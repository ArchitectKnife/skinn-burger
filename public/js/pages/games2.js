// Roulette, Mines, Towers.
import { state, html, raw, mount, $, $$, api, money, bc, pct, avatar, empty, loader, head, toast, fail, busy, page, on, sleep, rub } from '../core.js';
import { icon } from '../icons.js';
import { rulesBox } from './shared.js';
import { betInput, bindAmount, amountOf, requireLogin, loadMyBets, gameOff, reloader } from './games.js';

const parseData = (x) => { if (!x) return {}; if (typeof x === 'object') return x; try { return JSON.parse(x); } catch { return {}; } };

// ================= ROULETTE (европейская, 0–36) =================
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const OUTS = [['dozen', 1, '1–12'], ['dozen', 2, '13–24'], ['dozen', 3, '25–36'], ['low', null, '1–18'], ['even', null, 'Чётное'], ['red', null, 'Красное'], ['black', null, 'Чёрное'], ['odd', null, 'Нечётное'], ['high', null, '19–36']];
const PAY = { number: 36, red: 2, black: 2, even: 2, odd: 2, low: 2, high: 2, dozen: 3, column: 3 };
function wheelSvg(red) {
  const seg = 360 / WHEEL.length; const P = (r, a) => { const t = (a * Math.PI) / 180; return [(r * Math.sin(t)).toFixed(2), (-r * Math.cos(t)).toFixed(2)]; };
  let s = '<svg viewBox="-150 -150 300 300" aria-hidden="true"><circle r="148" fill="#3a2a17"/><circle r="142" fill="#1a1d26"/>';
  WHEEL.forEach((n, i) => {
    const a0 = (i - 0.5) * seg, a1 = (i + 0.5) * seg; const [x0, y0] = P(140, a0), [x1, y1] = P(140, a1), [x2, y2] = P(96, a1), [x3, y3] = P(96, a0);
    const fill = n === 0 ? '#2fa84f' : red.includes(n) ? '#d62f3c' : '#20232c';
    s += '<path d="M' + x0 + ' ' + y0 + ' A140 140 0 0 1 ' + x1 + ' ' + y1 + ' L' + x2 + ' ' + y2 + ' A96 96 0 0 0 ' + x3 + ' ' + y3 + ' Z" fill="' + fill + '" stroke="#0d0f14" stroke-width="1"/>';
    const [tx, ty] = P(119, i * seg);
    s += '<text x="' + tx + '" y="' + ty + '" fill="#fff" font-size="11" font-weight="700" text-anchor="middle" dominant-baseline="central" transform="rotate(' + (i * seg).toFixed(2) + ' ' + tx + ' ' + ty + ')">' + n + '</text>';
  });
  s += '<circle r="94" fill="#12151c"/><circle r="60" fill="#FFB627" opacity=".12"/></svg>';
  return s;
}
page('/games/roulette', async (ctx) => {
  let d = await api('/api/roulette');
  if (state.features.games === false || d.limits?.enabled === false) return mount(ctx.el, html`<div class="wrap">${head('Roulette')}${gameOff('Roulette')}</div>`);
  const RED = d.red || [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
  const col = (n) => (n === 0 ? 'green' : RED.includes(n) ? 'red' : 'black');
  const bets = new Map(); let chip = 10; let rot = 0; let spinning = false;
  const total = () => [...bets.values()].reduce((s, v) => s + v, 0);
  const nums = []; for (const row of [3, 2, 1]) { for (let c = 0; c < 12; c++) nums.push(c * 3 + row); nums.push('c' + (row === 3 ? 3 : row === 2 ? 2 : 1)); }
  mount(ctx.el, html`<div class="wrap">${head('Roulette', 'Европейская рулетка с одним зеро. Расставьте фишки и запустите колесо.')}
    <div class="game">
      <div class="card bet-panel">
        <div class="fld"><span>Номинал фишки, ₽</span><div class="seg" data-chips>${[1, 5, 10, 50, 100, 500].map((v) => html`<button class="${v === chip ? 'on' : ''}" data-chip="${v}">${v}</button>`)}</div></div>
        <div class="kv"><span>Ставок на столе</span><span data-cnt>0</span><span>Итого</span><span data-total>${bc(0)}</span></div>
        ${state.me ? html`<button class="btn lg block" data-spin disabled>Крутить</button>` : html`<a class="btn lg block" href="/login?next=/games/roulette">Войти, чтобы играть</a>`}
        <div class="row gap"><button class="btn ghost sm grow" data-undo>Отменить последнюю</button><button class="btn ghost sm grow" data-clear>Очистить стол</button></div>
        <p class="xs dim mb0">Лимит на спин: ${money(d.limits?.min ?? 100)} – ${rub(d.limits?.max ?? 5000000)}</p>
        ${rulesBox(['Нажмите на поле стола, чтобы поставить фишку. Повторное нажатие увеличивает ставку.', 'Выплаты: число ×36, дюжина и колонка ×3, красное/чёрное, чётное/нечётное, 1–18/19–36 ×2 (ставка включена).', 'При выпадении 0 выигрывает только ставка на число 0.', 'Число определяется на сервере из вашей пары сидов Provably Fair и nonce.'])}
      </div>
      <div class="stack">
        <div class="game-screen"><div class="rl-wrap"><div class="rl-ball"></div><div class="rl-wheel" data-wheel>${raw(wheelSvg(RED))}</div><div class="rl-num" data-num><b>?</b></div></div><div class="hist" style="padding:0 16px 16px" data-hist></div></div>
        <div class="card" style="overflow-x:auto"><div class="rl-table" data-table style="display:grid;grid-template-columns:repeat(14,minmax(34px,1fr));gap:4px;min-width:560px">
          <button class="n-green" data-b="number:0" data-l="0" style="grid-row:span 3">0</button>
          ${nums.map((n) => (typeof n === 'number' ? html`<button class="n-${col(n)}" data-b="number:${n}" data-l="${n}">${n}</button>` : html`<button class="out" data-b="column:${n.slice(1)}" data-l="2:1">2:1</button>`))}
        </div>
        <div class="rl-outs" style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:6px;min-width:560px">${OUTS.map(([t, v, l]) => html`<button class="out ${t === 'red' ? 'n-red' : t === 'black' ? 'n-black' : ''}" data-b="${t}:${v ?? ''}" data-l="${l}">${l}</button>`)}</div></div>
        <div class="card"><h3>Последние спины игроков</h3><div data-recent></div></div>
      </div>
    </div>
    <section class="sec"><div class="sec-head"><h2>Мои спины</h2></div><div data-my>${loader()}</div></section></div>`);
  const order = [];
  const drawTable = () => {
    for (const b of $$('[data-b]', ctx.el)) { const v = bets.get(b.dataset.b); b.innerHTML = ''; b.append(document.createTextNode(b.dataset.l)); if (v) { const s = document.createElement('span'); s.className = 'chipv'; s.textContent = v >= 1000 ? Math.round(v / 100) / 10 + 'k' : String(v); b.append(s); } }
    $('[data-cnt]', ctx.el).textContent = String(bets.size); mount($('[data-total]', ctx.el), bc(total() * 100));
    const sb = $('[data-spin]', ctx.el); if (sb) { sb.disabled = !bets.size || spinning; sb.textContent = bets.size ? 'Крутить за ' + rub(total() * 100) : 'Поставьте фишки'; }
  };
  const drawRecent = () => {
    const list = (d.recent || []).map((b) => ({ ...b, dd: parseData(b.data) }));
    mount($('[data-hist]', ctx.el), html`${list.slice(0, 20).map((b) => html`<span class="h-${col(Number(b.dd.n))}">${b.dd.n ?? '?'}</span>`)}`);
    mount($('[data-recent]', ctx.el), list.length ? html`<div class="players">${list.slice(0, 10).map((b) => html`<div class="pl ${b.payout > 0 ? 'won' : 'lost'}">${avatar({ nickname: b.nickname, avatar: b.avatar }, 'xs')}<span class="grow">${b.nickname || 'Игрок'}</span><span class="h-${col(Number(b.dd.n))}" style="padding:1px 8px;border-radius:6px">${b.dd.n}</span>${bc(b.amount)}${b.payout > 0 ? html`<span class="plus sm">+${money(b.payout)}</span>` : ''}</div>`)}</div>` : html`<p class="muted sm">Спинов пока не было.</p>`);
  };
  const reload = reloader(async () => { const nd = await api('/api/roulette'); if (!ctx.alive()) return; d = nd; drawRecent(); });
  on(ctx.el, 'click', '[data-chip]', (e, b) => { chip = Number(b.dataset.chip); for (const x of $$('[data-chip]', ctx.el)) x.classList.toggle('on', x === b); });
  on(ctx.el, 'click', '[data-b]', (e, b) => { if (spinning) return; const k = b.dataset.b; bets.set(k, (bets.get(k) || 0) + chip); order.push([k, chip]); drawTable(); });
  on(ctx.el, 'click', '[data-undo]', () => { const last = order.pop(); if (!last) return; const v = (bets.get(last[0]) || 0) - last[1]; if (v > 0) bets.set(last[0], v); else bets.delete(last[0]); drawTable(); });
  on(ctx.el, 'click', '[data-clear]', () => { if (spinning) return; bets.clear(); order.length = 0; drawTable(); });
  on(ctx.el, 'click', '[data-spin]', (e, b) => busy(b, async () => {
    if (!requireLogin() || spinning || !bets.size) return;
    const list = [...bets.entries()].map(([k, amount]) => { const [type, v] = k.split(':'); const o = { type, amount }; if (v !== '') o.value = Number(v); return o; });
    spinning = true; drawTable();
    try {
      const r = await api('/api/roulette/spin', { bets: list });
      const i = WHEEL.indexOf(r.n); const seg = 360 / WHEEL.length; const want = (360 - i * seg) % 360;
      rot = rot - (rot % 360) + 360 * 6 + want;
      const w = $('[data-wheel]', ctx.el); w.style.transform = `rotate(${rot}deg)`;
      mount($('[data-num]', ctx.el), html`<b>…</b>`);
      await sleep(5200); if (!ctx.alive()) return;
      mount($('[data-num]', ctx.el), html`<b class="h-${col(r.n)}" style="padding:4px 14px;border-radius:10px">${r.n}</b>`);
      if (r.payout > 0) toast(html`Выпало ${r.n}. Выигрыш: ${bc(r.payout)}`, 'ok', 6000); else toast(`Выпало ${r.n}. В этот раз без выигрыша.`, 'info', 5000);
      reload(); loadMyBets(ctx, 'roulette');
    } finally { spinning = false; if (ctx.alive()) drawTable(); }
  }));
  ctx.on('roulette', () => reload());
  drawTable(); drawRecent(); loadMyBets(ctx, 'roulette');
}, { title: 'Roulette' });

// ================= MINES =================
page('/games/mines', async (ctx) => {
  let d = await api('/api/mines');
  if (state.features.games === false || d.limits?.enabled === false) return mount(ctx.el, html`<div class="wrap">${head('Mines')}${gameOff('Mines')}</div>`);
  let g = d.game; let mines = g?.mines || 3; let last = null;
  mount(ctx.el, html`<div class="wrap">${head('Mines', 'Открывайте клетки с кристаллами и забирайте выигрыш до того, как наткнётесь на мину.')}
    <div class="game">
      <div class="card bet-panel" data-panel></div>
      <div class="stack"><div class="game-screen" style="padding:20px"><div class="game-status" data-status></div><div class="mines-grid" data-grid></div></div>
        <div class="mult-row" data-mults></div><div data-fair></div></div>
    </div>
    <section class="sec"><div class="sec-head"><h2>Мои игры</h2></div><div data-my>${loader()}</div></section></div>`);
  const active = () => g && g.status === 'active';
  const drawPanel = () => {
    const cur = active() ? g.revealed.length : 0; const m = active() ? g.mines : mines;
    const mult = cur ? d.table[m - 1][cur - 1] : 1; const next = d.table[m - 1][cur];
    mount($('[data-panel]', ctx.el), html`${active() ? html`<div class="kv"><span>Ставка</span><span>${bc(g.amount)}</span><span>Мин на поле</span><span>${g.mines}</span><span>Открыто</span><span>${cur} из ${25 - g.mines}</span><span>Текущий множитель</span><b>×${mult.toFixed(2)}</b>${next ? html`<span>Следующая клетка</span><span>×${next.toFixed(2)}</span>` : ''}</div>
      <button class="btn green lg block" data-cashout ${cur ? '' : raw('disabled')}>${cur ? 'Забрать ' + rub(Math.floor(g.amount * mult)) : 'Откройте клетку'}</button>` : html`${betInput(d.limits)}
      <label class="fld"><span>Количество мин</span><select data-mines>${Array.from({ length: 24 }, (_, i) => html`<option value="${i + 1}" ${i + 1 === mines ? raw('selected') : ''}>${i + 1}</option>`)}</select></label>
      <div class="seg">${[1, 3, 5, 10, 24].map((n) => html`<button data-mq="${n}" class="${n === mines ? 'on' : ''}">${n}</button>`)}</div>
      ${state.me ? html`<button class="btn lg block" data-start>Начать игру</button>` : html`<a class="btn lg block" href="/login?next=/games/mines">Войти, чтобы играть</a>`}`}
      ${rulesBox(['На поле 5×5 спрятано выбранное вами количество мин. Чем больше мин, тем быстрее растёт множитель.', 'Каждая открытая клетка с кристаллом увеличивает выигрыш. Забрать его можно в любой момент.', 'Мина — ставка проигрывает. Расстановка мин фиксируется на сервере в момент старта и раскрывается после игры.'])}`);
    if (!active()) bindAmount($('[data-panel]', ctx.el), d.limits);
  };
  const drawGrid = () => {
    const sec = g && g.status !== 'active' ? g.secret?.mines || [] : []; const rev = g?.revealed || [];
    mount($('[data-grid]', ctx.el), html`${Array.from({ length: 25 }, (_, i) => { let cls = '', t = ''; if (rev.includes(i)) { cls = sec.includes(i) ? 'bomb' : 'gem'; t = sec.includes(i) ? icon('bomb', 'boom') : icon('gem', 'safe'); } else if (g && g.status !== 'active') { if (sec.includes(i)) { cls = 'bomb ghost'; t = icon('bomb', 'dim'); } else { cls = 'gem ghost'; t = icon('gem', 'safe'); } } return html`<button class="mc ${cls}" data-cell="${i}" ${active() && !rev.includes(i) ? '' : raw('disabled')}>${t}</button>`; })}`);
    const m = active() ? g.mines : mines; const cur = active() ? g.revealed.length : -1;
    mount($('[data-mults]', ctx.el), html`${d.table[m - 1].slice(0, 24).map((x, k) => html`<span class="${k === cur - 1 ? 'on' : ''}">${k + 1}: ×${x.toFixed(2)}</span>`)}`);
    mount($('[data-status]', ctx.el), active() ? html`<span class="badge ok">Игра идёт</span>` : g ? html`<span class="badge ${g.status === 'won' ? 'ok' : 'err'}">${g.status === 'won' ? 'Выигрыш ' + rub(g.payout) : 'Мина!'}</span>` : '');
    mount($('[data-fair]', ctx.el), g && g.status !== 'active' ? html`<div class="fair-mini">Хеш сервера: <span class="mono">${g.serverHash}</span> · nonce ${g.nonce} · <a href="/fair?bet=${g.id}">проверить</a></div>` : '');
  };
  const draw = () => { drawPanel(); drawGrid(); };
  on(ctx.el, 'change', '[data-mines]', (e, s) => { mines = Number(s.value); for (const b of $$('[data-mq]', ctx.el)) b.classList.toggle('on', Number(b.dataset.mq) === mines); drawGrid(); });
  on(ctx.el, 'click', '[data-mq]', (e, b) => { mines = Number(b.dataset.mq); const s = $('[data-mines]', ctx.el); if (s) s.value = String(mines); for (const x of $$('[data-mq]', ctx.el)) x.classList.toggle('on', x === b); drawGrid(); });
  on(ctx.el, 'click', '[data-start]', (e, b) => busy(b, async () => { if (!requireLogin()) return; const r = await api('/api/mines/start', { amount: amountOf(ctx.el), mines }); g = r.game; draw(); }));
  let pending = false;
  on(ctx.el, 'click', '[data-cell]', async (e, b) => {
    if (!active() || pending) return; pending = true; b.classList.add('busy');
    try {
      const r = await api('/api/mines/reveal', { cell: Number(b.dataset.cell) }); g = r.game;
      if (r.boom) toast('Мина! Ставка проиграна.', 'err');
      else if (g.status === 'won') toast(html`Все кристаллы найдены! ${bc(g.payout)}`, 'ok');
      draw(); if (g.status !== 'active') loadMyBets(ctx, 'mines');
    } catch (err) { fail(err); } finally { pending = false; }
  });
  on(ctx.el, 'click', '[data-cashout]', (e, b) => busy(b, async () => { const r = await api('/api/mines/cashout', {}); g = r.game; toast(html`Выигрыш ×${Number(g.multiplier).toFixed(2)}: ${bc(g.payout)}`, 'ok'); draw(); loadMyBets(ctx, 'mines'); }));
  draw(); loadMyBets(ctx, 'mines');
}, { title: 'Mines' });

// ================= TOWERS =================
page('/games/towers', async (ctx) => {
  const d = await api('/api/towers');
  if (state.features.games === false || d.limits?.enabled === false) return mount(ctx.el, html`<div class="wrap">${head('Towers')}${gameOff('Towers')}</div>`);
  let g = d.game; let diff = g?.difficulty || 'easy'; const L = d.levels || 8;
  mount(ctx.el, html`<div class="wrap">${head('Towers', 'Поднимайтесь по башне из ' + L + ' этажей. Каждый этаж увеличивает множитель.')}
    <div class="game"><div class="card bet-panel" data-panel></div>
      <div class="stack"><div class="game-screen" style="padding:20px"><div class="game-status" data-status></div><div class="tower" data-tower></div></div><div data-fair></div></div></div>
    <section class="sec"><div class="sec-head"><h2>Мои игры</h2></div><div data-my>${loader()}</div></section></div>`);
  const active = () => g && g.status === 'active';
  const mode = () => d.modes[active() || g ? g?.difficulty || diff : diff] || d.modes.easy;
  const drawPanel = () => {
    const m = d.modes[active() ? g.difficulty : diff]; const k = active() ? g.path.length : 0; const mult = k ? m.mults[k - 1] : 1;
    mount($('[data-panel]', ctx.el), html`${active() ? html`<div class="kv"><span>Ставка</span><span>${bc(g.amount)}</span><span>Сложность</span><span>${m.name}</span><span>Этаж</span><span>${k} из ${L}</span><span>Множитель</span><b>×${mult.toFixed(2)}</b></div>
      <button class="btn green lg block" data-cashout ${k ? '' : raw('disabled')}>${k ? 'Забрать ' + rub(Math.floor(g.amount * mult)) : 'Выберите клетку на первом этаже'}</button>` : html`${betInput(d.limits)}
      <div class="fld"><span>Сложность</span><div class="seg" data-diff>${Object.entries(d.modes).map(([key, x]) => html`<button data-d="${key}" class="${key === diff ? 'on' : ''}">${x.name}</button>`)}</div></div>
      <p class="xs dim">${m.cells} клетки на этаже, из них с бомбой: ${m.bombs}. Максимальный множитель ×${m.mults[L - 1].toFixed(2)}.</p>
      ${state.me ? html`<button class="btn lg block" data-start>Начать подъём</button>` : html`<a class="btn lg block" href="/login?next=/games/towers">Войти, чтобы играть</a>`}`}
      ${rulesBox(['На каждом этаже выберите одну клетку. Безопасная клетка поднимает вас выше и увеличивает множитель.', 'Бомба — ставка проигрывает. Забрать выигрыш можно после любого пройденного этажа.', 'Расстановка бомб на всех этажах фиксируется сервером при старте и раскрывается после игры.'])}`);
    if (!active()) bindAmount($('[data-panel]', ctx.el), d.limits);
  };
  const drawTower = () => {
    const m = active() || g ? d.modes[g.difficulty] : d.modes[diff]; const cells = m.cells; const path = g?.path || []; const over = g && g.status !== 'active'; const bombs = over ? g.secret?.bombs || [] : [];
    const rows = [];
    for (let lv = L - 1; lv >= 0; lv--) {
      const cur = active() && lv === path.length; const past = lv < path.length;
      rows.push(html`<div class="tw-row ${cur ? 'cur' : ''} ${past ? 'past' : ''}" style="--c:${cells}"><span class="m">×${m.mults[lv].toFixed(2)}</span>${Array.from({ length: cells }, (_, c) => {
        const picked = path[lv] === c; const bomb = (bombs[lv] || []).includes(c);
        let cls = '', t = '';
        if (picked) { cls = bomb ? 'bomb' : 'safe'; t = bomb ? icon('bomb', 'boom') : icon('star', 'safe'); } else if (over && bombs[lv]) { cls = bomb ? 'bomb ghost' : 'safe ghost'; t = bomb ? icon('bomb', 'dim') : ''; }
        return html`<button class="tw ${cls}" data-col="${c}" ${cur ? '' : raw('disabled')}>${t}</button>`; })}</div>`);
    }
    mount($('[data-tower]', ctx.el), html`${rows}`);
    mount($('[data-status]', ctx.el), active() ? html`<span class="badge ok">Этаж ${path.length + 1}</span>` : g ? html`<span class="badge ${g.status === 'won' ? 'ok' : 'err'}">${g.status === 'won' ? 'Выигрыш ' + rub(g.payout) : 'Бомба!'}</span>` : '');
    mount($('[data-fair]', ctx.el), over ? html`<div class="fair-mini">Хеш сервера: <span class="mono">${g.serverHash}</span> · nonce ${g.nonce} · <a href="/fair?bet=${g.id}">проверить</a></div>` : '');
  };
  const draw = () => { drawPanel(); drawTower(); };
  on(ctx.el, 'click', '[data-d]', (e, b) => { diff = b.dataset.d; if (g && g.status !== 'active') g = null; draw(); });
  on(ctx.el, 'click', '[data-start]', (e, b) => busy(b, async () => { if (!requireLogin()) return; const r = await api('/api/towers/start', { amount: amountOf(ctx.el), difficulty: diff }); g = r.game; draw(); }));
  let pending = false;
  on(ctx.el, 'click', '[data-col]', async (e, b) => {
    if (!active() || pending) return; pending = true;
    try { const r = await api('/api/towers/step', { col: Number(b.dataset.col) }); g = r.game; if (r.boom) toast('Бомба! Ставка проиграна.', 'err'); else if (g.status === 'won') toast(html`Вершина покорена! ${bc(g.payout)}`, 'ok'); draw(); if (g.status !== 'active') loadMyBets(ctx, 'towers'); }
    catch (err) { fail(err); } finally { pending = false; }
  });
  on(ctx.el, 'click', '[data-cashout]', (e, b) => busy(b, async () => { const r = await api('/api/towers/cashout', {}); g = r.game; toast(html`Выигрыш ×${Number(g.multiplier).toFixed(2)}: ${bc(g.payout)}`, 'ok'); draw(); loadMyBets(ctx, 'towers'); }));
  draw(); loadMyBets(ctx, 'towers');
}, { title: 'Towers' });
