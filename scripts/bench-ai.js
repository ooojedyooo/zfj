// scripts/bench-ai.js
// 离线 AI 强度基准 —— 用数据说话，而不是「感觉变强了」
//
// 做法：随机摆一局，让某个策略自己去打，记录「打到全部击毁用了几炮」。
// 重复 N 局取平均。旧策略与新策略在同一批棋盘上各打一遍（成对比较，
// 排除棋盘难易不同的干扰）。
//
// 运行：node scripts/bench-ai.js          默认每档 300 局
//       node scripts/bench-ai.js 1000     指定局数
//       node scripts/bench-ai.js 500 --head=3 --slip=0    指定强度参数
//
// 参数与大厅里那个「AI 强度」调节页是同一套（services/aiTune），
// 所以在这里调出来的数，就是玩家在手机上能拖出来的数。

const { LocalGame } = require('../miniprogram/services/localGame')
const { randomDeploy } = require('../miniprogram/utils/plane')
const { buildIndex, judge } = require('../miniprogram/utils/judge')
const { RESULT, BOARD_SIZE } = require('../miniprogram/config/rules')
const { key } = require('../miniprogram/utils/board')
const aiTune = require('../miniprogram/services/aiTune')

/** 取 --name=value，没有则返回 null */
function argOf(name) {
  const hit = process.argv.slice(2).filter(function (a) {
    return a.indexOf('--' + name + '=') === 0
  })[0]
  return hit ? Number(hit.split('=')[1]) : null
}

const ROUNDS = parseInt(process.argv.slice(2).filter(function (a) {
  return a.indexOf('--') !== 0
})[0], 10) || 300
const MAX_SHOTS = 200   // 超过这个数算“卡住了”，不参与统计

const _argHead = argOf('head')
const _argSlip = argOf('slip')
if (_argHead != null || _argSlip != null) {
  const cur = aiTune.get()
  aiTune.set({
    headWeight: _argHead == null ? cur.headWeight : _argHead,
    slipRate: _argSlip == null ? cur.slipRate : _argSlip
  })
}
const TUNE = aiTune.get()
const TUNE_DESC = '机头 ' + TUNE.headWeight.toFixed(1) +
  ' / 走神 ' + Math.round(TUNE.slipRate * 100) + '%' +
  '（' + aiTune.level(TUNE).name + ' · 约 ' + aiTune.level(TUNE).shots + ' 炮打完 1 架）'

/* ---------------- 旧策略（改造前的实现，原样保留作对照） ---------------- */

function oldPick(probes) {
  const hits = Object.keys(probes)
    .filter(k => probes[k] === RESULT.HIT)
    .map(k => k.split(',').map(Number))

  for (const [r, c] of hits) {
    const neighbors = [[r - 1, c], [r + 1, c], [r, c - 1], [r, c + 1]]
    for (const [nr, nc] of neighbors) {
      if (nr < 1 || nr > BOARD_SIZE || nc < 1 || nc > BOARD_SIZE) continue
      if (probes[key(nr, nc)]) continue
      return { row: nr, col: nc }
    }
  }

  const candidates = []
  for (let r = 1; r <= BOARD_SIZE; r++) {
    for (let c = 1; c <= BOARD_SIZE; c++) {
      if (!probes[key(r, c)]) candidates.push({ row: r, col: c })
    }
  }
  if (!candidates.length) return null
  return candidates[Math.floor(Math.random() * candidates.length)]
}

/* ---------------- 两个策略各打一局，返回用了多少炮 ---------------- */

/** 旧策略：纯函数模拟，不经过 LocalGame */
function runOld(planes) {
  const { index } = buildIndex(planes)
  const probes = {}
  const killed = []
  let shots = 0

  while (killed.length < planes.length && shots < MAX_SHOTS) {
    const t = oldPick(probes)
    if (!t) break
    const res = judge(index, t.row, t.col)
    probes[key(t.row, t.col)] = res.result
    shots++
    if (res.result === RESULT.KILL && killed.indexOf(res.planeNo) < 0) killed.push(res.planeNo)
  }
  return killed.length >= planes.length ? shots : null
}

