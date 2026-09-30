// pages/result/result.js
// 结算页 —— 对应 PRD 3.6 / 5.5
// 社交：分享战报 / 邀请好友再战 / 最近对手回访
const api = require('../../services/cloudApi')
const rivals = require('../../services/rivals')
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
    foeSurvived: 0,
    // 社交
    rivalName: '',
    rivalTimes: 0,
    isCloud: api.isCloud
  },

  onLoad() {
    const app = getApp()
    app.enableShare()

    const r = app.globalData.matchResult || {}
    const planeCount = r.planeCount || 1
    this.planeCount = planeCount

    const rival = rivals.latest()
    const rivalList = rivals.list()

    this.setData({
      win: !!r.win,
      roomId: r.roomId || '',
      myShots: r.myShots || 0,
      foeShots: r.foeShots || 0,
      myDestroyed: r.myDestroyed || 0,
      foeDestroyed: r.foeDestroyed || 0,
      mySurvived: planeCount - (r.foeDestroyed || 0),
      foeSurvived: planeCount - (r.myDestroyed || 0),
      endLabel: r.win ? (END_TEXT[r.endType] || '') : (LOSE_TEXT[r.endType] || ''),
      rivalName: rivals.displayName(rival),
      rivalTimes: rivalList.length
    })
  },

  /** 分享战报 */
  onShareAppMessage() {
    return {
      title: this.data.win
        ? '炸飞机 · 我刚把对手全歼了，你敢来试试？'
        : '炸飞机 · 我被人一炮爆了机头，帮我报仇！',
      path: '/pages/index/index'
    }
  },

  /** 邀请好友再战：新建房间并停在等待页，由用户点「邀请好友加入」分享 */
  onInvite() {
    wx.redirectTo({
      url: '/pages/room/room?mode=create&auto=1&planes=' + this.planeCount
    })
  },

  // 再来一局（END-03）
  onAgain() {
    wx.redirectTo({ url: '/pages/room/room?mode=random&planes=' + this.planeCount })
  },

  // 返回大厅
  onBackHome() {
    wx.reLaunch({ url: '/pages/index/index' })
  }
})
