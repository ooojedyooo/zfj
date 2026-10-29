// minigame/js/scenes/lobby.js
// 大厅 —— 对应小程序 pages/index
//
// 版面顺序是按「玩家有多想马上开一局」排的：
//   ① 快速匹配（1 / 2 / 3 架三张卡）—— 一句话都不用想，点了就打
//   ② 创建房间 —— 我要定规则
//   ③ 浏览公开房间 / 搜索房间名 —— 我想挑一间
//   最近对手与玩法说明再往后放
//
// 「快速匹配」原来只有一个按钮，现在按架数拆成三个：
//   架数在布阵页已经不能改了（房间定死、布阵必须摆满），
//   所以「想打几架」必须在匹配之前就问清楚 —— 否则匹配进去才发现是三架局。
const Scene = require('./base')
const theme = require('../core/theme')
const draw = require('../core/draw')
const Button = require('../widgets/button')
const planeIcon = require('../widgets/plane-icon')
const ui = require('../widgets/ui')
const dialog = require('../core/dialog')
const share = require('../core/share')
const api = require('../shared/services/cloudApi')
const rivals = require('../shared/services/rivals')
const { MIN_PLANES, MAX_PLANES } = require('../shared/config/rules')

class Lobby extends Scene {
  constructor(app) {
    super(app)
    this.rivalName = ''
    this.rivalCount = 0
  }

  onEnter() {
    this.refreshRivals()
    share.onShare(function () {
      return {
        title: '炸飞机 · 9×9 双人实时对战，来跟我打一局',
        query: ''
      }
    })
  }

  refreshRivals() {
    const list = rivals.list()
    this.rivalName = rivals.displayName(list[0])
    this.rivalCount = list.length
    this.layout()
  }

  layout() {
    this.zones = []
    const u = this.u.bind(this)
    const L = this.layoutInfo
    const g = this.geo = {}
    const x = u(40)
    const w = L.W - u(80)

    g.x = x
    g.w = w

    // 纵向间距按可用高度收敛。
    // 平板宽 768 → u() 整体放大 1.02 倍，但屏幕只有 1024 高（稿 1000），
    // 写死间距会把「查看玩法规则」顶出屏外。手机上 availH 足够，k 封顶 1。
    const availH = L.H - L.safeTop - L.safeBottom
    const k = Math.min(1, availH / u(1160))
    const gap = function (v) { return u(v) * k }
    g.k = k

    /* ---------- 先算「自然高度」，再把余量回填 ----------
     *
     * 上一版是纯粹的从上往下堆：手机 375×667 上内容只占到 y≈450，
     * 下面 200px 全是空的，看起来像没排完。
     *
     * 现在分两步：先按内容本身的尺寸累加出一个自然高度，
     * 把 availH 与它的差额按权重分给「卡片高度 / 标题上方 / 中段 / 底部」。
     * 屏幕越大，分到的余量越多，但不超过各自上限，避免被拉变形。
     */
    const gIntro = gap(64)
    const tipH = api.isCloud ? 0 : gap(90)
    const gLabel = gap(62)
    const cardH0 = gap(150)
    const gAfterCards = gap(26)
    const gHint = gap(38)
    const btnH = gap(92)
    const gBtnGap = gap(18)
    const rowH = gap(88)
    const gAfterRow = gap(22)
    const rivalH = this.rivalName ? gap(120) + gap(20) : 0
    const gRules = gap(52)
    const gFoot = gap(40)

    const natural = gap(140) + gap(58) + gIntro + tipH + gLabel + cardH0 + gAfterCards +
      gHint + btnH + gBtnGap + rowH + gAfterRow + rivalH + gRules + gFoot
    const slack = Math.max(0, availH - natural)
    g.slack = slack

    // 权重：卡片 30%（但封顶），中段 26%，底部 29%，顶部 15%
    const extraCard = Math.min(slack * 0.30, u(110))
    const extraTop = slack * 0.15
    const extraMid = slack * 0.26
    const extraBottom = Math.max(0, slack * 0.29 - Math.max(0, slack * 0.30 - u(110)))
    const cardH = cardH0 + extraCard
    g.cardH = cardH

    g.titleY = L.safeTop + gap(140) + extraTop * 0.5
    g.subY = g.titleY + gap(58)

    let y = g.subY + gIntro + extraTop * 0.5

    if (!api.isCloud) {
      g.tipY = y
      y += gap(50) + gap(40)
    }

    /* ---- ① 快速匹配：三张架数卡 ---- */
    g.matchLabelY = y
    g.matchNoteY = y + gap(32)
    y += gap(62)

    const gapH = u(16)
    const cw = (w - gapH * 2) / 3
    g.matchCards = []
    for (let i = 0; i < 3; i++) {
      const n = MIN_PLANES + i
      const rect = { x: x + i * (cw + gapH), y: y, w: cw, h: cardH, planes: n }
      g.matchCards.push(rect)
      this.zone(rect.x, rect.y, rect.w, rect.h, function () {
        this.app.go('room', { mode: 'random', planeCount: n, auto: true })
      }.bind(this))
    }
    y += cardH + gAfterCards + extraMid * 0.4

    g.matchHintY = y
    y += gHint

    /* ---- ② 创建房间 ---- */
    g.btnH = btnH
    g.createBtn = { x: x, y: y, w: w, h: btnH }
    this.zone(x, y, w, btnH, function () {
      this.app.go('room', { mode: 'create' })
    }.bind(this))
    y += btnH + gBtnGap + extraMid * 0.6

    /* ---- ③ 浏览 / 搜索 ---- */
    g.rowH = rowH
    const two = Button.rowRects(x, y, w, rowH, u(16), 2)
    g.browseBtn = two[0]
    g.searchBtn = two[1]
    this.zone(two[0].x, two[0].y, two[0].w, two[0].h, function () {
      this.app.go('rooms', { mode: 'public' })
    }.bind(this))
    this.zone(two[1].x, two[1].y, two[1].w, two[1].h, function () {
      this.app.go('rooms', { mode: 'search' })
    }.bind(this))
    y += rowH + gAfterRow

    /* ---- 最近对手 ---- */
    if (this.rivalName) {
      const rcH = gap(120)
      g.rivalCard = { x: x, y: y, w: w, h: rcH }
      const bw = u(184)
      const bh = u(64)
      g.rivalBtn = { x: x + w - u(28) - bw, y: y + (rcH - bh) / 2, w: bw, h: bh }
      this.zone(g.rivalBtn.x, g.rivalBtn.y, bw, bh, this.onReinvite.bind(this))
      y += rcH + gap(20)
    }

    g.rulesY = y + gap(26) + extraBottom * 0.35
    this.zone(x, g.rulesY - gap(26), w, gap(52), this.onRules.bind(this))

    // 「查看玩法规则」已经贴着底部了，标识行再往下挤就会被裁。
    // 小屏（320×568）上 u(28) 只留 14px，字底正好压线，所以退到 u(40)。
    g.footY = L.H - L.safeBottom - u(40)
  }

