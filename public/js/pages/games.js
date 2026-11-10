// Игры: раздел игр, Crash, Double, Jackpot, Coinflip. Остальные игры — в games2.js и battles.js.
import { state, html, raw, mount, $, $$, api, money, num, bc, pct, fdate, ago, img, avatar, userLink, empty, loader, head, notice, toast, fail, modal, busy, page, go, on, sleep, cssColor, qs, rub } from '../core.js';
import { icon } from '../icons.js';
import { GAME_INFO, gameTile, betsTable, rulesBox } from './shared.js';
import './games2.js';
import './battles.js';

// ---------- общие элементы ставок ----------
export function betInput(limits, value) {
  const min = limits?.min ?? 100, max = limits?.max ?? 5000000;
  const v = value ?? Math.max(min / 100, 10);
  return html`<label class="fld"><span>Ставка, ₽ <small class="muted">${money(min)} – ${money(max)}</small></span><div class="amount"><input type="number" name="amount" min="${min / 100}" max="${max / 100}" step="0.01" value="${v}" data-amount inputmode="decimal"><button type="button" class="btn ghost sm" data-amt="half">½</button><button type="button" class="btn ghost sm" data-amt="double">×2</button><button type="button" class="btn ghost sm" data-amt="min">Мин</button><button type="button" class="btn ghost sm" data-amt="max">Макс</button></div></label>`;
}
export function bindAmount(root, limits) {
  on(root, 'click', '[data-amt]', (e, b) => {
    const inp = $('[data-amount]', root); if (!inp) return;
    const min = (limits?.min ?? 100) / 100; const lim = (limits?.max ?? 5000000) / 100;
    const bal = state.me ? state.me.balance / 100 : lim; const max = Math.max(min, Math.min(lim, bal));
    let v = parseFloat(String(inp.value).replace(',', '.')) || min;
    const k = b.dataset.amt;
    if (k === 'half') v = v / 2; if (k === 'double') v = v * 2; if (k === 'min') v = min; if (k === 'max') v = max;
    inp.value = Math.max(min, Math.min(lim, Math.floor(v * 100) / 100)).toFixed(2);
  });
}
export const amountOf = (root) => parseFloat(String($('[data-amount]', root)?.value || '0').replace(',', '.')) || 0;
export function requireLogin() { if (state.me) return true; go('/login?next=' + encodeURIComponent(location.pathname)); return false; }
export async function loadMyBets(ctx, game, sel = '[data-my]') {
  const box = $(sel, ctx.el); if (!box) return;
  if (!state.me) { mount(box, empty('Войдите, чтобы видеть историю своих ставок.', html`<a class="btn" href="/login?next=${encodeURIComponent(location.pathname)}">Войти</a>`)); return; }
  try { const r = await api('/api/history' + qs({ game })); if (ctx.alive()) mount(box, betsTable(r.bets.slice(0, 15), { empty: 'Вы ещё не играли в эту игру.' })); } catch (e) { mount(box, empty(e.message)); }
}
// Перезагрузка состояния с защитой от лавины событий.
export function reloader(fn) { let busyNow = false, again = false; const run = async () => { if (busyNow) { again = true; return; } busyNow = true; try { await fn(); } catch {} finally { busyNow = false; if (again) { again = false; run(); } } }; return run; }
export const gameOff = (name) => html`<div class="notice warn">Игра «${name}» временно отключена администрацией. Загляните позже.</div>`;
const playersBox = (bets, render) => bets?.length ? html`<div class="players">${bets.map(render)}</div>` : html`<p class="muted sm">Ставок пока нет — будьте первым.</p>`;

// ================= РАЗДЕЛ ИГР =================
page('/games', async (ctx) => {
  const d = await api('/api/games');
  mount(ctx.el, html`<div class="wrap">${head('Игры', 'Ставки и выплаты рассчитываются в рублях (₽). Результаты определяет сервер, каждую ставку можно проверить через Provably Fair.')}
    <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(240px,1fr))">
      ${gameTile('battles', d.battles?.enabled !== false, html`<span class="xs" style="margin-top:6px">Открытые комнаты: ${num(d.battles?.live ?? d.battles?.open ?? 0)}</span>`)}
      ${(d.games || []).map((g) => gameTile(g.key, g.enabled, html`<span class="xs" style="margin-top:6px">Ставки ${money(g.min)} – ${rub(g.max)}${g.players ? ' · игроков: ' + g.players : ''}</span>`))}
    </div>
    <section class="sec grid g3">
      <div class="card"><h3>${icon('key')} Честная игра</h3><p class="muted sm mb0">До ставки вы видите хеш серверного сида. После игры сид раскрывается, и любой результат можно пересчитать на странице <a href="/fair">Provably Fair</a>.</p></div>
      <div class="card"><h3>${icon('zap')} Мгновенные расчёты</h3><p class="muted sm mb0">Баланс проверяется и списывается на сервере атомарно. Повторная отправка запроса не приводит к двойному списанию.</p></div>
      <div class="card"><h3>${icon('history')} Полная история</h3><p class="muted sm mb0">Все ставки, выигрыши и операции доступны в разделе <a href="/history">История</a>.</p></div>
    </section></div>`);
}, { title: 'Игры' });

