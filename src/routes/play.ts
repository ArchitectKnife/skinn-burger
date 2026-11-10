// Каталог скинов и кейсов, открытие, инвентарь, продажа, апгрейд, контракты, история, Provably Fair.
import { one, all, run, tx, now } from '../lib/db.ts';
import { route, v, bad, notFound, HttpError, sha256, onlineCount } from '../lib/http.ts';
import { WEARS, hasWear, wearsAvailable, priceOf, itemView, invView, INV_SELECT, addInventory, consumeInventory, change, track, roll, rotateSeed,
  activeSeed, floatsFrom, getSetting, requireFeature, checkRestriction, publicUser, imageUrl, feature, periodKey } from '../lib/core.ts';
import { caseCard, caseDetail, openCase, wearOdds } from '../lib/cases.ts';
import { can } from '../lib/auth.ts';
import { sharedDrop, parseShare } from '../lib/dropfx.ts';

export const CASE_CATEGORIES: Record<string, string> = {
  popular: 'Популярные', new: 'Новые', cheap: 'Дешёвые', premium: 'Премиум', rare: 'Редкие', themed: 'Тематические',
  collection: 'Коллекционные', official: 'Официальные', knives: 'С ножами', gloves: 'С перчатками', knives_gloves: 'Ножи и перчатки',
  rarity: 'По редкости', weapon: 'По оружию', souvenir: 'Сувенирные',
  mid: 'Средние', expensive: 'Дорогие', elite: 'Элитные', covert: 'Тайные', exclusive: 'Эксклюзивные', awp: 'AWP', ak47: 'AK-47',
};
const RARE_KNIFE = "(i.category='Knives' OR i.weapon LIKE '%Knife%' OR i.name LIKE '★%')";

// ---------- Скины ----------
function itemPriceView(it: any) {
  const wears = wearsAvailable(it);
  const prices = wears.map((w) => ({ wear: w, price: priceOf(it.id, w, '') }));
  const st = it.stattrak ? wears.map((w) => ({ wear: w, price: priceOf(it.id, w, 'st') })) : [];
  const sv = it.souvenir ? wears.map((w) => ({ wear: w, price: priceOf(it.id, w, 'sv') })) : [];
  const src = one('SELECT source, MAX(updated_at) t FROM item_prices WHERE item_id=? GROUP BY source ORDER BY t DESC LIMIT 1', it.id);
  return { ...itemView(it), prices, stattrakPrices: st, souvenirPrices: sv, priceSource: src?.source || it.price_source || 'internal', priceUpdated: src?.t || null,
    minPrice: prices.length ? Math.min(...prices.map((p) => p.price)) : 0 };
}
route('GET', '/api/items/meta', () => ({
  total: one('SELECT COUNT(*) n FROM items WHERE archived=0').n,
  withImages: one("SELECT COUNT(*) n FROM items WHERE archived=0 AND image IS NOT NULL AND image<>''").n,
  weapons: all('SELECT weapon name, category, COUNT(*) n FROM items WHERE archived=0 GROUP BY weapon ORDER BY category, weapon'),
  categories: all('SELECT category name, COUNT(*) n FROM items WHERE archived=0 GROUP BY category ORDER BY n DESC'),
  rarities: all("SELECT rarity_name id, rarity_name name, MAX(rarity_color) color, COUNT(*) n FROM items WHERE archived=0 AND rarity_name IS NOT NULL AND rarity_name<>'' GROUP BY rarity_name ORDER BY MIN(COALESCE(base_price,0))"),
  collections: all("SELECT collection name, COUNT(*) n FROM items WHERE archived=0 AND collection IS NOT NULL AND collection<>'' GROUP BY collection ORDER BY collection"),
}));
route('GET', '/api/items', (c) => {
  const q = c.query;
  const where = ['i.archived=0'];
  const p: any[] = [];
  if (q.get('q')) { where.push('i.name LIKE ?'); p.push('%' + String(q.get('q')).slice(0, 60) + '%'); }
  for (const [k, col] of [['weapon', 'i.weapon'], ['category', 'i.category'], ['collection', 'i.collection']]) {
    if (q.get(k)) { where.push(`${col}=?`); p.push(q.get(k)); }
  }
  if (q.get('rarity')) { where.push('(i.rarity=? OR i.rarity_name=?)'); p.push(q.get('rarity'), q.get('rarity')); }
  if (q.get('stattrak') === '1') where.push('i.stattrak=1');
  if (q.get('souvenir') === '1') where.push('i.souvenir=1');
  const sort = ({ price_desc: 'COALESCE(i.base_price,0) DESC', price_asc: 'COALESCE(i.base_price,0) ASC', name: 'i.name ASC', new: 'i.id DESC' } as any)[q.get('sort') || ''] || 'COALESCE(i.base_price,0) DESC';
  const page = Math.max(1, Number(q.get('page')) || 1);
  const size = Math.min(96, Math.max(12, Number(q.get('size')) || 48));
  const total = one(`SELECT COUNT(*) n FROM items i WHERE ${where.join(' AND ')}`, ...p).n;
  const rows = all(`SELECT i.* FROM items i WHERE ${where.join(' AND ')} ORDER BY ${sort} LIMIT ? OFFSET ?`, ...p, size, (page - 1) * size);
  return { total, page, size, items: rows.map((r) => ({ ...itemView(r), minPrice: priceOf(r.id, wearsAvailable(r)[0], '') })) };
});
route('GET', '/api/items/:id', (c) => {
  const it = one('SELECT * FROM items WHERE id=?', v.int(c.params.id, 'id', 1));
  if (!it || (it.archived && !can(c.user, 'items.manage'))) throw notFound('Предмет не найден');
  const cases = all("SELECT c.* FROM case_items ci JOIN cases c ON c.id=ci.case_id WHERE ci.item_id=? AND c.status='published' ORDER BY c.price LIMIT 12", it.id).map(caseCard);
  const drops = one("SELECT COUNT(*) n FROM inventory WHERE item_id=?", it.id).n;
  return { item: { ...itemPriceView(it), wearOdds: wearOdds(it) }, cases, drops, wearsInfo: WEARS.map((w) => ({ code: w[0], name: w[1], min: w[2], max: Math.min(1, w[3]) })) };
});

