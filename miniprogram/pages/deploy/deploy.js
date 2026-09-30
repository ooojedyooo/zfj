// pages/deploy/deploy.js
// 布阵页 —— 对应 PRD 3.3 / 5.3
// 操作：点击棋盘放置飞机（锚点 = 机头），旋转按钮切换朝向，支持一键随机
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
    countdown: TIMEOUT.DEPLOY
  },

  onLoad(options) {
    const planeCount = Number(options.planeCount) || MIN_PLANES
    this.setData({ planeCount })
    this.refreshCells()
    this.startCountdown()
  },

  onUnload() {
    this.stopCountdown()
  },

  /* ---------------- 棋盘交互 ---------------- */
  onBoardTap(e) {
    const { row, col } = e.detail

    if (this.data.placed.length >= this.data.planeCount) {
      wx.showToast({ title: '飞机已全部放置', icon: 'none' })
      return
    }

    const cells = getAbsoluteCells('standard', row, col, this.data.rotation)
    const occupied = this.data.placed.reduce((acc, p) => acc.concat(p.cells), [])
    const check = validatePlacement(cells, occupied)

    if (!check.ok) {
      // 对应 PRD DEP-03
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
    const rotation = (this.data.rotation + 1) % 4
    this.setData({ rotation, rotationLabel: ROTATION_LABEL[rotation] })
  },

  onRandom() {
    const placed = randomDeploy(this.data.planeCount, 'standard', BOARD_SIZE)
    this.setData({ placed })
    this.refreshCells()
  },

  onClear() {
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
        setTimeout(() => this.onReady(), 800)
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

  /* ---------------- 就绪（DEP-05 / DEP-06） ---------------- */
  onReady() {
    if (this.data.placed.length < MIN_PLANES) {
      wx.showToast({ title: '至少布置 1 架飞机', icon: 'none' })
      return
    }
    this.stopCountdown()

    const app = getApp()
    app.globalData.match = Object.assign({}, app.globalData.match, {
      myDeployed: this.data.placed,
      planeCount: this.data.planeCount
    })

    wx.redirectTo({ url: '/pages/battle/battle' })
  }
})
