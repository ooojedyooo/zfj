// minigame/js/widgets/button.js
// 按钮控件：注册点击区（layout 阶段）+ 绘制（render 阶段）
//
// 用法（场景里成对调用）：
//   layout(): Button.layout(this, { x, y, w, h, label, kind, onTap })
//   render(): Button.render(ctx, { x, y, w, h, label, kind })
const theme = require('../core/theme')
const draw = require('../core/draw')

const KINDS = {
  // primary = 荧光青底 + 近黑字。深色界面里唯一主动「亮起来」的元素，
  // 所以一屏只该有一个，留给最重要的那个动作（创建房间 / 发射）。
  primary: { bg: theme.color.primary, fg: theme.color.primaryInk, border: null },
  // outline = 玻璃感：比面板亮一档的底 + 明显描边。有存在感，但不跟 primary 抢。
  outline: { bg: theme.color.panelHi, fg: theme.color.text, border: theme.color.borderHi },
  danger: { bg: theme.color.dangerLight, fg: theme.color.dangerDark, border: theme.color.danger },
  // warn = 「还没准备好」：不是错误，是「这一步还不能过」。用橙色区别于危险动作的红。
  warn: { bg: theme.color.warnLight, fg: theme.color.warnDark, border: theme.color.warn },
  ghost: { bg: theme.color.gray, fg: theme.color.text, border: null }
}

/** 注册点击区 */
function layout(scene, o) {
  scene.zone(o.x, o.y, o.w, o.h, o.onTap || null, { disabled: !!o.disabled })
}

/**
 * 绘制
 * @param {Function} [u] 设计稿单位换算函数（场景的 this.u）
 *
 * 为什么必须传 u：早先这里直接写 `size: theme.size.body`（=28），
 * 而 draw.text 把 size 当**像素**用，于是 375 屏上按钮字被画成 28px ——
 * 设计意图是 14px，整整放大一倍。表现就是窄按钮里文字撑满、几乎顶到边框。
 * 现在缺省时退化成 0.5 倍（375 屏的比例），传了 u 就是精确值。
 */
function render(ctx, o, u) {
  const toPx = typeof u === 'function' ? u : function (v) { return v * 0.5 }
  const k = KINDS[o.kind || 'primary'] || KINDS.primary
  // 圆角也必须换算：theme.radius 是设计稿单位，直接当像素用的话
  // 375 屏上会画成 16px（设计意图 12px），平板上又缩不回去。
  // 取 lg 与卡片同一档，按钮和卡片才是同一个圆度体系。
  const r = o.radius != null ? o.radius : toPx(theme.radius.lg)
  const prev = ctx.globalAlpha
  ctx.globalAlpha = o.disabled ? 0.45 : (o.pressed ? 0.8 : 1)

  draw.fillRect(ctx, o.x, o.y, o.w, o.h, o.bg || k.bg, r)
  // 顶部高光：暗底按钮靠这一条立起来；亮青底上几乎看不出，没有副作用
  draw.panelSheen(ctx, o.x, o.y, o.w, r, 'rgba(255, 255, 255, 0.16)')
  if (k.border && !o.bg) draw.strokeRect(ctx, o.x, o.y, o.w, o.h, k.border, r, 1)

  const label = o.loading ? (o.loadingText || '处理中…') : o.label
  draw.text(ctx, label, o.x + o.w / 2, o.y + o.h / 2, {
    size: o.size || toPx(theme.size.body),
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