// ---------- Кейсы ----------
route('GET', '/api/cases', (c) => {
  const q = c.query;
  const where = ["c.status='published'"];
  const p: any[] = [];
  if (q.get('q')) { where.push('c.name LIKE ?'); p.push('%' + String(q.get('q')).slice(0, 60) + '%'); }
  const cat = q.get('category');
  if (cat && cat !== 'all' && cat !== 'popular' && cat !== 'new') { where.push('EXISTS (SELECT 1 FROM json_each(c.categories) WHERE value=?)'); p.push(cat); }
  if (q.get('min')) { where.push('c.price >= ?'); p.push(Math.round(Number(q.get('min')) * 100) || 0); }
  if (q.get('max')) { where.push('c.price <= ?'); p.push(Math.round(Number(q.get('max')) * 100) || 1e12); }
  if (q.get('item')) { where.push(`EXISTS (SELECT 1 FROM case_items ci JOIN items i ON i.id=ci.item_id WHERE ci.case_id=c.id AND i.name LIKE ?)`); p.push('%' + String(q.get('item')).slice(0, 60) + '%'); }
  const s = q.get('sort') || (cat === 'new' ? 'new' : 'popular');
  const order = ({ popular: 'c.opens DESC, c.sort DESC', new: 'c.created_at DESC, c.id DESC', price_asc: 'c.price ASC', price_desc: 'c.price DESC', name: 'c.name ASC', rtp: 'CAST(c.ev AS REAL)/MAX(c.price,1) DESC' } as any)[s] || 'c.opens DESC';
  const rows = all(`SELECT c.* FROM cases c WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 500`, ...p);
  const counts: Record<string, number> = {};
  for (const r of all("SELECT value k, COUNT(*) n FROM cases, json_each(cases.categories) WHERE status='published' GROUP BY value")) counts[r.k] = r.n;
  counts.all = one("SELECT COUNT(*) n FROM cases WHERE status='published'").n;
  return { cases: rows.map(caseCard), categories: CASE_CATEGORIES, counts };
});
function loadCase(c: any, slug: string) {
  const cs = one('SELECT * FROM cases WHERE slug=?', slug);
  if (!cs || (cs.status !== 'published' && !can(c.user, 'cases.manage'))) throw notFound('Кейс не найден');
  return cs;
}
route('GET', '/api/cases/:slug', (c) => {
  const cs = loadCase(c, c.params.slug);
  const recent = all("SELECT b.*, u.nickname, u.avatar, u.role, u.created_at uc FROM bets b JOIN users u ON u.id=b.user_id WHERE b.game='case' AND json_extract(b.data,'$.caseId')=? ORDER BY b.id DESC LIMIT 12", cs.id)
    .map((b) => { const d = JSON.parse(b.data); const inv = one(INV_SELECT + ' WHERE inv.id=?', d.invId); return inv ? { user: publicUser({ id: b.user_id, nickname: b.nickname, avatar: b.avatar, role: b.role, created_at: b.uc }), item: invView(inv), at: b.created_at } : null; })
    .filter(Boolean);
  return { case: caseDetail(cs), recent, preview: cs.status !== 'published' };
});
route('POST', '/api/cases/:slug/open', (c) => {
  const cs = loadCase(c, c.params.slug);
  if (cs.status !== 'published') throw bad('Кейс не опубликован');
  checkRestriction(c.user, 'cases');
  const count = v.int(c.body.count ?? 1, 'Количество', 1, 10);
  return openCase(c.user.id, cs, count);
}, { auth: true, idem: true, rate: [30, 10_000] });
// Публичная карточка дропа для кнопки «Поделиться дропом». Токен подписан HMAC — перебрать чужие дропы нельзя.
route('GET', '/api/drops/:token', (c) => {
  if (!getSetting('drop_fx').share) throw notFound('Ссылки на дропы отключены');
  const d = sharedDrop(parseShare(c.params.token));
  if (!d) throw notFound('Дроп не найден');
  return { drop: d };
}, { rate: [60, 60_000] });

