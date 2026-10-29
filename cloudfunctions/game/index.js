// cloudfunctions/game/index.js
// 对局服务：布阵提交 / 就绪 / 开火判定 / 投降 / 回合超时 / 状态同步
//
// 【安全边界】本函数是本游戏唯一的"真相来源"：
//   - 双方布阵只存在于 games 集合，客户端无读权限
//   - 命中判定在服务端完成，客户端只收到"打中了/没打中/打爆了"
//   - 被击毁的飞机【绝不下发】其形状与朝向（PRD T-08）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const ROOMS = 'rooms'
const GAMES = 'games'

const { getAbsoluteCells, validatePlacement } = require('./shared/utils/plane')
const { buildIndex, judge, isAllDestroyed } = require('./shared/utils/judge')
const { key } = require('./shared/utils/board')
const { pickAutoTarget } = require('./shared/utils/room')
const {
  RESULT, BOARD_SIZE, MIN_PLANES, MAX_PLANES,
  TIMEOUT, MAX_TURN_TIMEOUT_STREAK, END_TYPE
} = require('./shared/config/rules')
const { EMOTE_LIST } = require('./shared/config/social')

const ok = (data) => ({ ok: true, data })
const fail = (msg, code) => ({ ok: false, msg: msg, code: code || 'ERROR' })

async function mustGetRoom(roomId) {
  if (!roomId) return null
  const doc = await db.collection(ROOMS).doc(roomId).get().catch(() => null)
  return doc && doc.data ? doc.data : null
}

async function getGameDoc(roomId) {
  const doc = await db.collection(GAMES).doc(roomId).get().catch(() => null)
  return doc && doc.data ? doc.data : null
}

function isPlayer(room, openid) {
  return !!room.players.find(p => p.openid === openid)
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  try {
    switch (event.action) {
      case 'deploy': return await deploy(event, OPENID)
      case 'fire': return await fire(event, OPENID)
      case 'emote': return await emote(event, OPENID)
      case 'surrender': return await surrender(event, OPENID)
      case 'tick': return await tick(event, OPENID)
      case 'sync': return await sync(event, OPENID)
      default: return fail('未知操作: ' + event.action)
    }
  } catch (e) {
    console.error('[game] error', e)
    return fail(e.message || '服务异常')
  }
}

/* ---------------- 提交布阵（服务端二次校验，防作弊） ---------------- */
async function deploy(event, openid) {
  const { roomId } = event
  const room = await mustGetRoom(roomId)
  if (!room) return fail('房间不存在', 'NOT_FOUND')
  if (room.status !== 'deploy') return fail('当前不是布阵阶段', 'BAD_STATE')
  if (!isPlayer(room, openid)) return fail('你不在该房间中', 'NOT_PLAYER')

  const list = Array.isArray(event.planes) ? event.planes : []
  if (list.length < MIN_PLANES || list.length > MAX_PLANES) {
    return fail('飞机数量需在 ' + MIN_PLANES + '~' + MAX_PLANES + ' 架之间', 'BAD_COUNT')
  }

  // 服务端重新校验一次：不信任客户端传来的格子
  let occupied = []
  const normalized = []
  for (const p of list) {
    const planeId = p.planeId || 'standard'
    const rotation = Number(p.rotation) || 0
    const anchorRow = Number(p.anchorRow)
    const anchorCol = Number(p.anchorCol)
    const cells = getAbsoluteCells(planeId, anchorRow, anchorCol, rotation)
    const check = validatePlacement(cells, occupied, BOARD_SIZE)
    if (!check.ok) return fail('布阵不合法（' + check.reason + '）', 'BAD_DEPLOY')
    occupied = occupied.concat(cells)
    normalized.push({ planeId, anchorRow, anchorCol, rotation })
  }

  // 写入私有集合 games（客户端读不到）
  const game = (await getGameDoc(roomId)) || { deploys: {}, killed: {}, ready: {} }
  game.deploys = game.deploys || {}
  game.killed = game.killed || {}
  game.ready = game.ready || {}
  game.deploys[openid] = normalized
  game.killed[openid] = game.killed[openid] || []
  game.ready[openid] = true

  const gameRef = db.collection(GAMES).doc(roomId)
  if (await getGameDoc(roomId)) {
    await gameRef.update({
      data: { deploys: game.deploys, killed: game.killed, ready: game.ready, updatedAt: Date.now() }
    })
  } else {
    await gameRef.set({
      data: {
        deploys: game.deploys, killed: game.killed, ready: game.ready,
        createdAt: Date.now(), updatedAt: Date.now()
      }
    })
  }

  // 更新房间：标记该玩家已就绪
  const players = room.players.map(p => (
    p.openid === openid ? Object.assign({}, p, { ready: true }) : p
  ))
  const allReady = players.length === 2 && players.every(p => p.ready)

  const data = { players, updatedAt: Date.now(), status: allReady ? 'battle' : 'deploy' }

  if (allReady) {
    // 双方就绪 → 开局，随机决定先手（T-01）
    const firstIndex = Math.random() < 0.5 ? 0 : 1
    data.battle = makeInitialBattle(
      players, players[firstIndex].openid, game.deploys, room.stepSeconds
    )
  }

  await db.collection(ROOMS).doc(roomId).update({ data })

  return ok({ allReady, firstHand: allReady ? data.battle.turn : '' })
}

