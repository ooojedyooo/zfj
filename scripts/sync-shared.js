// scripts/sync-shared.js
// 把「玩法逻辑」同步到两个消费端。全项目只有一份真源，避免多处实现算出不同结果。
//
// 真源：miniprogram/config、miniprogram/utils、miniprogram/services
//   ├─→ cloudfunctions/{room,game}/shared/   云函数复用同一份校验与判定（防作弊 + T-08）
//   └─→ minigame/js/shared/                  小游戏端复用（小游戏工程不能 require 目录外的文件）
//
// 使用：改完 miniprogram/config、miniprogram/utils 或 miniprogram/services 后执行
//   node scripts/sync-shared.js
//
// 【为什么改成扫目录而不是列清单】
//   以前这里是一张手写文件清单，于是「新增一个共享文件但要记得加进清单」变成了隐形陷阱：
//   漏加不会报错，只会让某一端悄悄用旧逻辑 —— 这类 bug 最难查。
//   现在目录里有什么就同步什么，新增文件自动生效。
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'miniprogram')

// 云函数只需要 config + utils（服务端不做 UI，也不需要本地离线引擎）
const CLOUD_FUNCS = ['room', 'game']
const CLOUD_DIRS = ['config', 'utils']
// config/cloud.js 是小程序端的环境配置（ENV_ID / USE_CLOUD），云函数不需要，也不能带
const CLOUD_SKIP = ['config/cloud.js']

// 小游戏端还要 services（数据接口层 / 离线引擎 / 最近对手 / 昵称）
const MINIGAME_ROOT = path.join(ROOT, 'minigame/js/shared')
const MINIGAME_DIRS = ['config', 'utils', 'services']

/** 列出 SRC 下若干目录里的所有 .js（相对路径，用 / 分隔） */
function listJs(dirs) {
  const out = []
  dirs.forEach(function (dir) {
    const abs = path.join(SRC, dir)
    if (!fs.existsSync(abs)) return
    fs.readdirSync(abs).forEach(function (name) {
      if (!/\.js$/.test(name)) return
      out.push(dir + '/' + name)
    })
  })
  return out.sort()
}

let count = 0

function copyOne(rel, destRoot) {
  const from = path.join(SRC, rel)
  const to = path.join(destRoot, rel)
  if (!fs.existsSync(from)) {
    console.warn('  ! 源文件不存在: ' + rel)
    return
  }
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
  count++
}

const cloudFiles = listJs(CLOUD_DIRS).filter(function (rel) {
  return CLOUD_SKIP.indexOf(rel) < 0
})
const minigameFiles = listJs(MINIGAME_DIRS)

CLOUD_FUNCS.forEach(function (fn) {
  cloudFiles.forEach(function (rel) {
    copyOne(rel, path.join(ROOT, 'cloudfunctions', fn, 'shared'))
  })
})

minigameFiles.forEach(function (rel) {
  copyOne(rel, MINIGAME_ROOT)
})

console.log('已同步 ' + count + ' 个共享文件')
console.log('  → cloudfunctions/[' + CLOUD_FUNCS.join(', ') + ']/shared/  （' + cloudFiles.length + ' 个：config + utils）')
console.log('  → minigame/js/shared/                        （' + minigameFiles.length + ' 个：config + utils + services）')
console.log('提示：改完 miniprogram 的 config / utils / services 后，请重跑本脚本，')
console.log('      并重新上传 room / game 云函数。')
