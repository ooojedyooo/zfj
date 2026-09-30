// minigame/js/scenes/battle.js
// 对战 —— 对应小程序 pages/battle
// 上下双棋盘（焦点方放大、非焦点方缩小），点选未攻击格 + 发射两步式出招；
// 局内快捷表情、投降、分享；数据全部来自服务端，本地不做任何判定。
const Scene = require('./base')
const theme = require('../core/theme')
const draw = require('../core/draw')
const Button = require('../widgets/button')
const Board = require('../widgets/board')
const dialog = require('../core/dialog')
const share = require('../core/share')
const api = require('../shared/services/cloudApi')
const rivals = require('../shared/services/rivals')
const { createMatrix } = require('../shared/utils/board')
const { getAbsoluteCells } = require('../shared/utils/plane')
const { RESULT, BOARD_SIZE, TIMEOUT } = require('../shared/config/rules')
const { EMOTES, EMOTE_HIDE_MS } = require('../shared/config/social')

const RESULT_TEXT = {}
RESULT_TEXT[RESULT.MISS] = '未击中'
RESULT_TEXT[RESULT.HIT] = '击中！'
RESULT_TEXT[RESULT.KILL] = '击毁！'

class Battle extends Scene {
  constructor(app) {
    super(app)
    this.roomId = ''
    this.myOpenid = ''
    this.foeOpenid = ''
    this.myDeploy = []
    this.focus = 'foe'
    this.selected = null
    this.myTurn = false
    this.finished = false
    this.statusText = '同步中…'
    this.myShots = 0
    this.foeShots = 0
    this.myDestroyed = 0
    this.foeDestroyed = 0
    this.turnSeconds = TIMEOUT.TURN
    this.emoteBarOpen = false
    this.emoteBubble = null
    this.lastBattle = null
    this.lastEmoteSeq = 0
    this.resultHandled = false
    this.ticking = false
    this.tickAcc = 0
    this.watcher = null
    this.emoteTimer = null
  }

  /* ---------------- 生命周期 ---------------- */

  onEnter() {
    const app = this.app
    const match = app.globalData.match || {}
    this.roomId = match.roomId || ''
    this.planeCount = this.planeCount || match.planeCount || 1
    this.resultHandled = false
    this.ticking = false
    this.tickAcc = 0
    this.selected = null
    this.emoteBarOpen = false
    this.emoteBubble = null
    this.lastEmoteSeq = 0
    this.layout()

    share.onShare(function () {
      return {
        title: '炸飞机 · 9×9 双人实时对战，来跟我打一局',
        query: ''
      }
    })

    if (!this.roomId) {
      app.toast('对局信息丢失')
      setTimeout(function () { app.reset('lobby') }, 1200)
      return
    }
    this.sync()
    this.startWatch()
  }

  onExit() {
    this.stopWatch()
    if (this.emoteTimer) { clearTimeout(this.emoteTimer); this.emoteTimer = null }
  }

  update(dt) {
    if (this.finished || !this.lastBattle || !this.lastBattle.turnDeadline) return
    this.tickAcc += dt
    if (this.tickAcc < 250) return
    this.tickAcc = 0

    const left = Math.max(0, Math.ceil((this.lastBattle.turnDeadline - Date.now()) / 1000))
    if (left !== this.turnSeconds) this.turnSeconds = left
    if (left <= 0) this.requestTick()
  }

  /* ---------------- 数据同步 ---------------- */

  sync() {
    const self = this
    api.sync({ roomId: this.roomId }).then(function (data) {
      self.myOpenid = data.myOpenid
      self.myDeploy = data.myDeploy || []
      self.planeCount = self.myDeploy.length || self.planeCount || 1
      self.resolveFoe(data.players)
      self.applyBattle(data.battle)
    }).catch(function (e) {
      self.app.toast(e.message || '同步失败')
    })
  }

  resolveFoe(players) {
    // 注意：普通 function 回调里的 this 不是场景实例，必须先存下来（此前这里踩过坑）
    const me = this.myOpenid
    const list = players || []
    const foe = list.filter(function (p) { return p && p.openid && p.openid !== me })[0]
    this.foeOpenid = foe ? foe.openid : ''
  }