// ================= CRASH =================
const crashCls = (c) => (c >= 10 ? 'h-gold' : c >= 2 ? 'h-green' : c >= 1.5 ? '' : 'h-red');
page('/games/crash', async (ctx) => {
  let d = await api('/api/crash');
  if (state.features.games === false || d.limits?.enabled === false) return mount(ctx.el, html`<div class="wrap">${head('Crash')}${gameOff('Crash')}</div>`);
  let off = d.serverTime - Date.now();
  const G = d.growth || 0.06;
  const multAt = (ms) => Math.floor(100 * Math.exp((G * Math.max(0, ms)) / 1000)) / 100;
  const sNow = () => Date.now() + off;
  mount(ctx.el, html`<div class="wrap">${head('Crash', 'Множитель растёт, пока ракета-бургер не взорвётся. Заберите выигрыш вовремя.')}
    <div class="game">
      <div class="card bet-panel">${betInput(d.limits)}
        <label class="fld"><span>Автовывод на множителе <small class="muted">необязательно</small></span><input type="number" min="1.01" step="0.01" placeholder="например, 2.00" data-auto></label>
        <div data-act></div><div class="xs dim" data-myinfo></div>
        ${rulesBox(['Ставки принимаются в течение ' + Math.round((d.betMs || 8000) / 1000) + ' секунд до старта раунда.', 'После старта множитель растёт от ×1.00. Нажмите «Забрать», чтобы зафиксировать выигрыш: ставка × текущий множитель.', 'Если раунд закончился раньше, чем вы забрали ставку, она проигрывает.', 'Точка взрыва вычисляется заранее из серверного сида раунда, хеш сида публикуется до начала.'])}
      </div>
      <div class="stack">
        <div class="game-screen crash"><div class="game-status" data-status></div><canvas></canvas><div class="crash-m" data-m><div><b>×1.00</b></div></div></div>
        <div class="hist" data-hist></div>
        <div class="grid g2"><div class="card"><div class="card-head"><h3>Ставки раунда</h3><span class="muted sm" data-pot></span></div><div data-bets></div></div>
          <div class="card"><h3>Раунд</h3><div class="kv sm" data-round></div></div></div>
      </div>
    </div>
    <section class="sec"><div class="sec-head"><h2>Мои ставки</h2></div><div data-my>${loader()}</div></section></div>`);
  bindAmount(ctx.el, d.limits);
  const cv = $('canvas', ctx.el);
  const draw = (m, el, boom) => {
    const dpr = window.devicePixelRatio || 1; const w = cv.clientWidth, h = cv.clientHeight; if (!w) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const tMax = Math.max(10000, el * 1.15); const mMax = Math.max(2, m * 1.25);
    const X = (t) => 46 + (t / tMax) * (w - 70); const Y = (v) => h - 34 - ((v - 1) / (mMax - 1)) * (h - 70);
    g.strokeStyle = 'rgba(255,255,255,.06)'; g.fillStyle = 'rgba(255,255,255,.35)'; g.font = '11px sans-serif'; g.lineWidth = 1;
    const step = mMax > 20 ? 5 : mMax > 6 ? 1 : mMax > 3 ? 0.5 : 0.25;
    for (let v = 1; v <= mMax; v += step) { const y = Y(v); g.beginPath(); g.moveTo(40, y); g.lineTo(w - 10, y); g.stroke(); g.fillText('×' + v.toFixed(v % 1 ? 2 : 0), 4, y + 4); }
    if (el <= 0) return;
    const grad = g.createLinearGradient(0, h, w, 0); grad.addColorStop(0, boom ? '#E63946' : '#FFB627'); grad.addColorStop(1, boom ? '#ff5a66' : '#E63946');
    g.beginPath(); g.moveTo(X(0), Y(1)); const n = 80; for (let i = 1; i <= n; i++) { const t = (el * i) / n; g.lineTo(X(t), Y(Math.min(m, multAt(t)))); }
    g.lineWidth = 4; g.strokeStyle = grad; g.lineCap = 'round'; g.stroke();
    g.lineTo(X(el), Y(1)); g.closePath(); const fill = g.createLinearGradient(0, 0, 0, h); fill.addColorStop(0, boom ? 'rgba(230,57,70,.25)' : 'rgba(255,182,39,.22)'); fill.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = fill; g.fill();
    { const px = X(el), py = Y(Math.min(m, multAt(el))); g.save(); g.beginPath(); g.arc(px, py, boom ? 10 : 7, 0, Math.PI * 2); g.fillStyle = boom ? '#ef4444' : '#ffb627'; g.shadowColor = g.fillStyle; g.shadowBlur = 22; g.fill(); g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,.85)'; g.stroke(); g.restore(); }
  };
  const mine = () => (state.me ? d.bets.find((b) => b.user?.id === state.me.id) : null);
  const drawStatic = () => {
    const r = d.round; const my = mine();
    mount($('[data-hist]', ctx.el), html`${(d.history || []).map((h) => html`<span class="${crashCls(h.result?.crash || 0)}" title="Раунд #${h.id}">×${Number(h.result?.crash || 0).toFixed(2)}</span>`)}`);
    const pot = d.bets.reduce((s, b) => s + b.amount, 0);
    $('[data-pot]', ctx.el).textContent = `${d.bets.length} ставок · ${rub(pot)}`;
    mount($('[data-bets]', ctx.el), playersBox(d.bets, (b) => html`<div class="pl ${b.status === 'won' ? 'won' : b.status === 'lost' ? 'lost' : ''}">${avatar(b.user, 'xs')}<span class="grow">${b.user?.nickname}</span>${bc(b.amount)}${b.status === 'won' ? html`<span class="plus sm">×${Number(b.cashout).toFixed(2)} → ${money(b.payout)}</span>` : ''}</div>`));
    mount($('[data-round]', ctx.el), r ? html`<span>Номер</span><span>#${r.id}</span><span>Статус</span><span>${{ betting: 'Приём ставок', running: 'Идёт раунд', ended: 'Завершён' }[r.status] || r.status}</span><span>Хеш сида</span><span class="mono xs">${r.hash}</span>${r.seed ? html`<span>Сид</span><span class="mono xs">${r.seed}</span>` : ''}${r.salt ? html`<span>Соль</span><span class="mono xs">${r.salt}</span>` : ''}` : html`<span>Раунд</span><span>Ожидание</span>`);
    let act;
    if (!state.me) act = html`<a class="btn lg block" href="/login?next=/games/crash">Войти, чтобы играть</a>`;
    else if (r?.status === 'running' && my?.status === 'active') act = html`<button class="btn green lg block" data-cashout>Забрать</button>`;
    else if (r?.status === 'betting' && !my) act = html`<button class="btn lg block" data-bet>Поставить</button>`;
    else if (r?.status === 'betting' && my) act = html`<button class="btn lg block" disabled>Ставка принята: ${rub(my.amount)}</button>`;
    else act = html`<button class="btn lg block" disabled>Ждём следующий раунд…</button>`;
    mount($('[data-act]', ctx.el), act);
    $('[data-myinfo]', ctx.el).textContent = my ? (my.status === 'won' ? `Вы забрали ×${Number(my.cashout).toFixed(2)}: +${rub(my.payout)}` : my.status === 'lost' ? 'Ставка сгорела в этом раунде' : 'Ваша ставка в игре') : '';
  };
  const reload = reloader(async () => { const nd = await api('/api/crash'); if (!ctx.alive()) return; d = nd; off = d.serverTime - Date.now(); drawStatic(); });
  drawStatic();
  let lastPhase = '';
  ctx.frame(() => {
    const r = d.round; const mEl = $('[data-m]', ctx.el); const st = $('[data-status]', ctx.el); if (!mEl) return;
    let phase = r?.status || 'none';
    if (!r) { mount(mEl, html`<div><b style="font-size:28px">Готовим раунд…</b></div>`); draw(1, 0); }
    else if (r.status === 'betting') {
      const leftMs = Math.max(0, (r.startedAt || 0) - sNow());
      mEl.classList.remove('boom'); mount(mEl, html`<div><small>Старт через</small><b>${(leftMs / 1000).toFixed(1)} с</b></div>`); draw(1, 0);
      mount(st, html`<span class="badge warn">Приём ставок</span>`);
    } else if (r.status === 'running') {
      const el = sNow() - r.startedAt; const m = multAt(el);
      mEl.classList.remove('boom'); mount(mEl, html`<div><b>×${m.toFixed(2)}</b></div>`); draw(m, el);
      mount(st, html`<span class="badge ok">В полёте</span>`);
      const cb = $('[data-cashout]', ctx.el); const my = mine(); if (cb && my) cb.textContent = `Забрать ${rub(Math.floor(my.amount * m))} (×${m.toFixed(2)})`;
    } else if (r.status === 'ended') {
      const c = Number(r.result?.crash || 1); const el = Math.log(Math.max(1, c)) / G * 1000;
      mEl.classList.add('boom'); mount(mEl, html`<div><small>Взрыв на</small><b>×${c.toFixed(2)}</b></div>`); draw(c, el, true);
      mount(st, html`<span class="badge err">Раунд завершён</span>`);
    }
    if (phase !== lastPhase) { lastPhase = phase; drawStatic(); if (phase === 'ended') loadMyBets(ctx, 'crash'); }
  });
  ctx.on('crash', () => reload());
  ctx.on('balance_hint', () => reload());
  ctx.every(2500, () => { const r = d.round; if (!r || r.status !== 'running' || sNow() - r.startedAt > 1000) reload(); });
  on(ctx.el, 'click', '[data-bet]', (e, b) => busy(b, async () => {
    if (!requireLogin()) return;
    const auto = parseFloat(String($('[data-auto]', ctx.el).value || '').replace(',', '.'));
    await api('/api/crash/bet', { amount: amountOf(ctx.el), auto: auto >= 1.01 ? auto : undefined });
    toast('Ставка принята. Удачного полёта!', 'ok'); await reload();
  }));
  on(ctx.el, 'click', '[data-cashout]', (e, b) => busy(b, async () => { const r = await api('/api/crash/cashout', {}); toast(html`Вы забрали ×${Number(r.multiplier).toFixed(2)}: ${bc(r.payout)}`, 'ok'); await reload(); }));
  loadMyBets(ctx, 'crash');
}, { title: 'Crash' });

