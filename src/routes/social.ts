// BURGER PASS, бонусы, задания, промокоды, достижения, коллекции, события/турниры, рейтинг, друзья,
// публичные профили, уведомления, новости, поддержка, финансы и загрузка файлов.
import fs from 'node:fs';
import path from 'node:path';
import { one, all, run, tx, now, DATA } from '../lib/db.ts';
import { route, v, bad, notFound, forbidden, HttpError, randomToken, broadcast, onlineCount } from '../lib/http.ts';
import { getSetting, requireFeature, change, notify, track, addXp, activeSeason, periodKey, addInventory, roll, publicUser, invView, INV_SELECT,
  imageUrl, itemView, feature, consumeInventory, audit, checkRestriction, rub } from '../lib/core.ts';
import { openCase } from '../lib/cases.ts';
import { can, isStaff } from '../lib/auth.ts';
import { paymentProviders } from '../lib/payments.ts';

const bc = (x: number) => rub(x);
const AUTH_IDEM = { auth: true, idem: true, rate: [20, 10_000] as [number, number] };

// ================= BURGER PASS =================
export function passLevel(s: any, xp: number) { return Math.min(100, Math.floor(xp / s.xp_per_level)); }
function rewardView(r: any) {
  const it = r.item_id ? one('SELECT * FROM items WHERE id=?', r.item_id) : null;
  const cs = r.case_id ? one('SELECT id, slug, name, image FROM cases WHERE id=?', r.case_id) : null;
  return { id: r.id, level: r.level, track: r.track, type: r.type, amount: r.amount, label: r.label, item: it ? itemView(it) : null,
    case: cs ? { ...cs, image: cs.image ? imageUrl(cs.image) : '/img/brand/case.svg' } : null };
}
function grantReward(userId: number, r: any) {
  if (r.type === 'balance') change(userId, r.amount, 'pass', { ref: 'pass_reward', refId: r.id, reason: `BURGER PASS: уровень ${r.level}` });
  else if (r.type === 'item') addInventory(userId, r.item_id, roll(userId, 1).floats[0], '', 'pass', r.id);
  else if (r.type === 'case') {
    const cs = one('SELECT * FROM cases WHERE id=?', r.case_id);
    if (!cs) throw bad('Кейс награды недоступен');
    return openCase(userId, cs, 1, { free: true, source: 'pass' });
  }
  return null;
}
route('GET', '/api/pass', (c) => {
  const s = activeSeason();
  if (!s) return { season: null };
  const prog = c.user ? one('SELECT * FROM pass_progress WHERE user_id=? AND season_id=?', c.user.id, s.id) : null;
  const xp = prog?.xp || 0;
  const claimed = new Set(c.user ? all('SELECT pc.reward_id FROM pass_claims pc JOIN pass_rewards r ON r.id=pc.reward_id WHERE pc.user_id=? AND r.season_id=?', c.user.id, s.id).map((x) => x.reward_id) : []);
  return { season: { id: s.id, name: s.name, xpPerLevel: s.xp_per_level, premiumPrice: s.premium_price, endsAt: s.ends_at, startsAt: s.starts_at },
    xp, level: passLevel(s, xp), premium: !!prog?.premium, enabled: feature('pass'),
    rewards: all('SELECT * FROM pass_rewards WHERE season_id=? ORDER BY level, track', s.id).map((r) => ({ ...rewardView(r), claimed: claimed.has(r.id) })),
    xpRules: '1 XP за каждый 1 ₽ оборота (кейсы, игры, битвы) + XP за задания' };
});
route('POST', '/api/pass/premium', (c) => {
  requireFeature('pass', 'BURGER PASS');
  const s = activeSeason();
  if (!s) throw bad('Сезон не активен');
  return tx(() => {
    run('INSERT OR IGNORE INTO pass_progress(user_id,season_id,xp,premium) VALUES(?,?,0,0)', c.user.id, s.id);
    if (run('UPDATE pass_progress SET premium=1 WHERE user_id=? AND season_id=? AND premium=0', c.user.id, s.id).changes !== 1) throw bad('Премиум уже активирован');
    const balance = change(c.user.id, -s.premium_price, 'pass_premium', { ref: 'season', refId: s.id, reason: `BURGER PASS Premium: ${s.name}` });
    notify(c.user.id, 'pass', 'BURGER PASS Premium активирован', 'Премиум-награды доступны для получения.', '/pass');
    return { ok: true, balance };
  });
}, AUTH_IDEM);
function claimReward(userId: number, rewardId: number) {
  const s = activeSeason();
  if (!s) throw bad('Сезон не активен');
  const r = one('SELECT * FROM pass_rewards WHERE id=? AND season_id=?', rewardId, s.id);
  if (!r) throw notFound('Награда не найдена');
  const prog = one('SELECT * FROM pass_progress WHERE user_id=? AND season_id=?', userId, s.id) || { xp: 0, premium: 0 };
  if (passLevel(s, prog.xp) < r.level) throw bad(`Нужен уровень ${r.level}`);
  if (r.track === 'premium' && !prog.premium) throw bad('Награда премиум-ветки — активируйте Premium');
  if (run('INSERT OR IGNORE INTO pass_claims(user_id,reward_id,created_at) VALUES(?,?,?)', userId, r.id, now()).changes !== 1) throw bad('Награда уже получена');
  return { reward: rewardView(r), result: grantReward(userId, r) };
}
route('POST', '/api/pass/claim', (c) => {
  requireFeature('pass', 'BURGER PASS');
  return tx(() => ({ ...claimReward(c.user.id, v.int(c.body.rewardId, 'Награда', 1)), balance: one('SELECT balance FROM users WHERE id=?', c.user.id).balance }));
}, AUTH_IDEM);
route('POST', '/api/pass/claim-all', (c) => {
  requireFeature('pass', 'BURGER PASS');
  const s = activeSeason();
  if (!s) throw bad('Сезон не активен');
  return tx(() => {
    const prog = one('SELECT * FROM pass_progress WHERE user_id=? AND season_id=?', c.user.id, s.id) || { xp: 0, premium: 0 };
    const lvl = passLevel(s, prog.xp);
    const list = all("SELECT * FROM pass_rewards WHERE season_id=? AND level<=? AND (track='free' OR ?=1) AND id NOT IN (SELECT reward_id FROM pass_claims WHERE user_id=?) ORDER BY level", s.id, lvl, prog.premium ? 1 : 0, c.user.id);
    const got = list.map((r) => claimReward(c.user.id, r.id));
    return { claimed: got.length, rewards: got, balance: one('SELECT balance FROM users WHERE id=?', c.user.id).balance };
  });
}, AUTH_IDEM);
route('GET', '/api/pass/history', (c) => ({
  rows: all('SELECT pc.created_at, r.*, s.name season FROM pass_claims pc JOIN pass_rewards r ON r.id=pc.reward_id JOIN pass_seasons s ON s.id=r.season_id WHERE pc.user_id=? ORDER BY pc.created_at DESC LIMIT 100', c.user.id)
    .map((r) => ({ ...rewardView(r), season: r.season, claimedAt: r.created_at })),
}), { auth: true });

