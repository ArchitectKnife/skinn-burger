// BURGER SKIN — кинематографичная сцена выпадения (GODLIKE / MYTHIC / DIVINE / KNIFE / GLOVE).
//
// Модуль грузится лениво только при редком дропе. Сцена ничего не решает: предмет, его цена и уровень
// уже записаны сервером в инвентарь и пришли в ответе /api/cases/:slug/open ДО запуска анимации.
// Здесь — только визуализация этого результата.
//
// Рендер: 2D-холст сцены (частицы, лучи, молнии, кольца) → WebGL2 пост-обработка (bloom из mip-уровней,
// радиальный motion blur, ударная волна-искажение, хроматическая аберрация, глитч, вспышка, тонмаппинг,
// виньетка, зерно). Без WebGL2 — облегчённый 2D bloom. Предмет — DOM-слой с 3D-трансформациями и «толщиной»
// из нескольких слоёв (2.5D), его можно вращать мышью/пальцем и приближать.
// Производительность: адаптивное качество по FPS, лимит частиц, пауза во вкладке в фоне, 30 FPS в простое.
import { html, mount, rub, WEARS, splitName, state, safeUrl } from './core.js';
import { icon } from './icons.js';
import { soundSettings, setSound, unlockSound } from './sound.js';
import { createCineAudio } from './cine-sound.js';
import { cineMode, shareOn } from './cine-mode.js';

export { cineMode };

const TAU = Math.PI * 2;
const clamp = (x, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const ss = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const eOut3 = (t) => 1 - Math.pow(1 - clamp(t), 3);
const eOutExpo = (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp(t)));
const eInOut = (t) => { t = clamp(t); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const eBack = (t) => { t = clamp(t); const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const noise = (t, s) => Math.sin(t * 1.7 + s) * 0.5 + Math.sin(t * 3.1 + s * 2.3) * 0.3 + Math.sin(t * 7.3 + s * 4.1) * 0.2;

export const SCENES = ['godlike', 'mythic', 'divine', 'knife', 'glove'];
const PAL = {
  godlike: { a: [255, 182, 39], b: [255, 226, 150], c: [255, 112, 24], bg: [14, 9, 3] },
  mythic: { a: [150, 80, 255], b: [214, 150, 255], c: [70, 214, 255], bg: [7, 3, 22] },
  divine: { a: [255, 232, 176], b: [255, 255, 255], c: [140, 200, 255], bg: [8, 8, 14] },
  knife: { a: [205, 222, 245], b: [255, 255, 255], c: [255, 182, 39], bg: [4, 6, 10] },
  glove: { a: [122, 199, 79], b: [244, 162, 89], c: [255, 236, 200], bg: [6, 9, 6] },
};
const TIER_ACC = { godlike: [255, 182, 39], mythic: [170, 96, 255], divine: [190, 228, 255] };
// Время сцены (сек): breach — прорыв/кульминация, reveal — появление предмета, card — итоговая карточка.
const TL = {
  godlike: { breach: 1.9, reveal: 3.1, card: 4.5 },
  mythic: { breach: 1.9, reveal: 3.2, card: 4.6 },
  divine: { breach: 2.5, reveal: 2.72, card: 4.5 },
  knife: { breach: 1.0, reveal: 2.9, card: 4.3 },
  glove: { breach: 1.2, reveal: 2.5, card: 4.0 },
};
const POST = {
  godlike: { bloom: 1.1, thr: 0.3, chroma: 0.003, vig: 0.85, grain: 0.035, expo: 1.55 },
  mythic: { bloom: 1.2, thr: 0.26, chroma: 0.007, vig: 0.9, grain: 0.04, expo: 1.6 },
  divine: { bloom: 1.3, thr: 0.34, chroma: 0.004, vig: 0.8, grain: 0.03, expo: 1.5 },
  knife: { bloom: 0.85, thr: 0.38, chroma: 0.003, vig: 0.95, grain: 0.045, expo: 1.6 },
  glove: { bloom: 0.95, thr: 0.33, chroma: 0.003, vig: 0.9, grain: 0.045, expo: 1.6 },
};
const KICK = { godlike: 'Золотой портал открыт', mythic: 'Пространство разорвано', divine: 'Рождение сверхновой', knife: 'Нож', glove: 'Перчатки' };

// ---------- CSS лениво ----------
let cssP = null;
export function ensureCss() {
  if (cssP) return cssP;
  if (document.querySelector('link[data-cine-css]')) return (cssP = Promise.resolve());
  cssP = new Promise((res) => {
    const l = document.createElement('link');
    l.rel = 'stylesheet'; l.href = '/cine.css?v=1'; l.dataset.cineCss = '1';
    l.onload = () => res(); l.onerror = () => res();
    document.head.append(l);
    setTimeout(res, 2500);
  });
  return cssP;
}

// ---------- Качество ----------
const QS = {
  1: { w: 640, parts: 280, layers: 3, k: 0.35 },
  2: { w: 960, parts: 650, layers: 4, k: 0.6 },
  3: { w: 1440, parts: 1400, layers: 6, k: 1 },
};
function pickQ() {
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(innerWidth, innerHeight) < 720;
  const cores = navigator.hardwareConcurrency || 4;
  const mem = navigator.deviceMemory || 4;
  let q = coarse || small ? 2 : 3;
  if (cores <= 4 || mem <= 3) q--;
  return clamp(q, 1, 3);
}

// ---------- Спрайты ----------
function cnv(w, h = w) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function glowSprite(c) {
  const cv = cnv(64); const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.16, rgba(c, 0.9)); gr.addColorStop(0.42, rgba(c, 0.26)); gr.addColorStop(1, rgba(c, 0));
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return cv;
}
function softSprite(c) {
  const cv = cnv(64); const g = cv.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, rgba(c, 0.55)); gr.addColorStop(0.5, rgba(c, 0.16)); gr.addColorStop(1, rgba(c, 0));
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return cv;
}
function smokeSprite(c) {
  const cv = cnv(128); const g = cv.getContext('2d');
  for (let i = 0; i < 18; i++) {
    const x = rnd(34, 94), y = rnd(34, 94), r = rnd(14, 34);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgba(c, 0.2)); gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  return cv;
}
function cosmosCanvas(P) {
  const s = 512; const cv = cnv(s); const g = cv.getContext('2d');
  const bg = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s * 0.7);
  bg.addColorStop(0, '#1a0b3a'); bg.addColorStop(1, '#030010');
  g.fillStyle = bg; g.fillRect(0, 0, s, s);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 16; i++) {
    const x = rnd(0, s), y = rnd(0, s), r = rnd(40, 170), c = pick([P.a, P.b, P.c]);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgba(c, rnd(0.12, 0.32))); gr.addColorStop(1, rgba(c, 0));
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  }
  for (let i = 0; i < 420; i++) { g.fillStyle = `rgba(255,255,255,${rnd(0.2, 1)})`; const z = Math.random() < 0.92 ? 1 : 2; g.fillRect(rnd(0, s), rnd(0, s), z, z); }
  for (let i = 0; i < 14; i++) {
    const x = rnd(0, s), y = rnd(0, s), r = rnd(4, 10);
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  return cv;
}
function boltPts(x1, y1, x2, y2, disp) {
  let pts = [[x1, y1], [x2, y2]];
  for (let it = 0; it < 5; it++) {
    const np = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1]; const [bx, by] = pts[i];
      const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1, off = (Math.random() - 0.5) * disp;
      np.push([(ax + bx) / 2 - (dy / l) * off, (ay + by) / 2 + (dx / l) * off], pts[i]);
    }
    pts = np; disp *= 0.55;
  }
  return pts;
}

// ---------- WebGL2 пост-обработка ----------
const VS = `#version 300 es
layout(location=0) in vec2 p; out vec2 vUv;
void main(){ vUv = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`;
const FS = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D T; uniform vec2 R; uniform vec2 uC; uniform vec4 uShock; uniform vec3 uFlashC;
uniform float uTime, uBloom, uThr, uChroma, uBlur, uGlitch, uFlash, uVig, uGrain, uExpo, uWarp, uAspect;
float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 samp(vec2 uv){ vec2 d = (uv - uC) * uChroma; return vec3(texture(T, uv + d).r, texture(T, uv).g, texture(T, uv - d).b); }
vec3 bl(vec2 uv, float lod, float thr){ vec2 px = exp2(lod) / R; vec3 c = textureLod(T, uv, lod).rgb * 0.4;
  c += textureLod(T, uv + vec2(px.x, 0.0), lod).rgb * 0.15; c += textureLod(T, uv - vec2(px.x, 0.0), lod).rgb * 0.15;
  c += textureLod(T, uv + vec2(0.0, px.y), lod).rgb * 0.15; c += textureLod(T, uv - vec2(0.0, px.y), lod).rgb * 0.15;
  return max(c - thr, 0.0); }
