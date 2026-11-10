// BURGER SKIN — звуковые эффекты (WebAudio, без внешних файлов).
// Звук не воспроизводится до первого взаимодействия пользователя со страницей (требование браузеров).
import { state, api, html, mount } from './core.js';
import { icon } from './icons.js';

const KEY = 'bs_sound_v1';
const BASE = { enabled: true, master: 0.7, effects: 0.8, upgrade: 0.8, cinema: 0.9 };
let ctx = null; let unlocked = false; let master = null; const buses = {};
let cfg = load();

function clamp01(v, d) { const n = Number(v); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d; }
function norm(o = {}) { return { enabled: o.enabled !== false, master: clamp01(o.master, BASE.master), effects: clamp01(o.effects, BASE.effects), upgrade: clamp01(o.upgrade, BASE.upgrade), cinema: clamp01(o.cinema, BASE.cinema) }; }
function siteDefaults() { const s = state.site?.sound || state.sound || {}; return s && typeof s === 'object' ? s : {}; }
function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) return norm(JSON.parse(raw)); } catch { /* браузер без localStorage */ }
  return null;
}
/** Текущие настройки: личные (аккаунт / браузер) → стандартные сайта → базовые. */
export function soundSettings() {
  if (state.me?.prefs?.sound) return norm(state.me.prefs.sound);
  if (cfg) return cfg;
  const d = siteDefaults();
  return norm({ ...BASE, enabled: d.enabled_default !== false, master: d.master ?? BASE.master, effects: d.effects ?? BASE.effects, upgrade: d.upgrade ?? BASE.upgrade, cinema: d.cinema ?? BASE.cinema });
}
export const soundMuted = () => { const s = soundSettings(); return !s.enabled || s.master <= 0; };
function featureOn(kind) { const d = siteDefaults(); if (kind === 'upgrade') return d.upgrade_sounds !== false; if (kind === 'cinema') return d.cinema_sounds !== false; return d.case_sounds !== false; }

let saveT = 0;
export function setSound(patch) {
  const next = norm({ ...soundSettings(), ...patch });
  cfg = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ }
  if (state.me) { state.me.prefs = { ...(state.me.prefs || {}), sound: next }; clearTimeout(saveT); saveT = setTimeout(() => { api('/api/me/prefs', { sound: next }).catch(() => {}); }, 600); }
  applyGains();
  for (const b of document.querySelectorAll('[data-sound-panel].icon-btn')) b.innerHTML = String(icon(soundMuted() ? 'volumeOff' : 'volume'));
  return next;
}

function applyGains() {
  if (!ctx) return;
  const s = soundSettings(); const t = ctx.currentTime;
  master.gain.setTargetAtTime(s.enabled ? s.master : 0, t, 0.02);
  buses.effects.gain.setTargetAtTime(s.effects, t, 0.02);
  buses.upgrade.gain.setTargetAtTime(s.upgrade, t, 0.02);
  buses.cinema.gain.setTargetAtTime(s.cinema, t, 0.02);
}
function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  ctx = new AC();
  const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(ctx.destination);
  master = ctx.createGain(); master.connect(comp);
  for (const k of ['effects', 'upgrade', 'cinema']) { buses[k] = ctx.createGain(); buses[k].connect(master); }
  applyGains();
  return ctx;
}
function unlock() {
  if (unlocked) return; const c = ensure(); if (!c) return;
  const go = () => { unlocked = c.state === 'running'; };
  if (c.state === 'suspended') c.resume().then(go).catch(() => {}); else go();
}
export const unlockSound = () => unlock();
/** Канал для кинодропов (cine-sound.js). null — звук выключен, отключён админом или браузер ещё не разрешил аудио. */
export function cineBus() {
  if (!featureOn('cinema')) return null;
  unlock(); if (!ensure()) return null;
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return { ctx, bus: buses.cinema };
}
for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlock, { capture: true, passive: true });

// ---------- синтез ----------
function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
function tone(bus, { f = 440, f2 = null, type = 'sine', t = 0, a = 0.005, d = 0.15, v = 0.3, detune = 0 }) {
  const c = ctx; const at = c.currentTime + t; const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, at); if (f2) o.frequency.exponentialRampToValueAtTime(f2, at + a + d); if (detune) o.detune.value = detune;
  env(g, at, a, v, d); o.connect(g); g.connect(bus); o.start(at); o.stop(at + a + d + 0.05);
}
let noiseBuf = null;
function noise(bus, { t = 0, d = 0.2, v = 0.2, hp = 800, lp = 8000, a = 0.005 }) {
  const c = ctx; if (!noiseBuf) { noiseBuf = c.createBuffer(1, c.sampleRate, c.sampleRate); const ch = noiseBuf.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1; }
  const at = c.currentTime + t; const s = c.createBufferSource(); s.buffer = noiseBuf;
  const h = c.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = hp; const l = c.createBiquadFilter(); l.type = 'lowpass'; l.frequency.value = lp;
  const g = c.createGain(); env(g, at, a, v, d); s.connect(h); h.connect(l); l.connect(g); g.connect(bus); s.start(at, Math.random() * 0.5); s.stop(at + a + d + 0.05);
}
const chord = (bus, notes, step, o) => notes.forEach((f, i) => tone(bus, { ...o, f, t: (o.t || 0) + i * step }));

