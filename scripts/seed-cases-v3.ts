// BURGER SKIN v3: новые кейсы из расширенного каталога Steam Market (сначала: npm run import:steam).
// Идемпотентно: кейсы с уже существующим slug пропускаются; существующие кейсы и данные не изменяются.
// Шансы: вес предмета обратно пропорционален его базовой цене; цена кейса считается автоматически (price_mode=auto).
// Состав, шансы, цену и обложку можно изменить в админ-панели (Кейсы, Обложки кейсов).
import { one, all, run, now } from '../src/lib/db.ts';
import { recalcCase } from '../src/lib/cases.ts';

type It = { id: number; name: string; weapon: string; category: string; pattern: string | null; rarity_name: string | null; base_price: number; ext_id: string | null };
const ALL: It[] = all('SELECT id, name, weapon, category, pattern, rarity_name, base_price, ext_id FROM items WHERE archived=0 AND base_price>0').map((r: any) => ({ ...r, id: Number(r.id), base_price: Number(r.base_price) }));
const steam = ALL.filter((i) => String(i.ext_id || '').startsWith('steam:'));
if (!steam.length) { console.error('Нет предметов из снимка Steam. Сначала выполните: npm run import:steam'); process.exit(1); }
const byPrice = (a: It, b: It) => b.base_price - a.base_price;
const knives = steam.filter((i) => i.category === 'Knives');
const gloves = steam.filter((i) => i.category === 'Gloves');
const wpn = (re: RegExp) => steam.filter((i) => re.test(i.weapon || ''));
// Недорогие предметы (до 4 000 руб.) для разбавления дорогих кейсов — только с реальной ценой.
const fillPool = ALL.filter((i) => i.base_price <= 400000 && i.category !== 'Knives' && i.category !== 'Gloves').sort((a, b) => a.base_price - b.base_price);
// minPrice (в копейках) — нижняя граница цены наполнителя, чтобы дорогие кейсы не превращались в «копеечные».
function fillers(n: number, minPrice = 100000): It[] {
  if (n <= 0) return [];
  const pool = fillPool.filter((i) => i.base_price >= minPrice);
  if (pool.length <= n) return pool;
  return Array.from({ length: n }, (_, k) => pool[Math.floor((k * (pool.length - 1)) / Math.max(1, n - 1))]);
}

