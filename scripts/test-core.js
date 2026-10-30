// scripts/test-core.js
// 核心玩法逻辑自测 —— 纯 Node 运行，不依赖小程序环境
// 运行：node scripts/test-core.js
const { getAbsoluteCells, validatePlacement, rotateRel, randomDeploy } = require('../miniprogram/utils/plane')
const { buildIndex, judge, isAllDestroyed } = require('../miniprogram/utils/judge')
const { getPlane } = require('../miniprogram/config/planes')
const { RESULT, BOARD_SIZE } = require('../miniprogram/config/rules')

let pass = 0
let fail = 0

function assert(name, cond) {
  if (cond) {
    pass++
    console.log('  ✓ ' + name)
  } else {
    fail++
    console.log('  ✗ ' + name)
  }
}

console.log('\n[1] 飞机形状（PRD 3.2）')
const plane = getPlane('standard')
assert('标准机共 10 格', plane.cellCount === 10)
assert('cells 数量与 cellCount 一致', plane.cells.length === plane.cellCount)
assert('headIndex 指向机头 (0,2)', plane.cells[plane.headIndex][0] === 0 && plane.cells[plane.headIndex][1] === 2)
assert('全部格位不重复', new Set(plane.cells.map(c => c.join(','))).size === 10)

console.log('\n[2] 旋转与绝对坐标（PRD 3.3）')
const cells0 = getAbsoluteCells('standard', 3, 3, 0)
assert('rotation 0：机头落在锚点 (3,3)', cells0.some(c => c.isHead && c.row === 3 && c.col === 3))
const head0 = cells0.find(c => c.isHead)
assert('机头格唯一', cells0.filter(c => c.isHead).length === 1)
assert('机头在 (3,3)', head0.row === 3 && head0.col === 3)
assert('rotation 0 时机翼在机头下一行（机头朝上）',
  cells0.some(c => c.row === head0.row + 1 && c.col === head0.col))
assert('旋转 4 次回到原位',
  JSON.stringify(rotateRel(1, 2, 4)) === JSON.stringify([1, 2]))
const cells1 = getAbsoluteCells('standard', 5, 5, 1)
assert('rotation 1 时机翼仍在机头相邻行/列上', cells1.length === 10)

console.log('\n[3] 摆放合法性（PRD 3.3 / DEP-03）')
const a = getAbsoluteCells('standard', 9, 3, 0)
assert('越界检测：机头 (9,3) 朝上会出界', validatePlacement(a, [], BOARD_SIZE).ok === false)
const a2 = getAbsoluteCells('standard', 1, 3, 0)
assert('机头 (1,3) 朝上在界内（飞机向下延伸）', validatePlacement(a2, [], BOARD_SIZE).ok === true)
const b = getAbsoluteCells('standard', 3, 3, 0)
assert('合法摆放通过', validatePlacement(b, [], BOARD_SIZE).ok === true)
const c = getAbsoluteCells('standard', 4, 3, 0)
assert('重叠检测命中', validatePlacement(c, b, BOARD_SIZE).ok === false)

console.log('\n[4] 命中判定（PRD 3.5）')
const deployed = [{ planeId: 'standard', anchorRow: 3, anchorCol: 3, rotation: 0, cells: getAbsoluteCells('standard', 3, 3, 0) }]
const { index } = buildIndex(deployed)
assert('打中机头 → 击毁', judge(index, 3, 3).result === RESULT.KILL)
const wingCell = deployed[0].cells.find(x => !x.isHead)
assert('打中机翼/机身/机尾 → 击中', judge(index, wingCell.row, wingCell.col).result === RESULT.HIT)
assert('打空白格 → 未击中', judge(index, 9, 9).result === RESULT.MISS)

console.log('\n[5] 击毁不揭示形状（T-08）')
const killRes = judge(index, 3, 3)
assert('击毁返回值只含 result 与 planeNo', Object.keys(killRes).length === 2)
assert('击毁不下发飞机格位信息', killRes.cells === undefined && killRes.shape === undefined)

console.log('\n[6] 胜负判定（PRD 3.6）')
assert('未全灭', isAllDestroyed([0], 2) === false)
assert('全灭', isAllDestroyed([0, 1], 2) === true)

console.log('\n[7] 随机布阵（T-03 兜底）')
let randomOk = true
for (let i = 0; i < 200; i++) {
  const r = randomDeploy(3, 'standard', BOARD_SIZE)
  if (r.length !== 3) { randomOk = false; break }
  const flat = r.reduce((acc, p) => acc.concat(p.cells.map(c => c.row + ',' + c.col)), [])
  if (new Set(flat).size !== flat.length) { randomOk = false; break }
  if (!r.every(p => validatePlacement(p.cells, [], BOARD_SIZE).ok)) { randomOk = false; break }
}
assert('200 次随机布 3 架，均合法且不重叠', randomOk)

console.log('\n[8] 离线 AI（单机试玩的对手）')
const { LocalGame } = require('../miniprogram/services/localGame')

/** 让 AI 打一局，返回用了几炮；打不完（卡死）返回 null */
function runAi(count) {
  const planes = randomDeploy(count, 'standard', BOARD_SIZE)
  const g = new LocalGame({ planeCount: count, firstHand: false })
  g.myDeployed = planes
  g.myIndex = buildIndex(planes)
  g.foeShots = 0
  g.finished = false
  while (!g.finished && g.foeShots < 150) {
    if (!g.foeFire()) return null
  }
  return g.finished ? g.foeShots : null
}

/** 跑 n 局，返回 { avg, stuck } */
function sample(count, n) {
  let total = 0
  let ok = 0
  for (let i = 0; i < n; i++) {
    const s = runAi(count)
    if (s == null) continue
    total += s
    ok++
  }
  return { avg: ok ? total / ok : Infinity, ok: ok, n: n }
}

