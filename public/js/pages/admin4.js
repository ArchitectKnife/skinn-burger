// BURGER SKIN — админ-панель: звук, апгрейдер, обложки кейсов, премиум-каталог.
import { page, api, html, raw, mount, $, $$, on, toast, busy, loader, notice, num, fdate, img, rub, cssColor, coverHtml } from '../core.js';
import { icon } from '../icons.js';
import { uploadImage } from './shared.js';
import { shell, wire, autoTable } from './admin-ui.js';
import { sfx } from '../sound.js';

const P = (t) => ({ staff: true, title: t + ' — админ-панель' });
const pctv = (x) => (Math.round((Number(x) || 0) * 10000) / 100).toLocaleString('ru-RU') + '%';
const qstr = (o) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '') p.set(k, v); const s = p.toString(); return s ? '?' + s : ''; };
const yesNo = (v, y = 'да', n = 'нет') => html`<span class="badge ${v ? 'ok' : 'warn'}">${v ? y : n}</span>`;

// ---------- Звук ----------
page('/admin/sound', async (ctx) => {
  const box = shell(ctx, '/admin/sound', 'Звук', loader());
  wire(box);
  const d = await api('/api/admin/settings');
  const s = (d.settings && d.settings.sound) || {};
  const pc = (k, def) => Math.round((s[k] ?? def) * 100);
  const rng = (k, label, def) => html`<label class="fld"><span>${label}: <b data-v="${k}">${pc(k, def)}%</b></span><input type="range" min="0" max="100" step="1" name="${k}" value="${pc(k, def)}"></label>`;
  const chk = (k, label) => html`<label class="check"><input type="checkbox" name="${k}" ${s[k] !== false ? raw('checked') : ''}><span>${label}</span></label>`;
  mount(box, html`<form class="card pad adm-form" data-f>
    <p class="muted sm">Значения по умолчанию для новых посетителей. Игрок меняет громкость кнопкой звука в шапке — его выбор сохраняется в аккаунте и браузере. Звук не воспроизводится до первого действия пользователя на странице.</p>
    <div class="stack">${chk('enabled_default', 'Звук включён по умолчанию')}${chk('case_sounds', 'Звуки открытия кейсов и продажи')}${chk('upgrade_sounds', 'Звуки апгрейдера')}${chk('cinema_sounds', 'Звуки кинодропов (GODLIKE / MYTHIC / DIVINE / ножи / перчатки)')}</div>
    <div class="grid g3 mt">${rng('master', 'Общая громкость', 0.7)}${rng('effects', 'Эффекты (кейсы, продажа)', 0.8)}${rng('upgrade', 'Апгрейдер', 0.8)}${rng('cinema', 'Кинодропы', 0.9)}</div>
    <div class="row gap mt"><button class="btn">${icon('save')}<span>Сохранить</span></button><button type="button" class="btn ghost" data-test="rare">${icon('play')}<span>Редкий дроп</span></button><button type="button" class="btn ghost" data-test="gold">${icon('play')}<span>Нож / перчатки</span></button><button type="button" class="btn ghost" data-test="win">${icon('play')}<span>Успешный апгрейд</span></button></div>
  </form>`);
  const f = $('[data-f]', box);
  on(f, 'input', 'input[type=range]', (e, i) => { const v = $(`[data-v="${i.name}"]`, f); if (v) v.textContent = i.value + '%'; });
  on(f, 'click', '[data-test]', (e, b) => sfx(b.dataset.test, { ch: b.dataset.test === 'win' ? 'upgrade' : 'effects' }));
  f.addEventListener('submit', (e) => { e.preventDefault(); const b = $('button.btn:not(.ghost)', f); busy(b, async () => {
    const v = { enabled_default: f.enabled_default.checked, case_sounds: f.case_sounds.checked, upgrade_sounds: f.upgrade_sounds.checked,
      master: Number(f.master.value) / 100, effects: Number(f.effects.value) / 100, upgrade: Number(f.upgrade.value) / 100, cinema_sounds: f.cinema_sounds.checked, cinema: Number(f.cinema.value) / 100 };
    await api('/api/admin/settings', { key: 'sound', value: v }); toast('Настройки звука сохранены', 'ok');
  }); });
}, P('Звук'));

