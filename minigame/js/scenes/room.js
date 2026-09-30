// minigame/js/scenes/room.js
// 房间 —— 对应小程序 pages/room
// 创建 / 加入 / 随机匹配 / 等待对手；含邀战分享与分享卡片回填
const Scene = require('./base')
const theme = require('../core/theme')
const draw = require('../core/draw')
const Button = require('../widgets/button')
const ui = require('../widgets/ui')
const dialog = require('../core/dialog')
const share = require('../core/share')
const api = require('../shared/services/cloudApi')
const { MIN_PLANES, MAX_PLANES, TIMEOUT } = require('../shared/config/rules')

class Room extends Scene {
  constructor(app) {
    super(app)
    this.mode = 'create'
    this.roomId = ''
    this.roomNo = ''
    this.password = String(Math.floor(1000 + Math.random() * 9000))
    this.usePassword = false
    this.planeCount = MIN_PLANES
    this.joinRoomNo = ''
    this.joinPassword = ''
    this.playerCount = 0
    this.waitLeft = TIMEOUT.ROOM
    this.loading = false
    this.enteredGame = false
    this.rivalName = ''
    this.phase = 0
    this.watcher = null
    this.timer = null
  }

  /* ---------------- 生命周期 ---------------- */

  onEnter(params) {
    const p = params || {}
    this.stopWatch()
    this.stopCountdown()

    this.enteredGame = false
    this.loading = false
    this.rivalName = p.rival || ''
    this.phase = 0
    this.waitLeft = TIMEOUT.ROOM
    this.playerCount = 0

    // 来自好友分享卡片：自动切到「加入房间」并回填房间号 / 密码
    const q = share.launchQuery()
    const qNo = p.roomNo || q.roomNo || ''
    const qPwd = p.pwd || q.pwd || ''
    if (qNo) {
      this.mode = 'join'
      this.joinRoomNo = qNo
      this.joinPassword = qPwd
    } else {
      this.mode = p.mode || 'create'
    }

    this.layout()

    // 从结算页 / 大厅「再邀一局」进来：自动建房
    if (p.auto) this.onCreate()
  }

  onExit() {
    this.stopWatch()
    this.stopCountdown()
    if (this.roomId && !this.enteredGame) {
      api.leaveRoom({ roomId: this.roomId }).catch(function () {})
    }
  }

  update(dt) {
    if (this.mode === 'waiting') this.phase += dt / 1000
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
    g.back = { x: u(24), y: L.safeTop + u(16), w: u(140), h: u(56) }
    g.titleY = L.safeTop + u(120)

    let y = g.titleY + u(72)
    const btnH = u(92)

    if (this.mode === 'waiting') {
      g.roomNoY = y + u(40)
      g.pillsY = g.roomNoY + u(110)
      g.spinnerY = g.pillsY + u(110)
      g.countdownY = g.spinnerY + u(90)

      const rects = Button.colRects(x, L.H - L.safeBottom - u(24) - btnH * 2 - u(20), w, btnH, u(20), 2)
      g.inviteBtn = rects[0]
      g.cancelBtn = rects[1]
      this.zone(rects[0].x, rects[0].y, rects[0].w, rects[0].h, this.onInvite.bind(this))
      this.zone(rects[1].x, rects[1].y, rects[1].w, rects[1].h, this.onCancel.bind(this))
    } else {
      this.zone(g.back.x, g.back.y, g.back.w, g.back.h, this.onCancel.bind(this))

      const cardH = (this.mode === 'join') ? u(240) : u(190)
      g.card = { x: x, y: y, w: w, h: cardH }

      if (this.mode === 'join') {
        g.row1 = { y: y + u(64) }
        g.row2 = { y: y + u(164) }
        this.zone(x, y + u(28), w, u(72), this.onEditRoomNo.bind(this))
        this.zone(x, y + u(128), w, u(72), this.onEditPassword.bind(this))
      } else {
        g.rowPlane = { y: y + u(64) }
        g.rowPwd = { y: y + u(138) }
        const sw = u(96)
        const swX = x + w - u(32) - sw
        const swY = g.rowPwd.y - u(30)
        g.switch = { x: swX, y: swY, w: sw, h: u(56) }
        this.zone(swX - u(20), swY - u(8), sw + u(40), u(72), this.onTogglePassword.bind(this))

        const st = u(64)
        g.minus = { x: x + w - u(32) - st * 2 - u(24), y: g.rowPlane.y - st / 2, w: st, h: st }
        g.plus = { x: x + w - u(32) - st, y: g.rowPlane.y - st / 2, w: st, h: st }
        this.zone(g.minus.x, g.minus.y, st, st, this.onDecPlane.bind(this))
        this.zone(g.plus.x, g.plus.y, st, st, this.onIncPlane.bind(this))

        if (this.usePassword) {
          g.pwdBoxY = y + cardH - u(12)
        }
      }

      const actionY = L.H - L.safeBottom - u(24) - btnH
      g.actionBtn = { x: x, y: actionY, w: w, h: btnH }
      const act = this.mode === 'join' ? this.onJoin
        : this.mode === 'random' ? this.onMatch : this.onCreate
      this.zone(x, actionY, w, btnH, act.bind(this))
    }
  }

