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
const { RESULT, BOARD_SIZE, TIMEOUT, MAX_TURN_TIMEOUT_STREAK } = require('../shared/config/rules')
const { EMOTES, EMOTE_HIDE_MS } = require('../shared/config/social')
const { AUDIO } = require('../core/audio')

const RESULT_TEXT = {}
RESULT_TEXT[RESULT.MISS] = '未击中'
RESULT_TEXT[RESULT.HIT] = '击中！'
RESULT_TEXT[RESULT.KILL] = '击毁！'

// T-08：结果音唯一数据源是我方 api.fire 返回的 res.result（见 onFire）。
// 机翼/机身/机尾服务端都回 hit → 同一个 sfx.hit，无部位变体；不接 incoming / 对方 marks。
const RESULT_SFX = {}
RESULT_SFX[RESULT.MISS] = AUDIO.SFX.MISS
RESULT_SFX[RESULT.HIT] = AUDIO.SFX.HIT
RESULT_SFX[RESULT.KILL] = AUDIO.SFX.KILL

// 等待态战报（§11.1.A 中档）。只说「我打过哪里、结果如何」：
// 没有机号、没有机头/机翼字样、没有来自 incoming 的数据 —— T-08 禁的就是这个。
const REPORT_TEXT = {}
REPORT_TEXT[RESULT.MISS] = '未击中'
REPORT_TEXT[RESULT.HIT] = '命中'
REPORT_TEXT[RESULT.KILL] = '击毁'
const REPORT_RESULTS = [RESULT.MISS, RESULT.HIT, RESULT.KILL]
const REPORT_MAX = 3

