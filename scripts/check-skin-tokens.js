#!/usr/bin/env node
// scripts/check-skin-tokens.js
// 皮肤 token 契约检查 —— design/art/skin-system.md ↔ minigame/js/core/theme.js
//
// 运行：node scripts/check-skin-tokens.js
//       node scripts/check-skin-tokens.js --strict   ← 把「待处理项」也算失败
//
// ================== 为什么要这个脚本 ==================
//
// 同一个色值在三个地方各写一遍：规格 §3 的展示块、规格 §9 的 token 契约块、
// theme.js。人眼比对相距几百行的两块文本是查不出分叉的，**必须机械验**。
//
// 但「一行 grep」是骗人的。计数 `grep -o | sort | uniq -c` 只能证明
// 「每个值各出现两次」，证不了「1 号机身没配给 2 号机头」——
// 配对漂移时每个值仍然各两次，检查全绿，而颜色已经错了。
// 所以这里**逐对深比较**，不是逐值。
//
// ================== 三条自己踩过的坑 ==================
//
// 1. **检查不许数到自己。** 上一版把 9 个色值的字面量写进了检查命令，
//    结果被检文件里的 hex 出现次数从 18 变 27 —— 多出来的 9 次是命令自己。
//    所以本文件里**一个色值字面量都不许有**，只出现 `#[0-9a-f]{6}` 这种模式，
//    并且最后有一条自检把这件事也机械验一遍（见「自检」）。
// 2. **不许正则扒 theme.js 源码。** 源码里注释掉的、被覆盖的、根本没被用的值
//    都会混进来。真值只能 `require` 出来 —— 那是真正会被画到屏幕上的东西。
//    源码文本另扫一遍，但只用来抓「值在源码里、却不在导出对象里」这类漏网。
// 3. **规格里的行号会过期，色值不会。** 所以指纹用 sha1 而不是行号；
//    对不上就**立刻停**，不要在一个已经不存在的版本上宣布「全对」。

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.join(__dirname, '..')
const SPEC_FILE = path.join(ROOT, 'design', 'art', 'skin-system.md')
const THEME_FILE = path.join(ROOT, 'minigame', 'js', 'core', 'theme.js')

/** 规格版本指纹（sha1 前 12 位）。规格一改，这里就要跟着改 —— 这是故意的。 */
const SPEC_SHA1_12 = '1f7267a877a8'

/* 色值只以**模式**出现，永远不写字面量（见文件头「坑 1」） */
const HEX_RE = /#[0-9a-f]{6}/gi
const HAS_HEX_RE = /#[0-9a-f]{6}/i

/* ---------------- 结果收集 ---------------- */

let pass = 0
const fails = []
const warns = []
const STRICT = process.argv.indexOf('--strict') >= 0

function ok(name, detail) {
  pass++
  console.log('  \u2713 ' + name + (detail ? '  \u2014  ' + detail : ''))
}
function fail(id, msg) {
  fails.push('[' + id + '] ' + msg)
  console.log('  \u2717 [' + id + '] ' + msg)
}
function info(msg) {
  console.log('    \u00b7 ' + msg)
}
function warn(msg) {
  warns.push(msg)
  console.log('    ! ' + msg)
}

/* ---------------- 工具 ---------------- */

function hexSet(text) {
  const out = new Set()
  const m = String(text).match(HEX_RE) || []
  m.forEach(function (s) { out.add(s.toUpperCase()) })
  return out
}

function sorted(arr) {
  return arr.slice().sort()
}

function sameSet(a, b) {
  return JSON.stringify(sorted([].concat(Array.from(a)))) ===
         JSON.stringify(sorted([].concat(Array.from(b))))
}

function diff(a, b) {
  return Array.from(a).filter(function (x) { return b.indexOf(x) < 0 })
}

/** 取 [from, to) 这一段；找不到标记就返回空串，由调用方报错 */
function slice(md, from, to) {
  const i = md.indexOf(from)
  if (i < 0) return ''
  const j = to ? md.indexOf(to, i + from.length) : md.length
  if (j < 0) return ''
  return md.slice(i, j)
}