// ================= Бонусы, задания, промокоды, рефералы =================
function dailyState(u: any) {
  const d = getSetting('daily');
  const today = periodKey('daily');
  const last = u.daily_last ? periodKey('daily', u.daily_last) : null;
  const yesterday = periodKey('daily', now() - 86400_000);
  const available = last !== today;
  const streak = available ? (last === yesterday ? Math.min(d.max_streak, u.daily_streak + 1) : 1) : u.daily_streak;
  const amount = d.base + d.step * (streak - 1);
  return { available, streak, amount, maxStreak: d.max_streak, base: d.base, step: d.step, schedule: Array.from({ length: d.max_streak }, (_, i) => d.base + d.step * i) };
}
function questsOf(userId: number) {
  return all('SELECT * FROM quests WHERE active=1 ORDER BY scope, sort, id').map((q) => {
    const p = one('SELECT progress, claimed FROM quest_progress WHERE user_id=? AND quest_id=? AND period=?', userId, q.id, periodKey(q.scope));
    return { id: q.id, scope: q.scope, title: q.title, metric: q.metric, goal: q.goal, reward: q.reward, xp: q.xp, progress: p?.progress || 0, claimed: !!p?.claimed };
  });
}
const REWARD_TYPES = ['bonus', 'quest', 'achievement', 'referral', 'promo', 'pass', 'event'];
route('GET', '/api/bonuses', (c) => {
  const u = one('SELECT * FROM users WHERE id=?', c.user.id);
  const ref = getSetting('referral');
  return {
    daily: dailyState(u), quests: questsOf(c.user.id),
    referral: { code: u.ref_code, link: (process.env.PUBLIC_URL || '') + '/r/' + u.ref_code, inviteeBonus: ref.invitee_bonus, inviterBonus: ref.inviter_bonus, threshold: ref.threshold_bc,
      invited: one('SELECT COUNT(*) n FROM users WHERE referred_by=?', u.id).n, active: one('SELECT COUNT(*) n FROM users WHERE referred_by=? AND ref_rewarded=1', u.id).n,
      earned: one("SELECT COALESCE(SUM(amount),0) s FROM ledger WHERE user_id=? AND type='referral' AND ref_type='user'", u.id).s },
    history: all(`SELECT id, amount, type, reason, created_at FROM ledger WHERE user_id=? AND type IN (${REWARD_TYPES.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 50`, u.id, ...REWARD_TYPES),
  };
}, { auth: true });
route('POST', '/api/bonuses/daily', (c) => tx(() => {
  checkRestriction(c.user, 'bonuses');
  const u = one('SELECT * FROM users WHERE id=?', c.user.id);
  const s = dailyState(u);
  if (!s.available) throw bad('Ежедневный бонус уже получен — возвращайтесь завтра');
  if (run('UPDATE users SET daily_last=?, daily_streak=? WHERE id=? AND (daily_last IS NULL OR daily_last=?)', now(), s.streak, u.id, u.daily_last).changes !== 1) throw bad('Бонус уже обрабатывается');
  const balance = change(u.id, s.amount, 'bonus', { ref: 'daily', refId: periodKey('daily'), reason: `Ежедневный бонус, день ${s.streak}` });
  track(u.id, 'daily');
  addXp(u.id, 25);
  return { amount: s.amount, streak: s.streak, balance };
}), AUTH_IDEM);
route('GET', '/api/quests', (c) => ({ quests: questsOf(c.user.id) }), { auth: true });
route('POST', '/api/quests/:id/claim', (c) => tx(() => {
  checkRestriction(c.user, 'bonuses');
  const q = one('SELECT * FROM quests WHERE id=? AND active=1', v.int(c.params.id, 'id', 1));
  if (!q) throw notFound('Задание не найдено');
  const period = periodKey(q.scope);
  const p = one('SELECT * FROM quest_progress WHERE user_id=? AND quest_id=? AND period=?', c.user.id, q.id, period);
  if (!p || p.progress < q.goal) throw bad('Задание ещё не выполнено');
  if (run('UPDATE quest_progress SET claimed=1 WHERE user_id=? AND quest_id=? AND period=? AND claimed=0', c.user.id, q.id, period).changes !== 1) throw bad('Награда уже получена');
  const balance = q.reward > 0 ? change(c.user.id, q.reward, 'quest', { ref: 'quest', refId: q.id, reason: q.title }) : one('SELECT balance FROM users WHERE id=?', c.user.id).balance;
  addXp(c.user.id, q.xp);
  return { ok: true, reward: q.reward, xp: q.xp, balance };
}), AUTH_IDEM);
route('POST', '/api/promo', (c) => {
  checkRestriction(c.user, 'bonuses');
  const code = v.str(c.body.code, 'Промокод', 2, 40);
  return tx(() => {
    const p = one('SELECT * FROM promo_codes WHERE code=? COLLATE NOCASE', code);
    if (!p || !p.active) throw bad('Промокод не найден или отключён');
    if (p.expires_at && p.expires_at < now()) throw bad('Срок действия промокода истёк');
    if (run('INSERT OR IGNORE INTO promo_uses(promo_id,user_id,created_at) VALUES(?,?,?)', p.id, c.user.id, now()).changes !== 1) throw bad('Вы уже активировали этот промокод');
    if (run('UPDATE promo_codes SET uses=uses+1 WHERE id=? AND (max_uses=0 OR uses < max_uses)', p.id).changes !== 1) throw bad('Лимит активаций промокода исчерпан');
    const balance = change(c.user.id, p.amount, 'promo', { ref: 'promo', refId: p.id, reason: `Промокод ${p.code}` });
    return { ok: true, amount: p.amount, balance };
  });
}, { auth: true, idem: true, rate: [10, 60_000] });
route('GET', '/api/promo/history', (c) => ({
  rows: all('SELECT pc.code, pc.amount, pu.created_at FROM promo_uses pu JOIN promo_codes pc ON pc.id=pu.promo_id WHERE pu.user_id=? ORDER BY pu.created_at DESC', c.user.id),
}), { auth: true });

