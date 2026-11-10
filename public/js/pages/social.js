// BURGER SKIN — BURGER PASS, бонусы, промокоды, достижения, коллекции, события и турниры, рейтинг.
import { state, html, raw, mount, $, $$, api, num, bc, fdate, fday, ago, left, LEDGER, img, itemCard, userLink, empty, loader, head, tabs, notice, toast, modal, busy, bindForm, page, on, setQuery, setBalance, rub } from '../core.js';
import { icon } from '../icons.js';
import { stat, progress, copy, featureOff, EVENT_KIND } from './shared.js';
import './profile.js';

export const absUrl = (p) => (p && String(p).startsWith('/') ? location.origin + p : p || '');

// ---------- BURGER PASS ----------
function rewardBody(r) {
  if (r.type === 'item' && r.item) return html`<div class="ri">${img(r.item.image, '', r.item.name)}</div><div class="rl">${r.label || r.item.name}</div>${r.item.price ? html`<small class="muted">${bc(r.item.price)}</small>` : ''}`;
  if (r.type === 'case' && r.case) return html`<div class="ri">${img(r.case.image, '', r.case.name)}</div><div class="rl">${r.label || 'Кейс ' + r.case.name}</div>`;
  return html`<div class="ri">${icon('coins')}</div><div class="rl">${r.label || 'Бонус на баланс'}</div><small class="muted">${bc(r.amount)}</small>`;
}
function rewardTitle(r) {
  if (r.type === 'item' && r.item) return r.item.name;
  if (r.type === 'case' && r.case) return 'Кейс «' + r.case.name + '»';
  return r.label || 'Бонус на баланс';
}
function showRewards(list) {
  const drops = [];
  for (const x of list) {
    const res = x.result;
    const ds = res?.drops || res?.items || (res?.item ? [res.item] : []);
    for (const d of ds) drops.push(d);
    if (x.reward?.type === 'item' && x.reward.item) drops.push(x.reward.item);
  }
  const money = list.filter((x) => x.reward?.type === 'balance').reduce((s, x) => s + (x.reward.amount || 0), 0);
  if (!drops.length) { toast(money ? 'Награда получена: ' + rub(money) : 'Награда получена', 'ok'); return; }
  modal(html`<h3>Награды BURGER PASS</h3>${money ? html`<p>На баланс зачислено ${bc(money)}</p>` : ''}<div class="grid g-items">${drops.map((d) => itemCard(d, { href: '/inventory' }))}</div><div class="row end gap mt"><a class="btn ghost" href="/inventory" data-close>В инвентарь</a><button class="btn" data-close>Отлично</button></div>`, { wide: true });
}

