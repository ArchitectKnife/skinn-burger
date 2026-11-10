// BURGER SKIN — админ-панель: игры, бонусы, PASS, финансы, поддержка, система.
import { page, api, html, raw, mount, $, $$, on, toast, busy, formData, loader, notice, num, bc, money, fdate, ago, img, go, can, state, GAMES, confirmBox, modal } from '../core.js';
import { betsTable, uploadImage } from './shared.js';
import { threadHtml } from './info.js';
import { shell, wire, listPage, askForm, kv, autoTable, toBC, tsInput, fromTsInput, opts, statusBadge, fileBtn, settingsFields, collectSettings, roleBadge, ROLE_RU } from './admin-ui.js';

const P = (t) => ({ staff: true, title: t + ' — админ-панель' });
const short = (v, n = 140) => { const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + '…' : s; };
const g = (r, ...keys) => { for (const k of keys) if (r && r[k] !== undefined && r[k] !== null) return r[k]; return null; };
const when = (r) => fdate(g(r, 'createdAt', 'created_at'));

export const auditCols = [
  { t: 'Время', f: when },
  { t: 'Сотрудник', f: (r) => { const id = g(r, 'actorId', 'actor_id'); const name = r.actor && typeof r.actor === 'object' ? r.actor.nickname : r.actor; return id ? html`<a href="/admin/users/${id}">${name || '#' + id}</a>` : 'Система'; } },
  { t: 'Действие', f: (r) => html`<span class="mono sm">${r.action}</span>` },
  { t: 'Объект', f: (r) => { const t = g(r, 'targetType', 'target_type'); const id = g(r, 'targetId', 'target_id'); return t ? (t === 'user' && id ? html`<a href="/admin/users/${id}">user #${id}</a>` : t + (id ? ' #' + id : '')) : '—'; } },
  { t: 'Данные', f: (r) => html`<span class="mono xs" title="${short(r.data, 2000)}">${short(r.data)}</span>` },
  { t: 'IP', f: (r) => html`<span class="mono xs">${r.ip || '—'}</span>` },
];
export const errCols = [
  { t: 'Время', f: when },
  { t: 'Уровень', f: (r) => statusBadge(r.level === 'error' ? 'rejected' : 'pending', { rejected: r.level || 'error', pending: r.level || 'warn' }) },
  { t: 'Адрес', f: (r) => html`<span class="mono xs">${r.path || '—'}</span>` },
  { t: 'Сообщение', f: (r) => html`${short(r.message, 300)}${r.stack ? html`<details><summary class="xs muted">Стек</summary><pre class="json xs">${short(r.stack, 4000)}</pre></details>` : ''}` },
  { t: 'Игрок', f: (r) => (r.user_id ? html`<a href="/admin/users/${r.user_id}">#${r.user_id}</a>` : '—') },
];
const genericTable = (rows, empty = 'Записей нет') => {
  const keys = rows && rows.length ? Object.keys(rows[0]).filter((k) => !/seed|stack|password|token/i.test(k)).slice(0, 8) : [];
  return autoTable(rows || [], keys.map((k) => ({ t: k, f: (r) => (/_at$|At$/.test(k) && typeof r[k] === 'number' ? fdate(r[k]) : html`<span class="xs">${short(r[k], 80)}</span>`) })), { empty });
};

