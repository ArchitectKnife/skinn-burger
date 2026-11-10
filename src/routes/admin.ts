import { readFileSync as readFileSyncW } from 'node:fs';
// Админ-панель. Каждый маршрут защищён проверкой разрешения на сервере (RouteOpts.perm → can()).
import fs from 'node:fs';
import path from 'node:path';
import { one, all, run, tx, now, DATA, db } from '../lib/db.ts';
import { route, v, bad, notFound, forbidden, onlineCount, broadcast } from '../lib/http.ts';
import { getSetting, setSetting, DEFAULTS, audit, verifyAudit, change, notify, publicUser, invView, INV_SELECT, itemView, imageUrl, rub } from '../lib/core.ts';
import { ROLES, ROLE_RANK, PERMS, DEFAULT_ROLE_PERMS, permsOf, can } from '../lib/auth.ts';
import { recalcCase, recalcAllCases, caseCard, caseRows, itemEV, caseCover, caseDetail } from '../lib/cases.ts';
import { dropFxStats } from '../lib/dropfx.ts';
import { importItems, importPrices, buildThemedCases, parseImport, catalogStats } from '../lib/catalog.ts';
import { mailConfigured, sendMail } from '../lib/mailer.ts';
import { ticketView, finView, TICKET_STATUSES, TICKET_PRIORITIES, EVENT_METRICS } from './social.ts';
import { betView, CASE_CATEGORIES } from './play.ts';
import { paymentProviders } from '../lib/payments.ts';

const DAY = 86400_000;
const MSK = 3 * 3600_000;
const page = (c: any, size = 50) => { const p = Math.max(1, Number(c.query.get('page')) || 1); return { limit: size, offset: (p - 1) * size, page: p }; };
export const RESTRICTIONS: Record<string, string> = { cases: 'Кейсы, апгрейд и контракты', games: 'Игры и Case Battle', finance: 'Пополнение и вывод', bonuses: 'Бонусы и промокоды', support: 'Обращения в поддержку' };
export const QUEST_METRICS: Record<string, string> = { case_open: 'Открыть кейсы', wager: 'Оборот, ₽', game: 'Сыграть в игры', battle: 'Участвовать в битвах', battle_win: 'Победить в битвах',
  upgrade: 'Сделать апгрейды', upgrade_win: 'Успешные апгрейды', contract: 'Создать контракты', daily: 'Забрать ежедневный бонус', friends: 'Добавить друзей', sell: 'Продать предметы' };

// ================= Дашборд =================
route('GET', '/api/admin/dashboard', () => {
  const t = now();
  const n = (sql: string, ...p: any[]) => one(sql, ...p).n;
  const from = Math.floor((t + MSK) / DAY) * DAY - MSK - 13 * DAY;
  const bucket = 'CAST((created_at + 10800000) / 86400000 AS INTEGER)';
  const series = (sql: string) => { const m = new Map(all(sql, from).map((r: any) => [r.d, r.v])); return Array.from({ length: 14 }, (_, i) => m.get(Math.floor((from + MSK) / DAY) + i) || 0); };
  const days = Array.from({ length: 14 }, (_, i) => new Date(from + MSK + i * DAY).toISOString().slice(5, 10));
  return {
    counters: {
      users: n('SELECT COUNT(*) n FROM users'), active24h: n('SELECT COUNT(*) n FROM users WHERE last_seen > ?', t - DAY), online: onlineCount(),
      new24h: n('SELECT COUNT(*) n FROM users WHERE created_at > ?', t - DAY), new7d: n('SELECT COUNT(*) n FROM users WHERE created_at > ?', t - 7 * DAY),
      opens24h: n("SELECT COUNT(*) n FROM bets WHERE game='case' AND created_at > ?", t - DAY), opensTotal: n("SELECT COUNT(*) n FROM bets WHERE game='case'"),
      items: n('SELECT COUNT(*) n FROM items WHERE archived=0'), itemsNoImage: n("SELECT COUNT(*) n FROM items WHERE archived=0 AND (image IS NULL OR image='')"),
      cases: n("SELECT COUNT(*) n FROM cases WHERE status='published'"), inventory: n("SELECT COUNT(*) n FROM inventory WHERE status='owned'"),
      financePending: n("SELECT COUNT(*) n FROM finance_requests WHERE status='pending'"), ticketsOpen: n("SELECT COUNT(*) n FROM tickets WHERE status<>'closed'"),
      balanceTotal: one('SELECT COALESCE(SUM(balance),0) n FROM users').n, errors24h: n('SELECT COUNT(*) n FROM error_log WHERE created_at > ?', t - DAY),
    },
    games: all("SELECT game, COUNT(*) bets, COUNT(DISTINCT user_id) players, COALESCE(SUM(amount),0) wagered, COALESCE(SUM(payout),0) paid FROM bets WHERE status<>'active' AND created_at > ? GROUP BY game ORDER BY wagered DESC", t - 7 * DAY),
    ledger: all('SELECT type, COUNT(*) n, COALESCE(SUM(amount),0) sum FROM ledger WHERE created_at > ? GROUP BY type ORDER BY n DESC', t - 7 * DAY),
    finance: { providers: paymentProviders().length, deposits: all("SELECT status, COUNT(*) n, COALESCE(SUM(amount),0) sum FROM finance_requests WHERE kind='deposit' GROUP BY status"),
      withdrawals: all("SELECT status, COUNT(*) n, COALESCE(SUM(amount),0) sum FROM finance_requests WHERE kind='withdraw' GROUP BY status") },
    charts: { days,
      registrations: series(`SELECT ${bucket} d, COUNT(*) v FROM users WHERE created_at >= ? GROUP BY d`),
      opens: series(`SELECT ${bucket} d, COUNT(*) v FROM bets WHERE game='case' AND created_at >= ? GROUP BY d`),
      active: series(`SELECT ${bucket} d, COUNT(DISTINCT user_id) v FROM bets WHERE created_at >= ? GROUP BY d`),
      wagered: series(`SELECT ${bucket} d, COALESCE(SUM(amount),0) v FROM bets WHERE status<>'active' AND created_at >= ? GROUP BY d`) },
    audit: auditRows('1=1', [], 10, 0), errors: all('SELECT * FROM error_log ORDER BY id DESC LIMIT 5'), catalog: catalogStats(),
  };
}, { perm: 'admin.access' });

