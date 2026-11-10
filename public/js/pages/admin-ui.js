// BURGER SKIN — общие элементы админ-панели: меню, графики, формы.
import { state, html, raw, mount, $, can, head, modal, formData, num, bc } from '../core.js';
import { icon } from '../icons.js';

export const NAV = [
  ['Обзор', [['/admin', 'Дашборд', 'dashboard', 'admin.access'], ['/admin/users', 'Пользователи', 'friends', 'users.view'], ['/admin/suspicious', 'Подозрительная активность', 'flag', 'users.view']]],
  ['Каталог', [['/admin/cases', 'Кейсы', 'cases', 'cases.manage'], ['/admin/items', 'Скины', 'skins', 'items.manage'], ['/admin/import', 'Импорт и цены', 'download', 'items.manage'], ['/admin/news', 'Новости и акции', 'news', 'news.manage']]],
  ['Игры и бонусы', [['/admin/games', 'Игры', 'games', 'games.manage'], ['/admin/pass', 'BURGER PASS', 'pass', 'pass.manage'], ['/admin/promo', 'Промокоды', 'tag', 'bonuses.manage'], ['/admin/quests', 'Задания', 'quests', 'bonuses.manage'], ['/admin/achievements', 'Достижения', 'trophy', 'bonuses.manage'], ['/admin/events', 'События и турниры', 'events', 'bonuses.manage']]],
  ['Операции', [['/admin/finance', 'Пополнения и выводы', 'card', 'finance.manage'], ['/admin/support', 'Поддержка', 'message', 'support.manage']]],
  ['Система', [['/admin/sound', 'Звук', 'volume', 'settings.manage'], ['/admin/drops', 'Кинодропы', 'trophy', 'settings.manage'], ['/admin/upgrader', 'Апгрейдер', 'upgrade', 'games.manage'], ['/admin/covers', 'Обложки кейсов', 'image', 'cases.manage'], ['/admin/wishlist', 'Премиум-каталог', 'gem', 'cases.manage'], ['/admin/settings', 'Настройки', 'wrench', 'admin.access'], ['/admin/roles', 'Роли и права', 'key', 'users.roles'], ['/admin/audit', 'Журнал аудита', 'scroll', 'audit.view'], ['/admin/errors', 'Журнал ошибок', 'alert', ['settings.manage', 'games.manage']], ['/admin/backups', 'Резервные копии', 'backup', 'backup.manage']]],
];
export const allowed = (p) => (Array.isArray(p) ? p.some((x) => can(x)) : can(p));
export const ROLE_RU = { OWNER: 'Владелец', ADMIN: 'Администратор', MODERATOR: 'Модератор', SUPPORT: 'Поддержка', USER: 'Игрок' };
export const roleBadge = (r) => html`<span class="badge ${r === 'OWNER' ? 'vio' : r === 'ADMIN' ? 'err' : r === 'USER' ? '' : 'info'}">${ROLE_RU[r] || r}</span>`;

export function shell(ctx, cur, title, body = '', right = '') {
  const isOn = (h) => h === cur || (h !== '/admin' && cur.startsWith(h + '/'));
  mount(ctx.el, html`<div class="adm"><aside class="adm-side">
    <div class="row gap mb"><img src="/img/brand/logo.svg" alt="" style="height:30px"><b>Админ-панель</b></div>
    <div class="mb">${roleBadge(state.me.role)} <span class="muted sm">${state.me.nickname}</span></div>
    ${NAV.map(([g, links]) => { const ls = links.filter((l) => allowed(l[3])); return ls.length ? html`<div class="dd-h">${g}</div>${ls.map(([h, l, ic]) => html`<a href="${h}" class="${isOn(h) ? 'on' : ''}"><span class="ico">${icon(ic)}</span>${l}</a>`)}` : ''; })}
    <div class="dd-h">Сайт</div><a href="/"><span class="ico">${icon('arrowLeft')}</span>Вернуться на сайт</a>
  </aside><main class="adm-main">${head(title, '', right)}<div data-adm>${body}</div></main></div>`);
  return $('[data-adm]', ctx.el);
}

