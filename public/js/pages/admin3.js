// BURGER SKIN — админ-панель: поддержка, настройки, роли, журналы, резервные копии.
import { page, api, html, raw, mount, $, $$, on, toast, busy, formData, loader, notice, num, fdate, ago, avatar, img, can, state } from '../core.js';
import { uploadImage } from './shared.js';
import { threadHtml } from './info.js';
import { shell, wire, listPage, kv, autoTable, opts, statusBadge, fileBtn, settingsFields, collectSettings, roleBadge, ROLE_RU } from './admin-ui.js';
import { auditCols, errCols } from './admin2.js';

const P = (t) => ({ staff: true, title: t + ' — админ-панель' });
const g = (r, ...keys) => { for (const k of keys) if (r && r[k] !== undefined && r[k] !== null) return r[k]; return null; };
const entriesOf = (x, fb) => (Array.isArray(x) ? x.map((v) => (typeof v === 'string' ? [v, fb[v] || v] : [v.id || v.key, v.name || v.label])) : x && typeof x === 'object' && Object.keys(x).length ? Object.entries(x) : Object.entries(fb));

// ---------- Поддержка ----------
const TICKET_ST = { open: 'Открыто', answered: 'Есть ответ', pending: 'Ждёт игрока', closed: 'Закрыто' };
const PRIO = { low: 'Низкий', normal: 'Обычный', high: 'Высокий', urgent: 'Срочный' };
const prioBadge = (p, name) => html`<span class="badge ${p === 'urgent' ? 'err' : p === 'high' ? 'warn' : ''}">${name || PRIO[p] || p}</span>`;

page('/admin/support', (ctx) => {
  const L = listPage(ctx, {
    cur: '/admin/support', title: 'Поддержка', url: '/api/admin/tickets', state: { status: 'active', priority: '', assignee: '', q: '' },
    filters: html`<select name="status">${opts([['active', 'Активные'], ['', 'Все'], ...Object.entries(TICKET_ST)], 'active')}</select><select name="priority">${opts([['', 'Любой приоритет'], ...Object.entries(PRIO)], '')}</select><select name="assignee">${opts([['', 'Любой исполнитель'], ['me', 'Назначены мне'], ['none', 'Без исполнителя']], '')}</select><input name="q" placeholder="Тема, ID или игрок">`,
    render: (r) => html`<p class="muted sm">Найдено: ${num(r.total)}</p>${autoTable(r.rows, [
      { t: 'ID', k: 'id' },
      { t: 'Тема', f: (t) => html`<b>${t.subject}</b><br><span class="xs muted">${t.categoryName || t.category || ''}</span>` },
      { t: 'Игрок', f: (t) => (t.user ? t.user.nickname : '—') },
      { t: 'Приоритет', f: (t) => prioBadge(t.priority, t.priorityName) },
      { t: 'Статус', f: (t) => statusBadge(t.status, TICKET_ST) },
      { t: 'Исполнитель', f: (t) => (t.assignee ? t.assignee.nickname : html`<span class="muted">не назначен</span>`) },
      { t: 'Сообщений', r: 1, f: (t) => num(t.messages || 0) },
      { t: 'Обновлено', f: (t) => ago(t.updatedAt || t.createdAt) },
    ], { href: (t) => '/admin/support/' + t.id, empty: 'Обращений нет' })}`,
  });
  ctx.on('staff_ticket', () => L.load());
}, P('Поддержка'));