// ================= DOUBLE =================
const D_ORDER = [0, 1, 14, 2, 13, 3, 12, 4, 11, 5, 10, 6, 9, 7, 8];
const dColor = (n) => (n === 0 ? 'green' : n <= 7 ? 'red' : 'black');
const D_NAME = { red: 'Красное', black: 'Чёрное', green: 'Зелёное' };
page('/games/double', async (ctx) => {
  let d = await api('/api/double');
  if (state.features.games === false || d.limits?.enabled === false) return mount(ctx.el, html`<div class="wrap">${head('Double')}${gameOff('Double')}</div>`);
  let off = d.serverTime - Date.now(); const sNow = () => Date.now() + off;
  const REPS = 9;
  const cells = []; for (let r = 0; r < REPS; r++) for (const n of D_ORDER) cells.push(n);
  mount(ctx.el, html`<div class="wrap">${head('Double', 'Угадайте цвет: красное и чёрное ×2, зелёное ×14.')}
    <div class="game">
      <div class="card bet-panel">${betInput(d.limits)}
        <div class="grid g3" style="gap:8px">${['red', 'green', 'black'].map((c) => html`<button class="dbl-btn ${c}" data-color="${c}">${c === 'green' ? '0' : c === 'red' ? '1–7' : '8–14'}<small>×${c === 'green' ? 14 : 2}</small></button>`)}</div>
        ${state.me ? '' : html`<a class="btn block" href="/login?next=/games/double">Войти, чтобы играть</a>`}
        ${rulesBox(['Приём ставок длится ' + Math.round((d.betMs || 15000) / 1000) + ' секунд, затем лента прокручивается.', 'Выпадает число от 0 до 14: 0 — зелёное (×14), 1–7 — красное (×2), 8–14 — чёрное (×2).', 'Можно поставить на несколько цветов в одном раунде.', 'Число раунда вычисляется из серверного сида, хеш которого опубликован заранее.'])}
      </div>
      <div class="stack">
        <div class="game-screen"><div class="game-status" data-status></div><div class="dbl-timer" data-timer></div>
          <div class="dbl-strip" data-strip><div class="dbl-mark"></div><div class="dbl-track" data-track>${cells.map((n) => html`<div class="dbl-c ${dColor(n)}">${n}</div>`)}</div></div>
          <div class="hist" style="padding:0 16px 16px" data-hist></div></div>
        <div class="dbl-bets" data-bets></div>
      </div>
    </div>
    <section class="sec"><div class="sec-head"><h2>Мои ставки</h2></div><div data-my>${loader()}</div></section></div>`);
  bindAmount(ctx.el, d.limits);
  const track = $('[data-track]', ctx.el); const strip = $('[data-strip]', ctx.el);
  let shownRound = 0; let lastN = d.history?.[0]?.result?.n ?? 0;
  const place = (n, rep, ms, jitter = 0) => {
    const idx = rep * D_ORDER.length + D_ORDER.indexOf(n); const c = track.children[idx]; if (!c) return;
    const x = c.offsetLeft + c.offsetWidth / 2 + jitter - strip.clientWidth / 2;
    track.style.transition = ms ? `transform ${ms}ms cubic-bezier(.12,.68,.08,1)` : 'none';
    track.style.transform = `translate3d(${-x}px,0,0)`;
  };
  const drawStatic = () => {
    mount($('[data-hist]', ctx.el), html`${(d.history || []).map((h) => html`<span class="h-${h.result?.color || dColor(h.result?.n || 0)}">${h.result?.n ?? '?'}</span>`)}`);
    mount($('[data-bets]', ctx.el), html`${['red', 'green', 'black'].map((c) => { const list = d.bets.filter((b) => b.choice === c); const sum = list.reduce((s, b) => s + b.amount, 0); return html`<div class="dbl-col"><h4><span class="h-${c}" style="padding:2px 8px;border-radius:6px">${D_NAME[c]} ×${c === 'green' ? 14 : 2}</span><span class="bc sm">${money(sum)}</span></h4>${playersBox(list, (b) => html`<div class="pl ${b.status === 'won' ? 'won' : b.status === 'lost' ? 'lost' : ''}">${avatar(b.user, 'xs')}<span class="grow">${b.user?.nickname}</span>${bc(b.amount)}</div>`)}</div>`; })}`);
    const r = d.round; const ok = r?.status === 'betting' && r.startedAt > sNow();
    for (const b of $$('[data-color]', ctx.el)) b.disabled = !ok || !state.me;
  };
  const sync = (animate) => {
    const r = d.round; if (!r) return;
    if (r.status === 'running' && r.result && shownRound !== r.id) {
      shownRound = r.id; const elapsed = sNow() - r.startedAt; const rollMs = d.rollMs || 6000;
      place(lastN, 2, 0); void track.offsetWidth;
      const left = Math.max(0, rollMs - elapsed - 200);
      requestAnimationFrame(() => place(r.result.n, REPS - 2, animate && left > 400 ? left : 0, (Math.random() - 0.5) * 60));
      lastN = r.result.n;
    } else if (r.status !== 'running' && shownRound === 0) { place(lastN, 2, 0); }
  };
  const reload = reloader(async () => { const nd = await api('/api/double'); if (!ctx.alive()) return; const prev = d.round?.status; d = nd; off = d.serverTime - Date.now(); drawStatic(); sync(true); if (prev === 'running' && d.round?.status !== 'running') loadMyBets(ctx, 'double'); });
  drawStatic(); sync(false);
  ctx.frame(() => {
    const r = d.round; const t = $('[data-timer]', ctx.el); const st = $('[data-status]', ctx.el); if (!t) return;
    if (!r) { t.textContent = 'Готовим раунд…'; return; }
    if (r.status === 'betting') { const l = Math.max(0, r.startedAt - sNow()); t.textContent = l > 0 ? `Ставки принимаются: ${(l / 1000).toFixed(1)} с` : 'Крутим ленту…'; mount(st, html`<span class="badge warn">Раунд #${r.id}</span>`); }
    else if (r.status === 'running') { const done = sNow() - r.startedAt > (d.rollMs || 6000); t.textContent = done && r.result ? `Выпало ${r.result.n} — ${D_NAME[r.result.color]}` : 'Крутим ленту…'; }
    else if (r.status === 'ended' && r.result) t.textContent = `Выпало ${r.result.n} — ${D_NAME[r.result.color]}`;
  });
  ctx.on('double', () => reload());
  ctx.on('balance_hint', () => reload());
  ctx.every(3000, () => reload());
  on(ctx.el, 'click', '[data-color]', (e, b) => busy(b, async () => { if (!requireLogin()) return; await api('/api/double/bet', { amount: amountOf(ctx.el), color: b.dataset.color }); toast(`Ставка на «${D_NAME[b.dataset.color]}» принята`, 'ok'); await reload(); }));
  window.addEventListener('resize', () => { if (ctx.alive()) place(lastN, d.round?.status === 'running' ? REPS - 2 : 2, 0); });
  loadMyBets(ctx, 'double');
}, { title: 'Double' });

