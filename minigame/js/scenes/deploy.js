// minigame/js/scenes/deploy.js
// 布阵 —— 对应小程序 pages/deploy
//
// 【交互契约】不用按钮中转，手指直接作用在飞机上（直接操作）
//   点空白格  → 放一架（落点 = 机头）；若已有选中，先退出选中，不误放
//   点机头    → 选中这一架；已选中时再点一次 = 以机头为轴旋转 90°
//   点机体    → 同样选中（命中判定放宽，手指比格子粗）
//   按住机头拖 → 整架跟着走，松手吸附到最近格
//   点状态条棋子 → 直接选中那一架
//
// 为什么「先选中再旋转」而不是「点一下直接转」：
//   拖拽的起手式就是按住机头，手指自然会先位移 3~8px。
//   若点一下就转，玩家每次想拖都会先把飞机转歪。选中态是这层安全垫。
//
// 【放不下怎么办】见 core/fit.js。总原则：合法路径零噪音，非法路径给去处。
//   拖拽 → 蓝框「松手落这里」（含自动吸附，最多挪 2 格，且不改朝向）
//   旋转 → 90° 不行就试 180°/270°，总会告诉你最后转成了哪个方向
//   放置 → 原地放不下就就近挪一格 / 换个朝向，并说明「已自动调整」
//   都不行 → 明确说「出界」还是「压到别的飞机」，并给出下一步动作
const Scene = require('./base')
const theme = require('../core/theme')
const draw = require('../core/draw')
const fit = require('../core/fit')
const Button = require('../widgets/button')
const Board = require('../widgets/board')
const planeIcon = require('../widgets/plane-icon')
const ui = require('../widgets/ui')
const dialog = require('../core/dialog')
const api = require('../shared/services/cloudApi')
const { getAbsoluteCells, randomDeploy } = require('../shared/utils/plane')
const { createMatrix } = require('../shared/utils/board')
const { BOARD_SIZE, MIN_PLANES, MAX_PLANES, TIMEOUT } = require('../shared/config/rules')

const ROTATION_LABEL = ['↑', '→', '↓', '←']

