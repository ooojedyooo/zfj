// minigame/js/core/theme.js
// 设计变量 —— 小游戏没有 WXSS，所有颜色/字号都以 JS 常量集中在这里
//
// ============ 深海指挥室（2026-10-29 换肤）============
//
// 上一版是「浅灰底 + 白卡 + 蓝按钮」——那是一套后台管理系统的配色：
// 干净、克制、也完全没有战场氛围。小游戏第一眼要么抓人、要么被划走，
// 所以整体换成深海军蓝底 + 荧光青强调。
//
// 换肤能只改这一个文件，靠的是一条不变式：
//   **Light = 底色，Dark = 文字色，两者永远成对出现。**
// 每个语义色都有 light（打在底上的面）和 dark（压在面上的字），
// 场景代码只按这个关系用，不关心绝对明度。于是把明度整体翻转，
// 所有「暗底 + 亮字」自动变成「深底 + 亮字」，一处不改也不会花。
//
// ============ 2026-11 皮肤系统：颜色按「谁能改它」分三层 ============
//
// 以前这里是一个平铺的 color 对象，「这个颜色该不该跟着皮肤变」只能写在注释里，
// 注释说不清的地方就退化成靠 review 记。现在按权限分层，**合并顺序就是权限顺序**：
//
//   color = Object.assign({}, SKINS[skin], PLACEHOLDER, STATE, SEMANTIC)
//                                          │ 皮肤改不动以下三层 ────┘
//
//   SKINS[skin]  皮肤可改：底色 / 面板 / 棋盘 / 飞机身份色 / 扫掠颜色
//   PLACEHOLDER  不可改：「没有身份」「没有皮肤」这两种显示态
//   STATE        不可改：画在皮肤**之上**的状态叠加（蒙层 / 去焦点 / 非法提示）
//   SEMANTIC     不可改：danger / hit / success / warn
//
// 语义色排最后，所以占位色和状态色都抢不走 danger / hit —— 这条不靠 review，靠顺序。
// **键名一个都没改**（还是 color.plane / color.planeOff / color.boardBg …），
// 所以 plane-icon.js、board.js 的回退行一行都不用动。
//
// 不属于 color 的两块：`sweep`（运动学，可读性参数）与 `planeArt`（三架共用的中性装饰）。
//
// 为什么要分这么多层而不是继续平铺：这些层的差别不是「值不同」而是
// 「谁有权改」。平铺的时候，「皮肤能改它」这件事没有任何结构表达，
// 于是每加一个键都要人来判断一次、每换一次肤都要人眼检查一次。

/* ==================================================================
 * 第一层 · PLACEHOLDER —— 「没有身份」和「没有皮肤」
 * ==================================================================
 *
 * 这四个键表达的不是「一艘涂装成这样的飞机」，而是：
 *   plane / planeHead       —— 这架还没有身份（无皮肤通道的机体；o.planes 缺省时
 *                              逐格老画法也用它，那一档的语义就是「没有皮肤」）
 *   planeOff / planeOffHead —— 这个槽位还没放东西（plane-icon 的 off 态）
 *
 * **它们必须在任何皮肤下长得一样。** 否则换肤后玩家会把「未放置」读成
 * 「一种新飞机」，把缩略盘上的占位读成「敌机」。
 *
 * 三条路里为什么选「立一层」而不是删掉、也不是从 planePalette[0] 派生：
 *   删掉       → 老画法通道裸奔（pal 缺失时没有颜色可画）
 *   派生       → 「没有皮肤」长得像「第 1 架」，那是把缺失伪装成一种选择
 *   立一层     → 「缺失」本身是一种显示态，它不随皮肤变 —— 这才是真事实
 *
 * ⚠ planeOffHead 的值与 SKINS.abyss 的 boardFrame / borderHi 相同，**纯属撞值**：
 *   它不是「棋盘描边的第二种用法」，而是一个恰好取到同一个数的关态机头色。
 *   这也是为什么 scripts/check-skin-tokens.js 除了按值查，还必须按**键名**查 ——
 *   同值不等于同义。
 */
