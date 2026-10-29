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
// 【本页同时决定「打几架」】
//
// 房间页不再有「飞机数量」这一项 —— 玩家在那儿没法判断 1 架和 3 架打起来
// 有什么差别，只能凭数字瞎选，进了棋盘还得再核对一次「我选的是 3 架吧」。
// 数量现在是**棋盘上真的有几架**，只有一处说法。
//
// 所以状态条的三个槽各代表一架的名额，三种状态：
//   未加入（none）→ 灰底 + 「+」：点它 = 往棋盘上添一架
//   收起  （off） → 虚线框     ：点它 = 回到收起前的位置和朝向
//   在场上（out） → 身份色     ：点它 = 选中这一架
//
// 「添一架」落在哪由系统给（离中心最近的空位），因为玩家此刻还没表达位置意图；
// 落好之后立刻选中，按住机头就能拖走。**谁做决定**这条线没破：
// 系统只在这个动作里替玩家选了初始位置，之后的每次移动都是玩家自己拖的。
// ============================================================================
// 【交互契约】不用按钮中转，手指直接作用在飞机上（直接操作）
//   点空白格  → 添一架（落点 = 机头）；若已有选中，先退出选中，不误放
//   点机头    → 选中这一架；已选中时再点一次 = 以机头为轴旋转 90°
//   点机体    → 同样选中（命中判定放宽，手指比格子粗）
//             → 重叠处再点一下 = 在叠着的几架之间轮换选中（见下「重叠」）
//   按住机头拖 → 整架跟着走，松手就地落下（不问合不合法）
//   点状态条棋子 → 未加入=添一架 / 收起=回原位 / 在场上=选中
//
// 为什么「先选中再旋转」而不是「点一下直接转」：
//   拖拽的起手式就是按住机头，手指自然会先位移 3~8px。
//   若点一下就转，玩家每次想拖都会先把飞机转歪。选中态是这层安全垫。
//
// ============================================================================
// 【重叠：怎么知道现在选的是哪一架】
//
// 机头重合时，两架飞机的抓手、旋转轴、描边全在同一个像素上，
// 画面上唯一的差别就是机头牌里的那个数字。所以三件事必须同时成立：
//
//   ① **看得出这格不止一架**：机头牌从「色块 + 白字」反转成「白底 + 红字」。
//      同一套颜色换正负关系，不用加角标，扫一眼就不一样。
//   ② **牌上是「当前选中那架」的编号**，点一下切换它就变（★ 这是唯一的信号）
//   ③ **点按只切换、不旋转**：重叠态下旋转结果不可预期（转完可能还叠着），
//      而且轮换和旋转抢同一个手势，必然有一个永远触发不了。
//      要转就点操作栏的「旋转」，那里没有歧义。
//
// 拖动同理：**优先抓当前选中的那架**。否则永远只能抓住后放的那架，
// 先放的怎么拖都拖不动 —— 而重叠恰恰是最需要拖开的时刻。
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
const { BOARD_SIZE, MIN_PLANES, TIMEOUT } = require('../shared/config/rules')
const { clampPlaneCount } = require('../shared/utils/room')

const ROTATION_LABEL = ['↑', '→', '↓', '←']

/** 槽位状态：这个名额上的飞机现在是「还没加入 / 收起来了 / 在场上」 */
const SLOT = { NONE: 'none', OFF: 'off', OUT: 'out' }

/** 在场上的那一架（唯一会被画到棋盘、参与审计、参与提交的状态） */
function isOut(p) {
  return !!(p && p.state === SLOT.OUT)
}

/**
 * 名额数组，长度 = **本局要打的架数**（房主开房时定死，1~3 架）。
 *
 * 不这一层固定长度的代价是：数组下标会被当成编号，删掉中间一架后面全部塌位，
 * 身份色和机头序号跟着变（紫变青、3 变 2），玩家会以为系统换了他的飞机。
 * 固定长度之后，下标 ≡ 槽位 ≡ 编号，三件事永远是同一件。
 */
function createSlots(count) {
  const n = clampPlaneCount(count)
  const out = []
  for (let i = 0; i < n; i++) {
    out.push({
      slot: i,
      planeId: 'standard',
      state: SLOT.NONE,
      anchorRow: 0,
      anchorCol: 0,
      rotation: 0,
      cells: []
    })
  }
  return out
}

