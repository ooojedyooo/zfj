// minigame/js/core/audio.js
// 程序化音频引擎 —— Web Audio 振荡器 / 噪声合成，零音频文件。
//
// 契约来源：design/audio/audio-spec.md §8（常量逐字照抄）、§2.1-2.16（合成配方）、
//           §3.1（皮肤 3 参数）、§4（音量/优先级/duck）、§5（氛围）、§6（静音）、§7.3（T-08）。
//
// ⚠ 所有增益 / 包络 / 频率数值均为「暂定，真机听感验证」（规格 §0.1）。
//   代码注释不把它们写成已验证定值。
//
// 零回归约定：测试桩没有 wx.createWebAudioContext（scripts/lib/wx-stub.js:76-98、
//   scripts/test-layout.js:27-38），此时 createAudio() 返回完整 no-op，
//   play/scene/setSkin/... 全部为空函数，205 项测试不受影响。

'use strict'

/* ==================================================================
 * §8 工程常量契约 —— 逐字照抄，不得改名 / 改值
 * ================================================================== */
const AUDIO = {
  MASTER_GAIN: 0.8,
  MASTER_LP_HZ: 7000,
  LIMITER: { thresholdDb: -6, kneeDb: 0, ratio: 20, attackS: 0.003, releaseS: 0.15 },
  BUS_SFX_GAIN: 1.0,
  BUS_AMB_GAIN: 0.03,          // duck 时 0.012，60ms 降 / 500ms 保持 / 800ms 回
  VOICES_MAX: 6,
  DEBOUNCE_MS: 40,
  NOISE_BUFFER_SEC: 0.5,       // 运行时生成，约 88 KB
  STORAGE_KEY_MUTED: 'audio.muted',
  SKIN: {
    abyss: { WAVE: 'sine', LP_SCALE: 0.75, TAIL_SCALE: 0.70 },
    dusk: { WAVE: 'triangle', LP_SCALE: 1.15, TAIL_SCALE: 1.30 }
  },
  SKIN_INVARIANT_EVENTS: ['sfx.deploy.invalid', 'sfx.tick', 'sfx.tick.urgent'],
  SFX: {
    UI_TAP: 'sfx.ui.tap', SKIN: 'sfx.skin', ROOM_ENTER: 'sfx.room.enter',
    DEPLOY_PLACE: 'sfx.deploy.place', DEPLOY_ROTATE: 'sfx.deploy.rotate',
    DEPLOY_INVALID: 'sfx.deploy.invalid', DEPLOY: 'sfx.deploy',
    ROUND_START: 'sfx.round.start', FIRE: 'sfx.fire', MISS: 'sfx.miss',
    HIT: 'sfx.hit', KILL: 'sfx.kill', TICK: 'sfx.tick', TICK_URGENT: 'sfx.tick.urgent',
    WIN: 'sfx.win', LOSE: 'sfx.lose'
  },
  AMB: { LOBBY: 'amb.lobby', BATTLE: 'amb.battle', CROSSFADE_S: 1.5 }
}

/** 优先级（§4.2）。P0 抢占、P1/P2 共存受上限、P3 满则丢。 */
const PRIORITY = {
  'sfx.kill': 0, 'sfx.win': 0, 'sfx.lose': 0,
  'sfx.hit': 1, 'sfx.miss': 1, 'sfx.fire': 1,
  'sfx.deploy': 2, 'sfx.deploy.place': 2, 'sfx.deploy.rotate': 2,
  'sfx.deploy.invalid': 2, 'sfx.skin': 2, 'sfx.room.enter': 2, 'sfx.round.start': 2,
  'sfx.tick': 3, 'sfx.tick.urgent': 3, 'sfx.ui.tap': 3
}

/* ==================================================================
 * §2 合成配方表（数据驱动）
 *
 * voice 字段：
 *   k:'osc'    wave:'theme'|'sine'|'triangle'|'square'|'sawtooth'
 *              f0,f1(Hz) · slide(频率_scans ms) · dur(包络 ms) · atk(ms)
 *              gain(相对事件) · lp(Hz) · hp/bp(Hz) · q · at(ms 偏移)
 *   k:'noise'  dur(ms) · lp/hp/bp(Hz) · lpFrom/lpTo(扫频 Hz) · q
 *              gain(相对事件) · at(ms 偏移)
 *   sw:skinWave(是否随皮肤换波形) · sl:skinLP(是否随皮肤缩放截止)
 *   st:skinTail(是否随皮肤缩放尾长)
 * 这些数值全部是「暂定，真机听感验证」。
 * ================================================================== */
