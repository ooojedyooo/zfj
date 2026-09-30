// services/cloudApi.js
// 【对外统一数据接口 / 分派器】
//
// 页面只 require 这一个模块，拿到的永远是一套相同的 API：
//   createRoom / joinRoom / matchRoom / getRoom / leaveRoom
//   deploy / fire / emote / surrender / tick / sync / watchRoom
//
// 背后实现由 config/cloud.js 的 USE_CLOUD 决定：
//   USE_CLOUD = true  → services/cloudImpl.js（微信云开发，真联机）
//   USE_CLOUD = false → services/offlineGame.js（本地离线引擎，对手由 AI 扮演）
//
// 这样「云环境还没配好」时也能把游戏完整跑起来，等云环境就绪只需改一个开关。

const { USE_CLOUD } = require('../config/cloud')
const cloudImpl = require('./cloudImpl')
const offline = require('./offlineGame')

const impl = USE_CLOUD ? cloudImpl : offline

/** 方法分派：统一走当前实现，缺失时给出明确报错 */
function route(name) {
  return function (params) {
    const fn = impl[name]
    if (typeof fn !== 'function') {
      return Promise.reject(new Error('当前数据源未实现方法：' + name))
    }
    return fn(params)
  }
}

module.exports = {
  /** 当前是否走云端联机（页面可用于文案提示，如「AI 陪练」） */
  isCloud: USE_CLOUD,

  /* 房间 */
  createRoom: route('createRoom'),
  joinRoom: route('joinRoom'),
  matchRoom: route('matchRoom'),
  getRoom: route('getRoom'),
  leaveRoom: route('leaveRoom'),

  /* 对局 */
  deploy: route('deploy'),
  fire: route('fire'),
  emote: route('emote'),
  surrender: route('surrender'),
  tick: route('tick'),
  sync: route('sync'),

  /* 实时监听（离线实现为本地事件广播，签名一致） */
  watchRoom: (roomId, onChange, onError) => impl.watchRoom(roomId, onChange, onError),

  /* ---- 以下仅离线模式有效，供调试与自动化测试加速使用 ---- */
  setDelays: (d) => {
    if (typeof offline.setDelays === 'function') offline.setDelays(d)
  }
}
