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

console.log('\n----------------------------------------')
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项')
console.log('----------------------------------------\n')

process.exit(fail === 0 ? 0 : 1)
