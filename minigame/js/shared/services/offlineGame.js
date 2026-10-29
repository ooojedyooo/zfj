// services/offlineGame.js
// 离线模拟引擎（USE_CLOUD = false 时启用）
//
// 目的：没有配置云环境时，也能完整跑通「大厅 → 房间 → 布阵 → 对战 → 结算」，
//      对手由本地引擎模拟。对外接口与 cloudApi 完全一致，页面代码无需区分。
//
// 注意：本模块是纯逻辑实现，不依赖任何小程序 API，可用 Node 直接测试。
const { LocalGame, genRoomId } = require('./localGame')
const { getAbsoluteCells } = require('../utils/plane')
const { TIMEOUT, MAX_TURN_TIMEOUT_STREAK } = require('../config/rules')
const { clampPlaneCount, clampStepSeconds, normalizeRoomName } = require('../utils/room')
const { EMOTE_LIST } = require('../config/social')

const ME = 'me'
const FOE = 'foe'

// 离线演示用的「别人的房间」。
// 离线模式没有真的服务端，但「浏览公开房间 / 按名字搜私密房」这两个入口
// 必须有内容可看，否则整页空白，玩家会以为功能坏了。
// 私密房示例密码统一 8888 —— 页面底部会写出来，不然离线时没人知道该输什么。
const MOCK_ROOMS = [
  { roomNo: '204815', roomName: '老周的飞行中队', planeCount: 3, stepSeconds: 20, hasPassword: false },
  { roomNo: '611902', roomName: '十秒一炮', planeCount: 1, stepSeconds: 10, hasPassword: false },
  { roomNo: '338470', roomName: '慢慢想，不着急', planeCount: 2, stepSeconds: 30, hasPassword: false },
  { roomNo: '750284', roomName: '一盘定生死', planeCount: 3, stepSeconds: 5, hasPassword: false },
  { roomNo: '918263', roomName: '老周的秘密基地', planeCount: 2, stepSeconds: 15, hasPassword: true },
  { roomNo: '462097', roomName: '夜战小队', planeCount: 3, stepSeconds: 15, hasPassword: true }
]
const MOCK_PASSWORD = '8888'

let room = null
let game = null
let listeners = []
let foeTimer = null
let joinTimer = null
let emoteSeq = 0

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

// 各阶段延时（毫秒），测试时可调小以加速
const delays = {
  opponentJoin: 2500,   // 创建房间后模拟对手加入
  matchJoin: 1400,      // 随机匹配到对手
  ready: 900,           // 对手完成布阵
  foeAction: 1300       // 对手出手
}

function setDelays(next) {
  Object.assign(delays, next || {})
}

function clampPlanes(n) {
  return clampPlaneCount(n)
}

function reset() {
  if (foeTimer) { clearTimeout(foeTimer); foeTimer = null }
  if (joinTimer) { clearTimeout(joinTimer); joinTimer = null }
  room = null
  game = null
  emoteSeq = 0
}

function emit() {
  const view = toView()
  listeners.forEach(fn => {
    try { fn(view) } catch (e) { /* ignore */ }
  })
}

/** 构造与云端 rooms 文档同构的视图 */
function toView() {
  if (!room) return null
  const view = {
    _id: room._id,
    roomNo: room.roomNo,
    roomName: room.roomName,
    planeCount: room.planeCount,
    stepSeconds: room.stepSeconds,
    hasPassword: !!room.hasPassword,
    isPublic: !room.hasPassword,
    status: room.status,
    players: room.players,
    battle: null
  }

  if (game) {
    view.battle = {
      turn: game.myTurn ? ME : FOE,
      seq: game.seq || 0,
      lastMove: game.lastMove || null,
      marks: { [ME]: game.myProbes, [FOE]: game.foeProbes },
      incoming: { [ME]: game.foeProbes, [FOE]: game.myProbes },
      stats: {
        [ME]: { kill: game.foeKilled.length, lost: game.myKilled.length, shots: game.myShots },
        [FOE]: { kill: game.myKilled.length, lost: game.foeKilled.length, shots: game.foeShots }
      },
      // 连续超时次数：两边都给，界面只显示自己那一份
      streak: { [ME]: room.myStreak || 0, [FOE]: 0 },
      counts: { [ME]: (game.myDeployed || []).length, [FOE]: (game.foeDeployed || []).length },
      stepSeconds: room.stepSeconds,
      finished: game.finished,
      winner: game.winner === 'me' ? ME : (game.winner === 'foe' ? FOE : ''),
      endType: game.endType,
      turnDeadline: game.turnDeadline || 0,
      emote: room.emote || null
    }
  }

  return view
}

