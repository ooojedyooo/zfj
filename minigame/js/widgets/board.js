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
// 复用 gameplay 层的旋转函数，**不自己再写一份**
//   —— 飞机形状的唯一权威是 shared/utils/plane.js，这里要是另写一个
//   「差不多」的实现，两边一定会有一天对不上，而对不上的表现是
//   「预览图里飞机朝向错了、真机对」这种最难查的 bug。
const { rotateRel } = require('../shared/utils/plane')

/** 底板内边距（设计稿单位） */
const PAD = 22

/**
 * 「细节层」的最低格子尺寸（刻度 / 空格微点都看它）。
 *
 * 11px 的格子（对战页那张缩小后的我方海域）里，刻度数字会和格线糊成一片、
 * 81 个微点会变成一片麻点，反而都是噪声。缩略盘的角色只是
 * 「看一眼还剩几架完好」，不需要读数，也不需要「这里能点」。
 */
const AXIS_MIN_CELL = 22

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

/**
 * 命中：橙色爆点 + 四向短芒
 *
 * 原来只是一个橙色实心圆 —— 在密网格里和「一个色块」没有区别。
 * 加上四向短芒之后它有了方向性，读起来是「这一格被炸开了」，
 * 而不是「这一格被涂成了橙色」。
 */
function burst(ctx, cx, cy, cell, color) {
  const r = cell * 0.2
  draw.circle(ctx, cx, cy, r, color)
  const gap = cell * 0.23
  const len = cell * 0.1
  const w = Math.max(1, cell * 0.055)
  draw.line(ctx, cx, cy - gap, cx, cy - gap - len, color, w)
  draw.line(ctx, cx, cy + gap, cx, cy + gap + len, color, w)
  draw.line(ctx, cx - gap, cy, cx - gap - len, cy, color, w)
  draw.line(ctx, cx + gap, cy, cx + gap + len, cy, color, w)
}

/**
 * 双轴刻度 1-9
 *
 * 这一条不是装饰。游戏里「横3，竖4」是唯一的书面报点口径：
 * 超时自动轰炸会播报「已自动轰炸 横3，竖4」，战报、复盘、口头邀战也全用它。
 * 盘上没有刻度，那句话就是一串读不懂的数字。
 *
 * 画在底板往外扩出来的那一圈环带上（见 PAD），**不占棋盘本体的尺寸** ——
 * 格子边长一像素都不会变小，触控精度不受影响。
 *
 * 环带中心 = pad * 0.5，所以数字距棋盘边 5~6px，永远压不到格线。
 */
function drawAxis(ctx, m, pad) {
  const cell = m.cell
  if (cell < AXIS_MIN_CELL) return
  const color = theme.color.axisText
  const fs = Math.max(9, Math.min(13, cell * 0.3))
  const ring = pad * 0.5

  for (let i = 1; i <= BOARD_SIZE; i++) {
    // 行号：左侧环带，垂直居中于该行
    draw.text(ctx, String(i), m.x - ring, m.y + (i - 0.5) * cell, {
      size: fs, color: color, align: 'center', baseline: 'middle'
    })
    // 列号：底部环带，水平居中于该列
    draw.text(ctx, String(i), m.x + (i - 0.5) * cell, m.y + m.size + ring, {
      size: fs, color: color, align: 'center', baseline: 'middle'
    })
  }
}

/* ================= 飞机精美化（art 规格 §5.3 十层） ================= */

/**
 * 细节层（龙骨 / 后掠线 / 翼尖灯 / 喷口）与机头序号的最低格子尺寸。
 *
 * art §6.4：**LOD 只降「读数」与「细节」，永不降「结构」。**
 * 结构 = 底板 / 外框 / 格线 / 两层底色 —— 定义「这是一张 9×9 的盘」的东西，
 * 任何尺寸下都必须画。
 * 11px 的缩略盘上：龙骨只有 3.3px 宽（读不出「一条带」）、后掠线 1px 被 AA
 * 摊成一片灰、5.7px 的序号是一团墨点。这些不是「小一号的华丽」，是噪点。
 */
const DETAIL_MIN_CELL = 22

/**
 * 机头「浅底盘」的最低格子尺寸。
 *
 * 与 `DETAIL_MIN_CELL` **同值不同义，故意分开两个常量**：
 *   · DETAIL_MIN_CELL  回答「还能不能画出龙骨 / 后掠线 / 翼尖灯 / 序号」——
 *     是**细节**的闸门，规格再好一点就能降到 16。
 *   · HEAD_PLATE_MIN_CELL 回答「机头格还能不能整格提亮」—— 是**结构**的闸门：
 *     一块 11px 的浅色方牌既印不了字（字只剩 5.7px），又比机身亮一大截，
 *     在缩略盘上会被读成「这一格是空的 / 被选中」。
 * 合成一个常量的后果是：哪天序号能缩到 16px 可读，改一处会把另一处悄悄绑回去。
 */
const HEAD_PLATE_MIN_CELL = 22

/**
 * 机型局部坐标：**单位是「格」，原点在机头格左上角，+y 朝机尾、+x 朝右翼。**
 *
 * 只有「装饰落点」用这组常量 —— 那是视觉位置，本来就该人工定。
 * 填充与描边一律按实际格位算（见 drawPlane），所以换机型时形状不会错。
 * 数值对应 shared/config/planes.js 的 standard 机型：
 *   机头 1 格 (0,0)｜机翼行 y∈[1,2] 横跨 x∈[-2,3]｜机身 (0,1)｜机尾行 y∈[3,4] 横跨 x∈[-1,2]
 *
 * 龙骨 = x∈[0,1] 那一列纵贯 y∈[0,4]。§5.2 说这是整份规格最关键的一条观察：
 * 现状读成「加号」，就是因为没人用这条贯通的中轴 —— 一个没有脊梁的十字，
 * 本来就长得像加号。
 */
