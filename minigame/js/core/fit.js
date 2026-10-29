// minigame/js/core/fit.js
// 「放不下怎么办」的求解器 —— 纯函数，不依赖任何 wx / canvas，可单独单测
//
// 【为什么需要它】
//   原来非法落位只有一种处理：拒绝 + 弹一句「放不下」+ 弹回原位。
//   玩家实际感受是「拖到边上就卡住，还得松手、重新拖一次」，一次操作变成三次。
//   真正省事的做法不是「事后告知」，而是**事中就给出一个能落的地方**。
//
// 【三条策略，按最小惊讶排序】
//   1. 原位原朝向能放 → 直接放，什么都不提示（合法路径不该有噪音）
//   2. 位置差一点 → 移动到最近的可落位点（最多 maxRadius 格）
//   3. 朝向差一点 → 换一个能放的朝向（转向次数少的优先）
//   4. 都不行 → 才明确拒绝，并说清是「出界」还是「压到别的飞机」
//
// 【为什么拖拽不自动转向、旋转不自动挪位】
//   这是可预测性的来源。玩家拖拽时只表达了「想挪到这儿」，没表达「想转」；
//   自动转向会让人觉得自己摆好的朝向被系统动了。反过来按旋转时，位置是他
//   刚定好的，也不该自己跑。所以两者各自只解锁一半自由度：
//     拖拽  → allowRotate: false
//     旋转  → prefer: 'rotate'（优先原地换向，实在不行才微调位置）
//     放置  → 两者都开（新放一架，玩家还没表达位置偏好，自由度最大）
const { getAbsoluteCells, validatePlacement } = require('../shared/utils/plane')
const { BOARD_SIZE } = require('../shared/config/rules')

/** 失败原因 → 给玩家看的话（不带「失败」二字，只说事实） */
function describeReason(reason) {
  if (reason === 'out_of_board') return '会超出棋盘'
  if (reason === 'overlap') return '会压到别的飞机'
  return '这里放不下'
}

/**
 * 第 d 圈的偏移（切比雪夫距离 = d）
 * d = 0 只返回 (0,0)；d ≥ 1 返回该圈全部偏移，且**正交方向排在斜角之前**——
 * 往正上/正下推一格，比往斜上方推更符合「就近挪一点」的直觉。
 */
function ringOffsets(d) {
  if (d <= 0) return [[0, 0]]
  const out = []
  for (let dr = -d; dr <= d; dr++) {
    for (let dc = -d; dc <= d; dc++) {
      if (Math.max(Math.abs(dr), Math.abs(dc)) !== d) continue
      out.push([dr, dc])
    }
  }
  out.sort(function (a, b) {
    const oa = (a[0] === 0 || a[1] === 0) ? 0 : 1
    const ob = (b[0] === 0 || b[1] === 0) ? 0 : 1
    if (oa !== ob) return oa - ob
    return (a[0] * a[0] + a[1] * a[1]) - (b[0] * b[0] + b[1] * b[1])
  })
  return out
}

/**
 * 在期望落位附近找一个真正能落的位置
 *
 * @param {Object} opt
 * @param {string} opt.planeId     机型
 * @param {number} opt.anchorRow   期望的机头行
 * @param {number} opt.anchorCol   期望的机头列
 * @param {number} opt.rotation    期望朝向 0~3
 * @param {Array}  opt.occupied    其它飞机占用的格位 [{row, col}]
 * @param {boolean} [opt.allowMove=true]   允许自动挪位置
 * @param {boolean} [opt.allowRotate=false] 允许自动换朝向
 * @param {number} [opt.maxRadius=2]       最多挪几格（超过就认栽，别让飞机莫名跳远）
 * @param {'move'|'rotate'} [opt.prefer='move']
 *        'move'   → 同朝向优先、位置优先（拖拽 / 放置）
 *        'rotate' → 换朝向优先、优先原地不动（旋转按钮）
 *
 * @returns {null|{anchorRow:number, anchorCol:number, rotation:number,
 *                 cells:Array, dist:number, moved:boolean, turned:boolean}}
 *          null = 附近确实没有能落的地方
 */
function findFit(opt) {
  const planeId = opt.planeId || 'standard'
  const occupied = opt.occupied || []
  const maxR = opt.maxRadius == null ? 2 : opt.maxRadius
  const rot = ((opt.rotation || 0) % 4 + 4) % 4
  const rotateFirst = opt.prefer === 'rotate'

  const radii = [0]
  if (opt.allowMove !== false) {
    for (let d = 1; d <= maxR; d++) radii.push(d)
  }

  // 候选朝向列表
  //
  // 'move'  ：原朝向排第一 —— 能不改朝向就不改（保持玩家的布置意图）
  // 'rotate'：**排除原朝向** —— 玩家已经按了「旋转」，就是明确要转向。
  //           若把原朝向留在候选里，就一定会先在半径 2 处找到「不转」的位置，
  //           表现为「按了旋转，结果只是挪了个位置」，这是最容易让人恼火的静默失败。
  const rots = []
  if (opt.allowRotate) {
    for (let k = 1; k <= 3; k++) rots.push((rot + k) % 4)
    if (!rotateFirst) rots.unshift(rot)
  } else {
    rots.push(rot)
  }

  // 'rotate'：先把所有距离上的转向方案试完（外层距离，内层朝向）
  // 'move'  ：先把同朝向的附近位置试完（外层朝向，内层距离）
  const outer = rotateFirst ? radii : rots
  const inner = rotateFirst ? rots : radii

  for (let i = 0; i < outer.length; i++) {
    for (let j = 0; j < inner.length; j++) {
      const d = rotateFirst ? outer[i] : inner[j]
      const r = rotateFirst ? inner[j] : outer[i]
      const offs = ringOffsets(d)
      for (let k = 0; k < offs.length; k++) {
        const row = opt.anchorRow + offs[k][0]
        const col = opt.anchorCol + offs[k][1]
        // 机头本身得在棋盘内，否则连「锚点」都不成立
        if (row < 1 || row > BOARD_SIZE || col < 1 || col > BOARD_SIZE) continue
        const cells = getAbsoluteCells(planeId, row, col, r)
        if (validatePlacement(cells, occupied).ok) {
          return {
            anchorRow: row,
            anchorCol: col,
            rotation: r,
            cells: cells,
            dist: d,
            moved: d > 0,
            turned: r !== rot
          }
        }
      }
    }
  }
  return null
}

/**
 * 只判一次合不合法，并把原因带出来
 * @returns {null|'out_of_board'|'overlap'} null = 合法
 */
function checkAt(planeId, row, col, rotation, occupied) {
  const cells = getAbsoluteCells(planeId, row, col, rotation)
  const res = validatePlacement(cells, occupied || [])
  return res.ok ? null : res.reason
}

/**
 * 给定一组已放置的飞机，拼出「除某一架之外」的占用格位
 * @param {Array} placed  [{cells}]
 * @param {number} skipIdx 要排除的下标（-1 = 全都算进来）
 */
function occupiedExcept(placed, skipIdx) {
  const out = []
  ;(placed || []).forEach(function (p, i) {
    if (i === skipIdx) return
    // 只有 state === 'out' 的飞机在场上。未加入（none）/ 收起（off）都不占位。
    // 兼容旧的 off 布尔字段：老调用点仍可能传 { cells, off }。
    if (p.state ? p.state !== 'out' : p.off) return
    for (let k = 0; k < p.cells.length; k++) out.push(p.cells[k])
  })
  return out
}

module.exports = { findFit, checkAt, occupiedExcept, describeReason, ringOffsets }
