// BURGER SKIN — оболочка приложения: шапка, навигация, лента дропов, подвал, живые события.
import { state, bus, html, raw, mount, $, $$, api, money, bc, avatar, toast, render, go, setHeaderRenderer, renderHeader, setAfterRender, startLive, can, refreshMe, cssColor, splitName, img, safeUrl, ROLES, rub } from './core.js';
import { icon } from './icons.js';
import { soundMuted } from './sound.js';
import './pages/main.js';
import './pages/games.js';
import './pages/social.js';
import './pages/account.js';
import './pages/admin.js';
import './pages/admin4.js';
import './pages/drop.js';
import './pages/admin-drops.js';

const GAMES_MENU = [
  ['/games/crash', 'crash', 'Crash'], ['/games/double', 'double', 'Double'], ['/games/jackpot', 'jackpot', 'Jackpot'], ['/games/coinflip', 'coinflip', 'Coinflip'],
  ['/games/roulette', 'roulette', 'Рулетка'], ['/games/mines', 'mines', 'Mines'], ['/games/towers', 'towers', 'Towers'],
];
// 5-й элемент — приоритет скрытия в меню «Ещё» (1 скрывается первым); без него пункт всегда виден
const MAIN_NAV = [['/cases', 'cases', 'Кейсы'], ['/battles', 'battles', 'Битвы', '', 5], ['/upgrade', 'upgrade', 'Апгрейд'], ['/contracts', 'contracts', 'Контракты', 'opt', 3], ['/skins', 'skins', 'Скины', 'opt', 2]];
const AFTER_NAV = [['/pass', 'pass', 'PASS', '', 4], ['/bonuses', 'bonuses', 'Бонусы', 'opt', 1]];
const ACCOUNT_MENU = [['/profile', 'user', 'Профиль'], ['/inventory', 'inventory', 'Инвентарь'], ['/history', 'history', 'История операций'], ['/balance', 'wallet', 'Баланс'],
  ['/friends', 'friends', 'Друзья'], ['/notifications', 'bell', 'Уведомления'], ['/support', 'support', 'Поддержка'], ['/settings', 'settings', 'Настройки']];
const ACTIVITY_MENU = [['/events', 'events', 'События'], ['/tournaments', 'trophy', 'Турниры'], ['/achievements', 'medal', 'Достижения'], ['/collections', 'collections', 'Коллекции'],
  ['/leaderboard', 'chart', 'Рейтинг'], ['/promo', 'ticket', 'Промокоды'], ['/news', 'news', 'Новости']];
const INFO_MENU = [['/fair', 'fair', 'Provably Fair'], ['/rules', 'book', 'Правила'], ['/privacy', 'lock', 'Конфиденциальность']];
const menuLink = (x, extra = '') => html`<a href="${x[0]}"><span class="ico">${icon(x[1])}</span><span class="ml">${x[2]}</span>${extra}</a>`;
const links = (arr) => arr.map((x) => menuLink(x));

function userMenu() {
  const me = state.me;
  return html`<div class="dd r" data-dd><button class="me-btn" aria-label="Меню аккаунта">${avatar(me)}<span class="me-n">${me.nickname}</span>${icon('chevronDown', 'chev')}</button>
    <div class="dd-menu">
      <div class="dd-h">${ROLES[me.role] || me.role}</div>
      ${links(ACCOUNT_MENU)}
      ${can('admin.access') ? html`<hr>${menuLink(['/admin', 'admin', 'Админ-панель'])}` : ''}
      <hr><button data-logout><span class="ico">${icon('logout')}</span>Выйти</button>
    </div></div>`;
}

