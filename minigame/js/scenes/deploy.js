// minigame/js/scenes/deploy.js
// 布阵 —— 对应小程序 pages/deploy
//
// 【交互契约】不用按钮中转，手指直接作用在飞机上（直接操作）
//   点空白格  → 放一架（落点 = 机头）；若已有选中，先退出选中，不误放
//   点机头    → 选中这一架；已选中时再点一次 = 以机头为轴旋转 90°
//   点机体    → 同样选中（命中判定放宽，手指比格子粗）
//   按住机头拖 → 整架跟着走，松手吸附到最近格；非法位置红框且不落位
//   点状态条棋子 → 直接选中那一架
//
// 为什么「先选中再旋转」而不是「点一下直接转」：
//   拖拽的起手式就是按住机头，手指自然会先位移 3~8px。
//   若点一下就转，玩家每次想拖都会先把飞机转歪。选中态是这层安全垫。
const Scene = require('./base')
const theme = require('../core/theme')
const draw = require('../core/draw')
const Button = require('../widgets/button')
const Board = require('../widgets/board')
const planeIcon = require('../widgets/plane-icon')
const ui = require('../widgets/ui')
const dialog = require('../core/dialog')
const api = require('../shared/services/cloudApi')
const { getAbsoluteCells, validatePlacement, randomDeploy } = require('../shared/utils/plane')
const { createMatrix } = require('../shared/utils/board')
const { BOARD_SIZE, MIN_PLANES, MAX_PLANES, TIMEOUT } = require('../shared/config/rules')

const ROTATION_LABEL = ['↑', '→', '↓', '←']