  /* ---------------- 绘制 ---------------- */

  render(ctx) {
    const u = this.u.bind(this)
    const L = this.layoutInfo
    const g = this.geo
    const c = theme.color

    if (this.mode === 'waiting') {
      draw.text(ctx, '等待对手加入…', L.W / 2, g.titleY, {
        size: u(theme.size.h2), weight: 500, color: c.text, align: 'center'
      })
      draw.text(ctx, this.roomNo || '------', L.W / 2, g.roomNoY, {
        size: u(96), weight: 500, color: c.primaryDark, align: 'center'
      })
      draw.text(ctx, '房间号', L.W / 2, g.roomNoY - u(76), {
        size: u(theme.size.tiny), color: c.textMuted, align: 'center'
      })

      const pill = u(200)
      const gap = u(28)
      const x0 = (L.W - pill * 2 - gap) / 2
      for (let i = 0; i < 2; i++) {
        const on = this.playerCount >= i + 1
        const px = x0 + i * (pill + gap)
        draw.fillRect(ctx, px, g.pillsY, pill, u(56), on ? c.primaryLight : c.gray, u(theme.radius.pill))
        draw.text(ctx, '玩家 ' + (i + 1), px + pill / 2, g.pillsY + u(28), {
          size: u(theme.size.small), color: on ? c.primaryDark : c.textMuted, align: 'center'
        })
      }

      ui.spinner(ctx, L, L.W / 2, g.spinnerY, u(34), this.phase * 3)

      draw.text(ctx, '超时将在 ' + this.waitLeft + ' 秒后自动解散', L.W / 2, g.countdownY, {
        size: u(theme.size.small), color: c.textMuted, align: 'center'
      })

      if (!api.isCloud) {
        draw.text(ctx, '离线试玩模式 · 对手稍后自动加入', L.W / 2, g.countdownY + u(44), {
          size: u(theme.size.tiny), color: c.textMuted, align: 'center'
        })
      }

      Button.render(ctx, Object.assign({}, g.inviteBtn, { label: '邀请好友加入', kind: 'primary' }))
      Button.render(ctx, Object.assign({}, g.cancelBtn, { label: '取消', kind: 'outline' }))
      return
    }

    const titles = { create: '创建房间', join: '加入房间', random: '随机匹配' }
    draw.text(ctx, titles[this.mode] || '', L.W / 2, g.titleY, {
      size: u(theme.size.h2), weight: 500, color: c.text, align: 'center'
    })

    // 返回
    draw.fillRect(ctx, g.back.x, g.back.y, g.back.w, g.back.h, c.gray, u(theme.radius.pill))
    draw.text(ctx, '‹ 返回', g.back.x + g.back.w / 2, g.back.y + g.back.h / 2, {
      size: u(theme.size.small), color: c.text, align: 'center'
    })

    const card = g.card
    ui.card(ctx, L, card.x, card.y, card.w, card.h)

    if (this.mode === 'join') {
      this.drawField(ctx, card.x + u(28), g.row1.y, card.w - u(56), '房间号', this.joinRoomNo || '点击输入 6 位房间号', !this.joinRoomNo)
      this.drawField(ctx, card.x + u(28), g.row2.y, card.w - u(56), '密码（如无请留空）', this.joinPassword || '点击输入', !this.joinPassword)
      draw.text(ctx, '从好友分享卡片点进来会自动回填', card.x + u(28), card.y + card.h - u(26), {
        size: u(theme.size.tiny), color: c.textMuted
      })
    } else {
      ui.row(ctx, L, card.x + u(28), g.rowPlane.y, card.w - u(56), '飞机数量', String(this.planeCount))
      // 加减给个圆底，否则两个孤零零的符号不像按钮，玩家根本想不到可以调
      const cr = g.minus.w / 2
      draw.circle(ctx, g.minus.x + cr, g.minus.y + cr, cr, c.gray)
      draw.circle(ctx, g.plus.x + cr, g.plus.y + cr, cr, c.gray)
      draw.text(ctx, '−', g.minus.x + g.minus.w / 2, g.minus.y + g.minus.h / 2, {
        size: u(theme.size.h2), color: c.primaryDark, align: 'center'
      })
      draw.text(ctx, '＋', g.plus.x + g.plus.w / 2, g.plus.y + g.plus.h / 2, {
        size: u(theme.size.h2), color: c.primaryDark, align: 'center'
      })

      if (this.mode === 'create') {
        ui.row(ctx, L, card.x + u(28), g.rowPwd.y, card.w - u(56), '设置密码', '')
        const s = g.switch
        draw.fillRect(ctx, s.x, s.y, s.w, s.h, this.usePassword ? c.primary : c.gray, s.h / 2)
        const knob = s.h - u(8)
        draw.circle(ctx, this.usePassword ? s.x + s.w - s.h / 2 : s.x + s.h / 2, s.y + s.h / 2, knob / 2, '#FFFFFF')

        if (this.usePassword) {
          draw.text(ctx, '房间密码：' + this.password, card.x + u(28), g.pwdBoxY, {
            size: u(theme.size.body), color: c.primaryDark, weight: 500
          })
        }
      } else {
        draw.text(ctx, '将为你匹配一位在线玩家，也可等待其他玩家加入', card.x + u(28), card.y + card.h - u(30), {
          size: u(theme.size.tiny), color: c.textMuted
        })
      }
    }

    const label = this.mode === 'join' ? '加入房间' : (this.mode === 'random' ? '开始匹配' : '创建房间')
    Button.render(ctx, Object.assign({}, g.actionBtn, {
      label: label, kind: 'primary', loading: this.loading
    }))
  }

