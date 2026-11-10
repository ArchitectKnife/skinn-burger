// Авторизация: Argon2id, сессии, роли и разрешения.
import crypto from 'node:crypto';
import { one, run, now } from './db.ts';
import { randomToken, sha256 } from './http.ts';
import { getSetting } from './core.ts';

const A2 = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32 }; // параметры OWASP для Argon2id
function argon(pw: string, nonce: Buffer, o: typeof A2): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    (crypto as any).argon2('argon2id', { message: pw, nonce, parallelism: o.parallelism, tagLength: o.tagLength, memory: o.memory, passes: o.passes },
      (err: any, key: any) => (err ? reject(err) : resolve(Buffer.from(key))));
  });
}
export async function hashPassword(pw: string): Promise<string> {
  const nonce = crypto.randomBytes(16);
  const tag = await argon(pw, nonce, A2);
  return `$argon2id$v=19$m=${A2.memory},t=${A2.passes},p=${A2.parallelism}$${nonce.toString('base64url')}$${tag.toString('base64url')}`;
}
export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  if (!stored) { await argon(pw, crypto.randomBytes(16), A2); return false; } // выравнивание времени ответа
  const m = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([\w-]+)\$([\w-]+)$/.exec(stored);
  if (!m) return false;
  const expected = Buffer.from(m[5], 'base64url');
  const tag = await argon(pw, Buffer.from(m[4], 'base64url'), { memory: +m[1], passes: +m[2], parallelism: +m[3], tagLength: expected.length });
  return tag.length === expected.length && crypto.timingSafeEqual(tag, expected);
}
export function passwordPolicy(pw: any): string | null {
  if (typeof pw !== 'string' || pw.length < 8 || pw.length > 128) return 'Пароль: от 8 до 128 символов';
  if (!/[a-zA-Zа-яА-Я]/.test(pw) || !/\d/.test(pw)) return 'Пароль должен содержать буквы и цифры';
  return null;
}

export const SESSION_TTL = 30 * 86400_000;
export function createSession(userId: number, ip: string, ua: string) {
  const token = randomToken(32);
  run('INSERT INTO sessions(id,user_id,created_at,expires_at,last_seen,ip,ua) VALUES(?,?,?,?,?,?,?)', sha256(token), userId, now(), now() + SESSION_TTL, now(), ip, String(ua || '').slice(0, 200));
  run('UPDATE users SET last_seen=?, last_ip=? WHERE id=?', now(), ip, userId);
  return token;
}
export function sessionUser(token: string | undefined, ip: string) {
  if (!token || token.length > 100) return null;
  const sid = sha256(token);
  const s = one('SELECT * FROM sessions WHERE id=?', sid);
  if (!s || s.expires_at < now()) return null;
  const u = one('SELECT * FROM users WHERE id=?', s.user_id);
  if (!u) return null;
  if (now() - (s.last_seen || 0) > 300_000) {
    run('UPDATE sessions SET last_seen=?, expires_at=?, ip=? WHERE id=?', now(), now() + SESSION_TTL, ip, sid);
    run('UPDATE users SET last_seen=?, last_ip=? WHERE id=?', now(), ip, u.id);
  }
  return { user: u, sid };
}
export const destroySession = (sid: string) => run('DELETE FROM sessions WHERE id=?', sid);

// ---------- Роли и разрешения ----------
export const ROLES = ['USER', 'SUPPORT', 'MODERATOR', 'ADMIN', 'OWNER'] as const;
export const ROLE_RANK: Record<string, number> = { USER: 0, SUPPORT: 1, MODERATOR: 2, ADMIN: 3, OWNER: 4 };
export const PERMS: Record<string, string> = {
  'admin.access': 'Доступ в админ-панель', 'users.view': 'Просмотр пользователей', 'users.ban': 'Блокировки и ограничения',
  'users.balance': 'Начисление и списание баланса', 'users.roles': 'Назначение ролей (ниже своей)', 'cases.manage': 'Управление кейсами',
  'items.manage': 'Управление скинами', 'games.manage': 'Управление играми', 'bonuses.manage': 'Бонусы, промокоды, задания, события',
  'pass.manage': 'Управление BURGER PASS', 'finance.manage': 'Заявки на пополнение и вывод', 'support.manage': 'Обращения в поддержку',
  'news.manage': 'Новости и акции', 'settings.manage': 'Системные настройки', 'audit.view': 'Журналы аудита и ошибок', 'backup.manage': 'Резервное копирование',
};
export const DEFAULT_ROLE_PERMS: Record<string, string[]> = {
  ADMIN: ['admin.access', 'users.view', 'users.ban', 'users.balance', 'users.roles', 'cases.manage', 'items.manage', 'games.manage', 'bonuses.manage', 'pass.manage', 'finance.manage', 'support.manage', 'news.manage', 'audit.view'],
  MODERATOR: ['admin.access', 'users.view', 'users.ban', 'support.manage', 'news.manage'],
  SUPPORT: ['admin.access', 'users.view', 'support.manage'],
  USER: [],
};
export function permsOf(role: string): string[] {
  if (role === 'OWNER') return Object.keys(PERMS);
  const custom = getSetting('role_permissions');
  const list = (custom && custom[role]) || DEFAULT_ROLE_PERMS[role] || [];
  return list.filter((p: string) => p in PERMS);
}
export const can = (u: any, perm: string) => !!u && u.status === 'active' && permsOf(u.role).includes(perm);
export const isStaff = (u: any) => !!u && u.role !== 'USER';