// ---------- Инвентарь ----------
route('GET', '/api/inventory', (c) => {
  const q = c.query;
  const status = q.get('status') || 'owned';
  const where = ['inv.user_id=?'];
  const p: any[] = [c.user.id];
  if (status !== 'all') { where.push('inv.status=?'); p.push(status); }
  if (q.get('q')) { where.push('i.name LIKE ?'); p.push('%' + String(q.get('q')).slice(0, 60) + '%'); }
  if (q.get('rarity')) { where.push('(i.rarity=? OR i.rarity_name=?)'); p.push(q.get('rarity'), q.get('rarity')); }
  if (q.get('wear')) { where.push('inv.wear=?'); p.push(q.get('wear')); }
  const rows = all(INV_SELECT + ` WHERE ${where.join(' AND ')} ORDER BY inv.id DESC LIMIT 1000`, ...p).map(invView);
  const s = q.get('sort') || 'new';
  if (s === 'price_desc') rows.sort((a, b) => b.price - a.price);
  if (s === 'price_asc') rows.sort((a, b) => a.price - b.price);
  if (s === 'name') rows.sort((a, b) => a.name.localeCompare(b.name));
  const owned = all(INV_SELECT + " WHERE inv.user_id=? AND inv.status='owned'", c.user.id).map(invView);
  return { items: rows, totalValue: owned.reduce((x, r) => x + r.price, 0), count: owned.length, sellRate: getSetting('economy').sell_rate };
}, { auth: true });

function sellItems(userId: number, ids: number[]) {
  return tx(() => {
    const items = consumeInventory(userId, ids, 'sold');
    const rate = getSetting('economy').sell_rate;
    const sum = items.reduce((s, it) => s + Math.floor(it.price * rate), 0);
    const bal = sum > 0 ? change(userId, sum, 'sell', { ref: 'inventory', refId: ids.join(','), reason: `Продажа предметов: ${items.length}` }) : one('SELECT balance FROM users WHERE id=?', userId).balance;
    track(userId, 'sell', items.length);
    return { sold: items.length, amount: sum, balance: bal };
  });
}
route('POST', '/api/inventory/sell', (c) => sellItems(c.user.id, v.ids(c.body.ids, 'Предметы', 1, 500)), { auth: true, idem: true, rate: [30, 10_000] });
route('POST', '/api/inventory/sell-all', (c) => {
  const ids = all("SELECT id FROM inventory WHERE user_id=? AND status='owned'", c.user.id).map((r) => r.id);
  if (!ids.length) throw bad('Инвентарь пуст');
  return sellItems(c.user.id, ids);
}, { auth: true, idem: true, rate: [5, 10_000] });