export function barChart(title, values, labels, o = {}) {
  const max = Math.max(1, ...values);
  const n = values.length || 1;
  const total = values.reduce((a, b) => a + b, 0);
  const fmt = o.fmt || ((x) => num(x));
  return html`<div class="card chart-box"><div class="row between"><b>${title}</b><span class="muted sm">${o.totalLabel || 'за 14 дней'}: ${fmt(total)}</span></div>
    <svg viewBox="0 0 ${n * 20} 100" preserveAspectRatio="none" style="width:100%;height:130px;display:block;margin-top:10px">${values.map((v, i) => { const h = Math.max(v > 0 ? 2 : 0, (v / max) * 96); return html`<rect x="${i * 20 + 3}" y="${100 - h}" width="14" height="${h}" rx="2" fill="${o.color || '#FFB627'}" opacity="${i === n - 1 ? 1 : 0.75}"><title>${labels[i]}: ${fmt(v)}</title></rect>`; })}</svg>
    <div class="row between xs muted">${labels.map((l, i) => (i % 3 === 0 || i === labels.length - 1 ? html`<span>${l}</span>` : ''))}</div></div>`;
}

export function askForm(title, body, ok = 'Сохранить', o = {}) {
  return new Promise((res) => {
    const m = modal(html`<h3>${title}</h3>${o.note ? html`<p class="muted sm">${o.note}</p>` : ''}<form class="form" data-ask>${body}<div class="row end gap"><button type="button" class="btn ghost" data-x>Отмена</button><button class="btn ${o.danger ? 'red' : ''}">${ok}</button></div></form>`, { wide: o.wide });
    const root = m.el || document;
    const f = root.querySelector('[data-ask]');
    root.querySelector('[data-x]').addEventListener('click', () => { m.close(); res(null); });
    f.addEventListener('submit', (e) => { e.preventDefault(); const d = formData(f); m.close(); res(d); });
  });
}
export const reasonField = (label = 'Причина (обязательно, попадёт в журнал аудита)') => html`<label class="fld"><span>${label}</span><textarea name="reason" rows="3" required minlength="5" maxlength="500"></textarea></label>`;
export const kv = (pairs) => html`<div class="kv">${pairs.filter(Boolean).map(([k, v]) => html`<span>${k}</span><span>${v ?? '—'}</span>`)}</div>`;

export function autoTable(rows, cols, o = {}) {
  if (!rows?.length) return html`<p class="muted">${o.empty || 'Нет данных'}</p>`;
  return html`<div class="tbl-wrap"><table class="tbl"><thead><tr>${cols.map((c) => html`<th class="${c.r ? 'r' : ''}">${c.t}</th>`)}</tr></thead><tbody>${rows.map((r) => html`<tr ${o.href ? raw('data-href="' + o.href(r) + '"') : ''}>${cols.map((c) => html`<td class="${c.r ? 'r' : ''} ${c.cls || ''}">${c.f ? c.f(r) : r[c.k] ?? '—'}</td>`)}</tr>`)}</tbody></table></div>`;
}

