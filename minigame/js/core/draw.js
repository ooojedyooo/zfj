// minigame/js/core/draw.js
// Canvas 绘制原语
//
// 小游戏直接用 Canvas 2D，这里把常用画法收口，场景代码只写业务。
const theme = require('./theme')

/**
 * 圆角矩形路径
 * @param {boolean} [skipBegin] 只追加子路径、不 beginPath。
 *   合成「一架飞机的 8 个机体格」时必须用这个：beginPath 会把前面已经攒好的
 *   子路径全部丢掉，于是「8 格一条路径一次 fill」就退化成 8 次 fill。
 */
function roundRectPath(ctx, x, y, w, h, r, skipBegin) {
  const rr = Math.max(0, Math.min(r == null ? theme.radius.md : r, w / 2, h / 2))
  if (!skipBegin) ctx.beginPath()
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

/**
 * 一批同样大小的小圆点，**只 fill 一次**
 *
 * 棋盘上 81 格要各点一个微点。逐格 circle() 就是 81 次 beginPath + fill，
 * 双棋盘每帧 160+ 次调用 —— 在真机上这个量级是能感觉到的。
 * 全部塞进一条路径只 fill 一次：视觉完全一样，调用数从 162 降到 2。
 *
 * moveTo 到圆弧起点 (cx + r, cy) 是必须的：arc() 会从「当前点」连一条线到弧起点，
 * 不先 moveTo 就会画出一堆横穿格子的连线。
 * @param {Array<{x:number,y:number}>} pts
 */
function dotGrid(ctx, pts, r, color) {
  if (!pts || !pts.length) return
  ctx.fillStyle = color
  ctx.beginPath()
  for (let i = 0; i < pts.length; i++) {
    ctx.moveTo(pts[i].x + r, pts[i].y)
    ctx.arc(pts[i].x, pts[i].y, r, 0, Math.PI * 2)
  }
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
 *
 * 为什么要缓存渐变对象（可选，第 6 个参数）：页面背景每帧都要这一段渐变，
 * 而 createLinearGradient 每帧都新建一个对象 = 60 个/秒的堆分配。
 * 渐变的定义只跟「ctx + 几何 + 色标」有关，三者都没变就可以复用。
 * 缓存键必须带上**色标的引用**——换皮肤时色标数组会换新对象，
 * 只比几何会把旧配色留在屏上。
 * @param {Array} stops [{ at: 0, color }, { at: 1, color }]
 * @param {string} [cacheKey] 传了就启用缓存（同一 key 复用同一渐变对象）
 */
const gradCache = (typeof WeakMap === 'function') ? new WeakMap() : null

function vGradient(ctx, x, y, w, h, stops, cacheKey) {
  if (typeof ctx.createLinearGradient !== 'function') {
    const last = stops[stops.length - 1]
    fillRect(ctx, x, y, w, h, last.color, 0)
    return
  }

  let g = null
  const geom = x + ',' + y + ',' + w + ',' + h

  if (cacheKey && gradCache) {
    let slot = gradCache.get(ctx)
    if (!slot) { slot = {}; gradCache.set(ctx, slot) }
    const hit = slot[cacheKey]
    // 色标引用 + 几何都一致才敢复用
    if (hit && hit.stops === stops && hit.geom === geom) {
      g = hit.g
    }
  }

  if (!g) {
    g = ctx.createLinearGradient(x, y, x, y + h)
    for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i].at, stops[i].color)
    if (cacheKey && gradCache) {
      let slot = gradCache.get(ctx)
      if (!slot) { slot = {}; gradCache.set(ctx, slot) }
      slot[cacheKey] = { stops: stops, geom: geom, g: g }
    }
  }

  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)
}

/**
 * 任意方向的线性渐变填充矩形
 *
 * `vGradient` 只会画「从上到下」，因为页面背景只需要那样。飞机的龙骨要跟着
 * 朝向一起转 —— 90° 旋转之后渐变方向就变成水平的了，端点必须能任意给。
 *
 * 降级：没有 createLinearGradient 时填整块最深的色标。少一层氛围，
 * 但**占用格、轮廓、明暗关系全都不变** —— 不允许因为降级把一架飞机画小/画歪。
 */