/** 模拟对手在 delay 后进入房间 */
function scheduleOpponentJoin(delay) {
  if (joinTimer) clearTimeout(joinTimer)
  joinTimer = setTimeout(() => {
    if (!room || room.status !== 'waiting') return
    room.players = room.players.concat([{ openid: FOE }])
    room.status = 'deploy'
    emit()
  }, delay)
}

/** 本局的单步时限（毫秒）—— 房间设了就用房间的，没设才回落默认值 */
function stepMs() {
  const s = (room && room.stepSeconds) || TIMEOUT.TURN
  return s * 1000
}

/** 对手出手（本地 AI） */
function scheduleFoe() {
  if (foeTimer) clearTimeout(foeTimer)
  foeTimer = setTimeout(() => {
    if (!game || game.finished) return
    const r = game.foeFire()
    game.seq = (game.seq || 0) + 1
    if (r) {
      game.lastMove = { row: r.row, col: r.col, result: r.result, by: FOE, at: Date.now() }
    }
    game.turnDeadline = Date.now() + stepMs()
    if (game.finished) room.status = 'finished'   // 与云端保持一致
    emit()
  }, delays.foeAction)
}

/* ---------------- 房间 ---------------- */

async function createRoom(params) {
  reset()
  const p = params || {}
  const hasPassword = !!String(p.password || '')
  room = {
    _id: 'local-' + Date.now(),
    roomNo: genRoomId(),
    roomName: normalizeRoomName(p.roomName, '我的房间'),
    planeCount: clampPlanes(p.planeCount),
    stepSeconds: clampStepSeconds(p.stepSeconds),
    password: hasPassword ? String(p.password).slice(0, 4) : '',
    hasPassword: hasPassword,
    status: 'waiting',
    players: [{ openid: ME }],
    myStreak: 0,
    emote: null
  }
  emit()
  scheduleOpponentJoin(delays.opponentJoin)   // 模拟对手加入，让玩家能看到等待界面
  return {
    roomId: room._id,
    roomNo: room.roomNo,
    roomName: room.roomName,
    planeCount: room.planeCount,
    stepSeconds: room.stepSeconds,
    hasPassword: room.hasPassword,
    matched: false
  }
}

/**
 * 浏览公开房间（离线版：返回演示列表）
 * 与云端签名一致：返回数组，元素字段 roomNo / roomName / stepSeconds / hasPassword / players
 */
async function listRooms() {
  return {
    rooms: MOCK_ROOMS.filter(r => !r.hasPassword).map(r => Object.assign({ players: 1 }, r))
  }
}

/**
 * 按房间名模糊搜索（公开 + 私密都搜）
 * 私密房搜得到、进得去，但要密码 —— 这正是「搜到之后输密码」的设计意图：
 * 房名本身不是秘密，密码才是。
 */
async function searchRooms(params) {
  const kw = String((params && params.keyword) || '').trim().toLowerCase()
  const pool = MOCK_ROOMS.map(r => Object.assign({ players: 1 }, r))
  return {
    rooms: kw ? pool.filter(r => r.roomName.toLowerCase().indexOf(kw) >= 0) : pool
  }
}

