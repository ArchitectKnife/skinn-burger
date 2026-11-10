// BURGER SKIN — ядро клиента: API, шаблоны, роутер, уведомления, живые события.
export const state = { me: null, site: null, features: {}, online: 0, feed: [] };
export const bus = new EventTarget();

// ---------- безопасные шаблоны ----------
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s ?? ''));
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"'`]/g, (c) => ESC[c]);
const fmt = (v) => (v == null || v === false || v === true ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(fmt).join('') : esc(v));
export function html(strings, ...vals) { let o = strings[0]; for (let i = 0; i < vals.length; i++) o += fmt(vals[i]) + strings[i + 1]; return new Raw(o); }
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export function mount(el, content) { if (el) el.innerHTML = fmt(content); return el; }
export function safeUrl(u, fb = '') { u = String(u || ''); if (/^\/(?!\/)/.test(u) || /^https:/i.test(u) || /^data:image\/(png|jpe?g|webp|gif);/i.test(u)) return u; return fb; }
export const cssColor = (c, fb = '#8a8f9c') => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : fb);
export function uid() { const a = new Uint8Array(16); crypto.getRandomValues(a); return [...a].map((x) => x.toString(16).padStart(2, '0')).join(''); }
export function on(root, type, sel, fn) { root.addEventListener(type, (e) => { const t = e.target.closest(sel); if (t && root.contains(t)) fn(e, t); }); }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- API ----------
export class ApiError extends Error { constructor(m, status, code, data) { super(m); this.status = status; this.code = code; this.data = data; } }
function cookie(n) { const m = document.cookie.split('; ').find((x) => x.startsWith(n + '=')); return m ? decodeURIComponent(m.slice(n.length + 1)) : ''; }
export async function api(path, body, method) {
  method = method || (body === undefined ? 'GET' : 'POST');
  const headers = { Accept: 'application/json' };
  const opt = { method, headers, credentials: 'same-origin' };
  if (method !== 'GET') { headers['Content-Type'] = 'application/json'; headers['X-CSRF-Token'] = cookie('bs_csrf'); headers['Idempotency-Key'] = uid(); opt.body = JSON.stringify(body ?? {}); }
  let r;
  try { r = await fetch(path, opt); } catch { throw new ApiError('Нет соединения с сервером. Проверьте подключение к интернету.', 0, 'network'); }
  let data = null;
  try { data = await r.json(); } catch {}
  if (!r.ok) {
    if (r.status === 401 && state.me && data?.code === 'auth_required') { state.me = null; renderHeader(); }
    throw new ApiError(data?.error || `Ошибка сервера (${r.status})`, r.status, data?.code, data);
  }
  if (data && typeof data.balance === 'number' && state.me && !path.startsWith('/api/admin')) setBalance(data.balance);
  return data;
}
export const qs = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== '' && v != null && v !== false) p.set(k, v === true ? '1' : v); const s = p.toString(); return s ? '?' + s : ''; };

