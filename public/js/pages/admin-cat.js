// BURGER SKIN — админ-панель: кейсы, скины, импорт каталога и цен.
import { page, api, html, raw, mount, $, $$, on, toast, busy, formData, loader, notice, num, bc, pct, fdate, img, go, rarityRu, confirmBox } from '../core.js';
import { uploadImage, catRu } from './shared.js';
import { shell, wire, listPage, askForm, kv, autoTable, toBC, opts, statusBadge, fileBtn } from './admin-ui.js';

const P = (t) => ({ staff: true, title: t + ' — админ-панель' });
const RARITIES = ['Consumer Grade', 'Industrial Grade', 'Mil-Spec Grade', 'Restricted', 'Classified', 'Covert', 'Extraordinary', 'Contraband'];
const CASE_ST = { draft: 'Черновик', published: 'Опубликован', hidden: 'Скрыт', archived: 'В архиве' };
const catList = (c) => (Array.isArray(c) ? c.map((k) => (typeof k === 'string' ? [k, catRu(k)] : [k.id || k.key, k.name || k.label])) : Object.entries(c || {}));
const itemCell = (it) => html`<span class="row gap">${img(it.image, 'mini-it')}<span><b style="color:${it.color || 'inherit'}">${it.name}</b>${it.rarityName ? html`<br><span class="xs muted">${rarityRu(it.rarityName)}</span>` : ''}</span></span>`;
const rtpText = (v) => (v == null ? '—' : v <= 2 ? pct(v) : Number(v).toFixed(1) + '%');
const VARIANT = { st: 'StatTrak™', sv: 'Souvenir', '': 'Обычный' };

// Загрузка изображений: <input type=file data-file="имя поля"> заполняет поле формы адресом файла.
function bindUploads(root, kind) {
  on(root, 'change', 'input[data-file]', async (e, t) => {
    const f = t.files && t.files[0]; if (!f) return;
    const form = t.closest('form');
    try {
      const r = await uploadImage(f, kind);
      const inp = form.elements.namedItem(t.dataset.file); if (inp) inp.value = r.url;
      const prev = form.querySelector('[data-prev]'); if (prev) prev.src = r.url;
      toast('Изображение загружено — не забудьте сохранить', 'ok');
    } catch (err) { toast(err.message, 'err'); }
    t.value = '';
  });
}

// ---------- Кейсы ----------
page('/admin/cases', (ctx) => {
  const L = listPage(ctx, {
    cur: '/admin/cases', title: 'Кейсы', url: '/api/admin/cases', size: 100, state: { q: '', status: '' },
    right: html`<div class="row gap wrap"><a class="btn" href="/admin/cases/new">Новый кейс</a><button class="btn ghost" data-gen>Собрать тематические кейсы</button><button class="btn ghost" data-recalc>Пересчитать цены</button></div>`,
    filters: html`<input name="q" placeholder="Название или адрес"><select name="status">${opts([['', 'Любой статус'], ...Object.entries(CASE_ST)], '')}</select>`,
    render: (r) => html`<p class="muted sm">Всего: ${num(r.total)}. Цена в авторежиме рассчитывается сервером из стоимости содержимого и наценки.</p>${autoTable(r.rows, [
      { t: 'Кейс', f: (c) => html`<span class="row gap">${img(c.image, 'mini-it')}<span><b>${c.name}</b><br><span class="xs muted mono">${c.slug}</span></span></span>` },
      { t: 'Статус', f: (c) => statusBadge(c.status, CASE_ST) },
      { t: 'Цена', r: 1, f: (c) => html`${bc(c.price)}<br><span class="xs muted">${c.priceMode === 'manual' ? 'вручную' : 'авто'}</span>` },
      { t: 'Ожид. дроп', r: 1, f: (c) => bc(c.ev) },
      { t: 'RTP', r: 1, f: (c) => rtpText(c.rtp) },
      { t: 'Предметов', r: 1, f: (c) => num(Array.isArray(c.items) ? c.items.length : c.items) },
      { t: 'Открытий', r: 1, f: (c) => num(c.opens) },
      { t: 'Категории', f: (c) => html`<span class="xs">${(c.categories || []).map(catRu).join(', ') || '—'}</span>` },
    ], { href: (c) => '/admin/cases/' + c.id, empty: 'Кейсов не найдено' })}`,
  });
  on(L.root, 'click', '[data-gen]', (e, t) => busy(t, async () => {
    if (!(await confirmBox('Собрать тематические кейсы из каталога? Будут созданы кейсы по оружию, ножам, перчаткам и редкости — только из предметов с изображением и ценой.'))) return;
    const r = await api('/api/admin/cases-generate', {});
    toast('Готово: создано ' + num(r.created || 0) + ', пропущено ' + num(r.skipped || 0), 'ok', 5000);
    L.load();
  }));
  on(L.root, 'click', '[data-recalc]', (e, t) => busy(t, async () => { await api('/api/admin/cases-recalc', {}); toast('Цены и шансы кейсов пересчитаны', 'ok'); L.load(); }));
}, P('Кейсы'));

