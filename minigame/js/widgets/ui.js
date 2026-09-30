// minigame/js/widgets/ui.js
// 通用页面元素：标题块、卡片、信息行、模式提示
const theme = require('../core/theme')
const draw = require('../core/draw')

/** 页首标题块，返回内容起始 y */
function titleBlock(ctx, layout, title, subtitle) {
  const u = layout.u.bind(layout)
  const x = u(40)
  let y = layout.safeTop + u(36) + u(theme.size.h1) / 2
  draw.text(ctx, title, x, y, { size: u(theme.size.h1), weight: 500, color: theme.color.primaryDark })
  y += u(48)
  if (subtitle) {
    draw.text(ctx, subtitle, x, y, { size: u(theme.size.small), color: theme.color.textMuted })
    y += u(44)
  }
  return y + u(20)
}

/** 卡片底板 */
function card(ctx, layout, x, y, w, h) {
  const u = layout.u.bind(layout)
  draw.fillRect(ctx, x, y, w, h, theme.color.card, u(theme.radius.lg))
  draw.strokeRect(ctx, x, y, w, h, theme.color.border, u(theme.radius.lg), 1)
}

/** 卡片内的一行「标签 —— 值」 */
function row(ctx, layout, x, y, w, label, value) {
  const u = layout.u.bind(layout)
  const size = u(theme.size.body)
  draw.text(ctx, label, x, y, { size: size, color: theme.color.text })
  draw.text(ctx, value, x + w, y, {
    size: size, color: theme.color.text, weight: 500, align: 'right'
  })
  draw.line(ctx, x, y + u(26), x + w, y + u(26), theme.color.border, 1)
}

/** 分区小标题 */
function sectionTitle(ctx, layout, x, y, text) {
  draw.text(ctx, text, x, y, {
    size: layout.u(theme.size.h3), weight: 500, color: theme.color.text
  })
}

/** 离线试玩提示条 */
function modeTip(ctx, layout, x, y, w, text) {
  const u = layout.u.bind(layout)
  const h = u(52)
  draw.fillRect(ctx, x, y, w, h, theme.color.gray, u(theme.radius.sm))
  draw.text(ctx, text, x + u(20), y + h / 2, {
    size: u(theme.size.tiny), color: theme.color.textMuted
  })
  return h
}

/** 圆形加载指示器（转圈） */
function spinner(ctx, layout, cx, cy, r, phase) {
  ctx.strokeStyle = theme.color.primaryLight
  ctx.lineWidth = layout.u(6)
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()

  ctx.strokeStyle = theme.color.primary
  ctx.beginPath()
  ctx.arc(cx, cy, r, phase, phase + Math.PI * 0.55)
  ctx.stroke()
}

/** 小圆角标签 */
function tag(ctx, layout, x, y, text, color, bg) {
  const u = layout.u.bind(layout)
  const size = u(theme.size.tiny)
  const w = draw.measure(ctx, text, size) + u(24)
  const h = u(36)
  draw.fillRect(ctx, x, y, w, h, bg || theme.color.primaryLight, h / 2)
  draw.text(ctx, text, x + w / 2, y + h / 2, {
    size: size, color: color || theme.color.primaryDark, align: 'center'
  })
  return { x: x, y: y, w: w, h: h }
}

module.exports = { titleBlock, card, row, sectionTitle, modeTip, spinner, tag }
