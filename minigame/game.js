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
const { createAudio } = require('./js/core/audio')

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

/* ---------------- 皮肤（纯本地，启动读一次） ---------------- */
// 只在这里读一次存储和调一次 applySkin。进场景不再读：切换时统一走 skin.setSkinId
// + applySkin + 立即重绘，避免不同场景各自读存储、在切换那一帧抖出半屏旧色。
const skin = require('./js/core/skin')
const theme = require('./js/core/theme')
const skinId = skin.getSkinId()
theme.applySkin(skinId)

/* ---------------- 音频（程序化合成，零资源；首个手势才解锁） ---------------- */
// 皮肤在上面已 applySkin，音频创建时读得到当前音色参数。
const audio = createAudio()
audio.setSkin(skinId)

/* ---------------- 应用与场景 ---------------- */
const app = createApp({
  canvas: canvas,
  ctx: ctx,
  info: info,
  audio: audio,
  scenes: {
    lobby: require('./js/scenes/lobby'),
    rooms: require('./js/scenes/rooms'),
    room: require('./js/scenes/room'),
    deploy: require('./js/scenes/deploy'),
    battle: require('./js/scenes/battle'),
    result: require('./js/scenes/result'),
    // 测试期用的离线 AI 调参页，从大厅的离线提示条进
    'ai-tune': require('./js/scenes/ai-tune')
  }
})

app.globalData.playerId = playerId
app.globalData.cloudReady = cloudReady
app.globalData.skinId = skinId

/* ---------------- 触摸 ---------------- */
function pointOf(e, useChanged) {
  const list = (useChanged ? e.changedTouches : e.touches) || e.touches || []
  const t = list[0]
  return t ? { x: t.clientX, y: t.clientY } : null
}

wx.onTouchStart(function (e) {
  // 首个手势解锁音频：ctx.resume() + 一记 tap 作为「声音已开」的确认。
  // unlock 内部有守卫，之后每次 touchStart 都是空操作（或仅在 suspended 时 resume）。
  audio.unlock()
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

/* ---------------- 前后台切换 ---------------- */
//
// 小游戏切后台时系统会冻结渲染帧投递，rAF 基本不再回调，所以"白烧电"的风险很低。
// 仍然显式 stop/start 是为了另外两件事：
//   ① 回前台首帧的 dt 从 0 起算（start() 里 last = Date.now()），
//      不会出现"切回来一次推进好几秒"的动效大跳；
//   ② 回前台是一次天然的清理时机 —— 对局画面可能已经过期（battle.sync 只在
//      onEnter 调一次），需要主动重同步。
// 注：「切后台 rAF 是否立即停投」各基础库版本行为有差异，上面的两条理由
//     不依赖这个假设，所以无论哪种行为都正确。
if (wx.onHide) {
  wx.onHide(function () {
    app.stop()
    audio.suspend()   // 后台挂起音频（非仅 gain=0，省电且避免后台出声）
  })
}

/* ---------------- 从好友分享卡片二次进入 ---------------- */
if (wx.onShow) {
  wx.onShow(function (res) {
    app.start()            // 已在运行则是空操作（start 自带 _running 守卫）
    audio.resume()         // 未静音时恢复；内部会重置氛围调度锚点，防后台欠账补发
    // 好友点卡热启动：带 auto:true 直接发起加入，不再要求玩家手点一次「加入房间」。
    // isConsumed 守卫：同一张卡在切后台后 onShow 仍会带同一份 query，已消费过就别再拽人进房。
    if (res && res.query && res.query.roomNo && !share.isConsumed(res.query.roomNo)) {
      share.setLaunchQuery(res.query)
      app.go('room', { mode: 'join', auto: true })
    }
  })
}

/* ---------------- 启动 ---------------- */
const launchQuery = share.launchQuery()
app.go('lobby')                                   // 先垫一层，保证「返回」可用
// 冷启动带邀请卡：auto:true 让房间页读入房间号后立刻 onJoin（见 room.js 的 join 分支）
if (launchQuery.roomNo) app.go('room', { mode: 'join', auto: true })
app.start()

// 导出供自动化测试驱动（小游戏运行时不依赖它）
module.exports = app
