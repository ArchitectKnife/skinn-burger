// BURGER SKIN — админ-панель: кинодропы (пороги уровней, сцены, ссылки «Поделиться», предпросмотр).
// Пороги влияют ТОЛЬКО на то, какую сцену показать для уже выданного предмета. Шансы кейсов они не меняют.
import { page, api, html, raw, mount, $, on, toast, busy, loader, notice, num, rub, img } from '../core.js';
import { icon } from '../icons.js';
import { shell, wire } from './admin-ui.js';
import { MODES, loadCine } from '../cine-mode.js';

const P = (t) => ({ staff: true, title: t + ' — админ-панель' });
const pctv = (x) => (!(x > 0) ? '0%' : x < 0.0001 ? '<0,01%' : (x * 100).toFixed(x < 0.01 ? 3 : 2).replace('.', ',') + '%');
const SCENES = [
  ['godlike', 'GODLIKE', 'Золотой портал, объёмные лучи, молнии и золотые частицы'],
  ['mythic', 'MYTHIC', 'Разрыв пространства, космическая энергия, фиолетовые молнии, искажение'],
  ['divine', 'DIVINE', 'Золотая сверхновая, ударная волна, ослепительная вспышка'],
  ['knife', 'KNIFE REVEAL', 'Отдельная сцена для ножей: кинематографичное вращение и блик клинка'],
  ['glove', 'GLOVE REVEAL', 'Отдельная сцена для перчаток: свои частицы и сценический свет'],
];