// ---------- Апгрейд ----------
function floatForWear(it: any, wear: string, r: number): number | null {
  if (!hasWear(it)) return null;
  const w = WEARS.find((x) => x[0] === wear);
  if (!w) return r;
  const lo = Math.max(it.min_float, w[2]);
  const hi = Math.min(it.max_float, w[3]) - 1e-6;
  const f = lo + r * Math.max(0, hi - lo);
  return (f - it.min_float) / (it.max_float - it.min_float);
}
// ---------- Апгрейд ----------
// Шанс считает только сервер: chance = min(max_chance, rtp × (input / target)^curve), curve ≥ 1, поэтому ожидание ≤ rtp.
// Браузер передаёт лишь ID предметов инвентаря и ID/качество цели; стоимость всегда берётся из БД.
// Защита: idempotency-ключ, лимит частоты, атомарное списание в транзакции, сверка ожидаемой стоимости.
const RARITY_RANK: Record<string, number> = { 'Consumer Grade': 1, 'Industrial Grade': 2, 'Mil-Spec Grade': 3, Restricted: 4, Classified: 5, Covert: 6, Extraordinary: 7, Contraband: 8 };
export const rarityRank = (it: any) => (String(it.name || '').startsWith('★') ? 7 : RARITY_RANK[it.rarity_name || it.rarityName] || 0);
export function upgradeRules() {
  const u = getSetting('upgrade');
  return {
    presets: (Array.isArray(u.presets) ? u.presets : [2, 3, 5, 10]).map(Number).filter((x: number) => x > 1),
    minMult: Number(u.min_mult) || 1.1, maxMult: Number(u.max_mult) || 20, rtp: Number(u.rtp) || 0.95, maxChance: Number(u.max_chance) || 0.75,
    minChance: Math.max(0, Number(u.min_chance) || 0), curve: Math.max(1, Number(u.curve) || 1), maxItems: Math.max(1, Math.round(Number(u.max_items) || 6)),
    tolerance: Math.min(0.5, Math.max(0.02, Number(u.tolerance) || 0.2)),
  };
}
export function upgradeChance(input: number, target: number) {
  const r = upgradeRules();
  if (!(input > 0) || !(target > input)) return 0;
  return Math.round(Math.min(r.maxChance, r.rtp * Math.pow(input / target, r.curve)) * 1e6) / 1e6;
}
function checkUpgrade(input: number, target: number) {
  const r = upgradeRules();
  if (!(input > 0)) throw bad('Выберите предметы для апгрейда');
  if (target <= input) throw bad('Цель должна быть дороже ставки');
  const mult = target / input;
  if (mult < r.minMult - 1e-9) throw bad(`Минимальный множитель — ×${r.minMult}. Выберите более дорогую цель`);
  if (mult > r.maxMult + 1e-9) throw bad(`Максимальный множитель — ×${r.maxMult}. Выберите более дешёвую цель`);
  const raw = r.rtp * Math.pow(input / target, r.curve);
  if (raw < r.minChance) throw bad('Шанс для этой цели ниже минимально допустимого');
  return { mult, chance: Math.round(Math.min(r.maxChance, raw) * 1e6) / 1e6 };
}
function inputFor(userId: number, ids: number[]) {
  const rows = ids.map((id) => one(INV_SELECT + " WHERE inv.id=? AND inv.user_id=? AND inv.status='owned'", id, userId));
  if (rows.some((r) => !r)) throw new HttpError(409, 'Один из предметов уже недоступен', 'item_unavailable');
  const views = rows.map(invView);
  return { views, input: views.reduce((s, r) => s + r.price, 0) };
}
function targetOf(body: any) {
  const itemId = v.int(body.itemId, 'Предмет', 1);
  const target = one('SELECT * FROM items WHERE id=? AND archived=0', itemId);
  if (!target) throw bad('Целевой предмет не найден');
  const wears = wearsAvailable(target);
  const wear = wears.includes(String(body.wear || '')) ? String(body.wear || '') : wears[0];
  const variant = body.variant === 'st' && target.stattrak ? 'st' : '';
  return { itemId, target, wear, variant };
}
const SORTS = ['fit', 'price_asc', 'price_desc', 'rarity', 'chance'];
function targetsFor(o: { input: number; min: number; max: number; q: string; rarity: string; category: string; sort: string; limit: number; ideal: number }) {
  const p: any[] = [];
  let where = 'archived=0';
  if (o.q) { where += ' AND name LIKE ?'; p.push('%' + o.q.slice(0, 60) + '%'); }
  if (o.rarity) { where += ' AND rarity_name=?'; p.push(o.rarity.slice(0, 40)); }
  if (o.category) { where += ' AND category=?'; p.push(o.category.slice(0, 40)); }
  const hi = Number.isFinite(o.max) ? Math.ceil(o.max * 2.5) : 1e15;
  const rows = all(`SELECT * FROM items WHERE ${where} AND COALESCE(base_price,0) >= ? AND COALESCE(base_price,0) <= ? ORDER BY COALESCE(base_price,0) ASC LIMIT 800`, ...p, Math.floor(o.min * 0.4), hi);
  const out: any[] = [];
  for (const it of rows) {
    for (const w of wearsAvailable(it)) {
      for (const variant of it.stattrak ? ['', 'st'] : ['']) {
        const price = priceOf(it.id, w, variant);
        if (price > o.min && price <= o.max) {
          out.push({ ...itemView(it), wear: w, variant, stattrak: variant === 'st', price, rank: rarityRank(it),
            multiplier: o.input > 0 ? Math.round((price / o.input) * 100) / 100 : null, chance: o.input > 0 ? upgradeChance(o.input, price) : null });
        }
      }
    }
  }
  const by: Record<string, (a: any, b: any) => number> = {
    fit: (a, b) => Math.abs(a.price - o.ideal) - Math.abs(b.price - o.ideal) || a.price - b.price,
    price_asc: (a, b) => a.price - b.price,
    price_desc: (a, b) => b.price - a.price,
    rarity: (a, b) => b.rank - a.rank || b.price - a.price,
    chance: (a, b) => (b.chance || 0) - (a.chance || 0),
  };
  return out.sort(by[o.sort] || by.price_asc).slice(0, o.limit);
}
function upgView(b: any, withUser = false) {
  let d: any = {};
  try { d = JSON.parse(b.data || '{}'); } catch { d = {}; }
  return { id: b.id, win: b.status === 'won', amount: b.amount, payout: b.payout, multiplier: b.multiplier, chance: d.chance ?? null, roll: d.roll ?? null,
    inputs: d.inputs || [], target: d.target || null, nonce: b.nonce, createdAt: b.created_at,
    user: withUser ? (b.private_profile ? { nickname: 'Скрытый профиль' } : { id: b.user_id, nickname: b.nickname, avatar: b.avatar ? imageUrl(b.avatar) : null }) : undefined };
}
route('GET', '/api/upgrade/rules', () => {
  const r = upgradeRules();
  return { rules: { presets: r.presets, minMult: r.minMult, maxMult: r.maxMult, maxItems: r.maxItems, maxChance: r.maxChance, minChance: r.minChance, rtp: r.rtp, curve: r.curve } };
});
route('GET', '/api/upgrade/targets', (c) => {
  const r = upgradeRules();
  const ids = String(c.query.get('ids') || '').split(',').map(Number).filter((x) => Number.isInteger(x) && x > 0).slice(0, r.maxItems);
  let input = Math.max(0, Math.round(Number(c.query.get('min') || 0)));
  if (ids.length && c.user) input = inputFor(c.user.id, ids).input;
  const mult = Number(c.query.get('mult') || 0);
  const q = String(c.query.get('q') || '').trim();
  const rarity = String(c.query.get('rarity') || '');
  const category = String(c.query.get('category') || '');
  const sortQ = String(c.query.get('sort') || '');
  const limit = Math.min(120, Math.max(10, Math.round(Number(c.query.get('limit') || 60))));
  let min = input; let max = Infinity; let ideal = input * 2; let sort = SORTS.includes(sortQ) ? sortQ : 'price_asc';
  if (input > 0) { min = Math.max(input, Math.floor(input * r.minMult) - 1); max = Math.ceil(input * r.maxMult); }
  if (input > 0 && mult > 0) {
    const m = Math.min(r.maxMult, Math.max(r.minMult, mult));
    ideal = input * m;
    min = Math.max(min, Math.floor(ideal * (1 - r.tolerance)));
    max = Math.min(max, Math.ceil(ideal * (1 + r.tolerance)));
    if (!SORTS.includes(sortQ)) sort = 'fit';
  }
  let targets = targetsFor({ input, min, max, q, rarity, category, sort, limit, ideal });
  let widened = false;
  if (!targets.length && input > 0 && mult > 0) {
    widened = true;
    targets = targetsFor({ input, min: Math.max(input, Math.floor(input * r.minMult) - 1), max: Math.ceil(input * r.maxMult), q, rarity, category, sort: 'fit', limit: 12, ideal });
  }
  return { targets, input, mult: mult > 0 ? Math.min(r.maxMult, Math.max(r.minMult, mult)) : null, widened, rules: { presets: r.presets, minMult: r.minMult, maxMult: r.maxMult, maxItems: r.maxItems } };
});
route('POST', '/api/upgrade/quote', (c) => {
  const r = upgradeRules();
  const rawIds = Array.isArray(c.body.ids) ? c.body.ids.map((x: any) => Number(x)) : [];
  if (new Set(rawIds).size !== rawIds.length) throw bad('Один и тот же предмет выбран дважды');
  const ids = v.ids(c.body.ids, 'Предметы', 1, r.maxItems);
  const { input } = inputFor(c.user.id, ids);
  const t = targetOf(c.body);
  const price = priceOf(t.itemId, t.wear, t.variant);
  const q = checkUpgrade(input, price);
  return { input, target: price, wear: t.wear, variant: t.variant, chance: q.chance, multiplier: q.mult };
}, { auth: true, rate: [120, 60_000] });
route('GET', '/api/upgrade/history', (c) => {
  const scope = c.query.get('scope') === 'all' ? 'all' : 'me';
  if (scope === 'me') {
    if (!c.user) return { scope, rows: [] };
    const rows = all("SELECT * FROM bets WHERE user_id=? AND game='upgrade' ORDER BY id DESC LIMIT 30", c.user.id);
    const stats = one("SELECT COUNT(*) n, COALESCE(SUM(status='won'),0) wins, COALESCE(SUM(amount),0) spent, COALESCE(SUM(payout),0) won FROM bets WHERE user_id=? AND game='upgrade'", c.user.id);
    return { scope, rows: rows.map((b: any) => upgView(b)), stats };
  }
  const rows = all("SELECT b.*, u.nickname, u.avatar, u.private_profile FROM bets b JOIN users u ON u.id=b.user_id WHERE b.game='upgrade' ORDER BY b.id DESC LIMIT 20");
  return { scope, rows: rows.map((b: any) => upgView(b, true)) };
});
route('POST', '/api/upgrade', (c) => {
  requireFeature('upgrade', 'Апгрейд');
  checkRestriction(c.user, 'games');
  const rules = upgradeRules();
  const rawIds = Array.isArray(c.body.ids) ? c.body.ids.map((x: any) => Number(x)) : [];
  if (new Set(rawIds).size !== rawIds.length) throw bad('Один и тот же предмет выбран дважды');
  const ids = v.ids(c.body.ids, 'Предметы', 1, rules.maxItems);
  const { itemId, target, wear, variant } = targetOf(c.body);
  const expectInput = Math.round(Number(c.body.expectInput) || 0);
  const expectTarget = Math.round(Number(c.body.expectTarget) || 0);
  return tx(() => {
    const inputs = consumeInventory(c.user.id, ids, 'upgraded');
    const input = inputs.reduce((s, r) => s + r.price, 0);
    const tPrice = priceOf(itemId, wear, variant);
    const drift = (a: number, b: number) => b > 0 && Math.abs(a - b) > Math.max(1, b * 0.005);
    if (drift(input, expectInput) || drift(tPrice, expectTarget)) throw new HttpError(409, 'Стоимость предметов изменилась — проверьте шанс ещё раз', 'price_changed');
    const { mult, chance } = checkUpgrade(input, tPrice);
    const r = roll(c.user.id, 2);
    const win = r.floats[0] < chance;
    const won = win ? addInventory(c.user.id, itemId, floatForWear(target, wear, r.floats[1]), variant, 'upgrade', null) : null;
    const betId = run('INSERT INTO bets(user_id,game,amount,payout,multiplier,status,data,seed_id,nonce,server_hash,created_at,settled_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      c.user.id, 'upgrade', input, won ? won.price : 0, mult, win ? 'won' : 'lost',
      JSON.stringify({ inputs: inputs.map((i) => ({ id: i.id, name: i.name, image: i.image, price: i.price, wear: i.wear, color: i.color })),
        target: { itemId, name: target.name, image: imageUrl(target.image), color: target.rarity_color, wear, variant, price: tPrice }, chance, roll: r.floats[0], invId: won?.id || null }),
      r.seedId, r.nonce, r.hash, now(), now()).lastInsertRowid;
    if (won) run('UPDATE inventory SET source_id=? WHERE id=?', String(betId), won.id);
    track(c.user.id, 'upgrade');
    if (win) track(c.user.id, 'upgrade_win');
    track(c.user.id, 'wager', Math.floor(input / 100));
    return { win, chance, roll: r.floats[0], multiplier: mult, input, target: tPrice, rare: win && rarityRank(target) >= 6, item: won, betId, nonce: r.nonce, serverHash: r.hash };
  });
}, { auth: true, idem: true, rate: [20, 10_000] });

