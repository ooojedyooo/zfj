// scripts/lib/wx-stub.js
// 公共桩环境 —— 自动化测试与界面预览共用一套
//
// 为什么不各写一份：桩一旦漂移，就会出现「预览里渲染正常、测试里却挂」
// 或者反过来的鬼故事。同一份桩，两边看到的是同一个 wx。
//
// 用法：
//   const { INFO, makeCtx, installWx } = require('./lib/wx-stub')
//   const ctx = makeCtx()
//   const rec = installWx(ctx)        // 必须在 require('minigame/game') 之前
//   ...require 被测对象...

const INFO = {
  windowWidth: 375,
  windowHeight: 667,
  pixelRatio: 2,
  statusBarHeight: 20,
  safeArea: { top: 20, bottom: 667 }
}

/**
 * 记录型 2D 上下文
 *
 * 不真的画，只把方法名记进 calls，用来断言「画了没」「画了几次」。
 * 注意：不要在断言里依赖累计绘制次数（脆弱），只用来验证不抛异常与局部调用。
 */
function makeCtx() {
  const calls = []
  const rec = function (name) {
    return function () { calls.push(name) }
  }
  return {
    calls: calls,
    globalAlpha: 1,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textAlign: '',
    textBaseline: '',
    scale: rec('scale'),
    clearRect: rec('clearRect'),
    fillRect: rec('fillRect'),
    beginPath: rec('beginPath'),
    moveTo: rec('moveTo'),
    lineTo: rec('lineTo'),
    arc: rec('arc'),
    arcTo: rec('arcTo'),
    closePath: rec('closePath'),
    fill: rec('fill'),
    stroke: rec('stroke'),
    save: rec('save'),
    restore: rec('restore'),
    fillText: rec('fillText'),
    strokeText: rec('strokeText'),
    // 渐变：draw.vGradient 在缺这个方法时会降级成纯色。
    // 桩里补上，测试才走真实分支（否则「背景画了渐变」这类回归永远测不出来）
    createLinearGradient: function () {
      return { addColorStop: function () {} }
    },
    setTransform: rec('setTransform'),
    measureText: function (s) { return { width: String(s).length * 7 } }
  }
}

/**
 * 把 wx 挂到 global，返回记录器
 * @param {Object} ctx 2D 上下文（createCanvas 返回它）
 * @param {Object} override 可覆盖个别 wx 行为（如 showModal）
 */
function installWx(ctx, override) {
  const STORE = {}
  // 弹窗桩：记下最后一次弹窗的参数，让「拦住了没有、说了什么」可以断言
  const MODAL = { last: null, count: 0 }

  global.wx = {
    getSystemInfoSync: function () { return INFO },
    getLaunchOptionsSync: function () { return { query: {} } },
    createCanvas: function () {
      return { width: 0, height: 0, getContext: function () { return ctx } }
    },
    showModal: function (o) { MODAL.last = o || {}; MODAL.count++ },
    showToast: function () {},
    hideToast: function () {},
    showShareMenu: function () {},
    shareAppMessage: function () {},
    onShareAppMessage: function () {},
    getStorageSync: function (k) { return STORE[k] || '' },
    setStorageSync: function (k, v) { STORE[k] = v },
    removeStorageSync: function (k) { delete STORE[k] },
    onTouchStart: function () {},
    onTouchMove: function () {},
    onTouchEnd: function () {},
    onTouchCancel: function () {},
    onShow: function () {},
    onHide: function () {},
    cloud: null
  }

  if (override) {
    Object.keys(override).forEach(function (k) { global.wx[k] = override[k] })
  }

  return { STORE: STORE, MODAL: MODAL }
}

module.exports = { INFO, makeCtx, installWx }
