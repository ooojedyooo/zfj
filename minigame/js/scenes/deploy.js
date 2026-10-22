// minigame/js/scenes/deploy.js
// 布阵 —— 对应小程序 pages/deploy
//
// ============================================================================
// 【核心模型：编辑期宽松 · 提交期严格】
//
// 布阵时**不限制**玩家把飞机摆在什么位置。出界、压到别的飞机，都可以放下去，
// 只是那一架会被标红（半透明红机体 + 实色红机头 + 冲突格斜线）。
// 等玩家点「就绪」时统一校验一次：还有不合规的，明确告诉他是哪一架、为什么，
// 并且**不允许开始游戏**。
//
// 为什么不是「放不下就拒绝」：
//   布阵是**多架飞机互相让位**的过程，天然会死锁 ——
//   想把 A 挪到 B 的位置，得先挪 B；可 B 想去的地方又被 A 占着。
//   旧做法只剩一条路：先把 A 挪到一个"合法但没用"的位置，挪 B，再把 A 挪回来。
//   一次调整变成三次，而且中间那些位置玩家根本不想要。
//
//   允许临时非法 = 允许玩家**先拆后建**。这是所有能做复杂布局的工具
//   （Figma 的绝对定位、剪辑软件的时间轴）都采用的模型：编辑期宽松，导出时校验。
//
// 代价是「系统不再帮着找位置」，所以必须补三件事：
//   ① 合法性**随时可见**（红格 / 状态条徽标 / 就绪按钮变「先修正 N 架」）
//   ② 提交时**拦住**，并说清是哪一架、哪里不对
//   ③ 给一个**显式的**修复入口「自动整理」——玩家点了才动他的飞机，
//      而不是像以前那样拖一下就偷偷改朝向
//
// ============================================================================
// 【交互契约】不用按钮中转，手指直接作用在飞机上（直接操作）
//   点空白格  → 放一架（落点 = 机头）；若已有选中，先退出选中，不误放
//   点机头    → 选中这一架；已选中时再点一次 = 以机头为轴旋转 90°
//   点机体    → 同样选中（命中判定放宽，手指比格子粗）
//             → 重叠处再点一下 = 在叠着的几架之间轮换选中
//   按住机头拖 → 整架跟着走，松手就地落下（不问合不合法）
//   点状态条棋子 → 直接选中那一架
//
// 为什么「先选中再旋转」而不是「点一下直接转」：
//   拖拽的起手式就是按住机头，手指自然会先位移 3~8px。
//   若点一下就转，玩家每次想拖都会先把飞机转歪。选中态是这层安全垫。
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

/** 某个格位是否在棋盘之外（飞机允许部分探出棋盘，但机头必须在内） */
function outsideCell(c) {
  return c.row < 1 || c.row > BOARD_SIZE || c.col < 1 || c.col > BOARD_SIZE
}

