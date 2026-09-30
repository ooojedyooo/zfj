// utils/plane.js
// 飞机形状计算 —— 对应 PRD 3.2 / 3.3
// 纯函数实现，不依赖任何小程序 API，便于单元测试与复用

const { getPlane } = require('../config/planes')
const { BOARD_SIZE } = require('../config/rules')

/**
 * 以机头为原点，顺时针旋转 times × 90°
 * 屏幕坐标系（row 向下、col 向右）：顺时针映射为 (row, col) -> (col, -row)
 */
function rotateRel(row, col, times) {
  let r = row
  let c = col
  const n = ((times % 4) + 4) % 4
  for (let i = 0; i < n; i++) {
    const t = r
    r = c
    c = -t
  }
  return [r, c]
}

/**
 * 计算某架飞机在棋盘上的绝对格位
 * @param {string} planeId  机型 id
 * @param {number} anchorRow 机头所在行（1~9）
 * @param {number} anchorCol 机头所在列（1~9）
 * @param {number} rotation 旋转次数（0~3）
 * @returns {Array<{row, col, isHead, index}>}
 */
function getAbsoluteCells(planeId, anchorRow, anchorCol, rotation = 0) {
  const plane = getPlane(planeId)
  const [headR, headC] = plane.cells[plane.headIndex]

  return plane.cells.map(([r, c], index) => {
    const [dr, dc] = rotateRel(r - headR, c - headC, rotation)
    return {
      row: anchorRow + dr,
      col: anchorCol + dc,
      isHead: index === plane.headIndex,
      index
    }
  })
}

/** 所有格位是否都在棋盘内 */
function isInside(cells, size = BOARD_SIZE) {
  return cells.every(c => c.row >= 1 && c.row <= size && c.col >= 1 && c.col <= size)
}

/** 两架飞机的格位是否重叠 */
function isOverlap(cellsA, cellsB) {
  const set = new Set(cellsA.map(c => c.row + ',' + c.col))
  return cellsB.some(c => set.has(c.row + ',' + c.col))
}

/**
 * 校验一次摆放是否合法
 * @param {Array} cells        待放置飞机的绝对格位
 * @param {Array} placedCells  棋盘上已放置飞机的全部格位
 * @param {number} size        棋盘尺寸
 * @returns {{ok: boolean, reason?: string}}
 */
function validatePlacement(cells, placedCells = [], size = BOARD_SIZE) {
  if (!isInside(cells, size)) {
    return { ok: false, reason: 'out_of_board' } // 对应 PRD DEP-03
  }
  if (isOverlap(cells, placedCells)) {
    return { ok: false, reason: 'overlap' }       // 对应 PRD DEP-03
  }
  return { ok: true }
}

/**
 * 随机生成一组合法布阵
 * 用于「一键随机布阵」以及布阵超时兜底（对应 PRD T-03）
 * @param {number} count      飞机数量
 * @param {string} planeId    机型
 * @param {number} size       棋盘尺寸
 * @param {number} maxRetry   单架最大重试次数
 */
function randomDeploy(count, planeId = 'standard', size = BOARD_SIZE, maxAttempt = 60) {
  let best = []

  // 采用「整组重试」策略：贪心逐架放置可能把棋盘切碎，导致后续飞机无处可放，
  // 因此整组失败就重新来一轮；同时记录历史最优结果作为兜底（保证尽量多飞机被放下）。
  for (let attempt = 0; attempt < maxAttempt; attempt++) {
    const result = []
    let occupied = []
    let failed = false

    for (let i = 0; i < count; i++) {
      // 枚举当前所有合法摆放位置，再从中随机挑选
      const candidates = []
      for (let r = 1; r <= size; r++) {
        for (let c = 1; c <= size; c++) {
          for (let rot = 0; rot < 4; rot++) {
            const cells = getAbsoluteCells(planeId, r, c, rot)
            if (validatePlacement(cells, occupied, size).ok) {
              candidates.push({ planeId, anchorRow: r, anchorCol: c, rotation: rot, cells })
            }
          }
        }
      }
      if (!candidates.length) {
        failed = true
        break
      }
      const picked = candidates[Math.floor(Math.random() * candidates.length)]
      result.push(picked)
      occupied = occupied.concat(picked.cells)
    }

    if (result.length > best.length) best = result
    if (!failed) return result // 全部放下，成功
  }

  return best // 兜底：返回历史最优结果
}

module.exports = {
  rotateRel,
  getAbsoluteCells,
  isInside,
  isOverlap,
  validatePlacement,
  randomDeploy
}
