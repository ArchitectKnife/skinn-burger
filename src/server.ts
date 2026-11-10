// BURGER SKIN — HTTP-сервер: статика, SPA, API, SSE, CSRF, rate limit, идемпотентность, централизованная обработка ошибок.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ROOT, DATA, one, run, now } from './lib/db.ts';
import { match, HttpError, readBody, securityHeaders, sendJson, sseOpen, parseCookies, cookieStr, rateLimit, randomToken } from './lib/http.ts';
import type { Ctx } from './lib/http.ts';
import { getSetting, logError, rub } from './lib/core.ts';
import { sharedDrop, parseShare, SHARE_RE } from './lib/dropfx.ts';
import { sessionUser, can, isStaff } from './lib/auth.ts';
import './routes/auth.ts';
import './routes/play.ts';
import { gamesTick } from './routes/games.ts';
import { socialTick, UPLOAD_DIR } from './routes/social.ts';
import './routes/admin.ts';

const PUBLIC = path.join(ROOT, 'public');
const IMG_CACHE = path.join(DATA, 'imgcache');
fs.mkdirSync(IMG_CACHE, { recursive: true });
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};
// Маршруты SPA (для неизвестных — index.html со статусом 404 и страницей «Не найдено»)
const SPA = [
  /^\/$/, /^\/cases(\/[\wа-яё%.-]+)?$/i, /^\/open\/[\wа-яё%.-]+$/i, /^\/skins(\/\d+)?$/, /^\/inventory$/, /^\/upgrade$/, /^\/contracts$/, /^\/battles(\/\d+|\/new)?$/,
  /^\/games(\/(crash|double|jackpot|coinflip|roulette|mines|towers))?$/, /^\/pass$/, /^\/bonuses$/, /^\/promo$/, /^\/achievements$/, /^\/collections(\/[^/]+)?$/,
  /^\/tournaments(\/\d+)?$/, /^\/events(\/\d+)?$/, /^\/friends$/, /^\/leaderboard$/, /^\/profile$/, /^\/u\/\d+$/, /^\/settings$/, /^\/login$/, /^\/register$/,
  /^\/forgot$/, /^\/reset$/, /^\/balance$/, /^\/deposit$/, /^\/withdraw$/, /^\/history$/, /^\/support(\/\d+|\/new)?$/, /^\/news(\/\d+)?$/, /^\/fair$/,
  /^\/rules$/, /^\/privacy$/, /^\/notifications$/, /^\/admin(\/[\w/-]*)?$/,
];
const WEAR_SHORT: Record<string, string> = { FN: 'Factory New', MW: 'Minimal Wear', FT: 'Field-Tested', WW: 'Well-Worn', BS: 'Battle-Scarred' };
const attr = (s: string) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string));
/** Страница дропа: тот же index.html, но с Open Graph-тегами, чтобы ссылка красиво выглядела в Telegram, VK и Discord. */
function sendDropPage(req: http.IncomingMessage, res: http.ServerResponse, token: string) {
  const file = path.join(PUBLIC, 'index.html');
  const d = getSetting('drop_fx').share ? sharedDrop(parseShare(token)) : null;
  if (!d) return sendFile(res, file, 404);
  const proto = process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https' ? 'https' : process.env.COOKIE_SECURE === '1' ? 'https' : 'http';
  const origin = (process.env.PUBLIC_URL || `${proto}://${req.headers.host || 'localhost'}`).replace(/\/+$/, '');
  const site = getSetting('site').name || 'BURGER SKIN';
  const label = d.fx?.label || 'DROP';
  const quality = [d.item.stattrak ? 'StatTrak™' : d.item.souvenir ? 'Souvenir' : '', d.item.wear ? WEAR_SHORT[d.item.wear] || d.item.wear : ''].filter(Boolean).join(' · ');
  const title = `${label}: ${d.item.name}${quality ? ' (' + quality + ')' : ''} — ${rub(d.item.price)}`;
  const desc = `${d.user?.nickname || 'Игрок'} выбил ${d.item.name} из кейса «${d.case.name}» на ${site}. Результат проверяется Provably Fair.`;
  const img = /^https?:/i.test(d.item.image) ? d.item.image : origin + d.item.image;
  const meta = `<title>${attr(title)} | ${attr(site)}</title>\n  <meta property="og:type" content="website">\n  <meta property="og:site_name" content="${attr(site)}">\n`
    + `  <meta property="og:title" content="${attr(title)}">\n  <meta property="og:description" content="${attr(desc)}">\n  <meta property="og:image" content="${attr(img)}">\n`
    + `  <meta property="og:url" content="${attr(origin + '/drop/' + d.token)}">\n  <meta name="twitter:card" content="summary_large_image">`;
  const htmlText = fs.readFileSync(file, 'utf8').replace(/<title>[^<]*<\/title>/, meta).replace(/(<meta name="description" content=")[^"]*(")/, (_m, a, b) => a + attr(desc) + b);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
  res.end(htmlText);
}
const IMG_HOSTS = new Set(['community.akamai.steamstatic.com', 'community.cloudflare.steamstatic.com', 'steamcommunity-a.akamaihd.net', 'steamcdn-a.akamaihd.net',
  'cdn.steamstatic.com', 'raw.githubusercontent.com', 'avatars.steamstatic.com', 'avatars.akamai.steamstatic.com', 'avatars.cloudflare.steamstatic.com', 'cdn.jsdelivr.net']);

function clientIp(req: http.IncomingMessage) {
  const xf = process.env.TRUST_PROXY === '1' ? String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() : '';
  return xf || req.socket.remoteAddress || '0.0.0.0';
}
// Код сайта (HTML/JS/CSS) браузер всегда перепроверяет по ETag (ответ 304 без тела, если файл не менялся),
// поэтому после обновления файлов новая версия подхватывается сразу, без Ctrl+F5 и без лишнего трафика.
const FRESH_EXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.webmanifest']);
function sendFile(res: http.ServerResponse, file: string, status = 200, cache = 'public, max-age=3600') {
  const ext = path.extname(file).toLowerCase();
  const headers: Record<string, string> = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': FRESH_EXT.has(ext) ? 'no-cache' : cache };
  if (status === 200) {
    try {
      const st = fs.statSync(file);
      const etag = `W/"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
      headers.ETag = etag;
      const inm = String((res as any).req?.headers?.['if-none-match'] || '');
      if (inm && inm.split(',').some((t) => t.trim() === etag)) { res.writeHead(304, headers); res.end(); return; }
    } catch { /* файл исчез — отдаём как есть, поток вернёт ошибку */ }
  }
  res.writeHead(status, headers);
  fs.createReadStream(file).pipe(res);
}
function safeJoin(base: string, rel: string) {
  const p = path.normalize(path.join(base, decodeURIComponent(rel)));
  return p.startsWith(base + path.sep) || p === base ? p : null;
}
const brandItem = path.join(PUBLIC, 'img', 'brand', 'item.svg');

async function proxyImage(res: http.ServerResponse, b64: string) {
  let url: URL;
  try { url = new URL(Buffer.from(b64.replace(/\.\w+$/, ''), 'base64url').toString('utf8')); } catch { return sendFile(res, brandItem); }
  if (url.protocol !== 'https:' || !IMG_HOSTS.has(url.hostname)) return sendFile(res, brandItem);
  const key = crypto.createHash('sha256').update(url.href).digest('hex');
  const file = path.join(IMG_CACHE, key);
  if (fs.existsSync(file) && fs.existsSync(file + '.type')) {
    res.writeHead(200, { 'Content-Type': fs.readFileSync(file + '.type', 'utf8'), 'Cache-Control': 'public, max-age=604800, immutable' });
    return fs.createReadStream(file).pipe(res);
  }
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'error' });
    const type = String(r.headers.get('content-type') || '');
    if (!r.ok || !/^image\/(png|jpeg|webp|gif|svg\+xml)/.test(type)) throw new Error('bad image ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 5 * 1024 * 1024) throw new Error('image too large');
    fs.writeFileSync(file, buf);
    fs.writeFileSync(file + '.type', type);
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'public, max-age=604800, immutable' });
    res.end(buf);
  } catch {
    // Источник недоступен (нет интернета) — отдаём фирменный силуэт, без кеширования.
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    fs.createReadStream(brandItem).pipe(res);
  }
}

function serveUpload(res: http.ServerResponse, user: any, kind: 'public' | 'private', name: string) {
  if (!/^[\w-]{8,40}\.(png|jpe?g|webp|gif)$/.test(name)) throw new HttpError(404, 'Файл не найден');
  const file = path.join(UPLOAD_DIR, kind, name);
  if (!fs.existsSync(file)) throw new HttpError(404, 'Файл не найден');
  if (kind === 'private') {
    if (!user) throw new HttpError(401, 'Требуется вход');
    const up = one('SELECT * FROM uploads WHERE id=?', name);
    const allowed = up && (up.owner_id === user.id || can(user, 'support.manage') ||
      one('SELECT 1 FROM ticket_messages m JOIN tickets t ON t.id=m.ticket_id WHERE m.attachment=? AND t.user_id=?', name, user.id));
    if (!allowed) throw new HttpError(403, 'Нет доступа');
    res.setHeader('Content-Disposition', 'inline');
    return sendFile(res, file, 200, 'private, no-store');
  }
  sendFile(res, file, 200, 'public, max-age=86400');
}

const MAINT_OPEN = new Set(['/api/me', '/api/auth/login', '/api/auth/options', '/api/auth/logout', '/api/site', '/api/auth/steam', '/api/auth/steam/return']);

async function handle(req: http.IncomingMessage, res: http.ServerResponse) {
  securityHeaders(res);
  const ip = clientIp(req);
  const url = new URL(req.url || '/', 'http://local');
  const p = url.pathname;
  const method = req.method || 'GET';
  const cookies = parseCookies(req.headers.cookie);
  const setCookies: string[] = [];
  if (!cookies.bs_csrf) { cookies.bs_csrf = randomToken(18); setCookies.push(cookieStr('bs_csrf', cookies.bs_csrf, { httpOnly: false, maxAge: 365 * 86400_000 })); }
  const flushCookies = () => { if (setCookies.length) res.setHeader('Set-Cookie', setCookies); };
  const sess = sessionUser(cookies.bs_sid, ip);
  const user = sess && sess.user.status === 'active' ? sess.user : null;

  // ---------- Статика ----------
  if (!p.startsWith('/api/')) {
    if (method !== 'GET' && method !== 'HEAD') { flushCookies(); return sendJson(res, 405, { error: 'Метод не поддерживается' }); }
    flushCookies();
    if (p.startsWith('/img/ext/')) return proxyImage(res, p.slice(9));
    if (p.startsWith('/uploads/public/')) return serveUpload(res, user, 'public', p.slice(16));
    if (p.startsWith('/uploads/private/')) return serveUpload(res, user, 'private', p.slice(17));
    const rm = /^\/r\/([A-Za-z0-9]{3,20})$/.exec(p);
    if (rm) { res.writeHead(302, { Location: '/register?ref=' + rm[1].toUpperCase() }); return res.end(); }
    if (p.startsWith('/drop/') && SHARE_RE.test(p.slice(6))) return sendDropPage(req, res, p.slice(6));
    if (path.extname(p)) {
      const f = safeJoin(PUBLIC, p);
      if (f && fs.existsSync(f) && fs.statSync(f).isFile()) return sendFile(res, f);
      if (p.startsWith('/img/items/')) return sendFile(res, brandItem);
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Не найдено');
    }
    return sendFile(res, path.join(PUBLIC, 'index.html'), SPA.some((r) => r.test(p)) ? 200 : 404);
  }

  // ---------- API ----------
  const ctx: Ctx = {
    req, res, method, path: p, query: url.searchParams, params: {}, body: {}, ip, user, sid: sess?.sid || null, cookies,
    setCookie: (name, value, opts) => setCookies.push(cookieStr(name, value, opts)),
  };
  let idemKey: string | null = null;
  try {
    rateLimit('ip:' + ip, Number(process.env.RATE_IP_LIMIT) || 400, 10_000);
    if (p === '/api/live') { flushCookies(); return sseOpen(res, user?.id ?? null); }
    if (p === '/api/health') return sendJson(res, 200, { ok: true, time: now() });
    const m = match(method, p);
    if (!m) throw new HttpError(404, 'Метод API не найден', 'not_found');
    ctx.params = m.params;
    const o = m.r.o;
    // CSRF: double-submit cookie + проверка Origin для всех изменяющих запросов
    if (method !== 'GET' && method !== 'HEAD') {
      const origin = String(req.headers.origin || '');
      if (origin && new URL(origin).host !== String(req.headers.host || '')) throw new HttpError(403, 'Запрос с чужого сайта отклонён', 'csrf');
      const tok = String(req.headers['x-csrf-token'] || '');
      if (!tok || !cookies.bs_csrf || tok.length !== cookies.bs_csrf.length || !crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(cookies.bs_csrf)))
        throw new HttpError(403, 'Сессия устарела. Обновите страницу.', 'csrf');
      ctx.body = await readBody(req);
      if (ctx.body === null || typeof ctx.body !== 'object' || Array.isArray(ctx.body)) ctx.body = {};
    }
    // Режим обслуживания
    const maint = getSetting('maintenance');
    if (maint.enabled && !(user && isStaff(user)) && !MAINT_OPEN.has(p)) throw new HttpError(503, maint.message, 'maintenance');
    // Права
    if ((o.auth || o.perm) && !user) throw new HttpError(401, sess && sess.user.status !== 'active' ? 'Аккаунт заблокирован' : 'Требуется вход', 'auth_required');
    if (o.perm && !can(user, o.perm)) throw new HttpError(403, 'Недостаточно прав', 'forbidden');
    if (o.perm) rateLimit('admin:' + user.id, 240, 60_000);
    if (o.rate) rateLimit(`r:${method}:${m.r.re.source}:${user?.id ?? ip}`, o.rate[0], o.rate[1]);
    if (method !== 'GET' && user) rateLimit('w:' + user.id, 120, 10_000);
    // Идемпотентность: повтор с тем же ключом вернёт прежний результат, параллельный — 409
    if (o.idem && user && method !== 'GET') {
      const k = String(req.headers['idempotency-key'] || '');
      if (!/^[\w-]{8,80}$/.test(k)) throw new HttpError(400, 'Отсутствует ключ повтора запроса. Обновите страницу.', 'idem_required');
      const ex = one('SELECT * FROM idem WHERE user_id=? AND key=?', user.id, k);
      if (ex) {
        if (ex.status === 0) throw new HttpError(409, 'Запрос уже выполняется', 'in_progress');
        flushCookies();
        return sendJson(res, ex.status, JSON.parse(ex.body || '{}'));
      }
      run('INSERT INTO idem(user_id,key,status,body,created_at) VALUES(?,?,0,NULL,?)', user.id, k, now());
      idemKey = k;
    }
    const result = await m.r.h(ctx);
    if (idemKey) run('UPDATE idem SET status=200, body=? WHERE user_id=? AND key=?', JSON.stringify(result ?? { ok: true }), user.id, idemKey);
    flushCookies();
    if (ctx.redirect) { res.writeHead(302, { Location: ctx.redirect, 'Cache-Control': 'no-store' }); return res.end(); }
    if (res.headersSent) return;
    sendJson(res, 200, result ?? { ok: true });
  } catch (e: any) {
    if (idemKey && user) {
      if (e instanceof HttpError && e.status < 500) run('UPDATE idem SET status=?, body=? WHERE user_id=? AND key=?', e.status, JSON.stringify({ error: e.message, code: e.code }), user.id, idemKey);
      else run('DELETE FROM idem WHERE user_id=? AND key=?', user.id, idemKey);
    }
    flushCookies();
    if (res.headersSent) { res.end(); return; }
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message, code: e.code });
    const msg = String(e?.message || e);
    if (/insufficient|CHECK constraint failed: balance/i.test(msg)) return sendJson(res, 400, { error: 'Недостаточно средств на балансе', code: 'insufficient_funds' });
    const id = logError(e, method + ' ' + p, user?.id ?? null);
    sendJson(res, 500, { error: 'Внутренняя ошибка сервера. Мы уже записали её в журнал.', code: 'internal', ref: id ?? undefined });
  }
}

export function start(port = Number(process.env.PORT) || 3000) {
  const server = http.createServer((req, res) => {
    handle(req, res).catch((e) => { logError(e, 'server', null); if (!res.headersSent) sendJson(res, 500, { error: 'Внутренняя ошибка сервера' }); else res.end(); });
  });
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
  const t1 = setInterval(() => { try { gamesTick(); } catch (e) { logError(e, 'tick:games', null); } }, 500);
  const t2 = setInterval(() => { try { socialTick(); } catch (e) { logError(e, 'tick:social', null); } }, 30_000);
  const t3 = setInterval(() => {
    run('DELETE FROM idem WHERE created_at < ?', now() - 86400_000);
    run('DELETE FROM sessions WHERE expires_at < ?', now());
  }, 3600_000);
  server.on('close', () => { clearInterval(t1); clearInterval(t2); clearInterval(t3); });
  server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`BURGER SKIN запущен: http://localhost:${port}`));
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) start();
