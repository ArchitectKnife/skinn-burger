// Ядро бизнес-логики: настройки, аудит, баланс (леджер), уведомления, Provably Fair, предметы и прогресс.
import crypto from 'node:crypto';
import { one, all, run, tx, now } from './db.ts';
import { HttpError, bad, broadcast, sha256 } from './http.ts';

// ---------- Настройки ----------
// ---------- Валюта ----------
// Все суммы хранятся в копейках (целые числа). Валюта сайта — российский рубль, единый формат: 1 250,00 ₽.
export const CURRENCY = { code: 'RUB', sign: '₽' } as const;
const rubFmt = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const rub = (c: number) => rubFmt.format((Number(c) || 0) / 100) + ' ₽';

export const DEFAULTS: Record<string, any> = {
  site: { name: 'BURGER SKIN', tagline: 'Сочные кейсы CS2', logo: '' },
  banner: { title: 'Открывай сочные кейсы CS2', subtitle: 'Честные шансы Provably Fair, битвы кейсов, апгрейды и BURGER PASS на 100 уровней.', image: '' },
  features: { registration: true, steam: true, games: true, battles: true, upgrade: true, contracts: true, pass: true, deposit: false, withdraw: false },
  maintenance: { enabled: false, message: 'На сайте идут технические работы. Скоро вернёмся!' },
  economy: { sell_rate: 1, case_margin: 0.12, upgrade_rtp: 0.95, upgrade_max_chance: 0.75, contract_min: 3, contract_max: 10, welcome_bonus: 0 },
  daily: { base: 1000, step: 500, max_streak: 7 },
  referral: { invitee_bonus: 2000, inviter_bonus: 5000, threshold_bc: 100 },
  games: {
    crash: { enabled: true, min: 100, max: 5000000 }, double: { enabled: true, min: 100, max: 5000000 },
    jackpot: { enabled: true, min: 100, max: 5000000 }, coinflip: { enabled: true, min: 100, max: 5000000 },
    roulette: { enabled: true, min: 100, max: 5000000 }, mines: { enabled: true, min: 100, max: 5000000 },
    towers: { enabled: true, min: 100, max: 5000000 }, battles: { enabled: true, min: 0, max: 100000000 },
  },
  notifications: { email_enabled: false, support_email: true, finance_email: true },
  finance: { provider: '', deposit_note: 'Платёжный провайдер не подключён.', withdraw_note: 'Вывод предметов в Steam не подключён.' },
  fair: { public_salt: '' },
  sound: { enabled_default: true, master: 0.7, effects: 0.8, upgrade: 0.8, cinema: 0.9, case_sounds: true, upgrade_sounds: true, cinema_sounds: true },
  // Кинематографичные дропы: пороги в копейках (GODLIKE < MYTHIC < DIVINE), min_x — дроп не дешевле N× цены кейса (0 — без условия).
  drop_fx: { enabled: true, godlike: 500000, mythic: 2500000, divine: 10000000, min_x: 1, knife_scene: true, glove_scene: true, share: true, default_mode: 'full' },
  upgrade: { presets: [2, 3, 5, 10], min_mult: 1.1, max_mult: 20, rtp: 0.95, max_chance: 0.75, min_chance: 0.01, curve: 1, max_items: 6, tolerance: 0.2 },
  role_permissions: null,
};
const settingsCache = new Map<string, any>();
export function getSetting(key: string): any {
  if (settingsCache.has(key)) return settingsCache.get(key);
  const row = one('SELECT value FROM settings WHERE key=?', key);
  const def = DEFAULTS[key];
  let val = row ? JSON.parse(row.value) : def;
  if (row && def && typeof def === 'object' && !Array.isArray(def) && val && typeof val === 'object') val = deepMerge(def, val);
  settingsCache.set(key, val);
  return val;
}
function deepMerge(a: any, b: any): any {
  const out: any = { ...a };
  for (const k of Object.keys(b)) out[k] = a[k] && typeof a[k] === 'object' && !Array.isArray(a[k]) && b[k] && typeof b[k] === 'object' ? deepMerge(a[k], b[k]) : b[k];
  return out;
}
export function setSetting(key: string, value: any) {
  run('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at', key, JSON.stringify(value), now());
  settingsCache.delete(key);
}
export const feature = (name: string) => !!getSetting('features')[name];
export function requireFeature(name: string, label: string) {
  if (!feature(name)) throw new HttpError(403, `Раздел «${label}» сейчас отключён администрацией.`, 'feature_disabled');
}

