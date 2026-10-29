// scripts/render-scenes.js
// 把界面渲染成 SVG —— 视觉自查与效果预览
//
// 为什么要这个：界面全是 Canvas 手绘，改完配色没有任何办法「看一眼」。
// 只能靠想象，或者让人打开开发者工具截图，一轮反馈要几分钟。
// 这里用 scripts/lib/svg-ctx.js 把 Canvas 调用翻译成 SVG，
// 场景代码一行不改就能出图。
//
// 运行：node scripts/render-scenes.js
// 输出：outputs/ui-preview/*.svg

const fs = require('fs')
const path = require('path')

const { SvgCtx } = require('./lib/svg-ctx')
const { INFO, installWx } = require('./lib/wx-stub')

const W = INFO.windowWidth
const H = INFO.windowHeight

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
    result: require('../minigame/js/scenes/result')
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
  const file = path.join(outDir, name + '.svg')
  fs.writeFileSync(file, svg)
  console.log('  ' + name + '.svg  (' + Math.round(svg.length / 1024) + ' KB)')
  return file
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

  console.log('\n共 ' + files.length + ' 张，输出目录：' + outDir)
  console.log(files.join('\n'))
}

main().catch(function (e) {
  console.error('渲染失败：', e && e.stack || e)
  process.exit(1)
}).then(function () {
  process.exit(0)
})