async function joinRoom(params) {
  reset()
  const p = params || {}
  const roomNo = String(p.roomNo || genRoomId())
  const meta = MOCK_ROOMS.filter(r => r.roomNo === roomNo)[0] || {}
  const hasPassword = !!meta.hasPassword
  const password = String(p.password || '')

  if (hasPassword && password !== MOCK_PASSWORD) {
    throw new Error('密码错误，请重新输入')
  }

  room = {
    _id: 'local-' + Date.now(),
    roomNo,
    roomName: meta.roomName || '好友的房间',
    planeCount: clampPlanes(meta.planeCount || p.planeCount),
    stepSeconds: clampStepSeconds(meta.stepSeconds || p.stepSeconds),
    hasPassword,
    status: 'deploy',          // 房主已在，我加入后即两人齐
    players: [{ openid: FOE }, { openid: ME }],
    myStreak: 0,
    emote: null
  }
  emit()
  return {
    roomId: room._id,
    roomNo: room.roomNo,
    roomName: room.roomName,
    planeCount: room.planeCount,
    stepSeconds: room.stepSeconds,
    hasPassword: room.hasPassword
  }
}

async function matchRoom(params) {
  reset()
  const p = params || {}
  room = {
    _id: 'local-' + Date.now(),
    roomNo: genRoomId(),
    roomName: '随机匹配的房间',
    planeCount: clampPlanes(p.planeCount),
    stepSeconds: clampStepSeconds(p.stepSeconds),
    hasPassword: false,
    status: 'waiting',
    players: [{ openid: ME }],
    myStreak: 0,
    emote: null
  }
  emit()
  scheduleOpponentJoin(delays.matchJoin)
  return {
    roomId: room._id,
    roomNo: room.roomNo,
    roomName: room.roomName,
    planeCount: room.planeCount,
    stepSeconds: room.stepSeconds,
    hasPassword: false,
    matched: false
  }
}

async function getRoom() {
  if (!room) throw new Error('房间不存在')
  return toView()
}

async function leaveRoom() {
  reset()
  emit()
  return {}
}

/* ---------------- 对局 ---------------- */

async function deploy(params) {
  if (!room) throw new Error('房间不存在')

  const raw = (params && params.planes) || []
  // 与云端同一条规则：架数由房间定死，多一架少一架都不收
  const need = clampPlanes(room.planeCount)
  if (raw.length !== need) {
    throw new Error('本局固定 ' + need + ' 架，你提交了 ' + raw.length + ' 架')
  }

  // 与云端一致：补全 cells
  const planes = raw.map(p => Object.assign({}, p, {
    cells: getAbsoluteCells(p.planeId || 'standard', p.anchorRow, p.anchorCol, p.rotation || 0)
  }))

  // AI 用同一个架数布阵：本局架数写在房间上，双方必须一致
  game = new LocalGame({ planeCount: need })
  game.deploy(planes)
  game.deployFoe()
  game.seq = 0
  game.lastMove = null

  room.status = 'deploy'
  emit()

  // 模拟对手稍后就绪 → 开局
  await sleep(delays.ready)
  if (!room || !game) throw new Error('房间已关闭')

  room.status = 'battle'
  game.myTurn = Math.random() < 0.5     // 先手随机（T-01）
  game.turnDeadline = Date.now() + stepMs()
  emit()

  if (!game.myTurn) scheduleFoe()

  return { allReady: true, firstHand: game.myTurn ? ME : FOE }
}

async function fire(params) {
  if (!game) throw new Error('对局不存在')
  if (game.finished) throw new Error('对局已结束')
  if (!game.myTurn) throw new Error('还没轮到你出手')

  const row = Number(params.row)
  const col = Number(params.col)
  const res = game.fire(row, col)
  if (!res.ok) throw new Error('该坐标已轰炸过')

  room.myStreak = 0                       // 手动出招即清零：连续超时只认「连着不动」
  game.seq = (game.seq || 0) + 1
  game.lastMove = { row, col, result: res.result, by: ME, at: Date.now() }
  game.turnDeadline = Date.now() + stepMs()
  if (game.finished) room.status = 'finished'     // 与云端保持一致
  emit()

  if (!res.win) scheduleFoe()

  return {
    result: res.result,
    win: !!res.win,
    turn: game.myTurn ? ME : FOE,
    seq: game.seq
  }
}

