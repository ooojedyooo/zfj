// scripts/test-layout.js
// 多分辨率布局回归：Canvas 界面最容易在小屏溢出 / 中屏重叠，而这类问题在真机上才暴露。
// 这里把 6 种屏幕宽高代入真实场景的 layout()，断言：
//   ① 每个区块都在屏内   ② 相邻区块不重叠   ③ 棋盘格子不小于 30px（触控目标下限）
const path = require('path')

const DEVICES = [
  { name: 'iPhone SE1 320x568', w: 320, h: 568 },
  { name: 'Android 小屏 360x640', w: 360, h: 640 },
  { name: 'iPhone 8 375x667', w: 375, h: 667 },
  { name: 'iPhone 14 390x844', w: 390, h: 844 },
  { name: 'iPhone Plus 414x896', w: 414, h: 896 },
  { name: '平板 768x1024', w: 768, h: 1024 }
]

function stubWx(info) {
  const noop = function () {}
  const store = {}
  const ctx = new Proxy({}, {
    get: function (t, k) {
      if (k === 'measureText') return function (s) { return { width: String(s).length * 7 } }
      if (k in t) return t[k]
      return noop
    },
    set: function (t, k, v) { t[k] = v; return true }
  })
  global.wx = {
    getSystemInfoSync: function () { return info },
    getLaunchOptionsSync: function () { return { query: {} } },
    createCanvas: function () { return { width: 0, height: 0, getContext: function () { return ctx } } },
    showModal: noop, showToast: noop, hideToast: noop,
    showShareMenu: noop, shareAppMessage: noop, onShareAppMessage: noop,
    getStorageSync: function (k) { return store[k] || '' },
    setStorageSync: function (k, v) { store[k] = v },
    removeStorageSync: function (k) { delete store[k] },
    onTouchStart: noop, onTouchMove: noop, onTouchEnd: noop, onTouchCancel: noop,
    onShow: noop, onHide: noop, cloud: null
  }
  return ctx
}

function load(info) {
  Object.keys(require.cache).forEach(function (k) {
    if (k.indexOf('minigame') >= 0) delete require.cache[k]
  })
  stubWx(info)
  return require(path.join('..', 'minigame', 'game'))
}

function inside(r, W, H, label, errs) {
  if (!r) { errs.push(label + ' 不存在'); return }
  if (r.x < -0.5 || r.y < -0.5) errs.push(label + ' 左上出屏 (' + Math.round(r.x) + ',' + Math.round(r.y) + ')')
  if (r.x + r.w > W + 0.5) errs.push(label + ' 右溢 ' + Math.round(r.x + r.w) + '>' + W)
  if (r.y + r.h > H + 0.5) errs.push(label + ' 下溢 ' + Math.round(r.y + r.h) + '>' + H)
}

function overlap(a, b, la, lb, errs) {
  if (!a || !b) return
  const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  if (ox > 0.5 && oy > 0.5) errs.push(la + ' 与 ' + lb + ' 重叠 ' + Math.round(ox) + 'x' + Math.round(oy))
}

let totalBad = 0

