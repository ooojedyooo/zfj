// scripts/render-scenes.js
// 把界面渲染成 SVG —— 视觉自查与效果预览
//
// 为什么要这个：界面全是 Canvas 手绘，改完配色没有任何办法「看一眼」。
// 只能靠想象，或者让人打开开发者工具截图，一轮反馈要几分钟。
// 这里用 scripts/lib/svg-ctx.js 把 Canvas 调用翻译成 SVG，
// 场景代码一行不改就能出图。
//
// 运行：node scripts/render-scenes.js
//       node scripts/render-scenes.js 390 844   ← 换个屏幕尺寸看
// 输出：outputs/ui-preview/*.svg + *.png

const fs = require('fs')
const path = require('path')

const { SvgCtx } = require('./lib/svg-ctx')
const stub = require('./lib/wx-stub')
const installWx = stub.installWx

// 允许命令行覆盖屏宽/屏高：小屏 320×568、主屏 375×667、大屏 390×844 都得看一眼
const ARG_W = parseInt(process.argv[2], 10)
const ARG_H = parseInt(process.argv[3], 10)
const INFO = stub.INFO
if (ARG_W > 0 && ARG_H > 0) {
  INFO.windowWidth = ARG_W
  INFO.windowHeight = ARG_H
  // 全面屏：顶部状态栏 44、底部 Home 条 34。
  // 不模拟安全区的话，看 390×844 会以为「底部留白刚刚好」，真机上被 Home 条压住。
  const inset = ARG_H >= 800
  INFO.statusBarHeight = inset ? 44 : 20
  INFO.safeArea = inset
    ? { top: 44, bottom: ARG_H - 34 }
    : { top: 20, bottom: ARG_H }
}

const W = INFO.windowWidth
const H = INFO.windowHeight
const SUFFIX = (ARG_W > 0 && ARG_H > 0) ? '-' + W + 'x' + H : ''

/* ---------------- 固定随机源 ----------------
 *
 * 布阵页的初始阵型来自 randomDeploy()，不固定的话**每次出图都不一样** ——
 * 于是「改完前后各截一张对比」这件事根本做不了：两张图的差别里混着阵型的差别。
 * 视觉 A/B 少一个可复现的基线，就等于每轮都在重新猜。
 *
 * 这里用一个最普通的 LCG 顶掉 Math.random（只在这个出图脚本里，
 * 场景代码一行不改）。要换阵型就改 SEED，不要删。
 */
const SEED = parseInt(process.env.PREVIEW_SEED, 10) || 20261113
let _seed = SEED >>> 0
Math.random = function () {
  _seed = (_seed * 1664525 + 1013904223) >>> 0
  return _seed / 4294967296
}

/* ---------------- 装桩 ---------------- */

const boot = new SvgCtx(W, H)
installWx(boot)

const { createApp } = require('../minigame/js/core/app')
const offline = require('../minigame/js/shared/services/offlineGame')
const theme = require('../minigame/js/core/theme')
const { rotateRel } = require('../minigame/js/shared/utils/plane')

const app = createApp({
  canvas: { width: W, height: H },
  ctx: boot,
  info: INFO,
  scenes: {
    lobby: require('../minigame/js/scenes/lobby'),
    rooms: require('../minigame/js/scenes/rooms'),
    room: require('../minigame/js/scenes/room'),
    deploy: require('../minigame/js/scenes/deploy'),
    battle: require('../minigame/js/scenes/battle'),
    result: require('../minigame/js/scenes/result'),
    'ai-tune': require('../minigame/js/scenes/ai-tune')
  }
})

app.globalData.playerId = 'p_preview'
app.globalData.cloudReady = false

/* ---------------- 工具 ---------------- */

const sleep = function (ms) {
  return new Promise(function (r) { setTimeout(r, ms) })
}