// ================= Достижения и коллекции =================
route('GET', '/api/achievements', (c) => {
  const uid = c.user?.id || 0;
  const stats: Record<string, number> = {};
  for (const s of all('SELECT metric, value FROM user_stats WHERE user_id=?', uid)) stats[s.metric] = s.value;
  const got = new Map(all('SELECT code, created_at FROM user_achievements WHERE user_id=?', uid).map((x) => [x.code, x.created_at]));
  return { achievements: all('SELECT * FROM achievements WHERE active=1 ORDER BY metric, goal').map((a) => ({ ...a, progress: Math.min(a.goal, stats[a.metric] || 0), unlockedAt: got.get(a.code) || null })), stats };
});
route('GET', '/api/collections', (c) => {
  const uid = c.user?.id || 0;
  const rows = all("SELECT collection name, COUNT(*) total, MAX(COALESCE(base_price,0)) top FROM items WHERE archived=0 AND collection IS NOT NULL AND collection<>'' GROUP BY collection ORDER BY collection");
  const owned: Record<string, number> = {};
  for (const r of all("SELECT i.collection name, COUNT(DISTINCT i.id) n FROM inventory inv JOIN items i ON i.id=inv.item_id WHERE inv.user_id=? AND inv.status='owned' GROUP BY i.collection", uid)) owned[r.name] = r.n;
  return { collections: rows.map((r) => ({ ...r, owned: owned[r.name] || 0, preview: all('SELECT * FROM items WHERE collection=? AND archived=0 ORDER BY COALESCE(base_price,0) DESC LIMIT 4', r.name).map(itemView) })) };
});
route('GET', '/api/collections/:name', (c) => {
  const name = c.params.name;
  const uid = c.user?.id || 0;
  const ownedIds = new Set(all("SELECT DISTINCT inv.item_id FROM inventory inv WHERE inv.user_id=? AND inv.status='owned'", uid).map((x) => x.item_id));
  const items = all('SELECT * FROM items WHERE collection=? AND archived=0 ORDER BY COALESCE(base_price,0) DESC', name).map((i) => ({ ...itemView(i), owned: ownedIds.has(i.id) }));
  if (!items.length) throw notFound('Коллекция не найдена');
  return { name, items };
});

