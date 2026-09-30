// services/offlineGame.js
// 离线模拟引擎（USE_CLOUD = false 时启用）
//
// 目的：没有配置云环境时，也能完整跑通「大厅 → 房间 → 布阵 → 对战 → 结算」，
//      对手由本地引擎模拟。对外接口与 cloudApi 完全一致，页面代码无需区分。
//
// 注意：本模块是纯逻辑实现，不依赖任何小程序 API，可用 Node 直接测试。
const { LocalGame, genRoomId } = require('./localGame')
const { getAbsoluteCells } = require('../utils/plane')
const { MIN_PLANES, MAX_PLANES, TIMEOUT } = require('../config/rules')
const { EMOTE_LIST } = require('../config/social')

const ME = 'me'
const FOE = 'foe'

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
  const v = Number(n) || MIN_PLANES
  return Math.min(MAX_PLANES, Math.max(MIN_PLANES, v))
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
    planeCount: room.planeCount,
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
    game.turnDeadline = Date.now() + TIMEOUT.TURN * 1000
    if (game.finished) room.status = 'finished'   // 与云端保持一致
    emit()
  }, delays.foeAction)
}

/* ---------------- 房间 ---------------- */

async function createRoom(params) {
  reset()
  room = {
    _id: 'local-' + Date.now(),
    roomNo: genRoomId(),
    planeCount: clampPlanes(params && params.planeCount),
    status: 'waiting',
    players: [{ openid: ME }],
    emote: null
  }
  emit()
  scheduleOpponentJoin(delays.opponentJoin)   // 模拟对手加入，让玩家能看到等待界面
  return {
    roomId: room._id,
    roomNo: room.roomNo,
    planeCount: room.planeCount,
    matched: false
  }
}

async function joinRoom(params) {
  reset()
  const roomNo = String((params && params.roomNo) || genRoomId())
  room = {
    _id: 'local-' + Date.now(),
    roomNo,
    planeCount: clampPlanes(params && params.planeCount),
    status: 'deploy',          // 房主已在，我加入后即两人齐
    players: [{ openid: FOE }, { openid: ME }],
    emote: null
  }
  emit()
  return { roomId: room._id, roomNo: room.roomNo, planeCount: room.planeCount }
}

async function matchRoom(params) {
  reset()
  room = {
    _id: 'local-' + Date.now(),
    roomNo: genRoomId(),
    planeCount: clampPlanes(params && params.planeCount),
    status: 'waiting',
    players: [{ openid: ME }],
    emote: null
  }
  emit()
  scheduleOpponentJoin(delays.matchJoin)
  return {
    roomId: room._id,
    roomNo: room.roomNo,
    planeCount: room.planeCount,
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
  if (raw.length < MIN_PLANES) throw new Error('至少布置 1 架飞机')

  // 与云端一致：补全 cells
  const planes = raw.map(p => Object.assign({}, p, {
    cells: getAbsoluteCells(p.planeId || 'standard', p.anchorRow, p.anchorCol, p.rotation || 0)
  }))

  game = new LocalGame({ planeCount: room.planeCount })
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
  game.turnDeadline = Date.now() + TIMEOUT.TURN * 1000
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

  game.seq = (game.seq || 0) + 1
  game.lastMove = { row, col, result: res.result, by: ME, at: Date.now() }
  game.turnDeadline = Date.now() + TIMEOUT.TURN * 1000
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

async function tick() {
  // 离线模式下对手会自动行动，不存在卡回合
  return { skipped: false }
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
  _getGame: () => game
}