// ================= JACKPOT =================
const JP_COLORS = ['#FFB627', '#E63946', '#7AC74F', '#4b8bff', '#8847ff', '#F4A259', '#2ec4b6', '#ff70a6', '#c0c6d4', '#e4ae39'];
page('/games/jackpot', async (ctx) => {
  let d = await api('/api/jackpot');
  if (state.features.games === false || d.limits?.enabled === false) return mount(ctx.el, html`<div class="wrap">${head('Jackpot')}${gameOff('Jackpot')}</div>`);
  let off = d.serverTime - Date.now(); const sNow = () => Date.now() + off;
  let spinning = false;
  mount(ctx.el, html`<div class="wrap">${head('Jackpot', 'Все ставки идут в общий банк. Чем больше ваша доля, тем выше шанс забрать всё.')}
    <div class="game">
      <div class="card bet-panel">${betInput(d.limits)}<div data-act></div>
        ${rulesBox(['Розыгрыш стартует, когда в раунде минимум два игрока: начинается обратный отсчёт ' + Math.round((d.countdownMs || 25000) / 1000) + ' секунд.', 'Шанс победы равен доле вашей ставки в банке. Можно сделать до 5 ставок за раунд.', 'Победитель получает банк за вычетом комиссии ' + Math.round((d.fee || 0) * 100) + '%.', 'Если соперник не нашёлся, ставка возвращается автоматически.', 'Победный билет вычисляется из серверного сида раунда.'])}
      </div>
      <div class="stack">
        <div class="game-screen"><div class="game-status" data-status></div>
          <div class="jp-ring"><div class="jp-arrow"></div><div class="jp-wheel" data-wheel></div><div class="jp-in" data-center></div></div>
          <div class="jp-bar" data-bar></div></div>
        <div class="grid g2"><div class="card"><h3>Участники</h3><div data-bets></div></div><div class="card"><h3>Прошлые розыгрыши</h3><div data-hist></div></div></div>
      </div>
    </div>
    <section class="sec"><div class="sec-head"><h2>Мои ставки</h2></div><div data-my>${loader()}</div></section></div>`);
  bindAmount(ctx.el, d.limits);
  const colorOf = (uid, list) => { const ids = [...new Set(list.map((b) => b.user?.id))]; return JP_COLORS[ids.indexOf(uid) % JP_COLORS.length]; };
  const segs = (bets) => { const list = [...bets].sort((a, b) => a.id - b.id); const pot = list.reduce((s, b) => s + b.amount, 0); let acc = 0; return { pot, list: list.map((b) => { const from = pot ? (acc / pot) * 360 : 0; acc += b.amount; return { b, from, to: pot ? (acc / pot) * 360 : 0 }; }) }; };
  const wheelBg = (bets) => { const s = segs(bets); if (!s.pot) return 'conic-gradient(#232836 0 360deg)'; return 'conic-gradient(' + s.list.map((x) => `${colorOf(x.b.user?.id, bets)} ${x.from.toFixed(2)}deg ${x.to.toFixed(2)}deg`).join(',') + ')'; };
  const drawStatic = () => {
    if (spinning) return;
    const bets = d.bets || []; const pot = bets.reduce((s, b) => s + b.amount, 0);
    const wheel = $('[data-wheel]', ctx.el); wheel.style.transition = 'none'; wheel.style.transform = 'rotate(0deg)'; wheel.style.background = wheelBg(bets);
    const byUser = {}; for (const b of bets) { const k = b.user?.id; byUser[k] = byUser[k] || { user: b.user, amount: 0 }; byUser[k].amount += b.amount; }
    const users = Object.values(byUser).sort((a, b) => b.amount - a.amount);
    mount($('[data-bar]', ctx.el), html`${users.map((u) => html`<i style="width:${pot ? ((u.amount / pot) * 100).toFixed(2) : 0}%;background:${colorOf(u.user?.id, bets)}"></i>`)}`);
    mount($('[data-bets]', ctx.el), playersBox(users, (u) => html`<div class="pl"><span style="width:10px;height:10px;border-radius:3px;background:${colorOf(u.user?.id, bets)}"></span>${avatar(u.user, 'xs')}<span class="grow">${u.user?.nickname}</span>${bc(u.amount)}<b class="sm">${pct(pot ? u.amount / pot : 0)}</b></div>`));
    mount($('[data-hist]', ctx.el), (d.history || []).length ? html`<div class="players">${d.history.map((h) => html`<div class="pl">${h.result?.refunded ? html`<span class="grow muted">#${h.id} · возврат ставок</span>` : html`${avatar(h.result?.winner, 'xs')}<span class="grow">${h.result?.winner?.nickname || '—'}</span>${bc(h.result?.prize)}<span class="xs dim">банк ${money(h.result?.pot || 0)}</span>`}</div>`)}</div>` : html`<p class="muted sm">Пока нет завершённых розыгрышей.</p>`);
    const r = d.round; const my = state.me ? bets.filter((b) => b.user?.id === state.me.id).length : 0;
    let act;
    if (!state.me) act = html`<a class="btn lg block" href="/login?next=/games/jackpot">Войти, чтобы играть</a>`;
    else if (r?.status === 'betting' && (!r.startedAt || r.startedAt - sNow() > 1000)) act = html`<button class="btn lg block" data-bet>${my ? 'Добавить ставку' : 'Внести в банк'}</button>${my ? html`<p class="xs dim mb0" style="margin-top:6px">Ваших ставок в раунде: ${my} из 5</p>` : ''}`;
    else act = html`<button class="btn lg block" disabled>Ждём следующий раунд…</button>`;
    mount($('[data-act]', ctx.el), act);
  };
  const reload = reloader(async () => { const nd = await api('/api/jackpot'); if (!ctx.alive()) return; d = nd; off = d.serverTime - Date.now(); drawStatic(); });
  ctx.frame(() => {
    if (spinning) return; const r = d.round; const c = $('[data-center]', ctx.el); const st = $('[data-status]', ctx.el); if (!c) return;
    const pot = (d.bets || []).reduce((s, b) => s + b.amount, 0);
    let sub = 'Ждём игроков';
    if (r?.status === 'betting' && r.startedAt) sub = 'Розыгрыш через ' + Math.max(0, Math.ceil((r.startedAt - sNow()) / 1000)) + ' с';
    else if (r?.status === 'betting' && (d.bets || []).length) sub = 'Нужен ещё один игрок';
    else if (r?.status === 'ended') sub = r.result?.refunded ? 'Ставки возвращены' : 'Победитель: ' + (r.result?.winner?.nickname || '—');
    mount(c, html`<b class="bc">${money(pot || r?.result?.pot || 0)}</b><span class="sm muted">${sub}</span>`);
    mount(st, r ? html`<span class="badge ${r.status === 'betting' ? 'warn' : 'info'}">Раунд #${r.id}</span>` : '');
  });
  const spin = async (id) => {
    const rr = await api('/api/rounds/' + id); if (!ctx.alive()) return;
    const res = rr.round?.result; if (!res || res.refunded) { toast('Соперник не нашёлся — ставки возвращены', 'info'); return reload(); }
    spinning = true;
    const bets = rr.bets || []; const wheel = $('[data-wheel]', ctx.el);
    wheel.style.transition = 'none'; wheel.style.background = wheelBg(bets); wheel.style.transform = 'rotate(0deg)'; void wheel.offsetWidth;
    const s = segs(bets); const a = s.pot ? ((res.ticket + 0.5) / s.pot) * 360 : 0;
    wheel.style.transition = ''; wheel.style.transform = `rotate(${360 * 6 - a}deg)`;
    mount($('[data-center]', ctx.el), html`<b class="bc">${money(res.pot)}</b><span class="sm muted">Крутим…</span>`);
    await sleep(7200); if (!ctx.alive()) return;
    mount($('[data-center]', ctx.el), html`${avatar(res.winner, 'md')}<b>${res.winner?.nickname}</b><span class="bc">${money(res.prize)}</span>`);
    const iWon = state.me && res.winnerId === state.me.id;
    toast(iWon ? html`${icon('events')} Вы выиграли банк: ${bc(res.prize)}` : `Банк забрал ${res.winner?.nickname}`, iWon ? 'ok' : 'info', 6000);
    loadMyBets(ctx, 'jackpot');
    await sleep(3500); spinning = false; if (ctx.alive()) reload();
  };
  ctx.on('jackpot', (e) => { if (e?.phase === 'ended' && e.id) spin(e.id).catch(() => { spinning = false; }); else reload(); });
  ctx.every(4000, () => reload());
  on(ctx.el, 'click', '[data-bet]', (e, b) => busy(b, async () => { if (!requireLogin()) return; await api('/api/jackpot/bet', { amount: amountOf(ctx.el) }); toast('Ставка добавлена в банк', 'ok'); await reload(); }));
  drawStatic(); loadMyBets(ctx, 'jackpot');
}, { title: 'Jackpot' });