function makeInitialBattle(players, firstOpenid, deploys, stepSeconds) {
  const marks = {}
  const incoming = {}
  const streak = {}
  const stats = {}
  // 各自的架数：架数已改为每人在布阵时决定，双方可能不同，
  // 所以「还剩几架」必须各算各的。只暴露数量，不暴露形状/朝向（T-08 不变）。
  const counts = {}
  players.forEach(p => {
    marks[p.openid] = {}
    incoming[p.openid] = {}
    streak[p.openid] = 0
    stats[p.openid] = { kill: 0, lost: 0, shots: 0 }
    counts[p.openid] = (deploys && deploys[p.openid] ? deploys[p.openid].length : 0)
  })
  const step = stepSeconds || TIMEOUT.TURN
  return {
    turn: firstOpenid,          // 当前轮到谁
    seq: 0,                     // 出手序号，客户端据此判断有更新
    lastMove: null,
    marks,                      // marks[A] = A 轰炸对手的记录
    incoming,                   // incoming[A] = A 自己棋盘上被炸的记录
    streak,                     // 连续超时次数
    stats,                      // stats[A] = { kill: 击毁对方架数, lost: 被击毁架数, shots: 出手次数 }
    counts,                     // counts[A] = A 本局放了几架（双方可能不同）
    stepSeconds: step,          // 本局每步限时（房主建房时定的，5~30s）
    finished: false,
    winner: '',
    endType: '',
    turnDeadline: Date.now() + step * 1000
  }
}

/* ---------------- 落炮核心（手动开火与超时自动轰炸共用） ---------------- */

/**
 * 把一炮落到棋盘上：判定 → 记击杀 → 换手 / 结算。
 *
 * 只改内存里的 battle 与 killed，落库交给调用方 —— fire 和 tick 的后续动作不同
 * （tick 还要判连续超时），共用一次落炮逻辑但各写各的库，避免「判两次、写两次」。
 */
function applyShot(o) {
  const room = o.room
  const game = o.game
  const shooter = o.shooter
  const b = room.battle

  const opponent = room.players.find(p => p.openid !== shooter)
  if (!opponent) return { error: 'NO_OPPONENT' }

  // 读取对手布阵并展开为绝对格位（仅服务端内存中操作）
  const foeRaw = game.deploys[opponent.openid] || []
  const deployed = foeRaw.map(p => ({
    planeId: p.planeId,
    anchorRow: p.anchorRow,
    anchorCol: p.anchorCol,
    rotation: p.rotation,
    cells: getAbsoluteCells(p.planeId, p.anchorRow, p.anchorCol, p.rotation)
  }))
  const { index } = buildIndex(deployed)

  const res = judge(index, o.row, o.col)

  // 击杀记录
  const killed = game.killed || {}
  killed[opponent.openid] = killed[opponent.openid] || []
  killed[shooter] = killed[shooter] || []
  if (res.result === RESULT.KILL && !killed[opponent.openid].includes(res.planeNo)) {
    killed[opponent.openid].push(res.planeNo)
  }

  // 公开战况
  const k = key(o.row, o.col)
  b.marks[shooter] = b.marks[shooter] || {}
  b.marks[shooter][k] = res.result
  b.incoming[opponent.openid] = b.incoming[opponent.openid] || {}
  b.incoming[opponent.openid][k] = res.result
  b.seq = (b.seq || 0) + 1
  b.lastMove = {
    row: o.row, col: o.col, result: res.result, by: shooter,
    at: Date.now(), auto: !!o.auto
  }

  // 手动出招清零连续超时；自动轰炸不清零（本来就该往上加）
  b.streak = b.streak || {}
  if (!o.auto) b.streak[shooter] = 0

  // 统计（供结算页展示）
  b.stats = b.stats || {}
  b.stats[shooter] = {
    kill: killed[opponent.openid].length,
    lost: killed[shooter].length,
    shots: Object.keys(b.marks[shooter]).length
  }
  b.stats[opponent.openid] = {
    kill: killed[shooter].length,
    lost: killed[opponent.openid].length,
    shots: Object.keys(b.marks[opponent.openid] || {}).length
  }

  const win = isAllDestroyed(killed[opponent.openid], foeRaw.length)
  const step = b.stepSeconds || TIMEOUT.TURN

  if (win) {
    b.finished = true
    b.winner = shooter
    b.endType = END_TYPE.ALL_DESTROYED
  } else {
    // 严格交替：开完炮即换手
    b.turn = opponent.openid
    b.turnDeadline = Date.now() + step * 1000
  }

  return {
    result: res.result,
    win,
    killed,
    destroyedCount: killed[opponent.openid].length,
    totalPlanes: foeRaw.length
  }
}

