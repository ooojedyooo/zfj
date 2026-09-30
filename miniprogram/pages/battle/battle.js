// pages/battle/battle.js
// 对战页 —— 对应 PRD 3.4 / 3.5 / 6.2 / 6.3
// 界面：上下双棋盘（上=我方受损，下=敌方战况），焦点可切换
// 操作：点选未攻击格 + 点击「发射」两步式出招
const { LocalGame } = require('../../services/localGame')
const { createMatrix } = require('../../utils/board')
const { RESULT, BOARD_SIZE } = require('../../config/rules')

const RESULT_TEXT = {
  [RESULT.MISS]: '未击中',
  [RESULT.HIT]: '击中！',
  [RESULT.KILL]: '击毁！'
}

Page({
  data: {
    size: BOARD_SIZE,
    myCells: [],
    foeCells: [],
    foeDisabled: {},
    selected: null,
    myTurn: false,
    finished: false,
    focus: 'foe',       // 'mine' | 'foe'
    statusText: '',
    resultToast: '',
    myShots: 0,
    foeShots: 0
  },

  onLoad() {
    const app = getApp()
    const match = app.globalData.match || {}

    const game = new LocalGame({ planeCount: match.planeCount || 1 })
    game.deploy(match.myDeployed || [])
    game.deployFoe()   // 本地模拟对手布阵
    this.game = game

    this.setData({
      myTurn: game.myTurn,
      focus: game.myTurn ? 'foe' : 'mine',
      statusText: game.myTurn ? '轮到你开炮' : '等待对方行动…'
    })

    this.refresh()

    if (!game.myTurn) this.foeTurn()
  },

  /* ---------------- 棋盘渲染 ---------------- */
  refresh() {
    this.setData({
      myCells: this.buildMyCells(),
      foeCells: this.buildFoeCells(),
      foeDisabled: this.buildDisabled(),
      myShots: this.game.myShots,
      foeShots: this.game.foeShots
    })
  },

  /** 我方海域：显示完整飞机 + 被炸痕迹（自己的飞机当然看得见） */
  buildMyCells() {
    const cells = createMatrix(BOARD_SIZE, '')
    this.game.myDeployed.forEach(p => {
      p.cells.forEach(c => {
        cells[c.row - 1][c.col - 1] = 'plane'
      })
    })
    Object.keys(this.game.foeProbes).forEach(k => {
      const [r, c] = k.split(',').map(Number)
      const res = this.game.foeProbes[k]
      cells[r - 1][c - 1] = res === RESULT.KILL ? 'kill'
        : res === RESULT.HIT ? 'hit' : 'miss'
    })
    return cells
  },

  /** 敌方海域：只显示我方炸过的点位，绝不显示对方飞机形状（T-08） */
  buildFoeCells() {
    const cells = createMatrix(BOARD_SIZE, '')
    Object.keys(this.game.myProbes).forEach(k => {
      const [r, c] = k.split(',').map(Number)
      const res = this.game.myProbes[k]
      cells[r - 1][c - 1] = res === RESULT.KILL ? 'kill'
        : res === RESULT.HIT ? 'hit' : 'miss'
    })
    return cells
  },

  /** 已轰炸过的格位，用于置灰不可选中（BAT-07） */
  buildDisabled() {
    const map = {}
    Object.keys(this.game.myProbes).forEach(k => { map[k] = true })
    return map
  },

  /* ---------------- 交互 ---------------- */
  onFoeCellTap(e) {
    if (!this.data.myTurn || this.data.finished) return
    this.setData({ selected: e.detail, focus: 'foe' })
  },

  focusMine() { this.setData({ focus: 'mine' }) },
  focusFoe() { this.setData({ focus: 'foe' }) },

  /** 发射（两步式出招的第二步，PRD 6.3） */
  onFire() {
    const sel = this.data.selected
    if (!sel) {
      wx.showToast({ title: '请先选择轰炸坐标', icon: 'none' })
      return
    }

    const res = this.game.fire(sel.row, sel.col)
    if (!res.ok) {
      wx.showToast({ title: '该坐标已轰炸过', icon: 'none' })
      return
    }

    this.setData({
      selected: null,
      resultToast: RESULT_TEXT[res.result] || ''
    })
    this.refresh()

    setTimeout(() => this.setData({ resultToast: '' }), 900)

    if (res.win) {
      this.endGame()
      return
    }
    this.foeTurn()
  },

  /** 对手回合（本地模拟） */
  foeTurn() {
    this.setData({
      myTurn: false,
      focus: 'mine',
      statusText: '等待对方行动…'
    })
    setTimeout(() => {
      const r = this.game.foeFire()
      this.refresh()
      if (r && r.lose) {
        this.endGame()
        return
      }
      this.setData({
        myTurn: this.game.myTurn,
        focus: this.game.myTurn ? 'foe' : 'mine',
        statusText: this.game.myTurn ? '轮到你开炮' : '等待对方行动…'
      })
    }, 900)
  },

  /** 投降（T-07） */
  onSurrender() {
    wx.showModal({
      title: '确认投降',
      content: '投降后本局将直接判定失败，确定吗？',
      confirmText: '确认投降',
      confirmColor: '#E24B4A',
      success: (r) => {
        if (r.confirm) {
          this.game.surrender()
          this.endGame()
        }
      }
    })
  },

  /** 结算并跳转（PRD 5.5 / END-01） */
  endGame() {
    const app = getApp()
    const g = this.game
    app.globalData.matchResult = {
      roomId: g.roomId,
      win: g.winner === 'me',
      endType: g.endType,
      myShots: g.myShots,
      foeShots: g.foeShots,
      myDestroyed: g.foeKilled.length,   // 我方击毁对方架数
      foeDestroyed: g.myKilled.length,   // 对方击毁我方架数
      planeCount: g.planeCount
    }
    wx.redirectTo({ url: '/pages/result/result' })
  }
})