DEVICES.forEach(function (d) {
  const info = {
    windowWidth: d.w, windowHeight: d.h, pixelRatio: 2, statusBarHeight: 20,
    safeArea: { top: 20, bottom: d.h }
  }
  const app = load(info)
  app.stop()
  const errs = []
  const W = d.w
  const H = d.h

  // --- 大厅 ---
  const lobby = app.get('lobby')
  app.go('lobby')
  lobby.layout()
  lobby.geo.buttons.forEach(function (b, i) { inside(b, W, H, '大厅按钮' + (i + 1), errs) })
  lobby.geo.buttons.forEach(function (b, i) {
    if (i > 0) overlap(lobby.geo.buttons[i - 1], b, '大厅按钮' + i, '大厅按钮' + (i + 1), errs)
  })

  // --- 房间（create：房名 / 单步限时 / 私密开关 / 密码行）---
  const room = app.get('room')
  app.go('room', { mode: 'create' })
  room.usePassword = true
  room.layout()
  inside(room.geo.card, W, H, '房间卡片', errs)
  inside(room.geo.actionBtn, W, H, '创建按钮', errs)
  overlap(room.geo.card, room.geo.actionBtn, '房间卡片', '创建按钮', errs)
  inside(room.geo.switch, W, H, '私密开关', errs)
  inside(room.geo.stepMinus, W, H, '限时−', errs)
  inside(room.geo.stepPlus, W, H, '限时＋', errs)
  overlap(room.geo.stepMinus, room.geo.stepPlus, '限时−', '限时＋', errs)
  // 三行设置 + 密码行 + 说明行都必须落在卡片里
  ;[['房名', room.geo.nameY], ['单步限时', room.geo.stepY], ['私密', room.geo.privY],
    ['密码', room.geo.pwdY], ['说明', room.geo.hintY]].forEach(function (p) {
    if (p[1] == null) { errs.push(p[0] + ' 行不存在'); return }
    if (p[1] < room.geo.card.y || p[1] > room.geo.card.y + room.geo.card.h) {
      errs.push(p[0] + ' 行跑出卡片 ' + Math.round(p[1]))
    }
  })
  // 密码行不能压住说明行
  if (room.geo.pwdY + 24 > room.geo.hintY) errs.push('密码行压住说明行')

  // --- 房间列表（公开 / 搜索）---
  const rl = app.get('rooms')
  app.go('rooms', { mode: 'public' })
  const fake = []
  for (let i = 0; i < 6; i++) {
    fake.push({
      roomNo: '20481' + i, roomName: '房间示例' + i,
      stepSeconds: 15, hasPassword: i % 2 === 0, players: 1
    })
  }
  rl.all = fake
  rl.layout()
  rl.geo.items.forEach(function (r, i) { inside(r, W, H, '列表项' + (i + 1), errs) })
  rl.geo.items.forEach(function (r, i) {
    if (i > 0) overlap(rl.geo.items[i - 1], r, '列表项' + i, '列表项' + (i + 1), errs)
  })
  rl.geo.actionRects.forEach(function (r, i) { inside(r, W, H, '列表按钮' + (i + 1), errs) })
  const lastItem = rl.geo.items[rl.geo.items.length - 1]
  overlap(lastItem, rl.geo.actionRects[0], '最后一项', '列表按钮', errs)

  app.go('rooms', { mode: 'search' })
  rl.keyword = '老周'
  rl.all = fake
  rl.layout()
  inside(rl.geo.searchBox, W, H, '搜索框', errs)
  overlap(rl.geo.searchBox, rl.geo.items[0], '搜索框', '第一项', errs)
  const lastSearchItem = rl.geo.items[rl.geo.items.length - 1]
  overlap(lastSearchItem, rl.geo.actionRects[0], '搜索最后一项', '列表按钮', errs)

  // --- 布阵（3 架）---
  app.globalData.match = { roomId: 'smoke', roomNo: '000000', planeCount: 3 }
  app.go('deploy', {})
  const dep = app.scene
  dep.stopCountdown()
  dep.layout()
  const g = dep.geo
  inside(g.board, W, H, '棋盘', errs)
  inside({ x: g.x, y: g.statusY, w: g.w, h: g.statusH }, W, H, '状态条', errs)
  inside(g.readyBtn, W, H, '就绪按钮', errs)
  g.opRects.forEach(function (r, i) { inside(r, W, H, '操作按钮' + (i + 1), errs) })
  overlap(g.board, { x: g.x, y: g.statusY, w: g.w, h: g.statusH }, '棋盘', '状态条', errs)
  overlap({ x: g.x, y: g.statusY, w: g.w, h: g.statusH }, g.opRects[0], '状态条', '操作按钮', errs)
  overlap(g.opRects[0], g.readyBtn, '操作按钮', '就绪按钮', errs)
  overlap(g.board, g.opRects[0], '棋盘', '操作按钮', errs)
  const lastS = g.statusSlots[2]
  if (lastS.x + lastS.w > g.statusTextX) errs.push('状态条棋子压到文字')
  if (g.statusTextX > g.x + g.w) errs.push('状态条文字起点出卡片')

  const cellPx = g.board.size / 9
  if (cellPx < 30) errs.push('格子只有 ' + cellPx.toFixed(1) + 'px（<30，手指点不准）')

  // --- 对战 ---
  app.globalData.match = { roomId: 'smoke' }
  app.go('battle', {})
  const bat = app.scene
  bat.stopAll && bat.stopAll()
  bat.layout()
  if (bat.geo.mineBoard) inside(bat.geo.mineBoard, W, H, '我方棋盘', errs)
  if (bat.geo.foeBoard) inside(bat.geo.foeBoard, W, H, '敌方棋盘', errs)

  dep.stopCountdown()
  room.stopCountdown()
  room.stopWatch()

  const status = errs.length ? 'BAD' : 'OK '
  if (errs.length) totalBad++
  console.log(status + '  ' + d.name + '   棋盘边长 ' + g.board.size.toFixed(0) +
    'px  格子 ' + cellPx.toFixed(1) + 'px')
  errs.forEach(function (e) { console.log('       · ' + e) })
})

console.log('\n' + (totalBad ? '有 ' + totalBad + ' 个尺寸存在问题' : '全部尺寸布局通过'))
process.exit(0)