  startWatch() {
    const self = this
    this.stopWatch()
    this.watcher = api.watchRoom(this.roomId, function (room) {
      if (room) self.applyBattle(room.battle)
    }, function () {
      self.app.toast('连接中断，请重新进入')
    })
  }

  stopWatch() {
    if (this.watcher) {
      try { this.watcher.close() } catch (e) { /* ignore */ }
      this.watcher = null
    }
  }

  applyBattle(b) {
    if (!b || !this.myOpenid) return
    this.lastBattle = b

    const mine = (b.marks && b.marks[this.myOpenid]) || {}
    const incoming = (b.incoming && b.incoming[this.myOpenid]) || {}
    const stats = (b.stats && b.stats[this.myOpenid]) || { kill: 0, lost: 0, shots: 0 }

    const myTurn = b.turn === this.myOpenid
    const finished = !!b.finished
    const focusChanged = (finished ? this.focus : (myTurn ? 'foe' : 'mine')) !== this.focus

    this.mine = mine
    this.incoming = incoming
    this.myTurn = myTurn
    this.finished = finished
    this.statusText = finished ? '对局结束' : (myTurn ? '轮到你开炮' : '等待对方行动…')
    this.myShots = stats.shots
    this.foeShots = Object.keys(incoming).length
    this.myDestroyed = stats.lost
    this.foeDestroyed = stats.kill
    this.focus = finished ? this.focus : (myTurn ? 'foe' : 'mine')
    if (finished) { this.emoteBarOpen = false }

    const needLayout = focusChanged || (this.wasTurn !== myTurn) || (this.wasFinished !== finished)
    this.wasTurn = myTurn
    this.wasFinished = finished
    if (needLayout) this.layout()

    if (b.emote && b.emote.seq !== this.lastEmoteSeq) {
      this.lastEmoteSeq = b.emote.seq
      this.showEmote(b.emote)
    }

    if (finished && !this.resultHandled) {
      this.resultHandled = true
      this.recordRival(b)
      const self = this
      setTimeout(function () { self.goResult(b) }, 800)
    }
  }

  requestTick() {
    if (this.ticking) return
    const self = this
    this.ticking = true
    api.tick({ roomId: this.roomId }).catch(function () {}).then(function () {
      setTimeout(function () { self.ticking = false }, 2500)
    })
  }

  /* ---------------- 布局 ---------------- */