// ---------- Игры ----------
page('/admin/games', async (ctx) => {
  const box = shell(ctx, '/admin/games', 'Игры', loader());
  const root = wire(box);
  let d;
  const draw = () => {
    const keys = Object.keys(d.settings || {});
    const act = Object.fromEntries((d.active || []).map((a) => [a.game, a.n]));
    mount(box, html`<div class="card"><h3>Доступность и лимиты ставок</h3><p class="muted sm">Отключённая игра не принимает новые ставки; уже начатые раунды завершаются честно. Изменения записываются в журнал аудита.</p>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Игра</th><th>Включена</th><th>Мин. ставка, ₽</th><th>Макс. ставка, ₽</th><th class="r">Активных сейчас</th><th></th></tr></thead><tbody>
      ${keys.map((k) => { const s = d.settings[k] || {}; return html`<tr data-g="${k}"><td><b>${GAMES[k] || k}</b></td><td><label class="check"><input type="checkbox" data-f="enabled" ${s.enabled ? raw('checked') : ''}><span>${s.enabled ? 'да' : 'нет'}</span></label></td><td><input type="number" data-f="min" step="0.01" min="0.01" value="${toBC(s.min)}" style="width:110px"></td><td><input type="number" data-f="max" step="0.01" min="0.01" value="${toBC(s.max)}" style="width:120px"></td><td class="r">${num(act[k] || 0)}</td><td class="r"><button class="btn sm" data-gsave="${k}">Сохранить</button></td></tr>`; })}
      </tbody></table></div></div>
      <div class="card mt"><h3>Статистика за 7 дней</h3>${autoTable(d.stats, [{ t: 'Игра', f: (r) => GAMES[r.game] || r.game }, { t: 'Ставок', r: 1, f: (r) => num(r.bets) }, { t: 'Игроков', r: 1, f: (r) => num(r.players) }, { t: 'Оборот', r: 1, f: (r) => bc(r.wagered) }, { t: 'Выплаты', r: 1, f: (r) => bc(r.paid) }, { t: 'Макс. выигрыш', r: 1, f: (r) => bc(r.maxWin) }], { empty: 'Ставок не было' })}</div>
      <div class="card mt"><h3>Последние раунды</h3>${autoTable(d.rounds, [{ t: 'ID', k: 'id' }, { t: 'Игра', f: (r) => GAMES[r.game] || r.game }, { t: 'Статус', f: (r) => statusBadge(r.status) }, { t: 'Хеш seed', f: (r) => html`<span class="mono xs">${short(r.hash, 20)}</span>` }, { t: 'Результат', f: (r) => html`<span class="mono xs">${short(r.result, 60)}</span>` }, { t: 'Seed (после раунда)', f: (r) => html`<span class="mono xs">${r.ended_at ? short(r.seed, 20) : 'скрыт до конца'}</span>` }, { t: 'Начат', f: when }], { empty: 'Раундов нет' })}</div>
      <div class="g2 mt"><div class="card"><h3>Case Battle</h3>${genericTable(d.battles, 'Битв нет')}</div><div class="card"><h3>Coinflip</h3>${genericTable(d.coinflips, 'Игр нет')}</div></div>
      <div class="card mt"><h3>Последние ставки</h3>${betsTable(d.recent || [], { gameCol: true, empty: 'Ставок нет' })}</div>
      <div class="card mt"><h3>Ошибки игрового сервера и API</h3>${autoTable(d.errors, errCols, { empty: 'Ошибок нет' })}</div>`);
  };
  const load = async () => { d = await api('/api/admin/games'); if (ctx.alive()) draw(); };
  on(root, 'click', '[data-gsave]', (e, t) => busy(t, async () => {
    const tr = t.closest('tr'); const v = (f) => tr.querySelector('[data-f="' + f + '"]');
    await api('/api/admin/games', { game: t.dataset.gsave, enabled: v('enabled').checked, min: Number(v('min').value), max: Number(v('max').value) });
    toast('Настройки игры сохранены', 'ok'); await load();
  }));
  await load();
}, P('Игры'));

