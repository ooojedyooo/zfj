// config/cloud.js
// 云开发配置
module.exports = {
  // 云开发环境 ID
  // 获取方式：微信开发者工具 → 顶部「云开发」→ 设置 → 环境 ID
  // 留空则使用默认环境（仅当该账号下只有一个云环境时可用）
  ENV_ID: '',

  // 是否启用云端联机
  //   true  → 走云函数 + 云数据库实时监听（正式对局）
  //   false → 使用本地模拟引擎（services/localGame.js），无云环境也能跑通界面
  USE_CLOUD: true,

  COLLECTIONS: {
    ROOMS: 'rooms',
    GAMES: 'games'
  },

  FUNCTIONS: {
    ROOM: 'room',
    GAME: 'game'
  }
}