// ---------- Апгрейдер ----------
page('/admin/upgrader', async (ctx) => {
  const box = shell(ctx, '/admin/upgrader', 'Апгрейдер', loader());
  wire(box);
  let u = {};
  const st = { page: 1, q: '', result: '' };
  const example = () => {
    const ch = (m) => Math.min(u.max_chance, u.rtp * Math.pow(1 / m, Math.max(1, u.curve || 1)));
    return (u.presets || []).map((m) => `×${m} → ${pctv(ch(m))}`).join(' · ');
  };
  const fld = (name, label, step, val) => html`<label class="fld"><span>${label}</span><input name="${name}" type="number" step="${step}" value="${val ?? ''}" required></label>`;
  const draw = () => mount(box, html`<form class="card pad adm-form" data-f>
      <div class="grid g3">
        <label class="fld"><span>Кнопки множителей (через запятую, до 8)</span><input name="presets" value="${(u.presets || []).join(', ')}" required></label>
        ${fld('min_mult', 'Минимальный множитель (1.01–5)', '0.01', u.min_mult)}
        ${fld('max_mult', 'Максимальный множитель', '0.1', u.max_mult)}
        ${fld('rtp', 'RTP — доля возврата (0.5–0.99)', '0.01', u.rtp)}
        ${fld('max_chance', 'Максимальный шанс (0.05–0.95)', '0.01', u.max_chance)}
        ${fld('min_chance', 'Минимальный шанс (ниже — апгрейд запрещён)', '0.0001', u.min_chance)}
        ${fld('curve', 'Кривая формулы (1 — линейная, до 2)', '0.05', u.curve)}
        ${fld('max_items', 'Предметов за один апгрейд (1–10)', '1', u.max_items)}
        ${fld('tolerance', 'Допуск автоподбора целей (0.02–0.5)', '0.01', u.tolerance)}
      </div>
      <p class="xs muted mt">Формула: шанс = min(макс. шанс, RTP × (ставка / цель)^кривая). При кривой ≥ 1 математическое ожидание игрока не превышает RTP. Расчёт выполняется только на сервере.<br>Текущие шансы: ${example()}</p>
      <div class="row gap"><button class="btn">${icon('save')}<span>Сохранить</span></button></div>
    </form>
    <section class="card pad mt"><div class="row between mb"><h3>История апгрейдов</h3>
      <form class="filters" data-hf><input name="q" placeholder="Игрок, ID игрока или ставки" value="${st.q}"><select name="result"><option value="">Все</option><option value="won">Успешные</option><option value="lost">Неудачные</option></select><button class="btn">Показать</button></form></div>
      <div data-h>${loader()}</div></section>`);
  const loadHist = async () => {
    const r = await api('/api/admin/upgrades' + qstr(st));
    const h = $('[data-h]', box); if (!h || !ctx.alive()) return;
    const s = r.stats || {};
    mount(h, html`<div class="row gap-l mb sm"><span>Всего: <b>${num(s.n)}</b></span><span>Успешных: <b>${num(s.wins)}</b></span><span>Поставлено: <b>${rub(s.wagered)}</b></span><span>Выдано: <b>${rub(s.paid)}</b></span><span>Фактический возврат: <b>${s.wagered ? pctv(s.paid / s.wagered) : '—'}</b></span></div>
      ${autoTable(r.rows, [
        { t: 'ID', k: 'id' },
        { t: 'Игрок', f: (x) => html`<a href="/admin/users/${x.user.id}">${x.user.nickname || x.user.login}</a>` },
        { t: 'Ставка', r: 1, f: (x) => rub(x.amount) },
        { t: 'Цель', f: (x) => (x.target ? html`<span class="row gap">${img(x.target.image, 'mini-it', x.target.name)}<span class="sm">${x.target.name}</span></span>` : '—') },
        { t: 'Множитель', r: 1, f: (x) => '×' + (Number(x.multiplier) || 0).toFixed(2) },
        { t: 'Шанс', r: 1, f: (x) => (x.chance != null ? pctv(x.chance) : '—') },
        { t: 'Точка', r: 1, f: (x) => (x.roll != null ? pctv(x.roll) : '—') },
        { t: 'Итог', f: (x) => html`<span class="badge ${x.status === 'won' ? 'ok' : 'err'}">${x.status === 'won' ? 'Успех' : 'Неудача'}</span>` },
        { t: 'Выдано', r: 1, f: (x) => rub(x.payout) },
        { t: 'Дата', f: (x) => fdate(x.createdAt) },
      ], { empty: 'Апгрейдов пока нет' })}
      <div class="row gap mt">${r.page > 1 ? html`<button type="button" class="btn ghost sm" data-pg="${r.page - 1}">Назад</button>` : ''}<span class="sm muted">Страница ${r.page} из ${Math.max(1, Math.ceil(r.total / r.per))}</span>${r.page * r.per < r.total ? html`<button type="button" class="btn ghost sm" data-pg="${r.page + 1}">Далее</button>` : ''}</div>`);
  };
  const load = async () => { const d = await api('/api/admin/settings'); u = (d.settings && d.settings.upgrade) || {}; if (!ctx.alive()) return; draw(); loadHist(); };
  on(box, 'submit', '[data-f]', (e, f) => { e.preventDefault(); busy($('button', f), async () => {
    const v = { presets: f.presets.value }; for (const k of ['min_mult', 'max_mult', 'rtp', 'max_chance', 'min_chance', 'curve', 'max_items', 'tolerance']) v[k] = Number(String(f[k].value).replace(',', '.'));
    await api('/api/admin/settings', { key: 'upgrade', value: v }); toast('Правила апгрейдера сохранены', 'ok'); await load();
  }); });
  on(box, 'submit', '[data-hf]', (e, f) => { e.preventDefault(); st.q = f.q.value.trim(); st.result = f.result.value; st.page = 1; loadHist(); });
  on(box, 'click', '[data-pg]', (e, b) => { st.page = Number(b.dataset.pg); loadHist(); });
  await load();
}, P('Апгрейдер'));