/** 用一个全新的 SVG 上下文渲染当前场景，返回 SVG 文本 */
function capture() {
  const ctx = new SvgCtx(W, H)
  app.ctx = ctx          // frame() 读 this.ctx，可以换
  app.renderOnce()
  return ctx.toSvg()
}

const outDir = path.join(__dirname, '..', 'outputs', 'ui-preview')

function save(name, svg) {
  fs.mkdirSync(outDir, { recursive: true })
  const file = path.join(outDir, name + SUFFIX + '.svg')
  fs.writeFileSync(file, svg)
  console.log('  ' + path.basename(file) + '  (' + Math.round(svg.length / 1024) + ' KB)')
  return file
}

/**
 * 裁一块、矢量放大 S 倍写出。
 *
 * 干什么用：把「扫掠外沿是不是压在格线上」这问题交给读者自己看，
 * 而不是让他眯着眼在一张 390px 的 PNG 上量。SVG 只改 viewBox，
 * 内容是矢量，放大 4 倍就是 4 倍的分辨率 —— 不是插值出来的马赛克。
 */
function saveCrop(name, svg, vx, vy, vw, vh, scale) {
  fs.mkdirSync(outDir, { recursive: true })
  const out = svg.replace(
    /viewBox="0 0 [\d.]+ [\d.]+" width="[\d.]+" height="[\d.]+"/,
    'viewBox="' + vx + ' ' + vy + ' ' + vw + ' ' + vh + '" width="' +
      Math.round(vw * scale) + '" height="' + Math.round(vh * scale) + '"'
  )
  const file = path.join(outDir, name + SUFFIX + '.svg')
  fs.writeFileSync(file, out)
  const png = svgToPng(file, { w: Math.round(vw * scale), h: Math.round(vh * scale) })
  console.log('  ' + path.basename(file) + '  (×' + scale + ' 裁切 ' +
    Math.round(vw) + '×' + Math.round(vh) + (png ? '，含 PNG' : '') + ')')
  return file
}

/* ---------------- 扫掠三问的现场读数 ----------------
 *
 * 为什么量**交付的那张 SVG**，而不是量渲染参数：
 *   扫掠的每个顶点都是 wedgePath 现场算出来的。参数全对、公式写错，照样能出图，
 *   而且错的样子（外沿被当成圆、角上被一条弦削掉）只有看图才认得出来。
 *   所以在 SVG 里把「用扫掠色的 path」全抓出来求包围盒，跟格区比 ——
 *   这一步和 team-lead 肉眼看图是同一个对象，结论才对得上。
 */

/** 扫掠的两种墨色：扇面 fill 是 #BFF3FF，前沿线/束头是 rgba(191, 243, 255, a) */
const SWEEP_INK = /(191,\s*243,\s*255|#BFF3FF)/

/**
 * 扫掠墨迹的包围盒，外加「离盘心最远的那个点」。
 *
 * 后者才是裁图该对准的地方：扇面的顶点就在盘心，所以 bbox 的左上两条边
 * 永远贴着中心 —— 拿 bbox 的角去裁，裁到的是一小片 α=0.01 的拖尾，什么都看不见。
 * 最远点 = 前沿线顶到格线上的那一端，那是「有没有出去」唯一有信息量的位置。
 */
function sweepInkBox(svg, cx, cy) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  let paths = 0
  let far = null
  let farCore = null
  const tags = svg.match(/<path[^>]*\/>/g) || []
  tags.forEach(function (tag) {
    if (!SWEEP_INK.test(tag)) return
    const d = (/ d="([^"]*)"/.exec(tag) || [])[1]
    if (!d) return
    const isCore = paths === 0      // 第一个用扫掠色的 path 就是核心扇段（绘制顺序）
    paths++
    const nums = d.match(/-?\d+(?:\.\d+)?/g) || []
    // 扫掠的路径只有 M/L，数字两两成对；A 命令不在这里出现，不用管参数奇偶
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const px = parseFloat(nums[i])
      const py = parseFloat(nums[i + 1])
      if (px < x0) x0 = px
      if (px > x1) x1 = px
      if (py < y0) y0 = py
      if (py > y1) y1 = py
      if (cx != null) {
        const dd = Math.hypot(px - cx, py - cy)
        if (!far || dd > far.d) far = { x: px, y: py, d: dd }
        if (isCore && (!farCore || dd > farCore.d)) farCore = { x: px, y: py, d: dd }
      }
    }
  })
  return paths
    ? { x0: x0, y0: y0, x1: x1, y1: y1, paths: paths, far: far, farCore: farCore }
    : null
}