// ---------- Универсальные справочники (промокоды, задания, достижения, события, новости) ----------
const OPT_RU = { daily: 'Ежедневное', weekly: 'Еженедельное', event: 'Событие', marathon: 'Марафон', tournament: 'Турнир', draft: 'Черновик', active: 'Идёт', finished: 'Завершено', news: 'Новость', promo: 'Акция', update: 'Обновление' };
const CRUD = {
  promo_codes: { path: '/admin/promo', title: 'Промокоды', one: 'промокод', about: 'Промокод начисляет внутренний баланс один раз на аккаунт. Лимит 0 — без ограничения количества активаций.', labels: { code: 'Код', amount: 'Сумма, ₽', max_uses: 'Лимит активаций', expires_at: 'Действует до', active: 'Активен' } },
  quests: { path: '/admin/quests', title: 'Задания', one: 'задание', about: 'Ежедневные и еженедельные задания. Прогресс считает сервер, награда и опыт BURGER PASS начисляются транзакцией.', labels: { scope: 'Период', title: 'Название', metric: 'Что считать', goal: 'Цель', reward: 'Награда, ₽', xp: 'Опыт PASS', active: 'Активно', sort: 'Порядок' } },
  achievements: { path: '/admin/achievements', title: 'Достижения', one: 'достижение', about: 'Достижение выдаётся автоматически при достижении цели по выбранной метрике.', labels: { code: 'Код', title: 'Название', description: 'Описание', metric: 'Метрика', goal: 'Цель', reward: 'Награда, ₽', icon: 'Значок (символ)', active: 'Активно' } },
  events: { path: '/admin/events', title: 'События, марафоны и турниры', one: 'событие', about: 'Турнир распределяет призы по местам рейтинга; марафон и событие дают награду за достижение цели. Призы выплачиваются сервером после окончания.', labels: { kind: 'Тип', title: 'Название', description: 'Описание', metric: 'Метрика', goal: 'Цель (0 — только рейтинг)', reward: 'Награда за цель, ₽', prizes: 'Призы за места, ₽ через запятую', starts_at: 'Начало', ends_at: 'Окончание', status: 'Статус' } },
  news: { path: '/admin/news', title: 'Новости и акции', one: 'новость', about: 'Опубликованные материалы показываются на главной и в разделе «Новости». Текст отображается безопасно (без HTML).', labels: { title: 'Заголовок', body: 'Текст', image: 'Изображение', kind: 'Тип', published: 'Опубликовано' } },
};
const ftype = (f) => (Array.isArray(f) ? f[0] : typeof f === 'string' ? f : f?.type);
const fopts = (f) => (Array.isArray(f) && Array.isArray(f[1]) ? f[1] : []);
const prizesList = (v) => { let a = v; if (typeof v === 'string') { try { a = JSON.parse(v); } catch { a = v.split(','); } } return Array.isArray(a) ? a.map((c) => toBC(Number(c))).join(', ') : ''; };

