// scripts/lab-plane.js
// 飞机底色 / 细节 / 色板的验收出图台
//
// 为什么要有这个脚本：飞机是**纯程序化绘制**的，改完没有任何办法「看一眼」。
// 而验收判据（去细节点还读得出是飞机 / 遮住序号看朝向 / 30px 噪点 / 灰度可分）
// 都必须对着同一批图反复看 —— 没有固定机位，就每轮都在重新猜。
//
// 运行：node scripts/lab-plane.js            出全部面板
//       node scripts/lab-plane.js -before    出改动前基线（A/B 用）
//       LAB_NODETAIL=1 node scripts/lab-plane.js   只出去细节版
// 输出：outputs/ui-preview/lab-*.svg + *.png
const fs = require('fs')
const path = require('path')
const { SvgCtx } = require('./lib/svg-ctx')
const theme = require('../minigame/js/core/theme')
const { getAbsoluteCells } = require('../minigame/js/shared/utils/plane')

const OUT = path.join(__dirname, '..', 'outputs', 'ui-preview')
const SUF = process.argv[2] || ''

/* ---------------- 出图 ---------------- */

const EDGE = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
]

function shot(name, W, H, paint) {
  const ctx = new SvgCtx(W, H)
  ctx.fillStyle = theme.color.bg
  ctx.fillRect(0, 0, W, H)
  paint(ctx)
  const svg = path.join(OUT, name + SUF + '.svg')
  fs.writeFileSync(svg, ctx.toSvg())
  let b = null
  for (let i = 0; i < EDGE.length; i++) if (fs.existsSync(EDGE[i])) b = EDGE[i]
  if (b) {
    require('child_process').execFileSync(b, [
      '--headless', '--disable-gpu', '--hide-scrollbars',
      '--default-background-color=00000000',
      '--window-size=' + W + ',' + H,
      '--screenshot=' + svg.replace(/\.svg$/, '.png'),
      'file:///' + svg.replace(/\\/g, '/')
    ], { stdio: 'ignore', timeout: 30000 })
  }
  return svg
}

/** 一架飞机铺满一张盘（阵型固定：机头 5,5，正反两个朝向） */
function panel(name, C, M, p, rot, Board) {
  const size = C * 9
  const cells = []
  for (let r = 0; r < 9; r++) { const a = []; for (let c = 0; c < 9; c++) a.push(''); cells.push(a) }
  const abs = getAbsoluteCells('standard', 5, 5, rot)
  abs.forEach(function (cl) {
    cells[cl.row - 1][cl.col - 1] = { s: cl.isHead ? 'head' : 'plane', p: p }
  })
  const o = { x: M, y: M, size: size, cells: cells, planes: [{ p: p, rotation: rot, cells: abs }] }
  const W = size + M * 2
  shot(name, W, W, function (ctx) { Board.render(ctx, o, function (v) { return v }) })
}

/**
 * 「无细节」版需要一个把 DETAIL_MIN_CELL 抬到天上的 board 模块。
 *
 * 常量是模块级的、没有对外开关（**不加开关是对的**：那是验收用的假状态，
 * 不该出现在产品代码的 API 里）。所以这里读源码改一个常量、写成同级临时文件
 * 再 require —— 同级是为了让 `../core/theme` 这些相对路径照常解析。
 * require 完立刻删文件：留着会被下一次 require 命中缓存，也容易被误提交。
 */
function boardNoDetail() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'minigame/js/widgets/board.js'), 'utf8')
  const key = 'const DETAIL_MIN_CELL = 22'
  if (src.indexOf(key) < 0) throw new Error('board.js 里找不到 ' + key + '，这个脚本要跟着改')
  const tmp = path.join(__dirname, '..', 'minigame/js/widgets/.board-nodetail.js')
  fs.writeFileSync(tmp, src.replace(key, 'const DETAIL_MIN_CELL = 9999'))
  try {
    return require(tmp)
  } finally {
    fs.unlinkSync(tmp)
  }
}

/* ---------------- 面板 ---------------- */

if (process.env.LAB_NODETAIL) {
  // 去细节：只留轮廓 + 底色。验「判据 ①：去掉细节还读得出是飞机吗」
  const nd = boardNoDetail()
  panel('lab-plane-56-nodetail', 56, 58, 0, 0, nd)
  panel('lab-plane-30-nodetail', 30, 45, 1, 0, nd)
  // 11px 本来就过不了细节闸门：这张应当与 lab-plane-11.png **逐字节相同**。
  // 相同就说明「缩略盘」与「无细节」是同一个状态，两条通道只需要验一条。
  panel('lab-plane-11-nodetail', 11, 22, 0, 0, nd)
  console.log('ok-nodetail' + SUF)
  process.exit(0)
}