const PLACEHOLDER = {
  plane: '#4A9EFF',
  planeHead: '#9BD2FF',
  planeOff: '#1E3448',
  planeOffHead: '#2A4A66'
}

/* ==================================================================
 * 顶层 · INTERACTION —— 冻结的交互青色源（规格 §9 1058-1060）
 * ==================================================================
 *
 * ghostOk / dragOrigin 原先写成 `primary@α`，而 primary 是皮肤 token
 * （abyss #2BE0C8 / dusk #A8DFFF）。换肤后「这里可以落子」的青色跟着皮肤变，
 * 直接破坏 STATE 的立层理由 —— 状态画在皮肤**之上**，不由皮肤决定。
 *
 * 值取 abyss 的 primary 字面量并**冻结在此**。它不进 color、不进任何 skin、
 * 也不是 primary 的别名：以后 primary 怎么改都不许动它，要改只能改规格。
 */
const INTERACTION = { ok: '#2BE0C8' }

/* ==================================================================
 * 顶层 · ALPHA —— rgba 表达规范登记（规格 §9 1073-1141）
 * ==================================================================
 *
 * 一张带透明度的颜色 = 底色 token + 独立 α 参数。
 *   <key>Base   底色来源：已登记 token 名；'self' = 取该槽位 rgba 字面量自身的 RGB
 *   <key>Alpha  0..1 的 α；派生项改写成 <key>Factor（乘）或 <key>Divisor（除），不写结果
 *
 * 这张表是派生关系的唯一权威。STATE / PLANE_ART / 皮肤块里的 rgba 字面量
 * 只是 checker 的逐值断言锚点（下游产物），两者不符时改字面量，不改这张表。
 */
const ALPHA = {
  // ---- STATE：5 条派生 + 3 条自由色 ----
  conflictBase: 'danger',
  conflictAlpha: 0.30,
  conflictLineBase: 'self',
  conflictLineAlpha: 0.9,
  ghostOkBase: 'interactionOk',
  ghostOkAlpha: 0.40,
  ghostBadBase: 'danger',
  ghostBadAlpha: 0.30,
  ghostBadLineBase: 'danger',
  ghostBadLineAlpha: 0.88,
  dragOriginBase: 'interactionOk',
  dragOriginAlpha: 0.14,
  maskBase: 'self',
  maskAlpha: 0.90,
  planeDimBase: 'self',
  planeDimAlpha: 0.55,

  // ---- PLANE_ART：2 条派生，写公式不写死结果 ----
  shadowBase: 'self',
  shadowAlpha: 0.55,
  keylineBase: 'self',
  keylineAlpha: 0.42,
  glowBase: 'self',
  glowAlpha: 0.30,
  keelTailBase: 'glow',
  keelTailFactor: 0.07,       // α = 0.30 × 0.07 = 0.021
  panelBase: 'self',
  panelAlpha: 0.32,
  lightBase: 'self',
  lightAlpha: 0.75,
  lightDimBase: 'light',
  lightDimDivisor: 2,         // α = 0.75 ÷ 2 = 0.375（原写死 0.38，漂移 0.005）
  nozzleBase: 'self',
  nozzleAlpha: 0.50,

  // ---- 皮肤 rgba：base 一律 self（RGB 随皮肤走），只把 α 单独登记 ----
  abyss_bgGridBase: 'self',
  abyss_bgGridAlpha: 0.10,
  abyss_cellDotBase: 'self',
  abyss_cellDotAlpha: 0.20,
  abyss_missRingBase: 'self',
  abyss_missRingAlpha: 0.72,
  abyss_sheenBase: 'self',
  abyss_sheenAlpha: 0.16,
  abyss_shadeBase: 'self',
  abyss_shadeAlpha: 0.35,
  dusk_bgGridBase: 'self',
  dusk_bgGridAlpha: 0.055,
  dusk_cellDotBase: 'self',
  dusk_cellDotAlpha: 0.20,
  dusk_missRingBase: 'self',
  dusk_missRingAlpha: 0.70,
  dusk_sheenBase: 'self',
  dusk_sheenAlpha: 0.14,
  dusk_shadeBase: 'self',
  dusk_shadeAlpha: 0.42,
  mono_bgGridBase: 'self',
  mono_bgGridAlpha: 0.05,
  mono_cellDotBase: 'self',
  mono_cellDotAlpha: 0.18,
  mono_missRingBase: 'self',
  mono_missRingAlpha: 0.72,
  mono_sheenBase: 'self',
  mono_sheenAlpha: 0.14,
  mono_shadeBase: 'self',
  mono_shadeAlpha: 0.45
}

