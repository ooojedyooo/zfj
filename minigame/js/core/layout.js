// minigame/js/core/layout.js
// 屏幕适配
//
// 小程序用 rpx（750 设计稿宽），小游戏要自己算。
// 这里统一用 u(设计稿单位) 换算成 px，写界面时按 750 宽的稿子写即可。

const DESIGN_WIDTH = 750

/**
 * @param {Object} info wx.getSystemInfoSync() 的返回值
 */
function createLayout(info) {
  const W = info.windowWidth
  const H = info.windowHeight
  const scale = W / DESIGN_WIDTH
  const safeArea = info.safeArea || { top: 0, bottom: H }

  return {
    W,
    H,
    scale,
    dpr: info.pixelRatio || 1,
    statusBar: info.statusBarHeight || 0,
    safeTop: safeArea.top || 0,
    safeBottom: Math.max(0, H - (safeArea.bottom || H)),

    /** 设计稿单位 → px */
    u(v) {
      return v * scale
    },

    /** 内容区（去掉状态栏与底部安全区）的高度 */
    contentH() {
      return H - this.safeTop - this.safeBottom
    }
  }
}

module.exports = { createLayout, DESIGN_WIDTH }