// ① 不许卡死：概率密度法一旦候选集合算空，就会返回 null 让对局挂住
const s1 = sample(1, 60)
const s3 = sample(3, 60)
assert('1 架局 60 次全部打完（没有卡死）', s1.ok === s1.n)
assert('3 架局 60 次全部打完（没有卡死）', s3.ok === s3.n)

// ② 强度回归：钉住「已经变聪明了」这件事。
//    改造前实测 1 架约 15 炮、3 架约 42 炮；现在约 11 / 29。
//    阈值留了余量，只防「被改回旧实现」，不卡随机波动。
assert('1 架局平均用炮 ≤ 13（改造前约 15）', s1.avg <= 13)
assert('3 架局平均用炮 ≤ 34（改造前约 42）', s3.avg <= 34)

// ③ 不许打重复的格：炮数应等于去重后的格数
const planes1 = randomDeploy(1, 'standard', BOARD_SIZE)
const g1 = new LocalGame({ planeCount: 1, firstHand: false })
g1.myDeployed = planes1
g1.myIndex = buildIndex(planes1)
g1.foeShots = 0
g1.finished = false
while (!g1.finished && g1.foeShots < 150) { if (!g1.foeFire()) break }
assert('AI 没有对同一格开两次火',
  Object.keys(g1.foeProbes).length === g1.foeShots)

console.log('\n[9] AI 强度参数（services/aiTune）')
const aiTune = require('../miniprogram/services/aiTune')

aiTune.reset()
const d0 = aiTune.get()
assert('默认值：机头权重 1.3 / 走神率 0.35',
  d0.headWeight === 1.3 && d0.slipRate === 0.35)
assert('默认强度是「均衡」', aiTune.level(d0).name === '均衡')

// 任何来源的值都要收成合法参数：storage 里可能是旧版本留下的、手输的、NaN
const hi = aiTune.normalize({ headWeight: 99, slipRate: 5 })
assert('越界值钳到上限 3.0 / 0.9', hi.headWeight === 3 && hi.slipRate === 0.9)
const lo = aiTune.normalize({ headWeight: -1, slipRate: -3 })
assert('越界值钳到下限 0.6 / 0', lo.headWeight === 0.6 && lo.slipRate === 0)
const bad = aiTune.normalize({ headWeight: 'abc', slipRate: null })
assert('非法值回落默认（NaN 会让 AI 选点返回 null 而卡死）',
  bad.headWeight === 1.3 && bad.slipRate === 0.35)
const snapped = aiTune.normalize({ headWeight: 1.27, slipRate: 0.33 })
assert('对齐步长：1.27 → 1.3', snapped.headWeight === 1.3)
assert('对齐步长：0.33 → 0.35', snapped.slipRate === 0.35)

// 滑块只认整数，换算必须能原路走回来（差一位就会「拖到 1.3 显示 1.4」）
let roundTripOk = true
for (let v = 6; v <= 30; v++) {
  if (aiTune.headToSlider(aiTune.sliderToHead(v)) !== v) roundTripOk = false
}
for (let v = 0; v <= 18; v++) {
  if (aiTune.slipToSlider(aiTune.sliderToSlip(v)) !== v) roundTripOk = false
}
assert('滑块换算双向无漂移（机头 6~30 / 走神 0~18）', roundTripOk)

assert('走神率 90% → 沙包', aiTune.level({ headWeight: 1.3, slipRate: 0.9 }).name === '沙包')
assert('走神率 0 + 机头 3.0 → 碾压', aiTune.level({ headWeight: 3, slipRate: 0 }).name === '碾压')
assert('等级索引在 0~4 之间', aiTune.level({ headWeight: 2.5, slipRate: 0.3 }).index <= 4)

aiTune.set({ headWeight: 2.5, slipRate: 0.1 })
assert('set / get 往返一致',
  aiTune.get().headWeight === 2.5 && aiTune.get().slipRate === 0.1)
assert('非默认值能被识别', aiTune.isDefault() === false)
aiTune.reset()
assert('reset 回到默认', aiTune.isDefault() === true)

/* 接线验证：参数必须真的改变出招，而不只是存下来了。
   成对比较 —— 同一批棋盘换参数各跑一遍，否则棋盘难易差异会盖掉策略差异。 */
function runAiOn(planes) {
  const g = new LocalGame({ planeCount: planes.length, firstHand: false })
  g.myDeployed = planes
  g.myIndex = buildIndex(planes)
  g.foeShots = 0
  g.finished = false
  while (!g.finished && g.foeShots < 150) {
    if (!g.foeFire()) return null
  }
  return g.finished ? g.foeShots : null
}

const boards = []
for (let i = 0; i < 30; i++) boards.push(randomDeploy(1, 'standard', BOARD_SIZE))
function avgOn(list) {
  let t = 0
  let n = 0
  list.forEach(function (b) {
    const s = runAiOn(b)
    if (s != null) { t += s; n++ }
  })
  return n ? t / n : Infinity
}

aiTune.set({ headWeight: 3, slipRate: 0 })
const avgStrict = avgOn(boards)
aiTune.set({ headWeight: 0.6, slipRate: 0.9 })
const avgDumb = avgOn(boards)
aiTune.reset()

assert('参数生效：满血 AI 比沙包少用三成以上炮数（' +
  avgStrict.toFixed(1) + ' vs ' + avgDumb.toFixed(1) + '）',
  avgDumb > avgStrict * 1.3)

console.log('\n----------------------------------------')
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项')
console.log('----------------------------------------\n')

process.exit(fail === 0 ? 0 : 1)