void main(){
  vec2 uv = vUv;
  if (uGlitch > 0.001) { float row = floor(uv.y * 26.0) + floor(uTime * 17.0) * 7.0; float n = h(vec2(row, floor(uTime * 23.0)));
    if (n < uGlitch * 0.45) uv.x += (h(vec2(row, 3.7)) - 0.5) * 0.14 * uGlitch; }
  if (uWarp > 0.001) { vec2 d = uv - uC; d.x *= uAspect; float l = length(d); uv += (uv - uC) * uWarp * sin(l * 22.0 - uTime * 5.0) * 0.018 / (0.25 + l); }
  if (uShock.w > 0.001) { vec2 d = uv - uShock.xy; d.x *= uAspect; float l = length(d); float x = l - uShock.z; float band = exp(-x * x * 700.0);
    vec2 dir = l > 0.0001 ? d / l : vec2(0.0); dir.x /= uAspect; uv -= dir * band * uShock.w * 0.05; }
  vec3 c;
  if (uBlur > 0.001) { vec2 d = (uv - uC) * uBlur; c = vec3(0.0); float tw = 0.0;
    for (int i = 0; i < 8; i++) { float w = 1.0 - float(i) / 9.0; c += samp(uv - d * float(i) / 7.0) * w; tw += w; } c /= tw; }
  else c = samp(uv);
  vec3 b = bl(uv, 2.0, uThr) * 0.45 + bl(uv, 3.5, uThr) * 0.7 + bl(uv, 5.0, uThr * 0.8) * 0.9 + bl(uv, 6.5, uThr * 0.6) * 1.15;
  c += b * uBloom + uFlashC * uFlash;
  c = vec3(1.0) - exp(-c * uExpo);
  vec2 q = vUv - 0.5; q.x *= mix(1.0, uAspect, 0.6); c *= mix(1.0, smoothstep(0.9, 0.18, length(q)), uVig);
  c += (h(vUv * R + fract(uTime) * 91.0) - 0.5) * uGrain;
  o = vec4(c, 1.0);
}`;
function makeGL(cv) {
  let gl = null;
  try { gl = cv.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' }); } catch { gl = null; }
  if (!gl) return null;
  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { console.warn('[cine] shader', gl.getShaderInfoLog(s)); return null; }
    return s;
  };
  const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return null;
  const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return null;
  gl.useProgram(pr);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const tex = gl.createTexture(); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  const U = {};
  for (const n of ['T', 'R', 'uC', 'uShock', 'uFlashC', 'uTime', 'uBloom', 'uThr', 'uChroma', 'uBlur', 'uGlitch', 'uFlash', 'uVig', 'uGrain', 'uExpo', 'uWarp', 'uAspect']) U[n] = gl.getUniformLocation(pr, n);
  gl.uniform1i(U.T, 0);
  return {
    draw(src, P, w, h) {
      if (gl.isContextLost()) return false;
      if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
      gl.viewport(0, 0, w, h);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.uniform2f(U.R, w, h); gl.uniform2f(U.uC, P.cx, P.cy); gl.uniform4f(U.uShock, P.shock[0], P.shock[1], P.shock[2], P.shock[3]);
      gl.uniform3f(U.uFlashC, P.flashC[0], P.flashC[1], P.flashC[2]);
      gl.uniform1f(U.uTime, P.time); gl.uniform1f(U.uBloom, P.bloom); gl.uniform1f(U.uThr, P.thr); gl.uniform1f(U.uChroma, P.chroma);
      gl.uniform1f(U.uBlur, P.blur); gl.uniform1f(U.uGlitch, P.glitch); gl.uniform1f(U.uFlash, P.flash); gl.uniform1f(U.uVig, P.vig);
      gl.uniform1f(U.uGrain, P.grain); gl.uniform1f(U.uExpo, P.expo); gl.uniform1f(U.uWarp, P.warp); gl.uniform1f(U.uAspect, w / h);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return true;
    },
    destroy() { try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ } },
  };
}

// ---------- Сцена ----------
let active = null;

class Cine {
  constructor(o, resolve) {
    this.o = o; this.resolve = resolve; this.item = o.item; this.fx = o.fx;
    const sc = o.fx.scene;
    this.scene = SCENES.includes(sc) ? sc : SCENES.includes(o.fx.tier) ? o.fx.tier : 'godlike';
    this.tier = o.fx.tier || null;
    this.pal = { ...PAL[this.scene] };
    if ((this.scene === 'knife' || this.scene === 'glove') && this.tier) this.pal.c = TIER_ACC[this.tier];
    this.tl = TL[this.scene];
    this.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.mode = this.reduce ? 'short' : o.mode === 'short' ? 'short' : 'full';
    this.speed = this.mode === 'short' ? 2.1 : 1;
    this.q = pickQ(); this.Q = QS[this.q];
    this.T = 0; this.RT = 0; this.phase = 'intro'; this.cardRT = 0; this.frameN = 0; this.ema = 1 / 60; this.slowN = 0;
    this.imp = { flash: 0, trauma: 0, glitch: 0, chroma: 0, blur: 0, zoom: 0 };
    this.flashC = [1, 0.97, 0.9]; this.expoMul = 1; this.warp = 0;
    this.parts = []; this.bolts = []; this.rings = []; this.shocks = []; this.acc = {};
    this.it = { x: 0, y: 0, s: 0.1, rx: 0, ry: 0, rz: 0, op: 0 };
    this.cam = { zoom: 1, rot: 0 };
    this.insp = null; this.skipping = false; this.dead = false; this.lastZap = 0; this.prevRy = 0; this.lastHalf = 0; this.priceTxt = '';
    this.audio = createCineAudio(this.scene);
    this.drone = null; this.riser = null;
    this.sprites();
    this.buildDom();
    this.setupCanvas();
    this.prepScene();
    this.cues = this.makeCues().sort((a, b) => a.t - b.t);
    this.bind();
    this.frame = this.frame.bind(this);
    this.raf = requestAnimationFrame(this.frame);
  }

  // --- ресурсы ---
  sprites() {
    const P = this.pal; const W = [255, 255, 255];
    this.spr = { a: glowSprite(P.a), b: glowSprite(P.b), c: glowSprite(P.c), w: glowSprite(W), sa: softSprite(P.a), sb: softSprite(P.b), sc: softSprite(P.c), sw: softSprite(W) };
    if (this.scene === 'glove') this.spr.sm = smokeSprite([150, 170, 150]);
    if (this.scene === 'mythic') this.cosmos = cosmosCanvas(P);
    this.cols = { a: `rgb(${P.a})`, b: `rgb(${P.b})`, c: `rgb(${P.c})`, w: '#fff' };
  }

  buildDom() {
    const it = this.item, fx = this.fx, o = this.o;
    const src = safeUrl(it.image, '/img/brand/item.svg');
    const [weapon, skin] = splitName(it.name || '');
    const n = this.Q.layers;
    const layers = [];
    for (let i = n - 1; i >= 0; i--) layers.push(html`<img class="cl ${i === 0 ? 'front' : i === n - 1 ? 'back' : 'mid'}" src="${src}" alt="" draggable="false" style="--z:${i}">`);
    const words = String(fx.label || 'EPIC DROP').split(' ');
    let li = 0;
    const title = words.map((w) => html`<span class="cw">${[...w].map((ch) => html`<span class="ch" style="--i:${li++}">${ch}</span>`)}</span>`);
    const chips = [];
    if (this.tier && (this.scene === 'knife' || this.scene === 'glove')) chips.push(html`<span class="cine-chip tier">${this.tier.toUpperCase()}</span>`);
    if (it.wear && WEARS[it.wear]) chips.push(html`<span class="cine-chip">${WEARS[it.wear]}</span>`);
    if (it.float != null && it.float !== '') chips.push(html`<span class="cine-chip mono">Float ${Number(it.float).toFixed(4)}</span>`);
    if (it.stattrak || it.variant === 'st') chips.push(html`<span class="cine-chip st">StatTrak™</span>`);
    if (it.souvenir || it.variant === 'sv') chips.push(html`<span class="cine-chip sv">Сувенир</span>`);
    if (it.rarityName) chips.push(html`<span class="cine-chip rar" style="--rc:${/^#[0-9a-f]{3,8}$/i.test(it.color || '') ? it.color : '#b0c3d9'}">${it.rarityName}</span>`);
    const canShare = !!o.share && shareOn();
    const tag = o.preview ? 'Предпросмотр' : o.replay ? 'Повтор' : '';
    const sub = [o.caseName ? `Кейс «${o.caseName}»` : '', o.others > 0 ? `+${o.others} ${plural(o.others, 'предмет', 'предмета', 'предметов')} в открытии` : ''].filter(Boolean).join(' · ');
    const root = document.createElement('div');
    root.className = `cine cine-${this.scene}${this.tier ? ' tier-' + this.tier : ''} q${this.q}${this.mode === 'short' ? ' short' : ''}`;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', fx.label || 'Редкий дроп');
    root.style.setProperty('--img', `url("${String(src).replace(/["\\\n\r]/g, '')}")`);
    root.style.setProperty('--ca', `rgb(${this.pal.a})`); root.style.setProperty('--cb', `rgb(${this.pal.b})`); root.style.setProperty('--cc', `rgb(${this.pal.c})`);
    mount(root, html`
      <div class="cine-stage">
        <div class="cine-item"><div class="cine-obj">${layers}<i class="cine-white"></i><i class="cine-glint"></i></div>
          <img class="cine-ghost g1" src="${src}" alt="" draggable="false"><img class="cine-ghost g2" src="${src}" alt="" draggable="false"></div>
      </div>
      <div class="cine-hud">
        ${tag ? html`<span class="cine-tag">${tag}</span>` : ''}
        <div class="cine-snd"><button class="cine-ib" data-c-mute aria-label="Звук"></button><input type="range" min="0" max="100" step="1" data-c-vol aria-label="Громкость кинодропов"></div>
        <button class="cine-skip" data-c-skip>Пропустить ${icon('chevronRight')}</button>
        <button class="cine-ib cine-x" data-c-close aria-label="Закрыть">${icon('close')}</button>
      </div>
      <div class="cine-card">
        <div class="cine-top"><div class="cine-kicker">${KICK[this.scene]}</div><h2 class="cine-title">${title}</h2></div>
        <div class="cine-info">
          <div class="cine-wpn">${skin ? weapon : ''}</div>
          <div class="cine-name">${skin || weapon}</div>
          <div class="cine-chips">${chips}</div>
          <div class="cine-price"><small>Стоимость на момент дропа</small><b data-c-price>${rub(0)}</b>${o.priceNow && o.priceNow !== it.price ? html`<small>сейчас ${rub(o.priceNow)}</small>` : ''}</div>
          ${sub ? html`<div class="cine-sub">${sub}</div>` : ''}
          <div class="cine-acts">
            ${canShare ? html`<button class="cine-btn gold" data-c-share>${icon('link')} Поделиться дропом</button>` : ''}
            <button class="cine-btn" data-c-inspect>${icon('eye')} Рассмотреть</button>
            <button class="cine-btn ghost" data-c-close>Продолжить</button>
          </div>
        </div>
      </div>
      <div class="cine-insp"><span>Тяните — вращение · колесо или щипок — приближение · двойной клик — сброс</span><button class="cine-btn" data-c-done>${icon('check')} Готово</button></div>`);
    this.root = root;
    this.stage = root.querySelector('.cine-stage');
    this.itemEl = root.querySelector('.cine-item');
    this.ghosts = [...root.querySelectorAll('.cine-ghost')];
    this.priceEl = root.querySelector('[data-c-price]');
    this.prevFocus = document.activeElement;
    document.documentElement.classList.add('cine-open');
    document.body.append(root);
    this.syncSoundUi();
  }

  setupCanvas() {
    this.sc = cnv(4); this.g = this.sc.getContext('2d', { alpha: false });
    const out = cnv(4); out.className = 'cine-gl';
    this.post = makeGL(out);
    if (this.post) {
      this.out = out;
      out.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.post = null; this.useFallback(); });
    } else this.useFallback(true);
    this.stage.prepend(this.out);
    this.resize();
  }
  useFallback(initial = false) {
    this.sc.className = 'cine-gl';
    if (!initial && this.out && this.out !== this.sc) this.out.replaceWith(this.sc);
    this.out = this.sc;
    this.bc = cnv(4); this.bg = this.bc.getContext('2d');
    this.vig = null;
  }
  resize() {
    const iw = innerWidth, ih = innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, 1.25);
    const W = Math.max(320, Math.round(Math.min(iw * dpr, this.Q.w)));
    const H = Math.max(200, Math.round((W * ih) / iw));
    this.W = W; this.H = H; this.sc.width = W; this.sc.height = H;
    this.U = Math.min(W, H) / 1000; this.hw = W / 2 / this.U; this.hh = H / 2 / this.U;
    this.K = Math.min(iw, ih) / 1000;
    this.portrait = ih > iw * 1.1;
    const S = Math.min(Math.min(iw, ih) * (this.portrait ? 0.8 : 0.55), 600);
    this.root.style.setProperty('--S', S.toFixed(1) + 'px');
    this.root.style.setProperty('--dz', (S * 0.0062).toFixed(2) + 'px');
    this.g.lineJoin = 'round'; this.g.lineCap = 'round';
    if (this.bc) { this.bc.width = Math.max(40, W >> 3); this.bc.height = Math.max(24, H >> 3); this.vig = null; }
    if (this.stars) this.makeStars();
  }

  // --- подготовка сцен ---
  prepScene() {
    if (this.scene === 'mythic' || this.scene === 'divine') this.makeStars();
    if (this.scene === 'mythic') {
      const L = this.hw * 1.35, N = 56, pts = [];
      let y = 0;
      for (let i = 0; i <= N; i++) {
        const x = -L + (2 * L * i) / N;
        y = (y + rnd(-1, 1) * 30) * 0.9;
        const e = Math.max(0, 1 - Math.pow(Math.abs(x) / L, 2));
        pts.push({ x, y: y * 0.8, w: Math.pow(e, 0.8) * rnd(0.6, 1.1) });
      }
      this.crack = { pts, L, ang: -0.2 };
    }
  }
  makeStars() {
    const n = Math.round(260 * this.Q.k + 60);
    this.stars = [];
    for (let i = 0; i < n; i++) this.stars.push({ x: rnd(-this.hw, this.hw), y: rnd(-this.hh, this.hh), z: Math.random() });
  }

  // --- звук ---
  snd(name, ...a) { if (this.skipping) return null; try { return this.audio[name](...a); } catch { return null; } }
  r(s) { return s / this.speed; }
  syncSoundUi() {
    const s = soundSettings();
    const muted = !s.enabled || !(s.master > 0) || this.audio.silent;
    const b = this.root.querySelector('[data-c-mute]');
    if (b) { b.innerHTML = String(icon(muted ? 'volumeOff' : 'volume')); b.setAttribute('aria-pressed', muted ? 'true' : 'false'); }
    const v = this.root.querySelector('[data-c-vol]');
    if (v) v.value = String(Math.round((s.cinema ?? 0.9) * 100));
  }
  toggleMute() {
    const s = soundSettings();
    const muted = !s.enabled || !(s.master > 0) || this.audio.silent;
    if (muted) {
      setSound({ enabled: true, master: s.master > 0 ? s.master : 0.7, cinema_sounds: true, cinema: (s.cinema ?? 0) > 0 ? s.cinema : 0.9 });
      try { unlockSound(); } catch { /* ignore */ }
      if (this.audio.silent) this.audio = createCineAudio(this.scene);
    } else setSound({ enabled: false });
    this.syncSoundUi();
  }

  // --- таймлайн ---
  beats(until) {
    const out = []; let t = 0.1, gap = 0.82;
    while (t < until - 0.12) { out.push(t); t += gap; gap = Math.max(0.27, gap * 0.82); }
    return out;
  }
  makeCues() {
    const tl = this.tl, sc = this.scene, C = [];
    const at = (t, fn) => C.push({ t, fn, done: false });
    const hbEnd = sc === 'divine' ? tl.breach - 0.5 : tl.reveal;
    for (const t of this.beats(hbEnd)) at(t, () => this.snd('heartbeat', 0.35 + 0.65 * (t / hbEnd)));
    at(0, () => { this.drone = this.snd('drone', this.r(tl.card + 0.5)); });
    if (sc === 'godlike') {
      at(tl.breach - 1.1, () => { this.riser = this.snd('riser', this.r(1.1)); });
      at(tl.breach, () => this.breachGodlike());
      at(tl.reveal - 0.9, () => { this.riser = this.snd('riser', this.r(0.9)); });
      at(tl.reveal, () => this.revealCommon(1));
    } else if (sc === 'mythic') {
      at(tl.breach - 1.2, () => { this.riser = this.snd('riser', this.r(1.2)); });
      at(tl.breach, () => this.breachMythic());
      at(tl.reveal - 0.9, () => { this.riser = this.snd('riser', this.r(0.9)); });
      at(tl.reveal, () => this.revealCommon(1));
    } else if (sc === 'divine') {
      at(0.4, () => { this.riser = this.snd('riser', this.r(tl.breach - 0.9)); });
      at(2.0, () => this.snd('suck', this.r(tl.breach - 2.0)));
      at(tl.breach, () => this.breachDivine());
      at(tl.breach + 0.1, () => this.shock(0, 0, 1.0, 0.8, 1.4));
      at(tl.breach + 0.26, () => this.shock(0, 0, 0.7, 0.55, 1.6));
      at(tl.reveal, () => { this.snd('reveal'); this.glint(); });
    } else if (sc === 'knife') {
      at(0.15, () => this.snd('impact', 0.22));
      at(0.45, () => this.snd('impact', 0.26));
      at(tl.breach - 0.5, () => { this.riser = this.snd('riser', this.r(1.4)); });
      at(tl.breach, () => this.snd('whoosh', 0.8));
      at(tl.reveal, () => this.revealKnife());
    } else {
      at(0.3, () => this.snd('lights'));
      at(tl.breach - 0.6, () => { this.riser = this.snd('riser', this.r(1.6)); });
      at(tl.breach, () => { this.snd('lights'); this.snd('whoosh', 0.6); });
      at(tl.reveal, () => this.revealGlove());
    }
    at(tl.card, () => this.showCard());
    return C;
  }
  runCues() {
    for (const c of this.cues) if (!c.done && c.t <= this.T) { c.done = true; try { c.fn(); } catch (e) { console.warn('[cine]', e); } }
  }
  slowWin() {
    const tl = this.tl;
    if (this.scene === 'divine') return [tl.breach + 0.02, tl.breach + 1.05];
    if (this.scene === 'knife') return [tl.reveal - 0.5, tl.reveal + 0.4];
    return [tl.reveal - 0.04, tl.reveal + 0.85];
  }
  slowAt(T) {
    if (this.phase === 'card') return 1;
    const [a, b] = this.slowWin();
    const k = ss(a - 0.12, a, T) * (1 - ss(b - 0.3, b, T));
    return lerp(1, this.mode === 'short' ? 0.55 : 0.28, k);
  }

  // --- эффекты ---
  P(o) {
    if (this.parts.length >= this.Q.parts) return null;
    const p = { x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 4, c: 'a', t: 0, alpha: 1, drag: 0, g: 0, att: 0, tl: 0.04, rot: 0, vr: 0, wob: 0, ph: Math.random() * TAU, ...o };
    this.parts.push(p); return p;
  }
  emit(key, rate, dt, fn) {
    if (!(rate > 0)) return;
    let n = (this.acc[key] || 0) + rate * dt;
    while (n >= 1) { fn(); n -= 1; }
    this.acc[key] = n;
  }
  sparks(n, x, y, o = {}) {
    const k = this.Q.k, cols = o.cols || ['a', 'b', 'w'];
    for (let i = 0; i < n * k; i++) {
      const a = o.ang != null ? o.ang + rnd(-o.spread, o.spread) : rnd(0, TAU);
      const sp = rnd(o.min ?? 400, o.max ?? 1600);
      this.P({ t: 1, x: x + Math.cos(a) * (o.r0 || 0), y: y + Math.sin(a) * (o.r0 || 0), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, max: rnd((o.life ?? 1.2) * 0.45, o.life ?? 1.2), size: rnd(1.2, o.size ?? 3.4), c: pick(cols), drag: o.drag ?? 2.4, g: o.g ?? 0, tl: o.tl ?? 0.035 });
    }
  }
  ring(x, y, o = {}) { this.rings.push({ x, y, r: o.r0 ?? 20, vr: o.vr ?? 1500, w: o.w ?? 8, c: o.c || 'b', life: 0, max: o.life ?? 0.9, decel: o.decel ?? 1.6, sq: o.sq ?? 1, a: o.a ?? 1, inward: !!o.inward }); }
  shock(x, y, amp = 1, life = 0.9, speed = 1.25) { this.shocks.push({ x, y, amp, life: 0, max: life, speed }); }
  bolt(x1, y1, x2, y2, o = {}) {
    const L = Math.hypot(x2 - x1, y2 - y1);
    const path = new Path2D();
    const add = (pts) => { path.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]); };
    const pts = boltPts(x1, y1, x2, y2, o.disp ?? L * 0.32); add(pts);
    const nb = Math.random() < 0.75 ? (Math.random() < 0.4 ? 2 : 1) : 0;
    for (let b = 0; b < nb; b++) {
      const [bx, by] = pts[(pts.length * rnd(0.25, 0.7)) | 0];
      const a = Math.atan2(y2 - y1, x2 - x1) + rnd(-0.9, 0.9), l = L * rnd(0.18, 0.42);
      add(boltPts(bx, by, bx + Math.cos(a) * l, by + Math.sin(a) * l, l * 0.35));
    }
    this.bolts.push({ path, c: o.c || 'b', w: o.w ?? 3, life: 0, max: o.life ?? 0.14 });
    this.imp.flash = Math.min(0.6, this.imp.flash + (o.flash ?? 0.04));
    if (this.RT - this.lastZap > 0.085) { this.lastZap = this.RT; this.snd('zap', o.lvl ?? rnd(0.35, 0.8)); }
  }
  hit(flash, trauma, o = {}) {
    const im = this.imp;
    im.flash = Math.max(im.flash, flash); im.trauma = Math.min(1, Math.max(im.trauma, trauma));
    if (o.chroma) im.chroma = Math.max(im.chroma, o.chroma);
    if (o.blur) im.blur = Math.max(im.blur, o.blur);
    if (o.glitch) im.glitch = Math.max(im.glitch, o.glitch);
    if (o.zoom) im.zoom = o.zoom;
    if (o.col) this.flashC = o.col;
    if (navigator.vibrate && !this.skipping && trauma > 0.6 && !this.reduce) { try { navigator.vibrate(trauma > 0.9 ? [40, 30, 70] : 35); } catch { /* ignore */ } }
  }
  glint() { const g = this.root.querySelector('.cine-glint'); if (!g) return; g.classList.remove('go'); void g.offsetWidth; g.classList.add('go'); }
  rgb(ms = 160) { this.itemEl.classList.add('rgb'); clearTimeout(this.rgbT); this.rgbT = setTimeout(() => this.itemEl?.classList.remove('rgb'), ms); }
  stopRiser() { try { this.riser?.stop?.(0.08); } catch { /* ignore */ } this.riser = null; }

  breachGodlike() {
    this.stopRiser();
    this.snd('portal'); this.snd('impact', 0.6);
    try { this.drone?.swell?.(1600, this.r(1.2)); } catch { /* ignore */ }
    this.hit(0.6, 0.7, { chroma: 0.8, blur: 0.5, zoom: 0.05, col: [1, 0.86, 0.55] });
    this.shock(0, 0, 0.9, 0.9);
    this.ring(0, 0, { r0: 120, vr: 1700, w: 10, c: 'b', life: 0.9 });
    this.ring(0, 0, { r0: 80, vr: 1100, w: 5, c: 'a', life: 1.1 });
    this.sparks(140, 0, 0, { r0: 120, min: 500, max: 1900, cols: ['a', 'b', 'w'] });
    for (let i = 0; i < 4; i++) { const a = rnd(0, TAU); this.bolt(Math.cos(a) * 310, Math.sin(a) * 310, Math.cos(a) * 1300, Math.sin(a) * 1300, { c: 'b', w: 4, life: 0.2, lvl: 0.9 }); }
  }
  breachMythic() {
    this.stopRiser();
    this.snd('tear'); this.snd('impact', 0.7);
    try { this.drone?.swell?.(1200, this.r(1.2)); } catch { /* ignore */ }
    this.hit(0.55, 0.85, { chroma: 1.4, blur: 0.4, glitch: 1, zoom: 0.05, col: [0.75, 0.45, 1] });
    this.rgb(450);
    this.shock(0, 0, 1, 0.9);
    this.ring(0, 0, { r0: 60, vr: 1600, w: 8, c: 'b', life: 0.9 });
    this.ring(0, 0, { r0: 40, vr: 900, w: 4, c: 'c', life: 1.2 });
    const k = this.Q.k, cr = this.crack, ca = Math.cos(cr.ang), sa = Math.sin(cr.ang);
    for (let i = 0; i < 150 * k; i++) {
      const p = pick(cr.pts); if (p.w < 0.15) continue;
      const side = Math.random() < 0.5 ? -1 : 1, sp = rnd(200, 800), lx = p.x, ly = p.y + side * p.w * 60;
      const wx = lx * ca - ly * sa, wy = lx * sa + ly * ca, nx = -sa * side, ny = ca * side;
      const s = rnd(8, 36);
      this.P({ t: 2, x: wx, y: wy, vx: nx * sp + rnd(-120, 120), vy: ny * sp + rnd(-120, 120), max: rnd(1.2, 2.6), size: s, c: pick(['b', 'c', 'a']), drag: 1.2, vr: rnd(-6, 6), rot: rnd(0, TAU),
        v: [rnd(-1, 1) * s, -s, s, rnd(-0.5, 0.5) * s, -s * rnd(0.3, 1), s] });
    }
    for (let i = 0; i < 6; i++) this.tearBolt(true);
  }
  breachDivine() {
    this.stopRiser();
    try { this.drone?.stop?.(0.3); } catch { /* ignore */ }
    this.drone = null;
    this.snd('finalHit'); this.snd('impact', 1);
    this.hit(1, 1, { chroma: 1.3, blur: 0.9, zoom: -0.06, col: [1, 0.97, 0.88] });
    this.shock(0, 0, 1.2, 1.0, 1.15);
    this.ring(0, 0, { r0: 30, vr: 2600, w: 26, c: 'w', life: 1.1, decel: 1.2 });
    this.ring(0, 0, { r0: 20, vr: 1900, w: 14, c: 'a', life: 1.3, decel: 1.4 });
    this.ring(0, 0, { r0: 10, vr: 1300, w: 8, c: 'c', life: 1.6, decel: 1.6 });
    this.ring(0, 0, { r0: 10, vr: 2200, w: 6, c: 'b', life: 1.2, sq: 0.22 });
    this.sparks(380, 0, 0, { min: 900, max: 2800, life: 2.2, drag: 1.5, cols: ['w', 'a', 'c', 'b'], size: 4 });
    const k = this.Q.k;
    for (let i = 0; i < 46 * k + 10; i++) {
      const a = rnd(0, TAU), sp = rnd(50, 240);
      this.P({ t: 0, soft: true, x: Math.cos(a) * rnd(0, 80), y: Math.sin(a) * rnd(0, 80), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, drag: 0.5, max: rnd(8, 15), size: rnd(140, 380), c: pick(['a', 'c', 'b']), alpha: rnd(0.25, 0.45), fin: 0.05 });
    }
  }
  revealCommon(power) {
    this.stopRiser();
    this.snd('impact', power); this.snd('reveal');
    try { this.drone?.swell?.(2400, this.r(0.8)); } catch { /* ignore */ }
    const myth = this.scene === 'mythic';
    this.hit(0.85, 0.95, { chroma: myth ? 1.6 : 1, blur: 0.65, zoom: 0.07, glitch: myth ? 0.8 : 0, col: myth ? [0.85, 0.65, 1] : [1, 0.92, 0.7] });
    if (myth) this.rgb(600);
    this.shock(0, 0, 1, 1);
    this.ring(0, 0, { r0: 100, vr: 2100, w: 12, c: 'w', life: 0.9 });
    this.ring(0, 0, { r0: 60, vr: 1400, w: 7, c: myth ? 'a' : 'b', life: 1.1 });
    this.ring(0, 0, { r0: 40, vr: 900, w: 4, c: myth ? 'c' : 'a', life: 1.4 });
    this.sparks(220, 0, 0, { min: 600, max: 2200, cols: myth ? ['a', 'b', 'c', 'w'] : ['a', 'b', 'w'] });
    this.glint();
  }
  revealKnife() {
    this.stopRiser();
    this.snd('shing'); this.snd('impact', 0.8); this.snd('reveal');
    this.hit(0.4, 0.55, { chroma: 0.7, blur: 0.25, zoom: 0.04, col: [0.9, 0.95, 1] });
    this.shock(0, 0, 0.7, 0.8);
    this.ring(0, 0, { r0: 120, vr: 1500, w: 5, c: 'w', life: 0.8 });
    this.ring(0, 0, { r0: 120, vr: 1100, w: 4, c: 'c', life: 1.0, sq: 0.25 });
    this.sparks(120, 0, 0, { min: 500, max: 1700, cols: ['w', 'a', 'c'], g: 900, drag: 1.6, life: 1.3 });
    this.glint();
  }
  revealGlove() {
    this.stopRiser();
    this.snd('impact', 0.8); this.snd('reveal');
    this.hit(0.45, 0.45, { chroma: 0.6, blur: 0.3, zoom: 0.04, col: [1, 0.85, 0.65] });
    this.shock(0, 120, 0.7, 0.8);
    this.ring(0, 170, { r0: 80, vr: 1300, w: 8, c: 'b', life: 1.0, sq: 0.28 });
    this.ring(0, 170, { r0: 60, vr: 800, w: 5, c: 'a', life: 1.3, sq: 0.28 });
    this.sparks(140, 0, 160, { ang: -Math.PI / 2, spread: 1.1, min: 300, max: 1300, cols: ['b', 'c', 'a'], g: 500, drag: 1.4, life: 1.8 });
    this.glint();
  }
  tearBolt(strong = false) {
    const cr = this.crack; const p = pick(cr.pts.filter((q) => q.w > 0.25));
    if (!p) return;
    const side = Math.random() < 0.5 ? -1 : 1, ca = Math.cos(cr.ang), sa = Math.sin(cr.ang);
    const op = this.tearOpen || 0.2, lx = p.x, ly = p.y + side * p.w * 115 * op;
    const wx = lx * ca - ly * sa, wy = lx * sa + ly * ca;
    const a = Math.atan2(ca * side, -sa * side) + rnd(-0.7, 0.7), L = rnd(260, strong ? 900 : 600);
    this.bolt(wx, wy, wx + Math.cos(a) * L, wy + Math.sin(a) * L, { c: pick(['a', 'b', 'c']), w: strong ? 3.6 : rnd(1.8, 3), life: rnd(0.08, 0.18) });
  }

  showCard() {
    if (this.phase === 'card') return;
    this.phase = 'card'; this.cardRT = this.RT;
    this.stopRiser();
    try { this.drone?.stop?.(1.4); } catch { /* ignore */ }
    this.drone = null;
    if (this.scene === 'divine') this.snd('impact', 0.5); else this.snd('finalHit');
    this.hit(0.25, 0.3, {});
    this.ring(0, this.cardY(), { r0: 160, vr: 900, w: 4, c: 'b', life: 1.1 });
    this.root.classList.add('card');
    const btn = this.root.querySelector('.cine-acts [data-c-close]');
    setTimeout(() => { if (!this.dead && !this.insp) btn?.focus({ preventScroll: true }); }, 400);
  }
  skip() {
    if (this.phase === 'card' || this.dead) return;
    this.skipping = true;
    for (const c of this.cues) if (!c.done && c.t < this.tl.card) { c.done = true; try { c.fn(); } catch { /* ignore */ } }
    this.skipping = false;
    try { this.audio.stopAll(0.12); } catch { /* ignore */ }
    this.drone = null; this.riser = null;
    this.T = this.tl.card;
    const im = this.imp; im.flash = Math.min(im.flash, 0.35); im.trauma = Math.min(im.trauma, 0.3); im.blur = 0; im.glitch = Math.min(im.glitch, 0.2); im.chroma = Math.min(im.chroma, 0.4);
    this.shocks.length = 0;
    this.snd('reveal');
    this.runCues();
  }

  // --- поза предмета ---
  cardY() { return this.portrait ? -90 : -40; }
  revealPose(T) {
    const tl = this.tl, sc = this.scene;
    const o = { x: 0, y: 0, s: 0.1, rx: 0, ry: 0, rz: 0, op: 0 };
    if (sc === 'godlike' || sc === 'mythic') {
      if (T < tl.reveal) return o;
      const p = (T - tl.reveal) / 0.95, e = eOut3(p);
      o.s = lerp(0.12, 1, eBack(p)); o.ry = (1 - e) * (sc === 'mythic' ? 720 : 540); o.rx = (1 - e) * -18;
      o.rz = (1 - e) * (sc === 'mythic' ? 16 : -9); o.y = lerp(30, 0, e); o.op = ss(0, 0.16, p);
    } else if (sc === 'divine') {
      if (T < tl.reveal) return o;
      const p = (T - tl.reveal) / 1.25, e = eOut3(p);
      o.s = lerp(1.32, 1, e); o.ry = lerp(-28, 0, e); o.rx = lerp(10, 0, e); o.op = ss(0, 0.12, p);
    } else if (sc === 'knife') {
      const t0 = tl.breach, t1 = tl.reveal, tE = tl.reveal + 0.45;
      if (T < t0) return o;
      const p = clamp((T - t0) / (t1 - t0)), e = eOut3(p);
      o.s = lerp(0.06, 1, e); o.y = lerp(-90, 0, e);
      o.ry = 2160 * eOut3(clamp((T - t0) / (tE - t0)));
      o.rz = Math.sin(p * Math.PI) * -14; o.rx = 9 * (1 - e); o.op = ss(t0, t0 + 0.22, T);
    } else {
      const t0 = tl.breach, t1 = tl.reveal;
      if (T < t0) return o;
      const p = clamp((T - t0) / (t1 - t0)), e = eOut3(p);
      o.y = lerp(this.hh + 260, 0, e); o.s = lerp(0.82, 1, e);
      o.ry = lerp(-42, 0, e) + Math.sin(T * 2.2) * 8 * (1 - e); o.rz = lerp(-12, 0, e); o.rx = lerp(16, 0, e);
      o.op = ss(t0, t0 + 0.3, T);
    }
    return o;
  }
  pose(T, dr) {
    const it = this.it;
    if (this.insp) {
      const s = this.insp;
      if (!s.drag) {
        s.ry += s.vy * dr; s.rx += s.vx * dr; const d = Math.exp(-2.6 * dr); s.vx *= d; s.vy *= d;
        s.idle += dr; if (s.idle > 2.2) { s.ry += 22 * dr; s.rx = lerp(s.rx, 0, 1 - Math.exp(-1.5 * dr)); }
      }
      s.rx = clamp(s.rx, -65, 65);
      Object.assign(it, { x: 0, y: 0, s: 1.12 * s.zoom, rx: s.rx, ry: s.ry, rz: 0, op: 1 });
      return;
    }
    const tl = this.tl;
    if (T >= tl.card) {
      const u = T - tl.card, k = eOut3(u / 0.9), b = this.revealPose(tl.card);
      let bry = ((b.ry % 360) + 540) % 360 - 180;
      const n = Math.floor(u / 9), pu = u - n * 9;
      const spin = n >= 1 && pu < 1.7 ? 360 * eInOut(pu / 1.7) : 0;
      const cs = this.portrait ? 0.98 : 0.86;
      it.x = 0; it.y = lerp(b.y, this.cardY(), k) + Math.sin(u * 1.3) * 6 * ss(0, 1, u);
      it.s = lerp(b.s, cs, k); it.rx = lerp(b.rx, 0, k) + Math.sin(u * 0.8) * 4 * ss(0, 1.5, u);
      it.ry = lerp(bry, 0, k) + Math.sin(u * 0.55) * 26 * ss(0, 1.5, u) + spin; it.rz = lerp(b.rz, 0, k); it.op = 1;
      return;
    }
    Object.assign(it, this.revealPose(T));
  }

  // --- обновление ---
  update(dt, dr) {
    const im = this.imp;
    im.flash *= Math.exp(-3.2 * dt); im.trauma = Math.max(0, im.trauma - 1.35 * dt); im.glitch *= Math.exp(-5 * dt);
    im.chroma *= Math.exp(-3 * dt); im.blur *= Math.exp(-3.4 * dt); im.zoom *= Math.exp(-4 * dt);
    this.sceneUpdate(dt);
    // частицы
    const a = this.parts; let j = 0;
    for (let i = 0; i < a.length; i++) {
      const p = a[i]; p.life += dt;
      if (p.life >= p.max) continue;
      if (p.t === 4) {
        p.px = p.x; p.py = p.y; p.ang += p.va * dt; p.r += p.vr * dt; p.va *= 1 + dt * 0.7;
        if (p.r < 6) continue;
        p.x = p.cx + Math.cos(p.ang) * p.r; p.y = p.cy + Math.sin(p.ang) * p.r * p.sq;
      } else {
        if (p.att) { const l = Math.hypot(p.x, p.y) || 1; if (l < 16) continue; p.vx -= (p.x / l) * p.att * dt; p.vy -= (p.y / l) * p.att * dt; }
        p.vy += p.g * dt;
        if (p.drag) { const d = Math.exp(-p.drag * dt); p.vx *= d; p.vy *= d; }
        p.x += p.vx * dt; p.y += p.vy * dt;
        if (p.wob) p.x += Math.sin(p.life * p.wob + p.ph) * 14 * dt;
        if (p.vr) p.rot += p.vr * dt;
      }
      a[j++] = p;
    }
    a.length = j;
    for (const b of this.bolts) b.life += dt;
    this.bolts = this.bolts.filter((b) => b.life < b.max);
    for (const r of this.rings) { r.life += dt; r.r += r.vr * dt; if (r.decel) r.vr *= Math.exp(-r.decel * dt); }
    this.rings = this.rings.filter((r) => r.life < r.max && r.r > 0);
    for (const s of this.shocks) s.life += dt;
    this.shocks = this.shocks.filter((s) => s.life < s.max);
  }

  sceneUpdate(dt) {
    const T = this.T, tl = this.tl, k = this.Q.k, card = T >= tl.card, sc = this.scene;
    if (sc === 'godlike') {
      const charge = ss(0, tl.breach, T);
      this.open = T < tl.breach ? 0 : eBack((T - tl.breach) / 0.55) * (T > tl.reveal ? lerp(1, 0.8, ss(tl.reveal, tl.reveal + 1.2, T)) : 1);
      const R = 300 * this.open;
      if (T < tl.reveal + 0.3) this.emit('conv', (50 + 260 * charge) * k * (T < tl.breach ? 1 : 0.5), dt, () => {
        const a = rnd(0, TAU), d = rnd(650, 1050), sp = rnd(380, 760);
        this.P({ t: 1, x: Math.cos(a) * d, y: Math.sin(a) * d, vx: -Math.cos(a) * sp, vy: -Math.sin(a) * sp, max: (d / sp) * 0.92, size: rnd(1.2, 3), c: Math.random() < 0.6 ? 'a' : 'b', tl: 0.05, alpha: 0.9, fin: 0.25 });
      });
      if (T >= tl.breach) {
        this.emit('vtx', (card ? 45 : 200) * k, dt, () => this.P({ t: 4, cx: 0, cy: 0, r: Math.max(120, R) * rnd(1.05, 1.9), ang: rnd(0, TAU), va: rnd(1.2, 2.6), vr: -rnd(60, 180), sq: 1, max: rnd(1.2, 2.4), size: rnd(1.2, 2.6), c: Math.random() < 0.5 ? 'b' : 'a', alpha: 0.9, fin: 0.2 }));
        this.emit('rise', (card ? 22 : 70) * k, dt, () => { const a = rnd(0, TAU), r = rnd(0, Math.max(100, R)); this.P({ t: 0, x: Math.cos(a) * r, y: Math.sin(a) * r * 0.6, vx: rnd(-30, 30), vy: -rnd(60, 220), max: rnd(1.5, 3.5), size: rnd(4, 12), c: Math.random() < 0.7 ? 'a' : 'w', alpha: 0.8, wob: rnd(1, 3) }); });
      }
      const lr = T < 1.0 ? 0 : T < tl.breach ? 2.2 : !card ? 5.5 : 0.3;
      this.emit('bolt', lr, dt, () => {
        if (T < tl.breach) { const a = rnd(0, TAU), r1 = rnd(60, 140), r2 = rnd(260, 420), a2 = a + rnd(-0.5, 0.5); this.bolt(Math.cos(a) * r1, Math.sin(a) * r1, Math.cos(a2) * r2, Math.sin(a2) * r2, { c: 'b', w: 2, life: 0.1, lvl: 0.35 }); }
        else { const a = rnd(0, TAU), r1 = Math.max(120, R) * 1.04, a2 = a + rnd(-0.4, 0.4), r2 = rnd(700, 1300); this.bolt(Math.cos(a) * r1, Math.sin(a) * r1, Math.cos(a2) * r2, Math.sin(a2) * r2, { c: Math.random() < 0.5 ? 'b' : 'w', w: rnd(2.5, 4.5), life: rnd(0.08, 0.18), lvl: card ? 0.3 : undefined }); }
      });
      this.cam.zoom = T < tl.breach ? 1 + 0.12 * charge : lerp(1.12, 1, ss(tl.breach, tl.card, T));
      this.cam.rot = Math.sin(T * 0.6) * 0.012;
      if (T < tl.breach) this.imp.trauma = Math.max(this.imp.trauma, 0.16 * charge);
    } else if (sc === 'mythic') {
      const tO = T < tl.breach ? 0 : eOutExpo((T - tl.breach) / 0.7);
      this.crackP = ss(0.45, tl.breach, T);
      this.tearOpen = tO * (T > tl.reveal ? lerp(1.3, 0.55, ss(tl.reveal, tl.reveal + 1.8, T)) : 1);
      const ws = 0.12 + 2.2 * ss(tl.breach - 0.3, tl.breach + 0.4, T) * (1 - ss(tl.reveal + 0.3, tl.reveal + 1.6, T));
      for (const s of this.stars) {
        s.x += s.x * s.z * ws * dt; s.y += s.y * s.z * ws * dt;
        if (Math.abs(s.x) > this.hw + 20 || Math.abs(s.y) > this.hh + 20) { s.x = rnd(-120, 120); s.y = rnd(-120, 120); s.z = Math.random(); }
      }
      this.warpS = ws;
      const cr = this.crack;
      if (T > 0.6 && T < tl.breach) this.emit('crk', 4.5, dt, () => {
        const lim = this.crackP * cr.pts.length / 2, mid = cr.pts.length / 2, i = Math.round(mid + rnd(-lim, lim)), j2 = clamp(i + ((rnd(2, 6)) | 0), 0, cr.pts.length - 1);
        const p1 = cr.pts[clamp(i, 0, cr.pts.length - 1)], p2 = cr.pts[j2], ca = Math.cos(cr.ang), sa = Math.sin(cr.ang);
        this.bolt(p1.x * ca - p1.y * sa, p1.x * sa + p1.y * ca, p2.x * ca - p2.y * sa, p2.x * sa + p2.y * ca + rnd(-40, 40), { c: 'b', w: 1.6, life: 0.09, lvl: 0.3, disp: 60 });
      });
      if (T >= tl.breach) {
        this.emit('tb', card ? 0.5 : 6, dt, () => this.tearBolt());
        this.emit('en', (card ? 25 : 90) * k, dt, () => {
          const p = pick(cr.pts); if (p.w < 0.2) return;
          const ca = Math.cos(cr.ang), sa = Math.sin(cr.ang), side = Math.random() < 0.5 ? -1 : 1, off = rnd(-1, 1) * p.w * 100 * this.tearOpen;
          const lx = p.x, ly = p.y + off, sp = rnd(40, 170);
          this.P({ t: 0, x: lx * ca - ly * sa, y: lx * sa + ly * ca, vx: -sa * side * sp, vy: ca * side * sp, max: rnd(1.4, 3), size: rnd(3, 9), c: pick(['b', 'c', 'a']), alpha: 0.85, drag: 0.4 });
        });
        if (!card) this.emit('gl', 1.6, dt, () => { this.imp.glitch = Math.max(this.imp.glitch, rnd(0.35, 0.9)); this.rgb(120); });
      }
      this.warp = 0.55 * tO * (1 - ss(tl.card, tl.card + 2, T)) + 0.1;
      this.cam.zoom = T < tl.breach ? 1 + 0.1 * ss(0, tl.breach, T) : lerp(1.1, 1, ss(tl.breach, tl.card, T));
      this.cam.rot = -0.035 * (1 - ss(tl.reveal, tl.card + 1, T)) + Math.sin(T * 0.5) * 0.012;
      if (T < tl.breach) this.imp.trauma = Math.max(this.imp.trauma, 0.14 * this.crackP);
    } else if (sc === 'divine') {
      const charge = ss(0, 2.0, T), coll = ss(2.0, tl.breach, T);
      if (T < tl.breach) {
        this.emit('suck', (80 + 420 * charge) * k, dt, () => {
          const a = rnd(0, TAU), d = rnd(700, 1150), sp = 150;
          this.P({ t: 1, x: Math.cos(a) * d, y: Math.sin(a) * d, vx: -Math.cos(a) * sp, vy: -Math.sin(a) * sp, att: 1300 + 1600 * coll, max: 3, size: rnd(1, 2.6), c: Math.random() < 0.6 ? 'a' : 'w', tl: 0.03, fin: 0.2, alpha: 0.9 });
        });
        this.emit('iring', 2.4 * charge, dt, () => this.ring(0, 0, { r0: 950, vr: -1100, w: 4, c: 'a', life: 0.85, decel: 0, a: 0.5, inward: true }));
        this.emit('flare', 1.8 * charge * (1 - coll), dt, () => { const a = rnd(0, TAU), r1 = 60 + 160 * charge; this.bolt(Math.cos(a) * r1 * 0.8, Math.sin(a) * r1 * 0.8, Math.cos(a + rnd(-0.3, 0.3)) * r1 * 2, Math.sin(a + rnd(-0.3, 0.3)) * r1 * 2, { c: 'a', w: 2, life: 0.12, lvl: 0.3, flash: 0.02 }); });
        this.expoMul = lerp(1, 0.5, coll);
        this.cam.zoom = 1 + 0.15 * charge + 0.05 * coll;
        this.imp.trauma = Math.max(this.imp.trauma, 0.24 * charge);
      } else {
        this.expoMul = 1;
        this.emit('dust', 26 * k, dt, () => this.P({ t: 0, x: rnd(-this.hw, this.hw), y: rnd(-this.hh, this.hh), vx: rnd(-10, 10), vy: rnd(-20, -4), max: rnd(2, 4), size: rnd(3, 9), c: pick(['w', 'a', 'c']), alpha: 0.7, fin: 0.3 }));
        this.cam.zoom = lerp(0.94, 1, ss(tl.breach, tl.card, T));
      }
      this.cam.rot = Math.sin(T * 0.5) * 0.008;
    } else if (sc === 'knife') {
      this.emit('dust', 22 * k, dt, () => this.P({ t: 0, x: rnd(-this.hw, this.hw), y: rnd(-this.hh, this.hh), vx: rnd(-12, 12), vy: rnd(-8, 8), max: rnd(4, 7), size: rnd(1.6, 3.6), c: 'w', alpha: 0.35, fin: 0.3 }));
      this.cam.zoom = lerp(1.14, 1, ss(0, tl.reveal, T));
      this.cam.rot = Math.sin(T * 0.4) * 0.015;
    } else {
      this.emit('smoke', 3.2 * (0.5 + k * 0.5), dt, () => this.P({ t: 3, x: rnd(-this.hw, this.hw), y: rnd(-this.hh * 0.2, this.hh), vx: rnd(-22, 22), vy: -rnd(6, 26), max: rnd(8, 12), size: rnd(280, 560), alpha: 0.2, grow: 0.4 }));
      this.emit('emb', 42 * k, dt, () => this.P({ t: 0, x: rnd(-this.hw, this.hw), y: this.hh + 20, vx: rnd(-20, 20), vy: -rnd(60, 190), max: rnd(4, 7), size: rnd(2, 6), c: Math.random() < 0.7 ? 'b' : 'c', alpha: 0.9, wob: rnd(1, 3) }));
      if (T >= tl.breach && T < tl.reveal + 0.6) this.emit('cyc', 120 * k, dt, () => this.P({ t: 4, cx: 0, cy: this.it.y + 40, r: rnd(240, 430), ang: rnd(0, TAU), va: rnd(2, 4), vr: -rnd(20, 70), sq: 0.32, max: rnd(0.8, 1.6), size: rnd(1.2, 2.6), c: Math.random() < 0.5 ? 'c' : 'b', alpha: 0.8, fin: 0.2 }));
      this.key = ss(0.3, 0.9, T); this.rim = ss(0.7, 1.3, T) * (0.88 + 0.12 * Math.sin(T * 7.3) * Math.sin(T * 3.1));
      this.cam.zoom = lerp(1.08, 1, ss(0, tl.reveal, T));
      this.cam.rot = Math.sin(T * 0.45) * 0.01;
    }
  }

  // --- отрисовка ---
  glow(spr, x, y, s, a) { if (a <= 0.003 || s <= 0) return; const g = this.g; g.globalAlpha = Math.min(1, a); g.drawImage(spr, x - s, y - s, s * 2, s * 2); }
  rays(x, y, n, len, w, rot, alpha, col, seed = 1, spread = TAU, base = 0) {
    if (alpha <= 0.003) return;
    const g = this.g;
    const grd = g.createRadialGradient(x, y, 0, x, y, len);
    grd.addColorStop(0, rgba(col, 0.9)); grd.addColorStop(0.22, rgba(col, 0.35)); grd.addColorStop(1, rgba(col, 0));
    g.globalAlpha = Math.min(1, alpha); g.fillStyle = grd; g.beginPath();
    for (let i = 0; i < n; i++) {
      const a = base + rot + (spread === TAU ? (i / n) * TAU : (i / Math.max(1, n - 1) - 0.5) * spread) + Math.sin(i * 12.9898 * seed) * (spread === TAU ? 0.35 : 0.05);
      const ww = w * (0.4 + (Math.sin(i * 78.233 * seed) * 0.5 + 0.5));
      const l = len * (0.55 + 0.45 * (Math.sin(i * 3.1 + seed) * 0.5 + 0.5));
      g.moveTo(x, y); g.lineTo(x + Math.cos(a - ww) * l, y + Math.sin(a - ww) * l); g.lineTo(x + Math.cos(a + ww) * l, y + Math.sin(a + ww) * l); g.closePath();
    }
    g.fill();
  }
  sceneDraw() {
    const g = this.g, T = this.T, tl = this.tl, P = this.pal, S = this.spr, sc = this.scene;
    if (sc === 'godlike') {
      const charge = ss(0, tl.breach, T), open = this.open || 0, R = 300 * open;
      this.glow(S.sa, 0, 0, 1000, 0.35 + 0.3 * charge);
      const ra = 0.1 * charge + 0.5 * Math.min(1, open);
      this.rays(0, 0, 22, 1500, 0.05, T * 0.12, ra, P.a, 1.3);
      this.rays(0, 0, 14, 1700, 0.035, -T * 0.07, ra * 0.75, P.b, 2.7);
      this.glow(S.a, 0, 0, 110 + 250 * charge + 220 * open, 0.55 + 0.4 * Math.min(1, open));
      if (open > 0.01) {
        const d = g.createRadialGradient(0, 0, 0, 0, 0, R);
        d.addColorStop(0, 'rgba(255,250,232,.95)'); d.addColorStop(0.45, rgba(P.b, 0.55)); d.addColorStop(0.82, rgba(P.a, 0.32)); d.addColorStop(1, rgba(P.a, 0));
        g.globalAlpha = 1; g.fillStyle = d; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill();
        g.strokeStyle = this.cols.b;
        g.globalAlpha = 0.25; g.lineWidth = 30; g.beginPath(); g.arc(0, 0, R * 1.02, 0, TAU); g.stroke();
        g.globalAlpha = 0.9; g.lineWidth = 6; g.setLineDash([40, 18]); g.lineDashOffset = -T * 120; g.beginPath(); g.arc(0, 0, R * 1.02, 0, TAU); g.stroke();
        g.lineWidth = 3; g.setLineDash([8, 14]); g.lineDashOffset = T * 200; g.beginPath(); g.arc(0, 0, R * 0.86, 0, TAU); g.stroke();
        g.setLineDash([]); g.strokeStyle = this.cols.a; g.globalAlpha = 0.8; g.lineWidth = 3; g.beginPath();
        for (let i = 0; i < 60; i++) { const a = (i / 60) * TAU + T * 0.4, r1 = R * 1.1, r2 = R * (i % 5 === 0 ? 1.24 : 1.17); g.moveTo(Math.cos(a) * r1, Math.sin(a) * r1); g.lineTo(Math.cos(a) * r2, Math.sin(a) * r2); }
        g.stroke();
        g.globalAlpha = 0.5; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, R * 1.32, 0, TAU); g.stroke();
      }
    } else if (sc === 'mythic') {
      g.fillStyle = '#e6dcff';
      const ws = this.warpS || 0.1;
      for (const s of this.stars) {
        g.globalAlpha = 0.25 + 0.6 * s.z; const z = 1 + s.z * 2.4;
        if (ws > 0.6) { g.strokeStyle = '#e6dcff'; g.lineWidth = z * 0.8; g.beginPath(); g.moveTo(s.x, s.y); g.lineTo(s.x * (1 - s.z * 0.05 * ws), s.y * (1 - s.z * 0.05 * ws)); g.stroke(); }
        else g.fillRect(s.x, s.y, z, z);
      }
      this.glow(S.sa, -this.hw * 0.4 + Math.sin(T * 0.2) * 80, -120, 900, 0.35);
      this.glow(S.sc, this.hw * 0.45, 160 + Math.cos(T * 0.25) * 60, 800, 0.22);
      const cr = this.crack, op = this.tearOpen || 0, pr = this.crackP || 0;
      g.save(); g.rotate(cr.ang);
      if (op > 0.005) {
        const G = 230 * op, pts = cr.pts;
        const top = pts.map((p, i) => [p.x, p.y - p.w * G * 0.5 + Math.sin(T * 30 + i) * 1.5]);
        const bot = pts.map((p, i) => [p.x, p.y + p.w * G * 0.5 + Math.sin(T * 27 + i * 1.7) * 1.5]);
        const path = new Path2D(); path.moveTo(top[0][0], top[0][1]);
        for (const q of top) path.lineTo(q[0], q[1]);
        for (let i = bot.length - 1; i >= 0; i--) path.lineTo(bot[i][0], bot[i][1]);
        path.closePath();
        g.save(); g.clip(path); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
        g.rotate(T * 0.05); const cs = Math.max(this.hw, this.hh) * 1.6; g.drawImage(this.cosmos, -cs, -cs, cs * 2, cs * 2);
        g.globalCompositeOperation = 'lighter'; g.restore();
        this.glow(S.b, 0, 0, 260 + 200 * op, 0.5);
        const edge = (arr) => { const e = new Path2D(); e.moveTo(arr[0][0], arr[0][1]); for (const q of arr) e.lineTo(q[0], q[1]); return e; };
        const e1 = edge(top), e2 = edge(bot);
        for (const [w, a, c] of [[16, 0.2, this.cols.a], [5, 0.6, this.cols.b], [1.6, 0.95, '#fff']]) { g.strokeStyle = c; g.lineWidth = w; g.globalAlpha = a; g.stroke(e1); g.stroke(e2); }
      } else if (pr > 0) {
        const lim = cr.L * pr; const e = new Path2D(); let st = false;
        for (const p of cr.pts) { if (Math.abs(p.x) > lim) continue; if (!st) { e.moveTo(p.x, p.y); st = true; } else e.lineTo(p.x, p.y); }
        for (const [w, a, c] of [[14, 0.18, this.cols.a], [4, 0.55, this.cols.b], [1.4, 0.95, '#fff']]) { g.strokeStyle = c; g.lineWidth = w; g.globalAlpha = a * (0.6 + 0.4 * Math.random()); g.stroke(e); }
        this.glow(S.b, 0, 0, 80 + 160 * pr, 0.5 * pr);
      }
      g.restore();
    } else if (sc === 'divine') {
      const charge = ss(0, 2.0, T), coll = ss(2.0, tl.breach, T);
      if (this.stars) { g.fillStyle = '#fff'; for (const s of this.stars) { g.globalAlpha = (0.15 + 0.5 * s.z) * (0.6 + 0.4 * Math.sin(T * 3 + s.x)); g.fillRect(s.x, s.y, 1 + s.z * 1.6, 1 + s.z * 1.6); } }
      if (T < tl.breach) {
        const r = lerp(60, 230, charge) * (1 - coll * 0.93) * (1 + 0.07 * Math.sin(T * 22 * charge));
        this.glow(S.sa, 0, 0, 900 * (0.4 + charge), 0.4 * charge * (1 - coll * 0.6));
        this.rays(0, 0, 22, 300 + 700 * charge, 0.03, T * 0.25, 0.3 * charge * (1 - coll), P.a, 1.7);
        this.glow(S.a, 0, 0, r * 4, 0.6);
        this.glow(S.w, 0, 0, r * 2.1, 1);
        this.glow(S.w, 0, 0, r * 1.2, 1);
      } else {
        const since = T - tl.breach, f = Math.exp(-since * 0.8);
        this.rays(0, 0, 30, 2000, 0.04, T * 0.05, 0.7 * f + 0.16, P.a, 1.9);
        this.rays(0, 0, 18, 2200, 0.025, -T * 0.03, 0.5 * f + 0.1, P.c, 3.3);
        this.glow(S.w, 0, 0, 420 * f + 140, 0.9);
        this.glow(S.a, 0, 0, 800 * f + 260, 0.5);
        g.globalAlpha = 0.85 * f + 0.18; const fw = 1700 * (0.6 + 0.4 * f), fh = 30 * (f + 0.35);
        g.drawImage(S.c, -fw, -fh, fw * 2, fh * 2); g.drawImage(S.w, -fw * 0.6, -fh * 0.35, fw * 1.2, fh * 0.7);
        for (let i = 1; i <= 4; i++) this.glow(S.sc, -i * 140, i * 80, 40 + i * 26, 0.16 * f + 0.05);
      }
    } else if (sc === 'knife') {
      const on1 = ss(0.15, 0.45, T), on2 = ss(0.45, 0.75, T), conv = ss(0.6, tl.reveal, T), rev = ss(tl.reveal, tl.reveal + 0.5, T);
      for (const [side, on] of [[-1, on1], [1, on2]]) {
        if (on <= 0) continue;
        const ox = side * this.hw * 0.85, oy = -this.hh * 1.05;
        const tx = side * lerp(340, 0, conv) + Math.sin(T * 0.9 + side) * 30 * (1 - rev), ty = lerp(220, 30, conv);
        const ang = Math.atan2(ty - oy, tx - ox), L = Math.hypot(tx - ox, ty - oy) * 1.7, hw = 0.15;
        const gr = g.createLinearGradient(ox, oy, ox + Math.cos(ang) * L, oy + Math.sin(ang) * L);
        gr.addColorStop(0, rgba(P.a, 0.55)); gr.addColorStop(0.5, rgba(P.a, 0.16)); gr.addColorStop(1, rgba(P.a, 0));
        g.globalAlpha = on * (0.75 + 0.25 * rev); g.fillStyle = gr; g.beginPath(); g.moveTo(ox, oy);
        g.lineTo(ox + Math.cos(ang - hw) * L, oy + Math.sin(ang - hw) * L); g.lineTo(ox + Math.cos(ang + hw) * L, oy + Math.sin(ang + hw) * L); g.closePath(); g.fill();
        this.glow(S.sa, tx, ty, 320, 0.45 * on);
        this.glow(S.w, ox, oy, 60, on);
      }
      this.glow(S.sc, 0, 0, 700, 0.45 * rev);
      this.rays(0, 0, 16, 1000, 0.012, T * 0.1, 0.35 * rev, P.c, 2.1);
    } else {
      const key = this.key || 0, rim = this.rim || 0, rev = ss(tl.reveal, tl.reveal + 0.6, T);
      this.glow(S.sb, -this.hw * 0.72, -this.hh * 0.3, 1000, 0.45 * key);
      this.glow(S.sc, this.hw * 0.7, -this.hh * 0.2, 900, 0.38 * rim);
      this.rays(0, -this.hh * 1.25, 9, this.hh * 2.6, 0.035, Math.sin(T * 0.3) * 0.04, 0.22 * key + 0.25 * rev, P.c, 1.4, 0.7, Math.PI / 2);
      this.glow(S.sb, 0, (this.it.y || 0) + 210, 520, 0.35 * rev + 0.15 * key);
    }
  }
  drawFx() {
    const g = this.g, S = this.spr, C = this.cols;
    for (const p of this.parts) {
      if (p.t !== 3) continue;
      const k = p.life / p.max, a = p.alpha * Math.sin(Math.PI * k);
      if (a < 0.004) continue;
      const s = p.size * (1 + p.grow * k); g.globalAlpha = a; g.drawImage(S.sm, p.x - s, p.y - s, s * 2, s * 2);
    }
    for (const r of this.rings) {
      const k = r.life / r.max, a = r.a * (r.inward ? ss(0, 0.35, k) * (1 - k) : Math.pow(1 - k, 1.4));
      if (a < 0.005) continue;
      g.strokeStyle = C[r.c]; g.beginPath(); g.ellipse(r.x, r.y, Math.max(1, r.r), Math.max(1, r.r * r.sq), 0, 0, TAU);
      g.globalAlpha = a * 0.22; g.lineWidth = r.w * 4; g.stroke();
      g.globalAlpha = a; g.lineWidth = r.w * (1 - k * 0.6); g.stroke();
    }
    for (const p of this.parts) {
      if (p.t === 3) continue;
      const k = p.life / p.max;
      const a = p.alpha * (1 - k) * (p.fin ? ss(0, p.fin, k) : 1);
      if (a < 0.004) continue;
      g.globalAlpha = a;
      if (p.t === 0) { const s = p.size; g.drawImage(p.soft ? S['s' + p.c] : S[p.c], p.x - s, p.y - s, s * 2, s * 2); }
      else if (p.t === 1 || p.t === 4) {
        g.strokeStyle = C[p.c]; g.lineWidth = p.size; g.beginPath();
        if (p.t === 1) { g.moveTo(p.x, p.y); g.lineTo(p.x - p.vx * p.tl, p.y - p.vy * p.tl); }
        else { const px = p.px ?? p.x, py = p.py ?? p.y; g.moveTo(px - (p.x - px) * 2, py - (p.y - py) * 2); g.lineTo(p.x, p.y); }
        g.stroke();
      } else if (p.t === 2) {
        g.save(); g.translate(p.x, p.y); g.rotate(p.rot);
        g.globalCompositeOperation = 'source-over'; g.fillStyle = 'rgba(12,6,28,.92)';
        g.beginPath(); g.moveTo(p.v[0], p.v[1]); g.lineTo(p.v[2], p.v[3]); g.lineTo(p.v[4], p.v[5]); g.closePath(); g.fill();
        g.globalCompositeOperation = 'lighter'; g.strokeStyle = C[p.c]; g.lineWidth = 2; g.stroke(); g.restore();
      }
    }
    for (const b of this.bolts) {
      const k = b.life / b.max, a = (1 - k) * (this.reduce ? 0.8 : 0.55 + 0.45 * Math.random());
      g.strokeStyle = C[b.c];
      g.globalAlpha = a * 0.18; g.lineWidth = b.w * 7; g.stroke(b.path);
      g.globalAlpha = a * 0.6; g.lineWidth = b.w * 2.2; g.stroke(b.path);
      g.globalAlpha = a; g.strokeStyle = '#fff'; g.lineWidth = b.w * 0.7; g.stroke(b.path);
    }
    g.globalAlpha = 1;
  }
  render() {
    const g = this.g, W = this.W, H = this.H, U = this.U, bg = this.pal.bg, im = this.imp;
    const slow = this.slowAt(this.T);
    const trail = this.post ? (this.phase === 'card' ? 0.12 : lerp(0.2, 0.5, (1 - slow) / 0.72)) : 0;
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    g.fillStyle = `rgba(${bg[0]},${bg[1]},${bg[2]},${(1 - trail).toFixed(3)})`; g.fillRect(0, 0, W, H);
    const z = this.cam.zoom * (1 + im.zoom), c = Math.cos(this.cam.rot) * U * z, s = Math.sin(this.cam.rot) * U * z;
    g.setTransform(c, s, -s, c, W / 2, H / 2);
    g.globalCompositeOperation = 'lighter';
    this.sceneDraw();
    const it = this.it;
    if (it.op > 0.01) { this.glow(this.spr.sa, it.x, it.y, 460 * it.s, 0.55 * it.op); this.glow(this.spr.a, it.x, it.y, 240 * it.s, 0.22 * it.op); }
    this.drawFx();
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;

    const B = POST[this.scene], rm = this.reduce;
    const icx = 0.5 + (it.x * U * z) / W, icy = 0.5 - (it.y * U * z) / H;
    const sh = this.shocks[this.shocks.length - 1];
    let shock = [0.5, 0.5, 0, 0];
    if (sh && !rm) { const k = sh.life / sh.max; shock = [0.5 + (sh.x * U * z) / W, 0.5 - (sh.y * U * z) / H, k * sh.speed, sh.amp * (1 - k) * Math.min(1, k * 8)]; }
    const flash = Math.min(1, im.flash) * (rm ? 0.35 : 1);
    if (this.post) {
      const ok = this.post.draw(this.sc, {
        cx: icx, cy: icy, shock, flashC: this.flashC, time: this.RT,
        bloom: B.bloom + Math.min(1, im.flash) * 0.6, thr: B.thr, chroma: B.chroma + im.chroma * 0.018 * (rm ? 0.3 : 1),
        blur: rm ? 0 : im.blur * 0.11 + (1 - slow) * 0.04, glitch: rm ? 0 : Math.min(1, im.glitch), flash, vig: B.vig, grain: B.grain,
        expo: B.expo * this.expoMul, warp: rm ? this.warp * 0.3 : this.warp,
      }, W, H);
      if (!ok) { this.post = null; this.useFallback(); }
    } else {
      const bc = this.bc, bgx = this.bg;
      bgx.globalCompositeOperation = 'copy'; bgx.drawImage(this.sc, 0, 0, bc.width, bc.height);
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.55 * B.bloom; g.drawImage(bc, 0, 0, W, H);
      g.globalAlpha = 1;
      if (flash > 0.01) { const fc = this.flashC; g.fillStyle = `rgba(${(fc[0] * 255) | 0},${(fc[1] * 255) | 0},${(fc[2] * 255) | 0},${(flash * 0.85).toFixed(3)})`; g.fillRect(0, 0, W, H); }
      g.globalCompositeOperation = 'source-over';
      if (!this.vig) {
        this.vig = cnv(W, H); const v = this.vig.getContext('2d');
        const gr = v.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.75);
        gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.8)'); v.fillStyle = gr; v.fillRect(0, 0, W, H);
      }
      g.drawImage(this.vig, 0, 0);
    }

    // DOM: тряска камеры и предмет
    const K = this.K;
    let tr = rm ? 0 : Math.min(1, im.trauma); tr *= tr;
    const sx = 24 * tr * noise(this.RT * 9, 1), sy = 24 * tr * noise(this.RT * 9, 7), rz = 0.9 * tr * noise(this.RT * 7, 3);
    this.stage.style.transform = tr > 0.0005 ? `translate3d(${(sx * K).toFixed(2)}px,${(sy * K).toFixed(2)}px,0) rotate(${rz.toFixed(3)}deg) scale(${(1 + tr * 0.04).toFixed(4)})` : '';
    const el = this.itemEl;
    el.style.opacity = it.op.toFixed(3);
    el.style.transform = `translate3d(${(it.x * z * K).toFixed(2)}px,${(it.y * z * K).toFixed(2)}px,0) translate(-50%,-50%) rotateX(${it.rx.toFixed(2)}deg) rotateY(${it.ry.toFixed(2)}deg) rotateZ(${it.rz.toFixed(2)}deg) scale(${Math.max(0.001, it.s * z).toFixed(4)})`;
    // «смаз» при быстром вращении (нож)
    const om = this.omega || 0;
    const ga = this.scene === 'knife' && !this.insp && this.phase !== 'card' ? clamp(Math.abs(om) / 1800) * 0.4 : 0;
    for (let i = 0; i < this.ghosts.length; i++) {
      const gh = this.ghosts[i];
      gh.style.opacity = ga > 0.01 ? (ga / (i + 1)).toFixed(3) : '0';
      if (ga > 0.01) gh.style.transform = `translate(-50%,-50%) rotateY(${(-om * 0.018 * (i + 1)).toFixed(2)}deg)`;
    }
    const wh = this.scene === 'divine' ? clamp(1 - (this.T - this.tl.reveal) / 0.9) : 0;
    if (wh !== this.lastWh) { this.lastWh = wh; this.root.style.setProperty('--white', wh.toFixed(3)); }
  }

  frame(now) {
    if (this.dead) return;
    this.raf = requestAnimationFrame(this.frame);
    if (document.hidden) { this.last = now; return; }
    let dr = (now - (this.last || now)) / 1000; this.last = now;
    dr = Math.min(dr, 0.05);
    this.frameN++;
    // адаптивное качество
    if (dr > 0) {
      this.ema = lerp(this.ema, dr, 0.06);
      if (this.frameN > 30 && this.ema > 0.031 && this.q > 1) { if (++this.slowN > 45) this.degrade(); } else this.slowN = 0;
    }
    // в простое на карточке — 30 FPS
    const idle = this.phase === 'card' && !this.insp && this.RT - this.cardRT > 12;
    if (idle && this.frameN % 2) { return; }
    if (idle) dr *= 2;
    this.RT += dr;
    const slow = this.slowAt(this.T);
    const dt = this.phase === 'card' ? dr : dr * this.speed * slow;
    this.T += dt;
    this.runCues();
    this.update(dt, dr);
    const prevRy = this.it.ry;
    this.pose(this.T, dr);
    this.omega = dr > 0 ? (this.it.ry - prevRy) / dr : 0;
    if (this.scene === 'knife' && this.phase !== 'card' && !this.insp) {
      const half = Math.floor(this.it.ry / 180);
      if (half !== this.lastHalf && Math.abs(this.omega) > 280 && this.T < this.tl.reveal + 0.4) this.snd('whoosh', clamp(Math.abs(this.omega) / 2200, 0.2, 0.9));
      this.lastHalf = half;
    }
    this.render();
    if (this.phase === 'card' && this.priceEl) {
      const u = this.RT - this.cardRT, price = Number(this.item.price) || 0;
      const v = u >= 1.4 ? price : Math.round(price * eOutExpo(u / 1.4));
      const t = rub(v);
      if (t !== this.priceTxt) { this.priceTxt = t; this.priceEl.textContent = t; }
    }
  }
  degrade() {
    this.slowN = 0; this.q--; this.Q = QS[this.q];
    this.root.classList.remove('q1', 'q2', 'q3'); this.root.classList.add('q' + this.q);
    if (this.parts.length > this.Q.parts) this.parts.length = this.Q.parts;
    this.resize();
  }

  // --- ввод ---
  bind() {
    const root = this.root;
    this.onClick = (e) => {
      const t = e.target.closest('button,[data-c-vol]');
      if (!t || !root.contains(t)) return;
      if (t.matches('[data-c-skip]')) this.skip();
      else if (t.matches('[data-c-close]')) this.close();
      else if (t.matches('[data-c-share]')) openShare({ item: this.item, fx: this.fx, share: this.o.share, pal: this.pal });
      else if (t.matches('[data-c-inspect]')) this.inspect(true);
      else if (t.matches('[data-c-done]')) this.inspect(false);
      else if (t.matches('[data-c-mute]')) this.toggleMute();
    };
    root.addEventListener('click', this.onClick);
    root.querySelector('[data-c-vol]')?.addEventListener('input', (e) => {
      const v = clamp(Number(e.target.value) / 100);
      const s = soundSettings();
      const patch = { cinema: v };
      if (v > 0 && (!s.enabled || !(s.master > 0))) { patch.enabled = true; if (!(s.master > 0)) patch.master = 0.7; }
      setSound(patch);
      if (v > 0 && this.audio.silent) { try { unlockSound(); } catch { /* ignore */ } this.audio = createCineAudio(this.scene); }
      this.syncSoundUi();
    });
    // жесты сцены: тап до карточки — пропуск; на карточке — осмотр
    const ptrs = new Map();
    this.stage.addEventListener('pointerdown', (e) => {
      if (this.phase !== 'card') { this.skip(); return; }
      if (!this.insp) { this.inspect(true); }
      const s = this.insp; s.idle = 0;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      try { this.stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      s.drag = true; s.vx = 0; s.vy = 0; s.lt = performance.now();
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; s.pd = Math.hypot(a.x - b.x, a.y - b.y); s.pz = s.zoom; }
    });
    this.stage.addEventListener('pointermove', (e) => {
      const s = this.insp; if (!s || !ptrs.has(e.pointerId)) return;
      const prev = ptrs.get(e.pointerId); const cur = { x: e.clientX, y: e.clientY }; ptrs.set(e.pointerId, cur);
      if (ptrs.size >= 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (s.pd > 0) s.zoom = clamp(s.pz * (d / s.pd), 0.6, 2.4); return; }
      const now = performance.now(), dtm = Math.max(1, now - s.lt) / 1000; s.lt = now;
      const dx = cur.x - prev.x, dy = cur.y - prev.y;
      s.ry += dx * 0.45; s.rx -= dy * 0.32;
      s.vy = lerp(s.vy, (dx * 0.45) / dtm, 0.5); s.vx = lerp(s.vx, (-dy * 0.32) / dtm, 0.5);
      s.idle = 0;
    });
    const up = (e) => { ptrs.delete(e.pointerId); if (this.insp && ptrs.size === 0) { this.insp.drag = false; if (performance.now() - this.insp.lt > 90) { this.insp.vx = 0; this.insp.vy = 0; } } };
    this.stage.addEventListener('pointerup', up); this.stage.addEventListener('pointercancel', up);
    this.stage.addEventListener('wheel', (e) => { if (!this.insp) return; e.preventDefault(); this.insp.zoom = clamp(this.insp.zoom * Math.exp(-e.deltaY * 0.0015), 0.6, 2.4); this.insp.idle = 0; }, { passive: false });
    this.stage.addEventListener('dblclick', () => { if (this.insp) Object.assign(this.insp, { rx: 0, ry: 0, vx: 0, vy: 0, zoom: 1, idle: 0 }); });
    this.onKey = (e) => {
      if (document.querySelector('.cine-sharebox')) return;
      if (e.key === 'Escape') { e.preventDefault(); if (this.phase !== 'card') this.skip(); else if (this.insp) this.inspect(false); else this.close(); }
      else if ((e.key === ' ' || e.key === 'Enter') && this.phase !== 'card') { e.preventDefault(); this.skip(); }
    };
    document.addEventListener('keydown', this.onKey);
    this.onResize = () => this.resize();
    addEventListener('resize', this.onResize);
    this.onPop = () => this.close(true);
    addEventListener('popstate', this.onPop);
    setTimeout(() => root.querySelector('[data-c-skip]')?.focus({ preventScroll: true }), 50);
  }
  inspect(on) {
    if (on && !this.insp) {
      const ry = ((this.it.ry % 360) + 540) % 360 - 180;
      this.insp = { rx: this.it.rx, ry, vx: 0, vy: 0, zoom: 1, drag: false, idle: 0, lt: 0, pd: 0, pz: 1 };
      this.root.classList.add('inspect');
      this.root.querySelector('[data-c-done]')?.focus({ preventScroll: true });
    } else if (!on && this.insp) {
      // плавный возврат: «рассматриваемая» поза становится стартом амбиента
      this.insp = null; this.root.classList.remove('inspect');
      this.T = this.tl.card + 0.001; this.cardRT = this.RT - 1.4;
      this.root.querySelector('.cine-acts [data-c-close]')?.focus({ preventScroll: true });
    }
  }
  close(instant = false) {
    if (this.dead) return;
    this.dead = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.rgbT);
    document.removeEventListener('keydown', this.onKey);
    removeEventListener('resize', this.onResize);
    removeEventListener('popstate', this.onPop);
    try { this.audio.stopAll(0.25); } catch { /* ignore */ }
    const audio = this.audio, post = this.post, root = this.root;
    const done = () => {
      root.remove();
      try { post?.destroy(); } catch { /* ignore */ }
      setTimeout(() => { try { audio.dispose(); } catch { /* ignore */ } }, 400);
      if (!document.querySelector('.cine')) document.documentElement.classList.remove('cine-open');
    };
    if (instant) done(); else { root.classList.add('out'); setTimeout(done, 320); }
    if (active === this) active = null;
    try { if (this.prevFocus && document.contains(this.prevFocus)) this.prevFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
    this.resolve?.();
  }
}

