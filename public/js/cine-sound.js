// BURGER SKIN — звуковой дизайн кинодропов.
// Все звуки оригинальные: они синтезируются прямо в браузере через WebAudio (осцилляторы, шум, фильтры,
// сгенерированная реверберация). Сторонних сэмплов нет — нет и вопросов с лицензиями, вес модуля ~10 КБ.
// Громкость: общий канал сайта → канал «Кинодропы» (настраивается в панели звука и прямо в сцене).
import { cineBus } from './sound.js';

const SILENT_H = { stop() {}, swell() {} };
const SILENT = { silent: true };
for (const k of ['heartbeat', 'drone', 'riser', 'suck', 'portal', 'zap', 'impact', 'reveal', 'finalHit', 'whoosh', 'shing', 'tear', 'lights', 'stopAll', 'dispose']) SILENT[k] = () => SILENT_H;

// Тональность сцены: основной бас и аккорд финала.
const KEYS = {
  godlike: { root: 36.71, chord: [293.66, 369.99, 440, 587.33, 739.99] },   // D мажор — торжество
  mythic: { root: 34.65, chord: [277.18, 329.63, 415.3, 493.88, 622.25] },  // C# минор + диссонанс — космос
  divine: { root: 41.2, chord: [329.63, 415.3, 493.88, 659.25, 830.61, 987.77] }, // E мажор + «хор»
  knife: { root: 27.5, chord: [220, 277.18, 329.63, 440, 554.37] },
  glove: { root: 43.65, chord: [349.23, 440, 523.25, 698.46] },
};

