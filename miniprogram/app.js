// app.js
// 炸飞机 · 全局逻辑
const { ENV_ID, USE_CLOUD } = require('./config/cloud')

App({
  globalData: {
    playerId: '',        // 本机玩家标识（临时身份，真实身份用云函数里的 OPENID）
    userInfo: null,      // 微信授权后填充
    match: null,         // 当前对局上下文 { roomId, roomNo, planeCount }
    matchResult: null,   // 对局结果，供结算页读取
    cloudReady: false
  },

  onLaunch() {
    this.initPlayerId()
    this.initCloud()
  },

  /**
   * 初始化临时玩家标识
   * 说明：真实对局身份以云函数中 cloud.getWXContext().OPENID 为准，
   *      这里的 playerId 仅用于本地调试与展示。
   */
  initPlayerId() {
    let playerId = wx.getStorageSync('zfj_player_id')
    if (!playerId) {
      playerId = 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      wx.setStorageSync('zfj_player_id', playerId)
    }
    this.globalData.playerId = playerId
  },

  /** 初始化云开发 */
  initCloud() {
    if (!USE_CLOUD) {
      console.info('[zfj] 离线试玩模式（未启用云开发，对手由本地 AI 扮演）')
      return
    }
    if (!wx.cloud) {
      console.error('[zfj] 当前基础库不支持云开发，请使用 2.2.3 及以上版本')
      return
    }
    wx.cloud.init({
      env: ENV_ID || undefined,   // 留空则使用默认环境
      traceUser: true
    })
    this.globalData.cloudReady = true
  },

  /** 统一开启「转发」入口（页面 onLoad 里调用一次即可） */
  enableShare() {
    if (typeof wx.showShareMenu === 'function') {
      wx.showShareMenu({ menus: ['shareAppMessage'] })
    }
  }
})