  layout() {
    this.zones = []
    const u = this.u.bind(this)
    const L = this.layoutInfo
    const g = this.geo = {}

    g.statusH = u(56)
    let top = L.safeTop + u(16)
    g.statusY = top + g.statusH / 2
    top += g.statusH + u(18)

    const btnH = u(88)
    const bottomH = btnH + u(20) + L.safeBottom + u(16)
    g.bottomRects = Button.rowRects(u(40), L.H - L.safeBottom - u(24) - btnH, L.W - u(80), btnH, u(20), 2)

    const showFire = this.myTurn && !this.finished
    const fireH = showFire ? u(92) + u(16) : 0

    const padOuter = u(14)
    const titleH = u(36)
    const gap = u(16)
    const remain = L.H - top - u(16) - bottomH - fireH

    const maxBoardW = L.W - u(80) - padOuter * 2
    const miniSize = Math.min(maxBoardW, Math.max(u(150), L.W * 0.26))
    const miniBlockH = titleH + miniSize + padOuter * 2
    const largeAvail = remain - gap - miniBlockH
    const largeSize = Math.max(u(220), Math.min(maxBoardW, largeAvail - titleH - padOuter * 2))

    const largeBlockH = titleH + largeSize + padOuter * 2

    g.mineSize = this.focus === 'mine' ? largeSize : miniSize
    g.foeSize = this.focus === 'foe' ? largeSize : miniSize

    g.mineBlock = { top: top, h: this.focus === 'mine' ? largeBlockH : miniBlockH }
    g.foeBlock = {
      top: top + g.mineBlock.h + gap,
      h: this.focus === 'foe' ? largeBlockH : miniBlockH
    }

    g.mineBoard = this.boardRect(g.mineBlock, g.mineSize, padOuter, titleH)
    g.foeBoard = this.boardRect(g.foeBlock, g.foeSize, padOuter, titleH)

    // 点击非焦点区域 → 切换焦点
    const self = this
    this.zone(u(40), g.mineBlock.top - u(8), L.W - u(80), g.mineBlock.h + u(8), function () {
      if (self.focus !== 'mine') { self.focus = 'mine'; self.layout() }
    })
    this.zone(u(40), g.foeBlock.top - u(8), L.W - u(80), g.foeBlock.h + u(8), function () {
      if (self.focus !== 'foe') { self.focus = 'foe'; self.layout() }
    })

    // 我方海域（只读）
    // 敌方海域（轮到我方可点选）
    Board.layout(this, {
      x: g.foeBoard.x, y: g.foeBoard.y, size: g.foeBoard.size,
      selectable: showFire,
      disabledMap: this.disabledMap(),
      selected: this.selected
    }, this.onFoeCellTap.bind(this))

    // 出招区
    if (showFire) {
      const fy = L.H - L.safeBottom - u(24) - btnH - u(20) - u(92)
      const emoteW = u(92)
      const fireW = u(200)
      g.emojiBtn = { x: u(40), y: fy, w: emoteW, h: u(92) }
      g.fireBtn = { x: L.W - u(40) - fireW, y: fy, w: fireW, h: u(92) }
      g.coordY = fy + u(46)
      this.zone(g.emojiBtn.x, g.emojiBtn.y, g.emojiBtn.w, g.emojiBtn.h, this.onToggleEmote.bind(this))
      this.zone(g.fireBtn.x, g.fireBtn.y, g.fireBtn.w, g.fireBtn.h, this.onFire.bind(this))

      if (this.emoteBarOpen) {
        const barH = u(104)
        g.emoteBarY = fy - u(16) - barH
        const rects = Button.rowRects(u(40), g.emoteBarY, L.W - u(80), barH, u(12), EMOTES.length)
        g.emoteRects = rects
        rects.forEach(function (r, i) {
          self.zone(r.x, r.y, r.w, r.h, function () { self.sendEmote(EMOTES[i].emoji) })
        })
      }
    }

    g.surrenderBtn = g.bottomRects[0]
    g.inviteBtn = g.bottomRects[1]
    const noop = function () {}
    this.zone(g.surrenderBtn.x, g.surrenderBtn.y, g.surrenderBtn.w, g.surrenderBtn.h,
      this.finished ? noop : this.onSurrender.bind(this), { disabled: this.finished })
    this.zone(g.inviteBtn.x, g.inviteBtn.y, g.inviteBtn.w, g.inviteBtn.h, this.onInvite.bind(this))
  }

  boardRect(block, size, padOuter, titleH) {
    const L = this.layoutInfo
    return {
      x: (L.W - size) / 2,
      y: block.top + titleH + padOuter,
      size: size
    }
  }

  /* ---------------- 渲染 ---------------- */