/**
 * 机翼两端。局部 y == 1 那一行就是翼（标准机 5 格），逆变换与 board.js 同源。
 *
 * **翼展轴随朝向变**：机头朝上/下时翼横跨几列，朝左/右时翼纵跨几行。
 * 所以对称轴是「机头格中心」在**翼展方向**上的那条中线 —— 写成固定的左右比较，
 * 竖着放的飞机会立刻报一条假警（第一版就是这么错的）。
 */
function wingEnds(bs, board) {
  const cell = board.size / 9
  const ins = Math.max(0.5, cell * 0.03)
  const out = []
  const planes = bs.myPlanes ? bs.myPlanes() : []
  planes.forEach(function (pl, i) {
    const head = pl.cells.filter(function (c) { return c.isHead })[0]
    if (!head) return
    const k = ((pl.rotation || 0) % 4 + 4) % 4
    const axis = (k % 2 === 0) ? 'x' : 'y'   // 翼展垂直于机头朝向
    let lo = Infinity
    let hi = -Infinity
    let a0 = Infinity
    let a1 = -Infinity
    pl.cells.forEach(function (c) {
      const rel = rotateRel(c.row - head.row, c.col - head.col, 4 - k)
      if (rel[0] !== 1) return                 // rel[0] 是局部 y，rel[1] 才是局部 x
      const v = axis === 'x' ? c.col : c.row
      const w = axis === 'x' ? c.row : c.col
      if (v < lo) lo = v
      if (v > hi) hi = v
      if (w < a0) a0 = w
      if (w > a1) a1 = w
    })
    if (!isFinite(lo)) return
    const origin = axis === 'x' ? board.x : board.y
    const centre = axis === 'x'
      ? board.x + (head.col - 0.5) * cell
      : board.y + (head.row - 0.5) * cell
    const loEdge = origin + (lo - 1) * cell     // 最外格的近端格沿
    const hiEdge = origin + hi * cell           // 最外格的远端格沿
    out.push({
      plane: i,
      rot: k,
      axis: axis,
      span: lo + '..' + hi,
      other: a0 + '..' + a1,
      gridLo: loEdge,
      gridHi: hiEdge,
      paintLo: loEdge + ins,
      paintHi: hiEdge - ins,
      // 对称性比「到中线的距离」，避免两个大数相减丢精度
      dLo: centre - (loEdge + ins),
      dHi: (hiEdge - ins) - centre,
      half: 2.5 * cell - ins,
      ins: ins
    })
  })
  return out
}

function r2(v) { return Math.round(v * 100) / 100 }

/**
 * 三问逐条核，不合就抛 —— 出图脚本里的断言比文档可靠，
 * 因为它是每次出图都跑一遍的那一份。
 */