/* ==================================================================
 * 第二层 · SEMANTIC —— 语义三色
 * ==================================================================
 *
 * 红 = 被击中 / 击毁 / 危险，橙 = 我方命中，绿 = 成功。
 * 皮肤写不进这三个键：「皮肤吞掉语义色」在结构层面就不成立。
 * 每个语义色都是 light（打在底上的面）/ 本体 / dark（压在面上的字）三件套。
 */
const SEMANTIC = {
  danger: '#FF5A5A',
  dangerLight: '#3A1620',
  dangerDark: '#FFB0B0',
  hit: '#FF9B2F',
  hitLight: '#3A2614',
  hitDark: '#FFC77A',
  success: '#45E08A',
  successLight: '#12321F',

  // 待修正（布阵页：还有飞机放不放得下）
  warn: '#FFB84D',
  warnLight: '#3A2A14',
  warnDark: '#FFCF8A'
}

/* ==================================================================
 * 第二层半 · STATE —— 画在皮肤**之上**的状态叠加色
 * ==================================================================
 *
 * 为什么不可换肤，和 SEMANTIC 同构但不一样：**这些不是皮肤的一部分，
 * 是画在皮肤之上的状态。** 蒙层、去焦点、非法提示如果随皮肤走，
 * 就会出现「换个皮肤之后『这格不能点』变得看不出来」——
 * 状态表达权不在皮肤手上。
 *
 * 这 9 个键原本一个都没有契约位置：它们在代码里活得好好的（9 个全有引用），
 * 只是规格从没给它们名字。**「能跑」不是「登记过」** —— 未登记的真值是
 * 「换肤时不知道要不要改它」，而答案是「根本不该改」，那就更该写下来。
 *
 * ⚠ `ghostBad` 与 `conflict` 同值（都是 danger @ .30），**不是撞值，是两个状态恰好同色**：
 *   一个是「已违规」，一个是「将要违规」。这正是断言四按**名字**查的理由 ——
 *   如果只按值查，删掉其中任何一个都不会被发现。
 * ⚠ G2 已收（规格 §9.3 / §9.4）：其中 5 个是派生值，关系登记在上表 ALPHA，
 *   ghostOk / dragOrigin 的基色为冻结的 INTERACTION.ok，不再是随皮肤走的 primary。
 *   下面的 rgba 字面量只是 checker 的逐值锚点，权威是 ALPHA 表。
 */
const STATE = {
  // 非法布阵 / 非法落位
  conflict: 'rgba(255, 90, 90, 0.30)',      // 叠两架：半透明压红
  conflictLine: 'rgba(255, 210, 210, 0.9)', // 叠两架的斜线（自由色，唯一非派生值）
  ghostOk: 'rgba(43, 224, 200, 0.40)',      // 可落位预览
  ghostBad: 'rgba(255, 90, 90, 0.30)',      // 非法落位预览（同 conflict 值，语义不同）
  ghostBadLine: 'rgba(255, 90, 90, 0.88)',  // 非法落位的描边
  dragOrigin: 'rgba(43, 224, 200, 0.14)',   // 拖拽起点残影
  // 蒙层 / 去焦点
  mask: 'rgba(3, 10, 18, 0.90)',            // 模态蒙层
  planeDim: 'rgba(7, 20, 38, 0.55)'         // 非焦点飞机：往底色压，让它退后
}