  render(ctx) {
    const u = this.u.bind(this)
    const L = this.layoutInfo
    const g = this.geo
    const c = theme.color

    // 状态条
    draw.text(ctx, this.statusText, u(40), g.statusY, {
      size: u(theme.size.body), weight: this.myTurn && !this.finished ? 500 : 400,
      color: this.myTurn && !this.finished ? c.primary : c.textMuted
    })
    const shots = '我方 ' + this.myShots + ' · 对方 ' + this.foeShots
    const cd = this.finished ? '' : '  ·  ' + this.turnSeconds + 's'
    draw.text(ctx, shots + cd, L.W - u(40), g.statusY, {
      size: u(theme.size.tiny), color: c.textMuted, align: 'right'
    })

    if (!api.isCloud) {
      draw.text(ctx, '离线试玩模式 · 对手由本地 AI 扮演', u(40), g.statusY + u(26), {
        size: u(theme.size.tiny), color: c.textMuted
      })
    }

    this.drawArea(ctx, u, {
      block: g.mineBlock, board: g.mineBoard, title: '我方海域 · 受损情况',
      focus: this.focus === 'mine', cells: this.myCells(), selectable: false,
      disabled: {}, tag: this.myDestroyed + '/' + (this.planeCount || 1) + ' 架被毁'
    })

    this.drawArea(ctx, u, {
      block: g.foeBlock, board: g.foeBoard, title: '敌方海域 · 我方战况',
      focus: this.focus === 'foe', cells: this.foeCells(), selectable: this.myTurn && !this.finished,
      disabled: this.disabledMap(), tag: '已击毁 ' + this.foeDestroyed + '/' + (this.planeCount || 1)
    })

    // 出招区
    if (g.emojiBtn) {
      draw.fillRect(ctx, g.emojiBtn.x, g.emojiBtn.y, g.emojiBtn.w, g.emojiBtn.h,
        this.emoteBarOpen ? c.primaryLight : c.gray, u(theme.radius.md))
      draw.text(ctx, '☺', g.emojiBtn.x + g.emojiBtn.w / 2, g.emojiBtn.y + g.emojiBtn.h / 2, {
        size: u(theme.size.h3), color: c.text, align: 'center'
      })

      const label = this.selected
        ? '横' + this.selected.col + '，竖' + this.selected.row
        : '请选择轰炸坐标'
      draw.text(ctx, label, g.emojiBtn.x + g.emojiBtn.w + u(20), g.coordY, {
        size: u(theme.size.body), color: this.selected ? c.text : c.textMuted
      })

      Button.render(ctx, Object.assign({}, g.fireBtn, {
        label: '发射', kind: 'primary', disabled: !this.selected
      }))

      if (this.emoteBarOpen && g.emoteRects) {
        draw.fillRect(ctx, u(40), g.emoteBarY, L.W - u(80), u(104), c.card, u(theme.radius.lg))
        g.emoteRects.forEach(function (r, i) {
          draw.text(ctx, EMOTES[i].emoji, r.x + r.w / 2, r.y + r.h / 2, {
            size: u(52), align: 'center'
          })
        })
      }
    }

    Button.render(ctx, Object.assign({}, g.surrenderBtn, {
      label: '投降', kind: 'danger', disabled: this.finished
    }))
    Button.render(ctx, Object.assign({}, g.inviteBtn, { label: '邀请好友', kind: 'outline' }))

    // 表情气泡
    if (this.emoteBubble) {
      const em = this.emoteBubble
      const size = u(theme.size.tiny)
      const who = em.mine ? '你' : '对方'
      const tw = draw.measure(ctx, who, size)
      const bw = tw + u(96)
      const bh = u(84)
      const bx = em.mine ? L.W - u(32) - bw : u(32)
      const by = L.H * 0.22
      draw.fillRect(ctx, bx, by, bw, bh, c.card, u(theme.radius.pill))
      draw.strokeRect(ctx, bx, by, bw, bh, c.border, u(theme.radius.pill), 1)
      draw.text(ctx, who, bx + u(24), by + bh / 2, { size: size, color: c.textMuted })
      draw.text(ctx, em.emoji, bx + u(24) + tw + u(24), by + bh / 2, { size: u(44) })
    }
  }

  drawArea(ctx, u, o) {
    const c = theme.color
    const block = o.block
    const board = o.board

    draw.text(ctx, o.title, u(40), block.top + u(18), {
      size: u(theme.size.small), weight: 500, color: o.focus ? c.text : c.textMuted
    })
    draw.text(ctx, o.tag, this.layoutInfo.W - u(40), block.top + u(18), {
      size: u(theme.size.tiny), color: c.textMuted, align: 'right'
    })
    if (o.focus) {
      const tw = draw.measure(ctx, '焦点', u(theme.size.tiny)) + u(24)
      draw.fillRect(ctx, u(40) + draw.measure(ctx, o.title, u(theme.size.small), 500) + u(14),
        block.top + u(18) - u(18), tw, u(36), c.primaryLight, u(18))
      draw.text(ctx, '焦点', u(40) + draw.measure(ctx, o.title, u(theme.size.small), 500) + u(14) + tw / 2,
        block.top + u(18), { size: u(theme.size.tiny), color: c.primaryDark, align: 'center' })
    }

    Board.render(ctx, {
      x: board.x, y: board.y, size: board.size,
      cells: o.cells, selectable: o.selectable,
      disabledMap: o.disabled, selected: o.selectable ? this.selected : null
    }, u)
  }

