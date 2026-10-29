// scripts/lib/svg-ctx.js
// 把 Canvas 2D 调用翻译成 SVG
//
// 用途：小游戏界面全部是 Canvas 手绘，改完配色没有任何办法「看一眼」——
// 只能靠想象，或者让人打开开发者工具截图。这个模块让场景代码不加改动
// 就能渲染成 SVG，用来做视觉自查与效果预览。
//
// 边界：只实现项目里实际用到的那一小撮 API（见文件末尾导出），
// 不是通用 Canvas 模拟器。文字宽度是估算值（服务端没有字体度量），
// 所以 ellipsis 的截断点可能与真机差一个字。

const esc = function (s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const n = function (v) {
  return Math.round(v * 100) / 100
}

/** 粗估文字宽度：中文按 1.0em，其余按 0.55em */
function estimateWidth(str, size) {
  let w = 0
  const s = String(str)
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    w += code > 0x2e80 ? 1.0 : 0.55
  }
  return w * size
}

class SvgCtx {
  constructor(w, h) {
    this.W = w
    this.H = h
    this.parts = []
    this.defs = []
    this.calls = []

    this.fillStyle = '#000000'
    this.strokeStyle = '#000000'
    this.lineWidth = 1
    this.font = '400 14px sans-serif'
    this.textAlign = 'left'
    this.textBaseline = 'middle'
    this.globalAlpha = 1

    this._path = []
    this._cur = null      // 当前点，arcTo 需要
    this._stack = []
    this._gradSeq = 0
  }

  /* ---------------- 属性快照 ---------------- */

  save() {
    this._stack.push({
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      globalAlpha: this.globalAlpha,
      font: this.font,
      textAlign: this.textAlign,
      textBaseline: this.textBaseline
    })
  }

  restore() {
    const s = this._stack.pop()
    if (!s) return
    Object.assign(this, s)
  }

  scale() {}        // 预览按 1:1，不做 dpr 缩放
  setTransform() {}
  clearRect() {}    // 每帧先铺背景，clear 可省

  /* ---------------- 填充 / 描边 ---------------- */

  _fillValue() {
    const fs = this.fillStyle
    if (fs && fs.__grad) return this._addGradient(fs)
    if (typeof fs === 'string' && fs.indexOf('rgba(') === 0) {
      // SVG 支持 CSS 颜色，rgba() 直接可用
      return fs
    }
    return fs
  }

  _addGradient(g) {
    const id = 'g' + (++this._gradSeq)
    const stops = g.stops.map(function (s) {
      return '<stop offset="' + s.at + '" stop-color="' + s.color + '"/>'
    }).join('')
    this.defs.push(
      '<linearGradient id="' + id + '" gradientUnits="userSpaceOnUse" ' +
      'x1="' + n(g.x0) + '" y1="' + n(g.y0) + '" x2="' + n(g.x1) + '" y2="' + n(g.y1) + '">' +
      stops + '</linearGradient>'
    )
    return 'url(#' + id + ')'
  }

  _attr() {
    return this.globalAlpha < 1 ? ' opacity="' + n(this.globalAlpha) + '"' : ''
  }

  fillRect(x, y, w, h) {
    this.calls.push('fillRect')
    if (w <= 0 || h <= 0) return
    this.parts.push(
      '<rect x="' + n(x) + '" y="' + n(y) + '" width="' + n(w) + '" height="' + n(h) +
      '" fill="' + this._fillValue() + '"' + this._attr() + '/>'
    )
  }

  strokeRect(x, y, w, h) {
    this.calls.push('strokeRect')
    this.parts.push(
      '<rect x="' + n(x) + '" y="' + n(y) + '" width="' + n(w) + '" height="' + n(h) +
      '" fill="none" stroke="' + this.strokeStyle + '" stroke-width="' + n(this.lineWidth) +
      '"' + this._attr() + '/>'
    )
  }

  /* ---------------- 路径 ---------------- */

  beginPath() {
    this._path = []
    this._cur = null
  }

  moveTo(x, y) {
    this._path.push('M' + n(x) + ' ' + n(y))
    this._cur = { x: x, y: y }
  }

  lineTo(x, y) {
    this._path.push('L' + n(x) + ' ' + n(y))
    this._cur = { x: x, y: y }
  }

  closePath() {
    this._path.push('Z')
  }

  /**
   * arcTo：Canvas 语义是「从当前点，用半径 r 的圆弧切到 P1→P2 这条线上」
   * 换算成 SVG 的 A 命令需要先求两个切点。
   */
  arcTo(x1, y1, x2, y2, r) {
    const p0 = this._cur
    if (!p0 || r <= 0) { this.lineTo(x1, y1); return }

    let v1x = p0.x - x1, v1y = p0.y - y1
    let v2x = x2 - x1, v2y = y2 - y1
    const l1 = Math.hypot(v1x, v1y)
    const l2 = Math.hypot(v2x, v2y)
    if (l1 < 1e-6 || l2 < 1e-6) { this.lineTo(x1, y1); return }
    v1x /= l1; v1y /= l1
    v2x /= l2; v2y /= l2

    const dot = Math.max(-1, Math.min(1, v1x * v2x + v1y * v2y))
    const angle = Math.acos(dot)
    if (angle < 1e-6) { this.lineTo(x1, y1); return }

    const t = r / Math.tan(angle / 2)
    const sx = x1 + v1x * t
    const sy = y1 + v1y * t
    const ex = x1 + v2x * t
    const ey = y1 + v2y * t

    // 顺时针 / 逆时针：SVG 的 sweep=1 在「y 轴向下」的坐标系里就是顺时针，
    // 与 Canvas arcTo 同向。这里符号取反过一次：先写成 cross>0?1:0，
    // 结果所有圆角矩形都被画成了「咬掉一角」的缺口。
    const cross = v1x * v2y - v1y * v2x

    this._path.push('L' + n(sx) + ' ' + n(sy))
    this._path.push('A' + n(r) + ' ' + n(r) + ' 0 0 ' + (cross < 0 ? 1 : 0) + ' ' + n(ex) + ' ' + n(ey))
    this._cur = { x: ex, y: ey }
  }

