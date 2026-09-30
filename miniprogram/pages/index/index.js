// pages/index/index.js
// 大厅首页：三个主入口 + 最近对手回访（对应 PRD 6.1 页面清单）
const api = require('../../services/cloudApi')
const rivals = require('../../services/rivals')

Page({
  data: {
    playerId: '',
    rivalName: '',
    rivalCount: 0,
    isCloud: api.isCloud
  },

  onLoad() {
    const app = getApp()
    app.enableShare()
    this.setData({ playerId: app.globalData.playerId })
  },

  // 每次回到大厅都刷新（结算页可能刚记录了一位对手）
  onShow() {
    this.refreshRivals()
  },

  refreshRivals() {
    const list = rivals.list()
    this.setData({
      rivalName: rivals.displayName(list[0]),
      rivalCount: list.length
    })
  },

  // 创建房间（公开 / 密码）
  onCreateRoom() {
    wx.navigateTo({ url: '/pages/room/room?mode=create' })
  },

  // 加入房间
  onJoinRoom() {
    wx.navigateTo({ url: '/pages/room/room?mode=join' })
  },

  // 公开随机匹配
  onRandomMatch() {
    wx.navigateTo({ url: '/pages/room/room?mode=random' })
  },

  /** 再邀最近对手：新建房间并带上对方名字，转发文案会带上他 */
  onReinvite() {
    const name = this.data.rivalName
    const q = name ? '&rival=' + encodeURIComponent(name) : ''
    wx.navigateTo({ url: '/pages/room/room?mode=create&auto=1' + q })
  },

  onShareAppMessage() {
    return {
      title: '炸飞机 · 9×9 双人实时对战，来跟我打一局',
      path: '/pages/index/index'
    }
  },

  // 玩法规则
  onRules() {
    wx.showModal({
      title: '玩法简介',
      content: '在 9×9 棋盘上布置 1-3 架飞机；双方轮流报点轰炸，机头被击中即整架击毁。先击毁对方全部飞机者获胜。',
      showCancel: false,
      confirmText: '知道了'
    })
  }
})