  render(ctx) {
    const u = this.u.bind(this)
    const L = this.layoutInfo
    const g = this.geo
    const c = theme.color

    // 右上角飞机水印：纯装饰，很淡，用来压住右侧大片空白
    // 深色底上不能再用浅色时代那种「比背景更暗的淡蓝」，得反过来用低透明亮色
    const wm = u(200)
    planeIcon.render(ctx, L.W - u(10) - wm, L.safeTop + u(20), wm, {
      rotation: 1,
      color: 'rgba(120, 210, 255, 0.07)',
      headColor: 'rgba(43, 224, 200, 0.10)',
      join: true,
      outline: 0.08
    })

    draw.text(ctx, '炸飞机', g.x, g.titleY, {
      size: u(theme.size.big), weight: 500, color: c.text
    })
    draw.text(ctx, '9×9 棋盘 · 双人实时对战', g.x, g.subY, {
      size: u(theme.size.small), color: c.textMuted
    })
    // 标题下方一道短装饰线：纯文字标题在深底上容易「飘」，压一条线把视觉重心钉住
    draw.fillRect(ctx, g.x, g.subY + u(30), u(88), u(4), c.primary, u(2))

    if (g.tipY != null) {
      ui.modeTip(ctx, L, g.x, g.tipY, g.w, '离线试玩模式 · 对手由本地 AI 扮演')
    }

    /* ---- 快速匹配 ---- */
    draw.text(ctx, '快速匹配', g.x, g.matchLabelY, {
      size: u(theme.size.h3), weight: 500, color: c.text
    })

    g.matchCards.forEach(function (r) {
      const rad = u(theme.radius.md)
      draw.fillRect(ctx, r.x, r.y, r.w, r.h, c.panel, rad)
      draw.panelSheen(ctx, r.x, r.y, r.w, rad)
      draw.strokeRect(ctx, r.x, r.y, r.w, r.h, c.border, rad, 1)

      // 图标吃满卡片：底部固定留一行文字，剩下的高度全给飞机。
      // 原来写死 r.h - u(74)，卡片一矮图标就只剩三十几像素，卡片显得空。
      const textH = u(56)
      const boxH = r.h - textH - u(16)
      const s = Math.min(r.w - u(24), boxH)
      planeIcon.render(ctx, r.x + (r.w - s) / 2, r.y + u(12) + (boxH - s) / 2, s, {
        on: true, rotation: 1, color: c.plane, headColor: c.planeHead, join: true
      })
      // 架数用 h2 大字 + 小号「架」：三张卡图形一样，数字就是唯一区别，必须够显眼
      const numSize = u(theme.size.h2)
      const unitSize = u(theme.size.small)
      const nw = draw.measure(ctx, String(r.planes), numSize, 500)
      const uw = draw.measure(ctx, '架', unitSize)
      const baseX = r.x + (r.w - nw - uw - u(6)) / 2
      const baseY = r.y + r.h - u(30)
      draw.text(ctx, String(r.planes), baseX, baseY, {
        size: numSize, weight: 500, color: c.text
      })
      draw.text(ctx, '架', baseX + nw + u(6), baseY + u(4), {
        size: unitSize, color: c.textMuted
      })
    })

    draw.text(ctx, '点卡片直接开打 · 没有合适的就替你开一间等着', g.x, g.matchHintY, {
      size: u(theme.size.tiny), color: c.textMuted
    })

    /* ---- 创建 / 浏览 / 搜索 ---- */
    Button.render(ctx, Object.assign({}, g.createBtn, { label: '创建房间', kind: 'primary' }), u)
    Button.render(ctx, Object.assign({}, g.browseBtn, { label: '浏览公开房间', kind: 'outline' }), u)
    Button.render(ctx, Object.assign({}, g.searchBtn, { label: '搜索房间名', kind: 'outline' }), u)

    if (this.rivalName && g.rivalCard) {
      const r = g.rivalCard
      ui.card(ctx, L, r.x, r.y, r.w, r.h)
      draw.text(ctx, '最近对手', r.x + u(28), r.y + r.h * 0.28, {
        size: u(theme.size.tiny), color: c.textMuted
      })
      draw.text(ctx, draw.ellipsis(ctx, this.rivalName, u(300), u(theme.size.h3), 500),
        r.x + u(28), r.y + r.h * 0.6, {
          size: u(theme.size.h3), weight: 500, color: c.text
        })
      draw.text(ctx, '本地共记录 ' + this.rivalCount + ' 位', r.x + u(28), r.y + r.h * 0.84, {
        size: u(theme.size.tiny), color: c.textMuted
      })
      const b = g.rivalBtn
      draw.fillRect(ctx, b.x, b.y, b.w, b.h, c.primaryLight, b.h / 2)
      draw.text(ctx, '再邀一局', b.x + b.w / 2, b.y + b.h / 2, {
        size: u(theme.size.small), color: c.primaryDark, weight: 500, align: 'center'
      })
    }

    draw.text(ctx, '查看玩法规则', L.W / 2, g.rulesY, {
      size: u(theme.size.body), color: c.primary, align: 'center'
    })

    draw.text(ctx, '玩家标识 ' + this.app.globalData.playerId, L.W / 2, g.footY, {
      size: u(theme.size.tiny), color: c.textMuted, align: 'center'
    })
  }

  /** 再邀最近对手：建房并带到房间页，由用户点「邀请好友」分享 */
  onReinvite() {
    this.app.go('room', { mode: 'create', auto: true, rival: this.rivalName })
  }

  onRules() {
    dialog.alert({
      title: '玩法简介',
      content: '在 9×9 棋盘上布置飞机；双方轮流报点轰炸，机头被击中即整架击毁。先击毁对方全部飞机者获胜。\n\n'
        + '每局的架数（' + MIN_PLANES + '~' + MAX_PLANES + ' 架）由开房的人定死，'
        + '双方布阵时必须摆满同样多才能开局。\n\n'
        + '每步限时 5~30 秒，建房时用滑块调。超时未出招，系统会替你从上到下、从左到右'
        + '打第一格没炸过的位置；连续超时 5 次判负。'
    })
  }
}

module.exports = function (app) { return new Lobby(app) }