function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

function preload(src, ms = 1500) {
  return new Promise((res) => {
    const im = new Image(); let done = false;
    const fin = () => { if (!done) { done = true; res(im); } };
    im.decoding = 'async'; im.onload = fin; im.onerror = fin; im.src = src;
    setTimeout(fin, ms);
  });
}

// ---------- Публичные функции ----------
/**
 * Проиграть сцену для УЖЕ выданного сервером предмета. Promise завершается при закрытии сцены.
 * o: { item, fx, share?, others?, caseName?, priceNow?, preview?, replay?, mode? }
 */
export async function playDrop(o = {}) {
  if (!o.item || !o.fx) return;
  if (active) active.close(true);
  let mode = o.mode || cineMode();
  if (mode === 'off') mode = o.replay || o.preview ? 'full' : 'off';
  if (mode === 'off') return;
  const src = safeUrl(o.item.image, '/img/brand/item.svg');
  await Promise.all([ensureCss(), preload(src, 900)]);
  return new Promise((resolve) => { active = new Cine({ ...o, mode }, resolve); });
}
export function closeDrop() { active?.close(true); }
export const dropActive = () => !!active;

/** Предпросмотр сцены из админки (ничего не выдаёт и не записывает). */
export function previewDrop(scene, item, tier = null) {
  const t = tier || (['godlike', 'mythic', 'divine'].includes(scene) ? scene : null);
  const label = t ? t.toUpperCase() + ' DROP' : scene === 'glove' ? 'GLOVE DROP' : 'KNIFE DROP';
  return playDrop({ item, fx: { tier: t, scene, label, rank: 0, kind: scene === 'knife' || scene === 'glove' ? scene : null }, preview: true, mode: 'full' });
}