/** 新策略：直接用 LocalGame，测的就是真正上线的那份代码 */
function runNew(planes) {
  const g = new LocalGame({ planeCount: planes.length, firstHand: false })
  g.myDeployed = planes
  g.myIndex = buildIndex(planes)   // foeFire 里读的是 myIndex.index
  g.myKilled = []
  g.foeProbes = {}
  g.foeShots = 0
  g.finished = false
  g.winner = null

  while (!g.finished && g.foeShots < MAX_SHOTS) {
    if (!g.foeFire()) return null
  }
  return g.finished ? g.foeShots : null
}

/* ---------------- 统计 ---------------- */

function mean(a) {
  return a.reduce(function (s, v) { return s + v }, 0) / a.length
}

function median(a) {
  const b = a.slice().sort(function (x, y) { return x - y })
  const m = Math.floor(b.length / 2)
  return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2
}

function pct(a, p) {
  const b = a.slice().sort(function (x, y) { return x - y })
  return b[Math.min(b.length - 1, Math.floor(b.length * p))]
}

/* ---------------- 主流程 ---------------- */

console.log('离线 AI 基准 · 每档 ' + ROUNDS + ' 局')
console.log('强度参数：' + TUNE_DESC + '\n')

const rows = []

;[1, 2, 3].forEach(function (count) {
  const oldShots = []
  const newShots = []
  let stuckOld = 0
  let stuckNew = 0

  for (let i = 0; i < ROUNDS; i++) {
    // 同一块棋盘，两个策略各打一遍
    const planes = randomDeploy(count, 'standard', BOARD_SIZE)

    const o = runOld(planes)
    if (o == null) stuckOld++; else oldShots.push(o)

    const n = runNew(planes)
    if (n == null) stuckNew++; else newShots.push(n)
  }

  rows.push({
    count: count,
    oldMean: mean(oldShots),
    newMean: mean(newShots),
    oldMed: median(oldShots),
    newMed: median(newShots),
    oldP90: pct(oldShots, 0.9),
    newP90: pct(newShots, 0.9),
    stuckOld: stuckOld,
    stuckNew: stuckNew,
    n: oldShots.length
  })
})

const pad = function (s, n) { return String(s).padStart ? String(s).padStart(n) : s }
const padEnd = function (s, n) { s = String(s); return s + ' '.repeat(Math.max(0, n - s.length)) }

console.log(padEnd('架数', 6) + pad('旧·均值', 10) + pad('新·均值', 10) +
  pad('变化', 10) + pad('旧·中位', 10) + pad('新·中位', 10) + pad('旧·P90', 9) + pad('新·P90', 9))

rows.forEach(function (r) {
  const delta = r.newMean - r.oldMean
  const rate = (delta / r.oldMean * 100).toFixed(1) + '%'
  console.log(
    padEnd(r.count + ' 架', 6) +
    pad(r.oldMean.toFixed(2), 10) +
    pad(r.newMean.toFixed(2), 10) +
    pad((delta > 0 ? '+' : '') + rate, 10) +
    pad(r.oldMed, 10) + pad(r.newMed, 10) +
    pad(r.oldP90, 9) + pad(r.newP90, 9)
  )
})

const totalOld = mean(rows.map(function (r) { return r.oldMean }))
const totalNew = mean(rows.map(function (r) { return r.newMean }))
console.log('\n平均用炮：旧 ' + totalOld.toFixed(2) + ' → 新 ' + totalNew.toFixed(2) +
  '（' + ((totalNew - totalOld) / totalOld * 100).toFixed(1) + '%）')

const stuck = rows.some(function (r) { return r.stuckNew > 0 })
if (stuck) {
  console.log('⚠ 新策略出现打不完的局，检查 _foePickTarget 的候选集合')
  process.exit(1)
}
console.log('✓ 全部 ' + ROUNDS * 3 + ' 局都打完了，没有卡死')
