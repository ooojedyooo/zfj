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
const profile = require('../shared/services/profile')
const {
  MAX_PLANES, TIMEOUT, TURN_MIN, TURN_MAX, TURN_DEFAULT, TURN_STEP, ROOM_NAME_MAX
} = require('../shared/config/rules')

class Room extends Scene {
  constructor(app) {
    super(app)
    this.mode = 'create'
    this.roomId = ''
    this.roomNo = ''
    this.roomName = ''
    this.password = String(Math.floor(1000 + Math.random() * 9000))
    this.usePassword = false        // 默认不设密码 = 公开房间（房名可被搜到）
    this.stepSeconds = TURN_DEFAULT // 每步限时，房主在 5~30 之间调
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

    // 房间名默认取昵称；单步限时回到默认值 —— 每次开新房间都是一张干净的设置
    this.roomName = profile.nickname()
    this.stepSeconds = TURN_DEFAULT
    this.usePassword = false
    this.password = String(Math.floor(1000 + Math.random() * 9000))

    // 从「公开房间 / 搜索结果」点进来：房间已经建好了，直接进等待页
    // （不在这里重复 join，列表页已经把加入这一步做完了）
    if (p.joined) {
      this.enterWaiting(p.joined)
      return
    }

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

    // 试着补一个真实微信昵称（拿不到就保持兜底名，不打扰玩家）
    const self = this
    profile.fetchWechatNickname(function (n) {
      if (self.mode !== 'create') return
      self.roomName = String(n).slice(0, ROOM_NAME_MAX)
      self.layout()
    })

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
      g.metaY = g.roomNoY + u(74)
      g.pillsY = g.roomNoY + u(136)
      g.spinnerY = g.pillsY + u(110)
      g.countdownY = g.spinnerY + u(90)

      const rects = Button.colRects(x, L.H - L.safeBottom - u(24) - btnH * 2 - u(20), w, btnH, u(20), 2)
      g.inviteBtn = rects[0]
      g.cancelBtn = rects[1]
      this.zone(rects[0].x, rects[0].y, rects[0].w, rects[0].h, this.onInvite.bind(this))
      this.zone(rects[1].x, rects[1].y, rects[1].w, rects[1].h, this.onCancel.bind(this))
    } else {
      this.zone(g.back.x, g.back.y, g.back.w, g.back.h, this.onCancel.bind(this))

      // 卡片高度：join 两条输入框 / create 三行设置（+密码行）/ random 只有一句说明
      let cardH = u(200)
      if (this.mode === 'join') cardH = u(240)
      if (this.mode === 'create') cardH = u(378) + (this.usePassword ? u(88) : 0)
      g.card = { x: x, y: y, w: w, h: cardH }

      if (this.mode === 'join') {
        g.row1 = { y: y + u(64) }
        g.row2 = { y: y + u(164) }
        this.zone(x, y + u(28), w, u(72), this.onEditJoinRoomNo.bind(this))
        this.zone(x, y + u(128), w, u(72), this.onEditJoinPassword.bind(this))
      } else if (this.mode === 'create') {
        // 三行设置：房间名 / 每步限时 / 是否私密
        // 顺序不是随便排的 —— 从上往下正好是「别人怎么找到我 → 打起来多快 → 谁能进来」，
        // 也就是从公开到私密逐级收紧。
        g.nameY = y + u(66)
        g.stepY = y + u(166)
        g.privY = y + u(266)
        g.hintY = y + cardH - u(30)

        // 房间名：整行可点，弹输入框改
        this.zone(x, g.nameY - u(42), w, u(84), this.onEditRoomName.bind(this))

        // 每步限时步进器：− 数字 ＋
        const sb = u(68)
        g.stepMinus = { x: x + w - u(300), y: g.stepY - u(34), w: sb, h: sb }
        g.stepPlus = { x: x + w - sb, y: g.stepY - u(34), w: sb, h: sb }
        g.stepValueX = x + w - u(150)
        this.zone(g.stepMinus.x, g.stepMinus.y, sb, sb, this.onStepDown.bind(this))
        this.zone(g.stepPlus.x, g.stepPlus.y, sb, sb, this.onStepUp.bind(this))

        // 私密开关
        const sw = u(96)
        const swX = x + w - u(30) - sw
        g.switch = { x: swX, y: g.privY - u(28), w: sw, h: u(56) }
        this.zone(swX - u(24), g.privY - u(48), sw + u(48), u(96), this.onTogglePassword.bind(this))

        if (this.usePassword) {
          // 固定跟在上一次开关之后的行位置，卡片高度一变密码行跟着下移，不会压到提示
          g.pwdY = y + u(356)
          this.zone(x, g.pwdY - u(40), w, u(80), this.onEditRoomPassword.bind(this))
        }
      } else {
        g.hintY = y + cardH - u(34)
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

      // 房间名与单步限时也亮出来：等待时正好是玩家检查「我建对了没」的窗口
      const meta = []
      if (this.roomName) meta.push(draw.ellipsis(ctx, this.roomName, u(360), u(theme.size.small)))
      meta.push('每步 ' + this.stepSeconds + ' 秒')
      draw.text(ctx, meta.join('  ·  '), L.W / 2, g.metaY, {
        size: u(theme.size.small), color: c.textMuted, align: 'center'
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
      if (this.mode === 'create') {
        const lx = card.x + u(28)
        const rx = card.x + card.w - u(28)
        const lw = card.w - u(56)
        const body = u(theme.size.body)

        // ① 房间名
        draw.text(ctx, '房间名', lx, g.nameY, { size: body, color: c.text })
        draw.text(ctx, draw.ellipsis(ctx, this.roomName || '未命名', lw - u(160), body, 500), rx, g.nameY, {
          size: body, color: c.primaryDark, weight: 500, align: 'right'
        })
        draw.text(ctx, '点改 · 别人可按这个名字搜到你', lx, g.nameY + u(30), {
          size: u(theme.size.tiny), color: c.textMuted
        })
        draw.line(ctx, lx, g.nameY + u(58), rx, g.nameY + u(58), c.border, 1)

        // ② 每步限时（5~30 秒，步长 5 秒）
        draw.text(ctx, '每步限时', lx, g.stepY, { size: body, color: c.text })
        const plusOn = this.stepSeconds < TURN_MAX
        const minusOn = this.stepSeconds > TURN_MIN
        ;[[g.stepMinus, '−', minusOn], [g.stepPlus, '＋', plusOn]].forEach(function (it) {
          const r = it[0]
          draw.fillRect(ctx, r.x, r.y, r.w, r.h, it[2] ? c.gray : c.card, u(theme.radius.md))
          draw.strokeRect(ctx, r.x, r.y, r.w, r.h, c.border, u(theme.radius.md), 1)
          draw.text(ctx, it[1], r.x + r.w / 2, r.y + r.h / 2, {
            size: u(theme.size.h3), color: it[2] ? c.text : c.textMuted, align: 'center'
          })
        })
        draw.text(ctx, this.stepSeconds + ' 秒', g.stepValueX, g.stepY, {
          size: u(theme.size.h3), weight: 500, color: c.text, align: 'center'
        })
        draw.text(ctx, '超时未出招会自动轰炸一格，连续 5 次判负', lx, g.stepY + u(34), {
          size: u(theme.size.tiny), color: c.textMuted
        })
        draw.line(ctx, lx, g.stepY + u(62), rx, g.stepY + u(62), c.border, 1)

        // ③ 私密开关
        draw.text(ctx, this.usePassword ? '私密房间（需要密码）' : '公开房间（无需密码）', lx, g.privY, {
          size: body, color: c.text
        })
        const s = g.switch
        draw.fillRect(ctx, s.x, s.y, s.w, s.h, this.usePassword ? c.primary : c.gray, s.h / 2)
        const knob = s.h - u(8)
        draw.circle(ctx,
          this.usePassword ? s.x + s.w - s.h / 2 : s.x + s.h / 2,
          s.y + s.h / 2, knob / 2, '#FFFFFF')
        draw.text(ctx,
          this.usePassword ? '凭密码进入 · 房名照样能被搜到' : '谁都能在公开列表里看到并直接进来',
          lx, g.privY + u(38), { size: u(theme.size.tiny), color: c.textMuted })

        if (this.usePassword) {
          draw.text(ctx, '房间密码', lx, g.pwdY, { size: body, color: c.text })
          draw.text(ctx, this.password, rx, g.pwdY, {
            size: body, color: c.primaryDark, weight: 500, align: 'right'
          })
          draw.text(ctx, '点一下可改', lx, g.pwdY + u(28), {
            size: u(theme.size.tiny), color: c.textMuted
          })
        }

        // 架数去哪儿了：明说，不然玩家会找「飞机数量」那一行
        draw.text(ctx, '下一局打几架，在布阵页点「+」添 · 添几架就是几架',
          lx, g.hintY, { size: u(theme.size.tiny), color: c.textMuted })
      } else {
        draw.text(ctx, '将为你匹配一位在线玩家，也可等待其他玩家加入',
          card.x + u(28), g.hintY, { size: u(theme.size.tiny), color: c.textMuted })
        draw.text(ctx, '打几架在布阵页决定 · 添几架就是几架',
          card.x + u(28), g.hintY + u(32), { size: u(theme.size.tiny), color: c.textMuted })
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

  onTogglePassword() {
    this.usePassword = !this.usePassword
    // 关掉私密就是公开房：密码留着不显示也不提交，下次打开还是那个数，玩家不用重新记
    this.layout()
  }

  onEditRoomName() {
    const self = this
    dialog.input({
      title: '房间名（最多 ' + ROOM_NAME_MAX + ' 个字）',
      value: this.roomName,
      placeholder: '例如：老周的飞行中队',
      onOk: function (v) {
        const name = String(v || '').trim().slice(0, ROOM_NAME_MAX)
        if (!name) { self.app.toast('房间名不能为空'); return }
        self.roomName = name
        self.layout()
      }
    })
  }

  onEditRoomPassword() {
    dialog.input({
      title: '设置 4 位数字密码',
      value: this.password,
      placeholder: '例如 8888',
      onOk: function (v) {
        const s = String(v || '').replace(/\D/g, '').slice(0, 4)
        if (s.length !== 4) { this.app.toast('密码需为 4 位数字'); return }
        this.password = s
        this.layout()
      }.bind(this)
    })
  }

  /** 每步限时 −/+，夹在 5~30 秒，步长 5 秒 */
  onStepDown() { this.setStep(this.stepSeconds - TURN_STEP) }
  onStepUp() { this.setStep(this.stepSeconds + TURN_STEP) }

  setStep(v) {
    // 注意别写成 `Number(v) || TURN_DEFAULT`：0 是 falsy，从 5 秒再按一下 − 会跳回 30 秒
    const n = Number(v)
    const target = isFinite(n) ? Math.min(TURN_MAX, Math.max(TURN_MIN, n)) : TURN_DEFAULT
    if (target === this.stepSeconds) return
    this.stepSeconds = target
    this.layout()
  }

  onEditJoinRoomNo() {
    dialog.input({
      title: '输入 6 位房间号',
      value: this.joinRoomNo,
      placeholder: '例如 123456',
      onOk: function (v) { this.joinRoomNo = v; this.layout() }.bind(this)
    })
  }

  onEditJoinPassword() {
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
      // 架数改由布阵页决定，这里只报「本局上限」；服务端按 1~3 架校验实际布阵
      planeCount: MAX_PLANES,
      roomName: this.roomName,
      stepSeconds: this.stepSeconds,
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
    api.matchRoom({ planeCount: MAX_PLANES }).then(function (data) {
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
      roomName: data.roomName || '',
      stepSeconds: data.stepSeconds || TURN_DEFAULT,
      planeCount: data.planeCount
    }
    this.roomId = data.roomId
    this.roomNo = data.roomNo
    this.roomName = data.roomName || this.roomName
    this.stepSeconds = data.stepSeconds || this.stepSeconds
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