const Board = require('../minigame/js/widgets/board')
panel('lab-one-0', 90, 55, 1, 0, Board)      // 整架特写，机头朝上
panel('lab-one-1', 90, 55, 0, 1, Board)      // 整架特写，机头朝右
panel('lab-plane-56', 56, 58, 0, 0, Board)
panel('lab-plane-30', 30, 45, 1, 0, Board)
panel('lab-plane-11', 11, 22, 0, 0, Board)   // 11px = 对战页缩略盘

/* ---------- 验收专用两张 ---------- */

/** 铺一张只有一架飞机的盘（含底板），坐标原点是画布左上角 */
function boardCtx(C, M) {
  const size = C * 9
  const W = size + M * 2
  const cells = []
  for (let r = 0; r < 9; r++) { const a = []; for (let c = 0; c < 9; c++) a.push(''); cells.push(a) }
  const abs = getAbsoluteCells('standard', 5, 5, 0)
  abs.forEach(function (cl) { cells[cl.row - 1][cl.col - 1] = { s: cl.isHead ? 'head' : 'plane', p: 0 } })
  const ctx = new SvgCtx(W, W)
  ctx.fillStyle = theme.color.bg
  ctx.fillRect(0, 0, W, W)
  Board.render(ctx, {
    x: M, y: M, size: size, cells: cells,
    planes: [{ p: 0, rotation: 0, cells: abs }]
  }, function (v) { return v })
  return { ctx: ctx, W: W, C: C, M: M }
}

/**
 * 机头接缝 **4× 矢量放大**
 *
 * 判的是「机头色和机身色有没**直接接壤**」—— 两次独立 fill 的抗锯齿各让 50%，
 * 合成后会透出 25% 底板，表现为一道暗细线，在 1:1 的图上经常看不见。
 * 裁窗 = 机头格 + 机身那一行左右两格；SVG 是矢量，放大不引入新的插值。
 */
function noseJoint() {
  const d = boardCtx(56, 58)
  const C = d.C
  const M = d.M
  const pad = 8
  writeShot('lab-nose-joint-4x', d.ctx,
    M + 3 * C - pad, M + 4 * C - pad, 3 * C + pad * 2, 2 * C + pad * 2, 4)
}

/**
 * 同一处接缝的 **1:1 → 最近邻 8×**
 *
 * 和上面那张是两个不同的问题：4× 矢量图回答「两色有没接壤」（几何），
 * 这张回答「手机屏上真正渲染出来的那几行像素长什么样」（栅格）。
 * 用 C=36 的产品尺寸、关掉插值放大，看到的就是设备上那 1~2 行像素本身。
 */
function noseJointPixel() {
  const C = 36
  const M = 34
  const d = boardCtx(C, M)
  writeShot('lab-nose-1x', d.ctx, 0, 0, d.W, d.W, 1)
  pixelUpscale('lab-nose-1x' + SUF + '.png', 'lab-nose-joint-1x-pixel8x' + SUF + '.png',
    { x: M + 3 * C, y: M + 4 * C, w: 3 * C, h: 2 * C }, 8)
}

/**
 * 11px 原始像素最近邻 8×
 *
 * 判的是「11px 上圆点够不够重、1px 线糊不糊」—— 这类判断**只能看原始像素**：
 * 矢量放大会把 1px 线重画成 8px 清晰的线，等于把问题抹掉。
 */
function pixel8x() {
  pixelUpscale('lab-plane-11' + SUF + '.png', 'lab-plane-11-pixel8x' + SUF + '.png',
    { x: 22 + 2 * 11, y: 22 + 4 * 11, w: 55, h: 44 }, 8)
}