// ---------- «Поделиться дропом» ----------
const SHARE_TG = ['https:', '', 't.me', 'share', 'url'].join('/');
const SHARE_VK = ['https:', '', 'vk.com', 'share.php'].join('/');
const FONT = 'Inter, "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';
async function shareImage(item, fx, pal) {
  const W = 1200, H = 630, cv = cnv(W, H), g = cv.getContext('2d');
  const sc = SCENES.includes(fx?.scene) ? fx.scene : SCENES.includes(fx?.tier) ? fx.tier : 'godlike';
  pal = pal || PAL[sc];
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#0d0f14'); bg.addColorStop(1, rgba(pal.bg, 1));
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const gx = 850, gy = 300;
  g.save(); g.globalCompositeOperation = 'lighter'; g.translate(gx, gy);
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * TAU + 0.1, w = 0.05 + (i % 3) * 0.02, l = 900;
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, l); grd.addColorStop(0, rgba(pal.b, 0.22)); grd.addColorStop(1, rgba(pal.b, 0));
    g.fillStyle = grd; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a - w) * l, Math.sin(a - w) * l); g.lineTo(Math.cos(a + w) * l, Math.sin(a + w) * l); g.closePath(); g.fill();
  }
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 420); gr.addColorStop(0, rgba(pal.a, 0.6)); gr.addColorStop(0.5, rgba(pal.a, 0.16)); gr.addColorStop(1, rgba(pal.a, 0));
  g.fillStyle = gr; g.fillRect(-600, -600, 1200, 1200);
  g.restore();
  const im = await preload(safeUrl(item.image, '/img/brand/item.svg'), 2500);
  if (im.naturalWidth) {
    const bw = 560, bh = 400, r = Math.min(bw / im.naturalWidth, bh / im.naturalHeight), w = im.naturalWidth * r, h = im.naturalHeight * r;
    g.save(); g.shadowColor = rgba(pal.a, 0.75); g.shadowBlur = 50; g.drawImage(im, gx - w / 2, gy - h / 2, w, h); g.restore();
  }
  const fit = (t, max, size, weight) => {
    let s = size;
    for (; s > 18; s -= 2) { g.font = `${weight} ${s}px ${FONT}`; if (g.measureText(t).width <= max) return t; }
    while (t.length > 3 && g.measureText(t).width > max) t = t.slice(0, -2) + '…';
    return t;
  };
  const site = state.site?.name || 'BURGER SKIN';
  const [weapon, skin] = splitName(item.name || '');
  g.textBaseline = 'alphabetic';
  g.fillStyle = 'rgba(255,255,255,.6)'; g.font = `800 26px ${FONT}`; g.fillText(String(site).toUpperCase(), 64, 78);
  const title = fit(String(fx?.label || 'EPIC DROP'), 560, 84, 900);
  const tg = g.createLinearGradient(64, 120, 64, 220); tg.addColorStop(0, rgba(pal.b, 1)); tg.addColorStop(1, rgba(pal.a, 1));
  g.fillStyle = tg; g.shadowColor = rgba(pal.a, 0.6); g.shadowBlur = 24; g.fillText(title, 64, 200); g.shadowBlur = 0;
  g.fillStyle = 'rgba(255,255,255,.7)'; g.fillText(fit(skin ? weapon : '', 560, 30, 700), 64, 268);
  g.fillStyle = '#fff'; g.fillText(fit(skin || weapon, 560, 48, 800), 64, 326);
  const meta = [item.wear && WEARS[item.wear], item.float != null && item.float !== '' ? 'Float ' + Number(item.float).toFixed(4) : '', item.stattrak ? 'StatTrak™' : '', item.souvenir ? 'Сувенир' : ''].filter(Boolean).join(' · ');
  if (meta) { g.fillStyle = 'rgba(255,255,255,.6)'; g.fillText(fit(meta, 560, 26, 600), 64, 372); }
  g.fillStyle = rgba(PAL.godlike.a, 1); g.fillText(fit(rub(Number(item.price) || 0), 560, 64, 900), 64, 470);
  g.fillStyle = 'rgba(255,255,255,.45)'; g.font = `600 22px ${FONT}`; g.fillText('Честный дроп · результат определён сервером · Provably Fair', 64, 566);
  g.fillStyle = rgba(pal.a, 1); g.fillRect(0, H - 8, W, 8);
  return new Promise((res) => { try { cv.toBlob((b) => res(b), 'image/png'); } catch { res(null); } });
}