function header() {
  const me = state.me; const f = state.features || {};
  const navLink = (x) => html`<a href="${x[0]}" class="${x[3] || ''}" data-nav="${x[0]}" data-pri="${x[4] || 0}" title="${x[2]}">${icon(x[1])}<span class="nl">${x[2]}</span></a>`;
  mount($('#top'), html`<div class="top-in">
    <button class="icon-btn burger-btn" data-drawer aria-label="Открыть меню">${icon('menu')}</button>
    <a class="logo" href="/" aria-label="BURGER SKIN — на главную"><img src="${safeUrl(state.site?.site?.logo, '/img/brand/logo.svg')}" alt=""><b>BURGER <i>SKIN</i></b></a>
    <nav class="nav" aria-label="Основные разделы">
      ${MAIN_NAV.map(navLink)}
      <div class="dd" data-dd data-nav="/games"><button title="Игры">${icon('games')}<span class="nl">Игры</span>${icon('chevronDown', 'chev')}</button><div class="dd-menu">
        ${menuLink(['/games', 'joystick', 'Все игры'])}<hr>
        ${links(GAMES_MENU)}
      </div></div>
      ${AFTER_NAV.map(navLink)}
      <div class="dd r more" data-dd data-more><button title="Ещё разделы" aria-label="Ещё разделы">${icon('grid')}<span class="nl">Ещё</span>${icon('chevronDown', 'chev')}</button><div class="dd-menu">
        ${[...MAIN_NAV, ...AFTER_NAV].filter((x) => x[4]).map((x) => html`<a href="${x[0]}" data-more-for="${x[0]}" hidden><span class="ico">${icon(x[1])}</span><span class="ml">${x[2]}</span></a>`)}
      </div></div>
    </nav>
    <div class="top-r">
      <span class="online" data-online>${state.online || 0} онлайн</span>
      <button class="icon-btn snd-btn" data-sound-panel aria-label="Настройки звука" title="Звук">${icon(soundMuted() ? 'volumeOff' : 'volume')}</button>
      ${me ? html`
        <span class="sep" aria-hidden="true"></span>
        <div class="wallet">
          <a class="bal" href="/balance" title="Баланс"><span class="bal-ico">${icon('wallet')}</span><span class="bc" data-balance>${rub(me.balance)}</span></a>
          <a class="btn sm dep-btn" href="/balance" title="Пополнить баланс">${icon('plus')}<span>Пополнить</span></a>
        </div>
        <a class="icon-btn notif" href="/notifications" aria-label="Уведомления">${icon('bell')}${me.unread ? html`<span class="cnt" data-unread>${me.unread > 99 ? '99+' : me.unread}</span>` : ''}</a>
        <span class="sep" aria-hidden="true"></span>
        ${userMenu()}` : html`
        <a class="btn ghost sm" href="/login">Войти</a>
        <a class="btn sm" href="/register">Регистрация</a>
        ${f.steam ? html`<a class="btn steam sm icon" href="/api/auth/steam" data-native title="Войти через Steam" aria-label="Войти через Steam">${icon('steam')}</a>` : ''}`}
    </div>
  </div>`);
  mount($('#drawer'), html`<div class="drawer-bg" data-drawer-close></div><div class="drawer-p">
    <div class="drawer-top"><a class="logo" href="/"><img src="${safeUrl(state.site?.site?.logo, '/img/brand/logo.svg')}" alt=""><b>BURGER <i>SKIN</i></b></a><button class="icon-btn" data-drawer-close aria-label="Закрыть меню">${icon('close')}</button></div>
    ${me ? html`<div class="adm-badge drawer-me">${avatar(me)}<div><b>${me.nickname}</b><span class="bc" data-balance>${rub(me.balance)}</span></div></div>
      <a class="btn block sm dep-wide" href="/balance">${icon('plus')}Пополнить баланс</a>` : html`<div class="drawer-auth"><a class="btn sm" href="/login">Войти</a><a class="btn ghost sm" href="/register">Регистрация</a></div>`}
    <div class="dd-h">Главное</div>
    ${menuLink(['/', 'home', 'Главная'])}
    ${links([...MAIN_NAV, ['/pass', 'pass', 'BURGER PASS'], ['/bonuses', 'bonuses', 'Бонусы']])}
    <div class="dd-h">Игры</div>
    ${links(GAMES_MENU)}
    <div class="dd-h">Активности</div>
    ${links(ACTIVITY_MENU)}
    ${me ? html`<div class="dd-h">Аккаунт</div>
      ${ACCOUNT_MENU.map((x) => menuLink(x, x[0] === '/notifications' && me.unread ? html`<span class="badge" style="margin-left:auto">${me.unread}</span>` : ''))}
      ${can('admin.access') ? menuLink(['/admin', 'admin', 'Админ-панель']) : ''}
      <button class="dl" data-logout><span class="ico">${icon('logout')}</span>Выйти</button>` : ''}
    <div class="dd-h">Информация</div>
    ${links(INFO_MENU)}
    <div class="dd-h">Звук</div>
    <button class="dl" data-sound-panel><span class="ico">${icon('volume')}</span>Настройки звука</button>
  </div>`);
  mount($('#tabbar'), html`
    <a href="/" data-tab="/">${icon('home')}<span>Главная</span></a>
    <a href="/cases" data-tab="/cases">${icon('cases')}<span>Кейсы</span></a>
    <a href="/upgrade" data-tab="/upgrade">${icon('upgrade')}<span>Апгрейд</span></a>
    <a href="/games" data-tab="/games">${icon('games')}<span>Игры</span></a>
    ${me ? html`<a href="/inventory" data-tab="/inventory">${icon('inventory')}<span>Инвентарь</span></a>` : html`<a href="/login" data-tab="/login">${icon('user')}<span>Войти</span></a>`}`);
  markActive(location.pathname);
}