page('/admin/support/:id', async (ctx) => {
  const base = '/api/admin/tickets/' + encodeURIComponent(ctx.params.id);
  const box = shell(ctx, '/admin/support', 'Обращение', loader(), html`<a class="btn ghost" href="/admin/support">← К обращениям</a>`);
  const root = wire(box);
  let d; const att = { id: null, name: '' };
  const draw = () => {
    const prev = $('[data-reply] textarea', box)?.value || '';
    const t = d.ticket; const u = d.user || t.user || {};
    const staffOpts = [['', 'Не назначен'], ...(d.staff || []).map((s) => [s.id, s.nickname + ' — ' + (ROLE_RU[s.role] || s.role || '')])];
    mount(box, html`<div class="split"><div class="card">
      <div class="row between wrap gap"><h3 style="margin:0">#${t.id} ${t.subject}</h3><span class="row gap">${prioBadge(t.priority, t.priorityName)}${statusBadge(t.status, TICKET_ST)}</span></div>
      <p class="muted sm">${t.categoryName || t.category || ''} · создано ${fdate(t.createdAt)}</p>
      ${threadHtml(t, state.me.id)}
      ${t.status === 'closed' ? html`<div class="mt">${notice('Обращение закрыто. Новый ответ сотрудника откроет его снова.', 'info')}</div>` : ''}
      <form class="form mt" data-reply><label class="fld"><span>Ответ игроку</span><textarea name="body" rows="4" maxlength="5000" required></textarea></label>
        <div class="row gap wrap">${fileBtn('attachment', 'Прикрепить изображение')}<span class="xs muted" data-att>${att.name}</span><label class="check"><input type="checkbox" name="close"><span>Закрыть после ответа</span></label><button class="btn">Отправить</button></div></form></div>
      <div class="stack">
        <form class="card form" data-upd><h3>Управление</h3>
          <label class="fld"><span>Статус</span><select name="status">${opts(entriesOf(d.statuses, TICKET_ST), t.status)}</select></label>
          <label class="fld"><span>Приоритет</span><select name="priority">${opts(entriesOf(d.priorities, PRIO), t.priority)}</select></label>
          <label class="fld"><span>Исполнитель</span><select name="assigneeId">${opts(staffOpts, t.assignee ? t.assignee.id : '')}</select></label>
          <button class="btn ghost">Сохранить</button></form>
        <div class="card"><h3>Игрок</h3><div class="row gap mb">${avatar(u)}<b>${u.nickname || '—'}</b></div>${kv([['Логин', u.login || '—'], ['Email', u.email || '—'], ['Регистрация', fdate(g(u, 'createdAt', 'created_at'))]])}${can('users.view') && u.id ? html`<a class="btn ghost sm mt" href="/admin/users/${u.id}">Открыть профиль</a>` : ''}</div>
        <div class="card"><h3>Другие обращения</h3>${autoTable((d.history || []).filter((h) => String(h.id) !== String(t.id)), [{ t: '#', k: 'id' }, { t: 'Тема', k: 'subject' }, { t: 'Статус', f: (h) => statusBadge(h.status, TICKET_ST) }, { t: 'Создано', f: (h) => fdate(g(h, 'createdAt', 'created_at')) }], { href: (h) => '/admin/support/' + h.id, empty: 'Других обращений нет' })}</div>
      </div></div>`);
    const ta = $('[data-reply] textarea', box); if (ta && prev) ta.value = prev;
  };
  const load = async () => { d = await api(base); if (ctx.alive()) draw(); };
  on(root, 'change', 'input[data-file]', async (e, t) => {
    const f = t.files && t.files[0]; if (!f) return;
    try { const r = await uploadImage(f, 'ticket'); att.id = r.id; att.name = 'Прикреплено: ' + f.name; const el = $('[data-att]', box); if (el) el.textContent = att.name; } catch (err) { toast(err.message, 'err'); }
    t.value = '';
  });
  on(root, 'submit', 'form[data-reply]', (e, f) => { e.preventDefault(); busy(f.querySelector('button:not([type])'), async () => {
    const v = formData(f);
    await api(base + '/reply', { body: v.body, attachment: att.id || undefined, close: !!v.close });
    att.id = null; att.name = ''; f.reset(); toast('Ответ отправлен', 'ok'); await load();
  }); });
  on(root, 'submit', 'form[data-upd]', (e, f) => { e.preventDefault(); busy(f.querySelector('button'), async () => {
    const v = formData(f);
    await api(base + '/update', { status: v.status, priority: v.priority, assigneeId: v.assigneeId ? Number(v.assigneeId) : null });
    toast('Обращение обновлено', 'ok'); await load();
  }); });
  ctx.on('staff_ticket', (p) => { const id = p && (p.id ?? p.ticketId); if (id == null || String(id) === String(ctx.params.id)) load(); });
  await load();
}, P('Обращение'));

