// Кейсы: вероятности, ожидаемая стоимость, цена и серверное открытие.
import { one, all, run, tx, now } from './db.ts';
import { HttpError, broadcast } from './http.ts';
import { WEARS, hasWear, priceOf, imageUrl, addInventory, roll, change, track, getSetting, publicUser, itemView } from './core.ts';
import { dropFx, shareToken } from './dropfx.ts';

export const ST_CHANCE = 0.1;

/** Вероятности качества при равномерном float в диапазоне предмета. */
export function wearOdds(it: any): Array<{ wear: string; p: number }> {
  if (!hasWear(it)) return [{ wear: '', p: 1 }];
  const span = it.max_float - it.min_float;
  return WEARS.map((w) => ({ wear: w[0], p: Math.max(0, Math.min(it.max_float, w[3]) - Math.max(it.min_float, w[2])) / span })).filter((x) => x.p > 0);
}
export function variantKind(c: any, it: any): string {
  const cats: string[] = JSON.parse(c?.categories || '[]');
  if (cats.includes('souvenir') && it.souvenir) return 'sv';
  return '';
}
export function itemEV(it: any, c: any = null): number {
  const odds = wearOdds(it);
  const v = variantKind(c, it);
  const base = odds.reduce((s, o) => s + o.p * priceOf(it.id, o.wear, v), 0);
  if (v === '' && it.stattrak) {
    const st = odds.reduce((s, o) => s + o.p * priceOf(it.id, o.wear, 'st'), 0);
    return base * (1 - ST_CHANCE) + st * ST_CHANCE;
  }
  return base;
}
export function caseRows(caseId: number) {
  return all('SELECT ci.weight, i.* FROM case_items ci JOIN items i ON i.id = ci.item_id WHERE ci.case_id=? ORDER BY i.id', caseId);
}
/** Пересчитывает ожидаемую стоимость и (в авто-режиме) цену кейса. */
export function recalcCase(caseId: number) {
  const c = one('SELECT * FROM cases WHERE id=?', caseId);
  if (!c) return;
  const rows = caseRows(caseId);
  const W = rows.reduce((s, r) => s + r.weight, 0);
  const ev = W > 0 ? Math.round(rows.reduce((s, r) => s + (r.weight / W) * itemEV(r, c), 0)) : 0;
  const margin = getSetting('economy').case_margin;
  const price = c.price_mode === 'auto' ? Math.max(100, Math.round(ev * (1 + margin))) : c.price;
  run('UPDATE cases SET ev=?, price=?, updated_at=? WHERE id=?', ev, price, now(), caseId);
}
export function recalcAllCases() {
  for (const c of all("SELECT id FROM cases WHERE status<>'archived'")) recalcCase(c.id);
}

/** Обложка кейса: загруженное изображение (mode=image) или композиция из реальных предметов кейса (mode=auto). */
export function caseCover(c: any) {
  const legacy = !c.image || /^\/img\/cases\//.test(c.image);
  const mode = c.cover_mode === 'image' && !legacy ? 'image' : 'auto';
  let ids: number[] = [];
  try { const v = JSON.parse(c.cover_items || '[]'); if (Array.isArray(v)) ids = v.map(Number).filter((x) => x > 0).slice(0, 3); } catch { ids = []; }
  let rows: any[] = ids.map((id) => one('SELECT i.id, i.name, i.image, i.rarity_color FROM case_items ci JOIN items i ON i.id=ci.item_id WHERE ci.case_id=? AND i.id=?', c.id, id)).filter(Boolean);
  if (!rows.length) rows = all('SELECT i.id, i.name, i.image, i.rarity_color FROM case_items ci JOIN items i ON i.id=ci.item_id WHERE ci.case_id=? ORDER BY COALESCE(i.base_price,0) DESC LIMIT 3', c.id);
  const items = rows.map((r) => ({ id: r.id, name: r.name, image: imageUrl(r.image), color: r.rarity_color, real: !!r.image }));
  return { mode, image: mode === 'image' ? imageUrl(c.image) : null, items, custom: ids.length > 0, missing: mode === 'auto' && !items.some((i) => i.real) };
}
export function caseCard(c: any) {
  const cover = caseCover(c);
  const top = cover.items[0];
  return { id: c.id, slug: c.slug, name: c.name, image: cover.mode === 'image' ? cover.image : top ? top.image : '/img/brand/case.svg', cover, accent: top?.color || '#FFB627',
    price: c.price, ev: c.ev, categories: JSON.parse(c.categories || '[]'), opens: c.opens, status: c.status, createdAt: c.created_at,
    items: one('SELECT COUNT(*) n FROM case_items WHERE case_id=?', c.id).n };
}
export function caseDetail(c: any) {
  const rows = caseRows(c.id);
  const W = rows.reduce((s, r) => s + r.weight, 0);
  const items = rows.map((r) => ({ ...itemView(r), chance: W ? r.weight / W : 0, value: Math.round(itemEV(r, c)),
    wears: wearOdds(r).map((o) => ({ ...o, price: priceOf(r.id, o.wear, variantKind(c, r)) })) }))
    .sort((a, b) => b.value - a.value);
  const byRarity: Record<string, { name: string; color: string; chance: number; count: number }> = {};
  for (const it of items) {
    const k = it.rarityName || '—';
    byRarity[k] = byRarity[k] || { name: k, color: it.color, chance: 0, count: 0 };
    byRarity[k].chance += it.chance;
    byRarity[k].count++;
  }
  return { ...caseCard(c), description: c.description, priceMode: c.price_mode, rtp: c.price ? c.ev / c.price : 0, items,
    rarities: Object.values(byRarity).sort((a, b) => a.chance - b.chance), stattrakChance: ST_CHANCE };
}

