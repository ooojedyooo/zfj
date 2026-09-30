// services/localGame.js
// 本地对局引擎 —— 【仅供本地调试 / 单机验证核心逻辑】
//
// 说明：MVP 尚未接入后端。本模块在本地内存中模拟「一名对手」，
// 使布阵、报点、判定、胜负等完整闭环可以离线跑通。
//
// TODO(V2)：替换为真实联机实现（云开发实时数据库 watch 或自建 WebSocket 服务），
//           对外接口保持一致：createRoom / deploy / fire / onFire / endTurn。

const { getAbsoluteCells, randomDeploy, validatePlacement } = require('../utils/plane')
const { buildIndex, judge, isAllDestroyed } = require('../utils/judge')
const { RESULT, BOARD_SIZE, END_TYPE } = require('../config/rules')
const { key } = require('../utils/board')

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
    this.foeProbes[key(target.row, target.col)] = res.result
    this.foeShots += 1

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

  _end(winner, endType) {
    this.finished = true
    this.winner = winner
    this.endType = endType
  }

  _foePickTarget() {
    // 1) 追打：找任意一个 hit（非击毁）格，打其上下左右未炸过的邻居
    const hits = Object.keys(this.foeProbes)
      .filter(k => this.foeProbes[k] === RESULT.HIT)
      .map(k => k.split(',').map(Number))

    for (const [r, c] of hits) {
      const neighbors = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
      for (const [nr, nc] of neighbors) {
        if (nr < 1 || nr > BOARD_SIZE || nc < 1 || nc > BOARD_SIZE) continue
        if (this.foeProbes[key(nr, nc)]) continue
        return { row: nr, col: nc }
      }
    }

    // 2) 随机：从未轰炸过的格子中挑一个
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