// ---------- Настройки ----------
const SET_TITLE = { site: 'Сайт и логотип', banner: 'Главный баннер', features: 'Управление функциями', maintenance: 'Режим обслуживания', economy: 'Экономика', notifications: 'Уведомления', finance: 'Финансы', daily: 'Ежедневный бонус', referral: 'Реферальная программа' };
const SET_ABOUT = {
  features: 'Выключенный раздел скрывается из меню и закрывается на сервере. Пополнение и вывод нельзя включить, пока не подключён одобренный платёжный провайдер.',
  maintenance: 'В режиме обслуживания игроки видят сообщение, а игровые и финансовые операции недоступны. Сотрудники продолжают работу.',
  economy: 'Доли указываются десятичной дробью (0.9 = 90%). Изменения применяются к новым операциям и записываются в журнал аудита.',
};
const UPLOAD_KIND = { site: ['logo', 'logo'], banner: ['image', 'banner'] };

page('/admin/settings', async (ctx) => {
  const box = shell(ctx, '/admin/settings', 'Настройки', loader());
  const root = wire(box);
  let d;
  const allowedKey = (k) => { const p = d.perms; if (Array.isArray(p)) return p.includes(k); if (p && typeof p === 'object' && p[k]) return can(p[k]); return true; };
  const draw = () => {
    const keys = Object.keys(d.settings || {}).filter((k) => k !== 'games' && allowedKey(k));
    const env = d.env || {};
    const yes = (v) => (v ? html`<span class="badge ok">настроено</span>` : html`<span class="badge warn">не настроено</span>`);
    const prov = Array.isArray(env.paymentProviders) ? env.paymentProviders : Object.keys(env.paymentProviders || {});
    mount(box, html`<div class="card"><h3>Окружение сервера</h3><p class="muted sm">Секреты задаются только переменными окружения на сервере (файл .env) и никогда не передаются в браузер. Здесь показано только, заданы ли они.</p>${kv([
        ['Публичный адрес (PUBLIC_URL)', env.publicUrl || html`<span class="badge warn">не задан</span>`],
        ['Steam Web API (STEAM_API_KEY)', yes(env.steamApiKey)],
        ['Почта для восстановления пароля (SMTP_*)', yes(env.smtp)],
        ['Защищённые cookie (COOKIE_SECURE)', yes(env.cookieSecure)],
        ['Платёжные провайдеры', prov.length ? prov.join(', ') : html`<span class="badge warn">не подключены</span>`],
        ['Node.js', env.node || '—'], ['Папка данных', env.dataDir || '—'],
      ])}</div>
      ${keys.map((k) => { const v = d.settings[k]; const up = UPLOAD_KIND[k]; const pic = up && v && v[up[0]]; return html`<form class="card mt" data-skey="${k}"><div class="row between wrap"><h3>${SET_TITLE[k] || k}</h3><button class="btn sm">Сохранить</button></div>${SET_ABOUT[k] ? html`<p class="muted sm">${SET_ABOUT[k]}</p>` : ''}
        ${up ? html`<div class="row gap mb">${pic ? html`<img data-prev src="${pic}" alt="" style="max-height:64px;max-width:240px;object-fit:contain">` : ''}${fileBtn(up[0], k === 'site' ? 'Загрузить логотип' : 'Загрузить изображение баннера')}</div>` : ''}
        <div class="form g2">${v !== null && typeof v === 'object' && !Array.isArray(v) ? settingsFields(v) : html`<label class="fld"><span>Значение</span><input name="__value" value="${v ?? ''}"></label>`}</div></form>`; })}
      <p class="muted sm mt">Лимиты и доступность игр настраиваются в разделе <a href="/admin/games">«Игры»</a>, новости — в разделе <a href="/admin/news">«Новости и акции»</a>.</p>`);
  };
  const load = async () => { d = await api('/api/admin/settings'); if (ctx.alive()) draw(); };
  on(root, 'change', 'input[data-file]', async (e, t) => {
    const f = t.files && t.files[0]; if (!f) return;
    const form = t.closest('form'); const up = UPLOAD_KIND[form.dataset.skey];
    try {
      const r = await uploadImage(f, up ? up[1] : 'banner');
      const inp = form.elements.namedItem(t.dataset.file); if (inp) inp.value = r.url;
      const p = form.querySelector('[data-prev]'); if (p) p.src = r.url;
      toast('Изображение загружено — нажмите «Сохранить»', 'ok');
    } catch (err) { toast(err.message, 'err'); }
    t.value = '';
  });
  on(root, 'submit', 'form[data-skey]', (e, f) => { e.preventDefault(); busy(f.querySelector('button'), async () => {
    const k = f.dataset.skey; const def = d.settings[k];
    const value = def !== null && typeof def === 'object' && !Array.isArray(def) ? collectSettings(f, def) : f.elements.namedItem('__value').value;
    await api('/api/admin/settings', { key: k, value });
    toast('Настройки сохранены', 'ok'); await load();
  }); });
  await load();
}, P('Настройки'));