  drawField(ctx, x, y, w, label, value, placeholder) {
    const u = this.u.bind(this)
    const c = theme.color
    draw.text(ctx, label, x, y - u(34), { size: u(theme.size.tiny), color: c.textMuted })
    draw.fillRect(ctx, x, y - u(26), w, u(56), c.gray, u(theme.radius.sm))
    draw.text(ctx, draw.ellipsis(ctx, value, w - u(32), u(theme.size.body)), x + u(16), y + u(2), {
      size: u(theme.size.body),
      color: placeholder ? c.textMuted : c.text
    })
  }

  /* ---------------- 交互 ---------------- */

  onIncPlane() {
    if (this.planeCount < MAX_PLANES) { this.planeCount++; }
  }

  onDecPlane() {
    if (this.planeCount > MIN_PLANES) { this.planeCount--; }
  }

  onTogglePassword() {
    this.usePassword = !this.usePassword
    this.layout()
  }

  onEditRoomNo() {
    dialog.input({
      title: '输入 6 位房间号',
      value: this.joinRoomNo,
      placeholder: '例如 123456',
      onOk: function (v) { this.joinRoomNo = v; this.layout() }.bind(this)
    })
  }

  onEditPassword() {
    dialog.input({
      title: '输入房间密码',
      value: this.joinPassword,
      placeholder: '如无密码请留空',
      onOk: function (v) { this.joinPassword = v; this.layout() }.bind(this)
    })
  }

