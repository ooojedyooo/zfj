// utils/board.js
// 棋盘与坐标工具 —— 对应 PRD 3.1
//
// 坐标体系约定（务必统一）：
//   - 棋盘 9×9，左上角为原点
//   - 内部统一用 [row, col]，row 从上往下 1→9（竖），col 从左往右 1→9（横）
//   - 对外展示为「横 X，竖 Y」，其中 X = col，Y = row

const { BOARD_SIZE } = require('../config/rules')

/** 生成棋盘格子的唯一键 */
function key(row, col) {
  return row + ',' + col
}

/** 坐标是否在棋盘内 */
function inBoard(row, col, size = BOARD_SIZE) {
  return row >= 1 && row <= size && col >= 1 && col <= size
}

/** 格式化为「横X竖Y」文案，如 formatCoord(8, 7) -> '横7，竖8' */
function formatCoord(row, col) {
  return '横' + col + '，竖' + row
}

/** 创建空的 9×9 二维状态数组，默认填充 initial */
function createMatrix(size = BOARD_SIZE, initial = '') {
  const matrix = []
  for (let r = 0; r < size; r++) {
    matrix.push(new Array(size).fill(initial))
  }
  return matrix
}

module.exports = {
  key,
  inBoard,
  formatCoord,
  createMatrix,
  BOARD_SIZE
}
