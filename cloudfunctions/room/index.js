// cloudfunctions/room/index.js
// 房间服务：创建 / 加入 / 随机匹配 / 查询 / 退出
//
// 数据分工：
//   rooms  集合 —— 公开视图，客户端可读（用于实时 watch）
//   games  集合 —— 含双方布阵，仅管理端可读写（客户端读不到，T-08 保障）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const ROOMS = 'rooms'
const GAMES = 'games'

const { MIN_PLANES, MAX_PLANES, TIMEOUT } = require('./shared/config/rules')

const ok = (data) => ({ ok: true, data })
const fail = (msg, code) => ({ ok: false, msg: msg, code: code || 'ERROR' })

/** 房间号限制在 1~3 架 */
function clampPlanes(n) {
  const v = Number(n) || MIN_PLANES
  return Math.min(MAX_PLANES, Math.max(MIN_PLANES, v))
}

/** 生成不重复的 6 位房间号 */
async function genRoomNo() {
  for (let i = 0; i < 12; i++) {
    const no = String(Math.floor(100000 + Math.random() * 900000))
    const existed = await db.collection(ROOMS).where({ roomNo: no }).count()
    if (existed.total === 0) return no
  }
  throw new Error('房间号生成失败，请重试')
}

/** 发给客户端的脱敏视图 */
function sanitize(room) {
  const r = Object.assign({}, room)
  delete r.password
  delete r.expireAt
  return r
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  try {
    switch (event.action) {
      case 'create': return await createRoom(event, OPENID)
      case 'join': return await joinRoom(event, OPENID)
      case 'match': return await matchRoom(event, OPENID)
      case 'get': return await getRoom(event, OPENID)
      case 'leave': return await leaveRoom(event, OPENID)
      default: return fail('未知操作: ' + event.action)
    }
  } catch (e) {
    console.error('[room] error', e)
    return fail(e.message || '服务异常')
  }
}

/* ---------------- 创建房间 ---------------- */
async function createRoom(event, openid) {
  const planeCount = clampPlanes(event.planeCount)
  const password = event.password ? String(event.password).slice(0, 4) : ''
  const roomNo = await genRoomNo()
  const now = Date.now()

  const res = await db.collection(ROOMS).add({
    data: {
      roomNo,
      password,
      isPublic: !password,
      planeCount,
      status: 'waiting',                      // waiting | deploy | battle | finished
      players: [{ openid, ready: false, joinedAt: now }],
      battle: null,
      createdAt: now,
      updatedAt: now,
      expireAt: now + TIMEOUT.ROOM * 1000      // 房间超时（T-10）
    }
  })

  return ok({ roomId: res._id, roomNo, password, planeCount, matched: false })
}

/* ---------------- 加入房间 ---------------- */
async function joinRoom(event, openid) {
  const roomNo = String(event.roomNo || '').trim()
  if (!/^\d{6}$/.test(roomNo)) return fail('房间号格式不正确', 'BAD_ROOM_NO')

  const found = await db.collection(ROOMS).where({ roomNo }).limit(1).get()
  if (!found.data.length) return fail('房间不存在', 'NOT_FOUND')
  const room = found.data[0]

  // 幂等：已在房间内直接返回
  if (room.players.some(p => p.openid === openid)) {
    return ok({ roomId: room._id, roomNo: room.roomNo, planeCount: room.planeCount })
  }
  if (room.status !== 'waiting') return fail('该房间已开始对局', 'STARTED')
  if (room.players.length >= 2) return fail('房间已满', 'FULL')
  if (room.password && String(event.password || '') !== room.password) {
    return fail('密码错误，请重新输入', 'WRONG_PASSWORD')   // PRD ROOM-05
  }

  await addPlayer(room, openid)
  return ok({ roomId: room._id, roomNo: room.roomNo, planeCount: room.planeCount })
}

/* ---------------- 随机匹配 ---------------- */
async function matchRoom(event, openid) {
  const planeCount = clampPlanes(event.planeCount)

  // 1) 优先撮合已有的公开房
  const pool = await db.collection(ROOMS)
    .where({ isPublic: true, status: 'waiting' })
    .orderBy('createdAt', 'asc')
    .limit(20)
    .get()

  const target = pool.data.find(r =>
    r.players.length < 2 && !r.players.some(p => p.openid === openid)
  )

  if (target) {
    await addPlayer(target, openid)
    return ok({
      roomId: target._id,
      roomNo: target.roomNo,
      planeCount: target.planeCount,
      matched: true
    })
  }

  // 2) 没有可加入的房，则自己开一间公开房等待
  const created = await createRoom({ planeCount, password: '' }, openid)
  return ok(created.data)
}

/** 追加玩家；凑满两人即进入布阵阶段 */
async function addPlayer(room, openid) {
  const players = room.players.concat([{ openid, ready: false, joinedAt: Date.now() }])
  const data = { players, updatedAt: Date.now() }

  if (players.length >= 2) {
    data.status = 'deploy'   // 双方就位，进入布阵（PRD ROOM-08）
  }
  await db.collection(ROOMS).doc(room._id).update({ data })
}

/* ---------------- 查询房间 ---------------- */
async function getRoom(event, openid) {
  const doc = await db.collection(ROOMS).doc(event.roomId).get().catch(() => null)
  if (!doc || !doc.data) return fail('房间不存在', 'NOT_FOUND')
  return ok(sanitize(doc.data))
}

/* ---------------- 离开 / 解散 ---------------- */
async function leaveRoom(event, openid) {
  const doc = await db.collection(ROOMS).doc(event.roomId).get().catch(() => null)
  if (!doc || !doc.data) return ok({})

  const room = doc.data
  const remain = room.players.filter(p => p.openid !== openid)

  if (remain.length === 0) {
    // 最后一人离开：清理房间与对局数据
    await db.collection(ROOMS).doc(room._id).remove().catch(() => {})
    await db.collection(GAMES).doc(room._id).remove().catch(() => {})
  } else {
    // 对局中退出：判负（PRD END-04）
    const data = { players: remain, updatedAt: Date.now() }
    if (room.status === 'battle' && room.battle && !room.battle.finished) {
      const battle = Object.assign({}, room.battle)
      battle.finished = true
      battle.winner = remain[0].openid
      battle.endType = 'surrender'
      data.battle = battle
    }
    data.status = 'finished'
    await db.collection(ROOMS).doc(room._id).update({ data })
  }

  return ok({})
}
