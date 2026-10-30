// minigame/js/scenes/ai-tune.js
// 离线 AI 强度调节 —— 测试期专用页，从大厅的离线提示条进
//
// 【为什么要有这一页】
//   以前这两个参数写死在 services/localGame.js 顶部，想试「AI 狠一点」得改代码、
//   重新上传、再设体验版 —— 一轮十几分钟，根本没法靠手感调。
//   现在拖一下滑块、退出、开一局，立刻能感觉出差别。
//
// 【改完什么时候生效】
//   localGame 在每炮出招前现读参数（不做事例快照），所以这局打到一半改也生效。
//   但拖动过程中不写盘 —— 滑块每帧都变值，每帧写 storage 是纯浪费；
//   松手 / 离开本页时才落盘一次。
//
// 【滑块不进 zones】
//   沿用 widgets/slider 的约定：拖动控件只走 onTouchStart/Move，不注册 zone。
//   否则 tap 会按同一坐标再算一次值，表现为「松手后数字又跳一下」。
const Scene = require('./base')
const theme = require('../core/theme')
const draw = require('../core/draw')
const geom = require('../core/geom')
const Button = require('../widgets/button')
const Slider = require('../widgets/slider')
const ui = require('../widgets/ui')
const aiTune = require('../shared/services/aiTune')

// 滑块只认整数，这里放的是「滑块区间」，真实值靠 scale 换算
const HEAD = aiTune.SLIDER.head      // 6~30  → 0.6~3.0
const SLIP = aiTune.SLIDER.slip      // 0~18  → 0~90%

// 五档等级的点亮色：从「好打」到「打不过」，用颜色先给个直觉
const LEVEL_COLORS = ['success', 'success', 'primary', 'warn', 'danger']
const LEVELS_LEN = aiTune.LEVELS.length

class AiTune extends Scene {
  constructor(app) {
    super(app)
    this.tune = aiTune.normalize(aiTune.DEFAULTS)
    this.drag = ''          // '' | 'head' | 'slip'
  }

  onEnter() {
    this.tune = aiTune.get()
    this.drag = ''
    this.layout()
  }

  onExit() {
    // 兜底：拖到一半直接点返回，值也要落下
    this.commit()
  }

  /* ---------------- 布局 ---------------- */

  layout() {
    this.zones = []
    const u = this.u.bind(this)
    const L = this.layoutInfo
    const g = this.geo = {}
    const x = u(40)
    const w = L.W - u(80)
    g.x = x
    g.w = w

    // 标题栏三元素同一条中线（与房间页 / 列表页一致）
    const barCy = L.safeTop + u(96)
    g.back = { x: u(24), y: barCy - u(28), w: u(140), h: u(56) }
    g.titleY = barCy
    this.zone(g.back.x, g.back.y, g.back.w, g.back.h, this.onBack.bind(this))

    const H_INTRO = u(170)
    const H_CARD = u(252)
    const H_LEVEL = u(158)
    const btnH = u(92)

    // 按钮永远贴底，剩下的余量分给三段间距（全面屏 390×844 上富余 160px，
    // 全堆在按钮上方会像「内容断了一截」，摊进间距才匀）
    g.btn = { x: x, y: L.H - L.safeBottom - u(56) - btnH, w: w, h: btnH }
    this.zone(g.btn.x, g.btn.y, g.btn.w, g.btn.h, this.onReset.bind(this))

    const base = u(64) + H_INTRO + u(34) + H_CARD + u(30) + H_CARD + u(30) + H_LEVEL
    const slack = Math.max(0, g.btn.y - u(48) - (barCy + base))
    const air = Math.min(slack / 4, u(56))

    let y = barCy + u(64) + air * 0.5
    g.intro = { x: x, y: y, w: w, h: H_INTRO }
    y += H_INTRO + u(34) + air

    g.headCard = { x: x, y: y, w: w, h: H_CARD }
    g.headSlider = { x: x + u(28), y: y + u(104), w: w - u(56), h: u(96) }
    y += H_CARD + u(30) + air

    g.slipCard = { x: x, y: y, w: w, h: H_CARD }
    g.slipSlider = { x: x + u(28), y: y + u(104), w: w - u(56), h: u(96) }
    y += H_CARD + u(30) + air

    g.levelCard = { x: x, y: y, w: w, h: H_LEVEL }
  }

