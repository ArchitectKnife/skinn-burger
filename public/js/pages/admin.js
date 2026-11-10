// BURGER SKIN — админ-панель: дашборд, пользователи, кейсы, скины, импорт.
import { page, api, html, raw, mount, $, on, toast, busy, bindForm, formData, loader, notice, num, bc, money, pct, fdate, ago, avatar, img, go, can, rarityRu, GAMES, LEDGER, INV_STATUS, confirmBox, rub } from '../core.js';
import { stat, betsTable, uploadImage, catRu } from './shared.js';
import { shell, wire, listPage, barChart, askForm, reasonField, kv, autoTable, roleBadge, ROLE_RU, toBC, opts, statusBadge, fileBtn } from './admin-ui.js';
import { auditCols, errCols } from './admin2.js';

const P = (t) => ({ staff: true, title: t + ' — админ-панель' });
const when = (r) => fdate(r.createdAt || r.created_at);
const RARITIES = ['Consumer Grade', 'Industrial Grade', 'Mil-Spec Grade', 'Restricted', 'Classified', 'Covert', 'Extraordinary', 'Contraband'];
const USER_ST = { active: 'Активен', banned: 'Заблокирован' };
const CASE_ST = { draft: 'Черновик', published: 'Опубликован', hidden: 'Скрыт', archived: 'В архиве' };
const FIN_ST = { pending: 'На рассмотрении', approved: 'Одобрена', rejected: 'Отклонена', cancelled: 'Отменена' };
const catList = (c) => (Array.isArray(c) ? c.map((k) => (typeof k === 'string' ? [k, catRu(k)] : [k.id || k.key, k.name || k.label])) : Object.entries(c || {}));
const itemCell = (it) => html`<span class="row gap">${img(it.image, 'mini-it')}<span><b style="color:${it.color || 'inherit'}">${it.name}</b>${it.rarityName ? html`<br><span class="xs muted">${rarityRu(it.rarityName)}</span>` : ''}</span></span>`;