/** 把 applyShot 的结果落库（同步一炮需要写两个集合） */
async function persistShot(roomId, room, out) {
  if (out && out.killed) {
    await db.collection(GAMES).doc(roomId)
      .update({ data: { killed: out.killed, updatedAt: Date.now() } })
  }
  const update = { battle: room.battle, updatedAt: Date.now() }
  update.status = room.battle.finished ? 'finished' : 'battle'
  await db.collection(ROOMS).doc(roomId).update({ data: update })
}

/* ---------------- 开火 ---------------- */
async function fire(event, openid) {
  const { roomId } = event
  const row = Number(event.row)
  const col = Number(event.col)

  if (!(row >= 1 && row <= BOARD_SIZE && col >= 1 && col <= BOARD_SIZE)) {
    return fail('坐标超出棋盘范围', 'BAD_COORD')
  }

  const room = await mustGetRoom(roomId)
  if (!room) return fail('房间不存在', 'NOT_FOUND')
  if (room.status !== 'battle' || !room.battle) return fail('对局尚未开始', 'BAD_STATE')

  const b = room.battle
  if (b.finished) return fail('对局已结束', 'FINISHED')
  if (b.turn !== openid) return fail('还没轮到你出手', 'NOT_YOUR_TURN')

  const k = key(row, col)
  if (b.marks[openid] && b.marks[openid][k]) {
    return fail('该坐标已轰炸过', 'REPEATED')   // 服务端兜底（PRD BAT-09）
  }

  const game = await getGameDoc(roomId)
  if (!game) return fail('对局数据缺失', 'NO_GAME')

  const out = applyShot({ room, game, shooter: openid, row, col, auto: false })
  if (out.error) return fail('对手不存在', 'NO_OPPONENT')

  await persistShot(roomId, room, out)

  return ok({
    result: out.result,
    destroyedCount: out.destroyedCount,
    totalPlanes: out.totalPlanes,
    win: out.win,
    turn: b.turn,
    seq: b.seq
  })
}

/* ---------------- 快捷表情（局内社交，本期同步做） ---------------- */
// 仅允许在对局进行中发送；表情写入 battle.emote，双方通过 watch 实时收到。
// 采用「白名单 + 递增 seq」：白名单防止任意字符串注入，seq 供客户端去重。
async function emote(event, openid) {
  const room = await mustGetRoom(event.roomId)
  if (!room) return fail('房间不存在', 'NOT_FOUND')
  if (!isPlayer(room, openid)) return fail('你不在该房间中', 'NOT_PLAYER')
  if (!room.battle) return fail('对局尚未开始', 'BAD_STATE')
  if (room.battle.finished) return fail('对局已结束', 'FINISHED')

  const emoji = String(event.emoji || '')
  if (EMOTE_LIST.indexOf(emoji) < 0) return fail('不支持的表情', 'BAD_EMOJI')

  const b = room.battle
  b.seq = (b.seq || 0) + 1
  b.emote = { by: openid, emoji, at: Date.now(), seq: b.seq }

  await db.collection(ROOMS).doc(event.roomId).update({
    data: { battle: b, updatedAt: Date.now() }
  })
  return ok({ seq: b.seq })
}

