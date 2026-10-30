// services/localGame.js
// 本地对局引擎 —— 【仅供本地调试 / 单机验证核心逻辑】
//
// 说明：MVP 尚未接入后端。本模块在本地内存中模拟「一名对手」，
// 使布阵、报点、判定、胜负等完整闭环可以离线跑通。
//
// TODO(V2)：替换为真实联机实现（云开发实时数据库 watch 或自建 WebSocket 服务），
//           对外接口保持一致：createRoom / deploy / fire / onFire / endTurn。

const { getAbsoluteCells, randomDeploy, validatePlacement, isInside } = require('../utils/plane')
const { buildIndex, judge, isAllDestroyed } = require('../utils/judge')
const { RESULT, BOARD_SIZE, END_TYPE } = require('../config/rules')
const { key } = require('../utils/board')
const aiTune = require('./aiTune')

// ── 离线 AI 的两个强度旋钮 ──
// 原来这里是两个写死的常量，改一次要重传代码包，测试期根本没法试手感。
// 现在收进 services/aiTune.js：默认值仍写在那里，但大厅里有个调节页可以实时改，
// 改完下一炮就生效（参数在 _foePickTarget / _densityPick 里现读，不做实例快照）。
// 只影响单机试玩 —— 联机对手是真人，碰不到这段。
//
// HEAD_WEIGHT 机头格在密度计算里的权重。1 = 不打折、纯看可能性；
//             调高会让它更执着于「猜机头」，但也会显得过于精准。
// SLIP_RATE   走神概率：这一炮不走推理，退回「摸四邻」的笨办法。
//             0 是满血碾压（实测 1 架 8 炮），太高又显得蠢。

/** 生成 6 位房间号 */
function genRoomId() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

/**
 * 本地对局实例
 * @param {Object} options { planeCount, firstHand }
 */
class LocalGame {
  constructor(options = {}) {
    this.roomId = genRoomId()
    this.planeCount = options.planeCount || 1
    // 先手随机（对应 T-01）；true 表示本机先手
    this.myTurn = options.firstHand === undefined ? Math.random() < 0.5 : options.firstHand

    this.myDeployed = []     // 我方布阵
    this.foeDeployed = []    // 对手布阵（本地模拟）
    this.myIndex = null
    this.foeIndex = null
    this.myKilled = []       // 对手击毁了我方哪些飞机
    this.foeKilled = []      // 我方击毁了对手哪些飞机

    this.myProbes = {}       // 我方轰炸过的格位：key -> 'miss'|'hit'|'kill'
    this.foeProbes = {}      // 对手轰炸我方的格位
    this._foeHunt = {}       // 对手「正在追」的线索格（打中机身、还没摸到机头）
    this.myShots = 0
    this.foeShots = 0
    this.finished = false
    this.winner = null       // 'me' | 'foe'
    this.endType = null
  }

  /** 本机布阵 */
  deploy(planes) {
    this.myDeployed = planes
    this.myIndex = buildIndex(planes)
    return this
  }

  /** 对手（本地模拟）自动布阵 */
  deployFoe() {
    this.foeDeployed = randomDeploy(this.planeCount, 'standard', BOARD_SIZE)
    this.foeIndex = buildIndex(this.foeDeployed)
    return this
  }

  /** 我方开火 */
  fire(row, col) {
    const k = key(row, col)
    if (this.myProbes[k]) {
      return { ok: false, reason: 'repeated' } // 界面层已杜绝，此处为兜底（PRD BAT-09）
    }
    const res = judge(this.foeIndex.index, row, col)
    this.myProbes[k] = res.result
    this.myShots += 1

    if (res.result === RESULT.KILL && !this.foeKilled.includes(res.planeNo)) {
      this.foeKilled.push(res.planeNo)
    }

    const win = isAllDestroyed(this.foeKilled, this.foeDeployed.length)
    if (win) this._end('me', END_TYPE.ALL_DESTROYED)

    // 严格交替：开完炮就换手（对应 T-02 之前的「严格交替」决策）
    if (!win) this.myTurn = false

    return { ok: true, result: res.result, win }
  }

