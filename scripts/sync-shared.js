// scripts/sync-shared.js
// 把小程序端的「纯玩法逻辑」同步到云函数目录。
//
// 为什么要同步：微信云函数独立打包上传，无法直接 require 小程序目录下的文件。
// 但布阵校验与命中判定必须在云端再执行一遍（防作弊 + T-08），
// 因此让云端复用与小程序端完全相同的代码，避免两份实现算出不同结果。
//
// 使用：改完 miniprogram/config 或 miniprogram/utils 后执行
//   node scripts/sync-shared.js
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'miniprogram')
const FUNCS = ['room', 'game']

// 保持 config/ 与 utils/ 两级目录结构，这样文件内的相对 require 路径无需改动
const FILES = [
  'config/rules.js',
  'config/planes.js',
  'config/items.js',
  'utils/board.js',
  'utils/plane.js',
  'utils/judge.js'
]

let count = 0

FUNCS.forEach(fn => {
  FILES.forEach(rel => {
    const from = path.join(SRC, rel)
    const to = path.join(ROOT, 'cloudfunctions', fn, 'shared', rel)
    if (!fs.existsSync(from)) {
      console.warn('  ! 源文件不存在: ' + rel)
      return
    }
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
    count++
  })
})

console.log('已同步 ' + count + ' 个共享文件到云函数目录（' + FUNCS.join(', ') + '）')
console.log('提示：修改 miniprogram/config 或 miniprogram/utils 后，请重新执行本脚本。')
