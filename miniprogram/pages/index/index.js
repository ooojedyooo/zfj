// pages/index/index.js
// 大厅首页：三个主入口（对应 PRD 6.1 页面清单）
Page({
  data: {
    playerId: ''
  },

  onLoad() {
    const app = getApp()
    this.setData({ playerId: app.globalData.playerId })
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