  /**
   * 对手行动（本地模拟）
   * 策略：优先追打已命中飞机的相邻格，否则随机打未炸过的格
   */
  foeFire() {
    const target = this._foePickTarget()
    if (!target) return null

    const res = judge(this.myIndex.index, target.row, target.col)
    const k = key(target.row, target.col)
    this.foeProbes[k] = res.result
    this.foeShots += 1

    // 「正在追的线索」：打中机身就记下来，击毁一架就清空、重新开始搜下一架。
    // 为什么要清空：击毁后，那些旧的 HIT 格里有一部分属于这架已死的飞机，
    // 但游戏规则不告诉你是哪几格。继续围着它们打就是白费炮。
    // 清空意味着「这架解决了，剩下的按已知信息重新推」。
    if (res.result === RESULT.HIT) {
      this._foeHunt[k] = true
    }
    if (res.result === RESULT.KILL) {
      this._foeHunt = {}
    }

    if (res.result === RESULT.KILL && !this.myKilled.includes(res.planeNo)) {
      this.myKilled.push(res.planeNo)
    }

    const lose = isAllDestroyed(this.myKilled, this.myDeployed.length)
    if (lose) this._end('foe', END_TYPE.ALL_DESTROYED)
    if (!lose) this.myTurn = true

    return { row: target.row, col: target.col, result: res.result, lose }
  }

  /** 投降（T-07） */
  surrender() {
    this._end('foe', END_TYPE.SURRENDER)
    return this
  }

  /** 本机还可炸的第一个空格（从上到下、从左到右）—— 超时自动轰炸用 */
  firstEmptyTarget() {
    for (let row = 1; row <= BOARD_SIZE; row++) {
      for (let col = 1; col <= BOARD_SIZE; col++) {
        if (!this.myProbes[key(row, col)]) return { row, col }
      }
    }
    return null
  }

  /**
   * 超时自动轰炸：替玩家按固定顺序打一炮
   * 复用 fire()，所以命中判定、击毁、换手、胜负与手动出招完全一致
   */
  autoFire() {
    const t = this.firstEmptyTarget()
    if (!t) return null
    const res = this.fire(t.row, t.col)
    return { row: t.row, col: t.col, result: res.result, win: !!res.win }
  }

  _end(winner, endType) {
    this.finished = true
    this.winner = winner
    this.endType = endType
  }

  /**
   * 对手选点
   *
   * 分两层：大部分时候按概率密度推（聪明），偶尔退回「摸四邻」的老办法（走神）。
   *
   * 【为什么不干脆全用密度法】实测密度法打 1 架只要 8 炮、3 架 21 炮
   * （旧实现是 15 / 44），已经远超普通人类玩家，玩起来像被机器碾压。
   * 掺进 20% 的「笨招」，平均用炮回到 11 / 28 一线：
   * 比人稍强一点、会犯错、有破绽可抓 —— 这才是陪练该有的手感。
   */
  _foePickTarget() {
    // 每炮现读，不在构造函数里快照 —— 在调节页改完，退出后这一炮就该按新参数走
    if (Math.random() < aiTune.get().slipRate) {
      return this._naivePick() || this._densityPick() || this._randomPick()
    }
    return this._densityPick() || this._randomPick()
  }