// ---------- Дашборд ----------
const CAT_STAT = { items: 'Всего предметов', withImage: 'С изображением', localImages: 'Изображений на сервере', withPrice: 'С рыночной ценой', knives: 'Ножей', gloves: 'Перчаток', cases: 'Кейсов', weapons: 'Видов оружия' };
page('/admin', async (ctx) => {
  const box = shell(ctx, '/admin', 'Дашборд', loader());
  wire(box);
  const d = await api('/api/admin/dashboard');
  if (!ctx.alive()) return;
  const c = d.counters || {}, ch = d.charts || { days: [] };
  const fin = d.finance || {};
  const prov = Array.isArray(fin.providers) ? fin.providers : Object.values(fin.providers || {});
  const provOn = prov.filter((p) => p && (p === true || p.enabled));
  const finRows = (rows) => autoTable(rows, [{ t: 'Статус', f: (r) => statusBadge(r.status, FIN_ST) }, { t: 'Заявок', r: 1, f: (r) => num(r.n) }, { t: 'Сумма', r: 1, f: (r) => bc(r.sum) }], { empty: 'Заявок нет' });
  mount(box, html`
    <div class="stats">
      ${stat('Пользователей', num(c.users), { sub: '+' + num(c.new24h) + ' за сутки · +' + num(c.new7d) + ' за 7 дней' })}
      ${stat('Активны за 24 ч', num(c.active24h), { sub: 'онлайн сейчас: ' + num(c.online) })}
      ${stat('Открытий за 24 ч', num(c.opens24h), { sub: 'всего: ' + num(c.opensTotal) })}
      ${stat('Предметов в каталоге', num(c.items), { sub: c.itemsNoImage ? 'без изображения: ' + num(c.itemsNoImage) : 'у всех есть изображение' })}
      ${stat('Опубликовано кейсов', num(c.cases))}
      ${stat('Предметов у игроков', num(c.inventory))}
      ${stat('Внутренний баланс игроков', bc(c.balanceTotal))}
      ${stat('Заявки ждут решения', html`<a href="/admin/finance">${num(c.financePending)}</a>`)}
      ${stat('Открытых обращений', html`<a href="/admin/support">${num(c.ticketsOpen)}</a>`)}
      ${stat('Ошибок за 24 ч', num(c.errors24h), { cls: c.errors24h ? 'red' : '' })}
    </div>
    <div class="g2 mt">
      ${barChart('Регистрации', ch.registrations || [], ch.days, { color: '#7AC74F' })}
      ${barChart('Открытия кейсов', ch.opens || [], ch.days)}
      ${barChart('Активные игроки по дням', ch.active || [], ch.days, { color: '#4b69ff', totalLabel: 'сумма за 14 дней' })}
      ${barChart('Оборот ставок', ch.wagered || [], ch.days, { color: '#E63946', fmt: (v) => rub(v) })}
    </div>
    <div class="g2 mt">
      <div class="card"><h3>Игры за 7 дней</h3>${autoTable(d.games, [{ t: 'Игра', f: (r) => GAMES[r.game] || r.game }, { t: 'Ставок', r: 1, f: (r) => num(r.bets) }, { t: 'Игроков', r: 1, f: (r) => num(r.players) }, { t: 'Оборот', r: 1, f: (r) => bc(r.wagered) }, { t: 'Выплачено', r: 1, f: (r) => bc(r.paid) }, { t: 'RTP', r: 1, f: (r) => (r.wagered ? pct(r.paid / r.wagered) : '—') }], { empty: 'Ставок за неделю не было' })}</div>
      <div class="card"><h3>Операции с балансом за 7 дней</h3>${autoTable(d.ledger, [{ t: 'Тип', f: (r) => LEDGER[r.type] || r.type }, { t: 'Операций', r: 1, f: (r) => num(r.n) }, { t: 'Сумма', r: 1, f: (r) => bc(r.sum) }], { empty: 'Операций не было' })}</div>
    </div>
    <div class="g2 mt">
      <div class="card"><h3>Пополнения и выводы</h3>
        ${provOn.length ? notice('Подключено провайдеров: ' + provOn.length, 'ok') : notice('Одобренные платёжные провайдеры не подключены. Реальные пополнения и выводы отключены, финансовая аналитика появится после подключения (см. README).', 'warn')}
        <div class="g2 mt"><div><b class="sm">Пополнения</b>${finRows(fin.deposits)}</div><div><b class="sm">Выводы</b>${finRows(fin.withdrawals)}</div></div></div>
      <div class="card"><h3>Каталог</h3>${kv(Object.entries(d.catalog || {}).filter(([, v]) => typeof v !== 'object').map(([k, v]) => [CAT_STAT[k] || k, num(v)]))}<div class="row gap mt"><a class="btn ghost sm" href="/admin/items">Скины</a><a class="btn ghost sm" href="/admin/import">Импорт каталога</a></div></div>
    </div>
    <div class="card mt"><div class="row between"><h3>Последние действия сотрудников</h3>${can('audit.view') ? html`<a class="sm" href="/admin/audit">Весь журнал</a>` : ''}</div>${autoTable(d.audit, auditCols, { empty: 'Журнал пока пуст' })}</div>
    <div class="card mt"><h3>Последние ошибки сервера</h3>${autoTable(d.errors, errCols, { empty: 'Ошибок не зафиксировано' })}</div>`);
}, P('Дашборд'));

