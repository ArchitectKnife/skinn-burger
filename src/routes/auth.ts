// Маршруты авторизации: регистрация, вход, выход, восстановление/смена пароля, Steam OpenID, настройки аккаунта.
import crypto from 'node:crypto';
import { one, all, run, tx, now } from '../lib/db.ts';
import { route, v, bad, HttpError, rateLimit, randomToken, sha256 } from '../lib/http.ts';
import { hashPassword, verifyPassword, passwordPolicy, createSession, destroySession, SESSION_TTL, permsOf } from '../lib/auth.ts';
import { getSetting, feature, change, notify, audit, activeSeed, imageUrl } from '../lib/core.ts';
import { mailConfigured, sendMail } from '../lib/mailer.ts';

function safeJson(x: any) { try { const v = JSON.parse(x || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } }
export function meView(u: any) {
  if (!u) return null;
  const seed = activeSeed(u.id);
  return { id: u.id, login: u.login, email: u.email, nickname: u.nickname, avatar: u.avatar ? imageUrl(u.avatar) : null, role: u.role,
    balance: u.balance, steamId: u.steam_id, steamName: u.steam_name, hasPassword: !!u.pass_hash, createdAt: u.created_at,
    refCode: u.ref_code, restrictions: JSON.parse(u.restrictions || '{}'), perms: permsOf(u.role), privateProfile: !!u.private_profile,
    notifyEmail: !!u.notify_email, prefs: safeJson(u.prefs), unread: one('SELECT COUNT(*) c FROM notifications WHERE user_id=? AND read=0', u.id).c,
    fair: { serverHash: seed.server_hash, clientSeed: seed.client_seed, nonce: seed.nonce } };
}
const publicUrl = () => (process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');
const newRefCode = () => crypto.randomBytes(5).toString('hex').toUpperCase();

function createUser(f: { login: string; email: string | null; passHash: string | null; nickname: string; ip: string; ref?: string | null; steamId?: string; steamName?: string; avatar?: string }) {
  return tx(() => {
    const referrer = f.ref ? one('SELECT id FROM users WHERE ref_code=?', String(f.ref).toUpperCase()) : null;
    const id = run('INSERT INTO users(login,email,pass_hash,nickname,avatar,steam_id,steam_name,ref_code,referred_by,reg_ip,last_ip,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      f.login, f.email, f.passHash, f.nickname, f.avatar || null, f.steamId || null, f.steamName || null, newRefCode(), referrer?.id || null, f.ip, f.ip, now()).lastInsertRowid;
    const eco = getSetting('economy');
    if (eco.welcome_bonus > 0) change(id, eco.welcome_bonus, 'bonus', { reason: 'Приветственный бонус' });
    if (referrer) {
      const ref = getSetting('referral');
      if (ref.invitee_bonus > 0) change(id, ref.invitee_bonus, 'referral', { ref: 'user', refId: referrer.id, reason: 'Бонус за регистрацию по приглашению' });
      notify(referrer.id, 'referral', 'По вашей ссылке зарегистрировался игрок', f.nickname, '/bonuses');
    }
    notify(id, 'welcome', 'Добро пожаловать в BURGER SKIN!', 'Заберите ежедневный бонус и начните открывать кейсы.', '/bonuses');
    return id;
  });
}
function startSession(c: any, userId: number) {
  const token = createSession(userId, c.ip, String(c.req.headers['user-agent'] || ''));
  c.setCookie('bs_sid', token, { maxAge: SESSION_TTL });
}

route('GET', '/api/me', (c) => ({ user: meView(c.user) }));
// Личные настройки интерфейса (звук). Хранятся в аккаунте и применяются на всех устройствах.
route('POST', '/api/me/prefs', (c) => {
  const cur = safeJson(c.user.prefs);
  const s = c.body.sound;
  if (s && typeof s === 'object') {
    const n = (x: any, d: number) => { const k = Number(x); return Number.isFinite(k) ? Math.min(1, Math.max(0, Math.round(k * 100) / 100)) : d; };
    cur.sound = { enabled: s.enabled !== false, master: n(s.master, 0.7), effects: n(s.effects, 0.8), upgrade: n(s.upgrade, 0.8), cinema: n(s.cinema, 0.9) };
  }
  run('UPDATE users SET prefs=? WHERE id=?', JSON.stringify(cur), c.user.id);
  return { prefs: cur };
}, { auth: true, rate: [30, 60_000] });

route('POST', '/api/auth/register', async (c) => {
  if (!feature('registration')) throw new HttpError(403, 'Регистрация временно закрыта');
  rateLimit('reg:' + c.ip, 5, 3600_000);
  const b = c.body;
  const login = v.str(b.login, 'Логин', 3, 24);
  if (!/^[a-zA-Z0-9_.-]+$/.test(login)) throw bad('Логин: латиница, цифры, точка, дефис и подчёркивание');
  const email = v.email(b.email);
  const perr = passwordPolicy(b.password);
  if (perr) throw bad(perr);
  if (!v.bool(b.agree)) throw bad('Необходимо принять правила и подтвердить возраст 18+');
  if (one('SELECT 1 FROM users WHERE login=?', login)) throw bad('Этот логин уже занят');
  if (one('SELECT 1 FROM users WHERE email=?', email)) throw bad('Этот email уже зарегистрирован');
  const hash = await hashPassword(b.password);
  const id = createUser({ login, email, passHash: hash, nickname: login, ip: c.ip, ref: b.ref ? String(b.ref).slice(0, 20) : null });
  audit(id, 'user.register', 'user', id, { login }, c.ip);
  startSession(c, id);
  return { user: meView(one('SELECT * FROM users WHERE id=?', id)) };
});

route('POST', '/api/auth/login', async (c) => {
  rateLimit('login:' + c.ip, 20, 600_000);
  const ident = v.str(c.body.login, 'Логин или email', 1, 120);
  const pw = v.str(c.body.password, 'Пароль', 1, 128);
  const u = one('SELECT * FROM users WHERE login=? OR email=?', ident, ident.toLowerCase());
  if (u && u.locked_until > now()) throw new HttpError(429, `Слишком много неудачных попыток. Вход заблокирован до ${new Date(u.locked_until).toLocaleTimeString('ru-RU', { timeZone: 'Europe/Moscow' })} (МСК)`);
  const ok = await verifyPassword(pw, u?.pass_hash || null);
  if (!u || !ok) {
    if (u) {
      const fails = u.failed_logins + 1;
      run('UPDATE users SET failed_logins=?, locked_until=? WHERE id=?', fails >= 5 ? 0 : fails, fails >= 5 ? now() + 15 * 60_000 : 0, u.id);
      if (fails >= 5) audit(null, 'user.lockout', 'user', u.id, { ip: c.ip }, c.ip);
    }
    throw new HttpError(401, 'Неверный логин или пароль', 'bad_credentials');
  }
  if (u.status === 'banned') throw new HttpError(403, 'Аккаунт заблокирован' + (u.ban_reason ? ': ' + u.ban_reason : ''), 'banned');
  run('UPDATE users SET failed_logins=0, locked_until=0 WHERE id=?', u.id);
  startSession(c, u.id);
  return { user: meView(u) };
});

route('POST', '/api/auth/logout', (c) => {
  if (c.sid) destroySession(c.sid);
  c.setCookie('bs_sid', '', { maxAge: 0 });
  return { ok: true };
});
route('POST', '/api/auth/logout-all', (c) => {
  run('DELETE FROM sessions WHERE user_id=?', c.user.id);
  c.setCookie('bs_sid', '', { maxAge: 0 });
  audit(c.user.id, 'user.logout_all', 'user', c.user.id, null, c.ip);
  return { ok: true };
}, { auth: true });

route('GET', '/api/auth/options', () => ({ mail: mailConfigured(), steam: feature('steam'), steamProfile: !!process.env.STEAM_API_KEY, registration: feature('registration') }));

route('POST', '/api/auth/forgot', async (c) => {
  rateLimit('forgot:' + c.ip, 5, 3600_000);
  const email = v.email(c.body.email);
  if (!mailConfigured()) throw new HttpError(503, 'Отправка писем не настроена на сервере. Напишите в поддержку — сотрудник поможет восстановить доступ.', 'mail_unavailable');
  const u = one('SELECT * FROM users WHERE email=?', email);
  if (u && u.status === 'active') {
    const token = randomToken(32);
    run('INSERT INTO password_resets(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)', sha256(token), u.id, now(), now() + 3600_000);
    const link = `${publicUrl()}/reset?token=${token}`;
    try { await sendMail(email, 'BURGER SKIN — восстановление пароля', `Здравствуйте, ${u.nickname}!\n\nЧтобы задать новый пароль, откройте ссылку (действует 1 час):\n${link}\n\nЕсли вы не запрашивали восстановление, просто проигнорируйте письмо.`); }
    catch (e: any) { throw new HttpError(502, 'Не удалось отправить письмо: ' + e.message); }
  }
  return { ok: true, message: 'Если аккаунт с таким email существует, мы отправили на него ссылку для восстановления.' };
});

route('POST', '/api/auth/reset', async (c) => {
  rateLimit('reset:' + c.ip, 10, 3600_000);
  const token = v.str(c.body.token, 'Токен', 10, 100);
  const perr = passwordPolicy(c.body.password);
  if (perr) throw bad(perr);
  const r = one('SELECT * FROM password_resets WHERE token_hash=?', sha256(token));
  if (!r || r.used_at || r.expires_at < now()) throw bad('Ссылка для восстановления недействительна или устарела');
  const hash = await hashPassword(c.body.password);
  tx(() => {
    if (run('UPDATE password_resets SET used_at=? WHERE token_hash=? AND used_at IS NULL', now(), r.token_hash).changes !== 1) throw bad('Ссылка уже использована');
    run('UPDATE users SET pass_hash=?, failed_logins=0, locked_until=0 WHERE id=?', hash, r.user_id);
    run('DELETE FROM sessions WHERE user_id=?', r.user_id);
  });
  audit(r.user_id, 'user.password_reset', 'user', r.user_id, null, c.ip);
  notify(r.user_id, 'security', 'Пароль изменён', 'Если это были не вы, срочно обратитесь в поддержку.', '/support');
  return { ok: true };
});

route('POST', '/api/me/password', async (c) => {
  rateLimit('pw:' + c.user.id, 10, 3600_000);
  const perr = passwordPolicy(c.body.newPassword);
  if (perr) throw bad(perr);
  if (c.user.pass_hash && !(await verifyPassword(String(c.body.oldPassword || ''), c.user.pass_hash))) throw bad('Текущий пароль указан неверно');
  const hash = await hashPassword(c.body.newPassword);
  run('UPDATE users SET pass_hash=? WHERE id=?', hash, c.user.id);
  run('DELETE FROM sessions WHERE user_id=? AND id<>?', c.user.id, c.sid);
  audit(c.user.id, 'user.password_change', 'user', c.user.id, null, c.ip);
  return { ok: true };
}, { auth: true });

route('POST', '/api/me/profile', (c) => {
  const b = c.body;
  const nickname = v.str(b.nickname, 'Никнейм', 2, 24);
  if (/[<>"'`]/.test(nickname)) throw bad('Никнейм содержит недопустимые символы');
  let email = c.user.email;
  if (b.email && b.email !== c.user.email) {
    email = v.email(b.email);
    if (one('SELECT 1 FROM users WHERE email=? AND id<>?', email, c.user.id)) throw bad('Этот email уже используется');
  }
  let avatar = c.user.avatar;
  if (b.avatar !== undefined) {
    if (b.avatar === '' || b.avatar === null) avatar = null;
    else if (typeof b.avatar === 'string' && /^\/(uploads\/public|img\/items)\/[\w.-]+$/.test(b.avatar)) avatar = b.avatar;
    else throw bad('Аватар нужно загрузить через форму');
  }
  run('UPDATE users SET nickname=?, email=?, avatar=?, private_profile=?, notify_email=? WHERE id=?', nickname, email, avatar, v.bool(b.privateProfile), v.bool(b.notifyEmail), c.user.id);
  return { user: meView(one('SELECT * FROM users WHERE id=?', c.user.id)) };
}, { auth: true, rate: [20, 60_000] });

route('GET', '/api/me/sessions', (c) => ({
  sessions: all('SELECT id, created_at, last_seen, ip, ua FROM sessions WHERE user_id=? ORDER BY last_seen DESC', c.user.id)
    .map((s) => ({ current: s.id === c.sid, createdAt: s.created_at, lastSeen: s.last_seen, ip: s.ip, ua: s.ua })),
}), { auth: true });

// ---------- Steam OpenID 2.0 ----------
const STEAM_OP = 'https://steamcommunity.com/openid/login';
route('GET', '/api/auth/steam', (c) => {
  if (!feature('steam')) throw new HttpError(403, 'Вход через Steam отключён администрацией');
  rateLimit('steam:' + c.ip, 20, 600_000);
  const mode = c.query.get('mode') === 'link' ? 'link' : 'login';
  if (mode === 'link' && !c.user) throw new HttpError(401, 'Войдите в аккаунт');
  const state = randomToken(16);
  c.setCookie('bs_steam', `${mode}.${state}.${String(c.query.get('ref') || '').replace(/[^A-Z0-9]/gi, '').slice(0, 20)}`, { maxAge: 600_000 });
  const base = publicUrl();
  const p = new URLSearchParams({
    'openid.ns': 'http://specs.openid.net/auth/2.0', 'openid.mode': 'checkid_setup',
    'openid.return_to': `${base}/api/auth/steam/return?state=${state}`, 'openid.realm': base,
    'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select', 'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
  });
  c.redirect = `${STEAM_OP}?${p}`;
  return null;
});

async function steamProfile(steamId: string) {
  const key = process.env.STEAM_API_KEY;
  if (!key) return null;
  try {
    const url = new URL('/ISteamUser/GetPlayerSummaries/v2/', 'https://api.steampowered.com');
    url.searchParams.set('key', key);
    url.searchParams.set('steamids', steamId);
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const j: any = await r.json();
    const p = j?.response?.players?.[0];
    return p ? { name: String(p.personaname || '').slice(0, 24), avatar: String(p.avatarfull || '') } : null;
  } catch { return null; }
}

route('GET', '/api/auth/steam/return', async (c) => {
  const [mode, state, ref] = String(c.cookies.bs_steam || '').split('.');
  c.setCookie('bs_steam', '', { maxAge: 0 });
  const fail = (msg: string) => { c.redirect = '/login?error=' + encodeURIComponent(msg); return null; };
  if (!state || c.query.get('state') !== state) return fail('Сессия входа через Steam устарела. Попробуйте ещё раз.');
  const q = c.query;
  const returnTo = String(q.get('openid.return_to') || '');
  if (!returnTo.startsWith(publicUrl() + '/api/auth/steam/return')) return fail('Некорректный адрес возврата Steam');
  if (q.get('openid.op_endpoint') !== STEAM_OP) return fail('Некорректный ответ Steam');
  const m = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(String(q.get('openid.claimed_id') || ''));
  if (!m) return fail('Steam не подтвердил аккаунт');
  const check = new URLSearchParams();
  for (const [k, val] of q) if (k.startsWith('openid.')) check.set(k, val);
  check.set('openid.mode', 'check_authentication');
  let valid = false;
  try {
    const r = await fetch(STEAM_OP, { method: 'POST', body: check, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10_000) });
    valid = /is_valid\s*:\s*true/.test(await r.text());
  } catch { return fail('Не удалось связаться со Steam для проверки входа'); }
  if (!valid) return fail('Steam отклонил проверку подписи');
  const steamId = m[1];
  const prof = await steamProfile(steamId);
  if (mode === 'link') {
    if (!c.user) return fail('Войдите в аккаунт, чтобы привязать Steam');
    const other = one('SELECT id FROM users WHERE steam_id=?', steamId);
    if (other && other.id !== c.user.id) { c.redirect = '/settings?error=' + encodeURIComponent('Этот Steam-аккаунт уже привязан к другому профилю'); return null; }
    run('UPDATE users SET steam_id=?, steam_name=?, avatar=COALESCE(avatar, ?) WHERE id=?', steamId, prof?.name || null, prof?.avatar || null, c.user.id);
    audit(c.user.id, 'user.steam_link', 'user', c.user.id, { steamId }, c.ip);
    c.redirect = '/settings?ok=steam';
    return null;
  }
  let u = one('SELECT * FROM users WHERE steam_id=?', steamId);
  if (!u) {
    if (!feature('registration')) return fail('Регистрация временно закрыта');
    const id = createUser({ login: 'steam_' + steamId, email: null, passHash: null, nickname: prof?.name || 'Steam ' + steamId.slice(-5), ip: c.ip, ref, steamId, steamName: prof?.name, avatar: prof?.avatar });
    audit(id, 'user.register_steam', 'user', id, { steamId }, c.ip);
    u = one('SELECT * FROM users WHERE id=?', id);
  }
  if (u.status === 'banned') return fail('Аккаунт заблокирован');
  startSession(c, u.id);
  c.redirect = '/';
  return null;
});

route('POST', '/api/me/steam/unlink', (c) => {
  if (!c.user.steam_id) throw bad('Steam не привязан');
  if (!c.user.pass_hash || !c.user.email) throw bad('Сначала укажите email и задайте пароль — иначе вы потеряете доступ к аккаунту');
  run('UPDATE users SET steam_id=NULL, steam_name=NULL WHERE id=?', c.user.id);
  audit(c.user.id, 'user.steam_unlink', 'user', c.user.id, null, c.ip);
  return { user: meView(one('SELECT * FROM users WHERE id=?', c.user.id)) };
}, { auth: true });