page('/pass', async (ctx) => {
  let tab = ctx.q.get('tab') || 'track';
  const load = async () => {
    const d = await api('/api/pass');
    if (!ctx.alive()) return;
    if (!d.season) return mount(ctx.el, html`<div class="wrap">${head('BURGER PASS', 'Сезонный пропуск на 100 уровней')}${empty('Новый сезон BURGER PASS скоро стартует. Следите за новостями!', html`<a class="btn" href="/news">Новости</a>`)}</div>`);
    const s = d.season; const lvl = d.level; const per = Math.max(1, s.xpPerLevel);
    const inLvl = lvl >= 100 ? per : Math.max(0, d.xp - lvl * per);
    const by = {}; for (const r of d.rewards) (by[r.level] ||= {})[r.track] = r;
    const ready = (r) => !!state.me && !r.claimed && lvl >= r.level && (r.track === 'free' || d.premium) && d.enabled;
    const nReady = d.rewards.filter(ready).length;
    const cell = (r, track) => {
      if (!r) return html`<div class="pt-r ${track === 'premium' ? 'prem' : ''} locked"><div class="ri muted">·</div><div class="rl muted sm">Без награды</div></div>`;
      const locked = lvl < r.level || (r.track === 'premium' && !d.premium);
      const cls = [r.track === 'premium' ? 'prem' : '', r.claimed ? 'claimed' : ready(r) ? 'ready' : locked ? 'locked' : ''].join(' ');
      const tip = r.claimed ? 'Получено' : ready(r) ? 'Нажмите, чтобы забрать' : lvl < r.level ? 'Откроется на уровне ' + r.level : 'Нужен Premium';
      return html`<div class="pt-r ${cls}" title="${tip}" ${ready(r) ? raw(`data-claim="${r.id}" role="button" tabindex="0" style="cursor:pointer"`) : ''}>${rewardBody(r)}${ready(r) ? html`<span class="badge warn">Забрать</span>` : ''}</div>`;
    };
    const cols = [];
    for (let L = 1; L <= 100; L++) cols.push(html`<div class="pt-lvl ${L <= lvl ? 'on' : ''}">${L}</div>${cell(by[L]?.free, 'free')}${cell(by[L]?.premium, 'premium')}`);
    mount(ctx.el, html`<div class="wrap">
      <div class="pass-hero">
        <div>
          <span class="badge warn">Сезон BURGER PASS</span>
          <h1>${s.name}</h1>
          <p class="muted">${s.endsAt ? html`До конца сезона: <b>${left(s.endsAt)}</b> · завершится ${fday(s.endsAt)}` : 'Сезон идёт без ограничения по времени'}</p>
          <div class="row between sm"><span>Уровень <b>${lvl}</b> из 100</span><span>${lvl >= 100 ? 'Максимальный уровень достигнут' : `${num(inLvl)} / ${num(per)} XP до уровня ${lvl + 1}`}</span></div>
          ${progress(inLvl, per)}
          <p class="muted sm">Всего опыта: ${num(d.xp)} XP. ${d.xpRules || ''}</p>
          <div class="row gap mt" style="flex-wrap:wrap">
            ${!state.me ? html`<a class="btn" href="/login?next=/pass">Войти и начать прокачку</a>` : html`
              ${d.premium ? html`<span class="badge vio">Premium активен</span>` : html`<button class="btn" data-prem ${d.enabled ? '' : raw('disabled')}>Активировать Premium · ${bc(s.premiumPrice)}</button>`}
              <button class="btn ghost" data-all ${nReady ? '' : raw('disabled')}>Забрать всё${nReady ? ` (${nReady})` : ''}</button>`}
            <a class="btn ghost" href="/bonuses">Задания на опыт</a>
          </div>
        </div>
        <div class="lvl"><div><b>${lvl}</b><span>уровень</span></div></div>
      </div>
      ${!d.enabled ? featureOff('BURGER PASS') : ''}
      <div class="mt-l">${tabs([['track', 'Награды'], ['history', 'История наград'], ['rules', 'Как получать опыт']], tab)}</div>
      <div data-body class="mt"></div>
    </div>`);
    const body = $('[data-body]', ctx.el);
    if (tab === 'track') {
      mount(body, html`<div class="row gap sm muted mb"><span class="badge">Верхний ряд — бесплатная ветка</span><span class="badge vio">Нижний ряд — Premium</span></div><div class="pass-track" data-track>${cols}</div>`);
      const tr = $('[data-track]', body); if (tr) tr.scrollLeft = Math.max(0, (Math.min(lvl, 99) - 2) * 128);
    } else if (tab === 'history') {
      if (!state.me) return mount(body, empty('Войдите, чтобы видеть историю наград.', html`<a class="btn" href="/login?next=/pass">Войти</a>`));
      mount(body, loader());
      const h = await api('/api/pass/history');
      if (!ctx.alive()) return;
      mount(body, h.rows.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Награда</th><th>Уровень</th><th>Ветка</th><th>Сезон</th><th class="r">Получена</th></tr></thead><tbody>${h.rows.map((r) => html`<tr><td><div class="mini-it">${r.item ? img(r.item.image) : r.case ? img(r.case.image) : html`<span>${icon('coins')}</span>`}<span>${rewardTitle(r)}${r.type === 'balance' ? html` · ${bc(r.amount)}` : ''}</span></div></td><td>${r.level}</td><td>${r.track === 'premium' ? html`<span class="badge vio">Premium</span>` : html`<span class="badge">Бесплатная</span>`}</td><td>${r.season}</td><td class="r muted">${fdate(r.claimedAt)}</td></tr>`)}</tbody></table></div>` : empty('Вы ещё не забирали награды пропуска.'));
    } else {
      mount(body, html`<div class="card prose"><h3>Как прокачивать BURGER PASS</h3><ul>
        <li>Опыт начисляется за оборот: открытие кейсов, мини-игры, апгрейды, контракты и Case Battle.</li>
        <li>Ежедневные и еженедельные задания дают дополнительный опыт — смотрите раздел <a href="/bonuses">Бонусы</a>.</li>
        <li>Ежедневный бонус приносит 25 XP.</li>
        <li>Каждые ${num(per)} XP — новый уровень. Всего в сезоне 100 уровней.</li>
        <li>Бесплатная ветка доступна всем. Premium открывает вторую ветку наград, в том числе за уже пройденные уровни.</li>
        <li>Награды не сгорают до конца сезона: забрать их можно в любой момент.</li></ul></div>`);
    }
  };
  on(ctx.el, 'click', '[data-tab]', (e, t) => { tab = t.dataset.tab; setQuery({ tab: tab === 'track' ? '' : tab }); load().catch(() => {}); });
  on(ctx.el, 'click', '[data-claim]', (e, t) => busy(t, async () => { const r = await api('/api/pass/claim', { rewardId: Number(t.dataset.claim) }); setBalance(r.balance); showRewards([r]); await load(); }));
  on(ctx.el, 'click', '[data-all]', (e, t) => busy(t, async () => { const r = await api('/api/pass/claim-all', {}); setBalance(r.balance); if (r.claimed) showRewards(r.rewards); else toast('Нет доступных наград', 'info'); await load(); }));
  on(ctx.el, 'click', '[data-prem]', (e, t) => busy(t, async () => {
    const r = await api('/api/pass/premium', {}); setBalance(r.balance); toast('Premium активирован — премиум-награды доступны', 'ok'); await load();
  }));
  ctx.on('pass', () => load().catch(() => {}));
  await load();
}, { title: 'BURGER PASS' });

// ---------- Бонусы и задания ----------
function questCard(q) {
  const done = q.progress >= q.goal;
  return html`<div class="quest ${q.claimed ? 'done' : ''}">
    <div><b>${q.title}</b><div class="muted sm">Награда: ${q.reward ? bc(q.reward) : ''}${q.reward && q.xp ? ' + ' : ''}${q.xp ? num(q.xp) + ' XP' : ''}</div></div>
    <div>${q.claimed ? html`<span class="badge ok">Получено</span>` : done ? html`<button class="btn sm" data-quest="${q.id}">Забрать</button>` : html`<span class="muted sm">${num(Math.min(q.progress, q.goal))} / ${num(q.goal)}</span>`}</div>
    ${progress(q.progress, q.goal, done ? 'green' : '')}
  </div>`;
}
export function promoForm() {
  return html`<form class="inline-form" data-promo><label class="fld"><span>Промокод</span><input name="code" required minlength="2" maxlength="40" placeholder="Введите промокод" autocomplete="off"></label><button class="btn">Активировать</button></form>`;
}
export function bindPromo(root, after) {
  for (const f of $$('[data-promo]', root)) bindForm(f, async (d, form) => {
    const r = await api('/api/promo', { code: String(d.code || '').trim() });
    setBalance(r.balance); toast('Промокод активирован: +' + rub(r.amount), 'ok'); form.reset(); after?.();
  });
}

page('/bonuses', async (ctx) => {
  const load = async () => {
    const d = await api('/api/bonuses');
    if (!ctx.alive()) return;
    const dl = d.daily; const ref = d.referral;
    const doneDays = dl.available ? dl.streak - 1 : dl.streak;
    const daily = d.quests.filter((q) => q.scope === 'daily');
    const weekly = d.quests.filter((q) => q.scope !== 'daily');
    const link = absUrl(ref.link);
    mount(ctx.el, html`<div class="wrap">
      ${head('Бонусы и задания', 'Забирайте ежедневный бонус, выполняйте задания и приглашайте друзей', html`<a class="btn ghost" href="/pass">BURGER PASS</a>`)}
      <div class="card">
        <div class="sec-head"><h2><span class="ic">${icon('bonuses')}</span>Ежедневный бонус</h2><span class="muted sm">Серия: ${dl.streak} из ${dl.maxStreak}</span></div>
        <div class="daily">${dl.schedule.map((a, i) => html`<div class="day ${i < doneDays ? 'done' : ''} ${dl.available && i === dl.streak - 1 ? 'today' : ''}">День ${i + 1}<b>${bc(a)}</b></div>`)}</div>
        <div class="row between mt" style="flex-wrap:wrap;gap:10px"><span class="muted sm">Заходите каждый день — сумма растёт. Пропуск дня сбрасывает серию.</span>
          ${dl.available ? html`<button class="btn" data-daily>Забрать ${bc(dl.amount)}</button>` : html`<span class="badge ok">Сегодня получено · следующий бонус завтра</span>`}</div>
      </div>
      <div class="grid g2 mt-l">
        <div class="card"><div class="sec-head"><h2><span class="ic">${icon('sun')}</span>Ежедневные задания</h2></div><div class="stack">${daily.length ? daily.map(questCard) : empty('Сегодня заданий нет.')}</div></div>
        <div class="card"><div class="sec-head"><h2><span class="ic">${icon('calendar')}</span>Еженедельные задания</h2></div><div class="stack">${weekly.length ? weekly.map(questCard) : empty('На этой неделе заданий нет.')}</div></div>
      </div>
      <div class="grid g2 mt-l">
        <div class="card"><div class="sec-head"><h2><span class="ic">${icon('friends')}</span>Пригласите друга</h2></div>
          <p class="muted">Друг получит ${bc(ref.inviteeBonus)} при регистрации по вашей ссылке, а вы — ${bc(ref.inviterBonus)}, когда его оборот достигнет ${num(ref.threshold)} ₽.</p>
          <div class="ref-box"><input readonly value="${link}" data-ref><button class="btn ghost" data-copy>Копировать</button></div>
          <div class="stats mt">${stat('Приглашено', num(ref.invited))}${stat('Активных', num(ref.active || 0))}${stat('Заработано', bc(ref.earned), { cls: 'hl' })}</div>
        </div>
        <div class="card"><div class="sec-head"><h2><span class="ic">${icon('tag')}</span>Промокод</h2><a href="/promo">История</a></div>${promoForm()}
          <div class="chips mt"><a class="chip" href="/achievements">${icon('medal')} Достижения</a><a class="chip" href="/collections">${icon('collections')} Коллекции</a><a class="chip" href="/events">${icon('events')} События и марафоны</a><a class="chip" href="/tournaments">${icon('trophy')} Турниры</a><a class="chip" href="/leaderboard">${icon('chart')} Рейтинг</a></div>
        </div>
      </div>
      <div class="card mt-l"><div class="sec-head"><h2><span class="ic">${icon('history')}</span>История наград</h2></div>
        ${d.history.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Дата</th><th>Тип</th><th>Описание</th><th class="r">Сумма</th></tr></thead><tbody>${d.history.map((h) => html`<tr><td class="muted nowrap">${fdate(h.created_at)}</td><td>${LEDGER[h.type] || h.type}</td><td>${h.reason || ''}</td><td class="r">${bc(h.amount, 'green')}</td></tr>`)}</tbody></table></div>` : empty('Наград пока не было — начните с ежедневного бонуса.')}
      </div>
    </div>`);
    bindPromo(ctx.el, () => load().catch(() => {}));
  };
  on(ctx.el, 'click', '[data-daily]', (e, t) => busy(t, async () => { const r = await api('/api/bonuses/daily', {}); setBalance(r.balance); toast('Бонус дня ' + r.streak + ': +' + rub(r.amount), 'ok'); await load(); }));
  on(ctx.el, 'click', '[data-quest]', (e, t) => busy(t, async () => { const r = await api(`/api/quests/${t.dataset.quest}/claim`, {}); setBalance(r.balance); toast('Задание выполнено: награда получена', 'ok'); await load(); }));
  on(ctx.el, 'click', '[data-copy]', () => copy($('[data-ref]', ctx.el).value));
  await load();
}, { auth: true, title: 'Бонусы' });

page('/promo', async (ctx) => {
  const load = async () => {
    const h = await api('/api/promo/history');
    if (!ctx.alive()) return;
    mount(ctx.el, html`<div class="wrap narrow">${head('Промокоды', 'Промокоды публикуются в новостях, соцсетях и на событиях BURGER SKIN')}
      <div class="card">${promoForm()}</div>
      <div class="card mt-l"><div class="sec-head"><h2>Активированные промокоды</h2></div>
      ${h.rows.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Код</th><th>Дата</th><th class="r">Сумма</th></tr></thead><tbody>${h.rows.map((r) => html`<tr><td class="mono">${r.code}</td><td class="muted">${fdate(r.created_at)}</td><td class="r">${bc(r.amount, 'green')}</td></tr>`)}</tbody></table></div>` : empty('Вы ещё не активировали промокоды.')}</div></div>`);
    bindPromo(ctx.el, () => load().catch(() => {}));
  };
  await load();
}, { auth: true, title: 'Промокоды' });

// ---------- Достижения и коллекции ----------
page('/achievements', async (ctx) => {
  const d = await api('/api/achievements');
  const got = d.achievements.filter((a) => a.unlockedAt).length;
  mount(ctx.el, html`<div class="wrap">${head('Достижения', `Открыто ${got} из ${d.achievements.length}`, html`<a class="btn ghost" href="/collections">Коллекции</a>`)}
    ${!state.me ? notice(html`<a href="/login?next=/achievements">Войдите</a>, чтобы отслеживать прогресс достижений.`) : ''}
    <div class="grid g3">${d.achievements.map((a) => html`<div class="ach ${a.unlockedAt ? 'got' : ''}"><div class="ai">${icon(a.icon || 'medal')}</div><div class="grow">
      <b>${a.title}</b><div class="muted sm">${a.description || ''}</div>
      ${progress(a.progress, a.goal, a.unlockedAt ? 'green' : '')}
      <div class="row between sm mt"><span class="muted">${num(a.progress)} / ${num(a.goal)}</span><span>${a.unlockedAt ? html`<span class="badge ok">Открыто ${fday(a.unlockedAt)}</span>` : a.reward ? html`Награда ${bc(a.reward)}` : ''}</span></div>
    </div></div>`)}</div></div>`);
}, { title: 'Достижения' });

page('/collections', async (ctx) => {
  const d = await api('/api/collections');
  mount(ctx.el, html`<div class="wrap">${head('Коллекции', 'Собирайте предметы из одной коллекции CS2')}
    ${d.collections.length ? html`<div class="grid g3">${d.collections.map((c) => html`<a class="card" href="/collections/${encodeURIComponent(c.name)}">
      <div class="row between"><b>${c.name}</b><span class="badge ${c.owned >= c.total ? 'ok' : ''}">${c.owned} / ${c.total}</span></div>
      <div class="row gap mt" style="justify-content:space-around">${c.preview.map((i) => html`<div style="width:22%">${img(i.image, '', i.name)}</div>`)}</div>
      ${progress(c.owned, c.total, 'mt')}</a>`)}</div>` : empty('Коллекции появятся после импорта каталога предметов.')}</div>`);
}, { title: 'Коллекции' });

page('/collections/:name', async (ctx) => {
  const d = await api('/api/collections/' + encodeURIComponent(ctx.params.name));
  const owned = d.items.filter((i) => i.owned).length;
  mount(ctx.el, html`<div class="wrap">${head(d.name, `Собрано ${owned} из ${d.items.length} предметов`, html`<a class="btn ghost" href="/collections">Все коллекции</a>`)}
    ${progress(owned, d.items.length, 'mb')}
    <div class="grid g-items mt">${d.items.map((i) => itemCard(i, { href: '/skins/' + i.id, cls: i.owned ? '' : 'dim', extra: i.owned ? html`<span class="badge ok">Есть</span>` : '' }))}</div></div>`);
}, { title: 'Коллекция' });

// ---------- События, марафоны, турниры ----------
const evVal = (e, v) => (e.metric === 'wager' || e.metric === 'best' ? num(v) + ' ₽' : num(v));
function boardRows(board, e) {
  if (!board?.length) return empty('Пока никто не набрал очков — станьте первым!');
  return html`<div>${board.map((r) => html`<div class="lb-row"><span class="place ${r.place <= 3 ? 'p' + r.place : ''}">${r.place}</span><span class="grow">${userLink(r.user)}</span><b>${evVal(e, r.value)}</b>${e.prizes?.[r.place - 1] ? html`<span class="badge warn">${bc(e.prizes[r.place - 1])}</span>` : ''}</div>`)}</div>`;
}
function evStatus(e) {
  if (e.status === 'finished' || (e.endsAt && e.endsAt < Date.now())) return html`<span class="badge">Завершено</span>`;
  if (e.startsAt && e.startsAt > Date.now()) return html`<span class="badge info">Начнётся через ${left(e.startsAt)}</span>`;
  return html`<span class="badge ok">Идёт${e.endsAt ? ' · ещё ' + left(e.endsAt) : ''}</span>`;
}
function eventCard(e, full = false) {
  const base = e.kind === 'tournament' ? '/tournaments/' : '/events/';
  const canClaim = state.me && e.kind !== 'tournament' && e.status === 'active' && !e.claimed && e.goal && e.progress >= e.goal && !(e.startsAt && e.startsAt > Date.now());
  return html`<div class="card">
    <div class="row between" style="flex-wrap:wrap;gap:8px"><span class="badge warn">${EVENT_KIND[e.kind] || e.kind}</span>${evStatus(e)}</div>
    <h3 class="mt">${full ? e.title : html`<a href="${base}${e.id}">${e.title}</a>`}</h3>
    ${e.description ? html`<p class="muted">${e.description}</p>` : ''}
    <div class="kv"><span>Условие</span><span>${e.metricName}${e.goal ? ': ' + evVal(e, e.goal) : ''}</span>
      ${e.startsAt ? html`<span>Начало</span><span>${fdate(e.startsAt)}</span>` : ''}${e.endsAt ? html`<span>Окончание</span><span>${fdate(e.endsAt)}</span>` : ''}
      ${e.kind === 'tournament' ? html`<span>Призовой фонд</span><span>${bc((e.prizes || []).reduce((s, x) => s + x, 0))}</span>` : html`<span>Награда</span><span>${bc(e.reward)}</span>`}</div>
    ${state.me && e.kind !== 'tournament' && e.goal ? html`<div class="mt">${progress(e.progress, e.goal, e.progress >= e.goal ? 'green' : '')}<div class="row between sm mt"><span class="muted">Ваш прогресс</span><span>${evVal(e, Math.min(e.progress, e.goal))} / ${evVal(e, e.goal)}</span></div></div>` : ''}
    ${state.me && e.kind === 'tournament' ? html`<p class="sm mt">Ваш результат: <b>${evVal(e, e.progress)}</b></p>` : ''}
    ${e.kind === 'tournament' && e.prizes?.length ? html`<div class="chips mt">${e.prizes.map((p, i) => html`<span class="chip">${i + 1} место · ${bc(p)}</span>`)}</div>` : ''}
    ${e.kind === 'tournament' && !full && e.board?.length ? html`<div class="mt">${boardRows(e.board.slice(0, 5), e)}</div>` : ''}
    <div class="row gap mt">${e.claimed ? html`<span class="badge ok">Награда получена${e.claimed.place ? ' · ' + e.claimed.place + ' место' : ''}</span>` : ''}${canClaim ? html`<button class="btn" data-evclaim="${e.id}">Забрать ${bc(e.reward)}</button>` : ''}${!full ? html`<a class="btn ghost sm" href="${base}${e.id}">Подробнее</a>` : ''}</div>
  </div>`;
}
function eventsPage(kindFilter, title, sub) {
  return async (ctx) => {
    let tab = ctx.q.get('tab') || 'all';
    const load = async () => {
      const d = await api('/api/events' + (kindFilter === 'tournament' ? '?kind=tournament' : ''));
      if (!ctx.alive()) return;
      let list = d.events.filter((e) => (kindFilter === 'tournament' ? e.kind === 'tournament' : e.kind !== 'tournament'));
      if (kindFilter !== 'tournament' && tab !== 'all') list = list.filter((e) => e.kind === tab);
      mount(ctx.el, html`<div class="wrap">${head(title, sub, html`<a class="btn ghost" href="${kindFilter === 'tournament' ? '/events' : '/tournaments'}">${kindFilter === 'tournament' ? 'События и марафоны' : 'Турниры'}</a>`)}
        ${kindFilter !== 'tournament' ? tabs([['all', 'Все'], ['event', 'События'], ['marathon', 'Марафоны']], tab) : ''}
        <div class="grid g2 mt">${list.length ? list.map((e) => eventCard(e)) : ''}</div>
        ${list.length ? '' : empty(kindFilter === 'tournament' ? 'Сейчас турниров нет. Новые турниры анонсируются в новостях.' : 'Сейчас нет активных событий. Загляните позже!', html`<a class="btn ghost" href="/news">Новости и акции</a>`)}
      </div>`);
    };
    on(ctx.el, 'click', '[data-tab]', (e, t) => { tab = t.dataset.tab; setQuery({ tab: tab === 'all' ? '' : tab }); load().catch(() => {}); });
    on(ctx.el, 'click', '[data-evclaim]', (e, t) => busy(t, async () => { const r = await api(`/api/events/${t.dataset.evclaim}/claim`, {}); setBalance(r.balance); toast('Награда события получена', 'ok'); await load(); }));
    await load();
  };
}
page('/events', eventsPage('event', 'События и марафоны', 'Выполняйте условия и забирайте награды'), { title: 'События' });
page('/tournaments', eventsPage('tournament', 'Турниры', 'Соревнуйтесь с игроками за призовой фонд'), { title: 'Турниры' });
async function eventDetail(ctx) {
  const load = async () => {
    const { event: e } = await api('/api/events/' + encodeURIComponent(ctx.params.id));
    if (!ctx.alive()) return;
    mount(ctx.el, html`<div class="wrap">${head(e.title, EVENT_KIND[e.kind] || '', html`<a class="btn ghost" href="${e.kind === 'tournament' ? '/tournaments' : '/events'}">Назад</a>`)}
      <div class="split"><div>${eventCard(e, true)}</div>
      <div class="card"><div class="sec-head"><h2>Таблица лидеров</h2></div>${boardRows(e.board, e)}</div></div></div>`);
  };
  on(ctx.el, 'click', '[data-evclaim]', (ev, t) => busy(t, async () => { const r = await api(`/api/events/${t.dataset.evclaim}/claim`, {}); setBalance(r.balance); toast('Награда события получена', 'ok'); await load(); }));
  await load();
}
page('/events/:id', eventDetail, { title: 'Событие' });
page('/tournaments/:id', eventDetail, { title: 'Турнир' });

// ---------- Рейтинг ----------
page('/leaderboard', async (ctx) => {
  let period = ctx.q.get('period') || 'week';
  let by = ctx.q.get('by') || 'wager';
  const BY = [['wager', 'Оборот'], ['won', 'Выигрыш'], ['opens', 'Открытия'], ['best', 'Лучший дроп']];
  const PER = [['day', 'День'], ['week', 'Неделя'], ['month', 'Месяц'], ['all', 'Всё время']];
  const fmt = (v) => (by === 'opens' ? num(v) : bc(v));
  const load = async () => {
    const d = await api('/api/leaderboard?period=' + period + '&by=' + by);
    if (!ctx.alive()) return;
    const top3 = d.list.slice(0, 3);
    mount(ctx.el, html`<div class="wrap">${head('Рейтинг игроков', 'Лучшие игроки BURGER SKIN')}
      <div class="filters"><div class="seg">${PER.map(([k, l]) => html`<button class="${k === period ? 'on' : ''}" data-period="${k}">${l}</button>`)}</div>
      <div class="seg">${BY.map(([k, l]) => html`<button class="${k === by ? 'on' : ''}" data-by="${k}">${l}</button>`)}</div></div>
      ${d.me ? notice(html`Ваше место: <b>${d.me.place}</b> · ${fmt(d.me.value)}`, 'ok') : state.me ? notice('Сыграйте, чтобы попасть в рейтинг этого периода.') : ''}
      ${top3.length ? html`<div class="grid g3 mt">${top3.map((r) => html`<div class="card center"><span class="place p${r.place}" style="margin:0 auto 10px">${r.place}</span>${userLink(r.user)}<div class="mt"><b>${fmt(r.value)}</b></div><small class="muted">${num(r.bets)} ставок</small></div>`)}</div>` : ''}
      <div class="card mt-l">${d.list.length ? d.list.map((r) => html`<div class="lb-row" ${d.me && r.user?.id === d.me.user?.id ? raw('style="background:rgba(255,182,39,.06)"') : ''}><span class="place ${r.place <= 3 ? 'p' + r.place : ''}">${r.place}</span><span class="grow">${userLink(r.user)}</span><span class="muted sm">${num(r.bets)} ставок</span><b>${fmt(r.value)}</b></div>`) : empty('За этот период ещё нет результатов.')}</div>
    </div>`);
  };
  on(ctx.el, 'click', '[data-period]', (e, t) => { period = t.dataset.period; setQuery({ period }); load().catch(() => {}); });
  on(ctx.el, 'click', '[data-by]', (e, t) => { by = t.dataset.by; setQuery({ by }); load().catch(() => {}); });
  await load();
}, { title: 'Рейтинг' });

export { ago };
