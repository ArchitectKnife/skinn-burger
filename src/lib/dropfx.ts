// BURGER SKIN — кинематографичные дропы: уровни редкости по стоимости и ссылки «Поделиться дропом».
//
// Честность: уровень (GODLIKE / MYTHIC / DIVINE) и сцена вычисляются ТОЛЬКО по уже выданному предмету
// и его цене на момент выпадения. Классификация вызывается после выбора предмета в openCase() и
// никак не участвует в выборе: шансы, Provably Fair и выданный предмет остаются прежними.
// Клиент лишь проигрывает анимацию для результата, который сервер уже записал в инвентарь.
import crypto from 'node:crypto';
import { one, all } from './db.ts';
import { getSetting, setSetting, invView, INV_SELECT, publicUser, imageUrl } from './core.ts';

export const FX_TIERS = ['godlike', 'mythic', 'divine'] as const;
export type FxTier = (typeof FX_TIERS)[number];
export type FxScene = FxTier | 'knife' | 'glove';
export const FX_LABEL: Record<FxTier, string> = { godlike: 'GODLIKE', mythic: 'MYTHIC', divine: 'DIVINE' };
const RANK: Record<FxTier, number> = { godlike: 2, mythic: 3, divine: 4 };

export type DropFx = { tier: FxTier | null; scene: FxScene; rank: number; label: string; kind: 'knife' | 'glove' | null };

const nameOf = (it: any) => String(it?.name || '');
export const isGlove = (it: any) => it?.category === 'Gloves' || (nameOf(it).startsWith('\u2605') && /gloves|hand wraps/i.test(nameOf(it)));
export const isKnife = (it: any) => !isGlove(it) && (it?.category === 'Knives' || nameOf(it).startsWith('\u2605'));

/** Уровень по стоимости. casePrice нужен только для условия «дроп не дешевле N× цены кейса». */
export function tierFor(price: number, casePrice = 0, s: any = getSetting('drop_fx')): FxTier | null {
  const p = Number(price) || 0;
  if (p <= 0) return null;
  if (s.min_x > 0 && casePrice > 0 && p < casePrice * s.min_x) return null;
  if (p >= s.divine) return 'divine';
  if (p >= s.mythic) return 'mythic';
  if (p >= s.godlike) return 'godlike';
  return null;
}

/** Сцена для выданного предмета или null, если дроп обычный. */
export function dropFx(item: any, casePrice = 0): DropFx | null {
  const s = getSetting('drop_fx');
  if (!s.enabled || !item) return null;
  const tier = tierFor(item.price, casePrice, s);
  const kind = isGlove(item) ? 'glove' : isKnife(item) ? 'knife' : null;
  const special = kind && s[kind + '_scene'] ? kind : null;
  const scene: FxScene | null = special || tier;
  if (!scene) return null;
  const label = tier ? FX_LABEL[tier] + ' DROP' : kind === 'glove' ? 'GLOVE DROP' : 'KNIFE DROP';
  return { tier, scene, rank: (tier ? RANK[tier] : 1) + (special ? 0.5 : 0), label, kind };
}

// ---------- Ссылки «Поделиться дропом» ----------
// Токен = id ставки + HMAC, чтобы по ссылке нельзя было перебрать чужие дропы подряд.
function secret(): string {
  let s = getSetting('share_secret');
  if (typeof s !== 'string' || s.length < 32) { s = crypto.randomBytes(32).toString('hex'); setSetting('share_secret', s); }
  return s;
}
const sig = (id: number) => crypto.createHmac('sha256', secret()).update('drop:' + id).digest('hex').slice(0, 12);
export const shareToken = (betId: number) => `${betId}-${sig(betId)}`;
export const SHARE_RE = /^(\d{1,12})-([a-f0-9]{12})$/;
export function parseShare(token: string): number | null {
  const m = SHARE_RE.exec(String(token || ''));
  if (!m) return null;
  const id = Number(m[1]);
  const a = Buffer.from(sig(id)); const b = Buffer.from(m[2]);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? id : null;
}