const LIB = {
  // Кейсы
  click: (b) => { tone(b, { f: 1250, type: 'square', d: 0.035, v: 0.07 }); tone(b, { f: 620, type: 'sine', d: 0.06, v: 0.12 }); },
  start: (b) => { tone(b, { f: 180, f2: 720, type: 'sawtooth', a: 0.02, d: 0.32, v: 0.08 }); noise(b, { d: 0.35, v: 0.09, hp: 1200, lp: 6000, a: 0.08 }); tone(b, { f: 90, f2: 60, d: 0.25, v: 0.25 }); },
  tick: (b, o = {}) => { const v = 0.05 + 0.1 * (o.level ?? 1); tone(b, { f: 2100 + Math.random() * 120, type: 'triangle', a: 0.001, d: 0.025, v }); noise(b, { d: 0.018, v: v * 0.6, hp: 3000, a: 0.001 }); },
  slow: (b) => { tone(b, { f: 330, f2: 160, type: 'sine', a: 0.04, d: 0.6, v: 0.08 }); },
  stop: (b) => { tone(b, { f: 140, f2: 70, type: 'sine', a: 0.003, d: 0.22, v: 0.35 }); noise(b, { d: 0.08, v: 0.12, hp: 400, lp: 3000 }); tone(b, { f: 980, type: 'triangle', d: 0.08, v: 0.06, t: 0.02 }); },
  drop: (b) => { chord(b, [523, 659], 0.07, { type: 'triangle', d: 0.22, v: 0.1 }); },
  rare: (b) => { chord(b, [523, 659, 784, 1047], 0.075, { type: 'triangle', d: 0.4, v: 0.12 }); noise(b, { t: 0.25, d: 0.5, v: 0.05, hp: 6000, a: 0.05 }); },
  gold: (b) => {
    tone(b, { f: 65, f2: 45, d: 0.9, v: 0.3, a: 0.01 });
    chord(b, [392, 523, 659, 784, 1047, 1319], 0.08, { type: 'triangle', d: 0.6, v: 0.11 });
    chord(b, [1568, 2093, 2637], 0.06, { type: 'sine', d: 0.9, v: 0.06, t: 0.5 });
    noise(b, { t: 0.45, d: 1.1, v: 0.06, hp: 7000, a: 0.08 });
  },
  sell: (b) => { tone(b, { f: 1318, type: 'sine', d: 0.12, v: 0.16 }); tone(b, { f: 1760, type: 'sine', d: 0.3, v: 0.14, t: 0.07 }); noise(b, { d: 0.05, v: 0.06, hp: 5000 }); },
  // Апгрейдер
  select: (b) => { tone(b, { f: 880, type: 'sine', d: 0.07, v: 0.12 }); tone(b, { f: 1320, type: 'sine', d: 0.05, v: 0.06, t: 0.03 }); },
  mult: (b) => { tone(b, { f: 700, type: 'square', d: 0.03, v: 0.05 }); tone(b, { f: 1050, type: 'triangle', d: 0.06, v: 0.08, t: 0.02 }); },
  launch: (b) => { tone(b, { f: 120, f2: 900, type: 'sawtooth', a: 0.03, d: 0.5, v: 0.07 }); tone(b, { f: 60, d: 0.4, v: 0.25 }); noise(b, { d: 0.5, v: 0.07, hp: 1500, a: 0.15 }); },
  spin: (b, o = {}) => { tone(b, { f: 1500 + 600 * (o.level ?? 1), type: 'triangle', a: 0.001, d: 0.02, v: 0.04 + 0.08 * (o.level ?? 1) }); },
  win: (b) => { chord(b, [523, 659, 784, 1047], 0.09, { type: 'triangle', d: 0.45, v: 0.13 }); tone(b, { f: 1568, type: 'sine', d: 0.8, v: 0.06, t: 0.4 }); },
  lose: (b) => { chord(b, [392, 330, 262], 0.12, { type: 'sawtooth', d: 0.3, v: 0.05 }); tone(b, { f: 110, f2: 55, d: 0.6, v: 0.25, t: 0.1 }); },
};
const UPG = new Set(['select', 'mult', 'launch', 'spin', 'win', 'lose']);
const lastAt = {};
/** Воспроизвести эффект. ch: 'effects' (кейсы и сайт) или 'upgrade' (апгрейдер). */
export function sfx(name, o = {}) {
  const fn = LIB[name]; if (!fn) return;
  const ch = o.ch || (UPG.has(name) ? 'upgrade' : 'effects');
  if (!featureOn(ch)) return;
  const s = soundSettings(); if (!s.enabled || s.master <= 0) return;
  if (!unlocked || !ensure() || ctx.state !== 'running') return; // до первого взаимодействия — тишина
  const minGap = name === 'tick' || name === 'spin' ? 28 : 40; const t = performance.now();
  if (lastAt[name] && t - lastAt[name] < minGap) return; lastAt[name] = t;
  fn(buses[ch], o);
}
/** Звук для выпавшего предмета по его классу. */
export function dropSound(item, ch) {
  const name = String(item?.name || ''); const cat = String(item?.category || item?.type || '').toLowerCase(); const r = String(item?.rarity || '').toLowerCase();
  if (name.startsWith('\u2605') || /knife|glove|нож|перчат/.test(cat)) return sfx('gold', { ch });
  if (/covert|тайн|contraband|classified|засекр/.test(r)) return sfx('rare', { ch });
  return sfx('drop', { ch });
}