// ---------- Неизменяемый журнал аудита (цепочка хешей + триггеры запрета изменения) ----------
export function audit(actorId: number | null, action: string, targetType: string | null, targetId: any, data: any = null, ip: string | null = null) {
  const prev = one('SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1');
  const t = now();
  const payload = JSON.stringify({ actorId, action, targetType, targetId: targetId == null ? null : String(targetId), data, ip, t });
  const hash = sha256((prev ? prev.hash : '') + payload);
  run('INSERT INTO audit_log(actor_id,action,target_type,target_id,data,ip,created_at,prev_hash,hash) VALUES(?,?,?,?,?,?,?,?,?)',
    actorId, action, targetType, targetId == null ? null : String(targetId), data ? JSON.stringify(data) : null, ip, t, prev ? prev.hash : null, hash);
}
export function verifyAudit(): { ok: boolean; checked: number; brokenAt?: number } {
  let prev = '';
  const rows = all('SELECT * FROM audit_log ORDER BY id');
  for (const r of rows) {
    const payload = JSON.stringify({ actorId: r.actor_id, action: r.action, targetType: r.target_type, targetId: r.target_id, data: r.data ? JSON.parse(r.data) : null, ip: r.ip, t: r.created_at });
    if (sha256(prev + payload) !== r.hash || (r.prev_hash || '') !== prev) return { ok: false, checked: rows.length, brokenAt: r.id };
    prev = r.hash;
  }
  return { ok: true, checked: rows.length };
}

// ---------- Баланс: атомарные операции через неизменяемый леджер ----------
// Суммы хранятся в копейках (целые числа), чтобы исключить ошибки округления.
export function change(userId: number, amount: number, type: string, o: { ref?: string; refId?: any; reason?: string; actor?: number | null } = {}): number {
  if (!Number.isInteger(amount)) throw new Error('amount must be integer');
  return tx(() => {
    const r = run('UPDATE users SET balance = balance + ? WHERE id = ? AND balance + ? >= 0', amount, userId, amount);
    if (r.changes !== 1) throw new HttpError(400, 'Недостаточно средств на балансе', 'insufficient_funds');
    const bal = one('SELECT balance FROM users WHERE id=?', userId).balance;
    run('INSERT INTO ledger(user_id,amount,balance_after,type,ref_type,ref_id,reason,actor_id,created_at) VALUES(?,?,?,?,?,?,?,?,?)',
      userId, amount, bal, type, o.ref ?? null, o.refId == null ? null : String(o.refId), o.reason ?? null, o.actor ?? null, now());
    broadcast('balance', { balance: bal }, userId);
    return bal;
  });
}

// ---------- Уведомления ----------
export function notify(userId: number, type: string, title: string, body = '', link = '') {
  const r = run('INSERT INTO notifications(user_id,type,title,body,link,created_at) VALUES(?,?,?,?,?,?)', userId, type, title, body, link, now());
  broadcast('notify', { id: r.lastInsertRowid, type, title, body, link }, userId);
}

