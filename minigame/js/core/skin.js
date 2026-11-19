// minigame/js/core/skin.js
// 纯本地皮肤设置。
//
// 为什么不放 shared/services/profile.js：art §2.5 建议过那个位置，但 §6.2 定案
// 是「纯本地、云函数零改动、js/shared/** 玩法逻辑零改动」。皮肤既不跨端也不上传，
// 让 shared 知道它反而是多余依赖。将来若要把皮肤下发到结算页/房间列表，
// 再按 §5.5 拆到 shared —— 触发条件是「皮肤需要跨客户端可见」。
//
// 依赖方向：只 require theme.js（拿已落地的皮肤列表给白名单兜底），
// 不 require 任何场景 / 绘制代码，不反向依赖调用者。
const theme = require('./theme')

const STORAGE_KEY = 'zfj_skin'
const VERSION = 1

/** 白名单写死在这里，不从 theme.skins 直接展开：mono 已在规格里但未落地，不能自动放行。 */
const ALLOWED = ['abyss', 'dusk'].filter(function (id) { return !!theme.skins[id] })
const DEFAULT = 'abyss'

/**
 * 读皮肤。任何异常都回落默认 —— 存储读不到、结构不对、版本不对、id 不在白名单，
 * 全都不抛。皮肤设置坏掉不能让界面画不出来，这是这个功能的最低要求。
 */
function getSkinId() {
  try {
    const raw = wx.getStorageSync(STORAGE_KEY)
    if (!raw || typeof raw !== 'object') return DEFAULT
    if (raw.v !== VERSION) return DEFAULT
    if (ALLOWED.indexOf(raw.id) < 0) return DEFAULT
    return raw.id
  } catch (e) {
    return DEFAULT
  }
}

/** 写皮肤。返回是否真的写成功了（存储被禁用时返回 false，调用方据此决定是否提示）。 */
function setSkinId(id) {
  if (ALLOWED.indexOf(id) < 0) return false
  try {
    wx.setStorageSync(STORAGE_KEY, { v: VERSION, id: id })
    return true
  } catch (e) {
    return false
  }
}

const NAMES = { abyss: '深海指挥室', dusk: '暖砂沙盘' }
function skinName(id) {
  return NAMES[id] || NAMES[DEFAULT]
}

module.exports = {
  getSkinId: getSkinId,
  setSkinId: setSkinId,
  skinName: skinName,
  ALLOWED: ALLOWED,
  DEFAULT: DEFAULT
}
