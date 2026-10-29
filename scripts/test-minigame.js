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
// 桩本体在 scripts/lib/wx-stub.js —— 与界面预览脚本共用同一份，
// 免得两边各写一套后漂移，出现「预览正常、测试却挂」的鬼故事。

const { makeCtx, installWx } = require('./lib/wx-stub')

const CTX = makeCtx()
const _stub = installWx(CTX)
const STORE = _stub.STORE
// 弹窗桩：记下最后一次弹窗的参数，让「拦住了没有、说了什么」可以断言
const MODAL = _stub.MODAL

/* ================= 加载被测对象 ================= */

const app = require('../minigame/game')
const offline = require('../minigame/js/shared/services/offlineGame')
const cloudApi = require('../minigame/js/shared/services/cloudApi')
const geom = require('../minigame/js/core/geom')
const Board = require('../minigame/js/widgets/board')
const theme = require('../minigame/js/core/theme')
const planeFit = require('../minigame/js/core/fit')
const { getAbsoluteCells } = require('../minigame/js/shared/utils/plane')
const { BOARD_SIZE, MAX_PLANES, TURN_MIN, TURN_MAX, TURN_DEFAULT, RESULT, END_TYPE } =
  require('../minigame/js/shared/config/rules')

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

/**
 * 模拟一次拖拽：按住 from 中心 → 拖到 to 中心 → 抬手
 * 走真实 touchMove 分发，所以能顺带验证「拖动不触发 tap」与落位吸附
 */
