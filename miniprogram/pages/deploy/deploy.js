// pages/deploy/deploy.js
// 布阵页 —— PRD 3.3 / 5.3
// 操作：点击棋盘放置飞机（锚点 = 机头），旋转按钮切换朝向，支持一键随机
// 就绪时把布阵提交到云函数，由服务端做二次校验（不信任客户端）
const api = require('../../services/cloudApi')
const { getAbsoluteCells, validatePlacement, randomDeploy } = require('../../utils/plane')
const { createMatrix } = require('../../utils/board')
const { BOARD_SIZE, MIN_PLANES, TIMEOUT } = require('../../config/rules')

const ROTATION_LABEL = ['↑', '→', '↓', '←']

Page({
  data: {
    size: BOARD_SIZE,
    cells: [],
    placed: [],
    planeCount: MIN_PLANES,
    rotation: 0,
    rotationLabel: '↑',
    countdown: TIMEOUT.DEPLOY,
    readying: false,
    waitingOpponent: false
  },

  onLoad() {
    const app = getApp()
    const match = app.globalData.match || {}
    this.roomId = match.roomId
    const planeCount = match.planeCount || MIN_PLANES
    this.setData({ planeCount })
    this.refreshCells()
    this.startCountdown()
  },

  onUnload() {
    this.stopCountdown()
    this.stopWatch()
  },

  /* ---------------- 棋盘交互 ---------------- */
  onBoardTap(e) {
    if (this.data.readying || this.data.waitingOpponent) return
    const { row, col } = e.detail

    if (this.data.placed.length >= this.data.planeCount) {
      wx.showToast({ title: '飞机已全部放置', icon: 'none' })
      return
    }

    const cells = getAbsoluteCells('standard', row, col, this.data.rotation)
    const occupied = this.data.placed.reduce((acc, p) => acc.concat(p.cells), [])
    const check = validatePlacement(cells, occupied)

    if (!check.ok) {
      // 对应 PRD DEP-03：非法位置高亮提示
      wx.showToast({
        title: check.reason === 'overlap' ? '与其他飞机重叠' : '超出棋盘边界',
        icon: 'none'
      })
      return
    }

    const placed = this.data.placed.concat([{
      planeId: 'standard',
      anchorRow: row,
      anchorCol: col,
      rotation: this.data.rotation,
      cells
    }])
    this.setData({ placed })
    this.refreshCells()
  },

  onRotate() {
    if (this.data.waitingOpponent) return
    const rotation = (this.data.rotation + 1) % 4
    this.setData({ rotation, rotationLabel: ROTATION_LABEL[rotation] })
  },

  onRandom() {
    const placed = randomDeploy(this.data.planeCount, 'standard', BOARD_SIZE)
    this.setData({ placed })
    this.refreshCells()
  },

  onClear() {
    if (this.data.waitingOpponent) return
    this.setData({ placed: [] })
    this.refreshCells()
  },

  /** 把布阵结果渲染到 9×9 状态数组 */
  refreshCells() {
    const cells = createMatrix(BOARD_SIZE, '')
    this.data.placed.forEach(p => {
      p.cells.forEach(c => {
        cells[c.row - 1][c.col - 1] = 'plane'
      })
    })
    this.setData({ cells })
  },

  /* ---------------- 倒计时（T-03） ---------------- */
  startCountdown() {
    this.stopCountdown()
    this.timer = setInterval(() => {
      const left = this.data.countdown - 1
      if (left <= 0) {
        this.stopCountdown()
        // 超时：自动随机布阵并强制就绪
        this.onRandom()
        wx.showToast({ title: '布阵超时，已自动布置', icon: 'none' })
        setTimeout(() => this.onReady(), 600)
        return
      }
      this.setData({ countdown: left })
    }, 1000)
  },

  stopCountdown() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  /* ---------------- 就绪：提交云端（DEP-05 / DEP-06） ---------------- */
  async onReady() {
    if (this.data.placed.length < MIN_PLANES) {
      wx.showToast({ title: '至少布置 1 架飞机', icon: 'none' })
      return
    }
    if (this.data.readying || this.data.waitingOpponent) return

    this.stopCountdown()
    this.setData({ readying: true })

    const planes = this.data.placed.map(p => ({
      planeId: p.planeId,
      anchorRow: p.anchorRow,
      anchorCol: p.anchorCol,
      rotation: p.rotation
    }))

    wx.showLoading({ title: '提交中…', mask: true })
    try {
      const res = await api.deploy({ roomId: this.roomId, planes })
      wx.hideLoading()
      if (res.allReady) {
        // 双方就绪，立即开局
        wx.redirectTo({ url: '/pages/battle/battle' })
      } else {
        // 等待对手就绪，监听房间状态
        this.setData({ readying: false, waitingOpponent: true })
        this.watchStart()
      }
    } catch (e) {
      wx.hideLoading()
      this.setData({ readying: false })
      wx.showToast({ title: e.message || '提交失败', icon: 'none' })
      this.startCountdown()
    }
  },

  /** 等待对手就绪：房间进入 battle 即跳转 */
  watchStart() {
    this.stopWatch()
    this.watcher = api.watchRoom(this.roomId, (room) => {
      if (room.status === 'battle') {
        this.stopWatch()
        wx.redirectTo({ url: '/pages/battle/battle' })
      }
    })
  },

  stopWatch() {
    if (this.watcher) {
      try { this.watcher.close() } catch (e) { /* ignore */ }
      this.watcher = null
    }
  }
})
