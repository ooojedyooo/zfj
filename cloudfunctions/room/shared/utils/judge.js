// utils/judge.js
// 命中判定 —— 对应 PRD 3.5 / 3.6
//
// 关键规则（T-08）：击中机头即整机击毁，但【不揭示】该飞机的其余格位与朝向。
// 因此本模块只返回当场命中格的判定结果，绝不下发飞机完整形状。

const { RESULT, BOARD_SIZE } = require('../config/rules')
const { key } = require('./board')

/**
 * 根据布阵结果构建索引表
 * @param {Array} deployed 布阵数组 [{ planeId, anchorRow, anchorCol, rotation, cells }]
 * @returns {{index: Object, planeCells: Object}}
 */
function buildIndex(deployed) {
  const index = {}       // 格位 key -> { planeId, planeNo, isHead }
  const planeCells = {}  // planeNo -> 该飞机全部格位（仅服务端持有，不对外暴露）

  deployed.forEach((plane, planeNo) => {
    planeCells[planeNo] = plane.cells
    plane.cells.forEach(cell => {
      index[key(cell.row, cell.col)] = {
        planeId: plane.planeId,
        planeNo,
        isHead: cell.isHead
      }
    })
  })

  return { index, planeCells }
}

/**
 * 判定一次轰炸
 * @param {Object} index      由 buildIndex 生成的索引表
 * @param {number} row
 * @param {number} col
 * @returns {{ result: string, planeNo: number|null }}
 */
function judge(index, row, col) {
  const hit = index[key(row, col)]
  if (!hit) {
    return { result: RESULT.MISS, planeNo: null }
  }
  return {
    result: hit.isHead ? RESULT.KILL : RESULT.HIT,
    planeNo: hit.planeNo
  }
}

/**
 * 判断某方是否已全部被击毁
 * @param {Object} planeCells  planeNo -> cells
 * @param {Array}  killedPlanes 已击毁的 planeNo 列表
 * @param {number} totalPlanes  该方飞机总数
 */
function isAllDestroyed(killedPlanes, totalPlanes) {
  return totalPlanes > 0 && killedPlanes.length >= totalPlanes
}

module.exports = {
  RESULT,
  BOARD_SIZE,
  buildIndex,
  judge,
  isAllDestroyed
}