  /* ---------------- 绘制 ---------------- */

  render(ctx) {
    const u = this.u.bind(this)
    const g = this.geo
    const c = theme.color
    const tune = this.tune
    const lv = aiTune.level(tune)
    const lvColor = c[LEVEL_COLORS[lv.index]] || c.primary

    // 顶部：返回 + 标题（标题居中，与列表页 / 房间页一致。
    // 靠左放会直接压在返回键上 —— 返回键宽到 u(140)，左对齐的标题从 u(40) 起笔）
    ui.backLabel(ctx, this.layoutInfo, g.back, '返回')
    draw.text(ctx, '离线 AI 强度', this.layoutInfo.W / 2, g.titleY, {
      size: u(theme.size.h2), weight: 500, color: c.text, align: 'center'
    })

    /* ---- 说明 ---- */
    ui.card(ctx, this.layoutInfo, g.intro.x, g.intro.y, g.intro.w, g.intro.h)
    const ix = g.intro.x + u(28)
    draw.text(ctx, '只影响离线试玩的电脑对手', ix, g.intro.y + u(54), {
      size: u(theme.size.body), color: c.text
    })
    draw.text(ctx, '联机对局里对手是真人，这些参数不起作用', ix, g.intro.y + u(98), {
      size: u(theme.size.tiny), color: c.textMuted
    })
    draw.text(ctx, '改完立刻生效，下一炮就按新参数走', ix, g.intro.y + u(132), {
      size: u(theme.size.tiny), color: c.textMuted
    })

    /* ---- 机头权重 ---- */
    this.renderCard(ctx, g.headCard, '机头权重', tune.headWeight.toFixed(1),
      '越高越执着于猜机头 · 打中机头等于整架击毁', g.headSlider, {
        value: aiTune.headToSlider(tune.headWeight),
        min: HEAD.min, max: HEAD.max,
        left: '0.6', right: '3.0', leftDesc: '机头次要', rightDesc: '死盯机头'
      })

    /* ---- 走神概率 ---- */
    this.renderCard(ctx, g.slipCard, '走神概率', Math.round(tune.slipRate * 100) + '%',
      '这一炮不推理、退回「摸四邻」的概率', g.slipSlider, {
        value: aiTune.slipToSlider(tune.slipRate),
        min: SLIP.min, max: SLIP.max,
        left: '0%', right: '90%', leftDesc: '从不走神', rightDesc: '大半在瞎摸'
      })

    /* ---- 当前强度 ---- */
    const lc = g.levelCard
    ui.card(ctx, this.layoutInfo, lc.x, lc.y, lc.w, lc.h)
    const lx = lc.x + u(28)
    draw.text(ctx, '当前强度', lx, lc.y + u(42), {
      size: u(theme.size.tiny), color: c.textMuted
    })
    draw.text(ctx, lv.name, lx, lc.y + u(88), {
      size: u(theme.size.h2), weight: 500, color: lvColor
    })

    // 五段等级条：等级名右边一小排格子，点亮几段就是第几档。
    // 比纯文字更一眼判得出「我现在调到哪了」，也不占额外高度。
    const segW = u(14)
    const segGap = u(6)
    const segH = u(22)
    const segTotal = LEVELS_LEN * segW + (LEVELS_LEN - 1) * segGap
    const segX0 = lc.x + lc.w - u(28) - segTotal
    const segY = lc.y + u(88) - segH / 2
    for (let i = 0; i < LEVELS_LEN; i++) {
      draw.fillRect(ctx, segX0 + i * (segW + segGap), segY, segW, segH,
        i <= lv.index ? lvColor : c.border, u(4))
    }

    draw.text(ctx, lv.desc + ' · 约 ' + lv.shots + ' 炮打完 1 架',
      lx, lc.y + u(126), {
        size: u(theme.size.tiny), color: c.textMuted
      })

    /* ---- 恢复默认 ---- */
    Button.render(ctx, Object.assign({}, g.btn, {
      label: aiTune.isDefault(tune) ? '已是默认强度' : '恢复默认',
      kind: 'outline',
      disabled: aiTune.isDefault(tune)
    }), u)
  }