function auditBattle(bs, svg, tag) {
  // 扫掠只挂在「当前放大的那块盘」上；飞机只在我方盘上（敌盘永不出现飞机形状）
  const board = bs.focus === 'mine' ? bs.geo.mineBoard : bs.geo.foeBoard
  const mine = bs.geo.mineBoard
  const cell = mine.size / 9
  const bx = board.x
  const by = board.y
  const b1 = bx + board.size
  const b2 = by + board.size
  const line = '  [' + tag + ']'

  // ① 扫掠有没有溢出格区
  const box = sweepInkBox(svg, bx + board.size / 2, by + board.size / 2)
  if (!box) {
    // 没有扫掠不算错（我方回合本来就没有），等待态「必须有」交给下面的焦点断言管
    console.log(line + ' ① 扫掠：本态没有（alpha=0 整层跳过）')
  } else {
    const out = Math.max(0, bx - box.x0, box.x1 - b1, by - box.y0, box.y1 - b2)
    console.log(line + ' ① 扫掠墨迹 x∈[' + r2(box.x0) + ',' + r2(box.x1) + '] y∈[' +
      r2(box.y0) + ',' + r2(box.y1) + ']，' + box.paths + ' 条路径')
    console.log(line + '   格区 x∈[' + r2(bx) + ',' + r2(b1) + '] y∈[' + r2(by) + ',' + r2(b2) +
      ']，四边最外坐标距格线 左' + r2(box.x0 - bx) + ' 右' + r2(b1 - box.x1) +
      ' 上' + r2(box.y0 - by) + ' 下' + r2(b2 - box.y1) +
      '（左/上是扇面顶点本身在盘心，那一侧本来就到不了）')
    console.log(line + '   最远顶点 (' + r2(box.far.x) + ',' + r2(box.far.y) + ') 距盘心 ' +
      r2(box.far.d) + '，正方形对角的极限 ' + r2(board.size / 2 * Math.SQRT2))
    if (out > 0.01) throw new Error(tag + ' 扫掠有顶点越出格区 ' + r2(out) + 'px')
    console.log(line + '   → 顶点一个都没出去。全仓未设 lineCap（默认 butt）→ 端点即端点，' +
      '几何零溢出就是墨零溢出；格框 1.5px 正压格线、向外 0.75px，是双保险不是补丁')
  }

  // ② 翼端落点（永远量我方盘：飞机只在那里）
  const wings = wingEnds(bs, mine)
  if (!wings.length) {
    console.log(line + ' ② 翼端：这局我方盘上没有飞机')
  } else {
    let sym = 0
    wings.forEach(function (w) {
      console.log(line + ' ② 翼#' + (w.plane + 1) + ' rot' + w.rot +
        '（翼展沿 ' + w.axis + '，占 ' + w.axis + w.span + ' / 另一轴 ' + w.other + '）' +
        '｜格沿 ' + r2(w.gridLo) + '..' + r2(w.gridHi) +
        '｜涂层 ' + r2(w.paintLo) + '..' + r2(w.paintHi) +
        '｜到机头中线 ' + r2(w.dLo) + ' / ' + r2(w.dHi))
      const lo = w.axis === 'x' ? mine.x : mine.y
      const hi = lo + mine.size
      if (w.paintLo < lo - 0.01 || w.paintHi > hi + 0.01) {
        throw new Error(tag + ' 翼#' + (w.plane + 1) + ' 出了我方格区：' +
          r2(w.paintLo) + '..' + r2(w.paintHi) + ' 越出 ' + r2(lo) + '..' + r2(hi))
      }
      if (Math.abs(w.dLo - w.dHi) > 0.01) {
        throw new Error(tag + ' 翼#' + (w.plane + 1) + ' 左右不对称：' +
          r2(w.dLo) + ' vs ' + r2(w.dHi) + '（翼绕机头中线对称）')
      }
      if (Math.abs(w.dLo - w.half) > 0.01) {
        throw new Error(tag + ' 翼#' + (w.plane + 1) + ' 不是 5 格宽：半翼展 ' +
          r2(w.dLo) + '，期望 ' + r2(w.half) + '（2.5 格 − 内缩 ' + r2(w.ins) + '）')
      }
      sym = Math.max(sym, Math.abs(w.dLo - w.dHi))
    })
    console.log(line + '   → 5 格整宽，两侧各内缩 ' + r2(wings[0].ins) +
      'px（逐格老规矩，不是越界），左右对称误差 ' + r2(sym) + 'px')
  }

  // ③ 焦点盘 + 状态自洽
  //
  // 后半句比前半句重要：几何错了肉眼看得出，**文案和几何对不上则看不出** ——
  // 图上一行「等待对方行动…」配一块放大的我方盘是自洽的，
  // 但要是文案还停在「轮到你开炮」，读图的人会先愣一下，然后开始怀疑整张图。
  // 出图脚本的全部价值就是「拿它当证据」，证据里混进一个真机不可能出现的状态，
  // 比没有证据更坏。
  const g = bs.geo
  const mineBig = g.mineBoard.size > g.foeBoard.size + 0.5
  const foeBig = g.foeBoard.size > g.mineBoard.size + 0.5
  const waiting = !bs.myTurn && !bs.finished
  console.log(line + ' ③ 焦点：' + bs.focus +
    '｜我方 ' + r2(g.mineBoard.size) + 'px@y' + r2(g.mineBoard.y) +
    '｜敌方 ' + r2(g.foeBoard.size) + 'px@y' + r2(g.foeBoard.y) +
    '｜myTurn=' + bs.myTurn + ' finished=' + bs.finished +
    ' sweepAlpha=' + r2(bs.sweepAlpha))
  console.log(line + '   状态条「' + bs.statusText + '」' +
    (waiting ? '（等待态必须配：focus=mine + 我方放大 + 扫掠已淡入）'
      : '（我方回合必须配：focus=foe + 敌方放大 + 扫掠已淡出）'))
  if (bs.myTurn && !bs.finished && !foeBig) throw new Error(tag + ' 轮到我方却没放大敌方海域')
  if (waiting && !mineBig) throw new Error(tag + ' 等待态却没放大我方海域')

  // 焦点/文案/扫掠三者必须同向。三条一起卡，是因为它们由三个地方各自写：
  // focus 在 applyBattle、statusText 在 statusLabel、alpha 在 update —
  // 漏改一处，图就变成一个真机上不可能出现的状态，而它看起来还挺正常。
  //
  // 先单独卡一句「取得到吗」：`if (bs.statusText && ...)` 这种写法在字段丢了的时候
  // 会静默跳过整条断言 —— 等于这条断言不存在，而它正是差点骗过人的那一条。
  if (typeof bs.statusText !== 'string' || !bs.statusText) {
    throw new Error(tag + ' 取不到 statusText（' + String(bs.statusText) +
      '）—— 状态自洽这条断言不许静默跳过')
  }
  if (waiting) {
    if (bs.focus !== 'mine') throw new Error(tag + ' 等待态 focus=' + bs.focus + '，期望 mine')
    if (bs.statusText.indexOf('等待') !== 0) {
      throw new Error(tag + ' 状态条写着「' + bs.statusText + '」，期望以「等待」开头')
    }
    if (!(bs.sweepAlpha > 0.99)) {
      throw new Error(tag + ' 等待态扫掠 masterAlpha=' + r2(bs.sweepAlpha) + '，期望已淡入到 1')
    }
  } else if (!bs.finished) {
    if (bs.focus !== 'foe') throw new Error(tag + ' 我方回合 focus=' + bs.focus + '，期望 foe')
    // 本示例 myStreak 恒为 0，所以是**整句相等**；真机上连续超时会带
    // 「· 连续超时 n/5」后缀，那种情况退回前缀比较（否则断言会因为后缀而假红）。
    const want = '轮到你开炮'
    const okText = bs.myStreak > 0
      ? bs.statusText.indexOf(want) === 0
      : bs.statusText === want
    if (!okText) {
      throw new Error(tag + ' 状态条写着「' + bs.statusText + '」，期望' +
        (bs.myStreak > 0 ? '以「' : '是「') + want + '」')
    }
    if (bs.sweepAlpha !== 0) {
      throw new Error(tag + ' 我方回合扫掠 masterAlpha=' + r2(bs.sweepAlpha) + '，期望 0')
    }
  }
}