const R = {}
const S = AUDIO.SFX

// 2.1 sfx.ui.tap —— 波形 + 尾长跟随；频率/滤波/增益恒定
R[S.UI_TAP] = {
  gain: 0.30, voices: [
    { k: 'osc', wave: 'theme', sw: true, f0: 880, f1: 620, slide: 30, dur: 38, atk: 2, lp: 4000, gain: 1 }
  ]
}
// 2.2 sfx.skin —— 尾长跟随；音高 / 五度关系恒定
R[S.SKIN] = {
  gain: 0.40, voices: [
    { k: 'osc', wave: 'sine', f0: 523, f1: 523, dur: 90, atk: 4, lp: 5000, gain: 1, at: 0, st: true },
    { k: 'osc', wave: 'sine', f0: 784, f1: 784, dur: 90, atk: 4, lp: 5000, gain: 1, at: 70, st: true }
  ]
}
// 2.3 sfx.room.enter —— 波形 + 尾长跟随；滤波恒定
R[S.ROOM_ENTER] = {
  gain: 0.35, voices: [
    { k: 'osc', wave: 'theme', sw: true, f0: 392, f1: 392, dur: 190, atk: 25, lp: 3500, gain: 0.5, st: true },
    { k: 'osc', wave: 'theme', sw: true, f0: 523, f1: 523, dur: 190, atk: 25, lp: 3500, gain: 0.5, st: true }
  ]
}
// 2.4 sfx.deploy.place —— 波形 + 截止 + 尾长全跟随
R[S.DEPLOY_PLACE] = {
  gain: 0.50, voices: [
    { k: 'osc', wave: 'theme', sw: true, sl: true, st: true, f0: 300, f1: 180, slide: 90, dur: 110, atk: 1, lp: 3500, gain: 1 },
    { k: 'noise', dur: 12, bp: 2500, q: 1, gain: 0.25 }
  ]
}
// 2.5 sfx.deploy.rotate —— 波形 + 尾长跟随；频率/滤波恒定
R[S.DEPLOY_ROTATE] = {
  gain: 0.35, voices: [
    { k: 'osc', wave: 'theme', sw: true, st: true, f0: 520, f1: 640, slide: 45, dur: 55, atk: 1, lp: 4000, gain: 1 },
    { k: 'noise', dur: 8, hp: 1500, gain: 0.20 }
  ]
}
// 2.6 sfx.deploy.invalid —— 全恒定（SKIN_INVARIANT）；恒 <1 kHz
R[S.DEPLOY_INVALID] = {
  gain: 0.40, voices: [
    { k: 'osc', wave: 'square', f0: 160, f1: 140, slide: 140, dur: 150, atk: 8, lp: 900, gain: 0.85 },
    { k: 'osc', wave: 'square', f0: 150, f1: 150, dur: 150, atk: 8, lp: 900, gain: 0.25 } // 轻微失谐拍频（暂定）
  ]
}
// 2.7 sfx.deploy —— 三音上行，波形 + 尾长跟随，音高恒定
R[S.DEPLOY] = {
  gain: 0.70, voices: [
    { k: 'osc', wave: 'theme', sw: true, st: true, f0: 392, f1: 392, dur: 150, atk: 5, lp: 5000, gain: 1, at: 0 },
    { k: 'osc', wave: 'theme', sw: true, st: true, f0: 523, f1: 523, dur: 150, atk: 5, lp: 5000, gain: 1, at: 90 },
    { k: 'osc', wave: 'theme', sw: true, st: true, f0: 659, f1: 659, dur: 150, atk: 5, lp: 5000, gain: 1, at: 180 }
  ]
}
// 2.8 sfx.round.start —— 波形 + 尾长跟随；音高/滤波恒定
R[S.ROUND_START] = {
  gain: 0.50, voices: [
    { k: 'osc', wave: 'theme', sw: true, st: true, f0: 659, f1: 659, dur: 220, atk: 15, lp: 4500, gain: 0.6 },
    { k: 'osc', wave: 'sine', st: true, f0: 330, f1: 330, dur: 220, atk: 15, lp: 4500, gain: 0.4 }
  ]
}
// 2.9 sfx.fire —— 波形 + 截止 + 尾长跟随（扫频终点按 LP_SCALE）
R[S.FIRE] = {
  gain: 0.60, voices: [
    { k: 'osc', wave: 'theme', sw: true, sl: true, st: true, f0: 240, f1: 60, slide: 150, dur: 160, atk: 1, lp: 4000, gain: 1 },
    { k: 'noise', dur: 90, lpFrom: 4000, lpTo: 600, gain: 0.35, sl: true }
  ]
}
// 2.10 sfx.miss —— 尾长 + 截止跟随；全噪声主导恒定
R[S.MISS] = {
  gain: 0.45, voices: [
    { k: 'noise', dur: 220, bpFrom: 1200, bpTo: 400, gain: 1, sl: true, st: true },
    { k: 'osc', wave: 'sine', st: true, f0: 300, f1: 200, slide: 120, dur: 120, atk: 1, lp: 2500, gain: 0.30 }
  ]
}
// 2.11 sfx.hit —— 波形 + 截止 + 尾长跟随；1.49 频率比恒定
R[S.HIT] = {
  gain: 0.65, voices: [
    { k: 'osc', wave: 'theme', sw: true, sl: true, st: true, f0: 900, f1: 520, slide: 130, dur: 180, atk: 2, lp: 4500, gain: 1 },
    { k: 'osc', wave: 'theme', sw: true, sl: true, st: true, f0: 1340, f1: 1340, dur: 180, atk: 2, lp: 4500, gain: 0.5 },
    { k: 'noise', dur: 25, hp: 2000, gain: 0.2 }
  ]
}
// 2.12 sfx.kill —— 三段；时序 0/90/180ms 恒定
R[S.KILL] = {
  gain: 0.90, voices: [
    { k: 'osc', wave: 'theme', sw: true, sl: true, st: true, f0: 720, f1: 180, slide: 220, dur: 220, atk: 1, lp: 4000, gain: 1, at: 0 },
    { k: 'noise', dur: 60, hp: 1500, gain: 0.35, at: 0 },
    { k: 'osc', wave: 'theme', sw: true, sl: true, st: true, f0: 140, f1: 45, slide: 350, dur: 350, atk: 1, lp: 2000, gain: 0.9, at: 90 },
    { k: 'noise', dur: 300, lpFrom: 1200, lpTo: 200, gain: 0.4, sl: true, at: 90 },
    { k: 'osc', wave: 'sine', sl: true, st: true, f0: 600, f1: 200, slide: 300, dur: 300, atk: 1, lp: 3000, gain: 0.25, at: 180 }
  ]
}
// 2.13 sfx.tick —— 全恒定（SKIN_INVARIANT）
R[S.TICK] = {
  gain: 0.22, voices: [
    { k: 'osc', wave: 'sine', f0: 1000, f1: 1000, dur: 25, atk: 1, lp: 3000, gain: 1 }
  ]
}
// 2.14 sfx.tick.urgent —— 全恒定（SKIN_INVARIANT）
R[S.TICK_URGENT] = {
  gain: 0.50, voices: [
    { k: 'osc', wave: 'triangle', f0: 1500, f1: 1500, dur: 45, atk: 1, lp: 4500, gain: 1, at: 0 },
    { k: 'osc', wave: 'triangle', f0: 1650, f1: 1650, dur: 45, atk: 1, lp: 4500, gain: 1, at: 110 }
  ]
}
// 2.15 sfx.win —— 四音分解 + 低根；波形/截止/尾长跟随
R[S.WIN] = {
  gain: 0.85, voices: [
    { k: 'osc', wave: 'theme', sw: true, sl: true, st: true, f0: 523, f1: 523, dur: 300, atk: 5, lp: 6000, gain: 0.8, at: 0 },
    { k: 'osc', wave: 'theme', sw: true, sl: true, st: true, f0: 659, f1: 659, dur: 300, atk: 5, lp: 6000, gain: 0.8, at: 110 },
    { k: 'osc', wave: 'theme', sw: true, sl: true, st: true, f0: 784, f1: 784, dur: 300, atk: 5, lp: 6000, gain: 0.8, at: 220 },
    { k: 'osc', wave: 'theme', sw: true, sl: true, st: true, f0: 1047, f1: 1047, dur: 600, atk: 5, lp: 6000, gain: 1, at: 330 },
    { k: 'osc', wave: 'sine', st: true, f0: 262, f1: 262, dur: 550, atk: 20, lp: 6000, gain: 0.5, at: 330 }
  ]
}
// 2.16 sfx.lose —— 三音下行 + 低根
R[S.LOSE] = {
  gain: 0.70, voices: [
    { k: 'osc', wave: 'theme', sw: true, sl: true, st: true, f0: 440, f1: 440, dur: 350, atk: 12, lp: 3500, gain: 0.8, at: 0 },
    { k: 'osc', wave: 'theme', sw: true, sl: true, st: true, f0: 370, f1: 370, dur: 350, atk: 12, lp: 3500, gain: 0.8, at: 160 },
    { k: 'osc', wave: 'theme', sw: true, sl: true, st: true, f0: 294, f1: 294, dur: 350, atk: 12, lp: 3500, gain: 0.8, at: 320 },
    { k: 'osc', wave: 'sine', st: true, f0: 147, f1: 147, dur: 450, atk: 25, lp: 3500, gain: 0.5, at: 480 }
  ]
}

