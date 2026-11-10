// Главная, кейсы, скины, инвентарь, апгрейд, контракты.
import { state, html, raw, mount, $, $$, api, money, num, bc, pct, fdate, ago, WEARS, rarityRu, INV_STATUS, splitName, img, itemCard, caseCard, avatar, userLink, empty, loader, pager, head, tabs, notice, fairBadge, toast, fail, modal, confirmBox, busy, page, go, setQuery, reelHtml, spinReel, cssColor, on, sleep, qs, rub, coverHtml, holdFeed } from '../core.js';
import { sfx, dropSound, trackStrip } from '../sound.js';
import { icon } from '../icons.js';
import { MODES, cineOn, cineMode, setCineMode, shareOn, bestFx, loadCine } from '../cine-mode.js';
import { GAME_INFO, gameTile, dropRow, betsTable, newsCard, EVENT_KIND, catRu, stat, progress, featureOff } from './shared.js';
const sellApi = async (b) => { const r = await api('/api/inventory/sell', b); sfx('sell'); return r; };

const debounce = (fn, ms = 300) => { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ================= ГЛАВНАЯ =================
page('/', async (ctx) => {
  const d = await api('/api/home');
  const b = d.banner || {};
  const title = String(b.title || 'Сочные кейсы CS2').trim();
  const words = title.split(/\s+/); const last = words.length > 1 ? words.pop() : '';
  const s = d.stats || {};
  const games = (d.games || []).filter((g) => GAME_INFO[g.key]);
  const daily = d.daily || { base: 0, step: 0, max_streak: 7 };
  mount(ctx.el, html`<div class="wrap">
    <section class="hero">
      <div>
        <span class="badge warn">${d.site?.name || 'BURGER SKIN'}</span>
        <h1 style="margin-top:14px">${words.join(' ')} ${last ? html`<em>${last}</em>` : ''}</h1>
        <p>${b.subtitle || 'Открывайте кейсы с настоящими скинами CS2, улучшайте дроп и сражайтесь в битвах кейсов. Каждый результат проверяется через Provably Fair.'}</p>
        <div class="row gap"><a class="btn lg" href="/cases">Открыть кейсы</a><a class="btn ghost lg" href="/battles">${icon('battles')} Битвы кейсов</a></div>
        <div class="hero-stats"><div><b>${num(s.cases)}</b><span>кейсов</span></div><div><b>${num(s.items)}</b><span>скинов</span></div><div><b>${num(s.opens)}</b><span>открытий</span></div><div><b>${num(s.users)}</b><span>игроков</span></div></div>
      </div>
      <div class="hero-art">${img(b.image || '/img/items/Kilowatt-ak.png', '', title)}</div>
    </section>
    <div class="quick">
      <a href="/cases"><span>${icon('cases')}</span>Кейсы</a><a href="/battles"><span>${icon('battles')}</span>Битвы</a><a href="/upgrade"><span>${icon('upgrade')}</span>Апгрейд</a>
      <a href="/contracts"><span>${icon('contracts')}</span>Контракты</a><a href="/games"><span>${icon('games')}</span>Игры</a><a href="/pass"><span>${icon('pass')}</span>BURGER PASS</a>
    </div>

    <section class="sec"><div class="sec-head"><h2><span class="ic">${icon('flame')}</span>Популярные кейсы</h2><a href="/cases?category=popular">Все кейсы →</a></div>
      ${d.popular?.length ? html`<div class="grid g-cases">${d.popular.map(caseCard)}</div>` : empty('Кейсы скоро появятся.')}</section>

    <section class="sec"><div class="sec-head"><h2><span class="ic">${icon('sparkles')}</span>Новые кейсы</h2><a href="/cases?category=new&sort=new">Смотреть →</a></div>
      <div class="grid g-cases">${(d.fresh || []).slice(0, 10).map(caseCard)}</div></section>

    <section class="sec"><div class="sec-head"><h2><span class="ic">${icon('games')}</span>Игры</h2><a href="/games">Все игры →</a></div>
      <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(210px,1fr))">${games.map((g) => gameTile(g.key, g.enabled))}</div></section>

    <section class="sec"><div class="sec-head"><h2><span class="ic">${icon('gem')}</span>Лучшие и редкие скины</h2><a href="/skins">Каталог скинов →</a></div>
      <div class="grid g-items">${(d.rare || []).map((it) => itemCard(it, { href: '/skins/' + it.id }))}</div></section>

    <section class="sec grid g2">
      <div class="card"><div class="card-head"><h3>${icon('live')} Последние открытия</h3><span class="badge ok">Live</span></div>
        <div class="stack" data-feed style="--x:0">${(d.feed || []).slice(0, 8).map(dropRow)}</div>${d.feed?.length ? '' : empty('Будьте первым, кто откроет кейс сегодня!')}</div>
      <div class="card"><div class="card-head"><h3>${icon('trophy')} Крупные выигрыши</h3><a class="sm" href="/leaderboard?by=best">Рейтинг →</a></div>
        <div class="stack">${(d.big || []).slice(0, 8).map(dropRow)}</div>${d.big?.length ? '' : empty('Здесь появятся самые дорогие дропы.')}</div>
    </section>

    <section class="sec grid g3">
      <div class="card hl"><div class="card-head"><h3>${icon('bonuses')} Ежедневный бонус</h3></div>
        <p class="muted sm">Заходите каждый день: награда растёт с серией до ${daily.max_streak} дней.</p>
        <div class="daily" style="grid-template-columns:repeat(${Math.min(7, daily.max_streak || 7)},1fr)">${Array.from({ length: Math.min(7, daily.max_streak || 7) }, (_, i) => html`<div class="day">День ${i + 1}<b>${money(daily.base + daily.step * i)}</b></div>`)}</div>
        <a class="btn block mt" href="/bonuses">${state.me ? 'Забрать бонус' : 'Войти и забрать'}</a></div>
      <div class="card"><div class="card-head"><h3>${icon('target')} Задания дня</h3><a class="sm" href="/bonuses">Все →</a></div>
        <div class="stack">${(d.quests || []).map((q) => html`<div><div class="row between sm"><span>${q.title}</span><span class="bc">${money(q.reward)}</span></div><div class="row between xs dim" style="margin:4px 0"><span>${num(Math.min(q.progress, q.goal))} / ${num(q.goal)}</span><span>+${q.xp} XP</span></div>${progress(q.progress, q.goal, 'green')}</div>`)}</div>
        ${d.quests?.length ? '' : empty('Задания появятся в новом сезоне.')}</div>
      <div class="card"><div class="card-head"><h3>${icon('chart')} Топ игроков недели</h3><a class="sm" href="/leaderboard">Рейтинг →</a></div>
        ${(d.top || []).length ? (d.top || []).map((t, i) => html`<div class="lb-row"><span class="place ${i < 3 ? 'p' + (i + 1) : ''}">${i + 1}</span><div class="grow">${userLink(t.user)}</div>${bc(t.wagered)}</div>`) : empty('Рейтинг формируется — ваше имя может быть первым.')}</div>
    </section>

    ${d.events?.length ? html`<section class="sec"><div class="sec-head"><h2><span class="ic">${icon('events')}</span>События и турниры</h2><a href="/events">Все события →</a></div>
      <div class="grid g-cards">${d.events.map((e) => html`<a class="card" href="/${e.kind === 'tournament' ? 'tournaments' : 'events'}/${e.id}" style="color:inherit"><span class="badge vio">${EVENT_KIND[e.kind] || 'Событие'}</span><h3 style="margin:10px 0 6px">${e.title}</h3><p class="muted sm">${String(e.description || '').slice(0, 120)}</p><div class="row between sm"><span>Награда: ${bc(e.reward)}</span>${e.ends_at ? html`<span class="muted">ещё ${new Date(e.ends_at) > new Date() ? '' : ''}${Math.max(0, Math.ceil((e.ends_at - Date.now()) / 86400000))} дн.</span>` : ''}</div></a>`)}</div></section>` : ''}

    <section class="sec"><div class="sec-head"><h2><span class="ic">${icon('percent')}</span>Дешёвые кейсы</h2><a href="/cases?sort=price_asc">Смотреть →</a></div>
      <div class="grid g-cases">${(d.cheap || []).map(caseCard)}</div></section>

    ${d.news?.length ? html`<section class="sec"><div class="sec-head"><h2><span class="ic">${icon('news')}</span>Новости и акции</h2><a href="/news">Все новости →</a></div><div class="grid g-cards">${d.news.map(newsCard)}</div></section>` : ''}
  </div>`);
  ctx.on('drop', (x) => { const box = $('[data-feed]', ctx.el); if (!box || !x?.item) return; const t = document.createElement('div'); mount(t, dropRow(x)); box.prepend(t.firstElementChild); while (box.children.length > 8) box.lastElementChild.remove(); });
}, { title: 'Кейсы CS2' });

// ================= КАТАЛОГ КЕЙСОВ =================
page('/cases', async (ctx) => {
  const st = { q: ctx.q.get('q') || '', category: ctx.q.get('category') || 'all', sort: ctx.q.get('sort') || '', min: ctx.q.get('min') || '', max: ctx.q.get('max') || '', item: ctx.q.get('item') || '' };
  mount(ctx.el, html`<div class="wrap">${head('Кейсы CS2', 'Выбирайте кейс, смотрите содержимое и шансы до открытия.', html`<a class="btn ghost" href="/battles/new">${icon('battles')} Создать битву</a>`)}
    <div class="filters">
      <label class="search"><input name="q" placeholder="Поиск кейса" value="${st.q}" aria-label="Поиск кейса"></label>
      <label class="search" style="flex:1 1 200px"><input name="item" placeholder="Кейсы со скином…" value="${st.item}" aria-label="Поиск по скину"></label>
      <select name="sort" aria-label="Сортировка">${[['', 'По популярности'], ['new', 'Сначала новые'], ['price_asc', 'Сначала дешёвые'], ['price_desc', 'Сначала дорогие'], ['rtp', 'Лучшая отдача'], ['name', 'По названию']].map(([k, l]) => html`<option value="${k}" ${st.sort === k ? raw('selected') : ''}>${l}</option>`)}</select>
      <input name="min" type="number" min="0" step="1" placeholder="Цена от" value="${st.min}" style="width:120px" aria-label="Цена от">
      <input name="max" type="number" min="0" step="1" placeholder="до" value="${st.max}" style="width:110px" aria-label="Цена до">
    </div>
    <div class="chips scroll mb" data-chips></div>
    <div data-list>${loader()}</div></div>`);
  let first = true;
  const load = async () => {
    setQuery({ ...st, category: st.category === 'all' ? '' : st.category });
    const r = await api('/api/cases' + qs({ ...st, category: st.category === 'all' ? '' : st.category }));
    if (!ctx.alive()) return;
    const cats = { all: 'Все', ...r.categories };
    mount($('[data-chips]', ctx.el), html`${Object.entries(cats).filter(([k]) => k === 'all' || k === 'popular' || k === 'new' || r.counts[k]).map(([k, l]) => html`<button class="chip ${st.category === k ? 'on' : ''}" data-cat="${k}">${l}${r.counts[k] ? html`<span class="n">${r.counts[k]}</span>` : ''}</button>`)}`);
    mount($('[data-list]', ctx.el), r.cases.length ? html`<p class="muted sm">Найдено кейсов: ${r.cases.length}</p><div class="grid g-cases">${r.cases.map(caseCard)}</div>` : empty('По вашему запросу ничего не найдено.', html`<button class="btn ghost" data-reset>Сбросить фильтры</button>`));
    first = false;
  };
  const later = debounce(() => load().catch(fail));
  ctx.el.addEventListener('input', (e) => { const n = e.target.name; if (n in st) { st[n] = e.target.value.trim(); later(); } });
  on(ctx.el, 'click', '[data-cat]', (e, b) => { st.category = b.dataset.cat; if (st.category === 'new' && !st.sort) st.sort = 'new'; load().catch(fail); });
  on(ctx.el, 'click', '[data-reset]', () => { Object.assign(st, { q: '', category: 'all', sort: '', min: '', max: '', item: '' }); for (const el of $$('.filters input, .filters select', ctx.el)) el.value = ''; load().catch(fail); });
  await load();
}, { title: 'Кейсы' });

// ================= СТРАНИЦА КЕЙСА И ОТКРЫТИЕ =================
function wearsModal(it) {
  modal(html`<h3>${it.name}</h3><div class="row gap mb"><span class="badge" style="color:${cssColor(it.color)}">${rarityRu(it.rarityName)}</span>${it.stattrak ? html`<span class="tag st">StatTrak™ возможен</span>` : ''}</div>
    <div class="item-img" style="max-width:280px;margin:0 auto 12px">${img(it.image, '', it.name)}</div>
    <p class="muted sm">Шанс предмета в кейсе: <b>${pct(it.chance)}</b>. Качество определяется float-значением при выпадении.</p>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Качество</th><th class="r">Шанс</th><th class="r">Цена</th></tr></thead><tbody>${(it.wears || []).map((w) => html`<tr><td>${w.wear ? WEARS[w.wear] + ' (' + w.wear + ')' : 'Без качества'}</td><td class="r">${pct(w.p * it.chance)}</td><td class="r">${bc(w.price)}</td></tr>`)}</tbody></table></div>
    <div class="row end mt"><a class="btn ghost" href="/skins/${it.id}" data-close>Карточка скина</a></div>`);
}
// ---------- кинодроп до выпадения ----------
const VEIL = { godlike: '255,182,39', mythic: '150,80,255', divine: '255,232,176', knife: '205,222,245', glove: '122,199,79' };
/** Лента «ломается» в цвет уровня и размывается: выпавший предмет до сцены не видно. */
function veil(stage, scene) { if (!stage) return; stage.style.setProperty('--veil', VEIL[scene] || VEIL.godlike); stage.classList.add('cine-veil'); }
function unveil(stage) { stage?.classList.remove('cine-veil'); }
/** Срабатывает, когда выпавший предмет почти въехал в окно любой из лент (запас — две карточки). */
function nearWinner(reels, win = 50) {
  return new Promise((res) => {
    const t0 = performance.now();
    const loop = () => {
      for (const el of reels) {
        const tr = $('.reel-track', el); const it = tr?.children[win]; if (!it || !el.isConnected) continue;
        const x = new DOMMatrixReadOnly(getComputedStyle(tr).transform).m41;
        if (it.offsetLeft + x < el.clientWidth + it.offsetWidth * 2) return res();
      }
      if (performance.now() - t0 < 12000) requestAnimationFrame(loop); else res();
    };
    requestAnimationFrame(loop);
  });
}
/** Мгновенно докручивает ленты до итоговой позиции (за закрытой сценой), чтобы после неё сразу был виден результат. */
function finishReels(reels, win = 50) {
  for (const el of reels) { const tr = $('.reel-track', el); if (!tr) continue; tr.style.transition = 'none'; void tr.offsetWidth; tr.children[win]?.classList.add('hit'); el.classList.add('done'); }
}

async function casePage(ctx) {
  const slug = ctx.params.slug;
  const d = await api('/api/cases/' + encodeURIComponent(slug));
  const c = d.case; const items = c.items || [];
  document.title = c.name + ' — ' + (state.site?.site?.name || 'BURGER SKIN');
  let count = Math.min(10, Math.max(1, Number(ctx.q.get('n')) || 1));
  let fast = localStorage.getItem('bs_fast') === '1';
  const rar = {}; for (const it of items) { const k = it.rarityName || '—'; rar[k] = rar[k] || { color: it.color, chance: 0, n: 0 }; rar[k].chance += it.chance; rar[k].n++; }
  const isPub = c.status === 'published';
  const price = () => c.price * count;
  const openBtn = () => state.me ? html`<button class="btn lg" data-open ${isPub ? '' : raw('disabled')}>Открыть за ${rub(price())}</button>` : html`<a class="btn lg" href="/login?next=${encodeURIComponent(location.pathname)}">Войти, чтобы открыть</a>`;
  const idle = () => (items.length ? reelHtml(items, items[0], 40, 20) : '');
  mount(ctx.el, html`<div class="wrap">
    ${d.preview || !isPub ? notice('Предпросмотр для сотрудников: кейс не опубликован и не виден игрокам.', 'warn') : ''}
    <div class="row gap sm mb"><a href="/cases">← Все кейсы</a></div>
    <section class="case-hero" style="--ac:${cssColor(c.accent, '#FFB627')}">
      <div class="ci">${coverHtml(c, 'lg')}</div>
      <div>
        <div class="chips mb">${(c.categories || []).slice(0, 5).map((k) => html`<a class="chip" href="/cases?category=${k}">${k}</a>`)}</div>
        <h1>${c.name}</h1>
        ${c.description ? html`<p class="muted">${c.description}</p>` : ''}
        <div class="row gap-l"><div><div class="xs dim">ЦЕНА</div><div class="lg">${bc(c.price)}</div></div><div><div class="xs dim">ПРЕДМЕТОВ</div><b class="lg">${items.length}</b></div><div><div class="xs dim">ОТКРЫТИЙ</div><b class="lg">${num(c.opens)}</b></div></div>
        <div class="open-bar">
          <div class="seg" data-count>${[1, 2, 3, 4, 5, 10].map((n) => html`<button data-n="${n}" class="${n === count ? 'on' : ''}">×${n}</button>`)}</div>
          <span data-openbtn>${openBtn()}</span>
          <label class="check sm"><input type="checkbox" data-fast ${fast ? raw('checked') : ''}><span>Быстрая анимация</span></label>
          ${cineOn() ? html`<label class="cine-mode-sel" title="Кинематографичные сцены для редких и дорогих дропов">Кинодропы <select data-cine-mode aria-label="Кинодропы">${MODES.map(([k, l]) => html`<option value="${k}" ${cineMode() === k ? raw('selected') : ''}>${l}</option>`)}</select></label>` : ''}
        </div>
      </div>
    </section>
    <div class="stage" data-stage>${idle()}</div>
    <div data-result></div>
    <section class="sec"><div class="sec-head"><h2>Содержимое и шансы</h2><a class="sm" href="/fair">Как рассчитывается результат →</a></div>
      <div class="rar-legend">${Object.entries(rar).map(([k, r]) => html`<span style="--rc:${cssColor(r.color)}"><i></i>${rarityRu(k)} · ${pct(r.chance)}</span>`)}</div>
      <div class="grid g-items chance-list">${items.map((it, i) => itemCard(it, { id: i, chance: it.chance }))}</div>
    </section>
    ${d.recent?.length ? html`<section class="sec"><div class="sec-head"><h2>Последние дропы из этого кейса</h2></div><div class="grid g2">${d.recent.slice(0, 10).map((x) => dropRow({ ...x, caseName: c.name }))}</div></section>` : ''}
  </div>`);
  const setCount = (n) => { count = n; for (const b of $$('[data-count] button', ctx.el)) b.classList.toggle('on', Number(b.dataset.n) === n); mount($('[data-openbtn]', ctx.el), openBtn()); const again = $('[data-again]', ctx.el); if (again) again.textContent = 'Открыть ещё за ' + money(price()); };
  on(ctx.el, 'click', '[data-count] button', (e, b) => setCount(Number(b.dataset.n)));
  on(ctx.el, 'change', '[data-fast]', (e, b) => { fast = b.checked; localStorage.setItem('bs_fast', fast ? '1' : '0'); });
  on(ctx.el, 'change', '[data-cine-mode]', (e, b) => { setCineMode(b.value); if (b.value !== 'off') loadCine().then((m) => m.ensureCss()).catch(() => {}); });
  on(ctx.el, 'click', '.chance-list .item', (e, el) => wearsModal(items[Number(el.dataset.id)]));
  let spinning = false; let lastFx = null;
  const open = (btn) => busy(btn, async () => {
    if (spinning) return; spinning = true; sfx('click');
    holdFeed(true); // свой дроп появится в ленте Live только после того, как игрок его увидит
    const stage = $('[data-stage]', ctx.el);
    try {
      const r = await api(`/api/cases/${encodeURIComponent(slug)}/open`, { count });
      const drops = r.drops || [];
      // Предмет и уровень дропа (fx) сервер уже определил и выдал до анимации: сцена только решает, КОГДА его показать.
      const cine = cineOn() && cineMode() !== 'off' ? bestFx(drops) : null;
      const cineMod = cine ? loadCine().then((m) => { m.ensureCss(); return m; }).catch(() => null) : null;
      mount($('[data-result]', ctx.el), ''); unveil(stage);
      const sm = drops.length > 1;
      mount(stage, html`${drops.map((x) => reelHtml(items, x.inv, 60, 50, sm ? 'sm' : ''))}`);
      stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await sleep(60);
      const reels = $$('.reel', stage); const dur0 = fast ? 2000 : 6000;
      sfx('start');
      const tr0 = reels[0] && $('.reel-track', reels[0]);
      const stopTicks = tr0 && tr0.children.length > 1 ? trackStrip(tr0, tr0.children[1].offsetLeft - tr0.children[0].offsetLeft, { duration: dur0 }) : () => {};
      const spun = Promise.all(reels.map((el, i) => spinReel(el, { duration: dur0 + i * (fast ? 80 : 220) })));
      const best = drops.reduce((a, x) => (!a || (x.inv.price || 0) > (a.inv.price || 0) ? x : a), null);
      if (cine) {
        // КИНОДРОП ДО ВЫПАДЕНИЯ: лента разгоняется, но прерывается сценой раньше, чем выпавший предмет
        // въедет в окно рулетки. Скин игрок впервые видит только в момент раскрытия внутри сцены.
        await Promise.race([sleep(fast ? 450 : 1400), nearWinner(reels)]);
        if (!ctx.alive()) return;
        veil(stage, cine.fx.scene); // лента «ломается» и размывается — предмет не разглядеть
        const m = await cineMod;
        if (!ctx.alive()) return;
        if (m) {
          stopTicks();
          await sleep(fast ? 160 : 380); // короткий «заряд» перед сценой
          if (!ctx.alive()) return;
          let ok = true;
          await m.playDrop({ item: cine.inv, fx: cine.fx, share: cine.share, others: drops.length - 1, caseName: c.name }).catch(() => { ok = false; });
          if (!ctx.alive()) return;
          finishReels(reels); unveil(stage);
          showResult(drops);
          if (!ok && best) dropSound(best.inv);
          return;
        }
        unveil(stage); // сцена не загрузилась — досматриваем обычную рулетку
      }
      await spun;
      if (!ctx.alive()) return;
      sfx('stop');
      showResult(drops);
      if (best) setTimeout(() => dropSound(best.inv), 140);
    } finally { spinning = false; holdFeed(false); }
  });
  function showResult(drops) {
    const total = drops.reduce((s, x) => s + (x.inv.price || 0), 0);
    const box = $('[data-result]', ctx.el);
    const fxd = bestFx(drops); lastFx = fxd;
    mount(box, html`<div class="result">${fxd ? html`<div class="mb"><span class="drop-fx-badge ${fxd.fx.scene}">${icon('trophy')} ${fxd.fx.label}</span></div>` : ''}<h2>${drops.length > 1 ? 'Ваши дропы' : 'Ваш дроп'}</h2><p class="muted">Предметы уже лежат в инвентаре. Общая стоимость: ${bc(total)}</p>
      <div class="grid g-items">${drops.map((x, i) => html`<div style="animation-delay:${i * 70}ms">${itemCard(x.inv, { cls: 'big', extra: html`<div class="item-act"><button class="btn sm red" data-sell="${x.inv.id}">Продать</button></div>` })}</div>`)}</div>
      <div class="result-acts">${drops.length > 1 ? html`<button class="btn red" data-sell-all>Продать всё за ${money(total)}</button>` : ''}<a class="btn ghost" href="/inventory">Оставить в инвентаре</a><a class="btn ghost" href="/upgrade?ids=${drops.map((x) => x.inv.id).slice(0, 6).join(',')}">${icon('upgrade')} В апгрейд</a>${fxd && cineOn() ? html`<button class="btn ghost" data-cine-replay>${icon('play')} Повтор сцены</button>` : ''}${fxd?.share && shareOn() ? html`<button class="btn ghost" data-share-drop>${icon('link')} Поделиться дропом</button>` : ''}<button class="btn" data-again>Открыть ещё за ${money(price())}</button></div>
      ${fairBadge(drops[0])}</div>`);
    box.dataset.ids = drops.map((x) => x.inv.id).join(',');
    setTimeout(() => box.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
  }
  const markSold = (ids) => { for (const id of ids) { const b = $(`[data-sell="${id}"]`, ctx.el); if (b) { b.disabled = true; b.textContent = 'Продано'; b.closest('.item')?.classList.add('off'); } } };
  on(ctx.el, 'click', '[data-open]', (e, b) => open(b));
  on(ctx.el, 'click', '[data-again]', (e, b) => { const ob = $('[data-open]', ctx.el); open(ob || b); });
  on(ctx.el, 'click', '[data-cine-replay]', (e, b) => { const x = lastFx; if (!x) return; busy(b, async () => { const m = await loadCine(); m.playDrop({ item: x.inv, fx: x.fx, share: x.share, replay: true, caseName: c.name }); }); });
  on(ctx.el, 'click', '[data-share-drop]', (e, b) => { const x = lastFx; if (!x?.share) return; busy(b, async () => { const m = await loadCine(); await m.openShare({ item: x.inv, fx: x.fx, share: x.share }); }); });
  on(ctx.el, 'click', '[data-sell]', (e, b) => { e.stopPropagation(); busy(b, async () => { const id = Number(b.dataset.sell); const r = await sellApi({ ids: [id] }); markSold([id]); toast(html`Продано за ${bc(r.amount)}`, 'ok'); }); });
  on(ctx.el, 'click', '[data-sell-all]', (e, b) => busy(b, async () => {
    const ids = String($('[data-result]', ctx.el).dataset.ids || '').split(',').map(Number).filter((id) => { const x = $(`[data-sell="${id}"]`, ctx.el); return id && x && !x.disabled; });
    if (!ids.length) return toast('Все предметы уже проданы', 'info');
    const r = await sellApi({ ids }); markSold(ids); b.disabled = true; toast(html`Продано предметов: ${r.sold} за ${bc(r.amount)}`, 'ok');
  }));
  if (ctx.path.startsWith('/open/') && state.me && isPub && ctx.q.get('go') === '1') { const ob = $('[data-open]', ctx.el); if (ob) open(ob); }
}
page('/cases/:slug', casePage, { title: 'Кейс' });
page('/open/:slug', casePage, { title: 'Открытие кейса' });

// ================= КАТАЛОГ СКИНОВ =================
page('/skins', async (ctx) => {
  const meta = await api('/api/items/meta');
  const st = { q: '', weapon: '', category: '', rarity: '', collection: '', stattrak: '', souvenir: '', sort: 'price_desc', page: 1 };
  for (const k of Object.keys(st)) if (ctx.q.get(k)) st[k] = k === 'page' ? Number(ctx.q.get(k)) || 1 : ctx.q.get(k);
  const sel = (name, label, list, val) => html`<select name="${name}" aria-label="${label}"><option value="">${label}</option>${list.map((x) => html`<option value="${x.v}" ${String(val) === String(x.v) ? raw('selected') : ''}>${x.l}${x.n != null ? ' (' + x.n + ')' : ''}</option>`)}</select>`;
  mount(ctx.el, html`<div class="wrap">${head('Каталог скинов CS2', `${num(meta.total)} предметов в каталоге · ${num(meta.withImages)} с изображениями`)}
    <div class="filters">
      <label class="search"><input name="q" placeholder="Название скина или оружия" value="${st.q}" aria-label="Поиск"></label>
      ${sel('category', 'Все категории', (meta.categories || []).filter((x) => x.name).map((x) => ({ v: x.name, l: catRu(x.name), n: x.n })), st.category)}
      ${sel('weapon', 'Все оружие', (meta.weapons || []).filter((x) => x.name).map((x) => ({ v: x.name, l: x.name, n: x.n })), st.weapon)}
      ${sel('rarity', 'Любая редкость', (meta.rarities || []).filter((x) => x.name).map((x) => ({ v: x.name, l: rarityRu(x.name), n: x.n })), st.rarity)}
      ${meta.collections?.length ? sel('collection', 'Все коллекции', meta.collections.map((x) => ({ v: x.name, l: x.name, n: x.n })), st.collection) : ''}
      <select name="sort" aria-label="Сортировка">${[['price_desc', 'Сначала дорогие'], ['price_asc', 'Сначала дешёвые'], ['name', 'По названию'], ['new', 'Новые в каталоге']].map(([k, l]) => html`<option value="${k}" ${st.sort === k ? raw('selected') : ''}>${l}</option>`)}</select>
      <label class="check sm"><input type="checkbox" name="stattrak" ${st.stattrak ? raw('checked') : ''}><span>StatTrak™</span></label>
      <label class="check sm"><input type="checkbox" name="souvenir" ${st.souvenir ? raw('checked') : ''}><span>Сувенир</span></label>
    </div>
    <div data-list>${loader()}</div></div>`);
  const load = async () => {
    setQuery({ ...st, page: st.page > 1 ? st.page : '', sort: st.sort === 'price_desc' ? '' : st.sort });
    const r = await api('/api/items' + qs({ ...st, size: 48 }));
    if (!ctx.alive()) return;
    mount($('[data-list]', ctx.el), r.items.length ? html`<p class="muted sm">Найдено: ${num(r.total)}</p><div class="grid g-items">${r.items.map((it) => itemCard(it, { href: '/skins/' + it.id }))}</div>${pager(r.page, r.total, r.size)}` : empty('Ничего не найдено. Попробуйте изменить фильтры.'));
  };
  const later = debounce(() => load().catch(fail));
  ctx.el.addEventListener('input', (e) => { const n = e.target.name; if (!(n in st)) return; st[n] = e.target.type === 'checkbox' ? (e.target.checked ? '1' : '') : e.target.value; st.page = 1; if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox') load().catch(fail); else later(); });
  on(ctx.el, 'click', '[data-page]', (e, b) => { st.page = Number(b.dataset.page); load().then(() => window.scrollTo({ top: 0, behavior: 'smooth' })).catch(fail); });
  await load();
}, { title: 'Скины CS2' });

page('/skins/:id', async (ctx) => {
  const d = await api('/api/items/' + encodeURIComponent(ctx.params.id));
  const it = d.item; const [w, p] = splitName(it.name);
  document.title = it.name + ' — ' + (state.site?.site?.name || 'BURGER SKIN');
  const priceTable = (title, list) => list?.length ? html`<h4 class="mt">${title}</h4><div class="tbl-wrap"><table class="tbl"><tbody>${list.map((x) => html`<tr><td>${x.wear ? WEARS[x.wear] + ' (' + x.wear + ')' : 'Без качества'}</td><td class="r">${bc(x.price)}</td></tr>`)}</tbody></table></div>` : '';
  const src = { internal: 'Внутренняя оценка BURGER SKIN', skinport: 'Skinport', steam: 'Steam Community Market', csv: 'Импорт цен', json: 'Импорт цен' };
  mount(ctx.el, html`<div class="wrap"><div class="row gap sm mb"><a href="/skins">← Каталог скинов</a></div>
    <div class="split">
      <div class="stack-l">
        <div class="item big" style="--rc:${cssColor(it.color)};padding:24px"><div class="item-badges">${it.stattrak ? html`<span class="tag st">StatTrak™</span>` : ''}${it.souvenir ? html`<span class="tag sv">Сувенир</span>` : ''}</div><div class="item-img" style="aspect-ratio:16/9">${img(it.image, '', it.name)}</div></div>
        <div class="card"><h3>Качество и float</h3>
          <p class="muted sm">Диапазон float этого скина: <b>${Number(it.minFloat ?? 0).toFixed(2)} – ${Number(it.maxFloat ?? 1).toFixed(2)}</b>. При выпадении float определяется сервером равномерно в этом диапазоне.</p>
          <div class="stack">${(it.wearOdds || []).filter((x) => x.wear).map((x) => html`<div><div class="row between sm"><span>${WEARS[x.wear]} (${x.wear})</span><b>${pct(x.p)}</b></div>${progress(x.p, 1)}</div>`)}</div></div>
      </div>
      <div class="stack-l">
        <div class="card"><div class="muted">${w}</div><h1 style="margin:4px 0 10px">${p || w}</h1>
          <div class="chips mb"><span class="badge" style="color:${cssColor(it.color)}">${rarityRu(it.rarityName)}</span><span class="badge">${catRu(it.category)}</span>${it.collection ? html`<a class="badge info" href="/collections/${encodeURIComponent(it.collection)}">${it.collection}</a>` : ''}</div>
          <div class="kv"><span>Базовая цена</span><span>${bc(it.price)}</span><span>Источник цены</span><span>${src[it.priceSource] || it.priceSource || '—'}</span>${it.priceUpdated ? html`<span>Обновлена</span><span>${fdate(it.priceUpdated)}</span>` : ''}<span>Выпало на сайте</span><span>${num(d.drops)} раз</span>${it.extId ? html`<span>Внешний ID</span><span class="mono">${it.extId}</span>` : ''}</div>
          ${priceTable('Цены по качеству', it.prices)}${priceTable('StatTrak™', it.stattrakPrices)}${priceTable('Сувенир', it.souvenirPrices)}
          <p class="xs dim mt mb0">Цены указаны в рублях (₽). Рыночные цены обновляются только из проверенных источников.</p></div>
      </div>
    </div>
    <section class="sec"><div class="sec-head"><h2>В каких кейсах встречается</h2></div>
      ${d.cases?.length ? html`<div class="grid g-cases">${d.cases.map(caseCard)}</div>` : empty('Этого предмета пока нет в опубликованных кейсах — его можно получить через апгрейд.', html`<a class="btn" href="/upgrade">К апгрейду</a>`)}</section></div>`);
}, { title: 'Скин' });

// ================= ИНВЕНТАРЬ =================
page('/inventory', async (ctx) => {
  const st = { status: ctx.q.get('status') || 'owned', q: '', sort: 'new', wear: '' };
  const sel = new Set(); let data = null;
  mount(ctx.el, html`<div class="wrap"><div data-head></div>
    <div class="filters">
      <label class="search"><input name="q" placeholder="Поиск в инвентаре" aria-label="Поиск"></label>
      <select name="status" aria-label="Статус">${[['owned', 'В инвентаре'], ['all', 'Все предметы'], ['sold', 'Проданные'], ['upgraded', 'Ушли в апгрейд'], ['contracted', 'Ушли в контракт'], ['withdrawing', 'Выводятся'], ['withdrawn', 'Выведенные']].map(([k, l]) => html`<option value="${k}" ${st.status === k ? raw('selected') : ''}>${l}</option>`)}</select>
      <select name="wear" aria-label="Качество"><option value="">Любое качество</option>${Object.entries(WEARS).map(([k, l]) => html`<option value="${k}">${l}</option>`)}</select>
      <select name="sort" aria-label="Сортировка"><option value="new">Сначала новые</option><option value="price_desc">Сначала дорогие</option><option value="price_asc">Сначала дешёвые</option><option value="name">По названию</option></select>
    </div>
    <div class="card flat mb row between gap" data-bar></div>
    <div data-list>${loader()}</div></div>`);
  const bar = () => {
    const items = data?.items || []; const chosen = items.filter((x) => sel.has(x.id));
    const sum = chosen.reduce((s, x) => s + x.price, 0);
    mount($('[data-bar]', ctx.el), html`<div class="row gap"><b>Выбрано: ${sel.size}</b>${sel.size ? html`<span>на ${bc(sum)}</span><button class="link sm" data-clear>снять выделение</button>` : html`<span class="muted sm">Нажмите на предметы, чтобы выбрать их</span>`}${st.status === 'owned' && items.length ? html`<button class="link sm" data-all>выбрать все</button>` : ''}</div>
      <div class="row gap"><button class="btn sm red" data-sell-sel ${sel.size ? '' : raw('disabled')}>Продать выбранные</button><button class="btn sm ghost" data-to-up ${sel.size && sel.size <= 6 ? '' : raw('disabled')}>${icon('upgrade')} В апгрейд</button><button class="btn sm ghost" data-to-ctr ${sel.size ? '' : raw('disabled')}>${icon('contracts')} В контракт</button><button class="btn sm ghost" data-sell-everything ${data?.count ? '' : raw('disabled')}>Продать всё</button></div>`);
  };
  const draw = () => {
    mount($('[data-head]', ctx.el), head('Инвентарь', html`Предметов в инвентаре: <b>${data.count}</b> · оценочная стоимость ${bc(data.totalValue)}`, html`<a class="btn ghost" href="/history?tab=ledger">История операций</a><a class="btn" href="/cases">Открыть кейс</a>`));
    const items = data.items;
    mount($('[data-list]', ctx.el), items.length ? html`<div class="grid g-items">${items.map((it) => itemCard(it, { id: it.id, selected: sel.has(it.id), cls: it.status === 'owned' ? '' : 'off', extra: it.status === 'owned' ? html`<div class="item-act"><button class="btn sm red" data-sell1="${it.id}">Продать</button></div>` : html`<div class="item-st">${INV_STATUS[it.status] || it.status} · ${fdate(it.createdAt)}</div>` }))}</div>` : empty(st.status === 'owned' ? 'В инвентаре пока нет предметов. Откройте первый кейс!' : 'Нет предметов с таким статусом.', html`<a class="btn" href="/cases">К кейсам</a>`));
    bar();
  };
  const load = async () => { data = await api('/api/inventory' + qs(st)); if (!ctx.alive()) return; for (const id of [...sel]) if (!data.items.some((x) => x.id === id && x.status === 'owned')) sel.delete(id); draw(); };
  const later = debounce(() => load().catch(fail));
  ctx.el.addEventListener('input', (e) => { const n = e.target.name; if (!(n in st)) return; st[n] = e.target.value; if (e.target.tagName === 'SELECT') load().catch(fail); else later(); });
  on(ctx.el, 'click', '.item[data-id]', (e, el) => { if (e.target.closest('button')) return; const id = Number(el.dataset.id); const it = data.items.find((x) => x.id === id); if (!it || it.status !== 'owned') return; sel.has(id) ? sel.delete(id) : sel.add(id); el.classList.toggle('sel', sel.has(id)); bar(); });
  on(ctx.el, 'click', '[data-clear]', () => { sel.clear(); draw(); });
  on(ctx.el, 'click', '[data-all]', () => { for (const it of data.items) if (it.status === 'owned') sel.add(it.id); draw(); });
  on(ctx.el, 'click', '[data-sell1]', (e, b) => busy(b, async () => { const r = await sellApi({ ids: [Number(b.dataset.sell1)] }); toast(html`Предмет продан за ${bc(r.amount)}`, 'ok'); await load(); }));
  on(ctx.el, 'click', '[data-sell-sel]', (e, b) => busy(b, async () => { const ids = [...sel]; if (!(await confirmBox(`Продать выбранные предметы (${ids.length})?`, 'Продать', true))) return; const r = await sellApi({ ids }); sel.clear(); toast(html`Продано: ${r.sold} за ${bc(r.amount)}`, 'ok'); await load(); }));
  on(ctx.el, 'click', '[data-sell-everything]', (e, b) => busy(b, async () => { if (!(await confirmBox(`Продать все предметы инвентаря (${data.count}) на сумму около ${rub(data.totalValue * (data.sellRate || 1))}?`, 'Продать всё', true))) return; const r = await api('/api/inventory/sell-all', {}); sel.clear(); toast(html`Продано: ${r.sold} за ${bc(r.amount)}`, 'ok'); await load(); }));
  on(ctx.el, 'click', '[data-to-up]', () => go('/upgrade?ids=' + [...sel].slice(0, 6).join(',')));
  on(ctx.el, 'click', '[data-to-ctr]', () => go('/contracts?ids=' + [...sel].slice(0, 10).join(',')));
  await load();
}, { auth: true, title: 'Инвентарь' });

// ================= АПГРЕЙД =================
// Шанс и результат считает сервер. Браузер только показывает предварительный расчёт и анимирует ответ.
const U_STAR = String.fromCharCode(0x2605);
const U_RAR = { 'Consumer Grade': 1, 'Industrial Grade': 2, 'Mil-Spec Grade': 3, Restricted: 4, Classified: 5, Covert: 6, Extraordinary: 7, Contraband: 8 };
const uRarRank = (it) => it.rank ?? (String(it.name || '').startsWith(U_STAR) ? 7 : U_RAR[it.rarityName] || 0);
const uMult = (m) => (m ? '×' + (Math.round(m * 100) / 100).toLocaleString('ru-RU') : '×—');
const uPct = (p) => (Math.max(0, p || 0) * 100).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%';
const uQs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };
const U_RING = 2 * Math.PI * 88;

page('/upgrade', async (ctx) => {
  const rr = await api('/api/upgrade/rules').catch(() => ({ rules: state.site?.upgrade || {} }));
  let rules = Object.assign({ presets: [2, 3, 5, 10], minMult: 1.1, maxMult: 20, maxItems: 6, maxChance: 0.75 }, rr.rules || {});
  const fast = localStorage.getItem('bs_fast') === '1';
  const st = { inv: [], sel: new Set(String(ctx.q.get('ids') || '').split(',').map(Number).filter((x) => x > 0)), targets: [], target: null, mult: rules.presets[0] || 2, custom: false,
    iq: '', isort: 'price_desc', tq: '', tsort: '', trar: '', scope: 'me', quote: null, qerr: '', busy: false, widened: false };
  const presetBtns = () => html`${rules.presets.map((m) => html`<button type="button" data-m="${m}" class="${!st.custom && st.mult === m ? 'on' : ''}">${uMult(m)}</button>`)}`;
  mount(ctx.el, html`<div class="wrap upg-page">
    ${head('Апгрейд', 'Обменяйте предметы на более дорогой скин. Шанс рассчитывает сервер по стоимости предметов и правилам площадки.')}
    ${state.me ? '' : notice(html`Чтобы делать апгрейды, <a href="/login?next=/upgrade">войдите в аккаунт</a>.`, 'info')}
    <div class="upg3">
      <section class="upg-col">
        <div class="upg-col-h"><h3>${icon('inventory')}<span>Ваши предметы</span></h3><span class="xs muted" data-selinfo></span></div>
        <div class="upg-tools"><input type="search" data-iq placeholder="Поиск по инвентарю" aria-label="Поиск по инвентарю"><select data-isort aria-label="Сортировка"><option value="price_desc">Сначала дорогие</option><option value="price_asc">Сначала дешёвые</option><option value="rarity">По редкости</option></select></div>
        <div class="upg-list" data-invlist>${loader()}</div>
      </section>
      <section class="upg-mid">
        <div class="upg-ring" data-ring>
          <svg viewBox="0 0 200 200" aria-hidden="true"><circle class="trk" cx="100" cy="100" r="88"></circle><circle class="arc" data-arc cx="100" cy="100" r="88" stroke-dasharray="0 ${U_RING.toFixed(2)}"></circle></svg>
          <div class="upg-needle" data-needle><i></i></div>
          <div class="upg-ring-c"><div class="upg-chance" data-chance>0,00%</div><div class="xs muted">шанс успеха</div><div class="upg-xm" data-xm>×—</div></div>
        </div>
        <div class="upg-pair"><div class="upg-slot" data-from></div><span class="upg-arrow">${icon('arrowRight')}</span><div class="upg-slot" data-to></div></div>
        <div class="upg-mults"><div class="seg" data-mults>${presetBtns()}</div><label class="upg-custom" data-customwrap><span>Свой ×</span><input type="number" inputmode="decimal" step="0.1" min="${rules.minMult}" max="${rules.maxMult}" placeholder="${rules.minMult}–${rules.maxMult}" data-custom aria-label="Свой множитель"></label></div>
        <div class="xs muted center upg-hint" data-hint></div>
        <button class="btn lg upg-go" data-go disabled>${icon('upgrade')}<span>Улучшить</span></button>
        <div data-res></div>
      </section>
      <section class="upg-col">
        <div class="upg-col-h"><h3>${icon('target')}<span>Желаемый скин</span></h3><span class="xs muted" data-tginfo></span></div>
        <div class="upg-tools"><input type="search" data-tq placeholder="Поиск скина" aria-label="Поиск скина"><select data-tsort aria-label="Сортировка"><option value="">Подходящие</option><option value="price_asc">Сначала дешёвые</option><option value="price_desc">Сначала дорогие</option><option value="rarity">По редкости</option><option value="chance">По шансу</option></select><select data-trar aria-label="Редкость"><option value="">Любая редкость</option>${Object.keys(U_RAR).map((k) => html`<option value="${k}">${rarityRu(k)}</option>`)}</select></div>
        <div class="upg-list" data-tglist>${loader()}</div>
      </section>
    </div>
    <section class="sec"><div class="sec-head"><h2>История апгрейдов</h2><div class="seg" data-hscope><button type="button" data-s="me" class="on">Мои</button><button type="button" data-s="all">Все игроки</button></div></div><div data-hist>${loader()}</div></section>
  </div>`);

  const tKey = (t) => `${t.id}|${t.wear || ''}|${t.variant || ''}`;
  const tile = (it, o = {}) => {
    const [w, p] = splitName(it.name);
    return html`<button type="button" class="ut ${o.on ? 'on' : ''}" style="--rc:${cssColor(it.color)}" ${raw(o.attr || '')}>
      <span class="ut-img">${img(it.image, '', it.name)}</span>
      <span class="ut-n"><span>${w}</span><b>${p || ''}</b></span>
      <span class="ut-m"><span class="xs dim">${it.wear || ''}${it.stattrak ? ' · ST' : ''}</span><b>${rub(it.price)}</b></span>${o.extra || ''}</button>`;
  };
  const selItems = () => st.inv.filter((x) => st.sel.has(x.id));
  const input = () => selItems().reduce((s, x) => s + (x.price || 0), 0);
  const drawInv = () => {
    const box = $('[data-invlist]', ctx.el); if (!box) return;
    if (!state.me) { mount(box, empty('Войдите, чтобы выбрать предметы')); return; }
    let list = st.inv.filter((x) => !st.iq || String(x.name).toLowerCase().includes(st.iq));
    list = list.slice().sort(st.isort === 'price_asc' ? (a, b) => a.price - b.price : st.isort === 'rarity' ? (a, b) => uRarRank(b) - uRarRank(a) || b.price - a.price : (a, b) => b.price - a.price);
    mount(box, list.length ? html`${list.map((x) => tile(x, { on: st.sel.has(x.id), attr: `data-i="${x.id}"` }))}` : empty(st.inv.length ? 'Ничего не найдено' : 'Инвентарь пуст — откройте кейс, чтобы получить предметы'));
    mount($('[data-selinfo]', ctx.el), st.sel.size ? html`Выбрано ${st.sel.size} из ${rules.maxItems} · ${rub(input())}` : html`До ${rules.maxItems} предметов`);
  };
  const drawTargets = () => {
    const box = $('[data-tglist]', ctx.el); if (!box) return;
    const k = st.target ? tKey(st.target) : '';
    mount(box, st.targets.length ? html`${st.targets.map((t, i) => tile(t, { on: tKey(t) === k, attr: `data-t="${i}"`, extra: t.chance != null ? html`<span class="ut-ch">${uPct(t.chance)} · ${uMult(t.multiplier)}</span>` : '' }))}` : empty(st.sel.size ? 'Нет подходящих скинов для этого множителя' : 'Скины не найдены'));
    mount($('[data-tginfo]', ctx.el), st.widened ? 'Точных совпадений нет — показаны ближайшие' : st.sel.size ? `Подбор под ${uMult(st.mult)}` : '');
  };
  const setRing = (p) => { const a = $('[data-arc]', ctx.el); if (a) a.setAttribute('stroke-dasharray', `${(Math.max(0, Math.min(1, p || 0)) * U_RING).toFixed(2)} ${U_RING.toFixed(2)}`); };
  const drawMid = () => {
    if (!ctx.alive()) return;
    const inp = input(); const t = st.target; const q = st.quote;
    const chance = q ? q.chance : t?.chance || 0;
    mount($('[data-from]', ctx.el), st.sel.size ? html`<div class="upg-thumbs n${Math.min(4, st.sel.size)}">${selItems().slice(0, 4).map((x) => img(x.image, '', x.name))}</div><div class="xs muted">Ставка · ${st.sel.size} шт.</div><b>${rub(inp)}</b>` : html`<div class="upg-ph">${icon('inventory')}</div><div class="xs muted">Выберите предметы</div><b>—</b>`);
    mount($('[data-to]', ctx.el), t ? html`<div class="upg-thumbs one" style="--rc:${cssColor(t.color)}">${img(t.image, '', t.name)}</div><div class="xs muted ellip" title="${t.name}">${t.name}</div><b>${rub(q ? q.target : t.price)}</b>` : html`<div class="upg-ph">${icon('target')}</div><div class="xs muted">Выберите цель</div><b>—</b>`);
    $('[data-chance]', ctx.el).textContent = uPct(chance);
    $('[data-xm]', ctx.el).textContent = uMult(q ? q.multiplier : t && inp ? t.price / inp : 0);
    if (!st.busy) setRing(chance);
    const go = $('[data-go]', ctx.el); go.disabled = !state.me || !st.sel.size || !t || !q || st.busy;
    mount($('[data-hint]', ctx.el), q ? html`Шанс рассчитан сервером · максимум ${uPct(rules.maxChance)}` : st.qerr ? html`<span class="err-t">${st.qerr}</span>` : '');
  };
  let qSeq = 0;
  const requote = async () => {
    st.quote = null; st.qerr = ''; drawMid();
    const t = st.target;
    if (!state.me || !t || !st.sel.size) return;
    const my = ++qSeq;
    try {
      const q = await api('/api/upgrade/quote', { ids: [...st.sel], itemId: t.id, wear: t.wear || '', variant: t.variant || '' });
      if (my === qSeq && ctx.alive()) { st.quote = q; drawMid(); }
    } catch (e) { if (my === qSeq && ctx.alive()) { st.qerr = e.message; drawMid(); } }
  };
  let tSeq = 0;
  const loadTargets = async (autoPick) => {
    const my = ++tSeq;
    const r = await api('/api/upgrade/targets' + uQs({ ids: [...st.sel].join(','), mult: st.sel.size ? st.mult : '', q: st.tq, sort: st.tsort, rarity: st.trar, limit: 60 })).catch((e) => { toast(e.message, 'err'); return null; });
    if (!r || my !== tSeq || !ctx.alive()) return;
    st.targets = r.targets || []; st.widened = !!r.widened;
    if (r.rules) rules = Object.assign(rules, r.rules);
    if (st.target) { const k = tKey(st.target); st.target = st.targets.find((x) => tKey(x) === k) || (autoPick ? null : st.target); }
    if (autoPick && st.sel.size && st.targets.length) {
      const ideal = (r.input || input()) * st.mult;
      st.target = st.targets.slice().sort((a, b) => Math.abs(a.price - ideal) - Math.abs(b.price - ideal))[0];
    }
    drawTargets(); requote();
  };
  const loadTargetsD = debounce((a) => loadTargets(a), 220);
  const loadInv = async () => {
    if (!state.me) { drawInv(); return; }
    const r = await api('/api/inventory?sort=price_desc').catch(() => ({}));
    st.inv = (r.items || r.rows || []).filter((x) => !x.status || x.status === 'owned');
    for (const id of [...st.sel]) if (!st.inv.some((x) => x.id === id)) st.sel.delete(id);
    drawInv();
  };
  const drawHist = async () => {
    const r = await api('/api/upgrade/history' + uQs({ scope: st.scope })).catch(() => ({ rows: [] }));
    const box = $('[data-hist]', ctx.el); if (!box || !ctx.alive()) return;
    mount(box, r.rows?.length ? html`<div class="upg-hist">${r.rows.map((h) => html`<div class="uh ${h.win ? 'win' : 'lose'}">
      <span class="uh-t xs dim">${ago(h.createdAt)}</span>
      ${h.user ? html`<span class="uh-u sm">${h.user.nickname}</span>` : ''}
      <span class="uh-in">${(h.inputs || []).slice(0, 3).map((x) => img(x.image, '', x.name))}<b class="sm">${rub(h.amount)}</b></span>
      <span class="uh-ar">${icon('arrowRight')}</span>
      <span class="uh-tg" style="--rc:${cssColor(h.target?.color)}">${img(h.target?.image, '', h.target?.name)}<span class="sm ellip">${h.target?.name || '—'}</span></span>
      <span class="uh-m sm">${uMult(h.multiplier)} · ${uPct(h.chance)}</span>
      <span class="badge ${h.win ? 'ok' : 'err'}">${h.win ? 'Успех' : 'Неудача'}</span></div>`)}</div>` : empty(st.scope === 'me' ? (state.me ? 'Вы ещё не делали апгрейдов' : 'Войдите, чтобы видеть свою историю') : 'Апгрейдов пока нет'));
  };
  const drawMults = () => { mount($('[data-mults]', ctx.el), presetBtns()); $('[data-customwrap]', ctx.el).classList.toggle('on', st.custom); };
  const spinNeedle = (roll, duration) => new Promise((res) => {
    const nd = $('[data-needle]', ctx.el);
    nd.style.transition = 'none'; nd.style.transform = 'rotate(0deg)'; void nd.offsetWidth;
    nd.style.transition = `transform ${duration}ms cubic-bezier(.12,.66,.12,1)`;
    nd.style.transform = `rotate(${360 * 5 + roll * 360}deg)`;
    let prev = 0; let acc = 0; let last = 0; let raf = 0; const step = 15;
    const tick = () => {
      const m = new DOMMatrix(getComputedStyle(nd).transform);
      let a = (Math.atan2(m.b, m.a) * 180) / Math.PI; if (a < 0) a += 360;
      let d = a - prev; if (d < -180) d += 360; prev = a; acc += Math.max(0, d);
      if (acc - last >= step) { last = acc; sfx('tick', { ch: 'upgrade', level: 0.45 }); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    setTimeout(() => { cancelAnimationFrame(raf); res(); }, duration + 80);
  });

  on(ctx.el, 'click', '[data-i]', (e, b) => {
    if (st.busy) return;
    const id = Number(b.dataset.i);
    if (st.sel.has(id)) st.sel.delete(id);
    else { if (st.sel.size >= rules.maxItems) { toast(`Можно выбрать не больше ${rules.maxItems} предметов`, 'info'); return; } st.sel.add(id); }
    sfx('select', { ch: 'upgrade' }); mount($('[data-res]', ctx.el), '');
    drawInv(); drawMid(); loadTargetsD(true);
  });
  on(ctx.el, 'click', '[data-t]', (e, b) => { if (st.busy) return; st.target = st.targets[Number(b.dataset.t)] || null; sfx('select', { ch: 'upgrade' }); drawTargets(); requote(); });
  on(ctx.el, 'click', '[data-mults] button', (e, b) => { if (st.busy) return; st.mult = Number(b.dataset.m); st.custom = false; $('[data-custom]', ctx.el).value = ''; sfx('mult', { ch: 'upgrade' }); drawMults(); loadTargets(true); });
  on(ctx.el, 'change', '[data-custom]', (e, inp) => {
    if (st.busy) return;
    const v = Number(String(inp.value).replace(',', '.'));
    if (!Number.isFinite(v) || v < rules.minMult || v > rules.maxMult) { toast(`Множитель должен быть от ×${rules.minMult} до ×${rules.maxMult}`, 'info'); return; }
    st.mult = Math.round(v * 100) / 100; st.custom = true; sfx('mult', { ch: 'upgrade' }); drawMults(); loadTargets(true);
  });
  on(ctx.el, 'input', '[data-iq]', debounce((e, i) => { st.iq = i.value.trim().toLowerCase(); drawInv(); }, 150));
  on(ctx.el, 'change', '[data-isort]', (e, s) => { st.isort = s.value; drawInv(); });
  on(ctx.el, 'input', '[data-tq]', debounce((e, i) => { st.tq = i.value.trim(); loadTargets(false); }, 300));
  on(ctx.el, 'change', '[data-tsort]', (e, s) => { st.tsort = s.value; loadTargets(false); });
  on(ctx.el, 'change', '[data-trar]', (e, s) => { st.trar = s.value; loadTargets(false); });
  on(ctx.el, 'click', '[data-hscope] button', (e, b) => { st.scope = b.dataset.s; for (const x of $$('[data-hscope] button', ctx.el)) x.classList.toggle('on', x === b); drawHist(); });
  on(ctx.el, 'click', '[data-go]', async (e, b) => {
    if (st.busy || !st.quote || !st.target) return;
    st.busy = true; b.disabled = true;
    const wrap = $('.upg3', ctx.el); wrap.classList.add('running');
    const ring = $('[data-ring]', ctx.el); ring.classList.remove('won', 'lost');
    mount($('[data-res]', ctx.el), '');
    sfx('launch', { ch: 'upgrade' });
    const q = st.quote; const t = st.target;
    let r;
    try {
      r = await api('/api/upgrade', { ids: [...st.sel], itemId: t.id, wear: t.wear || '', variant: t.variant || '', expectInput: q.input, expectTarget: q.target });
    } catch (err) {
      st.busy = false; wrap.classList.remove('running'); toast(err.message, 'err');
      if (err.code === 'price_changed' || err.code === 'item_unavailable') { await loadInv(); requote(); } else drawMid();
      return;
    }
    setRing(r.chance);
    sfx('spin', { ch: 'upgrade' });
    await spinNeedle(r.roll, fast ? 2200 : 4600);
    if (!ctx.alive()) return;
    wrap.classList.remove('running');
    ring.classList.add(r.win ? 'won' : 'lost');
    if (r.win) { sfx('win', { ch: 'upgrade' }); if (r.rare && r.item) setTimeout(() => dropSound(r.item, 'upgrade'), 380); } else sfx('lose', { ch: 'upgrade' });
    mount($('[data-res]', ctx.el), r.win && r.item
      ? html`<div class="upg-res win"><div><b>Апгрейд успешен</b><div class="xs muted">Предмет добавлен в инвентарь · шанс ${uPct(r.chance)} · точка ${uPct(r.roll)}</div></div>${itemCard(r.item, { cls: 'sm' })}</div>`
      : html`<div class="upg-res lose"><b>Не повезло</b><div class="xs muted">Шанс ${uPct(r.chance)} · точка ${uPct(r.roll)} · ставка ${rub(r.input)} списана</div></div>`);
    st.sel.clear(); st.target = null; st.quote = null; st.busy = false;
    await loadInv(); drawMid(); drawHist(); loadTargets(false);
    setTimeout(() => ring.classList.remove('won', 'lost'), 4500);
  });
  await loadInv(); drawMid(); loadTargets(st.sel.size > 0); drawHist();
}, { title: 'Апгрейд' });

// ================= КОНТРАКТЫ =================
page('/contracts', async (ctx) => {
  if (state.features.contracts === false) return mount(ctx.el, html`<div class="wrap">${head('Контракты')}${featureOff('Режим контрактов')}</div>`);
  let inv = (await api('/api/inventory?sort=price_asc')).items;
  let minItems = 3, maxItems = 10;
  const sel = []; for (const id of String(ctx.q.get('ids') || '').split(',').map(Number)) if (inv.some((x) => x.id === id) && !sel.includes(id) && sel.length < maxItems) sel.push(id);
  let quote = null; let busyNow = false;
  mount(ctx.el, html`<div class="wrap">${head('Контракты', 'Обменяйте несколько предметов на один новый. Результат определяет сервер по схеме Provably Fair.', html`<a class="btn ghost" href="/history?game=contract">История контрактов</a>`)}
    <div class="split"><div class="card"><div class="ctr-slots" data-slots></div></div>
      <div class="card sticky" data-quote></div></div>
    <section class="sec"><div class="sec-head"><h2>Выберите предметы</h2><span class="muted sm" data-n></span></div><div data-inv></div></section>
    <section class="sec"><div class="sec-head"><h2>Мои контракты</h2></div><div data-hist>${loader()}</div></section></div>`);
  const total = () => inv.filter((x) => sel.includes(x.id)).reduce((s, x) => s + x.price, 0);
  const drawQuote = () => {
    const q = quote;
    mount($('[data-quote]', ctx.el), html`<h3>Условия контракта</h3>
      <div class="kv"><span>Предметов</span><span>${sel.length} из ${minItems}–${maxItems}</span><span>Сумма предметов</span><span>${bc(total())}</span>${q ? html`<span>Возможный результат</span><span>${money(q.min)} – ${money(q.max)}</span><span>Ожидаемая стоимость</span><span>${bc(q.expected)}</span>` : ''}</div>
      ${q?.sample?.length ? html`<h4 class="mt">Примеры возможных предметов</h4><div class="grid g-items sm-items" style="grid-template-columns:repeat(2,1fr)">${q.sample.slice(0, 4).map((x) => itemCard(x))}</div>` : ''}
      <button class="btn lg block mt" data-sign ${sel.length >= minItems && !busyNow ? '' : raw('disabled')}>${icon('contracts')} Подписать контракт</button>
      ${sel.length < minItems ? html`<p class="muted sm mt mb0">Добавьте ещё ${minItems - sel.length} предм.</p>` : ''}<div data-fair></div>`);
  };
  const drawSlots = () => mount($('[data-slots]', ctx.el), html`${Array.from({ length: maxItems }, (_, i) => { const it = inv.find((x) => x.id === sel[i]); return html`<div class="ctr-slot">${it ? itemCard(it, { id: it.id, cls: 'slot-it' }) : '+'}</div>`; })}`);
  const drawInv = () => { $('[data-n]', ctx.el).textContent = `Выбрано ${sel.length} из ${maxItems}`; mount($('[data-inv]', ctx.el), inv.length ? html`<div class="grid g-items sm-items">${inv.map((x) => itemCard(x, { id: x.id, selected: sel.includes(x.id) }))}</div>` : empty('Инвентарь пуст. Для контракта нужно минимум ' + minItems + ' предмета.', html`<a class="btn" href="/cases">К кейсам</a>`)); };
  const requote = async () => { quote = null; if (sel.length) { try { quote = await api('/api/contracts/quote', { ids: sel }); minItems = quote.minItems || minItems; maxItems = quote.maxItems || maxItems; } catch (e) { fail(e); } } if (ctx.alive()) drawQuote(); };
  const hist = async () => { const r = await api('/api/history?game=contract'); if (ctx.alive()) mount($('[data-hist]', ctx.el), betsTable(r.bets.slice(0, 10), { empty: 'Вы ещё не заключали контрактов.' })); };
  const refresh = () => { drawSlots(); drawInv(); drawQuote(); requote(); };
  const toggle = (id) => { if (busyNow) return; const i = sel.indexOf(id); if (i >= 0) sel.splice(i, 1); else { if (sel.length >= maxItems) return toast(`Максимум ${maxItems} предметов`, 'info'); sel.push(id); } refresh(); };
  on(ctx.el, 'click', '[data-inv] .item', (e, el) => toggle(Number(el.dataset.id)));
  on(ctx.el, 'click', '[data-slots] .item', (e, el) => toggle(Number(el.dataset.id)));
  on(ctx.el, 'click', '[data-sign]', (e, b) => busy(b, async () => {
    if (!(await confirmBox(`Обменять ${sel.length} предм. на сумму ${rub(total())} на один новый предмет?`, 'Подписать'))) return;
    busyNow = true;
    try {
      const r = await api('/api/contracts', { ids: sel });
      const slots = $('[data-slots]', ctx.el); slots.classList.remove('ctr-fx'); void slots.offsetWidth; slots.classList.add('ctr-fx');
      await sleep(1600); if (!ctx.alive()) return;
      modal(html`<div class="result" style="border:0;padding:0"><h2>${icon('contracts')} Контракт заключён</h2><p class="muted">Вложено ${bc(r.total)} → получен предмет стоимостью ${bc(r.item?.price)}</p><div style="max-width:260px;margin:0 auto">${itemCard(r.item, { cls: 'big' })}</div>${fairBadge(r)}<div class="result-acts"><a class="btn ghost" href="/inventory" data-close>В инвентарь</a><button class="btn" data-close>Новый контракт</button></div></div>`);
      sel.length = 0; inv = (await api('/api/inventory?sort=price_asc')).items; if (!ctx.alive()) return; refresh(); hist();
    } finally { busyNow = false; if (ctx.alive()) drawQuote(); }
  }));
  refresh(); hist().catch(() => {});
}, { auth: true, title: 'Контракты' });
