// minigame/js/core/app.js
// 应用外壳：全局状态 + 场景栈 + 主循环 + 触摸分发 + 全局浮层
//
// 设计对照：
//   app.globalData  ≈ 小程序 App.globalData
//   app.go / replace ≈ wx.navigateTo / redirectTo（小游戏没有页面栈，自己管）
//   app.toast / busy ≈ wx.showToast / showLoading
const { createLayout } = require('./layout')
const { hitZone } = require('./geom')
const draw = require('./draw')
const theme = require('./theme')

// 小游戏环境有 rAF；Node 下测试时退化成 setTimeout
const raf = (typeof requestAnimationFrame === 'function')
  ? requestAnimationFrame
  : function (cb) { return setTimeout(function () { cb(Date.now()) }, 16) }

const caf = (typeof cancelAnimationFrame === 'function')
  ? cancelAnimationFrame
  : function (id) { clearTimeout(id) }

function createApp(opts) {
  const layout = createLayout(opts.info)
  const ctx = opts.ctx
  const canvas = opts.canvas
  const factories = opts.scenes || {}

  const cache = {}
  const overlay = { busy: '', toast: null, feedback: null }

  const app = {
    layout: layout,
    ctx: ctx,
    canvas: canvas,

    /** 设计稿单位 → px 的快捷方式 */
    u: function (v) { return layout.u(v) },

    globalData: {
      playerId: '',
      match: null,        // { roomId, roomNo, planeCount }
      matchResult: null,  // 结算页读取
      cloudReady: false
    },

    scene: null,
    stack: [],

    /* ---------------- 场景 ---------------- */

    get: function (name) {
      if (!cache[name]) {
        const f = factories[name]
        if (!f) throw new Error('未注册的场景: ' + name)
        cache[name] = f(app)
        cache[name].name = name   // 便于调试与自动化测试识别当前场景
      }
      return cache[name]
    },

    /** 前进（入栈） */
    go: function (name, params) {
      const next = this.get(name)
      if (this.scene && this.scene !== next && this.scene.onExit) this.scene.onExit()
      this.stack.push(name)
      if (this.stack.length > 30) this.stack.shift()
      this.scene = next
      if (next.onEnter) next.onEnter(params || {})
    },

    /** 替换当前（出栈再入栈） */
    replace: function (name, params) {
      if (this.stack.length) this.stack.pop()
      const next = this.get(name)
      if (this.scene && this.scene !== next && this.scene.onExit) this.scene.onExit()
      this.stack.push(name)
      this.scene = next
      if (next.onEnter) next.onEnter(params || {})
    },

    /** 返回上一层 */
    back: function () {
      if (this.stack.length <= 1) return
      this.stack.pop()
      const name = this.stack[this.stack.length - 1]
      const next = this.get(name)
      if (this.scene && this.scene !== next && this.scene.onExit) this.scene.onExit()
      this.scene = next
      if (next.onEnter) next.onEnter({})
    },

    /** 回到起始场景 */
    reset: function (name) {
      const next = this.get(name)
      if (this.scene && this.scene !== next && this.scene.onExit) this.scene.onExit()
      this.stack = [name]
      this.scene = next
      if (next.onEnter) next.onEnter({})
    },

    /* ---------------- 触摸分发 ---------------- */

    _touch: null,

    touchStart: function (x, y) {
      this._touch = { x: x, y: y, moved: false }
      const s = this.scene
      if (s && s.onTouchStart) s.onTouchStart(x, y)
    },

    touchMove: function (x, y) {
      const t = this._touch
      if (!t) return
      if (Math.abs(x - t.x) > 10 || Math.abs(y - t.y) > 10) t.moved = true
    },

    touchEnd: function (x, y) {
      const t = this._touch
      this._touch = null
      if (!t || t.moved) return
      const s = this.scene
      if (!s) return
      if (s.onTouchEnd) s.onTouchEnd(x, y)
      s.tap(t.x, t.y)
    },

    /* ---------------- 全局浮层 ---------------- */

    busy: function (text) { overlay.busy = text || '加载中…' },
    hideBusy: function () { overlay.busy = '' },
    toast: function (msg, ms) { overlay.toast = { msg: msg, until: Date.now() + (ms || 1600) } },
    feedback: function (msg, ms) { overlay.feedback = { msg: msg, until: Date.now() + (ms || 900) } },

    /* ---------------- 主循环 ---------------- */

    _running: false,

    start: function () {
      if (this._running) return
      this._running = true
      const self = this
      let last = Date.now()
      const tick = function () {
        if (!self._running) return
        const now = Date.now()
        const dt = Math.min(64, now - last)
        last = now
        self.frame(dt, now)
        self._rafId = raf(tick)
      }
      this._rafId = raf(tick)
    },

    stop: function () {
      this._running = false
      if (this._rafId != null) { caf(this._rafId); this._rafId = null }
    },

    frame: function (dt, now) {
      const scene = this.scene
      if (!scene) return
      if (scene.update) scene.update(dt)
      draw.background(this.ctx, layout)
      if (scene.render) scene.render(this.ctx)
      this.drawOverlays(now)
    },

    /** 渲染一次（测试用，不启动循环） */
    renderOnce: function () {
      this.frame(16, Date.now())
    },

    drawOverlays: function (now) {
      const c = theme.color

      // 轻提示（顶部胶囊）
      if (overlay.toast) {
        if (now >= overlay.toast.until) {
          overlay.toast = null
        } else {
          const t = overlay.toast.msg
          const size = this.u(theme.size.small)
          const w = draw.measure(ctx, t, size) + this.u(48)
          const h = this.u(60)
          const x = (layout.W - w) / 2
          const y = layout.safeTop + this.u(24)
          draw.fillRect(ctx, x, y, w, h, 'rgba(31,35,40,0.86)', this.u(theme.radius.pill))
          draw.text(ctx, t, layout.W / 2, y + h / 2, { size: size, color: '#FFFFFF', align: 'center' })
        }
      }

      // 居中大字反馈（命中 / 未击中 / 击毁）
      if (overlay.feedback) {
        if (now >= overlay.feedback.until) {
          overlay.feedback = null
        } else {
          const t = overlay.feedback.msg
          const size = this.u(theme.size.h2)
          const w = draw.measure(ctx, t, size, 500) + this.u(120)
          const h = this.u(140)
          const x = (layout.W - w) / 2
          const y = layout.H * 0.4 - h / 2
          draw.fillRect(ctx, x, y, w, h, c.mask, this.u(theme.radius.lg))
          draw.text(ctx, t, layout.W / 2, y + h / 2, {
            size: size, color: '#FFFFFF', weight: 500, align: 'center'
          })
        }
      }

      // 忙碌遮罩
      if (overlay.busy) {
        const t = overlay.busy
        const size = this.u(theme.size.body)
        const w = draw.measure(ctx, t, size) + this.u(96)
        const h = this.u(120)
        const x = (layout.W - w) / 2
        const y = layout.H / 2 - h / 2
        draw.fillRect(ctx, x, y, w, h, 'rgba(31,35,40,0.86)', this.u(theme.radius.md))
        draw.text(ctx, t, layout.W / 2, y + h / 2, { size: size, color: '#FFFFFF', align: 'center' })
      }
    }
  }

  return app
}

module.exports = { createApp }
