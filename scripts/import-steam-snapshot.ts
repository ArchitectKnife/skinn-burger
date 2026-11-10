// BURGER SKIN v3: импорт расширенного каталога из снимка Steam Community Market.
// Источник: scripts/steam-market-snapshot.json (минимальная цена продажи на Steam Market; дата снимка и курс ЦБ РФ указаны в файле).
// Ничего не придумывается:
//  - предмет добавляется, только если в снимке есть цена его обычной версии (без StatTrak/Souvenir);
//  - диапазон float ограничивается качествами, для которых есть цена, поэтому выпадения из кейсов
//    приходятся только на качества с реальной ценой;
//  - флаг StatTrak/Souvenir ставится, только если цена этой версии есть для всех доступных качеств.
// Идемпотентно: повторный запуск обновляет те же записи (ext_id = steam:<market_bucket_group_id>).
// Предметы, которые уже есть в каталоге из других источников, НЕ изменяются (ни поля, ни цены).
// Запуск: npm run import:steam [путь-к-снимку.json]
import fs from 'node:fs';
import path from 'node:path';
import { one, all } from '../src/lib/db.ts';
import { importItems, importPrices, parseMarketName } from '../src/lib/catalog.ts';

type Row = { page: string; hash: string; group: string; gid: string; price: number; listings: number; type: string; color: string; icon: string };
type PRow = Row & { name: string; wear: string; variant: string };

const file = path.resolve(process.argv[2] || 'scripts/steam-market-snapshot.json');
const snap = JSON.parse(fs.readFileSync(file, 'utf8'));
const rate = Number(snap.usd_rub);
if (!(rate > 0)) throw new Error('В снимке нет курса USD/RUB');
const SOURCE = `Steam Market ${snap.fetched_at}, курс ЦБ РФ ${String(rate).replace('.', ',')} от ${snap.usd_rub_date}`;
const STAR = String.fromCharCode(0x2605);
const ORDER = ['FN', 'MW', 'FT', 'WW', 'BS'];
const BAND: Record<string, [number, number]> = { FN: [0, 0.07], MW: [0.07, 0.15], FT: [0.15, 0.38], WW: [0.38, 0.45], BS: [0.45, 1] };
const CAT: Record<string, string> = { knife: 'Knives', gloves: 'Gloves', rifle: 'Rifles', sniper: 'Rifles', pistol: 'Pistols', smg: 'SMGs' };
const RAR = ['Extraordinary', 'Contraband', 'Covert', 'Classified', 'Restricted', 'Mil-Spec Grade', 'Industrial Grade', 'Consumer Grade'];
const rarityOf = (t: string) => RAR.find((r) => String(t || '').includes(r)) || null;

const groups = new Map<string, PRow[]>();
for (const r of snap.rows as Row[]) {
  if (!r.hash || !r.gid || !r.icon || !(Number(r.price) > 0)) continue;
  const p = parseMarketName(r.hash);
  const list = groups.get(r.gid) || [];
  list.push({ ...r, ...p });
  groups.set(r.gid, list);
}

const items: any[] = [];
const prices: any[] = [];
const skipped: string[] = [];
const preserved: string[] = [];
for (const [gid, rows] of groups) {
  const name = rows[0].name;
  const has = (w: string, v: string) => rows.some((r) => r.wear === w && r.variant === v);
  const vanilla = has('', '');
  const baseWears = ORDER.filter((w) => has(w, ''));
  if (!vanilla && !baseWears.length) { skipped.push(name); continue; }
  // Самый длинный непрерывный диапазон качеств с ценой обычной версии (при равенстве — с большим числом лотов).
  let best: string[] = [];
  let bestScore = -1;
  if (!vanilla) {
    let cur: string[] = [];
    const flush = () => {
      if (!cur.length) return;
      const score = cur.length * 1e6 + cur.reduce((s, w) => s + Number(rows.find((r) => r.wear === w && r.variant === '')?.listings || 0), 0);
      if (score > bestScore) { bestScore = score; best = cur; }
      cur = [];
    };
    for (const w of ORDER) { if (baseWears.includes(w)) cur.push(w); else flush(); }
    flush();
  }
  const wears = vanilla ? [''] : best;
  const ext = 'steam:' + gid;
  const ex = one('SELECT ext_id FROM items WHERE ext_id=? OR name=? COLLATE NOCASE ORDER BY id LIMIT 1', ext, name);
  if (ex && !String(ex.ext_id || '').startsWith('steam:')) { preserved.push(name); continue; }
  const st = wears.every((w) => has(w, 'st')) ? 1 : 0;
  const sv = !name.startsWith(STAR) && wears.every((w) => has(w, 'sv')) ? 1 : 0;
  const bare = name.startsWith(STAR + ' ') ? name.slice(2) : name;
  const [weapon, pattern] = bare.split(' | ');
  const min = vanilla ? 0 : BAND[wears[0]][0];
  const maxRaw = vanilla ? 1 : BAND[wears[wears.length - 1]][1];
  // Верхняя граница чуть ниже порога следующего качества, чтобы float не попадал на качество без цены.
  const max = maxRaw >= 1 ? 1 : Math.round((maxRaw - 0.000001) * 1e6) / 1e6;
  const head = rows.find((r) => r.variant === '') || rows[0];
  items.push({
    ext_id: ext, name, weapon, category: CAT[head.page.split('-')[0]] || null, pattern: pattern || null,
    rarity_name: rarityOf(head.type), rarity_color: head.color ? '#' + head.color : null, min_float: min, max_float: max,
    stattrak: st, souvenir: sv, image: 'https://community.akamai.steamstatic.com/economy/image/' + head.icon + '/360fx360f', collection: null,
  });
  for (const r of rows) prices.push({ market_hash_name: r.hash, price: Math.round((r.price / 100) * rate * 100) / 100, source: SOURCE });
}

const ri = importItems(items, SOURCE);
const rp = importPrices(prices, SOURCE);
console.log(`Снимок: ${file}`);
console.log(`Источник цен: ${SOURCE}`);
console.log(`Предметы: добавлено ${ri.added}, обновлено ${ri.updated}, ошибок ${ri.errors.length}`);
console.log(`Цены: добавлено ${rp.added}, обновлено ${rp.updated}, пропущено ${rp.skipped}`);
console.log(`Пропущено (в снимке есть цена только StatTrak/Souvenir): ${skipped.length}`);
console.log(`Уже были в каталоге из других источников, не изменены: ${preserved.length}`);
for (const e of ri.errors.slice(0, 20)) console.warn('  ошибка:', e.row, e.error);
const byCat = all("SELECT category, COUNT(*) n FROM items WHERE ext_id LIKE 'steam:%' AND archived=0 GROUP BY category ORDER BY n DESC");
console.log('Предметы из Steam по категориям:', byCat.map((r: any) => `${r.category}: ${r.n}`).join(', '));