page('/admin/drops', async (ctx) => {
  const box = shell(ctx, '/admin/drops', 'Кинодропы', loader());
  wire(box);
  let d = await api('/api/admin/drop-fx');
  // Предпросмотр доступен всегда: если в каталоге нет предмета нужного уровня, берём любой другой пример или демо-предмет.
  const pick = (k) => d.samples?.[k] || Object.values(d.samples || {}).find(Boolean) || { itemId: 0, name: 'Демо-предмет BURGER SKIN', weapon: '', rarityName: '', color: '#eb4b4b', image: '/img/brand/item.svg',
    category: k === 'knife' ? 'knife' : k === 'glove' ? 'gloves' : 'rifle', wear: 'fn', float: null, variant: null, stattrak: false, souvenir: false, price: Number(d.settings?.[k] || d.settings?.mythic || 2500000) };
  const tierOf = (price) => { const s = d.settings; return price >= s.divine ? 'divine' : price >= s.mythic ? 'mythic' : price >= s.godlike ? 'godlike' : null; };
  const rubIn = (name, label, kop) => html`<label class="fld"><span>${label}</span><input name="${name}" type="number" min="1" step="1" value="${Math.round((kop || 0) / 100)}" required></label>`;
  const chk = (name, label, on0) => html`<label class="check"><input type="checkbox" name="${name}" ${on0 !== false ? raw('checked') : ''}><span>${label}</span></label>`;
  const draw = () => {
    if (!ctx.alive()) return;
    const s = d.settings; const cat = d.catalog || {};
    const band = (k, t) => html`<div class="card"><div class="xs dim">${t}</div><b class="lg">${num(cat[k]?.items || 0)}</b> <span class="muted sm">скинов · ${num(cat[k]?.n || 0)} цен</span></div>`;
    const cases = (d.cases || []).slice(0, 60);
    mount(box, html`
      ${notice('Уровень дропа считает сервер по уже выданному предмету и его цене и сохраняет в ставке. Пороги меняют только то, какая сцена покажется, — шансы кейсов, Provably Fair и выдача предметов остаются прежними.')}
      <form class="card pad adm-form mt" data-f>
        <div class="stack">${chk('enabled', 'Кинодропы включены', s.enabled)}${chk('knife_scene', 'Отдельная сцена KNIFE REVEAL для любого ножа', s.knife_scene)}${chk('glove_scene', 'Отдельная сцена GLOVE REVEAL для любых перчаток', s.glove_scene)}${chk('share', 'Кнопка «Поделиться дропом» и публичные страницы /drop/…', s.share)}</div>
        <h3 class="mt">Пороги стоимости, ₽</h3>
        <div class="grid g3">${rubIn('godlike', 'GODLIKE — от', s.godlike)}${rubIn('mythic', 'MYTHIC — от', s.mythic)}${rubIn('divine', 'DIVINE — от', s.divine)}</div>
        <div class="grid g3 mt">
          <label class="fld"><span>Не дешевле N × цены кейса (0 — без условия)</span><input name="min_x" type="number" min="0" step="0.1" value="${s.min_x}" required></label>
          <label class="fld"><span>Режим по умолчанию для новых игроков</span><select name="default_mode">${MODES.map(([k, l]) => html`<option value="${k}" ${s.default_mode === k ? raw('selected') : ''}>${l}</option>`)}</select></label>
        </div>
        <p class="muted sm">Игрок всегда может переключить режим на странице кейса («Полные», «Короткие», «Выкл») и пропустить любую сцену кнопкой, касанием, Esc или пробелом. Громкость сцен — в разделе «Звук».</p>
        <div class="row gap mt"><button class="btn" data-save>${icon('save')}<span>Сохранить</span></button></div>
      </form>
      <section class="card pad mt"><h3>Предпросмотр сцен</h3><p class="muted sm">Ничего не выдаёт и не записывает: только показ сцены на примере предмета из каталога.</p>
        <div class="grid g3">${SCENES.map(([k, t, desc]) => { const it = pick(k); return html`<div class="card"><div class="row between gap"><span class="drop-fx-badge ${k}">${t}</span>${it ? html`<b class="sm">${rub(it.price)}</b>` : ''}</div>
          <div class="item-img" style="max-height:120px">${it ? img(it.image, '', it.name) : html`<span class="muted sm">Нет подходящего предмета</span>`}</div>
          <p class="muted xs">${desc}${it ? html`<br>${it.name}` : ''}</p>
          <button type="button" class="btn ghost sm block" data-prev="${k}">${icon('play')}<span>Показать</span></button></div>`; })}</div></section>
      <section class="card pad mt"><h3>Сколько цен каталога попадает в уровни</h3>
        <div class="grid g2">${band('below', 'Ниже GODLIKE')}${band('godlike', 'GODLIKE · ' + rub(s.godlike) + ' – ' + rub(s.mythic))}${band('mythic', 'MYTHIC · ' + rub(s.mythic) + ' – ' + rub(s.divine))}${band('divine', 'DIVINE · от ' + rub(s.divine))}</div></section>
      <section class="card pad mt"><h3>Шанс кинодропа за одно открытие</h3><p class="muted sm">Расчёт по текущим шансам и ценам качеств (без StatTrak™). Помогает подобрать пороги, чтобы сцены оставались редкими.</p>
        ${cases.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Кейс</th><th class="r">Цена</th><th class="r">GODLIKE+</th><th class="r">MYTHIC+</th><th class="r">DIVINE</th><th class="r">Любая сцена</th></tr></thead><tbody>${cases.map((c) => html`<tr><td><a href="/cases/${c.slug}">${c.name}</a></td><td class="r">${rub(c.price)}</td><td class="r">${pctv(c.godlike)}</td><td class="r">${pctv(c.mythic)}</td><td class="r">${pctv(c.divine)}</td><td class="r"><b>${pctv(c.special)}</b></td></tr>`)}</tbody></table></div>` : html`<p class="muted">Нет опубликованных кейсов</p>`}
      </section>`);
  };
  draw();
  on(box, 'submit', '[data-f]', (e, f) => {
    e.preventDefault();
    const b = $('[data-save]', f);
    busy(b, async () => {
      const kop = (n) => Math.round(Number(f[n].value) * 100);
      const v = { enabled: f.enabled.checked, knife_scene: f.knife_scene.checked, glove_scene: f.glove_scene.checked, share: f.share.checked,
        godlike: kop('godlike'), mythic: kop('mythic'), divine: kop('divine'), min_x: Number(f.min_x.value) || 0, default_mode: f.default_mode.value };
      if (!(v.godlike < v.mythic && v.mythic < v.divine)) { toast('Пороги должны возрастать: GODLIKE < MYTHIC < DIVINE', 'err'); return; }
      await api('/api/admin/settings', { key: 'drop_fx', value: v });
      toast('Настройки кинодропов сохранены', 'ok');
      d = await api('/api/admin/drop-fx');
      draw();
    });
  });
  on(box, 'click', '[data-prev]', (e, b) => {
    const k = b.dataset.prev; const it = pick(k);
    busy(b, async () => { const m = await loadCine(); m.previewDrop(k, it, k === 'knife' || k === 'glove' ? tierOf(it.price) : null); });
  });
}, P('Кинодропы'));
