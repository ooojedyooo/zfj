// services/aiTune.js
// 离线 AI 强度参数 —— 单独抽一个模块，因为现在有两个消费方：
//   ① services/localGame.js   出招时读它（原来这里是两个写死的常量）
//   ② scenes/ai-tune.js       大厅里的调节页，拖动滑块改它
//
// 为什么不在 localGame 里直接 wx.getStorageSync：
//   localGame 是纯玩法逻辑，也被 scripts/bench-ai.js 在 Node 里跑。
//   把「存储」这件事关在这个模块里，localGame 只管 `aiTune.get()` 拿两个数，
//   换成别的存储方式（云端下发、URL 参数）也不用动玩法代码。
//
// 只在离线试玩里生效。联机之后对手是真人，这段根本不会被调用。

const KEY = 'zfj_ai_tune'

// 默认值来自实测（scripts/bench-ai.js 400 局 × 3 档架数）：
//   满血密度法（HEAD 2.2 / SLIP 0）1 架 8 炮、3 架 21 炮 —— 远超普通人类，像被机器碾压。
//   掺 35% 走神后回到 11 / 30 —— 比人稍强、会犯错、有破绽可抓，这才是陪练该有的手感。
const DEFAULTS = { headWeight: 1.3, slipRate: 0.35 }

// 允许的调整范围。两端都刻意留了「明显过界」的档位，
// 让人可以直接把 AI 调成沙包或神仙，感受差别有多大。
const LIMITS = {
  headWeight: { min: 0.6, max: 3.0, step: 0.1 },
  slipRate: { min: 0, max: 0.9, step: 0.05 }
}

// 滑块用的是整数（滑块组件只认整数），这里是两边的换算比例：
//   机头权重 1.3 ↔ 滑块 13；走神率 0.35 ↔ 滑块 7
const SLIDER = {
  head: { min: 6, max: 30, scale: 0.1 },
  slip: { min: 0, max: 18, scale: 0.05 }
}

/**
 * 强度分级 —— 给玩家看的「这么说到底是什么水平」
 *
 * 主旋钮是走神率：它决定「这一炮是推理还是瞎摸」的占比，
 * 对体感的影响远大于机头权重（后者只在推理那一半里起作用）。
 * 所以先按 slipRate 归档，再用 headWeight 上下微调一级。
 */
const LEVELS = [
  { name: '沙包', desc: '大半在瞎摸，闭眼也能赢' },
  { name: '轻松', desc: '会推理，但常走神' },
  { name: '均衡', desc: '比人稍强，有破绽' },
  { name: '难缠', desc: '很少走神，盯机头很准' },
  { name: '碾压', desc: '几乎不犯错，很难赢' }
]

let cache = null

function round2(v) {
  return Math.round(v * 100) / 100
}

/** 夹到范围内并对齐到步长 */
function quantize(v, range) {
  // 「没设」必须先认出来，不能直接交给 Number()：
  // Number(null) === 0、Number('') === 0，而 0 在这里是**合法值**（走神率 0 = 满血碾压）。
  // 存储里缺字段就会悄悄把 AI 变成打不过，而不是回落到默认强度。
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!isFinite(n)) return null
  const clamped = Math.min(range.max, Math.max(range.min, n))
  const q = Math.round(clamped / range.step) * range.step
  return round2(Math.min(range.max, Math.max(range.min, q)))
}

/**
 * 规范化：任何来源（storage 里的旧值、手输的越界值、NaN）都收成合法参数。
 * 读盘时一定要过这一步 —— 上一版留下 0 或 null 会让 AI 直接卡死（slipRate 恒为 0 还算能跑，
 * headWeight 变 NaN 就等于每一格都是 NaN 权重，选点直接返回 null）。
 */
function normalize(o) {
  const src = o || {}
  const h = quantize(src.headWeight, LIMITS.headWeight)
  const s = quantize(src.slipRate, LIMITS.slipRate)
  return {
    headWeight: h === null ? DEFAULTS.headWeight : h,
    slipRate: s === null ? DEFAULTS.slipRate : s
  }
}

function canStore() {
  return typeof wx !== 'undefined' && wx && typeof wx.getStorageSync === 'function'
}