/* ---------------- SVG → PNG ---------------- */
//
// 为什么不自己画：node-canvas 要编译原生依赖，Windows 上十次九次装不上。
// 浏览器本来就是个 SVG 渲染器，直接用系统里的 Edge 无头截图。
// 两个必须踩过的坑：
//   ① --screenshot 只认真实存在的 Windows 绝对路径（带盘符、反斜杠），
//      传相对路径会得到一句「拒绝访问」，且不生成文件；
//   ② SVG 里的字体走系统回退，截图和真机不一定完全一致 ——
//      这里看的是**布局与色彩关系**，字形细节以真机为准。

const EDGE_PATHS = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome'
]

function findBrowser() {
  for (let i = 0; i < EDGE_PATHS.length; i++) {
    if (fs.existsSync(EDGE_PATHS[i])) return EDGE_PATHS[i]
  }
  return null
}

function svgToPng(svgFile, size) {
  const browser = findBrowser()
  if (!browser) return null
  const png = svgFile.replace(/\.svg$/, '.png')
  try {
    require('child_process').execFileSync(browser, [
      '--headless', '--disable-gpu', '--hide-scrollbars',
      '--default-background-color=00000000',
      '--window-size=' + size.w + ',' + size.h,
      '--screenshot=' + png,
      'file:///' + svgFile.replace(/\\/g, '/')
    ], { stdio: 'ignore', timeout: 30000 })
    return fs.existsSync(png) ? png : null
  } catch (e) {
    return null
  }
}