// ---------- Контракты ----------
// Целевая стоимость = вклад × (0.25 + 2.75·r³): от ×0.25 до ×3, среднее ≈ ×0.94. Выбирается предмет с ближайшей ценой.
const CONTRACT_MIN_K = 0.25, CONTRACT_MAX_K = 3;
function contractCandidates(target: number) {
  const rows = all('SELECT * FROM items WHERE archived=0 AND base_price IS NOT NULL ORDER BY ABS(base_price - ?) LIMIT 40', target);
  const out: any[] = [];
  for (const it of rows) for (const w of wearsAvailable(it)) out.push({ it, wear: w, price: priceOf(it.id, w, '') });
  return out.sort((a, b) => Math.abs(a.price - target) - Math.abs(b.price - target) || a.it.id - b.it.id || a.wear.localeCompare(b.wear)).slice(0, 5);
}
route('POST', '/api/contracts/quote', (c) => {
  const e = getSetting('economy');
  const ids = v.ids(c.body.ids, 'Предметы', 1, e.contract_max);
  const rows = ids.map((id) => one(INV_SELECT + " WHERE inv.id=? AND inv.user_id=? AND inv.status='owned'", id, c.user.id));
  if (rows.some((r) => !r)) throw bad('Предмет недоступен');
  const total = rows.map(invView).reduce((s, r) => s + r.price, 0);
  const sample = [CONTRACT_MIN_K, 0.6, 1, 1.8, CONTRACT_MAX_K].map((k) => contractCandidates(total * k)[0]).filter(Boolean)
    .map((x) => ({ ...itemView(x.it), wear: x.wear, price: x.price }));
  return { total, min: Math.round(total * CONTRACT_MIN_K), max: Math.round(total * CONTRACT_MAX_K), expected: Math.round(total * 0.9375), sample, minItems: e.contract_min, maxItems: e.contract_max };
}, { auth: true });
route('POST', '/api/contracts', (c) => {
  requireFeature('contracts', 'Контракты');
  checkRestriction(c.user, 'games');
  const e = getSetting('economy');
  const ids = v.ids(c.body.ids, 'Предметы', e.contract_min, e.contract_max);
  return tx(() => {
    const inputs = consumeInventory(c.user.id, ids, 'contracted');
    const total = inputs.reduce((s, r) => s + r.price, 0);
    const r = roll(c.user.id, 3);
    const target = Math.round(total * (CONTRACT_MIN_K + (CONTRACT_MAX_K - CONTRACT_MIN_K) * r.floats[0] ** 3));
    const cands = contractCandidates(target);
    if (!cands.length) throw new HttpError(500, 'Каталог пуст');
    const pick = cands[Math.min(cands.length - 1, Math.floor(r.floats[1] * cands.length))];
    const won = addInventory(c.user.id, pick.it.id, floatForWear(pick.it, pick.wear, r.floats[2]), '', 'contract', null);
    const betId = run('INSERT INTO bets(user_id,game,amount,payout,multiplier,status,data,seed_id,nonce,server_hash,created_at,settled_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      c.user.id, 'contract', total, won.price, won.price / Math.max(1, total), 'settled',
      JSON.stringify({ inputs: inputs.map((i) => ({ id: i.id, name: i.name, image: i.image, price: i.price, wear: i.wear })), target, invId: won.id, item: { name: won.name, image: won.image, wear: won.wear } }),
      r.seedId, r.nonce, r.hash, now(), now()).lastInsertRowid;
    run('UPDATE inventory SET source_id=? WHERE id=?', String(betId), won.id);
    track(c.user.id, 'contract');
    track(c.user.id, 'wager', Math.floor(total / 100));
    return { item: won, total, target, betId, nonce: r.nonce, serverHash: r.hash };
  });
}, { auth: true, idem: true, rate: [20, 10_000] });

