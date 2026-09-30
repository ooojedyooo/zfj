// services/rivals.js
// 最近对手（本地存储）
//
// 用途：对局结束后记下对手，结算页 / 大厅可「再邀一局」。
// 说明：本期不做好友关系链与消息推送，所谓「再邀」= 新建一个房间并把邀战卡片分享出去，
//      因此本模块只负责记住「谁是最近的对手」，不涉及任何网络请求。

const { MAX_RECENT_RIVALS } = require('../config/social')

const KEY = 'zfj_recent_rivals'

/** 读取最近对手列表（最新的在前） */
function list() {
  try {
    const arr = wx.getStorageSync(KEY)
    return Array.isArray(arr) ? arr : []
  } catch (e) {
    return []
  }
}

/** 取最近一位对手 */
function latest() {
  return list()[0] || null
}

/**
 * 记录一位对手（同一 openid 会去重并置顶）
 * @param {{openid:string, name?:string, win?:boolean, virtual?:boolean}} rival
 * @returns {Array} 更新后的列表
 */
function add(rival) {
  if (!rival || !rival.openid) return list()
  const rest = list().filter(r => r.openid !== rival.openid)
  const next = [Object.assign({ at: Date.now() }, rival)].concat(rest).slice(0, MAX_RECENT_RIVALS)
  try {
    wx.setStorageSync(KEY, next)
  } catch (e) { /* 存储失败不影响对局 */ }
  return next
}

/** 清空最近对手 */
function clear() {
  try {
    wx.removeStorageSync(KEY)
  } catch (e) { /* ignore */ }
}

/** 展示用昵称：真实对手取 openid 后 4 位，虚拟对手固定显示 */
function displayName(rival) {
  if (!rival) return ''
  if (rival.virtual) return 'AI 陪练'
  if (rival.name) return rival.name
  return '玩家 ' + String(rival.openid || '').slice(-4).toUpperCase()
}

module.exports = { list, latest, add, clear, displayName }
