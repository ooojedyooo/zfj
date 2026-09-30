// pages/battle/battle.js
// 对战页 —— PRD 3.4 / 3.5 / 6.2 / 6.3
// 界面：上下双棋盘（上=我方受损，下=敌方战况），焦点可切换
// 操作：点选未攻击格 + 点击「发射」两步式出招
// 数据：全部来自云端；通过 watch 实时同步，本地不做任何判定
const api = require('../../services/cloudApi')
const { createMatrix } = require('../../utils/board')
const { getAbsoluteCells } = require('../../utils/plane')
const { RESULT, BOARD_SIZE, TIMEOUT } = require('../../config/rules')

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
    focus: 'foe',        // 'mine' | 'foe'
    statusText: '同步中…',
    resultToast: '',
    myShots: 0,
    foeShots: 0,
    turnSeconds: TIMEOUT.TURN,
    myDestroyed: 0,
    foeDestroyed: 0,
    planeCount: 1
  },

  async onLoad() {
    const app = getApp()
    const match = app.globalData.match || {}
    this.roomId = match.roomId

    if (!this.roomId) {
      wx.showToast({ title: '对局信息丢失', icon: 'none' })
      setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 1200)
      return
    }

    try {
      const data = await api.sync({ roomId: this.roomId })
      this.myOpenid = data.myOpenid
      this.myDeploy = data.myDeploy || []
      this.setData({ planeCount: this.myDeploy.length || match.planeCount || 1 })
      this.applyBattle(data.battle)
    } catch (e) {
      wx.showToast({ title: e.message || '同步失败', icon: 'none' })
    }

    this.startWatch()
    this.startTimer()
  },

  onUnload() {
    this.stopWatch()
    this.stopTimer()
  },

  /* ---------------- 实时同步 ---------------- */
  startWatch() {
    this.stopWatch()
    this.watcher = api.watchRoom(this.roomId, (room) => {
      this.applyBattle(room.battle)
    }, () => {
      wx.showToast({ title: '连接中断，请重新进入', icon: 'none' })
    })
  },

  stopWatch() {
    if (this.watcher) {
      try { this.watcher.close() } catch (e) { /* ignore */ }
      this.watcher = null
    }
  },

  /* ---------------- 回合计时 ---------------- */
  startTimer() {
    this.stopTimer()
    this.timer = setInterval(() => {
      if (this.data.finished) return
      const b = this.lastBattle
      if (!b || !b.turnDeadline) return

      const left = Math.max(0, Math.ceil((b.turnDeadline - Date.now()) / 1000))
      if (left !== this.data.turnSeconds) this.setData({ turnSeconds: left })

      if (left <= 0) {
        // 双方都会触发，服务端按 deadline 判定，天然幂等
        this.requestTick()
      }
    }, 1000)
  },

  stopTimer() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  async requestTick() {
    if (this.ticking) return
    this.ticking = true
    try { await api.tick({ roomId: this.roomId }) } catch (e) { /* ignore */ }
    setTimeout(() => { this.ticking = false }, 2500)
  },

  /* ---------------- 渲染 ---------------- */
  applyBattle(b) {
    if (!b || !this.myOpenid) return
    this.lastBattle = b

    const mine = (b.marks && b.marks[this.myOpenid]) || {}
    const incoming = (b.incoming && b.incoming[this.myOpenid]) || {}
    const myStats = (b.stats && b.stats[this.myOpenid]) || { kill: 0, lost: 0, shots: 0 }

    const myTurn = b.turn === this.myOpenid
    const finished = !!b.finished

    this.setData({
      myCells: this.buildMyCells(incoming),
      foeCells: this.buildFoeCells(mine),
      foeDisabled: this.buildDisabled(mine),
      myTurn,
      finished,
      focus: finished ? this.data.focus : (myTurn ? 'foe' : 'mine'),
      statusText: finished ? '对局结束' : (myTurn ? '轮到你开炮' : '等待对方行动…'),
      myShots: myStats.shots,
      foeShots: Object.keys(incoming).length,
      myDestroyed: myStats.lost,
      foeDestroyed: myStats.kill,
      turnSeconds: b.turnDeadline ? Math.max(0, Math.ceil((b.turnDeadline - Date.now()) / 1000)) : 0
    })

    if (finished && !this.resultHandled) {
      this.resultHandled = true
      setTimeout(() => this.goResult(b), 800)
    }
  },

  /** 我方海域：自己的飞机 + 被炸痕迹（自己的飞机当然看得见） */
  buildMyCells(incoming) {
    const cells = createMatrix(BOARD_SIZE, '')
    ;(this.myDeploy || []).forEach(p => {
      const abs = getAbsoluteCells(p.planeId, p.anchorRow, p.anchorCol, p.rotation)
      abs.forEach(c => { cells[c.row - 1][c.col - 1] = 'plane' })
    })
    Object.keys(incoming).forEach(k => {
      const parts = k.split(',')
      const r = Number(parts[0])
      const c = Number(parts[1])
      const res = incoming[k]
      cells[r - 1][c - 1] = res === RESULT.KILL ? 'kill'
        : res === RESULT.HIT ? 'hit' : 'miss'
    })
    return cells
  },

  /** 敌方海域：只显示我方炸过的点位，绝不显示对方飞机形状（T-08） */
  buildFoeCells(mine) {
    const cells = createMatrix(BOARD_SIZE, '')
    Object.keys(mine).forEach(k => {
      const parts = k.split(',')
      const r = Number(parts[0])
      const c = Number(parts[1])
      const res = mine[k]
      cells[r - 1][c - 1] = res === RESULT.KILL ? 'kill'
        : res === RESULT.HIT ? 'hit' : 'miss'
    })
    return cells
  },

  /** 已轰炸过的格位，用于置灰不可选中（BAT-07） */
  buildDisabled(mine) {
    const map = {}
    Object.keys(mine).forEach(k => { map[k] = true })
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
  async onFire() {
    const sel = this.data.selected
    if (!sel) {
      wx.showToast({ title: '请先选择轰炸坐标', icon: 'none' })
      return
    }
    if (!this.data.myTurn || this.data.finished || this.firing) return

    this.firing = true
    try {
      const res = await api.fire({ roomId: this.roomId, row: sel.row, col: sel.col })
      this.setData({ selected: null, resultToast: RESULT_TEXT[res.result] || '' })
      setTimeout(() => this.setData({ resultToast: '' }), 900)
      // 战况由 watch 自动同步，无需手动刷新
    } catch (e) {
      wx.showToast({ title: e.message || '发射失败', icon: 'none' })
    } finally {
      this.firing = false
    }
  },

  /** 投降（T-07） */
  onSurrender() {
    if (this.data.finished) return
    wx.showModal({
      title: '确认投降',
      content: '投降后本局将直接判定失败，确定吗？',
      confirmText: '确认投降',
      confirmColor: '#E24B4A',
      success: async (r) => {
        if (!r.confirm) return
        try {
          await api.surrender({ roomId: this.roomId })
        } catch (e) {
          wx.showToast({ title: e.message || '操作失败', icon: 'none' })
        }
      }
    })
  },

  /** 结算并跳转（PRD 5.5 / END-01） */
  goResult(b) {
    const app = getApp()
    const myStats = (b.stats && b.stats[this.myOpenid]) || { kill: 0, lost: 0, shots: 0 }
    app.globalData.matchResult = {
      roomId: this.roomId,
      win: b.winner === this.myOpenid,
      endType: b.endType,
      myShots: myStats.shots,
      foeShots: (b.incoming && b.incoming[this.myOpenid]) ? Object.keys(b.incoming[this.myOpenid]).length : 0,
      myDestroyed: myStats.kill,
      foeDestroyed: myStats.lost,
      planeCount: this.data.planeCount
    }
    wx.redirectTo({ url: '/pages/result/result' })
  }
})