/* ---------------- 各页截图 ---------------- */

async function main() {
  const files = []

  console.log('渲染界面预览…')

  // ① 大厅
  app.reset('lobby')
  await sleep(20)
  files.push(save('1-lobby', capture()))

  // ② 房间列表（公开）
  app.go('rooms', { mode: 'public' })
  await sleep(60)
  files.push(save('2-rooms', capture()))

  // ③ 创建房间
  app.replace('room', { mode: 'create' })
  await sleep(20)
  files.push(save('3-room-create', capture()))

  // ③b 离线 AI 调参（测试期用；只影响单机对手）
  const aiTune = require('../minigame/js/shared/services/aiTune')
  aiTune.reset()
  app.replace('ai-tune')
  await sleep(20)
  files.push(save('3b-ai-tune', capture()))

  // ④ 布阵：走离线引擎建一间 2 架房，房主直接进布阵
  offline.setDelays({ opponentJoin: 20, matchJoin: 20, ready: 20, foeAction: 60000 })
  offline._reset()
  const room = await offline.createRoom({ planeCount: 2, stepSeconds: 20 })
  app.globalData.match = {
    roomId: room.roomId || room.roomNo,
    roomNo: room.roomNo,
    planeCount: 2,
    stepSeconds: 20
  }
  app.reset('deploy')
  await sleep(80)
  files.push(save('4-deploy', capture()))

  // ⑤ 对战：布阵提交后进入
  // 布阵数据从场景自己的 placed 里取 —— offline._getGame() 在提交之前是 null
  const deployScene = app.get('deploy')
  const planes = deployScene.placed
    .filter(function (p) { return p.state === 'out' })
    .map(function (p) {
      return {
        planeId: p.planeId, anchorRow: p.anchorRow, anchorCol: p.anchorCol, rotation: p.rotation
      }
    })

  if (planes.length) {
    await offline.deploy({ planes }).catch(function (e) {
      console.warn('  (布阵提交失败，跳过对战页：' + (e && e.message) + ')')
    })
    app.reset('battle')
    await sleep(150)
    const bt = app.get('battle')
    const svgTurn = capture()
    auditBattle(bt, svgTurn, '我方回合')
    files.push(save('5-battle', svgTurn))

    // ⑤b 等待态（对方回合）：雷达扫掠只在这一态出现（art §4.7）。
    //
    // **不手改 focus / myTurn**。手改验的是「我把 focus 设成 mine 之后画得对不对」，
    // 那一版永远绿；真正要验的是「界面自己走到等待态时，会不会把焦点切回我方、
    // 把扫掠打开」。所以在离线引擎里把这一回合判给对手，再让场景走正常的
    // onEnter → sync → applyBattle，焦点、排版、扫掠开关全部由产品代码决定。
    const g = offline._getGame && offline._getGame()
    if (g && !g.finished) {
      // 战报流水要用真实引擎的三炮，不手改 marks —— 否则出图验的是「我塞进去的三条」，
      // 而不是「界面会不会把自己打出的炮排出来」。三种结果各来一发，顺便在图上验语义色。
      const foeCells = []
      ;(g.foeDeployed || []).forEach(function (p) {
        (p.cells || []).forEach(function (c) { foeCells.push(c) })
      })
      const head = foeCells.filter(function (c) { return c.isHead })[0]
      const body = foeCells.filter(function (c) { return !c.isHead })[0]
      let miss = null
      for (let r = 1; r <= 9 && !miss; r++) {
        for (let col = 1; col <= 9 && !miss; col++) {
          if (!foeCells.some(function (c) { return c.row === r && c.col === col })) miss = { row: r, col: col }
        }
      }
      const samples = [head, body, miss].filter(Boolean).map(function (c) { return [c.row, c.col] })
      for (let i = 0; i < samples.length && !g.finished; i++) {
        g.myTurn = true
        const out = await offline.fire({ row: samples[i][0], col: samples[i][1] })
        console.log('  战报样本 ' + (i + 1) + '：横' + samples[i][1] + '竖' + samples[i][0] + ' ' + out.result)
      }
      g.myTurn = false
      g.turnDeadline = Date.now() + 20000
      app.reset('battle')
      await sleep(150)
      const bs = app.get('battle')
      // 走真实的 240ms 淡入：renderOnce 每帧 dt=16，15 帧收敛，跑 30 帧留余量。
      // 直接塞 alpha=1 会跳过「过渡在跑」这半个验证。
      for (let i = 0; i < 30; i++) app.renderOnce()
      const svg = capture()
      auditBattle(bs, svg, '等待态')
      files.push(save('5b-battle-waiting', svg))

      // ④ 溢出这一问的**视觉证据**：把「核心扇段顶到格线上的那一端」×4 裁出来。
      // 不裁棋盘角：扇面顶点在盘心，bbox 的两条边永远贴着中心；而四个盘角上
      // 只有 α=0.02 的最外层拖尾（两版都试过，裁出来是一片黑）。
      // 核心的远端 = 前沿线落点 = 全场最亮、也最容易被误认为「出去了」的那一个点。
      const mb = bs.geo.mineBoard
      const box = sweepInkBox(svg, mb.x + mb.size / 2, mb.y + mb.size / 2)
      if (box && box.farCore) {
        const half = 75
        saveCrop('lab-sweep-edge-4x', svg,
          box.farCore.x - half, box.farCore.y - half, half * 2, half * 2, 4)
      }
    }
  }

  console.log('\n转 PNG…')
  const pngs = []
  files.forEach(function (f) {
    const p = svgToPng(f, { w: W, h: H })
    if (p) pngs.push(p)
  })
  console.log(pngs.length
    ? '  ' + pngs.length + ' 张 PNG 已生成'
    : '  (没找到 Edge/Chrome，跳过 PNG，直接看 SVG 也行)')

  console.log('\n共 ' + files.length + ' 张，输出目录：' + outDir)
  console.log(files.join('\n'))
}

main().catch(function (e) {
  console.error('渲染失败：', e && e.stack || e)
  process.exit(1)
}).then(function () {
  process.exit(0)
})