function gradientRect(ctx, x, y, w, h, x0, y0, x1, y1, stops) {
  if (w <= 0 || h <= 0) return
  if (typeof ctx.createLinearGradient !== 'function') {
    fillRect(ctx, x, y, w, h, stops[stops.length - 1].color, 0)
    return
  }
  const g = ctx.createLinearGradient(x0, y0, x1, y1)
  for (let i = 0; i < stops.length; i++) g.addColorStop(stops[i].at, stops[i].color)
  ctx.fillStyle = g
  ctx.fillRect(x, y, w, h)
}

/**
 * 颜色混色：把 a 往 b 混 t（0~1），返回 rgba() 字符串
 *
 * 用途只有一处但很关键：飞机外描边按损伤比例往 danger 混（art §5.8）。
 * 那是「零额外调用」的一层 —— 只换 strokeStyle，不新增一次描边。
 *
 * 支持 `#RRGGBB` 与 `rgb()/rgba()` 两种写法（主题里两种都有）。
 * 解析失败就原样返回 a：宁可颜色不对，也不要在渲染路径上抛异常。
 */
function mix(a, b, t) {
  const ca = parseColor(a)
  const cb = parseColor(b)
  if (!ca || !cb) return a
  const k = Math.max(0, Math.min(1, t))
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * k)
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * k)
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * k)
  const al = Math.round((ca[3] + (cb[3] - ca[3]) * k) * 100) / 100
  return 'rgba(' + r + ', ' + g + ', ' + bl + ', ' + al + ')'
}

function parseColor(v) {
  const s = String(v)
  if (s.charAt(0) === '#') {
    if (s.length < 7) return null
    return [
      parseInt(s.substr(1, 2), 16),
      parseInt(s.substr(3, 2), 16),
      parseInt(s.substr(5, 2), 16),
      1
    ]
  }
  const m = /rgba?\(([^)]+)\)/.exec(s)
  if (!m) return null
  const p = m[1].split(',')
  if (p.length < 3) return null
  return [
    parseFloat(p[0]), parseFloat(p[1]), parseFloat(p[2]),
    p.length > 3 ? parseFloat(p[3]) : 1
  ]
}

/**
 * 换掉一个颜色的 alpha，返回 `rgba()` 字符串
 *
 * 为什么需要它：契约把「色」和「透明度」拆成两个 token（`sweepColor` + `SWEEP.edge: 0.20`
 * + `SWEEP.head: 0.30`）。代码要拼回一个 `strokeStyle`，就必须在**使用处**拼 ——
 * 不能在 theme 里写死一个 `rgba(...)` 字面量，否则换皮肤时底色变了、
 * α 那半截还留在旧皮肤的颜色上（那就是 G1/G2 记的那个病：色与 α 混写成字面量）。
 *
 * 解析失败原样返回：渲染路径上宁可颜色不对，也不要抛异常。
 */
function alpha(color, a) {
  const c = parseColor(color)
  if (!c) return color
  const k = Math.max(0, Math.min(1, a))
  return 'rgba(' + c[0] + ', ' + c[1] + ', ' + c[2] + ', ' + k + ')'
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

/**
 * 铺底色：深海渐变 + 极淡雷达网格
 *
 * 色标数组**提到外面**并跟着 palette 的引用走：
 * 每帧新建一个数组会让 vGradient 的缓存永远命中不了（引用每次都变，
 * 而引用正是判断「配色有没有换」的唯一可靠依据）。换皮肤时 palette 换新对象，
 * 色标自然重建。
 */
let bgStops = null
let bgStopsFor = null
let bgVersion = -1

function background(ctx, layout, palette) {
  const c = palette || theme.color
  // theme.color 在换肤时是 in-place 改的（引用不变），所以光看引用认不出配色换了。
  // 加上 colorVersion 这个信号，色标数组才会重建；数组引用一变，vGradient 的
  // WeakMap 缓存也就自然失效（它按「色标引用 + 几何」复用渐变对象）。
  if (bgStopsFor !== c || bgVersion !== theme.colorVersion) {
    bgStopsFor = c
    bgVersion = theme.colorVersion
    bgStops = [
      { at: 0, color: c.bgTop },
      { at: 0.45, color: c.bg },
      { at: 1, color: c.bgBottom }
    ]
  }
  vGradient(ctx, 0, 0, layout.W, layout.H, bgStops, 'bg')
  radarGrid(ctx, layout.W, layout.H, layout.u(120), c.grid)
}

module.exports = {
  roundRectPath, fillRect, strokeRect, circle, strokeCircle, dotGrid,
  line, dashedLine, text, measure, ellipsis,
  vGradient, gradientRect, mix, alpha, radarGrid, panelSheen, background
}