// ---------- Роли ----------
const STAFF_ROLES = ['ADMIN', 'MODERATOR', 'SUPPORT'];
page('/admin/roles', async (ctx) => {
  const box = shell(ctx, '/admin/roles', 'Роли и права', loader());
  const root = wire(box);
  let d;
  const draw = () => {
    const ed = !!d.editable;
    mount(box, html`${notice('Владелец (OWNER) всегда имеет все права и создаётся только консольной командой на сервере. Права проверяются сервером при каждом запросе.' + (ed ? '' : ' Изменять матрицу прав может только владелец.'), 'info')}
      <form class="card mt" data-roles><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Право</th>${STAFF_ROLES.map((r) => html`<th class="center">${ROLE_RU[r]}</th>`)}</tr></thead><tbody>
        ${Object.entries(d.perms || {}).map(([p, label]) => html`<tr><td>${label}<br><span class="mono xs muted">${p}</span></td>${STAFF_ROLES.map((r) => html`<td class="center"><input type="checkbox" data-perm="${r}|${p}" ${(d.current?.[r] || []).includes(p) ? raw('checked') : ''} ${ed ? '' : raw('disabled')}></td>`)}</tr>`)}
      </tbody></table></div>${ed ? html`<div class="row gap mt"><button class="btn">Сохранить права</button><button type="button" class="btn ghost" data-defaults>Значения по умолчанию</button></div>` : ''}</form>
      <div class="card mt"><h3>Сотрудники</h3>${autoTable(d.staff, [{ t: 'Сотрудник', f: (s) => html`<span class="row gap">${avatar(s)}<b>${s.nickname}</b></span>` }, { t: 'Логин', f: (s) => s.login || '—' }, { t: 'Роль', f: (s) => roleBadge(s.role) }, { t: 'Активность', f: (s) => { const t = g(s, 'lastSeen', 'last_seen'); return t ? ago(t) : '—'; } }], { href: can('users.view') ? (s) => '/admin/users/' + s.id : undefined, empty: 'Сотрудников нет' })}<p class="muted sm mt">Роль назначается в профиле игрока («Пользователи» → игрок → «Роль»). Назначать можно только роли ниже своей.</p></div>`);
  };
  const load = async () => { d = await api('/api/admin/roles'); if (ctx.alive()) draw(); };
  on(root, 'click', '[data-defaults]', () => { for (const c of $$('[data-perm]', box)) { const [r, p] = c.dataset.perm.split('|'); c.checked = (d.defaults?.[r] || []).includes(p); } toast('Значения по умолчанию подставлены — нажмите «Сохранить»', 'info'); });
  on(root, 'submit', 'form[data-roles]', (e, f) => { e.preventDefault(); busy(f.querySelector('button:not([type])'), async () => {
    const perms = Object.fromEntries(STAFF_ROLES.map((r) => [r, []]));
    for (const c of $$('[data-perm]', box)) if (c.checked) { const [r, p] = c.dataset.perm.split('|'); perms[r].push(p); }
    await api('/api/admin/roles', { perms }); toast('Права ролей сохранены', 'ok'); await load();
  }); });
  await load();
}, P('Роли и права'));