// ---------- Обложки кейсов ----------
page('/admin/covers', async (ctx) => {
  const box = shell(ctx, '/admin/covers', 'Обложки кейсов', loader());
  wire(box);
  let d;
  const card = (c) => {
    const sel = new Set(c.cover.custom ? c.cover.items.map((x) => x.id) : []);
    return html`<div class="card pad cov-card" data-id="${c.id}" data-img="${c.cover.mode === 'image' ? c.image || '' : ''}">
      <div class="cov-top"><div class="cov-prev case-img" style="--ac:${cssColor(c.cover.items[0]?.color, '#FFB627')}">${coverHtml({ ...c, image: c.cover.image || c.image })}</div>
        <div class="grow"><b>${c.name}</b><div class="xs muted mono">${c.slug}</div>${c.cover.missing ? html`<div class="badge warn mt">нет реальных изображений</div>` : ''}
          <div class="seg sm mt" data-mode><button type="button" data-m="auto" class="${c.cover.mode === 'auto' ? 'on' : ''}">Из предметов</button><button type="button" data-m="image" class="${c.cover.mode === 'image' ? 'on' : ''}">Своё изображение</button></div></div></div>
      <div class="xs muted mt">Предметы на обложке (до 3; если не выбрано — самые дорогие):</div>
      <div class="cov-items">${c.candidates.map((it) => html`<label class="cov-it" title="${it.name}" style="--rc:${cssColor(it.color)}"><input type="checkbox" value="${it.id}" ${sel.has(it.id) ? raw('checked') : ''}>${img(it.image, '', it.name)}</label>`)}</div>
      <div class="row gap mt"><label class="btn ghost sm">${icon('upload')}<span>Загрузить изображение</span><input type="file" accept="image/png,image/jpeg,image/webp" data-file hidden></label><button type="button" class="btn sm" data-save>${icon('save')}<span>Сохранить</span></button></div>
    </div>`;
  };
  const draw = () => mount(box, html`
    ${d.missing.length ? notice(html`Кейсы без реальных изображений предметов (${d.missing.length}): ${d.missing.map((m) => m.name).join(', ')}. Импортируйте изображения скинов в разделе «Импорт» или загрузите обложку вручную.`, 'warn') : notice('У всех кейсов есть обложка из реальных изображений предметов.', 'ok')}
    <p class="muted sm">Режим «Из предметов» собирает обложку из 1–3 предметов состава кейса с подсветкой по редкости. Режим «Своё изображение» использует загруженный файл.</p>
    <div class="adm-covers">${d.cases.map(card)}</div>`);
  const load = async () => { d = await api('/api/admin/covers'); if (ctx.alive()) draw(); };
  on(box, 'click', '[data-mode] button', (e, b) => { for (const x of $$('button', b.parentNode)) x.classList.toggle('on', x === b); });
  on(box, 'change', '[data-file]', (e, inp) => { const f = inp.files && inp.files[0]; const cardEl = inp.closest('.cov-card'); busy(inp.closest('label'), async () => {
    const r = await uploadImage(f, 'case'); const url = typeof r === 'string' ? r : r.url || r.path || r.image;
    cardEl.dataset.img = url; for (const x of $$('[data-mode] button', cardEl)) x.classList.toggle('on', x.dataset.m === 'image');
    mount($('.cov-prev', cardEl), html`<div class="cover n1">${img(url)}</div>`); toast('Изображение загружено — нажмите «Сохранить»', 'info');
  }); });
  on(box, 'click', '[data-save]', (e, b) => { const cardEl = b.closest('.cov-card'); busy(b, async () => {
    const mode = $('[data-mode] button.on', cardEl)?.dataset.m || 'auto';
    const items = $$('.cov-items input:checked', cardEl).map((x) => Number(x.value)).slice(0, 3);
    await api(`/api/admin/cases/${cardEl.dataset.id}/cover`, { mode, items, image: cardEl.dataset.img || '' });
    toast('Обложка сохранена', 'ok'); await load();
  }); });
  on(box, 'change', '.cov-items input', (e, inp) => { const all = $$('.cov-items input:checked', inp.closest('.cov-card')); if (all.length > 3) { inp.checked = false; toast('Можно выбрать до трёх предметов', 'info'); } });
  await load();
}, P('Обложки кейсов'));

