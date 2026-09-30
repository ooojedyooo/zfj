// config/items.js
// 道具配置 —— 【数据驱动核心】对应 PRD 附录 A / 11.4
//
// 本期（MVP）仅预留数据结构，功能于 V2 实现。
// 新增道具同样只需追加一条配置，效果由 effectType + params 描述，不改核心逻辑。
//
// effectType 效果类型（可扩展）：
//   multi_shot  多发攻击：一次攻击多个坐标

const SUPER_MISSILE = {
  id: 'super_missile',
  name: '超级导弹',
  desc: '使用一次可同时攻击 2 个坐标点',
  effectType: 'multi_shot',
  params: { targets: 2 },
  rarity: 'epic'
}

const ITEMS = [SUPER_MISSILE]

const ITEM_MAP = ITEMS.reduce((map, it) => {
  map[it.id] = it
  return map
}, {})

module.exports = {
  ITEMS,
  ITEM_MAP,
  getItem(id) {
    const item = ITEM_MAP[id]
    if (!item) throw new Error('[items] 未知道具: ' + id)
    return item
  }
}