/** 把 JS 注释剥掉。theme.js 的字符串里没有 `//` 和 `/*`，所以正则够用 —— 但下面会验一次。 */
function stripComments(src) {
  const noBlock = src.replace(/\/\*[\s\S]*?\*\//g, '')
  return noBlock.split('\n').map(function (l) {
    return l.replace(/\/\/.*$/, '')
  }).join('\n')
}

/**
 * 只取注释里的色值。
 *
 * 上一版写成 `hexSet(srcRaw.replace(srcCode, ''))` —— 那是错的：
 * 剥完注释的文本不是原文的子串，`replace` 一次都没命中，
 * 于是「注释里的色值」实际等于「全部色值」，报出来的数（43）看着有模有样。
 * 注释要单独取，不能靠减法。
 */
function commentHexes(src) {
  const out = new Set()
  ;(src.match(/\/\*[\s\S]*?\*\//g) || []).forEach(function (b) {
    hexSet(b).forEach(function (h) { out.add(h) })
  })
  src.split('\n').forEach(function (l) {
    const m = l.match(/\/\/.*$/)
    if (m) hexSet(m[0]).forEach(function (h) { out.add(h) })
  })
  return out
}

/* 规格里的 token 名 → theme.js 里的键名
 * （§9.1 名字对照：v1 是代码里还在用的名字，v2 是契约里的名字） */
const CODE_KEY = {
  bgGrid: 'grid',       // 页面雷达网格（别和 board 的 grid 混：那个是 gridLine）
  plate: 'boardBg',
  frame: 'boardFrame',
  grid: 'gridLine',
  axis: 'axisText',
  headInk: 'planeHeadInk',
  palette: 'planePalette'
}

/** 反向对照：代码键 → 规格名（键名断言要用） */
const SPEC_KEY = {}
Object.keys(CODE_KEY).forEach(function (specName) {
  SPEC_KEY[CODE_KEY[specName]] = specName
})

/* 扫掠运动学（speed / arc / …）本来平铺在 color 里，v2.4 已整块搬到顶层 `sweep`，
 * 名字与契约一一对应，所以不需要改名表 —— 这一块分层偏差的历史到此为止。 */

/* ================== 0. 指纹 ================== */

console.log('\n皮肤 token 检查 —— design/art/skin-system.md \u2194 minigame/js/core/theme.js\n')

const specRaw = fs.readFileSync(SPEC_FILE)
const specSha = crypto.createHash('sha1').update(specRaw).digest('hex')
const md = specRaw.toString('utf8')

if (specSha.slice(0, 12) !== SPEC_SHA1_12) {
  console.error('  停在指纹这一步。')
  console.error('  期望 sha1 前 12 位：' + SPEC_SHA1_12)
  console.error('  实际          ：' + specSha.slice(0, 12))
  console.error('  规格改过了。先确认为什么改，再把本文件顶部的 SPEC_SHA1_12 一起更新 ——')
  console.error('  在一个已经变过的文件上宣布「全对」，等于什么都没验。')
  process.exit(2)
}
ok('规格指纹', 'sha1 ' + specSha.slice(0, 12) + '\u2026，全 40 位已核')

/* ================== 1. 从规格解析三套皮肤 + 语义色 ================== */

const secAbyss = slice(md, '### 3.2', '### 3.3')
const secDusk = slice(md, '### 3.3', '### 3.4')
const secMono = slice(md, '### 3.4', '### 3.5')
const secContract = slice(md, '## 9. 工程 token 契约', '### 9.1')

if (!secAbyss || !secDusk || !secMono || !secContract) {
  console.error('  规格结构变了：找不到 §3.2 / §3.3 / §3.4 / §9 里的某一节。')
  process.exit(2)
}

const contInteraction = slice(secContract, 'const INTERACTION', 'const ALPHA')
const contAlpha = slice(secContract, 'const ALPHA', 'const SEMANTIC')
const contSem = slice(secContract, 'const SEMANTIC', 'const STATE')
const contState = slice(secContract, 'const STATE', 'const SWEEP')
const contSweep = slice(secContract, 'const SWEEP', 'const PLANE_ART')
const contPlaneArt = slice(secContract, 'const PLANE_ART', 'const PLACEHOLDER')
const contPlaceholder = slice(secContract, 'const PLACEHOLDER', 'const SKINS')
const contAlias = slice(secContract, 'const ALIASES', 'module.exports')
const contAbyss = slice(secContract, 'abyss: {', 'dusk: {')
const contDusk = slice(secContract, 'dusk: {', 'mono: {')
const contMono = slice(secContract, 'mono: {', 'module.exports')

if (!contInteraction || !contAlpha || !contSem || !contState || !contSweep ||
    !contPlaneArt || !contPlaceholder || !contAlias || !contAbyss || !contDusk || !contMono) {
  console.error('  §9 契约块结构变了：INTERACTION / ALPHA / SEMANTIC / STATE / SWEEP / PLANE_ART /' +
    ' PLACEHOLDER / ALIASES / abyss / dusk / mono 里有取不到的。')
  process.exit(2)
}

const SET = {
  sem: hexSet(contSem),
  placeholder: hexSet(contPlaceholder),
  abyss: new Set([].concat(Array.from(hexSet(secAbyss)), Array.from(hexSet(contAbyss)))),
  dusk: new Set([].concat(Array.from(hexSet(secDusk)), Array.from(hexSet(contDusk)))),
  mono: new Set([].concat(Array.from(hexSet(secMono)), Array.from(hexSet(contMono))))
}

info('规格解析：abyss ' + SET.abyss.size + ' / dusk ' + SET.dusk.size + ' / mono ' +
  SET.mono.size + ' / 语义色 ' + SET.sem.size + ' / 占位色 ' + SET.placeholder.size +
  ' / 状态色 ' + Object.keys(parseEntries(contState, 'rgba')).length + '（rgba，见 G1）')

/* 三套互不重叠 —— 否则「dusk 的值不许出现」这条约束会误伤 abyss */
;['dusk', 'mono'].forEach(function (s) {
  const overlap = Array.from(SET[s]).filter(function (h) { return SET.abyss.has(h) })
  if (overlap.length) {
    warn(s + ' 与 abyss 有 ' + overlap.length + ' 个色值重合，断言三会因此漏掉它们：' +
      overlap.join(' '))
  }
})

/* ================== 2. 真值：require 出来的 theme.js ================== */

const theme = require(THEME_FILE)
if (!theme || !theme.color || !Array.isArray(theme.color.planePalette)) {
  console.error('  theme.js 的形状变了：没有 color / planePalette。')
  process.exit(2)
}

/** 走遍导出对象，收集所有「值是纯 hex 的」槽位，key 用 JSON 路径 */
function collectHexValues(obj) {
  const out = new Map()
  ;(function walk(node, p) {
    if (typeof node === 'string') {
      if (/^#[0-9a-f]{6}$/i.test(node)) out.set(p, node.toUpperCase())
      return
    }
    if (Array.isArray(node)) {
      node.forEach(function (v, i) { walk(v, p + '[' + i + ']') })
      return
    }
    if (node && typeof node === 'object') {
      Object.keys(node).forEach(function (k) { walk(node[k], p ? p + '.' + k : k) })
    }
  })(obj, '')
  return out
}

const codeValues = collectHexValues(theme)

/* 值域清点 —— PR-5 起 rgba 不再只有一个「已知盲区」的数量。
 *
 * 旧版把 JSON.stringify(theme) 里的 rgba 收进 Set，只报去重值数（25）。那有两个坑：
 *   ① 槽位数（26）被去重吃掉一个（conflict 与 ghostBad 同值）；
 *   ② 若哪天公式化后值不再是 rgba 字符串，计数会自己掉下去，看起来像「修好了」。
 * 规格 §9.4 的方案保留了字面量锚点，所以槽位数**不该掉**；掉了就是真漏，直接红。
 *
 * 这里按 JSON 路径枚举，并显式打印：槽位数 / 去重值数 / 已登记数 / 派生态数。 */
const specRgbaBySkin = {}
;[['abyss', contAbyss], ['dusk', contDusk], ['mono', contMono]].forEach(function (p) {
  specRgbaBySkin[p[0]] = parseEntries(p[1]).filter(function (e) { return e.kind === 'rgba' }).length
})
const nStateRgba = parseEntries(contState).filter(function (e) { return e.kind === 'rgba' }).length
const nPlaneRgba = parseEntries(contPlaneArt).filter(function (e) { return e.kind === 'rgba' }).length
const specRgba = new Set()
;[contState, contPlaneArt, contAbyss, contDusk, contMono].forEach(function (b) {
  parseEntries(b).forEach(function (e) {
    if (e.kind === 'rgba') specRgba.add(normRgba(e.value))
  })
})

const rgbaSlots = collectRgbaSlots(theme)
const rgbaUniq = new Set(rgbaSlots.map(function (s) { return normRgba(s.value) }))
const rgbaRegistered = rgbaSlots.filter(function (s) { return specRgba.has(normRgba(s.value)) })
const rgbaUnregistered = rgbaSlots.filter(function (s) { return !specRgba.has(normRgba(s.value)) })
const derivedCount = Object.keys(theme.alpha || {}).filter(function (k) {
  return /Base$/.test(k) && theme.alpha[k] !== 'self'
}).length

/* 期望槽位数从契约推导，不写死：STATE + PLANE_ART + 当前皮肤的 color 副本 + 各皮肤表。 */
const activeSkin = theme.skin
const expectedRgbaSlots = (specRgbaBySkin[activeSkin] || 0) +
  Object.keys(theme.skins || {}).reduce(function (n, id) {
    return n + (specRgbaBySkin[id] || 0)
  }, 0) + nStateRgba + nPlaneRgba

if (rgbaSlots.length !== expectedRgbaSlots) {
  fail('一', 'rgba 字面量槽位数 ' + rgbaSlots.length + '，按 §9 契约推导应为 ' + expectedRgbaSlots +
    '\n             期望：STATE ' + nStateRgba + ' + PLANE_ART ' + nPlaneRgba + ' + color(' +
    activeSkin + ') ' + (specRgbaBySkin[activeSkin] || 0) + ' + 皮肤表 ' +
    Object.keys(theme.skins || {}).map(function (id) { return id + ' ' + specRgbaBySkin[id] }).join(' + ') +
    '\n             实际少了就说明有字面量被公式替掉了 —— 锚点掉了不是「修好了」，是断言失效')
} else {
  ok('rgba 槽位数与 §9 契约推导一致：' + expectedRgbaSlots + ' 处字面量锚点仍在')
}
if (rgbaUnregistered.length) {
  rgbaUnregistered.forEach(function (s) {
    fail('一', 'rgba 字面量 ' + s.path + ' = ' + s.value + '：规格 §9 的 rgba 槽位里查不到这个值')
  })
} else {
  ok('rgba 槽位 ' + rgbaRegistered.length + '/' + rgbaSlots.length + ' 的值都能在 §9 rgba 槽位里对上')
}
info('值域：' + codeValues.size + ' 个 hex 槽位参与逐值比对；rgba 槽位 ' + rgbaSlots.length +
  ' 个 / 去重值 ' + rgbaUniq.size + ' 个 / 已登记 ' + rgbaRegistered.length +
  ' 个 / 派生态 ' + derivedCount + ' 条（ALPHA 表 Base ≠ self）')

/* 规格 token 表 = 已登记。**只认 token 表，不认散文** ——
 * 规格正文里还留着被否决/历史的色值（「原来是 X」这种），
 * 把它们算成「登记过」，就等于允许代码继续用被否决的那一版。 */
const REGISTERED = new Set()
;[SET.abyss, SET.dusk, SET.mono, SET.sem, SET.placeholder].forEach(function (s) {
  s.forEach(function (h) { REGISTERED.add(h) })
})

console.log('\n断言一 · 代码里每个色值都必须在规格 token 表里登记过')

const unregistered = []
codeValues.forEach(function (hex, p) {
  if (REGISTERED.has(hex)) return
  unregistered.push({ path: p, hex: hex })
})

if (!unregistered.length) {
  ok('theme.js 导出的 ' + codeValues.size + ' 个 hex 全部已登记')
} else {
  unregistered.forEach(function (u) {
    fail('一', u.path + ' = ' + u.hex +
      '\n             期望：登记在规格 token 表里\n             实际：规格里查不到这个值' +
      '\n             要么删掉它，要么让 art 把它登记进 §3/§9 —— 不要在这里加白名单')
  })
}

/* ---- 源码文本再扫一遍：抓「值写在源码里、却不在导出对象里」 ---- */

const srcRaw = fs.readFileSync(THEME_FILE, 'utf8')
const srcCode = stripComments(srcRaw)
const srcCommentHexes = commentHexes(srcRaw)

/* 剥注释这一步必须自证没剥错：导出对象里的每个值都得还留在剥完的源码里。
 * 否则「剥注释」会把真代码一起剥掉，后面的扫描就成了摆设。 */
const missingAfterStrip = []
codeValues.forEach(function (hex, p) {
  if (srcCode.toUpperCase().indexOf(hex) < 0) missingAfterStrip.push(p + '=' + hex)
})
if (missingAfterStrip.length) {
  fail('一', '剥注释把真代码剥掉了（' + missingAfterStrip.length + ' 个值不见了）：' +
    missingAfterStrip.join(' '))
} else {
  ok('剥注释这一步自证：导出对象的 ' + codeValues.size + ' 个值全部还在代码行里')
}

const srcOnly = diff(Array.from(hexSet(srcCode)), Array.from(codeValues.values()))
if (srcOnly.length) {
  fail('一', '这些色值写在 theme.js 的**代码行**里，却没出现在导出对象中：' + srcOnly.join(' ') +
    '\n             期望：要么被导出（那就该被上面的检查管住），要么根本不该存在')
} else {
  ok('代码行里的色值没有导出之外的漏网')
}

if (srcCommentHexes.size) {
  const commentUnregistered = diff(Array.from(srcCommentHexes), Array.from(REGISTERED))
  info('注释里另有 ' + srcCommentHexes.size + ' 个色值（历史/被否决值的记录，不算失败）' +
    (commentUnregistered.length ? '，其中未登记的是 ' + commentUnregistered.join(' ') : ''))
}

/* ================== 3. 断言一·反向：规格里该落地的必须在代码里 ================== */

console.log('\n断言一 · 反向：规格 §9 的每个 token 必须真的在代码里（逐名字，不是逐值）')

/** 从 §9 契约块里按 `key: '#hex'` 抓 token（palette 的 body/head 单独由断言二管） */
function contractTokens(text) {
  const out = []
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*'(#[0-9a-f]{6})'/gi
  let m
  while ((m = re.exec(text))) {
    if (m[1] === 'body' || m[1] === 'head') continue
    out.push({ name: m[1], hex: m[2].toUpperCase() })
  }
  return out
}

/**
 * 抓 `name: <值>`，值支持 `'#hex'` / `'rgba(...)'` / `'字符串'` / 数字 / `[数字数组]`。
 *
 * 为什么要这个而不复用 contractTokens：STATE / PLANE_ART / SWEEP 里没有 hex
 * （全是 rgba、数字、'board'、数组），只认 hex 的正则会把它们整块漏掉 ——
 * 而「漏掉」在检查里等于「验过了」，这是最坏的一种通过。
 *
 * 先剥注释：契约块的注释里提到过 `speed`、`peak` 这种词，不能算 token 定义。
 */
/**
 * 契约块里**声明了几个键**（不管值长什么样）。
 *
 * 为什么需要它：`parseEntries` 只认五种值形态（hex / rgba / 字符串 / 数字 / 数组）。
 * 哪天契约里出现第六种写法（`foo: BAR`、`baz: [1,2].map(...)`），那一行会被**静默跳过** ——
 * 而「跳过」在检查里等于「验过了」。所以拿行首 `name:` 的数量去对账，
 * 对不上就红，并把对不上的名字打出来。
 */
function declaredNames(block) {
  const body = stripComments(block)
  const out = []
  const re = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)\s*:/gm
  let m
  while ((m = re.exec(body))) {
    if (out.indexOf(m[1]) < 0) out.push(m[1])
  }
  return out
}

function parseEntries(block) {
  const body = stripComments(block)
  const out = []
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*('([^']*)'|(-?[\d.]+)|(\[[^\]]*\]))/g
  let m
  while ((m = re.exec(body))) {
    let kind, value
    if (m[3] != null) {
      value = m[3]
      kind = value.charAt(0) === '#' ? 'hex' : (/^rgba?\(/i.test(value) ? 'rgba' : 'str')
    } else if (m[4] != null) {
      value = m[4]; kind = 'num'
    } else {
      value = m[5]; kind = 'arr'
    }
    out.push({ name: m[1], value: value, kind: kind })
  }
  return out
}

/** 归一化：hex 统一大写、rgba 去空格（`rgba(255, 90, 90, 0.30)` vs `rgba(255,90,90,0.3)`） */
function normVal(e) {
  if (e.kind === 'hex') return String(e.value).toUpperCase()
  if (e.kind === 'rgba') return String(e.value).toLowerCase().replace(/\s+/g, '')
  if (e.kind === 'arr') {
    return (String(e.value).match(/-?[\d.]+/g) || []).map(Number).join(',')
  }
  /* 数字按值归一：契约写 `0.10`、代码写 `0.1`，是同一个数 ——
   * 比字符串会红在格式上，那种红只会教人「把字号对齐」而不是「把数对齐」。 */
  if (e.kind === 'num') return String(Number(e.value))
  return String(e.value)
}

/** 代码侧同一种归一化 */
function normCode(v, kind) {
  if (kind === 'arr') return (Array.isArray(v) ? v : []).map(Number).join(',')
  if (kind === 'hex') return String(v).toUpperCase()
  if (kind === 'rgba') return String(v).toLowerCase().replace(/\s+/g, '')
  if (kind === 'num') return String(Number(v))
  return String(v)
}

/** rgba 拆成 [r,g,b,a]；不是 rgb(a) 字符串就返回 null。 */
function rgbaParts(v) {
  const m = /^rgba?\(([^)]*)\)$/i.exec(String(v).trim())
  if (!m) return null
  const p = m[1].split(',').map(function (x) { return parseFloat(x) })
  if (p.length < 3 || p.some(function (n) { return !isFinite(n) })) return null
  return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]
}

