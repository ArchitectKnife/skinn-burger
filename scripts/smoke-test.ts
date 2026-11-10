// Автотест: поднимает сайт на временной базе, проверяет ключевые сценарии и удаляет временные данные.
// Запуск: npm test
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'burger-test-'));
process.env.DATA_DIR = dir;
delete process.env.DB_FILE;
const dbm: any = await import('../src/lib/db.ts');
dbm.migrate();
const { seed } = await import('../scripts/seed.ts');
seed();
const { start } = await import('../src/server.ts');
const port = 18000 + Math.floor(Math.random() * 2000);
const server = start(port);
await new Promise((r) => setTimeout(r, 500));
const base = 'http://127.0.0.1:' + port;

let jar: Record<string, string> = {};
async function req(method: string, p: string, body?: unknown, key?: string) {
  const headers: Record<string, string> = { cookie: Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ') };
  if (method !== 'GET') {
    headers['content-type'] = 'application/json';
    headers['x-csrf-token'] = jar.bs_csrf || '';
    headers['idempotency-key'] = key || crypto.randomUUID();
  }
  const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie()) {
    const kv = c.split(';')[0];
    const i = kv.indexOf('=');
    const k = kv.slice(0, i), v = kv.slice(i + 1);
    if (v && !/max-age=0/i.test(c)) jar[k] = v; else delete jar[k];
  }
  const t = await r.text();
  let j: any = null;
  try { j = JSON.parse(t); } catch { j = null; }
  return { status: r.status, j, t };
}

let failed = 0, passed = 0;
function check(name: string, ok: boolean, info = '') {
  if (ok) { passed++; console.log('  OK   ' + name); } else { failed++; console.log('  FAIL ' + name + (info ? ' -> ' + info.slice(0, 200) : '')); }
}
const list = (j: any) => (Array.isArray(j) ? j : j?.rows || j?.items || j?.cases || j?.inventory || []);

console.log('BURGER SKIN: автотест на временной базе ' + dir);
let r = await req('GET', '/');
check('Главная страница отдаётся', r.status === 200 && r.t.includes('BURGER'), String(r.status));
check('Слово «демо» отсутствует в оболочке', !/демо/i.test(r.t));
r = await req('GET', '/api/site');
check('Настройки сайта', r.status === 200, r.t);
r = await req('GET', '/api/cases');
const cases = list(r.j);
check('Каталог кейсов не пуст', r.status === 200 && cases.length > 0, r.t);
r = await req('GET', '/api/items/meta');
check('Каталог скинов: у всех предметов есть изображения', r.status === 200 && r.j.total > 0 && r.j.withImages === r.j.total, r.t);
r = await req('GET', '/api/admin/dashboard');
check('Гость не попадает в админку', r.status === 401 || r.status === 403, String(r.status));

r = await req('POST', '/api/auth/register', { login: 'tester1', email: 'tester1@example.com', password: 'Tester12345!', agree: true });
check('Регистрация', r.status === 200, r.t);
r = await req('GET', '/api/me');
const me = r.j?.user || r.j;
check('Сессия после регистрации', r.status === 200 && me?.login === 'tester1', r.t);
r = await req('GET', '/api/admin/dashboard');
check('Обычный игрок получает 403 в админке', r.status === 403, String(r.status));
r = await req('POST', '/api/admin/users/' + me.id + '/role', { role: 'OWNER' });
check('Игрок не может назначить себе роль', r.status === 403, String(r.status));
r = await req('POST', '/api/finance/deposit', { amount: 100, method: 'card' });
check('Пополнение честно отключено без провайдера (503)', r.status === 503, String(r.status) + ' ' + r.t);
r = await req('POST', '/api/finance/withdraw', { amount: 100 });
check('Вывод честно отключён (503)', r.status === 503, String(r.status) + ' ' + r.t);

const noTok = await fetch(base + '/api/auth/logout', { method: 'POST', headers: { cookie: Object.entries(jar).map(([k, v]) => k + '=' + v).join('; '), 'content-type': 'application/json' }, body: '{}' });
check('Запрос без CSRF-токена отклоняется', noTok.status === 403, String(noTok.status));

dbm.run('UPDATE users SET balance=? WHERE id=?', 10_000_000, me.id);
const slug = cases[0].slug;
const key = crypto.randomUUID();
const o1 = await req('POST', '/api/cases/' + slug + '/open', { count: 1 }, key);
check('Открытие кейса', o1.status === 200, o1.t);
const bal1 = dbm.one('SELECT balance FROM users WHERE id=?', me.id).balance;
const o2 = await req('POST', '/api/cases/' + slug + '/open', { count: 1 }, key);
const bal2 = dbm.one('SELECT balance FROM users WHERE id=?', me.id).balance;
check('Повтор запроса с тем же Idempotency-Key не списывает баланс повторно', bal1 === bal2 && o2.status < 500, bal1 + ' / ' + bal2);
check('Баланс списан на сервере', bal1 < 10_000_000, String(bal1));
const bets = dbm.one("SELECT COUNT(*) n FROM bets WHERE user_id=?", me.id);
check('Открытие записано в историю', bets && bets.n >= 1, JSON.stringify(bets));

r = await req('GET', '/api/inventory');
const inv = list(r.j).filter((x: any) => (x.status || 'owned') === 'owned');
check('Предмет появился в инвентаре', r.status === 200 && inv.length >= 1, r.t);
if (inv.length) {
  const s1 = await req('POST', '/api/inventory/sell', { ids: [inv[0].id] });
  check('Продажа предмета', s1.status === 200, s1.t);
  const s2 = await req('POST', '/api/inventory/sell', { ids: [inv[0].id] });
  check('Повторная продажа того же предмета запрещена', s2.status >= 400 && s2.status < 500, String(s2.status));
}
r = await req('GET', '/api/fair');
check('Provably Fair: данные сидов', r.status === 200, r.t);
r = await req('POST', '/api/auth/logout', {});
check('Выход', r.status === 200, r.t);
r = await req('POST', '/api/auth/login', { login: 'tester1', password: 'wrong-password' });
check('Неверный пароль отклоняется', r.status >= 400 && r.status < 500, String(r.status));

dbm.run("UPDATE users SET role='OWNER' WHERE id=?", me.id);
r = await req('POST', '/api/auth/login', { login: 'tester1', password: 'Tester12345!' });
check('Вход', r.status === 200, r.t);
r = await req('GET', '/api/admin/dashboard');
check('OWNER открывает дашборд', r.status === 200, r.t);
r = await req('POST', '/api/admin/users/' + me.id + '/balance', { amount: 10, reason: '' });
check('Изменение баланса без причины запрещено', r.status >= 400 && r.status < 500, String(r.status));
r = await req('GET', '/api/admin/audit/verify');
check('Цепочка журнала аудита не нарушена', r.status === 200 && r.j?.ok === true, r.t);

server.close();
console.log('\nИтог: пройдено ' + passed + ', ошибок ' + failed);
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