// ---------- Пользователи ----------
page('/admin/users', (ctx) => {
  listPage(ctx, {
    cur: '/admin/users', title: 'Пользователи', url: '/api/admin/users', size: 50, state: { q: '', role: '', status: '', sort: 'new' },
    filters: html`<input name="q" placeholder="Логин, email, ник, ID или IP"><select name="role">${opts([['', 'Все роли'], ...Object.entries(ROLE_RU)], '')}</select><select name="status">${opts([['', 'Любой статус'], ['active', 'Активные'], ['banned', 'Заблокированные']], '')}</select><select name="sort">${opts([['new', 'Сначала новые'], ['balance', 'По балансу'], ['seen', 'По активности']], 'new')}</select>`,
    render: (r) => html`<p class="muted sm">Найдено: ${num(r.total)}</p>${autoTable(r.rows, [
      { t: 'ID', k: 'id' },
      { t: 'Игрок', f: (u) => html`<span class="row gap">${avatar(u)}<span><b>${u.nickname}</b><br><span class="xs muted">${u.login}</span></span></span>` },
      { t: 'Email', f: (u) => u.email || '—' },
      { t: 'Роль', f: (u) => roleBadge(u.role) },
      { t: 'Статус', f: (u) => statusBadge(u.status, USER_ST) },
      { t: 'Баланс', r: 1, f: (u) => bc(u.balance) },
      { t: 'Steam', f: (u) => (u.steamId ? html`<span class="badge info">${u.steamName || 'привязан'}</span>` : '—') },
      { t: 'Регистрация', f: (u) => fdate(u.createdAt) },
      { t: 'Активность', f: (u) => (u.lastSeen ? ago(u.lastSeen) : '—') },
    ], { href: (u) => '/admin/users/' + u.id, empty: 'Пользователи не найдены' })}`,
  });
}, P('Пользователи'));

const STAT_RU = { case_open: 'Открыто кейсов', wager: 'Оборот ставок', game: 'Сыграно игр', battle: 'Битв кейсов', battle_win: 'Побед в битвах', upgrade: 'Апгрейдов', upgrade_win: 'Успешных апгрейдов', contract: 'Контрактов', daily: 'Ежедневных бонусов', friends: 'Друзей', sell: 'Продано предметов', best: 'Лучший дроп' };
const MONEY_STATS = ['wager', 'best', 'won', 'paid', 'sell_sum', 'deposit'];
const RESTR_RU = { cases: 'Кейсы, апгрейд и контракты', games: 'Игры и Case Battle', finance: 'Пополнение и вывод', bonuses: 'Бонусы и промокоды', support: 'Обращения в поддержку' };