const PK = {
  keelX: 0.5,      // 龙骨中轴（机头格水平中点）
  keelW: 0.30,     // 龙骨宽。0.5 以上会有亮带穿过序号，0.2 以下 30px 屏上退化成划痕
  wingY: 1,        // 机翼行上沿
  wingX0: -2,      // 左翼尖
  wingX1: 3,       // 右翼尖
  panelOff: 0.37,  // 后掠偏移（格）→ 视觉后掠角 ≈ 10°。贴到 0.6 就有「被削掉一条」的错觉
  noseW: 0.16,     // 机头前缘三角宽。≤0.18，再宽会碰到 0.62C 的序号保护区
  noseD: 0.10,     // 机头前缘三角深
  nozzleW: 0.40,   // 尾喷口宽
  nozzleH: 0.16    // 尾喷口高
}

/** 龙骨渐变色标：模块级常量，引用稳定（不进热路径新建数组） */
const KEEL_STOPS = [
  { at: 0, color: theme.planeArt.glow },
  { at: 1, color: theme.planeArt.keelTail }
]

/* 共享 scratch：热路径不分配对象。约定「取到就立刻用掉，不要持有」。 */
const _mp = { x: 0, y: 0 }
const _mr = { x: 0, y: 0, w: 0, h: 0 }
const _one = []      // 单格 path 入参（机头格复用，免得每架每帧 new 一个数组）

/** 取某格的状态字符串（cells 的元素可能是字符串，也可能是对象） */
function cellState(cells, row, col) {
  const r = cells && cells[row - 1]
  if (!r) return ''
  const v = r[col - 1]
  if (!v) return ''
  return typeof v === 'string' ? v : v.s
}

/** 取某格落了几架（只有机头格用得上：stack > 1 → 白底牌 + 红字） */
function cellStack(cells, row, col) {
  const r = cells && cells[row - 1]
  const v = r && r[col - 1]
  if (!v) return 1
  return typeof v === 'string' ? 1 : (v.stack || 1)
}

/** 这架被打掉了几成（0~1）。只读数据，不额外产生绘制调用。 */
function damageOf(cells, list) {
  if (!list || !list.length) return 0
  let n = 0
  for (let i = 0; i < list.length; i++) {
    const s = cellState(cells, list[i].row, list[i].col)
    if (s === 'hit' || s === 'kill') n++
  }
  return n / list.length
}

/**
 * 局部点 → 屏幕点
 *
 * **为什么不用 ctx.translate + ctx.rotate（art §5.5 的原始方案）：**
 *   ① scripts/lib/svg-ctx.js 的 setTransform 是空实现 → 出图会**静默画错位置**：
 *      真机对、预览错。而这套项目唯一的视觉验证手段就是预览图。
 *      静默错位比抛异常危险得多 —— 抛异常至少有人看得见。
 *   ② 90° 整数倍旋转**不插值**：1px 线转完还是 1px，清晰度零损失。
 *
 * 映射规则与 shared/utils/plane.js 的 rotateRel 完全一致（顺时针 k 次），
 * 所以几何和数据永远同源：那边改一个约定，这边不用动。
 */
function mapPoint(f, lx, ly) {
  const u = lx - 0.5   // 相对机头格**中心**
  const v = ly - 0.5
  const k = f.k
  let dr, dc
  if (k === 1) { dr = u; dc = -v }
  else if (k === 2) { dr = -v; dc = -u }
  else if (k === 3) { dr = -u; dc = v }
  else { dr = v; dc = u }
  _mp.x = f.cx + dc * f.cell
  _mp.y = f.cy + dr * f.cell
  return _mp
}

/** 局部矩形 → 屏幕矩形（正交映射后仍轴对齐，两个对角点就够） */
function mapRect(f, lx0, ly0, lx1, ly1) {
  const a = mapPoint(f, lx0, ly0)
  const ax = a.x
  const ay = a.y
  const b = mapPoint(f, lx1, ly1)
  _mr.x = Math.min(ax, b.x)
  _mr.y = Math.min(ay, b.y)
  _mr.w = Math.abs(b.x - ax)
  _mr.h = Math.abs(b.y - ay)
  return _mr
}

/** 局部线段 → 当前路径（一次 moveTo + lineTo） */
function segPath(ctx, f, x1, y1, x2, y2) {
  const a = mapPoint(f, x1, y1)
  const ax = a.x
  const ay = a.y
  const b = mapPoint(f, x2, y2)
  ctx.moveTo(ax, ay)
  ctx.lineTo(b.x, b.y)
}

/** 局部圆心 → 当前路径（一个圆；同一路径里可连续放多个） */
function dotPath(ctx, f, lx, ly, r) {
  const a = mapPoint(f, lx, ly)
  ctx.moveTo(a.x + r, a.y)
  ctx.arc(a.x, a.y, r, 0, Math.PI * 2)
}

/**
 * 把「这一组格的外轮廓」写进当前路径（不 stroke）
 *
 * 只描「邻居不在集合里」的边：10 个格子画出来是一架完整飞机的轮廓，而不是
 * 10 个小方框。逐格描边会在交界处留下内线，把整架切成小方块 —— 那正是要消灭的观感。
 *
 * 为什么单独抽出来：暗描边和亮描边是**同一条轮廓**，各 stroke 一次。
 * 中间夹着别的 fill（会 beginPath），所以两次描边各自重建路径 ——
 * 重建是纯 JS 循环，不产生光栅化调用，绘制次数不变。
 */