const ODDS = { mil: 0.7992, res: 0.1598, cla: 0.032, cov: 0.0064, rare: 0.0026 };
const bucket = (x) => (String(x.name).startsWith('★') ? 'rare' : { 'Restricted': 'res', 'Classified': 'cla', 'Covert': 'cov', 'Extraordinary': 'rare', 'Contraband': 'rare' }[x.rarityName] || 'mil');

page('/admin/cases/:id', async (ctx) => {
  const isNew = ctx.params.id === 'new';
  const box = shell(ctx, '/admin/cases', isNew ? 'Новый кейс' : 'Редактирование кейса', loader(), html`<a class="btn ghost" href="/admin/cases">← К списку кейсов</a>`);
  const root = wire(box);
  bindUploads(root, 'cover');
  let d = { case: null }; let cats = []; let contents = []; let timer = 0;
  const cid = () => encodeURIComponent(d.case ? d.case.id : ctx.params.id);
  const total = () => contents.reduce((a, x) => a + (Number(x.weight) || 0), 0);
  const contentsHtml = () => {
    const t = total();
    const ev = t ? contents.reduce((a, x) => a + ((x.price || 0) * (Number(x.weight) || 0)) / t, 0) : 0;
    return html`<div class="row between wrap gap"><h3 style="margin:0">Содержимое и шансы (${contents.length})</h3><div class="row gap wrap"><button type="button" class="btn ghost sm" data-odds>Шансы как в официальных кейсах</button><button type="button" class="btn ghost sm" data-eq>Равные шансы</button><button type="button" class="btn sm" data-save-items>Сохранить содержимое</button></div></div>
      <p class="muted sm">Шанс предмета = его вес / сумма весов. Ожидаемая стоимость дропа по текущим весам: <b data-ev>${bc(Math.round(ev))}</b>. Игроки видят те же шансы на странице кейса; изменения вступают в силу только после сохранения и не влияют на уже сделанные открытия.</p>
      ${contents.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Предмет</th><th class="r">Цена</th><th class="r">Вес</th><th class="r">Шанс</th><th></th></tr></thead><tbody>${contents.map((x, i) => html`<tr><td>${itemCell(x)}</td><td class="r">${bc(x.price)}</td><td class="r"><input type="number" min="0" step="any" value="${x.weight}" data-w="${i}" style="width:110px"></td><td class="r mono" data-ch="${i}">${t ? pct((Number(x.weight) || 0) / t) : '—'}</td><td class="r"><button type="button" class="btn ghost sm" data-rm="${i}">Убрать</button></td></tr>`)}</tbody></table></div>` : html`<p class="muted">В кейсе пока нет предметов — добавьте их через поиск ниже.</p>`}`;
  };
  const resultsHtml = (rows) => (rows.length ? autoTable(rows, [{ t: 'Предмет', f: itemCell }, { t: 'Цена', r: 1, f: (x) => (x.price ? bc(x.price) : html`<span class="badge warn">нет цены</span>`) }, { t: '', r: 1, f: (x) => (contents.some((c) => c.id === x.id) ? html`<span class="muted sm">уже в кейсе</span>` : html`<button type="button" class="btn ghost sm" data-add="${x.id}">Добавить</button>`) }]) : html`<p class="muted sm">Ничего не найдено</p>`);
  let found = [];
  const redrawContents = () => { const el = $('[data-contents]', box); if (el) mount(el, contentsHtml()); const rs = $('[data-ires]', box); if (rs && found.length) mount(rs, resultsHtml(found)); };
  const draw = () => {
    const c = d.case || { name: '', slug: '', description: '', image: '', priceMode: 'auto', price: 0, categories: [], status: 'draft', sort: 100 };
    const imgVal = c.rawImage ?? c.image ?? '';
    mount(box, html`<div class="split">
      <form class="card form" data-case>
        <div class="g2"><label class="fld"><span>Название</span><input name="name" required minlength="2" maxlength="80" value="${c.name}"></label><label class="fld"><span>Адрес страницы (slug)</span><input name="slug" maxlength="80" value="${c.slug || ''}" placeholder="создаётся из названия"></label></div>
        <label class="fld"><span>Описание</span><textarea name="description" rows="3" maxlength="2000">${c.description || ''}</textarea></label>
        <div class="row gap"><img data-prev src="${c.image || '/img/brand/case.svg'}" alt="" style="width:96px;height:96px;object-fit:contain"><label class="fld grow"><span>Обложка (загрузите файл или укажите путь /img/... или /uploads/public/...)</span><input name="image" value="${imgVal}"></label>${fileBtn('image')}</div>
        <div class="g4">
          <label class="fld"><span>Цена</span><select name="priceMode">${opts([['auto', 'Авто (по содержимому)'], ['manual', 'Вручную']], c.priceMode)}</select></label>
          <label class="fld"><span>Цена в ₽ (для ручного режима)</span><input name="price" type="number" min="0.01" step="0.01" value="${toBC(c.price)}"></label>
          <label class="fld"><span>Статус</span><select name="status">${opts(Object.entries(CASE_ST), c.status)}</select></label>
          <label class="fld"><span>Порядок сортировки</span><input name="sort" type="number" step="1" value="${c.sort ?? 100}"></label>
        </div>
        <div><span class="sm muted">Категории каталога</span><div class="row gap wrap mt">${cats.map(([k, l]) => html`<label class="check"><input type="checkbox" name="cat_${k}" ${(c.categories || []).includes(k) ? raw('checked') : ''}><span>${l}</span></label>`)}</div></div>
        <div class="row gap wrap"><button class="btn">${isNew ? 'Создать кейс' : 'Сохранить'}</button>${!isNew ? html`<a class="btn ghost" href="/cases/${c.slug}" target="_blank" rel="noopener">Предпросмотр</a><button type="button" class="btn red" data-del>Удалить или архивировать</button>` : ''}</div>
      </form>
      ${!isNew ? html`<div class="card"><h3>Сводка</h3>${kv([['ID', c.id], ['Статус', statusBadge(c.status, CASE_ST)], ['Текущая цена', bc(c.price)], ['Ожидаемый дроп', bc(c.ev)], ['RTP', rtpText(c.rtp)], ['Открытий', num(c.opens)], ['Источник', c.source || 'вручную'], ['Создан', fdate(c.createdAt)]])}</div>` : ''}
    </div>
    ${isNew ? html`<div class="mt">${notice('Сначала сохраните кейс как черновик, затем добавьте предметы и настройте шансы. Пустой кейс опубликовать нельзя.')}</div>` : html`<div class="card mt" data-contents>${contentsHtml()}</div>
      <div class="card mt"><h3>Добавить предметы</h3><input data-isearch placeholder="Поиск по каталогу: AK-47, Kukri, Kilowatt..." style="width:100%"><div data-ires class="mt"><p class="muted sm">Начните вводить название предмета.</p></div></div>`}`);
  };
  const load = async () => {
    if (isNew) { const r = await api('/api/admin/cases?page=1'); cats = catList(r.categories); }
    else {
      d = await api('/api/admin/cases/' + encodeURIComponent(ctx.params.id));
      cats = catList(d.categories);
      contents = (d.case.contents || []).map((x) => ({ id: x.id, name: x.name, image: x.image, color: x.color, rarityName: x.rarityName, price: x.price, weight: x.weight }));
    }
    if (ctx.alive()) draw();
  };
  on(root, 'submit', 'form[data-case]', (e, f) => {
    e.preventDefault();
    busy(f.querySelector('button:not([type])'), async () => {
      const v = formData(f);
      const body = { name: v.name, description: v.description, priceMode: v.priceMode, status: v.status, sort: Number(v.sort) || 0, categories: cats.map(([k]) => k).filter((k) => v['cat_' + k]) };
      if (v.slug) body.slug = v.slug;
      if (v.image) body.image = v.image;
      if (v.priceMode === 'manual') body.price = Number(v.price);
      if (isNew) {
        const r = await api('/api/admin/cases', body);
        toast('Кейс создан', 'ok');
        go('/admin/cases/' + (r.case ? r.case.id : r.id), { replace: true });
      } else { await api('/api/admin/cases/' + cid(), body); toast('Изменения сохранены', 'ok'); await load(); }
    });
  });
  on(root, 'input', '[data-w]', (e, t) => {
    contents[Number(t.dataset.w)].weight = Number(t.value) || 0;
    const tt = total();
    for (const el of $$('[data-ch]', box)) { const x = contents[Number(el.dataset.ch)]; el.textContent = tt ? pct((Number(x.weight) || 0) / tt) : '—'; }
    const evEl = $('[data-ev]', box);
    if (evEl) mount(evEl, bc(Math.round(tt ? contents.reduce((a, x) => a + ((x.price || 0) * (Number(x.weight) || 0)) / tt, 0) : 0)));
  });
  on(root, 'click', '[data-rm]', (e, t) => { contents.splice(Number(t.dataset.rm), 1); redrawContents(); });
  on(root, 'click', '[data-eq]', () => { for (const x of contents) x.weight = 1; redrawContents(); toast('Всем предметам задан одинаковый вес. Не забудьте сохранить.', 'info'); });
  on(root, 'click', '[data-odds]', () => {
    const cnt = {};
    for (const x of contents) { const b = bucket(x); cnt[b] = (cnt[b] || 0) + 1; }
    for (const x of contents) { const b = bucket(x); x.weight = Math.max(1, Math.round((ODDS[b] / cnt[b]) * 1e6)); }
    redrawContents();
    toast('Веса выставлены по опубликованным шансам Valve (79,92 / 15,98 / 3,2 / 0,64 / 0,26%). Не забудьте сохранить.', 'info', 6000);
  });
  on(root, 'click', '[data-save-items]', (e, t) => busy(t, async () => {
    if (contents.some((x) => !(Number(x.weight) > 0))) throw new Error('У каждого предмета должен быть вес больше нуля');
    await api('/api/admin/cases/' + cid() + '/items', { items: contents.map((x) => ({ itemId: x.id, weight: Number(x.weight) })) });
    toast('Содержимое сохранено, цена пересчитана', 'ok');
    await load();
  }));
  on(root, 'input', '[data-isearch]', (e, t) => {
    clearTimeout(timer);
    const q = t.value.trim();
    timer = setTimeout(async () => {
      const rs = $('[data-ires]', box); if (!rs) return;
      if (q.length < 2) { found = []; mount(rs, html`<p class="muted sm">Введите хотя бы 2 символа.</p>`); return; }
      try { const r = await api('/api/admin/items?q=' + encodeURIComponent(q)); found = (r.rows || []).filter((x) => !x.archived).slice(0, 40); mount(rs, resultsHtml(found)); } catch (err) { mount(rs, notice(err.message, 'err')); }
    }, 300);
  });
  on(root, 'click', '[data-add]', (e, t) => {
    const x = found.find((f) => String(f.id) === t.dataset.add); if (!x) return;
    if (!x.price) return toast('У предмета нет цены из проверенного источника — сначала импортируйте цену', 'err');
    contents.push({ id: x.id, name: x.name, image: x.image, color: x.color, rarityName: x.rarityName, price: x.price, weight: 1 });
    redrawContents();
  });
  on(root, 'click', '[data-del]', (e, t) => busy(t, async () => {
    if (!(await confirmBox('Удалить кейс? Если его уже открывали, он будет перенесён в архив — история игроков сохранится.', 'Удалить', true))) return;
    const r = await api('/api/admin/cases/' + cid() + '/delete', {});
    toast(r.archived ? 'Кейс перенесён в архив' : 'Кейс удалён', 'ok');
    go('/admin/cases');
  }));
  await load();
}, P('Кейс'));

// ---------- Скины ----------
const CAT_STAT = { items: 'Всего', withImage: 'С изображением', localImages: 'Изображений на сервере', withPrice: 'С ценой' };
page('/admin/items', (ctx) => {
  const sel = new Set();
  const L = listPage(ctx, {
    cur: '/admin/items', title: 'Скины', url: '/api/admin/items', size: 60, state: { q: '', weapon: '', rarity: '', category: '' },
    right: html`<div class="row gap wrap"><a class="btn" href="/admin/items/new">Добавить предмет</a><a class="btn ghost" href="/admin/import">Импорт и цены</a></div>`,
    filters: html`<input name="q" placeholder="Название или внешний ID"><input name="weapon" placeholder="Оружие, например AK-47"><select name="rarity">${opts([['', 'Любая редкость'], ...RARITIES.map((x) => [x, rarityRu(x)])], '')}</select><input name="category" placeholder="Категория"><label class="check"><input type="checkbox" name="archived"><span>Архив</span></label><label class="check"><input type="checkbox" name="noimage"><span>Без изображения</span></label><label class="check"><input type="checkbox" name="noprice"><span>Без цены</span></label>`,
    render: (r) => html`<div class="row gap wrap mb">${Object.entries(r.stats || {}).filter(([, v]) => typeof v === 'number').map(([k, v]) => html`<span class="chip">${CAT_STAT[k] || k}: <b>${num(v)}</b></span>`)}</div>
      <div class="toolbar row gap wrap mb"><label class="check"><input type="checkbox" data-all><span>Выбрать все на странице</span></label><span class="muted sm">Выбрано: <b data-selc>${sel.size}</b></span><button class="btn ghost sm" data-bulk>Массовое изменение</button><button class="btn ghost sm" data-clear>Сбросить выбор</button><span class="muted sm">Найдено: ${num(r.total)}</span></div>
      ${autoTable(r.rows, [
        { t: '', f: (it) => html`<input type="checkbox" data-sel="${it.id}" ${sel.has(it.id) ? raw('checked') : ''}>` },
        { t: 'Предмет', f: itemCell },
        { t: 'Оружие', f: (it) => it.weapon || '—' },
        { t: 'Категория', f: (it) => it.category || '—' },
        { t: 'Особенности', f: (it) => html`${it.stattrak ? html`<span class="badge warn">ST</span> ` : ''}${it.souvenir ? html`<span class="badge info">SV</span> ` : ''}${it.archived ? html`<span class="badge err">архив</span>` : ''}${it.rawImage || it.image ? '' : html`<span class="badge err">нет изображения</span>`}` },
        { t: 'Цена', r: 1, f: (it) => (it.price ? html`${bc(it.price)}<br><span class="xs muted">${it.priceSource || ''}</span>` : html`<span class="badge warn">нет цены</span>`) },
        { t: 'В кейсах', r: 1, f: (it) => num(Array.isArray(it.inCases) ? it.inCases.length : it.inCases || 0) },
        { t: 'ID', f: (it) => html`<span class="mono xs">${it.id}${it.extId ? ' / ' + it.extId : ''}</span>` },
      ], { href: (it) => '/admin/items/' + it.id, empty: 'Предметы не найдены' })}`,
  });
  const count = () => { const el = $('[data-selc]', L.box); if (el) el.textContent = String(sel.size); };
  on(L.root, 'change', '[data-sel]', (e, t) => { const id = Number(t.dataset.sel); if (t.checked) sel.add(id); else sel.delete(id); count(); });
  on(L.root, 'change', '[data-all]', (e, t) => { for (const c of $$('[data-sel]', L.box)) { c.checked = t.checked; const id = Number(c.dataset.sel); if (t.checked) sel.add(id); else sel.delete(id); } count(); });
  on(L.root, 'click', '[data-clear]', () => { sel.clear(); for (const c of $$('[data-sel]', L.box)) c.checked = false; count(); });
  on(L.root, 'click', '[data-bulk]', async () => {
    if (!sel.size) return toast('Сначала отметьте предметы в таблице', 'err');
    const keep = [['', 'Не менять']];
    const f = await askForm('Массовое изменение: ' + sel.size + ' предм.', html`<div class="g2">
      <label class="fld"><span>Редкость</span><select name="rarityName">${opts([...keep, ...RARITIES.map((x) => [x, rarityRu(x)])], '')}</select></label>
      <label class="fld"><span>Категория</span><input name="category" placeholder="не менять"></label>
      <label class="fld"><span>Оружие</span><input name="weapon" placeholder="не менять"></label>
      <label class="fld"><span>Коллекция</span><input name="collection" placeholder="не менять"></label>
      <label class="fld"><span>Архив</span><select name="archived">${opts([...keep, ['1', 'Перенести в архив'], ['0', 'Вернуть из архива']], '')}</select></label>
      <label class="fld"><span>StatTrak</span><select name="stattrak">${opts([...keep, ['1', 'Доступен'], ['0', 'Недоступен']], '')}</select></label>
      <label class="fld"><span>Souvenir</span><select name="souvenir">${opts([...keep, ['1', 'Доступен'], ['0', 'Недоступен']], '')}</select></label></div>`, 'Применить', { wide: true, note: 'Названия, внешние ID и цены массово не меняются: цены обновляются только импортом из проверенного источника.' });
    if (!f) return;
    const set = {};
    for (const k of ['rarityName', 'category', 'weapon', 'collection']) if (f[k]) set[k] = f[k];
    for (const k of ['archived', 'stattrak', 'souvenir']) if (f[k] !== '') set[k] = f[k] === '1';
    if (!Object.keys(set).length) return toast('Не выбрано ни одного изменения', 'err');
    await busy(null, async () => { const r = await api('/api/admin/items-bulk', { ids: [...sel], set }); toast('Обновлено предметов: ' + num(r.updated), 'ok'); sel.clear(); L.load(); });
  });
}, P('Скины'));

page('/admin/items/:id', async (ctx) => {
  const isNew = ctx.params.id === 'new';
  const box = shell(ctx, '/admin/items', isNew ? 'Новый предмет' : 'Редактирование предмета', loader(), html`<a class="btn ghost" href="/admin/items">← К списку</a>`);
  const root = wire(box);
  bindUploads(root, 'item');
  let d = null;
  const draw = () => {
    const it = d?.item || { name: '', weapon: '', category: '', pattern: '', rarity: '', rarityName: 'Mil-Spec Grade', collection: '', extId: '', color: '#4b69ff', minFloat: 0, maxFloat: 1, stattrak: false, souvenir: false, archived: false, price: null, priceSource: '' };
    const imgVal = it.rawImage ?? it.image ?? '';
    const chk = (n, l) => html`<label class="check"><input type="checkbox" name="${n}" ${it[n] ? raw('checked') : ''}><span>${l}</span></label>`;
    const fld = (n, l, extra = '') => html`<label class="fld"><span>${l}</span><input name="${n}" value="${it[n] ?? ''}" ${raw(extra)}></label>`;
    mount(box, html`<div class="split"><form class="card form" data-item>
      ${fld('name', 'Название (как в Steam, например «AK-47 | Redline»)', 'required maxlength="160"')}
      <div class="g3">${fld('weapon', 'Оружие')}${fld('category', 'Категория')}${fld('pattern', 'Раскраска')}</div>
      <div class="g3"><label class="fld"><span>Редкость</span><select name="rarityName">${opts(RARITIES.map((x) => [x, rarityRu(x)]), it.rarityName)}</select></label>${fld('rarity', 'Код редкости (rarity_…)')}${fld('color', 'Цвет редкости #RRGGBB', 'pattern="#[0-9a-fA-F]{6}"')}</div>
      <div class="g2">${fld('collection', 'Коллекция')}${fld('extId', 'Внешний ID (из каталога-источника)')}</div>
      <div class="row gap"><img data-prev src="${it.image || '/img/brand/item.svg'}" alt="" style="width:120px;height:90px;object-fit:contain"><label class="fld grow"><span>Изображение (файл или путь /img/..., /uploads/public/...)</span><input name="image" value="${imgVal}"></label>${fileBtn('image')}</div>
      <div class="g4"><label class="fld"><span>Мин. float</span><input name="minFloat" type="number" min="0" max="1" step="any" value="${it.minFloat ?? 0}"></label><label class="fld"><span>Макс. float</span><input name="maxFloat" type="number" min="0" max="1" step="any" value="${it.maxFloat ?? 1}"></label><label class="fld"><span>Цена, ₽</span><input name="price" type="number" min="0" step="0.01" value="${toBC(it.price)}"></label>${fld('priceSource', 'Источник цены', 'maxlength="60" placeholder="skinport, steam market..."')}</div>
      <p class="muted xs">Указывайте цену только из проверенного источника и обязательно заполняйте «Источник цены». Для массового обновления используйте импорт цен.</p>
      <div class="row gap wrap">${chk('stattrak', 'Есть StatTrak™')}${chk('souvenir', 'Есть Souvenir')}${chk('archived', 'В архиве (не выпадает и скрыт из каталога)')}</div>
      <div class="row gap"><button class="btn">${isNew ? 'Создать предмет' : 'Сохранить'}</button></div>
    </form>
    ${d ? html`<div class="stack"><div class="card"><h3>Цены по качеству</h3>${autoTable(d.prices, [{ t: 'Вариант', f: (p) => VARIANT[p.variant || ''] || p.variant }, { t: 'Качество', f: (p) => p.wear || 'любое' }, { t: 'Цена', r: 1, f: (p) => bc(p.price) }, { t: 'Источник', f: (p) => p.source || '—' }, { t: 'Обновлено', f: (p) => fdate(p.updated_at || p.updatedAt) }], { empty: 'Цен по качеству нет — импортируйте их из проверенного источника' })}</div>
      <div class="card"><h3>В кейсах</h3>${autoTable(d.cases, [{ t: 'Кейс', k: 'name' }, { t: 'Вес', r: 1, k: 'weight' }], { href: (c) => '/admin/cases/' + c.id, empty: 'Предмет не входит ни в один кейс' })}</div></div>` : ''}</div>`);
  };
  const load = async () => { if (!isNew) d = await api('/api/admin/items/' + encodeURIComponent(ctx.params.id)); if (ctx.alive()) draw(); };
  on(root, 'submit', 'form[data-item]', (e, f) => {
    e.preventDefault();
    busy(f.querySelector('button:not([type])'), async () => {
      const v = formData(f);
      const body = { name: v.name, stattrak: !!v.stattrak, souvenir: !!v.souvenir, archived: !!v.archived, minFloat: Number(v.minFloat), maxFloat: Number(v.maxFloat), rarityName: v.rarityName };
      for (const k of ['weapon', 'category', 'pattern', 'rarity', 'collection', 'extId', 'color', 'image', 'priceSource']) if (v[k] !== '' && v[k] != null) body[k] = v[k];
      if (v.price !== '' && v.price != null) body.price = Number(v.price);
      if (body.price && !body.priceSource) throw new Error('Укажите источник цены');
      if (isNew) { const r = await api('/api/admin/items', body); toast('Предмет создан', 'ok'); go('/admin/items/' + (r.item ? r.item.id : r.id), { replace: true }); }
      else { await api('/api/admin/items/' + encodeURIComponent(ctx.params.id), body); toast('Изменения сохранены', 'ok'); await load(); }
    });
  });
  await load();
}, P('Предмет'));

// ---------- Импорт ----------
const report = (r) => html`${kv([['Добавлено', num(r.added || 0)], ['Обновлено', num(r.updated || 0)], ['Пропущено', num(r.skipped || 0)]])}
  ${r.errors?.length ? html`<details class="mt" open><summary>Замечания (${r.errors.length})</summary><ul class="sm">${r.errors.slice(0, 100).map((x) => html`<li>Строка ${x.row}: ${x.error}</li>`)}</ul></details>` : ''}
  ${r.unmatched?.length ? html`<details class="mt"><summary>Не найдены в каталоге (${r.unmatched.length})</summary><ul class="sm">${r.unmatched.slice(0, 200).map((x) => html`<li>${x}</li>`)}</ul></details>` : ''}`;
page('/admin/import', async (ctx) => {
  const form = (kind, title, about, src) => html`<form class="card form" data-imp="${kind}"><h3>${title}</h3><p class="muted sm">${about}</p>
    <label class="btn ghost sm" style="cursor:pointer;align-self:flex-start">Выбрать файл JSON/CSV<input type="file" accept=".json,.csv,application/json,text/csv" data-text hidden></label>
    <label class="fld"><span>Данные</span><textarea name="data" rows="8" class="mono" required placeholder="Вставьте JSON-массив или CSV с заголовком"></textarea></label>
    <div class="g2"><label class="fld"><span>Формат</span><select name="format">${opts([['', 'Определить автоматически'], ['json', 'JSON'], ['csv', 'CSV']], '')}</select></label><label class="fld"><span>Источник данных</span><input name="source" required maxlength="60" value="${src}"></label></div>
    <button class="btn">Импортировать</button><div data-res></div></form>`;
  const cmd = ['# на компьютере с интернетом, в папке проекта:', 'npm run import:catalog -- --download-images   # каталог скинов + изображения', 'npm run import:prices                          # рыночные цены Skinport', 'npm run import:catalog -- --file ./skins.json  # из заранее скачанного файла', 'npm run import:prices -- --file ./prices.json'].join('\n');
  const box = shell(ctx, '/admin/import', 'Импорт каталога и цен', html`<div class="g2">
    ${form('items', 'Импорт предметов', 'Поддерживается файл skins.json из открытого каталога ByMykel CSGO-API и собственный JSON/CSV. Основные поля: name, weapon, category, pattern, rarity, color, image, min_float, max_float, stattrak, souvenir, collection, ext_id. Предметы сопоставляются по ext_id или названию: существующие обновляются, новые добавляются.', 'bymykel')}
    ${form('prices', 'Импорт цен', 'Ответ Skinport (поля market_hash_name и suggested_price / median_price / min_price) или свой файл с полями name, wear (FN/MW/FT/WW/BS), variant (st/sv), price. Цены импортируются в рублях: укажите источник с ценами в RUB (например, Skinport с currency=RUB). Источник обязателен и показывается игрокам.', 'skinport')}
  </div>
  <div class="card mt"><h3>Большой каталог через консоль</h3><p class="muted sm">Файлы больше нескольких мегабайт и скачивание изображений удобнее запускать на сервере:</p><pre class="json">${cmd}</pre></div>
  <div class="card mt" data-dups>${loader()}</div>`);
  const root = wire(box);
  on(root, 'change', 'input[data-text]', async (e, t) => {
    const f = t.files && t.files[0]; if (!f) return;
    if (f.size > 8 * 1024 * 1024) { toast('Файл больше 8 МБ — используйте консольную команду с флагом --file', 'err', 6000); t.value = ''; return; }
    const form = t.closest('form');
    form.elements.namedItem('data').value = await f.text();
    if (/\.csv$/i.test(f.name)) form.elements.namedItem('format').value = 'csv';
    if (/\.json$/i.test(f.name)) form.elements.namedItem('format').value = 'json';
    toast('Файл загружен: ' + f.name, 'ok');
    t.value = '';
  });
  on(root, 'submit', 'form[data-imp]', (e, f) => {
    e.preventDefault();
    busy(f.querySelector('button:not([type])'), async () => {
      const v = formData(f);
      const url = f.dataset.imp === 'items' ? '/api/admin/items-import' : '/api/admin/prices-import';
      const body = { data: v.data, source: v.source }; if (v.format) body.format = v.format;
      const r = await api(url, body);
      mount($('[data-res]', f), html`<div class="mt">${notice('Импорт завершён', 'ok')}${report(r)}</div>`);
      toast('Импорт завершён', 'ok');
      loadDups();
    });
  });
  const loadDups = async () => {
    try {
      const r = await api('/api/admin/items-duplicates');
      if (!ctx.alive()) return;
      mount($('[data-dups]', box), html`<div class="g2"><div><h3>Возможные дубликаты (${(r.groups || []).length})</h3>${(r.groups || []).length ? html`<ul class="sm">${r.groups.slice(0, 100).map((g) => html`<li><b>${g.name}</b> — ${num(g.n)} шт.: ${(g.ids || []).map((id) => html`<a class="chip" href="/admin/items/${id}">#${id}</a> `)}</li>`)}</ul>` : html`<p class="muted sm">Дубликатов не найдено.</p>`}</div>
        <div><h3>Без изображения (${(r.noImage || []).length})</h3>${(r.noImage || []).length ? html`<ul class="sm">${r.noImage.slice(0, 100).map((x) => html`<li><a href="/admin/items/${x.id}">${x.name}</a></li>`)}</ul><p class="muted xs">Такие предметы не попадают в автоматически собранные кейсы.</p>` : html`<p class="muted sm">У всех предметов есть изображение.</p>`}</div></div>`);
    } catch (e) { mount($('[data-dups]', box), notice(e.message, 'err')); }
  };
  loadDups();
}, P('Импорт'));