/* ==================================================================
 * 第二层半 · SWEEP —— 扫掠运动学，全局常量
 * ==================================================================
 *
 * 唯一理由，且不可协商：这些是「可读性参数」。若放进皮肤，一个皮肤把 speed 设成 200、
 * 或把 peak 设成 0.4，就能把整块盘洗成不可读 —— 换肤不该有这种权力。
 *
 * **束头几何（tick*）本来是住在 color 里的，那是分类错误**：三个都是长度，不是颜色。
 * 混在 color 里之后，任何「颜色都该可换肤」的推理都会顺手把线宽也变成皮肤能改的东西，
 * 而线宽是可读性参数，同 speed / peak。三个值目前都标「暂定」（规格 §9）。
 */
const SWEEP = {
  speed: 45,          // deg/s，8.0s 一圈。2s 一圈是「扫描」，8s 一圈是「守夜」
  arc: 40,            // 硬边核心张角（deg）；拖尾在它之外再外扩 trail × seg
  trail: 7,           // 拖尾层数。**v2.4 从 8 改 7**：第 8 层 α=0.001（0.26/255）低于
                      //   8bit 量子，屏幕上永远画不出来 —— 契约比屏幕多一层，
                      //   代码只能靠 slice(0,7) 去追。宁可改契约，不留胶带。
  seg: 5,             // 每层角宽（deg）。**总跨度 = arc + trail × seg**，不写第三个常数：
                      //   80° 会漂正是因为它是独立数字而不是算式。现在是 75°。
  anchor: 'board',
  peak: 0.10,         // 核心峰值透明度。上限 0.12，超过 0.14 不接受
  // edge / head 是**透明度**，不是颜色：色由皮肤的 sweepColor 给，
  // 两者在使用处拼成 rgba（draw.alpha）。写成 rgba 字面量的话，
  // 换皮肤时底色变了、α 那半截还留在旧皮肤的颜色上。
  edge: 0.20,         // 前沿线
  head: 0.30,         // 束头横杠
  // 拖尾的 α 阶梯，**7 位，与 trail 同长**。权威值只此一处：
  // art §4.4 那张表保留只为展示 Δα 推导，不要从那里抄数。
  // 不许降到 6 层以下：阶梯头两格 0.090 − 0.072 = 0.018（≈4.6/255）是相邻两层的台阶。
  ahead: [0.090, 0.072, 0.055, 0.040, 0.027, 0.016, 0.007],
  fadeMs: 240,        // 主透明度过渡时长。硬开关会让「轮到你了」那一瞬像掉帧
  tickInset: 3,       // 束头沿半径内移 px：外沿点正压在格线上，居中画会糊成一坨 · 暂定
  tickLen: 3,         // 束头长 px（横杠，不是圆点 —— 圆点会被读成「敌机」）· 暂定
  tickWidth: 1.5      // 横杠线宽 px · 暂定
}

/* ==================================================================
 * 第三层 · SKINS —— 皮肤可改的部分
 * ================================================================== */

