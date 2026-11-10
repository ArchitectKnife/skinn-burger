// Case Battle: список комнат, создание, комната с анимацией раундов.
import { state, html, raw, mount, $, $$, api, money, num, bc, img, avatar, userLink, empty, loader, head, tabs, notice, toast, fail, modal, confirmBox, busy, page, go, on, sleep, cssColor, qs, reelHtml, spinReel, itemCard, fdate, ago, rub } from '../core.js';
import { icon } from '../icons.js';
import { rulesBox, copy } from './shared.js';

const ST = { waiting: ['Ожидание игроков', 'warn'], starting: ['Скоро старт', 'info'], running: ['Идёт битва', 'ok'], finished: ['Завершена', ''], cancelled: ['Отменена', 'err'] };
const MODE = { classic: ['Классика', 'Побеждает игрок с наибольшей суммой дропа'], crazy: ['Crazy', 'Побеждает игрок с наименьшей суммой дропа'] };
const caseOf = (cs, map) => { const id = typeof cs === 'object' && cs ? cs.id : cs; return { ...(map[id] || {}), ...(typeof cs === 'object' && cs ? cs : {}), id }; };
const mapOf = (list) => Object.fromEntries((list || []).map((c) => [c.id, c]));
const stBadge = (s) => html`<span class="badge ${ST[s]?.[1] || ''}">${ST[s]?.[0] || s}</span>`;

function battleCard(b, map) {
  const cs = (b.cases || []).map((x) => caseOf(x, map));
  const slots = Array.from({ length: b.maxPlayers }, (_, s) => b.players.find((p) => p.slot === s));
  return html`<a class="bt-card" href="/battles/${b.id}${b.inviteCode ? '?code=' + b.inviteCode : ''}">
    <div class="row between"><div class="row gap-s">${stBadge(b.status)}<span class="badge vio">${MODE[b.mode]?.[0] || b.mode}</span>${b.private ? html`<span class="badge">${icon('lock')} Приватная</span>` : ''}</div><span class="xs dim">#${b.id}</span></div>
    <div class="bt-cases">${cs.slice(0, 7).map((c) => html`<span title="${c.name || ''}">${img(c.image, '', c.name)}</span>`)}${cs.length > 7 ? html`<b class="sm">+${cs.length - 7}</b>` : ''}</div>
    <div class="row between"><div class="bt-slots">${slots.map((p) => (p ? html`<span title="${p.user?.nickname || ''}">${avatar(p.user, 'xs')}</span>` : html`<span class="free">+</span>`))}</div>
      <div class="right"><div class="xs dim">Вход · ${cs.length} раунд.</div>${bc(b.cost)}</div></div>
    ${b.status === 'finished' && b.total != null ? html`<div class="xs muted">Банк ${rub(b.total)} · победил ${b.players.find((p) => p.slot === b.winnerSlot)?.user?.nickname || '—'}</div>` : ''}
  </a>`;
}

// ================= СПИСОК =================
page('/battles', async (ctx) => {
  let d = await api('/api/battles'); let tab = ctx.q.get('tab') || 'live';
  mount(ctx.el, html`<div class="wrap">${head('Case Battle', 'Открывайте кейсы против других игроков. Победитель забирает все выпавшие предметы.', d.enabled === false ? '' : html`<a class="btn" href="/battles/new">+ Создать битву</a>`)}
    ${d.enabled === false ? notice('Case Battle временно отключён администрацией.', 'warn') : ''}
    <div data-tabs></div><div data-list></div>
    <section class="sec">${rulesBox(['Создатель выбирает кейсы (каждый кейс — один раунд), число игроков и режим. Все участники платят одинаковую сумму входа.', 'В каждом раунде игроки одновременно открывают один и тот же кейс.', 'Классика: побеждает наибольшая сумма дропа. Crazy: побеждает наименьшая.', 'Победитель получает все предметы всех игроков. Свободные места можно заполнить ботами.', 'Результаты всех раундов вычисляются из серверного сида битвы и сидов игроков; хеш серверного сида виден до старта.'])}</section></div>`);
  const draw = () => {
    const map = mapOf(d.cases);
    mount($('[data-tabs]', ctx.el), tabs([['live', `Активные (${d.live.length})`], ['mine', 'Мои битвы'], ['recent', 'Завершённые']], tab));
    const list = d[tab] || [];
    mount($('[data-list]', ctx.el), list.length ? html`<div class="grid g-cards">${list.map((b) => battleCard(b, map))}</div>` : empty(tab === 'mine' && !state.me ? 'Войдите, чтобы видеть свои битвы.' : 'Здесь пока пусто. Создайте свою битву!', d.enabled === false ? '' : html`<a class="btn" href="/battles/new">Создать битву</a>`));
  };
  let t = 0; const reload = () => { clearTimeout(t); t = setTimeout(async () => { try { const nd = await api('/api/battles'); if (ctx.alive()) { d = nd; draw(); } } catch {} }, 250); };
  on(ctx.el, 'click', '[data-tab]', (e, b) => { tab = b.dataset.tab; draw(); });
  ctx.on('battle', reload); ctx.every(6000, reload);
  draw();
}, { title: 'Case Battle' });