// ---------- Provably Fair ----------
// Результат = HMAC_SHA256(server_seed, `${client_seed}:${nonce}:${cursor}`), каждые 4 байта → число [0, 1).
export function floatsFrom(serverSeed: string, clientSeed: string, nonce: number | string, count: number): number[] {
  const out: number[] = [];
  let cursor = 0;
  while (out.length < count) {
    const h = crypto.createHmac('sha256', serverSeed).update(`${clientSeed}:${nonce}:${cursor++}`).digest();
    for (let i = 0; i < 32 && out.length < count; i += 4) out.push(h[i] / 256 + h[i + 1] / 65536 + h[i + 2] / 16777216 + h[i + 3] / 4294967296);
  }
  return out;
}
export const newSeed = () => crypto.randomBytes(32).toString('hex');
export function activeSeed(userId: number) {
  let s = one('SELECT * FROM fair_seeds WHERE user_id=? AND active=1', userId);
  if (!s) {
    const seed = newSeed();
    const id = run('INSERT INTO fair_seeds(user_id,server_seed,server_hash,client_seed,nonce,active,created_at) VALUES(?,?,?,?,0,1,?)',
      userId, seed, sha256(seed), crypto.randomBytes(8).toString('hex'), now()).lastInsertRowid;
    s = one('SELECT * FROM fair_seeds WHERE id=?', id);
  }
  return s;
}
export function roll(userId: number, count: number) {
  const s = activeSeed(userId);
  const nonce = s.nonce + 1;
  run('UPDATE fair_seeds SET nonce=? WHERE id=?', nonce, s.id);
  return { floats: floatsFrom(s.server_seed, s.client_seed, nonce, count), seedId: s.id, nonce, hash: s.server_hash, clientSeed: s.client_seed };
}
export function rotateSeed(userId: number, clientSeed?: string | null) {
  return tx(() => {
    const cur = activeSeed(userId);
    run('UPDATE fair_seeds SET active=0, revealed_at=? WHERE id=?', now(), cur.id);
    const seed = newSeed();
    run('INSERT INTO fair_seeds(user_id,server_seed,server_hash,client_seed,nonce,active,created_at) VALUES(?,?,?,?,0,1,?)',
      userId, seed, sha256(seed), clientSeed || crypto.randomBytes(8).toString('hex'), now());
    return { revealed: { serverSeed: cur.server_seed, serverHash: cur.server_hash, clientSeed: cur.client_seed, nonce: cur.nonce } };
  });
}
export function publicSalt(): string {
  const f = getSetting('fair');
  if (!f.public_salt) { const salt = crypto.randomBytes(16).toString('hex'); setSetting('fair', { ...f, public_salt: salt }); return salt; }
  return f.public_salt;
}

// ---------- Предметы, качество, цены ----------
export const WEARS: [string, string, number, number, number][] = [
  ['FN', 'Factory New', 0, 0.07, 1.5], ['MW', 'Minimal Wear', 0.07, 0.15, 1.15], ['FT', 'Field-Tested', 0.15, 0.38, 1],
  ['WW', 'Well-Worn', 0.38, 0.45, 0.9], ['BS', 'Battle-Scarred', 0.45, 1.01, 0.8],
];
export const hasWear = (it: any) => !(it.category === 'Gloves' ? false : !it.pattern || it.pattern === 'Vanilla') && it.max_float > it.min_float;
export function wearOf(f: number) { return (WEARS.find((w) => f >= w[2] && f < w[3]) || WEARS[4])[0]; }
export function wearsAvailable(it: any): string[] {
  if (!hasWear(it)) return [''];
  return WEARS.filter((w) => w[3] > it.min_float && w[2] < it.max_float).map((w) => w[0]);
}
const VARIANT_K: Record<string, number> = { '': 1, st: 1.6, sv: 1.3 };
/** Текущая оценка предмета: цена из источника → другое качество того же предмета → базовая оценка. */
export function priceOf(itemId: number, wear: string, variant = ''): number {
  const exact = one('SELECT price FROM item_prices WHERE item_id=? AND wear=? AND variant=?', itemId, wear || '', variant);
  if (exact) return exact.price;
  const it = one('SELECT base_price, category, pattern, min_float, max_float FROM items WHERE id=?', itemId);
  if (!it) return 0;
  const wk = (WEARS.find((w) => w[0] === wear) || [0, 0, 0, 0, 1])[4] as number;
  const anyPrice = one('SELECT price, wear FROM item_prices WHERE item_id=? AND variant=? ORDER BY price LIMIT 1', itemId, variant);
  if (anyPrice) return Math.max(1, Math.round(anyPrice.price * wk / ((WEARS.find((w) => w[0] === anyPrice.wear) || [0, 0, 0, 0, 1])[4] as number)));
  return Math.max(1, Math.round((it.base_price || 0) * wk * (VARIANT_K[variant] || 1)));
}
export function itemView(it: any) {
  return { id: it.id, name: it.name, weapon: it.weapon, category: it.category, pattern: it.pattern, rarity: it.rarity, rarityName: it.rarity_name,
    color: it.rarity_color, image: imageUrl(it.image), stattrak: !!it.stattrak, souvenir: !!it.souvenir, minFloat: it.min_float, maxFloat: it.max_float,
    price: it.base_price, priceSource: it.price_source, collection: it.collection, extId: it.ext_id };
}
/** Внешние картинки отдаём через собственный кеширующий прокси (список разрешённых доменов). */
export function imageUrl(src: string | null): string {
  if (!src) return '/img/brand/item.svg';
  if (src.startsWith('/')) return src;
  return '/img/ext/' + Buffer.from(src).toString('base64url');
}
export function invView(r: any) {
  return { id: r.id, itemId: r.item_id, name: r.name, weapon: r.weapon, rarity: r.rarity, rarityName: r.rarity_name, color: r.rarity_color,
    image: imageUrl(r.image), category: r.category, wear: r.wear, float: r.float, variant: r.variant, stattrak: r.variant === 'st', souvenir: r.variant === 'sv',
    status: r.status, source: r.source, dropPrice: r.price, price: priceOf(r.item_id, r.wear || '', r.variant), createdAt: r.created_at };
}
export const INV_SELECT = 'SELECT inv.*, i.name, i.weapon, i.rarity, i.rarity_name, i.rarity_color, i.image, i.category FROM inventory inv JOIN items i ON i.id = inv.item_id';