function footer() {
  const name = state.site?.site?.name || 'BURGER SKIN';
  mount($('#foot'), html`<div class="foot-in">
    <div><a class="logo" href="/" style="padding:0;margin-bottom:10px"><img src="/img/brand/logo.svg" alt=""><b>BURGER <i>SKIN</i></b></a>
      <p class="muted sm">${state.site?.site?.tagline || 'Сочные кейсы CS2'}. Открывайте кейсы, улучшайте предметы, участвуйте в битвах и проверяйте честность каждого результата.</p>
      <div class="row gap"><span class="age">18+</span><span class="xs dim">Сервис предназначен только для совершеннолетних. Играйте ответственно.</span></div></div>
    <div><h4>Разделы</h4><a href="/cases">Кейсы</a><a href="/skins">Каталог скинов</a><a href="/battles">Битвы кейсов</a><a href="/upgrade">Апгрейд</a><a href="/contracts">Контракты</a><a href="/games">Игры</a></div>
    <div><h4>Активности</h4><a href="/pass">BURGER PASS</a><a href="/bonuses">Бонусы</a><a href="/events">События</a><a href="/tournaments">Турниры</a><a href="/leaderboard">Рейтинг</a><a href="/news">Новости</a></div>
    <div><h4>Помощь</h4><a href="/support">Поддержка</a><a href="/fair">Provably Fair</a><a href="/rules">Правила</a><a href="/privacy">Конфиденциальность</a><a href="/balance">Баланс</a></div>
    <div class="foot-note"><span>© ${new Date().getFullYear()} ${name}. Все суммы указаны в рублях (₽). Пополнение и вывод доступны только через подключённые и проверенные платёжные провайдеры.</span><span>${name} не связан с Valve Corporation. Counter-Strike и Steam — товарные знаки Valve Corporation.</span></div>
  </div>`);
}

