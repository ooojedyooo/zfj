// minigame/js/widgets/button.js
// 按钮控件：注册点击区（layout 阶段）+ 绘制（render 阶段）
//
// 用法（场景里成对调用）：
//   layout(): Button.layout(this, { x, y, w, h, label, kind, onTap })
//   render(): Button.render(ctx, { x, y, w, h, label, kind })
const theme = require('../core/theme')
const draw = require('../core/draw')

const KINDS = {
  primary: { bg: theme.color.primary, fg: '#FFFFFF', border: null },
  outline: { bg: theme.color.primaryLight, fg: theme.color.primaryDark, border: theme.color.primary },
  danger: { bg: theme.color.dangerLight, fg: theme.color.dangerDark, border: theme.color.danger },
  ghost: { bg: theme.color.gray, fg: theme.color.text, border: null }
}

/** 注册点击区 */
function layout(scene, o) {
  scene.zone(o.x, o.y, o.w, o.h, o.onTap || null, { disabled: !!o.disabled })
}

/** 绘制 */
function render(ctx, o) {
  const k = KINDS[o.kind || 'primary'] || KINDS.primary
  const r = o.radius != null ? o.radius : theme.radius.md
  const prev = ctx.globalAlpha
  ctx.globalAlpha = o.disabled ? 0.45 : (o.pressed ? 0.8 : 1)

  draw.fillRect(ctx, o.x, o.y, o.w, o.h, o.bg || k.bg, r)
  if (k.border && !o.bg) draw.strokeRect(ctx, o.x, o.y, o.w, o.h, k.border, r, 1)

  const label = o.loading ? (o.loadingText || '处理中…') : o.label
  draw.text(ctx, label, o.x + o.w / 2, o.y + o.h / 2, {
    size: o.size || theme.size.body,
    color: o.color || k.fg,
    weight: 500,
    align: 'center'
  })

  ctx.globalAlpha = prev
}

/** 一小段等宽按钮的横排布点：返回 n 个矩形 */
function rowRects(x, y, w, h, gap, n) {
  const cw = (w - gap * (n - 1)) / n
  const out = []
  for (let i = 0; i < n; i++) {
    out.push({ x: x + i * (cw + gap), y: y, w: cw, h: h })
  }
  return out
}

/** 等宽竖排布点 */
function colRects(x, y, w, h, gap, n) {
  const out = []
  for (let i = 0; i < n; i++) {
    out.push({ x: x, y: y + i * (h + gap), w: w, h: h })
  }
  return out
}

module.exports = { layout, render, rowRects, colRects, KINDS }