export function createCineAudio(scene = 'godlike') {
  const b = cineBus();
  if (!b) return SILENT;
  const { ctx, bus } = b;
  const key = KEYS[scene] || KEYS.godlike;
  const out = ctx.createGain(); out.gain.value = 0.9; out.connect(bus);
  // Реверберация «большой зал»: импульс из затухающего шума, генерируется один раз.
  const rev = ctx.createConvolver(); rev.buffer = impulse(ctx, 2.6, 2.4);
  const wet = ctx.createGain(); wet.gain.value = 0.34; rev.connect(wet); wet.connect(bus);
  const nbuf = noiseBuf(ctx);
  const live = new Set();
  const now = (at = 0) => ctx.currentTime + Math.max(0, at);

  const gain = (v = 1, send = 0) => {
    const g = ctx.createGain(); g.gain.value = v; g.connect(out);
    if (send) { const s = ctx.createGain(); s.gain.value = send; g.connect(s); s.connect(rev); }
    return g;
  };
  const filt = (type, f, q = 0.7) => { const x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; };
  const osc = (type, f, t, dur, detune = 0) => { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune; o.start(t); o.stop(t + dur + 0.1); return o; };
  const noise = (t, dur) => { const s = ctx.createBufferSource(); s.buffer = nbuf; s.loop = true; s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.1); return s; };
  const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
  const drive = (() => { const w = ctx.createWaveShaper(); const n = 1024; const c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * 2.6); } w.curve = c; w.connect(out); return w; })();

  const api = {
    /** Удар сердца (lub-dub). level 0..1 — сердцебиение становится громче и чаще к раскрытию. */
    heartbeat(level = 0.6, at = 0) {
      const t = now(at);
      const lp = filt('lowpass', 180, 1); lp.connect(gain(1, 0.12));
      for (const [dt, f, v] of [[0, 62, 1], [0.16, 52, 0.7]]) {
        const g = ctx.createGain(); g.connect(lp); env(g, t + dt, 0.006, 0.95 * level * v, 0.26);
        const o = osc('sine', f, t + dt, 0.35); o.frequency.exponentialRampToValueAtTime(f * 0.55, t + dt + 0.2); o.connect(g);
      }
    },
    /** Глубокий кинематографичный бас-дрон с раскрывающимся фильтром. */
    drone(dur = 4) {
      const t = now(); const g = gain(0.0001, 0.2); const lp = filt('lowpass', 110, 5); lp.connect(g);
      const nodes = [];
      for (const [type, mul, det, v] of [['sine', 1, 0, 0.9], ['sine', 1.5, 0, 0.35], ['sawtooth', 2, -7, 0.22], ['sawtooth', 2, 7, 0.22], ['sawtooth', 3, 3, 0.1]]) {
        const o = osc(type, key.root * mul, t, 60, det); const og = ctx.createGain(); og.gain.value = v; o.connect(og); og.connect(lp); nodes.push(o);
      }
      const lfo = osc('sine', 0.23, t, 60); const lg = ctx.createGain(); lg.gain.value = 40; lfo.connect(lg); lg.connect(lp.frequency); nodes.push(lfo);
      g.gain.exponentialRampToValueAtTime(0.55, t + Math.min(2.2, dur * 0.6));
      lp.frequency.exponentialRampToValueAtTime(900, t + dur);
      const h = { stop(fade = 0.4) { const n = ctx.currentTime; g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(Math.max(0.0002, g.gain.value), n); g.gain.exponentialRampToValueAtTime(0.0001, n + fade); for (const o of nodes) { try { o.stop(n + fade + 0.05); } catch { /* уже остановлен */ } } live.delete(h); },
        swell(f = 2400, time = 0.6) { const n = ctx.currentTime; lp.frequency.cancelScheduledValues(n); lp.frequency.setValueAtTime(lp.frequency.value, n); lp.frequency.exponentialRampToValueAtTime(f, n + time); } };
      live.add(h); return h;
    },
    /** Нарастание перед ударом (шум + два расстроенных пилообразных тона). */
    riser(dur = 1.6, at = 0) {
      const t = now(at); const g = gain(0.0001, 0.45);
      const bp = filt('bandpass', 250, 3.5); bp.connect(g); noise(t, dur).connect(bp); bp.frequency.exponentialRampToValueAtTime(6500, t + dur);
      for (const det of [-12, 12]) { const o = osc('sawtooth', 110, t, dur, det); o.frequency.exponentialRampToValueAtTime(660, t + dur); const og = ctx.createGain(); og.gain.value = 0.07; o.connect(og); og.connect(g); }
      g.gain.exponentialRampToValueAtTime(0.42, t + dur * 0.97); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.06);
      const h = { stop() { const n = ctx.currentTime; g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(Math.max(0.0002, g.gain.value), n); g.gain.exponentialRampToValueAtTime(0.0001, n + 0.08); live.delete(h); }, swell() {} };
      live.add(h); setTimeout(() => live.delete(h), (dur + at + 0.2) * 1000); return h;
    },
    /** Обратный «вдох» — звезда сжимается перед взрывом. */
    suck(dur = 0.9, at = 0) {
      const t = now(at); const g = gain(0.0001, 0.5); const hp = filt('highpass', 1200, 0.8); hp.connect(g); noise(t, dur).connect(hp);
      hp.frequency.exponentialRampToValueAtTime(5200, t + dur); g.gain.exponentialRampToValueAtTime(0.5, t + dur); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.03);
    },
    /** Открытие портала: свистящий вихрь + мерцающие обертоны. */
    portal(at = 0) {
      const t = now(at); const g = gain(1, 0.7);
      const lp = filt('lowpass', 300, 6); const ng = ctx.createGain(); lp.connect(ng); ng.connect(g); noise(t, 2.2).connect(lp);
      lp.frequency.exponentialRampToValueAtTime(7000, t + 0.7); lp.frequency.exponentialRampToValueAtTime(500, t + 2.1); env(ng, t, 0.5, 0.55, 1.6);
      const trem = osc('sine', 9, t, 2.4); const tg = ctx.createGain(); tg.gain.value = 0.5;
      const sh = ctx.createGain(); sh.gain.value = 0.5; trem.connect(tg); tg.connect(sh.gain); sh.connect(g);
      key.chord.slice(0, 4).forEach((f, i) => { const o = osc('sine', f * 2, t, 2.4, (i - 1.5) * 6); const og = ctx.createGain(); env(og, t + i * 0.06, 0.7, 0.08, 1.6); o.connect(og); og.connect(sh); });
      const sub = osc('sine', key.root * 2, t, 1.6); sub.frequency.exponentialRampToValueAtTime(key.root, t + 1.4); const sg = ctx.createGain(); env(sg, t, 0.3, 0.5, 1.2); sub.connect(sg); sg.connect(g);
    },
    /** Электрический разряд: треск и гудение с перегрузкой. */
    zap(level = 0.7, at = 0) {
      const t = now(at); const dur = 0.18 + Math.random() * 0.22; const g = gain(1, 0.25);
      const hp = filt('highpass', 1700, 0.9); const cg = ctx.createGain(); cg.gain.value = 0; hp.connect(cg); cg.connect(g); noise(t, dur).connect(hp);
      for (let x = 0; x < dur; x += 0.008 + Math.random() * 0.012) cg.gain.setValueAtTime(Math.random() < 0.55 ? (0.15 + Math.random() * 0.6) * level : 0, t + x);
      cg.gain.setValueAtTime(0, t + dur);
      const bz = osc('sawtooth', 55 + Math.random() * 40, t, dur); const bp = filt('bandpass', 900 + Math.random() * 900, 2.5); const bg = ctx.createGain(); env(bg, t, 0.004, 0.5 * level, dur); bz.connect(bp); bp.connect(bg); bg.connect(drive);
    },
    /** Удар появления предмета: саб-бум + шумовой взрыв с хвостом реверберации. */
    impact(level = 1, at = 0) {
      const t = now(at); const g = gain(1, 0.55);
      const o = osc('sine', 150, t, 1.8); o.frequency.exponentialRampToValueAtTime(30, t + 1.1); const og = ctx.createGain(); env(og, t, 0.004, 1 * level, 1.6); o.connect(og); og.connect(g);
      const o2 = osc('triangle', 80, t, 1); o2.frequency.exponentialRampToValueAtTime(38, t + 0.6); const o2g = ctx.createGain(); env(o2g, t, 0.003, 0.5 * level, 0.8); o2.connect(o2g); o2g.connect(drive);
      const lp = filt('lowpass', 1400, 0.8); const ng = ctx.createGain(); env(ng, t, 0.002, 0.7 * level, 0.55); noise(t, 0.7).connect(lp); lp.connect(ng); ng.connect(g); lp.frequency.exponentialRampToValueAtTime(200, t + 0.5);
    },
    /** Финальный аккорд раскрытия (колокольные обертоны; для DIVINE — «хор» из формантных фильтров). */
    reveal(at = 0) {
      const t = now(at); const g = gain(0.8, 0.8);
      key.chord.forEach((f, i) => {
        for (const [mul, v, d] of [[1, 0.09, 3.6], [2.76, 0.03, 1.4], [5.4, 0.015, 0.7]]) { const o = osc('sine', f * mul, t + i * 0.035, d + 0.2); const og = ctx.createGain(); env(og, t + i * 0.035, 0.012, v, d); o.connect(og); og.connect(g); }
        const tr = osc('triangle', f / 2, t, 3.4, (i % 2 ? 5 : -5)); const tg = ctx.createGain(); env(tg, t, 0.25, 0.05, 3); tr.connect(tg); tg.connect(g);
      });
      if (scene === 'divine' || scene === 'godlike') {
        const f1 = filt('bandpass', 720, 6), f2 = filt('bandpass', 1150, 7); const cg = ctx.createGain(); env(cg, t, 0.6, 0.35, 3.2); f1.connect(cg); f2.connect(cg); cg.connect(g);
        for (const f of key.chord.slice(0, 3)) for (const det of [-9, 0, 9]) { const o = osc('sawtooth', f, t, 4, det); o.connect(f1); o.connect(f2); }
      }
      if (scene === 'mythic') { const o = osc('sine', key.chord[0] * 1.414, t, 3); const og = ctx.createGain(); env(og, t, 0.4, 0.06, 2.5); const fm = osc('sine', 5.5, t, 3); const fg = ctx.createGain(); fg.gain.value = 18; fm.connect(fg); fg.connect(o.frequency); o.connect(og); og.connect(g); }
    },
    /** Финальный ударный звук: бум + тарелка + металлический звон. */
    finalHit(at = 0) {
      api.impact(1, at);
      const t = now(at); const g = gain(1, 0.6);
      const hp = filt('highpass', 5200, 0.6); const ng = ctx.createGain(); env(ng, t, 0.003, 0.28, 2.2); noise(t, 2.4).connect(hp); hp.connect(ng); ng.connect(g);
      for (const [f, d] of [[1720, 1.1], [2480, 0.9], [3310, 0.7], [4630, 0.5]]) { const o = osc('sine', f, t, d + 0.2); const og = ctx.createGain(); env(og, t, 0.002, 0.03, d); o.connect(og); og.connect(g); }
      const sub = osc('sine', key.root, t, 2.4); const sg = ctx.createGain(); env(sg, t, 0.01, 0.7, 2.2); sub.connect(sg); sg.connect(g);
    },
    /** Свист вращения (нож). */
    whoosh(level = 0.5, at = 0) {
      const t = now(at); const g = gain(1, 0.2); const bp = filt('bandpass', 500, 1.6); const ng = ctx.createGain(); bp.connect(ng); ng.connect(g); noise(t, 0.45).connect(bp);
      bp.frequency.exponentialRampToValueAtTime(2600, t + 0.16); bp.frequency.exponentialRampToValueAtTime(700, t + 0.4); env(ng, t, 0.12, 0.6 * level, 0.28);
    },
    /** Металлический «дзынь» клинка. */
    shing(at = 0) {
      const t = now(at); const g = gain(1, 0.5);
      for (const [f, d, v] of [[2350, 1.5, 0.06], [3530, 1.1, 0.05], [4870, 0.8, 0.04], [6120, 0.6, 0.03], [7900, 0.4, 0.02]]) { const o = osc('sine', f, t, d + 0.2); o.frequency.exponentialRampToValueAtTime(f * 1.012, t + d); const og = ctx.createGain(); env(og, t, 0.002, v * 2, d); o.connect(og); og.connect(g); }
      const hp = filt('highpass', 4000, 0.7); const ng = ctx.createGain(); env(ng, t, 0.05, 0.25, 0.25); noise(t, 0.4).connect(hp); hp.connect(ng); ng.connect(g); hp.frequency.exponentialRampToValueAtTime(9000, t + 0.3);
    },
    /** Разрыв пространства: рвущийся шум с перегрузкой и вобл-басом. */
    tear(at = 0) {
      const t = now(at); const g = gain(1, 0.6);
      const bp = filt('bandpass', 3200, 1.4); const ng = ctx.createGain(); env(ng, t, 0.02, 0.6, 1.2); noise(t, 1.4).connect(bp); bp.connect(ng); ng.connect(drive); bp.frequency.exponentialRampToValueAtTime(160, t + 1.1);
      const o = osc('sawtooth', 46, t, 1.8); const lfo = osc('sine', 7, t, 1.8); const lg = ctx.createGain(); lg.gain.value = 14; lfo.connect(lg); lg.connect(o.frequency);
      const lp = filt('lowpass', 420, 4); const og = ctx.createGain(); env(og, t, 0.05, 0.5, 1.6); o.connect(lp); lp.connect(og); og.connect(g);
      for (let i = 0; i < 4; i++) api.zap(0.6, at + i * 0.09 + Math.random() * 0.05);
    },
    /** Тёплый «свет включён» для перчаток: мягкий вздох + кожаный удар. */
    lights(at = 0) {
      const t = now(at); const g = gain(1, 0.4);
      const lp = filt('lowpass', 700, 0.9); const ng = ctx.createGain(); env(ng, t, 0.25, 0.4, 0.8); noise(t, 1.2).connect(lp); lp.connect(ng); ng.connect(g);
      const o = osc('sine', 95, t + 0.35, 0.5); o.frequency.exponentialRampToValueAtTime(48, t + 0.6); const og = ctx.createGain(); env(og, t + 0.35, 0.004, 0.6, 0.35); o.connect(og); og.connect(g);
    },
    /** Остановить длительные звуки (дрон, нарастание) — при пропуске или закрытии сцены. */
    stopAll(fade = 0.3) { for (const h of [...live]) h.stop(fade); },
    /** Полностью отключить сцену от аудиовыхода после затухания хвостов. */
    dispose() { api.stopAll(0.4); const n = ctx.currentTime; out.gain.setTargetAtTime(0, n + 2.5, 0.4); setTimeout(() => { try { out.disconnect(); wet.disconnect(); } catch { /* ignore */ } }, 5000); },
  };
  return api;
}

let NB = null;
function noiseBuf(ctx) {
  if (NB && NB.sampleRate === ctx.sampleRate) return NB;
  const len = Math.floor(ctx.sampleRate * 2); NB = ctx.createBuffer(1, len, ctx.sampleRate); const d = NB.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return NB;
}
let IR = null;
function impulse(ctx, sec, decay) {
  if (IR && IR.sampleRate === ctx.sampleRate) return IR;
  const len = Math.floor(ctx.sampleRate * sec); IR = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = IR.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
  return IR;
}
