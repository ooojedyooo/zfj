// minigame/js/widgets/slider.js
// 水平滑块 —— 目前只有「每步限时」用（5~30 秒，1 秒连续）
//
// 为什么不注册 zone：
//   滑块是**拖动**控件，手指按下去的那一刻就应该跳到该位置。
//   如果同时注册 zone，tap 又会触发一次 onTap，两边算出来的值未必一样，
//   表现为「松手后数值又跳了一下」。所以滑块只用 onTouchStart/Move 处理，
//   不进 zones —— hitZone 找不到它，也就不会重复响应。
//
// 值 ↔ 位置的换算放在这里，是因为它有两个陷阱：
//   ① 手柄有半径，手指在轨道两端时圆心必须收进来半个手柄，否则手柄会画到轨道外；
//   ② 换算出来的是浮点数，必须当场取整，否则「界面 18 秒 / 服务端 18.37 秒」。
const theme = require('../core/theme')
const draw = require('../core/draw')

const TRACK_H = 18     // 轨道粗细（设计稿单位）。深色面板上 12 太细，看着像一条发丝
const KNOB_R = 24       // 手柄半径

/** 值 → 手柄圆心 x */
function xOf(rect, value, min, max) {
  const t = max > min ? (value - min) / (max - min) : 0
  const clamped = Math.min(1, Math.max(0, t))
  return rect.x + KNOB_R + clamped * (rect.w - KNOB_R * 2)
}

/** 手指 x → 值（已取整并夹在 min~max） */
function valueAt(rect, x, min, max) {
  const span = rect.w - KNOB_R * 2
  const t = span > 0 ? (x - rect.x - KNOB_R) / span : 0
  return Math.min(max, Math.max(min, Math.round(min + t * (max - min))))
}

/**
 * 绘制
 * @param {object} o { value, min, max, disabled, showScale }
 */
function render(ctx, u, rect, o) {
  const c = theme.color
  const cy = rect.y + rect.h / 2
  const x0 = rect.x + KNOB_R
  const x1 = rect.x + rect.w - KNOB_R
  const th = u(TRACK_H)
  const knobX = xOf(rect, o.value, o.min, o.max)

  const prev = ctx.globalAlpha
  if (o.disabled) ctx.globalAlpha = prev * 0.45

  // 轨道：底槽 + 已填充段（填充色就是「当前值」，不用看数字也能估）
  // 底槽用 borderHi 而不是 border：深面板上 border 几乎和背景同色，
  // 只剩「已填充那一段」能看见，滑块的可用范围就读不出来了
  draw.fillRect(ctx, x0, cy - th / 2, x1 - x0, th, c.borderHi, th / 2)
  if (knobX > x0) draw.fillRect(ctx, x0, cy - th / 2, knobX - x0, th, c.primary, th / 2)

  // 手柄：白底 + 主色描边，中间再压一个更小的实心点 ——
  // 纯白圆在深底上虽然亮，但没有边界；双环让它始终看得出是个「抓手」
  draw.circle(ctx, knobX, cy, u(KNOB_R), '#FFFFFF')
  draw.strokeCircle(ctx, knobX, cy, u(KNOB_R) - 1, c.primary, 3)
  draw.circle(ctx, knobX, cy, u(KNOB_R - 12), c.primary)

  // 两端刻度：滑块不给范围，玩家不知道能拖到哪
  if (o.showScale !== false) {
    draw.text(ctx, String(o.min), x0, cy + u(KNOB_R) + u(14), {
      size: u(theme.size.tiny), color: c.textMuted, align: 'center'
    })
    draw.text(ctx, String(o.max), x1, cy + u(KNOB_R) + u(14), {
      size: u(theme.size.tiny), color: c.textMuted, align: 'center'
    })
  }

  ctx.globalAlpha = prev
}

module.exports = { render, xOf, valueAt, KNOB_R }
