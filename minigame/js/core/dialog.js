// minigame/js/core/dialog.js
// 原生弹窗封装（小游戏没有 WXML，输入与确认都走原生弹窗）
//
// 说明：房间号 / 密码这类文本输入，用 wx.showModal({ editable: true })
//       需要基础库 2.17.1+，本项目 libVersion 3.5.5 满足。

/** 文本输入弹窗 */
function input(o) {
  const opt = o || {}
  if (typeof wx === 'undefined' || !wx.showModal) {
    if (opt.onOk) opt.onOk(opt.value || '')
    return
  }
  wx.showModal({
    title: opt.title || '请输入',
    editable: true,
    placeholderText: opt.placeholder || '',
    content: opt.value || '',
    success: function (res) {
      if (res.confirm && opt.onOk) opt.onOk(String(res.content || '').trim())
    },
    fail: function () {}
  })
}

/** 二次确认弹窗 */
function confirm(o) {
  const opt = o || {}
  if (typeof wx === 'undefined' || !wx.showModal) {
    if (opt.onOk) opt.onOk()
    return
  }
  wx.showModal({
    title: opt.title || '确认',
    content: opt.content || '',
    confirmText: opt.confirmText || '确定',
    cancelText: opt.cancelText || '取消',
    confirmColor: opt.confirmColor || '#185FA5',
    success: function (res) {
      if (res.confirm && opt.onOk) opt.onOk()
    },
    fail: function () {}
  })
}

/** 仅提示 */
function alert(o) {
  const opt = o || {}
  if (typeof wx === 'undefined' || !wx.showModal) return
  wx.showModal({
    title: opt.title || '提示',
    content: opt.content || '',
    showCancel: false,
    confirmText: '知道了',
    success: function () { if (opt.onClose) opt.onClose() },
    fail: function () { if (opt.onClose) opt.onClose() }
  })
}

module.exports = { input: input, confirm: confirm, alert: alert }