page('/admin/users/:id', async (ctx) => {
  const box = shell(ctx, '/admin/users', 'Профиль игрока', loader(), html`<a class="btn ghost" href="/admin/users">← К списку</a>`);
  const root = wire(box);
  const base = '/api/admin/users/' + encodeURIComponent(ctx.params.id);
  let d = null; let tab = 'ledger';
  const TABS = [['ledger', 'Операции'], ['bets', 'Ставки и открытия'], ['inventory', 'Инвентарь'], ['finance', 'Заявки'], ['tickets', 'Обращения'], ['sessions', 'Сеансы'], ['sameIp', 'Общие IP'], ['audit', 'Журнал']];
  const tabBody = () => {
    if (tab === 'ledger') return autoTable(d.ledger, [{ t: 'Время', f: when }, { t: 'Тип', f: (r) => LEDGER[r.type] || r.type }, { t: 'Сумма', r: 1, f: (r) => html`<span class="${r.amount < 0 ? 'red' : 'ok'}">${r.amount > 0 ? '+' : ''}${money(r.amount)}</span>` }, { t: 'Баланс после', r: 1, f: (r) => (r.balance ?? r.balance_after) != null ? money(r.balance ?? r.balance_after) : '—' }, { t: 'Комментарий', f: (r) => r.note || r.reason || r.comment || '—' }], { empty: 'Операций нет' });
    if (tab === 'bets') return betsTable(d.bets || [], { gameCol: true, empty: 'Ставок и открытий нет' });
    if (tab === 'inventory') return autoTable(d.inventory, [{ t: 'Предмет', f: (r) => itemCell(r.item || r) }, { t: 'Качество', f: (r) => r.wear || '—' }, { t: 'Float', f: (r) => (r.float != null ? Number(r.float).toFixed(6) : '—') }, { t: 'Стоимость', r: 1, f: (r) => bc(r.price) }, { t: 'Статус', f: (r) => INV_STATUS[r.status] || r.status }, { t: 'Получен', f: when }], { empty: 'Инвентарь пуст' });
    if (tab === 'finance') return autoTable(d.finance, [{ t: 'ID', k: 'id' }, { t: 'Тип', f: (r) => (r.kind === 'deposit' ? 'Пополнение' : 'Вывод') }, { t: 'Сумма', r: 1, f: (r) => bc(r.amount) }, { t: 'Статус', f: (r) => statusBadge(r.status, FIN_ST) }, { t: 'Создана', f: when }], { empty: 'Заявок нет' });
    if (tab === 'tickets') return autoTable(d.tickets, [{ t: 'ID', k: 'id' }, { t: 'Тема', k: 'subject' }, { t: 'Статус', f: (r) => statusBadge(r.status, { open: r.statusName, answered: r.statusName, pending: r.statusName, closed: r.statusName }) }, { t: 'Создано', f: when }], { href: (r) => '/admin/support/' + r.id, empty: 'Обращений нет' });
    if (tab === 'sessions') return autoTable(d.sessions, [{ t: 'Начат', f: when }, { t: 'Активность', f: (r) => ago(r.last_seen) }, { t: 'IP', f: (r) => html`<span class="mono xs">${r.ip}</span>` }, { t: 'Браузер', f: (r) => html`<span class="xs muted">${String(r.ua || '').slice(0, 90)}</span>` }, { t: 'Истекает', f: (r) => fdate(r.expires_at) }], { empty: 'Активных сеансов нет' });
    if (tab === 'sameIp') return autoTable(d.sameIp, [{ t: 'ID', k: 'id' }, { t: 'Логин', k: 'login' }, { t: 'Ник', k: 'nickname' }, { t: 'Статус', f: (r) => statusBadge(r.status, USER_ST) }, { t: 'IP регистрации', f: (r) => html`<span class="mono xs">${r.reg_ip || '—'}</span>` }, { t: 'Последний IP', f: (r) => html`<span class="mono xs">${r.last_ip || '—'}</span>` }], { href: (r) => '/admin/users/' + r.id, empty: 'Других аккаунтов с этих IP нет' });
    return autoTable(d.audit, auditCols, { empty: 'Записей нет' });
  };
  const draw = () => {
    const u = d.user; const rs = u.restrictions || {};
    const active = Object.keys(rs).filter((k) => rs[k]);
    mount(box, html`<div class="card"><div class="row between wrap gap">
      <div class="row gap">${avatar(u, 'xl')}<div><h2 style="margin:0">${u.nickname}</h2><div class="muted sm">${u.login} · ${u.email || 'email не указан'} · ID ${u.id}</div>
        <div class="row gap wrap mt">${roleBadge(u.role)} ${statusBadge(u.status, USER_ST)} ${active.map((k) => html`<span class="badge warn">Ограничено: ${RESTR_RU[k] || k}</span>`)}</div></div></div>
      <div class="row gap wrap">
        ${can('users.balance') ? html`<button class="btn" data-bal>Изменить баланс</button>` : ''}
        ${can('users.roles') && d.roles?.length ? html`<button class="btn ghost" data-role>Роль</button>` : ''}
        ${can('users.ban') ? html`<button class="btn ghost" data-restr>Ограничения</button>${u.status === 'banned' ? html`<button class="btn ghost" data-unban>Разблокировать</button>` : html`<button class="btn red" data-ban>Заблокировать</button>`}<button class="btn ghost" data-kill>Завершить сеансы</button>` : ''}
        <a class="btn ghost" href="/u/${u.id}" target="_blank" rel="noopener">Публичный профиль</a>
      </div></div>
      ${u.status === 'banned' && u.banReason ? html`<div class="mt">${notice('Причина блокировки: ' + u.banReason, 'err')}</div>` : ''}
      <div class="g2 mt">${kv([['Баланс', bc(u.balance)], ['Steam', u.steamId ? (u.steamName || '') + ' (' + u.steamId + ')' : 'не привязан'], ['Реферальный код', u.refCode], ['Приглашён', u.referredBy ? html`<a href="/admin/users/${u.referredBy}">#${u.referredBy}</a>` : '—'], ['Регистрация', fdate(u.createdAt)], ['Последняя активность', u.lastSeen ? fdate(u.lastSeen) : '—'], ['IP регистрации / последний', (u.regIp || '—') + ' / ' + (u.lastIp || '—')], ['Неудачных входов', num(u.failedLogins || 0) + (u.lockedUntil && u.lockedUntil > Date.now() ? ' (вход заблокирован до ' + fdate(u.lockedUntil) + ')' : '')]])}
        ${kv(Object.entries(d.stats || {}).map(([k, v]) => [STAT_RU[k] || k, MONEY_STATS.includes(k) ? bc(v) : num(v)]).concat(Object.keys(d.stats || {}).length ? [] : [['Статистика', 'пока нет активности']]))}</div></div>
      <div class="mt">${raw(String(tabsHtml()))}</div><div class="card mt" data-tb>${tabBody()}</div>`);
  };
  const tabsHtml = () => html`<div class="tabs">${TABS.map(([k, l]) => html`<button class="tab ${k === tab ? 'on' : ''}" data-utab="${k}">${l}</button>`)}</div>`;
  const load = async () => { d = await api(base); if (ctx.alive()) draw(); };
  on(root, 'click', '[data-utab]', (e, t) => { tab = t.dataset.utab; draw(); });
  on(root, 'click', '[data-bal]', async () => {
    const f = await askForm('Изменение баланса', html`<label class="fld"><span>Сумма в рублях (положительная — начисление, отрицательная — списание)</span><input name="amount" type="number" step="0.01" required></label>${reasonField()}`, 'Применить', { note: 'Текущий баланс: ' + money(d.user.balance) + ' ₽. Операция записывается в историю игрока и журнал аудита.' });
    if (!f) return;
    await busy(null, async () => { const r = await api(base + '/balance', { amount: Number(f.amount), reason: f.reason }); toast('Баланс изменён: ' + rub(r.balance), 'ok'); await load(); });
  });
  on(root, 'click', '[data-role]', async () => {
    const f = await askForm('Роль игрока', html`<label class="fld"><span>Роль</span><select name="role">${opts(d.roles.map((r) => [r, ROLE_RU[r] || r]), d.user.role)}</select></label>`, 'Сохранить', { note: 'Можно назначать только роли ниже своей. Роль владельца назначается только скриптом create-owner на сервере.' });
    if (!f) return;
    await busy(null, async () => { await api(base + '/role', { role: f.role }); toast('Роль изменена', 'ok'); await load(); });
  });
  on(root, 'click', '[data-restr]', async () => {
    const rs = d.user.restrictions || {};
    const keys = Object.keys(d.restrictions || RESTR_RU);
    const f = await askForm('Ограничения аккаунта', html`<p class="muted sm">Отмеченные разделы будут недоступны игроку.</p>${keys.map((k) => html`<label class="check"><input type="checkbox" name="${k}" ${rs[k] ? raw('checked') : ''}><span>${(d.restrictions && d.restrictions[k]) || RESTR_RU[k] || k}</span></label>`)}${reasonField()}`);
    if (!f) return;
    await busy(null, async () => { await api(base + '/restrictions', f); toast('Ограничения сохранены', 'ok'); await load(); });
  });
  on(root, 'click', '[data-ban]', async () => {
    const f = await askForm('Заблокировать аккаунт', reasonField('Причина (увидит игрок)'), 'Заблокировать', { danger: true, note: 'Все сеансы игрока будут завершены.' });
    if (!f) return;
    await busy(null, async () => { await api(base + '/ban', { reason: f.reason }); toast('Аккаунт заблокирован', 'ok'); await load(); });
  });
  on(root, 'click', '[data-unban]', (e, t) => busy(t, async () => { if (!(await confirmBox('Разблокировать аккаунт?'))) return; await api(base + '/unban', {}); toast('Аккаунт разблокирован', 'ok'); await load(); }));
  on(root, 'click', '[data-kill]', (e, t) => busy(t, async () => { if (!(await confirmBox('Завершить все сеансы игрока?'))) return; await api(base + '/logout', {}); toast('Сеансы завершены', 'ok'); await load(); }));
  await load();
}, P('Профиль игрока'));

page('/admin/suspicious', async (ctx) => {
  const box = shell(ctx, '/admin/suspicious', 'Подозрительная активность', loader());
  wire(box);
  const d = await api('/api/admin/suspicious');
  if (!ctx.alive()) return;
  const ulinks = (ids, names) => String(ids || '').split(',').filter(Boolean).map((id, i) => html`<a class="chip" href="/admin/users/${id}">${String(names || '').split(',')[i] || '#' + id}</a> `);
  mount(box, html`<p class="muted">Автоматические сигналы для проверки модератором. Сигнал не означает нарушение — решение принимает сотрудник.</p>
    <div class="card mt"><h3>Несколько аккаунтов с одного IP</h3>${autoTable(d.sharedIps, [{ t: 'IP', f: (r) => html`<span class="mono">${r.ip}</span>` }, { t: 'Аккаунтов', r: 1, f: (r) => num(r.n) }, { t: 'Игроки', f: (r) => ulinks(r.ids, r.names) }], { empty: 'Совпадений нет' })}</div>
    <div class="card mt"><h3>Необычно высокий выигрыш</h3>${autoTable(d.highWin, [{ t: 'Игрок', f: (r) => html`<a href="/admin/users/${r.user_id}">${r.nickname}</a>` }, { t: 'Ставок', r: 1, f: (r) => num(r.bets) }, { t: 'Оборот', r: 1, f: (r) => bc(r.wagered) }, { t: 'Выплаты', r: 1, f: (r) => bc(r.paid) }, { t: 'Отдача', r: 1, f: (r) => (r.wagered ? pct(r.paid / r.wagered) : '—') }], { empty: 'Сигналов нет' })}</div>
    <div class="card mt"><h3>Много неудачных входов</h3>${autoTable(d.failedLogins, [{ t: 'Игрок', f: (r) => html`<a href="/admin/users/${r.id}">${r.nickname} (${r.login})</a>` }, { t: 'Попыток', r: 1, f: (r) => num(r.failed_logins) }, { t: 'Заблокирован до', f: (r) => (r.locked_until ? fdate(r.locked_until) : '—') }, { t: 'IP', f: (r) => html`<span class="mono xs">${r.last_ip || '—'}</span>` }], { empty: 'Сигналов нет' })}</div>
    <div class="card mt"><h3>Ручные начисления сотрудниками</h3>${autoTable(d.adminCredits, [{ t: 'Время', f: when }, { t: 'Игрок', f: (r) => html`<a href="/admin/users/${r.user_id}">${r.nickname || '#' + r.user_id}</a>` }, { t: 'Сумма', r: 1, f: (r) => bc(r.amount) }, { t: 'Сотрудник', f: (r) => r.actor || '—' }, { t: 'Причина', f: (r) => r.note || r.reason || '—' }], { empty: 'Начислений не было' })}</div>
    <div class="card mt"><h3>Подозрительные рефералы</h3>${autoTable(d.referralFarms, [{ t: 'Пригласивший', f: (r) => html`<a href="/admin/users/${r.id}">${r.nickname}</a>` }, { t: 'Приглашено', r: 1, f: (r) => num(r.invited) }, { t: 'Разных IP', r: 1, f: (r) => num(r.ips) }], { empty: 'Сигналов нет' })}</div>`);
}, P('Подозрительная активность'));

export { itemCell, RARITIES, CASE_ST, catList, when, P };
import './admin-cat.js';