/** 当前参数（带内存缓存，出招时每炮都会读，不能每次都碰 storage） */
function get() {
  if (cache) return cache
  let raw = null
  if (canStore()) {
    try { raw = wx.getStorageSync(KEY) || null } catch (e) { raw = null }
  }
  cache = normalize(raw)
  return cache
}

/** 写入并落盘（拖动过程中请用 peek 预览，松手再 set，别每一帧都写盘） */
function set(o) {
  cache = normalize(o)
  if (canStore()) {
    try { wx.setStorageSync(KEY, cache) } catch (e) { /* 存储满了也不该影响开局 */ }
  }
  return cache
}

/** 恢复默认 */
function reset() {
  return set(DEFAULTS)
}

/** 是不是默认值（大厅上可以据此标「默认」） */
function isDefault(o) {
  const t = o ? normalize(o) : get()
  return t.headWeight === DEFAULTS.headWeight && t.slipRate === DEFAULTS.slipRate
}

/**
 * 强度分级
 *
 * 【为什么按「估计炮数」分，而不是按走神率阈值】
 * 早先是「先按 slipRate 归档，再用 headWeight 上下微调一级」，问题是两个旋钮
 * 互相干扰时结果反直觉 —— 走神率拉到 90% 但机头权重也拉满，实际 13.6 炮，
 * 却因为「加权升一级」被标成「轻松」，玩家会觉得「我都拉满了怎么还不是沙包」。
 * 改成直接用拟合出的炮数分档：等级和界面上的「约 N 炮」同源，自己解释自己。
 *
 * 断点取自实测（1 架局，每档 200 局）：
 *   8.6 炮 机头3.0/走神0      → 碾压
 *   10.1 炮 机头1.3/走神0      → 难缠
 *   11.8 炮 默认               → 均衡
 *   12.6 炮 机头3.0/走神0.9    → 轻松
 *   15.2 炮 机头0.6/走神0.9    → 沙包
 */
function level(o) {
  const t = o ? normalize(o) : get()
  const shots = estimateShots(t)
  let i
  if (shots <= 9.3) i = 4
  else if (shots <= 11) i = 3
  else if (shots <= 12.4) i = 2
  else if (shots <= 14) i = 1
  else i = 0
  return { index: i, name: LEVELS[i].name, desc: LEVELS[i].desc, total: LEVELS.length, shots: shots }
}

/**
 * 粗估「打 1 架要挨几炮」—— 给玩家一个「拖到这里会怎样」的直觉，不是精确计算。
 *
 * 拟合自实测（每档 200 局，机头固定 1.3 时）：
 *   走神率 0 → 10.1 炮，0.35 → 11.8，0.9 → 15.0   ⇒ 约 10 + slip*5.5
 *   机头权重再做一档修正：0.6 → +6%，3.0 → -15%
 * 实测误差在 ±0.8 炮以内，够用。真要精确数字去跑 scripts/bench-ai.js。
 */
function estimateShots(o) {
  const t = o ? normalize(o) : get()
  const base = 10 + t.slipRate * 5.5
  const adj = 1 - (t.headWeight - 1.3) * 0.09
  return Math.round(base * adj)
}

/* ---- 滑块换算：滑块只认整数，真实值是小数 ---- */

function headToSlider(v) {
  return Math.round((v === undefined ? get().headWeight : v) * 10)
}
function sliderToHead(s) {
  return round2(s * SLIDER.head.scale)
}
function slipToSlider(v) {
  return Math.round((v === undefined ? get().slipRate : v) / SLIDER.slip.scale)
}
function sliderToSlip(s) {
  return round2(s * SLIDER.slip.scale)
}

/** 测试用：清掉内存缓存，强制下次 get() 重新读盘 */
function _clearCache() {
  cache = null
}

module.exports = {
  KEY,
  DEFAULTS,
  LIMITS,
  SLIDER,
  LEVELS,
  normalize,
  get,
  set,
  reset,
  isDefault,
  level,
  estimateShots,
  headToSlider,
  sliderToHead,
  slipToSlider,
  sliderToSlip,
  _clearCache
}