/** 把一张 1:1 的 PNG 裁一块、关掉插值放大 S 倍（canvas nearest-neighbour） */
function pixelUpscale(src, outName, crop, S) {
  const html = path.join(OUT, '.pixel8x.html')
  const out = path.join(OUT, outName)
  fs.writeFileSync(html, [
    '<!doctype html><meta charset="utf-8">',
    '<body style="margin:0;background:#000">',
    '<canvas id="c" width="' + crop.w * S + '" height="' + crop.h * S + '"></canvas>',
    '<script>',
    'var img=new Image()',
    'img.onload=function(){',
    '  var x=document.getElementById("c").getContext("2d")',
    '  x.imageSmoothingEnabled=false;x.mozImageSmoothingEnabled=false;x.webkitImageSmoothingEnabled=false',
    '  x.drawImage(img,' + crop.x + ',' + crop.y + ',' + crop.w + ',' + crop.h + ',0,0,' + crop.w * S + ',' + crop.h * S + ')',
    '}',
    'img.src="' + src + '"',
    '<\/script>'
  ].join('\n'))
  let b = null
  for (let i = 0; i < EDGE.length; i++) if (fs.existsSync(EDGE[i])) b = EDGE[i]
  if (b) {
    require('child_process').execFileSync(b, [
      '--headless', '--disable-gpu', '--hide-scrollbars',
      '--virtual-time-budget=4000',
      '--window-size=' + crop.w * S + ',' + crop.h * S,
      '--screenshot=' + out,
      'file:///' + html.replace(/\\/g, '/')
    ], { stdio: 'ignore', timeout: 30000 })
  }
  fs.unlinkSync(html)
}

/** 把已画好的 ctx 按裁切窗 + 放大倍数写出（只改 svg 头，内容一行不动） */
function writeShot(name, ctx, vx, vy, vw, vh, scale) {
  let svg = String(ctx.toSvg()).replace(
    /viewBox="0 0 [\d.]+ [\d.]+" width="[\d.]+" height="[\d.]+"/,
    'viewBox="' + vx + ' ' + vy + ' ' + vw + ' ' + vh + '" width="' +
      Math.round(vw * scale) + '" height="' + Math.round(vh * scale) + '"'
  )
  const f = path.join(OUT, name + SUF + '.svg')
  fs.writeFileSync(f, svg)
  let b = null
  for (let i = 0; i < EDGE.length; i++) if (fs.existsSync(EDGE[i])) b = EDGE[i]
  if (b) {
    require('child_process').execFileSync(b, [
      '--headless', '--disable-gpu', '--hide-scrollbars',
      '--default-background-color=00000000',
      '--window-size=' + Math.round(vw * scale) + ',' + Math.round(vh * scale),
      '--screenshot=' + f.replace(/\.svg$/, '.png'),
      'file:///' + f.replace(/\\/g, '/')
    ], { stdio: 'ignore', timeout: 30000 })
  }
}

noseJoint()
noseJointPixel()
pixel8x()

/* ---------- 色板灰度对照：上排原色，下排等效灰度 ---------- */

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
function Yof(h) {
  return 0.2126 * lin(parseInt(h.substr(1, 2), 16)) +
         0.7152 * lin(parseInt(h.substr(3, 2), 16)) +
         0.0722 * lin(parseInt(h.substr(5, 2), 16))
}
function Lstar(h) {
  const y = Yof(h)
  return y > 0.008856 ? 116 * Math.pow(y, 1 / 3) - 16 : 903.3 * y
}
/** L* → 灰度 sRGB，保证「看到的灰」和「标的数」同源 */
function grayOf(h) {
  const t = (Lstar(h) + 16) / 116
  const v = t > 0.206897 ? t * t * t : (t - 0.137931) / 7.787
  const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055
  return Math.round(Math.max(0, Math.min(1, s)) * 255)
}
function hex2(n) { return ('0' + Math.max(0, Math.min(255, n)).toString(16)).slice(-2) }

const pal = theme.color.planePalette
const SW = 150
const GAP = 18
const PW = SW * 6 + GAP * 7

shot('lab-palette', PW, 470, function (ctx) {
  for (let i = 0; i < 3; i++) {
    const items = [{ c: pal[i].body, tag: 'body ' + (i + 1) }, { c: pal[i].head, tag: 'head ' + (i + 1) }]
    for (let j = 0; j < 2; j++) {
      const k = i * 2 + j
      const x = GAP + k * (SW + GAP)
      const it = items[j]
      ctx.fillStyle = it.c
      ctx.fillRect(x, 40, SW, SW)
      const g = hex2(grayOf(it.c))
      ctx.fillStyle = '#' + g + g + g
      ctx.fillRect(x, 40 + SW + 20, SW, SW)
      ctx.fillStyle = '#EAF2FB'
      ctx.font = '600 20px sans-serif'
      ctx.textAlign = 'left'
      ctx.textBaseline = 'middle'
      ctx.fillText(it.tag + '  L*' + Lstar(it.c).toFixed(1), x, 22)
    }
  }
})

console.log('ok' + SUF)
