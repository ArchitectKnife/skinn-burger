// BURGER SKIN v2: дополнительные кейсы из предметов, которые уже есть в каталоге.
// Идемпотентно: кейсы с уже существующим slug пропускаются. Существующие кейсы и данные не изменяются.
// Шансы: вес предмета обратно пропорционален его базовой цене, цена кейса считается автоматически (price_mode=auto).
// Состав, шансы, цену и обложку можно изменить в админ-панели (Кейсы, Обложки кейсов).
import { one, all, run, now } from '../src/lib/db.ts';
import { recalcCase } from '../src/lib/cases.ts';

type Def = { slug: string; name: string; description: string; categories: string[]; items: number[]; cover: number[] };

const KNIVES = [18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
const DEFS: Def[] = [
  { slug: 'budget-bite', name: 'Бюджетный укус', description: 'Недорогой кейс со скинами коллекции Kilowatt и шансом на Glock-18 | Block-18.', categories: ['cheap', 'new'], items: [1, 2, 3, 4, 5, 6, 7, 8], cover: [8, 4, 7] },
  { slug: 'double-cheese', name: 'Двойной чизбургер', description: 'Средний кейс: Restricted-скины и шанс на USP-S | Jawbreaker.', categories: ['mid', 'new'], items: [2, 3, 7, 8, 9, 10, 11, 12, 15], cover: [15, 9, 8] },
  { slug: 'ak-inheritance', name: 'Наследие AK-47', description: 'Кейс с главным призом AK-47 | Inheritance.', categories: ['ak47', 'rare', 'expensive'], items: [17, 13, 9, 8, 10, 11, 12, 1, 5], cover: [17, 13, 9] },
  { slug: 'awp-chrome', name: 'Хромовая AWP', description: 'Кейс с главным призом AWP | Chrome Cannon.', categories: ['awp', 'rare'], items: [16, 15, 14, 8, 10, 11, 2, 4, 6], cover: [16, 15, 14] },
  { slug: 'kukri-night', name: 'Ночной Kukri', description: 'Доступный кейс с небольшим шансом на нож Kukri.', categories: ['knives', 'rare'], items: [25, 30, 29, 20, 24, 26, 27, 18, 1, 2, 3, 4, 5, 6], cover: [25, 30, 29] },
  { slug: 'kukri-elite', name: 'Kukri Элит', description: 'Только ножи Kukri: каждое открытие — нож.', categories: ['knives', 'elite', 'premium', 'expensive'], items: KNIVES, cover: [21, 19, 23] },
  { slug: 'covert-grill', name: 'Тайный гриль', description: 'Повышенная доля Classified и Covert предметов.', categories: ['covert', 'rare'], items: [16, 17, 13, 14, 15, 8, 9, 10, 11, 12], cover: [13, 17, 16] },
  { slug: 'kilowatt-full', name: 'Коллекция Kilowatt', description: 'Вся коллекция The Kilowatt Collection в одном кейсе.', categories: ['collection', 'themed'], items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17], cover: [14, 16, 17] },
  { slug: 'exclusive-burger', name: 'Эксклюзивный бургер', description: 'Дорогие Classified/Covert скины и три самых дорогих Kukri.', categories: ['exclusive', 'premium', 'expensive'], items: [13, 14, 15, 16, 17, 23, 28, 22], cover: [23, 17, 16] },
  { slug: 'premium-roast', name: 'Премиум-прожарка', description: 'Только топовые скины коллекции Kilowatt.', categories: ['premium', 'expensive'], items: [9, 13, 14, 15, 16, 17], cover: [15, 13, 9] },
  { slug: 'pistol-gold', name: 'Пистолетный набор', description: 'Пистолеты и Zeus x27 из коллекции Kilowatt.', categories: ['weapon', 'mid'], items: [1, 5, 8, 10, 15, 14], cover: [14, 15, 10] },
];

const exists = new Map<number, number>();
for (const r of all('SELECT id, base_price FROM items WHERE archived=0 AND base_price>0')) exists.set(Number(r.id), Number(r.base_price));
let sort = Number(one('SELECT COALESCE(MAX(sort),0) m FROM cases').m) + 1;
let added = 0, skipped = 0;
for (const d of DEFS) {
  if (one('SELECT 1 FROM cases WHERE slug=?', d.slug)) { skipped++; continue; }
  const ids = d.items.filter((id) => exists.has(id));
  if (ids.length < 3) { console.warn('Пропущен (мало предметов с ценой):', d.slug); skipped++; continue; }
  const cover = d.cover.filter((x) => ids.includes(x));
  const id = Number(run('INSERT INTO cases(slug,name,description,image,price,price_mode,categories,status,sort,source,created_at,updated_at,cover_mode,cover_items) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    d.slug, d.name, d.description, '', 100, 'auto', JSON.stringify(d.categories), 'published', sort++, 'seed-v2', now(), now(), 'auto', JSON.stringify(cover)).lastInsertRowid);
  for (const iid of ids) run('INSERT INTO case_items(case_id,item_id,weight) VALUES(?,?,?)', id, iid, Math.max(1, Math.round(1e9 / exists.get(iid)!)));
  recalcCase(id);
  const c = one('SELECT price, ev FROM cases WHERE id=?', id);
  console.log(`+ ${d.slug}: ${ids.length} предм., цена ${(c.price / 100).toFixed(2)} RUB, EV ${(c.ev / 100).toFixed(2)} RUB`);
  added++;
}
console.log(`Готово: добавлено ${added}, пропущено ${skipped}`);
