// scripts/test-minigame.js
// 小游戏端自动化测试
//
// 小游戏没有 DOM，但整个界面层是「纯计算 + Canvas 调用」，所以可以：
//   1) 用桩 canvas 顶掉绘制，验证渲染不抛异常；
//   2) 用桩 wx 顶掉原生能力，走真实的触摸分发（touchStart → touchEnd）驱动整个流程；
//   3) 数据层复用离线引擎，因此能真正从大厅一路点到结算。
//
// 运行：node scripts/test-minigame.js
const assert = require('assert')

/* ================= 桩环境（必须在 require 入口前装好） ================= */

const INFO = {
  windowWidth: 375,
  windowHeight: 667,
  pixelRatio: 2,
  statusBarHeight: 20,
  safeArea: { top: 20, bottom: 667 }
}

function makeCtx() {
  const calls = []
  const rec = function (name) {
    return function () { calls.push(name) }
  }
  return {
    calls: calls,
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    scale: rec('scale'),
    clearRect: rec('clearRect'),
    fillRect: rec('fillRect'),
    beginPath: rec('beginPath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    arc: rec('arc'),
    arcTo: rec('arcTo'),
    closePath: rec('closePath'),
    fill: rec('fill'),
    stroke: rec('stroke'),
    save: rec('save'),
    restore: rec('restore'),
    fillText: rec('fillText'),
    setTransform: rec('setTransform'),
    measureText: function (s) { return { width: String(s).length * 7 } }
  }
}

const CTX = makeCtx()
const STORE = {}

global.wx = {
  getSystemInfoSync: function () { return INFO },
  getLaunchOptionsSync: function () { return { query: {} } },
  createCanvas: function () { return { width: 0, height: 0, getContext: function () { return CTX } } },
  showModal: function () {},
  showToast: function () {},
  hideToast: function () {},
  showShareMenu: function () {},
  shareAppMessage: function () {},
  onShareAppMessage: function () {},
  getStorageSync: function (k) { return STORE[k] || '' },
  setStorageSync: function (k, v) { STORE[k] = v },
  removeStorageSync: function (k) { delete STORE[k] },
  onTouchStart: function () {},
  onTouchMove: function () {},
  onTouchEnd: function () {},
  onTouchCancel: function () {},
  onShow: function () {},
  onHide: function () {},
  cloud: null
}

/* ================= 加载被测对象 ================= */

const app = require('../minigame/game')
const offline = require('../minigame/js/shared/services/offlineGame')
const cloudApi = require('../minigame/js/shared/services/cloudApi')
const geom = require('../minigame/js/core/geom')
const Board = require('../minigame/js/widgets/board')
const { getAbsoluteCells } = require('../minigame/js/shared/utils/plane')
const { BOARD_SIZE, RESULT, END_TYPE } = require('../minigame/js/shared/config/rules')

/* ================= 断言脚手架 ================= */

let pass = 0
let failed = 0

function check(name, fn) {
  try {
    fn()
    console.log('  \u2713 ' + name)
    pass++
  } catch (e) {
    console.log('  \u2717 ' + name + '  \u2192 ' + e.message)
    failed++
  }
}

function section(t) { console.log('\n' + t) }

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms) }) }

function waitFor(cond, label, timeout) {
  const limit = timeout || 6000
  return new Promise(function (resolve, reject) {
    const t0 = Date.now()
    const iv = setInterval(function () {
      let ok = false
      try { ok = !!cond() } catch (e) { ok = false }
      if (ok) { clearInterval(iv); resolve(true); return }
      if (Date.now() - t0 > limit) {
        clearInterval(iv)
        reject(new Error('等待超时：' + label))
      }
    }, 15)
  })
}

/** 模拟一次真实点击：走 app 的触摸分发 */
function tapAt(x, y) {
  app.touchStart(x, y)
  app.touchEnd(x, y)
}

function tapRect(r) {
  tapAt(r.x + r.w / 2, r.y + r.h / 2)
}

function headOf(plane) {
  return getAbsoluteCells(plane.planeId, plane.anchorRow, plane.anchorCol, plane.rotation)
    .filter(function (c) { return c.isHead })[0]
}

/* ================= 主流程 ================= */