function planeEdge(ctx, f, cells, has) {
  ctx.beginPath()
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    const rel = rotateRel(c.row - f.hr, c.col - f.hc, 4 - f.k)
    const r = mapRect(f, rel[1], rel[0], rel[1] + 1, rel[0] + 1)
    // 先取值再判断：mapRect 返回共享 scratch，下一次调用会被覆盖
    const x = r.x
    const y = r.y
    const w = r.w
    const h = r.h
    if (!has[(c.row - 1) + ',' + c.col]) { ctx.moveTo(x, y); ctx.lineTo(x + w, y) }
    if (!has[(c.row + 1) + ',' + c.col]) { ctx.moveTo(x, y + h); ctx.lineTo(x + w, y + h) }
    if (!has[c.row + ',' + (c.col - 1)]) { ctx.moveTo(x, y); ctx.lineTo(x, y + h) }
    if (!has[c.row + ',' + (c.col + 1)]) { ctx.moveTo(x + w, y); ctx.lineTo(x + w, y + h) }
  }
}

/**
 * 两块**不同色**的底色（机头 / 机身）在共用边界上要重叠这么多 px。
 *
 * 两次独立 fill 的抗锯齿各让掉 50%，合成后那条边界会透出 25% 的底板，
 * 读成一道暗细线 —— 看上去像「机头是贴上去的一块牌」。并集路径只解决同色格之间的缝，
 * 解决不了**换色**那一条，所以换色的那条边要往外多吃 0.6px。
 * 0.6 而不是 0.5：dpr=2 时边界常常落在半像素上，0.6 逻辑像素 = 1.2 设备像素才盖得住。
 */
const FILL_OVERLAP = 0.6

/**
 * 把「一组格子的并集」写进当前路径（不 fill）
 *
 * **为什么不能用逐格 fillRect / roundRectPath：** 它们让每一格的四条边**都**内缩，
 * 相邻两格各缩 ins，中间就露出一条 2·ins 宽的暗底板（36px 格上 2.2px），
 * 再叠上 3.6px 圆角把交界处的角凹掉更多。于是 10 格的飞机读成「10 块圆角卡片」——
 * 那些「凭空多出来的内部边」不是描边画出来的（planeEdge 一直只画并集轮廓），
 * 是**底色层的缝**透出来的暗底板。
 *
 * 所以：朝外的边内缩 `ins`，**朝内的边反而外扩 FILL_OVERLAP**；两格边界重合，
 * 一整块无缝。圆角同理，只做在「两条相邻边都朝外」的角上，其余角是直角 ——
 * 两个直角拼在一起是一条直线，看不出接缝。
 *
 * **为什么四邻 → 四边不用查表、与朝向无关：** 格子**从来不在屏幕上转动**。
 * drawPlane 里 rotateRel(…, 4-k) 与 mapPoint 的 k 互为逆变换，两者相乘恒等于
 * 「格子落在自己真实的棋盘位上」（转的是飞机**占哪几格**，不是格子的画法）。
 * 所以「上边」永远是 row-1 那一侧，四个朝向同一套判断 —— 这也正好让底色与
 * planeEdge 的描边用**完全一致**的邻接规则，两层不会各说各话。
 *
 * @param {Object} f    frameOf() 的结果
 * @param {Array}  cells 要画的格（{row, col}）
 * @param {Object} has  整架飞机的格集合（判邻居在不在，含机头格）
 * @param {number} ins  朝外边内缩 px
 * @param {number} rad  外角圆角半径 px
 */
function unionRectPath(ctx, f, cells, has, ins, rad) {
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]
    const rel = rotateRel(c.row - f.hr, c.col - f.hc, 4 - f.k)
    const r = mapRect(f, rel[1], rel[0], rel[1] + 1, rel[0] + 1)
    // 先取值再判断：mapRect 返回共享 scratch，下一次调用会覆盖
    const x = r.x
    const y = r.y
    const w = r.w
    const h = r.h
    const oT = !has[(c.row - 1) + ',' + c.col]
    const oB = !has[(c.row + 1) + ',' + c.col]
    const oL = !has[c.row + ',' + (c.col - 1)]
    const oR = !has[c.row + ',' + (c.col + 1)]
    const x0 = x + (oL ? ins : -FILL_OVERLAP)
    const x1 = x + w - (oR ? ins : -FILL_OVERLAP)
    const y0 = y + (oT ? ins : -FILL_OVERLAP)
    const y1 = y + h - (oB ? ins : -FILL_OVERLAP)
    const rr = Math.max(0, Math.min(rad, (x1 - x0) / 2, (y1 - y0) / 2))
    const rTL = (oT && oL) ? rr : 0
    const rTR = (oT && oR) ? rr : 0
    const rBR = (oB && oR) ? rr : 0
    const rBL = (oB && oL) ? rr : 0
    // arcTo 在 r=0 时退化成 lineTo（Canvas 规范与出图桩同语义），
    // 所以「有圆角 / 没圆角」共用一条代码路径，不需要分支。
    ctx.moveTo(x0 + rTL, y0)
    ctx.arcTo(x1, y0, x1, y1, rTR)
    ctx.arcTo(x1, y1, x0, y1, rBR)
    ctx.arcTo(x0, y1, x0, y0, rBL)
    ctx.arcTo(x0, y0, x1, y0, rTL)
    ctx.closePath()
  }
}

