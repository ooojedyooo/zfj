// config/rules.js
// 游戏规则常量 —— 与 PRD 第 3 章一一对应，集中管理，避免散落魔法数字

module.exports = {
  // 棋盘：9 × 9 固定（PRD 3.1）
  BOARD_SIZE: 9,

  // 布阵：飞机数量 1 ~ 3 架（PRD 3.3）
  MIN_PLANES: 1,
  MAX_PLANES: 3,

  // 方向：4 向旋转，值 = 顺时针旋转次数 × 90°（PRD 3.3）
  ROTATIONS: [0, 1, 2, 3],

  // 计时（单位：秒，均可配置，对应 T-03 / T-05 / T-06 / T-10）
  TIMEOUT: {
    DEPLOY: 60,          // 布阵限时，超时自动随机布阵并强制就绪
    TURN: 30,            // 每回合限时，超时自动跳过
    RECONNECT_KEEP: 60,  // 断线重连保留时长
    ROOM: 5 * 60         // 房间等待对手超时
  },

  // 回合超时判负阈值：同一玩家连续超时达到该次数判负（T-02）
  MAX_TURN_TIMEOUT_STREAK: 3,

  // 命中判定结果（PRD 3.5）
  RESULT: {
    MISS: 'miss',  // 未击中
    HIT: 'hit',    // 击中（机翼 / 机身 / 机尾）
    KILL: 'kill'   // 击毁（击中机头）—— 注意：不揭示飞机形状与朝向（T-08）
  },

  // 对局结束方式（用于埋点 battle_end，PRD 8.2）
  END_TYPE: {
    ALL_DESTROYED: 'all_destroyed', // 一方全部飞机被击毁
    SURRENDER: 'surrender',         // 投降
    TIMEOUT: 'timeout'              // 连续超时判负
  }
}