/** rgba 语义归一化：0.30 与 0.3、空白差异都不是差异 —— 比数不比格式。 */
function normRgba(v) {
  const p = rgbaParts(v)
  return p ? p.join(',') : String(v).toLowerCase().replace(/\s+/g, '')
}

/** rgba 的 α；非 rgba 返回 null。Factor / Divisor 要用它当被乘/被除数。 */
function alphaOf(v) {
  const p = rgbaParts(v)
  return p ? p[3] : null
}

/** 按 JSON 路径枚举导出的 rgba 槽位 —— 不再用 Set 去重后只报一个数量。 */
function collectRgbaSlots(obj) {
  const out = []
  ;(function walk(node, p) {
    if (typeof node === 'string') {
      if (/^rgba?\(/i.test(node.trim())) out.push({ path: p, value: node })
      return
    }
    if (Array.isArray(node)) {
      node.forEach(function (v, i) { walk(v, p + '[' + i + ']') })
      return
    }
    if (node && typeof node === 'object') {
      Object.keys(node).forEach(function (k) { walk(node[k], p ? p + '.' + k : k) })
    }
  })(obj, '')
  return out
}

/**
 * 契约块 → 代码对象，逐名字逐值。返回 { checked, bad[] }
 * 只做「契约里有 → 代码里必须有且相等」这一个方向；代码里的多余键由断言四管。
 */
function compareBlock(block, codeObj, label, renameMap) {
  const entries = parseEntries(block)
  const bad = []

  /* 先对账：契约里声明了几个键，解析器就抓到了几个 —— 少一个就说明有写法没被认出来。 */
  const declared = declaredNames(block)
  const parsed = entries.map(function (e) { return e.name })
  const missed = declared.filter(function (n) { return parsed.indexOf(n) < 0 })
  if (missed.length) {
    bad.push(label + '：契约里这些键没被解析出来 → ' + missed.join(' / ') +
      '（值形态超出现有的五种：hex / rgba / 字符串 / 数字 / 数组）—— ' +
      '它们等于没被验过，补解析器或改写法')
  }

  entries.forEach(function (e) {
    const key = (renameMap && renameMap[e.name]) || e.name
    const got = codeObj[key]
    if (got == null) {
      bad.push(label + '.' + key + '：代码里没有这个键（契约里有 ' + e.name + '）')
      return
    }
    if (normCode(got, e.kind) !== normVal(e)) {
      bad.push(label + '.' + key + '：期望 ' + normVal(e) + '，实际 ' + normCode(got, e.kind))
    }
  })
  return { checked: entries.length, bad: bad }
}

function reportBlock(label, res) {
  if (res.bad.length) {
    res.bad.forEach(function (b) {
      fail('一·反向', b + '\n             契约 §9 是权威；代码对不上就是代码错（或 CODE_KEY 改名表要同步）')
    })
  } else if (!res.checked) {
    fail('一·反向', label + ' 从契约里解析到 0 个 token，正则大概失效了')
  } else {
    ok(label + ' ' + res.checked + ' 个 token 逐名字逐值对上')
  }
}

const tokens = contractTokens(contAbyss).concat(contractTokens(contSem))
  .concat(contractTokens(contPlaceholder))
if (tokens.length < 20) {
  fail('一·反向', '只从 §9 解析到 ' + tokens.length + ' 个 hex token，正则大概失效了')
} else {
  const bad = []
  tokens.forEach(function (t) {
    const key = CODE_KEY[t.name] || t.name
    const got = theme.color[key]
    if (typeof got !== 'string') {
      bad.push(t.name + '\u2192' + key + '：代码里没有这个键')
      return
    }
    if (got.toUpperCase() !== t.hex) {
      bad.push(t.name + '\u2192' + key + '：期望 ' + t.hex + '，实际 ' + got.toUpperCase())
    }
  })
  if (bad.length) {
    bad.forEach(function (b) {
      fail('一·反向', b + '\n             注意：规格名\u2192代码键的对照表在 CODE_KEY 里，改名要同步')
    })
  } else {
    ok(tokens.length + ' 个 hex token 逐名字逐值对上（含 ' + Object.keys(CODE_KEY).length + ' 个改名）')
  }
}

/* 两块已落地皮肤各自的 token 都要逐名逐值对上 —— hex 与 rgba 都查。
 *
 * 旧版只用 contractTokens（只认 '#hex'），于是每套皮肤 5 类 rgba
 * （bgGrid / cellDot / missRing / sheen / shade）整块被跳过 —— 「漏掉」在检查里
 * 等于「验过了」。PR-5 补 rgba 分支：沿用 parseEntries + 语义归一化，
 * 认 0.30 = 0.3、认空白差异。plateShadow 已按规格 §9.3 从契约撤掉，不开特例。
 * mono 未落地，只登记 alpha，不进这里的硬失败。
 * palette 是对象数组，逐对比较在断言二/三里做，那里比这里严（计数检查抓不到配对漂移）。
 */
;[['abyss', theme.skins && theme.skins.abyss], ['dusk', theme.skins && theme.skins.dusk]]
  .forEach(function (pair) {
    const skinObj = pair[1]
    if (!skinObj) {
      fail('一·反向', 'theme.skins.' + pair[0] + ' 不存在 —— 断言三也过不了')
      return
    }
    const block = pair[0] === 'abyss' ? contAbyss : contDusk
    const t = contractTokens(block)
    const bad = []
    t.forEach(function (x) {
      const key = CODE_KEY[x.name] || x.name
      const got = skinObj[key]
      if (typeof got !== 'string') bad.push(x.name + '→' + key + '：皮肤块里没有这个键')
      else if (got.toUpperCase() !== x.hex) bad.push(x.name + '→' + key + '：期望 ' + x.hex + '，实际 ' + got.toUpperCase())
    })
    if (bad.length) bad.forEach(function (b) { fail('一·反向', pair[0] + '：' + b) })
    else ok('SKINS.' + pair[0] + ' ' + t.length + ' 个 hex token 逐名字逐值对上')

    const rv = parseEntries(block).filter(function (e) { return e.kind === 'rgba' })
    const badRgba = []
    rv.forEach(function (e) {
      const key = CODE_KEY[e.name] || e.name
      const got = skinObj[key]
      if (typeof got !== 'string') badRgba.push(e.name + '→' + key + '：皮肤块里没有这个 rgba 键')
      else if (normRgba(got) !== normRgba(e.value)) {
        badRgba.push(e.name + '→' + key + '：期望 ' + e.value + '，实际 ' + got)
      }
    })
    if (badRgba.length) {
      badRgba.forEach(function (b) { fail('一·反向', pair[0] + '：' + b) })
    } else {
      ok('SKINS.' + pair[0] + ' ' + rv.length + ' 个 rgba token 逐名字逐值对上')
    }
  })

/* ================== 断言一·派生：ALPHA 表三步机验（规格 §9.4） ================== */
console.log('\n断言一 · 派生：ALPHA 每条 Base + α 必须能重建 §9 的 rgba 字面量')

const alphaTable = theme.alpha
if (!alphaTable || typeof alphaTable !== 'object') {
  fail('一·派生', 'theme.alpha 不存在 —— 规格 §9 的 ALPHA 表没有落地')
} else {
  /* 契约 rgba 槽位 → 字面量 + 它在 theme 导出里的落点 */
  const slotValue = {}
  const slotMeta = {}
  function addSlots(block, prefix, container, skin) {
    parseEntries(block).forEach(function (e) {
      if (e.kind !== 'rgba') return
      const key = (prefix ? prefix + '_' : '') + e.name
      slotValue[key] = e.value
      slotMeta[key] = { container: container, skin: skin, specName: e.name }
    })
  }
  addSlots(contState, '', 'color', null)
  addSlots(contPlaneArt, '', 'planeArt', null)
  addSlots(contAbyss, 'abyss', 'skin', 'abyss')
  addSlots(contDusk, 'dusk', 'skin', 'dusk')
  addSlots(contMono, 'mono', 'skin', 'mono')

  const contractNames = new Set()
  ;[contInteraction, contAlpha, contSem, contState, contSweep, contPlaneArt,
    contPlaceholder, contAbyss, contDusk, contMono, contAlias].forEach(function (b) {
    declaredNames(b).forEach(function (n) { contractNames.add(n) })
  })

  const declared = Object.keys(alphaTable)
    .filter(function (k) { return k.slice(-4) === 'Base' })
    .map(function (k) { return k.slice(0, -4) })

  const gapBad = []
  Object.keys(slotValue).forEach(function (k) {
    if (declared.indexOf(k) < 0) gapBad.push('ALPHA 表缺少 rgba 槽位 ' + k + ' 的 Base 登记')
  })
  declared.forEach(function (k) {
    if (!slotValue[k]) gapBad.push('ALPHA 表登记了 ' + k + '，但 §9 里没有这个 rgba 槽位')
  })
  if (gapBad.length) gapBad.forEach(function (b) { fail('一·派生', b) })
  else ok('ALPHA 表与 §9 rgba 槽位一一对应：' + declared.length + ' 条')

  /* 顶层冻结青：不进 color，也不是 primary 的别名（G2 的真实 bug 就在这里） */
  if (!theme.interaction || !/^#[0-9a-f]{6}$/i.test(String(theme.interaction.ok))) {
    fail('一·派生', 'theme.interaction.ok 必须是顶层冻结的 hex token')
  } else if (theme.color.interaction != null || theme.color.ok != null ||
             (theme.aliases || {}).ok != null || (theme.aliases || {}).interaction != null) {
    fail('一·派生', 'INTERACTION.ok 不得进 color，也不得登记成 primary 的别名')
  } else {
    ok('INTERACTION.ok 冻结在顶层，未进 color / aliases')
  }

  function rgbOf(v) {
    if (/^#[0-9a-f]{6}$/i.test(String(v))) {
      const s = String(v)
      return [parseInt(s.substr(1, 2), 16), parseInt(s.substr(3, 2), 16), parseInt(s.substr(5, 2), 16)]
    }
    const p = rgbaParts(v)
    return p ? [p[0], p[1], p[2]] : null
  }
  function resolveBase(name, key) {
    if (name === 'self') return slotValue[key]
    if (name === 'interactionOk') {
      return contractNames.has('ok') && theme.interaction ? theme.interaction.ok : null
    }
    if (!contractNames.has(name)) return null
    if (theme.color && theme.color[name] != null) return theme.color[name]
    if (theme.planeArt && theme.planeArt[name] != null) return theme.planeArt[name]
    return null
  }
  function codeValue(key, meta) {
    if (meta.container === 'color') return theme.color[key]
    if (meta.container === 'planeArt') return theme.planeArt[key]
    const skin = theme.skins && theme.skins[meta.skin]
    return skin ? skin[CODE_KEY[meta.specName] || meta.specName] : null
  }

  const stepBad = []
  let stepOK = 0
  let monoSkip = 0
  declared.forEach(function (key) {
    const meta = slotMeta[key]
    const baseName = alphaTable[key + 'Base']
    /* ① Base 指向的 token 在契约里存在 */
    const base = resolveBase(baseName, key)
    if (base == null || rgbOf(base) == null) {
      stepBad.push(key + '：Base ' + baseName + ' 在契约里不存在或不是颜色')
      return
    }
    let a = alphaTable[key + 'Alpha']
    const factor = alphaTable[key + 'Factor']
    const divisor = alphaTable[key + 'Divisor']
    if (typeof factor === 'number' || typeof divisor === 'number') {
      const baseAlpha = alphaOf(base)
      if (baseAlpha == null) {
        stepBad.push(key + '：Factor/Divisor 的 Base 没有 α 可供派生')
        return
      }
      /* 写公式不写结果：keelTail = 0.30 × 0.07；lightDim = 0.75 ÷ 2 */
      a = typeof factor === 'number' ? baseAlpha * factor : baseAlpha / divisor
      a = Number(a.toFixed(6))
    }
    if (typeof a !== 'number' || !isFinite(a)) {
      stepBad.push(key + '：α 不是有效数字')
      return
    }
    /* ② at(Base, α) 的结果 == 契约里该槽位的 rgba 字面量 */
    const rgb = rgbOf(base)
    const rebuilt = 'rgba(' + rgb[0] + ', ' + rgb[1] + ', ' + rgb[2] + ', ' + a + ')'
    if (normRgba(rebuilt) !== normRgba(slotValue[key])) {
      stepBad.push(key + '：at(' + baseName + ', ' + a + ') = ' + rebuilt +
        '，契约字面量是 ' + slotValue[key])
      return
    }
    /* ③ theme.js 导出值 == 字面量。mono 未落地，只验①②，不算它的账。 */
    if (meta.container === 'skin' && meta.skin === 'mono' && !(theme.skins && theme.skins.mono)) {
      monoSkip++
      stepOK++
      return
    }
    const got = codeValue(key, meta)
    if (typeof got !== 'string' || normRgba(got) !== normRgba(slotValue[key])) {
      stepBad.push(key + '：theme.js 导出 ' + String(got) + '，契约字面量是 ' + slotValue[key])
      return
    }
    stepOK++
  })
  if (stepBad.length) stepBad.forEach(function (b) { fail('一·派生', b) })
  else {
    ok('ALPHA ' + stepOK + ' 条三步机验通过' +
      (monoSkip ? '（其中 mono ' + monoSkip + ' 条只验①②，皮肤未落地）' : ''))
  }
}

/* STATE / SWEEP / PLANE_ART 三块：值不是 hex，用能认 rgba / 数字 / 数组的解析器。
 * 这三块以前整块漏在检查之外 —— 「漏掉」在检查里等于「验过了」。 */
reportBlock('STATE', compareBlock(contState, theme.color, 'color', null))
reportBlock('SWEEP', compareBlock(contSweep, theme.sweep, 'sweep', null))
reportBlock('PLANE_ART', compareBlock(contPlaneArt, theme.planeArt, 'planeArt', null))

/* 别名表也在契约里，所以它对不对也得验（同向：契约有的别名，代码必须有且指向同一个） */
const aliasRes = compareBlock(contAlias, theme.aliases || {}, 'aliases', null)
reportBlock('ALIASES', aliasRes)

/* 规格 §9.1 明确要求删掉 `cellEmpty`（恒等于 plate）。
 * 上一版这里是「它还在的话至少钉住同值」—— 那等于给它发了无限期许可证：
 * 一个恒等于别的 key 的 key，留着只是多一份会漂的副本，钉住它也没有任何信息量。 */
if (theme.color.cellEmpty != null) {
  fail('一·反向', 'cellEmpty 又出现了（= ' + theme.color.cellEmpty + '）—— 规格 §9.1 要求删除' +
    '\n             它恒等于 plate（boardBg），留着就是第二个真值：改一处忘一处，棋盘就花' +
    '\n             要空格底色就引用 boardBg，不要再立一个同名不同的键')
} else {
  ok('cellEmpty 已按 §9.1 删除（空格底色统一引用 boardBg）')
}

/* ================== 4. 断言二：飞机身份色逐对深比较 ================== */

console.log('\n断言二 · planePalette 逐对深比较（不是逐值计数）')

function specPairs(text, re) {
  const out = []
  let m
  while ((m = re.exec(text))) out.push([m[1].toUpperCase(), m[2].toUpperCase()])
  return out
}

/* 规格里同一组配对写了两遍：§3 的展示块、§9 的契约块。两块格式不同，只能各用一条正则。 */
const pairsSec = specPairs(md, /body (#[0-9a-f]{6})\s+head (#[0-9a-f]{6})/gi)
const pairsContract = specPairs(contAbyss + contDusk + contMono,
  /\{ body: '(#[0-9a-f]{6})', head: '(#[0-9a-f]{6})' \}/gi)

if (pairsSec.length !== 9) {
  fail('二', '规格 §3 只解析到 ' + pairsSec.length + ' 组 body/head，期望 9（三套 × 3 架）')
} else if (pairsContract.length !== 9) {
  fail('二', '规格 §9 只解析到 ' + pairsContract.length + ' 组 body/head，期望 9')
} else if (JSON.stringify(pairsSec) !== JSON.stringify(pairsContract)) {
  const where = []
  for (let i = 0; i < 9; i++) {
    if (JSON.stringify(pairsSec[i]) !== JSON.stringify(pairsContract[i])) {
      where.push('第 ' + (i + 1) + ' 组：§3 是 ' + pairsSec[i].join(' / ') +
        '，§9 是 ' + pairsContract[i].join(' / '))
    }
  }
  fail('二', '规格自己前后不一致（§3 展示块 vs §9 契约块）：\n             ' + where.join('\n             '))
} else {
  ok('规格内部自洽：§3 与 §9 的 9 组配对逐对相同')
}

const codePairs = theme.color.planePalette.map(function (p) {
  return [String(p.body).toUpperCase(), String(p.head).toUpperCase()]
})

if (codePairs.length !== 3) {
  fail('二', 'planePalette 有 ' + codePairs.length + ' 架，期望 3')
} else if (pairsSec.length === 9) {
  const bad = []
  for (let i = 0; i < 3; i++) {
    const want = pairsSec[i]
    const got = codePairs[i]
    if (got[0] !== want[0] || got[1] !== want[1]) {
      bad.push('第 ' + (i + 1) + ' 架：期望 body=' + want[0] + ' head=' + want[1] +
        '，实际 body=' + got[0] + ' head=' + got[1])
    }
  }
  if (bad.length) {
    bad.forEach(function (b) {
      fail('二', b + '\n             逐值计数在这里是绿的 —— 配错对时每个值仍然各出现两次')
    })
  } else {
    ok('代码 == 规格：3 架 ×（body, head）逐对相同')
    /* 反过来再确认一次「逐值计数抓不到配对漂移」这件事不是空话：
     * 代码里出现的 6 个值必须与规格那 6 个值集合相同（配对另算）。 */
    const codeVals = [].concat.apply([], codePairs)
    const specVals = [].concat.apply([], pairsSec.slice(0, 3))
    if (!sameSet(codeVals, specVals)) {
      fail('二', '机身/机头的**值集合**与规格不一致：多 ' + diff(codeVals, specVals).join(' ') +
        '，少 ' + diff(specVals, codeVals).join(' '))
    }
  }
}

/* ================== 5. 断言三：dusk 已落地且对齐；mono 仍未落地 ================== */

console.log('\n断言三 · dusk 必须逐名逐值落地；mono 独有色值仍 0 命中')

if (!theme.skins || !theme.skins.dusk) {
  fail('三', 'theme.skins.dusk 不存在 —— dusk 没有落地')
} else {
  const duskPairs = theme.skins.dusk.planePalette.map(function (p) {
    return [String(p.body).toUpperCase(), String(p.head).toUpperCase()]
  })
  const want = pairsSec.slice(3, 6)
  const bad = []
  for (let i = 0; i < 3; i++) {
    if (!want[i] || duskPairs[i][0] !== want[i][0] || duskPairs[i][1] !== want[i][1]) {
      bad.push('第 ' + (i + 1) + ' 架：期望 ' + (want[i] ? want[i].join(' / ') : '规格缺行') +
        '，实际 ' + duskPairs[i].join(' / '))
    }
  }
  if (bad.length) {
    bad.forEach(function (b) { fail('三', 'dusk 机身/机头配对错：' + b) })
  } else {
    ok('dusk 3 架 ×（body, head）逐对相同（§3.3 与 §9 一致）')
  }
}

/* mono 没落地：它的独有色值一个都不许出现在代码里（连注释也不行）。
 * dusk 的值已经合法，不能再算进「外来值」—— 否则一落地就会误报。 */
const foreign = new Set()
SET.mono.forEach(function (h) {
  if (!SET.abyss.has(h) && !SET.dusk.has(h) && !SET.sem.has(h)) foreign.add(h)
})

const leaked = []
codeValues.forEach(function (hex, p) {
  if (foreign.has(hex)) leaked.push(p + ' = ' + hex)
})
/* 源码文本也查：写在注释里同样是「提前混进来」的征兆（下一步就会有人照着注释改代码） */
const leakedInSrc = diff(Array.from(hexSet(srcRaw)), Array.from(codeValues.values()))
  .filter(function (h) { return foreign.has(h) })
  .map(function (h) { return '注释里 = ' + h })

const allLeaks = leaked.concat(leakedInSrc)
if (allLeaks.length) {
  allLeaks.forEach(function (s) {
    fail('三', s + '\n             期望：本期落地 abyss + dusk，mono 独有的值一个都不该在代码里' +
      '\n             实际：查到了 —— 换肤还没做，颜色先混进来了')
  })
} else {
  ok('mono 独有的 ' + foreign.size + ' 个色值，代码里 0 处出现',
    '（其中 planePalette 的 6 个也包含在这 ' + foreign.size + ' 个里）')
  const palMono = pairsSec.slice(6, 9)
  const hit = [].concat.apply([], palMono).filter(function (h) { return hexSet(srcRaw).has(h) })
  info('未落地皮肤 mono 的身份色 6 个，命中 ' + hit.length + ' 个' +
    (hit.length ? '（' + hit.join(' ') + '）' : ''))
}

/* ================== 6. 断言四：按键名查（值撞上了不算数） ================== */

console.log('\n断言四 · 每个键都要在 §9 里有**自己的位置**（同值不等于同义）')

/* 为什么按值查不够：`planeOffHead` 与 `abyss.frame` / `abyss.borderHi` **同值**，
 * 「每个色值都登记过」这条会放它过关 —— 而它一次都没被登记为「槽位关闭态」。
 * 等 dusk 落地（frame 换了），这个键就会带着一个属于 abyss 的配色留在代码里，绿着出去。
 *
 * 所以：值撞上了不算数。键本身得有位置。（规格 §9.2 第 4 点）
 */
const contractKeys = new Set()
;(function () {
  /* §9 是 js 代码块，先剥注释再抓键：注释里提到过 `speed` 这种词，不能算 */
  const body = stripComments(secContract)
  const re = /([A-Za-z_][A-Za-z0-9_]*)\s*:\s*('[^']*'|[\d.]+|\[)/g
  let m
  while ((m = re.exec(body))) contractKeys.add(m[1])
})()

/* 已登记 token 的「值 → 名字」反查表：判定「这个键是不是靠撞值蒙混过关」要用。
 * 五块都收：dusk / mono 虽然没落地，但它们占了这些值，
 * 一个撞在 dusk 上的键同样属于「同值不等于同义」。 */
const specValueNames = new Map()
;[contAbyss, contSem, contPlaceholder, contDusk, contMono].forEach(function (block) {
  contractTokens(block).forEach(function (t) {
    const names = specValueNames.get(t.hex) || []
    if (names.indexOf(t.name) < 0) names.push(t.name)
    specValueNames.set(t.hex, names)
  })
})

/* 两级判定，判据是**从数据自动算出来的**，不是一张手写名单：
 *
 *   硬失败 · 撞值缺席：键没有 §9 位置，但它的值恰好等于某个已登记 token 的值。
 *     这就是 planeOffHead 那一类 —— 按值检查会放它过关。
 *
 *   待登记 · 纯缺席：键没有位置，值也没跟谁撞上。这是**契约覆盖面比代码小**，
 *     不该让检查永远红，但也不该消失 —— 逐条打印，--strict 下判失败。
 *
 * **三个容器都查，不只 color。** 只查 color 的话，「把键挪出 color」就成了
 * 绕过断言四的正路 —— 而 v2.4 刚好把 11 个扫掠参数挪进了顶层 `sweep`。
 * 检查不跟着挪，「挪出去」就等于「不用查了」。
 */
const collideAbsent = []
const pureAbsent = []
const aliasOk = []
const aliasBroken = []
const ALIASES = (theme && theme.aliases) || {}

const CONTAINERS = [
  { label: 'color', obj: theme.color, rename: SPEC_KEY },
  { label: 'sweep', obj: theme.sweep, rename: null }
  /* planeArt 故意不在这里：它有 2 个派生值（keelTail / lightDim）本来就不是 token，
   * 而是「α×0.07」「α 减半」算出来的 —— 那属于 §9.3 G1，下面单独指路。
   * 塞进「待登记」会让这条永远清不了零，而它需要的不是一次决定，是一次公式化。 */
]

CONTAINERS.forEach(function (box) {
  const obj = box.obj
  if (!obj || typeof obj !== 'object') {
    fail('四', 'theme.' + box.label + ' 不存在或不是对象 —— 契约 §9 module.exports 里有它')
    return
  }
  Object.keys(obj).forEach(function (k) {
    const specName = (box.rename && box.rename[k]) || k
    if (contractKeys.has(specName)) return
    const where = 'theme.' + box.label + '.' + k

    /* 别名键（theme.aliases 声明了「我就是另一个 token」）走另一条路 ——
     * 「声明了」不等于「算通过」，两件事都得验：
     *   ① 源 token 自己得有契约位置（别名不能指向一个同样没登记的键）；
     *   ② 值真的跟着源 token 走（否则就是有人把值手工改回去了，别名成了谎话）。 */
    const alias = ALIASES[k]
    if (alias && box.label === 'color') {
      const aliasSpecName = SPEC_KEY[alias] || alias
      if (!contractKeys.has(aliasSpecName)) {
        aliasBroken.push(where + ' → ' + alias + '：源 token 自己也没有 §9 位置，别名解决不了这个问题')
        return
      }
      if (theme.color[k] !== theme.color[alias]) {
        aliasBroken.push(where + ' → ' + alias + '：声明是别名，值却不一样（' +
          String(theme.color[k]) + ' vs ' + String(theme.color[alias]) +
          '）—— 有人把值抄回去改了，声明已成谎话')
        return
      }
      aliasOk.push(where + ' → ' + alias)
      return
    }

    const v = obj[k]
    const names = (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v))
      ? (specValueNames.get(v.toUpperCase()) || [])
      : []
    if (names.length) collideAbsent.push({ where: where, specName: specName, hex: v.toUpperCase(), names: names })
    else pureAbsent.push({ where: where, specName: specName, v: String(v) })
  })
})

aliasBroken.forEach(function (b) {
  fail('四', 'theme.aliases 里的声明不成立：' + b +
    '\n             期望：别名指向的 token 有契约位置，且两者的值一致' +
    '\n             别名的意义是「让它跟着源 token 走」，不是「让检查闭嘴」')
})
aliasOk.forEach(function (a) {
  info('别名  ' + a.split(' → ')[0] + ' 派生于 ' + a.split(' → ')[1] +
    '（已验：源 token 有位置，值确实跟着走）')
})

if (!collideAbsent.length) {
  ok('没有「撞值蒙混」的键：位置之外的键要么是已声明的别名，要么值确实是它自己的')
} else {
  collideAbsent.forEach(function (c) {
    fail('四', c.where + ' 没有 §9 位置，但值 ' + c.hex +
      ' 与 ' + c.names.join(' / ') + ' 同值' +
      '\n             这条为什么是失败而不是提示：按值检查刚刚被它骗过去一次（同值不等于同义）' +
      '\n             期望：§9 里有一行 `' + c.specName + ': …` 说明它是什么；' +
      '\n             三条路：删掉它 / 在 theme.aliases 里声明它派生于 ' + c.names[0] +
      ' / 让 art 立一层（PLACEHOLDER 就是这么来的）')
  })
}

if (!pureAbsent.length) {
  const n = CONTAINERS.reduce(function (s, b) { return s + Object.keys(b.obj || {}).length }, 0)
  const list = CONTAINERS.map(function (b) {
    return b.label + ' ' + Object.keys(b.obj || {}).length
  }).join(' + ')
  ok(list + ' = ' + n + ' 个键都有归宿（自己的 §9 位置 / 已声明别名）')
} else {
  warn('契约覆盖缺口（不判失败，--strict 下判）：' + pureAbsent.length +
    ' 个键在 §9 里既无位置、也无别名、也没撞上谁 —— 契约的覆盖面比代码小，不是代码错')
  pureAbsent.forEach(function (a) {
    info('待登记  ' + a.where + '（§9 里应有一行 `' + a.specName + ': …`）当前值 ' + a.v)
  })
}

/* planeArt 的派生值：PR-5 起 keelTail / lightDim 已有自己的 token 行（§9 PLANE_ART），
 * 派生关系登记在 ALPHA 表（Factor / Divisor），字面量只是 checker 的断言锚点。
 *
 * 旧版从 §9.3 G1 表格行的反引号里抓名字，规范一重写解析就失效 —— fail-closed
 * 但报错误导。现在从 ALPHA 表抓：planeArt 里 Base ≠ 'self' 的键就是派生值。
 * 守卫不撤：往 planeArt 加新键不能绕过断言四 —— 既不在契约 token 行、
 * 又没在 ALPHA 表登记为派生，一律硬失败。 */
;(function () {
  const alpha = theme.alpha || {}
  const derived = Object.keys(theme.planeArt || {}).filter(function (k) {
    return alpha[k + 'Base'] && alpha[k + 'Base'] !== 'self'
  })
  const extras = Object.keys(theme.planeArt || {}).filter(function (k) {
    return !contractKeys.has(k) && derived.indexOf(k) < 0
  })

  if (extras.length) {
    extras.forEach(function (k) {
      fail('四', 'theme.planeArt.' + k + ' 既不在契约 token 行里，也不在 ALPHA 表登记为派生值' +
        '\n             期望：要么给它一个 §9 位置，要么在 ALPHA 表里写清它派生于谁' +
        '\n             实际：两边都没有 —— 这条不能算「已知缺口」，它只是个没登记的新键')
    })
  }
  const noFormula = derived.filter(function (k) {
    return alpha[k + 'Factor'] == null && alpha[k + 'Divisor'] == null
  })
  if (noFormula.length) {
    noFormula.forEach(function (k) {
      fail('四', 'theme.planeArt.' + k + ' 在 ALPHA 表里声明了 Base，却没有 Factor/Divisor' +
        '\n             派生值要写公式不写结果；只写 Base + Alpha 等于又抄了一份字面量')
    })
  } else if (derived.length) {
    info('planeArt 派生值（ALPHA 表登记，公式化）：' + derived.join(' / '))
  }
})()

/* ================== 7. 必须不存在的键（§9.1 反面表） ================== */

console.log('\n断言五 · §9.1「必须不存在的键」：查的是存不存在，不是值对不对')

/* 这张表是从规格里**抓**出来的，不是在这里手抄一份 —— 手抄的清单本身就是会漏改的副本。
 * 「待登记」这个分类藏了个陷阱：它假定「现有的键都该被登记」，而死键的正确归宿是删除。
 * 判据不是「它在不在 theme.js 里」，是「**它画不画到屏上**」。 */
const secNotExist = slice(md, '**必须不存在的键**', '### 9.2')
const mustNotExist = []
;(String(secNotExist).match(/^\|\s*`([A-Za-z_][A-Za-z0-9_]*)`\s*\|/gm) || []).forEach(function (row) {
  const m = /`([A-Za-z_][A-Za-z0-9_]*)`/.exec(row)
  if (m && mustNotExist.indexOf(m[1]) < 0) mustNotExist.push(m[1])
})

if (!mustNotExist.length) {
  fail('五', '规格 §9.1 的「必须不存在的键」表解析到 0 行 —— 表格格式变了，这条检查等于不存在')
} else {
  /* 绘制引用的形态：`c.disabled` / `theme.color.disabled` / `color.disabled` / `pal.disabled`。
   * **不能只查 `.disabled`** —— `z.disabled` / `button.disabled` 在字符串层面长得一样，
   * 只有「谁是接收者」能分开。这正是规格那一栏写「绘制引用」三个字的原因。 */
  const DRAW_REF = function (key) {
    return new RegExp('\\b(?:c|color|pal|theme\\.color|o\\.palette)\\.' + key + '\\b')
  }
  const BARE = function (key) { return new RegExp('\\b' + key + '\\b') }

  const jsFiles = []
  ;(function walk(dir) {
    fs.readdirSync(dir).forEach(function (name) {
      const p = path.join(dir, name)
      const st = fs.statSync(p)
      if (st.isDirectory()) walk(p)
      else if (/\.js$/.test(name)) jsFiles.push(p)
    })
  })(path.join(ROOT, 'minigame', 'js'))

  mustNotExist.forEach(function (key) {
    const inColor = Object.prototype.hasOwnProperty.call(theme.color, key)
    const refs = []
    let bare = 0
    jsFiles.forEach(function (f) {
      const lines = fs.readFileSync(f, 'utf8').split('\n')
      lines.forEach(function (l, i) {
        if (BARE(key).test(l)) bare++
        if (DRAW_REF(key).test(l)) {
          refs.push(path.relative(ROOT, f).replace(/\\/g, '/') + ':' + (i + 1))
        }
      })
    })
    if (inColor || refs.length) {
      fail('五', 'theme.color.' + key + ' 必须不存在（规格 §9.1 反面表）' +
        (inColor ? '\n             实际：theme.color 里还有这个键' : '') +
        (refs.length ? '\n             实际：还有 ' + refs.length + ' 处绘制引用 → ' + refs.join('、') : '') +
        '\n             期望：0 处绘制引用。死键的正确归宿是删除，不是登记')
    } else {
      ok(key + ' 已不存在',
        bare ? '（另 ' + bare + ' 处同名但非绘制引用，是交互标志，不算）' : '（全仓 0 处同名出现）')
    }
  })
}



console.log('\n自检 · 检查脚本不许含色值字面量（否则会数到自己）')

const selfSrc = fs.readFileSync(__filename, 'utf8')
if (HAS_HEX_RE.test(selfSrc)) {
  const offenders = selfSrc.split('\n').map(function (l, i) {
    return HAS_HEX_RE.test(l) ? '第 ' + (i + 1) + ' 行' : null
  }).filter(Boolean)
  fail('自检', '本文件里出现了色值字面量：' + offenders.join('、') +
    '\n             期望：只用 #[0-9a-f]{6} 这种模式。内嵌在被检对象里的检查，' +
    '先问一句「它会不会数到自己」')
} else {
  ok('本文件 0 个色值字面量（' + (selfSrc.length) + ' 字节全文扫过）')
}

/* ================== 收尾 ================== */

console.log('\n' + '-'.repeat(56))
if (fails.length) {
  console.log('通过 ' + pass + ' 项，失败 ' + fails.length + ' 项：')
  fails.forEach(function (f) { console.log('  \u2717 ' + f) })
  console.log('-'.repeat(56) + '\n')
  process.exit(1)
}

if (STRICT && warns.length) {
  console.log('通过 ' + pass + ' 项；但 --strict 下「待处理项」也算失败（' + warns.length + ' 条）：')
  warns.forEach(function (w) { console.log('  \u2717 ' + w) })
  console.log('-'.repeat(56) + '\n')
  process.exit(1)
}

console.log('通过 ' + pass + ' 项，失败 0 项' +
  (warns.length ? '（另有 ' + warns.length + ' 条待处理项，' +
    (STRICT ? '--strict 下会失败' : '用 --strict 可让它们失败') + '）' : ''))
console.log('-'.repeat(56) + '\n')
process.exit(0)
