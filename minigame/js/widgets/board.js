// minigame/js/widgets/board.js
// 9×9 棋盘控件 —— 小游戏版，行为对齐 miniprogram/components/board-grid
//
// cells 取值：'' | 'plane' | 'head' | 'hit' | 'kill' | 'miss'
//   plane → 我方飞机机体
//   head  → 我方飞机机头（单独配色 + 白点，用来一眼看出朝向）
//   hit   → 被击中（非机头）
//   kill  → 机头被击中，整机击毁
//   miss  → 未击中
//
// disabledMap: { 'row,col': true } 已轰炸过的格，不可再选（BAT-07）
const theme = require('../core/theme')
const draw = require('../core/draw')
const { BOARD_SIZE } = require('../shared/config/rules')

/** 底板内边距（设计稿单位） */
const PAD = 14

/** 计算格边长等度量 */
function metrics(o) {
  const cell = o.size / BOARD_SIZE
  return { x: o.x, y: o.y, size: o.size, cell: cell }
}

/** 某个格的矩形 */
function cellRect(o, row, col) {
  const m = metrics(o)
  return {
    x: m.x + (col - 1) * m.cell,
    y: m.y + (row - 1) * m.cell,
    w: m.cell,
    h: m.cell
  }
}

/** 棋盘（含底板）的总占用矩形，供场景排版用 */
function outerRect(o, u) {
  const pad = u(PAD)
  return { x: o.x - pad, y: o.y - pad, w: o.size + pad * 2, h: o.size + pad * 2 }
}

/**
 * 注册格子的点击区（layout 阶段）
 * @param {Scene} scene
 * @param {Object} o { x, y, size, selectable, disabledMap }
 * @param {(row:number,col:number)=>void} onCellTap
 */
function layout(scene, o, onCellTap) {
  if (!o.selectable) return
  for (let r = 1; r <= BOARD_SIZE; r++) {
    for (let c = 1; c <= BOARD_SIZE; c++) {
      const k = r + ',' + c
      const rect = cellRect(o, r, c)
      scene.zone(rect.x, rect.y, rect.w, rect.h, function () {
        onCellTap(r, c)
      }, { disabled: !!(o.disabledMap && o.disabledMap[k]), row: r, col: c })
    }
  }
}

/** 绘制棋盘（render 阶段） */
function render(ctx, o, u) {
  const m = metrics(o)
  const c = theme.color
  const pad = u ? u(PAD) : PAD
  const cell = m.cell

  // 底板（加描边：白底与浅灰页面背景对比太弱，不描边会看不出棋盘边界）
  const ox = m.x - pad
  const oy = m.y - pad
  const ow = m.size + pad * 2
  const oh = m.size + pad * 2
  draw.fillRect(ctx, ox, oy, ow, oh, c.boardBg, theme.radius.lg)
  draw.strokeRect(ctx, ox, oy, ow, oh, c.boardFrame, theme.radius.lg, 1)

  // 网格线（1px + 加深色：原来 0.5px 的浅灰在白底上几乎不可见）
  for (let i = 0; i <= BOARD_SIZE; i++) {
    const off = i * cell
    draw.line(ctx, m.x, m.y + off, m.x + m.size, m.y + off, c.gridLine, 1)
    draw.line(ctx, m.x + off, m.y, m.x + off, m.y + m.size, c.gridLine, 1)
  }

  // 外圈再压一道，棋盘边界更实在
  draw.strokeRect(ctx, m.x, m.y, m.size, m.size, c.boardFrame, 0, 1.5)

  // 内部留缝不要太大，否则 10 格飞机会被切成 10 个小方块、看不出是一架飞机
  const inset = Math.max(0.5, cell * 0.03)

  for (let r = 1; r <= BOARD_SIZE; r++) {
    const row = (o.cells && o.cells[r - 1]) || []
    for (let col = 1; col <= BOARD_SIZE; col++) {
      const state = row[col - 1]
      if (!state) continue

      const x = m.x + (col - 1) * cell
      const y = m.y + (r - 1) * cell
      const cx = x + cell / 2
      const cy = y + cell / 2

      if (state === 'plane' || state === 'head') {
        const fill = state === 'head' ? c.planeHead : c.plane
        draw.fillRect(ctx, x + inset, y + inset, cell - inset * 2, cell - inset * 2, fill, cell * 0.1)
        if (state === 'head') {
          // 机头白点：朝向一眼可辨
          draw.circle(ctx, cx, cy, Math.max(1.5, cell * 0.14), '#FFFFFF')
        }
      } else if (state === 'hit') {
        draw.fillRect(ctx, x + inset, y + inset, cell - inset * 2, cell - inset * 2, c.hitLight, cell * 0.1)
        draw.circle(ctx, cx, cy, cell * 0.26, c.hit)
      } else if (state === 'kill') {
        draw.fillRect(ctx, x + inset, y + inset, cell - inset * 2, cell - inset * 2, c.danger, cell * 0.1)
        draw.circle(ctx, cx, cy, cell * 0.22, '#FFFFFF')
      } else if (state === 'miss') {
        draw.circle(ctx, cx, cy, cell * 0.18, c.miss)
      }
    }
  }

  // 选中高亮
  const sel = o.selected
  if (sel && o.selectable) {
    const x = m.x + (sel.col - 1) * cell
    const y = m.y + (sel.row - 1) * cell
    draw.fillRect(ctx, x + inset, y + inset, cell - inset * 2, cell - inset * 2, c.primaryLight, cell * 0.1)
    draw.strokeRect(ctx, x + 1, y + 1, cell - 2, cell - 2, c.primary, cell * 0.1, Math.max(2, cell * 0.12))
  }
}

module.exports = { layout, render, cellRect, metrics, outerRect, BOARD_SIZE }