  arc(cx, cy, r, a0, a1, ccw) {
    const TAU = Math.PI * 2
    let span = a1 - a0
    if (!ccw && span < 0) span += TAU
    if (ccw && span > 0) span -= TAU

    if (Math.abs(span) >= TAU - 1e-6) {
      // 整圆：拆成两个半圆，避免起终点重合时 A 命令退化
      this._path.push('M' + n(cx + r) + ' ' + n(cy))
      this._path.push('A' + n(r) + ' ' + n(r) + ' 0 0 1 ' + n(cx - r) + ' ' + n(cy))
      this._path.push('A' + n(r) + ' ' + n(r) + ' 0 0 1 ' + n(cx + r) + ' ' + n(cy))
      this._cur = { x: cx + r, y: cy }
      return
    }

    const sx = cx + r * Math.cos(a0)
    const sy = cy + r * Math.sin(a0)
    const ex = cx + r * Math.cos(a1)
    const ey = cy + r * Math.sin(a1)
    if (!this._cur) this._path.push('M' + n(sx) + ' ' + n(sy))
    else this._path.push('L' + n(sx) + ' ' + n(sy))
    this._path.push('A' + n(r) + ' ' + n(r) + ' 0 ' + (Math.abs(span) > Math.PI ? 1 : 0) +
      ' ' + (span > 0 ? 1 : 0) + ' ' + n(ex) + ' ' + n(ey))
    this._cur = { x: ex, y: ey }
  }

  fill() {
    if (!this._path.length) return
    this.parts.push('<path d="' + this._path.join(' ') + '" fill="' + this._fillValue() + '"' +
      this._attr() + '/>')
  }

  stroke() {
    if (!this._path.length) return
    this.parts.push('<path d="' + this._path.join(' ') + '" fill="none" stroke="' +
      this.strokeStyle + '" stroke-width="' + n(this.lineWidth) +
      '" stroke-linecap="round"' + this._attr() + '/>')
  }

  /* ---------------- 文字 ---------------- */

  _fontSize() {
    const m = /(\d+(?:\.\d+)?)px/.exec(this.font || '')
    return m ? parseFloat(m[1]) : 14
  }

  _fontWeight() {
    const m = /^(\d+|bold|normal)/.exec(this.font || '')
    if (!m) return 400
    if (m[1] === 'bold') return 600
    if (m[1] === 'normal') return 400
    return parseFloat(m[1])
  }

  _anchor() {
    if (this.textAlign === 'center') return 'middle'
    if (this.textAlign === 'right' || this.textAlign === 'end') return 'end'
    return 'start'
  }

  _baseline() {
    if (this.textBaseline === 'middle') return 'central'
    if (this.textBaseline === 'top') return 'hanging'
    if (this.textBaseline === 'bottom') return 'text-after-edge'
    return 'auto'
  }

  fillText(str, x, y) {
    this.calls.push('fillText')
    const s = String(str)
    if (!s) return
    this.parts.push(
      '<text x="' + n(x) + '" y="' + n(y) + '" fill="' + this.fillStyle +
      '" font-size="' + n(this._fontSize()) + '" font-weight="' + this._fontWeight() +
      '" font-family="system-ui, -apple-system, PingFang SC, Microsoft YaHei, sans-serif"' +
      ' text-anchor="' + this._anchor() + '" dominant-baseline="' + this._baseline() + '"' +
      this._attr() + '>' + esc(s) + '</text>'
    )
  }

  strokeText(str, x, y) {
    this.calls.push('strokeText')
    const s = String(str)
    if (!s) return
    this.parts.push(
      '<text x="' + n(x) + '" y="' + n(y) + '" fill="none" stroke="' + this.strokeStyle +
      '" stroke-width="' + n(this.lineWidth) + '" font-size="' + n(this._fontSize()) +
      '" font-weight="' + this._fontWeight() +
      '" font-family="system-ui, -apple-system, PingFang SC, Microsoft YaHei, sans-serif"' +
      ' text-anchor="' + this._anchor() + '" dominant-baseline="' + this._baseline() + '"' +
      this._attr() + '>' + esc(s) + '</text>'
    )
  }

  measureText(s) {
    return { width: estimateWidth(s, this._fontSize()) }
  }

  createLinearGradient(x0, y0, x1, y1) {
    return {
      __grad: true,
      x0: x0, y0: y0, x1: x1, y1: y1,
      stops: [],
      addColorStop: function (at, color) { this.stops.push({ at: at, color: color }) }
    }
  }

  setLineDash() {}   // draw.dashedLine 是手工分段，不走这个

  /* ---------------- 输出 ---------------- */

  toSvg() {
    const defs = this.defs.length ? '<defs>' + this.defs.join('') + '</defs>' : ''
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + this.W + ' ' + this.H +
      '" width="' + this.W + '" height="' + this.H + '">' +
      defs + this.parts.join('') + '</svg>'
  }
}

module.exports = { SvgCtx, estimateWidth }
