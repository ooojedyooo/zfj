// services/profile.js
// 玩家昵称 —— 房间名的默认值来源
//
// 为什么默认名要这么绕：
//   wx.getUserInfo 从基础库 2.27.1 起返回的是匿名数据（nickName 恒为「微信用户」），
//   而 wx.createUserInfoButton 是一块盖在 canvas 上的原生按钮，会挡住界面。
//   所以策略是：上一次手动设过的名字 → 微信真实昵称（能拿到就用）→ 「飞行员xxxx」兜底。
//   无论走哪条，玩家都能在创建房间页点一下改名，不会卡在「名字改不了」上。

const { ROOM_NAME_MAX } = require('../config/rules')

const NICK_KEY = 'zfj_nickname'
const ID_KEY = 'zfj_player_id'

let fetched = false

function read(k) {
  try { return wx.getStorageSync(k) || '' } catch (e) { return '' }
}

function write(k, v) {
  try { wx.setStorageSync(k, v) } catch (e) { /* ignore */ }
}

/** 兜底名：拿本机玩家标识的尾 4 位，保证同一台设备每次都一样 */
function defaultName() {
  const id = String(read(ID_KEY) || 'me')
  return '飞行员' + id.slice(-4)
}

/** 当前昵称（同步，供界面直接显示） */
function nickname() {
  const saved = String(read(NICK_KEY) || '').trim()
  return saved ? saved.slice(0, ROOM_NAME_MAX) : defaultName()
}

/** 记住昵称，下次建房直接用它 */
function setNickname(v) {
  const s = String(v == null ? '' : v).replace(/[\r\n\t]/g, ' ').trim().slice(0, ROOM_NAME_MAX)
  if (s) write(NICK_KEY, s)
  return s
}

/**
 * 尝试取微信昵称（异步、一次性）
 * 只认「非匿名」的返回值，拿不到就安静退出 —— 不弹授权框，不打断建房流程
 */
function fetchWechatNickname(cb) {
  if (fetched) return
  fetched = true
  if (typeof wx === 'undefined' || !wx.getUserInfo) return
  try {
    wx.getUserInfo({
      withCredentials: false,
      lang: 'zh_CN',
      success: function (res) {
        const n = res && res.userInfo && res.userInfo.nickName
        if (n && n !== '微信用户' && n !== 'WeChat User') {
          setNickname(n)
          if (typeof cb === 'function') cb(n)
        }
      },
      fail: function () { /* 匿名/未授权，静默 */ }
    })
  } catch (e) { /* 老基础库不支持，静默 */ }
}

module.exports = { nickname, setNickname, fetchWechatNickname, defaultName }