export async function openShare({ item, fx, share, pal } = {}) {
  if (!item || !share) return;
  await ensureCss();
  document.querySelector('.cine-sharebox')?.remove();
  const url = `${location.origin}/drop/${encodeURIComponent(share)}`;
  const site = state.site?.name || 'BURGER SKIN';
  const text = `${fx?.label || 'Мой дроп'}: ${item.name} — ${rub(Number(item.price) || 0)} · ${site}`;
  const tgHref = SHARE_TG + '?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(text);
  const vkHref = SHARE_VK + '?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(text);
  const box = document.createElement('div');
  box.className = 'cine-sharebox'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Поделиться дропом');
  mount(box, html`<div class="csb">
    <button class="cine-ib csb-x" data-x aria-label="Закрыть">${icon('close')}</button>
    <h3>Поделиться дропом</h3>
    <div class="csb-prev" data-prev><span>${icon('image')} Готовим картинку…</span></div>
    <div class="csb-link"><input readonly value="${url}" aria-label="Ссылка на дроп"><button class="cine-btn sm" data-copy>${icon('copy')} <span>Копировать</span></button></div>
    <div class="csb-acts">
      ${navigator.share ? html`<button class="cine-btn gold" data-native>${icon('external')} Отправить…</button>` : ''}
      <a class="cine-btn" target="_blank" rel="noopener noreferrer" href="${tgHref}">Telegram</a>
      <a class="cine-btn" target="_blank" rel="noopener noreferrer" href="${vkHref}">ВКонтакте</a>
      <button class="cine-btn" data-dl disabled>${icon('download')} Картинка</button>
    </div>
    <p class="csb-note">По ссылке друзья увидят карточку дропа и смогут пересмотреть сцену. Баланс и почта не показываются.</p>
  </div>`);
  document.body.append(box);
  let blobUrl = '', file = null;
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
  const close = () => { box.remove(); document.removeEventListener('keydown', onKey, true); if (blobUrl) URL.revokeObjectURL(blobUrl); };
  document.addEventListener('keydown', onKey, true);
  box.addEventListener('click', async (e) => {
    if (e.target === box || e.target.closest('[data-x]')) { close(); return; }
    const b = e.target.closest('button'); if (!b) return;
    if (b.matches('[data-copy]')) {
      const lbl = b.querySelector('span');
      const ok = () => { if (lbl) { lbl.textContent = 'Скопировано'; setTimeout(() => { lbl.textContent = 'Копировать'; }, 1600); } };
      try { await navigator.clipboard.writeText(url); ok(); }
      catch { const inp = box.querySelector('input'); inp.select(); try { document.execCommand('copy'); ok(); } catch { /* ignore */ } }
    } else if (b.matches('[data-native]')) {
      const d = { title: `${fx?.label || 'Дроп'} — ${site}`, text, url };
      try { if (file && navigator.canShare?.({ files: [file] })) d.files = [file]; await navigator.share(d); } catch { /* отменено */ }
    } else if (b.matches('[data-dl]') && blobUrl) {
      const a = document.createElement('a'); a.href = blobUrl; a.download = `burger-skin-drop-${share}.png`; document.body.append(a); a.click(); a.remove();
    }
  });
  box.querySelector('[data-x]')?.focus({ preventScroll: true });
  const blob = await shareImage(item, fx, pal).catch(() => null);
  if (!box.isConnected) return;
  const prev = box.querySelector('[data-prev]');
  if (blob) {
    blobUrl = URL.createObjectURL(blob);
    try { file = new File([blob], `burger-skin-drop-${share}.png`, { type: 'image/png' }); } catch { file = null; }
    const im = new Image(); im.alt = 'Превью дропа'; im.src = blobUrl; prev.replaceChildren(im);
    const dl = box.querySelector('[data-dl]'); if (dl) dl.disabled = false;
  } else prev.textContent = 'Картинка недоступна — можно поделиться ссылкой.';
}