// ---------- лента дропов ----------
const tickerItems = [];
function tkHtml(d) {
  const it = d.item || {}; const [w, p] = splitName(it.name);
  const href = d.case?.slug ? '/cases/' + encodeURIComponent(d.case.slug) : d.user?.id ? '/u/' + d.user.id : '/cases';
  return html`<a class="tk" href="${href}" style="--rc:${cssColor(it.color)}" title="${it.name}${d.caseName || d.case?.name ? ' · ' + (d.caseName || d.case?.name) : ''}">${img(it.image, '', it.name)}<div class="tk-t"><b>${p || w}</b><span>${p ? w : ''}</span></div><div class="tk-u">${avatar(d.user, 'xs')}${d.user?.nickname || ''}</div></a>`;
}
function renderTicker() {
  const el = $('#ticker'); if (!el) return;
  if (!tickerItems.length) { el.hidden = true; return; }
  el.hidden = false;
  mount(el, html`<div class="ticker-in"><span class="ticker-label">Live</span>${tickerItems.map(tkHtml)}</div>`);
}
async function loadTicker() {
  try { const r = await api('/api/feed'); tickerItems.splice(0, tickerItems.length, ...(r.drops || []).slice(0, 30)); state.feed = r.drops || []; } catch {}
  renderTicker();
}
bus.addEventListener('drop', (e) => {
  const d = e.detail; if (!d?.item) return;
  tickerItems.unshift(d); if (tickerItems.length > 30) tickerItems.length = 30;
  const inEl = $('#ticker .ticker-in');
  if (inEl) { const tmp = document.createElement('div'); mount(tmp, tkHtml(d)); inEl.insertBefore(tmp.firstElementChild, inEl.children[1] || null); while (inEl.children.length > 31) inEl.lastElementChild.remove(); $('#ticker').hidden = false; }
  else renderTicker();
});

// ---------- служебное ----------
function markActive(path) {
  for (const a of $$('[data-nav]')) { const h = a.dataset.nav; a.classList.toggle('on', path === h || path.startsWith(h + '/')); }
  for (const a of $$('[data-tab-nav]')) { const h = a.dataset.tabNav; a.classList.toggle('on', h === '/' ? path === '/' : path === h || path.startsWith(h + '/')); }
  for (const a of $$('.drawer-p a')) a.classList.toggle('on', a.getAttribute('href') === path);
  fitNav();
}