// ---------- История ----------
export function betView(b: any) {
  const d = b.data ? JSON.parse(b.data) : {};
  let item: any = null;
  if (d.invId) { const inv = one(INV_SELECT + ' WHERE inv.id=?', d.invId); if (inv) item = invView(inv); }
  const seed = b.seed_id ? one('SELECT revealed_at, server_seed, client_seed FROM fair_seeds WHERE id=?', b.seed_id) : null;
  return { id: b.id, game: b.game, amount: b.amount, payout: b.payout, multiplier: b.multiplier, status: b.status, createdAt: b.created_at,
    data: { ...d, secret: undefined }, item, nonce: b.nonce, serverHash: b.server_hash, revealed: !!seed?.revealed_at,
    serverSeed: seed?.revealed_at ? seed.server_seed : null, clientSeed: seed?.client_seed || null };
}
route('GET', '/api/history', (c) => {
  const game = c.query.get('game');
  const page = Math.max(1, Number(c.query.get('page')) || 1);
  const p: any[] = [c.user.id];
  let where = 'user_id=?';
  if (game === 'games') where += " AND game NOT IN ('case','upgrade','contract')";
  else if (game) { where += ' AND game=?'; p.push(game); }
  where += " AND status<>'active'";
  const total = one(`SELECT COUNT(*) n FROM bets WHERE ${where}`, ...p).n;
  return { total, page, bets: all(`SELECT * FROM bets WHERE ${where} ORDER BY id DESC LIMIT 30 OFFSET ?`, ...p, (page - 1) * 30).map(betView) };
}, { auth: true });
route('GET', '/api/ledger', (c) => {
  const page = Math.max(1, Number(c.query.get('page')) || 1);
  const type = c.query.get('type');
  const p: any[] = [c.user.id];
  let where = 'user_id=?';
  if (type) { where += ' AND type=?'; p.push(type); }
  return { total: one(`SELECT COUNT(*) n FROM ledger WHERE ${where}`, ...p).n, page,
    rows: all(`SELECT id, amount, balance_after, type, reason, created_at FROM ledger WHERE ${where} ORDER BY id DESC LIMIT 40 OFFSET ?`, ...p, (page - 1) * 40) };
}, { auth: true });

