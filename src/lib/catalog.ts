// Каталог CS2: импорт предметов (ByMykel CSGO-API / JSON / CSV), импорт цен (Skinport / JSON / CSV),
// импорт официальных кейсов и генерация тематических кейсов. Ничего не придумывает: только данные из файлов/источников.
import { one, all, run, tx, now } from './db.ts';
import { HttpError } from './http.ts';
import { recalcCase, recalcAllCases } from './cases.ts';

export type ImportReport = { added: number; updated: number; skipped: number; errors: Array<{ row: number; error: string }> };

// ---------- Парсинг форматов ----------
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',' || ch === ';') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell);
  if (row.some((x) => x !== '')) rows.push(row);
  if (!rows.length) return [];
  const head = rows[0].map((h) => h.trim().replace(/^\uFEFF/, ''));
  return rows.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, (r[i] ?? '').trim()])));
}
export function parseImport(data: string, format?: string): any[] {
  const s = String(data || '').trim();
  if (!s) throw new HttpError(400, 'Пустые данные импорта');
  if (format === 'csv' || (!format && !/^[\[{]/.test(s))) return parseCsv(s);
  let j: any;
  try { j = JSON.parse(s); } catch { throw new HttpError(400, 'Некорректный JSON'); }
  if (Array.isArray(j)) return j;
  if (Array.isArray(j.items)) return j.items;
  if (j && typeof j === 'object') return Object.values(j);
  throw new HttpError(400, 'Ожидается массив записей');
}

// ---------- Нормализация предметов ----------
const RARITY_COLORS: Record<string, string> = {
  'Consumer Grade': '#b0c3d9', 'Industrial Grade': '#5e98d9', 'Mil-Spec Grade': '#4b69ff', 'Restricted': '#8847ff', 'Classified': '#d32ce6',
  'Covert': '#eb4b4b', 'Extraordinary': '#e4ae39', 'Contraband': '#e4ae39',
};
const truthy = (x: any) => x === true || x === 1 || x === '1' || String(x).toLowerCase() === 'true' || String(x).toLowerCase() === 'yes';
const okImage = (u: any) => typeof u === 'string' && (/^https:\/\/[\w.-]+\/[^\s"'<>]+$/.test(u) || /^\/(img|uploads\/public)\/[\w./-]+$/.test(u));
export function normalizeItem(s: any) {
  // Формат ByMykel (вложенные объекты) или плоский CSV/JSON.
  const rarityName = s.rarity?.name ?? s.rarity_name ?? s.rarityName ?? null;
  const knifeOrGlove = /^★/.test(String(s.name || ''));
  const rn = knifeOrGlove && (rarityName === 'Covert' || !rarityName) ? 'Extraordinary' : rarityName;
  return {
    ext_id: s.id ?? s.ext_id ?? s.extId ?? null,
    name: String(s.name || '').trim(),
    weapon: s.weapon?.name ?? s.weapon ?? null,
    category: s.category?.name ?? s.category ?? null,
    pattern: s.pattern?.name ?? s.pattern ?? null,
    rarity: s.rarity?.id ?? (typeof s.rarity === 'string' ? s.rarity : null),
    rarity_name: rn,
    rarity_color: (knifeOrGlove ? RARITY_COLORS.Extraordinary : null) || s.rarity?.color || s.rarity_color || s.rarityColor || (rn ? RARITY_COLORS[rn] : null) || null,
    min_float: s.min_float ?? s.minFloat ?? null,
    max_float: s.max_float ?? s.maxFloat ?? null,
    stattrak: truthy(s.stattrak) ? 1 : 0,
    souvenir: truthy(s.souvenir) ? 1 : 0,
    image: s.image || null,
    collection: (Array.isArray(s.collections) ? s.collections[0]?.name : s.collection) || null,
    crates: Array.isArray(s.crates) ? JSON.stringify(s.crates.map((c: any) => c.name).filter(Boolean)) : s.crates || null,
  };
}
export function importItems(rows: any[], source: string): ImportReport {
  const rep: ImportReport = { added: 0, updated: 0, skipped: 0, errors: [] };
  tx(() => {
    rows.forEach((raw, i) => {
      const it = normalizeItem(raw);
      if (!it.name || it.name.length > 160) { rep.skipped++; rep.errors.push({ row: i + 1, error: 'нет названия' }); return; }
      if (it.image && !okImage(it.image)) { rep.errors.push({ row: i + 1, error: `недопустимый адрес изображения: ${it.name}` }); it.image = null; }
      const mn = it.min_float == null || it.min_float === '' ? 0 : Number(it.min_float);
      const mx = it.max_float == null || it.max_float === '' ? 1 : Number(it.max_float);
      if (!(mn >= 0 && mx <= 1 && mn <= mx)) { rep.skipped++; rep.errors.push({ row: i + 1, error: `некорректный float: ${it.name}` }); return; }
      const ex = (it.ext_id && one('SELECT * FROM items WHERE ext_id=?', String(it.ext_id))) || one('SELECT * FROM items WHERE name=? COLLATE NOCASE ORDER BY id LIMIT 1', it.name);
      if (ex) {
        run(`UPDATE items SET ext_id=COALESCE(?, ext_id), name=?, weapon=COALESCE(?, weapon), category=COALESCE(?, category), pattern=COALESCE(?, pattern), rarity=COALESCE(?, rarity),
          rarity_name=COALESCE(?, rarity_name), rarity_color=COALESCE(?, rarity_color), min_float=?, max_float=?, stattrak=?, souvenir=?,
          image=CASE WHEN image LIKE '/img/%' OR image LIKE '/uploads/%' THEN image ELSE COALESCE(?, image) END, collection=COALESCE(?, collection), crates=COALESCE(?, crates), updated_at=? WHERE id=?`,
          it.ext_id ? String(it.ext_id) : null, it.name, it.weapon, it.category, it.pattern, it.rarity, it.rarity_name, it.rarity_color, mn, mx, it.stattrak, it.souvenir, it.image, it.collection, it.crates, now(), ex.id);
        rep.updated++;
      } else {
        run('INSERT INTO items(ext_id,name,weapon,category,pattern,rarity,rarity_name,rarity_color,min_float,max_float,stattrak,souvenir,image,collection,crates,price_source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          it.ext_id ? String(it.ext_id) : null, it.name, it.weapon, it.category, it.pattern, it.rarity, it.rarity_name, it.rarity_color, mn, mx, it.stattrak, it.souvenir, it.image, it.collection, it.crates, null, now(), now());
        rep.added++;
      }
    });
  });
  run('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at', 'catalog_last_import', JSON.stringify({ source, at: now(), ...rep, errors: rep.errors.length }), now());
  return rep;
}

// ---------- Цены ----------
const WEAR_CODES: Record<string, string> = { 'Factory New': 'FN', 'Minimal Wear': 'MW', 'Field-Tested': 'FT', 'Well-Worn': 'WW', 'Battle-Scarred': 'BS', FN: 'FN', MW: 'MW', FT: 'FT', WW: 'WW', BS: 'BS' };
/** «StatTrak™ AK-47 | Redline (Field-Tested)» → { name: 'AK-47 | Redline', wear: 'FT', variant: 'st' } */
export function parseMarketName(m: string) {
  let s = String(m || '').trim();
  let variant = '';
  let star = '';
  if (s.startsWith('★ ')) { star = '★ '; s = s.slice(2); }
  if (s.startsWith('StatTrak™ ')) { variant = 'st'; s = s.slice(10); }
  else if (s.startsWith('Souvenir ')) { variant = 'sv'; s = s.slice(9); }
  let wear = '';
  const w = /\s\(([^)]+)\)$/.exec(s);
  if (w && WEAR_CODES[w[1]]) { wear = WEAR_CODES[w[1]]; s = s.slice(0, w.index); }
  return { name: star + s, wear, variant };
}
export function importPrices(rows: any[], source: string): ImportReport & { unmatched: string[] } {
  const rep = { added: 0, updated: 0, skipped: 0, errors: [] as Array<{ row: number; error: string }>, unmatched: [] as string[] };
  const touched = new Set<number>();
  tx(() => {
    rows.forEach((r, i) => {
      const parsed = r.market_hash_name ? parseMarketName(r.market_hash_name) : { name: String(r.name || '').trim(), wear: WEAR_CODES[r.wear] || '', variant: ['st', 'sv'].includes(r.variant) ? r.variant : '' };
      const raw = r.price ?? r.suggested_price ?? r.median_price ?? r.min_price ?? r.mean_price;
      const price = Math.round(Number(raw) * 100);
      if (!parsed.name || !Number.isFinite(price) || price <= 0) { rep.skipped++; return; }
      const it = one('SELECT id FROM items WHERE name=? COLLATE NOCASE AND archived=0 ORDER BY id LIMIT 1', parsed.name);
      if (!it) { rep.skipped++; if (rep.unmatched.length < 200) rep.unmatched.push(r.market_hash_name || parsed.name); return; }
      const ex = one('SELECT 1 FROM item_prices WHERE item_id=? AND wear=? AND variant=?', it.id, parsed.wear, parsed.variant);
      run('INSERT INTO item_prices(item_id,wear,variant,price,source,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(item_id,wear,variant) DO UPDATE SET price=excluded.price, source=excluded.source, updated_at=excluded.updated_at',
        it.id, parsed.wear, parsed.variant, price, String(r.source || source), now());
      if (ex) rep.updated++; else rep.added++;
      touched.add(it.id);
    });
    for (const id of touched) {
      const p = one("SELECT price, source FROM item_prices WHERE item_id=? AND variant='' ORDER BY CASE wear WHEN 'FT' THEN 0 WHEN '' THEN 0 WHEN 'MW' THEN 1 WHEN 'WW' THEN 2 WHEN 'FN' THEN 3 ELSE 4 END LIMIT 1", id)
        || one('SELECT price, source FROM item_prices WHERE item_id=? ORDER BY price LIMIT 1', id);
      if (p) run('UPDATE items SET base_price=?, price_source=?, updated_at=? WHERE id=?', p.price, p.source, now(), id);
    }
  });
  run('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at', 'catalog_last_prices', JSON.stringify({ source, at: now(), added: rep.added, updated: rep.updated, skipped: rep.skipped }), now());
  return rep;
}

// ---------- Кейсы ----------
// Официальные шансы CS2 по уровням редкости (для низших уровней — пропорциональное расширение шкалы).
export const TIER_WEIGHT: Record<string, number> = {
  'Consumer Grade': 240, 'Industrial Grade': 160, 'Mil-Spec Grade': 79.92, 'Restricted': 15.98, 'Classified': 3.2, 'Covert': 0.64, 'Extraordinary': 0.26, 'Contraband': 0.26,
};
const tierOf = (it: any) => (it.rarity_name in TIER_WEIGHT ? it.rarity_name : /^★/.test(it.name) ? 'Extraordinary' : 'Mil-Spec Grade');
const priced = "(i.base_price IS NOT NULL OR EXISTS (SELECT 1 FROM item_prices ip WHERE ip.item_id=i.id))";
const withImage = "(i.image IS NOT NULL AND i.image<>'')";
function weightsFor(items: any[]) {
  const byTier = new Map<string, any[]>();
  for (const it of items) { const t = tierOf(it); if (!byTier.has(t)) byTier.set(t, []); byTier.get(t)!.push(it); }
  const out: Array<{ id: number; weight: number }> = [];
  for (const [t, list] of byTier) for (const it of list) out.push({ id: it.id, weight: Math.round((TIER_WEIGHT[t] / list.length) * 1e6) / 1e6 });
  return out;
}
function upsertCase(extId: string, o: { name: string; description: string; image?: string | null; categories: string[]; sort?: number }, items: any[]) {
  if (items.length < 3) return 'skip';
  const slugBase = o.name.toLowerCase().replace(/★/g, '').replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'case';
  let ex = one('SELECT * FROM cases WHERE ext_id=?', extId);
  if (!ex) {
    let slug = slugBase, n = 2;
    while (one('SELECT 1 FROM cases WHERE slug=?', slug)) slug = `${slugBase}-${n++}`;
    const id = run('INSERT INTO cases(slug,name,description,image,price,price_mode,categories,status,sort,source,ext_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',
      slug, o.name, o.description, o.image || null, 100, 'auto', JSON.stringify(o.categories), 'published', o.sort ?? 100, 'catalog', extId, now(), now()).lastInsertRowid;
    ex = one('SELECT * FROM cases WHERE id=?', id);
  } else if (ex.source === 'catalog') {
    run('UPDATE cases SET name=?, description=?, image=COALESCE(?, image), categories=?, updated_at=? WHERE id=?', o.name, o.description, o.image || null, JSON.stringify(o.categories), now(), ex.id);
  } else return 'kept';
  run('DELETE FROM case_items WHERE case_id=?', ex.id);
  for (const w of weightsFor(items)) run('INSERT OR REPLACE INTO case_items(case_id,item_id,weight) VALUES(?,?,?)', ex.id, w.id, w.weight);
  recalcCase(ex.id);
  return 'ok';
}
/** Импорт официальных кейсов и сувенирных наборов из crates.json (ByMykel). */
export function importCrates(rows: any[]) {
  let ok = 0, skipped = 0;
  tx(() => {
    for (const cr of rows) {
      const type = String(cr.type || '');
      if (!/Case|Souvenir/i.test(type) || !Array.isArray(cr.contains)) { skipped++; continue; }
      const find = (x: any) => one(`SELECT i.* FROM items i WHERE (i.ext_id=? OR i.name=? COLLATE NOCASE) AND i.archived=0 AND ${priced} AND ${withImage} LIMIT 1`, String(x.id || ''), String(x.name || ''));
      const items = [...cr.contains, ...(cr.contains_rare || [])].map(find).filter(Boolean);
      const uniq = [...new Map(items.map((i: any) => [i.id, i])).values()];
      const knives = uniq.some((i: any) => i.category === 'Knives' || /^★/.test(i.name) && !/Gloves|Wraps/.test(i.name));
      const gloves = uniq.some((i: any) => i.category === 'Gloves' || /Gloves|Wraps/.test(i.name));
      const souvenir = /Souvenir/i.test(type) || /Souvenir/i.test(cr.name);
      const cats = souvenir ? ['souvenir', 'collection', 'official'] : ['official', 'collection'];
      if (knives) cats.push('knives');
      if (gloves) cats.push('gloves');
      if (knives && gloves) cats.push('knives_gloves');
      const r = upsertCase('crate:' + cr.id, { name: cr.name, description: `Официальный состав «${cr.name}», шансы по уровням редкости CS2.`, image: okImage(cr.image) ? cr.image : null, categories: cats, sort: 50 }, uniq);
      if (r === 'ok') ok++; else skipped++;
    }
  });
  return { cases: ok, skipped };
}
const KNIFE_RU = 'Нож';
/** Тематические кейсы из имеющегося каталога (только предметы с изображением и ценой). */
export function buildThemedCases() {
  const res: Record<string, number> = { created: 0, skipped: 0 };
  const pool = (where: string, ...p: any[]) => all(`SELECT i.* FROM items i WHERE i.archived=0 AND ${priced} AND ${withImage} AND (${where}) ORDER BY i.id`, ...p);
  const add = (key: string, o: any, items: any[]) => { const r = upsertCase('gen:' + key, o, items.slice(0, 120)); if (r === 'ok') res.created++; else res.skipped++; };
  tx(() => {
    // По оружию
    for (const w of all("SELECT weapon, COUNT(*) n FROM items i WHERE archived=0 AND weapon IS NOT NULL AND name NOT LIKE '★%' GROUP BY weapon HAVING n >= 3 ORDER BY n DESC"))
      add('weapon:' + w.weapon, { name: `Всё для ${w.weapon}`, description: `Скины ${w.weapon} из каталога, шансы по редкости.`, categories: ['weapon', 'themed'], sort: 200 }, pool("i.weapon=? AND i.name NOT LIKE '★%'", w.weapon));
    // По типу ножа
    for (const k of all("SELECT weapon, COUNT(*) n FROM items i WHERE archived=0 AND name LIKE '★%' AND name NOT LIKE '%Gloves%' AND name NOT LIKE '%Wraps%' GROUP BY weapon HAVING n >= 3"))
      add('knife:' + k.weapon, { name: `★ ${k.weapon}`, description: `${KNIFE_RU} ${k.weapon} в разных расцветках.`, categories: ['knives', 'premium', 'rare'], sort: 30 }, pool("i.weapon=? AND i.name LIKE '★%'", k.weapon));
    // Перчатки
    for (const g of all("SELECT weapon, COUNT(*) n FROM items i WHERE archived=0 AND (category='Gloves' OR name LIKE '%Gloves%' OR name LIKE '%Wraps%') GROUP BY weapon HAVING n >= 3"))
      add('gloves:' + g.weapon, { name: `★ ${g.weapon}`, description: 'Перчатки CS2.', categories: ['gloves', 'premium', 'rare'], sort: 35 }, pool('i.weapon=?', g.weapon));
    const gloves = pool("i.category='Gloves' OR i.name LIKE '%Gloves%' OR i.name LIKE '%Wraps%'");
    const knives = pool("i.name LIKE '★%' AND i.name NOT LIKE '%Gloves%' AND i.name NOT LIKE '%Wraps%'");
    add('gloves:all', { name: 'Все перчатки', description: 'Любые перчатки из каталога.', categories: ['gloves', 'premium', 'rare', 'popular'], sort: 20 }, gloves);
    add('knives:all', { name: 'Ножевой бургер', description: 'Только ножи.', categories: ['knives', 'premium', 'rare', 'popular'], sort: 20 }, knives);
    add('kg:mix', { name: 'Нож или перчатки', description: 'Ножи и перчатки в одном кейсе.', categories: ['knives_gloves', 'knives', 'gloves', 'premium', 'rare'], sort: 15 },
      [...knives.filter((_: any, i: number) => i % 2 === 0).slice(0, 60), ...gloves.slice(0, 60)]);
    // По редкости
    const RU: Record<string, string> = { 'Consumer Grade': 'Ширпотреб', 'Industrial Grade': 'Промышленное', 'Mil-Spec Grade': 'Армейское', Restricted: 'Запрещённое', Classified: 'Засекреченное', Covert: 'Тайное' };
    for (const [r, ru] of Object.entries(RU)) {
      const items = pool("i.rarity_name=? AND i.name NOT LIKE '★%'", r);
      const cats = ['rarity'];
      if (['Consumer Grade', 'Industrial Grade', 'Mil-Spec Grade'].includes(r)) cats.push('cheap');
      if (['Classified', 'Covert'].includes(r)) cats.push('premium');
      if (r === 'Covert') cats.push('rare');
      // Разбиваем большие уровни на несколько кейсов по цене.
      const sorted = [...items].sort((a, b) => (a.base_price || 0) - (b.base_price || 0));
      const parts = Math.max(1, Math.min(4, Math.floor(sorted.length / 25)));
      for (let p = 0; p < parts; p++) {
        const slice = sorted.slice(Math.floor((p * sorted.length) / parts), Math.floor(((p + 1) * sorted.length) / parts));
        add(`rarity:${r}:${p}`, { name: parts > 1 ? `${ru} • ${['I', 'II', 'III', 'IV'][p]}` : `${ru} качество`, description: `Только предметы редкости «${r}».`, categories: cats, sort: 120 + p }, slice);
      }
    }
    // По категории оружия
    const CAT: Record<string, string> = { Pistols: 'Пистолетный залп', Rifles: 'Винтовки', SMGs: 'Пистолеты-пулемёты', Heavy: 'Тяжёлая артиллерия' };
    for (const [cat, ru] of Object.entries(CAT)) add('cat:' + cat, { name: ru, description: `Категория «${cat}».`, categories: ['themed', 'weapon'], sort: 150 }, pool("i.category=? AND i.name NOT LIKE '★%'", cat));
    // Коллекции без кейса
    for (const col of all("SELECT collection, COUNT(*) n FROM items i WHERE archived=0 AND collection IS NOT NULL AND collection<>'' GROUP BY collection HAVING n >= 5"))
      if (!one("SELECT 1 FROM cases WHERE name=? AND source<>'catalog'", col.collection))
        add('col:' + col.collection, { name: col.collection, description: `Предметы коллекции «${col.collection}».`, categories: ['collection'], sort: 180 }, pool('i.collection=?', col.collection));
    // По цене (только если есть цены из источника)
    const BANDS: Array<[number, number, string, string[]]> = [[0, 1000, 'До 10 ₽', ['cheap']], [1000, 5000, '10–50 ₽', ['cheap']], [5000, 30000, '50–300 ₽', []], [30000, 200000, '300–2000 ₽', ['premium']], [200000, 1e12, '2000+ ₽', ['premium', 'rare']]];
    for (const [lo, hi, label, cats] of BANDS) add(`band:${lo}`, { name: `Корзина ${label}`, description: `Предметы с базовой оценкой ${label}.`, categories: ['themed', ...cats], sort: 90 }, pool('i.base_price >= ? AND i.base_price < ?', lo, hi));
  });
  return res;
}
export function catalogStats() {
  const n = (sql: string) => one(sql).n;
  return {
    items: n('SELECT COUNT(*) n FROM items WHERE archived=0'),
    withImage: n("SELECT COUNT(*) n FROM items WHERE archived=0 AND image IS NOT NULL AND image<>''"),
    localImages: n("SELECT COUNT(*) n FROM items WHERE archived=0 AND image LIKE '/img/%'"),
    withPrice: n('SELECT COUNT(*) n FROM items i WHERE archived=0 AND (base_price IS NOT NULL OR EXISTS (SELECT 1 FROM item_prices ip WHERE ip.item_id=i.id))'),
    knives: n("SELECT COUNT(*) n FROM items WHERE archived=0 AND name LIKE '★%' AND name NOT LIKE '%Gloves%' AND name NOT LIKE '%Wraps%'"),
    gloves: n("SELECT COUNT(*) n FROM items WHERE archived=0 AND (category='Gloves' OR name LIKE '%Gloves%' OR name LIKE '%Wraps%')"),
    weapons: n('SELECT COUNT(DISTINCT weapon) n FROM items WHERE archived=0'),
    collections: n("SELECT COUNT(DISTINCT collection) n FROM items WHERE archived=0 AND collection IS NOT NULL AND collection<>''"),
    cases: n("SELECT COUNT(*) n FROM cases WHERE status='published'"),
    priceSources: all('SELECT COALESCE(price_source, —) s, COUNT(*) n FROM items WHERE archived=0 GROUP BY price_source'.replace('—', "'нет'")),
    lastImport: (() => { const r = one("SELECT value FROM settings WHERE key='catalog_last_import'"); return r ? JSON.parse(r.value) : null; })(),
    lastPrices: (() => { const r = one("SELECT value FROM settings WHERE key='catalog_last_prices'"); return r ? JSON.parse(r.value) : null; })(),
  };
}
export { recalcAllCases };