// ================= COINFLIP =================
const SIDE = { ct: ['shield', 'Спецназ (CT)'], t: ['flame', 'Террористы (T)'] };
export function coinModal(flip) {
  const m = modal(html`<div class="center"><h3>Coinflip #${flip.id}</h3><div class="coin" data-coin><div class="f heads">${icon(SIDE.ct[0])}</div><div class="f tails">${icon(SIDE.t[0])}</div></div><div data-out class="muted">Подбрасываем монету…</div></div>`);
  const coin = $('[data-coin]', m.el);
  requestAnimationFrame(() => { coin.style.transform = `rotateY(${1800 + (flip.result === 't' ? 180 : 0)}deg)`; });
  setTimeout(() => {
    const out = $('[data-out]', m.el); if (!out) return;
    const winner = flip.winnerId === flip.creator?.id ? flip.creator : flip.joiner;
    const iWon = state.me && flip.winnerId === state.me.id;
    mount(out, html`<p>Выпало: <b>${SIDE[flip.result]?.[1] || flip.result}</b></p><p class="lg">${iWon ? html`${icon('events')} Вы победили и получили ${bc(flip.payout)}` : html`Победил ${winner?.nickname || 'соперник'}`}</p><p class="xs dim mono">Сид: ${flip.seed || '—'}</p>`);
  }, 3100);
}
page('/games/coinflip', async (ctx) => {
  let d = await api('/api/coinflip');
  if (state.features.games === false || d.limits?.enabled === false) return mount(ctx.el, html`<div class="wrap">${head('Coinflip')}${gameOff('Coinflip')}</div>`);
  let side = 'ct'; const seen = new Set((d.recent || []).map((f) => f.id));
  mount(ctx.el, html`<div class="wrap">${head('Coinflip', 'Создайте ставку или примите чужую. Победитель забирает обе ставки за вычетом комиссии.')}
    <div class="game">
      <div class="card bet-panel">${betInput(d.limits)}
        <div class="fld"><span>Ваша сторона</span><div class="seg" data-side>${Object.entries(SIDE).map(([k, v]) => html`<button class="${k === side ? 'on' : ''}" data-s="${k}">${icon(v[0])} ${v[1]}</button>`)}</div></div>
        ${state.me ? html`<button class="btn lg block" data-create>Создать игру</button>` : html`<a class="btn lg block" href="/login?next=/games/coinflip">Войти, чтобы играть</a>`}
        ${rulesBox(['Создатель выбирает сторону и сумму. Соперник ставит ту же сумму на противоположную сторону.', 'Если соперника нет, можно сыграть против бота — условия те же.', 'Комиссия с банка: ' + Math.round((d.fee || 0) * 100) + '%.', 'Сторона определяется из серверного сида игры (хеш виден заранее) и сида соперника.'])}
      </div>
      <div class="stack"><div class="card"><div class="card-head"><h3>Открытые игры</h3><span class="muted sm" data-n></span></div><div class="stack" data-open></div></div>
        <div class="card"><h3>Последние результаты</h3><div class="stack" data-recent></div></div></div>
    </div>
    <section class="sec"><div class="sec-head"><h2>Мои игры</h2></div><div data-my>${loader()}</div></section></div>`);
  bindAmount(ctx.el, d.limits);
  const row = (f, live) => { const mineF = state.me && f.creator?.id === state.me.id; const s = SIDE[f.side] || ['?', f.side]; const os = SIDE[f.side === 'ct' ? 't' : 'ct'];
    return html`<div class="cf-row"><div class="row gap"><span class="cf-side ${f.side === 'ct' ? 'heads' : 'tails'}" title="${s[1]}">${icon(s[0])}</span>${userLink(f.creator)}</div><b class="muted">VS</b>
      <div class="row gap">${f.joiner ? html`<span class="cf-side ${f.side === 'ct' ? 'tails' : 'heads'}">${icon(os[0])}</span>${userLink(f.joiner)}` : html`<span class="muted sm">Ждём соперника</span>`}</div>
      <div class="row gap end">${bc(f.amount)}${live ? (mineF ? html`<button class="btn sm ghost" data-bot="${f.id}">${icon('bot')} С ботом</button><button class="btn sm red" data-cancel="${f.id}">Отменить</button>` : html`<button class="btn sm" data-join="${f.id}">Играть за ${os[1]}</button>`) : html`${f.winnerId && state.me && f.winnerId === state.me.id ? html`<span class="badge ok">Победа</span>` : html`<span class="badge">${SIDE[f.result] ? icon(SIDE[f.result][0]) : ''} ${f.result === 'ct' ? 'CT' : 'T'}</span>`}<button class="btn sm ghost" data-show="${f.id}">Повтор</button>`}</div></div>`; };
  const draw = () => {
    $('[data-n]', ctx.el).textContent = (d.open || []).length + ' игр';
    mount($('[data-open]', ctx.el), (d.open || []).length ? html`${d.open.map((f) => row(f, true))}` : empty('Открытых игр нет. Создайте первую!'));
    mount($('[data-recent]', ctx.el), (d.recent || []).length ? html`${d.recent.slice(0, 12).map((f) => row(f, false))}` : html`<p class="muted sm">Ещё никто не играл.</p>`);
  };
  const reload = reloader(async () => {
    const nd = await api('/api/coinflip'); if (!ctx.alive()) return; d = nd; draw();
    for (const f of d.recent || []) { if (seen.has(f.id)) continue; seen.add(f.id); if (state.me && (f.creator?.id === state.me.id || f.joiner?.id === state.me.id)) { coinModal(f); loadMyBets(ctx, 'coinflip'); } }
  });
  on(ctx.el, 'click', '[data-side] button', (e, b) => { side = b.dataset.s; for (const x of $$('[data-side] button', ctx.el)) x.classList.toggle('on', x === b); });
  on(ctx.el, 'click', '[data-create]', (e, b) => busy(b, async () => { await api('/api/coinflip', { amount: amountOf(ctx.el), side }); toast('Игра создана — ждём соперника', 'ok'); await reload(); }));
  on(ctx.el, 'click', '[data-join]', (e, b) => busy(b, async () => { if (!requireLogin()) return; await api(`/api/coinflip/${b.dataset.join}/join`, {}); await reload(); }));
  on(ctx.el, 'click', '[data-bot]', (e, b) => busy(b, async () => { await api(`/api/coinflip/${b.dataset.bot}/bot`, {}); await reload(); }));
  on(ctx.el, 'click', '[data-cancel]', (e, b) => busy(b, async () => { await api(`/api/coinflip/${b.dataset.cancel}/cancel`, {}); toast('Игра отменена, ставка возвращена', 'ok'); await reload(); }));
  on(ctx.el, 'click', '[data-show]', (e, b) => { const f = (d.recent || []).find((x) => String(x.id) === b.dataset.show); if (f) coinModal(f); });
  ctx.on('coinflip', () => reload());
  ctx.every(5000, () => reload());
  draw(); loadMyBets(ctx, 'coinflip');
}, { title: 'Coinflip' });