// ================= События, марафоны, турниры =================
export const EVENT_METRICS: Record<string, string> = { wager: 'Оборот, ₽', case_open: 'Открыто кейсов', game: 'Сыграно игр', battle: 'Битв кейсов', upgrade: 'Апгрейдов', upgrade_win: 'Успешных апгрейдов', contract: 'Контрактов', best: 'Лучший дроп, ₽' };
function metricSql(metric: string) {
  switch (metric) {
    case 'wager': return 'COALESCE(SUM(amount),0)/100';
    case 'best': return 'COALESCE(MAX(payout),0)/100';
    default: return 'COUNT(*)';
  }
}
function metricWhere(metric: string) {
  switch (metric) {
    case 'case_open': return "game='case'";
    case 'game': return "game NOT IN ('case','upgrade','contract','battle')";
    case 'battle': return "game='battle'";
    case 'upgrade': return "game='upgrade'";
    case 'upgrade_win': return "game='upgrade' AND payout>0";
    case 'contract': return "game='contract'";
    default: return '1=1';
  }
}
function eventProgress(e: any, userId: number) {
  return one(`SELECT ${metricSql(e.metric)} v FROM bets WHERE user_id=? AND status<>'active' AND created_at>=? AND created_at<? AND ${metricWhere(e.metric)}`, userId, e.starts_at || 0, e.ends_at || 9e15).v || 0;
}
function eventBoard(e: any, limit = 20) {
  return all(`SELECT user_id, ${metricSql(e.metric)} v FROM bets WHERE status<>'active' AND created_at>=? AND created_at<? AND ${metricWhere(e.metric)} GROUP BY user_id ORDER BY v DESC, MIN(id) LIMIT ?`, e.starts_at || 0, e.ends_at || 9e15, limit)
    .map((r, i) => ({ place: i + 1, value: r.v, user: publicUser(one('SELECT * FROM users WHERE id=?', r.user_id)) }));
}
function eventView(e: any, userId: number | null) {
  const claim = userId ? one('SELECT * FROM event_claims WHERE event_id=? AND user_id=?', e.id, userId) : null;
  return { id: e.id, kind: e.kind, title: e.title, description: e.description, metric: e.metric, metricName: EVENT_METRICS[e.metric] || e.metric, goal: e.goal, reward: e.reward,
    prizes: JSON.parse(e.prizes || '[]'), startsAt: e.starts_at, endsAt: e.ends_at, status: e.status, progress: userId ? eventProgress(e, userId) : 0, claimed: claim,
    board: e.kind === 'tournament' ? eventBoard(e, 10) : [] };
}
route('GET', '/api/events', (c) => {
  const kind = c.query.get('kind');
  const p: any[] = [];
  let where = "status IN ('active','finished')";
  if (kind) { where += ' AND kind=?'; p.push(kind); }
  return { events: all(`SELECT * FROM events WHERE ${where} ORDER BY status='active' DESC, COALESCE(ends_at,9e15) ASC LIMIT 50`, ...p).map((e) => eventView(e, c.user?.id || null)), metrics: EVENT_METRICS };
});
route('GET', '/api/events/:id', (c) => {
  const e = one("SELECT * FROM events WHERE id=? AND status IN ('active','finished')", v.int(c.params.id, 'id', 1));
  if (!e) throw notFound('Событие не найдено');
  return { event: { ...eventView(e, c.user?.id || null), board: eventBoard(e, 50) } };
});
route('POST', '/api/events/:id/claim', (c) => tx(() => {
  checkRestriction(c.user, 'bonuses');
  const e = one("SELECT * FROM events WHERE id=? AND status='active' AND kind IN ('event','marathon')", v.int(c.params.id, 'id', 1));
  if (!e) throw bad('Событие недоступно');
  if (e.starts_at && e.starts_at > now()) throw bad('Событие ещё не началось');
  if (eventProgress(e, c.user.id) < e.goal) throw bad('Условие события ещё не выполнено');
  if (run('INSERT OR IGNORE INTO event_claims(event_id,user_id,amount,place,created_at) VALUES(?,?,?,NULL,?)', e.id, c.user.id, e.reward, now()).changes !== 1) throw bad('Награда уже получена');
  const balance = change(c.user.id, e.reward, 'event', { ref: 'event', refId: e.id, reason: e.title });
  return { ok: true, amount: e.reward, balance };
}), AUTH_IDEM);
export function socialTick() {
  for (const e of all("SELECT * FROM events WHERE status='active' AND ends_at IS NOT NULL AND ends_at <= ?", now())) {
    tx(() => {
      if (run("UPDATE events SET status='finished' WHERE id=? AND status='active'", e.id).changes !== 1) return;
      if (e.kind !== 'tournament') return;
      const prizes: number[] = JSON.parse(e.prizes || '[]');
      for (const row of eventBoard(e, prizes.length)) {
        const amount = prizes[row.place - 1] || 0;
        if (!amount || !row.user || row.value <= 0) continue;
        if (run('INSERT OR IGNORE INTO event_claims(event_id,user_id,amount,place,created_at) VALUES(?,?,?,?,?)', e.id, row.user.id, amount, row.place, now()).changes === 1) {
          change(row.user.id, amount, 'event', { ref: 'tournament', refId: e.id, reason: `${e.title}: ${row.place} место` });
          notify(row.user.id, 'event', `Турнир «${e.title}»: ${row.place} место!`, `Приз ${bc(amount)} зачислен на баланс.`, '/tournaments');
        }
      }
    });
  }
}

// ================= Рейтинг =================
route('GET', '/api/leaderboard', (c) => {
  const period = v.oneOf(c.query.get('period') || 'week', 'Период', ['day', 'week', 'month', 'all'] as const);
  const by = v.oneOf(c.query.get('by') || 'wager', 'Показатель', ['wager', 'won', 'opens', 'best'] as const);
  const since = { day: now() - 86400_000, week: now() - 7 * 86400_000, month: now() - 30 * 86400_000, all: 0 }[period];
  const expr = { wager: 'SUM(amount)', won: 'SUM(payout)', opens: "SUM(CASE WHEN game='case' THEN 1 ELSE 0 END)", best: 'MAX(payout)' }[by];
  const rows = all(`SELECT user_id, ${expr} v, COUNT(*) n FROM bets WHERE status<>'active' AND created_at>=? GROUP BY user_id HAVING v > 0 ORDER BY v DESC LIMIT 50`, since);
  const list = rows.map((r, i) => ({ place: i + 1, value: r.v, bets: r.n, user: publicUser(one('SELECT * FROM users WHERE id=?', r.user_id)) }));
  const me = c.user ? list.find((x) => x.user?.id === c.user.id) || null : null;
  return { period, by, list, me };
});

