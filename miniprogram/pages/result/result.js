// pages/result/result.js
// 结算页 —— 对应 PRD 3.6 / 5.5
const { END_TYPE } = require('../../config/rules')

const END_TEXT = {
  [END_TYPE.ALL_DESTROYED]: '击毁对方全部飞机',
  [END_TYPE.SURRENDER]: '对方投降',
  [END_TYPE.TIMEOUT]: '对方超时判负'
}

const LOSE_TEXT = {
  [END_TYPE.ALL_DESTROYED]: '己方飞机全部被击毁',
  [END_TYPE.SURRENDER]: '己方主动投降',
  [END_TYPE.TIMEOUT]: '己方连续超时判负'
}

Page({
  data: {
    win: false,
    endLabel: '',
    roomId: '',
    myShots: 0,
    foeShots: 0,
    myDestroyed: 0,
    foeDestroyed: 0,
    mySurvived: 0,
    foeSurvived: 0
  },

  onLoad() {
    const app = getApp()
    const r = app.globalData.matchResult || {}
    const planeCount = r.planeCount || 1

    this.setData({
      win: !!r.win,
      roomId: r.roomId || '',
      myShots: r.myShots || 0,
      foeShots: r.foeShots || 0,
      myDestroyed: r.myDestroyed || 0,
      foeDestroyed: r.foeDestroyed || 0,
      mySurvived: planeCount - (r.foeDestroyed || 0),
      foeSurvived: planeCount - (r.myDestroyed || 0),
      endLabel: r.win ? (END_TEXT[r.endType] || '') : (LOSE_TEXT[r.endType] || '')
    })
  },

  // 再来一局（END-03）
  onAgain() {
    wx.redirectTo({ url: '/pages/room/room?mode=random' })
  },

  // 返回大厅
  onBackHome() {
    wx.reLaunch({ url: '/pages/index/index' })
  }
})
