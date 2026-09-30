// minigame/js/scenes/result.js
// 结算 —— 对应小程序 pages/result
// 战绩统计 + 最近对手 + 再来一局 / 邀请再战 / 分享战报
const Scene = require('./base')
const theme = require('../core/theme')
const draw = require('../core/draw')
const Button = require('../widgets/button')
const ui = require('../widgets/ui')
const share = require('../core/share')
const api = require('../shared/services/cloudApi')
const rivals = require('../shared/services/rivals')
const { END_TYPE } = require('../shared/config/rules')

const END_TEXT = {}
END_TEXT[END_TYPE.ALL_DESTROYED] = '击毁对方全部飞机'
END_TEXT[END_TYPE.SURRENDER] = '对方投降'
END_TEXT[END_TYPE.TIMEOUT] = '对方超时判负'

const LOSE_TEXT = {}
LOSE_TEXT[END_TYPE.ALL_DESTROYED] = '己方飞机全部被击毁'
LOSE_TEXT[END_TYPE.SURRENDER] = '己方主动投降'
LOSE_TEXT[END_TYPE.TIMEOUT] = '己方连续超时判负'

class Result extends Scene {
  constructor(app) {
    super(app)
    this.planeCount = 1
    this.rivalName = ''
  }

  onEnter() {
    const r = this.app.globalData.matchResult || {}
    const list = rivals.list()
    this.planeCount = r.planeCount || 1
    this.win = !!r.win
    this.endType = r.endType || ''
    this.roomId = r.roomId || ''
    this.myShots = r.myShots || 0
    this.foeShots = r.foeShots || 0
    this.myDestroyed = r.myDestroyed || 0
    this.foeDestroyed = r.foeDestroyed || 0
    this.rivalName = rivals.displayName(list[0])
    this.rivalCount = list.length

    share.onShare(function () {
      return {
        title: '炸飞机 · 9×9 双人实时对战，来跟我打一局',
        query: ''
      }
    })
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
    g.headY = L.safeTop + u(120)
    g.subY = g.headY + u(76)

    let y = g.subY + u(64)
    g.card = { x: x, y: y, w: w, h: u(340) }
    y += g.card.h + u(22)

    if (this.rivalName) {
      g.rival = { x: x, y: y, w: w, h: u(128) }
      y += g.rival.h + u(22)
    }

    const btnH = u(88)
    const gap = u(18)
    const labels = ['再来一局']
    if (this.rivalName) labels.push('邀请好友再战')
    labels.push('分享战报')
    labels.push('返回大厅')

    g.buttons = []
    labels.forEach(function (lb) {
      const r = { x: x, y: y, w: w, h: btnH, label: lb }
      g.buttons.push(r)
      y += btnH + gap
    }, this)

    const self = this
    const acts = [this.onAgain.bind(this)]
    if (this.rivalName) acts.push(this.onInvite.bind(this))
    acts.push(this.onShareReport.bind(this))
    acts.push(this.onBackHome.bind(this))

    g.buttons.forEach(function (r, i) {
      self.zone(r.x, r.y, r.w, r.h, acts[i])
    })
  }

  render(ctx) {
    const u = this.u.bind(this)
    const L = this.layoutInfo
    const g = this.geo
    const c = theme.color

    draw.text(ctx, this.win ? '胜 利' : '失 败', L.W / 2, g.headY, {
      size: u(theme.size.big), weight: 500, align: 'center',
      color: this.win ? c.primary : c.danger
    })
    draw.text(ctx, this.win ? (END_TEXT[this.endType] || '') : (LOSE_TEXT[this.endType] || ''), L.W / 2, g.subY, {
      size: u(theme.size.small), color: c.textMuted, align: 'center'
    })

    // 战绩卡
    const card = g.card
    ui.card(ctx, L, card.x, card.y, card.w, card.h)
    const mySurvived = this.planeCount - this.foeDestroyed
    const foeSurvived = this.planeCount - this.myDestroyed
    ui.row(ctx, L, card.x + u(28), card.y + u(56), card.w - u(56), '我方剩余飞机', mySurvived + ' / ' + (mySurvived + this.foeDestroyed))
    ui.row(ctx, L, card.x + u(28), card.y + u(124), card.w - u(56), '对方剩余飞机', foeSurvived + ' / ' + (foeSurvived + this.myDestroyed))
    ui.row(ctx, L, card.x + u(28), card.y + u(192), card.w - u(56), '我方出手次数', String(this.myShots))
    ui.row(ctx, L, card.x + u(28), card.y + u(260), card.w - u(56), '对方出手次数', String(this.foeShots))
    draw.text(ctx, '房间号', card.x + u(28), card.y + u(316), { size: u(theme.size.small), color: c.textMuted })
    draw.text(ctx, draw.ellipsis(ctx, this.roomId, u(360), u(theme.size.small), 500), card.x + card.w - u(28), card.y + u(316), {
      size: u(theme.size.small), color: c.text, weight: 500, align: 'right'
    })

    // 最近对手
    if (this.rivalName && g.rival) {
      const r = g.rival
      ui.card(ctx, L, r.x, r.y, r.w, r.h)
      draw.text(ctx, '最近对手', r.x + u(28), r.y + u(44), { size: u(theme.size.tiny), color: c.textMuted })
      draw.text(ctx, draw.ellipsis(ctx, this.rivalName, u(400), u(theme.size.h3), 500), r.x + u(28), r.y + u(86), {
        size: u(theme.size.h3), weight: 500, color: c.text
      })
      draw.text(ctx, '本地已记录 ' + this.rivalCount + ' 位', r.x + r.w - u(28), r.y + u(86), {
        size: u(theme.size.tiny), color: c.textMuted, align: 'right'
      })
    }

    g.buttons.forEach(function (b, i) {
      const kind = i === 0 ? 'primary' : 'outline'
      Button.render(ctx, { x: b.x, y: b.y, w: b.w, h: b.h, label: b.label, kind: kind })
    })
  }

  /* ---------------- 交互 ---------------- */

  /** 再来一局：随机匹配 */
  onAgain() {
    this.app.replace('room', { mode: 'random' })
  }

  /** 邀请好友再战：新建房间并停在等待页，由用户点「邀请好友加入」分享 */
  onInvite() {
    this.app.replace('room', { mode: 'create', auto: true, rival: this.rivalName })
  }

  onShareReport() {
    share.share({
      title: this.win
        ? '炸飞机 · 我刚把对手全歼了，你敢来试试？'
        : '炸飞机 · 我被人一炮爆了机头，帮我报仇！',
      query: ''
    })
  }

  onBackHome() {
    this.app.globalData.match = null
    this.app.globalData.matchResult = null
    this.app.reset('lobby')
  }
}

module.exports = function (app) { return new Result(app) }