for (const [entity, cfg] of Object.entries(CRUD)) {
  page(cfg.path, async (ctx) => {
    const box = shell(ctx, cfg.path, cfg.title, loader(), html`<button class="btn" data-new>Создать ${cfg.one}</button>`);
    const root = wire(box);
    let d;
    const optLabel = (k, val) => { const m = d.options || {}; const map = k === 'metric' ? (entity === 'events' ? m.events : m.quests) : null; const lab = map && !Array.isArray(map) ? map[val] : null; return lab || OPT_RU[val] || val; };
    const show = (k, f, v) => {
      const t = ftype(f);
      if (v == null || v === '') return '—';
      if (t === 'money') return bc(v);
      if (t === 'bool') return v ? html`<span class="badge ok">да</span>` : html`<span class="badge">нет</span>`;
      if (t === 'ts') return fdate(v);
      if (t === 'prizes') return prizesList(v) || '—';
      if (t === 'oneOf') return optLabel(k, v);
      return short(v, 80);
    };
    const fieldHtml = (k, f, v) => {
      const t = ftype(f); const lab = cfg.labels[k] || k;
      if (t === 'bool') return html`<label class="check"><input type="checkbox" name="${k}" ${v ? raw('checked') : ''}><span>${lab}</span></label>`;
      if (t === 'oneOf') return html`<label class="fld"><span>${lab}</span><select name="${k}">${opts(fopts(f).map((o) => [o, optLabel(k, o)]), v ?? fopts(f)[0])}</select></label>`;
      if (t === 'int') return html`<label class="fld"><span>${lab}</span><input type="number" step="1" name="${k}" value="${v ?? 0}" required></label>`;
      if (t === 'money') return html`<label class="fld"><span>${lab}</span><input type="number" step="0.01" min="0" name="${k}" value="${v != null ? toBC(v) : ''}" required></label>`;
      if (t === 'ts') return html`<label class="fld"><span>${lab} (МСК)</span><input type="datetime-local" name="${k}" value="${v ? tsInput(v) : ''}"></label>`;
      if (t === 'prizes') return html`<label class="fld"><span>${lab}</span><input name="${k}" value="${prizesList(v)}" placeholder="5000, 2500, 1000"></label>`;
      if (k === 'body' || k === 'description') return html`<label class="fld" style="grid-column:1/-1"><span>${lab}</span><textarea name="${k}" rows="${k === 'body' ? 10 : 3}">${v ?? ''}</textarea></label>`;
      if (k === 'image') return html`<label class="fld"><span>${lab}</span><input name="image" value="${v ?? ''}" placeholder="загрузите файл"></label><div class="end">${fileBtn('image')}</div>`;
      return html`<label class="fld"><span>${lab}</span><input name="${k}" value="${v ?? ''}" ${t === 'str' || t === 'code' ? raw('required') : ''}></label>`;
    };
    const collect = (v) => {
      const out = {};
      for (const [k, f] of Object.entries(d.fields)) {
        const t = ftype(f); const x = v[k];
        if (t === 'bool') out[k] = !!x;
        else if (t === 'int' || t === 'money') out[k] = Number(x);
        else if (t === 'ts') out[k] = x ? fromTsInput(x) : null;
        else if (t === 'prizes') out[k] = String(x || '').split(',').map((s) => s.trim()).filter(Boolean).map(Number);
        else if (t === 'opt') out[k] = x ? x : null;
        else out[k] = x;
      }
      return out;
    };
    const edit = async (row) => {
      const f = await askForm((row ? 'Редактировать ' : 'Создать ') + cfg.one, html`<div class="form g2">${Object.entries(d.fields).map(([k, fs]) => fieldHtml(k, fs, row ? row[k] : undefined))}</div>`, row ? 'Сохранить' : 'Создать', { wide: true });
      if (!f) return;
      await busy(null, async () => {
        await api('/api/admin/crud/' + entity + (row ? '/' + row.id : ''), collect(f));
        toast(row ? 'Сохранено' : 'Создано', 'ok'); await load();
      });
    };
    const draw = () => {
      const cols = [{ t: 'ID', k: 'id' }, ...Object.entries(d.fields).filter(([k]) => k !== 'body' && k !== 'description').map(([k, f]) => ({ t: cfg.labels[k] || k, f: (r) => (k === 'image' && r.image ? img(r.image, 'mini-it') : show(k, f, r[k])) }))];
      if (entity === 'promo_codes') cols.push({ t: 'Активаций', r: 1, f: (r) => num(g(r, 'uses', 'used', 'used_count') || 0) });
      cols.push({ t: '', r: 1, f: (r) => html`<span class="row gap end"><button class="btn ghost sm" data-edit="${r.id}">Изменить</button><button class="btn ghost sm" data-delr="${r.id}">Удалить</button></span>` });
      mount(box, html`<p class="muted">${cfg.about}</p><div class="card mt">${autoTable(d.rows, cols, { empty: 'Записей пока нет — нажмите «Создать»' })}</div>`);
    };
    const load = async () => { d = await api('/api/admin/crud/' + entity); if (ctx.alive()) draw(); };
    on(root, 'click', '[data-new]', () => edit(null));
    on(root, 'click', '[data-edit]', (e, t) => edit(d.rows.find((r) => String(r.id) === t.dataset.edit)));
    on(root, 'click', '[data-delr]', (e, t) => busy(t, async () => {
      if (!(await confirmBox('Удалить запись? История начислений игрокам сохранится.', 'Удалить', true))) return;
      await api('/api/admin/crud/' + entity + '/' + t.dataset.delr + '/delete', {}); toast('Запись удалена', 'ok'); await load();
    }));
    on(document.body, 'change', '.modal input[data-file]', async (e, t) => {
      if (!ctx.alive()) return;
      const file = t.files && t.files[0]; if (!file) return;
      try { const r = await uploadImage(file, 'news'); const inp = t.closest('form').elements.namedItem(t.dataset.file); if (inp) inp.value = r.url; toast('Изображение загружено', 'ok'); } catch (err) { toast(err.message, 'err'); }
      t.value = '';
    });
    await load();
  }, P(cfg.title));
}