class Deploy extends Scene {
  constructor(app) {
    super(app)
    this.placed = []
    this.planeCount = MIN_PLANES
    this.rotation = 0
    this.selected = -1      // 选中的飞机下标（-1 = 未选中）
    this.drag = null        // 拖拽中：{ idx, row, col, valid }
    this._press = null      // 按在机头起手：{ idx, x, y }
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
    this.planeCount = Math.min(MAX_PLANES, Math.max(MIN_PLANES, match.planeCount || MIN_PLANES))
    this.placed = []
    this.rotation = 0
    this.selected = -1
    this.drag = null
    this._press = null
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
    this.drag = null
    this._press = null
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
    const x = u(32)
    const w = L.W - u(64)
    const pad = u(14)

    g.x = x
    g.w = w
    g.pad = pad
    g.back = { x: u(24), y: L.safeTop + u(16), w: u(140), h: u(56) }
    g.barY = L.safeTop + u(100)

    const statusH = u(132)
    const opsH = u(96)
    const btnH = u(96)
    const bottomH = L.safeBottom + u(24) + btnH + u(20) + opsH + u(20) + statusH

    // 棋盘：先按宽度定，再按剩余高度收敛（宽度通常是瓶颈，格子越大越好点）
    const availH = L.H - (g.barY + u(52)) - u(30) - bottomH
    const byW = w - pad * 2
    const size = Math.max(u(270), Math.min(byW, availH))
    g.board = { x: x + (w - size) / 2, y: g.barY + u(52), size: size }

    g.statusY = g.board.y + size + pad * 2 + u(20)
    g.statusH = statusH

    // 状态条里的飞机棋子（本局几架就摆几个，点一下选中那一架）
    const slotSize = u(72)
    const slotGap = u(10)
    g.statusSlots = []
    for (let i = 0; i < this.planeCount; i++) {
      g.statusSlots.push({
        x: x + u(24) + i * (slotSize + slotGap),
        y: g.statusY + u(16),
        w: slotSize,
        h: slotSize
      })
    }
    g.statusTextX = x + u(24) + this.planeCount * slotSize +
      (this.planeCount - 1) * slotGap + u(20)
    g.statusHintY = g.statusY + statusH - u(24)

    // 只有已放置的棋子可点（点它 = 选中那一架）
    if (!this.waiting && !this.readying) {
      g.statusSlots.forEach(function (s, i) {
        if (i < this.placed.length) {
          this.zone(s.x, s.y, s.w, s.h, this.onPickSlot.bind(this, i))
        }
      }, this)
    }

    g.opsY = g.statusY + statusH + u(20)
    g.opsH = opsH
    const ops = Button.rowRects(x, g.opsY, w, opsH, u(16), 3)
    g.opRects = ops
    this.zone(ops[0].x, ops[0].y, ops[0].w, ops[0].h, this.onRotate.bind(this))
    this.zone(ops[1].x, ops[1].y, ops[1].w, ops[1].h, this.onSecondAction.bind(this))
    this.zone(ops[2].x, ops[2].y, ops[2].w, ops[2].h, this.onClear.bind(this))

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
      marks: this.marks(),
      selectable: !this.waiting && !this.readying
    }
  }

  cells() {
    const m = createMatrix(BOARD_SIZE, '')
    this.placed.forEach(function (p) {
      p.cells.forEach(function (c) {
        // 机头单独标出来，玩家才看得出这架飞机朝哪边（旋转/推演都靠它）
        m[c.row - 1][c.col - 1] = c.isHead ? 'head' : 'plane'
      })
    })
    return m
  }

  /**
   * 叠加层：选中描边 + 拖拽预览
   * 拖拽时**不改动 cells**，而是用 marks 叠一层半透明预览——
   * 这样「原位置留痕 + 目标位置预览」能同屏看到，玩家知道飞机从哪来、要落到哪。
   */
  marks() {
    const out = {}

    // 选中：整架描边
    if (this.selected >= 0 && this.selected < this.placed.length && !this.drag) {
      this.placed[this.selected].cells.forEach(function (c) {
        out[c.row + ',' + c.col] = 'select'
      })
    }

    // 拖拽
    if (this.drag) {
      const p = this.placed[this.drag.idx]
      if (p) {
        const moved = this.drag.row !== p.anchorRow || this.drag.col !== p.anchorCol
        if (moved) {
          p.cells.forEach(function (c) {
            if (!out[c.row + ',' + c.col]) out[c.row + ',' + c.col] = 'fade'
          })
        }
        const ghost = getAbsoluteCells(p.planeId, this.drag.row, this.drag.col, p.rotation)
        const kind = this.drag.valid ? 'ghostOk' : 'ghostBad'
        ghost.forEach(function (c) {
          out[c.row + ',' + c.col] = kind
        })
      }
    }
    return out
  }

  /* ---------------- 绘制 ---------------- */

  render(ctx) {
    const u = this.u.bind(this)
    const L = this.layoutInfo
    const g = this.geo
    const c = theme.color

    // 顶部提示：随进度 / 选中态变化，永远告诉玩家「现在能做什么」
    let tip
    if (this.waiting || this.readying) {
      tip = '等待对手就绪…'
    } else if (this.selected >= 0) {
      tip = '第 ' + (this.selected + 1) + ' 架已选中 · 再点机头旋转'
    } else if (this.placed.length >= this.planeCount) {
      tip = '已放满 ' + this.planeCount + ' 架 · 点「就绪」开始'
    } else {
      tip = '点棋盘放第 ' + (this.placed.length + 1) + ' / ' + this.planeCount + ' 架 · 落点即机头'
    }
    draw.text(ctx, draw.ellipsis(ctx, tip, g.w - u(120), u(theme.size.small)), g.x, g.barY, {
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

    /* ---- 状态条 ---- */
    const st = { x: g.x, y: g.statusY, w: g.w, h: g.statusH }
    ui.card(ctx, L, st.x, st.y, st.w, st.h)

    g.statusSlots.forEach(function (s, i) {
      const on = i < this.placed.length
      const isSel = this.selected === i
      if (isSel) {
        draw.fillRect(ctx, s.x, s.y, s.w, s.h, c.primaryLight, u(theme.radius.md))
        draw.strokeRect(ctx, s.x, s.y, s.w, s.h, c.primary, u(theme.radius.md), 2)
      }
      planeIcon.render(ctx, s.x + u(4), s.y + u(4), s.w - u(8), {
        on: on,
        rotation: on ? this.placed[i].rotation : 0
      })
    }, this)

    // 第一行：已放数量 + 当前作用对象的朝向（短，避免撞上棋子）
    const hasSel = this.selected >= 0 && this.selected < this.placed.length
    const rotLabel = hasSel ? this.placed[this.selected].rotation : this.rotation
    const line1 = this.placed.length + ' / ' + this.planeCount + ' · 朝 ' + ROTATION_LABEL[rotLabel]
    draw.text(ctx, draw.ellipsis(ctx, line1, g.x + g.w - g.statusTextX - u(24), u(theme.size.body), 500),
      g.statusTextX, g.statusSlots[0].y + u(22), {
        size: u(theme.size.body), weight: 500, color: c.text
      })

    // 第二行：操作说明（不做隐藏手势，全写在明处）
    const hint = this.selected >= 0
      ? '再点机头旋转 · 按住机头拖走'
      : '点机头选中 · 按住机头拖拽'
    draw.text(ctx, hint, g.x + u(24), g.statusHintY, {
      size: u(theme.size.tiny), color: c.textMuted
    })

    /* ---- 操作栏 ---- */
    const hasSel2 = this.selected >= 0
    const labels = ['旋转', hasSel2 ? '移除这架' : '随机布阵', '清空']
    const kinds = ['outline', hasSel2 ? 'danger' : 'outline', 'outline']
    const disabled = this.waiting || this.readying
    g.opRects.forEach(function (r, i) {
      Button.render(ctx, {
        x: r.x, y: r.y, w: r.w, h: r.h,
        label: labels[i], kind: kinds[i], disabled: disabled
      })
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

  /** 命中某格属于哪一架（从后往前找，后放的优先） */
  findPlaneAt(row, col) {
    for (let i = this.placed.length - 1; i >= 0; i--) {
      const p = this.placed[i]
      for (let k = 0; k < p.cells.length; k++) {
        if (p.cells[k].row === row && p.cells[k].col === col) {
          return { idx: i, isHead: !!p.cells[k].isHead }
        }
      }
    }
    return null
  }

  onBoardTap(row, col) {
    if (this.waiting || this.readying) return

    const owner = this.findPlaneAt(row, col)

    if (owner) {
      // 已选中这一架 + 点的是机头 → 以机头为轴旋转
      if (owner.isHead && this.selected === owner.idx) {
        this.rotatePlane(owner.idx)
        return
      }
      // 否则选中它（点机体也算，手指比格子粗）
      this.selected = owner.idx
      this.rotation = this.placed[owner.idx].rotation
      return
    }

    // 点空白：选中态下先退出选中，不误放
    if (this.selected >= 0) {
      this.selected = -1
      return
    }

    if (this.placed.length >= this.planeCount) {
      this.app.toast('已放满 ' + this.planeCount + ' 架，点「就绪」开始对局')
      return
    }

    const cells = getAbsoluteCells('standard', row, col, this.rotation)
    const others = []
    this.placed.forEach(function (q) { others.push.apply(others, q.cells) })
    const check = validatePlacement(cells, others)

    if (!check.ok) {
      this.app.toast(check.reason === 'overlap' ? '这里与已有飞机重叠' : '这里放不下，会超出棋盘')
      return
    }
    this.placed.push({
      planeId: 'standard',
      anchorRow: row,
      anchorCol: col,
      rotation: this.rotation,
      cells: cells
    })
    this.layout()   // 状态条多了可点的棋子
    this.app.toast('已放置第 ' + this.placed.length + ' 架')
  }

  /** 点状态条里的飞机棋子 → 选中那一架 */
  onPickSlot(idx) {
    if (this.waiting || this.readying) return
    this.selected = (this.selected === idx) ? -1 : idx
    if (this.selected >= 0) this.rotation = this.placed[idx].rotation
  }

  /* ---- 拖拽移动（按住机头） ---- */

  onTouchStart(x, y) {
    this._press = null
    if (this.waiting || this.readying || this.drag) return
    const cell = Board.cellAt(this.geo.board, x, y)
    if (!cell) return
    const owner = this.findPlaneAt(cell.row, cell.col)
    // 只有按在机头上才进入拖拽候选：机头是这架飞机的「抓手」
    if (owner && owner.isHead) {
      this._press = { idx: owner.idx, x: x, y: y }
    }
  }

  onTouchMove(x, y, dx, dy, moved) {
    if (!this._press) return
    if (!moved) return

    const idx = this._press.idx
    const p = this.placed[idx]
    if (!p) { this._press = null; return }

    const cell = Board.cellAt(this.geo.board, x, y)
    // 手指划出棋盘时保持上一个合法落点，划回来还能接住
    const row = cell ? cell.row : (this.drag ? this.drag.row : p.anchorRow)
    const col = cell ? cell.col : (this.drag ? this.drag.col : p.anchorCol)

    const cells = getAbsoluteCells(p.planeId, row, col, p.rotation)
    const others = []
    this.placed.forEach(function (q, i) { if (i !== idx) others.push.apply(others, q.cells) })
    const check = validatePlacement(cells, others)

    this.selected = -1   // 进入拖拽即退出选中（拖拽本身有更明确的视觉）
    this.drag = { idx: idx, row: row, col: col, valid: check.ok }
  }

  onTouchEnd(x, y) {
    if (!this.drag) { this._press = null; return }
    const d = this.drag
    const p = this.placed[d.idx]
    this.drag = null
    this._press = null
    if (!p) return

    if (!d.valid) {
      this.app.toast('这里放不下，飞机留在原位')
      return
    }
    if (d.row === p.anchorRow && d.col === p.anchorCol) return

    p.anchorRow = d.row
    p.anchorCol = d.col
    p.cells = getAbsoluteCells(p.planeId, d.row, d.col, p.rotation)
    this.app.toast('已移动 · 机头在 第 ' + d.row + ' 行 第 ' + d.col + ' 列')
  }

  /* ---- 旋转 / 移除 ---- */

  /** 以机头为轴顺时针旋转 90°；非法（压到别的飞机 / 出界）则拒绝并说明原因 */
  rotatePlane(idx) {
    const p = this.placed[idx]
    if (!p) return false
    const rot = (p.rotation + 1) % 4
    const cells = getAbsoluteCells(p.planeId, p.anchorRow, p.anchorCol, rot)
    const others = []
    this.placed.forEach(function (q, i) { if (i !== idx) others.push.apply(others, q.cells) })

    const check = validatePlacement(cells, others)
    if (!check.ok) {
      this.app.toast(check.reason === 'overlap' ? '转过去会压到别的飞机' : '转过去会超出棋盘')
      return false
    }
    p.rotation = rot
    p.cells = cells
    this.rotation = rot   // 下一架沿用当前朝向，连放多架同一方向更省事
    this.app.toast('第 ' + (idx + 1) + ' 架朝向 ' + ROTATION_LABEL[rot])
    return true
  }

  /** 操作栏「旋转」：有选中转选中的，否则转最近一架，都没有则切待放朝向 */
  onRotate() {
    if (this.waiting || this.readying) return
    if (this.selected >= 0) {
      this.rotatePlane(this.selected)
      return
    }
    if (!this.placed.length) {
      this.rotation = (this.rotation + 1) % 4
      this.app.toast('下一架朝向：' + ROTATION_LABEL[this.rotation])
      return
    }
    this.rotatePlane(this.placed.length - 1)
  }

  onRemoveSelected() {
    if (this.selected < 0) return
    const n = this.selected + 1
    this.placed.splice(this.selected, 1)
    this.selected = -1
    this.layout()
    this.app.toast('已移除第 ' + n + ' 架')
  }

  /** 操作栏中间按钮：无选中 = 随机布阵；有选中 = 移除这架（危险操作要显式表态） */
  onSecondAction() {
    if (this.waiting || this.readying) return
    if (this.selected >= 0) return this.onRemoveSelected()
    this.onRandom()
  }

  onRandom() {
    if (this.waiting) return
    this.placed = randomDeploy(this.planeCount, 'standard', BOARD_SIZE)
    this.selected = -1
    this.drag = null
    this.layout()
    this.app.toast('已随机布阵')
  }

  onClear() {
    if (this.waiting) return
    this.placed = []
    this.selected = -1
    this.drag = null
    this.layout()
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
    this.selected = -1
    this.drag = null
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