/** 某个格位是否在棋盘之外（飞机允许部分探出棋盘，但机头必须在内） */
function outsideCell(c) {
  return c.row < 1 || c.row > BOARD_SIZE || c.col < 1 || c.col > BOARD_SIZE
}

/** 取一架飞机的机头格（cells 里 isHead 为真的那个） */
function headCellOf(p) {
  if (!p) return null
  for (let i = 0; i < p.cells.length; i++) {
    if (p.cells[i].isHead) return p.cells[i]
  }
  return null
}

class Deploy extends Scene {
  constructor(app) {
    super(app)
    this.slotCount = MIN_PLANES   // 本局要打几架（房间定的），onEnter 里接管
    this.placed = createSlots(MIN_PLANES)
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
    // 架数由房主开房时定死，布阵页只负责「摆成那个样子」。
    // 拿不到就按 1 架兜底 —— 至少能就绪，不会卡在自相矛盾的状态里。
    this.slotCount = clampPlaneCount(match.planeCount)
    this.placed = createSlots(this.slotCount)
    this.rotation = 0
    this.selected = -1
    this.drag = null
    this._press = null
    this.countdown = TIMEOUT.DEPLOY
    this.readying = false
    this.waiting = false
    this.phase = 0
    this.autoFill()
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
      // 未加入 / 收起的飞机不在场上，不参与出界 / 重叠判定
      if (!isOut(placed[i])) { outside.push(0); continue }
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

  /* ---------------- 收起（临时离场） ----------------
   *
   * 「移除这架」原本是把数组元素 splice 掉 —— 位置和朝向一起没了，
   * 再放要重新拖一次。但玩家点它的心态几乎都不是「这一局不要这架了」，
   * 而是「先把它拿开，腾地方摆别的，一会儿再放回来」。
   *
   * 所以改成**收起**：`state = 'off'` 表示暂时不在场上，
   *   位置 / 朝向 / 编号 / 身份色全部原样留着，再点一下就从原位展开。
   *
   * 用状态标记而不是从数组里删，是为了让**下标永远等于编号**。
   * 一旦 splice，第 3 架会塌成第 2 架，颜色和机头序号跟着变 ——
   * 玩家会以为系统把他的飞机换了。
   *
   * 合并了数量选择之后，「收起」还多了一层含义：**收起来就等于本局不用它**。
   * 所以就绪时不再拦「还有架没放」（那不是错误，是玩家的选择）。
   */

  /** 真正在场上（state === 'out'）的飞机 —— 架数、审计、提交都只认它 */
  activePlaced() {
    return this.placed.filter(isOut)
  }

  /** 在场上几架 = 本局打几架 */
  activeCount() {
    return this.activePlaced().length
  }

  /** 收起着、但位置还记着的架数 */
  offCount() {
    let n = 0
    for (let i = 0; i < this.placed.length; i++) {
      if (this.placed[i].state === SLOT.OFF) n++
    }
    return n
  }

  /** 从未加入过的名额数 */
  noneCount() {
    let n = 0
    for (let i = 0; i < this.placed.length; i++) {
      if (this.placed[i].state === SLOT.NONE) n++
    }
    return n
  }

  /** 第一个未加入的名额（-1 = 名额都用过了） */
  firstFreeSlot() {
    for (let i = 0; i < this.placed.length; i++) {
      if (this.placed[i].state === SLOT.NONE) return i
    }
    return -1
  }

  /* ---------------- 数量：本局固定，多退少补 ---------------- */

  /** 「本局 N 架 · 已摆 M 架」，四个字看完就知道还差点什么 */
  countText() {
    const n = this.activeCount()
    const need = this.slotCount
    if (n === need) return '本局 ' + need + ' 架 · 已就位'
    if (n < need) return '本局 ' + need + ' 架 · 还差 ' + (need - n) + ' 架'
    return '本局 ' + need + ' 架 · 多了 ' + (n - need) + ' 架'
  }

  /**
   * 进布阵页就按房间定的架数摆满。
   *
   * 为什么不让人从空棋盘开始一架架点「+」：
   *   架数已经由房主定死，玩家在布阵页没有「打几架」的决定权。
   *   空棋盘进来等于每次开局都先报一次「数量不符」，那个提示就成了噪音；
   *   而且连点三下「+」纯粹是重复劳动。摆好之后玩家只做调整（拖 / 转 / 收），
   *   主动权一点没少。
   */
  autoFill() {
    const n = this.slotCount
    const list = randomDeploy(n, 'standard', BOARD_SIZE)
    const slots = createSlots(n)
    list.forEach(function (p, i) {
      if (!slots[i]) return
      slots[i].state = SLOT.OUT
      slots[i].planeId = p.planeId
      slots[i].anchorRow = p.anchorRow
      slots[i].anchorCol = p.anchorCol
      slots[i].rotation = p.rotation
      slots[i].cells = p.cells
    })
    this.placed = slots
    this.selected = -1
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

    // 状态条里的飞机棋子：**数量 = 本局架数**，点它加入 / 收起 / 选中
    const slotSize = u(72)
    const slotGap = u(10)
    const n = this.slotCount
    g.statusSlots = []
    for (let i = 0; i < n; i++) {
      g.statusSlots.push({
        x: x + u(24) + i * (slotSize + slotGap),
        y: g.statusY + u(16),
        w: slotSize,
        h: slotSize
      })
    }
    g.statusTextX = x + u(24) + n * slotSize + (n - 1) * slotGap + u(16)
    g.statusHintY = g.statusY + statusH - u(24)

    // 每个槽都可点：未加入 = 添一架，收起着 = 展开回原位，在场上 = 选中。
    // 槽位是玩家脑子里「第几架」最直接的映射，做成一半可点一半不可点，
    // 就会出现「明明看着有个槽，点了没反应」。
    if (!this.waiting && !this.readying) {
      g.statusSlots.forEach(function (s, i) {
        this.zone(s.x, s.y, s.w, s.h, this.onPickSlot.bind(this, i))
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

    // 正在拖的那架「拿在手上」，棋盘上不再算它、也不画它。
    // 否则拖拽时原位置会杵着一个实色飞机，玩家看到的是「凭空多了一架」。
    const dragIdx = this.drag ? this.drag.idx : -1

    // 一格落了几架（含机头）：机头格靠它换成「白底牌 + 红字」，见 board.js
    const stack = {}
    this.activePlaced().forEach(function (p) {
      if (p.slot === dragIdx) return
      p.cells.forEach(function (c) {
        if (outsideCell(c)) return
        const k = c.row + ',' + c.col
        stack[k] = (stack[k] || 0) + 1
      })
    })

    this.placed.forEach(function (p, i) {
      if (!isOut(p)) return     // 未加入 / 收起的飞机不画（它们在状态条里有自己的样子）
      if (i === dragIdx) return // 拖拽中的那架只在手指位置画落点框，见 marks()
      // 出界 / 压到别人 → 这一架整体标「不合规」（画成半透明）。
      // 「整架」而不是「只标冲突的那几格」：玩家要判断的是「这一架能不能用」，
      // 逐格标会让人以为只有那几个格子有问题。
      const bad = a.outside[i] > 0 || !!a.overlap[i]
      const trimmed = a.outside[i] > 0
      p.cells.forEach(function (c) {
        // 出界的格直接不画。画在棋盘范围外会糊到倒计时、状态条上。
        if (outsideCell(c)) return
        const k = c.row + ',' + c.col
        m[c.row - 1][c.col - 1] = {
          s: c.isHead ? 'head' : 'plane',
          p: p.slot,
          bad: bad,
          trimmed: trimmed,
          conflict: !!a.conflict[k],
          stack: stack[k] || 1
        }
      })
    })

    // 机头重叠时「牌上写谁的数字」：优先写**当前选中**的那一架。
    //
    // 不这么做就会出现最糟的一种情况：玩家点了一下，选择其实已经换到另一架了，
    // 但牌上数字没变（因为后放的那架覆盖了先放的），于是一模一样的画面里
    // 他自己也说不清现在选的是哪一架。数字变化就是这条唯一的信号。
    const sel = this.selected
    if (sel >= 0 && sel < this.placed.length && isOut(this.placed[sel])) {
      const hc = headCellOf(this.placed[sel])
      if (hc && !outsideCell(hc)) {
        const cur = m[hc.row - 1][hc.col - 1]
        if (cur && cur.s === 'head' && cur.stack > 1) {
          m[hc.row - 1][hc.col - 1] = Object.assign({}, cur, { p: sel })
        }
      }
    }
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
      if (i === focus || !isOut(p)) return
      p.cells.forEach(function (c) {
        if (outsideCell(c)) return
        out[c.row + ',' + c.col] = true
      })
    })
    return out
  }

  /**
   * 叠加层：选中描边 + 拖拽落点预览
   *
   * 拖拽时**不改动 cells**，而是用 marks 叠一层落点预览——
   * 棋盘上那一架已由 cells() 跳过（等于被拿在手上），所以这里只画「松手会落到哪」。
   *
   * 注意：这里不再有「自动吸附候选」（hint），也没有「原位置留痕」。
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

      // 只画落点：能放=蓝框，放不下=红框，两种都是「松手落这儿」。
      //
      // 这里原来还有一层「原位置留痕」（fade 浅色块），已经去掉 ——
      // 和 cells() 里那份实色本体叠在一起，拖动时屏幕上同时出现三份飞机
      // （实色本体 + 浅色留痕 + 落点框），谁在被拖反而看不清。
      // 现在那架已经「拿在手上」，原位置就该是空的。
      put(getAbsoluteCells(p.planeId, d.row, d.col, d.rotation),
        d.valid ? 'ghostOk' : 'ghostBad')
      return out
    }

    // 选中：整架描边（未加入 / 收起的架不在场上，不描边 —— 描了会被当成它还在）
    if (this.selected >= 0 && this.selected < this.placed.length &&
        isOut(this.placed[this.selected])) {
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
      const stacked = this.headStackOf(this.selected)
      tip = stacked > 1
        // 机头重叠时，旋转是没法预期的（转完可能还叠着），所以点按只切换选择。
        // 文案必须说清这一点，否则「点了一下没转」会被当成坏了。
        ? '第 ' + (this.selected + 1) + ' 架已选中 · 此格叠了 ' + stacked + ' 架，点它切换'
        : '第 ' + (this.selected + 1) + ' 架已选中 · 再点机头旋转'
    } else if (pending > 0) {
      const ov = this.headOverlaps()
      tip = ov.length
        ? '第 ' + ov.map(function (i) { return i + 1 }).join('、') + ' 架机头重叠 · 点该格切换'
        : pending + ' 架位置不合规 · 点红格可调'
    } else if (this.activeCount() !== this.slotCount) {
      // 数量不对：这是唯一需要说「差几架」的地方
      tip = this.countText()
    } else {
      tip = this.slotCount + ' 架已就位 · 点「就绪」开始'
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
      const p = this.placed[i]
      const isOn = p.state === SLOT.OUT
      const isOff = p.state === SLOT.OFF
      const isSel = this.selected === i && isOn
      const isDrag = !!this.drag && this.drag.idx === i
      if (isSel || isDrag) {
        draw.fillRect(ctx, s.x, s.y, s.w, s.h, c.primaryLight, u(theme.radius.md))
        draw.strokeRect(ctx, s.x, s.y, s.w, s.h, c.primary, u(theme.radius.md), 2)
      } else if (isOff) {
        // 收起：淡底 + 虚线框。虚线是「这里有个位置，但东西被拿开了」的通用表达，
        // 和「从未加入过的名额」（灰底 + 加号）区分开 —— 否则玩家会以为这架被删了。
        draw.fillRect(ctx, s.x, s.y, s.w, s.h, c.gray, u(theme.radius.md))
        const dd = u(5)
        const gg = u(4)
        const col = c.textMuted
        const x2 = s.x + s.w
        const y2 = s.y + s.h
        draw.dashedLine(ctx, s.x, s.y, x2, s.y, col, 1, dd, gg)
        draw.dashedLine(ctx, x2, s.y, x2, y2, col, 1, dd, gg)
        draw.dashedLine(ctx, x2, y2, s.x, y2, col, 1, dd, gg)
        draw.dashedLine(ctx, s.x, y2, s.x, s.y, col, 1, dd, gg)
      } else if (!isOn) {
        // 未加入：灰底 + 淡灰飞机 + 右下角「+」。看到就知道「这儿能再添一架」。
        draw.fillRect(ctx, s.x, s.y, s.w, s.h, c.gray, u(theme.radius.md))
      }
      // 状态条棋子用**和棋盘完全一致的身份色**：
      // 棋盘上第 3 架是紫的，这里第 3 个槽也是紫的，两者形成对应关系。
      // 这也是颜色系统的自解释图例——不用额外写「配色说明」。
      // （槽位只有 72 设计单位，图标里的格太小印不下序号，序号只在棋盘机头格出现）
      const pal = theme.color.planePalette[i % theme.color.planePalette.length]
      const bad = isOn && !!badOf[i]
      // 收起的架用 35% 不透明度画身份色：比纯灰多一层「它还是第几架」的信息，
      // 又比实色明确「它现在不在场上」。
      const prevAlpha = ctx.globalAlpha
      if (isOff) ctx.globalAlpha = prevAlpha * 0.35
      planeIcon.render(ctx, s.x + u(4), s.y + u(4), s.w - u(8), {
        on: isOn || isOff,
        rotation: p.rotation,
        // 槽位只有 72 设计单位，半透明的小图标看不出来，所以这里用实色红
        color: bad ? c.danger : pal.body,
        headColor: bad ? c.dangerDark : pal.head
      })
      ctx.globalAlpha = prevAlpha

      // 未加入：右下角加号（唯一表示「这个名额还空着、可点」的符号）
      if (!isOn && !isOff) {
        const bx = s.x + s.w - u(10)
        const by = s.y + s.h - u(10)
        draw.circle(ctx, bx, by, u(11), c.primary)
        draw.text(ctx, '+', bx, by + u(1), {
          size: u(18), weight: 700, color: '#FFFFFF',
          align: 'center', baseline: 'middle'
        })
      }

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
      const offN = this.offCount()
      line1 = this.activeCount() + '/' + this.slotCount + ' 架' +
        (offN ? ' · 收起 ' + offN : '') +
        ' · 朝 ' + ROTATION_LABEL[rotLabel]
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
    } else if (this.activeCount() !== this.slotCount) {
      hint = '点「就绪」可以一步补齐或收起 · 也能自己拖'
      hintColor = c.warnDark
    } else if (this.noneCount() > 0) {
      hint = '点下方「+」添一架 · 点机头选中 · 按住机头拖'
    } else {
      hint = '点机头选中 · 按住机头拖 · 点「收起」可以拿掉一架'
    }
    draw.text(ctx, draw.ellipsis(ctx, hint, g.w - u(48), u(theme.size.tiny)),
      g.x + u(24), g.statusHintY, { size: u(theme.size.tiny), color: hintColor })

    /* ---- 操作栏 ---- */
    const hasSel2 = this.selected >= 0
    // 「收起」可逆（位置和朝向都记着，点虚线条就能展开），所以不给危险色。
    // 危险色应该留给真的不可逆的动作，滥用会让玩家对红色麻木。
    const labels = ['旋转', hasSel2 ? '收起这架' : '随机布阵', '清空']
    const kinds = ['outline', 'outline', 'outline']
    const disabled = this.waiting || this.readying
    g.opRects.forEach(function (r, i) {
      Button.render(ctx, {
        x: r.x, y: r.y, w: r.w, h: r.h,
        label: labels[i], kind: kinds[i], disabled: disabled
      }, u)
    })

    // 就绪按钮兼任「状态指示器」：有几架不合规 / 数量差几架，按钮自己就说出来（不用点才知道）。
    // 「放错了」和「数量不对」是两种处境：前者红，后者橙 —— 橙色是「还没准备好」，不是错误。
    const n = this.activeCount()
    const diff = n - this.slotCount
    Button.render(ctx, Object.assign({}, g.readyBtn, {
      label: pending > 0
        ? '先修正 ' + pending + ' 架'
        : (diff < 0 ? '还差 ' + (-diff) + ' 架'
          : (diff > 0 ? '多了 ' + diff + ' 架' : '就绪 · ' + n + ' 架')),
      kind: (pending > 0 || diff !== 0) ? 'warn' : 'primary',
      loading: this.readying || this.waiting,
      loadingText: this.waiting ? '等待对手…' : '提交中…'
    }), u)

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
      if (!isOut(p)) continue     // 未加入 / 收起的架不在场上，点不到
      for (let k = 0; k < p.cells.length; k++) {
        if (p.cells[k].row === row && p.cells[k].col === col) {
          out.push({ idx: i, isHead: !!p.cells[k].isHead })
          break
        }
      }
    }
    return out
  }