/** 算一架飞机的「局部 → 屏幕」映射参数；没有机头就返回 null（宁可不画） */
function frameOf(m, pl) {
  let head = null
  for (let i = 0; i < pl.cells.length; i++) {
    if (pl.cells[i].isHead) { head = pl.cells[i]; break }
  }
  if (!head) return null
  return {
    k: ((pl.rotation || 0) % 4 + 4) % 4,
    cx: m.x + (head.col - 0.5) * m.cell,
    cy: m.y + (head.row - 0.5) * m.cell,
    cell: m.cell,
    hr: head.row,
    hc: head.col
  }
}

/**
 * 画一架飞机（art §5.3 的 #1~#9）
 *
 * 第 #10 层「机头序号」**故意留在这里不画**，由格循环补 ——
 * 因为序号之上还要压 trimmed / conflict / dim 这些格级叠加，
 * 顺序挪到这儿会让「降饱和」把序号一起压暗，和现状不一致。
 *
 * 绘制调用（C=36）：暗描边 1 + 机体底色 1 + 机头底色 1 + 龙骨 1 + 后掠线 1 +
 * 前缘三角 1 + 翼尖灯 1 + 喷口 2 + 亮描边 1 = **10 次**
 * 对比现状「10 格 × fillRect + 1 text = 11」—— 精美化之后反而少一次。
 * 前提是 §6.3 P1「8 个机体格合成一条路径一次 fill」：
 * 没这条会变成 +60 而不是 +2，那是整个方案最容易被估错的一处。
 *
 * @param {Object} f     frameOf() 的结果
 * @param {Object} pl    { p, cells: [{ row, col, isHead }] }
 * @param {Array}  cells 棋盘 cells 矩阵（判「这一格是不是已经被打中」）
 * @param {boolean} dimmed 非焦点（整架压一层暗色）
 */