// ================= СОЗДАНИЕ =================
page('/battles/new', async (ctx) => {
  const d = await api('/api/battles');
  if (d.enabled === false) return mount(ctx.el, html`<div class="wrap">${head('Новая битва')}${notice('Case Battle временно отключён администрацией.', 'warn')}</div>`);
  const qty = new Map(); let players = 2, mode = 'classic', priv = false, q = '';
  const pre = Number(ctx.q.get('case')); if (pre && d.cases.some((c) => c.id === pre)) qty.set(pre, 1);
  const rounds = () => [...qty.values()].reduce((s, v) => s + v, 0);
  const cost = () => d.cases.reduce((s, c) => s + (qty.get(c.id) || 0) * c.price, 0);
  mount(ctx.el, html`<div class="wrap"><div class="row gap sm mb"><a href="/battles">← Все битвы</a></div>${head('Новая битва', 'Выберите кейсы: каждый кейс — один раунд. До 25 раундов.')}
    <div class="split"><div><label class="search mb"><input data-q placeholder="Поиск кейса" aria-label="Поиск кейса"></label><div class="case-pick" data-cases></div></div>
      <div class="card sticky" data-sum></div></div></div>`);
  const drawCases = () => mount($('[data-cases]', ctx.el), html`${d.cases.filter((c) => !q || c.name.toLowerCase().includes(q)).map((c) => { const n = qty.get(c.id) || 0; return html`<div class="cp ${n ? 'on' : ''}" data-c="${c.id}">${img(c.image, '', c.name)}<b class="sm">${c.name}</b>${bc(c.price)}<div class="qty"><button data-minus="${c.id}" ${n ? '' : raw('disabled')} aria-label="Меньше">−</button><span>${n}</span><button data-plus="${c.id}" aria-label="Больше">+</button></div></div>`; })}`);
  const drawSum = () => mount($('[data-sum]', ctx.el), html`<h3>Параметры битвы</h3>
    <div class="fld"><span>Игроков</span><div class="seg">${[2, 3, 4].map((n) => html`<button data-pl="${n}" class="${n === players ? 'on' : ''}">${n === 2 ? '1 на 1' : n === 3 ? '1 на 1 на 1' : '4 игрока'}</button>`)}</div></div>
    <div class="fld"><span>Режим</span><div class="seg">${Object.entries(MODE).map(([k, v]) => html`<button data-mode="${k}" class="${k === mode ? 'on' : ''}">${v[0]}</button>`)}</div><small class="muted">${MODE[mode][1]}</small></div>
    <label class="check"><input type="checkbox" data-priv ${priv ? raw('checked') : ''}><span>Приватная комната (вход по ссылке-приглашению)</span></label>
    <div class="kv mt"><span>Раундов</span><span>${rounds()} / 25</span><span>Вход для каждого</span><span>${bc(cost())}</span><span>Общий банк</span><span>${bc(cost() * players)}</span></div>
    ${state.me ? html`<button class="btn lg block mt" data-create ${rounds() ? '' : raw('disabled')}>Создать за ${rub(cost())}</button>` : html`<a class="btn lg block mt" href="/login?next=/battles/new">Войти, чтобы создать</a>`}
    ${rounds() ? html`<button class="link sm mt" data-reset>Очистить выбор</button>` : html`<p class="muted sm mt mb0">Добавьте хотя бы один кейс.</p>`}`);
  const redraw = () => { drawCases(); drawSum(); };
  $('[data-q]', ctx.el).addEventListener('input', (e) => { q = e.target.value.trim().toLowerCase(); drawCases(); });
  on(ctx.el, 'click', '[data-plus]', (e, b) => { e.stopPropagation(); if (rounds() >= 25) return toast('Максимум 25 раундов', 'info'); const id = Number(b.dataset.plus); qty.set(id, (qty.get(id) || 0) + 1); redraw(); });
  on(ctx.el, 'click', '[data-minus]', (e, b) => { e.stopPropagation(); const id = Number(b.dataset.minus); const n = (qty.get(id) || 0) - 1; if (n > 0) qty.set(id, n); else qty.delete(id); redraw(); });
  on(ctx.el, 'click', '.cp', (e, el) => { if (e.target.closest('button')) return; const id = Number(el.dataset.c); if (qty.get(id)) return; if (rounds() >= 25) return toast('Максимум 25 раундов', 'info'); qty.set(id, 1); redraw(); });
  on(ctx.el, 'click', '[data-pl]', (e, b) => { players = Number(b.dataset.pl); drawSum(); });
  on(ctx.el, 'click', '[data-mode]', (e, b) => { mode = b.dataset.mode; drawSum(); });
  on(ctx.el, 'change', '[data-priv]', (e, b) => { priv = b.checked; });
  on(ctx.el, 'click', '[data-reset]', () => { qty.clear(); redraw(); });
  on(ctx.el, 'click', '[data-create]', (e, b) => busy(b, async () => {
    const ids = []; for (const c of d.cases) for (let i = 0; i < (qty.get(c.id) || 0); i++) ids.push(c.id);
    const r = await api('/api/battles', { cases: ids, players, mode, private: priv });
    const bt = r.battle || r; toast('Битва создана', 'ok');
    go(`/battles/${bt.id}` + (bt.inviteCode ? '?code=' + bt.inviteCode : ''));
  }));
  redraw();
}, { auth: true, title: 'Новая битва' });