const ABYSS = {
  /* ---------------- 底与面（深色体系的骨架） ---------------- */
  bgTop: '#0B2038',        // 页面渐变亮端
  bg: '#071426',           // 页面主底色
  bgBottom: '#040D18',     // 页面渐变暗端
  panel: '#0F2438',        // 面板 / 卡片
  panelHi: '#16324A',      // 面板高一级（按下、悬停、强调块）
  sheen: 'rgba(140, 215, 255, 0.16)',   // 面板顶部 1px 高光
  shade: 'rgba(0, 0, 0, 0.35)',         // 模拟投影（比 shadowBlur 便宜一个量级）
  grid: 'rgba(70, 140, 190, 0.10)',     // 雷达网格线

  /* ---------------- 主色：荧光青 ---------------- */
  // primaryLight = 青的低饱和暗底，primaryDark = 深底上的亮青字。
  // 名字沿用旧值，是为了不动那 100 多处场景调用；语义仍是「底 / 字」。
  primary: '#2BE0C8',
  primaryLight: '#12304A',
  primaryDark: '#8FF3E6',
  primaryInk: '#04121F',   // 青底上压的字（深到发黑才够清楚）

  /* ---------------- 中性 ---------------- */
  card: '#0F2438',         // 卡片面板（原纯白）
  border: '#1E3A52',       // 常规划线
  borderHi: '#2A4A66',     // 需要强调的描边
  text: '#EAF2FB',
  textMuted: '#7E96AE',
  textFaint: '#5A7186',
  gray: '#14293D',         // 占位块 / 次级按钮底

  /* ---------------- 棋盘 ---------------- */
  // 深底上的棋盘不能靠「线」划分，要靠「格子比底略亮一档」。
  boardBg: '#0A1B2E',
  boardFrame: '#2A4A66',
  gridLine: '#1C3A52',

  // 飞机：深底上机头必须比机身亮，才看得出朝向（浅底时代是反过来的）
  planeHeadInk: '#04121F', // 机头序号字色。与 primaryInk 分开：
                           // 序号要压在提亮后的浅色机头上，语义不同（机头是浅色块，
                           // 压上去的字必须近黑，否则和机头糊成一片）。
  planePalette: [
    { body: '#4789d4', head: '#8caed5' },
    { body: '#2cbeb9', head: '#62c6c3' },
    { body: '#a02ec6', head: '#c897d9' }
  ],
  // 空炸：原来是 #35506B，只比底色亮一档，在 9×9 的密网格里几乎看不见
  // →「我到底打过哪几格」要靠它回答，提到 #4C7093 并加一圈外环（见 missRing）
  miss: '#4C7093',
  missRing: 'rgba(84, 124, 164, 0.72)',

  // 空格中心的一个微点：告诉玩家「这一格是可以点的」。
  // 深底 + 大格子的盘面上，纯网格会读成「空表」而不是「可操作区域」。
  // 透明度压到 0.2 —— 它是节奏点，不是内容。
  cellDot: 'rgba(92, 156, 206, 0.20)',

  // 棋盘刻度（1-9 双轴）。取 textFaint 那一档：能读到，但永远抢不过格子里的东西
  // 2026-11 美术审计：原 #5A7186 对底板只有 3.42:1，提到 #7E9BB4 后是 5.98:1。
  // 刻度承担「横3，竖4」的报点口径，是书面唯一坐标语言，必须读得清。
  axisText: '#7E9BB4',

  // 雷达扫掠：**皮肤只给颜色**。运动学（speed / arc / peak / tick…）在顶层 SWEEP，
  // 皮肤改不动它 —— 那些是可读性参数，换肤不该有那种权力。
  sweepColor: '#BFF3FF',
  sweepGlow: '#BFF3FF'
}

/* ==================================================================
 * DUSK · 暖砂沙盘 —— 值逐字抄自 art §3.3 / §9，一个 hex 都不许改
 * ==================================================================
 *
 * 硬规则（art §3.3）：暖色只做结构，绝不进格子。
 * frame = #8A6A45 是黄铜，只允许出现在底板外框 / 面板描边 / 分隔线 / 外圈环带；
 * 格内只能是语义色、身份色、中性灰。所以 sweepColor 仍是冷白 #DCEFFF ——
 * 暖金更好看，但会和 hit 橙混在同一格里，读不出「这是命中还是格子本来就暖」。
 *
 * 键名沿用 ABYSS 的旧名（boardBg←plate / boardFrame←frame / grid←bgGrid /
 * gridLine←grid / axisText←axis / planeHeadInk←headInk / planePalette←palette），
 * 见规格 §9.1 名字对照。100 多处绘制调用不因为换肤而改。
 */
