// Общие фрагменты интерфейса для страниц.
import { html, raw, img, bc, money, fdate, ago, empty, userLink, cssColor, GAMES, state, api, toast, num, pct } from '../core.js';
import { icon } from '../icons.js';

export const GAME_INFO = {
  crash: ['crash', 'Crash', 'Заберите выигрыш до взрыва ракеты', '#4a200c', '#161922'],
  double: ['target', 'Double', 'Красное ×2, чёрное ×2, зелёное ×14', '#4a1018', '#151821'],
  jackpot: ['coins', 'Jackpot', 'Общий банк: шанс равен доле ставки', '#42310a', '#161922'],
  coinflip: ['coinflip', 'Coinflip', 'Один на один, орёл или решка', '#3a2c0c', '#171a24'],
  roulette: ['roulette', 'Рулетка', 'Европейская рулетка 0–36', '#0f3a1c', '#151821'],
  mines: ['mines', 'Mines', 'Открывайте клетки и обходите мины', '#123049', '#141822'],
  towers: ['towers', 'Towers', 'Выше этаж — больше множитель', '#2e1a4a', '#141822'],
  battles: ['battles', 'Битвы кейсов', 'Открывайте кейсы против соперников', '#4a1212', '#161922'],
};
export function gameTile(key, enabled = true, extra = '') {
  const g = GAME_INFO[key]; if (!g) return '';
  const href = key === 'battles' ? '/battles' : '/games/' + key;
  return html`<a class="game-tile ${enabled ? '' : 'off'}" href="${href}" style="--g1:${cssColor(g[3])};--g2:${cssColor(g[4])}"><span class="gi">${icon(g[0])}</span><b>${g[1]}</b><span>${enabled ? g[2] : 'Временно недоступно'}</span>${extra}</a>`;
}
export function dropRow(d) {
  const it = d.item || {};
  return html`<div class="drop-row" style="--rc:${cssColor(it.color)}">${img(it.image, '', it.name)}<div class="t"><b>${it.name}${it.wear ? html` <span class="muted xs">(${it.wear})</span>` : ''}</b><span class="muted xs row gap-s">${userLink(d.user)}<span>· ${d.caseName || d.case?.name || ''} · ${ago(d.at)}</span></span></div>${bc(it.price)}</div>`;
}
const parse = (x) => { if (x && typeof x === 'string') { try { return JSON.parse(x); } catch { return {}; } } return x || {}; };
export function betStatus(b) {
  if (b.status === 'active') return html`<span class="badge info">В игре</span>`;
  if (b.status === 'refunded') return html`<span class="badge">Возврат</span>`;
  return (b.payout || 0) > 0 ? html`<span class="badge ok">Выигрыш</span>` : html`<span class="badge err">Проигрыш</span>`;
}
export function betsTable(bets, o = {}) {
  if (!bets?.length) return empty(o.empty || 'Здесь пока пусто.');
  return html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>${o.gameCol === false ? 'Раунд' : 'Игра'}</th><th>Дата</th><th class="r">Ставка</th><th class="r">Множитель</th><th class="r">Выплата</th><th>Статус</th><th></th></tr></thead><tbody>
    ${bets.map((b) => { const d = parse(b.data); const label = b.item ? html`<div class="mini-it">${img(b.item.image, '', b.item.name)}<span>${b.item.name}</span></div>` : html`${GAMES[b.game] || b.game || '#' + b.id}${d.caseName ? html` <span class="muted sm">· ${d.caseName}</span>` : ''}`;
      return html`<tr><td>${label}</td><td class="nowrap muted sm">${fdate(b.createdAt || b.created_at)}</td><td class="r">${bc(b.amount)}</td><td class="r">${b.multiplier ? '×' + Number(b.multiplier).toFixed(2) : '—'}</td><td class="r ${(b.payout || 0) > 0 ? 'plus' : 'minus'}">${money(b.payout || 0)}</td><td>${betStatus(b)}</td><td class="r"><a class="sm" href="/fair?bet=${b.id}">Проверить</a></td></tr>`; })}
  </tbody></table></div>`;
}
export function rulesBox(items, open = false) {
  return html`<details class="card flat rules" ${open ? raw('open') : ''}><summary>Правила и честность</summary><ul>${items.map((x) => html`<li>${x}</li>`)}</ul><p class="sm mb0">Результат определяет сервер с помощью криптостойкого генератора и схемы Provably Fair. Хеш сида публикуется до ставки, сам сид — после. <a href="/fair">Как проверить →</a></p></details>`;
}
export const NEWS_KIND = { news: 'Новость', promo: 'Акция', update: 'Обновление' };
export const EVENT_KIND = { event: 'Событие', marathon: 'Марафон', tournament: 'Турнир' };
export function newsCard(n) {
  return html`<a class="news-card" href="/news/${n.id}"><div class="ni">${n.image ? img(n.image, '', n.title) : html`<img src="/img/brand/logo.svg" alt="" style="height:70%">`}</div><div class="nb"><span class="badge ${n.kind === 'promo' ? 'warn' : n.kind === 'update' ? 'info' : ''}">${NEWS_KIND[n.kind] || 'Новость'}</span><b>${n.title}</b><p class="muted sm mb0">${String(n.excerpt || '').slice(0, 140)}${String(n.excerpt || '').length > 140 ? '…' : ''}</p><div class="xs dim" style="margin-top:8px">${fdate(n.created_at || n.createdAt)}</div></div></a>`;
}
export const CAT_RU = { Pistols: 'Пистолеты', Pistol: 'Пистолеты', Rifles: 'Винтовки', Rifle: 'Винтовки', 'Sniper Rifles': 'Снайперские винтовки', 'Sniper Rifle': 'Снайперские винтовки', SMGs: 'Пистолеты-пулемёты', SMG: 'Пистолеты-пулемёты', Heavy: 'Тяжёлое оружие', Shotguns: 'Дробовики', Shotgun: 'Дробовики', Machineguns: 'Пулемёты', 'Machine Guns': 'Пулемёты', Knives: 'Ножи', Knife: 'Ножи', Gloves: 'Перчатки', Equipment: 'Снаряжение', Other: 'Другое' };
export const catRu = (c) => CAT_RU[c] || c || '—';
export function stat(label, value, o = {}) { return html`<div class="stat ${o.cls || ''}"><span>${label}</span><b>${value}</b>${o.sub ? html`<small>${o.sub}</small>` : ''}</div>`; }
export function progress(v, goal, cls = '') { const p = goal > 0 ? Math.min(100, (v / goal) * 100) : 0; return html`<div class="bar ${cls}"><i style="width:${p.toFixed(1)}%"></i></div>`; }
export function copy(text) {
  const done = () => toast('Скопировано', 'ok', 1800);
  if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, () => fallback());
  else fallback();
  function fallback() { const t = document.createElement('textarea'); t.value = text; document.body.append(t); t.select(); try { document.execCommand('copy'); done(); } catch { toast('Не удалось скопировать', 'err'); } t.remove(); }
}
// Чтение файла в data URL и загрузка на сервер (только изображения, до 3 МБ).
export function uploadImage(file, kind) {
  return new Promise((res, rej) => {
    if (!file) return rej(new Error('Файл не выбран'));
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) return rej(new Error('Поддерживаются PNG, JPG, WEBP и GIF'));
    if (file.size > 3 * 1024 * 1024) return rej(new Error('Файл больше 3 МБ'));
    const fr = new FileReader();
    fr.onload = () => api('/api/uploads', { kind, data: fr.result }).then(res, rej);
    fr.onerror = () => rej(new Error('Не удалось прочитать файл'));
    fr.readAsDataURL(file);
  });
}
export const featureOff = (name) => html`<div class="notice warn">${name} временно отключён администрацией. Попробуйте позже.</div>`;
export { num, pct };