// ---------- форматирование ----------
const nf = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfi = new Intl.NumberFormat('ru-RU');
export const money = (c) => nf.format((Number(c) || 0) / 100);
// Единый формат валюты сайта: 1 250,00 ₽ (суммы хранятся в копейках).
export const CURRENCY = { code: 'RUB', sign: '₽' };
export const rub = (c) => money(c) + ' ₽';
export const num = (n) => nfi.format(Number(n) || 0);
export const bc = (c, cls = '') => html`<span class="bc ${cls}">${rub(c)}</span>`;
export function pct(x) { const v = (Number(x) || 0) * 100; return (v >= 10 ? v.toFixed(1) : v >= 1 ? v.toFixed(2) : v >= 0.01 ? v.toFixed(3) : v.toFixed(4)).replace('.', ',') + '%'; }
export const fdate = (t) => (t ? new Date(t).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
export const fday = (t) => (t ? new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—');
export function ago(t) { const s = Math.max(0, (Date.now() - t) / 1000); if (s < 60) return 'только что'; if (s < 3600) return Math.floor(s / 60) + ' мин назад'; if (s < 86400) return Math.floor(s / 3600) + ' ч назад'; return fdate(t); }
export function left(t) { let s = Math.max(0, Math.floor((t - Date.now()) / 1000)); const d = Math.floor(s / 86400); s %= 86400; const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); return d ? `${d} д ${h} ч` : h ? `${h} ч ${m} мин` : `${m} мин ${s % 60} с`; }
export const toCents = (v) => Math.round(parseFloat(String(v).replace(',', '.')) * 100) || 0;

export const WEARS = { FN: 'Прямо с завода', MW: 'Немного поношенное', FT: 'После полевых испытаний', WW: 'Поношенное', BS: 'Закалённое в боях' };
export const RARITY_RU = { 'Consumer Grade': 'Ширпотреб', 'Industrial Grade': 'Промышленное', 'Mil-Spec Grade': 'Армейское', Restricted: 'Запрещённое', Classified: 'Засекреченное', Covert: 'Тайное', Extraordinary: 'Экстраординарное', Contraband: 'Контрабанда', 'Base Grade': 'Базовое', 'High Grade': 'Высшее', Remarkable: 'Примечательное', Exotic: 'Экзотичное', Superior: 'Превосходное', Distinguished: 'Заслуженное', Exceptional: 'Исключительное', Master: 'Мастерское' };
export const rarityRu = (n) => RARITY_RU[n] || n || '—';
export const GAMES = { case: 'Кейс', upgrade: 'Апгрейд', contract: 'Контракт', battle: 'Битва кейсов', crash: 'Crash', double: 'Double', jackpot: 'Jackpot', coinflip: 'Coinflip', roulette: 'Рулетка', mines: 'Mines', towers: 'Towers' };
export const LEDGER = { case: 'Открытие кейса', sell: 'Продажа предмета', bet: 'Ставка', win: 'Выигрыш', achievement: 'Достижение', referral: 'Реферальный бонус', bonus: 'Бонус', quest: 'Задание', promo: 'Промокод', pass: 'BURGER PASS', pass_premium: 'Премиум BURGER PASS', event: 'Событие', admin: 'Корректировка администрацией', deposit: 'Пополнение', refund: 'Возврат', battle: 'Битва кейсов' };
export const INV_STATUS = { owned: 'В инвентаре', sold: 'Продан', upgraded: 'Ушёл в апгрейд', contracted: 'Ушёл в контракт', withdrawing: 'Выводится', withdrawn: 'Выведен' };
export const ROLES = { USER: 'Игрок', SUPPORT: 'Поддержка', MODERATOR: 'Модератор', ADMIN: 'Администратор', OWNER: 'Владелец', BOT: 'Бот' };
export const can = (p) => !!state.me?.perms?.includes(p);

// ---------- компоненты ----------
export function splitName(n) { n = String(n || ''); const i = n.indexOf(' | '); return i < 0 ? [n, ''] : [n.slice(0, i), n.slice(i + 3)]; }
export function img(src, cls = '', alt = '') { return html`<img class="${cls}" src="${safeUrl(src, '/img/brand/item.svg')}" alt="${alt}" loading="lazy" decoding="async">`; }
export function itemCard(it, o = {}) {
  const [w, p] = splitName(it.name);
  const badges = [];
  if (it.variant === 'st') badges.push(html`<span class="tag st">ST™</span>`);
  if (it.variant === 'sv') badges.push(html`<span class="tag sv">SV</span>`);
  if (it.wear) badges.push(html`<span class="tag" title="${WEARS[it.wear] || it.wear}">${it.wear}</span>`);
  if (o.chance != null) badges.push(html`<span class="tag ch">${pct(o.chance)}</span>`);
  const tag = o.href ? 'a' : 'div';
  return html`<${raw(tag)} class="item ${o.cls || ''} ${o.selected ? 'sel' : ''}" style="--rc:${cssColor(it.color)}" ${o.href ? raw(`href="${esc(o.href)}"`) : ''} ${o.id != null ? raw(`data-id="${esc(o.id)}"`) : ''} title="${it.name}${it.wear ? ' · ' + (WEARS[it.wear] || it.wear) : ''}">
    <div class="item-badges">${badges}</div>
    <div class="item-img">${img(it.image, '', it.name)}</div>
    <div class="item-w">${w}</div><div class="item-p">${p || rarityRu(it.rarityName)}</div>
    ${o.price === false ? '' : html`<div class="item-price">${bc(o.priceValue ?? it.price ?? it.minPrice)}</div>`}
    ${o.extra || ''}
  </${raw(tag)}>`;
}
/** Обложка кейса: композиция из 1–3 реальных предметов или загруженное изображение. */
export function coverHtml(c, cls = '') {
  const cv = c && c.cover;
  const its = cv && cv.mode !== 'image' && Array.isArray(cv.items) ? cv.items.filter((x) => x && x.image).slice(0, 3) : [];
  if (its.length) return html`<div class="cover n${its.length} ${cls}" style="--ac:${cssColor(its[0].color, '#FFB627')}">${its.map((it) => html`<img src="${safeUrl(it.image, '/img/brand/item.svg')}" alt="${it.name || ''}" loading="lazy" decoding="async">`)}</div>`;
  return html`<div class="cover n1 ${cls}">${img((cv && cv.image) || (c && c.image), '', c && c.name)}</div>`;
}
export function caseCard(c) {
  return html`<a class="case" href="/cases/${encodeURIComponent(c.slug)}" style="--ac:${cssColor(c.accent, '#FFB627')}">
    <div class="case-glow"></div>
    <div class="case-img">${coverHtml(c)}</div>
    <div class="case-name">${c.name}</div>
    <div class="case-meta"><span class="case-price">${bc(c.price)}</span>${c.opens ? html`<span class="muted sm">${num(c.opens)} откр.</span>` : html`<span class="muted sm">${c.items || ''} предм.</span>`}</div>
  </a>`;
}
const hue = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };
export function avatar(u, cls = '') { const src = safeUrl(u?.avatar); const n = String(u?.nickname || '?').trim() || '?'; return src ? html`<img class="ava ${cls}" src="${src}" alt="" loading="lazy">` : html`<span class="ava ${cls}" style="--h:${hue(n)}">${n[0].toUpperCase()}</span>`; }
export const userLink = (u, cls = '') => (!u?.id || u.role === 'BOT' ? html`<span class="ulink ${cls}">${avatar(u)}<span>${u?.nickname || 'Игрок'}</span></span>` : html`<a class="ulink ${cls}" href="/u/${u.id}">${avatar(u)}<span>${u.nickname}</span></a>`);
export const empty = (text, action = '') => html`<div class="empty"><img src="/img/brand/logo.svg" alt=""><p>${text}</p>${action}</div>`;
export const loader = () => html`<div class="loader"><span></span><span></span><span></span></div>`;
export function pager(page, total, size) { const pages = Math.max(1, Math.ceil(total / size)); if (pages <= 1) return ''; const b = []; const from = Math.max(1, page - 2), to = Math.min(pages, page + 2); if (from > 1) b.push(html`<button class="pg" data-page="1">1</button>${from > 2 ? html`<span class="muted">…</span>` : ''}`); for (let i = from; i <= to; i++) b.push(html`<button class="pg ${i === page ? 'on' : ''}" data-page="${i}">${i}</button>`); if (to < pages) b.push(html`${to < pages - 1 ? html`<span class="muted">…</span>` : ''}<button class="pg" data-page="${pages}">${pages}</button>`); return html`<div class="pager">${b}</div>`; }
export const head = (title, sub = '', right = '') => html`<div class="page-head"><div><h1>${title}</h1>${sub ? html`<p class="muted">${sub}</p>` : ''}</div>${right ? html`<div class="page-head-r">${right}</div>` : ''}</div>`;
export const tabs = (list, cur, attr = 'data-tab') => html`<div class="tabs">${list.map(([k, l]) => html`<button class="tab ${k === cur ? 'on' : ''}" ${raw(attr)}="${k}">${l}</button>`)}</div>`;
export const notice = (text, type = 'info') => html`<div class="notice ${type}">${text}</div>`;
export function fairBadge(x) { if (!x?.serverHash) return ''; return html`<details class="fair-mini"><summary>Provably Fair</summary><div class="mono sm">Хеш сида сервера: ${x.serverHash}<br>Сид клиента: ${x.clientSeed || '—'} · Nonce: ${x.nonce ?? '—'}</div><a href="/fair" class="sm">Проверить результат →</a></details>`; }

