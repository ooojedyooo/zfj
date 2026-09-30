// pages/room/room.js
// 房间页：创建 / 加入 / 随机匹配 / 等待对手
// 当前为本地调试模式（对手由本地引擎模拟），接入后端后替换为真实房间服务
const { genRoomId } = require('../../services/localGame')
const { MIN_PLANES, MAX_PLANES, TIMEOUT } = require('../../config/rules')

Page({
  data: {
    mode: 'create',      // create | join | random | waiting
    roomId: '',
    password: '',
    usePassword: false,
    planeCount: MIN_PLANES,
    minPlanes: MIN_PLANES,
    maxPlanes: MAX_PLANES,
    joinRoomId: '',
    joinPassword: '',
    waitSeconds: TIMEOUT.ROOM
  },

  onLoad(options) {
    const mode = options.mode || 'create'
    this.setData({ mode })

    if (mode === 'create') this.createRoom()
    if (mode === 'random') this.randomMatch()
    if (mode === 'join') {
      wx.setNavigationBarTitle({ title: '加入房间' })
    }
  },

  onUnload() {
    this.stopCountdown()
  },

  /* ---------------- 创建房间 ---------------- */
  createRoom() {
    const roomId = genRoomId()
    const password = this.data.usePassword
      ? String(Math.floor(1000 + Math.random() * 9000))
      : ''
    this.setData({ roomId, password })
  },

  togglePassword(e) {
    const usePassword = e.detail.value
    const password = usePassword ? String(Math.floor(1000 + Math.random() * 9000)) : ''
    this.setData({ usePassword, password })
  },

  incPlane() {
    if (this.data.planeCount < MAX_PLANES) {
      this.setData({ planeCount: this.data.planeCount + 1 })
    }
  },

  decPlane() {
    if (this.data.planeCount > MIN_PLANES) {
      this.setData({ planeCount: this.data.planeCount - 1 })
    }
  },

  // 进入等待状态
  onWait() {
    this.setData({ mode: 'waiting' })
    this.startCountdown()
    this.simulateOpponent()
  },

  /* ---------------- 加入房间 ---------------- */
  onJoinRoomIdInput(e) {
    this.setData({ joinRoomId: e.detail.value })
  },

  onJoinPasswordInput(e) {
    this.setData({ joinPassword: e.detail.value })
  },

  onJoin() {
    const { joinRoomId } = this.data
    if (!/^\d{6}$/.test(joinRoomId)) {
      wx.showToast({ title: '请输入 6 位房间号', icon: 'none' })
      return
    }
    // 真实实现：向服务端校验房间号与密码（对应 PRD ROOM-05）
    this.setData({ mode: 'waiting', roomId: joinRoomId })
    this.startCountdown()
    this.simulateOpponent()
  },

  /* ---------------- 随机匹配 ---------------- */
  randomMatch() {
    this.setData({ mode: 'waiting' })
    this.startCountdown()
    this.simulateOpponent()
  },

  /* ---------------- 等待对手 ---------------- */
  startCountdown() {
    this.stopCountdown()
    this.timer = setInterval(() => {
      const left = this.data.waitSeconds - 1
      if (left <= 0) {
        // 对应 PRD ROOM-06：超时自动解散
        this.stopCountdown()
        wx.showModal({
          title: '匹配超时',
          content: '等待超过 5 分钟仍未匹配到对手，房间已自动解散。',
          showCancel: false,
          success: () => wx.navigateBack()
        })
        return
      }
      this.setData({ waitSeconds: left })
    }, 1000)
  },

  stopCountdown() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  },

  // 本地调试：模拟对手进入房间（接入后端后删除本方法）
  simulateOpponent() {
    setTimeout(() => {
      if (this.data.mode !== 'waiting') return
      this.stopCountdown()
      wx.showToast({ title: '对手已就位', icon: 'success' })
      setTimeout(() => this.goDeploy(), 600)
    }, 1200)
  },

  goDeploy() {
    const app = getApp()
    app.globalData.match = {
      roomId: this.data.roomId,
      planeCount: this.data.planeCount,
      password: this.data.password
    }
    wx.redirectTo({
      url: '/pages/deploy/deploy?planeCount=' + this.data.planeCount
    })
  },

  onCancel() {
    this.stopCountdown()
    wx.navigateBack()
  }
})