// ---------- Provably Fair ----------
route('GET', '/api/fair', (c) => {
  const s = activeSeed(c.user.id);
  return { active: { serverHash: s.server_hash, clientSeed: s.client_seed, nonce: s.nonce },
    revealed: all('SELECT id, server_seed, server_hash, client_seed, nonce, revealed_at FROM fair_seeds WHERE user_id=? AND active=0 ORDER BY id DESC LIMIT 20', c.user.id) };
}, { auth: true });
route('POST', '/api/fair/rotate', (c) => {
  const cs = v.optStr(c.body.clientSeed, 'Client seed', 64);
  if (cs && !/^[\w-]{1,64}$/.test(cs)) throw bad('Client seed: латиница, цифры, дефис и подчёркивание');
  const r = rotateSeed(c.user.id, cs);
  const s = activeSeed(c.user.id);
  return { ...r, active: { serverHash: s.server_hash, clientSeed: s.client_seed, nonce: s.nonce } };
}, { auth: true, rate: [10, 60_000] });
route('POST', '/api/fair/verify', (c) => {
  const serverSeed = v.str(c.body.serverSeed, 'Server seed', 1, 128);
  const clientSeed = v.str(c.body.clientSeed, 'Client seed', 0, 256);
  const nonce = v.str(String(c.body.nonce ?? ''), 'Nonce', 1, 64);
  const count = v.int(c.body.count ?? 3, 'Количество', 1, 64);
  return { hash: sha256(serverSeed), floats: floatsFrom(serverSeed, clientSeed, nonce, count) };
}, { rate: [60, 60_000] });
route('GET', '/api/fair/bet/:id', (c) => {
  const b = one('SELECT * FROM bets WHERE id=?', v.int(c.params.id, 'id', 1));
  if (!b || (b.user_id !== c.user.id && !can(c.user, 'games.manage'))) throw notFound('Ставка не найдена');
  const view = betView(b);
  const floats = view.serverSeed ? floatsFrom(view.serverSeed, view.clientSeed as string, b.nonce, 32) : null;
  return { bet: view, floats };
}, { auth: true });

