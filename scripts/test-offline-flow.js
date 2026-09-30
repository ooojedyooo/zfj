// scripts/test-offline-flow.js
// 离线引擎「全流程」集成测试
//
// 与 test-core.js 的分工：
//   test-core.js    → 验纯函数（形状 / 旋转 / 判定 / 随机布阵）
//   本文件          → 验状态机（建房 → 入房 → 布阵 → 开局 → 轮流开火 → 结算）
//                     并把返回结构按「页面实际取数方式」逐字段断言，
//                     防止离线引擎与云端 rooms 文档结构出现偏差。
//
// 运行：node scripts/test-offline-flow.js
const assert = require('assert')
const offline = require('../miniprogram/services/offlineGame')
const { randomDeploy, getAbsoluteCells } = require('../miniprogram/utils/plane')
const { BOARD_SIZE, RESULT, END_TYPE } = require('../miniprogram/config/rules')
const { EMOTE_LIST, EMOTES } = require('../miniprogram/config/social')

const ME = 'me'
const FOE = 'foe'

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

function section(title) {
  console.log('\n' + title)
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/** 轮询等待条件成立（条件可为同步或异步返回值） */
async function waitFor(cond, label, timeout = 5000) {
  const start = Date.now()
  for (;;) {
    let ok = false
    try { ok = await cond() } catch (e) { ok = false }
    if (ok) return true
    if (Date.now() - start > timeout) {
      throw new Error('等待超时：' + label)
    }
    await sleep(15)
  }
}

/** 轮询等待「轮到我出手」 */
function waitMyTurn(timeout = 5000) {
  return waitFor(() => {
    const g = offline._getGame()
    return !!g && !g.finished && g.myTurn
  }, '轮到我出手', timeout)
}

/** 只取提交给服务端的字段（与 deploy 页保持一致） */
function toSubmit(planes) {
  return planes.map(p => ({
    planeId: p.planeId,
    anchorRow: p.anchorRow,
    anchorCol: p.anchorCol,
    rotation: p.rotation
  }))
}

/** 找出某架飞机的机头绝对坐标 */
function headOf(plane) {
  return getAbsoluteCells(plane.planeId, plane.anchorRow, plane.anchorCol, plane.rotation)
    .find(c => c.isHead)
}

/** 找出某架飞机的非机头格（机翼 / 机身 / 机尾） */
function bodyOf(plane) {
  return getAbsoluteCells(plane.planeId, plane.anchorRow, plane.anchorCol, plane.rotation)
    .find(c => !c.isHead)
}

/** 建房并等到对手就位 */
async function newRoom(planeCount) {
  offline._reset()
  await offline.createRoom({ planeCount })
  await waitFor(async () => {
    const v = await offline.getRoom()
    return v && v.status === 'deploy' && (v.players || []).length === 2
  }, '对手加入并切到 deploy')
  return offline.getRoom()
}

async function main() {
  // 把各阶段延时压到 40ms，测试才跑得快
  offline.setDelays({ opponentJoin: 40, matchJoin: 40, ready: 40, foeAction: 40 })

  /* ============ 1. 建房 / 匹配 ============ */
  section('[1] 建房 → 对手加入（ROOM 模块）')

  const statuses = []
  offline._reset()
  const created = await offline.createRoom({ planeCount: 1 })
  const watcher = offline.watchRoom(created.roomId, v => {
    if (v) statuses.push(v.status)
  })

  check('房间号为 6 位数字', () => assert.ok(/^\d{6}$/.test(created.roomNo), '实际：' + created.roomNo))
  check('返回 roomId', () => assert.ok(!!created.roomId))
  check('飞机数量被写入房间', () => assert.strictEqual(created.planeCount, 1))
  check('刚创建时未匹配', () => assert.strictEqual(created.matched, false))

  await waitFor(async () => {
    const v = await offline.getRoom()
    return v && v.status === 'deploy'
  }, '对手加入并切到 deploy')

  const waitingView = await offline.getRoom()
  check('等待态人数补齐到 2 人', () => assert.strictEqual(waitingView.players.length, 2))
  check('玩家列表含 me', () => assert.ok(waitingView.players.some(p => p.openid === ME)))
  check('watch 收到 waiting → deploy 变化', () => {
    assert.ok(statuses.indexOf('waiting') >= 0, '缺少 waiting：' + statuses.join('>'))
    assert.ok(statuses.indexOf('deploy') >= 0, '缺少 deploy：' + statuses.join('>'))
  })
  watcher.close()

  check('setDelays 可调（用于测试加速）', () => assert.strictEqual(typeof offline.setDelays, 'function'))

  /* ============ 2. 布阵 / 开局 ============ */
  section('[2] 布阵 → 开局（DEP 模块）')

  await newRoom(1)

  // 非法布阵应被拒绝（与云端同源校验）
  let badErr = null
  try {
    await offline.deploy({ planes: [] })
  } catch (e) { badErr = e }
  check('空布阵被拒绝（至少 1 架）', () => assert.ok(badErr && /至少/.test(badErr.message)))

  const myPlanes = randomDeploy(1, 'standard', BOARD_SIZE)
  const dep = await offline.deploy({ planes: toSubmit(myPlanes) })
  check('双方就绪 allReady = true', () => assert.strictEqual(dep.allReady, true))
  check('先手为 me 或 foe（T-01 随机）', () => assert.ok(dep.firstHand === ME || dep.firstHand === FOE))

  const s = await offline.sync()
  check('sync 返回 myOpenid', () => assert.strictEqual(s.myOpenid, ME))
  check('sync 状态为 battle', () => assert.strictEqual(s.status, 'battle'))
  check('battle.turn 指向某一方', () => assert.ok(s.battle.turn === ME || s.battle.turn === FOE))
  check('battle.turnDeadline 已下发', () => assert.ok(s.battle.turnDeadline > Date.now()))
  check('myDeploy 回传自己的布阵（渲染我方海域用）', () => assert.strictEqual(s.myDeploy.length, 1))
  check('battle 未泄露对手飞机信息', () => {
    const raw = JSON.stringify(s.battle)
    assert.ok(raw.indexOf('anchorRow') < 0, 'battle 中出现 anchorRow')
    assert.ok(raw.indexOf('"cells"') < 0, 'battle 中出现 cells')
  })

  /* ============ 3. 快捷表情（SOC 模块） ============ */
  section('[3] 局内快捷表情')

  check('表情白名单非空', () => assert.ok(EMOTES.length >= 4))
  check('EMOTE_LIST 与 EMOTES 同源', () => assert.strictEqual(EMOTE_LIST.length, EMOTES.length))

  const e1 = await offline.emote({ emoji: EMOTE_LIST[0] })
  const sEmote = await offline.sync()
  check('表情写入 battle.emote', () => assert.strictEqual(sEmote.battle.emote.emoji, EMOTE_LIST[0]))
  check('表情标记发送方为自己', () => assert.strictEqual(sEmote.battle.emote.by, ME))
  check('表情返回递增 seq', () => assert.ok(e1.seq > 0))

  let emoteErr = null
  try { await offline.emote({ emoji: '\uD83D\uDCA9' }) } catch (e) { emoteErr = e }
  check('白名单外的表情被拒绝', () => assert.ok(emoteErr && /不支持/.test(emoteErr.message)))

  /* ============ 4. 对战：直取机头 → 全灭获胜 ============ */
  section('[4] 对战：击中机头即击毁（BAT 模块）')

  await newRoom(1)
  await offline.deploy({ planes: toSubmit(randomDeploy(1, 'standard', BOARD_SIZE)) })

  const g1 = offline._getGame()
  const head1 = headOf(g1.foeDeployed[0])

  await waitMyTurn()
  const r1 = await offline.fire({ row: head1.row, col: head1.col })
  check('打中机头 → 判定为 kill', () => assert.strictEqual(r1.result, RESULT.KILL))
  check('全部飞机被击毁 → win = true', () => assert.strictEqual(r1.win, true))

  await waitFor(async () => {
    const v = await offline.getRoom()
    return v.battle && v.battle.finished
  }, '对局结束')

  const fin = await offline.sync()
  check('房间状态切到 finished', () => assert.strictEqual(fin.status, 'finished'))
  check('winner = me', () => assert.strictEqual(fin.battle.winner, ME))
  check('endType = all_destroyed', () => assert.strictEqual(fin.battle.endType, END_TYPE.ALL_DESTROYED))
  check('endType 属于 END_TYPE 枚举', () => {
    assert.ok(Object.values(END_TYPE).indexOf(fin.battle.endType) >= 0)
  })

  /* ============ 5. 重复报点 / tick / 投降 ============ */
  section('[5] 重复报点拦截 / 回合超时 / 投降')

  await newRoom(3)
  await offline.deploy({ planes: toSubmit(randomDeploy(3, 'standard', BOARD_SIZE)) })

  const g2 = offline._getGame()
  const body = bodyOf(g2.foeDeployed[0])

  await waitMyTurn()
  const r2 = await offline.fire({ row: body.row, col: body.col })
  check('打中非机头部位 → hit（不击毁）', () => assert.strictEqual(r2.result, RESULT.HIT))
  check('严格交替：出手后换手', () => assert.strictEqual(g2.myTurn, false))

  await waitMyTurn()
  let repeatErr = null
  try {
    await offline.fire({ row: body.row, col: body.col })
  } catch (e) { repeatErr = e }
  check('重复轰炸同一坐标被拒绝（BAT-09 兜底）', () => {
    assert.ok(repeatErr && /轰炸过/.test(repeatErr.message), '实际错误：' + (repeatErr && repeatErr.message))
  })

  const t = await offline.tick()
  check('离线模式 tick 不跳过回合', () => assert.strictEqual(t.skipped, false))

  await offline.surrender()
  const surView = await offline.sync()
  check('投降后对局结束', () => assert.strictEqual(surView.battle.finished, true))
  check('投降 endType = surrender', () => assert.strictEqual(surView.battle.endType, END_TYPE.SURRENDER))
  check('投降方判负（winner = foe）', () => assert.strictEqual(surView.battle.winner, FOE))

  let surErr = null
  try { await offline.surrender() } catch (e) { surErr = e }
  check('重复投降被拒绝', () => assert.ok(surErr && /已结束/.test(surErr.message)))

  /* ============ 6. 页面取数字段映射（防结构漂移） ============ */
  section('[6] 页面字段映射（模拟 battle.js 取数）')

  await newRoom(2)
  await offline.deploy({ planes: toSubmit(randomDeploy(2, 'standard', BOARD_SIZE)) })
  await waitMyTurn()
  const gg = offline._getGame()
  const head2 = headOf(gg.foeDeployed[1] || gg.foeDeployed[0])
  await offline.fire({ row: head2.row, col: head2.col })

  const view = await offline.sync()
  const myOpenid = view.myOpenid

  check('battle.marks[myOpenid] 可取到轰炸记录', () => {
    const m = view.battle.marks[myOpenid]
    assert.ok(m && typeof m === 'object', 'marks 缺失')
    assert.ok(Object.keys(m).length >= 1, 'marks 为空')
  })
  check('battle.incoming[myOpenid] 可取到被炸记录', () => {
    const inc = view.battle.incoming[myOpenid]
    assert.ok(inc && typeof inc === 'object', 'incoming 缺失')
  })
  check('battle.stats[myOpenid] 三字段齐备', () => {
    const st = view.battle.stats[myOpenid]
    assert.ok(st && 'kill' in st && 'lost' in st && 'shots' in st, JSON.stringify(st))
  })
  check('marks 取值仅限 miss/hit/kill（T-08 不泄露形状）', () => {
    const allowed = [RESULT.MISS, RESULT.HIT, RESULT.KILL]
    Object.keys(view.battle.marks[myOpenid]).forEach(k => {
      assert.ok(allowed.indexOf(view.battle.marks[myOpenid][k]) >= 0)
    })
  })
  check('myDeploy 含锚点与朝向，可重算我方格位', () => {
    const p = view.myDeploy[0]
    assert.ok(p.anchorRow >= 1 && p.anchorCol >= 1)
    assert.ok(p.rotation >= 0 && p.rotation <= 3)
  })
  check('players 可用于解析对手标识', () => {
    const foe = view.players.find(x => x.openid !== myOpenid)
    assert.ok(foe && foe.openid === FOE)
  })
  check('sync 返回 myDestroyed 计数', () => assert.strictEqual(typeof view.myDestroyed, 'number'))

  /* ============ 7. 离开房间 ============ */
  section('[7] 离开房间')

  await offline.leaveRoom()
  let leaveErr = null
  try { await offline.getRoom() } catch (e) { leaveErr = e }
  check('离开后房间不可再读', () => assert.ok(leaveErr && /不存在/.test(leaveErr.message)))

  // 收尾：清掉可能残留的定时器
  offline._reset()

  console.log('\n----------------------------------------')
  console.log('通过 ' + pass + ' 项，失败 ' + failed + ' 项')
  console.log('----------------------------------------\n')

  process.exit(failed === 0 ? 0 : 1)
}

main().catch(err => {
  console.error('\n[离线全流程测试] 异常中断：', err)
  process.exit(1)
})
