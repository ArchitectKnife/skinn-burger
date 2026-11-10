// Стартовое наполнение базы BURGER SKIN. Скрипт идемпотентен: повторный запуск ничего не дублирует
// и не удаляет существующие данные.
//
// Цены стартовых предметов — внутренняя оценка BURGER SKIN (price_source = 'internal'), а не рыночная цена.
// Рыночные цены загружаются отдельно: npm run import:prices (Skinport или ваш файл).
import { one, all, run, tx, now } from '../src/lib/db.ts';
import { importItems, TIER_WEIGHT } from '../src/lib/catalog.ts';
import { recalcAllCases } from '../src/lib/cases.ts';
import { generatePassRewards } from '../src/routes/admin.ts';
import { setSetting, getSetting } from '../src/lib/core.ts';

const IMG = '/img/items/';
const KILOWATT = 'The Kilowatt Collection';
// [название, оружие, категория, паттерн, редкость, файл, оценка в ₽, minFloat, maxFloat]
type Row = [string, string, string, string, string, string, number, number, number];
const W: Row[] = [
  ['Dual Berettas | Hideout', 'Dual Berettas', 'Pistols', 'Hideout', 'Mil-Spec Grade', 'Kilowatt-duals.png', 18, 0, 1],
  ['MAC-10 | Light Box', 'MAC-10', 'SMGs', 'Light Box', 'Mil-Spec Grade', 'Kilowatt-mac10.png', 22, 0, 1],
  ['Nova | Dark Sigil', 'Nova', 'Heavy', 'Dark Sigil', 'Mil-Spec Grade', 'Kilowatt-nova.png', 16, 0, 1],
  ['SSG 08 | Dezastre', 'SSG 08', 'Rifles', 'Dezastre', 'Mil-Spec Grade', 'Kilowatt-ssg08.png', 25, 0, 1],
  ['Tec-9 | Slag', 'Tec-9', 'Pistols', 'Slag', 'Mil-Spec Grade', 'Kilowatt-tec9.png', 15, 0, 1],
  ['UMP-45 | Motorized', 'UMP-45', 'SMGs', 'Motorized', 'Mil-Spec Grade', 'Kilowatt-ump45.png', 17, 0, 1],
  ['XM1014 | Irezumi', 'XM1014', 'Heavy', 'Irezumi', 'Mil-Spec Grade', 'Kilowatt-xm1014.png', 38, 0, 1],
  ['Glock-18 | Block-18', 'Glock-18', 'Pistols', 'Block-18', 'Restricted', 'Kilowatt-block18.png', 140, 0, 1],
  ['M4A4 | Etch Lord', 'M4A4', 'Rifles', 'Etch Lord', 'Restricted', 'Kilowatt-m4a4.png', 230, 0, 1],
  ['Five-SeveN | Hybrid', 'Five-SeveN', 'Pistols', 'Hybrid', 'Restricted', 'Kilowatt-fiveseven.png', 95, 0, 1],
  ['MP7 | Just Smile', 'MP7', 'SMGs', 'Just Smile', 'Restricted', 'Kilowatt-mp7.png', 85, 0, 1],
  ['Sawed-Off | Analog Input', 'Sawed-Off', 'Heavy', 'Analog Input', 'Restricted', 'Kilowatt-sawedoff.png', 80, 0, 1],
  ['M4A1-S | Black Lotus', 'M4A1-S', 'Rifles', 'Black Lotus', 'Classified', 'Kilowatt-m4a1s.png', 1400, 0, 1],
  ['Zeus x27 | Olympus', 'Zeus x27', 'Equipment', 'Olympus', 'Classified', 'Kilowatt-zeus.png', 450, 0, 1],
  ['USP-S | Jawbreaker', 'USP-S', 'Pistols', 'Jawbreaker', 'Classified', 'Kilowatt-usp.png', 650, 0, 1],
  ['AWP | Chrome Cannon', 'AWP', 'Rifles', 'Chrome Cannon', 'Covert', 'Kilowatt-awp.png', 2500, 0, 1],
  ['AK-47 | Inheritance', 'AK-47', 'Rifles', 'Inheritance', 'Covert', 'Kilowatt-ak.png', 3000, 0, 1],
];
const KUKRI: Array<[string, string, number, number, number]> = [
  ['', 'CS2_weapon_knife_kukri.png', 15000, 0, 1],
  ['Blue Steel', 'Kukri-blue.png', 17000, 0, 1],
  ['Boreal Forest', 'Kukri-boreal.png', 12000, 0.06, 0.8],
  ['Case Hardened', 'Kukri-caseh.png', 18000, 0, 1],
  ['Crimson Web', 'Kukri-crimson.png', 19000, 0.06, 0.8],
  ['Fade', 'Kukri-fade.png', 25000, 0, 0.08],
  ['Forest DDPAT', 'Kukri-forest.png', 11500, 0.06, 0.8],
  ['Night Stripe', 'Kukri-night.png', 12500, 0.06, 0.8],
  ['Safari Mesh', 'Kukri-safari.png', 11000, 0.06, 0.8],
  ['Scorched', 'Kukri-scorched.png', 11500, 0.06, 0.8],
  ['Slaughter', 'Kukri-slaughter.png', 22000, 0.01, 0.26],
  ['Stained', 'Kukri-stained.png', 14000, 0, 1],
  ['Urban Masked', 'Kukri-urban.png', 11000, 0.06, 0.8],
];