// ---------- Главная и лента ----------
export function feed(limit = 20, minPrice = 0) {
  return all("SELECT b.id, b.user_id, b.data, b.payout, b.created_at, u.nickname, u.avatar, u.role, u.created_at uc FROM bets b JOIN users u ON u.id=b.user_id WHERE b.game IN ('case','upgrade','contract','battle') AND b.payout >= ? AND json_extract(b.data,'$.invId') IS NOT NULL ORDER BY " + (minPrice ? 'b.payout DESC, b.id DESC' : 'b.id DESC') + ' LIMIT ?', minPrice, limit)
    .map((b) => { const d = JSON.parse(b.data); const inv = one(INV_SELECT + ' WHERE inv.id=?', d.invId); return inv ? { id: b.id, user: publicUser({ id: b.user_id, nickname: b.nickname, avatar: b.avatar, role: b.role, created_at: b.uc }), item: invView(inv), caseName: d.caseName || null, at: b.created_at } : null; })
    .filter(Boolean);
}
route('GET', '/api/feed', () => ({ drops: feed(24), big: feed(10, 1) }));
route('GET', '/api/home', (c) => {
  const pub = "status='published'";
  const day = periodKey('daily');
  const top = all("SELECT b.user_id, SUM(b.amount) w, SUM(b.payout) p FROM bets b WHERE b.created_at > ? AND b.status<>'active' GROUP BY b.user_id ORDER BY w DESC LIMIT 8", now() - 7 * 86400_000)
    .map((r) => ({ user: publicUser(one('SELECT * FROM users WHERE id=?', r.user_id)), wagered: r.w, won: r.p }));
  return {
    site: getSetting('site'), banner: getSetting('banner'), features: getSetting('features'),
    popular: all(`SELECT * FROM cases WHERE ${pub} ORDER BY opens DESC, sort DESC LIMIT 10`).map(caseCard),
    fresh: all(`SELECT * FROM cases WHERE ${pub} ORDER BY created_at DESC, id DESC LIMIT 10`).map(caseCard),
    cheap: all(`SELECT * FROM cases WHERE ${pub} ORDER BY price ASC LIMIT 5`).map(caseCard),
    rare: all(`SELECT * FROM items i WHERE archived=0 AND ${RARE_KNIFE} ORDER BY COALESCE(base_price,0) DESC LIMIT 6`).concat(all("SELECT * FROM items WHERE archived=0 ORDER BY COALESCE(base_price,0) DESC LIMIT 12"))
      .filter((x: any, i: number, a: any[]) => a.findIndex((y) => y.id === x.id) === i).slice(0, 12).map(itemView),
    feed: feed(16), big: feed(8, 1), top,
    quests: all("SELECT * FROM quests WHERE active=1 AND scope='daily' ORDER BY sort LIMIT 4").map((qst) => ({ ...qst, progress: c.user ? one('SELECT progress FROM quest_progress WHERE user_id=? AND quest_id=? AND period=?', c.user.id, qst.id, day)?.progress || 0 : 0 })),
    daily: getSetting('daily'),
    news: all('SELECT id, title, kind, image, created_at, substr(body,1,180) excerpt FROM news WHERE published=1 ORDER BY id DESC LIMIT 4'),
    events: all("SELECT id, kind, title, description, reward, ends_at FROM events WHERE status='active' AND (ends_at IS NULL OR ends_at > ?) ORDER BY id DESC LIMIT 3", now()),
    games: Object.entries(getSetting('games')).map(([k, g]: any) => ({ key: k, enabled: g.enabled && feature('games') })),
    stats: { users: one('SELECT COUNT(*) n FROM users').n, opens: one("SELECT COUNT(*) n FROM bets WHERE game='case'").n, cases: one(`SELECT COUNT(*) n FROM cases WHERE ${pub}`).n,
      items: one('SELECT COUNT(*) n FROM items WHERE archived=0').n, online: onlineCount() },
  };
});