// ---------- уведомления, модальные окна ----------
export function toast(msg, type = 'info', ms = 4200) {
  const box = $('#toasts'); if (!box) return;
  const el = document.createElement('div'); el.className = 'toast ' + type; mount(el, msg instanceof Raw ? msg : html`${msg}`);
  box.append(el); requestAnimationFrame(() => el.classList.add('in'));
  const close = () => { el.classList.remove('in'); setTimeout(() => el.remove(), 300); };
  el.addEventListener('click', close); setTimeout(close, ms);
}
export const fail = (e) => toast(e?.message || String(e), 'err');
export function modal(content, o = {}) {
  const root = $('#modals'); const wrap = document.createElement('div'); wrap.className = 'modal-bg';
  wrap.innerHTML = `<div class="modal ${o.wide ? 'wide' : ''}" role="dialog" aria-modal="true"><button class="modal-x" aria-label="Закрыть">×</button><div class="modal-body"></div></div>`;
  const body = $('.modal-body', wrap); mount(body, content); root.append(wrap); document.body.classList.add('noscroll');
  let closed = false;
  const close = () => { if (closed) return; closed = true; wrap.classList.remove('in'); setTimeout(() => { wrap.remove(); if (!root.children.length) document.body.classList.remove('noscroll'); }, 200); o.onClose?.(); };
  wrap.addEventListener('click', (e) => { if ((e.target === wrap && !o.sticky) || e.target.closest('.modal-x') || e.target.closest('[data-close]')) close(); });
  requestAnimationFrame(() => wrap.classList.add('in'));
  return { el: body, close };
}
export function confirmBox(text, ok = 'Подтвердить', danger = false) {
  return new Promise((res) => { let v = false; const m = modal(html`<h3>${text}</h3><div class="row end gap"><button class="btn ghost" data-close>Отмена</button><button class="btn ${danger ? 'red' : ''}" data-ok>${ok}</button></div>`, { onClose: () => res(v) }); $('[data-ok]', m.el).addEventListener('click', () => { v = true; m.close(); }); });
}
// Форма в модальном окне. fields: [{name,label,type,value,options,required,placeholder,min,max,step}]
export function formBox(title, fields, ok = 'Сохранить') {
  return new Promise((res) => { let v = null; const m = modal(html`<h3>${title}</h3><form class="form">${fields.map(field)}<div class="row end gap"><button type="button" class="btn ghost" data-close>Отмена</button><button class="btn">${ok}</button></div></form>`, { onClose: () => res(v) }); $('form', m.el).addEventListener('submit', (e) => { e.preventDefault(); v = formData(e.target); m.close(); }); $('input,textarea,select', m.el)?.focus(); });
}
export function field(f) {
  const id = 'f_' + f.name + '_' + Math.random().toString(36).slice(2, 6);
  const req = f.required ? raw('required') : '';
  let input;
  if (f.type === 'select') input = html`<select id="${id}" name="${f.name}" ${req}>${Object.entries(f.options || {}).map(([k, l]) => html`<option value="${k}" ${String(f.value ?? '') === String(k) ? raw('selected') : ''}>${l}</option>`)}</select>`;
  else if (f.type === 'textarea') input = html`<textarea id="${id}" name="${f.name}" rows="${f.rows || 4}" placeholder="${f.placeholder || ''}" ${req} ${f.max ? raw(`maxlength="${Number(f.max)}"`) : ''}>${f.value ?? ''}</textarea>`;
  else if (f.type === 'checkbox') return html`<label class="check"><input type="checkbox" name="${f.name}" ${f.value ? raw('checked') : ''}><span>${f.label}</span></label>`;
  else input = html`<input id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${f.value ?? ''}" placeholder="${f.placeholder || ''}" ${req} ${f.min != null ? raw(`min="${esc(f.min)}"`) : ''} ${f.max != null && f.type === 'number' ? raw(`max="${esc(f.max)}"`) : ''} ${f.step ? raw(`step="${esc(f.step)}"`) : ''} ${f.auto ? raw(`autocomplete="${esc(f.auto)}"`) : ''}>`;
  return html`<label class="fld" for="${id}"><span>${f.label}</span>${input}${f.hint ? html`<small class="muted">${f.hint}</small>` : ''}</label>`;
}
export function formData(form) { const o = {}; for (const el of form.elements) { if (!el.name) continue; if (el.type === 'checkbox') o[el.name] = el.checked; else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; } else if (el.multiple) o[el.name] = [...el.selectedOptions].map((x) => x.value); else o[el.name] = el.value; } return o; }
// Обёртка для кнопок/форм: блокирует повторное нажатие на время запроса.
export async function busy(btn, fn) { if (btn?.disabled) return; const prev = btn?.innerHTML; if (btn) { btn.disabled = true; btn.classList.add('busy'); } try { return await fn(); } catch (e) { fail(e); } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.classList.remove('busy'); if (prev != null && btn.innerHTML !== prev && btn.dataset.keep == null) btn.innerHTML = prev; } } }
export function bindForm(form, fn) { form.addEventListener('submit', (e) => { e.preventDefault(); const btn = form.querySelector('button[type=submit],button:not([type])'); busy(btn, () => fn(formData(form), form)); }); }