  /* ---------------- 棋盘状态 ---------------- */

  myCells() {
    const m = createMatrix(BOARD_SIZE, '')
    ;(this.myDeploy || []).forEach(function (p) {
      const abs = getAbsoluteCells(p.planeId, p.anchorRow, p.anchorCol, p.rotation)
      abs.forEach(function (cell) { m[cell.row - 1][cell.col - 1] = 'plane' })
    })
    const inc = this.incoming || {}
    Object.keys(inc).forEach(function (k) {
      const parts = k.split(',')
      m[Number(parts[0]) - 1][Number(parts[1]) - 1] = inc[k]
    })
    return m
  }

  foeCells() {
    const m = createMatrix(BOARD_SIZE, '')
    const mine = this.mine || {}
    Object.keys(mine).forEach(function (k) {
      const parts = k.split(',')
      m[Number(parts[0]) - 1][Number(parts[1]) - 1] = mine[k]
    })
    return m
  }

  disabledMap() {
    const map = {}
    Object.keys(this.mine || {}).forEach(function (k) { map[k] = true })
    return map
  }

  /* ---------------- 交互 ---------------- */

  onFoeCellTap(row, col) {
    if (!this.myTurn || this.finished) return
    this.selected = { row: row, col: col }
    this.focus = 'foe'
    this.layout()
  }

  onFire() {
    if (!this.selected) {
      this.app.toast('请先选择轰炸坐标')
      return
    }
    if (!this.myTurn || this.finished || this.firing) return

    const self = this
    const app = this.app
    const sel = this.selected
    this.firing = true
    api.fire({ roomId: this.roomId, row: sel.row, col: sel.col }).then(function (res) {
      self.firing = false
      self.selected = null
      self.layout()
      app.feedback(RESULT_TEXT[res.result] || '', 900)
    }).catch(function (e) {
      self.firing = false
      app.toast(e.message || '发射失败')
    })
  }

  onToggleEmote() {
    if (this.finished) return
    this.emoteBarOpen = !this.emoteBarOpen
    this.layout()
  }

  sendEmote(emoji) {
    const self = this
    this.emoteBarOpen = false
    this.layout()
    api.emote({ roomId: this.roomId, emoji: emoji }).catch(function (e) {
      console.warn('[battle] emote failed', e && e.message)
    })
  }

  showEmote(emote) {
    if (!emote || !emote.emoji) return
    const self = this
    const mine = emote.by === this.myOpenid
    if (this.emoteTimer) clearTimeout(this.emoteTimer)
    this.emoteBubble = { emoji: emote.emoji, mine: mine }
    this.emoteTimer = setTimeout(function () {
      self.emoteBubble = null
      self.emoteTimer = null
    }, EMOTE_HIDE_MS)
  }

  onSurrender() {
    if (this.finished) return
    const self = this
    dialog.confirm({
      title: '确认投降',
      content: '投降后本局将直接判定失败，确定吗？',
      confirmText: '确认投降',
      confirmColor: '#E24B4A',
      onOk: function () {
        api.surrender({ roomId: self.roomId }).catch(function (e) {
          self.app.toast(e.message || '操作失败')
        })
      }
    })
  }

  onInvite() {
    share.share({ title: '炸飞机 · 我正在跟人火拼，快来跟我打一局', query: '' })
  }

  recordRival(b) {
    if (!this.foeOpenid) return
    rivals.add({
      openid: this.foeOpenid,
      virtual: !api.isCloud,
      win: b.winner === this.myOpenid
    })
  }

  goResult(b) {
    const stats = (b.stats && b.stats[this.myOpenid]) || { kill: 0, lost: 0, shots: 0 }
    const incoming = (b.incoming && b.incoming[this.myOpenid]) || {}
    this.app.globalData.matchResult = {
      roomId: this.roomId,
      win: b.winner === this.myOpenid,
      endType: b.endType,
      myShots: stats.shots,
      foeShots: Object.keys(incoming).length,
      myDestroyed: stats.kill,
      foeDestroyed: stats.lost,
      planeCount: this.planeCount || 1
    }
    this.app.replace('result')
  }
}

module.exports = function (app) { return new Battle(app) }
