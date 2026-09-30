// minigame/js/scenes/deploy.js
// 布阵 —— 对应小程序 pages/deploy
// 点棋盘放飞机（锚点=机头），旋转换朝向，一键随机；就绪后提交到服务端二次校验
const Scene = require('./base')
const theme = require('../core/theme')
const draw = require('../core/draw')
const Button = require('../widgets/button')
const Board = require('../widgets/board')
const ui = require('../widgets/ui')
const dialog = require('../core/dialog')
const api = require('../shared/services/cloudApi')
const { getAbsoluteCells, validatePlacement, randomDeploy } = require('../shared/utils/plane')
const { createMatrix } = require('../shared/utils/board')
const { BOARD_SIZE, MIN_PLANES, TIMEOUT } = require('../shared/config/rules')

const ROTATION_LABEL = ['↑', '→', '↓', '←']

class Deploy extends Scene {
  constructor(app) {
    super(app)
    this.placed = []
    this.planeCount = MIN_PLANES
    this.rotation = 0
    this.countdown = TIMEOUT.DEPLOY
    this.readying = false
    this.waiting = false
    this.roomId = ''
    this.phase = 0
    this.timer = null
    this.watcher = null
  }

  onEnter() {
    const match = this.app.globalData.match || {}
    this.roomId = match.roomId || ''
    this.planeCount = match.planeCount || MIN_PLANES
    this.placed = []
    this.rotation = 0
    this.countdown = TIMEOUT.DEPLOY
    this.readying = false
    this.waiting = false
    this.phase = 0
    this.layout()
    this.startCountdown()
  }

  onExit() {
    this.stopCountdown()
    this.stopWatch()
  }

  update(dt) {
    if (this.waiting) this.phase += dt / 1000
  }

  /* ---------------- 布局 ---------------- */

  layout() {
    this.zones = []
    const u = this.u.bind(this)
    const L = this.layoutInfo
    const g = this.geo = {}
    const x = u(40)
    const w = L.W - u(80)
    const pad = u(14)

    g.x = x
    g.w = w
    g.back = { x: u(24), y: L.safeTop + u(16), w: u(140), h: u(56) }
    g.barY = L.safeTop + u(100)

    // 棋盘：先按宽度定，再按剩余高度收敛
    const bottomH = L.safeBottom + u(24) + u(92) + u(20) + u(72) + u(24) + u(150)
    const availH = L.H - g.barY - u(40) - bottomH
    const byW = w - pad * 2
    const size = Math.max(u(300), Math.min(byW, availH))
    g.board = { x: x + (w - size) / 2, y: g.barY + u(44), size: size }

    let y = g.board.y + size + pad * 2 + u(28)
    g.cardY = y
    g.cardH = u(150)

    y += g.cardH + u(24)
    g.opsY = y
    g.opsH = u(72)
    const ops = Button.rowRects(x, g.opsY, w, g.opsH, u(16), 3)
    g.opRects = ops
    this.zone(ops[0].x, ops[0].y, ops[0].w, ops[0].h, this.onRotate.bind(this))
    this.zone(ops[1].x, ops[1].y, ops[1].w, ops[1].h, this.onRandom.bind(this))
    this.zone(ops[2].x, ops[2].y, ops[2].w, ops[2].h, this.onClear.bind(this))

    const btnH = u(92)
    g.readyBtn = { x: x, y: L.H - L.safeBottom - u(24) - btnH, w: w, h: btnH }
    this.zone(x, g.readyBtn.y, w, btnH, this.onReady.bind(this))

    // 棋盘格（仅就绪前可点）
    if (!this.waiting && !this.readying) {
      Board.layout(this, this.boardOpts(), this.onBoardTap.bind(this))
    }

    if (!this.waiting) {
      this.zone(g.back.x, g.back.y, g.back.w, g.back.h, this.onBack.bind(this))
    }
  }

  boardOpts() {
    const g = this.geo
    return {
      x: g.board.x,
      y: g.board.y,
      size: g.board.size,
      cells: this.cells(),
      selectable: !this.waiting && !this.readying
    }
  }

  cells() {
    const m = createMatrix(BOARD_SIZE, '')
    this.placed.forEach(function (p) {
      p.cells.forEach(function (c) {
        m[c.row - 1][c.col - 1] = 'plane'
      })
    })
    return m
  }

  /* ---------------- 绘制 ---------------- */