function drawPlane(ctx, f, pl, cells, dimmed) {
  const art = theme.planeArt
  const C = f.cell
  const k = f.k
  const list = pl.cells
  const pal = paletteOf(pl.p)
  const bodyColor = pal ? pal.body : theme.color.plane
  const headColor = pal ? pal.head : theme.color.planeHead
  const ins = Math.max(0.5, C * 0.03)   // 逐格内缩（px），和逐格老画法同一个值
  const insC = ins / C                  // 同一个量，换算成「格」
  const rad = C * 0.1

  // 已经被打中的格子不参与本体 —— 给一个空洞描一圈轮廓比不描更怪。
  // 但「机头在哪」仍然记下来：它是整架几何的锚点（龙骨方向、前缘三角都靠它），
  // 机头被打中时状态变 kill，可那不代表机头换了位置。
  const vis = []
  const body = []          // vis 去掉机头格：机体色和机头色不同，必须分两次 fill
  const has = {}
  let head = null
  let visHead = null
  for (let i = 0; i < list.length; i++) {
    const cl = list[i]
    if (cl.isHead && !head) head = cl
    const s = cellState(cells, cl.row, cl.col)
    if (s === 'hit' || s === 'kill') continue
    vis.push(cl)
    if (cl.isHead) visHead = cl
    else body.push(cl)
    has[cl.row + ',' + cl.col] = true
  }
  if (!vis.length) return

  // ---- #1 外描边·暗 ----
  // 先画、再让底色压上去：内半圈被盖掉，只在外侧留约 0.9px 暗边，
  // 飞机从底板上「浮」起来一层。单层亮描边只告诉你「这里有边界」，
  // 不告诉你边界往哪边倒 —— 暗底 + 亮面才说得清。整套方案性价比最高的一层。
  planeEdge(ctx, f, vis, has)
  ctx.strokeStyle = art.shadow
  ctx.lineWidth = Math.max(1, C * 0.05)
  ctx.stroke()

  // ---- #3 机体底色：8 格一条并集路径、一次 fill ----
  // 相邻格之间**不内缩**：一格的四条边缩不缩，取决于那一边的邻居在不在集合里。
  // 逐格内缩会让 10 格飞机读成 10 块圆角卡片（内部凭空多出 12 条暗缝），
  // 那是「缝成一块」失败的真正原因，而描边层一直是对的。
  ctx.beginPath()
  unionRectPath(ctx, f, body, has, ins, rad)
  ctx.fillStyle = bodyColor
  ctx.fill()

  // ---- #4 机头底色（1 格）----
  // 不并进 #3：颜色不同，必须单独 fill。但它走**同一套边判定** ——
  // 和机身相邻的那条边不内缩，所以机头是严丝合缝贴上去的，不是贴了块牌。
  //
  // 小尺寸不画浅底盘：整格改用机身色，机头改由中心暗点表达（见格循环里的 isHead 分支）。
  if (visHead) {
    _one[0] = visHead
    ctx.beginPath()
    unionRectPath(ctx, f, _one, has, ins, rad)
    ctx.fillStyle = C >= HEAD_PLATE_MIN_CELL ? headColor : bodyColor
    ctx.fill()
  }

  if (C >= DETAIL_MIN_CELL) {
    // ---- #5 龙骨 · 中轴渐变带 ----
    // 亮端永远落在局部 -y 端，而 -y 端永远是机头（映射规则保证）：
    // **朝向被画进了光照里**，玩家不看序号也能读出机头朝哪 —— 第二重方向编码。
    //
    // stack > 1 时整格跳过：那一格画的是「白底牌 + 红字」，亮带穿过去会把数字划花，
    // 而数字是判断「现在选的是哪一架」的唯一依据。
    const from = (head && cellStack(cells, head.row, head.col) > 1) ? 1 : 0
    const p0 = mapPoint(f, PK.keelX, 0)
    const gx0 = p0.x
    const gy0 = p0.y
    const p1 = mapPoint(f, PK.keelX, 4)
    const gx1 = p1.x
    const gy1 = p1.y
    const kr = mapRect(f, PK.keelX - PK.keelW / 2, from, PK.keelX + PK.keelW / 2, 4)
    draw.gradientRect(ctx, kr.x, kr.y, kr.w, kr.h, gx0, gy0, gx1, gy1, KEEL_STOPS)

    // ---- #6 机翼后掠线 ×4：一条路径 4 段，一次 stroke ----
    // 用暗线不用亮线：亮线在机翼上会读成「这里有缝、是不是两架飞机」，
    // 暗的 1px 读成「蒙皮拼缝」。
    ctx.strokeStyle = art.panel
    ctx.lineWidth = Math.max(1, C * 0.025)
    ctx.beginPath()
    for (let s = 0; s < 2; s++) {
      const yy = PK.wingY + 0.15 + s * 0.30
      segPath(ctx, f, 0, yy, PK.wingX0, yy + PK.panelOff)
      segPath(ctx, f, 1, yy, PK.wingX1, yy + PK.panelOff)
    }
    ctx.stroke()

    // ---- #7 机头前缘三角 ----
    // 最强的单点方向线索：真飞机机头是尖的，方块机头是平的。
    // 画在格内、顶点朝外，不切轮廓（亮描边压在它上面），所以不违反「不许向外长」。
    const na = mapPoint(f, PK.keelX, insC)
    const nax = na.x
    const nay = na.y
    const nb = mapPoint(f, PK.keelX - PK.noseW / 2, insC + PK.noseD)
    const nbx = nb.x
    const nby = nb.y
    const nd = mapPoint(f, PK.keelX + PK.noseW / 2, insC + PK.noseD)
    ctx.beginPath()
    ctx.moveTo(nax, nay)
    ctx.lineTo(nbx, nby)
    ctx.lineTo(nd.x, nd.y)
    ctx.closePath()
    ctx.fillStyle = art.shadow
    ctx.fill()

    // ---- #8 翼尖灯 ×2：一条路径两个圆，一次 fill ----
    // 作用是把翼展两端「钉住」：5 格宽才是一条有端点的翼，不是一块含糊的矩形。
    // 不用红/绿航行灯 —— 那正好占掉语义色的两个位置（红=击毁 / 绿=成功）。
    const lr = Math.max(1.6, C * 0.055) / 2
    ctx.fillStyle = art.light
    ctx.beginPath()
    dotPath(ctx, f, PK.wingX0 + insC + lr / C, 1.5, lr)
    dotPath(ctx, f, PK.wingX1 - insC - lr / C, 1.5, lr)
    ctx.fill()

    // ---- #9 尾喷口 ----
    // 机尾的「句号」：没有它，尾巴读起来像被截断。
    // 棋盘内不画尾焰 —— 那一格格子是「没占」的语义，焰一越界就把空读成有。
    const nz = mapRect(f, PK.keelX - PK.nozzleW / 2, 4 - insC - PK.nozzleH,
      PK.keelX + PK.nozzleW / 2, 4 - insC)
    const nx = nz.x
    const ny = nz.y
    const nw = nz.w
    const nh = nz.h
    draw.fillRect(ctx, nx, ny, nw, nh, art.nozzle, Math.min(nw, nh) * 0.3)
    // 亮缝压在喷口上沿：光从上方来，和面板顶部高光是同一个约定
    const slitY = 4 - insC - PK.nozzleH
    const s1 = mapPoint(f, PK.keelX - PK.nozzleW / 2, slitY)
    const sx1 = s1.x
    const sy1 = s1.y
    const s2 = mapPoint(f, PK.keelX + PK.nozzleW / 2, slitY)
    draw.line(ctx, sx1, sy1, s2.x, s2.y, art.lightDim, 1)
  }

  // ---- #2 外描边·亮 ----
  // 放在最后：压在三角、喷口之上，形成一圈 1px 的清晰亮边。
  // 受损时把色值往 danger 混 —— **只换 strokeStyle，不新增一次描边**（§5.8）。
  // 目标色写死 α 0.52 而不是直接混 theme.color.danger：伤到 45% 时 t=1，
  // 混到 α 1.0 会盖过机头序号。
  const dmg = damageOf(cells, list)
  planeEdge(ctx, f, vis, has)
  ctx.strokeStyle = dmg > 0
    ? draw.mix(art.keyline, 'rgba(255, 90, 90, 0.52)', Math.min(1, dmg * 2.2))
    : art.keyline
  ctx.lineWidth = Math.max(1, C * 0.028)
  ctx.stroke()

  // ---- 非焦点：整架压一层暗色 ----
  // 必须**整架一次**，不能逐格 —— 逐格会在格缝处留下 10 个小方块，
  // 一架连续的飞机被切成 10 块，正是精美化要消灭的那个观感。
  if (dimmed) {
    ctx.beginPath()
    for (let i = 0; i < vis.length; i++) {
      const cl = vis[i]
      const rel = rotateRel(cl.row - f.hr, cl.col - f.hc, 4 - k)
      const r = mapRect(f, rel[1], rel[0], rel[1] + 1, rel[0] + 1)
      // 不用 ctx.rect()：测试桩与部分基础库没有这个方法（见控制清单）
      ctx.moveTo(r.x, r.y)
      ctx.lineTo(r.x + r.w, r.y)
      ctx.lineTo(r.x + r.w, r.y + r.h)
      ctx.lineTo(r.x, r.y + r.h)
      ctx.closePath()
    }
    ctx.fillStyle = theme.color.planeDim
    ctx.fill()
  }
}

/* ================= 雷达扫掠（art 规格 §4 + 附 B） ================= */