export function addInventory(userId: number, itemId: number, fl: number | null, variant: string, source: string, sourceId: any) {
  const it = one('SELECT * FROM items WHERE id=?', itemId);
  if (!it) throw bad('Предмет не найден');
  const f = fl == null ? null : Math.round((it.min_float + fl * (it.max_float - it.min_float)) * 1e9) / 1e9;
  const wear = hasWear(it) && f != null ? wearOf(f) : '';
  const price = priceOf(itemId, wear, variant);
  const id = run('INSERT INTO inventory(user_id,item_id,wear,float,variant,price,status,source,source_id,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
    userId, itemId, wear, f, variant, price, 'owned', source, sourceId == null ? null : String(sourceId), now(), now()).lastInsertRowid;
  run('INSERT INTO user_stats(user_id,metric,value) VALUES(?,?,?) ON CONFLICT(user_id,metric) DO UPDATE SET value=MAX(value, excluded.value)', userId, 'best_drop', price);
  return invView(one(INV_SELECT + ' WHERE inv.id=?', id));
}
/** Списывает предметы из инвентаря. Атомарно: или все предметы принадлежат пользователю и доступны, или ошибка. */
export function consumeInventory(userId: number, ids: number[], status: string) {
  return tx(() => {
    const rows = ids.map((id) => one(INV_SELECT + ' WHERE inv.id=? AND inv.user_id=? AND inv.status=?', id, userId, 'owned'));
    if (rows.some((r) => !r)) throw new HttpError(409, 'Один из предметов уже недоступен (продан, использован или не принадлежит вам)', 'item_unavailable');
    for (const r of rows) {
      const u = run('UPDATE inventory SET status=?, updated_at=? WHERE id=? AND user_id=? AND status=?', status, now(), r.id, userId, 'owned');
      if (u.changes !== 1) throw new HttpError(409, 'Предмет уже обработан', 'item_unavailable');
    }
    return rows.map(invView);
  });
}

