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

/** 卡片底板：深面板 + 顶部高光 + 下沉投影 */
function card(ctx, layout, x, y, w, h) {
  const u = layout.u.bind(layout)
  const r = u(theme.radius.lg)
  // 投影：往下错开的深色块。比 shadowBlur 便宜得多（每帧都画，真机上差一个量级）
  draw.fillRect(ctx, x, y + u(6), w, h, theme.color.shade, r)
  draw.fillRect(ctx, x, y, w, h, theme.color.panel, r)
  // 深色面板能「立起来」，靠的就是上沿这一条 1px 亮线（光从上方来）
  draw.panelSheen(ctx, x, y, w, r)
  draw.strokeRect(ctx, x, y, w, h, theme.color.border, r, 1)
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

/**
 * 离线试玩提示条
 * @param {object} opt { action } —— 右侧加一个可点提示（主色 + 下划线，像链接）
 */
function modeTip(ctx, layout, x, y, w, text, opt) {
  const u = layout.u.bind(layout)
  const o = opt || {}
  const h = u(52)
  draw.fillRect(ctx, x, y, w, h, theme.color.gray, u(theme.radius.sm))
  draw.text(ctx, text, x + u(20), y + h / 2, {
    size: u(theme.size.tiny), color: theme.color.textMuted
  })
  if (o.action) {
    const size = u(theme.size.tiny)
    const tw = draw.measure(ctx, o.action, size)
    const ax = x + w - u(20) - tw
    const ay = y + h / 2
    draw.text(ctx, o.action, x + w - u(20), ay, {
      size: size, color: theme.color.primary, align: 'right'
    })
    // 下划线是「这里能点」的信号。不用箭头字符 —— 全角符号在不同
    // Android 回退字体里渲染不一致（返回键的「‹」就踩过）
    draw.line(ctx, ax, ay + u(16), ax + tw, ay + u(16), theme.color.primary, 1)
  }
  return h
}

/**
 * 返回按钮的内容：手绘一个「‹」+ 文字，整组居中
 * 不用「‹」这个码位——不同 Android 机型的回退字体对它的处理不一致，
 * 有的渲染成小圆点、有的偏得离谱。两笔线画出来，任何设备上都长一样。
 */
function backLabel(ctx, layout, rect, text) {
  const u = layout.u.bind(layout)
  const cy = rect.y + rect.h / 2
  const size = u(theme.size.small)
  const textW = draw.measure(ctx, text, size)
  const armW = u(7)
  const armH = u(10)
  const gapW = u(10)
  const total = armW + gapW + textW
  const x = rect.x + (rect.w - total) / 2
  const lw = Math.max(1.5, u(2.4))
  draw.line(ctx, x + armW, cy - armH, x, cy, theme.color.text, lw)
  draw.line(ctx, x, cy, x + armW, cy + armH, theme.color.text, lw)
  draw.text(ctx, text, x + armW + gapW, cy, { size: size, color: theme.color.text })
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

module.exports = { titleBlock, card, row, sectionTitle, modeTip, backLabel, spinner, tag }