  onCreate() {
    if (this.loading) return
    const app = this.app
    const self = this
    this.loading = true
    this.layout()
    app.busy('创建中…')
    api.createRoom({
      planeCount: this.planeCount,
      password: this.usePassword ? this.password : ''
    }).then(function (data) {
      app.hideBusy()
      self.loading = false
      self.enterWaiting(data)
    }).catch(function (e) {
      app.hideBusy()
      self.loading = false
      app.toast(e.message || '创建失败')
      self.layout()
    })
  }

  onJoin() {
    const no = String(this.joinRoomNo || '').trim()
    if (!/^\d{6}$/.test(no)) {
      this.app.toast('请输入 6 位房间号')
      return
    }
    if (this.loading) return
    const app = this.app
    const self = this
    this.loading = true
    this.layout()
    app.busy('加入中…')
    api.joinRoom({ roomNo: no, password: this.joinPassword }).then(function (data) {
      app.hideBusy()
      self.loading = false
      self.enterWaiting(data)
    }).catch(function (e) {
      app.hideBusy()
      self.loading = false
      app.toast(e.message || '加入失败')
      self.layout()
    })
  }

  onMatch() {
    if (this.loading) return
    const app = this.app
    const self = this
    this.loading = true
    this.layout()
    app.busy('匹配中…')
    api.matchRoom({ planeCount: this.planeCount }).then(function (data) {
      app.hideBusy()
      self.loading = false
      self.enterWaiting(data)
    }).catch(function (e) {
      app.hideBusy()
      self.loading = false
      app.toast(e.message || '匹配失败')
      self.layout()
    })
  }

  enterWaiting(data) {
    const app = this.app
    app.globalData.match = {
      roomId: data.roomId,
      roomNo: data.roomNo,
      planeCount: data.planeCount
    }
    this.roomId = data.roomId
    this.roomNo = data.roomNo
    this.playerCount = data.matched ? 2 : 1
    this.mode = 'waiting'
    this.waitLeft = TIMEOUT.ROOM
    this.layout()
    this.startWatch()
    this.startCountdown()
  }

  /* ---------------- 实时监听 ---------------- */

  startWatch() {
    const self = this
    const app = this.app
    this.stopWatch()
    this.watcher = api.watchRoom(this.roomId, function (room) {
      if (!room) return
      const n = (room.players || []).length
      if (n !== self.playerCount) {
        self.playerCount = n
        self.layout()
      }
      if (room.status === 'deploy' || room.status === 'battle') {
        self.enteredGame = true
        self.stopWatch()
        self.stopCountdown()
        app.toast('对手已就位', 900)
        app.replace('deploy')
      } else if (room.status === 'finished') {
        self.stopWatch()
        self.stopCountdown()
        dialog.alert({
          title: '房间已关闭',
          content: '对手已离开房间',
          onClose: function () { app.back() }
        })
      }
    }, function () {
      app.toast('连接中断，请重试')
    })
  }

  stopWatch() {
    if (this.watcher) {
      try { this.watcher.close() } catch (e) { /* ignore */ }
      this.watcher = null
    }
  }

  startCountdown() {
    const self = this
    this.stopCountdown()
    this.timer = setInterval(function () {
      self.waitLeft -= 1
      if (self.waitLeft <= 0) {
        self.stopCountdown()
        dialog.alert({
          title: '匹配超时',
          content: '等待超过 5 分钟仍未匹配到对手，房间已自动解散。',
          onClose: function () { self.app.back() }
        })
      }
    }, 1000)
  }

  stopCountdown() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  onCancel() {
    this.app.back()
  }

  /* ---------------- 分享 ---------------- */

  shareInfo() {
    if (this.roomNo) {
      const q = this.usePassword ? { roomNo: this.roomNo, pwd: this.password } : { roomNo: this.roomNo }
      return {
        title: this.rivalName
          ? '炸飞机 · ' + this.rivalName + '，房间 ' + this.roomNo + '，接着上次的账继续算！'
          : '炸飞机 · 房间号 ' + this.roomNo + '，来跟我打一局！',
        query: share.toQuery(q)
      }
    }
    return { title: '炸飞机 · 9×9 双人实时对战，机头一炮击毁', query: '' }
  }

  onInvite() {
    share.share(this.shareInfo())
  }
}

module.exports = function (app) { return new Room(app) }
