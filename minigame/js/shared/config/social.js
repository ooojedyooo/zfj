// config/social.js
// 社交相关配置（局内表情 / 最近对手）
//
// 为什么单独抽出来：表情白名单必须【客户端与云端同源】——
// 客户端用它渲染表情栏，云端用它校验，避免两边各写一份导致不一致。
const EMOTES = [
  { emoji: '\uD83D\uDC4D', label: '点赞' },
  { emoji: '\uD83D\uDE02', label: '哈哈' },
  { emoji: '\uD83D\uDE31', label: '好险' },
  { emoji: '\uD83C\uDFAF', label: '精准' },
  { emoji: '\uD83D\uDCA3', label: '轰炸' },
  { emoji: '\uD83D\uDE4F', label: '承让' }
]

module.exports = {
  EMOTES,

  /** 仅取 emoji 字符数组，供云端做白名单校验 */
  EMOTE_LIST: EMOTES.map(e => e.emoji),

  /** 表情气泡自动消失时长（毫秒） */
  EMOTE_HIDE_MS: 2200,

  /** 本地保存的最近对手数量上限 */
  MAX_RECENT_RIVALS: 5
}
