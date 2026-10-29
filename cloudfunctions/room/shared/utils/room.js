// utils/room.js
// 房间相关的取值规则 —— 云函数与离线引擎共用同一份，避免两端「校验标准不一样」
//
// 为什么这些规则值得单独一个文件：
//   房主设的单步时长、房间名、超时自动轰炸的落点，这三件事客户端和服务端都要算。
//   一旦写成两份，就会出现「界面显示 15 秒 / 服务端按 30 秒判超时」这种最难查的 bug。

const {
  BOARD_SIZE, MIN_PLANES, MAX_PLANES, TURN_MIN, TURN_MAX, ROOM_NAME_MAX
} = require('../config/rules')
const { key } = require('./board')

/**
 * 本局架数夹取：1~3 的整数。
 *
 * 房主建房时就把它定死，之后布阵必须摆满同样多 —— 客户端、云函数、离线引擎
 * 三处都要按同一个标准夹，否则会出现「房间上写 3 架，服务端按 1 架放行」。
 */
function clampPlaneCount(v) {
  const n = Number(v)
  if (!isFinite(n) || n <= 0) return MIN_PLANES
  return Math.min(MAX_PLANES, Math.max(MIN_PLANES, Math.round(n)))
}

/**
 * 单步时长夹取：落在 5~30 秒，**1 秒连续**（滑块拖动，不再对齐到 5 秒档）
 *
 * 不做整数对齐会出问题：滑块给的是像素换算出来的浮点值，
 * 一旦某个环节把它原样存下来，就会出现「界面写 18 秒 / 服务端 18.37 秒超时」。
 */
function clampStepSeconds(v) {
  const n = Number(v)
  // NaN / '' / undefined 一律回落到默认值，不要静默变成 5 秒 —— 那会让玩家觉得「明明设了 30 却 5 秒就超时」
  if (!isFinite(n) || n <= 0) return require('../config/rules').TURN_DEFAULT
  return Math.min(TURN_MAX, Math.max(TURN_MIN, Math.round(n)))
}

/** 房间名清洗：去首尾空白、把连续空白压成一个空格、截断到最大字数 */
function normalizeRoomName(name, fallback) {
  let s = String(name == null ? '' : name)
    .replace(/\s+/g, ' ')
    .trim()
  if (!s) s = String(fallback == null ? '' : fallback).replace(/\s+/g, ' ').trim()
  if (!s) s = '未命名房间'
  return s.slice(0, ROOM_NAME_MAX)
}

/**
 * 超时自动轰炸的落点：从上到下、从左到右，第一个还没炸过的格子
 *
 * 为什么是这个顺序而不是随机：
 *   随机意味着超时的代价忽大忽小，玩家会觉得「挂机也可能赢」；
 *   固定顺序是可预期、可复盘的 —— 一超时就知道会打哪儿，赖不掉。
 *   而且它按行扫，天然把棋盘当成一张纸从上往下读，不用额外解释。
 *
 * @param {Object} marks 我方轰炸记录 { 'row,col': 'miss'|'hit'|'kill' }
 * @returns {{row:number,col:number}|null} 全炸完时返回 null
 */
function pickAutoTarget(marks) {
  const m = marks || {}
  for (let row = 1; row <= BOARD_SIZE; row++) {
    for (let col = 1; col <= BOARD_SIZE; col++) {
      if (!m[key(row, col)]) return { row, col }
    }
  }
  return null
}

module.exports = {
  clampPlaneCount,
  clampStepSeconds,
  normalizeRoomName,
  pickAutoTarget
}