type Def = { slug: string; name: string; description: string; categories: string[]; top: It[]; fill: number; minFill?: number };
const DEFS: Def[] = [
  { slug: 'karambit-legend', name: 'Легенда Karambit', description: 'Ножи Karambit с ценой Steam Market и недорогие винтовки.', categories: ['knives', 'elite', 'premium', 'expensive', 'new'], top: wpn(/^Karambit$/), fill: 8 },
  { slug: 'butterfly-effect', name: 'Эффект бабочки', description: 'Butterfly Knife в разных отделках.', categories: ['knives', 'premium', 'rare', 'new'], top: wpn(/^Butterfly Knife$/), fill: 8 },
  { slug: 'bayonet-assault', name: 'Штыковая атака', description: 'M9 Bayonet и Bayonet.', categories: ['knives', 'rare', 'new'], top: wpn(/Bayonet$/), fill: 8 },
  { slug: 'doppler-lab', name: 'Лаборатория Doppler', description: 'Ножи с отделками Doppler, Gamma Doppler, Fade, Marble Fade и Tiger Tooth.', categories: ['knives', 'exclusive', 'premium', 'new'], top: knives.filter((i) => /Doppler|Fade|Tiger Tooth/.test(i.pattern || '')), fill: 8 },
  { slug: 'knife-vault', name: 'Ножевой сейф', description: 'Только ножи: каждое открытие — нож.', categories: ['knives', 'elite', 'exclusive', 'expensive', 'new'], top: knives, fill: 0 },
  { slug: 'glove-box', name: 'Перчаточный бокс', description: 'Перчатки Sport, Specialist, Driver, Moto, Hand Wraps, Bloodhound и недорогие винтовки.', categories: ['gloves', 'rare', 'premium', 'new'], top: gloves, fill: 8 },
  { slug: 'glove-elite', name: 'Перчатки Элит', description: 'Только перчатки: каждое открытие — перчатки.', categories: ['gloves', 'elite', 'expensive', 'new'], top: gloves, fill: 0 },
  { slug: 'sniper-arsenal', name: 'Арсенал снайпера', description: 'AWP и SSG 08 с ценой Steam Market.', categories: ['awp', 'rare', 'new'], top: wpn(/^(AWP|SSG 08|SCAR-20|G3SG1)$/), fill: 8 },
  { slug: 'ak-legends', name: 'Легенды AK-47', description: 'Gold Arabesque, Fire Serpent, Hydroponic и другие AK-47.', categories: ['ak47', 'rare', 'expensive', 'new'], top: wpn(/^AK-47$/), fill: 8 },
  { slug: 'm4-command', name: 'Командование M4', description: 'M4A4 и M4A1-S.', categories: ['weapon', 'rare', 'new'], top: wpn(/^M4A/), fill: 8 },
  { slug: 'pistol-elite', name: 'Элитные пистолеты', description: 'Дорогие пистолеты с ценой Steam Market.', categories: ['weapon', 'premium', 'new'], top: steam.filter((i) => i.category === 'Pistols'), fill: 8 },
  { slug: 'smg-elite', name: 'SMG Премиум', description: 'Дорогие пистолеты-пулемёты.', categories: ['weapon', 'premium', 'new'], top: steam.filter((i) => i.category === 'SMGs'), fill: 8 },
  { slug: 'covert-ops', name: 'Тайная операция', description: 'Covert-оружие без ножей и перчаток.', categories: ['covert', 'rare', 'new'], top: steam.filter((i) => i.rarity_name === 'Covert' && i.category !== 'Knives' && i.category !== 'Gloves'), fill: 8 },
  { slug: 'rifle-market', name: 'Винтовочный рынок', description: 'Винтовки средней цены.', categories: ['mid', 'weapon', 'new'], top: steam.filter((i) => i.category === 'Rifles' && i.base_price <= 1000000), fill: 6, minFill: 10000 },
  { slug: 'burger-millionaire', name: 'Бургер-миллионер', description: 'Десять самых дорогих предметов каталога и недорогие винтовки.', categories: ['premium', 'exclusive', 'expensive', 'new'], top: [...steam].sort(byPrice).slice(0, 10), fill: 8 },
];

let sort = Number(one('SELECT COALESCE(MAX(sort),0) m FROM cases').m) + 1;
let added = 0, skipped = 0;
for (const d of DEFS) {
  if (one('SELECT 1 FROM cases WHERE slug=?', d.slug)) { skipped++; continue; }
  const top = [...d.top].sort(byPrice).slice(0, 40);
  if (top.length < 2) { console.warn('Пропущен (мало предметов с ценой):', d.slug); skipped++; continue; }
  const map = new Map<number, It>();
  for (const i of [...top, ...fillers(d.fill, d.minFill)]) map.set(i.id, i);
  const list = [...map.values()];
  const cover = top.slice(0, 3).map((i) => i.id);
  const id = Number(run('INSERT INTO cases(slug,name,description,image,price,price_mode,categories,status,sort,source,created_at,updated_at,cover_mode,cover_items) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    d.slug, d.name, d.description, '', 100, 'auto', JSON.stringify(d.categories), 'published', sort++, 'seed-v3', now(), now(), 'auto', JSON.stringify(cover)).lastInsertRowid);
  for (const i of list) run('INSERT INTO case_items(case_id,item_id,weight) VALUES(?,?,?)', id, i.id, Math.max(1, Math.round(1e9 / i.base_price)));
  recalcCase(id);
  const c = one('SELECT price, ev FROM cases WHERE id=?', id);
  console.log(`+ ${d.slug}: ${list.length} предм., цена ${(c.price / 100).toFixed(2)} RUB, EV ${(c.ev / 100).toFixed(2)} RUB`);
  added++;
}
console.log(`Готово: добавлено ${added}, пропущено ${skipped}`);
