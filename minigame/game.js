// minigame/game.js
// 炸飞机 · 微信小游戏入口
//
// 对应关系：
//   小程序 app.js + 页面路由  →  本文件 + js/core/app.js 的场景栈
//   小程序 wx.cloud.init      →  同样在入口初始化
//
// 注意：小游戏没有 WXML/WXSS/Page，全部界面由 Canvas 绘制，
//      但玩法逻辑与数据层（js/shared/**）与小程序的 miniprogram/{config,utils,services} 同源。
const { ENV_ID, USE_CLOUD } = require('./js/shared/config/cloud')
const { createApp } = require('./js/core/app')
const share = require('./js/core/share')

/* ---------------- 画布 ---------------- */
const canvas = wx.createCanvas()
const info = wx.getSystemInfoSync()
const dpr = info.pixelRatio || 1

canvas.width = Math.floor(info.windowWidth * dpr)
canvas.height = Math.floor(info.windowHeight * dpr)

const ctx = canvas.getContext('2d')
ctx.scale(dpr, dpr)   // 之后一律按逻辑像素（CSS px）绘制

/* ---------------- 云开发 ---------------- */
let cloudReady = false
if (USE_CLOUD) {
  if (wx.cloud) {
    wx.cloud.init({ env: ENV_ID || undefined, traceUser: true })
    cloudReady = true
  } else {
    console.error('[zfj] 当前基础库不支持云开发，请升级微信版本')
  }
} else {
  console.info('[zfj] 离线试玩模式（对手由本地 AI 扮演）')
}

/* ---------------- 玩家标识 ---------------- */
let playerId = ''
try { playerId = wx.getStorageSync('zfj_player_id') || '' } catch (e) { playerId = '' }
if (!playerId) {
  playerId = 'p_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  try { wx.setStorageSync('zfj_player_id', playerId) } catch (e) { /* ignore */ }
}

/* ---------------- 应用与场景 ---------------- */
const app = createApp({
  canvas: canvas,
  ctx: ctx,
  info: info,
  scenes: {
    lobby: require('./js/scenes/lobby'),
    room: require('./js/scenes/room'),
    deploy: require('./js/scenes/deploy'),
    battle: require('./js/scenes/battle'),
    result: require('./js/scenes/result')
  }
})

app.globalData.playerId = playerId
app.globalData.cloudReady = cloudReady

/* ---------------- 触摸 ---------------- */
function pointOf(e, useChanged) {
  const list = (useChanged ? e.changedTouches : e.touches) || e.touches || []
  const t = list[0]
  return t ? { x: t.clientX, y: t.clientY } : null
}

wx.onTouchStart(function (e) {
  const p = pointOf(e, false)
  if (p) app.touchStart(p.x, p.y)
})
wx.onTouchMove(function (e) {
  const p = pointOf(e, false)
  if (p) app.touchMove(p.x, p.y)
})
wx.onTouchEnd(function (e) {
  const p = pointOf(e, true)
  if (p) app.touchEnd(p.x, p.y)
})
if (wx.onTouchCancel) {
  wx.onTouchCancel(function () { app._touch = null })
}

/* ---------------- 分享 ---------------- */
share.onShare(function () {
  return { title: '炸飞机 · 9×9 双人实时对战，来跟我打一局', query: '' }
})

/* ---------------- 从好友分享卡片二次进入 ---------------- */
if (wx.onShow) {
  wx.onShow(function (res) {
    if (res && res.query && res.query.roomNo) {
      share.setLaunchQuery(res.query)
      app.go('room', { mode: 'join' })
    }
  })
}

/* ---------------- 启动 ---------------- */
const launchQuery = share.launchQuery()
app.go('lobby')                                   // 先垫一层，保证「返回」可用
if (launchQuery.roomNo) app.go('room', { mode: 'join' })
app.start()

// 导出供自动化测试驱动（小游戏运行时不依赖它）
module.exports = app
