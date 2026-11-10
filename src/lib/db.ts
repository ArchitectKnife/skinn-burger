// База данных: SQLite (встроенный node:sqlite), миграции, транзакции.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const DATA = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
fs.mkdirSync(DATA, { recursive: true });
export const DB_FILE = process.env.DB_FILE ? path.resolve(process.env.DB_FILE) : path.join(DATA, 'burger.sqlite');

export const db: any = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;');

const cache = new Map<string, any>();
function st(sql: string) {
  let s = cache.get(sql);
  if (!s) { s = db.prepare(sql); cache.set(sql, s); }
  return s;
}
const norm = (p: any[]) => p.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
export const one = (sql: string, ...p: any[]): any => st(sql).get(...norm(p));
export const all = (sql: string, ...p: any[]): any[] => st(sql).all(...norm(p));
export const run = (sql: string, ...p: any[]): { changes: number; lastInsertRowid: number } => {
  const r = st(sql).run(...norm(p));
  return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
};
export const now = () => Date.now();

let depth = 0;
/** Атомарная транзакция. Все игровые и финансовые операции выполняются внутри неё. */
export function tx<T>(fn: () => T): T {
  if (depth > 0) return fn();
  depth++;
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
  finally { depth--; }
}

const MIGRATIONS: string[] = [
  /* 1: базовая схема */ `
CREATE TABLE users(
  id INTEGER PRIMARY KEY, login TEXT NOT NULL UNIQUE COLLATE NOCASE, email TEXT UNIQUE COLLATE NOCASE, pass_hash TEXT,
  nickname TEXT NOT NULL, avatar TEXT, steam_id TEXT UNIQUE, steam_name TEXT, role TEXT NOT NULL DEFAULT 'USER',
  status TEXT NOT NULL DEFAULT 'active', ban_reason TEXT, restrictions TEXT NOT NULL DEFAULT '{}',
  balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0), ref_code TEXT UNIQUE, referred_by INTEGER, ref_rewarded INTEGER NOT NULL DEFAULT 0,
  failed_logins INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, reg_ip TEXT, last_ip TEXT,
  daily_streak INTEGER NOT NULL DEFAULT 0, daily_last INTEGER NOT NULL DEFAULT 0, private_profile INTEGER NOT NULL DEFAULT 0,
  notify_email INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL, last_seen INTEGER);
CREATE TABLE sessions(id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, last_seen INTEGER, ip TEXT, ua TEXT);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE password_resets(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at INTEGER, expires_at INTEGER, used_at INTEGER);
CREATE TABLE ledger(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, balance_after INTEGER NOT NULL,
  type TEXT NOT NULL, ref_type TEXT, ref_id TEXT, reason TEXT, actor_id INTEGER, created_at INTEGER NOT NULL);
CREATE INDEX ledger_user ON ledger(user_id, id);
CREATE TRIGGER ledger_no_update BEFORE UPDATE ON ledger BEGIN SELECT RAISE(ABORT, 'ledger is immutable'); END;
CREATE TRIGGER ledger_no_delete BEFORE DELETE ON ledger BEGIN SELECT RAISE(ABORT, 'ledger is immutable'); END;
CREATE TABLE idem(user_id INTEGER NOT NULL, key TEXT NOT NULL, status INTEGER, body TEXT, created_at INTEGER, PRIMARY KEY(user_id, key));
CREATE TABLE items(id INTEGER PRIMARY KEY, ext_id TEXT UNIQUE, name TEXT NOT NULL, weapon TEXT, category TEXT, pattern TEXT,
  rarity TEXT, rarity_name TEXT, rarity_color TEXT, min_float REAL NOT NULL DEFAULT 0, max_float REAL NOT NULL DEFAULT 1,
  stattrak INTEGER NOT NULL DEFAULT 0, souvenir INTEGER NOT NULL DEFAULT 0, image TEXT, collection TEXT, crates TEXT,
  archived INTEGER NOT NULL DEFAULT 0, base_price INTEGER, price_source TEXT, created_at INTEGER, updated_at INTEGER);
CREATE INDEX items_name ON items(name);
CREATE INDEX items_weapon ON items(weapon);
CREATE TABLE item_prices(item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE, wear TEXT NOT NULL, variant TEXT NOT NULL DEFAULT '',
  price INTEGER NOT NULL, source TEXT, updated_at INTEGER, PRIMARY KEY(item_id, wear, variant));
CREATE TABLE cases(id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, description TEXT, image TEXT,
  price INTEGER NOT NULL DEFAULT 0, price_mode TEXT NOT NULL DEFAULT 'auto', categories TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'published', opens INTEGER NOT NULL DEFAULT 0, sort INTEGER NOT NULL DEFAULT 0,
  source TEXT, ext_id TEXT UNIQUE, created_at INTEGER, updated_at INTEGER);
CREATE TABLE case_items(case_id INTEGER NOT NULL REFERENCES cases(id) ON DELETE CASCADE, item_id INTEGER NOT NULL REFERENCES items(id),
  weight REAL NOT NULL CHECK(weight > 0), PRIMARY KEY(case_id, item_id));
CREATE TABLE inventory(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id), item_id INTEGER NOT NULL REFERENCES items(id),
  wear TEXT, float REAL, variant TEXT NOT NULL DEFAULT '', price INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'owned',
  source TEXT, source_id TEXT, created_at INTEGER, updated_at INTEGER);
CREATE INDEX inv_user ON inventory(user_id, status);
CREATE TABLE fair_seeds(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, server_seed TEXT NOT NULL, server_hash TEXT NOT NULL,
  client_seed TEXT NOT NULL, nonce INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER, revealed_at INTEGER);
CREATE INDEX fair_user ON fair_seeds(user_id, active);
CREATE TABLE bets(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, game TEXT NOT NULL, amount INTEGER NOT NULL, payout INTEGER NOT NULL DEFAULT 0,
  multiplier REAL, status TEXT NOT NULL, data TEXT, secret TEXT, seed_id INTEGER, nonce INTEGER, server_hash TEXT, created_at INTEGER, settled_at INTEGER);
CREATE INDEX bets_user ON bets(user_id, game, id);
CREATE INDEX bets_game ON bets(game, id);
CREATE TABLE rounds(id INTEGER PRIMARY KEY, game TEXT NOT NULL, status TEXT NOT NULL, seed TEXT NOT NULL, hash TEXT NOT NULL, result TEXT,
  created_at INTEGER, started_at INTEGER, ended_at INTEGER);
CREATE INDEX rounds_game ON rounds(game, id);
CREATE TABLE round_bets(id INTEGER PRIMARY KEY, round_id INTEGER NOT NULL, user_id INTEGER NOT NULL, amount INTEGER NOT NULL, choice TEXT,
  auto REAL, cashout REAL, payout INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER);
CREATE INDEX rb_round ON round_bets(round_id);
CREATE TABLE battles(id INTEGER PRIMARY KEY, creator_id INTEGER NOT NULL, mode TEXT NOT NULL DEFAULT 'classic', cases TEXT NOT NULL,
  max_players INTEGER NOT NULL, private INTEGER NOT NULL DEFAULT 0, invite_code TEXT, cost INTEGER NOT NULL, status TEXT NOT NULL,
  server_seed TEXT NOT NULL, server_hash TEXT NOT NULL, result TEXT, total INTEGER NOT NULL DEFAULT 0, winner_slot INTEGER, winner_id INTEGER,
  created_at INTEGER, start_at INTEGER, finished_at INTEGER);
CREATE TABLE battle_players(battle_id INTEGER NOT NULL REFERENCES battles(id), slot INTEGER NOT NULL, user_id INTEGER, bot INTEGER NOT NULL DEFAULT 0,
  client_seed TEXT, total INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(battle_id, slot));
CREATE TABLE coinflips(id INTEGER PRIMARY KEY, creator_id INTEGER NOT NULL, joiner_id INTEGER, joiner_bot INTEGER NOT NULL DEFAULT 0, amount INTEGER NOT NULL,
  side TEXT NOT NULL, status TEXT NOT NULL, server_seed TEXT NOT NULL, server_hash TEXT NOT NULL, client_seed TEXT, result TEXT,
  winner_id INTEGER, payout INTEGER NOT NULL DEFAULT 0, created_at INTEGER, finished_at INTEGER);
CREATE TABLE pass_seasons(id INTEGER PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', xp_per_level INTEGER NOT NULL DEFAULT 500,
  premium_price INTEGER NOT NULL DEFAULT 0, starts_at INTEGER, ends_at INTEGER, created_at INTEGER);
CREATE TABLE pass_rewards(id INTEGER PRIMARY KEY, season_id INTEGER NOT NULL REFERENCES pass_seasons(id) ON DELETE CASCADE, level INTEGER NOT NULL,
  track TEXT NOT NULL, type TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0, item_id INTEGER, case_id INTEGER, label TEXT,
  UNIQUE(season_id, level, track));
CREATE TABLE pass_progress(user_id INTEGER NOT NULL, season_id INTEGER NOT NULL, xp INTEGER NOT NULL DEFAULT 0, premium INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(user_id, season_id));
CREATE TABLE pass_claims(user_id INTEGER NOT NULL, reward_id INTEGER NOT NULL, created_at INTEGER, PRIMARY KEY(user_id, reward_id));
CREATE TABLE quests(id INTEGER PRIMARY KEY, scope TEXT NOT NULL, title TEXT NOT NULL, metric TEXT NOT NULL, goal INTEGER NOT NULL,
  reward INTEGER NOT NULL DEFAULT 0, xp INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, sort INTEGER NOT NULL DEFAULT 0);
CREATE TABLE quest_progress(user_id INTEGER NOT NULL, quest_id INTEGER NOT NULL, period TEXT NOT NULL, progress INTEGER NOT NULL DEFAULT 0,
  claimed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, quest_id, period));
CREATE TABLE user_stats(user_id INTEGER NOT NULL, metric TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(user_id, metric));
CREATE TABLE achievements(code TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT, metric TEXT NOT NULL, goal INTEGER NOT NULL,
  reward INTEGER NOT NULL DEFAULT 0, icon TEXT, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE user_achievements(user_id INTEGER NOT NULL, code TEXT NOT NULL, created_at INTEGER, PRIMARY KEY(user_id, code));
CREATE TABLE promo_codes(id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE COLLATE NOCASE, amount INTEGER NOT NULL, max_uses INTEGER NOT NULL DEFAULT 0,
  uses INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, active INTEGER NOT NULL DEFAULT 1, created_by INTEGER, created_at INTEGER);
CREATE TABLE promo_uses(promo_id INTEGER NOT NULL, user_id INTEGER NOT NULL, created_at INTEGER, PRIMARY KEY(promo_id, user_id));
CREATE TABLE events(id INTEGER PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, description TEXT, metric TEXT, goal INTEGER,
  reward INTEGER NOT NULL DEFAULT 0, prizes TEXT NOT NULL DEFAULT '[]', starts_at INTEGER, ends_at INTEGER, status TEXT NOT NULL DEFAULT 'active', created_at INTEGER);
CREATE TABLE event_claims(event_id INTEGER NOT NULL, user_id INTEGER NOT NULL, amount INTEGER, place INTEGER, created_at INTEGER, PRIMARY KEY(event_id, user_id));
CREATE TABLE friends(user_id INTEGER NOT NULL, friend_id INTEGER NOT NULL, status TEXT NOT NULL, created_at INTEGER, PRIMARY KEY(user_id, friend_id));
CREATE TABLE notifications(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, type TEXT, title TEXT NOT NULL, body TEXT, link TEXT,
  read INTEGER NOT NULL DEFAULT 0, created_at INTEGER);
CREATE INDEX notif_user ON notifications(user_id, id);
CREATE TABLE news(id INTEGER PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, image TEXT, kind TEXT NOT NULL DEFAULT 'news',
  published INTEGER NOT NULL DEFAULT 1, created_by INTEGER, created_at INTEGER);
CREATE TABLE tickets(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, subject TEXT NOT NULL, category TEXT NOT NULL, priority TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', assignee_id INTEGER, created_at INTEGER, updated_at INTEGER);
CREATE TABLE ticket_messages(id INTEGER PRIMARY KEY, ticket_id INTEGER NOT NULL REFERENCES tickets(id), user_id INTEGER NOT NULL, staff INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL, attachment TEXT, created_at INTEGER);
CREATE TABLE finance_requests(id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0, inv_id INTEGER,
  method TEXT, details TEXT, status TEXT NOT NULL DEFAULT 'pending', staff_id INTEGER, comment TEXT, created_at INTEGER, decided_at INTEGER);
CREATE TABLE uploads(id TEXT PRIMARY KEY, owner_id INTEGER, kind TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER, created_at INTEGER);
CREATE TABLE audit_log(id INTEGER PRIMARY KEY, actor_id INTEGER, action TEXT NOT NULL, target_type TEXT, target_id TEXT, data TEXT, ip TEXT,
  created_at INTEGER NOT NULL, prev_hash TEXT, hash TEXT NOT NULL);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is immutable'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is immutable'); END;
CREATE TABLE settings(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER);
CREATE TABLE error_log(id INTEGER PRIMARY KEY, level TEXT, message TEXT, stack TEXT, path TEXT, user_id INTEGER, created_at INTEGER);
`,
  /* 2: ожидаемая стоимость кейса и индексы */ `
ALTER TABLE cases ADD COLUMN ev INTEGER NOT NULL DEFAULT 0;
CREATE INDEX inv_item ON inventory(item_id);
CREATE INDEX bets_created ON bets(created_at);
CREATE INDEX ledger_created ON ledger(created_at);
CREATE INDEX users_created ON users(created_at);
CREATE INDEX tickets_user ON tickets(user_id, id);
CREATE INDEX fin_user ON finance_requests(user_id, id);
CREATE INDEX friends_friend ON friends(friend_id);
`,
  /* 3: валюта RUB в подписях (числа не меняются), личные настройки, обложки кейсов, иконки достижений */ `
ALTER TABLE users ADD COLUMN prefs TEXT;
ALTER TABLE cases ADD COLUMN cover_mode TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE cases ADD COLUMN cover_items TEXT;
UPDATE cases SET cover_mode='image' WHERE image IS NOT NULL AND image<>'' AND image NOT LIKE '/img/cases/%';
UPDATE pass_rewards SET label=replace(label,' BC',' ₽') WHERE label LIKE '% BC%';
UPDATE quests SET title=replace(title,' BC',' ₽') WHERE title LIKE '% BC%';
UPDATE achievements SET description=replace(description,' BC',' ₽') WHERE description LIKE '% BC%';
UPDATE notifications SET body=replace(body,' BC',' ₽') WHERE body LIKE '% BC%';
UPDATE notifications SET title=replace(title,' BC',' ₽') WHERE title LIKE '% BC%';
UPDATE news SET body=replace(body,' BC',' ₽') WHERE body LIKE '% BC%';
UPDATE news SET title=replace(title,' BC',' ₽') WHERE title LIKE '% BC%';
UPDATE achievements SET icon=CASE WHEN icon LIKE '🍔%' THEN 'pass' WHEN icon LIKE '🍟%' THEN 'flame' WHEN icon LIKE '👨%' THEN 'award' WHEN icon LIKE '⬆%' THEN 'upgrade' WHEN icon LIKE '🚀%' THEN 'crash' WHEN icon LIKE '📜%' THEN 'contracts' WHEN icon LIKE '⚔%' THEN 'battles' WHEN icon LIKE '🤝%' THEN 'friends' WHEN icon LIKE '💎%' THEN 'gem' WHEN icon LIKE '📅%' THEN 'calendar' WHEN icon LIKE '🔥%' THEN 'flame' WHEN icon LIKE '🏆%' THEN 'trophy' WHEN icon LIKE '🏅%' THEN 'medal' ELSE 'medal' END WHERE icon IS NOT NULL AND icon<>'' AND icon NOT GLOB '[a-zA-Z]*';
CREATE INDEX IF NOT EXISTS bets_game_user ON bets(game, user_id, id);
`,
];

export function migrate() {
  const cur = Number(one('PRAGMA user_version').user_version);
  for (let i = cur; i < MIGRATIONS.length; i++) {
    db.exec('BEGIN');
    try { db.exec(MIGRATIONS[i]); db.exec(`PRAGMA user_version=${i + 1}`); db.exec('COMMIT'); }
    catch (e) { db.exec('ROLLBACK'); throw e; }
  }
}
migrate();
