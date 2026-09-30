// config/cloud.js
// 云开发配置
module.exports = {
  // 云开发环境 ID
  // 获取方式：微信开发者工具 → 顶部「云开发」→ 设置 → 环境 ID
  // 留空则使用默认环境（仅当该账号下只有一个云环境时可用）
  ENV_ID: '',

  // 是否启用云端联机
  //   true  → 走云函数 + 云数据库实时监听（正式对局）
  //   false → 使用离线引擎（services/offlineGame.js），对手由本地 AI 扮演
  //
  // ⚑ 云环境尚未配置时保持 false，游戏可立刻完整试玩：
  //   建房 → 对手 2.5s 后自动加入 → 布阵 → 随机先手 → 轮流开火 → 结算
  // 云环境就绪后：填好上面的 ENV_ID，把这里改成 true，并上传 cloudfunctions 下三个云函数。
  USE_CLOUD: false,

  COLLECTIONS: {
    ROOMS: 'rooms',
    GAMES: 'games'
  },

  FUNCTIONS: {
    ROOM: 'room',
    GAME: 'game'
  }
}