function seedItems() {
  const rows: any[] = W.map((r) => ({ name: r[0], weapon: r[1], category: r[2], pattern: r[3], rarity_name: r[4], image: IMG + r[5], min_float: r[7], max_float: r[8], stattrak: 1, souvenir: 0, collection: KILOWATT, crates: JSON.stringify(['Kilowatt Case']) }));
  for (const k of KUKRI) rows.push({ name: k[0] ? `★ Kukri Knife | ${k[0]}` : '★ Kukri Knife', weapon: 'Kukri Knife', category: 'Knives', pattern: k[0] || 'Vanilla', rarity_name: 'Extraordinary', image: IMG + k[1], min_float: k[3], max_float: k[4], stattrak: 1, souvenir: 0, collection: null, crates: JSON.stringify(['Kilowatt Case']) });
  const rep = importItems(rows, 'seed');
  // Внутренняя оценка выставляется только тем предметам, у которых ещё нет цены из проверенного источника.
  const est = new Map<string, number>();
  for (const r of W) est.set(r[0], r[6]);
  for (const k of KUKRI) est.set(k[0] ? `★ Kukri Knife | ${k[0]}` : '★ Kukri Knife', k[2]);
  for (const [name, bc] of est) run("UPDATE items SET base_price=?, price_source='internal' WHERE name=? AND (price_source IS NULL OR price_source IN ('internal','seed') OR base_price IS NULL)", Math.round(bc * 100), name);
  return rep;
}

const byName = (names: string[]) => names.map((n) => one('SELECT * FROM items WHERE name=?', n)).filter(Boolean);
const where = (sql: string, ...p: any[]) => all(`SELECT * FROM items WHERE archived=0 AND (${sql}) ORDER BY id`, ...p);
const tierOf = (it: any) => (it.rarity_name in TIER_WEIGHT ? it.rarity_name : /^★/.test(it.name) ? 'Extraordinary' : 'Mil-Spec Grade');

