// scripts/sync-shared.js
// 把「玩法逻辑」同步到两个消费端。全项目只有一份真源，避免多处实现算出不同结果。
//
// 真源：miniprogram/config、miniprogram/utils、miniprogram/services
//   ├─→ cloudfunctions/{room,game}/shared/   云函数复用同一份校验与判定（防作弊 + T-08）
//   └─→ minigame/js/shared/                  小游戏端复用（小游戏工程不能 require 目录外的文件）
//
// 使用：改完 miniprogram/config、miniprogram/utils 或 miniprogram/services 后执行
//   node scripts/sync-shared.js
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'miniprogram')

// 云函数只需要 config + utils（服务端不做 UI，也不需要本地离线引擎）
const CLOUD_FUNCS = ['room', 'game']
const CLOUD_FILES = [
  'config/rules.js',
  'config/planes.js',
  'config/items.js',
  'config/social.js',
  'utils/board.js',
  'utils/plane.js',
  'utils/judge.js'
]

// 小游戏端还需要 services（数据接口层 / 离线引擎 / 最近对手）
const MINIGAME_ROOT = path.join(ROOT, 'minigame/js/shared')
const MINIGAME_FILES = CLOUD_FILES.concat([
  'config/cloud.js',
  'services/cloudApi.js',
  'services/cloudImpl.js',
  'services/offlineGame.js',
  'services/localGame.js',
  'services/rivals.js'
])

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

CLOUD_FUNCS.forEach(function (fn) {
  CLOUD_FILES.forEach(function (rel) {
    copyOne(rel, path.join(ROOT, 'cloudfunctions', fn, 'shared'))
  })
})

MINIGAME_FILES.forEach(function (rel) {
  copyOne(rel, MINIGAME_ROOT)
})

console.log('已同步 ' + count + ' 个共享文件')
console.log('  → cloudfunctions/[' + CLOUD_FUNCS.join(', ') + ']/shared/  （config + utils）')
console.log('  → minigame/js/shared/                        （config + utils + services）')
console.log('提示：改完 miniprogram 的 config / utils / services 后，请重跑本脚本，')
console.log('      并重新上传 room / game 云函数。')
