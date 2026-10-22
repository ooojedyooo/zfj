// minigame/js/widgets/board.js
// 9×9 棋盘控件 —— 小游戏版，行为对齐 miniprogram/components/board-grid
//
// cells 取值：'' | 'plane' | 'head' | 'hit' | 'kill' | 'miss'
//   也可以是对象 { s: 'head', p: 0 } —— p 是「飞机身份色下标」，
//   用于布阵时区分第 1/2/3 架（颜色 + 机头序号双重编码，见 theme.planePalette）
//   plane → 我方飞机机体
//   head  → 我方飞机机头（有 p 时印序号，无 p 时印白点）
//   hit   → 被击中（非机头）
//   kill  → 机头被击中，整机击毁
//   miss  → 未击中
//
// marks 叠加层取值：
//   'select'   选中架的整架描边（实线）
//   'fade'     拖拽时原位置留痕（浅色块）
//   'ghostOk'  松手就落在这里（实心色块 + 实线外轮廓）
//   'ghostBad' 手指所在但不能放（浅红 + 斜线 + 红外轮廓）
//   'hint'     自动吸附的候选位置（**只有虚线外轮廓，不填色**）
//
// 为什么 hint 不填色：它表达的是「如果你现在松手，会落到这儿」，
// 属于**预期**而不是**现状**。填色会和 ghostOk 混淆，玩家会以为已经放下了。
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

/**
 * 像素坐标 → 格子坐标（拖拽落位用）
 * @returns {{row:number,col:number}|null} 落在棋盘外返回 null
 */
function cellAt(o, x, y) {
  const m = metrics(o)
  if (x < m.x || y < m.y || x >= m.x + m.size || y >= m.y + m.size) return null
  const col = Math.floor((x - m.x) / m.cell) + 1
  const row = Math.floor((y - m.y) / m.cell) + 1
  if (row < 1 || row > BOARD_SIZE || col < 1 || col > BOARD_SIZE) return null
  return { row: row, col: col }
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

/** cells 的元素规范化：字符串 → { s, p } */
function normCell(v) {
  if (!v) return null
  if (typeof v === 'string') return { s: v, p: -1 }
  return { s: v.s, p: (v.p == null ? -1 : v.p) }
}

/** 取某架飞机的身份色，p < 0 时回落到默认单色 */
function paletteOf(p) {
  const list = theme.color.planePalette
  if (p < 0) return null
  return list[p % list.length]
}

/**
 * 画一组格子的**外轮廓**
 *
 * 只画「邻居不在集合内」的边，所以 10 格画出来是一架完整飞机的轮廓，
 * 而不是 10 个小方框。这比逐格描边更能让人看出「这是一架飞机」。
 *
 * @param {number} dash 传了就画虚线（hint），否则实线
 */
function strokeOutline(ctx, m, cells, color, width, dash) {
  const key = {}
  for (let i = 0; i < cells.length; i++) key[cells[i].row + ',' + cells[i].col] = true
  const cell = m.cell

  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    const x = m.x + (c.col - 1) * cell
    const y = m.y + (c.row - 1) * cell
    // [x1, y1, x2, y2, 邻居行, 邻居列]
    const edges = [
      [x, y, x + cell, y, c.row - 1, c.col],
      [x, y + cell, x + cell, y + cell, c.row + 1, c.col],
      [x, y, x, y + cell, c.row, c.col - 1],
      [x + cell, y, x + cell, y + cell, c.row, c.col + 1]
    ]
    for (let e = 0; e < edges.length; e++) {
      const ed = edges[e]
      if (key[ed[4] + ',' + ed[5]]) continue   // 内部边不画
      if (dash) draw.dashedLine(ctx, ed[0], ed[1], ed[2], ed[3], color, width, dash, dash * 0.8)
      else draw.line(ctx, ed[0], ed[1], ed[2], ed[3], color, width)
    }
  }
}

/** 单格画叉（表示「这里不能放」） */
function hatch(ctx, x, y, size, color, width) {
  const p = size * 0.24
  draw.line(ctx, x + p, y + p, x + size - p, y + size - p, color, width)
  draw.line(ctx, x + size - p, y + p, x + p, y + size - p, color, width)
}