// ---------- Премиум-каталог ----------
page('/admin/wishlist', async (ctx) => {
  const box = shell(ctx, '/admin/wishlist', 'Премиум-каталог', loader());
  wire(box);
  const d = await api('/api/admin/catalog/wishlist');
  if (!ctx.alive()) return;
  const groups = d.groups || {};
  mount(box, html`${notice(html`Список премиальных предметов для импорта: <b>${d.total}</b>. Уже в каталоге: <b>${d.inCatalog}</b>, не хватает: <b>${d.missing}</b>. Импорт с изображениями: <code>npm run import:premium</code> (нужен доступ в интернет), затем цены: <code>npm run import:prices</code>. Файл списка: <code>${d.file}</code>.`, d.missing ? 'warn' : 'ok')}
    ${autoTable(d.items, [
      { t: 'Предмет', f: (x) => (x.itemId ? html`<a href="/admin/items/${x.itemId}">${x.name}</a>` : x.name) },
      { t: 'Раздел', f: (x) => groups[x.group] || x.group || '—' },
      { t: 'В каталоге', f: (x) => yesNo(x.inCatalog) },
      { t: 'Изображение', f: (x) => yesNo(x.image, 'есть', 'нет') },
      { t: 'Рыночная цена', f: (x) => yesNo(x.priced, 'загружена', 'нет') },
    ], { empty: 'Список пуст' })}`);
}, P('Премиум-каталог'));
