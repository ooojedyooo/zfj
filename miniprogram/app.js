// app.js
// 炸飞机 · 全局逻辑
// 说明：本期不接入账号体系，使用本地持久化的临时玩家标识（对应 PRD 5.1 ACC-01）
App({
  globalData: {
    playerId: '',        // 本机玩家标识
    userInfo: null,      // 微信授权后填充
    match: null          // 当前对局上下文 { roomId, role, config }
  },

  onLaunch() {
    this.initPlayerId()
  },

  /**
   * 初始化临时玩家标识
   * 未接入登录体系前，用随机串作为本地身份，保证同机复玩时身份稳定
   */
  initPlayerId() {
    let playerId = wx.getStorageSync('zfj_player_id')
    if (!playerId) {
      playerId = 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      wx.setStorageSync('zfj_player_id', playerId)
    }
    this.globalData.playerId = playerId
  }
})
