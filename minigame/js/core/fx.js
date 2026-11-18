// minigame/js/core/fx.js
// 动效时钟 —— 所有"每帧在变的东西"的唯一时间源
//
// 为什么不用 Date.now() 直接取相位（`angle = (now % period) / period * TAU`）：
//   ① 切后台 60s 回来，now 前进 60000ms，相位前进 (60000 % 7200) = 2400ms 的量
//      —— 视觉上雷达瞬间跳小半圈；
//   ② 系统时间被网络校时或用户手动改动时，相位会任意跳；
//   ③ Date.now() 在部分旧安卓上粒度 10~16ms，45°/s 下每帧 0.75°，
//      这个粒度会造成可见的台阶感。
//
// 累积 clock 的输入是 tick 里已经钳过 [0, 64] 的 dt，于是**天然免疫**
// "切后台回来跳一大格"：无论后台多久，最多推进 64ms（45°/s 下 = 2.9°，看不出）。
//
// 关键约定：**这个时钟永不复位**。
//   曾经考虑过"进入某个状态时复位，让雷达每次从 12 点起扫"。但按美术规格，
//   对局里"等待对方"这个状态每回合要反复进出（一局十几次），每次复位 =
//   雷达每次都从 12 点重新开机，那个规律比相位本身更显眼。
//   连续累积反而没有相位跳变：关闭期间没人画它，所以"跳"不存在；
//   重新打开时靠 240ms 的 masterAlpha 淡入遮住入场。

/** 单帧 dt 上限。与 app.js 里的钳制同源，这里再兜一次，防止调用方忘记。 */
const MAX_DT = 64

/**
 * 创建一个时钟实例。
 *
 * 为什么是实例而不是模块级单例：出图脚本与测试会在同一个进程里先后创建
 * 多个 app，共享一个全局 t 会让上一个 app 的时间漏到下一个里。
 */
function createFx() {
  let t = 0
  let frozen = false

  return {
    /** 每帧推进。dt 单位毫秒。 */
    step: function (dt) {
      if (frozen) return
      const d = Number(dt)
      if (!(d > 0)) return                    // NaN / 负数 / 0 全部忽略
      t += Math.min(MAX_DT, d)
    },

    /** 当前时钟，毫秒，单调不减 */
    time: function () {
      return t
    },

    /**
     * 把时钟钉在某个值上并冻结 —— 只给预览出图用。
     *
     * 动效是时间的函数，不冻结的话每次跑 render-scenes 相位都不一样，
     * 出图既不可复现也没法 diff。
     */
    freeze: function (ms) {
      const v = Number(ms)
      if (!isFinite(v)) return
      t = Math.max(0, v)
      frozen = true
    },

    /** 解冻（照常累积） */
    thaw: function () {
      frozen = false
    },

    /** 是否处于冻结态，供测试断言 */
    isFrozen: function () {
      return frozen
    }
  }
}

module.exports = { createFx, MAX_DT }
