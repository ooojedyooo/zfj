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

/** 描边圆 */
function strokeCircle(ctx, cx, cy, radius, color, width) {
  ctx.strokeStyle = color
  ctx.lineWidth = width || 1
  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.stroke()
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
 * 虚线
 *
 * 手工分段实现，不用 ctx.setLineDash()：
 *   ① 小游戏基础库对 setLineDash 的支持不一致（部分安卓机上是空实现）；
 *   ② 用 line() 拼装后，测试桩不需要额外方法就能断言「画了虚线」。
 * @param {number} dash 实线段长
 * @param {number} gap  间隔长
 */
function dashedLine(ctx, x1, y1, x2, y2, color, width, dash, gap) {
  const dx = x2 - x1
  const dy = y2 - y1
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len < 0.5) return
  const d = dash || 6
  const g = gap == null ? d : gap
  const ux = dx / len
  const uy = dy / len
  let p = 0
  while (p < len) {
    const e = Math.min(p + d, len)
    line(ctx, x1 + ux * p, y1 + uy * p, x1 + ux * e, y1 + uy * e, color, width || 1)
    p = e + g
  }
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

/**
 * 垂直渐变填充
 *
 * 为什么这里要判 createLinearGradient 存在：部分老基础库与测试桩没有这个方法，
 * 直接调会抛「is not a function」整屏白掉。降级成一整块最深色，
 * 视觉上少一层氛围，但界面依然完整可用。
 * @param {Array} stops [{ at: 0, color }, { at: 1, color }]
 */
function vGradient(ctx, x, y, w, h, stops) {
  if (typeof ctx.createLinearGradient !== 'function') {
    const last = stops[stops.length - 1]
    fillRect(ctx, x, y, w, h, last.color, 0)
    return
  }
  const g = ctx.createLinearGradient(x, y, x, y + h)
  for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i].at, stops[i].color)
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)
}

/**
 * 雷达网格
 *
 * 单次 beginPath + 多条 moveTo/lineTo，只 stroke 一次 —— 逐条 line() 会变成
 * 几十次独立 stroke，每帧都重画的背景下这个差别在真机上是能感觉到的。
 */
function radarGrid(ctx, w, h, step, color, ox, oy) {
  const s = Math.max(2, step)
  ctx.strokeStyle = color
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let x = (ox || 0) % s; x <= w; x += s) {
    ctx.moveTo(x, 0)
    ctx.lineTo(x, h)
  }
  for (let y = (oy || 0) % s; y <= h; y += s) {
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
  }
  ctx.stroke()
}

/**
 * 面板顶部高光条
 *
 * 深色界面的「立体感」几乎全靠这一条 1px 亮线：光从上方来，
 * 面板上沿被照亮、下沿沉进阴影。不用 shadowBlur（太贵），
 * 也不用渐变（一条线就够）。
 */
function panelSheen(ctx, x, y, w, r, color) {
  const inset = Math.min(r == null ? theme.radius.md : r, w / 2)
  line(ctx, x + inset, y + 1, x + w - inset, y + 1, color || theme.color.sheen, 1)
}

/** 铺底色：深海渐变 + 极淡雷达网格 */
function background(ctx, layout) {
  const c = theme.color
  vGradient(ctx, 0, 0, layout.W, layout.H, [
    { at: 0, color: c.bgTop },
    { at: 0.45, color: c.bg },
    { at: 1, color: c.bgBottom }
  ])
  radarGrid(ctx, layout.W, layout.H, layout.u(120), c.grid)
}

module.exports = {
  roundRectPath, fillRect, strokeRect, circle, strokeCircle,
  line, dashedLine, text, measure, ellipsis,
  vGradient, radarGrid, panelSheen, background
}