const DUSK = {
  bgTop: '#2A2018',
  bg: '#1B1510',
  bgBottom: '#100C09',
  panel: '#241B14',
  panelHi: '#33261B',
  sheen: 'rgba(255,236,205,0.14)',
  shade: 'rgba(0,0,0,0.42)',
  grid: 'rgba(200,170,130,0.055)',       // ← 规格 bgGrid（页面雷达网格）
  primary: '#A8DFFF',
  primaryLight: '#2A2318',
  primaryDark: '#D6F1FF',
  primaryInk: '#201409',
  card: '#241B14',
  border: '#3A2C1F',
  borderHi: '#57402C',
  text: '#F7EFE3',
  textMuted: '#C4AE92',
  textFaint: '#9A8267',
  gray: '#2A2118',
  boardBg: '#191310',                    // ← 规格 plate
  boardFrame: '#8A6A45',                 // ← 规格 frame：唯一的暖色结构色
  gridLine: '#4A3A2B',                   // ← 规格 grid
  planeHeadInk: '#201409',               // ← 规格 headInk
  planePalette: [
    { body: '#5b8abf', head: '#96aeca' },
    { body: '#51bbb8', head: '#84c1bf' },
    { body: '#9444af', head: '#c19ccd' }
  ],
  miss: '#6E7F8F',
  missRing: 'rgba(150,168,180,0.70)',
  cellDot: 'rgba(214,178,132,0.20)',
  axisText: '#B39A7C',                   // ← 规格 axis
  sweepColor: '#DCEFFF',
  sweepGlow: '#DCEFFF'
}

/* 别名键 —— 「这个键没有自己的颜色，它就是另一个 token」。
 *
 * 提示环 / 选中环都不是独立颜色，就是主色。上一版各自抄了一份字面量，
 * 那是迟早漂的写法：换 dusk 时 primary 变了它们不变，环就不再是主色，
 * 而按值检查会因为「这个值在 primary 上登记过」放过它们（同值不等于同义）。
 *
 * 但光写成 `ABYSS.hintRing = ABYSS.primary` 还不够 —— 值仍然同值，
 * 检查脚本看到的是「两个键恰好一样」，分不出「派生」和「撞值」。
 * 所以把**指向关系本身**声明出来（下面这张表），再由脚本验两件事：
 *   ① 别名指向的 token 自己确实有契约位置；
 *   ② 别名的值真的等于源 token 的值（没被谁手工改回去）。
 * 声明是数据，不是注释，也不是检查脚本里的白名单 —— 加白名单是绕过检查，
 * 声明关系是让检查能查得更准。
 */
const ALIASES = {
  hintRing: 'primary',   // 提示环（布阵页「这里可以放」）
  selectRing: 'primary'  // 选中环
}

const SKINS = { abyss: ABYSS, dusk: DUSK }

/* 别名对**每一套**皮肤都生效：换肤时环自动跟着当套的主色走，
 * 不需要记得「加皮肤时还要改第二处」。 */
Object.keys(SKINS).forEach(function (s) {
  Object.keys(ALIASES).forEach(function (k) {
    SKINS[s][k] = SKINS[s][ALIASES[k]]
  })
})

/** 当前皮肤。换肤只改这一处。 */
const SKIN = 'abyss'

/* 三架飞机的身份色规则（数值一律以「量出来的」为准，这里**不重复抄数**）：
 *   三套皮肤共用同一组色相 212 / 178 / 285，只调饱和度与明度。
 *   ① 原来 2 号机 #2FD08F（156°）与 success #45E08A（147°）只差 9°、亮度比 1.17
 *      —— 等于撞色，玩家分不清「这架飞机」和「成功」；
 *   ② 三架之间必须**色相可分**且**明度可分**（明度差是给色弱玩家的第二条通道：
 *      只靠色相在 37px 的格子里、在灰度屏上，一个都读不出来）。
 *   R1 机身明度阶梯：任意两架的机身 L* 差要够大；
 *   R2 机头比机身亮：深色棋盘上这是「机头在哪」最直接的一条通道；
 *   R3 机身要能从底板上浮出来：非文字图形对底板的对比度下限。
 *   具体阈值与实测在 test-minigame [14]，那里是唯一权威 —— 抄在注释里的数一定会过期。
 *   每架只有 body / head 两个值是**有彩**的：装饰色统一走 planeArt（中性色）。
 */

/* ==================================================================
 * 不可换肤的装饰层
 * ================================================================== */