/** 快捷表情（离线版：仅广播给本地监听者，语义与云端一致） */
async function emote(params) {
  if (!room) throw new Error('房间不存在')
  if (!game || game.finished) throw new Error('对局已结束')
  const emoji = String((params && params.emoji) || '')
  if (EMOTE_LIST.indexOf(emoji) < 0) throw new Error('不支持的表情')
  emoteSeq += 1
  room.emote = { by: ME, emoji, at: Date.now(), seq: emoteSeq }
  emit()
  return { seq: emoteSeq }
}

async function surrender() {
  if (!game) throw new Error('对局不存在')
  if (game.finished) throw new Error('对局已结束')
  game.surrender()
  room.status = 'finished'
  emit()
  return {}
}

  /**
   * 超时未出招（T-02 修订）
   *
   * 旧行为是「跳过回合」，问题很实在：挂机的人只要熬过 3 次就输了，
   * 但中间那几步等于白送对手 —— 双方都不动，棋局就僵在那儿。
   * 现在改成「替玩家按固定顺序打一炮」：棋局一定往前走，
   * 同时「连续超时 5 次」判负，保证挂机不会赢。
   */
async function tick() {
  if (!room || !game || game.finished) return { skipped: false, auto: false }
  if (!game.myTurn) return { skipped: false, auto: false }   // 轮到 AI，由 AI 定时器接管
  if (!game.turnDeadline || Date.now() < game.turnDeadline) return { skipped: false, auto: false }

  const shot = game.autoFire()
  room.myStreak = (room.myStreak || 0) + 1
  game.seq = (game.seq || 0) + 1

  if (shot) {
    game.lastMove = {
      row: shot.row, col: shot.col, result: shot.result,
      by: ME, at: Date.now(), auto: true
    }
  }
  game.turnDeadline = Date.now() + stepMs()

  let finished = false
  if (!game.finished && room.myStreak >= MAX_TURN_TIMEOUT_STREAK) {
    // 连续超时 5 次：判负。先让这一炮落地再判，这样「最后一炮赢了」不会被规则吞掉。
    game.finished = true
    game.winner = 'foe'
    game.endType = 'timeout'
    finished = true
  }
  if (game.finished) room.status = 'finished'
  emit()

  if (finished) return { skipped: false, auto: true, finished: true, reason: 'timeout_streak' }

  if (!game.finished) scheduleFoe()
  return {
    skipped: false, auto: true,
    row: shot ? shot.row : 0, col: shot ? shot.col : 0,
    result: shot ? shot.result : '', streak: room.myStreak
  }
}

async function sync() {
  if (!room) throw new Error('房间不存在')
  const view = toView()
  return {
    myOpenid: ME,
    status: room.status,
    battle: view.battle,
    myDeploy: (game && game.myDeployed) || [],
    myDestroyed: (game && game.myKilled.length) || 0,
    players: room.players
  }
}

/* ---------------- 实时监听（模拟 watch） ---------------- */

function watchRoom(roomId, onChange, onError) {
  const handler = (view) => {
    if (view && typeof onChange === 'function') onChange(view)
  }
  listeners.push(handler)
  // 立即推送一次当前状态
  setTimeout(() => handler(toView()), 0)

  return {
    close() {
      const i = listeners.indexOf(handler)
      if (i >= 0) listeners.splice(i, 1)
    }
  }
}

module.exports = {
  createRoom,
  joinRoom,
  matchRoom,
  listRooms,
  searchRooms,
  getRoom,
  leaveRoom,
  deploy,
  fire,
  emote,
  surrender,
  tick,
  sync,
  watchRoom,
  setDelays,
  // 供测试使用
  _reset: reset,
  _getGame: () => game,
  _room: () => room,
  _mockRooms: () => MOCK_ROOMS.slice(),
  _mockPassword: MOCK_PASSWORD
}