/** 绘制棋盘（render 阶段） */
function render(ctx, o, u) {
  const m = metrics(o)
  const c = theme.color
  const pad = u ? u(PAD) : PAD
  const cell = m.cell
  const keyOf = function (r, col) { return r + ',' + col }

  // 底板（先铺一层极淡的偏移块当阴影，比 shadowBlur 便宜且在真机上更稳）
  const ox = m.x - pad
  const oy = m.y - pad
  const ow = m.size + pad * 2
  const oh = m.size + pad * 2
  draw.fillRect(ctx, ox, oy + pad * 0.5, ow, oh, 'rgba(12, 68, 124, 0.05)', theme.radius.lg)
  // 加描边：白底与浅灰页面背景对比太弱，不描边会看不出棋盘边界
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
  const dim = o.dim || {}

  for (let r = 1; r <= BOARD_SIZE; r++) {
    const row = (o.cells && o.cells[r - 1]) || []
    for (let col = 1; col <= BOARD_SIZE; col++) {
      const info = normCell(row[col - 1])
      if (!info) continue

      const x = m.x + (col - 1) * cell
      const y = m.y + (r - 1) * cell
      const cx = x + cell / 2
      const cy = y + cell / 2
      const state = info.s

      if (state === 'plane' || state === 'head') {
        const pal = paletteOf(info.p)
        const isHead = state === 'head'
        const fill = isHead
          ? (pal ? pal.head : c.planeHead)
          : (pal ? pal.body : c.plane)
        draw.fillRect(ctx, x + inset, y + inset, cell - inset * 2, cell - inset * 2, fill, cell * 0.1)

        if (isHead) {
          if (pal) {
            // 有身份色 → 印序号：颜色负责扫一眼，序号负责确认「是第几架」
            draw.text(ctx, String(info.p + 1), cx, cy + cell * 0.02, {
              size: cell * 0.52, weight: 600, color: '#FFFFFF',
              align: 'center', baseline: 'middle'
            })
          } else {
            // 无身份色（对战阶段）→ 白点标记朝向
            draw.circle(ctx, cx, cy, Math.max(1.5, cell * 0.14), '#FFFFFF')
          }
        }
        // 非焦点飞机降饱和（选中 / 拖拽某一架时，让焦点跳出来）
        if (dim[keyOf(r, col)]) {
          draw.fillRect(ctx, x + inset, y + inset, cell - inset * 2, cell - inset * 2,
            c.planeDim, cell * 0.1)
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

  // 选中高亮（单格，仅敌方棋盘点选用）
  const sel = o.selected
  if (sel && o.selectable) {
    const x = m.x + (sel.col - 1) * cell
    const y = m.y + (sel.row - 1) * cell
    draw.fillRect(ctx, x + inset, y + inset, cell - inset * 2, cell - inset * 2, c.primaryLight, cell * 0.1)
    draw.strokeRect(ctx, x + 1, y + 1, cell - 2, cell - 2, c.primary, cell * 0.1, Math.max(2, cell * 0.12))
  }

  /* ---------------- 叠加层 ---------------- */
  const marks = o.marks
  if (!marks) return

  // 先把同一类标记的格子收集起来：外轮廓要按「整架」画，不能逐格画
  const groups = { fade: [], ghostOk: [], ghostBad: [], hint: [], select: [] }
  for (let r = 1; r <= BOARD_SIZE; r++) {
    for (let col = 1; col <= BOARD_SIZE; col++) {
      const st = marks[keyOf(r, col)]
      if (st && groups[st]) groups[st].push({ row: r, col: col })
    }
  }

  // ① 原位置留痕：逐格浅块（它本来就要「淡」，画外轮廓反而抢眼）
  groups.fade.forEach(function (p) {
    draw.fillRect(ctx, m.x + (p.col - 1) * cell + inset, m.y + (p.row - 1) * cell + inset,
      cell - inset * 2, cell - inset * 2, c.dragOrigin, cell * 0.1)
  })

  // ② 非法落位：浅红色块 + 斜线（纯红色块容易和「击毁红」混淆，加斜线更像禁止标志）
  groups.ghostBad.forEach(function (p) {
    const x = m.x + (p.col - 1) * cell
    const y = m.y + (p.row - 1) * cell
    draw.fillRect(ctx, x + inset, y + inset, cell - inset * 2, cell - inset * 2, c.ghostBad, cell * 0.1)
    hatch(ctx, x, y, cell, c.ghostBadLine, Math.max(1, cell * 0.055))
  })

  // ③ 合法落位：实心块 + 实线外轮廓
  groups.ghostOk.forEach(function (p) {
    draw.fillRect(ctx, m.x + (p.col - 1) * cell + inset, m.y + (p.row - 1) * cell + inset,
      cell - inset * 2, cell - inset * 2, c.ghostOk, cell * 0.1)
  })

  // ④ 自动吸附候选：**只描虚线，不填色**
  if (groups.hint.length) {
    strokeOutline(ctx, m, groups.hint, c.hintRing, Math.max(1.5, cell * 0.07), Math.max(3, cell * 0.22))
  }

  // ⑤ 选中 / 合法落位的外轮廓（实线，压在最上层）
  if (groups.ghostOk.length) {
    strokeOutline(ctx, m, groups.ghostOk, c.primary, Math.max(1.5, cell * 0.08), 0)
  }
  if (groups.select.length) {
    strokeOutline(ctx, m, groups.select, c.selectRing, Math.max(2, cell * 0.1), 0)
  }
}

module.exports = { layout, render, cellRect, cellAt, metrics, outerRect, normCell, BOARD_SIZE }