// ---------- баланс и шапка ----------
export function setBalance(c) { if (!state.me) return; state.me.balance = c; for (const el of $$('[data-balance]')) { el.textContent = rub(c); el.classList.remove('pulse'); void el.offsetWidth; el.classList.add('pulse'); } }
export async function refreshMe() { try { const r = await api('/api/me'); state.me = r.user; } catch { } renderHeader(); return state.me; }
let headerRenderer = () => {};
export const setHeaderRenderer = (fn) => { headerRenderer = fn; };
export const renderHeader = () => headerRenderer();

// ---------- роутер ----------
const routes = [];
let notFound = null;
export function page(path, fn, opt = {}) { const keys = []; const re = new RegExp('^' + path.replace(/\/:(\w+)/g, (_, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$'); routes.push({ re, keys, fn, opt }); }
export const setNotFound = (fn) => { notFound = { fn, keys: [], opt: { title: 'Страница не найдена' } }; };
let token = 0; let cleanups = []; let afterRender = () => {};
export const setAfterRender = (fn) => { afterRender = fn; };
export function go(url, o = {}) { if (o.replace) history.replaceState(null, '', url); else history.pushState(null, '', url); return render(o); }
export function setQuery(params) { const u = new URL(location.href); for (const [k, v] of Object.entries(params)) { if (v === '' || v == null || v === false) u.searchParams.delete(k); else u.searchParams.set(k, v); } history.replaceState(null, '', u.pathname + u.search); }
export async function render(o = {}) {
  const my = ++token; for (const f of cleanups.splice(0)) { try { f(); } catch {} }
  const u = new URL(location.href); let m = null; let r = null;
  for (const x of routes) { m = u.pathname.match(x.re); if (m) { r = x; break; } }
  if (!r) r = notFound;
  const params = {}; r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch { params[k] = m[i + 1]; } });
  const app = $('#app'); const el = document.createElement('div'); el.className = 'page ' + (r.opt.cls || ''); app.replaceChildren(el);
  document.title = (r.opt.title ? r.opt.title + ' — ' : '') + (state.site?.site?.name || 'BURGER SKIN');
  afterRender(u.pathname, r.opt);
  if (!o.keepScroll) window.scrollTo(0, 0);
  const ctx = {
    params, q: u.searchParams, el, path: u.pathname,
    alive: () => my === token,
    cleanup: (f) => cleanups.push(f),
    on(name, fn) { const h = (e) => { if (my === token) fn(e.detail); }; bus.addEventListener(name, h); cleanups.push(() => bus.removeEventListener(name, h)); },
    every(ms, fn) { const t = setInterval(() => { if (my === token) fn(); }, ms); cleanups.push(() => clearInterval(t)); },
    later(ms, fn) { const t = setTimeout(() => { if (my === token) fn(); }, ms); cleanups.push(() => clearTimeout(t)); },
    frame(fn) { let id = 0; const loop = (t) => { if (my !== token) return; fn(t); id = requestAnimationFrame(loop); }; id = requestAnimationFrame(loop); cleanups.push(() => cancelAnimationFrame(id)); },
  };
  if (r.opt.auth && !state.me) return mount(el, needLogin());
  if (r.opt.staff && !can('admin.access')) return mount(el, html`<div class="wrap">${empty('Раздел доступен только сотрудникам BURGER SKIN.', html`<a class="btn" href="/">На главную</a>`)}</div>`);
  mount(el, html`<div class="wrap">${loader()}</div>`);
  try { await r.fn(ctx); } catch (e) { if (my === token) mount(el, errorView(e)); }
}
export function needLogin() { return html`<div class="wrap narrow"><div class="card center pad-xl"><img src="/img/brand/logo.svg" class="logo-big" alt=""><h2>Нужно войти в аккаунт</h2><p class="muted">Войдите или зарегистрируйтесь, чтобы открыть этот раздел.</p><div class="row center gap"><a class="btn" href="/login?next=${encodeURIComponent(location.pathname + location.search)}">Войти</a><a class="btn ghost" href="/register">Регистрация</a>${state.features.steam ? html`<a class="btn steam" href="/api/auth/steam" data-native>Войти через Steam</a>` : ''}</div></div></div>`; }
export function errorView(e) { if (e?.status === 404) return html`<div class="wrap">${empty('Ничего не найдено. Возможно, страница была удалена или ссылка устарела.', html`<a class="btn" href="/">На главную</a>`)}</div>`; if (e?.status === 401) return needLogin(); return html`<div class="wrap">${empty(e?.message || 'Не удалось загрузить страницу', html`<button class="btn" data-reload>Обновить</button>`)}</div>`; }

// ---------- живые события (SSE) ----------
// Пока игрок смотрит рулетку или кинодроп, его собственный дроп не попадает в ленту Live —
// иначе лента показала бы выпавший скин раньше, чем он появится в сцене. Чужие дропы идут как обычно.
let feedHold = 0; const heldDrops = [];
const isMine = (d) => !!state.me && !!d?.user && (d.user.id != null ? d.user.id === state.me.id : d.user.nickname === state.me.nickname);
function holdMine(d) { if (!feedHold || !isMine(d)) return false; heldDrops.push(d); return true; }
export function holdFeed(on) {
  if (on) { feedHold++; return; }
  feedHold = Math.max(0, feedHold - 1);
  if (!feedHold) for (const d of heldDrops.splice(0)) bus.dispatchEvent(new CustomEvent('drop', { detail: d }));
}
const EVENTS = ['balance', 'balance_hint', 'battle', 'coinflip', 'crash', 'double', 'drop', 'jackpot', 'notify', 'pass', 'roulette', 'settings', 'staff_ticket', 'online'];
let es = null; let esTimer = 0;
export function startLive() {
  if (!window.EventSource) return; if (es) es.close(); clearTimeout(esTimer);
  es = new EventSource('/api/live');
  for (const n of EVENTS) es.addEventListener(n, (m) => { let d = {}; try { d = JSON.parse(m.data); } catch {} if (n === 'drop' && holdMine(d)) return; bus.dispatchEvent(new CustomEvent(n, { detail: d })); });
  es.onerror = () => { es.close(); es = null; esTimer = setTimeout(startLive, 4000); };
}

// ---------- анимация ленты (кейсы, битвы) ----------
export function weightedPick(pool) { const tot = pool.reduce((s, x) => s + Math.sqrt(x.chance || 0.01), 0); let r = Math.random() * tot; for (const x of pool) { r -= Math.sqrt(x.chance || 0.01); if (r <= 0) return x; } return pool[pool.length - 1]; }
export function reelHtml(pool, winner, n = 60, win = 50, cls = '') {
  const list = []; for (let i = 0; i < n; i++) list.push(i === win ? winner : weightedPick(pool));
  return html`<div class="reel ${cls}"><div class="reel-mark"></div><div class="reel-track">${list.map((it, i) => html`<div class="reel-it ${i === win ? 'win' : ''}" style="--rc:${cssColor(it.color)}">${img(it.image)}<span>${splitName(it.name)[1] || it.name}</span></div>`)}</div></div>`;
}
export function spinReel(reelEl, { win = 50, duration = 6500, vertical = false } = {}) {
  return new Promise((res) => {
    const track = $('.reel-track', reelEl); const it = track.children[win];
    if (!it) return res();
    const size = vertical ? reelEl.clientHeight : reelEl.clientWidth;
    const pos = vertical ? it.offsetTop : it.offsetLeft; const len = vertical ? it.offsetHeight : it.offsetWidth;
    const target = pos + len * (0.18 + Math.random() * 0.64) - size / 2;
    track.style.transition = 'none'; track.style.transform = 'translate3d(0,0,0)'; void track.offsetWidth;
    track.style.transition = `transform ${duration}ms cubic-bezier(.08,.62,.1,1)`;
    track.style.transform = vertical ? `translate3d(0,${-target}px,0)` : `translate3d(${-target}px,0,0)`;
    // Завершение только по своей анимации transform: transitionend от карточек внутри ленты всплывает
    // и раньше преждевременно «останавливало» рулетку и подсвечивало выпавший предмет.
    let done = false;
    const onEnd = (e) => { if (e.target === track && e.propertyName === 'transform') fin(); };
    const fin = () => { if (done) return; done = true; track.removeEventListener('transitionend', onEnd); it.classList.add('hit'); reelEl.classList.add('done'); res(); };
    track.addEventListener('transitionend', onEnd); setTimeout(fin, duration + 120);
  });
}
