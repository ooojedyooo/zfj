// cloudfunctions/room/index.js
// 房间服务：创建 / 加入 / 随机匹配 / 列表 / 搜索 / 查询 / 退出
//
// 数据分工（T-08 同一条思路，这次把密码也纳进来）：
//   rooms  集合 —— 公开视图，客户端可读可 watch
//                  ⚠️ 所以这里绝不能放密码明文：客户端能直接读到
//                  密码放 games.meta，rooms 只留 hasPassword 布尔
//   games  集合 —— 含双方布阵 + 房间密码，仅管理端可读写
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command

const ROOMS = 'rooms'
const GAMES = 'games'

const { TIMEOUT } = require('./shared/config/rules')
const { clampPlaneCount, clampStepSeconds, normalizeRoomName } = require('./shared/utils/room')

const ok = (data) => ({ ok: true, data })
const fail = (msg, code) => ({ ok: false, msg: msg, code: code || 'ERROR' })

/** 正则元字符转义：房间名是用户输入，直接拼进 RegExp 会被 '.*' 之类的串打穿 */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
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

/** 列表项：只给列表页要显示的那几个字段，别把整份房间文档推给客户端 */
function listItem(room) {
  return {
    roomId: room._id,
    roomNo: room.roomNo,
    roomName: room.roomName || '未命名房间',
    // 架数必须给：玩家在列表上就要知道这一局打多大，不然点进去才发现不是想要的
    planeCount: clampPlaneCount(room.planeCount),
    stepSeconds: room.stepSeconds || 30,
    hasPassword: !!room.hasPassword,
    players: (room.players || []).length,
    createdAt: room.createdAt || 0
  }
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext()
  try {
    switch (event.action) {
      case 'create': return await createRoom(event, OPENID)
      case 'join': return await joinRoom(event, OPENID)
      case 'match': return await matchRoom(event, OPENID)
      case 'list': return await listRooms(event, OPENID)
      case 'search': return await searchRooms(event, OPENID)
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
  const planeCount = clampPlaneCount(event.planeCount)
  const password = event.password ? String(event.password).slice(0, 4) : ''
  const hasPassword = !!password
  const roomName = normalizeRoomName(event.roomName, '我的房间')
  const stepSeconds = clampStepSeconds(event.stepSeconds)
  const roomNo = await genRoomNo()
  const now = Date.now()

  const res = await db.collection(ROOMS).add({
    data: {
      roomNo,
      roomName,
      stepSeconds,                            // 本局每步限时（5~30s，T-05 修订）
      hasPassword,                            // 只告诉客户端「有没有密码」，不给密码本身
      isPublic: !hasPassword,
      planeCount,
      status: 'waiting',                      // waiting | deploy | battle | finished
      players: [{ openid, ready: false, joinedAt: now }],
      battle: null,
      createdAt: now,
      updatedAt: now,
      expireAt: now + TIMEOUT.ROOM * 1000      // 房间超时（T-10）
    }
  })

  // 密码写进私有集合：rooms 客户端可读，密码一旦写进去等于公开
  await db.collection(GAMES).doc(res._id).set({
    data: { meta: { password }, createdAt: now, updatedAt: now }
  }).catch(() => { /* 旧环境 games 未初始化时忽略，join 侧会按「无密码」处理 */ })

  return ok({
    roomId: res._id, roomNo, roomName, stepSeconds,
    hasPassword, planeCount, matched: false
  })
}

/* ---------------- 公开房间列表 ---------------- */
async function listRooms() {
  const res = await db.collection(ROOMS)
    .where({ isPublic: true, status: 'waiting' })
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get()
  return ok({ rooms: res.data.map(listItem) })
}

/* ---------------- 按房间名搜索（公开 + 私密都搜） ---------------- */
// 私密房也要能被搜到 —— 房名不是秘密，密码才是。
// 搜不到私密房的话，「按名字找朋友那局」这个入口就废了。
async function searchRooms(event) {
  const kw = String(event.keyword || '').trim().slice(0, 20)
  if (!kw) return ok({ rooms: [] })

  const res = await db.collection(ROOMS)
    .where({
      status: 'waiting',
      roomName: db.RegExp({ regexp: escapeRegExp(kw), options: 'i' })
    })
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get()
  return ok({ rooms: res.data.map(listItem) })
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
    return ok({
      roomId: room._id, roomNo: room.roomNo, roomName: room.roomName,
      stepSeconds: room.stepSeconds, hasPassword: !!room.hasPassword,
      planeCount: room.planeCount
    })
  }
  if (room.status !== 'waiting') return fail('该房间已开始对局', 'STARTED')
  if (room.players.length >= 2) return fail('房间已满', 'FULL')

  if (room.hasPassword) {
    const meta = await getPassword(room._id)
    if (String(event.password || '') !== meta) {
      return fail('密码错误，请重新输入', 'WRONG_PASSWORD')   // PRD ROOM-05
    }
  }

  await addPlayer(room, openid)
  return ok({
    roomId: room._id, roomNo: room.roomNo, roomName: room.roomName,
    stepSeconds: room.stepSeconds, hasPassword: !!room.hasPassword,
    planeCount: room.planeCount
  })
}

/** 从私有集合取密码；读不到按空密码处理（旧房间没有这个字段） */
async function getPassword(roomId) {
  const doc = await db.collection(GAMES).doc(roomId).get().catch(() => null)
  return (doc && doc.data && doc.data.meta && doc.data.meta.password) || ''
}

/* ---------------- 随机匹配 ---------------- */
/**
 * 匹配**同架数**的房间。
 *
 * 架数不能事后改：它决定了这一局多大，布阵还要按它摆满。
 * 所以「想打 1 架」和「想打 3 架」是两个池子，不能拿 3 架的房去凑 1 架的人。
 */
async function matchRoom(event, openid) {
  const planeCount = clampPlaneCount(event.planeCount)

  // 1) 优先撮合已有的公开房（同架数、还在等人）
  const pool = await db.collection(ROOMS)
    .where({ isPublic: true, status: 'waiting', planeCount })
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
      roomName: target.roomName,
      stepSeconds: target.stepSeconds,
      hasPassword: !!target.hasPassword,
      planeCount: target.planeCount,
      matched: true
    })
  }

  // 2) 没有可加入的房，则自己开一间公开房等待
  //    匹配到的房沿用对方的单步时限 —— 那是这一局的规则，不能各算各的
  const created = await createRoom({
    planeCount,
    password: '',
    roomName: event.roomName || '随机匹配的房间',
    stepSeconds: event.stepSeconds
  }, openid)
  return ok(Object.assign({}, created.data, { matched: false }))
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
