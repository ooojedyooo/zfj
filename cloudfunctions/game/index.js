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
    data.battle = makeInitialBattle(players, players[firstIndex].openid)
  }

  await db.collection(ROOMS).doc(roomId).update({ data })

  return ok({ allReady, firstHand: allReady ? data.battle.turn : '' })
}

function makeInitialBattle(players, firstOpenid) {
  const marks = {}
  const incoming = {}
  const streak = {}
  const stats = {}
  players.forEach(p => {
    marks[p.openid] = {}
    incoming[p.openid] = {}
    streak[p.openid] = 0
    stats[p.openid] = { kill: 0, lost: 0, shots: 0 }
  })
  return {
    turn: firstOpenid,          // 当前轮到谁
    seq: 0,                     // 出手序号，客户端据此判断有更新
    lastMove: null,
    marks,                      // marks[A] = A 轰炸对手的记录
    incoming,                   // incoming[A] = A 自己棋盘上被炸的记录
    streak,                     // 连续超时次数
    stats,                      // stats[A] = { kill: 击毁对方架数, lost: 被击毁架数, shots: 出手次数 }
    finished: false,
    winner: '',
    endType: '',
    turnDeadline: Date.now() + TIMEOUT.TURN * 1000
  }
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

  const opponent = room.players.find(p => p.openid !== openid)
  if (!opponent) return fail('对手不存在', 'NO_OPPONENT')

  const game = await getGameDoc(roomId)
  if (!game) return fail('对局数据缺失', 'NO_GAME')

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

  const res = judge(index, row, col)

  // 更新击杀记录
  const killed = game.killed || {}
  killed[opponent.openid] = killed[opponent.openid] || []
  if (res.result === RESULT.KILL && !killed[opponent.openid].includes(res.planeNo)) {
    killed[opponent.openid].push(res.planeNo)
  }
  await db.collection(GAMES).doc(roomId).update({ data: { killed, updatedAt: Date.now() } })

  // 更新公开战况
  b.marks[openid][k] = res.result
  b.incoming[opponent.openid][k] = res.result
  b.seq += 1
  b.lastMove = { row, col, result: res.result, by: openid, at: Date.now() }
  b.streak[openid] = 0

  // 统计（供结算页展示）
  b.stats = b.stats || {}
  b.stats[openid] = {
    kill: killed[opponent.openid].length,
    lost: killed[openid].length,
    shots: Object.keys(b.marks[openid]).length
  }
  b.stats[opponent.openid] = {
    kill: killed[openid].length,
    lost: killed[opponent.openid].length,
    shots: Object.keys(b.marks[opponent.openid]).length
  }

  const win = isAllDestroyed(killed[opponent.openid], foeRaw.length)

  if (win) {
    b.finished = true
    b.winner = openid
    b.endType = END_TYPE.ALL_DESTROYED
  } else {
    // 严格交替：开完炮即换手
    b.turn = opponent.openid
    b.turnDeadline = Date.now() + TIMEOUT.TURN * 1000
  }

  const update = { battle: b, updatedAt: Date.now() }
  if (win) update.status = 'finished'
  await db.collection(ROOMS).doc(roomId).update({ data: update })

  return ok({
    result: res.result,
    destroyedCount: killed[opponent.openid].length,
    totalPlanes: foeRaw.length,
    win,
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

/* ---------------- 回合超时（T-02） ---------------- */
async function tick(event, openid) {
  const room = await mustGetRoom(event.roomId)
  if (!room || room.status !== 'battle' || !room.battle) return ok({ skipped: false })
  const b = room.battle
  if (b.finished) return ok({ skipped: false })

  // 未到截止时间，无需处理
  if (!b.turnDeadline || Date.now() < b.turnDeadline) return ok({ skipped: false })

  const loser = b.turn
  const opponent = room.players.find(p => p.openid !== loser)
  b.streak = b.streak || {}
  b.streak[loser] = (b.streak[loser] || 0) + 1

  if (b.streak[loser] >= MAX_TURN_TIMEOUT_STREAK) {
    b.finished = true
    b.winner = opponent ? opponent.openid : ''
    b.endType = END_TYPE.TIMEOUT
    await db.collection(ROOMS).doc(room._id).update({
      data: { battle: b, status: 'finished', updatedAt: Date.now() }
    })
    return ok({ skipped: false, finished: true, reason: 'timeout_streak' })
  }

  // 自动跳过该回合，交给对方
  b.turn = opponent ? opponent.openid : ''
  b.turnDeadline = Date.now() + TIMEOUT.TURN * 1000
  b.seq += 1
  b.lastMove = { skipped: true, by: loser, at: Date.now() }

  await db.collection(ROOMS).doc(room._id).update({ data: { battle: b, updatedAt: Date.now() } })
  return ok({ skipped: true })
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
    battle: room.battle,
    myDeploy,                 // 只返回「自己的」布阵，用于渲染我方海域
    myDestroyed: (game && game.killed && game.killed[openid]) ? game.killed[openid].length : 0,
    players: room.players.map(p => ({ openid: p.openid, ready: !!p.ready }))
  })
}
