// config/planes.js
// 机型配置 —— 【数据驱动核心】对应 PRD 附录 A
//
// 新增机型只需在 PLANES 数组追加一条记录，摆放校验、命中判定、棋盘渲染
// 全部复用同一套逻辑，无需改动任何核心代码。
//
// 字段说明：
//   id        机型唯一标识
//   name      机型名称
//   cellCount 占用格数
//   headIndex 机头在 cells 数组中的下标（决定「击毁开关」）
//   rarity    稀有度（V1 固定 common）
//   cells     相对坐标数组 [row, col]，以「机头所在格」为摆放锚点

// 标准机：10 格 = 机头1 + 机翼5 + 机身1 + 机尾3（PRD 3.2）
// 形状（机头朝上，锚点在机头）：
//      ■          row 0 : 机头
//    ■■■■■        row 1 : 机翼（中格与机头相连）
//      ■          row 2 : 机身
//     ■■■         row 3 : 机尾（与机身相连，居中）
const STANDARD_PLANE = {
  id: 'standard',
  name: '标准机',
  cellCount: 10,
  headIndex: 0,
  rarity: 'common',
  cells: [
    [0, 2],                                        // 机头
    [1, 0], [1, 1], [1, 2], [1, 3], [1, 4],        // 机翼 5 格
    [2, 2],                                        // 机身
    [3, 1], [3, 2], [3, 3]                         // 机尾 3 格
  ]
}

const PLANES = [STANDARD_PLANE]

const PLANE_MAP = PLANES.reduce((map, p) => {
  map[p.id] = p
  return map
}, {})

module.exports = {
  PLANES,
  PLANE_MAP,
  getPlane(id) {
    const plane = PLANE_MAP[id]
    if (!plane) throw new Error('[planes] 未知机型: ' + id)
    return plane
  }
}