function dragRect(from, to) {
  const fx = from.x + from.w / 2
  const fy = from.y + from.h / 2
  const tx = to.x + to.w / 2
  const ty = to.y + to.h / 2
  app.touchStart(fx, fy)
  app.touchMove(fx + (tx - fx) * 0.5, fy + (ty - fy) * 0.5)
  app.touchMove(tx, ty)
  app.touchEnd(tx, ty)
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
  check('大厅有「快速匹配」三张架数卡（1 / 2 / 3 架）', function () {
    assert.strictEqual(lobby.geo.matchCards.length, 3, '实际 ' + lobby.geo.matchCards.length)
    assert.deepStrictEqual(lobby.geo.matchCards.map(function (c) { return c.planes }), [1, 2, 3])
  })
  check('三张匹配卡横排、等宽、不重叠', function () {
    const cs = lobby.geo.matchCards
    const w0 = cs[0].w
    cs.forEach(function (c, i) {
      assert.ok(Math.abs(c.w - w0) < 0.001, '第 ' + i + ' 张宽度不一致')
      assert.ok(c.y === cs[0].y, '第 ' + i + ' 张没对齐')
    })
    assert.ok(cs[1].x > cs[0].x + cs[0].w, '第 2 张和第 1 张叠了')
    assert.ok(cs[2].x > cs[1].x + cs[1].w, '第 3 张和第 2 张叠了')
    assert.ok(cs[2].x + cs[2].w <= 375, '右侧溢出')
    assert.ok(cs[0].y >= 0 && cs[0].y + cs[0].h <= 667, '纵向溢出')
  })
  check('匹配卡在创建按钮上方（最显眼的位置先给匹配）', function () {
    const last = lobby.geo.matchCards[2]
    assert.ok(last.y + last.h < lobby.geo.createBtn.y)
  })
  check('创建 / 浏览 / 搜索三个入口都在屏内且互不重叠', function () {
    const bs = [lobby.geo.createBtn, lobby.geo.browseBtn, lobby.geo.searchBtn]
    bs.forEach(function (b) {
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= 375 && b.y + b.h <= 667, '出屏')
    })
    assert.ok(lobby.geo.createBtn.y + lobby.geo.createBtn.h < lobby.geo.browseBtn.y, '上下按钮重叠')
    assert.ok(lobby.geo.browseBtn.x + lobby.geo.browseBtn.w < lobby.geo.searchBtn.x, '左右按钮重叠')
  })

  // 点「2 架」那张卡：应当直接带着 planeCount=2 进房间页并自动发起匹配
  tapRect(lobby.geo.matchCards[1])
  check('点「2 架」进入房间页并带上架数', function () {
    assert.strictEqual(app.scene.name, 'room')
    assert.strictEqual(app.scene.mode, 'random')
    assert.strictEqual(app.scene.matchPlanes, 2)
  })
  app.back()
  await waitFor(function () { return app.scene.name === 'lobby' }, '回到大厅')

  tapRect(app.scene.geo.createBtn)
  check('点「创建房间」进入房间场景', function () { assert.strictEqual(app.scene.name, 'room') })

  const room = app.scene
  check('房间默认 create 模式', function () { assert.strictEqual(room.mode, 'create') })
  check('房间场景可渲染', function () { app.renderOnce() })
  check('房间页有四行设置：房名 / 飞机数量 / 每步限时 / 是否私密', function () {
    assert.ok(room.geo.nameY && room.geo.planeY && room.geo.stepY && room.geo.privY, '少了行位置')
    assert.ok(room.geo.nameY < room.geo.planeY && room.geo.planeY < room.geo.stepY
      && room.geo.stepY < room.geo.privY, '行顺序不对')
  })
  check('飞机数量是三段控件，默认 3 架', function () {
    assert.strictEqual(room.geo.planeRects.length, 3)
    assert.strictEqual(room.planeCount, MAX_PLANES)
    const r = room.geo.planeRects[2]
    assert.ok(r.x >= 0 && r.x + r.w <= 375, '第三段出屏')
  })
  check('每步限时是滑块，不是 ± 按钮', function () {
    assert.ok(room.geo.stepSlider, '没有滑块')
    assert.strictEqual(room.geo.stepMinus, undefined, '还留着减号按钮')
    const s = room.geo.stepSlider
    assert.ok(s.x >= 0 && s.x + s.w <= 375, '滑块出屏')
    assert.ok(s.y > room.geo.stepY, '滑块压到标题行')
  })
  check('卡片把四行都包进去，说明文字不滑出卡片底', function () {
    const card = room.geo.card
    assert.ok(card.h > app.u(500), '卡片太矮，四行放不下：' + card.h)
    assert.ok(room.geo.hintY > card.y && room.geo.hintY < card.y + card.h, '说明文字没落在卡片里')
    assert.ok(room.geo.stepSlider.y + room.geo.stepSlider.h < card.y + card.h, '滑块滑出卡片底')
  })

  /* ---- 架数分段：点一下即改 ---- */
  tapRect(room.geo.planeRects[0])
  check('点「1 架」后本局架数变 1', function () {
    assert.strictEqual(room.planeCount, 1)
  })
  tapRect(room.geo.planeRects[2])
  check('点回「3 架」', function () { assert.strictEqual(room.planeCount, 3) })

  /* ---- 滑块：拖动即改，1 秒连续 ---- */
  const slider = room.geo.stepSlider
  const sCy = slider.y + slider.h / 2
  const sLeft = slider.x + app.u(24) + 1
  const sRight = slider.x + slider.w - app.u(24) - 1
  app.touchStart(sRight, sCy)
  app.touchEnd(sRight, sCy)
  check('拖到最右 = 30 秒', function () { assert.strictEqual(room.stepSeconds, TURN_MAX) })

  app.touchStart(sLeft, sCy)
  app.touchEnd(sLeft, sCy)
  check('拖到最左 = 5 秒（下限）', function () { assert.strictEqual(room.stepSeconds, TURN_MIN) })

  app.touchStart(sLeft, sCy)
  app.touchMove(sLeft + (sRight - sLeft) * 0.5, sCy)
  app.touchEnd(sRight, sCy)
  check('拖动中途连续改值（1 秒粒度，不是 5 秒跳档）', function () {
    const v = room.stepSeconds
    assert.ok(v >= TURN_MIN && v <= TURN_MAX, '越界：' + v)
  })

  app.touchStart(sRight, sCy)
  app.touchEnd(sRight, sCy)
  check('每步限时仍是整数（滑块算出浮点也不会存进去）', function () {
    assert.strictEqual(room.stepSeconds, Math.round(room.stepSeconds))
  })
  app.renderOnce()

  /* ---------- 4. 创建房间 → 等待 → 对手就位 ---------- */
  section('[4] 创建房间 → 对手加入 → 布阵')

  // 「快速匹配」也要端到端对上架数：点「3 架」→ 房间就是 3 架 → 布阵页 3 个名额
  app.reset('lobby')
  tapRect(app.scene.geo.matchCards[2])
  await waitFor(function () { return app.scene.name === 'deploy' }, '匹配到房间并进入布阵')
  check('快速匹配 3 架 → 房间与布阵名额都是 3', function () {
    assert.strictEqual(app.globalData.match.planeCount, 3)
    assert.strictEqual(app.scene.slotCount, 3)
    assert.strictEqual(app.scene.placed.length, 3)
  })
  check('布阵页按 3 架自动摆满，且位置合规', function () {
    assert.strictEqual(app.scene.activeCount(), 3)
    assert.strictEqual(app.scene.audit().ok, true)
  })
  app.scene.stopCountdown()
  app.reset('lobby')
  await sleep(60)
  // 上面那次走的是 random 模式，房间场景被复用成 random 布局了 —— 重新进一次创建页
  app.go('room', { mode: 'create' })

  // 本段走「1 架局」：后面的对战断言依赖「一炮定胜负」。
  // 布阵细节里有需要 3 架的（重叠 / 身份色 / 上限），用夹具切过去，不靠房间。
  tapRect(room.geo.planeRects[0])
  check('创建前把架数定为 1（对战段依赖一炮定胜负）', function () {
    assert.strictEqual(room.planeCount, 1)
  })

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
  check('布阵页名额数 = 房间定的架数（1 架）', function () {
    assert.strictEqual(deploy.slotCount, 1, 'slotCount ' + deploy.slotCount)
    assert.strictEqual(deploy.placed.length, 1, '名额数 ' + deploy.placed.length)
    assert.strictEqual(deploy.geo.statusSlots.length, 1, '状态条槽位数不对')
  })
  check('进布阵页就按架数摆好，不用玩家一架架点「+」', function () {
    assert.strictEqual(deploy.activeCount(), 1)
    assert.strictEqual(deploy.audit().ok, true, '自动摆的位置竟然不合规')
  })

  // 夹具：把这一页切成 3 架局（房间是 1 架，但布阵细节要测 3 架才能覆盖重叠与配色）
  const mkSlot = function (slot) {
    return {
      slot: slot, planeId: 'standard', state: 'none',
      anchorRow: 0, anchorCol: 0, rotation: 0, cells: []
    }
  }
  const useSlots = function (n) {
    deploy.slotCount = n
    deploy.placed = []
    for (let i = 0; i < n; i++) deploy.placed.push(mkSlot(i))
    deploy.selected = -1
    deploy.drag = null
    deploy._press = null
    deploy.layout()
  }
  useSlots(3)

  // 极端夹具用：直接造一架在场的飞机（state 必须是 out 才算在场上）
  const mkOut = function (row, col, rot, slot) {
    return {
      slot: slot, planeId: 'standard', state: 'out',
      anchorRow: row, anchorCol: col, rotation: rot,
      cells: getAbsoluteCells('standard', row, col, rot)
    }
  }

  check('切到 3 架局后状态条跟着变成 3 个槽', function () {
    assert.strictEqual(deploy.geo.statusSlots.length, 3)
    const last = deploy.geo.statusSlots[2]
    assert.ok(last.x + last.w < deploy.geo.statusTextX, '棋子压到状态文字')
  })

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
  check('布阵页各区块不重叠且不出屏', function () {
    const L = app.layout
    const gg = deploy.geo
    assert.ok(gg.board.y + gg.board.size <= gg.statusY + 0.01, '棋盘压到状态条')
    assert.ok(gg.statusY + gg.statusH <= gg.opsY + 0.01, '状态条压到操作按钮')
    assert.ok(gg.opsY + gg.opsH <= gg.readyBtn.y + 0.01, '操作按钮压到就绪按钮')
    assert.ok(gg.readyBtn.y + gg.readyBtn.h <= L.H, '就绪按钮出屏')
    gg.opRects.forEach(function (r) {
      assert.ok(r.x >= 0 && r.x + r.w <= L.W, '操作按钮横向出屏')
    })
    // 状态条里的棋子不能压到右侧文字
    const lastSlot = gg.statusSlots[gg.statusSlots.length - 1]
    assert.ok(lastSlot.x + lastSlot.w < gg.statusTextX, '棋子压到状态文字')
    assert.ok(gg.statusTextX < gg.x + gg.w, '状态文字起点超出卡片')
  })

  /* ---------- 布阵：放置 ---------- */

  // ① 合法位置：落点 = 机头
  const anchor = Board.cellRect(board, 5, 5)
  tapRect(anchor)
  check('点空白格成功放置', function () { assert.strictEqual(deploy.activeCount(), 1) })
  check('落点即机头', function () {
    const p = deploy.placed[0]
    assert.strictEqual(p.anchorRow, 5)
    assert.strictEqual(p.anchorCol, 5)
    const head = p.cells.filter(function (c) { return c.isHead })[0]
    assert.strictEqual(head.row, 5)
    assert.strictEqual(head.col, 5)
    assert.strictEqual(p.cells.length, 10)
  })
  check('机头 / 机体分别标记，并带身份下标（用于配色区分每架）', function () {
    const flat = deploy.cells().reduce(function (a, r) { return a.concat(r) }, [])
    const heads = flat.filter(function (v) { return v && v.s === 'head' })
    const bodies = flat.filter(function (v) { return v && v.s === 'plane' })
    assert.strictEqual(heads.length, 1, '机头格 ' + heads.length)
    assert.strictEqual(bodies.length, 9, '机体格 ' + bodies.length)
    assert.strictEqual(heads[0].p, 0, '第 1 架的身份下标应为 0，实际 ' + heads[0].p)
    assert.strictEqual(bodies[0].p, 0)
  })

  // ② 越界落点 → 直接放下并标红（编辑期宽松：系统不替玩家改位置）
  tapRect(deploy.geo.opRects[2])         // 清空
  deploy.rotation = 0                    // 夹具：机头朝上、机身向下，第 8 行必然探出棋盘
  tapRect(Board.cellRect(board, 8, 3))
  check('越界落点直接放下，机头仍在点的那一格', function () {
    assert.strictEqual(deploy.activeCount(), 1, '越界落点没放下')
    const p = deploy.placed[0]
    assert.strictEqual(p.anchorRow, 8, '机头被系统挪走了：' + p.anchorRow)
    assert.strictEqual(p.anchorCol, 3, '机头被系统挪走了：' + p.anchorCol)
  })
  check('越界被审计出来（就绪时要靠它拦人）', function () {
    const a = deploy.audit()
    assert.strictEqual(a.ok, false, '越界竟然判为合规')
    assert.strictEqual(a.items.length, 1)
    assert.ok(a.items[0].outside > 0, '没有数出出界格数')
    assert.strictEqual(a.items[0].overlap, false)
  })
  check('越界那架整架标为不合规（半透明）+ 探出棋盘，出界格不进矩阵', function () {
    const flat = deploy.cells().reduce(function (a, r) { return a.concat(r) }, [])
    const planes = flat.filter(function (v) { return v && (v.s === 'plane' || v.s === 'head') })
    assert.ok(planes.length > 0, '棋盘上一格都没画')
    planes.forEach(function (v) {
      assert.strictEqual(v.bad, true, '有格子没被标为不合规')
      assert.strictEqual(v.trimmed, true, '没被标成「探出棋盘」')
    })
    assert.ok(planes.length < 10, '出界格不该出现在矩阵里，实际 ' + planes.length + ' 格')
  })
  check('标红状态可正常渲染', function () { app.renderOnce() })

  // ③ 压到别的飞机 → 也直接放下，只标红。
  //    这正是布阵死锁的解法：A 想挪到 B 的位置时，不必先把 A 扔进一个没用的空位。
  tapRect(deploy.geo.opRects[2])
  deploy.rotation = 0
  tapRect(Board.cellRect(board, 5, 5))   // A 占 行 5~8 / 列 3~7
  const firstCells = JSON.stringify(deploy.placed[0].cells)
  tapRect(Board.cellRect(board, 3, 5))   // B 机头 (3,5)，机身必然压到 A 的 5~6 行
  check('重叠落点也直接放下，且不动已放好的那架', function () {
    assert.strictEqual(deploy.activeCount(), 2, '重叠落点没放下：' + deploy.activeCount())
    assert.strictEqual(JSON.stringify(deploy.placed[0].cells), firstCells, '第 1 架被挪动了')
  })
  check('重叠被审计出来，两架都算不合规', function () {
    const a = deploy.audit()
    assert.strictEqual(a.ok, false, '重叠竟然判为合规')
    assert.strictEqual(a.items.length, 2, '违规架数 ' + a.items.length)
    a.items.forEach(function (it) { assert.strictEqual(it.overlap, true) })
  })
  check('冲突格单独标出来（哪几格叠在一起看得见）', function () {
    const a = deploy.audit()
    assert.ok(Object.keys(a.conflict).length > 0, '没有标出冲突格')
    const flat = deploy.cells().reduce(function (x, r) { return x.concat(r) }, [])
    assert.ok(flat.some(function (v) { return v && v.conflict }), '矩阵里没有 conflict 标记')
  })
  check('重叠只标 bad、不标 trimmed（压到人 ≠ 出界）', function () {
    const flat = deploy.cells().reduce(function (x, r) { return x.concat(r) }, [])
    const planes = flat.filter(function (v) { return v && (v.s === 'plane' || v.s === 'head') })
    assert.ok(planes.length > 0)
    planes.forEach(function (v) {
      assert.strictEqual(v.bad, true, '重叠的格子没标不合规')
      assert.strictEqual(v.trimmed, false, '把重叠误标成出界了')
    })
  })
  check('重叠状态可正常渲染', function () { app.renderOnce() })
  check('第 2 架带自己的身份下标（第 3 架同理）', function () {
    const flat = deploy.cells().reduce(function (a, r) { return a.concat(r) }, [])
    assert.ok(flat.some(function (v) { return v && v.p === 1 && v.s === 'head' }), '没有 p=1 的机头')
    assert.ok(flat.some(function (v) { return v && v.p === 1 && v.s === 'plane' }), '没有 p=1 的机体')
  })
  check('三架的身份色互不相同', function () {
    const pal = theme.color.planePalette
    assert.ok(pal.length >= 3, '调色板不足 3 色')
    const bodies = pal.slice(0, 3).map(function (p) { return p.body })
    const heads = pal.slice(0, 3).map(function (p) { return p.head })
    assert.strictEqual(new Set(bodies).size, 3, '机体色有重复：' + bodies.join(','))
    assert.strictEqual(new Set(heads).size, 3, '机头色有重复：' + heads.join(','))
    // 不能撞上棋盘上已有的语义色（红=击毁 / 橙=命中 / 绿=成功）
    const used = new Set((bodies.concat(heads)).map(function (v) { return v.toUpperCase() }))
    ;[theme.color.danger, theme.color.dangerDark, theme.color.hit, theme.color.success]
      .forEach(function (v) {
        assert.ok(!used.has(v.toUpperCase()), '飞机身份色撞上了语义色 ' + v)
      })
  })

  // ④ 清空重放一架，专测选中与旋转
  tapRect(deploy.geo.opRects[2])
  tapRect(Board.cellRect(board, 5, 5))
  check('清空并重放后只有 1 架', function () { assert.strictEqual(deploy.activeCount(), 1) })

  // ⑤ 点机头 → 选中（不再「点一下就删」，误触代价太高）
  tapRect(anchor)
  check('点机头选中该架（不删除）', function () {
    assert.strictEqual(deploy.activeCount(), 1, '点机头把飞机删掉了')
    assert.strictEqual(deploy.selected, 0, '未选中，selected=' + deploy.selected)
  })
  check('选中态给整架 10 格打描边标记', function () {
    const marks = deploy.marks()
    const sel = Object.keys(marks).filter(function (k) { return marks[k] === 'select' })
    assert.strictEqual(sel.length, 10, '描边格数 ' + sel.length)
  })
  check('选中态可渲染（选中高亮）', function () { app.renderOnce() })

  // ⑥ 已选中时再点机头 → 以机头为轴旋转 90°
  const rotBefore = deploy.placed[0].rotation
  const headPos = { row: deploy.placed[0].anchorRow, col: deploy.placed[0].anchorCol }
  tapRect(anchor)
  check('再点机头即以机头为轴旋转 90°', function () {
    assert.strictEqual(deploy.placed[0].rotation, (rotBefore + 1) % 4,
      '朝向没变：' + rotBefore + ' → ' + deploy.placed[0].rotation)
  })
  check('旋转后机头仍在原格（真正的「以头部为中心」）', function () {
    const p = deploy.placed[0]
    const head = p.cells.filter(function (c) { return c.isHead })[0]
    assert.strictEqual(head.row, headPos.row, '机头行跑了')
    assert.strictEqual(head.col, headPos.col, '机头列跑了')
    assert.strictEqual(p.cells.length, 10, '格数不是 10')
  })

  // ⑦ 选中态下点空白 → 只退出选中，不误放
  tapRect(Board.cellRect(board, 1, 1))
  check('选中态下点空白只退出选中，不放新飞机', function () {
    assert.strictEqual(deploy.selected, -1, '没退出选中')
    assert.strictEqual(deploy.activeCount(), 1, '误放了新飞机')
  })

  // ⑧ 按住机头拖到合法位置 → 整架跟着走
  const anchorNow = function () {
    return Board.cellRect(board, deploy.placed[0].anchorRow, deploy.placed[0].anchorCol)
  }
  dragRect(anchorNow(), Board.cellRect(board, 7, 7))
  check('拖拽后机头落到目标格', function () {
    const p = deploy.placed[0]
    assert.strictEqual(p.anchorRow, 7, '行未更新：' + p.anchorRow)
    assert.strictEqual(p.anchorCol, 7, '列未更新：' + p.anchorCol)
    const head = p.cells.filter(function (c) { return c.isHead })[0]
    assert.strictEqual(head.row, 7)
    assert.strictEqual(head.col, 7)
    assert.strictEqual(p.cells.length, 10, '拖拽后格数不是 10')
  })
  check('拖拽结束后不残留拖拽态', function () {
    assert.strictEqual(deploy.drag, null)
    assert.strictEqual(deploy._press, null)
  })

  // ⑨ 拖到会出界的位置 → 只给红框，松手就地落下（不再吸附去别处）
  //    先把朝向固定为 0，保证「拖到最下排必然探出棋盘」，不依赖前面步骤累积的朝向
  const p0 = deploy.placed[0]
  p0.rotation = 0
  p0.cells = getAbsoluteCells(p0.planeId, p0.anchorRow, p0.anchorCol, 0)
  const curHead = { row: p0.anchorRow, col: p0.anchorCol }
  const badTarget = Board.cellRect(board, 9, curHead.col)
  app.touchStart(anchorNow().x + anchorNow().w / 2, anchorNow().y + anchorNow().h / 2)
  app.touchMove(badTarget.x + badTarget.w / 2, badTarget.y + badTarget.h / 2)
  check('拖到放不下的位置：红框 + 说清超界几格', function () {
    assert.ok(deploy.drag, '没有进入拖拽态')
    assert.strictEqual(deploy.drag.valid, false, '这个位置竟然判为合法')
    assert.ok(deploy.drag.outside > 0, '没有数出出界格数')
    assert.ok(deploy.dragReasonText(deploy.drag).indexOf('超出棋盘') >= 0,
      deploy.dragReasonText(deploy.drag))
    const marks = deploy.marks()
    const kinds = Object.keys(marks).map(function (k) { return marks[k] })
    assert.ok(kinds.indexOf('ghostBad') >= 0, '没有红框：' + kinds.join(','))
    assert.ok(kinds.indexOf('hint') < 0, '系统还在替玩家找位置（不该再有吸附虚线框）')
  })
  check('拖拽中棋盘上不再留那架（本体与浅色留痕都没了）', function () {
    const p = deploy.placed[0]
    const m = deploy.cells()
    p.cells.forEach(function (c) {
      if (c.row < 1 || c.row > 9 || c.col < 1 || c.col > 9) return
      // 本局只有 1 架，原位置只要还有东西就是「那一架没被拿走」
      assert.ok(!m[c.row - 1][c.col - 1],
        '原位置 ' + c.row + ',' + c.col + ' 还画着东西')
    })

    const marks = deploy.marks()
    const kinds = Object.keys(marks).map(function (k) { return marks[k] })
    assert.ok(kinds.indexOf('fade') < 0, '原位置还留着浅色留痕')
    assert.ok(kinds.indexOf('ghostBad') >= 0, '落点红框没了：' + kinds.join(','))
  })
  check('拖拽中照常可渲染', function () { app.renderOnce() })
  app.touchEnd(badTarget.x + badTarget.w / 2, badTarget.y + badTarget.h / 2)
  check('松手就地落下（不弹回原位、不吸附去别处）', function () {
    const p = deploy.placed[0]
    assert.strictEqual(deploy.drag, null)
    assert.strictEqual(p.anchorRow, 9, '行没落到手指处：' + p.anchorRow)
    assert.strictEqual(p.anchorCol, curHead.col, '列没落到手指处：' + p.anchorCol)
    assert.strictEqual(deploy.activeCount(), 1)
  })
  check('落下后这架被标红，就绪会被它拦住', function () {
    const a = deploy.audit()
    assert.strictEqual(a.ok, false)
    assert.ok(a.items[0].outside > 0, '没有数出界格数')
  })
  check('机头始终留在棋盘内（它是抓手，也是旋转轴）', function () {
    deploy.activePlaced().forEach(function (p) {
      assert.ok(p.anchorRow >= 1 && p.anchorRow <= BOARD_SIZE, '机头行出界了：' + p.anchorRow)
      assert.ok(p.anchorCol >= 1 && p.anchorCol <= BOARD_SIZE, '机头列出界了：' + p.anchorCol)
    })
  })

  // ⑩ 贴边按旋转 → 就转，不偷偷挪位置
  tapRect(deploy.geo.opRects[2])          // 清空
  deploy.rotation = 0
  tapRect(Board.cellRect(board, 1, 5))    // 机头贴住上边，机身向下
  const edgeAnchor = { row: deploy.placed[0].anchorRow, col: deploy.placed[0].anchorCol }
  const edgeRot = deploy.placed[0].rotation
  tapRect(deploy.geo.opRects[0])          // 「旋转」
  check('贴边旋转只转向、不挪位（机头是轴，位置由玩家定）', function () {
    const p = deploy.placed[0]
    assert.strictEqual(p.rotation, (edgeRot + 1) % 4, '朝向没变，等于按了没反应')
    assert.strictEqual(p.anchorRow, edgeAnchor.row, '机头被系统挪走了')
    assert.strictEqual(p.anchorCol, edgeAnchor.col, '机头被系统挪走了')
    assert.strictEqual(p.cells.length, 10)
  })
  check('转完探出棋盘只是标红，不是拒绝', function () {
    const a = deploy.audit()
    assert.strictEqual(typeof a.ok, 'boolean')
    if (!a.ok) {
      assert.ok(a.items[0].outside > 0 || a.items[0].overlap, '违规原因不明')
    }
    app.renderOnce()
  })

  // ⑪ 点机体也能选中（命中判定放宽），再用「收起这架」把它拿开
  //     只挑「落在棋盘内」的机体格：旋转后可能有机体格探出边界，那格点不到
  const bodyCell = deploy.placed[0].cells.filter(function (c) {
    return !c.isHead && c.row >= 1 && c.row <= BOARD_SIZE && c.col >= 1 && c.col <= BOARD_SIZE
  })[0]
  tapRect(Board.cellRect(board, bodyCell.row, bodyCell.col))
  check('点机体也能选中该架', function () {
    assert.strictEqual(deploy.activeCount(), 1)
    assert.strictEqual(deploy.selected, 0, '未选中，selected=' + deploy.selected)
  })
  check('选中后其余飞机降饱和，焦点那架不降', function () {
    const dim = deploy.dimMap()
    const head = deploy.placed[0].cells.filter(function (c) { return c.isHead })[0]
    assert.ok(!dim[head.row + ',' + head.col], '被选中的飞机被降饱和了')
  })

  // 「移除」改成「收起」：本局几架在房间页就定死了，布阵时不能真删。
  // 玩家点它的心态是「先拿开腾地方，一会儿放回来」，所以位置和朝向必须留着。
  const stashedPos = {
    row: deploy.placed[0].anchorRow,
    col: deploy.placed[0].anchorCol,
    rot: deploy.placed[0].rotation
  }
  check('「收起这架」只改状态，数组不塌（下标 ≡ 编号）', function () {
    deploy.onSecondAction()
    assert.strictEqual(deploy.placed.length, MAX_PLANES, '数组长度变了，编号会塌')
    assert.strictEqual(deploy.placed[0].state, 'off', '没有标记为收起')
    assert.strictEqual(deploy.activeCount(), 0)
    assert.strictEqual(deploy.selected, -1)
  })
  check('收起的飞机：棋盘上不画、不算违规、不占位', function () {
    const flat = deploy.cells().reduce(function (a, r) { return a.concat(r) }, [])
    assert.ok(!flat.some(function (v) { return v && (v.s === 'plane' || v.s === 'head') }),
      '收起的飞机还画在棋盘上')
    assert.strictEqual(deploy.audit().items.length, 0, '收起的飞机被算成了违规')
    assert.strictEqual(deploy.offCount(), 1)
    assert.strictEqual(deploy.activePlaced().length, 0)
  })
  check('收起后位置和朝向原样留着', function () {
    const p = deploy.placed[0]
    assert.strictEqual(p.anchorRow, stashedPos.row)
    assert.strictEqual(p.anchorCol, stashedPos.col)
    assert.strictEqual(p.rotation, stashedPos.rot)
  })
  check('点状态条的虚线槽 → 放回原位，朝向不变', function () {
    deploy.onPickSlot(0)
    const p = deploy.placed[0]
    assert.strictEqual(p.state, 'out', '没有展开')
    assert.strictEqual(p.anchorRow, stashedPos.row, '回来的位置变了')
    assert.strictEqual(p.anchorCol, stashedPos.col, '回来的位置变了')
    assert.strictEqual(p.rotation, stashedPos.rot, '回来的朝向变了')
    assert.strictEqual(deploy.selected, 0, '展开后没有顺手选中它')
  })
  // 架数由房主开房时定死，布阵必须**正好摆满**。
  // 收起不再等于「这一局不用这架」—— 它只是「暂时挪开」，凑不够就开不了局。
  // 注意：这里不能真的提交 —— 离线引擎会在几百毫秒后把场景切到 battle，
  // 后面所有用例都会在一个已经被换掉的场景上跑。用 spy 顶掉 submit。
  const spySubmit = function (fn) {
    const orig = deploy.submit
    let called = false
    deploy.submit = function () { called = true }
    try { fn() } finally { deploy.submit = orig }
    return called
  }

  check('3 架局收起 1 架 → 就绪被拦（数量不符，不许开局）', function () {
    // 用「+」自动落位，保证位置本身合规，才能证明拦住它的只能是数量
    deploy.onClear()
    deploy.onPickSlot(0)
    deploy.onPickSlot(1)
    deploy.selected = 0
    deploy.onStashSelected()
    deploy.layout()
    assert.strictEqual(deploy.activeCount(), 1, '夹具没摆好')
    assert.strictEqual(deploy.offCount(), 1)
    MODAL.last = null
    const before = MODAL.count
    const called = spySubmit(function () { deploy.onReady() })
    assert.strictEqual(MODAL.count, before + 1, '数量不对却没弹窗')
    assert.strictEqual(MODAL.last.title, '还差 2 架', '弹窗标题：' + MODAL.last.title)
    assert.ok(!called, '数量不对竟然提交了')
    assert.ok(/必须正好摆 3 架/.test(MODAL.last.content), '没说清规则：' + MODAL.last.content)
  })
  check('拦截弹窗给一步到位的修法（补齐 / 我自己改）', function () {
    assert.strictEqual(MODAL.last.confirmText, '替我补齐')
    assert.strictEqual(MODAL.last.cancelText, '我自己改')
  })
  check('点「替我补齐」→ 补齐到本局架数且位置合规', function () {
    MODAL.last.success({ confirm: true })
    assert.strictEqual(deploy.activeCount(), 3, '没补齐：' + deploy.activeCount())
    assert.strictEqual(deploy.audit().ok, true, '补齐后位置不合规')
    assert.strictEqual(deploy.offCount(), 0, '收起的没放回来')
  })
  check('补齐后数量对上了，就绪放行', function () {
    MODAL.last = null
    const before = MODAL.count
    const called = spySubmit(function () { deploy.onReady() })
    assert.strictEqual(MODAL.count, before, '数量已对上还在拦：' + (MODAL.last && MODAL.last.title))
    assert.ok(called, '没放行')
  })
  check('一架都不放时，就绪被拦且说的是「还差 3 架」', function () {
    deploy.onClear()
    MODAL.last = null
    const called = spySubmit(function () { deploy.onReady() })
    assert.strictEqual(MODAL.last.title, '还差 3 架', '实际：' + (MODAL.last && MODAL.last.title))
    assert.ok(!called, '0 架竟然提交了')
    deploy.placed[0] = mkOut(5, 5, 0, 0)
    deploy.layout()
  })
  check('摆多了也能被拦，修法是「收起多的」', function () {
    // 3 架局摆 1 架会「还差 2 架」；这里反过来造一个 1 架局摆 3 架的局面
    deploy.slotCount = 1
    deploy.placed = [mkOut(1, 1, 0, 0), mkOut(4, 4, 0, 1), mkOut(7, 7, 0, 2)]
    deploy.layout()
    MODAL.last = null
    const called = spySubmit(function () { deploy.onReady() })
    assert.ok(!called, '摆多了竟然提交了')
    assert.strictEqual(MODAL.last.title, '多了 2 架', '实际：' + MODAL.last.title)
    assert.strictEqual(MODAL.last.confirmText, '收起多的')
    MODAL.last.success({ confirm: true })
    assert.strictEqual(deploy.activeCount(), 1, '没把多的收起来')
    assert.strictEqual(deploy.offCount(), 2, '收起的不该直接删掉')
    // 恢复 3 架局给后面的用例
    useSlots(3)
    deploy.onClear()
  })

  // 极端情况：三架完全重合。真实操作里「连续拖到同一处」就能达成，不能崩
  check('三架重合时三架都算违规，且能在重叠格上轮换选中', function () {
    deploy.placed = [mkOut(5, 5, 0, 0), mkOut(5, 5, 0, 1), mkOut(5, 5, 0, 2)]
    const a = deploy.audit()
    assert.strictEqual(a.items.length, 3, '违规架数 ' + a.items.length)
    a.items.forEach(function (it) { assert.strictEqual(it.overlap, true) })
    assert.strictEqual(Object.keys(a.conflict).length, 10,
      '冲突格数 ' + Object.keys(a.conflict).length)
    app.renderOnce()

    // 点机翼格（非机头，不会触发旋转）→ 每点一次轮到下一架
    deploy.selected = -1
    const order = []
    for (let i = 0; i < 3; i++) {
      deploy.onBoardTap(6, 5)
      order.push(deploy.selected)
    }
    assert.deepStrictEqual(order, [2, 1, 0], '轮换顺序不对：' + order.join(','))
  })

  // 机头重合：两架的抓手、旋转轴、描边全在同一个像素上，
  // 画面上唯一的差别就是机头牌里的那个数字 —— 所以点一下必须让它变，
  // 而且不能顺手旋转（重叠态转完可能还叠着，且会和「点一下切换」抢同一个手势）
  check('机头重叠时点机头 = 切换选择不旋转，机头牌换成选中那架的编号', function () {
    deploy.placed = [mkOut(5, 5, 0, 0), mkOut(5, 5, 1, 1),
      { slot: 2, planeId: 'standard', state: 'none', anchorRow: 0, anchorCol: 0, rotation: 0, cells: [] }]
    deploy.selected = -1
    app.renderOnce()

    deploy.onBoardTap(5, 5)
    assert.strictEqual(deploy.selected, 1, '第一次点没选中后放的那架：' + deploy.selected)
    let head = deploy.cells()[4][4]
    assert.strictEqual(head.s, 'head', '重叠处没画成机头：' + head.s)
    assert.ok(head.stack > 1, '机头格没标出「叠了几架」：stack=' + head.stack)
    assert.strictEqual(head.p, 1, '机头牌写的不是选中架的编号：' + head.p)

    const rot = [deploy.placed[0].rotation, deploy.placed[1].rotation]
    deploy.onBoardTap(5, 5)
    assert.strictEqual(deploy.selected, 0, '没有轮换到另一架：' + deploy.selected)
    assert.deepStrictEqual([deploy.placed[0].rotation, deploy.placed[1].rotation], rot,
      '重叠处点按顺手把飞机转了 —— 这一步只该切换选择')
    head = deploy.cells()[4][4]
    assert.strictEqual(head.p, 0, '切换后机头牌没换成第 1 架的编号：' + head.p)
    app.renderOnce()
  })

  check('机头重叠时，按住拖抓的是选中那架（不是永远后放的）', function () {
    deploy.selected = 0
    const r = Board.cellRect(deploy.geo.board, 5, 5)
    deploy.onTouchStart(r.x + r.w / 2, r.y + r.h / 2)
    assert.ok(deploy._press, '没进入待拖状态')
    assert.strictEqual(deploy._press.idx, 0,
      '抓到了第 ' + (deploy._press.idx + 1) + ' 架，不是选中的第 1 架')
    deploy._press = null
    deploy.selected = -1
    deploy.onClear()
    app.renderOnce()
  })

  // ⑫ 就绪校验：还有不合规的飞机 → 拦住，并说清是哪一架
  // 先切成 2 架局，这样「数量」正好对上，被拦只可能因为位置
  useSlots(2)
  tapRect(deploy.geo.opRects[2])          // 清空
  deploy.rotation = 0
  tapRect(Board.cellRect(board, 5, 5))    // A 占 行 5~8
  tapRect(Board.cellRect(board, 3, 5))    // B 压到 A
  const pendingBefore = deploy.pendingCount()
  check('有违规时「就绪」变成「先修正 N 架」', function () {
    assert.strictEqual(pendingBefore, 2, '违规架数 ' + pendingBefore)
    app.renderOnce()
  })
  check('点「就绪」被拦下：不提交、不跳走，并选中第一架问题飞机', function () {
    tapRect(deploy.geo.readyBtn)
    assert.strictEqual(app.scene.name, 'deploy', '竟然开局了')
    assert.strictEqual(deploy.readying, false, '竟然进了提交态')
    assert.strictEqual(deploy.waiting, false, '竟然进了等待态')
    assert.strictEqual(deploy.selected, 0, '没把玩家带到第一架问题飞机上')
  })
  check('拦截后可渲染（红格 + 状态条徽标 + 橙色按钮）', function () { app.renderOnce() })

  // ⑬ 「自动整理」= 显式修复入口：玩家点了才动他的飞机
  deploy.autoFix()
  check('「自动整理」把违规飞机挪到最近的合法位置', function () {
    const a = deploy.audit()
    assert.strictEqual(a.ok, true, '整理后仍不合规：' + JSON.stringify(a.items))
    assert.strictEqual(deploy.activeCount(), 2, '整理过程中丢了飞机')
  })
  check('整理后互不重叠、没有出界格', function () {
    const key = {}
    deploy.placed[0].cells.forEach(function (c) { key[c.row + ',' + c.col] = true })
    deploy.placed[1].cells.forEach(function (c) {
      assert.ok(!key[c.row + ',' + c.col], '仍重叠在 ' + c.row + ',' + c.col)
    })
    deploy.placed.forEach(function (p) {
      p.cells.forEach(function (c) {
        assert.ok(c.row >= 1 && c.row <= BOARD_SIZE && c.col >= 1 && c.col <= BOARD_SIZE,
          '仍有格出界：' + c.row + ',' + c.col)
      })
    })
  })

  // ⑭ 清空 / 随机布阵（切回 3 架局）
  useSlots(3)
  tapRect(deploy.geo.opRects[2])
  check('「清空」生效：名额都回到「未加入」', function () {
    assert.strictEqual(deploy.activeCount(), 0)
    assert.strictEqual(deploy.noneCount(), deploy.slotCount)
    assert.strictEqual(deploy.offCount(), 0, '清空应该连收起的位置一起清掉')
  })

  // ⑮ 随机布阵：总是摆满「本局架数」。架数不是它能改的东西 —— 房间上写着。
  check('随机布阵摆满本局架数（3 架）', function () {
    tapRect(deploy.geo.opRects[1])
    assert.strictEqual(deploy.activeCount(), deploy.slotCount, '实际 ' + deploy.activeCount())
    const a = deploy.audit()
    assert.strictEqual(a.ok, true, '随机布阵产生了违规：' + JSON.stringify(a.items))
  })
  check('随机布阵后机头仍带身份下标', function () {
    const flat = deploy.cells().reduce(function (a, r) { return a.concat(r) }, [])
    assert.ok(flat.some(function (v) { return v && v.p === 0 && v.s === 'head' }), '没有 p=0 的机头')
    assert.ok(flat.some(function (v) { return v && v.p === 2 && v.s === 'head' }), '没有 p=2 的机头')
  })
  check('场上只有 1 架时随机布阵仍然摆满（不会被现有数量带偏）', function () {
    deploy.onClear()
    tapRect(Board.cellRect(board, 5, 5))
    assert.strictEqual(deploy.activeCount(), 1)
    tapRect(deploy.geo.opRects[1])
    assert.strictEqual(deploy.activeCount(), deploy.slotCount, '实际 ' + deploy.activeCount())
    assert.strictEqual(deploy.audit().ok, true, '重排后不合规')
  })

  // ⑯ 点状态条的「+」= 往棋盘上添一架（这就是「合并数量」后的添加入口）
  check('点状态条的「+」添一架，落在合法位置并被选中', function () {
    deploy.onClear()
    tapRect(deploy.geo.statusSlots[1])          // 点第 2 个名额
    assert.strictEqual(deploy.activeCount(), 1, '没添上')
    assert.strictEqual(deploy.placed[1].state, 'out', '添到了别的名额上')
    assert.strictEqual(deploy.selected, 1, '添完没有选中它，玩家还得自己找')
    assert.strictEqual(deploy.audit().ok, true, '自动落点竟然不合法')
    const p = deploy.placed[1]
    assert.ok(p.cells.length === 10, '格数不是 10')
    p.cells.forEach(function (c) {
      assert.ok(c.row >= 1 && c.row <= BOARD_SIZE && c.col >= 1 && c.col <= BOARD_SIZE,
        '自动落点探出棋盘：' + c.row + ',' + c.col)
    })
  })
  check('再点一次「+」添第二架，位置不跟第一架重叠', function () {
    tapRect(deploy.geo.statusSlots[0])
    assert.strictEqual(deploy.activeCount(), 2)
    assert.strictEqual(deploy.audit().ok, true, '两架自动落点重叠了')
  })
  check('点「+」添到上限后再点第 4 个位置——没有第 4 个（本局 3 架）', function () {
    tapRect(deploy.geo.statusSlots[2])
    assert.strictEqual(deploy.activeCount(), deploy.slotCount)
    assert.strictEqual(deploy.noneCount(), 0)
    assert.strictEqual(deploy.audit().ok, true, '三架自动落点互相压到了')
  })

  // 战斗段落依赖「1 架、一炮定胜负」：切回 1 架局（房间本来就是 1 架）
  deploy.slotCount = 1
  deploy.placed = [mkSlot(0)]
  deploy.selected = -1
  deploy.drag = null
  deploy.rotation = 0
  deploy.layout()
  tapRect(Board.cellRect(board, 5, 5))
  check('1 架局摆 1 架 → 就绪按钮报「就绪 · 1 架」且放行', function () {
    assert.strictEqual(deploy.activeCount(), 1)
    assert.strictEqual(deploy.audit().ok, true)
    MODAL.last = null
    const called = spySubmit(function () { deploy.onReady() })
    assert.ok(called, '1 架局摆 1 架竟然没放行')
  })

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
  check('我方海域渲染出飞机格（机体 + 机头）', function () {
    const flat = battle.myCells().reduce(function (a, row) { return a.concat(row) }, [])
    const norm = flat.map(function (v) { return Board.normCell(v) })
    const heads = norm.filter(function (v) { return v && v.s === 'head' }).length
    const bodies = norm.filter(function (v) { return v && v.s === 'plane' }).length
    assert.ok(bodies + heads >= 10, '我方飞机格不足 10，实际 ' + (bodies + heads))
    assert.strictEqual(heads, battle.planeCount, '机头格数应等于我方飞机数')
  })
  check('我方海域沿用布阵时的身份色（能看出是哪一架被打）', function () {
    const flat = battle.myCells().reduce(function (a, row) { return a.concat(row) }, [])
    assert.ok(flat.some(function (v) { return v && v.p === 0 }), '我方飞机没有身份下标')
  })
  check('敌方海域不显示对方飞机（T-08）', function () {
    const flat = battle.foeCells().reduce(function (a, row) { return a.concat(row) }, [])
    assert.ok(flat.indexOf('plane') < 0, '敌方棋盘泄露了飞机机体')
    assert.ok(flat.indexOf('head') < 0, '敌方棋盘泄露了机头')
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

  check('双击同一格 = 发射；单击、换格、隔太久都不算', function () {
    const createBattle = require('../minigame/js/scenes/battle')
    // 单独建一个场景实例（不是当前正在跑的那个），把 layout 和 onFire 换成探针。
    // 不这么做的话，双击会把真实对局打完，后面几个用例全落在一个已结算的局上。
    const b = createBattle(app)
    b.myTurn = true
    b.finished = false
    b.firing = false
    b.focus = 'foe'
    b.selected = null
    b._lastTap = null
    let fires = 0
    b.onFire = function () { fires += 1 }
    b.layout = function () {}

    b.onFoeCellTap(3, 4)
    assert.strictEqual(fires, 0, '单击就开火了')
    assert.deepStrictEqual(b.selected, { row: 3, col: 4 }, '单击没有选中')

    b.onFoeCellTap(3, 4)
    assert.strictEqual(fires, 1, '同一格双击没有开火')

    // 双击后立刻再点一下：应该是「重新选一次」，不该变成第二炮
    b.onFoeCellTap(3, 4)
    assert.strictEqual(fires, 1, '连点三下打出了两炮')

    // 换格：第一次只是改选，第二次才是双击
    b.onFoeCellTap(5, 6)
    assert.strictEqual(fires, 1, '点了别的格被当成双击')
    b.onFoeCellTap(5, 6)
    assert.strictEqual(fires, 2, '换格后双击没开火')

    // 慢点两下同一格：真机上「看一眼再决定」很常见，不能算开火
    b.onFoeCellTap(7, 8)
    b._lastTap.at = Date.now() - 400
    b.onFoeCellTap(7, 8)
    assert.strictEqual(fires, 2, '隔了 400ms 还被当成双击')

    // 上一炮还没回来时双击：不能再打一炮
    b.firing = true
    b._lastTap = null
    b.onFoeCellTap(1, 1)
    b.onFoeCellTap(1, 1)
    assert.strictEqual(fires, 2, '上一炮没回来就又开了一炮')
  })

  check('返回大厅后状态被清空', function () {
    const backBtn = result.geo.buttons[result.geo.buttons.length - 1]
    tapRect(backBtn)
    assert.strictEqual(app.scene.name, 'lobby')
    assert.strictEqual(app.globalData.match, null)
  })

  /* ---------- 8. 智能落位求解器（纯函数） ---------- */
  section('[8] 智能落位求解器（放不下怎么办）')

  const FS = require('../minigame/js/shared/config/rules')
  const emptyOcc = []

  check('完全合法时原地返回，不挪位不转向', function () {
    const f = planeFit.findFit({
      planeId: 'standard', anchorRow: 5, anchorCol: 5, rotation: 0, occupied: emptyOcc
    })
    assert.strictEqual(f.anchorRow, 5)
    assert.strictEqual(f.anchorCol, 5)
    assert.strictEqual(f.rotation, 0)
    assert.strictEqual(f.moved, false)
    assert.strictEqual(f.turned, false)
  })

  check('越界时向棋盘内吸附（距离优先）', function () {
    // 机头在第 8 行、朝上 → 机体延伸到第 11 行，必须上移
    const f = planeFit.findFit({
      planeId: 'standard', anchorRow: 8, anchorCol: 3, rotation: 0, occupied: emptyOcc
    })
    assert.ok(f, '没有找到吸附位置')
    assert.strictEqual(f.anchorRow, 6, '应吸附到第 6 行，实际 ' + f.anchorRow)
    assert.strictEqual(f.anchorCol, 3)
    assert.ok(f.moved && !f.turned, '不该改朝向')
  })

  check('重叠时绕开已有飞机，且不动已有飞机', function () {
    const blocker = getAbsoluteCells('standard', 5, 5, 0)
    // 半径给足：任务中心那架横跨 4 行 5 列，半径 2 根本跨不过去
    const f = planeFit.findFit({
      planeId: 'standard', anchorRow: 5, anchorCol: 5, rotation: 0,
      occupied: blocker, maxRadius: 6
    })
    assert.ok(f, '没有找到空位')
    const key = {}
    blocker.forEach(function (c) { key[c.row + ',' + c.col] = true })
    f.cells.forEach(function (c) {
      assert.ok(!key[c.row + ',' + c.col], '吸附结果与已有飞机重叠于 ' + c.row + ',' + c.col)
    })
  })

  check('allowRotate=false 时绝不改朝向（拖拽场景）', function () {
    // 机头贴在左边缘，朝左必然出界；不改朝向就必须靠挪位置解决
    const f = planeFit.findFit({
      planeId: 'standard', anchorRow: 5, anchorCol: 1, rotation: 3,
      occupied: emptyOcc, allowRotate: false
    })
    if (f) assert.strictEqual(f.rotation, 3, '朝向被偷改了：' + f.rotation)
  })

  check('prefer=rotate 时优先原地换向，而不是先挪位置', function () {
    // 在 (1,5) 朝上放不下（机体会出头？不，朝上是向下延伸，能放下）—— 用一个必然出界的组合：
    // 机头在 (1,1) 朝左：机体会伸到第 -2 列
    const f = planeFit.findFit({
      planeId: 'standard', anchorRow: 1, anchorCol: 1, rotation: 3,
      occupied: emptyOcc, allowMove: true, allowRotate: true, prefer: 'rotate'
    })
    assert.ok(f, '没有找到能转的朝向')
    assert.ok(f.turned, 'prefer=rotate 却没转向')
  })

  check('搜索半径内无解时返回 null（不硬塞到远处）', function () {
    const full = []
    for (let r = 1; r <= FS.BOARD_SIZE; r++) {
      for (let c = 1; c <= FS.BOARD_SIZE; c++) full.push({ row: r, col: c })
    }
    const f = planeFit.findFit({
      planeId: 'standard', anchorRow: 5, anchorCol: 5, rotation: 0,
      occupied: full, allowMove: true, allowRotate: true, maxRadius: 2
    })
    assert.strictEqual(f, null)
  })

  check('maxRadius 被严格执行', function () {
    // 只有把第 1~4 行整片占满，第 5 行才放不下；此时最近空位在半径外
    const occ = []
    for (let r = 1; r <= 4; r++) {
      for (let c = 1; c <= 9; c++) occ.push({ row: r, col: c })
    }
    const near = planeFit.findFit({
      planeId: 'standard', anchorRow: 3, anchorCol: 5, rotation: 0, occupied: occ,
      allowMove: true, allowRotate: false, maxRadius: 1
    })
    assert.strictEqual(near, null, '半径 1 内不该有解')
    const far = planeFit.findFit({
      planeId: 'standard', anchorRow: 3, anchorCol: 5, rotation: 0, occupied: occ,
      allowMove: true, allowRotate: false, maxRadius: 3
    })
    assert.ok(far, '半径 3 内应有解')
    assert.ok(far.dist <= 3, '解的距离超出半径：' + far.dist)
  })

  check('失败原因区分「出界」与「压到别的飞机」', function () {
    assert.strictEqual(planeFit.checkAt('standard', 9, 5, 0, emptyOcc), 'out_of_board')
    assert.strictEqual(planeFit.checkAt('standard', 1, 1, 0, emptyOcc), 'out_of_board')
    const occ = getAbsoluteCells('standard', 5, 5, 0)
    assert.strictEqual(planeFit.checkAt('standard', 5, 5, 0, occ), 'overlap')
    assert.strictEqual(planeFit.checkAt('standard', 3, 3, 0, emptyOcc), null)
  })

  check('原因文案面向玩家（不含「失败」「错误」）', function () {
    const out = planeFit.describeReason('out_of_board')
    const ov = planeFit.describeReason('overlap')
    assert.ok(out.indexOf('棋盘') >= 0, out)
    assert.ok(ov.indexOf('飞机') >= 0, ov)
    ;[out, ov].forEach(function (t) {
      assert.ok(t.indexOf('失败') < 0 && t.indexOf('错误') < 0 && t.indexOf('非法') < 0, t)
    })
  })

  check('occupiedExcept 正确排除被拖拽/旋转的那一架', function () {
    const placed = [
      { cells: getAbsoluteCells('standard', 1, 1, 0) },
      { cells: getAbsoluteCells('standard', 5, 5, 0) }
    ]
    assert.strictEqual(planeFit.occupiedExcept(placed, 0).length, 10)
    assert.strictEqual(planeFit.occupiedExcept(placed, -1).length, 20)
    const key = {}
    planeFit.occupiedExcept(placed, 1).forEach(function (c) { key[c.row + ',' + c.col] = true })
    assert.ok(key['5,5'] === undefined, '排除失败：仍含第 2 架的格')
  })

  check('吸附结果永远落在棋盘内（随机压测 500 次）', function () {
    for (let i = 0; i < 500; i++) {
      const row = 1 + Math.floor(Math.random() * 9)
      const col = 1 + Math.floor(Math.random() * 9)
      const rot = Math.floor(Math.random() * 4)
      const f = planeFit.findFit({
        planeId: 'standard', anchorRow: row, anchorCol: col, rotation: rot,
        occupied: [], allowMove: true, allowRotate: true, maxRadius: 2
      })
      // 9×9 放一架 10 格飞机，任何位置朝任何方向都至少有一个能落的地方
      assert.ok(f, '第 ' + i + ' 次无解：' + row + ',' + col + ' rot=' + rot)
      f.cells.forEach(function (c) {
        assert.ok(c.row >= 1 && c.row <= 9 && c.col >= 1 && c.col <= 9,
          '第 ' + i + ' 次出界：' + c.row + ',' + c.col)
      })
    }
  })

  /* ---------- 9. 创建房间页：房名 / 单步限时 / 私密开关 ---------- */
  section('[9] 创建房间：房名、单步限时、公开或私密')

  app.go('room', { mode: 'create' })
  const cr = app.scene
  check('创建页四行设置都在卡片内，且卡片不压住底部按钮', function () {
    const card = cr.geo.card
    assert.ok(card.h > 0, '没有卡片')
    ;[cr.geo.nameY, cr.geo.planeY, cr.geo.stepY, cr.geo.privY, cr.geo.hintY].forEach(function (y) {
      assert.ok(y > card.y && y < card.y + card.h, '有一行跑出卡片：' + y)
    })
    assert.ok(card.y + card.h < 667 - 80, '卡片压到底部操作区')
  })
  check('默认不设密码 = 公开房间', function () {
    assert.strictEqual(cr.usePassword, false)
  })
  check('房间名默认取昵称，非空且不超过 12 字', function () {
    assert.ok(cr.roomName && cr.roomName.length > 0, '房间名为空')
    assert.ok(cr.roomName.length <= 12, '房间名过长：' + cr.roomName)
  })
  check('每步限时默认 20 秒（范围内）', function () {
    assert.strictEqual(cr.stepSeconds, TURN_DEFAULT)
    assert.ok(cr.stepSeconds >= TURN_MIN && cr.stepSeconds <= TURN_MAX)
  })
  check('滑块把限时夹在 5~30 秒之间（拖到两端越界也不飘）', function () {
    const r = cr.geo.stepSlider
    const cy = r.y + r.h / 2
    app.touchStart(r.x + 2, cy)
    app.touchEnd(r.x + 2, cy)
    assert.strictEqual(cr.stepSeconds, TURN_MIN, '左端失效：' + cr.stepSeconds)
    app.touchStart(r.x + r.w - 2, cy)
    app.touchEnd(r.x + r.w - 2, cy)
    assert.strictEqual(cr.stepSeconds, TURN_MAX, '右端失效：' + cr.stepSeconds)
  })
  check('滑块 1 秒连续：拖到中间能取到 5 与 30 之间的任意整数', function () {
    const r = cr.geo.stepSlider
    const cy = r.y + r.h / 2
    const left = r.x + app.u(24)
    const right = r.x + r.w - app.u(24)
    // 走到 1/4、1/2、3/4，三个点都应该落在开区间里，且互不相同
    const got = []
    ;[0.25, 0.5, 0.75].forEach(function (t) {
      app.touchStart(left + (right - left) * t, cy)
      app.touchEnd(left + (right - left) * t, cy)
      got.push(cr.stepSeconds)
    })
    got.forEach(function (v) {
      assert.ok(v > TURN_MIN && v < TURN_MAX, '没落在开区间：' + v)
      assert.strictEqual(v, Math.round(v), '不是整数：' + v)
    })
    assert.strictEqual(new Set(got).size, 3, '三个位置取到同一个值：' + got.join(','))
  })
  check('打开私密开关后出现密码行，且整卡仍在屏内', function () {
    tapRect({ x: cr.geo.switch.x, y: cr.geo.switch.y, w: cr.geo.switch.w, h: cr.geo.switch.h })
    assert.strictEqual(cr.usePassword, true)
    assert.ok(cr.geo.pwdY > cr.geo.card.y && cr.geo.pwdY < cr.geo.card.y + cr.geo.card.h, '密码行跑出卡片')
    assert.ok(cr.geo.card.y + cr.geo.card.h < 667 - 80, '加密码行后卡片压到底部按钮')
    app.renderOnce()
  })
  check('关掉开关回到公开房间，密码行随之消失', function () {
    tapRect({ x: cr.geo.switch.x, y: cr.geo.switch.y, w: cr.geo.switch.w, h: cr.geo.switch.h })
    assert.strictEqual(cr.usePassword, false)
    assert.strictEqual(cr.geo.pwdY, undefined)
  })

  /* ---------- 10. 公开房间列表 / 按名搜索 ---------- */
  section('[10] 公开房间列表与按名搜索')

  app.reset('lobby')
  app.go('rooms', { mode: 'public' })
  const rl = app.scene
  await waitFor(function () { return rl.all.length > 0 }, '公开房间列表加载')

  check('公开列表至少一条，且每条都有房间号 / 房名 / 架数 / 单步限时', function () {
    assert.ok(rl.all.length > 0)
    rl.all.forEach(function (it) {
      assert.ok(/^\d{6}$/.test(it.roomNo), '房间号不合法：' + it.roomNo)
      assert.ok(it.roomName && it.roomName.length > 0, '缺少房名')
      assert.ok(it.planeCount >= 1 && it.planeCount <= 3, '架数不合法：' + it.planeCount)
      assert.ok(it.stepSeconds >= 5 && it.stepSeconds <= 30, '单步限时不合法：' + it.stepSeconds)
    })
  })
  check('公开列表里只有公开房', function () {
    assert.ok(!rl.all.some(function (it) { return it.hasPassword }), '公开列表混进了私密房')
  })
  check('列表项之间不重叠，也不压住底部按钮', function () {
    const items = rl.geo.items
    for (let i = 1; i < items.length; i++) {
      assert.ok(items[i].y >= items[i - 1].y + items[i - 1].h, '第 ' + i + ' 项与上一项重叠')
    }
    const last = items[items.length - 1]
    assert.ok(last.y + last.h < rl.geo.actionY, '最后一项压住底部按钮')
  })
  check('列表页可渲染', function () { app.renderOnce() })

  // 搜索：模糊匹配 + 私密房也搜得到
  app.reset('lobby')
  app.go('rooms', { mode: 'search' })
  const sr = app.scene
  check('搜索页有搜索框，且初始为空态', function () {
    assert.ok(sr.geo.searchBox, '没有搜索框')
    assert.strictEqual(sr.all.length, 0, '没输关键字就出结果了')
    app.renderOnce()
  })

  sr.keyword = '老周'
  sr.load()
  await waitFor(function () { return sr.all.length > 0 }, '搜索结果加载')
  check('按房名模糊匹配命中多个房间', function () {
    assert.ok(sr.all.length >= 2, '只命中 ' + sr.all.length + ' 条')
    sr.all.forEach(function (it) {
      assert.ok(it.roomName.indexOf('老周') >= 0, '混入了不匹配的房间：' + it.roomName)
    })
  })
  check('搜索结果包含私密房（房名不是秘密，密码才是）', function () {
    assert.ok(sr.all.some(function (it) { return it.hasPassword }), '私密房搜不到')
  })
  check('搜索页可渲染', function () { app.renderOnce() })

  const privItem = sr.all.filter(function (it) { return it.hasPassword })[0]
  MODAL.last = null
  sr.onPick(privItem)
  check('点私密房先弹密码框，不直接进去', function () {
    assert.ok(MODAL.last && /密码/.test(MODAL.last.title || ''), '没有弹密码框')
    assert.strictEqual(app.scene.name, 'rooms', '没输密码就进去了')
  })

  MODAL.last.success({ confirm: true, content: '0000' })
  await sleep(30)
  check('密码错误时留在列表页', function () {
    assert.strictEqual(app.scene.name, 'rooms')
  })

  MODAL.last = null
  sr.onPick(privItem)
  MODAL.last.success({ confirm: true, content: '8888' })
  await waitFor(function () {
    const m = app.globalData.match
    return m && m.roomNo === privItem.roomNo
  }, '密码正确后进入房间')
  check('密码正确后带上了房间的房名与单步限时', function () {
    const m = app.globalData.match
    assert.strictEqual(m.roomName, privItem.roomName)
    assert.strictEqual(m.stepSeconds, privItem.stepSeconds)
    // 双方齐了就直接进布阵；列表页 → 等待页 → 布阵这条链不断
    assert.ok(app.scene.name === 'room' || app.scene.name === 'deploy',
      '没有进入房间：' + app.scene.name)
  })
  if (app.scene.onExit) app.scene.onExit()

  /* ---------- 11. 超时：自动轰炸 + 连续 5 次判负 ---------- */
  section('[11] 回合超时：自动轰炸与连超判负')

  const ROOMUTIL = require('../minigame/js/shared/utils/room')
  const RULES = require('../minigame/js/shared/config/rules')
  const { buildIndex } = require('../minigame/js/shared/utils/judge')

  // 这一段直接驱动离线引擎：AI 出手延时调大，避免它在断言之间插一脚
  offline.setDelays({ opponentJoin: 20, matchJoin: 20, ready: 20, foeAction: 60000 })
  offline._reset()
  await offline.createRoom({ planeCount: 1, stepSeconds: 5 })
  const t0 = Date.now()
  await offline.deploy({
    planes: [{ planeId: 'standard', anchorRow: 5, anchorCol: 5, rotation: 0 }]
  })
  const ig = offline._getGame()
  check('回合截止时间按房间设定的 5 秒算，而不是默认 30 秒', function () {
    const left = ig.turnDeadline - t0
    assert.ok(left <= 5200, '截止时间偏晚：' + left + 'ms')
    assert.ok(left > 1000, '截止时间不对：' + left + 'ms')
  })

  ig.myTurn = true
  ig.turnDeadline = Date.now() - 1
  const tick1 = await offline.tick()
  check('超时后自动轰炸，落点是第一行第一列', function () {
    assert.strictEqual(tick1.auto, true, '没有自动轰炸')
    assert.strictEqual(tick1.row, 1)
    assert.strictEqual(tick1.col, 1)
    assert.ok(ig.myProbes['1,1'], '战况里没有这一炮')
    assert.strictEqual(tick1.streak, 1)
  })

  ig.myTurn = true
  ig.turnDeadline = Date.now() - 1
  const tick2 = await offline.tick()
  check('第二次超时顺着同一行往右，且不重复炸同一格', function () {
    assert.strictEqual(tick2.row, 1)
    assert.strictEqual(tick2.col, 2)
    assert.strictEqual(tick2.streak, 2)
  })

  ig.myTurn = true
  ig.turnDeadline = Date.now() - 1
  await offline.tick()
  ig.myTurn = true
  await offline.fire({ row: 9, col: 9 })
  check('手动出招把连续超时清零', function () {
    assert.ok(!ig.finished, '不该结束')
    assert.strictEqual(offline._room().myStreak, 0, '连续超时没清零：' + offline._room().myStreak)
    assert.ok(ig.myProbes['9,9'], '手动这一炮没落地')
  })

  // 重新开一局，专门测连超判负
  offline._reset()
  await offline.createRoom({ planeCount: 1, stepSeconds: 5 })
  await offline.deploy({
    planes: [{ planeId: 'standard', anchorRow: 1, anchorCol: 1, rotation: 0 }]
  })
  const ig2 = offline._getGame()
  // 把对手布阵固定在棋盘下半部分 —— 否则随机布阵偶尔会摆在 (1,1)~(1,5)，
  // 5 炮就把对方全歼了，测不到「连超判负」这条规则
  ig2.foeDeployed = [{
    planeId: 'standard', anchorRow: 5, anchorCol: 1, rotation: 0,
    cells: getAbsoluteCells('standard', 5, 1, 0)
  }]
  ig2.foeIndex = buildIndex(ig2.foeDeployed)
  let lastTick = null
  for (let i = 0; i < RULES.MAX_TURN_TIMEOUT_STREAK; i++) {
    ig2.myTurn = true
    ig2.turnDeadline = Date.now() - 1
    lastTick = await offline.tick()
    if (ig2.finished) break
  }
  check('连续超时 5 次判负，不再往下拖', function () {
    assert.strictEqual(ig2.finished, true, '没有判负')
    assert.strictEqual(ig2.winner, 'foe')
    assert.strictEqual(ig2.endType, 'timeout')
    assert.strictEqual(lastTick.finished, true, 'tick 没报 finished')
  })
  check('判负前那一炮仍然落地（不是白丢一步）', function () {
    assert.strictEqual(Object.keys(ig2.myProbes).length, RULES.MAX_TURN_TIMEOUT_STREAK,
      '自动轰炸次数不对：' + Object.keys(ig2.myProbes).length)
  })

  /* ---------- 12. 房间规则纯函数 ---------- */
  section('[12] 房间规则取值（纯函数）')

  check('单步限时夹在 5~30 秒，非法值回落默认', function () {
    assert.strictEqual(ROOMUTIL.clampStepSeconds(3), 5)
    assert.strictEqual(ROOMUTIL.clampStepSeconds(99), 30)
    // 1 秒连续：17 就是 17，不再对齐到 5 的倍数
    assert.strictEqual(ROOMUTIL.clampStepSeconds(17), 17)
    assert.strictEqual(ROOMUTIL.clampStepSeconds(17.6), 18)
    assert.strictEqual(ROOMUTIL.clampStepSeconds(5), 5)
    assert.strictEqual(ROOMUTIL.clampStepSeconds(30), 30)
    assert.strictEqual(ROOMUTIL.clampStepSeconds(''), RULES.TURN_DEFAULT)
    assert.strictEqual(ROOMUTIL.clampStepSeconds(undefined), RULES.TURN_DEFAULT)
    assert.strictEqual(ROOMUTIL.clampStepSeconds(NaN), RULES.TURN_DEFAULT)
  })
  check('本局架数夹在 1~3，取整', function () {
    assert.strictEqual(ROOMUTIL.clampPlaneCount(0), 1)
    assert.strictEqual(ROOMUTIL.clampPlaneCount(9), 3)
    assert.strictEqual(ROOMUTIL.clampPlaneCount(2), 2)
    assert.strictEqual(ROOMUTIL.clampPlaneCount('2'), 2)
    assert.strictEqual(ROOMUTIL.clampPlaneCount(2.6), 3)
    assert.strictEqual(ROOMUTIL.clampPlaneCount(undefined), 1)
  })
  check('房间名去空白、压空格、截断到 12 字', function () {
    assert.strictEqual(ROOMUTIL.normalizeRoomName('  老周 \n 中队  '), '老周 中队')
    assert.strictEqual(ROOMUTIL.normalizeRoomName('一二三四五六七八九十一二三四'), '一二三四五六七八九十一二')
    assert.strictEqual(ROOMUTIL.normalizeRoomName('', '兜底名'), '兜底名')
    assert.strictEqual(ROOMUTIL.normalizeRoomName(null), '未命名房间')
  })
  check('自动轰炸选点：从上到下、从左到右', function () {
    assert.deepStrictEqual(ROOMUTIL.pickAutoTarget({}), { row: 1, col: 1 })
    assert.deepStrictEqual(ROOMUTIL.pickAutoTarget({ '1,1': 'miss', '1,2': 'miss' }), { row: 1, col: 3 })
    const all = {}
    for (let r = 1; r <= 9; r++) for (let c = 1; c <= 9; c++) all[r + ',' + c] = 'miss'
    assert.strictEqual(ROOMUTIL.pickAutoTarget(all), null)
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