const PENTA = [440, 523, 659, 784, 880] // §5.2 五声音阶（算得）

/* ==================================================================
 * 小工具
 * ================================================================== */
function noop() {}
function hasWebAudio() {
  return typeof wx !== 'undefined' && !!wx && typeof wx.createWebAudioContext === 'function'
}

/** 包络：先短线性起音，再指数衰减到 0.0001（绝不 ramp 到 0，Web Audio 会抛错）。 */
function envelope(param, t, peak, durMs, atkMs) {
  const p = Math.max(0.0001, peak)
  const d = Math.max(0.01, durMs / 1000)
  const a = Math.max(0, (atkMs || 0) / 1000)
  if (a > 0) {
    param.setValueAtTime(0.0001, t)
    param.linearRampToValueAtTime(p, t + Math.min(a, d * 0.5))
  } else {
    param.setValueAtTime(p, t)
  }
  param.exponentialRampToValueAtTime(0.0001, t + d)
}

/** 频率扫描（正数，指数插值更贴合听感）。 */
function sweepFreq(param, f0, f1, t, ms) {
  param.setValueAtTime(Math.max(1, f0), t)
  if (f1 !== f0) param.exponentialRampToValueAtTime(Math.max(1, f1), t + Math.max(0.005, ms / 1000))
}