// ================= КОМНАТА =================
page('/battles/:id', async (ctx) => {
  const id = ctx.params.id; const code = ctx.q.get('code') || '';
  const [d0, lst] = await Promise.all([api(`/api/battles/${encodeURIComponent(id)}` + qs({ code })), api('/api/battles').catch(() => ({ cases: [] }))]);
  let b = d0.battle; const map = mapOf(lst.cases);
  let off = b.serverTime - Date.now(); const sNow = () => Date.now() + off;
  const pools = new Map();
  const getPool = async (c) => { if (!c.slug) return null; if (!pools.has(c.slug)) pools.set(c.slug, api('/api/cases/' + encodeURIComponent(c.slug)).then((r) => r.case.items).catch(() => null)); return pools.get(c.slug); };
  const cases = () => (b.cases || []).map((x) => caseOf(x, map));
  let shown = 0; let animating = false;
  const isMember = () => state.me && b.players.some((p) => p.user?.id === state.me.id);
  const isCreator = () => state.me && b.creatorId === state.me.id;
  const link = () => location.origin + '/battles/' + b.id + (b.inviteCode || code ? '?code=' + (b.inviteCode || code) : '');
  mount(ctx.el, html`<div class="wrap"><div class="row gap sm mb"><a href="/battles">← Все битвы</a></div>
    <div data-head></div><div class="bt-rounds" data-rounds></div><div data-count></div>
    <div class="arena" data-arena style="--n:${b.maxPlayers}"></div>
    <div data-result></div>
    <section class="sec grid g2"><div class="card"><h3>Кейсы битвы</h3><div data-caselist></div></div><div class="card"><h3>${icon('key')} Честность</h3><div class="kv sm" data-fair></div></div></section></div>`);
  const totals = () => { const t = {}; for (const r of b.rounds.slice(0, shown)) for (const x of r) t[x.slot] = (t[x.slot] || 0) + (x.price || 0); return t; };
  const drawHead = () => {
    const cs = cases(); const free = b.maxPlayers - b.players.length;
    let acts = '';
    if (b.status === 'waiting') {
      if (!state.me) acts = html`<a class="btn" href="/login?next=${encodeURIComponent(location.pathname + location.search)}">Войти, чтобы участвовать</a>`;
      else acts = html`${isMember() ? html`<button class="btn ghost" data-invite>${icon('invite')} Пригласить друзей</button><button class="btn ghost" data-copy>${icon('link')} Ссылка</button>` : ''}${isCreator() && free ? html`<button class="btn ghost" data-bots>${icon('bot')} Заполнить ботами</button>` : ''}${isMember() ? html`<button class="btn red" data-leave>${isCreator() ? 'Отменить битву' : 'Покинуть'}</button>` : ''}`;
    }
    mount($('[data-head]', ctx.el), head(html`Битва #${b.id}`, html`${stBadge(b.status)} <span class="badge vio">${MODE[b.mode]?.[0]}</span> ${b.private ? html`<span class="badge">${icon('lock')} Приватная</span>` : ''} · ${MODE[b.mode]?.[1]} · вход ${rub(b.cost)} · ${cs.length} раунд.`, acts));
    const cur = b.status === 'running' ? Math.max(0, shown - 1) : -1;
    mount($('[data-rounds]', ctx.el), html`${cs.map((c, i) => html`<div class="rc ${i < shown ? 'done' : ''} ${i === cur ? 'cur' : ''}" title="${c.name || ''}">${img(c.image, '', c.name)}<span class="xs">${i + 1}</span></div>`)}`);
    const counts = {}; for (const c of cs) { counts[c.id] = counts[c.id] || { c, n: 0 }; counts[c.id].n++; }
    mount($('[data-caselist]', ctx.el), html`<div class="players">${Object.values(counts).map(({ c, n }) => html`<div class="pl"><span class="thumb">${img(c.image, '', c.name)}</span>${c.slug ? html`<a class="grow" href="/cases/${c.slug}">${c.name}</a>` : html`<span class="grow">${c.name || 'Кейс #' + c.id}</span>`}<span class="muted">×${n}</span>${bc(c.price)}</div>`)}</div>`);
    mount($('[data-fair]', ctx.el), html`<span>Хеш серверного сида</span><span class="mono xs">${b.hash}</span><span>Серверный сид</span><span class="mono xs">${b.seed || 'будет раскрыт после битвы'}</span><span>Сиды игроков</span><span class="mono xs">${b.clientSeed || 'формируются при старте'}</span><span>Создана</span><span>${fdate(b.createdAt)}</span>`);
  };
  const drawArena = () => {
    const t = totals(); const fin = b.status === 'finished' && shown >= (b.cases || []).length;
    mount($('[data-arena]', ctx.el), html`${Array.from({ length: b.maxPlayers }, (_, s) => {
      const p = b.players.find((x) => x.slot === s);
      const cls = fin ? (s === b.winnerSlot ? 'win' : 'lose') : '';
      const drops = b.rounds.slice(0, shown).map((r) => r.find((x) => x.slot === s)).filter(Boolean);
      return html`<div class="bp ${cls}" data-slot="${s}"><div class="bp-head">${p ? userLink(p.user) : html`<span class="muted">Свободное место</span>`}${fin && s === b.winnerSlot ? html`<span class="badge ok">${icon('trophy')} Победитель</span>` : ''}</div>
        <div class="bp-total">${bc(fin && p?.total != null ? p.total : t[s] || 0)}</div>
        <div data-reel="${s}"></div>
        ${p ? '' : b.status === 'waiting' ? html`<div class="bp-wait">${state.me && !isMember() ? html`<button class="btn" data-join="${s}">Занять место за ${money(b.cost)}</button>` : html`<span class="muted">Ждём игрока…</span>`}</div>` : ''}
        <div class="bp-drops">${drops.slice().reverse().map((x) => itemCard(x))}</div></div>`;
    })}`);
    if (fin) {
      const rows = b.players.map((p) => ({ p, total: p.total ?? t[p.slot] ?? 0 })).sort((a, c) => (b.mode === 'crazy' ? a.total - c.total : c.total - a.total));
      const w = b.players.find((p) => p.slot === b.winnerSlot);
      mount($('[data-result]', ctx.el), html`<div class="card hl mt"><div class="card-head"><h3>${icon('trophy')} Итоги битвы</h3><span>Банк ${bc(b.total)}</span></div>
        <p>${w ? html`${userLink(w.user)} забирает все предметы на сумму ${bc(b.total)}` : '—'}</p>
        <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Место</th><th>Игрок</th><th class="r">Сумма дропа</th><th class="r">Результат</th></tr></thead><tbody>${rows.map((r, i) => html`<tr><td>${i + 1}</td><td>${userLink(r.p.user)}</td><td class="r">${bc(r.total)}</td><td class="r ${r.p.slot === b.winnerSlot ? 'plus' : 'minus'}">${r.p.slot === b.winnerSlot ? '+' + money(b.total) : '−' + money(b.cost)}</td></tr>`)}</tbody></table></div>
        <div class="row gap mt"><a class="btn" href="/battles/new">Создать новую битву</a>${isMember() ? html`<a class="btn ghost" href="/inventory">В инвентарь</a>` : ''}</div></div>`);
    } else if (b.status === 'cancelled') mount($('[data-result]', ctx.el), notice('Битва отменена создателем. Взносы возвращены участникам.', 'warn'));
    else mount($('[data-result]', ctx.el), '');
  };
  const draw = () => { drawHead(); drawArena(); };
  // Проигрывание новых раундов по очереди.
  const play = async () => {
    if (animating) return; animating = true;
    try {
      while (ctx.alive() && shown < b.rounds.length) {
        const r = b.rounds[shown]; const c = cases()[shown] || {}; const last = shown === b.rounds.length - 1;
        const live = b.status === 'running' || (b.status === 'finished' && last && sNow() - (b.finishedAt || 0) < 8000);
        if (live) {
          const pool = (await getPool(c)) || b.rounds.flat();
          const dur = Math.max(1800, (b.roundMs || 4500) - 1100);
          const spins = [];
          for (const x of r) { const box = $(`[data-reel="${x.slot}"]`, ctx.el); if (!box) continue; mount(box, reelHtml(pool, x, 34, 28, 'sm vert')); const el = $('.reel', box); if (el) spins.push(spinReel(el, { win: 28, duration: dur, vertical: true })); }
          await Promise.all(spins); await sleep(350);
        }
        if (!ctx.alive()) return; shown++; draw();
      }
    } finally { animating = false; }
  };
  const reload = async () => { try { const r = await api(`/api/battles/${encodeURIComponent(id)}` + qs({ code })); if (!ctx.alive()) return; b = r.battle; off = b.serverTime - Date.now(); if (!animating) draw(); play(); } catch {} };
  // Уже сыгранные раунды показываем сразу, анимируем только текущий.
  shown = b.status === 'finished' && sNow() - (b.finishedAt || 0) > 8000 ? b.rounds.length : Math.max(0, b.rounds.length - 1);
  draw(); play();
  ctx.on('battle', (e) => { if (!e || Number(e.id) === Number(b.id)) reload(); });
  ctx.every(1000, () => {
    const cd = $('[data-count]', ctx.el); if (!cd) return;
    if (b.startAt && sNow() < b.startAt && b.status !== 'finished') mount(cd, html`<div class="countdown">Старт через <b>${Math.ceil((b.startAt - sNow()) / 1000)}</b></div>`);
    else if (b.status === 'waiting') mount(cd, html`<div class="countdown">Ждём игроков: ${b.players.length} из ${b.maxPlayers}</div>`);
    else mount(cd, '');
    if (b.status === 'running') { const exp = Math.min((b.cases || []).length, Math.floor((sNow() - b.startAt) / (b.roundMs || 4500)) + 1); if (exp > b.rounds.length) reload(); }
    else if ((b.status === 'starting' || b.status === 'waiting') && b.startAt && sNow() >= b.startAt) reload();
  });
  ctx.every(5000, () => { if (b.status === 'waiting' || b.status === 'starting') reload(); });
  on(ctx.el, 'click', '[data-join]', (e, btn) => busy(btn, async () => { await api(`/api/battles/${b.id}/join`, { code: code || undefined, slot: Number(btn.dataset.join) }); toast('Вы в битве! Удачи', 'ok'); await reload(); }));
  on(ctx.el, 'click', '[data-bots]', (e, btn) => busy(btn, async () => { const r = await api(`/api/battles/${b.id}/bots`, {}); b = r.battle; draw(); }));
  on(ctx.el, 'click', '[data-leave]', (e, btn) => busy(btn, async () => { if (!(await confirmBox(isCreator() ? 'Отменить битву? Взносы будут возвращены всем участникам.' : 'Покинуть битву? Взнос будет возвращён.', 'Да', true))) return; const wasCreator = isCreator(); await api(`/api/battles/${b.id}/leave`, {}); toast('Взнос возвращён на баланс', 'ok'); if (wasCreator) go('/battles'); else await reload(); }));
  on(ctx.el, 'click', '[data-copy]', () => copy(link()));
  on(ctx.el, 'click', '[data-invite]', async () => {
    try {
      const f = await api('/api/friends'); const list = (f.friends || []).map((x) => x.user || x);
      const m = modal(html`<h3>Пригласить друзей</h3><p class="muted sm">Друг получит уведомление со ссылкой на эту битву.</p>${list.length ? html`<div class="players">${list.map((u) => html`<div class="pl">${avatar(u, 'xs')}<span class="grow">${u.nickname}</span><button class="btn sm" data-inv="${u.id}">Пригласить</button></div>`)}</div>` : empty('У вас пока нет друзей.', html`<a class="btn" href="/friends" data-close>Найти друзей</a>`)}<div class="row gap mt"><button class="btn ghost grow" data-copy2>${icon('link')} Скопировать ссылку</button></div>`);
      on(m.el, 'click', '[data-inv]', (e, btn) => busy(btn, async () => { await api(`/api/battles/${b.id}/invite`, { userId: Number(btn.dataset.inv) }); btn.textContent = 'Приглашён'; btn.disabled = true; }));
      on(m.el, 'click', '[data-copy2]', () => copy(link()));
    } catch (err) { fail(err); }
  });
}, { title: 'Case Battle' });