async function main() {
  cloudApi.setDelays({ opponentJoin: 40, matchJoin: 40, ready: 40, foeAction: 40 })

  /* ---------- 1. 引擎与适配 ========== */
  section('[1] 引擎与屏幕适配')

  check('启动即进入大厅', function () { assert.strictEqual(app.scene.name, 'lobby') })
  check('750 设计稿单位铺满屏宽', function () { assert.strictEqual(app.layout.u(750), 375) })
  check('u() 线性换算正确', function () { assert.strictEqual(app.layout.u(100), 50) })
  check('安全区已记录', function () { assert.strictEqual(app.layout.safeTop, 20) })
  check('canvas 已按 DPR 缩放', function () { assert.ok(CTX.calls.indexOf('scale') >= 0) })
  check('每帧渲染不抛异常', function () { app.renderOnce() })
  check('渲染确实产生了绘制调用', function () {
    // 注意：主循环用的是 setTimeout 兜底，早期版本这里靠「累计调用数 > 100」判断，
    // 会随机器调度抖动而假失败。改为「清零后渲染一帧，看这一帧画了什么」。
    CTX.calls.length = 0
    app.renderOnce()
    const n = CTX.calls.length
    assert.ok(n >= 30, '一帧只产生了 ' + n + ' 次绘制调用')
    const texts = CTX.calls.filter(function (c) { return c === 'fillText' }).length
    assert.ok(texts >= 3, '一帧只绘制了 ' + texts + ' 段文字')
  })

  /* ---------- 2. 几何与命中 ---------- */
  section('[2] 几何与命中检测')

  const r = { x: 10, y: 20, w: 100, h: 50 }
  check('点在矩形内', function () { assert.ok(geom.inRect(50, 40, r)) })
  check('点在矩形外', function () { assert.ok(!geom.inRect(500, 40, r)) })
  check('hitZone 后注册者优先', function () {
    const a = { x: 0, y: 0, w: 100, h: 100, onTap: function () {}, id: 'a' }
    const b = { x: 0, y: 0, w: 100, h: 100, onTap: function () {}, id: 'b' }
    assert.strictEqual(geom.hitZone(10, 10, [a, b]).id, 'b')
  })
  check('disabled 的 zone 不响应', function () {
    const a = { x: 0, y: 0, w: 100, h: 100, onTap: function () {}, disabled: true }
    assert.strictEqual(geom.hitZone(10, 10, [a]), null)
  })
  check('棋盘格切分正确', function () {
    const cells = geom.grid(0, 0, 90, 9, 9)
    assert.strictEqual(cells.length, 81)
    assert.strictEqual(cells[0].row, 1)
    assert.strictEqual(cells[0].col, 1)
    assert.strictEqual(cells[80].row, 9)
    assert.strictEqual(cells[80].col, 9)
    assert.strictEqual(cells[0].w, 10)
  })
  check('棋盘格位映射正确（首格左上）', function () {
    const o = { x: 100, y: 200, size: 90 }
    const c1 = Board.cellRect(o, 1, 1)
    assert.strictEqual(c1.x, 100)
    assert.strictEqual(c1.y, 200)
    const c9 = Board.cellRect(o, 9, 9)
    assert.strictEqual(c9.x, 180)
    assert.strictEqual(c9.y, 280)
  })
  check('棋盘外框含底板内边距', function () {
    const o = { x: 100, y: 200, size: 90 }
    const outer = Board.outerRect(o, function (v) { return v })
    assert.ok(outer.x < 100 && outer.w > 90)
  })

  /* ---------- 3. 大厅可点区域 ---------- */
  section('[3] 大厅 → 房间（触摸驱动）')

  const lobby = app.scene
  check('大厅注册了 3 个主入口按钮', function () {
    assert.ok(lobby.geo.buttons.length === 3, '实际 ' + lobby.geo.buttons.length)
  })
  check('「创建房间」按钮落在屏内', function () {
    const b = lobby.geo.buttons[0]
    assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 375 && b.y + b.h <= 667)
  })
  check('按钮竖排不重叠且间距一致', function () {
    const b = lobby.geo.buttons
    const gap = b[1].y - (b[0].y + b[0].h)
    assert.ok(Math.abs(gap - (b[2].y - (b[1].y + b[1].h))) < 0.001, '间距不一致')
    assert.ok(gap > 0, '按钮重叠')
  })

  tapRect(lobby.geo.buttons[0])
  check('点击后进入房间场景', function () { assert.strictEqual(app.scene.name, 'room') })

  const room = app.scene
  check('房间默认 create 模式', function () { assert.strictEqual(room.mode, 'create') })
  check('房间场景可渲染', function () { app.renderOnce() })

  /* ---------- 4. 创建房间 → 等待 → 对手就位 ---------- */
  section('[4] 创建房间 → 对手加入 → 布阵')

  const actionZone = room.zones[room.zones.length - 1]
  tapRect(actionZone)

  await waitFor(function () { return room.mode === 'waiting' }, '进入等待态')
  check('进入等待态并拿到 6 位房间号', function () {
    assert.ok(/^\d{6}$/.test(room.roomNo), '实际：' + room.roomNo)
  })
  check('等待态渲染正常（含转圈与倒计时）', function () { app.renderOnce() })

  await waitFor(function () { return app.scene.name === 'deploy' }, '对手加入并切到布阵')
  check('对手加入后自动进入布阵', function () { assert.strictEqual(app.scene.name, 'deploy') })

  const deploy = app.scene
  check('布阵飞机数量取自房间设置', function () {
    assert.ok(deploy.planeCount >= 1 && deploy.planeCount <= 3, String(deploy.planeCount))
  })
  check('布阵初始未放置飞机', function () { assert.strictEqual(deploy.placed.length, 0) })

  const board = deploy.geo.board
  check('棋盘完整落在屏内', function () {
    assert.ok(board.x >= 0 && board.y >= 0)
    assert.ok(board.x + board.size <= 375, '右侧溢出')
    assert.ok(board.y + board.size <= 667, '底部溢出')
  })
  check('棋盘格可点（已注册 81 个格子）', function () {
    assert.ok(deploy.zones.length >= BOARD_SIZE * BOARD_SIZE, '实际 ' + deploy.zones.length)
  })
  check('布阵场景可渲染', function () { app.renderOnce() })

  // 点棋盘放一架（锚点 = 机头）
  const anchor = Board.cellRect({ x: board.x, y: board.y, size: board.size }, 3, 3)
  tapRect(anchor)
  check('点击棋盘成功放置飞机', function () { assert.strictEqual(deploy.placed.length, 1) })
  check('放置位置与点击格一致', function () {
    const p = deploy.placed[0]
    assert.strictEqual(p.anchorRow, 3)
    assert.strictEqual(p.anchorCol, 3)
  })

  // 再点同一处应被拒绝（重叠）
  tapRect(anchor)
  check('重叠位置被拒绝', function () { assert.strictEqual(deploy.placed.length, 1) })

  // 清空 + 随机
  tapRect(deploy.geo.opRects[2])
  check('「清空」生效', function () { assert.strictEqual(deploy.placed.length, 0) })
  tapRect(deploy.geo.opRects[1])
  check('「随机布阵」按数量放满', function () {
    assert.strictEqual(deploy.placed.length, deploy.planeCount)
  })
  tapRect(deploy.geo.opRects[0])
  check('「旋转」切换朝向', function () { assert.ok(deploy.rotation >= 0 && deploy.rotation <= 3) })

  // 就绪
  tapRect(deploy.geo.readyBtn)
  await waitFor(function () { return app.scene.name === 'battle' }, '就绪后进入对战', 8000)
  check('就绪后进入对战场景', function () { assert.strictEqual(app.scene.name, 'battle') })

  /* ---------- 5. 对战 ---------- */
  section('[5] 对战：双棋盘 / 选点 / 开火')

  const battle = app.scene
  await waitFor(function () { return battle.myOpenid }, '同步到自身身份')
  check('已拿到自身 openid', function () { assert.ok(!!battle.myOpenid) })
  check('已回传我方布阵用于渲染我方海域', function () {
    assert.ok(battle.myDeploy.length >= 1)
  })
  check('我方海域渲染出飞机格', function () {
    const flat = battle.myCells().reduce(function (a, row) { return a.concat(row) }, [])
    assert.ok(flat.filter(function (s) { return s === 'plane' }).length >= 10, '我方飞机格不足 10')
  })
  check('敌方海域不显示对方飞机（T-08）', function () {
    const flat = battle.foeCells().reduce(function (a, row) { return a.concat(row) }, [])
    assert.ok(flat.indexOf('plane') < 0, '敌方棋盘泄露了飞机格')
  })
  check('对战场景可渲染', function () { app.renderOnce() })

  await waitFor(function () { return battle.myTurn }, '轮到我方出手')
  check('轮次已交替到我方', function () { assert.ok(battle.myTurn) })
  check('敌方棋盘此时可点选', function () {
    const cellZones = battle.zones.filter(function (z) { return z.row && z.col })
    assert.ok(cellZones.length > 0, '未注册可点格')
    assert.ok(cellZones.filter(function (z) { return !z.disabled }).length > 0)
  })

  // 几何检查放在轮次落定之后：出招区（发射按钮）只在「轮到我方」时才存在，
  // 且回合切换会触发 layout() 重算两盘棋的位置与尺寸
  check('双棋盘均在屏内', function () {
    const L = app.layout
    ;[['我方', battle.geo.mineBoard], ['敌方', battle.geo.foeBoard]].forEach(function (it) {
      assert.ok(it[1].x >= 0 && it[1].y >= 0, it[0] + '棋盘左上出屏')
      assert.ok(it[1].x + it[1].size <= L.W, it[0] + '棋盘右侧出屏')
      assert.ok(it[1].y + it[1].size <= L.H, it[0] + '棋盘底部出屏')
    })
    assert.ok(battle.geo.mineBlock.h + battle.geo.foeBlock.h < L.H, '两块棋盘合计超屏')
  })
  check('「发射」按钮与底部操作栏均在屏内', function () {
    const L = app.layout
    const b = battle.geo.fireBtn
    const s = battle.geo.surrenderBtn
    assert.ok(b && s, '出招区未生成（fireBtn=' + !!b + ' surrenderBtn=' + !!s + '）')
    assert.ok(b.y + b.h <= L.H && s.y + s.h <= L.H)
  })

  // 选一格未被炸过的（先不打机头，验证「选中」这一步）
  const g = offline._getGame()
  check('本局飞机数量为 1（后续断言依赖「一炮定胜负」）', function () {
    assert.strictEqual(g.planeCount, 1, '实际 ' + g.planeCount)
  })
  const head = headOf(g.foeDeployed[0])

  // ⚠️ 几何必须在这里才取！
  // 回合切换会让焦点跟着切（我方回合 → 敌盘放大 / 对方回合 → 我盘放大），
  // applyBattle 检测到焦点变化会重跑 layout()，geo.foeBoard 的位置与尺寸都变了。
  // 若在 waitFor(myTurn) 之前缓存 foeBoard，算出来的像素点会落到别的格子上
  // （表现为「明明点了机头，却打到了镜像位置」），而且只在「先手是对方」时复现。
  const fb = battle.geo.foeBoard
  const headRect = Board.cellRect({ x: fb.x, y: fb.y, size: fb.size }, head.row, head.col)

  tapRect(headRect)
  check('点选格位后写入 selected', function () {
    assert.ok(battle.selected, '未写入 selected')
    assert.strictEqual(battle.selected.row, head.row,
      '行号不符：期望 ' + head.row + '，实际 ' + battle.selected.row + '（几何是否为旧布局？）')
    assert.strictEqual(battle.selected.col, head.col,
      '列号不符：期望 ' + head.col + '，实际 ' + battle.selected.col)
  })
  check('被选中的格出现在置灰表之外', function () {
    assert.ok(!battle.disabledMap()[head.row + ',' + head.col])
  })
  check('选中态可渲染（选中高亮）', function () { app.renderOnce() })

  // 发射
  const selBeforeFire = battle.selected ? (battle.selected.row + ',' + battle.selected.col) : 'null'
  tapRect(battle.geo.fireBtn)
  await waitFor(function () { return battle.selected === null }, '开火后清空选中')
  check('开火后清空选中', function () { assert.strictEqual(battle.selected, null) })
  check('发射坐标与点选一致', function () {
    assert.strictEqual(selBeforeFire, head.row + ',' + head.col,
      '发射坐标 ' + selBeforeFire + ' 与目标机头 ' + head.row + ',' + head.col + ' 不一致')
  })

  try {
    await waitFor(function () { return battle.finished }, '一方全灭', 8000)
  } catch (e) {
    // 失败时把对局状态打出来，否则只看到一句超时无从下手
    console.error('\n  [诊断] 我方飞机数=' + battle.planeCount +
      ' 轮次我方=' + battle.myTurn +
      ' 我击毁=' + battle.foeDestroyed +
      ' 我被毁=' + battle.myDestroyed +
      ' 我出手=' + battle.myShots +
      ' 对手出手=' + battle.foeShots +
      ' 终局=' + battle.finished +
      ' endType=' + (battle.lastBattle && battle.lastBattle.endType) +
      '\n  [诊断] myOpenid=' + battle.myOpenid +
      ' foeOpenid=' + battle.foeOpenid +
      ' 发射坐标=' + selBeforeFire +
      ' 我的轰炸记录=' + JSON.stringify(battle.mine) +
      ' 全体marks=' + JSON.stringify((battle.lastBattle || {}).marks) +
      ' 置灰表=' + JSON.stringify(Object.keys(battle.disabledMap())) +
      '\n  [诊断] 目标机头=' + head.row + ',' + head.col +
      ' 对手布阵=' + JSON.stringify(g.foeDeployed && g.foeDeployed.map(function (p) {
        return { id: p.planeId, r: p.anchorRow, c: p.anchorCol, rot: p.rotation }
      })))
    throw e
  }
  check('打中机头即击毁整机并结束对局', function () {
    assert.strictEqual(battle.foeDestroyed, 1)
    assert.ok(battle.finished)
  })
  check('已击毁格进入置灰表（不可再选）', function () {
    assert.ok(battle.disabledMap()[head.row + ',' + head.col])
  })

  /* ---------- 6. 结算 ---------- */
  section('[6] 结算')

  await waitFor(function () { return app.scene.name === 'result' }, '自动跳转结算', 8000)
  const result = app.scene
  check('已进入结算场景', function () { assert.strictEqual(app.scene.name, 'result') })
  check('结算数据已写入 globalData', function () {
    const r = app.globalData.matchResult
    assert.ok(r && typeof r.win === 'boolean')
    assert.strictEqual(r.endType, END_TYPE.ALL_DESTROYED)
    assert.ok(r.planeCount >= 1)
  })
  check('我方获胜时胜率统计正确', function () {
    const r = app.globalData.matchResult
    assert.strictEqual(r.win, true)
    assert.strictEqual(r.myDestroyed, 1)
    assert.strictEqual(r.foeDestroyed, 0)
  })
  check('结算场景可渲染', function () { app.renderOnce() })
  check('已记录最近对手', function () {
    const list = require('../minigame/js/shared/services/rivals').list()
    assert.ok(list.length >= 1, '最近对手为空')
  })
  check('结算按钮均在屏内', function () {
    result.geo.buttons.forEach(function (b) {
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 375 && b.y + b.h <= 667,
        '按钮溢出：' + JSON.stringify(b))
    })
  })

  /* ---------- 7. 触摸取消与返回 ---------- */
  section('[7] 触摸分发细节')

  check('拖动过的触摸不触发点击', function () {
    const before = app.scene.name
    app.touchStart(100, 100)
    app.touchMove(100, 400)
    app.touchEnd(100, 400)
    assert.strictEqual(app.scene.name, before, '拖动被误判为点击')
  })

  check('返回大厅后状态被清空', function () {
    const backBtn = result.geo.buttons[result.geo.buttons.length - 1]
    tapRect(backBtn)
    assert.strictEqual(app.scene.name, 'lobby')
    assert.strictEqual(app.globalData.match, null)
  })

  /* ---------- 收尾 ---------- */
  app.stop()
  offline._reset()

  console.log('\n----------------------------------------')
  console.log('通过 ' + pass + ' 项，失败 ' + failed + ' 项')
  console.log('----------------------------------------\n')
  process.exit(failed === 0 ? 0 : 1)
}

main().catch(function (err) {
  console.error('\n[小游戏端测试] 异常中断：', err)
  process.exit(1)
})