// ================= Друзья и профили =================
function friendStatus(me: number, other: number) {
  const a = one('SELECT status FROM friends WHERE user_id=? AND friend_id=?', me, other);
  const b = one('SELECT status FROM friends WHERE user_id=? AND friend_id=?', other, me);
  if (a?.status === 'accepted') return 'friends';
  if (a?.status === 'pending') return 'outgoing';
  if (b?.status === 'pending') return 'incoming';
  return 'none';
}
route('GET', '/api/users/search', (c) => {
  const q = v.str(c.query.get('q') || '', 'Поиск', 2, 40);
  return { users: all("SELECT * FROM users WHERE status='active' AND (nickname LIKE ? OR login LIKE ?) ORDER BY last_seen DESC LIMIT 20", `%${q}%`, `%${q}%`)
    .map((u) => ({ ...publicUser(u), friend: c.user ? friendStatus(c.user.id, u.id) : 'none' })) };
}, { rate: [30, 60_000] });
route('GET', '/api/users/:id', (c) => {
  const u = one('SELECT * FROM users WHERE id=?', v.int(c.params.id, 'id', 1));
  if (!u || (u.status !== 'active' && !can(c.user, 'users.view'))) throw notFound('Игрок не найден');
  const self = c.user?.id === u.id;
  const hidden = !!u.private_profile && !self && !isStaff(c.user);
  const st: Record<string, number> = {};
  for (const s of all('SELECT metric, value FROM user_stats WHERE user_id=?', u.id)) st[s.metric] = s.value;
  const s = activeSeason();
  const xp = s ? one('SELECT xp FROM pass_progress WHERE user_id=? AND season_id=?', u.id, s.id)?.xp || 0 : 0;
  const rankRow = one("SELECT COUNT(*) + 1 r FROM (SELECT user_id, SUM(amount) w FROM bets WHERE status<>'active' GROUP BY user_id) WHERE w > (SELECT COALESCE(SUM(amount),0) FROM bets WHERE user_id=? AND status<>'active')", u.id);
  return {
    user: { ...publicUser(u), steamName: u.steam_name, privateProfile: !!u.private_profile, lastSeen: hidden ? null : u.last_seen },
    stats: { opens: st.case_open || 0, wagered: st.wager || 0, games: st.game || 0, battles: st.battle || 0, battlesWon: st.battle_win || 0, upgrades: st.upgrade || 0, upgradesWon: st.upgrade_win || 0,
      contracts: st.contract || 0, bestDrop: st.best_drop || 0, passLevel: s ? passLevel(s, xp) : 0, achievements: one('SELECT COUNT(*) n FROM user_achievements WHERE user_id=?', u.id).n, rank: rankRow.r },
    hidden,
    recent: hidden ? [] : all(INV_SELECT + " WHERE inv.user_id=? AND inv.source IN ('case','upgrade','contract','battle','pass') ORDER BY inv.id DESC LIMIT 18", u.id).map(invView),
    best: hidden ? [] : all(INV_SELECT + " WHERE inv.user_id=? AND inv.status='owned' ORDER BY inv.price DESC LIMIT 6", u.id).map(invView),
    friend: c.user && !self ? friendStatus(c.user.id, u.id) : null,
    friends: one("SELECT COUNT(*) n FROM friends WHERE user_id=? AND status='accepted'", u.id).n,
  };
});
route('GET', '/api/friends', (c) => {
  const map = (rows: any[], key: string) => rows.map((r) => ({ ...publicUser(one('SELECT * FROM users WHERE id=?', r[key])), since: r.created_at, online: false }));
  return {
    friends: map(all("SELECT * FROM friends WHERE user_id=? AND status='accepted' ORDER BY created_at DESC", c.user.id), 'friend_id'),
    incoming: map(all("SELECT * FROM friends WHERE friend_id=? AND status='pending' ORDER BY created_at DESC", c.user.id), 'user_id'),
    outgoing: map(all("SELECT * FROM friends WHERE user_id=? AND status='pending' ORDER BY created_at DESC", c.user.id), 'friend_id'),
  };
}, { auth: true });
route('POST', '/api/friends/:id/request', (c) => tx(() => {
  const id = v.int(c.params.id, 'id', 1);
  if (id === c.user.id) throw bad('Нельзя добавить себя');
  const u = one("SELECT * FROM users WHERE id=? AND status='active'", id);
  if (!u) throw notFound('Игрок не найден');
  const st = friendStatus(c.user.id, id);
  if (st === 'friends' || st === 'outgoing') throw bad('Заявка уже отправлена');
  if (st === 'incoming') return acceptFriend(c.user.id, id);
  if (one("SELECT COUNT(*) n FROM friends WHERE user_id=? AND status='pending'", c.user.id).n >= 50) throw bad('Слишком много исходящих заявок');
  run('INSERT INTO friends(user_id,friend_id,status,created_at) VALUES(?,?,?,?)', c.user.id, id, 'pending', now());
  notify(id, 'friend', 'Заявка в друзья', `${c.user.nickname} хочет добавить вас в друзья`, '/friends');
  return { status: 'outgoing' };
}), { auth: true, rate: [30, 60_000] });
function acceptFriend(me: number, other: number) {
  if (run("UPDATE friends SET status='accepted' WHERE user_id=? AND friend_id=? AND status='pending'", other, me).changes !== 1) throw bad('Заявка не найдена');
  run("INSERT INTO friends(user_id,friend_id,status,created_at) VALUES(?,?,'accepted',?) ON CONFLICT(user_id,friend_id) DO UPDATE SET status='accepted'", me, other, now());
  track(me, 'friends');
  track(other, 'friends');
  const meU = one('SELECT nickname FROM users WHERE id=?', me);
  notify(other, 'friend', 'Заявка принята', `${meU.nickname} теперь в вашем списке друзей`, `/u/${me}`);
  return { status: 'friends' };
}
route('POST', '/api/friends/:id/accept', (c) => tx(() => acceptFriend(c.user.id, v.int(c.params.id, 'id', 1))), { auth: true });
route('POST', '/api/friends/:id/remove', (c) => {
  const id = v.int(c.params.id, 'id', 1);
  run('DELETE FROM friends WHERE (user_id=? AND friend_id=?) OR (user_id=? AND friend_id=?)', c.user.id, id, id, c.user.id);
  return { status: 'none' };
}, { auth: true });