/**
 * 扫掠的最低格子尺寸。
 *
 * 11px 的缩略盘上半边长只有 50px，9 段扇面全挤在 100px 见方里 —— 那不是
 * 「隐约可感的光」，是一片灰雾。何况这块盘本来就不该扫：§4.7 规定同时只扫一块，
 * 挂在当前放大的那块盘上。
 */
const SWEEP_MIN_CELL = 22

/**
 * 拖尾的透明度阶梯与每层角宽 —— **值一个都不在这里**，全在 `theme.sweep`：
 * `ahead`（7 位，与 `trail` 同长）+ `seg`（每层 5°）。总跨度 = `arc + trail × seg` = 75°。
 *
 * 为什么以前这里有 7 个数而契约写 8：第 8 层 α=0.001（0.26/255）低于 8bit 量子，
 * 屏幕上永远画不出来 —— 契约比屏幕多一层，于是代码用 `slice(0,7)` 去追。
 * v2.4 把 `trail` 改成 7、`ahead` 删到 7 位，**`slice` 这个胶带也一起删了**：
 * 胶带会把「契约 8 / 代码 7」的差异藏起来，契约对齐之后再留着，
 * 只会在下次有人调 `trail` 时静默截断，而且没人会怀疑一行 `slice`。
 *
 * 不许降到 6 层以下：阶梯头两格 `0.090 − 0.072 = 0.018`（≈4.6/255），
 * 那是相邻两层的台阶 —— 再少一层台阶就变大，能看出切面。
 */

const HP = Math.PI / 2
const QUARTER = Math.PI / 4

const _sp = { x: 0, y: 0 }

/**
 * 射线与棋盘正方形求交：相对棋盘中心、沿角度 a 的边界点
 *
 * 闭式解 `d = half / max(|cos a|, |sin a|)`：轴上是 half、角上是 half·√2。
 * 比逐边 slab 求交少一半分支，而且 a 为负、a 跨 0 都不需要特判。
 *
 * 为什么不用圆：圆弧外沿会在盘面上描出一个内切圆，那条圆会变成一条可见边界，
 * 暗示「角落扫不到」—— 在一个每格都等价可炸的盘上，这是**假信息**，比难看严重。
 */
function edgePoint(half, a) {
  const c = Math.cos(a)
  const s = Math.sin(a)
  const d = half / Math.max(Math.abs(c), Math.abs(s))
  _sp.x = c * d
  _sp.y = s * d
  return _sp
}

/**
 * 「被棋盘正方形截断的扇形」路径
 *
 * 顶点全部落在四条边上：同一条边上的两个顶点之间，直线就是边本身（误差 0）；
 * 跨角时把角点插进来，仍是沿两条边走（误差 0）。**所以弧一次都不用画** ——
 * art 算的「8° 弦高 0.57px」是圆弧近似的误差，这套路径里根本不存在。
 *
 * 角点定位**不能**用附 B 的 `CORNERS[i] > a0 && < a1`（那组常量只在 [0,2π) 里）：
 * a0 可能是负数（右上/左上象限），45° 那个角对应的是 -45°，字面比较会漏掉它，
 * 扇段就会在角上被一条弦削掉半径的 8% —— 肉眼可见。这里按 a0 现算 k 的起点。
 */
function wedgePath(ctx, cx, cy, half, a0, a1) {
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  let p = edgePoint(half, a0)
  ctx.lineTo(cx + p.x, cy + p.y)
  for (let k = Math.ceil((a0 - QUARTER) / HP); ; k++) {
    const ca = QUARTER + k * HP
    if (ca >= a1) break
    if (ca > a0) {
      p = edgePoint(half, ca)
      ctx.lineTo(cx + p.x, cy + p.y)
    }
  }
  p = edgePoint(half, a1)
  ctx.lineTo(cx + p.x, cy + p.y)
  ctx.closePath()
}

/**
 * 雷达扫掠（art §4.5 的 L2 层：底板之上、格线之下）
 *
 * 为什么必须夹在这个位置：
 *   ① **在格线之下**。反过来，扫掠每经过一次就把 20 条格线洗淡一次，
 *      9×9 的边界周期性变模糊 —— 而「数格子」是每回合的高频动作。
 *   ② **在所有内容之下**。于是它物理上不可能盖住机头序号、命中橙点、击毁红叉。
 *      「氛围不许改写事实」在这里不靠调低透明度保证，靠图层保证 ——
 *      §4.8 那条「不碰已炸格」也因此一行特判代码都不用写。
 *
 * 副作用（接受）：被占用的格子遮住扫掠，光在物体背后断掉。读起来是
 * 「光从物体背后扫过去」，不要为了连贯去反向补光 —— 那才会毁掉可读性。
 *
 * @param {Object} sw { t, alpha }：t = 永不复位的全局毫秒时钟；alpha = 0~1 主透明度
 */
