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

/* ---------------- 装桩 ---------------- */

const boot = new SvgCtx(W, H)
installWx(boot)

const { createApp } = require('../minigame/js/core/app')
const offline = require('../minigame/js/shared/services/offlineGame')

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
    files.push(save('5-battle', capture()))
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