// ---------- шапка: пункты, которым не хватает места, уходят в меню «Ещё» (без наложений) ----------
function fitNav() {
  const nav = $('#top .nav');
  if (!nav || getComputedStyle(nav).display === 'none') return;
  const more = nav.querySelector('[data-more]');
  const pri = [...nav.querySelectorAll('[data-pri]')].filter((el) => +el.dataset.pri > 0).sort((a, b) => a.dataset.pri - b.dataset.pri);
  nav.classList.remove('compact');
  for (const el of pri) el.classList.remove('nav-hide');
  if (more) more.classList.remove('show');
  const over = () => { const lim = nav.getBoundingClientRect().right + 0.5; let m = 0; for (const c of nav.children) m = Math.max(m, c.getBoundingClientRect().right); return m > lim; };
  const hidden = [];
  for (const el of pri) { if (!over()) break; el.classList.add('nav-hide'); hidden.push(el); if (more) more.classList.add('show'); }
  if (over()) nav.classList.add('compact');
  if (more) {
    const set = new Set(hidden.map((el) => el.getAttribute('href')));
    for (const a of more.querySelectorAll('[data-more-for]')) a.hidden = !set.has(a.dataset.moreFor);
    more.classList.toggle('on', hidden.some((el) => el.classList.contains('on')));
  }
}
let fitRaf = 0;
addEventListener('resize', () => { cancelAnimationFrame(fitRaf); fitRaf = requestAnimationFrame(fitNav); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitNav());
function closeMenus() { for (const d of $$('[data-dd].open')) d.classList.remove('open'); }
function drawer(open) { const d = $('#drawer'); d.classList.toggle('open', open); d.setAttribute('aria-hidden', open ? 'false' : 'true'); document.body.classList.toggle('noscroll', open); }
function maintenance() {
  const m = state.site?.maintenance; const el = $('#maint');
  if (m?.enabled) { el.hidden = false; el.textContent = (m.message || 'Идут технические работы') + (can('admin.access') ? ' — вы видите сайт как сотрудник.' : ''); } else el.hidden = true;
}
function applySite(s) { state.site = s; state.features = s.features || {}; state.online = s.online || state.online; maintenance(); }

setHeaderRenderer(header);
setAfterRender((path, opt) => { markActive(path); closeMenus(); drawer(false); document.body.classList.toggle('in-admin', path.startsWith('/admin')); $('#foot').hidden = path.startsWith('/admin'); $('#ticker').hidden = path.startsWith('/admin') || !tickerItems.length; });

document.addEventListener('click', async (e) => {
  const t = e.target;
  const dd = t.closest('[data-dd] > button');
  if (dd) { const box = dd.parentElement; const was = box.classList.contains('open'); closeMenus(); if (!was) box.classList.add('open'); e.preventDefault(); return; }
  if (!t.closest('[data-dd] .dd-menu')) closeMenus();
  if (t.closest('[data-drawer]')) { drawer(true); return; }
  if (t.closest('[data-drawer-close]')) { drawer(false); return; }
  if (t.closest('[data-reload]')) { location.reload(); return; }
  if (t.closest('[data-logout]')) {
    e.preventDefault();
    try { await api('/api/auth/logout', {}); } catch {}
    state.me = null; renderHeader(); toast('Вы вышли из аккаунта', 'ok'); go('/'); return;
  }
  const a = t.closest('a[href]');
  if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const href = a.getAttribute('href');
  if (!href || !href.startsWith('/') || href.startsWith('//') || a.target || a.hasAttribute('data-native') || a.hasAttribute('download')) return;
  if (/^\/(api|r|uploads|img)\//.test(href)) return;
  e.preventDefault();
  closeMenus(); drawer(false);
  if (href === location.pathname + location.search) { render({ keepScroll: false }); return; }
  go(href);
});
window.addEventListener('popstate', () => render({ keepScroll: true }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenus(); drawer(false); const m = $$('.modal-bg').pop(); if (m) m.querySelector('.modal-x')?.click(); } });
// Подмена битых картинок фирменной заглушкой (один раз).
document.addEventListener('error', (e) => { const el = e.target; if (el?.tagName === 'IMG' && !el.dataset.fb) { el.dataset.fb = '1'; el.src = '/img/brand/item.svg'; } }, true);

// ---------- живые события ----------
bus.addEventListener('balance', (e) => { if (typeof e.detail?.balance === 'number' && state.me) { state.me.balance = e.detail.balance; for (const el of $$('[data-balance]')) el.textContent = money(e.detail.balance); } });
let hintTimer = 0;
bus.addEventListener('balance_hint', () => { clearTimeout(hintTimer); hintTimer = setTimeout(() => { if (state.me) refreshMe(); }, 400); });
bus.addEventListener('notify', (e) => {
  const n = e.detail || {}; if (!state.me) return;
  state.me.unread = (state.me.unread || 0) + 1; renderHeader();
  toast(html`<b>${n.title || 'Уведомление'}</b>${n.body || ''}${n.link ? html`<div class="mt" style="margin-top:6px"><a href="${n.link}">Открыть →</a></div>` : ''}`, 'info', 7000);
});
bus.addEventListener('online', (e) => { const n = e.detail?.n ?? e.detail?.online; if (typeof n === 'number') { state.online = n; for (const el of $$('[data-online]')) el.textContent = n + ' онлайн'; } });
bus.addEventListener('settings', async () => { try { applySite(await api('/api/site')); renderHeader(); footer(); } catch {} });
setInterval(async () => { try { const s = await api('/api/site'); state.online = s.online; for (const el of $$('[data-online]')) el.textContent = s.online + ' онлайн'; if (JSON.stringify(s.maintenance) !== JSON.stringify(state.site?.maintenance)) { applySite(s); } } catch {} }, 60000);

// ---------- запуск ----------
(async function boot() {
  try { applySite(await api('/api/site')); } catch { state.site = { site: { name: 'BURGER SKIN' }, features: {} }; }
  try { const r = await api('/api/me'); state.me = r.user || null; } catch { state.me = null; }
  header(); footer(); startLive(); loadTicker();
  await render();
})();
