// minigame/js/core/draw.js
// Canvas 绘制原语
//
// 小游戏直接用 Canvas 2D，这里把常用画法收口，场景代码只写业务。
const theme = require('./theme')

/** 圆角矩形路径 */
function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r == null ? theme.radius.md : r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

/** 填充圆角矩形 */
function fillRect(ctx, x, y, w, h, color, r) {
  ctx.fillStyle = color
  if (r === 0) {
    ctx.fillRect(x, y, w, h)
    return
  }
  roundRectPath(ctx, x, y, w, h, r)
  ctx.fill()
}

/** 描边圆角矩形 */
function strokeRect(ctx, x, y, w, h, color, r, width) {
  ctx.strokeStyle = color
  ctx.lineWidth = width || 1
  roundRectPath(ctx, x, y, w, h, r)
  ctx.stroke()
}

/** 圆 */
function circle(ctx, cx, cy, radius, color) {
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fill()
}

/** 直线 */
function line(ctx, x1, y1, x2, y2, color, width) {
  ctx.strokeStyle = color
  ctx.lineWidth = width || 1
  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()
}

/**
 * 文字
 * @param {Object} o { x, y, size, color, weight, align, baseline, maxWidth }
 */
function text(ctx, str, x, y, o) {
  const opt = o || {}
  const size = opt.size || theme.size.body
  ctx.font = (opt.weight || 400) + ' ' + size + 'px ' + theme.font
  ctx.fillStyle = opt.color || theme.color.text
  ctx.textAlign = opt.align || 'left'
  ctx.textBaseline = opt.baseline || 'middle'
  if (opt.maxWidth) {
    ctx.fillText(String(str), x, y, opt.maxWidth)
  } else {
    ctx.fillText(String(str), x, y)
  }
}

/** 测量文字宽度 */
function measure(ctx, str, size, weight) {
  ctx.font = (weight || 400) + ' ' + (size || theme.size.body) + 'px ' + theme.font
  return ctx.measureText(String(str)).width
}

/** 单行截断（超出宽度尾部加 …） */
function ellipsis(ctx, str, maxWidth, size, weight) {
  let s = String(str == null ? '' : str)
  if (measure(ctx, s, size, weight) <= maxWidth) return s
  while (s.length > 1 && measure(ctx, s + '…', size, weight) > maxWidth) {
    s = s.slice(0, -1)
  }
  return s + '…'
}

/** 铺底色 */
function background(ctx, layout) {
  fillRect(ctx, 0, 0, layout.W, layout.H, theme.color.bg, 0)
}

module.exports = {
  roundRectPath, fillRect, strokeRect, circle, line, text, measure, ellipsis, background
}
