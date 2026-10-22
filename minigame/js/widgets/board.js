// minigame/js/widgets/board.js
// 9×9 棋盘控件 —— 小游戏版，行为对齐 miniprogram/components/board-grid
//
// cells 取值：'' | 'plane' | 'head' | 'hit' | 'kill' | 'miss'
//   也可以是对象 { s: 'head', p: 0, bad: true, trimmed: true, conflict: true }
//     p        「飞机身份色下标」，用于布阵时区分第 1/2/3 架（颜色 + 机头序号双重编码）
//     bad      这一架整体不合规（出界 / 重叠）→ 整架降为半透明，**身份色不变**
//              编辑期允许摆在不合法位置，靠这个标记让「它还不合规」一眼可见
//     trimmed  这一架有格子在棋盘外 → 界内可见部分加红色描边（边界被切断了）
//     conflict 这一格被两架及以上同时占用 → 深红 + 白斜线
//              半透明叠在一起只会变深一点，看不出「这里有两架」
//     stack    这一格落了几架（≥2 就是重叠）。**机头格靠它换成「白底牌 + 红字」**：
//              普通机头是「色块 + 白字」，正负关系一反，不用角标也能看出这格不止一架；
//              牌上的数字是「现在选中的是第几架」，点一下切换它就变 —— 这是重叠时
//              判断「自己选的是哪一架」的唯一依据，所以机头格不画斜线（会划花数字）
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
//   'ghostBad' 松手会落在这里，但这一位放不下（浅红 + 斜线）
//   'hint'     自动吸附的候选位置（**只有虚线外轮廓，不填色**）
//              注意：布阵页在「编辑期宽松」之后不再产生 hint —— 系统不再替玩家
//              找位置。该标记保留给仍需要「建议落点」的场景（如自动整理预览）。
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

/** cells 的元素规范化：字符串 → { s, p, bad, trimmed, conflict } */
function normCell(v) {
  if (!v) return null
  if (typeof v === 'string') {
    return { s: v, p: -1, bad: false, trimmed: false, conflict: false, stack: 1 }
  }
  return {
    s: v.s,
    p: (v.p == null ? -1 : v.p),
    bad: !!v.bad,
    trimmed: !!v.trimmed,
    conflict: !!v.conflict,
    stack: v.stack || 1
  }
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
        const fill = isHead ? (pal ? pal.head : c.planeHead) : (pal ? pal.body : c.plane)

        // 不合规（出界 / 重叠）：整架**降不透明度，但不换颜色**。
        //   换成纯红会同时丢掉两层信息 —— 「这是第几架」和「这是飞机、不是被打中的格子」。
        //   保留身份色 + 变虚，两个诉求一次满足。
        const prevAlpha = ctx.globalAlpha
        if (info.bad) ctx.globalAlpha = prevAlpha * 0.5
        draw.fillRect(ctx, x + inset, y + inset, cell - inset * 2, cell - inset * 2, fill, cell * 0.1)
        ctx.globalAlpha = prevAlpha

        if (isHead) {
          if (pal) {
            // 有身份色 → 印序号：颜色负责扫一眼，序号负责确认「是第几架」
            // 序号不在半透明层里，飞机变虚了它也要一直读得清
            if (info.stack > 1) {
              // 几架机头叠在同一格。
              // 普通机头是「色块 + 白字」，这里换成「白底牌 + 深色字」——
              // 同一套颜色换了正负关系，扫一眼就知道「这一格不止一架」，
              // 不需要额外的角标或说明文字。
              const bs = cell * 0.66
              draw.fillRect(ctx, cx - bs / 2, cy - bs / 2, bs, bs, c.boardBg, bs * 0.2)
              draw.strokeRect(ctx, cx - bs / 2, cy - bs / 2, bs, bs, c.danger,
                bs * 0.2, Math.max(1.2, cell * 0.07))
              draw.text(ctx, String(info.p + 1), cx, cy + cell * 0.02, {
                size: cell * 0.44, weight: 700, color: c.danger,
                align: 'center', baseline: 'middle'
              })
            } else {
              draw.text(ctx, String(info.p + 1), cx, cy + cell * 0.02, {
                size: cell * 0.52, weight: 600, color: '#FFFFFF',
                align: 'center', baseline: 'middle'
              })
            }
          } else {
            // 无身份色（对战阶段）→ 白点标记朝向
            draw.circle(ctx, cx, cy, Math.max(1.5, cell * 0.14), '#FFFFFF')
          }
        }

        // 出界：界内可见的那部分加红色描边 —— 表达「这架的边界被棋盘切断了」。
        // 用描边而不是填色：填色会占用「这里有冲突」那个视觉通道。
        if (info.trimmed) {
          draw.strokeRect(ctx, x + 1, y + 1, cell - 2, cell - 2, c.danger,
            cell * 0.1, Math.max(1.2, cell * 0.05))
        }

        // 冲突格：两架及以上压在同一格。深红 + 白斜线，不透明，压在最上层。
        // 两层半透明叠一起只会「再深一点」，看不出是两架 —— 斜线才说得清。
        //
        // 机头格例外：那里已经有「白底牌 + 红字」的叠层表达，再划一道斜线
        // 只会把序号划花，而序号是判断「现在选的是哪一架」的唯一依据。
        if (info.conflict && !isHead) {
          draw.fillRect(ctx, x + inset, y + inset, cell - inset * 2, cell - inset * 2,
            c.conflict, cell * 0.1)
          hatch(ctx, x, y, cell, c.conflictLine, Math.max(1, cell * 0.06))
        }

        // 非焦点飞机降饱和（选中 / 拖拽某一架时，让焦点跳出来）
        // 已经半透明的不合规飞机不再降饱和：它现在恰恰最需要被看见
        if (!info.bad && dim[keyOf(r, col)]) {
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