// ================= Уведомления и новости =================
route('GET', '/api/notifications', (c) => ({
  rows: all('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 60', c.user.id),
  unread: one('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0', c.user.id).n,
}), { auth: true });
route('POST', '/api/notifications/read', (c) => {
  if (Array.isArray(c.body.ids) && c.body.ids.length) for (const id of v.ids(c.body.ids, 'ids', 1, 200)) run('UPDATE notifications SET read=1 WHERE id=? AND user_id=?', id, c.user.id);
  else run('UPDATE notifications SET read=1 WHERE user_id=?', c.user.id);
  return { unread: one('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0', c.user.id).n };
}, { auth: true });
route('GET', '/api/news', (c) => {
  const kind = c.query.get('kind');
  return { news: all(`SELECT id, title, kind, image, created_at, substr(body,1,240) excerpt FROM news WHERE published=1 ${kind ? 'AND kind=?' : ''} ORDER BY id DESC LIMIT 50`, ...(kind ? [kind] : [])) };
});
route('GET', '/api/news/:id', (c) => {
  const n = one('SELECT * FROM news WHERE id=?', v.int(c.params.id, 'id', 1));
  if (!n || (!n.published && !can(c.user, 'news.manage'))) throw notFound('Новость не найдена');
  return { news: n };
});

// ================= Поддержка =================
export const TICKET_CATEGORIES: Record<string, string> = { account: 'Аккаунт и вход', balance: 'Баланс и финансы', cases: 'Кейсы и предметы', games: 'Игры и битвы', bonus: 'Бонусы и BURGER PASS', tech: 'Техническая проблема', other: 'Другое' };
export const TICKET_PRIORITIES: Record<string, string> = { low: 'Низкий', normal: 'Обычный', high: 'Высокий', urgent: 'Срочный' };
export const TICKET_STATUSES: Record<string, string> = { open: 'Открыто', answered: 'Есть ответ', pending: 'В работе', closed: 'Закрыто' };
function attachmentOf(c: any, id: any) {
  if (!id) return null;
  const up = one("SELECT * FROM uploads WHERE id=? AND owner_id=? AND kind='ticket'", String(id), c.user.id);
  if (!up) throw bad('Вложение не найдено');
  return up.id;
}
export function ticketView(t: any, withMessages = false) {
  const u = publicUser(one('SELECT * FROM users WHERE id=?', t.user_id));
  const assignee = t.assignee_id ? publicUser(one('SELECT * FROM users WHERE id=?', t.assignee_id)) : null;
  const out: any = { id: t.id, subject: t.subject, category: t.category, categoryName: TICKET_CATEGORIES[t.category] || t.category, priority: t.priority, priorityName: TICKET_PRIORITIES[t.priority],
    status: t.status, statusName: TICKET_STATUSES[t.status], user: u, assignee, createdAt: t.created_at, updatedAt: t.updated_at,
    messages: one('SELECT COUNT(*) n FROM ticket_messages WHERE ticket_id=?', t.id).n };
  if (withMessages) out.thread = all('SELECT m.*, u.nickname, u.avatar, u.role FROM ticket_messages m JOIN users u ON u.id=m.user_id WHERE m.ticket_id=? ORDER BY m.id', t.id)
    .map((m) => ({ id: m.id, staff: !!m.staff, user: { id: m.user_id, nickname: m.nickname, avatar: m.avatar ? imageUrl(m.avatar) : null, role: m.role }, body: m.body,
      attachment: m.attachment ? '/uploads/private/' + m.attachment : null, createdAt: m.created_at }));
  return out;
}
function loadTicket(c: any, id: number) {
  const t = one('SELECT * FROM tickets WHERE id=?', id);
  if (!t || (t.user_id !== c.user.id && !can(c.user, 'support.manage'))) throw notFound('Обращение не найдено');
  return t;
}
route('GET', '/api/tickets', (c) => ({ tickets: all('SELECT * FROM tickets WHERE user_id=? ORDER BY updated_at DESC', c.user.id).map((t) => ticketView(t)), categories: TICKET_CATEGORIES, priorities: TICKET_PRIORITIES }), { auth: true });
route('POST', '/api/tickets', (c) => {
  checkRestriction(c.user, 'support');
  const subject = v.str(c.body.subject, 'Тема', 3, 120);
  const category = v.oneOf(c.body.category, 'Категория', Object.keys(TICKET_CATEGORIES));
  const priority = v.oneOf(c.body.priority || 'normal', 'Приоритет', ['low', 'normal', 'high']);
  const body = v.str(c.body.body, 'Сообщение', 5, 5000);
  const att = attachmentOf(c, c.body.attachment);
  if (one("SELECT COUNT(*) n FROM tickets WHERE user_id=? AND status<>'closed'", c.user.id).n >= 5) throw bad('У вас уже 5 открытых обращений — дождитесь ответа');
  return tx(() => {
    const id = run('INSERT INTO tickets(user_id,subject,category,priority,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', c.user.id, subject, category, priority, 'open', now(), now()).lastInsertRowid;
    run('INSERT INTO ticket_messages(ticket_id,user_id,staff,body,attachment,created_at) VALUES(?,?,0,?,?,?)', id, c.user.id, body, att, now());
    broadcast('staff_ticket', { id }, undefined);
    return { ticket: ticketView(one('SELECT * FROM tickets WHERE id=?', id), true) };
  });
}, { auth: true, idem: true, rate: [5, 3600_000] });
route('GET', '/api/tickets/:id', (c) => ({ ticket: ticketView(loadTicket(c, v.int(c.params.id, 'id', 1)), true) }), { auth: true });
route('POST', '/api/tickets/:id/messages', (c) => {
  checkRestriction(c.user, 'support');
  const t = loadTicket(c, v.int(c.params.id, 'id', 1));
  if (t.user_id !== c.user.id) throw forbidden('Сотрудники отвечают через админ-панель');
  if (t.status === 'closed') throw bad('Обращение закрыто — откройте его снова');
  const body = v.str(c.body.body, 'Сообщение', 1, 5000);
  const att = attachmentOf(c, c.body.attachment);
  run('INSERT INTO ticket_messages(ticket_id,user_id,staff,body,attachment,created_at) VALUES(?,?,0,?,?,?)', t.id, c.user.id, body, att, now());
  run("UPDATE tickets SET status='open', updated_at=? WHERE id=?", now(), t.id);
  if (t.assignee_id) notify(t.assignee_id, 'support', `Новое сообщение в обращении #${t.id}`, t.subject, `/admin/support/${t.id}`);
  return { ticket: ticketView(one('SELECT * FROM tickets WHERE id=?', t.id), true) };
}, { auth: true, idem: true, rate: [20, 60_000] });
route('POST', '/api/tickets/:id/close', (c) => {
  const t = loadTicket(c, v.int(c.params.id, 'id', 1));
  if (t.user_id !== c.user.id) throw forbidden();
  run("UPDATE tickets SET status='closed', updated_at=? WHERE id=?", now(), t.id);
  return { ticket: ticketView(one('SELECT * FROM tickets WHERE id=?', t.id), true) };
}, { auth: true });
route('POST', '/api/tickets/:id/reopen', (c) => {
  const t = loadTicket(c, v.int(c.params.id, 'id', 1));
  if (t.user_id !== c.user.id) throw forbidden();
  if (t.status !== 'closed') throw bad('Обращение и так открыто');
  run("UPDATE tickets SET status='open', updated_at=? WHERE id=?", now(), t.id);
  return { ticket: ticketView(one('SELECT * FROM tickets WHERE id=?', t.id), true) };
}, { auth: true });