/** Выбор по весам: тикет = r × сумма весов, порядок — по id предмета (воспроизводимо при проверке). */
export function pickWeighted(rows: any[], r: number) {
  const W = rows.reduce((s, x) => s + x.weight, 0);
  const ticket = r * W;
  let acc = 0;
  for (const x of rows) {
    if (ticket < acc + x.weight) return { row: x, ticket, lo: acc, hi: acc + x.weight, total: W };
    acc += x.weight;
  }
  const last = rows[rows.length - 1];
  return { row: last, ticket, lo: acc - last.weight, hi: acc, total: W };
}
/** Выдаёт предмет из кейса по трём числам [выбор, float, StatTrak]. */
export function dropFrom(c: any, rows: any[], f: number[]) {
  const p = pickWeighted(rows, f[0]);
  const it = p.row;
  let variant = variantKind(c, it);
  if (variant === '' && it.stattrak && f[2] < ST_CHANCE) variant = 'st';
  return { item: it, float: hasWear(it) ? f[1] : null, variant, pick: p };
}

export function openCase(userId: number, c: any, count: number, opts: { free?: boolean; source?: string } = {}) {
  const rows = caseRows(c.id);
  if (!rows.length) throw new HttpError(400, 'В кейсе нет предметов');
  return tx(() => {
    const total = opts.free ? 0 : c.price * count;
    if (total > 0) change(userId, -total, 'case', { ref: 'case', refId: c.id, reason: `Открытие: ${c.name} ×${count}` });
    const drops: any[] = [];
    for (let k = 0; k < count; k++) {
      const r = roll(userId, 3);
      const d = dropFrom(c, rows, r.floats);
      const inv = addInventory(userId, d.item.id, d.float, d.variant, opts.source || 'case', c.id);
      // Предмет уже выбран и записан в инвентарь. Уровень кинодропа — только классификация результата, на выбор не влияет.
      const fx = dropFx(inv, c.price);
      const price = opts.free ? 0 : c.price;
      const betId = run('INSERT INTO bets(user_id,game,amount,payout,multiplier,status,data,seed_id,nonce,server_hash,created_at,settled_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        userId, 'case', price, inv.price, price ? inv.price / price : null, 'settled',
        JSON.stringify({ caseId: c.id, caseName: c.name, invId: inv.id, itemId: d.item.id, free: !!opts.free, ticket: d.pick.ticket, range: [d.pick.lo, d.pick.hi], total: d.pick.total, fx }),
        r.seedId, r.nonce, r.hash, now(), now()).lastInsertRowid;
      run('UPDATE inventory SET source_id=? WHERE id=?', String(betId), inv.id);
      drops.push({ inv, betId, nonce: r.nonce, serverHash: r.hash, clientSeed: r.clientSeed, fx, share: shareToken(Number(betId)) });
    }
    run('UPDATE cases SET opens = opens + ? WHERE id=?', count, c.id);
    track(userId, 'case_open', count);
    if (total > 0) track(userId, 'wager', Math.floor(total / 100));
    const u = publicUser(one('SELECT * FROM users WHERE id=?', userId));
    for (const d of drops) broadcast('drop', { user: u, item: d.inv, case: { slug: c.slug, name: c.name }, at: now() });
    return { drops, balance: one('SELECT balance FROM users WHERE id=?', userId).balance };
  });
}