// ---------- BURGER PASS ----------
const SEASON_ST = { draft: 'Черновик', active: 'Идёт', ended: 'Завершён', finished: 'Завершён' };
const seasonForm = (s = {}) => html`<div class="form g2"><label class="fld" style="grid-column:1/-1"><span>Название сезона</span><input name="name" required minlength="2" maxlength="80" value="${s.name || ''}"></label>
  <label class="fld"><span>Опыта на уровень</span><input name="xpPerLevel" type="number" min="1" step="1" value="${g(s, 'xpPerLevel', 'xp_per_level') ?? 1000}"></label>
  <label class="fld"><span>Цена премиума, ₽</span><input name="premiumPrice" type="number" min="0" step="0.01" value="${toBC(g(s, 'premiumPrice', 'premium_price') ?? 99900)}"></label>
  <label class="fld"><span>Начало (МСК)</span><input name="startsAt" type="datetime-local" value="${tsInput(g(s, 'startsAt', 'starts_at') || Date.now())}"></label>
  <label class="fld"><span>Окончание (МСК)</span><input name="endsAt" type="datetime-local" value="${tsInput(g(s, 'endsAt', 'ends_at') || Date.now() + 60 * 864e5)}"></label></div>`;
const seasonBody = (f) => ({ name: f.name, xpPerLevel: Number(f.xpPerLevel), premiumPrice: Number(f.premiumPrice), startsAt: fromTsInput(f.startsAt), endsAt: fromTsInput(f.endsAt) });

page('/admin/pass', async (ctx) => {
  const box = shell(ctx, '/admin/pass', 'BURGER PASS', loader(), html`<button class="btn" data-new>Новый сезон</button>`);
  const root = wire(box);
  const load = async () => {
    const d = await api('/api/admin/pass'); if (!ctx.alive()) return;
    mount(box, html`<p class="muted">Сезон содержит 100 уровней с бесплатной и премиум-веткой наград. Одновременно может идти один сезон.</p><div class="card mt">${autoTable(d.seasons, [
      { t: 'ID', k: 'id' }, { t: 'Сезон', k: 'name' }, { t: 'Статус', f: (s) => statusBadge(s.status, SEASON_ST) },
      { t: 'Опыт/ур.', r: 1, f: (s) => num(g(s, 'xpPerLevel', 'xp_per_level')) }, { t: 'Премиум', r: 1, f: (s) => bc(g(s, 'premiumPrice', 'premium_price')) },
      { t: 'Период', f: (s) => fdate(g(s, 'startsAt', 'starts_at')) + ' — ' + fdate(g(s, 'endsAt', 'ends_at')) },
      { t: 'Наград', r: 1, f: (s) => num(s.rewards || 0) }, { t: 'Участников', r: 1, f: (s) => num(s.players || 0) + ' / ' + num(s.premiumPlayers || 0) + ' прем.' },
    ], { href: (s) => '/admin/pass/' + s.id, empty: 'Сезонов пока нет' })}</div>`);
  };
  on(root, 'click', '[data-new]', async () => {
    const f = await askForm('Новый сезон BURGER PASS', seasonForm(), 'Создать', { wide: true });
    if (!f) return;
    await busy(null, async () => { const r = await api('/api/admin/pass', seasonBody(f)); toast('Сезон создан', 'ok'); const id = r.season ? r.season.id : r.id; if (id) go('/admin/pass/' + id); else load(); });
  });
  await load();
}, P('BURGER PASS'));