function seedCase(slug: string, name: string, description: string, categories: string[], sort: number, items: any[], image?: string) {
  if (one('SELECT 1 FROM cases WHERE slug=?', slug)) return false;
  const id = run('INSERT INTO cases(slug,name,description,image,price,price_mode,categories,status,sort,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    slug, name, description, image || `/img/cases/${slug}.svg`, 100, 'auto', JSON.stringify(categories), 'published', sort, 'seed', now(), now()).lastInsertRowid;
  const byTier = new Map<string, any[]>();
  for (const it of items) { const t = tierOf(it); if (!byTier.has(t)) byTier.set(t, []); byTier.get(t)!.push(it); }
  for (const [t, list] of byTier) for (const it of list) run('INSERT OR REPLACE INTO case_items(case_id,item_id,weight) VALUES(?,?,?)', id, it.id, Math.round((TIER_WEIGHT[t] / list.length) * 1e6) / 1e6);
  return true;
}

export const SEED_CASES: Array<{ slug: string; name: string; description: string; categories: string[]; sort: number; pick: () => any[]; image?: string }> = [
  { slug: 'kilowatt-case', name: 'Kilowatt Case', description: 'Официальный состав кейса Kilowatt: 17 скинов коллекции и редкие ножи Kukri. Шансы — по официальной шкале редкости CS2.', categories: ['official', 'collection', 'knives', 'popular'], sort: 1, image: '/img/items/Kilowatt-case.png', pick: () => where("collection=? OR weapon='Kukri Knife'", KILOWATT) },
  { slug: 'burger-starter', name: 'Burger Starter', description: 'Лёгкий перекус для первого открытия: армейские и запрещённые скины Kilowatt.', categories: ['cheap', 'new', 'popular'], sort: 2, pick: () => where("rarity_name IN ('Mil-Spec Grade','Restricted')") },
  { slug: 'electro-mix', name: 'Электро-микс', description: 'Все 17 оружейных скинов коллекции Kilowatt без ножей.', categories: ['themed', 'new', 'popular', 'collection'], sort: 3, pick: () => where('collection=?', KILOWATT) },
  { slug: 'burger-royale', name: 'Burger Royale', description: 'Тайное качество и ножи Kukri с лучшими расцветками.', categories: ['premium', 'knives', 'rare', 'new'], sort: 4, pick: () => [...where("rarity_name='Covert'"), ...byName(['★ Kukri Knife | Fade', '★ Kukri Knife | Slaughter', '★ Kukri Knife | Case Hardened', '★ Kukri Knife | Crimson Web', '★ Kukri Knife | Blue Steel'])] },
  { slug: 'kukri-collection', name: 'Кукри-коллекция', description: 'Только ножи Kukri: от ванили до Fade.', categories: ['knives', 'premium', 'rare'], sort: 5, pick: () => where("weapon='Kukri Knife'") },
  { slug: 'army-order', name: 'Армейский заказ', description: 'Только армейское качество (Mil-Spec).', categories: ['rarity', 'cheap'], sort: 10, pick: () => where("rarity_name='Mil-Spec Grade'") },
  { slug: 'restricted-sauce', name: 'Запретный соус', description: 'Только запрещённое качество (Restricted).', categories: ['rarity'], sort: 11, pick: () => where("rarity_name='Restricted'") },
  { slug: 'classified-recipe', name: 'Засекреченный рецепт', description: 'Только засекреченное качество (Classified).', categories: ['rarity', 'premium'], sort: 12, pick: () => where("rarity_name='Classified'") },
  { slug: 'secret-ingredient', name: 'Тайный ингредиент', description: 'Засекреченные и тайные скины Kilowatt.', categories: ['rarity', 'premium', 'rare'], sort: 13, pick: () => where("rarity_name IN ('Classified','Covert')") },
  { slug: 'pistol-burger', name: 'Пистолетный бургер', description: 'Пистолеты и Zeus из коллекции Kilowatt.', categories: ['weapon', 'themed', 'cheap'], sort: 20, pick: () => where("category IN ('Pistols','Equipment')") },
  { slug: 'smg-combo', name: 'SMG-комбо', description: 'MAC-10, UMP-45 и MP7.', categories: ['weapon', 'themed', 'cheap'], sort: 21, pick: () => where("category='SMGs'") },
  { slug: 'rifle-grill', name: 'Винтовочный гриль', description: 'AK-47, M4A4, M4A1-S, AWP и SSG 08.', categories: ['weapon', 'themed', 'premium'], sort: 22, pick: () => where("category='Rifles'") },
  { slug: 'heavy-roast', name: 'Тяжёлая прожарка', description: 'Дробовики коллекции Kilowatt.', categories: ['weapon', 'themed', 'cheap'], sort: 23, pick: () => where("category='Heavy'") },
  { slug: 'night-shift', name: 'Ночная смена', description: 'Тёмные расцветки Kukri и мрачные скины.', categories: ['knives', 'themed'], sort: 30, pick: () => byName(['★ Kukri Knife | Night Stripe', '★ Kukri Knife | Urban Masked', '★ Kukri Knife | Scorched', 'Tec-9 | Slag', 'Nova | Dark Sigil', 'MAC-10 | Light Box', 'Glock-18 | Block-18', 'M4A4 | Etch Lord']) },
  { slug: 'forest-bbq', name: 'Лесной гриль', description: 'Камуфляжные Kukri и армейские скины.', categories: ['knives', 'themed', 'cheap'], sort: 31, pick: () => [...byName(['★ Kukri Knife | Forest DDPAT', '★ Kukri Knife | Boreal Forest', '★ Kukri Knife | Safari Mesh']), ...where("rarity_name='Mil-Spec Grade'")] },
  { slug: 'bloody-steak', name: 'Кровавый стейк', description: 'Crimson Web и Slaughter вместе с запрещёнными скинами.', categories: ['knives', 'rare'], sort: 32, pick: () => [...byName(['★ Kukri Knife | Crimson Web', '★ Kukri Knife | Slaughter']), ...where("rarity_name='Restricted'")] },
  { slug: 'steel-and-fire', name: 'Сталь и пламя', description: 'Blue Steel, Case Hardened, Stained и Fade плюс засекреченные скины.', categories: ['knives', 'premium'], sort: 33, pick: () => [...byName(['★ Kukri Knife | Blue Steel', '★ Kukri Knife | Case Hardened', '★ Kukri Knife | Stained', '★ Kukri Knife | Fade']), ...where("rarity_name='Classified'")] },
];

function seedContent() {
  const t = now();
  if (!one('SELECT 1 FROM quests LIMIT 1')) {
    const Q: Array<[string, string, string, number, number, number]> = [
      ['daily', 'Открой 3 кейса', 'case_open', 3, 500, 120],
      ['daily', 'Сыграй 5 раундов в играх', 'game', 5, 400, 100],
      ['daily', 'Сделай апгрейд', 'upgrade', 1, 300, 80],
      ['daily', 'Забери ежедневный бонус', 'daily', 1, 200, 60],
      ['weekly', 'Открой 25 кейсов', 'case_open', 25, 3000, 600],
      ['weekly', 'Оборот 1000 ₽', 'wager', 1000, 2500, 500],
      ['weekly', 'Победи в 3 битвах кейсов', 'battle_win', 3, 3000, 600],
      ['weekly', 'Подпиши 3 контракта', 'contract', 3, 2000, 400],
    ];
    Q.forEach((q, i) => run('INSERT INTO quests(scope,title,metric,goal,reward,xp,active,sort) VALUES(?,?,?,?,?,?,1,?)', q[0], q[1], q[2], q[3], q[4], q[5], i));
  }
  const A: Array<[string, string, string, string, number, number, string]> = [
    ['first_case', 'Первый укус', 'Открой первый кейс', 'case_open', 1, 100, 'pass'],
    ['case_100', 'Постоянный гость', 'Открой 100 кейсов', 'case_open', 100, 2000, 'flame'],
    ['case_1000', 'Шеф-повар', 'Открой 1000 кейсов', 'case_open', 1000, 15000, 'award'],
    ['upgrade_win', 'Двойная котлета', 'Выиграй апгрейд', 'upgrade_win', 1, 300, 'upgrade'],
    ['upgrade_25', 'Мастер апгрейда', 'Выиграй 25 апгрейдов', 'upgrade_win', 25, 3000, 'crash'],
    ['contract_10', 'Контрактник', 'Подпиши 10 контрактов', 'contract', 10, 1500, 'contracts'],
    ['battle_win_10', 'Гладиатор', 'Победи в 10 битвах кейсов', 'battle_win', 10, 3000, 'battles'],
    ['friends_5', 'Большая компания', 'Добавь 5 друзей', 'friends', 5, 500, 'friends'],
    ['wager_10000', 'Хайроллер', 'Оборот 10 000 ₽', 'wager', 10000, 5000, 'gem'],
    ['daily_7', 'Завсегдатай', 'Забери ежедневный бонус 7 раз', 'daily', 7, 700, 'calendar'],
  ];
  for (const a of A) run('INSERT OR IGNORE INTO achievements(code,title,description,metric,goal,reward,icon,active) VALUES(?,?,?,?,?,?,?,1)', ...a);
  if (!one('SELECT 1 FROM events LIMIT 1')) {
    const D = 86400_000;
    run('INSERT INTO events(kind,title,description,metric,goal,reward,prizes,starts_at,ends_at,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      'marathon', 'Марафон открытий', 'Открой 50 кейсов за время марафона и забери награду.', 'case_open', 50, 5000, '[]', t, t + 14 * D, 'active', t);
    run('INSERT INTO events(kind,title,description,metric,goal,reward,prizes,starts_at,ends_at,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      'tournament', 'Турнир «Жаркий гриль»', 'Рейтинг по обороту за неделю. Призы получают первые 5 мест.', 'wager', null, 0, JSON.stringify([50000, 25000, 15000, 7500, 5000]), t, t + 7 * D, 'active', t);
    run('INSERT INTO events(kind,title,description,metric,goal,reward,prizes,starts_at,ends_at,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      'event', 'Неделя апгрейдов', 'Выиграй 5 апгрейдов и получи бонус.', 'upgrade_win', 5, 2500, '[]', t, t + 7 * D, 'active', t);
  }
  if (!one('SELECT 1 FROM news LIMIT 1')) {
    run('INSERT INTO news(title,body,image,kind,published,created_at) VALUES(?,?,?,?,1,?)', 'BURGER SKIN открыт', 'Добро пожаловать! В каталоге — кейсы, апгрейд, контракты, битвы кейсов и семь мини-игр. Каждый результат можно проверить на странице Provably Fair.', '/img/items/Kilowatt-case.png', 'news', t);
    run('INSERT INTO news(title,body,image,kind,published,created_at) VALUES(?,?,?,?,1,?)', 'Стартовал BURGER PASS «Сезон 1: Kilowatt»', '100 уровней, бесплатная и премиум-ветка наград. Опыт начисляется за открытия, игры и задания.', '/img/items/Kilowatt-ak.png', 'promo', t - 1000);
    run('INSERT INTO news(title,body,image,kind,published,created_at) VALUES(?,?,?,?,1,?)', 'Промокод BURGER', 'Введите промокод BURGER на странице «Промокоды» и получите 50 ₽ на внутренний баланс. Количество активаций ограничено.', '/img/items/Kukri-fade.png', 'promo', t - 2000);
  }
  run('INSERT OR IGNORE INTO promo_codes(code,amount,max_uses,uses,expires_at,active,created_at) VALUES(?,?,?,0,NULL,1,?)', 'BURGER', 5000, 1000, t);
}

function seedPass() {
  if (one('SELECT 1 FROM pass_seasons LIMIT 1')) return false;
  const t = now();
  const id = Number(run('INSERT INTO pass_seasons(name,status,xp_per_level,premium_price,starts_at,ends_at,created_at) VALUES(?,?,?,?,?,?,?)',
    'Сезон 1: Kilowatt', 'draft', 500, 49900, t, t + 90 * 86400_000, t).lastInsertRowid);
  generatePassRewards(id);
  run("UPDATE pass_seasons SET status='active' WHERE id=?", id);
  return true;
}

export function seed() {
  const items = seedItems();
  let cases = 0;
  tx(() => { for (const c of SEED_CASES) if (seedCase(c.slug, c.name, c.description, c.categories, c.sort, c.pick(), c.image)) cases++; });
  recalcAllCases();
  tx(() => seedContent());
  const pass = seedPass();
  const banner = getSetting('banner');
  if (!banner.image) setSetting('banner', { ...banner, title: 'Сочные кейсы CS2', subtitle: 'Открывай, апгрейди, сражайся в битвах — каждый результат проверяется через Provably Fair.', image: '/img/items/Kilowatt-ak.png' });
  setSetting('seed_version', 1);
  return { items, casesCreated: cases, passCreated: pass, totals: { items: one('SELECT COUNT(*) n FROM items').n, cases: one('SELECT COUNT(*) n FROM cases').n } };
}

if (import.meta.filename === process.argv[1]) console.log(JSON.stringify(seed(), null, 2));