/** 拖拽时允许自动吸附的最大格数（超过这个距离就不硬塞，免得飞机莫名跳远） */
const SNAP_RADIUS = 2

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
      dim: this.dimMap(),
      selectable: !this.waiting && !this.readying
    }
  }

  cells() {
    const m = createMatrix(BOARD_SIZE, '')
    this.placed.forEach(function (p, i) {
      p.cells.forEach(function (c) {
        // 带上身份下标 p：
        //   ① 布阵时用它给每架上不同的色（theme.planePalette）
        //   ② 机头格里印出 1/2/3 序号 —— 颜色负责扫一眼，序号负责确认是哪一架
        m[c.row - 1][c.col - 1] = { s: c.isHead ? 'head' : 'plane', p: i }
      })
    })
    return m
  }

  /** 当前焦点之外的那几架 → 降饱和，让被选 / 被拖的那架跳出来 */
  dimMap() {
    const out = {}
    let focus = -1
    if (this.drag) focus = this.drag.idx
    else if (this.selected >= 0) focus = this.selected
    if (focus < 0 || focus >= this.placed.length) return out
    this.placed.forEach(function (p, i) {
      if (i === focus) return
      p.cells.forEach(function (c) { out[c.row + ',' + c.col] = true })
    })
    return out
  }

  /**
   * 叠加层：选中描边 + 拖拽预览 + 自动吸附候选
   *
   * 拖拽时**不改动 cells**，而是用 marks 叠一层——
   * 这样「原位置留痕 + 手指位置 + 将要落到哪」能同屏看到，
   * 玩家不用猜「松手会发生什么」。
   */
  marks() {
    const out = {}
    const put = function (cells, kind) {
      for (let i = 0; i < cells.length; i++) {
        out[cells[i].row + ',' + cells[i].col] = kind
      }
    }

    if (this.drag) {
      const d = this.drag
      const p = this.placed[d.idx]
      if (!p) return out

      // ① 原位置留痕（位置真的变了才留，原地按着不留）
      if (d.row !== p.anchorRow || d.col !== p.anchorCol || (d.fit && d.fit.moved)) {
        put(p.cells, 'fade')
      }

      if (d.valid) {
        // ② 手指位置就能放 → 实心预览，松手即落
        put(d.fit.cells, 'ghostOk')
      } else {
        // ③ 手指位置放不下 → 红框 + 斜线，并画出「其实会落到这儿」
        put(getAbsoluteCells(p.planeId, d.row, d.col, p.rotation), 'ghostBad')
        if (d.fit) put(d.fit.cells, 'hint')
      }
      return out
    }

    // 选中：整架描边
    if (this.selected >= 0 && this.selected < this.placed.length) {
      put(this.placed[this.selected].cells, 'select')
    }
    return out
  }

  /* ---------------- 绘制 ---------------- */

  render(ctx) {
    const u = this.u.bind(this)
    const L = this.layoutInfo
    const g = this.geo
    const c = theme.color

    // 顶部提示：随进度 / 选中态 / 拖拽态变化，永远告诉玩家「现在能做什么」
    let tip
    if (this.waiting || this.readying) {
      tip = '等待对手就绪…'
    } else if (this.drag) {
      const d = this.drag
      if (d.valid) tip = '松手就把第 ' + (d.idx + 1) + ' 架放到这里'
      else if (d.fit) tip = fit.describeReason(d.reason) + ' · 松手放到最近的空位'
      else tip = fit.describeReason(d.reason) + ' · 松手留在原位'
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
      const isDrag = !!this.drag && this.drag.idx === i
      if (isSel || isDrag) {
        draw.fillRect(ctx, s.x, s.y, s.w, s.h, c.primaryLight, u(theme.radius.md))
        draw.strokeRect(ctx, s.x, s.y, s.w, s.h, c.primary, u(theme.radius.md), 2)
      }
      // 状态条棋子用**和棋盘完全一致的身份色**：
      // 棋盘上第 3 架是紫的，这里第 3 个槽也是紫的，两者形成对应关系。
      // 这也是颜色系统的自解释图例——不用额外写「配色说明」。
      // （槽位只有 36px，图标里的格太小印不下序号，序号只在棋盘机头格里出现）
      const pal = theme.color.planePalette[i % theme.color.planePalette.length]
      planeIcon.render(ctx, s.x + u(4), s.y + u(4), s.w - u(8), {
        on: on,
        rotation: on ? this.placed[i].rotation : 0,
        color: pal.body,
        headColor: pal.head
      })
    }, this)

    // 第一行：数量 + 当前作用对象的朝向（拖拽时切到「正在移动第几架」）
    const d = this.drag
    let line1
    if (d && this.placed[d.idx]) {
      line1 = '移动第 ' + (d.idx + 1) + ' 架 · 朝 ' + ROTATION_LABEL[this.placed[d.idx].rotation]
    } else {
      const hasSel = this.selected >= 0 && this.selected < this.placed.length
      const rotLabel = hasSel ? this.placed[this.selected].rotation : this.rotation
      line1 = this.placed.length + ' / ' + this.planeCount + ' · 朝 ' + ROTATION_LABEL[rotLabel]
    }
    draw.text(ctx, draw.ellipsis(ctx, line1, g.x + g.w - g.statusTextX - u(24), u(theme.size.body), 500),
      g.statusTextX, g.statusSlots[0].y + u(22), {
        size: u(theme.size.body), weight: 500, color: c.text
      })

    // 第二行：操作说明（不做隐藏手势，全写在明处；非法时换红字说清后果）
    let hint
    let hintColor = c.textMuted
    if (d) {
      if (d.valid) {
        hint = '松手放下 · 蓝框就是落点'
      } else if (d.fit) {
        hint = '虚线框 = 会自动落到这里'
        hintColor = c.primary
      } else {
        hint = fit.describeReason(d.reason) + ' · 松手留在原位'
        hintColor = c.danger
      }
    } else if (this.selected >= 0) {
      hint = '再点机头旋转 · 按住机头拖走'
    } else if (this.placed.length >= this.planeCount) {
      hint = '点任意机头可选中调整'
    } else if (!this.placed.length) {
      hint = '点棋盘任意格放置 · 落点即机头'
    } else {
      hint = '点机头选中 · 按住机头拖拽'
    }
    draw.text(ctx, draw.ellipsis(ctx, hint, g.w - u(48), u(theme.size.tiny)),
      g.x + u(24), g.statusHintY, { size: u(theme.size.tiny), color: hintColor })

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
      this.app.toast('已放满 ' + this.planeCount + ' 架 · 点机头可选中调整')
      return
    }

    this.placeAt(row, col)
  }

  /**
   * 在 (row,col) 放一架。
   * 放不下时不直接拒绝，而是就近找一个能落的位置 / 朝向（理由见 core/fit.js）：
   * 玩家点的是「大概这儿」，差一格还要他重来一次，纯属浪费操作。
   */
  placeAt(row, col) {
    const occupied = fit.occupiedExcept(this.placed, -1)
    const reason = fit.checkAt('standard', row, col, this.rotation, occupied)

    if (!reason) {
      this.pushPlane(row, col, this.rotation)
      return
    }

    const near = fit.findFit({
      planeId: 'standard',
      anchorRow: row,
      anchorCol: col,
      rotation: this.rotation,
      occupied: occupied,
      allowMove: true,
      allowRotate: true,
      maxRadius: SNAP_RADIUS,
      prefer: 'move'
    })

    if (!near) {
      this.app.toast(fit.describeReason(reason) + ' · 换个位置试试')
      return
    }

    this.pushPlane(near.anchorRow, near.anchorCol, near.rotation)
    if (near.moved && near.turned) this.app.toast('这里放不下 · 已挪到最近的空位并转向')
    else if (near.moved) this.app.toast('这里放不下 · 已挪到最近的空位')
    else this.app.toast('这个方向放不下 · 已自动转为朝 ' + ROTATION_LABEL[near.rotation])
  }

  pushPlane(row, col, rotation) {
    const cells = getAbsoluteCells('standard', row, col, rotation)
    this.placed.push({
      planeId: 'standard',
      anchorRow: row,
      anchorCol: col,
      rotation: rotation,
      cells: cells
    })
    this.rotation = rotation   // 下一架沿用这个朝向，连放多架更省事
    this.layout()              // 状态条多了一个可点的棋子
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
    if (!owner || !owner.isHead) return   // 机头是这架飞机的「抓手」

    const p = this.placed[owner.idx]
    // 记下「按下时手指在哪一格 + 机头在哪一格」，后面用**增量**算落点。
    // 不能直接拿「手指当前所在格」当机头：玩家按住机头的下半格时，
    // 一开始就会让飞机往上跳一格，手感是「抓不稳」。
    this._press = {
      idx: owner.idx,
      grabRow: cell.row,
      grabCol: cell.col,
      baseRow: p.anchorRow,
      baseCol: p.anchorCol,
      lastRow: null,
      lastCol: null,
      dragged: false
    }
  }

  onTouchMove(x, y, dx, dy, moved) {
    const pr = this._press
    if (!pr) return
    if (!moved) return

    const p = this.placed[pr.idx]
    if (!p) { this._press = null; return }

    const cell = Board.cellAt(this.geo.board, x, y)
    let row
    let col
    if (cell) {
      row = pr.baseRow + (cell.row - pr.grabRow)
      col = pr.baseCol + (cell.col - pr.grabCol)
      pr.lastRow = row
      pr.lastCol = col
    } else if (pr.lastRow != null) {
      // 手指划出棋盘：保持上一个指向，划回来还能接住（不要一出手就清空预览）
      row = pr.lastRow
      col = pr.lastCol
    } else {
      return
    }
    pr.dragged = true

    const occupied = fit.occupiedExcept(this.placed, pr.idx)
    const reason = fit.checkAt(p.planeId, row, col, p.rotation, occupied)

    let snap
    if (!reason) {
      snap = {
        anchorRow: row,
        anchorCol: col,
        rotation: p.rotation,
        cells: getAbsoluteCells(p.planeId, row, col, p.rotation),
        dist: 0, moved: false, turned: false
      }
    } else {
      // 放不下 ≠ 卡住。在附近找最近的能落点，先把「会落到哪」画出来。
      // 但**不改朝向**：玩家表达的是「想挪到这儿」，没表达「想转」，
      // 自动转向会让摆好的朝向被系统动掉。转向只在他按旋转时才做。
      snap = fit.findFit({
        planeId: p.planeId,
        anchorRow: row,
        anchorCol: col,
        rotation: p.rotation,
        occupied: occupied,
        allowMove: true,
        allowRotate: false,
        maxRadius: SNAP_RADIUS,
        prefer: 'move'
      })
    }

    this.selected = -1   // 进入拖拽即退出选中（拖拽本身有更明确的视觉）
    this.drag = {
      idx: pr.idx,
      row: row,
      col: col,
      valid: !reason,
      reason: reason || '',
      fit: snap
    }
  }

  onTouchEnd(x, y) {
    if (!this.drag) { this._press = null; return }
    const d = this.drag
    const p = this.placed[d.idx]
    this.drag = null
    this._press = null
    if (!p) return

    const target = d.fit
    if (!target) {
      // 附近确实没地方 → 留在原位，并说清是撞到了还是出界了
      this.app.toast(fit.describeReason(d.reason) + ' · 已留在原位')
      return
    }
    if (target.anchorRow === p.anchorRow && target.anchorCol === p.anchorCol) {
      return   // 手抖了一下又回原位，不打扰
    }

    p.anchorRow = target.anchorRow
    p.anchorCol = target.anchorCol
    p.cells = target.cells
    this.app.toast(d.valid
      ? '已移动第 ' + (d.idx + 1) + ' 架'
      : fit.describeReason(d.reason) + ' · 已移到最近的空位')
  }

  /* ---- 旋转 / 移除 ---- */

  /**
   * 以机头为轴旋转。
   *
   * 【为什么不直接「转不了就拒绝」】
   *   贴边或被围住时按一下没反应，玩家会以为按钮坏了，只能反复按 —— 这才是真麻烦。
   *   所以按四级回退找一个能转的方案，并且**每次都明确告诉玩家最后转成了哪个方向**：
   *     ① 原地转 90°
   *     ② 转 90° 会撞 → 就近挪 1~2 格再转（保持「转 90°」的意图）
   *     ③ 90° 彻底不行 → 试 180° / 270°（方向会写进提示，不会静默转歪）
   *     ④ 四个方向都放不下 → 告诉他下一步该干什么（拖走）
   */
  rotatePlane(idx) {
    const p = this.placed[idx]
    if (!p) return false
    const occupied = fit.occupiedExcept(this.placed, idx)
    const target = (p.rotation + 1) % 4

    // ① 原地转 90°
    if (!fit.checkAt(p.planeId, p.anchorRow, p.anchorCol, target, occupied)) {
      this.applyRotation(idx, target, p.anchorRow, p.anchorCol)
      this.app.toast('第 ' + (idx + 1) + ' 架朝向 ' + ROTATION_LABEL[target])
      return true
    }

    // ② 转过去会撞 → 就近挪一格再转
    const near = fit.findFit({
      planeId: p.planeId,
      anchorRow: p.anchorRow,
      anchorCol: p.anchorCol,
      rotation: target,
      occupied: occupied,
      allowMove: true,
      allowRotate: false,
      maxRadius: SNAP_RADIUS,
      prefer: 'move'
    })
    if (near) {
      this.applyRotation(idx, target, near.anchorRow, near.anchorCol)
      this.app.toast('转过去放不下 · 已挪开 ' + (near.dist === 1 ? '一格' : near.dist + ' 格') + '再转')
      return true
    }

    // ③ 90° 彻底不行 → 试 180° / 270°（优先原地不动）
    const alt = fit.findFit({
      planeId: p.planeId,
      anchorRow: p.anchorRow,
      anchorCol: p.anchorCol,
      rotation: target,
      occupied: occupied,
      allowMove: true,
      allowRotate: true,
      maxRadius: SNAP_RADIUS,
      prefer: 'rotate'
    })
    if (alt) {
      this.applyRotation(idx, alt.rotation, alt.anchorRow, alt.anchorCol)
      this.app.toast('这个方向放不下 · 已转为朝 ' + ROTATION_LABEL[alt.rotation])
      return true
    }

    // ④ 四个方向都放不下：卡在角上或被包住了
    this.app.toast('四个方向都放不下 · 按住机头拖到空旷处')
    return false
  }

  applyRotation(idx, rotation, row, col) {
    const p = this.placed[idx]
    p.rotation = rotation
    p.anchorRow = row
    p.anchorCol = col
    p.cells = getAbsoluteCells(p.planeId, row, col, rotation)
    this.rotation = rotation   // 下一架沿用当前朝向，连放多架同一方向更省事
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
