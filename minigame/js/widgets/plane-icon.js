// minigame/js/widgets/plane-icon.js
// 飞机棋子图标 —— 直接由机型配置的相对坐标绘制，和棋盘里的飞机是同一份形状数据
//
// 用途：
//   ① 房间页「飞机数量」点亮选择器（点亮 N 个 = N 架）
//   ② 布阵页「已放置」状态（点亮 = 已放，点一下 = 选中那一架）
//
// 关键决策：图标跟随该架飞机的实际朝向（rotation）。
// 若统一画「朝上」，玩家会误以为飞机都朝上——朝向是要推理的核心信息，图标不能撒谎。
const theme = require('../core/theme')
const draw = require('../core/draw')
const { getPlane, PLANE_MAP } = require('../shared/config/planes')

const shapeCache = {}

/**
 * 归一化某朝向下的格位（整体平移到左上角对齐）
 * @returns {{rows:number, cols:number, cells:Array<{r:number,c:number,isHead:boolean}>}}
 */
function shapeOf(planeId, rotation) {
  const key = (planeId || 'standard') + ':' + (((rotation || 0) % 4) + 4) % 4
  if (shapeCache[key]) return shapeCache[key]

  const plane = PLANE_MAP[planeId] || getPlane('standard')
  const head = plane.cells[plane.headIndex]
  const hr = head[0]
  const hc = head[1]
  const times = ((rotation || 0) % 4 + 4) % 4

  let minR = Infinity
  let maxR = -Infinity
  let minC = Infinity
  let maxC = -Infinity
  const items = []

  plane.cells.forEach(function (cell, i) {
    let dr = cell[0] - hr
    let dc = cell[1] - hc
    for (let k = 0; k < times; k++) {
      const t = dr
      dr = dc
      dc = -t
    }
    if (dr < minR) minR = dr
    if (dr > maxR) maxR = dr
    if (dc < minC) minC = dc
    if (dc > maxC) maxC = dc
    items.push({ dr: dr, dc: dc, isHead: i === plane.headIndex })
  })

  const shape = {
    rows: maxR - minR + 1,
    cols: maxC - minC + 1,
    cells: items.map(function (it) {
      return { r: it.dr - minR, c: it.dc - minC, isHead: it.isHead }
    })
  }
  shapeCache[key] = shape
  return shape
}

/**
 * 在 size × size 的方框里画一枚飞机棋子
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x 方框左上角
 * @param {number} y
 * @param {number} size 方框边长
 * @param {Object} o { planeId, rotation, on, color, headColor, pad }
 */
function render(ctx, x, y, size, o) {
  const opt = o || {}
  const shape = shapeOf(opt.planeId || 'standard', opt.rotation || 0)
  const pad = opt.pad != null ? opt.pad : size * 0.08
  const inner = size - pad * 2
  const cell = inner / Math.max(shape.rows, shape.cols)
  const ox = x + pad + (inner - shape.cols * cell) / 2
  const oy = y + pad + (inner - shape.rows * cell) / 2

  const on = opt.on !== false
  const body = on ? (opt.color || theme.color.plane) : theme.color.planeOff
  const headColor = on ? (opt.headColor || theme.color.planeHead) : theme.color.planeOffHead
  const gap = Math.max(0.4, cell * 0.1)

  shape.cells.forEach(function (c) {
    draw.fillRect(
      ctx,
      ox + c.c * cell + gap,
      oy + c.r * cell + gap,
      cell - gap * 2,
      cell - gap * 2,
      c.isHead ? headColor : body,
      cell * 0.24
    )
  })
}

/** 图标的横向留白比例（供调用方算槽位宽高） */
const ASPECT = 1

module.exports = { render, shapeOf, ASPECT }