/* 飞机装饰（art §9 PLANE_ART，顶层）
 *
 * **三架共用一套中性色，不是 per-plane。**
 * 镜面高光本来就该是中性色：紫机身上打一层中性高光，比打一层紫高光更像金属。
 * 附带好处：机身色相辨识只剩 body/head 两个值在竞争，更纯粹；
 * 损伤混色也只需要改一个 strokeStyle，不用遍历三架。
 *
 * 为什么放在顶层而不是 SKINS 里：它不是「某个皮肤的颜色」，
 * 是**三套皮肤共用**的物理量（金属反光、蒙皮拼缝），换肤时一个字节都不该变。
 * 层级本身就把「皮肤改不动它」这件事表达出来了。
 */
const PLANE_ART = {
  shadow: 'rgba(2, 8, 16, 0.55)',       // 外描边·暗（keyline 底）+ 机头前缘三角
  keyline: 'rgba(224, 236, 246, 0.42)',  // 外描边·亮；受损时混 danger（§5.8）
  glow: 'rgba(224, 236, 246, 0.30)',     // 龙骨渐变·机头端
  // 龙骨渐变·机尾端 = at(glow, 0.30 × 0.07) = 0.021。公式在 ALPHA.keelTailFactor，
  // 这里保留字面量作 checker 锚点；不要手改，也不要写成 at(glow, 0.07)。
  keelTail: 'rgba(224, 236, 246, 0.021)',
  panel: 'rgba(6, 18, 30, 0.32)',        // 机翼后掠线 1px
  light: 'rgba(224, 244, 255, 0.75)',    // 翼尖灯
  // 尾喷口亮缝 = at(light, 0.75 ÷ 2) = 0.375；原写死 0.38 是漂移（规格 §9.4）
  lightDim: 'rgba(224, 244, 255, 0.375)',
  nozzle: 'rgba(2, 8, 16, 0.50)'         // 尾喷口块
}

/**
 * 换肤。in-place 改 `module.exports.color`，不换对象引用 ——
 * 场景里可能有人缓存了 `theme.color` 这个对象，换引用会让那些地方留在旧皮肤。
 *
 * 必须先删旧键再 assign：三套皮肤的键数不必相同，只 assign 新的会让旧皮肤独有的
 * token 留下来，变成一只「谁都不管的第三只手」。删完再按
 * 皮肤 → 占位色 → 状态色 → 语义色的顺序写回，权限顺序和初始化时完全一致。
 *
 * colorVersion 只服务缓存失效（draw.background 的色标数组按引用缓存）：
 * 色对象引用没变，但内容变了，所以必须有第二个信号告诉缓存「配色换了」。
 */
function applySkin(id) {
  const next = SKINS[id] ? id : SKIN
  const color = module.exports.color
  Object.keys(color).forEach(function (k) { delete color[k] })
  Object.assign(color, SKINS[next], PLACEHOLDER, STATE, SEMANTIC)
  module.exports.skin = next
  module.exports.colorVersion += 1
  return next
}

module.exports = {
  skin: SKIN,
  colorVersion: 0,

  // 合并顺序就是权限顺序：皮肤 → 占位色 → 状态色 → 语义色。
  // 后三层都排在皮肤之后，皮肤改不动它们；语义色仍排最后，所以谁也抢不走 danger / hit。
  color: Object.assign({}, SKINS[SKIN], PLACEHOLDER, STATE, SEMANTIC),

  // 已落地皮肤表。core/skin.js 用它给白名单兜底（id 必须真的有值表）。
  skins: SKINS,
  applySkin: applySkin,

  // 顶层冻结青色源：不进 color / 不进皮肤，ghostOk 与 dragOrigin 的基色
  interaction: INTERACTION,
  // rgba 派生表：脚本验「底色 token + 独立 α」关系的唯一数据入口
  alpha: ALPHA,

  // 派生键的指向关系（见上面 ALIASES 那段）。导出是为了让
  // scripts/check-skin-tokens.js 能验「别名指向谁、值有没有跟着走」。
  aliases: ALIASES,

  // 运动学：全局，皮肤改不动（见上面 SWEEP 那段）
  sweep: SWEEP,

  planeArt: PLANE_ART,

  // 字号（设计稿单位，调用时用 layout.u() 换算）
  // 未随换肤调整：布局是按字号算出来的，动字号要连布局一起复核。
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
