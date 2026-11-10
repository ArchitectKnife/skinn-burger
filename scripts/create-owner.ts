// Создание первого владельца (OWNER). Данные берутся ТОЛЬКО из переменных окружения:
//   OWNER_LOGIN, OWNER_EMAIL, OWNER_PASSWORD
// Запуск:  npm run create-owner                 — создать нового владельца
//           npm run create-owner -- --promote    — назначить OWNER существующему аккаунту OWNER_LOGIN
//           npm run create-owner -- --reset-password — задать владельцу новый пароль из OWNER_PASSWORD
// Пароль нигде не сохраняется в открытом виде: в базу записывается только хеш Argon2id.
import crypto from 'node:crypto';
import { one, run, now, tx } from '../src/lib/db.ts';
import { hashPassword, passwordPolicy } from '../src/lib/auth.ts';
import { audit } from '../src/lib/core.ts';

export async function createOwner(o: { login?: string; email?: string; password?: string; promote?: boolean; resetPassword?: boolean }) {
  const login = String(o.login || '').trim();
  const email = String(o.email || '').trim().toLowerCase() || null;
  const password = String(o.password || '');
  if (!/^[a-zA-Z0-9_.-]{3,24}$/.test(login)) throw new Error('OWNER_LOGIN: 3–24 символа (латиница, цифры, _ . -)');
  const ex = one('SELECT * FROM users WHERE login=?', login);
  if (o.promote) {
    if (!ex) throw new Error(`Пользователь ${login} не найден`);
    run("UPDATE users SET role='OWNER', status='active' WHERE id=?", ex.id);
    audit(null, 'owner.promote', 'user', ex.id, { login, via: 'cli' }, 'cli');
    return { id: ex.id, login, action: 'promoted' };
  }
  const policy = passwordPolicy(password);
  if (policy) throw new Error('OWNER_PASSWORD: ' + policy);
  if (o.resetPassword) {
    if (!ex || ex.role !== 'OWNER') throw new Error(`Владелец ${login} не найден`);
    run('UPDATE users SET pass_hash=?, failed_logins=0, locked_until=0 WHERE id=?', await hashPassword(password), ex.id);
    run('DELETE FROM sessions WHERE user_id=?', ex.id);
    audit(null, 'owner.reset_password', 'user', ex.id, { login, via: 'cli' }, 'cli');
    return { id: ex.id, login, action: 'password_reset' };
  }
  if (ex) throw new Error(`Логин ${login} уже занят. Используйте --promote, чтобы назначить его владельцем.`);
  if (email && one('SELECT 1 FROM users WHERE email=?', email)) throw new Error('Email уже используется');
  const hash = await hashPassword(password);
  const id = tx(() => {
    let ref = '';
    do ref = crypto.randomBytes(5).toString('hex').toUpperCase(); while (one('SELECT 1 FROM users WHERE ref_code=?', ref));
    const uid = run("INSERT INTO users(login,email,pass_hash,nickname,role,ref_code,created_at) VALUES(?,?,?,?,'OWNER',?,?)", login, email, hash, login, ref, now()).lastInsertRowid;
    audit(null, 'owner.create', 'user', uid, { login, via: 'cli' }, 'cli');
    return uid;
  });
  return { id, login, action: 'created' };
}

if (import.meta.filename === process.argv[1]) {
  const args = process.argv.slice(2);
  createOwner({ login: process.env.OWNER_LOGIN, email: process.env.OWNER_EMAIL, password: process.env.OWNER_PASSWORD, promote: args.includes('--promote'), resetPassword: args.includes('--reset-password') })
    .then((r) => { console.log('Готово:', JSON.stringify(r)); console.log('Удалите OWNER_PASSWORD из .env после создания владельца.'); })
    .catch((e) => { console.error('Ошибка:', e.message); process.exit(1); });
}
