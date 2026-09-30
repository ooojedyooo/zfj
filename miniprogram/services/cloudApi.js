// services/cloudApi.js
// 云函数调用封装 + 房间实时监听
//
// 约定：所有云函数统一返回 { ok: boolean, data?: any, msg?: string, code?: string }
// 本模块把 ok:false 统一转成 Promise reject，页面只需 try/catch。

const { FUNCTIONS, COLLECTIONS } = require('../config/cloud')

/** 调用云函数 */
function call(name, action, data) {
  return new Promise((resolve, reject) => {
    if (!wx.cloud) {
      reject(new Error('当前基础库不支持云开发，请升级微信版本'))
      return
    }
    wx.cloud.callFunction({
      name,
      data: Object.assign({ action: action }, data || {}),
      success: (res) => {
        const r = res.result || {}
        if (r.ok) {
          resolve(r.data)
        } else {
          const err = new Error(r.msg || '操作失败')
          err.code = r.code
          reject(err)
        }
      },
      fail: (err) => {
        console.error('[cloudApi] callFunction fail', name, action, err)
        reject(new Error('网络异常，请重试'))
      }
    })
  })
}

/**
 * 实时监听房间文档
 * @param {string} roomId
 * @param {(room:Object)=>void} onChange
 * @param {(err:Error)=>void} [onError]
 * @returns watcher（务必在页面 onUnload 时调用 close()）
 */
function watchRoom(roomId, onChange, onError) {
  const db = wx.cloud.database()
  return db.collection(COLLECTIONS.ROOMS).where({ _id: roomId }).watch({
    onChange(snapshot) {
      const room = snapshot.docs && snapshot.docs[0]
      if (room && typeof onChange === 'function') onChange(room)
    },
    onError(err) {
      console.error('[cloudApi] watch error', err)
      if (typeof onError === 'function') onError(err)
    }
  })
}

module.exports = {
  call,
  watchRoom,

  /* 房间 */
  createRoom: (p) => call(FUNCTIONS.ROOM, 'create', p),
  joinRoom: (p) => call(FUNCTIONS.ROOM, 'join', p),
  matchRoom: (p) => call(FUNCTIONS.ROOM, 'match', p),
  getRoom: (p) => call(FUNCTIONS.ROOM, 'get', p),
  leaveRoom: (p) => call(FUNCTIONS.ROOM, 'leave', p),

  /* 对局 */
  deploy: (p) => call(FUNCTIONS.GAME, 'deploy', p),
  fire: (p) => call(FUNCTIONS.GAME, 'fire', p),
  surrender: (p) => call(FUNCTIONS.GAME, 'surrender', p),
  tick: (p) => call(FUNCTIONS.GAME, 'tick', p),
  sync: (p) => call(FUNCTIONS.GAME, 'sync', p)
}