// ================= Пользователи =================
function adminUser(u: any) {
  return { id: u.id, login: u.login, email: u.email, nickname: u.nickname, avatar: u.avatar ? imageUrl(u.avatar) : null, role: u.role, status: u.status, banReason: u.ban_reason,
    restrictions: JSON.parse(u.restrictions || '{}'), balance: u.balance, steamId: u.steam_id, steamName: u.steam_name, refCode: u.ref_code, referredBy: u.referred_by,
    failedLogins: u.failed_logins, lockedUntil: u.locked_until, regIp: u.reg_ip, lastIp: u.last_ip, createdAt: u.created_at, lastSeen: u.last_seen };
}
function target(c: any, allowSelf = false) {
  const u = one('SELECT * FROM users WHERE id=?', v.int(c.params.id, 'id', 1));
  if (!u) throw notFound('Пользователь не найден');
  if (u.id === c.user.id) { if (!allowSelf) throw bad('Нельзя применить к собственному аккаунту'); return u; }
  if (ROLE_RANK[u.role] >= ROLE_RANK[c.user.role]) throw forbidden('Нельзя управлять аккаунтом с равной или более высокой ролью');
  return u;
}
route('GET', '/api/admin/users', (c) => {
  const { limit, offset, page: p } = page(c);
  const w: string[] = ['1=1'];
  const prm: any[] = [];
  const q = (c.query.get('q') || '').trim();
  if (q) { w.push('(login LIKE ? OR nickname LIKE ? OR email LIKE ? OR steam_id=? OR CAST(id AS TEXT)=? OR last_ip=?)'); prm.push(`%${q}%`, `%${q}%`, `%${q}%`, q, q, q); }
  const role = c.query.get('role');
  if (role && (ROLES as readonly string[]).includes(role)) { w.push('role=?'); prm.push(role); }
  const status = c.query.get('status');
  if (status) { w.push('status=?'); prm.push(status); }
  const sort = ({ new: 'id DESC', balance: 'balance DESC', seen: 'COALESCE(last_seen,0) DESC' } as any)[c.query.get('sort') || 'new'] || 'id DESC';
  return { rows: all(`SELECT * FROM users WHERE ${w.join(' AND ')} ORDER BY ${sort} LIMIT ? OFFSET ?`, ...prm, limit, offset).map(adminUser),
    total: one(`SELECT COUNT(*) n FROM users WHERE ${w.join(' AND ')}`, ...prm).n, page: p, roles: ROLES, restrictions: RESTRICTIONS };
}, { perm: 'users.view' });
route('GET', '/api/admin/users/:id', (c) => {
  const u = one('SELECT * FROM users WHERE id=?', v.int(c.params.id, 'id', 1));
  if (!u) throw notFound('Пользователь не найден');
  const stats: Record<string, number> = {};
  for (const s of all('SELECT metric, value FROM user_stats WHERE user_id=?', u.id)) stats[s.metric] = s.value;
  return {
    user: adminUser(u), stats, restrictions: RESTRICTIONS, roles: ROLES.filter((r) => r !== 'OWNER' && ROLE_RANK[r] < ROLE_RANK[c.user.role]),
    ledger: all('SELECT * FROM ledger WHERE user_id=? ORDER BY id DESC LIMIT 100', u.id),
    bets: all("SELECT * FROM bets WHERE user_id=? AND status<>'active' ORDER BY id DESC LIMIT 60", u.id).map(betView),
    inventory: all(INV_SELECT + ' WHERE inv.user_id=? ORDER BY inv.id DESC LIMIT 200', u.id).map(invView),
    sessions: all('SELECT created_at, last_seen, ip, ua, expires_at FROM sessions WHERE user_id=? ORDER BY last_seen DESC LIMIT 20', u.id),
    finance: all('SELECT * FROM finance_requests WHERE user_id=? ORDER BY id DESC LIMIT 30', u.id).map(finView),
    tickets: all('SELECT * FROM tickets WHERE user_id=? ORDER BY id DESC LIMIT 30', u.id).map((t) => ticketView(t)),
    sameIp: all('SELECT id, login, nickname, status, last_ip, reg_ip FROM users WHERE id<>? AND ((last_ip IS NOT NULL AND last_ip IN (?,?)) OR (reg_ip IS NOT NULL AND reg_ip IN (?,?))) LIMIT 30',
      u.id, u.last_ip, u.reg_ip, u.last_ip, u.reg_ip),
    audit: auditRows('(target_type=? AND target_id=?) OR actor_id=?', ['user', String(u.id), u.id], 50, 0),
  };
}, { perm: 'users.view' });
route('POST', '/api/admin/users/:id/ban', (c) => {
  const u = target(c);
  const reason = v.str(c.body.reason, 'Причина', 3, 500);
  tx(() => {
    run("UPDATE users SET status='banned', ban_reason=? WHERE id=?", reason, u.id);
    run('DELETE FROM sessions WHERE user_id=?', u.id);
    audit(c.user.id, 'user.ban', 'user', u.id, { reason }, c.ip);
  });
  return { user: adminUser(one('SELECT * FROM users WHERE id=?', u.id)) };
}, { perm: 'users.ban' });
route('POST', '/api/admin/users/:id/unban', (c) => {
  const u = target(c);
  run("UPDATE users SET status='active', ban_reason=NULL, failed_logins=0, locked_until=0 WHERE id=?", u.id);
  audit(c.user.id, 'user.unban', 'user', u.id, null, c.ip);
  return { user: adminUser(one('SELECT * FROM users WHERE id=?', u.id)) };
}, { perm: 'users.ban' });
route('POST', '/api/admin/users/:id/restrictions', (c) => {
  const u = target(c);
  const r: Record<string, boolean> = {};
  for (const k of Object.keys(RESTRICTIONS)) if (c.body[k]) r[k] = true;
  const reason = v.str(c.body.reason, 'Причина', 3, 500);
  run('UPDATE users SET restrictions=? WHERE id=?', JSON.stringify(r), u.id);
  audit(c.user.id, 'user.restrictions', 'user', u.id, { restrictions: r, reason }, c.ip);
  if (Object.keys(r).length) notify(u.id, 'security', 'Для аккаунта установлены ограничения', Object.keys(r).map((k) => RESTRICTIONS[k]).join(', '), '/support');
  return { user: adminUser(one('SELECT * FROM users WHERE id=?', u.id)) };
}, { perm: 'users.ban' });
route('POST', '/api/admin/users/:id/role', (c) => {
  const u = target(c);
  const role = v.oneOf(c.body.role, 'Роль', ['USER', 'SUPPORT', 'MODERATOR', 'ADMIN']);
  if (ROLE_RANK[role] >= ROLE_RANK[c.user.role]) throw forbidden('Можно назначать только роли ниже своей');
  run('UPDATE users SET role=? WHERE id=?', role, u.id);
  run('DELETE FROM sessions WHERE user_id=?', u.id);
  audit(c.user.id, 'user.role', 'user', u.id, { from: u.role, to: role }, c.ip);
  return { user: adminUser(one('SELECT * FROM users WHERE id=?', u.id)) };
}, { perm: 'users.roles' });
route('POST', '/api/admin/users/:id/balance', (c) => {
  const u = target(c, c.user.role === 'OWNER');
  const amount = Math.round(v.num(c.body.amount, 'Сумма', -1e9, 1e9) * 100);
  if (!amount) throw bad('Сумма не может быть нулевой');
  const reason = v.str(c.body.reason, 'Причина', 5, 500);
  const balance = tx(() => {
    const b = change(u.id, amount, 'admin', { ref: 'admin', refId: c.user.id, reason, actor: c.user.id });
    audit(c.user.id, 'user.balance', 'user', u.id, { amount, reason, balanceAfter: b }, c.ip);
    notify(u.id, 'balance', amount > 0 ? 'Начисление на баланс' : 'Списание с баланса', `${rub(amount)}: ${reason}`, '/balance');
    return b;
  });
  return { balance };
}, { perm: 'users.balance', idem: true });
route('POST', '/api/admin/users/:id/logout', (c) => {
  const u = target(c);
  run('DELETE FROM sessions WHERE user_id=?', u.id);
  audit(c.user.id, 'user.logout_all', 'user', u.id, null, c.ip);
  return { ok: true };
}, { perm: 'users.ban' });
route('GET', '/api/admin/suspicious', () => {
  const t = now();
  return {
    sharedIps: all("SELECT ip, COUNT(*) n, group_concat(id) ids, group_concat(nickname, ', ') names FROM (SELECT id, nickname, last_ip ip FROM users WHERE last_ip IS NOT NULL UNION SELECT id, nickname, reg_ip FROM users WHERE reg_ip IS NOT NULL) GROUP BY ip HAVING COUNT(DISTINCT id) > 1 ORDER BY n DESC LIMIT 50"),
    highWin: all("SELECT b.user_id, u.nickname, SUM(b.amount) wagered, SUM(b.payout) paid, COUNT(*) bets FROM bets b JOIN users u ON u.id=b.user_id WHERE b.status<>'active' AND b.created_at > ? GROUP BY b.user_id HAVING wagered >= 100000 AND paid > wagered * 1.5 ORDER BY paid - wagered DESC LIMIT 50", t - 7 * DAY),
    failedLogins: all('SELECT id, login, nickname, failed_logins, locked_until, last_ip FROM users WHERE failed_logins >= 5 OR locked_until > ? ORDER BY failed_logins DESC LIMIT 50', t),
    adminCredits: all("SELECT l.*, u.nickname, a.nickname actor FROM ledger l JOIN users u ON u.id=l.user_id LEFT JOIN users a ON a.id=l.actor_id WHERE l.type='admin' AND l.created_at > ? ORDER BY ABS(l.amount) DESC LIMIT 50", t - 30 * DAY),
    referralFarms: all('SELECT r.id, r.nickname, COUNT(u.id) invited, COUNT(DISTINCT u.reg_ip) ips FROM users r JOIN users u ON u.referred_by=r.id GROUP BY r.id HAVING invited >= 3 AND ips * 2 <= invited ORDER BY invited DESC LIMIT 50'),
  };
}, { perm: 'users.view' });

