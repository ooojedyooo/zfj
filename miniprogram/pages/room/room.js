// pages/room/room.js
// 房间页：创建 / 加入 / 随机匹配 / 等待对手
// 已接入微信云开发：房间由云端维护，客户端通过 watch 实时感知状态变化
const api = require('../../services/cloudApi')
const { MIN_PLANES, MAX_PLANES, TIMEOUT } = require('../../config/rules')

Page({
  data: {
    mode: 'create',      // create | join | random | waiting
    roomId: '',
    roomNo: '',
    password: '',
    usePassword: false,
    planeCount: MIN_PLANES,
    minPlanes: MIN_PLANES,
    maxPlanes: MAX_PLANES,
    joinRoomNo: '',
    joinPassword: '',
    playerCount: 0,
    waitSeconds: TIMEOUT.ROOM,
    loading: false,
    isCloud: api.isCloud
  },

  onLoad(options) {
    const app = getApp()
    app.enableShare()

    let mode = options.mode || 'create'
    // 从分享卡片进来：自动切到「加入房间」并回填房间号 / 密码
    const sharedRoomNo = String(options.roomNo || '').trim()
    const sharedPwd = options.pwd ? decodeURIComponent(options.pwd) : ''
    if (sharedRoomNo) mode = 'join'

    // 从结算页带过来的飞机数量，沿用上一局设置
    const planes = Number(options.planes)
    const planeCount = (planes >= MIN_PLANES && planes <= MAX_PLANES) ? planes : MIN_PLANES

    this.setData({
      mode,
      planeCount,
      password: String(Math.floor(1000 + Math.random() * 9000)),
      joinRoomNo: /^\d{6}$/.test(sharedRoomNo) ? sharedRoomNo : '',
      joinPassword: sharedPwd
    })

    if (mode === 'join') wx.setNavigationBarTitle({ title: '加入房间' })
    if (mode === 'random') wx.setNavigationBarTitle({ title: '随机匹配' })

    // 从结算页 / 大厅「再邀一局」进来：自动建房并停下等待好友
    if (options.auto === '1') {
      this.rivalName = options.rival ? decodeURIComponent(options.rival) : ''
      wx.setNavigationBarTitle({ title: '邀请好友' })
      this.onStartCreate()
    }
  },

  /** 分享房间卡片：好友点开直达「加入房间」并回填房间号 */
  onShareAppMessage() {
    const d = this.data
    if (d.roomNo) {
      const pwd = d.usePassword ? '&pwd=' + encodeURIComponent(d.password) : ''
      const title = this.rivalName
        ? '炸飞机 · ' + this.rivalName + '，房间 ' + d.roomNo + '，接着上次的账继续算！'
        : '炸飞机 · 房间号 ' + d.roomNo + '，来跟我打一局！'
      return {
        title,
        path: '/pages/room/room?mode=join&roomNo=' + d.roomNo + pwd
      }
    }
    return {
      title: '炸飞机 · 9×9 双人实时对战，机头一炮击毁',
      path: '/pages/index/index'
    }
  },

  onUnload() {
    this.stopWatch()
    this.stopCountdown()
    // 尚未进入对局就退出 → 释放房间（最后一人离开时由云端自动清理）
    if (this.data.roomId && !this.enteredGame) {
      api.leaveRoom({ roomId: this.data.roomId }).catch(() => {})
    }
  },

  /* ---------------- 创建房间 ---------------- */
  togglePassword(e) {
    this.setData({ usePassword: e.detail.value })
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

  async onStartCreate() {
    if (this.data.loading) return
    this.setData({ loading: true })
    wx.showLoading({ title: '创建中…', mask: true })
    try {
      const data = await api.createRoom({
        planeCount: this.data.planeCount,
        password: this.data.usePassword ? this.data.password : ''
      })
      wx.hideLoading()
      this.setData({ loading: false })
      this.enterWaiting(data)
    } catch (e) {
      wx.hideLoading()
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '创建失败', icon: 'none' })
    }
  },

  /* ---------------- 加入房间 ---------------- */
  onJoinRoomNoInput(e) {
    this.setData({ joinRoomNo: e.detail.value })
  },

  onJoinPasswordInput(e) {
    this.setData({ joinPassword: e.detail.value })
  },

  async onJoin() {
    if (this.data.loading) return
    const roomNo = String(this.data.joinRoomNo || '').trim()
    if (!/^\d{6}$/.test(roomNo)) {
      wx.showToast({ title: '请输入 6 位房间号', icon: 'none' })
      return
    }
    this.setData({ loading: true })
    wx.showLoading({ title: '加入中…', mask: true })
    try {
      const data = await api.joinRoom({ roomNo, password: this.data.joinPassword })
      wx.hideLoading()
      this.setData({ loading: false })
      this.enterWaiting(data)
    } catch (e) {
      wx.hideLoading()
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '加入失败', icon: 'none' })
    }
  },

  /* ---------------- 随机匹配 ---------------- */
  async doMatch() {
    if (this.data.loading) return
    this.setData({ loading: true })
    wx.showLoading({ title: '匹配中…', mask: true })
    try {
      const data = await api.matchRoom({ planeCount: this.data.planeCount })
      wx.hideLoading()
      this.setData({ loading: false })
      this.enterWaiting(data)
    } catch (e) {
      wx.hideLoading()
      this.setData({ loading: false })
      wx.showToast({ title: e.message || '匹配失败', icon: 'none' })
      setTimeout(() => wx.navigateBack(), 1200)
    }
  },

  /* ---------------- 等待对手 ---------------- */
  enterWaiting(data) {
    const app = getApp()
    app.globalData.match = {
      roomId: data.roomId,
      roomNo: data.roomNo,
      planeCount: data.planeCount
    }
    this.setData({
      mode: 'waiting',
      roomId: data.roomId,
      roomNo: data.roomNo,
      playerCount: data.matched ? 2 : 1
    })
    this.startWatch()
    this.startCountdown()
  },

  /** 实时监听房间：两人到齐（status 变为 deploy）即进入布阵 */
  startWatch() {
    this.stopWatch()
    this.watcher = api.watchRoom(this.data.roomId, (room) => {
      const playerCount = (room.players || []).length
      if (playerCount !== this.data.playerCount) this.setData({ playerCount })

      if (room.status === 'deploy' || room.status === 'battle') {
        this.enteredGame = true
        this.stopWatch()
        this.stopCountdown()
        wx.showToast({ title: '对手已就位', icon: 'success' })
        setTimeout(() => wx.redirectTo({ url: '/pages/deploy/deploy' }), 600)
      } else if (room.status === 'finished') {
        this.stopWatch()
        this.stopCountdown()
        wx.showModal({
          title: '房间已关闭',
          content: '对手已离开房间',
          showCancel: false,
          success: () => wx.navigateBack()
        })
      }
    })
  },

  stopWatch() {
    if (this.watcher) {
      try { this.watcher.close() } catch (e) { /* ignore */ }
      this.watcher = null
    }
  },

  startCountdown() {
    this.stopCountdown()
    this.timer = setInterval(() => {
      const left = this.data.waitSeconds - 1
      if (left <= 0) {
        this.stopCountdown()
        // 对应 PRD ROOM-06：超时自动解散
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

  onCancel() {
    this.stopWatch()
    this.stopCountdown()
    wx.navigateBack()
  }
})
