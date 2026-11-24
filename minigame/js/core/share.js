// minigame/js/core/share.js
// 分享封装
//
// 小游戏与小程序的区别：
//   小程序用 Page.onShareAppMessage 被动返回分享内容 + 页面路径 path；
//   小游戏用 wx.onShareAppMessage 注册被动分享 + wx.shareAppMessage 主动拉起，
//   参数是 { title, imageUrl, query }，好友点开后从启动参数 query 里取。
const LAUNCH = { query: {} }
// 上次已消费过的邀请房号。小游戏 query 是全局的：点卡进来读过一次后必须记住，
// 否则切后台再回来（onShow 仍带着同一份 query）会反复把玩家拽回「加入房间」。
let CONSUMED_ROOM_NO = ''

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

/**
 * 热启动时更新启动参数（game.js 在 wx.onShow 里调用）。
 *
 * 普通切前台时 res.query 往往是空的：此时**不能**把 LAUNCH.query 覆盖成 {}，
 * 否则好友刚点的邀请卡房间号会在真正进房前就被抹掉。
 * 只有拿到新的 roomNo（另一张邀请卡）才整份替换，并重置「已消费」标记。
 */
function setLaunchQuery(q) {
  const next = q || {}
  if (next.roomNo) {
    LAUNCH.query = next
    CONSUMED_ROOM_NO = ''
  }
  return LAUNCH.query
}

/**
 * 消费邀请参数：房间页读入 roomNo / pwd 后调用。
 * 只清 invite 相关字段（roomNo / pwd / invite），保留 query 里其它字段；
 * 同时记下已消费的房号，供 onShow 幂等守卫使用。
 * 清理时机由房间页掌握：见 scenes/room.js onEnter 的「来自好友分享卡片」分支。
 */
function consumeInvite() {
  const no = LAUNCH.query && LAUNCH.query.roomNo
  if (no) CONSUMED_ROOM_NO = no
  const rest = Object.assign({}, LAUNCH.query)
  delete rest.roomNo
  delete rest.pwd
  delete rest.invite
  LAUNCH.query = rest
  return no || ''
}

/** 这张邀请卡是否已经消费过（防止 onShow 重复自动进房） */
function isConsumed(roomNo) {
  return !!roomNo && roomNo === CONSUMED_ROOM_NO
}

/**
 * 邀请卡 query：只放房间号和可选密码。
 * T-08 硬约束：不得带棋盘 / 布阵 / 机位任何信息，全场景只走这一个拼装点。
 */
function roomQuery(roomNo, pwd) {
  if (!roomNo) return ''
  return toQuery(pwd ? { roomNo: roomNo, pwd: pwd } : { roomNo: roomNo })
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
  consumeInvite: consumeInvite,
  isConsumed: isConsumed,
  roomQuery: roomQuery,
  toQuery: toQuery,
  parseQuery: parseQuery
}