  /**
   * 这一架的机头格上还叠了几架（含自己）
   * > 1 就是「机头重合」—— 此时点按只切换选择、不旋转，理由见 onBoardTap
   */
  headStackOf(idx) {
    const h = headCellOf(this.placed[idx])
    if (!h) return 0
    return this.planesAt(h.row, h.col).length
  }

  /** 机头被重叠占用的那几架（返回 0-based 下标），用来提示「点该格切换」 */
  headOverlaps() {
    const self = this
    const out = []
    this.placed.forEach(function (p, i) {
      if (!isOut(p)) return
      const h = headCellOf(p)
      if (!h || outsideCell(h)) return
      if (self.planesAt(h.row, h.col).length > 1) out.push(i)
    })
    return out
  }

  onBoardTap(row, col) {
    if (this.waiting || this.readying) return

    const hits = this.planesAt(row, col)

    if (hits.length) {
      // 重叠处：点一下在叠着的几架之间轮换。不然压在下面那架永远选不到 ——
      // 它被遮住、被标红，只能从状态条进去，等于把问题藏起来了。
      if (hits.length > 1) {
        let cur = -1
        for (let i = 0; i < hits.length; i++) {
          if (hits[i].idx === this.selected) { cur = i; break }
        }
        const pick = hits[(cur + 1) % hits.length]
        this.selected = pick.idx
        this.rotation = this.placed[pick.idx].rotation
        // 切换本身不需要重复 toast：机头牌上的数字变了、顶部文案变了、
        // 状态条对应棋子亮了，三个通道同时响应，再弹一句就是噪音。
        return
      }

      const pick = hits[0]
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

    // 名额都用过（在场上 / 收起）→ 没有可添的地方，说清现状
    const free = this.firstFreeSlot()
    if (free < 0) {
      const offN = this.offCount()
      this.app.toast(offN
        ? '还有 ' + offN + ' 架收起着 · 点状态条的虚线槽放回原位'
        : '本局就 ' + this.slotCount + ' 架 · 点机头可选中调整')
      return
    }

    this.placeAt(row, col, free)
  }

  /** 机头必须留在棋盘内（它是抓手，也是「以机头为轴旋转」的轴心） */
  clampHead(row, col) {
    return {
      row: Math.min(BOARD_SIZE, Math.max(1, row)),
      col: Math.min(BOARD_SIZE, Math.max(1, col))
    }
  }

  /**
   * 在 (row,col) 添一架到第 slot 个名额。
   *
   * 与旧版的关键差别：**不再自动换位置 / 换朝向**。
   * 点哪儿就放哪儿，放不下就标红，玩家自己决定要不要立刻调。
   * （理由见文件头「编辑期宽松 · 提交期严格」）
   */
  placeAt(row, col, slot) {
    const p = this.placed[slot]
    if (!p || p.state !== SLOT.NONE) return
    const head = this.clampHead(row, col)
    p.state = SLOT.OUT
    p.planeId = 'standard'
    p.anchorRow = head.row
    p.anchorCol = head.col
    p.rotation = this.rotation
    p.cells = getAbsoluteCells(p.planeId, head.row, head.col, p.rotation)
    // **不选中**。玩家刚亲手点下位置，位置意图已经表达完了；
    // 若顺手选中，下一次点空白就会先「退出选中」而不是接着添一架 ——
    // 连放三架变成「放一架、点一下空白、再放一架」。
    this.layout()              // 槽位状态变了，重排一次

    const text = this.issueTextOf(slot)
    if (text) this.app.toast('第 ' + (slot + 1) + ' 架放不下 · 已标红')
  }

  /**
   * 把某个空名额自动落到「离棋盘中心最近的合法位置」。
   *
   * 位置由系统给，不是「替玩家做决定」—— 这个动作里玩家还没有表达位置意图；
   * 落好之后立刻选中，按住机头就能拖走，主动权仍在玩家手上。
   *
   * @returns {boolean} 是否真的放下了
   */
  placeSlotAuto(slot) {
    const p = this.placed[slot]
    if (!p || p.state !== SLOT.NONE) return false

    const occupied = []
    this.placed.forEach(function (q, i) {
      if (i === slot || !isOut(q)) return
      q.cells.forEach(function (c) {
        if (!outsideCell(c)) occupied.push(c)
      })
    })

    const res = fit.findFit({
      planeId: 'standard',
      anchorRow: Math.ceil(BOARD_SIZE / 2),
      anchorCol: Math.ceil(BOARD_SIZE / 2),
      rotation: this.rotation,
      occupied: occupied,
      allowMove: true,
      allowRotate: false,     // 添一架不该顺手把朝向改了
      maxRadius: BOARD_SIZE,  // 由中心向外逐环找，落点就是「离中心最近的空位」
      prefer: 'move'
    })

    const head = res
      ? { row: res.anchorRow, col: res.anchorCol }
      : this.clampHead(Math.ceil(BOARD_SIZE / 2), Math.ceil(BOARD_SIZE / 2))

    p.state = SLOT.OUT
    p.planeId = 'standard'
    p.anchorRow = head.row
    p.anchorCol = head.col
    p.rotation = this.rotation
    p.cells = getAbsoluteCells(p.planeId, head.row, head.col, p.rotation)
    return true
  }

  /** 点状态条的「+」→ 把这一架添到棋盘上并选中它 */
  onAddSlot(slot) {
    if (!this.placeSlotAuto(slot)) return
    this.selected = slot
    this.layout()
    this.app.toast('第 ' + (slot + 1) + ' 架已添到棋盘 · 按住机头拖到想要的位置')
  }

  /** 点状态条里的飞机棋子 → 未加入=添一架 / 收起=回原位 / 在场上=选中 */
  onPickSlot(idx) {
    if (this.waiting || this.readying) return

    const p = this.placed[idx]
    if (!p) return
    if (p.state === SLOT.OFF) return this.onRestore(idx)
    if (p.state === SLOT.NONE) return this.onAddSlot(idx)

    this.selected = (this.selected === idx) ? -1 : idx
    if (this.selected >= 0) this.rotation = p.rotation
  }

  /* ---- 拖拽移动（按住机头） ---- */

  onTouchStart(x, y) {
    this._press = null
    if (this.waiting || this.readying || this.drag) return
    const cell = Board.cellAt(this.geo.board, x, y)
    if (!cell) return
    const hits = this.planesAt(cell.row, cell.col)
    let owner = null
    // 优先抓**当前选中**的那架：几架机头叠在同一格时，如果不看选中态，
    // 永远只能抓住后放的那架，先放的怎么拖都拖不动 —— 而重叠恰恰是最需要拖开的时刻。
    for (let i = 0; i < hits.length; i++) {
      if (hits[i].isHead && hits[i].idx === this.selected) { owner = hits[i]; break }
    }
    if (!owner) {
      for (let i = 0; i < hits.length; i++) {
        if (hits[i].isHead) { owner = hits[i]; break }
      }
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
    if (!isOut(p)) return false     // 未加入 / 收起的架不在场上，转了也看不见
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
    // 「最近放下的那一架」要跳过收起的 —— 它不在场上，转了也看不见
    let last = -1
    for (let i = this.placed.length - 1; i >= 0; i--) {
      if (isOut(this.placed[i])) { last = i; break }
    }
    if (last < 0) {
      this.rotation = (this.rotation + 1) % 4
      this.app.toast('下一架朝向：' + ROTATION_LABEL[this.rotation])
      return
    }
    this.rotatePlane(last)
  }

  /** 收起这一架：只改状态，位置 / 朝向 / 编号全部留着，点虚线槽就能展开回原位 */
  onStashSelected() {
    if (this.selected < 0) return
    const p = this.placed[this.selected]
    if (!isOut(p)) return
    const n = this.selected + 1
    p.state = SLOT.OFF
    this.selected = -1
    this.drag = null
    this.layout()
    const left = this.activeCount()
    this.app.toast(left >= this.slotCount
      ? '第 ' + n + ' 架已收起 · 点虚线槽可放回'
      : '第 ' + n + ' 架已收起 · 现在 ' + left + '/' + this.slotCount + ' 架，点虚线槽放回')
  }

  /** 展开：回到收起前的位置和朝向（位置现在不合法也照样展开，标红即可） */
  onRestore(idx) {
    const p = this.placed[idx]
    if (!p || p.state !== SLOT.OFF) return false
    p.state = SLOT.OUT
    this.selected = idx
    this.rotation = p.rotation
    this.layout()
    const n = this.activeCount()
    const text = this.issueTextOf(idx)
    this.app.toast('第 ' + (idx + 1) + ' 架已放回原位 · ' + n + '/' + this.slotCount + ' 架' +
      (text ? ' · 但现在' + text : ''))
    return true
  }

  /**
   * 补齐到 need 架：先把「收起着」的放回原位（位置是玩家自己挑的，比系统找的更合心意），
   * 再给空名额自动找位置。
   */
  fillTo(need) {
    const target = Math.min(this.slotCount, need)
    for (let i = 0; i < this.placed.length && this.activeCount() < target; i++) {
      if (this.placed[i].state === SLOT.OFF) this.placed[i].state = SLOT.OUT
    }
    for (let i = 0; i < this.placed.length && this.activeCount() < target; i++) {
      if (this.placed[i].state === SLOT.NONE) this.placeSlotAuto(i)
    }
    this.selected = -1
    this.layout()
    const n = this.activeCount()
    const bad = this.audit().items.length
    if (n < target) {
      this.app.toast('只补到 ' + n + ' 架 · 棋盘上放不下了')
      return
    }
    this.app.toast(bad
      ? '已补齐 ' + target + ' 架 · 有 ' + bad + ' 架位置不合规'
      : '已补齐 ' + target + ' 架 · 可以就绪')
  }

  /** 收起多出来的：从最后一架往前收，位置记住，点虚线槽还能放回 */
  stashTo(need) {
    const target = Math.max(0, need)
    let n = this.activeCount()
    for (let i = this.placed.length - 1; i >= 0 && n > target; i--) {
      if (this.placed[i].state === SLOT.OUT) {
        this.placed[i].state = SLOT.OFF
        n--
      }
    }
    this.selected = -1
    this.layout()
    this.app.toast('现在 ' + this.activeCount() + '/' + this.slotCount + ' 架 · 点虚线槽可放回')
  }

  /** 操作栏中间按钮：有选中 = 收起这架；无选中 = 随机布阵 */
  onSecondAction() {
    if (this.waiting || this.readying) return
    if (this.selected >= 0) return this.onStashSelected()
    this.onRandom()
  }

  /**
   * 随机布阵：整盘重排成「本局那 N 架」。
   * 架数不由这里决定 —— 它早就写在房间上了，这里只是换一组位置。
   */
  onRandom() {
    if (this.waiting) return
    const n = this.slotCount
    const list = randomDeploy(n, 'standard', BOARD_SIZE)
    const slots = createSlots(n)
    list.forEach(function (p, i) {
      if (!slots[i]) return
      slots[i].state = SLOT.OUT
      slots[i].planeId = p.planeId
      slots[i].anchorRow = p.anchorRow
      slots[i].anchorCol = p.anchorCol
      slots[i].rotation = p.rotation
      slots[i].cells = p.cells
    })
    this.placed = slots
    this.selected = -1
    this.drag = null
    this.layout()
    this.app.toast('已随机布置 ' + this.activeCount() + ' 架')
  }

  /** 清空 = 名额全部回到「未加入」，位置与朝向一并清掉 */
  onClear() {
    if (this.waiting) return
    this.placed = createSlots(this.slotCount)
    this.selected = -1
    this.drag = null
    this.layout()
    this.app.toast('已清空 · 点棋盘放 ' + this.slotCount + ' 架')
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

    // ① 数量：本局几架是房主定死的，多一架少一架都不许开局。
    //    先查数量再查位置 —— 数量都不对的时候，去摆位置没有意义。
    const n = this.activeCount()
    if (n !== this.slotCount) {
      this.blockCount(n)
      return
    }

    // ② 位置：出界 / 压人
    const a = this.audit()
    if (!a.ok) {
      this.blockStart(a)
      return
    }
    this.submit()
  }

  /**
   * 数量不对：说清「本局几架 / 现在几架」，并给一个一步到位的修法。
   *
   * 措辞不带责备 —— 这不是玩家做错了，是房主定的规则，他只是还没对齐。
   * 也不直接替他摆：补齐 / 收起都是玩家点的，摆完还能继续拖。
   */
  blockCount(n) {
    const need = this.slotCount
    const more = n < need
    const self = this
    dialog.confirm({
      title: more ? '还差 ' + (need - n) + ' 架' : '多了 ' + (n - need) + ' 架',
      content: '本局由房主定了 ' + need + ' 架，布阵必须正好摆 ' + need + ' 架才能开始。\n\n'
        + (more
          ? '你现在摆了 ' + n + ' 架。「补齐」会替你把空位放到棋盘上，之后照样能拖。'
          : '你现在摆了 ' + n + ' 架。「收起多的」会把多出来的收起来，位置记着，随时能放回。'),
      confirmText: more ? '替我补齐' : '收起多的',
      cancelText: '我自己改',
      onOk: function () {
        if (more) self.fillTo(need)
        else self.stashTo(need)
      }
    })
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
      if (bad[i] || !isOut(p)) return      // 收起 / 未加入的架不在场上，不占位
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

    // 只提交在场上的（onReady 已核对过数量与位置，这里再收一道，别把收起的架当布置）
    const planes = this.activePlaced().map(function (p) {
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
