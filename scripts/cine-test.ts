// Автотест кинодропов: временная база, серверный расчёт уровня, ссылки «Поделиться», админка.
// Запуск: node --disable-warning=ExperimentalWarning scripts/cine-test.ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'burger-cine-'));
process.env.DATA_DIR = dir;
delete process.env.DB_FILE;
const dbm: any = await import('../src/lib/db.ts');
dbm.migrate();
const { seed } = await import('../scripts/seed.ts');
seed();
const { start } = await import('../src/server.ts');
const port = 20000 + Math.floor(Math.random() * 2000);
const server = start(port);
await new Promise((r) => setTimeout(r, 500));
const base = 'http://127.0.0.1:' + port;
const keep = process.argv.includes('--keep');

const jar: Record<string, string> = {};
async function req(method: string, p: string, body?: unknown) {
  const headers: Record<string, string> = { cookie: Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ') };
  if (method !== 'GET') { headers['content-type'] = 'application/json'; headers['x-csrf-token'] = jar.bs_csrf || ''; headers['idempotency-key'] = crypto.randomUUID(); }
  const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie()) { const kv = c.split(';')[0]; const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v && !/max-age=0/i.test(c)) jar[k] = v; else delete jar[k]; }
  const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { j = null; }
  return { status: r.status, j, t };
}
let failed = 0, passed = 0;
function check(name: string, ok: boolean, info = '') { if (ok) { passed++; console.log('  OK   ' + name); } else { failed++; console.log('  FAIL ' + name + (info ? ' -> ' + info.slice(0, 300) : '')); } }
console.log('BURGER SKIN: автотест кинодропов на временной базе ' + dir);

let r = await req('GET', '/api/site');
const sfx = r.j?.dropFx;
check('Сайт отдаёт настройки кинодропов', r.status === 200 && sfx && typeof sfx.enabled === 'boolean' && !!sfx.tiers, r.t);
r = await req('GET', '/js/cinematic.js');
check('Модуль сцен отдаётся', r.status === 200 && r.t.includes('playDrop'), String(r.status));
r = await req('GET', '/cine.css');
check('Стили сцен отдаются', r.status === 200 && r.t.includes('.cine'), String(r.status));
r = await req('GET', '/');
check('Стили сцен НЕ грузятся на главной (ленивая загрузка)', r.status === 200 && !r.t.includes('cine.css') && !r.t.includes('cinematic.js'));

r = await req('POST', '/api/auth/register', { login: 'cine1', email: 'cine1@example.com', password: 'Tester12345!', agree: true });
check('Регистрация', r.status === 200, r.t);
r = await req('GET', '/api/me');
const me = r.j?.user || r.j;
r = await req('GET', '/api/admin/drop-fx');
check('Игрок не видит админку кинодропов', r.status === 403, String(r.status));
r = await req('POST', '/api/admin/settings', { key: 'drop_fx', value: { enabled: true, godlike: 100, mythic: 200, divine: 300, min_x: 0, knife_scene: true, glove_scene: true, share: true, default_mode: 'full' } });
check('Игрок не может менять пороги', r.status === 403, String(r.status));

dbm.run("UPDATE users SET role='OWNER' WHERE id=?", me.id);
r = await req('POST', '/api/auth/logout', {});
r = await req('POST', '/api/auth/login', { login: 'cine1', password: 'Tester12345!' });
check('Вход владельца', r.status === 200, r.t);
r = await req('GET', '/api/admin/drop-fx');
check('Админка: статистика уровней и кейсов', r.status === 200 && !!r.j?.settings && !!r.j?.catalog && Array.isArray(r.j?.cases) && !!r.j?.samples, r.t);
const statsBefore = r.j;
r = await req('POST', '/api/admin/settings', { key: 'drop_fx', value: { ...statsBefore.settings, godlike: 900000, mythic: 500000 } });
check('Неверный порядок порогов отклоняется', r.status === 400, String(r.status) + ' ' + r.t);