// ================= Финансы =================
export const FIN_STATUSES: Record<string, string> = { pending: 'На рассмотрении', approved: 'Одобрена', rejected: 'Отклонена', cancelled: 'Отменена' };
export function finView(r: any) {
  const inv = r.inv_id ? one(INV_SELECT + ' WHERE inv.id=?', r.inv_id) : null;
  return { id: r.id, kind: r.kind, amount: r.amount, method: r.method, status: r.status, statusName: FIN_STATUSES[r.status] || r.status, comment: r.comment,
    item: inv ? invView(inv) : null, details: r.details ? JSON.parse(r.details) : null, createdAt: r.created_at, decidedAt: r.decided_at, user: publicUser(one('SELECT * FROM users WHERE id=?', r.user_id)) };
}
route('GET', '/api/finance', (c) => {
  const fin = getSetting('finance');
  const providers = paymentProviders();
  return {
    balance: one('SELECT balance FROM users WHERE id=?', c.user.id).balance,
    deposit: { enabled: feature('deposit') && providers.length > 0, note: fin.deposit_note, methods: providers.map((p) => ({ id: p.id, name: p.name })) },
    withdraw: { enabled: feature('withdraw'), note: fin.withdraw_note },
    requests: all('SELECT * FROM finance_requests WHERE user_id=? ORDER BY id DESC LIMIT 50', c.user.id).map(finView),
    summary: all('SELECT type, COUNT(*) n, SUM(amount) s FROM ledger WHERE user_id=? GROUP BY type', c.user.id),
  };
}, { auth: true });
route('POST', '/api/finance/deposit', (c) => {
  checkRestriction(c.user, 'finance');
  const providers = paymentProviders();
  if (!feature('deposit') || !providers.length) throw new HttpError(503, getSetting('finance').deposit_note || 'Пополнение сейчас недоступно', 'deposit_unavailable');
  const amount = v.money(c.body.amount, 'Сумма', 1, 1_000_000);
  const p = providers.find((x) => x.id === c.body.method);
  if (!p) throw bad('Способ оплаты недоступен');
  const id = run('INSERT INTO finance_requests(user_id,kind,amount,method,status,created_at) VALUES(?,?,?,?,?,?)', c.user.id, 'deposit', amount, p.id, 'pending', now()).lastInsertRowid;
  audit(c.user.id, 'finance.deposit_request', 'finance', id, { amount, method: p.id }, c.ip);
  // Провайдер создаёт платёж; баланс начисляется только после подтверждения провайдера и проверки сотрудником.
  return { request: finView(one('SELECT * FROM finance_requests WHERE id=?', id)), next: p.createPayment ? p.createPayment({ requestId: id, amount, userId: c.user.id }) : null };
}, { auth: true, idem: true, rate: [5, 60_000] });
const TRADE_RE = new RegExp('^https://' + 'steamcommunity\\.com/tradeoffer/new/\\?partner=\\d{1,12}&token=[\\w-]{6,16}$');
route('POST', '/api/finance/withdraw', (c) => {
  checkRestriction(c.user, 'finance');
  if (!feature('withdraw')) throw new HttpError(503, getSetting('finance').withdraw_note || 'Вывод сейчас недоступен', 'withdraw_unavailable');
  const invId = v.int(c.body.invId, 'Предмет', 1);
  const tradeUrl = v.str(c.body.tradeUrl, 'Trade URL', 20, 200);
  if (!TRADE_RE.test(tradeUrl)) throw bad('Укажите ссылку на обмен Steam (Trade URL)');
  if (!c.user.steam_id) throw bad('Для вывода привяжите Steam в настройках');
  return tx(() => {
    const [item] = consumeInventory(c.user.id, [invId], 'withdrawing');
    const id = run('INSERT INTO finance_requests(user_id,kind,amount,inv_id,method,details,status,created_at) VALUES(?,?,?,?,?,?,?,?)', c.user.id, 'withdraw', item.price, invId, 'steam_trade', JSON.stringify({ tradeUrl }), 'pending', now()).lastInsertRowid;
    audit(c.user.id, 'finance.withdraw_request', 'finance', id, { invId, price: item.price }, c.ip);
    return { request: finView(one('SELECT * FROM finance_requests WHERE id=?', id)) };
  });
}, { auth: true, idem: true, rate: [5, 60_000] });
route('POST', '/api/finance/:id/cancel', (c) => tx(() => {
  const r = one("SELECT * FROM finance_requests WHERE id=? AND user_id=? AND status='pending'", v.int(c.params.id, 'id', 1), c.user.id);
  if (!r || run("UPDATE finance_requests SET status='cancelled', decided_at=? WHERE id=? AND status='pending'", now(), r.id).changes !== 1) throw bad('Заявку нельзя отменить');
  if (r.inv_id) run("UPDATE inventory SET status='owned', updated_at=? WHERE id=? AND status='withdrawing'", now(), r.inv_id);
  return { request: finView(one('SELECT * FROM finance_requests WHERE id=?', r.id)) };
}), { auth: true, idem: true });

