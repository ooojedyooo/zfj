// minigame/js/core/theme.js
// 设计变量 —— 与 miniprogram/app.wxss 保持一致，保证两端观感统一
//
// 小游戏没有 WXSS，所有颜色/字号都以 JS 常量形式集中在这里，便于统一调整。
module.exports = {
  color: {
    // 主色
    primary: '#185FA5',
    primaryLight: '#E6F1FB',
    primaryDark: '#0C447C',

    // 语义色：红=被击中/击毁/危险，橙=我方命中
    danger: '#E24B4A',
    dangerLight: '#FCEBEB',
    dangerDark: '#791F1F',
    hit: '#EF9F27',
    hitLight: '#FAEEDA',
    success: '#1D9E75',

    // 中性
    bg: '#F6F7F9',
    card: '#FFFFFF',
    border: '#E6E8EB',
    text: '#1F2328',
    textMuted: '#6B7280',
    gray: '#F1EFE8',

    // 棋盘
    // 注意：格线原来是 #E6E8EB + 0.5px，在白底上几乎看不见，实战里数不清格子。
    // 这里整体加深一档，并给底板加描边，让棋盘边界与 9×9 格位一眼可辨。
    boardBg: '#FFFFFF',
    boardFrame: '#C7D0DA',
    gridLine: '#B9C5D1',
    cellEmpty: '#FFFFFF',
    plane: '#378ADD',        // 机体：实心蓝，与白色底板对比明确
    planeHead: '#0C447C',    // 机头：再深一档 + 白点标记，一眼看出朝向
    planeSelected: '#185FA5',
    miss: '#B9B7AD',
    disabled: '#EAE8E1',

    // 蒙层
    mask: 'rgba(12, 68, 124, 0.92)'
  },

  // 字号（设计稿单位，调用时用 layout.u() 换算）
  size: {
    h1: 60,
    h2: 44,
    h3: 32,
    body: 28,
    small: 24,
    tiny: 22,
    big: 72
  },

  radius: {
    sm: 12,
    md: 16,
    lg: 24,
    pill: 999
  },

  font: 'sans-serif'
}