// Шансы кейсов до и после смены порогов должны совпадать бит-в-бит.
const cases0 = (await req('GET', '/api/cases')).j;
const list = (j: any) => (Array.isArray(j) ? j : j?.rows || j?.items || j?.cases || []);
const slug = list(cases0)[0].slug;
const odds = async () => { const j = (await req('GET', '/api/cases/' + slug)).j; return JSON.stringify((j?.case?.items || j?.items || []).map((x: any) => [x.itemId ?? x.id, x.chance ?? x.weight ?? x.odds])); };
const oddsA = await odds();
r = await req('POST', '/api/admin/settings', { key: 'drop_fx', value: { ...statsBefore.settings, godlike: 100, mythic: 200, divine: 300, min_x: 0 } });
check('Пороги сохраняются', r.status === 200 && r.j?.value?.godlike === 100, r.t);
const oddsB = await odds();
check('Смена порогов не меняет шансы кейса', oddsA === oddsB && oddsA.length > 4, oddsA.slice(0, 120) + ' vs ' + oddsB.slice(0, 120));

dbm.run('UPDATE users SET balance=? WHERE id=?', 50_000_000, me.id);
const o = await req('POST', '/api/cases/' + slug + '/open', { count: 5 });
const drops = o.j?.drops || o.j?.results || o.j?.items || [];
check('Открытие кейса x5', o.status === 200 && drops.length === 5, o.t);
const t = { godlike: 100, mythic: 200, divine: 300 };
const want = (p: number) => (p >= t.divine ? 'divine' : p >= t.mythic ? 'mythic' : p >= t.godlike ? 'godlike' : null);
check('У каждого дропа есть серверный уровень и ссылка', drops.every((d: any) => d.share && 'fx' in d), JSON.stringify(drops[0] || {}).slice(0, 300));
check('Уровень соответствует цене выданного предмета', drops.every((d: any) => (d.fx?.tier ?? null) === want(d.inv.price)), JSON.stringify(drops.map((d: any) => [d.inv.price, d.fx?.tier])));
const invIds = new Set(list((await req('GET', '/api/inventory')).j).map((x: any) => x.id));
check('Показанные предметы = предметы в инвентаре', drops.every((d: any) => invIds.has(d.inv.id)));
const d0 = drops[0];
r = await req('GET', '/api/drops/' + d0.share);
check('Публичный дроп отдаётся', r.status === 200 && r.j?.drop?.token === d0.share, r.t);
check('Публичный дроп = записанная ставка (предмет, цена, уровень)', r.j?.drop?.item?.name === d0.inv.name && r.j?.drop?.item?.price === d0.inv.price && (r.j?.drop?.fx?.tier ?? null) === (d0.fx?.tier ?? null), JSON.stringify(r.j?.drop || {}).slice(0, 300));
check('Публичный дроп не раскрывает e-mail и сид сервера', !r.t.includes('cine1@example.com') && !/serverSeed"/.test(r.t));
const bad = d0.share.slice(0, -2) + (d0.share.slice(-2) === 'aa' ? 'bb' : 'aa');
r = await req('GET', '/api/drops/' + bad);
check('Поддельная ссылка отклоняется', r.status === 404 || r.status === 400, String(r.status));
r = await req('GET', '/drop/' + d0.share);
check('Страница /drop/… с Open Graph превью', r.status === 200 && r.t.includes('og:title'), r.t.slice(0, 300));

// Ссылки можно отключить
r = await req('POST', '/api/admin/settings', { key: 'drop_fx', value: { ...statsBefore.settings, godlike: 100, mythic: 200, divine: 300, min_x: 0, share: false } });
r = await req('GET', '/api/drops/' + d0.share);
check('Отключённые ссылки не открываются', r.status === 404, String(r.status));
// Выключенные кинодропы — fx = null, открытие работает как раньше
r = await req('POST', '/api/admin/settings', { key: 'drop_fx', value: { ...statsBefore.settings, enabled: false } });
const o2 = await req('POST', '/api/cases/' + slug + '/open', { count: 1 });
const dd = o2.j?.drops || [];
check('С выключенными кинодропами кейс открывается без сцены', o2.status === 200 && dd.length === 1 && dd[0].fx === null, o2.t);
r = await req('POST', '/api/admin/settings', { key: 'drop_fx', value: { ...statsBefore.settings, godlike: 100, mythic: 200, divine: 300, min_x: 0 } });
r = await req('GET', '/api/admin/audit/verify');
check('Цепочка журнала аудита не нарушена', r.status === 200 && r.j?.ok === true, r.t);

console.log('\nИтог: пройдено ' + passed + ', ошибок ' + failed);
if (keep) {
  fs.writeFileSync(path.join(os.tmpdir(), 'cine-test.json'), JSON.stringify({ base, jar, share: d0.share, slug }));
  console.log('KEEP ' + base);
} else {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}