page('/admin/pass/:id', async (ctx) => {
  const id = encodeURIComponent(ctx.params.id); const base = '/api/admin/pass/' + id;
  const box = shell(ctx, '/admin/pass', 'Сезон BURGER PASS', loader(), html`<a class="btn ghost" href="/admin/pass">← К сезонам</a>`);
  const root = wire(box);
  let d;
  const rw = (lv, tr) => (d.rewards || []).find((r) => Number(r.level) === lv && r.track === tr);
  const rwText = (r) => { if (!r || r.type === 'none') return html`<span class="muted">—</span>`; const t = r.label ? html`<b>${r.label}</b><br>` : ''; if (r.type === 'balance') return html`${t}${bc(r.amount)}`; if (r.type === 'item') return html`<span class="row gap">${img(r.item_image, 'mini-it')}<span>${t}${r.item_name || 'предмет #' + r.item_id}</span></span>`; if (r.type === 'case') return html`${t}Кейс: ${r.case_name || '#' + r.case_id}`; return r.type; };
  const draw = () => {
    const s = d.season;
    const lv = Array.from({ length: 100 }, (_, i) => i + 1);
    mount(box, html`<div class="split"><form class="card" data-season><div class="row between"><h3>${s.name}</h3>${statusBadge(s.status, SEASON_ST)}</div>${seasonForm(s)}<div class="row gap wrap mt"><button class="btn">Сохранить</button>${s.status === 'draft' ? html`<button type="button" class="btn ghost" data-pub>Опубликовать сезон</button>` : ''}${s.status === 'active' ? html`<button type="button" class="btn red" data-end>Завершить сезон</button>` : ''}</div></form>
      <form class="card form" data-gen><h3>Автозаполнение наград</h3><p class="muted sm">Заполнит все 100 уровней наградами балансом: база + шаг × уровень, премиум — с множителем. Отдельные уровни можно затем заменить скинами или кейсами.</p>
        <div class="g3"><label class="fld"><span>База, ₽</span><input name="base" type="number" min="0" step="0.01" value="10"></label><label class="fld"><span>Шаг, ₽</span><input name="step" type="number" min="0" step="0.01" value="2"></label><label class="fld"><span>Множитель премиума</span><input name="premiumMult" type="number" min="1" max="20" step="0.1" value="3"></label></div><button class="btn ghost">Заполнить уровни</button></form></div>
      <div class="card mt"><h3>Награды по уровням</h3><p class="muted sm">Нажмите на ячейку, чтобы изменить награду.</p><div class="tbl-wrap"><table class="tbl"><thead><tr><th>Уровень</th><th>Бесплатно</th><th>Премиум</th></tr></thead><tbody>
      ${lv.map((l) => html`<tr><td><b>${l}</b></td><td data-rw="${l}:free" style="cursor:pointer">${rwText(rw(l, 'free'))}</td><td data-rw="${l}:premium" style="cursor:pointer">${rwText(rw(l, 'premium'))}</td></tr>`)}</tbody></table></div></div>`);
  };
  const load = async () => { d = await api(base); if (ctx.alive()) draw(); };
  on(root, 'submit', 'form[data-season]', (e, f) => { e.preventDefault(); busy(f.querySelector('button:not([type])'), async () => { await api(base, seasonBody(formData(f))); toast('Сезон сохранён', 'ok'); await load(); }); });
  on(root, 'submit', 'form[data-gen]', (e, f) => { e.preventDefault(); busy(f.querySelector('button'), async () => { const v = formData(f); if (!(await confirmBox('Заменить награды всех 100 уровней?'))) return; await api(base + '/generate', { base: Number(v.base), step: Number(v.step), premiumMult: Number(v.premiumMult) }); toast('Награды сгенерированы', 'ok'); await load(); }); });
  on(root, 'click', '[data-pub]', (e, t) => busy(t, async () => { if (!(await confirmBox('Опубликовать сезон? Игроки начнут получать опыт.'))) return; await api(base + '/publish', {}); toast('Сезон опубликован', 'ok'); await load(); }));
  on(root, 'click', '[data-end]', (e, t) => busy(t, async () => { if (!(await confirmBox('Завершить сезон? Новый опыт перестанет начисляться.', 'Завершить', true))) return; await api(base + '/end', {}); toast('Сезон завершён', 'ok'); await load(); }));
  on(root, 'click', '[data-rw]', async (e, t) => {
    const [l, tr] = t.dataset.rw.split(':'); const cur = rw(Number(l), tr) || { type: 'balance' };
    const f = await askForm('Уровень ' + l + ' — ' + (tr === 'free' ? 'бесплатная ветка' : 'премиум'), html`<div class="form g2">
      <label class="fld"><span>Тип награды</span><select name="type">${opts([['balance', 'Баланс'], ['item', 'Скин'], ['case', 'Кейс'], ['none', 'Без награды']], cur.type)}</select></label>
      <label class="fld"><span>Сумма, ₽ (для баланса)</span><input name="amount" type="number" min="0" step="0.01" value="${toBC(cur.amount || 0)}"></label>
      <label class="fld"><span>ID скина (см. «Скины»)</span><input name="itemId" type="number" min="1" step="1" value="${cur.item_id || ''}"></label>
      <label class="fld"><span>ID кейса (см. «Кейсы»)</span><input name="caseId" type="number" min="1" step="1" value="${cur.case_id || ''}"></label>
      <label class="fld" style="grid-column:1/-1"><span>Подпись (необязательно)</span><input name="label" maxlength="80" value="${cur.label || ''}"></label></div>`, 'Сохранить');
    if (!f) return;
    const body = { level: Number(l), track: tr, type: f.type, label: f.label || '' };
    if (f.type === 'balance') body.amount = Number(f.amount);
    if (f.type === 'item') body.itemId = Number(f.itemId);
    if (f.type === 'case') body.caseId = Number(f.caseId);
    await busy(null, async () => { await api(base + '/reward', body); toast('Награда сохранена', 'ok'); await load(); });
  });
  await load();
}, P('Сезон BURGER PASS'));