function noopAudio() {
  return {
    isNoop: true,
    play: noop, scene: noop, setSkin: noop, setMuted: noop, getMuted: function () { return false },
    unlock: noop, suspend: noop, resume: noop, destroy: noop, step: noop
  }
}

/* ==================================================================
 * 引擎
 * ================================================================== */
function createAudio() {
  if (!hasWebAudio()) return noopAudio()

  let ctx = null
  let master, masterLP, limiter, busSfx, busAmb, noiseBuf
  let skin = 'abyss'
  let muted = false
  let unlocked = false
  let active = []                 // 活跃声部 { id, priority, stop, gain, born }
  let lastAt = {}                 // 同 ID 去抖
  let lastTapAt = -1e9            // 跨事件 tap↔fire 60ms 去重
  let lastTapVoices = []
  let lastResult = null           // { id, at } —— hit/kill 100ms 去重（§4.2）
  let ambScene = ''               // 当前氛围 ID
  let drones = {}                 // 两套常开铺底
  let timer = null                // look-ahead 调度器
  let nextAmbientAt = 0
  let nextPulseAt = 0

  /* ---- 图构建（首个手势时） ---- */
  function buildGraph() {
    const makeCtx = typeof wx.createWebAudioContext === 'function' ? wx.createWebAudioContext : null
    ctx = makeCtx()
    if (!ctx || typeof ctx.createGain !== 'function') { ctx = null; return false }

    busSfx = ctx.createGain()
    busSfx.gain.value = AUDIO.BUS_SFX_GAIN
    busAmb = ctx.createGain()
    busAmb.gain.value = AUDIO.BUS_AMB_GAIN

    master = ctx.createGain()
    master.gain.value = AUDIO.MASTER_GAIN
    masterLP = ctx.createBiquadFilter()
    masterLP.type = 'lowpass'
    masterLP.frequency.value = AUDIO.MASTER_LP_HZ
    masterLP.Q.value = 0.707

    limiter = ctx.createDynamicsCompressor()
    const L = AUDIO.LIMITER
    limiter.threshold.value = L.thresholdDb
    limiter.knee.value = L.kneeDb
    limiter.ratio.value = L.ratio
    limiter.attack.value = L.attackS
    limiter.release.value = L.releaseS

    busSfx.connect(master)
    busAmb.connect(master)
    master.connect(masterLP)
    masterLP.connect(limiter)
    if (ctx.destination) limiter.connect(ctx.destination)

    // 噪声缓冲：1 份 0.5s mono 白噪，所有噪声层共用（§1.1）
    try {
      const rate = ctx.sampleRate || 44100
      const len = Math.floor(AUDIO.NOISE_BUFFER_SEC * rate)
      noiseBuf = ctx.createBuffer(1, len, rate)
      const data = noiseBuf.getChannelData(0)
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    } catch (e) { noiseBuf = null }

    buildDrones()
    return true
  }

  /** 两套常开 drone：osc → lp → breath(LFO ±20%) → sceneGain(交叉淡入) → busAmb */
  function buildDrones() {
    function one(f1, f2, lpHz) {
      if (typeof ctx.createOscillator !== 'function' || typeof ctx.createBiquadFilter !== 'function') return null
      const lp = ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = lpHz
      const breath = ctx.createGain()
      breath.gain.value = 1
      const sceneGain = ctx.createGain()
      sceneGain.gain.value = 0
      try {
        const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = f1
        const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f2
        o1.connect(lp); o2.connect(lp); lp.connect(breath); breath.connect(sceneGain); sceneGain.connect(busAmb)
        o1.start(); o2.start()
      } catch (e) { return null }
      return { sceneGain: sceneGain, breath: breath }
    }
    drones[AUDIO.AMB.LOBBY] = one(110, 165, 800)   // §5.2
    drones[AUDIO.AMB.BATTLE] = one(98, 147, 700)   // §5.3
    try {
      const lfo = ctx.createOscillator()
      const amt = ctx.createGain()
      lfo.type = 'sine'; lfo.frequency.value = 0.1  // 10s 呼吸
      amt.gain.value = 0.2
      lfo.connect(amt)
      Object.keys(drones).forEach(function (k) { if (drones[k]) amt.connect(drones[k].breath.gain) })
      lfo.start()
    } catch (e) { /* LFO 不可用则铺底恒定，不影响功能 */ }
  }

  function skinParams(id) {
    return AUDIO.SKIN[id] || AUDIO.SKIN.abyss
  }

  /** §3：3 参数一次性应用到 voice 描述；SKIN_INVARIANT 事件原样返回。 */
  function applySkinToVoice(v, eventId) {
    const out = Object.assign({}, v)
    if (AUDIO.SKIN_INVARIANT_EVENTS.indexOf(eventId) >= 0) return out
    const p = skinParams(skin)
    if (v.sw && v.wave === 'theme') out.wave = p.WAVE
    if (v.sl) {
      if (v.lp) out.lp = Math.min(AUDIO.MASTER_LP_HZ, v.lp * p.LP_SCALE)
      if (v.lpFrom) out.lpFrom = Math.min(AUDIO.MASTER_LP_HZ, v.lpFrom * p.LP_SCALE)
      if (v.lpTo) out.lpTo = Math.min(AUDIO.MASTER_LP_HZ, v.lpTo * p.LP_SCALE)
      if (v.bpFrom) out.bpFrom = Math.min(AUDIO.MASTER_LP_HZ, v.bpFrom * p.LP_SCALE)
      if (v.bpTo) out.bpTo = Math.min(AUDIO.MASTER_LP_HZ, v.bpTo * p.LP_SCALE)
    }
    if (v.st && v.dur) out.dur = v.dur * p.TAIL_SCALE
    return out
  }

  /* ---- 单个声部调度 ---- */
  function scheduleVoice(v, eventId, eventPeak, when, bus) {
    const p = applySkinToVoice(v, eventId)
    const t = when + (p.at || 0) / 1000
    let src = null
    let param = null
    const nodes = []

    if (p.k === 'osc') {
      if (typeof ctx.createOscillator !== 'function') return
      src = ctx.createOscillator()
      src.type = p.wave || 'sine'
      sweepFreq(src.frequency, p.f0, p.f1, t, p.slide || 0)
      param = src
    } else {
      if (!noiseBuf || typeof ctx.createBufferSource !== 'function') return
      src = ctx.createBufferSource()
      src.buffer = noiseBuf
      param = src
    }

    let tail = src
    if (p.k === 'noise' && (p.lp || p.lpFrom || p.hp || p.bp || p.bpFrom)) {
      if (typeof ctx.createBiquadFilter !== 'function') return
      const f = ctx.createBiquadFilter()
      if (p.lpFrom && p.lpTo) {
        f.type = 'lowpass'
        f.frequency.setValueAtTime(Math.max(30, p.lpFrom), t)
        f.frequency.exponentialRampToValueAtTime(Math.max(30, p.lpTo), t + Math.max(0.01, p.dur / 1000))
      } else if (p.bpFrom && p.bpTo) {
        f.type = 'bandpass'
        f.frequency.setValueAtTime(Math.max(30, p.bpFrom), t)
        f.frequency.exponentialRampToValueAtTime(Math.max(30, p.bpTo), t + Math.max(0.01, p.dur / 1000))
      } else if (p.lp) { f.type = 'lowpass'; f.frequency.setValueAtTime(p.lp, t) }
      else if (p.hp) { f.type = 'highpass'; f.frequency.setValueAtTime(p.hp, t) }
      else if (p.bp) { f.type = 'bandpass'; f.frequency.setValueAtTime(p.bp, t) }
      if (p.q != null) f.Q.value = p.q
      tail.connect(f); tail = f; nodes.push(f)
    } else if (p.k === 'osc' && p.lp) {
      if (typeof ctx.createBiquadFilter !== 'function') return
      const f = ctx.createBiquadFilter()
      f.type = 'lowpass'
      f.frequency.setValueAtTime(Math.max(30, p.lp), t)
      tail.connect(f); tail = f; nodes.push(f)
    }

    const g = ctx.createGain()
    envelope(g.gain, t, Math.max(0.0002, eventPeak * p.gain), p.dur, p.atk)
    tail.connect(g); g.connect(bus); nodes.push(g)

    let stopped = false
    const stop = function (fadeMs) {
      if (stopped) return
      stopped = true
      const now = ctx.currentTime
      const fsec = Math.max(0.005, (fadeMs || 30) / 1000)
      try {
        g.gain.cancelScheduledValues(now)
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now)
        g.gain.exponentialRampToValueAtTime(0.0001, now + fsec)
        src.stop(now + fsec + 0.01)
      } catch (e) { /* 已 stop */ }
    }
    try {
      if (p.k === 'noise') {
        const off = noiseBuf.duration > 0 ? Math.random() * Math.max(0, noiseBuf.duration - p.dur / 1000 - 0.01) : 0
        src.start(t, off, Math.max(0.01, p.dur / 1000 + 0.02))
      } else {
        src.start(t)
      }
      src.stop(t + Math.max(0.02, p.dur / 1000 + (p.at || 0) / 1000 + 0.05))
    } catch (e) { stopped = true }

    const rec = { id: eventId, priority: PRIORITY[eventId] == null ? 2 : PRIORITY[eventId], stop: stop, gain: g, born: ctx.currentTime }
    active.push(rec)
    src.onended = function () {
      const i = active.indexOf(rec)
      if (i >= 0) active.splice(i, 1)
      nodes.forEach(function (n) { try { n.disconnect() } catch (e) {} })
      try { g.disconnect() } catch (e) {}
    }
    return rec
  }

  /** P0 duck（§4.2）：60ms 降到 0.012，保持 500ms，800ms 回 0.03。 */
  function duckAmbience() {
    if (!ctx || !busAmb) return
    const t = ctx.currentTime
    const low = AUDIO.BUS_AMB_GAIN * 0.4
    try {
      busAmb.gain.cancelScheduledValues(t)
      busAmb.gain.setValueAtTime(AUDIO.BUS_AMB_GAIN, t)
      busAmb.gain.linearRampToValueAtTime(low, t + 0.06)
      busAmb.gain.setValueAtTime(low, t + 0.56)
      busAmb.gain.linearRampToValueAtTime(AUDIO.BUS_AMB_GAIN, t + 1.36)
    } catch (e) { /* 参数自动化不可用则忽略 */ }
  }

  /** 声部预算：P3 满则丢；P0 抢占低优先级；P1/P2 超载停最老。 */
  function makeRoom(priority) {
    if (active.length < AUDIO.VOICES_MAX) return true
    if (priority === 3) return false
    const victims = active.filter(function (r) { return r.priority > priority })
    if (victims.length) { victims.slice(0, 2).forEach(function (r) { r.stop(30) }); return true }
    const oldest = active.slice().sort(function (a, b) { return a.born - b.born })[0]
    if (oldest && oldest.priority >= priority) { oldest.stop(30); return true }
    return false
  }

  function play(id) {
    if (!ctx || !unlocked || muted) return
    if (ctx.state === 'suspended') return
    const recipe = R[id]
    if (!recipe) return
    const now = ctx.currentTime * 1000
    // 同 ID 去抖 40ms
    if (now - (lastAt[id] || -1e9) < AUDIO.DEBOUNCE_MS) return
    lastAt[id] = now

    // §4.2 击毁盖过命中：100ms 窗口内 hit 与 kill 都到 → 只播 kill
    if (id === S.HIT && lastResult && lastResult.id === S.KILL && now - lastResult.at < 100) return
    if (id === S.KILL || id === S.HIT || id === S.MISS) lastResult = { id: id, at: now }

    const priority = PRIORITY[id] == null ? 2 : PRIORITY[id]
    if (!makeRoom(priority)) return

    // 跨事件 tap↔fire 60ms：fire 触发时把刚播的 tap 快速淡出（v1.1 裁决）
    if (id === S.FIRE && now - lastTapAt < 60 && lastTapVoices.length) {
      lastTapVoices.forEach(function (v) { v.stop(25) })
      lastTapVoices = []
    }

    const when = ctx.currentTime + 0.01
    const made = []
    recipe.voices.forEach(function (v) {
      const rec = scheduleVoice(v, id, recipe.gain, when, busSfx)
      if (rec) made.push(rec)
    })
    if (id === S.UI_TAP) { lastTapAt = now; lastTapVoices = made }
    if (priority === 0) duckAmbience()
  }

  /* ---- 氛围调度（look-ahead setInterval，见实现单 §4） ---- */
  function ambTone(freq, durMs, atkMs, peak, when, type) {
    if (!ctx) return
    try {
      const o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.value = freq
      const g = ctx.createGain()
      envelope(g.gain, when, peak, durMs, atkMs)
      o.connect(g); g.connect(busAmb)
      o.start(when); o.stop(when + durMs / 1000 + 0.05)
      o.onended = function () { try { o.disconnect() } catch (e) {}; try { g.disconnect() } catch (e) {} }
    } catch (e) { /* 氛围点缀失败不影响主流程 */ }
  }

  function ambNoise(durMs, hpHz, peak, when) {
    if (!ctx || !noiseBuf) return
    try {
      const s = ctx.createBufferSource(); s.buffer = noiseBuf
      const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hpHz
      const g = ctx.createGain(); envelope(g.gain, when, peak, durMs, 5)
      s.connect(f); f.connect(g); g.connect(busAmb)
      const off = Math.random() * Math.max(0, noiseBuf.duration - durMs / 1000 - 0.01)
      s.start(when, off, durMs / 1000 + 0.02)
      s.onended = function () { try { s.disconnect() } catch (e) {}; try { f.disconnect() } catch (e) {}; try { g.disconnect() } catch (e) {} }
    } catch (e) {}
  }

  function schedule() {
    if (!ctx || muted || !unlocked || ctx.state !== 'running') return
    const now = ctx.currentTime
    const horizon = now + 0.4
    if (ambScene === AUDIO.AMB.LOBBY) {
      if (!nextAmbientAt || nextAmbientAt < now) nextAmbientAt = now + 2
      while (nextAmbientAt < horizon) {
        const f = PENTA[Math.floor(Math.random() * PENTA.length)]
        ambTone(f, 400, 30, 0.3, Math.max(nextAmbientAt, now + 0.02))
        nextAmbientAt += 4 + Math.random() * 5
      }
    } else if (ambScene === AUDIO.AMB.BATTLE) {
      if (!nextAmbientAt || nextAmbientAt < now) nextAmbientAt = now + 3
      while (nextAmbientAt < horizon) {
        const p = skinParams(skin)
        ambNoise(40, 3000 * p.LP_SCALE, 0.12, Math.max(nextAmbientAt, now + 0.02))
        nextAmbientAt += 6 + Math.random() * 6
      }
      if (!nextPulseAt || nextPulseAt < now) nextPulseAt = now + 1
      while (nextPulseAt < horizon) {
        ambTone(70, 180, 20, 0.25, Math.max(nextPulseAt, now + 0.02))
        nextPulseAt += 2
      }
    }
  }

  function startTimer() {
    if (timer) return
    if (typeof setInterval !== 'function') return
    timer = setInterval(schedule, 120)
  }
  function stopTimer() {
    if (timer) { clearInterval(timer); timer = null }
  }

  /** §5.4：把两套 drone 的 sceneGain 交叉淡入淡出到 target，1.5s */
  function fadeDronesTo(target) {
    if (!ctx) return
    Object.keys(drones).forEach(function (k) {
      const d = drones[k]
      if (!d || !d.sceneGain) return
      const g = d.sceneGain.gain
      const t = ctx.currentTime
      const to = k === target ? 1 : 0
      try {
        g.cancelScheduledValues(t)
        g.setValueAtTime(g.value, t)
        g.linearRampToValueAtTime(to, t + AUDIO.AMB.CROSSFADE_S)
      } catch (e) { g.value = to }
    })
  }

  /** §5.4：1.5s gain 交叉淡入淡出 */
  function scene(name) {
    const next = name === 'battle' || name === 'result' ? AUDIO.AMB.BATTLE : AUDIO.AMB.LOBBY
    if (!ctx) { ambScene = next; return }   // 解锁前的场景切换只记目标，buildGraph 后再淡入
    if (next === ambScene) return
    ambScene = next
    if (typeof setInterval === 'function' && !timer) startTimer()
    fadeDronesTo(next)
    nextAmbientAt = ctx.currentTime + 1
    nextPulseAt = ctx.currentTime + 1
  }

  /** 首个用户手势：创建 + resume + 播 tap 确认（规格 §1.2 / §6） */
  function unlock() {
    if (unlocked) { if (ctx && ctx.state === 'suspended' && !muted && ctx.resume) ctx.resume(); return }
    if (!buildGraph()) return
    unlocked = true
    if (ctx.state === 'suspended' && ctx.resume) {
      try { const r = ctx.resume(); if (r && typeof r.then === 'function') r.catch(noop) } catch (e) {}
    }
    // 建图后按已记录的场景淡入对应氛围（scene('lobby') 在解锁前已调用过）。
    fadeDronesTo(ambScene || AUDIO.AMB.LOBBY)
    nextAmbientAt = ctx.currentTime + 1
    nextPulseAt = ctx.currentTime + 1
    startTimer()
    play(S.UI_TAP)   // 这声 tap 就是「声音已开」的确认
  }

  /** 静音：ctx.suspend()，不是只把 gain 置 0（§6） */
  function setMuted(v) {
    const next = !!v
    if (next === muted) return
    muted = next
    try {
      wx.setStorageSync(AUDIO.STORAGE_KEY_MUTED, muted)
    } catch (e) { /* 存储不可用不影响本次切换 */ }
    if (!ctx) return
    if (muted) {
      stopTimer()
      if (ctx.suspend) { try { const r = ctx.suspend(); if (r && r.then) r.catch(noop) } catch (e) {} }
    } else {
      if (ctx.state === 'suspended' && ctx.resume) {
        try { const r = ctx.resume(); if (r && r.then) r.catch(noop) } catch (e) {}
      }
      nextAmbientAt = ctx.currentTime + 0.5
      nextPulseAt = ctx.currentTime + 0.5
      startTimer()
    }
  }

  function getMuted() { return muted }
  function setSkin(id) {
    const next = AUDIO.SKIN[id] ? id : 'abyss'
    skin = next
  }
  function suspend() {
    stopTimer()
    if (ctx && ctx.suspend && !muted) { try { const r = ctx.suspend(); if (r && r.then) r.catch(noop) } catch (e) {} }
  }
  function resume() {
    if (!ctx || muted) return
    if (ctx.state === 'suspended' && ctx.resume) {
      try { const r = ctx.resume(); if (r && r.then) r.catch(noop) } catch (e) {}
    }
    // 回前台必须重置调度锚点，否则后台欠账会一次性补发一串音符
    const t = ctx.currentTime
    nextAmbientAt = t + 0.1
    nextPulseAt = t + 0.1
    startTimer()
  }
  function destroy() {
    stopTimer()
    active.slice().forEach(function (v) { v.stop(20) })
    if (ctx && ctx.close) { try { ctx.close() } catch (e) {} }
    ctx = null
    unlocked = false
  }

  // 初始读静音存储（沿用 skin.js:24-34 的容错范式）
  try { muted = !!wx.getStorageSync(AUDIO.STORAGE_KEY_MUTED) } catch (e) { muted = false }

  return {
    isNoop: false,
    play: play,
    scene: scene,
    setSkin: setSkin,
    setMuted: setMuted,
    getMuted: getMuted,
    unlock: unlock,
    suspend: suspend,
    resume: resume,
    destroy: destroy,
    step: schedule,
    // 供测试断言 / 调试，不属于玩法接口
    _debug: function () {
      return { ctx: !!ctx, unlocked: unlocked, muted: muted, skin: skin, ambScene: ambScene, voices: active.length }
    }
  }
}

module.exports = { createAudio, AUDIO, PRIORITY, RECIPES: R }
