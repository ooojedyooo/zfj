// minigame/js/core/geom.js
// 几何与命中检测（纯函数，可脱离小游戏环境单测）

/** 点是否在矩形内 */
function inRect(x, y, r) {
  return !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h
}

/**
 * 在 zone 列表中命中一个（后注册的在上层，故从后往前找）
 * @param {number} x
 * @param {number} y
 * @param {Array<{x:number,y:number,w:number,h:number,onTap?:Function}>} zones
 */
function hitZone(x, y, zones) {
  if (!zones || !zones.length) return null
  for (let i = zones.length - 1; i >= 0; i--) {
    const z = zones[i]
    if (z.disabled) continue
    if (z.onTap && inRect(x, y, z)) return z
  }
  return null
}

/** 把一个矩形切成 rows × cols 的小格 */
function grid(x, y, size, rows, cols) {
  const cw = size / cols
  const ch = size / rows
  const cells = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push({ row: r + 1, col: c + 1, x: x + c * cw, y: y + r * ch, w: cw, h: ch })
    }
  }
  return cells
}

module.exports = { inRect, hitZone, grid }
