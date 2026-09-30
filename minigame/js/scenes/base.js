// minigame/js/scenes/base.js
// 场景基类
//
// 约定（刻意对齐小程序的写法，减少两端心智负担）：
//   layout()        → 重建 zones（所有可点位置都在这里算，用 this.geo 存几何）
//   render(ctx)     → 纯绘制，不改状态，只读 this.geo 与 this 上的字段
//   onEnter/onExit  → 进入 / 离开（离开时务必清掉定时器与监听）
//   update(dt)      → 每帧逻辑（计时、轮询等）
//
// 注意：只有「可点区域发生变化」时才需要调用 layout()；
//      纯文字变化（倒计时、出手数）每帧重绘即可，无需重算布局。
const { hitZone } = require('../core/geom')

class Scene {
  constructor(app) {
    this.app = app
    this.zones = []
    this.geo = {}
  }

  /** 设计稿单位 → px */
  u(v) {
    return this.app.layout.u(v)
  }

  get layoutInfo() {
    return this.app.layout
  }

  /** 注册一个可点击区域 */
  zone(x, y, w, h, onTap, meta) {
    const z = Object.assign({ x: x, y: y, w: w, h: h, onTap: onTap }, meta || {})
    this.zones.push(z)
    return z
  }

  onEnter() {}
  onExit() {}

  /** 重建 zones，默认清空 */
  layout() {
    this.zones = []
  }

  update() {}
  render() {}

  onTouchStart() {}
  onTouchEnd() {}

  /** 触摸点击分发（由 app 调用） */
  tap(x, y) {
    const z = hitZone(x, y, this.zones)
    if (z && z.onTap) z.onTap(z)
    return z
  }
}

module.exports = Scene
