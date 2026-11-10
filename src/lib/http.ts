// HTTP-ядро: маршрутизация, валидация, ошибки, rate limit, SSE, заголовки безопасности.
import type { IncomingMessage, ServerResponse } from 'node:http';
import crypto from 'node:crypto';

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'error') { super(message); this.status = status; this.code = code; }
}
export const bad = (msg: string, code = 'bad_request') => new HttpError(400, msg, code);
export const forbidden = (msg = 'Недостаточно прав') => new HttpError(403, msg, 'forbidden');
export const notFound = (msg = 'Не найдено') => new HttpError(404, msg, 'not_found');

export type Ctx = {
  req: IncomingMessage; res: ServerResponse; method: string; path: string; query: URLSearchParams;
  params: Record<string, string>; body: any; ip: string; user: any; sid: string | null; cookies: Record<string, string>;
  setCookie: (name: string, value: string, opts?: { maxAge?: number; httpOnly?: boolean }) => void;
  redirect?: string;
};
export type RouteOpts = { auth?: boolean; perm?: string; rate?: [number, number]; idem?: boolean; raw?: boolean };
type Handler = (c: Ctx) => any;
type Route = { method: string; re: RegExp; keys: string[]; h: Handler; o: RouteOpts };
export const routes: Route[] = [];

export function route(method: string, pattern: string, h: Handler, o: RouteOpts = {}) {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_m, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, h, o });
}
export function match(method: string, path: string) {
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(path);
    if (m) {
      const params: Record<string, string> = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      return { r, params };
    }
  }
  return null;
}

// ---------- Валидация входных данных ----------
export const v = {
  str(x: any, name: string, min = 1, max = 200): string {
    if (typeof x !== 'string') throw bad(`Поле «${name}» обязательно`);
    const s = x.trim();
    if (s.length < min || s.length > max) throw bad(`Поле «${name}»: от ${min} до ${max} символов`);
    return s;
  },
  optStr(x: any, name: string, max = 2000): string | null {
    if (x === undefined || x === null || x === '') return null;
    return v.str(x, name, 0, max);
  },
  int(x: any, name: string, min = -1e15, max = 1e15): number {
    const n = typeof x === 'string' && x.trim() !== '' ? Number(x) : x;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < min || n > max) throw bad(`Поле «${name}»: целое число от ${min} до ${max}`);
    return n;
  },
  num(x: any, name: string, min = -1e15, max = 1e15): number {
    const n = typeof x === 'string' && x.trim() !== '' ? Number(x) : x;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw bad(`Поле «${name}»: число от ${min} до ${max}`);
    return n;
  },
  /** Сумма в рублях (с копейками) → целое в сотых */
  money(x: any, name: string, min = 0.01, max = 1e9): number {
    const n = v.num(x, name, min, max);
    return Math.round(n * 100);
  },
  bool: (x: any) => x === true || x === 1 || x === '1' || x === 'true' || x === 'on',
  oneOf<T extends string>(x: any, name: string, list: readonly T[]): T {
    if (!list.includes(x)) throw bad(`Поле «${name}»: допустимые значения — ${list.join(', ')}`);
    return x;
  },
  ids(x: any, name: string, min = 1, max = 100): number[] {
    if (!Array.isArray(x)) throw bad(`Поле «${name}» должно быть списком`);
    const out = [...new Set(x.map((i) => v.int(i, name, 1)))];
    if (out.length < min || out.length > max) throw bad(`Выберите от ${min} до ${max} элементов`);
    return out;
  },
  email(x: any): string {
    const s = v.str(x, 'Email', 5, 120).toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) throw bad('Некорректный email');
    return s;
  },
};

// ---------- Rate limiting (скользящее окно в памяти) ----------
const buckets = new Map<string, number[]>();
export function rateLimit(key: string, limit: number, windowMs: number) {
  const t = Date.now();
  const arr = (buckets.get(key) || []).filter((x) => t - x < windowMs);
  if (arr.length >= limit) {
    buckets.set(key, arr);
    throw new HttpError(429, 'Слишком много запросов. Подождите немного и попробуйте снова.', 'rate_limited');
  }
  arr.push(t);
  buckets.set(key, arr);
}
setInterval(() => {
  const t = Date.now();
  for (const [k, arr] of buckets) if (!arr.length || t - arr[arr.length - 1] > 3600_000) buckets.delete(k);
}, 600_000).unref();

// ---------- Cookies ----------
export function parseCookies(h = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export const secureCookies = () => process.env.COOKIE_SECURE === '1' || (process.env.PUBLIC_URL || '').startsWith('https://');
export function cookieStr(name: string, value: string, opts: { maxAge?: number; httpOnly?: boolean } = {}) {
  let s = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
  if (opts.maxAge !== undefined) s += `; Max-Age=${Math.floor(opts.maxAge / 1000)}`;
  if (opts.httpOnly !== false) s += '; HttpOnly';
  if (secureCookies()) s += '; Secure';
  return s;
}

// ---------- Тело запроса ----------
export function readBody(req: IncomingMessage, limit = 4 * 1024 * 1024): Promise<any> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'Слишком большой запрос')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      const ct = String(req.headers['content-type'] || '');
      if (ct.includes('application/x-www-form-urlencoded')) return resolve(Object.fromEntries(new URLSearchParams(raw)));
      try { resolve(JSON.parse(raw)); } catch { reject(bad('Некорректный JSON')); }
    });
    req.on('error', reject);
  });
}

export function securityHeaders(res: ServerResponse) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://steamcommunity.com");
  if (secureCookies()) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
}

export function sendJson(res: ServerResponse, status: number, data: any) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

// ---------- Server-Sent Events: живые обновления (игры, битвы, лента, уведомления) ----------
type Client = { res: ServerResponse; userId: number | null };
const clients = new Set<Client>();
export function sseOpen(res: ServerResponse, userId: number | null) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 3000\n\n');
  const c: Client = { res, userId };
  clients.add(c);
  res.on('close', () => clients.delete(c));
}
export function broadcast(event: string, data: any, userId?: number) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) if (userId === undefined || c.userId === userId) c.res.write(msg);
}
export const onlineCount = () => clients.size;
setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 25_000).unref();

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