/* ---------------- 投降（T-07） ---------------- */
async function surrender(event, openid) {
  const room = await mustGetRoom(event.roomId)
  if (!room) return fail('房间不存在', 'NOT_FOUND')
  if (!room.battle || room.battle.finished) return fail('对局已结束', 'FINISHED')

  const opponent = room.players.find(p => p.openid !== openid)
  const b = room.battle
  b.finished = true
  b.winner = opponent ? opponent.openid : ''
  b.endType = END_TYPE.SURRENDER

  await db.collection(ROOMS).doc(event.roomId).update({
    data: { battle: b, status: 'finished', updatedAt: Date.now() }
  })
  return ok({})
}

/* ---------------- 回合超时（T-02 修订：不再跳过，改为自动轰炸） ---------------- */
//
// 旧行为「跳过回合」的毛病：两个人都不动时，棋局靠超时永远推不完；
// 而且挂机只要熬过 3 次就输，中间那几炮等于白送。
//
// 现在：超时 = 替这名玩家按「从上到下、从左到右」打第一格没炸过的位置。
//   ① 棋局一定往前走，不会僵住
//   ② 落点是确定的，超时代价可预期、可复盘（不是随机，随机等于赌）
//   ③ 连续超时 5 次判负，挂机赢不了
async function tick(event) {
  const room = await mustGetRoom(event.roomId)
  if (!room || room.status !== 'battle' || !room.battle) return ok({ skipped: false })
  const b = room.battle
  if (b.finished) return ok({ skipped: false })

  // 未到截止时间，无需处理
  if (!b.turnDeadline || Date.now() < b.turnDeadline) return ok({ skipped: false })

  const loser = b.turn
  b.streak = b.streak || {}
  b.streak[loser] = (b.streak[loser] || 0) + 1

  const game = await getGameDoc(event.roomId)
  if (!game) return fail('对局数据缺失', 'NO_GAME')

  const target = pickAutoTarget(b.marks[loser])
  const seqBefore = b.seq || 0
  let out = null
  if (target) {
    out = applyShot({ room, game, shooter: loser, row: target.row, col: target.col, auto: true })
    if (out.error) return fail('对手不存在', 'NO_OPPONENT')
  }

  const streak = b.streak[loser]
  let finished = false
  if (!b.finished && streak >= MAX_TURN_TIMEOUT_STREAK) {
    // 先让这一炮落地（万一这一炮炸中机头，那也是本局最后一炮），再判负
    const opponent = room.players.find(p => p.openid !== loser)
    b.finished = true
    b.winner = opponent ? opponent.openid : ''
    b.endType = END_TYPE.TIMEOUT
    finished = true
  }

  // 乐观锁：双方的客户端都会在到点时各发一次 tick。
  // 用 seq 做版本号，只有一个能匹配上，另一次 update 落空 → 不会重复轰炸。
  const upd = await db.collection(ROOMS)
    .where({ _id: room._id, 'battle.seq': seqBefore })
    .update({
      data: { battle: b, status: b.finished ? 'finished' : 'battle', updatedAt: Date.now() }
    })

  if (!upd.stats || !upd.stats.updated) return ok({ skipped: false, stale: true })

  if (out) {
    await db.collection(GAMES).doc(event.roomId)
      .update({ data: { killed: out.killed, updatedAt: Date.now() } })
      .catch(() => {})
  }

  return ok({
    skipped: false,
    auto: true,
    row: target ? target.row : 0,
    col: target ? target.col : 0,
    result: out ? out.result : '',
    streak: streak,
    finished: finished,
    reason: finished ? 'timeout_streak' : ''
  })
}

/* ---------------- 状态同步（含"我自己的布阵"） ---------------- */
async function sync(event, openid) {
  const room = await mustGetRoom(event.roomId)
  if (!room) return fail('房间不存在', 'NOT_FOUND')

  const game = await getGameDoc(event.roomId)
  const myDeploy = (game && game.deploys && game.deploys[openid]) || []

  return ok({
    myOpenid: openid,         // 客户端用它从 battle.marks / battle.incoming 中取自己的视图
    status: room.status,
    roomName: room.roomName || '',
    stepSeconds: room.stepSeconds || TIMEOUT.TURN,
    battle: room.battle,
    myDeploy,                 // 只返回「自己的」布阵，用于渲染我方海域
    myDestroyed: (game && game.killed && game.killed[openid]) ? game.killed[openid].length : 0,
    players: room.players.map(p => ({ openid: p.openid, ready: !!p.ready }))
  })
}
