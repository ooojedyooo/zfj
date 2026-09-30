// minigame/js/scenes/lobby.js
// 大厅 —— 对应小程序 pages/index
// 三个主入口 + 最近对手一键再邀 + 玩法说明
const Scene = require('./base')
const theme = require('../core/theme')
const draw = require('../core/draw')
const Button = require('../widgets/button')
const ui = require('../widgets/ui')
const dialog = require('../core/dialog')
const share = require('../core/share')
const api = require('../shared/services/cloudApi')
const rivals = require('../shared/services/rivals')

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
    g.titleY = L.safeTop + u(150)
    g.subY = g.titleY + u(62)

    let y = g.subY + u(70)

    if (!api.isCloud) {
      g.tipY = y
      y += u(52) + u(30)
    }

    g.btnH = u(92)
    g.buttons = []
    const items = [
      { label: '创建房间', kind: 'primary', act: 'create' },
      { label: '加入房间', kind: 'outline', act: 'join' },
      { label: '随机匹配', kind: 'outline', act: 'random' }
    ]
    items.forEach(function (it) {
      const rect = { x: x, y: y, w: w, h: g.btnH, label: it.label, kind: it.kind }
      g.buttons.push(rect)
      this.zone(rect.x, rect.y, rect.w, rect.h, function () {
        this.app.go('room', { mode: it.act })
      }.bind(this))
      y += g.btnH + u(20)
    }, this)

    if (this.rivalName) {
      const cardH = u(132)
      g.rivalCard = { x: x, y: y, w: w, h: cardH }
      const bw = u(184)
      const bh = u(64)
      g.rivalBtn = { x: x + w - u(28) - bw, y: y + (cardH - bh) / 2, w: bw, h: bh }
      this.zone(g.rivalBtn.x, g.rivalBtn.y, bw, bh, this.onReinvite.bind(this))
      y += cardH + u(24)
    }

    g.rulesY = y + u(28)
    this.zone(x, g.rulesY - u(26), w, u(52), this.onRules.bind(this))

    g.footY = L.H - L.safeBottom - u(32)
  }

  render(ctx) {
    const u = this.u.bind(this)
    const L = this.layoutInfo
    const g = this.geo
    const c = theme.color

    draw.text(ctx, '炸飞机', g.x, g.titleY, {
      size: u(theme.size.big), weight: 500, color: c.primaryDark
    })
    draw.text(ctx, '9×9 棋盘 · 双人实时对战', g.x, g.subY, {
      size: u(theme.size.small), color: c.textMuted
    })

    if (g.tipY != null) {
      ui.modeTip(ctx, L, g.x, g.tipY, g.w, '离线试玩模式 · 对手由本地 AI 扮演')
    }

    g.buttons.forEach(function (b) {
      Button.render(ctx, {
        x: b.x, y: b.y, w: b.w, h: b.h, label: b.label, kind: b.kind
      })
    })

    if (this.rivalName && g.rivalCard) {
      const r = g.rivalCard
      ui.card(ctx, L, r.x, r.y, r.w, r.h)
      draw.text(ctx, '最近对手', r.x + u(28), r.y + u(38), {
        size: u(theme.size.tiny), color: c.textMuted
      })
      draw.text(ctx, draw.ellipsis(ctx, this.rivalName, u(300), u(theme.size.h3), 500), r.x + u(28), r.y + u(80), {
        size: u(theme.size.h3), weight: 500, color: c.text
      })
      draw.text(ctx, '本地共记录 ' + this.rivalCount + ' 位', r.x + u(28), r.y + u(112), {
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
      content: '在 9×9 棋盘上布置 1-3 架飞机；双方轮流报点轰炸，机头被击中即整架击毁。先击毁对方全部飞机者获胜。'
    })
  }
}

module.exports = function (app) { return new Lobby(app) }