  /** 一张「标签 —— 值 + 说明 + 滑块」的卡 */
  renderCard(ctx, r, title, value, desc, slideRect, so) {
    const u = this.u.bind(this)
    const c = theme.color
    ui.card(ctx, this.layoutInfo, r.x, r.y, r.w, r.h)

    draw.text(ctx, title, r.x + u(28), r.y + u(48), {
      size: u(theme.size.h3), weight: 500, color: c.text
    })
    // 当前值用主色：拖动时视线只需要盯这一处
    draw.text(ctx, value, r.x + r.w - u(28), r.y + u(48), {
      size: u(theme.size.h3), weight: 500, color: c.primaryDark, align: 'right'
    })
    draw.text(ctx, desc, r.x + u(28), r.y + u(84), {
      size: u(theme.size.tiny), color: c.textMuted
    })

    Slider.render(ctx, u, slideRect, {
      value: so.value, min: so.min, max: so.max, showScale: false
    })

    // 两端刻度自己画：滑块内部值（6 / 30）对玩家没意义，
    // 要显示的是真实值（0.6 / 3.0）和它的含义（不看机头 / 死盯机头）
    const cy = slideRect.y + slideRect.h / 2
    const lx = slideRect.x + Slider.KNOB_R
    const rx = slideRect.x + slideRect.w - Slider.KNOB_R
    const ty = cy + u(Slider.KNOB_R) + u(18)
    draw.text(ctx, so.left, lx, ty, { size: u(theme.size.tiny), color: c.text, align: 'center' })
    draw.text(ctx, so.right, rx, ty, { size: u(theme.size.tiny), color: c.text, align: 'center' })
    draw.text(ctx, so.leftDesc, lx, ty + u(26), {
      size: u(theme.size.tiny), color: c.textMuted, align: 'center'
    })
    draw.text(ctx, so.rightDesc, rx, ty + u(26), {
      size: u(theme.size.tiny), color: c.textMuted, align: 'center'
    })
  }

  /* ---------------- 交互 ---------------- */

  onTouchStart(x, y) {
    const g = this.geo
    if (g.headSlider && geom.inRect(x, y, g.headSlider)) {
      this.drag = 'head'
      this.applyHead(x)
      return
    }
    if (g.slipSlider && geom.inRect(x, y, g.slipSlider)) {
      this.drag = 'slip'
      this.applySlip(x)
    }
  }

  onTouchMove(x, y) {
    if (this.drag === 'head') this.applyHead(x)
    else if (this.drag === 'slip') this.applySlip(x)
  }

  onTouchEnd() {
    if (!this.drag) return
    this.drag = ''
    this.commit()
  }

  /**
   * 拖动中只改内存里的值，不重建布局 —— 滑块位置没变，变的只是数字文字，
   * 而 render 每帧都读 this.tune，本来就会刷新。
   */
  applyHead(x) {
    const g = this.geo.headSlider
    const s = Slider.valueAt(g, x, HEAD.min, HEAD.max)
    const v = aiTune.sliderToHead(s)
    if (v === this.tune.headWeight) return
    this.tune = { headWeight: v, slipRate: this.tune.slipRate }
  }

  applySlip(x) {
    const g = this.geo.slipSlider
    const s = Slider.valueAt(g, x, SLIP.min, SLIP.max)
    const v = aiTune.sliderToSlip(s)
    if (v === this.tune.slipRate) return
    this.tune = { headWeight: this.tune.headWeight, slipRate: v }
  }

  /** 落盘（松手 / 离开本页时各调用一次，重复调用无副作用） */
  commit() {
    if (this.tune) aiTune.set(this.tune)
  }

  onReset() {
    if (aiTune.isDefault(this.tune)) return
    this.tune = aiTune.reset()
    this.layout()
  }

  onBack() {
    this.commit()
    this.app.back()
  }
}

module.exports = function (app) { return new AiTune(app) }