function drawSweep(ctx, m, sw) {
  const c = theme.color
  const sweep = theme.sweep        // 运动学在顶层：皮肤改不动它
  const cx = m.x + m.size / 2
  const cy = m.y + m.size / 2
  const half = m.size / 2
  const master = sw.alpha
  const a = (((sw.t / 1000) * sweep.speed) % 360) * Math.PI / 180
  const core = sweep.arc * Math.PI / 180
  const seg = sweep.seg * Math.PI / 180      // 每层拖尾的张角（契约 SWEEP.seg）
  const prevAlpha = ctx.globalAlpha

  ctx.fillStyle = c.sweepColor

  // 核心扇段
  ctx.globalAlpha = prevAlpha * master * sweep.peak
  wedgePath(ctx, cx, cy, half, a - core, a)
  ctx.fill()

  // 拖尾：**并列扇段、互不叠加**，所以圆心不会累积 —— v1 那个「挖内孔防风车」的
  // r₀ 因此可以删掉。相邻扇段共享完全相同的顶点，无缝、无累积、无暗线。
  // 层数与阶梯直接吃契约的 `trail` / `ahead`（同长），本文件不再截断也不再多存一份。
  for (let i = 0; i < sweep.ahead.length; i++) {
    ctx.globalAlpha = prevAlpha * master * sweep.ahead[i]
    const b = a - core - seg * (i + 1)
    wedgePath(ctx, cx, cy, half, b, b + seg)
    ctx.fill()
  }

  ctx.globalAlpha = prevAlpha

  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const dist = half / Math.max(Math.abs(ca), Math.abs(sa))

  // 前沿线：从中心顶到边界点。运动感主要来自它，不是扇面 ——
  // 扇面只有 0.10，静态截图里几乎看不出来，那是故意的（§4.9）。
  //
  // 这里的 α 是**拼出来的**（色在皮肤的 sweepColor，α 在契约的 SWEEP.edge），
  // 不是 rgba 字面量：写死字面量的话，换皮肤时底色变了、α 那半截还留在旧皮肤的色上。
  // 也不把它乘进 globalAlpha —— 那会和 240ms 淡入相乘两次，过渡期暗到看不见。
  ctx.strokeStyle = draw.alpha(c.sweepColor, sweep.edge)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(cx, cy)
  ctx.lineTo(cx + ca * dist, cy + sa * dist)
  ctx.stroke()

  // 束头：垂直半径的短横杠。**必须是横杠不是圆点** —— 圆点会被读成「敌机」。
  // 沿半径内移 tickInset：外沿点正压在棋盘边线上，居中画上去会骑在线上糊成一坨。
  const t = dist - sweep.tickInset
  const tx = cx + ca * t
  const ty = cy + sa * t
  const hl = sweep.tickLen / 2
  ctx.strokeStyle = draw.alpha(c.sweepColor, sweep.head)
  ctx.lineWidth = sweep.tickWidth
  ctx.beginPath()
  ctx.moveTo(tx - sa * hl, ty + ca * hl)
  ctx.lineTo(tx + sa * hl, ty - ca * hl)
  ctx.stroke()
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

  // 雷达扫掠（L2：底板之上、格线之下，见 drawSweep 的注释）
  // alpha 为 0 时整层跳过 —— 0 次绘制调用，不是「画了但看不见」。
  const sw = o.sweep
  if (sw && sw.alpha > 0 && cell >= SWEEP_MIN_CELL) drawSweep(ctx, m, sw)

  // 网格线：**全部塞进一条 path，只 stroke 一次**
  //
  // 原来这个循环里是 20 次 draw.line()，也就是 20 次 beginPath + stroke。
  // 同色、同宽、同线帽，合成一条 path 视觉上完全等价，但双盘一帧差 38 次光栅化
  // —— 这是全仓最便宜的一笔性能（零内存、零风险、零视觉变化）。
  // 做法与 draw.radarGrid() 一致：那里早就这么写了，棋盘这边是漏了。
  ctx.strokeStyle = c.gridLine
  ctx.lineWidth = 1
  ctx.beginPath()
  for (let i = 0; i <= BOARD_SIZE; i++) {
    const off = i * cell
    ctx.moveTo(m.x, m.y + off)
    ctx.lineTo(m.x + m.size, m.y + off)
    ctx.moveTo(m.x + off, m.y)
    ctx.lineTo(m.x + off, m.y + m.size)
  }
  ctx.stroke()

  // 外圈再压一道，棋盘边界更实在
  draw.strokeRect(ctx, m.x, m.y, m.size, m.size, c.boardFrame, 0, 1.5)

  // 双轴刻度（画在底板外圈环带里，不占棋盘尺寸）
  drawAxis(ctx, m, pad)

  const dim = o.dim || {}

  /* ---------------- 飞机（精美化通道） ----------------
   *
   * o.planes 缺省时**完全走下面的逐格老画法**：一条代码路径两种渲染，
   * 新路径坏掉时老路径还在（art §5.10 的「风险归零」）。
   * 缩略盘、图省事的地方不传 planes，就还是老画法。
   *
   * 覆盖率 covered：这些格的本体由这里画，格循环里跳过它们的底色填充 ——
   * 但**不跳**序号、不跳 trimmed / conflict 这些格级叠加（见下面的分支）。
   */
  const covered = {}
  const planes = o.planes
  if (planes && planes.length) {
    for (let i = 0; i < planes.length; i++) {
      const pl = planes[i]
      const f = frameOf(m, pl)
      if (!f) continue
      let dimmed = false
      for (let j = 0; j < pl.cells.length; j++) {
        const cl = pl.cells[j]
        covered[cl.row + ',' + cl.col] = true
        if (dim[cl.row + ',' + cl.col]) dimmed = true
      }
      const prevAlpha = ctx.globalAlpha
      // 不合规（出界 / 重叠）：整架**降不透明度，但不换颜色**。
      // 换成纯红会同时丢掉两层信息 ——「这是第几架」和「这是飞机、不是被打中的格子」。
      if (pl.bad) ctx.globalAlpha = prevAlpha * 0.5
      drawPlane(ctx, f, pl, o.cells, dimmed)
      ctx.globalAlpha = prevAlpha
    }
  }

  // 内部留缝不要太大，否则 10 格飞机会被切成 10 个小方块、看不出是一架飞机
  const inset = Math.max(0.5, cell * 0.03)
  // 空格收集起来最后一次性点完（见 draw.dotGrid 的性能说明）
  const empties = []

  for (let r = 1; r <= BOARD_SIZE; r++) {
    const row = (o.cells && o.cells[r - 1]) || []
    for (let col = 1; col <= BOARD_SIZE; col++) {
      const info = normCell(row[col - 1])
      const x = m.x + (col - 1) * cell
      const y = m.y + (r - 1) * cell
      const cx = x + cell / 2
      const cy = y + cell / 2

      if (!info) {
        empties.push({ x: cx, y: cy })
        continue
      }

      const state = info.s

      if (state === 'plane' || state === 'head') {
        const pal = paletteOf(info.p)
        const isHead = state === 'head'
        // 这一格的本体已经由精美化通道整架画过了 —— 别再叠一层底色，
        // 否则半透明（bad）会被叠两次，颜色比旁边几格深一档。
        const cov = covered[keyOf(r, col)]

        if (!cov) {
          // 小尺寸机头不画浅底盘：11px 的浅色方牌会被读成「空格 / 被选中」，
          // 而它本来要表达的是「机头在这」。同一道闸门，精美化通道与老画法共用。
          const headFill = cell >= HEAD_PLATE_MIN_CELL
            ? (pal ? pal.head : c.planeHead)
            : (pal ? pal.body : c.plane)
          const fill = isHead ? headFill : (pal ? pal.body : c.plane)

          // 不合规（出界 / 重叠）：整架**降不透明度，但不换颜色**。
          //   换成纯红会同时丢掉两层信息 —— 「这是第几架」和「这是飞机、不是被打中的格子」。
          //   保留身份色 + 变虚，两个诉求一次满足。
          const prevAlpha = ctx.globalAlpha
          if (info.bad) ctx.globalAlpha = prevAlpha * 0.5
          draw.fillRect(ctx, x + inset, y + inset, cell - inset * 2, cell - inset * 2, fill, cell * 0.1)
          ctx.globalAlpha = prevAlpha
        }

        if (isHead) {
          // 序号是「第几架」的权威通道，但它有尺寸下限（art §5.6 第 4 条）：
          // cell < 22px 时 0.52C 只有 5~11px，糊成一团既不可读又难看 ——
          // **不是缩小而是换圆点**。
          if (pal && cell >= DETAIL_MIN_CELL) {
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
              // 机头格印序号。字色用**近黑**而不是白：
              // 深色棋盘上机头被提亮成 #9BD2FF 这类浅色，白字压上去几乎看不见；
              // 反过来说，浅底 + 深字才是有对比的那一对。
              draw.text(ctx, String(info.p + 1), cx, cy + cell * 0.02, {
                size: cell * 0.52, weight: 600, color: c.planeHeadInk,
                align: 'center', baseline: 'middle'
              })
            }
          } else {
            // 没有序号可印 —— 两种原因走同一条：
            //   ① 尺寸不够（cell < DETAIL_MIN_CELL，0.52C 只剩 5~11px）；
            //   ② 这一局不带身份色（对战页的对方盘）。
            // 机身色 + 中心暗点就是机头的全部标识：点比数字耐缩，缩到 5px 仍是个点。
            draw.circle(ctx, cx, cy, Math.max(1.2, cell * 0.13), c.primaryInk)
          }
        }

        // 出界：界内可见的那部分加红色描边 —— 表达「这架的边界被棋盘切断了」。
        // 用描边而不是填色：填色会占用「这里有冲突」那个视觉通道。
        // （精美化通道只收「整架都在盘内」的飞机，所以这里走不到 cov 分支）
        if (info.trimmed && !cov) {
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
        // 精美化通道已在整架画完时压过一层，这里不重复
        if (!cov && !info.bad && dim[keyOf(r, col)]) {
          draw.fillRect(ctx, x + inset, y + inset, cell - inset * 2, cell - inset * 2,
            c.planeDim, cell * 0.1)
        }
      } else if (state === 'hit') {
        draw.fillRect(ctx, x + inset, y + inset, cell - inset * 2, cell - inset * 2, c.hitLight, cell * 0.1)
        burst(ctx, cx, cy, cell, c.hit)
      } else if (state === 'kill') {
        draw.fillRect(ctx, x + inset, y + inset, cell - inset * 2, cell - inset * 2, c.danger, cell * 0.1)
        // 白色叉：整格红底 + 一道叉，读作「这架没了」。
        // 原来是一个白点 —— 白点更像「这里有个东西」，而不是「这里结束了」。
        const q = cell * 0.26
        const kw = Math.max(1.6, cell * 0.1)
        draw.line(ctx, x + q, y + q, x + cell - q, y + cell - q, '#FFFFFF', kw)
        draw.line(ctx, x + cell - q, y + q, x + q, y + cell - q, '#FFFFFF', kw)
      } else if (state === 'miss') {
        // 空炸：实心点 + 外环。外环是「这一格已经处理过」的边界 ——
        // 没有它，一个 4px 的圆点在密网格里会被误认成格线交点。
        draw.strokeCircle(ctx, cx, cy, cell * 0.3, c.missRing, 1)
        draw.circle(ctx, cx, cy, cell * 0.155, c.miss)
      }
    }
  }

  // 空格微点：一次 fill 画完 81 格，告诉玩家「这一格是可以点的」。
  // 缩略盘（格子 11px）不画 —— 81 个点挤在 100px 里不是纹理，是一片麻点。
  if (cell >= AXIS_MIN_CELL) {
    draw.dotGrid(ctx, empties, Math.max(0.9, cell * 0.035), c.cellDot)
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

module.exports = {
  layout, render, cellRect, cellAt, metrics, outerRect, normCell,
  BOARD_SIZE, PAD
}