  /**
   * 概率密度：枚举所有「与已知结果不矛盾」的摆放，看哪些格被最多可能摆放覆盖。
   *
   * 早先的实现是「命中就摸四邻」，但无记忆 —— 不知道刚摸的是哪个方向，
   * 也不知道哪个方向已经打空。推进一格要浪费 3 炮，打一架要 15 炮。
   *
   * 为什么这算公平：飞机形状是公开信息（布阵时玩家自己就在按这个形状摆），
   * 真人对战双方都知道。用形状反推位置，正是人类玩家在做的事。
   */
  _densityPick() {
    const known = this.foeProbes
    const hunt = this._foeHunt || {}
    const hunting = Object.keys(hunt).length > 0
    const headWeight = aiTune.get().headWeight
    const score = {}          // key -> 权重累计

    for (let r = 1; r <= BOARD_SIZE; r++) {
      for (let c = 1; c <= BOARD_SIZE; c++) {
        for (let rot = 0; rot < 4; rot++) {
          const cells = getAbsoluteCells('standard', r, c, rot)
          if (!isInside(cells, BOARD_SIZE)) continue

          // 这个摆放是否还与已知结果相容？
          //   MISS → 这格是空的，摆放不能占
          //   KILL → 该格已属于一架被击毁的飞机，摆放也不能占（不允许重叠）
          let fits = true
          let covHits = 0
          for (let i = 0; i < cells.length; i++) {
            const k = key(cells[i].row, cells[i].col)
            const v = known[k]
            if (v === RESULT.MISS || v === RESULT.KILL) { fits = false; break }
            if (hunt[k]) covHits++
          }
          if (!fits) continue

          // 【关键】手里有一条没解开的线索时，不覆盖它的摆放直接排除。
          // 早先只给它一个低权重（w=1），结果这些「纯属还没被排除」的摆放
          // 数量多、面积大，累加之后反而盖过了真正的机头候选 ——
          // 1 架局因此几乎没提升（15.00 → 14.22）。硬排除之后才有意义。
          if (hunting && covHits === 0) continue

          // 命中越多，这条线索越长越可信，权重越高
          const w = covHits > 0 ? 6 + covHits * 3 : 1

          for (let i = 0; i < cells.length; i++) {
            const cell = cells[i]
            const k = key(cell.row, cell.col)
            if (known[k]) continue          // 已经打过的格不用再打
            score[k] = (score[k] || 0) + w * (cell.isHead ? headWeight : 1)
          }
        }
      }
    }

    return this._pickByScore(score)
  }

  /**
   * 笨招 —— 改造之前那套完整策略：有线索就摸四邻（无记忆），没线索就全局随机撒网
   *
   * 【不能在没有线索时返回 null】早先这里 return null，靠 `_naivePick() || _densityPick()`
   * 兜底，看似安全，实际把「走神」削成了「只在追线索时走神」：
   * 一局里绝大部分炮都发生在「还没打中任何东西」的搜寻阶段，那一段全部落回密度法。
   * 实测走神率 0.10 的平均用炮（11.08）反而比 0.35（10.51）更多 —— 旋钮不单调，
   * 滑块中间那些档位就是噪音，玩家拖来拖去只会觉得「没规律」。
   * 真正的笨办法必须包含「没线索就瞎撒网」，这才是旧 AI 的完整行为。
   */
  _naivePick() {
    // 只看「正在追的线索」，不看全部历史命中 ——
    // 已经击毁的那架留下的 HIT 格还在 foeProbes 里，围着它们打是纯浪费。
    const hunt = this._foeHunt || {}
    const hits = Object.keys(hunt).map(k => k.split(',').map(Number))

    for (const [r, c] of hits) {
      const neighbors = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
      for (const [nr, nc] of neighbors) {
        if (nr < 1 || nr > BOARD_SIZE || nc < 1 || nc > BOARD_SIZE) continue
        if (this.foeProbes[key(nr, nc)]) continue
        return { row: nr, col: nc }
      }
    }
    return this._randomPick()
  }

  /**
   * 按权重选点
   *
   * 不直接取最大值：那样每局走法完全一致、显得机械，玩家能摸出套路。
   * 也不做全局加权抽样：权重差距会被拉平，机头候选的优势就没了
   * （试过，1 架局只提升 5%）。
   * 折中 —— 在「接近最高分」的候选里随机。既保住方向，又保留变数。
   */
  _pickByScore(score) {
    const keys = Object.keys(score)
    if (!keys.length) return null

    let max = 0
    for (let i = 0; i < keys.length; i++) {
      if (score[keys[i]] > max) max = score[keys[i]]
    }

    const top = keys.filter(function (k) { return score[k] >= max * 0.6 })
    const picked = top[Math.floor(Math.random() * top.length)].split(',').map(Number)
    return { row: picked[0], col: picked[1] }
  }

  /** 兜底：从未轰炸过的格子里均匀随机挑一个 */
  _randomPick() {
    const candidates = []
    for (let r = 1; r <= BOARD_SIZE; r++) {
      for (let c = 1; c <= BOARD_SIZE; c++) {
        if (!this.foeProbes[key(r, c)]) candidates.push({ row: r, col: c })
      }
    }
    if (!candidates.length) return null
    return candidates[Math.floor(Math.random() * candidates.length)]
  }
}

module.exports = { LocalGame, genRoomId }
