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
    planeOff: '#DCE3EA',     // 熄灭态机体（飞机棋子未点亮）
    planeOffHead: '#C3CFDB', // 熄灭态机头
    miss: '#B9B7AD',
    disabled: '#EAE8E1',

    // 飞机身份色 —— 布阵时最多 3 架，靠「颜色 + 机头序号」双重编码区分
    //
    // 为什么刻意避开红 / 橙 / 绿：
    //   红 = 被击中 / 击毁，橙 = 我方命中，绿 = 成功。
    //   这三类语义在棋盘上同样要出现，飞机身份色一旦撞色，玩家会把
    //   「第 3 架飞机」看成「被击毁的格子」。所以只在蓝→青→紫这条冷色带里取。
    //
    // 为什么不能只靠颜色：
    //   纯色编码对色弱玩家无效（男性红绿色弱约 8%），而且 30px 的小格子上
    //   相邻色相很难区分。所以机头格里同时印序号 1/2/3 —— 颜色负责「扫一眼」，
    //   序号负责「确认是它」。
    planePalette: [
      { body: '#185FA5', head: '#0C447C' },  // 1 蓝（主色，同时是单架时的默认色）
      { body: '#14808E', head: '#0B5A65' },  // 2 青
      { body: '#7A5CC4', head: '#573C94' }   // 3 紫
    ],
    planeDim: 'rgba(107, 114, 128, 0.22)',  // 非焦点飞机（有其它架被选中时降饱和）

    // 拖拽 / 选中
    ghostOk: 'rgba(24, 95, 165, 0.55)',   // 可落位预览
    ghostBad: 'rgba(226, 75, 74, 0.42)',  // 非法落位预览（色块）
    ghostBadLine: 'rgba(226, 75, 74, 0.85)', // 非法落位（斜线，比色块更像「禁止」）
    hintRing: '#185FA5',                  // 自动吸附候选位（虚线描边）
    dragOrigin: 'rgba(55, 138, 221, 0.18)', // 拖拽时原位置留痕
    selectRing: '#185FA5',

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