// ---------- Пополнения и выводы ----------
const FIN_ST = { pending: 'На рассмотрении', approved: 'Одобрена', rejected: 'Отклонена', cancelled: 'Отменена' };
const KIND_RU = { deposit: 'Пополнение', withdraw: 'Вывод', withdrawal: 'Вывод' };
page('/admin/finance', (ctx) => {
  const L = listPage(ctx, {
    cur: '/admin/finance', title: 'Пополнения и выводы', url: '/api/admin/finance', state: { status: 'pending', kind: '', user: '' },
    filters: html`<select name="status">${opts([['', 'Любой статус'], ...Object.entries(FIN_ST)], 'pending')}</select><select name="kind">${opts([['', 'Все типы'], ['deposit', 'Пополнения'], ['withdraw', 'Выводы']], '')}</select><input name="user" placeholder="ID или логин игрока">`,
    render: (r) => { const prov = Array.isArray(r.providers) ? r.providers : Object.values(r.providers || {}); return html`${prov.length ? '' : html`<div class="mb">${notice('Одобренные платёжные провайдеры не подключены: игроки не могут создавать новые заявки. Одобряйте заявку только после фактического подтверждения от провайдера.', 'warn')}</div>`}${autoTable(r.rows, [
      { t: 'ID', k: 'id' }, { t: 'Игрок', f: (x) => (x.user ? html`<a href="/admin/users/${x.user.id}">${x.user.nickname}</a>` : '—') }, { t: 'Тип', f: (x) => KIND_RU[x.kind] || x.kind },
      { t: 'Сумма', r: 1, f: (x) => bc(x.amount) }, { t: 'Способ', f: (x) => x.method || (x.item ? x.item.name : '—') }, { t: 'Статус', f: (x) => statusBadge(x.status, FIN_ST) },
      { t: 'Создана', f: when }, { t: 'Решение', f: (x) => (x.decidedAt ? html`<span class="xs">${fdate(x.decidedAt)}${x.staff ? ', ' + (x.staff.nickname || x.staff) : ''}<br>${x.comment || ''}</span>` : '—') },
      { t: '', r: 1, f: (x) => (x.status === 'pending' ? html`<span class="row gap end"><button class="btn sm" data-dec="${x.id}:approve">Одобрить</button><button class="btn ghost sm" data-dec="${x.id}:reject">Отклонить</button></span>` : '') },
    ], { empty: 'Заявок нет' })}`; },
  });
  on(L.root, 'click', '[data-dec]', async (e, t) => {
    const [id, decision] = t.dataset.dec.split(':');
    const f = await askForm(decision === 'approve' ? 'Одобрить заявку #' + id : 'Отклонить заявку #' + id, html`<label class="fld"><span>Комментарий к решению (увидит игрок)</span><textarea name="comment" rows="3" minlength="3" maxlength="1000" required></textarea></label>`, decision === 'approve' ? 'Одобрить' : 'Отклонить', { danger: decision !== 'approve', note: 'Заявку можно обработать только один раз. При отклонении вывода средства или предмет возвращаются игроку.' });
    if (!f) return;
    await busy(null, async () => { await api('/api/admin/finance/' + id + '/decide', { decision, comment: f.comment }); toast('Решение сохранено', 'ok'); L.load(); });
  });
}, P('Пополнения и выводы'));

import './admin3.js';