// ---------- Прогресс: статистика, задания, достижения, опыт BURGER PASS, рефералы ----------
export function periodKey(scope: string, t = now()) {
  const d = new Date(t + 3 * 3600_000); // московское время
  if (scope === 'daily') return 'D' + d.toISOString().slice(0, 10);
  const day = (d.getUTCDay() + 6) % 7;
  const monday = new Date(d.getTime() - day * 86400_000);
  return 'W' + monday.toISOString().slice(0, 10);
}
export function activeSeason() {
  return one("SELECT * FROM pass_seasons WHERE status='active' AND (ends_at IS NULL OR ends_at > ?) ORDER BY id DESC LIMIT 1", now());
}
export function addXp(userId: number, xp: number) {
  if (xp <= 0) return;
  const s = activeSeason();
  if (!s) return;
  const before = one('SELECT xp FROM pass_progress WHERE user_id=? AND season_id=?', userId, s.id)?.xp || 0;
  run('INSERT INTO pass_progress(user_id,season_id,xp) VALUES(?,?,?) ON CONFLICT(user_id,season_id) DO UPDATE SET xp = xp + excluded.xp', userId, s.id, xp);
  const lvBefore = Math.min(100, Math.floor(before / s.xp_per_level));
  const lvAfter = Math.min(100, Math.floor((before + xp) / s.xp_per_level));
  if (lvAfter > lvBefore) {
    notify(userId, 'pass', `BURGER PASS: уровень ${lvAfter}!`, 'Заберите награды за новые уровни.', '/pass');
    bumpStat(userId, 'pass_level', lvAfter, true);
  }
}
function bumpStat(userId: number, metric: string, value: number, isMax = false) {
  if (isMax) run('INSERT INTO user_stats(user_id,metric,value) VALUES(?,?,?) ON CONFLICT(user_id,metric) DO UPDATE SET value=MAX(value, excluded.value)', userId, metric, value);
  else run('INSERT INTO user_stats(user_id,metric,value) VALUES(?,?,?) ON CONFLICT(user_id,metric) DO UPDATE SET value=value + excluded.value', userId, metric, value);
  const total = one('SELECT value FROM user_stats WHERE user_id=? AND metric=?', userId, metric).value;
  for (const a of all('SELECT * FROM achievements WHERE metric=? AND active=1 AND goal <= ?', metric, total)) {
    const ins = run('INSERT OR IGNORE INTO user_achievements(user_id,code,created_at) VALUES(?,?,?)', userId, a.code, now());
    if (ins.changes === 1) {
      if (a.reward > 0) change(userId, a.reward, 'achievement', { ref: 'achievement', refId: a.code, reason: a.title });
      notify(userId, 'achievement', `Достижение: ${a.title}`, a.reward > 0 ? `Награда: ${rub(a.reward)}` : '', '/achievements');
    }
  }
}
/** Единая точка учёта активности. metric: case_open, wager (в рублях), game, upgrade, upgrade_win, contract, battle, battle_win, daily, sell, friends */
export function track(userId: number, metric: string, inc = 1) {
  if (inc <= 0) return;
  bumpStat(userId, metric, inc);
  for (const qst of all('SELECT * FROM quests WHERE metric=? AND active=1', metric)) {
    const period = periodKey(qst.scope);
    run('INSERT INTO quest_progress(user_id,quest_id,period,progress) VALUES(?,?,?,?) ON CONFLICT(user_id,quest_id,period) DO UPDATE SET progress = MIN(progress + excluded.progress, ?)',
      userId, qst.id, period, Math.min(inc, qst.goal), qst.goal);
  }
  if (metric === 'wager') {
    addXp(userId, inc);
    const u = one('SELECT referred_by, ref_rewarded FROM users WHERE id=?', userId);
    const ref = getSetting('referral');
    if (u?.referred_by && !u.ref_rewarded) {
      const w = one('SELECT value FROM user_stats WHERE user_id=? AND metric=?', userId, 'wager')?.value || 0;
      if (w >= ref.threshold_bc && run('UPDATE users SET ref_rewarded=1 WHERE id=? AND ref_rewarded=0', userId).changes === 1 && ref.inviter_bonus > 0) {
        change(u.referred_by, ref.inviter_bonus, 'referral', { ref: 'user', refId: userId, reason: 'Бонус за приглашённого друга' });
        notify(u.referred_by, 'referral', 'Бонус за друга', `Приглашённый игрок активен — начислено ${rub(ref.inviter_bonus)}`, '/bonuses');
      }
    }
  }
}
/** Списание ставки: баланс + учёт оборота. */
export function wager(userId: number, amount: number, game: string, refId: any) {
  const bal = change(userId, -amount, 'bet', { ref: game, refId, reason: game });
  track(userId, 'wager', Math.floor(amount / 100));
  return bal;
}

export function checkRestriction(user: any, key: string) {
  const r = JSON.parse(user.restrictions || '{}');
  if (r[key]) throw new HttpError(403, 'Для вашего аккаунта эта функция ограничена. Обратитесь в поддержку.', 'restricted');
}
export function gameLimits(game: string, amount: number) {
  const g = getSetting('games')[game];
  if (!g || !g.enabled) throw new HttpError(403, 'Эта игра сейчас отключена администрацией.', 'game_disabled');
  if (amount < g.min || amount > g.max) throw bad(`Ставка должна быть от ${rub(g.min)} до ${rub(g.max)}`);
}
export function publicUser(u: any) {
  if (!u) return null;
  return { id: u.id, nickname: u.nickname, avatar: u.avatar ? imageUrl(u.avatar) : null, role: u.role, createdAt: u.created_at };
}
export function logError(e: any, path = '', userId: number | null = null) {
  try { run('INSERT INTO error_log(level,message,stack,path,user_id,created_at) VALUES(?,?,?,?,?,?)', 'error', String(e?.message || e).slice(0, 1000), String(e?.stack || '').slice(0, 4000), path, userId, now()); } catch { /* ignore */ }
}