// ================= Кейсы =================
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'case';
function caseFields(c: any, partial: boolean) {
  const b = c.body;
  const f: Record<string, any> = {};
  if (!partial || b.name !== undefined) f.name = v.str(b.name, 'Название', 2, 80);
  if (b.slug !== undefined || !partial) { const s = slugify(String(b.slug || b.name || '')); if (!/^[a-z0-9а-яё-]{2,60}$/i.test(s)) throw bad('Некорректный адрес кейса'); f.slug = s; }
  if (b.description !== undefined) f.description = v.optStr(b.description, 'Описание', 2000);
  if (b.image !== undefined) { const img = v.optStr(b.image, 'Обложка', 500); if (img && !/^\/(uploads\/public|img)\/[\w./-]+$/.test(img) && !/^https:\/\/[\w.-]+\/[\w./%-]+$/.test(img)) throw bad('Обложка: загрузите файл или укажите https-адрес'); f.image = img || null; }
  if (b.priceMode !== undefined) f.price_mode = v.oneOf(b.priceMode, 'Режим цены', ['auto', 'manual']);
  if (b.price !== undefined && b.price !== null && b.price !== '') f.price = v.money(b.price, 'Цена', 0.01, 1e7);
  if (b.categories !== undefined) { if (!Array.isArray(b.categories)) throw bad('Категории: ожидается список'); f.categories = JSON.stringify(b.categories.filter((x: any) => x in CASE_CATEGORIES)); }
  if (b.status !== undefined) f.status = v.oneOf(b.status, 'Статус', ['draft', 'published', 'hidden', 'archived']);
  if (b.sort !== undefined) f.sort = v.int(b.sort, 'Порядок', -1e6, 1e6);
  return f;
}
function adminCase(cs: any) {
  const rows = caseRows(cs.id);
  const W = rows.reduce((s, r) => s + r.weight, 0);
  return { ...caseCard(cs), description: cs.description, rawImage: cs.image, priceMode: cs.price_mode, sort: cs.sort, source: cs.source, rtp: cs.price ? cs.ev / cs.price : 0,
    contents: rows.map((r) => ({ ...itemView(r), weight: r.weight, chance: W ? r.weight / W : 0, ev: itemEV(r, cs) })) };
}
route('GET', '/api/admin/cases', (c) => {
  const { limit, offset, page: p } = page(c, 100);
  const q = (c.query.get('q') || '').trim();
  const st = c.query.get('status');
  const w = ['1=1'];
  const prm: any[] = [];
  if (q) { w.push('(name LIKE ? OR slug LIKE ?)'); prm.push(`%${q}%`, `%${q}%`); }
  if (st) { w.push('status=?'); prm.push(st); }
  return { rows: all(`SELECT * FROM cases WHERE ${w.join(' AND ')} ORDER BY sort, id LIMIT ? OFFSET ?`, ...prm, limit, offset).map((cs) => ({ ...caseCard(cs), priceMode: cs.price_mode, rtp: cs.price ? cs.ev / cs.price : 0, source: cs.source })),
    total: one(`SELECT COUNT(*) n FROM cases WHERE ${w.join(' AND ')}`, ...prm).n, page: p, categories: CASE_CATEGORIES };
}, { perm: 'cases.manage' });
route('GET', '/api/admin/cases/:id', (c) => {
  const cs = one('SELECT * FROM cases WHERE id=?', v.int(c.params.id, 'id', 1));
  if (!cs) throw notFound('Кейс не найден');
  return { case: adminCase(cs), categories: CASE_CATEGORIES };
}, { perm: 'cases.manage' });
route('POST', '/api/admin/cases', (c) => {
  const f = caseFields(c, false);
  if (one('SELECT 1 FROM cases WHERE slug=?', f.slug)) f.slug += '-' + Date.now().toString(36);
  const id = run('INSERT INTO cases(slug,name,description,image,price,price_mode,categories,status,sort,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    f.slug, f.name, f.description ?? null, f.image ?? null, f.price ?? 100, f.price_mode ?? 'auto', f.categories ?? '[]', f.status ?? 'draft', f.sort ?? 0, 'admin', now(), now()).lastInsertRowid;
  audit(c.user.id, 'case.create', 'case', id, f, c.ip);
  return { case: adminCase(one('SELECT * FROM cases WHERE id=?', id)) };
}, { perm: 'cases.manage' });
route('POST', '/api/admin/cases/:id', (c) => {
  const cs = one('SELECT * FROM cases WHERE id=?', v.int(c.params.id, 'id', 1));
  if (!cs) throw notFound('Кейс не найден');
  const f = caseFields(c, true);
  if (f.slug && f.slug !== cs.slug && one('SELECT 1 FROM cases WHERE slug=? AND id<>?', f.slug, cs.id)) throw bad('Адрес уже занят');
  if (f.status === 'published' && !one('SELECT 1 FROM case_items WHERE case_id=?', cs.id)) throw bad('Нельзя опубликовать пустой кейс');
  const keys = Object.keys(f);
  if (keys.length) run(`UPDATE cases SET ${keys.map((k) => `${k}=?`).join(', ')}, updated_at=? WHERE id=?`, ...keys.map((k) => f[k]), now(), cs.id);
  recalcCase(cs.id);
  audit(c.user.id, 'case.update', 'case', cs.id, f, c.ip);
  return { case: adminCase(one('SELECT * FROM cases WHERE id=?', cs.id)) };
}, { perm: 'cases.manage' });
route('POST', '/api/admin/cases/:id/items', (c) => {
  const cs = one('SELECT * FROM cases WHERE id=?', v.int(c.params.id, 'id', 1));
  if (!cs) throw notFound('Кейс не найден');
  if (!Array.isArray(c.body.items) || c.body.items.length > 1000) throw bad('Ожидается список до 1000 предметов');
  const items = c.body.items.map((x: any) => ({ itemId: v.int(x.itemId, 'Предмет', 1), weight: v.num(x.weight, 'Вес', 0.000001, 1e9) }));
  if (cs.status === 'published' && !items.length) throw bad('Опубликованный кейс не может быть пустым');
  tx(() => {
    run('DELETE FROM case_items WHERE case_id=?', cs.id);
    for (const it of items) {
      if (!one('SELECT 1 FROM items WHERE id=? AND archived=0', it.itemId)) throw bad(`Предмет #${it.itemId} недоступен`);
      run('INSERT INTO case_items(case_id,item_id,weight) VALUES(?,?,?) ON CONFLICT(case_id,item_id) DO UPDATE SET weight=excluded.weight', cs.id, it.itemId, it.weight);
    }
    recalcCase(cs.id);
    audit(c.user.id, 'case.items', 'case', cs.id, { items }, c.ip);
  });
  return { case: adminCase(one('SELECT * FROM cases WHERE id=?', cs.id)) };
}, { perm: 'cases.manage' });
route('POST', '/api/admin/cases/:id/delete', (c) => {
  const cs = one('SELECT * FROM cases WHERE id=?', v.int(c.params.id, 'id', 1));
  if (!cs) throw notFound('Кейс не найден');
  const used = cs.opens > 0 || one("SELECT 1 FROM bets WHERE game='case' AND json_extract(data,'$.caseId')=? LIMIT 1", cs.id);
  if (used) run("UPDATE cases SET status='archived', updated_at=? WHERE id=?", now(), cs.id);
  else tx(() => { run('DELETE FROM case_items WHERE case_id=?', cs.id); run('DELETE FROM cases WHERE id=?', cs.id); });
  audit(c.user.id, used ? 'case.archive' : 'case.delete', 'case', cs.id, { name: cs.name }, c.ip);
  return { ok: true, archived: !!used };
}, { perm: 'cases.manage' });
route('POST', '/api/admin/cases-generate', (c) => {
  const r = buildThemedCases();
  audit(c.user.id, 'case.generate', 'case', null, r, c.ip);
  return r;
}, { perm: 'cases.manage' });
route('POST', '/api/admin/cases-recalc', (c) => {
  recalcAllCases();
  audit(c.user.id, 'case.recalc', 'case', null, null, c.ip);
  return { ok: true };
}, { perm: 'cases.manage' });

// ================= Предметы =================
function itemFields(b: any, partial: boolean) {
  const f: Record<string, any> = {};
  const s = (k: string, col: string, name: string, max = 120, req = false) => { if (b[k] !== undefined || (!partial && req)) f[col] = req ? v.str(b[k], name, 1, max) : v.optStr(b[k], name, max) || null; };
  s('name', 'name', 'Название', 160, true);
  s('weapon', 'weapon', 'Оружие'); s('category', 'category', 'Категория'); s('pattern', 'pattern', 'Скин');
  s('rarity', 'rarity', 'Редкость (код)'); s('rarityName', 'rarity_name', 'Редкость'); s('collection', 'collection', 'Коллекция', 200); s('extId', 'ext_id', 'Внешний ID', 120);
  if (b.color !== undefined) { if (b.color && !/^#[0-9a-f]{6}$/i.test(b.color)) throw bad('Цвет: формат #RRGGBB'); f.rarity_color = b.color || null; }
  if (b.image !== undefined) { const img = v.optStr(b.image, 'Изображение', 600); if (img && !/^\/(uploads\/public|img)\/[\w./-]+$/.test(img) && !/^https:\/\/[\w.-]+\/[\w./%-]+$/.test(img)) throw bad('Изображение: загрузите файл или укажите https-адрес'); f.image = img || null; }
  if (b.minFloat !== undefined) f.min_float = v.num(b.minFloat, 'Min float', 0, 1);
  if (b.maxFloat !== undefined) f.max_float = v.num(b.maxFloat, 'Max float', 0, 1);
  if (b.stattrak !== undefined) f.stattrak = v.bool(b.stattrak) ? 1 : 0;
  if (b.souvenir !== undefined) f.souvenir = v.bool(b.souvenir) ? 1 : 0;
  if (b.archived !== undefined) f.archived = v.bool(b.archived) ? 1 : 0;
  if (b.price !== undefined && b.price !== '' && b.price !== null) { f.base_price = v.money(b.price, 'Цена', 0.01, 1e8); f.price_source = v.str(b.priceSource || 'manual', 'Источник цены', 2, 40); }
  if (f.min_float !== undefined && f.max_float !== undefined && f.min_float > f.max_float) throw bad('Min float больше max float');
  return f;
}
route('GET', '/api/admin/items', (c) => {
  const { limit, offset, page: p } = page(c, 60);
  const w = ['1=1'];
  const prm: any[] = [];
  const q = (c.query.get('q') || '').trim();
  if (q) { w.push('(name LIKE ? OR ext_id=? OR CAST(id AS TEXT)=?)'); prm.push(`%${q}%`, q, q); }
  for (const [k, col] of [['weapon', 'weapon'], ['rarity', 'rarity_name'], ['category', 'category']]) { const x = c.query.get(k); if (x) { w.push(`${col}=?`); prm.push(x); } }
  w.push(c.query.get('archived') === '1' ? 'archived=1' : 'archived=0');
  if (c.query.get('noimage') === '1') w.push("(image IS NULL OR image='')");
  if (c.query.get('noprice') === '1') w.push('base_price IS NULL AND NOT EXISTS (SELECT 1 FROM item_prices ip WHERE ip.item_id=items.id)');
  return { rows: all(`SELECT * FROM items WHERE ${w.join(' AND ')} ORDER BY id DESC LIMIT ? OFFSET ?`, ...prm, limit, offset).map((i) => ({ ...itemView(i), archived: !!i.archived, rawImage: i.image,
      prices: one('SELECT COUNT(*) n FROM item_prices WHERE item_id=?', i.id).n, inCases: one('SELECT COUNT(*) n FROM case_items WHERE item_id=?', i.id).n })),
    total: one(`SELECT COUNT(*) n FROM items WHERE ${w.join(' AND ')}`, ...prm).n, page: p, stats: catalogStats() };
}, { perm: 'items.manage' });
route('GET', '/api/admin/items/:id', (c) => {
  const i = one('SELECT * FROM items WHERE id=?', v.int(c.params.id, 'id', 1));
  if (!i) throw notFound('Предмет не найден');
  return { item: { ...itemView(i), archived: !!i.archived, rawImage: i.image }, prices: all('SELECT * FROM item_prices WHERE item_id=? ORDER BY variant, wear', i.id),
    cases: all('SELECT c.id, c.name, c.slug, ci.weight FROM case_items ci JOIN cases c ON c.id=ci.case_id WHERE ci.item_id=?', i.id) };
}, { perm: 'items.manage' });
route('POST', '/api/admin/items', (c) => {
  const f = itemFields(c.body, false);
  const cols = Object.keys(f);
  const id = run(`INSERT INTO items(${cols.join(',')},created_at,updated_at) VALUES(${cols.map(() => '?').join(',')},?,?)`, ...cols.map((k) => f[k]), now(), now()).lastInsertRowid;
  audit(c.user.id, 'item.create', 'item', id, f, c.ip);
  return { item: itemView(one('SELECT * FROM items WHERE id=?', id)) };
}, { perm: 'items.manage' });
route('POST', '/api/admin/items/:id', (c) => {
  const i = one('SELECT * FROM items WHERE id=?', v.int(c.params.id, 'id', 1));
  if (!i) throw notFound('Предмет не найден');
  const f = itemFields(c.body, true);
  const cols = Object.keys(f);
  if (cols.length) run(`UPDATE items SET ${cols.map((k) => `${k}=?`).join(', ')}, updated_at=? WHERE id=?`, ...cols.map((k) => f[k]), now(), i.id);
  for (const r of all('SELECT DISTINCT case_id FROM case_items WHERE item_id=?', i.id)) recalcCase(r.case_id);
  audit(c.user.id, 'item.update', 'item', i.id, f, c.ip);
  return { item: itemView(one('SELECT * FROM items WHERE id=?', i.id)) };
}, { perm: 'items.manage' });
route('POST', '/api/admin/items-bulk', (c) => {
  const ids = v.ids(c.body.ids, 'Предметы', 1, 5000);
  const f = itemFields(c.body.set || {}, true);
  delete f.name; delete f.ext_id;
  const cols = Object.keys(f);
  if (!cols.length) throw bad('Не выбраны поля для изменения');
  tx(() => {
    for (const id of ids) run(`UPDATE items SET ${cols.map((k) => `${k}=?`).join(', ')}, updated_at=? WHERE id=?`, ...cols.map((k) => f[k]), now(), id);
    audit(c.user.id, 'item.bulk', 'item', null, { ids, set: f }, c.ip);
  });
  recalcAllCases();
  return { updated: ids.length };
}, { perm: 'items.manage' });
route('GET', '/api/admin/items-duplicates', () => ({
  groups: all('SELECT name, COUNT(*) n, group_concat(id) ids FROM items WHERE archived=0 GROUP BY name COLLATE NOCASE HAVING n > 1 ORDER BY n DESC LIMIT 200').map((g) => ({ ...g, ids: String(g.ids).split(',').map(Number) })),
  noImage: all("SELECT id, name FROM items WHERE archived=0 AND (image IS NULL OR image='') LIMIT 200"),
}), { perm: 'items.manage' });
route('POST', '/api/admin/items-import', (c) => {
  const rows = parseImport(String(c.body.data || ''), c.body.format);
  const r = importItems(rows, v.str(c.body.source || 'admin-import', 'Источник', 2, 60));
  audit(c.user.id, 'item.import', 'item', null, { rows: rows.length, ...r, errors: r.errors.slice(0, 20) }, c.ip);
  return r;
}, { perm: 'items.manage' });
route('POST', '/api/admin/prices-import', (c) => {
  const rows = parseImport(String(c.body.data || ''), c.body.format);
  const r = importPrices(rows, v.str(c.body.source, 'Источник цен', 2, 60));
  recalcAllCases();
  audit(c.user.id, 'price.import', 'item', null, { rows: rows.length, ...r, errors: r.errors.slice(0, 20) }, c.ip);
  return r;
}, { perm: 'items.manage' });

// ================= Игры =================
route('GET', '/api/admin/games', () => {
  const t = now();
  return { settings: getSetting('games'),
    stats: all("SELECT game, COUNT(*) bets, COUNT(DISTINCT user_id) players, COALESCE(SUM(amount),0) wagered, COALESCE(SUM(payout),0) paid, MAX(payout) maxWin FROM bets WHERE status<>'active' AND created_at > ? GROUP BY game", t - 7 * DAY),
    active: all("SELECT game, COUNT(*) n FROM bets WHERE status='active' GROUP BY game"),
    rounds: all('SELECT id, game, status, hash, result, created_at, ended_at, CASE WHEN status=\'ended\' THEN seed END seed FROM rounds ORDER BY id DESC LIMIT 40'),
    battles: all('SELECT id, status, cost, total, max_players, mode, created_at, finished_at FROM battles ORDER BY id DESC LIMIT 30'),
    coinflips: all('SELECT id, status, amount, result, created_at FROM coinflips ORDER BY id DESC LIMIT 30'),
    errors: all("SELECT * FROM error_log WHERE path LIKE 'tick:%' OR path LIKE '/api/%' ORDER BY id DESC LIMIT 40"),
    recent: all("SELECT * FROM bets WHERE status<>'active' ORDER BY id DESC LIMIT 50").map(betView) };
}, { perm: 'games.manage' });
route('POST', '/api/admin/games', (c) => {
  const games = getSetting('games');
  const g = v.oneOf(c.body.game, 'Игра', Object.keys(games));
  const cur = games[g];
  const next = { enabled: c.body.enabled !== undefined ? v.bool(c.body.enabled) : cur.enabled,
    min: c.body.min !== undefined ? v.money(c.body.min, 'Минимум', 0, 1e9) : cur.min, max: c.body.max !== undefined ? v.money(c.body.max, 'Максимум', 0.01, 1e9) : cur.max };
  if (next.min > next.max) throw bad('Минимум больше максимума');
  setSetting('games', { ...games, [g]: next });
  audit(c.user.id, 'game.settings', 'game', g, { from: cur, to: next }, c.ip);
  return { settings: getSetting('games') };
}, { perm: 'games.manage' });

// ================= Универсальный CRUD: промокоды, задания, достижения, события, новости =================
type FieldSpec = [string, ...any[]];
const CRUD: Record<string, { perm: string; key: string; order: string; fields: Record<string, FieldSpec>; stamp?: boolean; by?: boolean }> = {
  promo_codes: { perm: 'bonuses.manage', key: 'id', order: 'id DESC', stamp: true, by: true, fields: { code: ['code'], amount: ['money', 0.01], max_uses: ['int', 0, 1e9], expires_at: ['ts'], active: ['bool'] } },
  quests: { perm: 'bonuses.manage', key: 'id', order: 'scope, sort, id', fields: { scope: ['oneOf', ['daily', 'weekly']], title: ['str', 2, 120], metric: ['oneOf', Object.keys(QUEST_METRICS)], goal: ['int', 1, 1e9], reward: ['money', 0], xp: ['int', 0, 1e6], active: ['bool'], sort: ['int', -1e6, 1e6] } },
  achievements: { perm: 'bonuses.manage', key: 'code', order: 'metric, goal', fields: { code: ['code'], title: ['str', 2, 120], description: ['opt', 500], metric: ['oneOf', Object.keys(QUEST_METRICS)], goal: ['int', 1, 1e12], reward: ['money', 0], icon: ['opt', 16], active: ['bool'] } },
  events: { perm: 'bonuses.manage', key: 'id', order: 'id DESC', stamp: true, fields: { kind: ['oneOf', ['event', 'marathon', 'tournament']], title: ['str', 2, 120], description: ['opt', 2000], metric: ['oneOf', Object.keys(EVENT_METRICS)], goal: ['int', 0, 1e12], reward: ['money', 0], prizes: ['prizes'], starts_at: ['ts'], ends_at: ['ts'], status: ['oneOf', ['draft', 'active', 'finished']] } },
  news: { perm: 'news.manage', key: 'id', order: 'id DESC', stamp: true, by: true, fields: { title: ['str', 2, 160], body: ['str', 1, 20000], image: ['opt', 500], kind: ['oneOf', ['news', 'promo', 'update']], published: ['bool'] } },
};
function parseField(spec: FieldSpec, x: any, name: string) {
  const [k, a, b] = spec;
  switch (k) {
    case 'str': return v.str(x, name, a, b);
    case 'opt': return v.optStr(x, name, a) || null;
    case 'int': return v.int(x, name, a, b);
    case 'money': return v.money(x, name, a, 1e9);
    case 'bool': return v.bool(x) ? 1 : 0;
    case 'oneOf': return v.oneOf(x, name, a);
    case 'code': { const s = v.str(x, name, 2, 40); if (!/^[\w-]+$/.test(s)) throw bad(`${name}: только латиница, цифры, _ и -`); return s; }
    case 'ts': { if (x === null || x === '' || x === undefined) return null; const t = typeof x === 'number' ? x : Date.parse(x); if (!Number.isFinite(t)) throw bad(`${name}: некорректная дата`); return t; }
    case 'prizes': { const arr = Array.isArray(x) ? x : String(x || '').split(/[,;\s]+/).filter(Boolean); if (arr.length > 100) throw bad('До 100 призов'); return JSON.stringify(arr.map((p: any) => v.money(p, 'Приз', 0.01, 1e9))); }
  }
  throw bad('Неизвестное поле');
}
function crudCfg(c: any) {
  const cfg = CRUD[c.params.entity];
  if (!cfg) throw notFound('Раздел не найден');
  if (!can(c.user, cfg.perm)) throw forbidden();
  return cfg;
}
route('GET', '/api/admin/crud/:entity', (c) => {
  const cfg = crudCfg(c);
  return { rows: all(`SELECT * FROM ${c.params.entity} ORDER BY ${cfg.order} LIMIT 1000`), fields: Object.fromEntries(Object.entries(cfg.fields).map(([k, s]) => [k, s[0]])),
    options: { quests: QUEST_METRICS, events: EVENT_METRICS } };
}, { perm: 'admin.access' });
route('POST', '/api/admin/crud/:entity', (c) => {
  const cfg = crudCfg(c);
  const f: Record<string, any> = {};
  for (const [k, s] of Object.entries(cfg.fields)) f[k] = parseField(s, c.body[k], k);
  if (cfg.stamp) f.created_at = now();
  if (cfg.by) f.created_by = c.user.id;
  const cols = Object.keys(f);
  const r = run(`INSERT INTO ${c.params.entity}(${cols.join(',')}) VALUES(${cols.map(() => '?').join(',')})`, ...cols.map((k) => f[k]));
  const id = cfg.key === 'id' ? r.lastInsertRowid : f[cfg.key];
  audit(c.user.id, `${c.params.entity}.create`, c.params.entity, id, f, c.ip);
  return { row: one(`SELECT * FROM ${c.params.entity} WHERE ${cfg.key}=?`, id) };
}, { perm: 'admin.access' });
route('POST', '/api/admin/crud/:entity/:id', (c) => {
  const cfg = crudCfg(c);
  const cur = one(`SELECT * FROM ${c.params.entity} WHERE ${cfg.key}=?`, c.params.id);
  if (!cur) throw notFound('Запись не найдена');
  const f: Record<string, any> = {};
  for (const [k, s] of Object.entries(cfg.fields)) if (c.body[k] !== undefined && k !== cfg.key) f[k] = parseField(s, c.body[k], k);
  const cols = Object.keys(f);
  if (cols.length) run(`UPDATE ${c.params.entity} SET ${cols.map((k) => `${k}=?`).join(', ')} WHERE ${cfg.key}=?`, ...cols.map((k) => f[k]), c.params.id);
  audit(c.user.id, `${c.params.entity}.update`, c.params.entity, c.params.id, f, c.ip);
  return { row: one(`SELECT * FROM ${c.params.entity} WHERE ${cfg.key}=?`, c.params.id) };
}, { perm: 'admin.access' });
route('POST', '/api/admin/crud/:entity/:id/delete', (c) => {
  const cfg = crudCfg(c);
  const cur = one(`SELECT * FROM ${c.params.entity} WHERE ${cfg.key}=?`, c.params.id);
  if (!cur) throw notFound('Запись не найдена');
  if ('active' in cfg.fields) run(`UPDATE ${c.params.entity} SET active=0 WHERE ${cfg.key}=?`, c.params.id);
  else if (c.params.entity === 'events') run("UPDATE events SET status='draft' WHERE id=?", c.params.id);
  else run(`DELETE FROM ${c.params.entity} WHERE ${cfg.key}=?`, c.params.id);
  audit(c.user.id, `${c.params.entity}.delete`, c.params.entity, c.params.id, cur, c.ip);
  return { ok: true };
}, { perm: 'admin.access' });

// ================= BURGER PASS =================
function seasonView(s: any) {
  return { ...s, rewards: one('SELECT COUNT(*) n FROM pass_rewards WHERE season_id=?', s.id).n, players: one('SELECT COUNT(*) n FROM pass_progress WHERE season_id=?', s.id).n,
    premiumPlayers: one('SELECT COUNT(*) n FROM pass_progress WHERE season_id=? AND premium=1', s.id).n };
}
function seasonFields(b: any, partial: boolean) {
  const f: Record<string, any> = {};
  if (!partial || b.name !== undefined) f.name = v.str(b.name, 'Название', 2, 80);
  if (!partial || b.xpPerLevel !== undefined) f.xp_per_level = v.int(b.xpPerLevel ?? 500, 'XP на уровень', 10, 1e7);
  if (!partial || b.premiumPrice !== undefined) f.premium_price = v.money(b.premiumPrice ?? 0, 'Цена Premium', 0, 1e7);
  if (b.startsAt !== undefined) f.starts_at = parseField(['ts'], b.startsAt, 'Начало');
  if (b.endsAt !== undefined) f.ends_at = parseField(['ts'], b.endsAt, 'Окончание');
  return f;
}
route('GET', '/api/admin/pass', () => ({ seasons: all('SELECT * FROM pass_seasons ORDER BY id DESC').map(seasonView) }), { perm: 'pass.manage' });
route('GET', '/api/admin/pass/:id', (c) => {
  const s = one('SELECT * FROM pass_seasons WHERE id=?', v.int(c.params.id, 'id', 1));
  if (!s) throw notFound('Сезон не найден');
  return { season: seasonView(s), rewards: all('SELECT r.*, i.name item_name, i.image item_image, c.name case_name FROM pass_rewards r LEFT JOIN items i ON i.id=r.item_id LEFT JOIN cases c ON c.id=r.case_id WHERE season_id=? ORDER BY level, track', s.id)
    .map((r) => ({ ...r, item_image: r.item_image ? imageUrl(r.item_image) : null })) };
}, { perm: 'pass.manage' });
route('POST', '/api/admin/pass', (c) => {
  const f = seasonFields(c.body, false);
  const id = run('INSERT INTO pass_seasons(name,status,xp_per_level,premium_price,starts_at,ends_at,created_at) VALUES(?,?,?,?,?,?,?)', f.name, 'draft', f.xp_per_level, f.premium_price, f.starts_at ?? null, f.ends_at ?? null, now()).lastInsertRowid;
  audit(c.user.id, 'pass.create', 'season', id, f, c.ip);
  return { season: seasonView(one('SELECT * FROM pass_seasons WHERE id=?', id)) };
}, { perm: 'pass.manage' });
route('POST', '/api/admin/pass/:id', (c) => {
  const s = one('SELECT * FROM pass_seasons WHERE id=?', v.int(c.params.id, 'id', 1));
  if (!s) throw notFound('Сезон не найден');
  const f = seasonFields(c.body, true);
  const cols = Object.keys(f);
  if (cols.length) run(`UPDATE pass_seasons SET ${cols.map((k) => `${k}=?`).join(', ')} WHERE id=?`, ...cols.map((k) => f[k]), s.id);
  audit(c.user.id, 'pass.update', 'season', s.id, f, c.ip);
  return { season: seasonView(one('SELECT * FROM pass_seasons WHERE id=?', s.id)) };
}, { perm: 'pass.manage' });
export function generatePassRewards(seasonId: number, o: { base?: number; step?: number; premiumMult?: number } = {}) {
  const base = o.base ?? 500, step = o.step ?? 50, mult = o.premiumMult ?? 2.5;
  const casesByPrice = all("SELECT id, price FROM cases WHERE status='published' ORDER BY price");
  const caseAt = (frac: number) => casesByPrice.length ? casesByPrice[Math.min(casesByPrice.length - 1, Math.floor(frac * casesByPrice.length))].id : null;
  const topItems = all("SELECT id FROM items WHERE archived=0 AND (image IS NOT NULL AND image<>'') ORDER BY COALESCE(base_price,0) DESC LIMIT 40").map((x) => x.id);
  let n = 0;
  const put = (level: number, trackName: string, type: string, amount: number, itemId: number | null, caseId: number | null, label: string) => {
    run('INSERT INTO pass_rewards(season_id,level,track,type,amount,item_id,case_id,label) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(season_id,level,track) DO UPDATE SET type=excluded.type, amount=excluded.amount, item_id=excluded.item_id, case_id=excluded.case_id, label=excluded.label',
      seasonId, level, trackName, type, amount, itemId, caseId, label);
    n++;
  };
  tx(() => {
    for (let L = 1; L <= 100; L++) {
      const coins = base + step * L;
      const cFree = L % 10 === 0 ? caseAt(L / 140) : null;
      if (cFree) put(L, 'free', 'case', 0, null, cFree, `Кейс за ${L} уровень`);
      else put(L, 'free', 'balance', coins, null, null, `${rub(coins)}`);
      const itemIdx = L === 100 ? 0 : L === 75 ? 3 : L === 50 ? 8 : L === 25 ? 15 : -1;
      if (itemIdx >= 0 && topItems.length) put(L, 'premium', 'item', 0, topItems[Math.min(itemIdx, topItems.length - 1)], null, `Скин за ${L} уровень`);
      else if (L % 5 === 0 && casesByPrice.length) put(L, 'premium', 'case', 0, null, caseAt(0.3 + L / 200), `Премиум-кейс за ${L} уровень`);
      else put(L, 'premium', 'balance', Math.round(coins * mult), null, null, `${rub(Math.round(coins * mult))}`);
    }
  });
  return n;
}
route('POST', '/api/admin/pass/:id/generate', (c) => {
  const s = one('SELECT * FROM pass_seasons WHERE id=?', v.int(c.params.id, 'id', 1));
  if (!s) throw notFound('Сезон не найден');
  const n = generatePassRewards(s.id, { base: c.body.base !== undefined ? v.money(c.body.base, 'База', 0, 1e6) : undefined, step: c.body.step !== undefined ? v.money(c.body.step, 'Шаг', 0, 1e6) : undefined,
    premiumMult: c.body.premiumMult !== undefined ? v.num(c.body.premiumMult, 'Множитель Premium', 1, 20) : undefined });
  audit(c.user.id, 'pass.generate', 'season', s.id, { rewards: n }, c.ip);
  return { rewards: n };
}, { perm: 'pass.manage' });
route('POST', '/api/admin/pass/:id/reward', (c) => {
  const s = one('SELECT * FROM pass_seasons WHERE id=?', v.int(c.params.id, 'id', 1));
  if (!s) throw notFound('Сезон не найден');
  const level = v.int(c.body.level, 'Уровень', 1, 100);
  const track = v.oneOf(c.body.track, 'Ветка', ['free', 'premium']);
  const type = v.oneOf(c.body.type, 'Тип', ['balance', 'item', 'case', 'none']);
  if (type === 'none') run('DELETE FROM pass_rewards WHERE season_id=? AND level=? AND track=?', s.id, level, track);
  else {
    const amount = type === 'balance' ? v.money(c.body.amount, 'Сумма', 0.01, 1e7) : 0;
    const itemId = type === 'item' ? v.int(c.body.itemId, 'Предмет', 1) : null;
    const caseId = type === 'case' ? v.int(c.body.caseId, 'Кейс', 1) : null;
    if (itemId && !one('SELECT 1 FROM items WHERE id=?', itemId)) throw bad('Предмет не найден');
    if (caseId && !one('SELECT 1 FROM cases WHERE id=?', caseId)) throw bad('Кейс не найден');
    run('INSERT INTO pass_rewards(season_id,level,track,type,amount,item_id,case_id,label) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(season_id,level,track) DO UPDATE SET type=excluded.type, amount=excluded.amount, item_id=excluded.item_id, case_id=excluded.case_id, label=excluded.label',
      s.id, level, track, type, amount, itemId, caseId, v.optStr(c.body.label, 'Подпись', 80) || null);
  }
  audit(c.user.id, 'pass.reward', 'season', s.id, { level, track, type }, c.ip);
  return { ok: true };
}, { perm: 'pass.manage' });
route('POST', '/api/admin/pass/:id/publish', (c) => {
  const s = one('SELECT * FROM pass_seasons WHERE id=?', v.int(c.params.id, 'id', 1));
  if (!s) throw notFound('Сезон не найден');
  if (one('SELECT COUNT(*) n FROM pass_rewards WHERE season_id=?', s.id).n === 0) throw bad('Добавьте награды перед публикацией');
  tx(() => {
    run("UPDATE pass_seasons SET status='ended' WHERE status='active' AND id<>?", s.id);
    run("UPDATE pass_seasons SET status='active', starts_at=COALESCE(starts_at, ?) WHERE id=?", now(), s.id);
  });
  audit(c.user.id, 'pass.publish', 'season', s.id, null, c.ip);
  broadcast('pass', { id: s.id });
  return { season: seasonView(one('SELECT * FROM pass_seasons WHERE id=?', s.id)) };
}, { perm: 'pass.manage' });
route('POST', '/api/admin/pass/:id/end', (c) => {
  const id = v.int(c.params.id, 'id', 1);
  run("UPDATE pass_seasons SET status='ended', ends_at=COALESCE(ends_at, ?) WHERE id=?", now(), id);
  audit(c.user.id, 'pass.end', 'season', id, null, c.ip);
  return { season: seasonView(one('SELECT * FROM pass_seasons WHERE id=?', id)) };
}, { perm: 'pass.manage' });

// ================= Финансовые заявки =================
route('GET', '/api/admin/finance', (c) => {
  const { limit, offset, page: p } = page(c);
  const w = ['1=1'];
  const prm: any[] = [];
  for (const k of ['status', 'kind']) { const x = c.query.get(k); if (x) { w.push(`${k}=?`); prm.push(x); } }
  const uid = c.query.get('user');
  if (uid) { w.push('user_id=?'); prm.push(Number(uid)); }
  return { rows: all(`SELECT * FROM finance_requests WHERE ${w.join(' AND ')} ORDER BY status='pending' DESC, id DESC LIMIT ? OFFSET ?`, ...prm, limit, offset).map((r) => ({ ...finView(r), staff: r.staff_id ? publicUser(one('SELECT * FROM users WHERE id=?', r.staff_id)) : null })),
    total: one(`SELECT COUNT(*) n FROM finance_requests WHERE ${w.join(' AND ')}`, ...prm).n, page: p, providers: paymentProviders().map((x) => ({ id: x.id, name: x.name })) };
}, { perm: 'finance.manage' });
route('POST', '/api/admin/finance/:id/decide', (c) => {
  const r = one('SELECT * FROM finance_requests WHERE id=?', v.int(c.params.id, 'id', 1));
  if (!r) throw notFound('Заявка не найдена');
  if (r.user_id === c.user.id) throw forbidden('Нельзя обрабатывать собственные заявки');
  const decision = v.oneOf(c.body.decision, 'Решение', ['approve', 'reject']);
  const comment = v.str(c.body.comment, 'Комментарий', 3, 1000);
  const status = decision === 'approve' ? 'approved' : 'rejected';
  tx(() => {
    if (run("UPDATE finance_requests SET status=?, staff_id=?, comment=?, decided_at=? WHERE id=? AND status='pending'", status, c.user.id, comment, now(), r.id).changes !== 1) throw bad('Заявка уже обработана');
    if (r.kind === 'deposit' && status === 'approved') change(r.user_id, r.amount, 'deposit', { ref: 'finance', refId: r.id, reason: 'Пополнение подтверждено', actor: c.user.id });
    if (r.kind === 'withdraw' && r.inv_id) run('UPDATE inventory SET status=?, updated_at=? WHERE id=? AND status=?', status === 'approved' ? 'withdrawn' : 'owned', now(), r.inv_id, 'withdrawing');
    audit(c.user.id, `finance.${decision}`, 'finance', r.id, { kind: r.kind, amount: r.amount, comment }, c.ip);
    notify(r.user_id, 'finance', `Заявка #${r.id}: ${status === 'approved' ? 'одобрена' : 'отклонена'}`, comment, '/balance');
  });
  return { request: finView(one('SELECT * FROM finance_requests WHERE id=?', r.id)) };
}, { perm: 'finance.manage', idem: true });

// ================= Поддержка =================
route('GET', '/api/admin/tickets', (c) => {
  const { limit, offset, page: p } = page(c);
  const w = ['1=1'];
  const prm: any[] = [];
  const st = c.query.get('status');
  if (st === 'active') w.push("status<>'closed'"); else if (st) { w.push('status=?'); prm.push(st); }
  const pr = c.query.get('priority');
  if (pr) { w.push('priority=?'); prm.push(pr); }
  const as = c.query.get('assignee');
  if (as === 'me') { w.push('assignee_id=?'); prm.push(c.user.id); } else if (as === 'none') w.push('assignee_id IS NULL');
  const q = (c.query.get('q') || '').trim();
  if (q) { w.push('(subject LIKE ? OR CAST(id AS TEXT)=?)'); prm.push(`%${q}%`, q); }
  return { rows: all(`SELECT * FROM tickets WHERE ${w.join(' AND ')} ORDER BY status='closed', CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, updated_at DESC LIMIT ? OFFSET ?`, ...prm, limit, offset).map((t) => ticketView(t)),
    total: one(`SELECT COUNT(*) n FROM tickets WHERE ${w.join(' AND ')}`, ...prm).n, page: p, statuses: TICKET_STATUSES, priorities: TICKET_PRIORITIES,
    staff: all("SELECT * FROM users WHERE role<>'USER' AND status='active'").filter((u) => permsOf(u.role).includes('support.manage')).map(publicUser) };
}, { perm: 'support.manage' });
route('GET', '/api/admin/tickets/:id', (c) => {
  const t = one('SELECT * FROM tickets WHERE id=?', v.int(c.params.id, 'id', 1));
  if (!t) throw notFound('Обращение не найдено');
  const u = one('SELECT * FROM users WHERE id=?', t.user_id);
  return { ticket: ticketView(t, true), user: { ...publicUser(u), login: u.login, email: u.email, balance: u.balance, status: u.status }, statuses: TICKET_STATUSES, priorities: TICKET_PRIORITIES,
    staff: all("SELECT * FROM users WHERE role<>'USER' AND status='active'").filter((x) => permsOf(x.role).includes('support.manage')).map(publicUser),
    history: all('SELECT id, subject, status, created_at FROM tickets WHERE user_id=? AND id<>? ORDER BY id DESC LIMIT 10', t.user_id, t.id) };
}, { perm: 'support.manage' });
route('POST', '/api/admin/tickets/:id/reply', (c) => {
  const t = one('SELECT * FROM tickets WHERE id=?', v.int(c.params.id, 'id', 1));
  if (!t) throw notFound('Обращение не найдено');
  const body = v.str(c.body.body, 'Ответ', 1, 5000);
  let att = null;
  if (c.body.attachment) { const up = one("SELECT * FROM uploads WHERE id=? AND owner_id=? AND kind='ticket'", String(c.body.attachment), c.user.id); if (!up) throw bad('Вложение не найдено'); att = up.id; }
  tx(() => {
    run('INSERT INTO ticket_messages(ticket_id,user_id,staff,body,attachment,created_at) VALUES(?,?,1,?,?,?)', t.id, c.user.id, body, att, now());
    run("UPDATE tickets SET status=?, assignee_id=COALESCE(assignee_id, ?), updated_at=? WHERE id=?", c.body.close ? 'closed' : 'answered', c.user.id, now(), t.id);
    audit(c.user.id, 'ticket.reply', 'ticket', t.id, { close: !!c.body.close }, c.ip);
    notify(t.user_id, 'support', `Ответ поддержки по обращению #${t.id}`, t.subject, `/support/${t.id}`);
  });
  const u = one('SELECT email, notify_email FROM users WHERE id=?', t.user_id);
  if (u?.email && u.notify_email && mailConfigured()) sendMail(u.email, `BURGER SKIN: ответ по обращению #${t.id}`, `${t.subject}\n\n${body}\n\nОтветить: ${(process.env.PUBLIC_URL || '') + '/support/' + t.id}`).catch(() => {});
  return { ticket: ticketView(one('SELECT * FROM tickets WHERE id=?', t.id), true) };
}, { perm: 'support.manage', idem: true });
route('POST', '/api/admin/tickets/:id/update', (c) => {
  const t = one('SELECT * FROM tickets WHERE id=?', v.int(c.params.id, 'id', 1));
  if (!t) throw notFound('Обращение не найдено');
  const f: Record<string, any> = {};
  if (c.body.status !== undefined) f.status = v.oneOf(c.body.status, 'Статус', Object.keys(TICKET_STATUSES));
  if (c.body.priority !== undefined) f.priority = v.oneOf(c.body.priority, 'Приоритет', Object.keys(TICKET_PRIORITIES));
  if (c.body.assigneeId !== undefined) {
    if (c.body.assigneeId === null || c.body.assigneeId === '') f.assignee_id = null;
    else { const a = one('SELECT * FROM users WHERE id=?', v.int(c.body.assigneeId, 'Сотрудник', 1)); if (!a || !permsOf(a.role).includes('support.manage')) throw bad('Сотрудник не может вести обращения'); f.assignee_id = a.id;
      if (a.id !== c.user.id) notify(a.id, 'support', `Вам назначено обращение #${t.id}`, t.subject, `/admin/support/${t.id}`); }
  }
  const cols = Object.keys(f);
  if (!cols.length) throw bad('Нечего изменять');
  run(`UPDATE tickets SET ${cols.map((k) => `${k}=?`).join(', ')}, updated_at=? WHERE id=?`, ...cols.map((k) => f[k]), now(), t.id);
  audit(c.user.id, 'ticket.update', 'ticket', t.id, f, c.ip);
  if (f.status && f.status !== t.status) notify(t.user_id, 'support', `Обращение #${t.id}: ${TICKET_STATUSES[f.status]}`, t.subject, `/support/${t.id}`);
  return { ticket: ticketView(one('SELECT * FROM tickets WHERE id=?', t.id), true) };
}, { perm: 'support.manage' });

// ================= Апгрейдер: история для владельца =================
route('GET', '/api/admin/upgrades', (c) => {
  const q = String(c.query.get('q') || '').trim().slice(0, 60);
  const res = String(c.query.get('result') || '');
  const page = Math.max(1, Math.floor(Number(c.query.get('page') || 1)));
  const per = 50;
  let where = "b.game='upgrade'";
  const p: any[] = [];
  if (res === 'won' || res === 'lost') { where += ' AND b.status=?'; p.push(res); }
  if (q) { where += ' AND (u.nickname LIKE ? OR u.login LIKE ? OR b.id=? OR b.user_id=?)'; p.push('%' + q + '%', '%' + q + '%', Number(q) || -1, Number(q) || -1); }
  const total = one(`SELECT COUNT(*) n FROM bets b JOIN users u ON u.id=b.user_id WHERE ${where}`, ...p).n;
  const rows = all(`SELECT b.*, u.nickname, u.login FROM bets b JOIN users u ON u.id=b.user_id WHERE ${where} ORDER BY b.id DESC LIMIT ? OFFSET ?`, ...p, per, (page - 1) * per);
  const stats = one("SELECT COUNT(*) n, COALESCE(SUM(amount),0) wagered, COALESCE(SUM(payout),0) paid, COALESCE(SUM(status='won'),0) wins FROM bets WHERE game='upgrade'");
  return { total, page, per, stats, rows: rows.map((b: any) => {
    let d: any = {};
    try { d = JSON.parse(b.data || '{}'); } catch { d = {}; }
    return { id: b.id, user: { id: b.user_id, nickname: b.nickname, login: b.login }, amount: b.amount, payout: b.payout, multiplier: b.multiplier, status: b.status,
      chance: d.chance ?? null, roll: d.roll ?? null, inputs: d.inputs || [], target: d.target || null, nonce: b.nonce, serverHash: b.server_hash, createdAt: b.created_at };
  }) };
}, { perm: 'games.manage' });

// ================= Обложки кейсов =================
route('GET', '/api/admin/covers', () => {
  const rows = all("SELECT * FROM cases WHERE status<>'archived' ORDER BY sort, id");
  const list = rows.map((cs: any) => ({ id: cs.id, slug: cs.slug, name: cs.name, status: cs.status, image: cs.image || null, coverMode: cs.cover_mode || 'auto', cover: caseCover(cs),
    candidates: all('SELECT i.id, i.name, i.image, i.rarity_color FROM case_items ci JOIN items i ON i.id=ci.item_id WHERE ci.case_id=? ORDER BY COALESCE(i.base_price,0) DESC LIMIT 24', cs.id)
      .map((i: any) => ({ id: i.id, name: i.name, image: imageUrl(i.image), color: i.rarity_color, real: !!i.image })) }));
  return { cases: list, missing: list.filter((x: any) => x.cover.missing).map((x: any) => ({ id: x.id, slug: x.slug, name: x.name })) };
}, { perm: 'cases.manage' });
route('POST', '/api/admin/cases/:id/cover', (c) => {
  const cs = one('SELECT * FROM cases WHERE id=?', v.int(c.params.id, 'id', 1));
  if (!cs) throw bad('Кейс не найден');
  const mode = c.body.mode === 'image' ? 'image' : 'auto';
  let image = cs.image;
  if (mode === 'image') {
    image = String(c.body.image || cs.image || '');
    if (!/^\/(uploads\/public|img)\/[\w./-]+$/.test(image) || /^\/img\/cases\//.test(image)) throw bad('Обложка: загрузите изображение (PNG, JPG или WebP)');
  }
  const items = Array.isArray(c.body.items) ? [...new Set(c.body.items.map(Number).filter((x: number) => Number.isInteger(x) && x > 0))].slice(0, 3) : [];
  for (const id of items) if (!one('SELECT 1 x FROM case_items WHERE case_id=? AND item_id=?', cs.id, id)) throw bad('Предмет для обложки должен входить в состав кейса');
  run('UPDATE cases SET cover_mode=?, cover_items=?, image=?, updated_at=? WHERE id=?', mode, items.length ? JSON.stringify(items) : null, image, now(), cs.id);
  audit(c.user.id, 'case.cover', 'case', cs.id, { mode, items, image }, c.ip);
  return { cover: caseCover(one('SELECT * FROM cases WHERE id=?', cs.id)) };
}, { perm: 'cases.manage' });

// ================= Премиум-каталог: список желаемых предметов =================
route('GET', '/api/admin/catalog/wishlist', () => {
  const file = 'scripts/premium-wishlist.json';
  let doc: any = {};
  try { doc = JSON.parse(readFileSyncW(file, 'utf8')); } catch { doc = {}; }
  const items = (Array.isArray(doc.items) ? doc.items : []).map((w: any) => {
    const it = one('SELECT id, image FROM items WHERE name=? AND archived=0', String(w.name || ''));
    const priced = it ? one('SELECT COUNT(*) n FROM item_prices WHERE item_id=?', it.id).n > 0 : false;
    return { name: w.name, group: w.group || '', tags: w.tags || [], inCatalog: !!it, itemId: it?.id || null, image: !!it?.image, priced };
  });
  return { file, groups: doc.groups || {}, total: items.length, inCatalog: items.filter((x: any) => x.inCatalog).length, missing: items.filter((x: any) => !x.inCatalog).length, items };
}, { perm: 'cases.manage' });

// ================= Системные настройки =================
const SETTING_PERM: Record<string, string> = { site: 'settings.manage', banner: 'settings.manage', features: 'settings.manage', maintenance: 'settings.manage', economy: 'settings.manage',
  notifications: 'settings.manage', finance: 'settings.manage', daily: 'bonuses.manage', referral: 'bonuses.manage', games: 'games.manage',
  sound: 'settings.manage', upgrade: 'games.manage', drop_fx: 'settings.manage' };
function sanitize(def: any, val: any): any {
  if (def === null || typeof def !== 'object' || Array.isArray(def)) {
    if (typeof def === 'number') { const n = Number(val); return Number.isFinite(n) ? n : def; }
    if (typeof def === 'boolean') return val === true || val === 'true' || val === 1;
    if (typeof def === 'string') return typeof val === 'string' ? val.slice(0, 2000) : def;
    return def;
  }
  const out: any = {};
  for (const k of Object.keys(def)) out[k] = val && typeof val === 'object' && k in val ? sanitize(def[k], val[k]) : def[k];
  return out;
}
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
route('GET', '/api/admin/settings', (c) => ({
  settings: Object.fromEntries(Object.keys(SETTING_PERM).filter((k) => can(c.user, SETTING_PERM[k])).map((k) => [k, getSetting(k)])),
  env: { publicUrl: process.env.PUBLIC_URL || null, steamApiKey: !!process.env.STEAM_API_KEY, smtp: mailConfigured(), cookieSecure: process.env.COOKIE_SECURE === '1',
    paymentProviders: paymentProviders().map((p) => p.name), node: process.version, dataDir: DATA },
  perms: SETTING_PERM,
}), { perm: 'admin.access' });
route('POST', '/api/admin/settings', (c) => {
  const key = v.oneOf(c.body.key, 'Раздел', Object.keys(SETTING_PERM));
  if (!can(c.user, SETTING_PERM[key])) throw forbidden();
  let val = sanitize(DEFAULTS[key], { ...getSetting(key), ...(c.body.value || {}) });
  if (key === 'economy') { val.sell_rate = clamp(val.sell_rate, 0.5, 1); val.case_margin = clamp(val.case_margin, 0, 1); val.upgrade_rtp = clamp(val.upgrade_rtp, 0.5, 0.99);
    val.upgrade_max_chance = clamp(val.upgrade_max_chance, 0.05, 0.95); val.contract_min = clamp(Math.round(val.contract_min), 2, 10); val.contract_max = clamp(Math.round(val.contract_max), val.contract_min, 20); val.welcome_bonus = clamp(Math.round(val.welcome_bonus), 0, 1e7); }
  if (key === 'upgrade') {
    const src = c.body.value && 'presets' in c.body.value ? c.body.value.presets : getSetting('upgrade').presets;
    const list = (Array.isArray(src) ? src : String(src).split(/[\s,;]+/)).map((x: any) => Math.round(Number(String(x).replace(',', '.').replace(/x$/i, '')) * 100) / 100).filter((x: number) => Number.isFinite(x));
    val.rtp = clamp(val.rtp, 0.5, 0.99); val.max_chance = clamp(val.max_chance, 0.05, 0.95); val.curve = clamp(val.curve, 1, 2);
    val.min_mult = clamp(Math.round(val.min_mult * 100) / 100, 1.01, 5);
    val.max_mult = clamp(Math.round(val.max_mult * 100) / 100, Math.max(1.5, val.min_mult + 0.1), 1000);
    val.min_chance = clamp(val.min_chance, 0.0001, Math.min(val.max_chance, val.rtp / val.max_mult));
    val.max_items = clamp(Math.round(val.max_items), 1, 10); val.tolerance = clamp(val.tolerance, 0.02, 0.5);
    val.presets = [...new Set(list.filter((x: number) => x >= val.min_mult && x <= val.max_mult))].sort((x: any, y: any) => x - y).slice(0, 8);
    if (!val.presets.length) throw bad('Укажите хотя бы один множитель в пределах минимального и максимального');
  }
  if (key === 'sound') { val.master = clamp(val.master, 0, 1); val.effects = clamp(val.effects, 0, 1); val.upgrade = clamp(val.upgrade, 0, 1); val.cinema = clamp(val.cinema, 0, 1); }
  if (key === 'drop_fx') {
    for (const k of ['godlike', 'mythic', 'divine']) val[k] = clamp(Math.round(val[k]), 100, 1e11);
    if (!(val.godlike < val.mythic && val.mythic < val.divine)) throw bad('Пороги должны возрастать: GODLIKE < MYTHIC < DIVINE');
    val.min_x = clamp(Math.round(val.min_x * 100) / 100, 0, 1000);
    if (!['full', 'short', 'off'].includes(val.default_mode)) val.default_mode = 'full';
  }
  if (key === 'daily') { val.base = clamp(Math.round(val.base), 0, 1e7); val.step = clamp(Math.round(val.step), 0, 1e7); val.max_streak = clamp(Math.round(val.max_streak), 1, 60); }
  if (key === 'referral') { val.invitee_bonus = clamp(Math.round(val.invitee_bonus), 0, 1e7); val.inviter_bonus = clamp(Math.round(val.inviter_bonus), 0, 1e7); val.threshold_bc = clamp(Math.round(val.threshold_bc), 0, 1e7); }
  if (key === 'site' && val.logo && !/^\/(uploads\/public|img)\/[\w./-]+$/.test(val.logo)) throw bad('Логотип: загрузите файл');
  if (key === 'banner' && val.image && !/^\/(uploads\/public|img)\/[\w./-]+$/.test(val.image)) throw bad('Баннер: загрузите файл');
  if (key === 'features' && (val.deposit && !paymentProviders().length)) throw bad('Пополнение нельзя включить: не подключён ни один одобренный платёжный провайдер (см. README)');
  const before = getSetting(key);
  setSetting(key, val);
  if (key === 'economy') { recalcAllCases(); setSetting('upgrade', { ...getSetting('upgrade'), rtp: val.upgrade_rtp, max_chance: val.upgrade_max_chance }); }
  if (key === 'upgrade') setSetting('economy', { ...getSetting('economy'), upgrade_rtp: val.rtp, upgrade_max_chance: val.max_chance });
  audit(c.user.id, 'settings.update', 'settings', key, { before, after: val }, c.ip);
  broadcast('settings', { key });
  return { key, value: getSetting(key) };
}, { perm: 'admin.access' });

// Кинодропы: сколько цен каталога попадает в каждый уровень и шанс кинодропа по кейсам — для настройки порогов.
route('GET', '/api/admin/drop-fx', () => dropFxStats(caseDetail), { perm: 'settings.manage' });

// ================= Роли и разрешения =================
route('GET', '/api/admin/roles', (c) => ({
  perms: PERMS, defaults: DEFAULT_ROLE_PERMS, current: Object.fromEntries(['ADMIN', 'MODERATOR', 'SUPPORT'].map((r) => [r, permsOf(r)])), editable: c.user.role === 'OWNER',
  staff: all("SELECT * FROM users WHERE role<>'USER' ORDER BY role, id").map((u) => ({ ...publicUser(u), login: u.login, status: u.status })),
}), { perm: 'users.roles' });
route('POST', '/api/admin/roles', (c) => {
  if (c.user.role !== 'OWNER') throw forbidden('Изменять разрешения ролей может только владелец');
  const src = c.body.perms || {};
  const next: Record<string, string[]> = {};
  for (const r of ['ADMIN', 'MODERATOR', 'SUPPORT']) {
    const list = Array.isArray(src[r]) ? src[r].filter((p: any) => typeof p === 'string' && p in PERMS) : permsOf(r);
    if (list.length && !list.includes('admin.access')) list.push('admin.access');
    next[r] = [...new Set(list)] as string[];
  }
  const before = Object.fromEntries(['ADMIN', 'MODERATOR', 'SUPPORT'].map((r) => [r, permsOf(r)]));
  setSetting('role_permissions', next);
  audit(c.user.id, 'roles.update', 'settings', 'role_permissions', { before, after: next }, c.ip);
  return { current: next };
}, { perm: 'users.roles' });

// ================= Журналы =================
function auditRows(where: string, prm: any[], limit: number, offset: number) {
  return all(`SELECT a.*, u.nickname actor FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id WHERE ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`, ...prm, limit, offset)
    .map((a) => ({ id: a.id, actorId: a.actor_id, actor: a.actor, action: a.action, targetType: a.target_type, targetId: a.target_id, data: a.data ? JSON.parse(a.data) : null, ip: a.ip, createdAt: a.created_at }));
}
route('GET', '/api/admin/audit', (c) => {
  const { limit, offset, page: p } = page(c);
  const w = ['1=1'];
  const prm: any[] = [];
  const action = c.query.get('action');
  if (action) { w.push('a.action LIKE ?'); prm.push(`${action}%`); }
  const actor = c.query.get('actor');
  if (actor) { w.push('a.actor_id=?'); prm.push(Number(actor)); }
  const tt = c.query.get('target');
  if (tt) { w.push('a.target_type=?'); prm.push(tt); }
  return { rows: auditRows(w.join(' AND '), prm, limit, offset), total: one(`SELECT COUNT(*) n FROM audit_log a WHERE ${w.join(' AND ')}`, ...prm).n, page: p };
}, { perm: 'audit.view' });
route('GET', '/api/admin/audit/verify', () => verifyAudit(), { perm: 'audit.view' });
route('GET', '/api/admin/errors', (c) => {
  if (!can(c.user, 'settings.manage') && !can(c.user, 'games.manage')) throw forbidden();
  const { limit, offset, page: p } = page(c);
  return { rows: all('SELECT * FROM error_log ORDER BY id DESC LIMIT ? OFFSET ?', limit, offset), total: one('SELECT COUNT(*) n FROM error_log').n, page: p };
}, { perm: 'admin.access' });

// ================= Резервное копирование =================
export const BACKUP_DIR = path.join(DATA, 'backups');
export function makeBackup() {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const d = new Date(now() + MSK).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  const file = path.join(BACKUP_DIR, `burger-${d}.sqlite`);
  if (fs.existsSync(file)) throw bad('Копия уже создана в эту секунду');
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  return { file: path.basename(file), size: fs.statSync(file).size };
}
route('GET', '/api/admin/backups', () => {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  return { dir: BACKUP_DIR, files: fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.sqlite')).sort().reverse().map((f) => ({ file: f, size: fs.statSync(path.join(BACKUP_DIR, f)).size, createdAt: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs })) };
}, { perm: 'backup.manage' });
route('POST', '/api/admin/backups', (c) => {
  const r = makeBackup();
  audit(c.user.id, 'backup.create', 'backup', r.file, r, c.ip);
  return r;
}, { perm: 'backup.manage', rate: [5, 60_000] });