/**
 * Синхронные щелчки рулетки: следим за реальным положением ленты и играем щелчок, когда
 * граница предмета проходит через центр. Когда лента замедляется — один раз звук замедления.
 */
export function trackStrip(strip, itemSize, { axis = 'x', ch = 'effects', tickName = 'tick', duration = 6000 } = {}) {
  if (!strip || !itemSize) return () => {};
  let last = null; let lastPos = null; let lastT = 0; let maxV = 0; let slowed = false; let stop = false; const t0 = performance.now();
  const read = () => { const m = new DOMMatrixReadOnly(getComputedStyle(strip).transform); return axis === 'y' ? m.m42 : m.m41; };
  const loop = (t) => {
    if (stop || !strip.isConnected) return;
    const pos = read(); const idx = Math.floor(-pos / itemSize);
    if (lastPos != null) { const v = Math.abs(pos - lastPos) / Math.max(1, t - lastT); maxV = Math.max(maxV, v); if (!slowed && maxV > 0.5 && v < maxV * 0.22) { slowed = true; sfx('slow', { ch }); } }
    if (last != null && idx !== last) { const v = lastPos != null ? Math.abs(pos - lastPos) / Math.max(1, t - lastT) : 1; sfx(tickName, { ch, level: Math.min(1, 0.35 + v / Math.max(0.5, maxV)) }); }
    last = idx; lastPos = pos; lastT = t;
    if (t - t0 < duration + 1500) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return () => { stop = true; };
}

// ---------- панель настроек ----------
let panel = null;
function closePanel() { panel?.remove(); panel = null; }
function openPanel(anchor) {
  if (panel) { closePanel(); return; }
  const s = soundSettings();
  panel = document.createElement('div'); panel.className = 'snd-panel'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'Настройки звука');
  const row = (k, label) => html`<label class="snd-row"><span>${label}</span><input type="range" min="0" max="100" step="1" value="${Math.round(s[k] * 100)}" data-snd="${k}"><b data-sndv="${k}">${Math.round(s[k] * 100)}%</b></label>`;
  mount(panel, html`<div class="snd-h"><b>${icon('volume')}Звук</b><label class="snd-sw"><input type="checkbox" data-snd-on ${s.enabled ? 'checked' : ''}><i></i></label></div>
    ${row('master', 'Общая громкость')}${row('effects', 'Эффекты кейсов')}${row('upgrade', 'Апгрейдер')}${row('cinema', 'Кинодропы')}
    <div class="snd-f"><button class="btn sm ghost" data-snd-test>${icon('play')}Проверить</button><button class="btn sm ghost" data-snd-mute>${icon('volumeOff')}Выключить всё</button></div>
    <p class="xs dim">Настройки сохраняются ${state.me ? 'в аккаунте' : 'в браузере'}.</p>`);
  if (!s.enabled) panel.querySelector('[data-snd-on]').checked = false;
  document.body.appendChild(panel);
  const r = anchor?.getBoundingClientRect?.();
  if (r && window.innerWidth > 640) { panel.style.top = Math.round(r.bottom + 10) + 'px'; panel.style.right = Math.max(12, Math.round(window.innerWidth - r.right - 60)) + 'px'; } else panel.classList.add('sheet');
  panel.addEventListener('input', (e) => { const k = e.target.dataset.snd; if (k) { const v = Number(e.target.value) / 100; panel.querySelector(`[data-sndv="${k}"]`).textContent = Math.round(v * 100) + '%'; setSound({ [k]: v }); } });
  panel.addEventListener('change', (e) => { if (e.target.matches('[data-snd-on]')) { setSound({ enabled: e.target.checked }); if (e.target.checked) { unlock(); setTimeout(() => sfx('drop'), 60); } } });
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-snd-test]')) { unlock(); setTimeout(() => { sfx('click'); setTimeout(() => sfx('rare'), 160); setTimeout(() => sfx('win'), 900); }, 40); }
    if (e.target.closest('[data-snd-mute]')) { setSound({ enabled: false }); panel.querySelector('[data-snd-on]').checked = false; }
  });
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-sound-panel]');
  if (b) { e.preventDefault(); openPanel(b); return; }
  if (panel && !e.target.closest('.snd-panel')) closePanel();
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
