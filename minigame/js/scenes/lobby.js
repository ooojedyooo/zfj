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

    g.titleY = L.safeTop + gap(140)
    g.subY = g.titleY + gap(58)

    let y = g.subY + gap(64)

    if (!api.isCloud) {
      g.tipY = y
      y += gap(50) + gap(20)
    }

    /* ---- ① 快速匹配：三张架数卡 ---- */
    g.matchLabelY = y
    g.matchNoteY = y + gap(32)
    y += gap(62)

    const gapH = u(16)
    const cw = (w - gapH * 2) / 3
    const cardH = gap(150)
    g.matchCards = []
    for (let i = 0; i < 3; i++) {
      const n = MIN_PLANES + i
      const rect = { x: x + i * (cw + gapH), y: y, w: cw, h: cardH, planes: n }
      g.matchCards.push(rect)
      this.zone(rect.x, rect.y, rect.w, rect.h, function () {
        this.app.go('room', { mode: 'random', planeCount: n, auto: true })
      }.bind(this))
    }
    y += cardH + gap(26)

    g.matchHintY = y
    y += gap(38)

    /* ---- ② 创建房间 ---- */
    const btnH = gap(92)
    g.btnH = btnH
    g.createBtn = { x: x, y: y, w: w, h: btnH }
    this.zone(x, y, w, btnH, function () {
      this.app.go('room', { mode: 'create' })
    }.bind(this))
    y += btnH + gap(18)

    /* ---- ③ 浏览 / 搜索 ---- */
    const rowH = gap(88)
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
    y += rowH + gap(22)

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

    g.rulesY = y + gap(26)
    this.zone(x, g.rulesY - gap(26), w, gap(52), this.onRules.bind(this))

    g.footY = L.H - L.safeBottom - u(28)
  }

  render(ctx) {
    const u = this.u.bind(this)
    const L = this.layoutInfo
    const g = this.geo
    const c = theme.color

    // 右上角飞机水印：纯装饰，很淡，用来压住右侧大片空白
    const wm = u(200)
    planeIcon.render(ctx, L.W - u(10) - wm, L.safeTop + u(20), wm, {
      rotation: 1,
      color: 'rgba(24, 95, 165, 0.08)',
      headColor: 'rgba(12, 68, 124, 0.12)'
    })

    draw.text(ctx, '炸飞机', g.x, g.titleY, {
      size: u(theme.size.big), weight: 500, color: c.primaryDark
    })
    draw.text(ctx, '9×9 棋盘 · 双人实时对战', g.x, g.subY, {
      size: u(theme.size.small), color: c.textMuted
    })

    if (g.tipY != null) {
      ui.modeTip(ctx, L, g.x, g.tipY, g.w, '离线试玩模式 · 对手由本地 AI 扮演')
    }

    /* ---- 快速匹配 ---- */
    draw.text(ctx, '快速匹配', g.x, g.matchLabelY, {
      size: u(theme.size.h3), weight: 500, color: c.text
    })
    draw.text(ctx, '选架数，直接开打', g.x + g.w, g.matchLabelY, {
      size: u(theme.size.tiny), color: c.textMuted, align: 'right'
    })

    g.matchCards.forEach(function (r) {
      draw.fillRect(ctx, r.x, r.y, r.w, r.h, c.card, u(theme.radius.md))
      draw.strokeRect(ctx, r.x, r.y, r.w, r.h, c.border, u(theme.radius.md), 1)
      const s = Math.min(r.w - u(40), r.h - u(74))
      planeIcon.render(ctx, r.x + (r.w - s) / 2, r.y + u(14), s, {
        on: true, rotation: 1, color: c.plane, headColor: c.planeHead
      })
      draw.text(ctx, r.planes + ' 架', r.x + r.w / 2, r.y + r.h - u(28), {
        size: u(theme.size.h3), weight: 500, color: c.primaryDark, align: 'center'
      })
    })

    draw.text(ctx, '按架数进入公开房 · 暂时没有就替你开一间等着', g.x, g.matchHintY, {
      size: u(theme.size.tiny), color: c.textMuted
    })

    /* ---- 创建 / 浏览 / 搜索 ---- */
    Button.render(ctx, Object.assign({}, g.createBtn, { label: '创建房间', kind: 'primary' }))
    Button.render(ctx, Object.assign({}, g.browseBtn, { label: '浏览公开房间', kind: 'outline' }))
    Button.render(ctx, Object.assign({}, g.searchBtn, { label: '搜索房间名', kind: 'outline' }))

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