const LABELS = {
  name: 'Название', tagline: 'Слоган', logo: 'Логотип (путь к загруженному файлу)', title: 'Заголовок', subtitle: 'Подзаголовок', image: 'Изображение (путь к загруженному файлу)',
  registration: 'Регистрация новых игроков', steam: 'Вход через Steam', games: 'Мини-игры', battles: 'Case Battle', upgrade: 'Апгрейд', contracts: 'Контракты', pass: 'BURGER PASS',
  deposit: 'Пополнение (нужен одобренный провайдер)', withdraw: 'Вывод предметов (нужен провайдер)', enabled: 'Включено', message: 'Сообщение',
  sell_rate: 'Доля цены при продаже (0.5–1)', case_margin: 'Наценка кейса (0–1)', upgrade_rtp: 'RTP апгрейда (0.5–0.99)', upgrade_max_chance: 'Макс. шанс апгрейда',
  contract_min: 'Мин. предметов в контракте', contract_max: 'Макс. предметов в контракте', welcome_bonus: 'Приветственный бонус, в копейках', base: 'База, в копейках', step: 'Шаг, в копейках',
  max_streak: 'Макс. серия, дней', invitee_bonus: 'Бонус приглашённому, в копейках', inviter_bonus: 'Бонус пригласившему, в копейках', threshold_bc: 'Порог оборота приглашённого, ₽',
  min: 'Мин. ставка, в копейках', max: 'Макс. ставка, в копейках',
};
export function settingsFields(obj, prefix = '') {
  return Object.entries(obj || {}).map(([k, v]) => {
    const name = prefix ? prefix + '.' + k : k;
    const label = LABELS[k] || k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) return html`<fieldset class="card" style="padding:12px"><legend class="sm"><b>${label}</b></legend><div class="form g2">${settingsFields(v, name)}</div></fieldset>`;
    if (typeof v === 'boolean') return html`<label class="check"><input type="checkbox" name="${name}" ${v ? raw('checked') : ''}><span>${label}</span></label>`;
    if (typeof v === 'number') return html`<label class="fld"><span>${label}</span><input type="number" step="any" name="${name}" value="${v}"></label>`;
    const long = typeof v === 'string' && v.length > 60;
    return html`<label class="fld"><span>${label}</span>${long ? html`<textarea name="${name}" rows="3">${v}</textarea>` : html`<input name="${name}" value="${v ?? ''}">`}</label>`;
  });
}
export function collectSettings(form, def) {
  const out = {};
  const walk = (d, o, prefix) => {
    for (const [k, v] of Object.entries(d || {})) {
      const name = prefix ? prefix + '.' + k : k;
      if (v !== null && typeof v === 'object' && !Array.isArray(v)) { o[k] = {}; walk(v, o[k], name); continue; }
      const el = form.elements.namedItem(name);
      if (!el) { o[k] = v; continue; }
      if (typeof v === 'boolean') o[k] = !!el.checked;
      else if (typeof v === 'number') o[k] = Number(el.value);
      else o[k] = el.value;
    }
  };
  walk(def, out, '');
  return out;
}
export const toBC = (c) => (c == null ? '' : String(Math.round(c) / 100));
export const tsInput = (t) => { if (!t) return ''; const d = new Date(Number(t) + 3 * 3600000); return d.toISOString().slice(0, 16); };
export const fromTsInput = (s) => (s ? Date.parse(s + ':00+03:00') : null);
export { bc };

import { on, go, api, qs, pager, loader, notice } from '../core.js';
// Клики по строкам таблиц с data-href (кроме вложенных кнопок и полей).
export function wire(box) {
  const root = box.closest('.adm') || box;
  on(root, 'click', 'tr[data-href]', (e, t) => { if (e.target.closest('a,button,input,select,label,textarea')) return; go(t.dataset.href); });
  return root;
}
// Типовая страница-список: фильтры + таблица + постраничная навигация.
export function listPage(ctx, o) {
  const box = shell(ctx, o.cur, o.title, html`${o.top || ''}${o.filters ? html`<form class="filters" data-filter>${o.filters}<button class="btn">Показать</button></form>` : ''}<div data-list>${loader()}</div>`, o.right || '');
  const root = wire(box);
  const st = Object.assign({ page: 1 }, o.state || {});
  const list = $('[data-list]', box);
  const self = { box, root, list, st, data: null };
  self.load = async () => {
    try {
      const r = await api(o.url + qs(st));
      if (!ctx.alive()) return;
      self.data = r;
      mount(list, html`${o.render(r, st)}${pager(r.page || st.page, r.total || 0, o.size || 50)}`);
    } catch (e) { mount(list, notice(e.message, 'err')); }
  };
  on(root, 'submit', 'form[data-filter]', (e, f) => { e.preventDefault(); Object.assign(st, formData(f), { page: 1 }); self.load(); });
  on(list, 'click', '[data-page]', (e, t) => { st.page = Number(t.dataset.page) || 1; self.load(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  self.load();
  return self;
}
export const opts = (list, cur) => list.map(([v, l]) => html`<option value="${v}" ${String(v) === String(cur ?? '') ? raw('selected') : ''}>${l}</option>`);
export const statusBadge = (s, map = {}) => { const cls = { published: 'ok', active: 'ok', approved: 'ok', answered: 'info', open: 'warn', pending: 'warn', draft: '', hidden: 'warn', archived: 'err', banned: 'err', rejected: 'err', closed: '', cancelled: '', finished: 'info' }[s] ?? ''; return html`<span class="badge ${cls}">${map[s] || s}</span>`; };
export const fileBtn = (name, label = 'Загрузить файл', accept = 'image/png,image/jpeg,image/webp,image/gif') => html`<label class="btn ghost sm" style="cursor:pointer">${label}<input type="file" accept="${accept}" data-file="${name}" hidden></label>`;