class Deploy extends Scene {
  constructor(app) {
    super(app)
    this.placed = []
    this.planeCount = MIN_PLANES
    this.rotation = 0
    this.selected = -1      // 选中的飞机下标（-1 = 未选中）
    this.drag = null        // 拖拽中：{ idx, row, col, rotation, valid, reason, outside }
    this._press = null      // 按在机头起手：{ idx, grabRow, grabCol, baseRow, baseCol }
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

  /* ---------------- 合法性审计 ---------------- */

  /**
   * 全盘审计：谁出界了、谁压着谁了。
   *
   * 每次状态变动后即时算（最多 3 架 × 10 格，纯计算，比维护缓存 + 到处失效标记更省心）。
   *
   * @returns {{
   *   ok: boolean,
   *   items: Array<{idx, outside:number, overlap:boolean}>,   // 逐架的违规清单
   *   outside: number[],                                      // 每架出界格数
   *   conflict: Object                                        // 'r,c' → 该格确实叠了 ≥2 架
   * }}
   */
  audit() {
    const placed = this.placed
    const outside = []
    const owners = {}       // 'r,c' → [飞机下标]
    const overlap = {}

    for (let i = 0; i < placed.length; i++) {
      const cells = placed[i].cells
      let out = 0
      for (let k = 0; k < cells.length; k++) {
        const c = cells[k]
        if (outsideCell(c)) { out++; continue }
        const key = c.row + ',' + c.col
        const arr = owners[key]
        if (arr) {
          if (arr.indexOf(i) < 0) arr.push(i)
        } else {
          owners[key] = [i]
        }
      }
      outside.push(out)
    }

    const conflict = {}
    Object.keys(owners).forEach(function (key) {
      const arr = owners[key]
      if (arr.length < 2) return
      conflict[key] = true
      for (let i = 0; i < arr.length; i++) overlap[arr[i]] = true
    })

    const items = []
    for (let i = 0; i < placed.length; i++) {
      const out = outside[i]
      const ov = !!overlap[i]
      if (!out && !ov) continue
      items.push({ idx: i, outside: out, overlap: ov })
    }
    return {
      ok: items.length === 0,
      items: items,
      outside: outside,      // 每架出界格数
      overlap: overlap,      // { idx: true } 压到别人的那几架
      conflict: conflict     // 'r,c' → 这一格确实叠了 ≥2 架
    }
  }

  /** 单架的违规说明（合规则返回空串） */
  issueText(item) {
    const parts = []
    if (item.outside > 0) parts.push('有 ' + item.outside + ' 格超出棋盘')
    if (item.overlap) parts.push('压到别的飞机')
    return parts.join('，')
  }

  /** 某一架现在的违规说明（合规返回空串） */
  issueTextOf(idx) {
    const items = this.audit().items
    for (let i = 0; i < items.length; i++) {
      if (items[i].idx === idx) return this.issueText(items[i])
    }
    return ''
  }

  /** 还有几架不能开局（就绪按钮 / 顶部提示用） */
  pendingCount() {
    return this.audit().items.length
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
    const a = this.audit()
    this.placed.forEach(function (p, i) {
      // 出界 / 压到别人 → 这一架整体标「不合规」（画成半透明）。
      // 「整架」而不是「只标冲突的那几格」：玩家要判断的是「这一架能不能用」，
      // 逐格标会让人以为只有那几个格子有问题。
      const bad = a.outside[i] > 0 || !!a.overlap[i]
      const trimmed = a.outside[i] > 0
      p.cells.forEach(function (c) {
        // 出界的格直接不画。画在棋盘范围外会糊到倒计时、状态条上。
        if (outsideCell(c)) return
        m[c.row - 1][c.col - 1] = {
          s: c.isHead ? 'head' : 'plane',
          p: i,
          bad: bad,
          trimmed: trimmed,
          conflict: !!a.conflict[c.row + ',' + c.col]
        }
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
      p.cells.forEach(function (c) {
        if (outsideCell(c)) return
        out[c.row + ',' + c.col] = true
      })
    })
    return out
  }

  /**
   * 叠加层：选中描边 + 拖拽落点预览 + 原位置留痕
   *
   * 拖拽时**不改动 cells**，而是用 marks 叠一层——
   * 这样「原位置留痕 + 手指位置 + 松手会落到哪」能同屏看到。
   *
   * 注意：这里不再有「自动吸附候选」（hint）。
   * 松手落在手指处，不管是蓝框还是红框 —— 玩家自己决定，系统不挪。
   */
  marks() {
    const out = {}
    const put = function (cells, kind) {
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]
        if (outsideCell(c)) continue
        out[c.row + ',' + c.col] = kind
      }
    }

    if (this.drag) {
      const d = this.drag
      const p = this.placed[d.idx]
      if (!p) return out

      // ① 原位置留痕（真的挪开了才留；原地按着不留）
      if (d.row !== p.anchorRow || d.col !== p.anchorCol) put(p.cells, 'fade')

      // ② 手指位置：能放=蓝框，放不下=红框。两种都是「松手落这儿」
      put(getAbsoluteCells(p.planeId, d.row, d.col, d.rotation),
        d.valid ? 'ghostOk' : 'ghostBad')
      return out
    }

    // 选中：整架描边
    if (this.selected >= 0 && this.selected < this.placed.length) {
      put(this.placed[this.selected].cells, 'select')
    }
    return out
  }

  /** 拖拽中「为什么放不下」的说法（只说事实，不说失败） */
  dragReasonText(d) {
    if (d.outside > 0) return '有 ' + d.outside + ' 格超出棋盘'
    if (d.reason === 'overlap') return '会压到别的飞机'
    return '这里放不下'
  }

  /* ---------------- 绘制 ---------------- */

  render(ctx) {
    const u = this.u.bind(this)
    const L = this.layoutInfo
    const g = this.geo
    const c = theme.color
    const audit = this.audit()
    const pending = audit.items.length

    // 顶部提示：随进度 / 选中态 / 拖拽态 / 违规数变化，永远告诉玩家「现在能做什么」
    let tip
    if (this.waiting || this.readying) {
      tip = '等待对手就绪…'
    } else if (this.drag) {
      const d = this.drag
      if (d.valid) tip = '松手就把第 ' + (d.idx + 1) + ' 架放到这里'
      else tip = this.dragReasonText(d) + ' · 松手也先放这儿'
    } else if (this.selected >= 0) {
      tip = '第 ' + (this.selected + 1) + ' 架已选中 · 再点机头旋转'
    } else if (pending > 0) {
      tip = pending + ' 架位置不合规 · 点红格可调'
    } else if (this.placed.length >= this.planeCount) {
      tip = '已放满 ' + this.planeCount + ' 架 · 点「就绪」开始'
    } else {
      tip = '点棋盘放第 ' + (this.placed.length + 1) + ' / ' + this.planeCount + ' 架 · 落点即机头'
    }
    const tipBad = this.drag ? !this.drag.valid : (pending > 0 && this.selected < 0)
    draw.text(ctx, draw.ellipsis(ctx, tip, g.w - u(120), u(theme.size.small)), g.x, g.barY, {
      size: u(theme.size.small), color: tipBad ? c.danger : c.textMuted
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

    const items = audit.items
    const badOf = {}
    items.forEach(function (it) { badOf[it.idx] = true })

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
      // （槽位只有 72 设计单位，图标里的格太小印不下序号，序号只在棋盘机头格出现）
      const pal = theme.color.planePalette[i % theme.color.planePalette.length]
      const bad = !!badOf[i]
      planeIcon.render(ctx, s.x + u(4), s.y + u(4), s.w - u(8), {
        on: on,
        rotation: on ? this.placed[i].rotation : 0,
        // 槽位只有 72 设计单位，半透明的小图标看不出来，所以这里用实色红
        color: bad ? c.danger : pal.body,
        headColor: bad ? c.dangerDark : pal.head
      })

      // 违规徽标：棋盘上可能因为出界而看不全，这一格是「哪一架有问题」的可靠入口
      if (bad) {
        const bx = s.x + s.w - u(6)
        const by = s.y + u(6)
        draw.circle(ctx, bx, by, u(12), c.danger)
        draw.text(ctx, '!', bx, by + u(1), {
          size: u(17), weight: 700, color: '#FFFFFF',
          align: 'center', baseline: 'middle'
        })
      }
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

    // 第二行：操作说明（不做隐藏手势，全写在明处；有违规时换红字说清后果）
    let hint
    let hintColor = c.textMuted
    if (d) {
      if (d.valid) {
        hint = '松手放下 · 蓝框就是落点'
      } else {
        hint = this.dragReasonText(d) + ' · 松手先放这儿，回头再调'
        hintColor = c.danger
      }
    } else if (this.selected >= 0) {
      hint = '再点机头旋转 · 按住机头拖走'
    } else if (pending > 0) {
      hint = '红格放不下 · 拖到空处，或点「先修正」自动整理'
      hintColor = c.danger
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

    // 就绪按钮兼任「状态指示器」：有几架不合规，按钮自己就说出来（不用点才知道）
    Button.render(ctx, Object.assign({}, g.readyBtn, {
      label: pending > 0 ? '先修正 ' + pending + ' 架' : '就绪',
      kind: pending > 0 ? 'warn' : 'primary',
      loading: this.readying || this.waiting,
      loadingText: this.waiting ? '等待对手…' : '提交中…'
    }))

    if (this.waiting) {
      ui.spinner(ctx, L, L.W / 2, L.H * 0.5, u(36), this.phase * 3)
    }
  }

  /* ---------------- 棋盘交互 ---------------- */

  /**
   * 命中某格的所有飞机（重叠时可能 >1），**后放的排在前面**
   * 重叠格上「点一下换一个」就靠这个列表
   */
  planesAt(row, col) {
    const out = []
    for (let i = this.placed.length - 1; i >= 0; i--) {
      const p = this.placed[i]
      for (let k = 0; k < p.cells.length; k++) {
        if (p.cells[k].row === row && p.cells[k].col === col) {
          out.push({ idx: i, isHead: !!p.cells[k].isHead })
          break
        }
      }
    }
    return out
  }

  onBoardTap(row, col) {
    if (this.waiting || this.readying) return

    const hits = this.planesAt(row, col)

    if (hits.length) {
      let pick = hits[0]
      // 重叠处：再点一次轮到下一架。不然压在下面那架永远选不到 ——
      // 它被遮住、被标红，只能从状态条进去，等于把问题藏起来了。
      if (hits.length > 1) {
        let cur = -1
        for (let i = 0; i < hits.length; i++) {
          if (hits[i].idx === this.selected) { cur = i; break }
        }
        if (cur >= 0) pick = hits[(cur + 1) % hits.length]
      }
      // 已选中这一架 + 点的是机头 → 以机头为轴旋转
      if (pick.isHead && this.selected === pick.idx) {
        this.rotatePlane(pick.idx)
        return
      }
      // 否则选中它（点机体也算，手指比格子粗）
      this.selected = pick.idx
      this.rotation = this.placed[pick.idx].rotation
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

  /** 机头必须留在棋盘内（它是抓手，也是「以机头为轴旋转」的轴心） */
  clampHead(row, col) {
    return {
      row: Math.min(BOARD_SIZE, Math.max(1, row)),
      col: Math.min(BOARD_SIZE, Math.max(1, col))
    }
  }

  /**
   * 在 (row,col) 放一架。
   *
   * 与旧版的关键差别：**不再自动换位置 / 换朝向**。
   * 点哪儿就放哪儿，放不下就标红，玩家自己决定要不要立刻调。
   * （理由见文件头「编辑期宽松 · 提交期严格」）
   */
  placeAt(row, col) {
    const head = this.clampHead(row, col)
    const cells = getAbsoluteCells('standard', head.row, head.col, this.rotation)
    this.placed.push({
      planeId: 'standard',
      anchorRow: head.row,
      anchorCol: head.col,
      rotation: this.rotation,
      cells: cells
    })
    this.layout()              // 状态条多了一个可点的棋子

    const text = this.issueTextOf(this.placed.length - 1)
    if (text) this.app.toast('第 ' + this.placed.length + ' 架放不下 · 已标红')
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
    const hits = this.planesAt(cell.row, cell.col)
    let owner = null
    for (let i = 0; i < hits.length; i++) {
      if (hits[i].isHead) { owner = hits[i]; break }
    }
    if (!owner) return   // 机头是这架飞机的「抓手」

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
    } else if (pr.lastRow != null) {
      // 手指划出棋盘：保持上一个指向，划回来还能接住（不要一出手就清空预览）
      row = pr.lastRow
      col = pr.lastCol
    } else {
      return
    }

    // 机头夹在棋盘内：机身可以探出边界（会标红），但机头不能丢 ——
    // 机头一出界，这架飞机就既看不见也没法「以机头为轴旋转」了。
    const head = this.clampHead(row, col)
    row = head.row
    col = head.col
    pr.lastRow = row
    pr.lastCol = col
    pr.dragged = true

    const cells = getAbsoluteCells(p.planeId, row, col, p.rotation)
    const occupied = fit.occupiedExcept(this.placed, pr.idx)
    const reason = fit.checkAt(p.planeId, row, col, p.rotation, occupied)

    let outside = 0
    if (reason === 'out_of_board') {
      for (let i = 0; i < cells.length; i++) if (outsideCell(cells[i])) outside++
    }

    this.selected = -1   // 进入拖拽即退出选中（拖拽本身有更明确的视觉）
    this.drag = {
      idx: pr.idx,
      row: row,
      col: col,
      rotation: p.rotation,
      valid: !reason,
      reason: reason || '',
      outside: outside
    }
  }

  onTouchEnd(x, y) {
    if (!this.drag) { this._press = null; return }
    const d = this.drag
    const p = this.placed[d.idx]
    this.drag = null
    this._press = null
    if (!p) return

    if (d.row === p.anchorRow && d.col === p.anchorCol) return   // 手抖了一下又回原位，不打扰

    p.anchorRow = d.row
    p.anchorCol = d.col
    p.cells = getAbsoluteCells(p.planeId, d.row, d.col, p.rotation)

    const text = this.issueTextOf(d.idx)
    if (text) this.app.toast('第 ' + (d.idx + 1) + ' 架放不下 · 已标红')
    else this.app.toast('已移动第 ' + (d.idx + 1) + ' 架')
  }

  /* ---- 旋转 / 移除 ---- */

  /**
   * 以机头为轴顺时针旋转 90°。
   *
   * 转不动也照转 —— 转完压在别人身上或探出棋盘，就标红，玩家自己看着办。
   * 旧版那套「转不了就近挪一格再转」看着聪明，实际上是在玩家没要求的情况下
   * 改了他的位置，而且挪到哪儿还得靠猜。现在只有一条规则：**机头不动，转 90°**。
   */
  rotatePlane(idx) {
    const p = this.placed[idx]
    if (!p) return false
    const next = (p.rotation + 1) % 4
    p.rotation = next
    p.cells = getAbsoluteCells(p.planeId, p.anchorRow, p.anchorCol, next)
    this.rotation = next   // 下一架沿用当前朝向，连放多架同一方向更省事

    const text = this.issueTextOf(idx)
    this.app.toast('第 ' + (idx + 1) + ' 架朝向 ' + ROTATION_LABEL[next] + (text ? ' · 已标红' : ''))
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

  /** 操作栏中间按钮：有选中 = 移除这架；无选中 = 随机布阵 */
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

  /* ---------------- 就绪：提交期严格 ---------------- */

  onReady() {
    if (this.waiting || this.readying) return
    if (this.placed.length < MIN_PLANES) {
      this.app.toast('至少布置 1 架飞机')
      return
    }

    const a = this.audit()
    if (!a.ok) {
      this.blockStart(a)
      return
    }
    this.submit()
  }

  /**
   * 校验没过：说清哪一架、怎么不对，给出两条路（自动整理 / 自己改），
   * 并且**不提交**。同时把那架选中、拉进视野，玩家不用自己找。
   */
  blockStart(a) {
    const lines = a.items.map(function (it) {
      return '第 ' + (it.idx + 1) + ' 架' + this.issueText(it)
    }, this)

    this.selected = a.items[0].idx
    this.rotation = this.placed[this.selected].rotation
    this.layout()

    const self = this
    dialog.confirm({
      title: '还有 ' + a.items.length + ' 架要调整',
      content: lines.join('\n') + '\n\n「自动整理」会把它们挪到最近的空位，' +
        '也可以自己拖到空处。调好了才能开始。',
      confirmText: '自动整理',
      cancelText: '我自己改',
      onOk: function () { self.autoFix() }
    })
  }

  /**
   * 显式修复：把不合规的飞机挪到最近的合法位置。
   *
   * 这是 fit.findFit 现在唯一的用途 —— 从「系统偷偷替你改」变成
   * 「你点了才替你改」。差别不在算法，在于**谁做决定**。
   */
  autoFix() {
    const items = this.audit().items
    if (!items.length) return

    const bad = {}
    items.forEach(function (it) { bad[it.idx] = true })

    // 先把所有待修的飞机从占用集合里摘出去，否则它们会互相锁死：
    // A 想去 B 现在的位置，而 B 也等着挪，两个都搜不到空位。
    let occupied = []
    this.placed.forEach(function (p, i) {
      if (bad[i]) return
      p.cells.forEach(function (c) {
        if (!outsideCell(c)) occupied.push(c)
      })
    })

    let fixed = 0
    for (let n = 0; n < items.length; n++) {
      const idx = items[n].idx
      const p = this.placed[idx]
      const res = fit.findFit({
        planeId: p.planeId,
        anchorRow: p.anchorRow,
        anchorCol: p.anchorCol,
        rotation: p.rotation,
        occupied: occupied,
        allowMove: true,
        allowRotate: true,
        maxRadius: BOARD_SIZE,   // 由近到远搜，实际落点就是「最近的空位」
        prefer: 'move'
      })
      if (!res) continue
      p.anchorRow = res.anchorRow
      p.anchorCol = res.anchorCol
      p.rotation = res.rotation
      p.cells = res.cells
      fixed++
      occupied = occupied.concat(res.cells)
    }

    this.selected = -1
    this.layout()

    const left = this.audit().items.length
    if (left === 0) {
      this.app.toast(fixed ? '已整理 ' + fixed + ' 架 · 可以就绪了' : '已经没问题了')
      return
    }
    this.selected = this.audit().items[0].idx
    this.layout()
    this.app.toast('还有 ' + left + ' 架附近放不下 · 按住机头拖到空处')
  }

  /** 真正提交（此时已确认全部合规） */
  submit() {
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
