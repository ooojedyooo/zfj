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
    TURN: 30,            // 每回合限时的默认值（房主可在 5~30 之间改，见 TURN_MIN/TURN_MAX）
    RECONNECT_KEEP: 60,  // 断线重连保留时长
    ROOM: 5 * 60         // 房间等待对手超时
  },

  // 每步限时（T-05 修订）：房主建房时在 5~30 秒之间选，步长 5 秒
  //   为什么要下限：少于 5 秒根本来不及在 9×9 上点两下（选格 + 发射）。
  //   为什么步长不做 1 秒：5 秒档玩家已经能明显感到节奏差异，再细就是给自己加控件。
  TURN_MIN: 5,
  TURN_MAX: 30,
  TURN_DEFAULT: 30,
  TURN_STEP: 5,

  // 房间名最大字数（用于按名字搜索，太长在列表里放不下）
  ROOM_NAME_MAX: 12,

  // 回合超时判负阈值：同一玩家连续超时达到该次数判负（T-02 修订，原为 3）
  //   超时不再「跳过回合」，而是自动轰炸一个格（见 utils/room.pickAutoTarget），
  //   所以连续超时 5 次 = 替玩家乱打 5 炮还没醒，才判负。
  MAX_TURN_TIMEOUT_STREAK: 5,

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