  render(ctx) {
    const u = this.u.bind(this)
    const L = this.layoutInfo
    const g = this.geo
    const c = theme.color

    draw.text(ctx, '点击棋盘放置飞机 · 锚点为机头', g.x, g.barY, {
      size: u(theme.size.small), color: c.textMuted
    })
    const urgent = this.countdown <= 10
    draw.text(ctx, this.countdown + 's', g.x + g.w, g.barY, {
      size: u(theme.size.h3), weight: 500, align: 'right',
      color: urgent ? c.danger : c.primary
    })

    if (!this.waiting) {
      draw.fillRect(ctx, g.back.x, g.back.y, g.back.w, g.back.h, c.gray, u(theme.radius.pill))
      draw.text(ctx, '‹ 返回', g.back.x + g.back.w / 2, g.back.y + g.back.h / 2, {
        size: u(theme.size.small), color: c.text, align: 'center'
      })
    }

    Board.render(ctx, this.boardOpts(), u)

    // 信息卡
    const card = { x: g.x, y: g.cardY, w: g.w, h: g.cardH }
    draw.fillRect(ctx, card.x, card.y, card.w, card.h, c.card, u(theme.radius.lg))
    draw.strokeRect(ctx, card.x, card.y, card.w, card.h, c.border, u(theme.radius.lg), 1)
    draw.text(ctx, '飞机数量', card.x + u(28), card.y + u(52), { size: u(theme.size.body), color: c.text })
    draw.text(ctx, this.placed.length + ' / ' + this.planeCount, card.x + card.w - u(28), card.y + u(52), {
      size: u(theme.size.body), color: c.text, weight: 500, align: 'right'
    })
    draw.line(ctx, card.x + u(28), card.y + u(84), card.x + card.w - u(28), card.y + u(84), c.border, 1)
    draw.text(ctx, '当前朝向', card.x + u(28), card.y + u(116), { size: u(theme.size.body), color: c.text })
    draw.text(ctx, ROTATION_LABEL[this.rotation], card.x + card.w - u(28), card.y + u(116), {
      size: u(theme.size.h3), color: c.primaryDark, weight: 500, align: 'right'
    })

    const labels = ['旋转', '随机布阵', '清空']
    const disabled = this.waiting || this.readying
    g.opRects.forEach(function (r, i) {
      Button.render(ctx, { x: r.x, y: r.y, w: r.w, h: r.h, label: labels[i], kind: 'outline', disabled: disabled })
    })

    Button.render(ctx, Object.assign({}, g.readyBtn, {
      label: '就绪',
      kind: 'primary',
      loading: this.readying || this.waiting,
      loadingText: this.waiting ? '等待对手…' : '提交中…'
    }))

    if (this.waiting) {
      ui.spinner(ctx, L, L.W / 2, L.H * 0.5, u(36), this.phase * 3)
    }
  }

  /* ---------------- 棋盘交互 ---------------- */

  onBoardTap(row, col) {
    if (this.placed.length >= this.planeCount) {
      this.app.toast('飞机已全部放置')
      return
    }
    const cells = getAbsoluteCells('standard', row, col, this.rotation)
    const occupied = this.placed.reduce(function (acc, p) { return acc.concat(p.cells) }, [])
    const check = validatePlacement(cells, occupied)

    if (!check.ok) {
      this.app.toast(check.reason === 'overlap' ? '与其他飞机重叠' : '超出棋盘边界')
      return
    }
    this.placed.push({
      planeId: 'standard',
      anchorRow: row,
      anchorCol: col,
      rotation: this.rotation,
      cells: cells
    })
  }

  onRotate() {
    if (this.waiting) return
    this.rotation = (this.rotation + 1) % 4
  }

  onRandom() {
    if (this.waiting) return
    this.placed = randomDeploy(this.planeCount, 'standard', BOARD_SIZE)
  }

  onClear() {
    if (this.waiting) return
    this.placed = []
  }

  /* ---------------- 倒计时（T-03） ---------------- */

  startCountdown() {
    const self = this
    this.stopCountdown()
    this.timer = setInterval(function () {
      if (self.waiting || self.readying) return
      self.countdown -= 1
      if (self.countdown <= 0) {
        self.stopCountdown()
        self.onRandom()
        self.app.toast('布阵超时，已自动布置')
        setTimeout(function () { self.onReady() }, 500)
      }
    }, 1000)
  }

  stopCountdown() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  onBack() {
    dialog.confirm({
      title: '退出布阵',
      content: '离开后本局将视为放弃，确定吗？',
      confirmText: '退出',
      confirmColor: '#E24B4A',
      onOk: function () {
        const self = this
        self.app.globalData.match = null
        self.app.back()
      }.bind(this)
    })
  }

  /* ---------------- 就绪 ---------------- */

  onReady() {
    if (this.placed.length < MIN_PLANES) {
      this.app.toast('至少布置 1 架飞机')
      return
    }
    if (this.readying || this.waiting) return

    const app = this.app
    const self = this
    this.stopCountdown()
    this.readying = true
    this.layout()

    const planes = this.placed.map(function (p) {
      return { planeId: p.planeId, anchorRow: p.anchorRow, anchorCol: p.anchorCol, rotation: p.rotation }
    })

    api.deploy({ roomId: this.roomId, planes: planes }).then(function (res) {
      self.readying = false
      if (res.allReady) {
        app.replace('battle')
      } else {
        self.waiting = true
        self.layout()
        self.watchStart()
      }
    }).catch(function (e) {
      self.readying = false
      self.layout()
      app.toast(e.message || '提交失败')
      self.startCountdown()
    })
  }

  watchStart() {
    const self = this
    this.stopWatch()
    this.watcher = api.watchRoom(this.roomId, function (room) {
      if (room && room.status === 'battle') {
        self.stopWatch()
        self.app.replace('battle')
      }
    })
  }

  stopWatch() {
    if (this.watcher) {
      try { this.watcher.close() } catch (e) { /* ignore */ }
      this.watcher = null
    }
  }
}

module.exports = function (app) { return new Deploy(app) }