/** Публичная карточка дропа (без приватных данных: только ник, аватар, предмет и хеш Provably Fair). */
export function sharedDrop(betId: number | null) {
  if (!betId) return null;
  const b = one('SELECT b.*, u.nickname, u.avatar, u.role, u.created_at uc FROM bets b JOIN users u ON u.id=b.user_id WHERE b.id=?', betId);
  if (!b || b.game !== 'case') return null;
  let d: any = {};
  try { d = JSON.parse(b.data || '{}'); } catch { d = {}; }
  const row = d.invId ? one(INV_SELECT + ' WHERE inv.id=?', d.invId) : null;
  if (!row) return null;
  const v = invView(row);
  const item = { itemId: v.itemId, name: v.name, weapon: v.weapon, rarityName: v.rarityName, color: v.color, image: v.image, category: v.category,
    wear: v.wear, float: v.float, variant: v.variant, stattrak: v.stattrak, souvenir: v.souvenir, price: b.payout, priceNow: v.price };
  const cs = d.caseId ? one('SELECT slug, name, price, status FROM cases WHERE id=?', d.caseId) : null;
  // Уровень, показанный игроку в момент дропа, сохраняется в ставке; для старых ставок — по текущим порогам.
  const fx = d.fx !== undefined ? d.fx : dropFx(item, cs?.price || b.amount);
  return {
    token: shareToken(b.id), at: b.created_at, item, fx: fx || null, free: !!d.free,
    user: publicUser({ id: b.user_id, nickname: b.nickname, avatar: b.avatar, role: b.role, created_at: b.uc }),
    case: cs && cs.status === 'published' ? { slug: cs.slug, name: cs.name, price: cs.price } : { slug: null, name: d.caseName || 'Кейс', price: b.amount },
    fair: { serverHash: b.server_hash, nonce: b.nonce },
  };
}

// ---------- Админка: статистика порогов ----------
const bandSql = 'SELECT COUNT(*) n, COUNT(DISTINCT item_id) items FROM item_prices WHERE price >= ? AND price < ?';
export function dropFxStats(caseDetailFn: (c: any) => any) {
  const s = getSetting('drop_fx');
  const bands = [['below', 1, s.godlike], ['godlike', s.godlike, s.mythic], ['mythic', s.mythic, s.divine], ['divine', s.divine, 1e15]] as const;
  const catalog = Object.fromEntries(bands.map(([k, lo, hi]) => [k, one(bandSql, lo, hi)]));
  // Вероятность кинодропа по каждому опубликованному кейсу (по шансам и ценам качеств; StatTrak не учитывается).
  const cases = all("SELECT * FROM cases WHERE status='published' ORDER BY price").map((c: any) => {
    const det = caseDetailFn(c);
    const p: Record<string, number> = { godlike: 0, mythic: 0, divine: 0, special: 0 };
    for (const it of det.items || []) {
      const kind = isGlove(it) ? 'glove' : isKnife(it) ? 'knife' : null;
      for (const w of it.wears || []) {
        const pr = it.chance * (w.p ?? 1);
        const t = tierFor(w.price, c.price, s);
        if (t === 'divine') p.divine += pr;
        if (t === 'divine' || t === 'mythic') p.mythic += pr;
        if (t) p.godlike += pr;
        if ((kind && s[kind + '_scene']) || t) p.special += pr;
      }
    }
    return { slug: c.slug, name: c.name, price: c.price, ...p };
  });
  const sample = (lo: number, hi: number, extra = '') => {
    const r = one(`SELECT i.*, p.wear pw, p.variant pv, p.price pp FROM item_prices p JOIN items i ON i.id=p.item_id WHERE i.archived=0 AND p.price >= ? AND p.price < ? ${extra} ORDER BY p.price DESC LIMIT 1`, lo, hi);
    return r ? { itemId: r.id, name: r.name, weapon: r.weapon, rarityName: r.rarity_name, color: r.rarity_color, image: imageUrl(r.image), category: r.category,
      wear: r.pw, float: null, variant: r.pv, stattrak: r.pv === 'st', souvenir: r.pv === 'sv', price: r.pp } : null;
  };
  const noSpecial = "AND i.category NOT IN ('Knives','Gloves') AND i.name NOT LIKE '\u2605%'";
  const samples = {
    godlike: sample(s.godlike, s.mythic, noSpecial) || sample(s.godlike, s.mythic),
    mythic: sample(s.mythic, s.divine, noSpecial) || sample(s.mythic, s.divine),
    divine: sample(s.divine, 1e15, noSpecial) || sample(s.divine, 1e15),
    knife: sample(s.godlike, 1e15, "AND i.category='Knives'") || sample(1, 1e15, "AND i.category='Knives'"),
    glove: sample(s.godlike, 1e15, "AND i.category='Gloves'") || sample(1, 1e15, "AND i.category='Gloves'"),
  };
  return { settings: s, catalog, cases, samples };
}