// ================= Загрузка изображений =================
const MIME: Record<string, { ext: string; magic: number[] }> = {
  'image/png': { ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47] }, 'image/jpeg': { ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
  'image/webp': { ext: 'webp', magic: [0x52, 0x49, 0x46, 0x46] }, 'image/gif': { ext: 'gif', magic: [0x47, 0x49, 0x46, 0x38] },
};
const UPLOAD_PERM: Record<string, string | null> = { avatar: null, ticket: null, cover: 'cases.manage', item: 'items.manage', news: 'news.manage', logo: 'settings.manage', banner: 'settings.manage', support: 'support.manage' };
export const UPLOAD_DIR = path.join(DATA, 'uploads');
route('POST', '/api/uploads', (c) => {
  const kind = v.oneOf(c.body.kind, 'Тип', Object.keys(UPLOAD_PERM));
  const perm = UPLOAD_PERM[kind];
  if (perm && !can(c.user, perm)) throw forbidden();
  const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(c.body.data || ''));
  if (!m) throw bad('Поддерживаются изображения PNG, JPEG, WEBP и GIF');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 2 * 1024 * 1024) throw bad('Максимальный размер файла — 2 МБ');
  const t = MIME[m[1]];
  if (!t.magic.every((b, i) => buf[i] === b)) throw bad('Содержимое файла не соответствует формату изображения');
  const priv = kind === 'ticket' || kind === 'support';
  const file = randomToken(12) + '.' + t.ext;
  const dir = path.join(UPLOAD_DIR, priv ? 'private' : 'public');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), buf);
  run('INSERT INTO uploads(id,owner_id,kind,mime,size,created_at) VALUES(?,?,?,?,?,?)', file, c.user.id, kind === 'support' ? 'ticket' : kind, m[1], buf.length, now());
  return { id: file, url: (priv ? '/uploads/private/' : '/uploads/public/') + file };
}, { auth: true, rate: [20, 60_000] });


// ---------- Публичная конфигурация сайта (без секретов) ----------
route('GET', '/api/site', () => {
  const f = getSetting('features');
  const fin = getSetting('finance');
  const m = getSetting('maintenance');
  return {
    site: getSetting('site'), banner: getSetting('banner'), features: f,
    maintenance: { enabled: !!m.enabled, message: m.message || '' },
    finance: { depositNote: fin.deposit_note, withdrawNote: fin.withdraw_note, providers: paymentProviders().map((p: any) => ({ id: p.id, name: p.name })) },
    online: onlineCount(),
    sound: getSetting('sound'),
    dropFx: (({ enabled, godlike, mythic, divine, share, default_mode }) => ({ enabled, share, defaultMode: default_mode, tiers: { godlike, mythic, divine } }))(getSetting('drop_fx')),
    currency: { code: 'RUB', sign: '₽' },
    upgrade: (({ presets, min_mult, max_mult, max_items }) => ({ presets, minMult: min_mult, maxMult: max_mult, maxItems: max_items }))(getSetting('upgrade')),
  };
});