// ---------- Журналы ----------
page('/admin/audit', (ctx) => {
  const L = listPage(ctx, {
    cur: '/admin/audit', title: 'Журнал аудита', url: '/api/admin/audit', state: { action: '', actor: '', target: '' },
    top: html`<p class="muted">Журнал нельзя изменить или удалить через сайт: каждая запись связана с предыдущей хешем SHA-256, поэтому любая правка базы вручную обнаруживается проверкой.</p><div data-ver class="mb"></div>`,
    right: html`<button class="btn ghost" data-verify>Проверить целостность</button>`,
    filters: html`<input name="action" placeholder="Действие, например user.balance"><input name="actor" placeholder="ID сотрудника"><input name="target" placeholder="ID объекта">`,
    render: (r) => html`<p class="muted sm">Записей: ${num(r.total)}</p>${autoTable(r.rows, auditCols, { empty: 'Записей нет' })}`,
  });
  on(L.root, 'click', '[data-verify]', (e, t) => busy(t, async () => {
    const r = await api('/api/admin/audit/verify');
    mount($('[data-ver]', L.box), r.ok ? notice('Цепочка журнала цела: проверено записей — ' + num(r.checked), 'ok') : notice('Нарушена целостность журнала на записи #' + r.brokenAt + ' (проверено ' + num(r.checked) + '). Возможно, база изменена вручную — сравните с резервной копией.', 'err'));
  }));
}, P('Журнал аудита'));

page('/admin/errors', (ctx) => {
  listPage(ctx, {
    cur: '/admin/errors', title: 'Журнал ошибок', url: '/api/admin/errors',
    top: html`<p class="muted">Непредвиденные ошибки сервера. Игроки видят только общее сообщение без технических деталей.</p>`,
    render: (r) => html`<p class="muted sm">Записей: ${num(r.total)}</p>${autoTable(r.rows, errCols, { empty: 'Ошибок не зафиксировано' })}`,
  });
}, P('Журнал ошибок'));

// ---------- Резервные копии ----------
const size = (b) => (b > 1048576 ? (b / 1048576).toFixed(2) + ' МБ' : Math.max(1, Math.round(b / 1024)) + ' КБ');
page('/admin/backups', async (ctx) => {
  const box = shell(ctx, '/admin/backups', 'Резервные копии', loader(), html`<button class="btn" data-mk>Создать копию сейчас</button>`);
  const root = wire(box);
  const restore = ['# создать копию из консоли (можно поставить в cron)', 'npm run backup', '', '# восстановление', '1. Остановите сервер.', '2. Сохраните текущий файл data/burger.sqlite отдельно (на всякий случай).', '3. Скопируйте выбранную копию из data/backups в data/burger.sqlite', '   и удалите рядом файлы burger.sqlite-wal и burger.sqlite-shm, если они есть.', '4. Запустите сервер: npm start', '5. Папку data/uploads (загруженные изображения) копируйте отдельно.'].join('\n');
  const load = async () => {
    const d = await api('/api/admin/backups'); if (!ctx.alive()) return;
    mount(box, html`<div class="card"><h3>Копии на сервере</h3><p class="muted sm">Папка: <span class="mono">${d.dir}</span>. Копия создаётся безопасно на работающей базе. Скачивание базы через браузер намеренно отключено — забирайте файлы с сервера по SSH/SFTP.</p>${autoTable(d.files, [{ t: 'Файл', f: (f) => html`<span class="mono sm">${f.file}</span>` }, { t: 'Размер', r: 1, f: (f) => size(f.size || 0) }, { t: 'Создан', f: (f) => fdate(g(f, 'createdAt', 'created_at')) }], { empty: 'Копий пока нет' })}</div>
      <div class="card mt"><h3>Как восстановить базу</h3><pre class="json">${restore}</pre></div>`);
  };
  on(root, 'click', '[data-mk]', (e, t) => busy(t, async () => { const r = await api('/api/admin/backups', {}); toast('Копия создана: ' + r.file + ' (' + size(r.size || 0) + ')', 'ok', 6000); await load(); }));
  await load();
}, P('Резервные копии'));