// 双击同一格 = 直接发射，省掉「再伸手去点发射按钮」那一步。
// 300ms 是移动端判定双击的常用窗口：再短（<200ms）真机上几乎打不出来，
// 再长（>400ms）又会让「想换个目标、连点了两下」被误判成开火。
const DOUBLE_TAP_MS = 300

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
    this.foePlaneCount = 0
    this.stepSeconds = TIMEOUT.TURN
    this.turnSeconds = TIMEOUT.TURN
    this.myStreak = 0
    this.lastAutoAt = 0
    // 战报流水：1 条 = 我的一炮。结果来自 marks，顺序来自 lastMove.at（见 syncBattleReport）
    this.shotLog = []
    this.lastReportAt = 0
    this.wasReportSlot = false
    this.emoteBarOpen = false
    this.emoteBubble = null
    this.lastBattle = null
    this.lastEmoteSeq = 0
    this.resultHandled = false
    this.ticking = false
    this.tickAcc = 0
    this.watcher = null
    this.emoteTimer = null
    this._lastTap = null    // 上一次点中的格 {row, col, at}，用于识别双击发射

    // 雷达扫掠：时钟**不在这里初始化清零**（只在构造时置 0）——
    // 「永不复位」包括跨局：玩家看到的是「这台雷达一直在转，只是刚才没显示」，
    // 而不是「每局它都重新开机」。主透明度同理，交给 update 里的 240ms 过渡收敛。
    this.battleClock = 0
    this.sweepAlpha = 0
  }

  /* ---------------- 生命周期 ---------------- */

  onEnter() {
    const app = this.app
    const match = app.globalData.match || {}
    this.roomId = match.roomId || ''
    this.planeCount = this.planeCount || match.planeCount || 1
    // 本局每步限时由房主在创建房间时定（5~120 秒），不是全局常量
    this.stepSeconds = match.stepSeconds || TIMEOUT.TURN
    this.turnSeconds = this.stepSeconds
    this.myStreak = 0
    this.lastAutoAt = 0
    this.shotLog = []
    this.lastReportAt = 0
    this.wasReportSlot = false
    this.resultHandled = false
    this.ticking = false
    this.tickAcc = 0
    this.selected = null
    this._lastTap = null
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
    // 雷达时钟与淡入淡出必须**在下面那个提前 return 之前**推进。
    //
    // 时钟永不复位是 art §4.3 的硬要求：一局里「对方回合」要反复进出十几次
    // （每回合切一次），每次从 t=0 起算 = 雷达每 20 秒从 12 点重新开机，
    // 比相位跳变更刺眼。要是让它跟着下面的 `finished / 没有 deadline` 一起被卡住，
    // 相位就会在每次状态切换时倒退 —— 等于偷偷把「不复位」破坏掉了。
    // 用 dt 累加而不是 Date.now() 还多一个必要副作用：切后台回来 dt 不会跳过几秒。
    const d = Math.max(0, Number(dt) || 0)
    this.battleClock += d
    this.stepSweepAlpha(d)

    if (this.finished || !this.lastBattle || !this.lastBattle.turnDeadline) return
    this.tickAcc += dt
    if (this.tickAcc < 250) return
    this.tickAcc = 0

    const left = Math.max(0, Math.ceil((this.lastBattle.turnDeadline - Date.now()) / 1000))
    if (left !== this.turnSeconds) {
      const wasTurn = this.turnSeconds
      this.turnSeconds = left
      // 逐秒 tick 音：只挂这个「秒变化点」，绝不挂 render（那是每帧，会重复响）。
      // 250ms 累加器天然防抖；只在本人回合、未结束、倒计时递减时响。
      // 规格 §2.13：>5s 每跨一秒响 sfx.tick；§2.14：≤5s 改响 sfx.tick.urgent。
      // wasTurn > left 保证只认「递减」，避免异常回增再减导致重复响。
      if (this.myTurn && !this.finished && left > 0 && wasTurn > left) {
        this.app.audio.play(left <= 5 ? AUDIO.SFX.TICK_URGENT : AUDIO.SFX.TICK)
      }
    }
    if (left <= 0) this.requestTick()
  }

  /**
   * 扫掠该不该出现（art §4.7）
   *
   * 全游戏只有「对方回合 / 等待回应」这 20 秒是玩家没事干的时候：
   * 静止的盘 = 玩家怀疑卡死，扫掠 = 「系统在跑、我们在听」。
   * 轮到我方出手就关 —— 那要逐格排查、核对「横3竖4」、点选目标，**读数优先于氛围**。
   */
  sweepWanted() {
    return !this.finished && !this.myTurn && !!this.lastBattle
  }

  /** 主透明度按 240ms 线性趋近 0 或 1。硬开关会让「轮到你了」那一瞬像掉帧。 */
  stepSweepAlpha(dt) {
    const target = this.sweepWanted() ? 1 : 0
    if (this.sweepAlpha === target) return
    const step = dt / theme.sweep.fadeMs
    let v = this.sweepAlpha < target
      ? Math.min(target, this.sweepAlpha + step)
      : Math.max(target, this.sweepAlpha - step)
    // 浮点累加不会精确落到 0（1 − 15×(16/240) 会剩 8e-17），而这个 0 是**功能性的**：
    // 只有真正等于 0，board.js 才会整层跳过（0 次绘制调用）。差一位就等于
    // 每帧白画 10 次「看不见的扫掠」。所以到目标附近直接吸附。
    if (Math.abs(v - target) < 1e-6) v = target
    this.sweepAlpha = v
  }

  /**
   * 把扫掠参数发给「当前放大的那块盘」
   *
   * 同一时刻最多 1 个扫掠实例：两块盘同时扫，视线会被两个不同相位的运动撕开
   * （最难受的一种视觉噪声）。
   *
   * ⚠ 与任务书的一处出入，已报 team-lead：任务书写「只扫放大的那块**敌方海域**」，
   * 但等待态下放大的其实是**我方海域** —— applyBattle 里 `myTurn ? 'foe' : 'mine'`，
   * 不是我的回合就放大自己的盘。按字面实现的话，那时敌方盘是 11px 缩略盘，
   * SWEEP_MIN_CELL=22 会直接把它关掉，扫掠永远不会出现。
   * 所以这里按 art §4.7「挂在当前放大的那块盘上」实现。
   */
  sweepFor(focused) {
    if (!focused || this.sweepAlpha <= 0) return null
    return { t: this.battleClock, alpha: this.sweepAlpha }
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

    // 双方架数各自独立（布阵页点「+」添几架就是几架），所以对方那半边的
    // 「已击毁 X / N」必须用对方的 N。新版本服务端在 battle.counts 里给；
    // 老服务端（或离线引擎）没有这个字段时退回自己的架数 —— 离线对局双方同架数，
    // 退回是准确的；老服务端上与旧行为一致，不会比原来更差。
    const counts = b.counts || {}
    this.foePlaneCount = counts[this.foeOpenid] || this.planeCount || 0

    // 单步限时与连续超时次数都从服务端来：客户端只负责显示，不自己数
    if (b.stepSeconds) this.stepSeconds = b.stepSeconds
    this.myStreak = ((b.streak || {})[this.myOpenid]) || 0

    const mine = (b.marks && b.marks[this.myOpenid]) || {}
    const incoming = (b.incoming && b.incoming[this.myOpenid]) || {}
    const stats = (b.stats && b.stats[this.myOpenid]) || { kill: 0, lost: 0, shots: 0 }

    const myTurn = b.turn === this.myOpenid
    const finished = !!b.finished
    const focusChanged = (finished ? this.focus : (myTurn ? 'foe' : 'mine')) !== this.focus

    this.mine = mine
    this.incoming = incoming
    this.syncBattleReport(b, mine)
    this.myTurn = myTurn
    this.finished = finished
    this.statusText = this.statusLabel(finished, myTurn)
    this.myShots = stats.shots
    this.foeShots = Object.keys(incoming).length
    this.myDestroyed = stats.lost
    this.foeDestroyed = stats.kill
    this.focus = finished ? this.focus : (myTurn ? 'foe' : 'mine')
    if (finished) { this.emoteBarOpen = false }

    // 服务端替我打了一炮（回合超时）：得说出来，否则玩家会以为「我没点，怎么炸了」
    const lm = b.lastMove
    if (lm && lm.auto && lm.by === this.myOpenid && lm.at !== this.lastAutoAt) {
      this.lastAutoAt = lm.at
      this.app.feedback('超时 · 已自动轰炸 横' + lm.col + '，竖' + lm.row, 1400)
    }

    // 战报只在等待态占位；首次拿到 lastBattle 时也要重排一次，否则那一格永远空着
    const reportSlot = !finished && !myTurn && !!b.turnDeadline
    const reportSlotChanged = reportSlot !== this.wasReportSlot
    this.wasReportSlot = reportSlot
    let needLayout = focusChanged || (this.wasTurn !== myTurn) || (this.wasFinished !== finished)
    if (reportSlotChanged) needLayout = true
    // 「轮到你了」提示音（规格 §2.8）：仅在明确由对方回合翻转到我方回合时响一次。
    // wasTurn 未定义（首次同步）不响，避免与进房音叠加 / 无法区分重连。
    if (myTurn && this.wasTurn === false && !finished) {
      this.app.audio.play(AUDIO.SFX.ROUND_START)
    }
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

  /** 状态条文案：超时计数直接写进这一句，玩家不用再去别处找数字 */
  statusLabel(finished, myTurn) {
    if (finished) return '对局结束'
    const base = myTurn ? '轮到你开炮' : '等待对方行动…'
    if (this.myStreak > 0) {
      return base + ' · 连续超时 ' + this.myStreak + '/' + MAX_TURN_TIMEOUT_STREAK
    }
    return base
  }

  requestTick() {
    if (this.ticking) return
    const self = this
    this.ticking = true
    api.tick({ roomId: this.roomId }).catch(function () {}).then(function () {
      setTimeout(function () { self.ticking = false }, 2500)
    })
  }

  /* ---------------- 等待态战报 ---------------- */

  /**
   * 战报流水的数据源。
   *
   * 结果只认 `b.marks[我]`：值是 'miss' / 'hit' / 'kill'（rules.js RESULT），
   * 服务端在 fire 时写入（cloudfunctions/game/index.js:214-215）。
   * `incoming[我]` 是「打到我盘上的炮」，跟战报无关；`stats.shots` 只有计数。
   *
   * 顺序有个前提要写清楚：**marks 是 map，没有时间戳**。会话内用 `lastMove.at`
   * （全状态唯一带 at 的字段）逐炮累积；首次进入 / 重连只能用 Object.keys(marks)
   * 的插入序作种子。要让跨会话的顺序也权威，得后端加 shotLog 数组 —— 不在本改动范围内。
   */
  syncBattleReport(b, mine) {
    const marks = mine || {}
    const keyRegex = /^([1-9]),([1-9])$/
    const parse = function (k) {
      const m = keyRegex.exec(String(k || ''))
      return m ? { row: Number(m[1]), col: Number(m[2]) } : null
    }
    const resultOf = function (k) {
      const v = marks[k]
      return REPORT_RESULTS.indexOf(v) >= 0 ? v : null
    }
    const make = function (k, at, born) {
      const rc = parse(k)
      if (!rc) return null
      return { key: k, row: rc.row, col: rc.col, result: resultOf(k), at: at, born: born }
    }

    if (!this.shotLog.length) {
      const keys = Object.keys(marks).filter(function (k) { return !!resultOf(k) && !!parse(k) })
      this.shotLog = keys.slice(-REPORT_MAX).reverse()
        .map(function (k) { return make(k, 0, -Infinity) })
        .filter(function (e) { return !!e })
    }

    const lm = b && b.lastMove
    if (lm && lm.by === this.myOpenid && lm.at && lm.at !== this.lastReportAt) {
      const k = Number(lm.row) + ',' + Number(lm.col)
      if (resultOf(k)) {
        this.lastReportAt = lm.at
        const known = this.shotLog.some(function (e) { return e.key === k })
        if (!known) {
          const e = make(k, lm.at, this.battleClock)
          if (e) {
            this.shotLog.unshift(e)
            if (this.shotLog.length > REPORT_MAX) this.shotLog.length = REPORT_MAX
          }
        }
      }
    }

    // marks 被重置（离线引擎重开一局）时，别留着已经不存在的炮
    this.shotLog = this.shotLog.filter(function (e) { return resultOf(e.key) === e.result })
  }

  /** 等待态且有炮才显示。我方回合一律不显示 —— 那时读数优先于氛围。 */
  reportVisible() {
    return !this.finished && !this.myTurn && !!this.lastBattle && this.shotLog.length > 0
  }

  recentReport() {
    return this.reportVisible() ? this.shotLog.slice(0, this.reportRows()) : []
  }

  reportRows() {
    const g = this.geo && this.geo.report
    if (!g) return 0
    return Math.max(1, Math.min(REPORT_MAX, Math.floor((g.h - this.u(26)) / this.u(26))))
  }

  reportLine(e) {
    return '横' + e.col + '竖' + e.row + ' · ' + (REPORT_TEXT[e.result] || '')
  }

  reportColor(e) {
    const c = theme.color
    return e.result === RESULT.KILL ? c.danger : (e.result === RESULT.HIT ? c.hit : c.miss)
  }

  /** 新条目 240ms 淡入；用 draw.alpha 拼色，不碰 globalAlpha（它会和扫掠淡入相乘两次）。 */
  reportAlpha(e) {
    if (!isFinite(e.born)) return 1
    const ms = Math.max(0, this.battleClock - e.born)
    return Math.max(0, Math.min(1, ms / theme.sweep.fadeMs))
  }

  drawBattleReport(ctx, u) {
    const g = this.geo && this.geo.report
    if (!g || !this.reportVisible()) return
    const rows = this.recentReport()
    if (!rows.length) return
    const c = theme.color

    draw.fillRect(ctx, g.x, g.y, g.w, g.h, c.card, u(theme.radius.lg))
    draw.strokeRect(ctx, g.x, g.y, g.w, g.h, c.border, u(theme.radius.lg), 1)
    draw.text(ctx, '战报流水', g.x + u(20), g.y + u(17), {
      size: u(theme.size.tiny), weight: 500, color: c.textMuted
    })

    const rowH = u(26)
    const y0 = g.y + u(26)
    for (let i = 0; i < rows.length; i++) {
      const e = rows[i]
      const a = this.reportAlpha(e)
      const y = y0 + i * rowH + rowH / 2
      draw.circle(ctx, g.x + u(24), y, u(4), draw.alpha(this.reportColor(e), a))
      draw.text(ctx, this.reportLine(e), g.x + u(38), y, {
        size: u(theme.size.tiny), color: draw.alpha(c.text, a)
      })
    }
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

    const padOuter = u(Board.PAD)
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

    // 大棋盘是被「屏宽」卡住而不是被高度卡住的（竖屏上永远先撞 maxBoardW），
    // 于是 remain 里会剩下一截用不掉的余量，全堆在小棋盘和底部按钮之间，
    // 看着像半页空白。把余量对半分给「两棋盘之间」和「底部」，重心才落回中间。
    const used = g.mineBlock.h + gap + g.foeBlock.h
    const spare = Math.max(0, remain - used)
    let gapExtra = Math.min(spare * 0.55, u(150))
    // 等待态：同一笔余量先供战报（三行 + 标题 + 上下留白），剩下的才给两盘之间。
    // 不能先塞满 gapExtra 再说 —— 那正是「下半屏空白」的成因。
    const wantReport = !this.finished && !this.myTurn && !!this.lastBattle && !!this.lastBattle.turnDeadline
    if (wantReport) {
      const need = u(6) + u(8) + u(26) + REPORT_MAX * u(26) + u(10)
      const reserve = Math.min(spare, need)
      gapExtra = Math.max(0, Math.min(gapExtra, spare - reserve))
    }
    if (gapExtra > 0) {
      g.foeBlock.top = g.mineBlock.top + g.mineBlock.h + gap + gapExtra
      g.foeBoard = this.boardRect(g.foeBlock, g.foeSize, padOuter, titleH)
    }

    // 等待态下半屏的余量放战报。它只占「小盘下沿 → 底部按钮上沿」这一段：
    // 不去动 gapExtra（那是两盘之间的呼吸），也不挤按钮。没空间就整块不画。
    g.report = null
    if (wantReport) {
      const rTop = g.foeBlock.top + g.foeBlock.h + u(6)
      const rBottom = g.bottomRects[0].y - u(8)
      if (rBottom - rTop >= u(58)) {
        g.report = {
          x: u(40), y: rTop, w: L.W - u(80),
          h: Math.min(rBottom - rTop, u(160))
        }
      }
    }

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
    const urgent = !this.finished && this.myTurn && this.turnSeconds <= 5
    const warnStreak = !this.finished && this.myStreak > 0
    draw.text(ctx, this.statusText, u(40), g.statusY, {
      size: u(theme.size.body),
      weight: this.myTurn && !this.finished ? 500 : 400,
      color: warnStreak ? c.warnDark : (this.myTurn && !this.finished ? c.primary : c.textMuted)
    })
    // 倒计时单独画：只剩 5 秒时变红，提醒「该点了，不然自动轰炸」
    const cdText = this.finished ? '' : this.turnSeconds + 's'
    const cdW = cdText ? draw.measure(ctx, cdText, u(theme.size.tiny), 500) : 0
    if (cdText) {
      draw.text(ctx, cdText, L.W - u(40), g.statusY, {
        size: u(theme.size.tiny), weight: urgent ? 500 : 400,
        color: urgent ? c.danger : c.textMuted, align: 'right'
      })
    }
    draw.text(ctx, '我方 ' + this.myShots + ' · 对方 ' + this.foeShots,
      L.W - u(40) - (cdText ? cdW + u(18) : 0), g.statusY, {
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
      planes: this.myPlanes(),
      disabled: {}, tag: this.myDestroyed + '/' + (this.planeCount || 1) + ' 架被毁'
    })

    this.drawArea(ctx, u, {
      block: g.foeBlock, board: g.foeBoard, title: '敌方海域 · 我方战况',
      focus: this.focus === 'foe', cells: this.foeCells(), selectable: this.myTurn && !this.finished,
      disabled: this.disabledMap(), tag: this.foePlaneCount
        ? '已击毁 ' + this.foeDestroyed + '/' + this.foePlaneCount
        : '已击毁 ' + this.foeDestroyed + ' 架'
    })

    // 等待态战报：只占小盘与底部按钮之间的空档，不碰棋盘，也不碰扫掠
    this.drawBattleReport(ctx, u)

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
      const labelX = g.emojiBtn.x + g.emojiBtn.w + u(20)
      const labelSize = u(theme.size.body)
      draw.text(ctx, label, labelX, g.coordY, {
        size: labelSize, color: this.selected ? c.text : c.textMuted
      })

      // 双击是快捷方式，但不能是没人知道的隐藏手势：选中后把这句写在坐标后面。
      // 不这么做的话，玩家永远只会去点「发射」按钮，双击等于白做。
      if (this.selected) {
        const lw = draw.measure(ctx, label, labelSize)
        draw.text(ctx, '· 双击发射', labelX + lw + u(12), g.coordY, {
          size: u(theme.size.tiny), color: c.textMuted
        })
      }

      Button.render(ctx, Object.assign({}, g.fireBtn, {
        label: '发射', kind: 'primary', disabled: !this.selected
      }), u)

      if (this.emoteBarOpen && g.emoteRects) {
        draw.fillRect(ctx, u(40), g.emoteBarY, L.W - u(80), u(104), c.card, u(theme.radius.lg))
        g.emoteRects.forEach(function (r, i) {
          draw.text(ctx, EMOTES[i].emoji, r.x + r.w / 2, r.y + r.h / 2, {
            size: u(52), align: 'center'
          })
        })
      }
    }

    // 投降是不可逆的坏消息，但它不该和「邀请好友」抢同一档视觉重量：
    // 红底红框的实心按钮放在最常用操作的旁边，等于每局都在劝玩家按它。
    // 降成灰底 + 红字 —— 想找的人找得到，不想找的人不会误触。
    Button.render(ctx, Object.assign({}, g.surrenderBtn, {
      label: '投降', kind: 'ghost', color: c.dangerDark, disabled: this.finished
    }), u)
    Button.render(ctx, Object.assign({}, g.inviteBtn, { label: '邀请好友', kind: 'outline' }), u)

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
    // 这里原来挂一枚「焦点」徽章，表示「这块盘现在是放大的那块」。
    // 删掉的理由：它解释的是**实现状态**，不是玩家的事 —— 哪块盘大，
    // 一眼就看得出来；而玩家真正需要的「现在轮到你，点格子选目标」，
    // 底部那一行已经写了。多一个看不懂的词只会占走注意力。

    Board.render(ctx, {
      x: board.x, y: board.y, size: board.size,
      cells: o.cells, selectable: o.selectable,
      planes: o.planes,
      sweep: this.sweepFor(o.focus),
      disabledMap: o.disabled, selected: o.selectable ? this.selected : null
    }, u)
  }

  /**
   * 我方海域的飞机，走精美化通道（art §5.10）
   *
   * 敌方海域**永远不传** —— 敌盘上不出现飞机的任何形状、剪影、虚影（§5.7）。
   * 飞机是隐藏信息，任何轮廓暗示都在泄漏「这一带可能有飞机」，
   * 而机头位置决定整架生死：泄漏一格 = 泄漏一条命。
   *
   * 出界的不进来（理论上布阵阶段已挡掉，这里只是兜底）：装饰带按「整架在盘内」推导。
   */
  myPlanes() {
    const out = []
    ;(this.myDeploy || []).forEach(function (p, i) {
      const abs = getAbsoluteCells(p.planeId, p.anchorRow, p.anchorCol, p.rotation)
      for (let k = 0; k < abs.length; k++) {
        const c = abs[k]
        if (c.row < 1 || c.row > BOARD_SIZE || c.col < 1 || c.col > BOARD_SIZE) return
      }
      out.push({ p: i, rotation: p.rotation, cells: abs })
    })
    return out
  }

  /* ---------------- 棋盘状态 ---------------- */

  myCells() {
    const m = createMatrix(BOARD_SIZE, '')
    ;(this.myDeploy || []).forEach(function (p, i) {
      const abs = getAbsoluteCells(p.planeId, p.anchorRow, p.anchorCol, p.rotation)
      // 自己的飞机自己当然看得见，机头单独标出（印序号 i+1），便于推演对方机头可能在的位置。
      // 身份色沿用布阵阶段的配色：布阵时第 2 架是青的，打到这里还是青的，
      // 于是「哪一架被打残了、还剩几架完好」一眼就知道，不用去数格子。
      abs.forEach(function (cell) {
        m[cell.row - 1][cell.col - 1] = { s: cell.isHead ? 'head' : 'plane', p: i }
      })
    })
    const inc = this.incoming || {}
    Object.keys(inc).forEach(function (k) {
      const parts = k.split(',')
      // 命中态直接用字符串覆盖：打中的格子要看「打成了什么」，不该再显示身份色
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
    // firing 期间不接受改选：这一炮还没回来就换目标，会出现
    // 「选中已经变了、飞出去的还是旧格」的错位
    if (!this.myTurn || this.finished || this.firing) return

    // 双击同一格 = 发射。必须**同格**且够快：
    // 先点 A 再点 B 是换目标，哪怕手速再快也不该开火。
    const now = Date.now()
    const prev = this._lastTap
    const dbl = !!prev && prev.row === row && prev.col === col &&
      (now - prev.at) <= DOUBLE_TAP_MS

    this.selected = { row: row, col: col }
    this.focus = 'foe'

    if (dbl) {
      this._lastTap = null   // 清掉，防连点三下打出两炮
      this.onFire()
      return
    }

    this._lastTap = { row: row, col: col, at: now }
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
    // 开火音：玩家点下、炮弹出膛时响一次（T17/规格 §2.9）。
    // 与通用 tap 音的叠加由 audio.js 的 tap↔fire 60ms 去抖吞掉。
    app.audio.play(AUDIO.SFX.FIRE)
    api.fire({ roomId: this.roomId, row: sel.row, col: sel.col }).then(function (res) {
      self.firing = false
      self.selected = null
      self.layout()
      // 结果音：唯一数据源是我方这一炮的服务端返回 res.result（T-08）。
      // 必须在结果回来后响，绝不提前；catch 分支不播结果音。
      if (RESULT_SFX[res.result]) app.audio.play(RESULT_SFX[res.result])
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
      planeCount: this.planeCount || 1,       // 我方架数
      foePlaneCount: this.foePlaneCount || 0    // 对方架数（拿不到时为 0）
    }
    this.app.replace('result')
  }
}

module.exports = function (app) { return new Battle(app) }
