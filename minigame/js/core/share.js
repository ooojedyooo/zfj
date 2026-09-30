// minigame/js/core/share.js
// 分享封装
//
// 小游戏与小程序的区别：
//   小程序用 Page.onShareAppMessage 被动返回分享内容 + 页面路径 path；
//   小游戏用 wx.onShareAppMessage 注册被动分享 + wx.shareAppMessage 主动拉起，
//   参数是 { title, imageUrl, query }，好友点开后从启动参数 query 里取。
const LAUNCH = { query: {} }

try {
  const opt = (typeof wx !== 'undefined' && wx.getLaunchOptionsSync)
    ? wx.getLaunchOptionsSync()
    : null
  if (opt && opt.query) LAUNCH.query = opt.query
} catch (e) { /* ignore */ }

/** 取启动参数（分享卡片带过来的） */
function launchQuery() {
  return LAUNCH.query || {}
}

/** 热启动时更新启动参数（game.js 在 wx.onShow 里调用） */
function setLaunchQuery(q) {
  LAUNCH.query = q || {}
  return LAUNCH.query
}

/** 注册被动分享（点右上角「···」转发） */
function onShare(getInfo) {
  if (typeof wx === 'undefined') return
  if (wx.showShareMenu) {
    try { wx.showShareMenu({ withShareTicket: false }) } catch (e) { /* ignore */ }
  }
  if (wx.onShareAppMessage) wx.onShareAppMessage(getInfo)
}

/** 主动拉起分享（必须在用户点击的调用链里） */
function share(info) {
  if (typeof wx === 'undefined' || !wx.shareAppMessage) return
  try { wx.shareAppMessage(info) } catch (e) { /* ignore */ }
}

/** 拼 query 串 */
function toQuery(obj) {
  const parts = []
  Object.keys(obj || {}).forEach(function (k) {
    if (obj[k] === undefined || obj[k] === null || obj[k] === '') return
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(obj[k]))
  })
  return parts.join('&')
}

/** 解析 query 串 */
function parseQuery(str) {
  const out = {}
  String(str || '').split('&').forEach(function (kv) {
    if (!kv) return
    const i = kv.indexOf('=')
    const k = i < 0 ? kv : kv.slice(0, i)
    const v = i < 0 ? '' : kv.slice(i + 1)
    try { out[decodeURIComponent(k)] = decodeURIComponent(v) } catch (e) { out[k] = v }
  })
  return out
}

module.exports = {
  onShare: onShare,
  share: share,
  launchQuery: launchQuery,
  setLaunchQuery: setLaunchQuery,
  toQuery: toQuery,
  parseQuery: parseQuery
}
