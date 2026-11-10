// Игры: Crash, Double, Jackpot (общие раунды), Coinflip, Roulette, Mines, Towers и Case Battle.
// Все результаты считаются на сервере из заранее зафиксированных seed (хеш публикуется до ставки).
import { one, all, run, tx, now } from '../lib/db.ts';
import { route, v, bad, notFound, forbidden, broadcast, sha256, randomToken } from '../lib/http.ts';
import { getSetting, requireFeature, checkRestriction, gameLimits, wager, change, track, notify, roll, newSeed, floatsFrom, publicSalt,
  publicUser, addInventory, priceOf, hasWear, wearOf, imageUrl, activeSeed, logError, rub } from '../lib/core.ts';
import { caseRows, dropFrom } from '../lib/cases.ts';
import { can } from '../lib/auth.ts';

const AUTH = { auth: true, idem: true, rate: [40, 10_000] as [number, number] };
function guard(c: any, game: string, amount: number) {
  requireFeature('games', 'Игры');
  checkRestriction(c.user, 'games');
  gameLimits(game, amount);
}
function logBet(userId: number, game: string, amount: number, payout: number, mult: number | null, data: any, seed: any = null) {
  const id = run('INSERT INTO bets(user_id,game,amount,payout,multiplier,status,data,seed_id,nonce,server_hash,created_at,settled_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    userId, game, amount, payout, mult, payout > 0 ? 'won' : 'lost', JSON.stringify(data), seed?.seedId ?? null, seed?.nonce ?? null, seed?.hash ?? null, now(), now()).lastInsertRowid;
  track(userId, 'game');
  return id;
}
const userBets = (userId: number | undefined, game: string, n = 15) => userId
  ? all("SELECT id, amount, payout, multiplier, status, data, created_at FROM bets WHERE user_id=? AND game=? AND status<>'active' ORDER BY id DESC LIMIT ?", userId, game, n)
    .map((b) => ({ ...b, data: JSON.parse(b.data || '{}') })) : [];

// ================= Общие раунды =================
function newRound(game: string, startsAt: number | null) {
  const seed = newSeed();
  const id = run('INSERT INTO rounds(game,status,seed,hash,result,created_at,started_at) VALUES(?,?,?,?,?,?,?)', game, 'betting', seed, sha256(seed), null, now(), startsAt).lastInsertRowid;
  broadcast(game, { phase: 'betting', id });
  return id;
}
const roundFloat = (r: any) => floatsFrom(r.seed, publicSalt(), `${r.game}:${r.id}`, 1)[0];
function roundPublic(r: any) {
  if (!r) return null;
  const show = r.status === 'ended' || (r.game === 'double' && r.status === 'running');
  return { id: r.id, game: r.game, status: r.status, hash: r.hash, seed: r.status === 'ended' ? r.seed : null, salt: publicSalt(),
    result: show && r.result ? JSON.parse(r.result) : null, createdAt: r.created_at, startedAt: r.started_at, endedAt: r.ended_at };
}
function roundBets(roundId: number) {
  return all('SELECT rb.*, u.nickname, u.avatar, u.role, u.created_at uc FROM round_bets rb JOIN users u ON u.id=rb.user_id WHERE rb.round_id=? ORDER BY rb.amount DESC, rb.id', roundId)
    .map((b) => ({ id: b.id, user: publicUser({ id: b.user_id, nickname: b.nickname, avatar: b.avatar, role: b.role, created_at: b.uc }), amount: b.amount, choice: b.choice,
      cashout: b.status === 'won' ? b.cashout : null, payout: b.payout, status: b.status, createdAt: b.created_at }));
}
function settleRoundBet(b: any, payout: number, mult: number | null, game: string, roundId: number, data: any = {}) {
  const u = run("UPDATE round_bets SET status=?, payout=?, cashout=? WHERE id=? AND status='active'", payout > 0 ? 'won' : 'lost', payout, mult, b.id);
  if (u.changes !== 1) return false;
  if (payout > 0) change(b.user_id, payout, 'win', { ref: game, refId: roundId, reason: game });
  logBet(b.user_id, game, b.amount, payout, mult, { roundId, choice: b.choice, ...data });
  if (payout > 0) broadcast('balance_hint', {}, b.user_id);
  return true;
}
route('GET', '/api/rounds/:id', (c) => {
  const r = one('SELECT * FROM rounds WHERE id=?', v.int(c.params.id, 'id', 1));
  if (!r) throw notFound('Раунд не найден');
  return { round: roundPublic(r), bets: roundBets(r.id) };
});
const lastRounds = (game: string, n = 20) => all("SELECT * FROM rounds WHERE game=? AND status='ended' ORDER BY id DESC LIMIT ?", game, n).map(roundPublic);
const liveRound = (game: string) => one("SELECT * FROM rounds WHERE game=? AND status IN ('betting','running') ORDER BY id DESC LIMIT 1", game);

// ================= CRASH =================
const CRASH_BET_MS = 8000, CRASH_PAUSE_MS = 3000, GROWTH = 0.06;
export const crashPoint = (r: any) => Math.min(1000, Math.max(1, Math.floor(97 / (1 - roundFloat(r))) / 100));
const multAt = (ms: number) => Math.floor(100 * Math.exp((GROWTH * Math.max(0, ms)) / 1000)) / 100;
const crashMs = (cp: number) => (Math.log(cp) / GROWTH) * 1000;
function crashTick(t: number) {
  const r = liveRound('crash');
  if (!r) {
    const last = one("SELECT ended_at FROM rounds WHERE game='crash' ORDER BY id DESC LIMIT 1");
    if (!last || t - (last.ended_at || 0) >= CRASH_PAUSE_MS) newRound('crash', t + CRASH_BET_MS);
    return;
  }
  if (r.status === 'betting') {
    if (t >= r.started_at) { run("UPDATE rounds SET status='running', started_at=? WHERE id=?", t, r.id); broadcast('crash', { phase: 'running', id: r.id, startedAt: t, serverTime: t }); }
    return;
  }
  const cp = crashPoint(r);
  const el = t - r.started_at;
  const m = Math.min(multAt(el), cp);
  tx(() => {
    for (const b of all("SELECT * FROM round_bets WHERE round_id=? AND status='active' AND auto IS NOT NULL AND auto <= ?", r.id, m)) {
      if (b.auto <= cp && settleRoundBet(b, Math.floor(b.amount * b.auto), b.auto, 'crash', r.id)) broadcast('crash', { phase: 'cashout', id: r.id, m: b.auto });
    }
    if (el >= crashMs(cp)) {
      for (const b of all("SELECT * FROM round_bets WHERE round_id=? AND status='active'", r.id)) settleRoundBet(b, 0, null, 'crash', r.id, { crash: cp });
      run("UPDATE rounds SET status='ended', result=?, ended_at=? WHERE id=?", JSON.stringify({ crash: cp }), t, r.id);
      broadcast('crash', { phase: 'ended', id: r.id, crash: cp });
    }
  });
}
route('GET', '/api/crash', (c) => {
  const r = liveRound('crash') || one("SELECT * FROM rounds WHERE game='crash' ORDER BY id DESC LIMIT 1");
  return { serverTime: now(), growth: GROWTH, betMs: CRASH_BET_MS, round: roundPublic(r), bets: r ? roundBets(r.id) : [], history: lastRounds('crash'), my: userBets(c.user?.id, 'crash'),
    myActive: r && c.user ? one('SELECT amount, auto, status, cashout, payout FROM round_bets WHERE round_id=? AND user_id=?', r.id, c.user.id) : null, limits: getSetting('games').crash };
});
route('POST', '/api/crash/bet', (c) => {
  const amount = v.money(c.body.amount, 'Ставка');
  guard(c, 'crash', amount);
  const auto = c.body.auto ? Math.floor(v.num(c.body.auto, 'Автовывод', 1.01, 1000) * 100) / 100 : null;
  return tx(() => {
    const r = one("SELECT * FROM rounds WHERE game='crash' AND status='betting' ORDER BY id DESC LIMIT 1");
    if (!r || now() >= r.started_at) throw bad('Приём ставок закрыт — дождитесь следующего раунда');
    if (one('SELECT 1 FROM round_bets WHERE round_id=? AND user_id=?', r.id, c.user.id)) throw bad('Вы уже сделали ставку в этом раунде');
    const balance = wager(c.user.id, amount, 'crash', r.id);
    run('INSERT INTO round_bets(round_id,user_id,amount,choice,auto,created_at) VALUES(?,?,?,?,?,?)', r.id, c.user.id, amount, 'crash', auto, now());
    broadcast('crash', { phase: 'bet', id: r.id });
    return { ok: true, balance, roundId: r.id };
  });
}, AUTH);
route('POST', '/api/crash/cashout', (c) => tx(() => {
  const r = one("SELECT * FROM rounds WHERE game='crash' AND status='running' ORDER BY id DESC LIMIT 1");
  if (!r) throw bad('Раунд ещё не начался');
  const b = one("SELECT * FROM round_bets WHERE round_id=? AND user_id=? AND status='active'", r.id, c.user.id);
  if (!b) throw bad('Нет активной ставки');
  const cp = crashPoint(r);
  const el = now() - r.started_at;
  if (el >= crashMs(cp)) throw bad('Слишком поздно — бургер уже взорвался');
  const m = Math.min(multAt(el), cp);
  const payout = Math.floor(b.amount * m);
  settleRoundBet(b, payout, m, 'crash', r.id);
  broadcast('crash', { phase: 'cashout', id: r.id, m });
  return { ok: true, multiplier: m, payout, balance: one('SELECT balance FROM users WHERE id=?', c.user.id).balance };
}), AUTH);

// ================= DOUBLE =================
const DOUBLE_BET_MS = 15000, DOUBLE_ROLL_MS = 6000, DOUBLE_PAUSE_MS = 3000;
const doubleColor = (n: number) => (n === 0 ? 'green' : n <= 7 ? 'red' : 'black');
const DOUBLE_PAY: Record<string, number> = { red: 2, black: 2, green: 14 };
function doubleTick(t: number) {
  const r = liveRound('double');
  if (!r) {
    const last = one("SELECT ended_at FROM rounds WHERE game='double' ORDER BY id DESC LIMIT 1");
    if (!last || t - (last.ended_at || 0) >= DOUBLE_PAUSE_MS) newRound('double', t + DOUBLE_BET_MS);
    return;
  }
  if (r.status === 'betting' && t >= r.started_at) {
    const n = Math.floor(roundFloat(r) * 15);
    run("UPDATE rounds SET status='running', started_at=?, result=? WHERE id=?", t, JSON.stringify({ n, color: doubleColor(n) }), r.id);
    broadcast('double', { phase: 'rolling', id: r.id, n, startedAt: t, serverTime: t });
    return;
  }
  if (r.status === 'running' && t - r.started_at >= DOUBLE_ROLL_MS) {
    const res = JSON.parse(r.result);
    tx(() => {
      for (const b of all("SELECT * FROM round_bets WHERE round_id=? AND status='active'", r.id)) {
        const win = b.choice === res.color;
        settleRoundBet(b, win ? b.amount * DOUBLE_PAY[b.choice] : 0, win ? DOUBLE_PAY[b.choice] : 0, 'double', r.id, { n: res.n });
      }
      run("UPDATE rounds SET status='ended', ended_at=? WHERE id=?", t, r.id);
    });
    broadcast('double', { phase: 'ended', id: r.id, ...res });
  }
}
route('GET', '/api/double', (c) => {
  const r = liveRound('double') || one("SELECT * FROM rounds WHERE game='double' ORDER BY id DESC LIMIT 1");
  return { serverTime: now(), betMs: DOUBLE_BET_MS, rollMs: DOUBLE_ROLL_MS, round: roundPublic(r), bets: r ? roundBets(r.id) : [], history: lastRounds('double', 30), my: userBets(c.user?.id, 'double'), limits: getSetting('games').double };
});
route('POST', '/api/double/bet', (c) => {
  const amount = v.money(c.body.amount, 'Ставка');
  const color = v.oneOf(c.body.color, 'Цвет', ['red', 'black', 'green'] as const);
  guard(c, 'double', amount);
  return tx(() => {
    const r = one("SELECT * FROM rounds WHERE game='double' AND status='betting' ORDER BY id DESC LIMIT 1");
    if (!r || now() >= r.started_at) throw bad('Приём ставок закрыт — дождитесь следующего раунда');
    if (one('SELECT 1 FROM round_bets WHERE round_id=? AND user_id=? AND choice=?', r.id, c.user.id, color)) throw bad('Ставка на этот цвет уже сделана');
    const balance = wager(c.user.id, amount, 'double', r.id);
    run('INSERT INTO round_bets(round_id,user_id,amount,choice,created_at) VALUES(?,?,?,?,?)', r.id, c.user.id, amount, color, now());
    broadcast('double', { phase: 'bet', id: r.id });
    return { ok: true, balance };
  });
}, AUTH);

// ================= JACKPOT =================
const JACKPOT_COUNTDOWN_MS = 25000, JACKPOT_REFUND_MS = 120000, JACKPOT_FEE = 0.05, JACKPOT_PAUSE_MS = 5000;
function jackpotTick(t: number) {
  const r = liveRound('jackpot');
  if (!r) {
    const last = one("SELECT ended_at FROM rounds WHERE game='jackpot' ORDER BY id DESC LIMIT 1");
    if (!last || t - (last.ended_at || 0) >= JACKPOT_PAUSE_MS) newRound('jackpot', null);
    return;
  }
  const bets = all("SELECT * FROM round_bets WHERE round_id=? AND status='active' ORDER BY id", r.id);
  if (!bets.length) return;
  const players = new Set(bets.map((b) => b.user_id)).size;
  if (players === 1 && t - bets[0].created_at >= JACKPOT_REFUND_MS) {
    tx(() => {
      for (const b of bets) {
        run("UPDATE round_bets SET status='refunded', payout=? WHERE id=?", b.amount, b.id);
        change(b.user_id, b.amount, 'refund', { ref: 'jackpot', refId: r.id, reason: 'Jackpot: нет соперников, ставка возвращена' });
      }
      run("UPDATE rounds SET status='ended', result=?, ended_at=? WHERE id=?", JSON.stringify({ refunded: true }), t, r.id);
    });
    broadcast('jackpot', { phase: 'ended', id: r.id, refunded: true });
    return;
  }
  if (r.started_at && t >= r.started_at) {
    const pot = bets.reduce((s, b) => s + b.amount, 0);
    const ticket = Math.floor(roundFloat(r) * pot);
    let acc = 0, winner = bets[bets.length - 1];
    for (const b of bets) { if (ticket < acc + b.amount) { winner = b; break; } acc += b.amount; }
    const prize = Math.floor(pot * (1 - JACKPOT_FEE));
    tx(() => {
      for (const b of bets) {
        const win = b.user_id === winner.user_id;
        const share = win ? bets.filter((x) => x.user_id === winner.user_id).reduce((s, x) => s + x.amount, 0) : 0;
        // Выигрыш начисляется одной ставке победителя; остальные его ставки закрываются как участвующие в выигрыше.
        if (win && b.id === winner.id) settleRoundBet(b, prize, prize / share, 'jackpot', r.id, { pot, ticket, chance: share / pot });
        else if (win) { run("UPDATE round_bets SET status='won', payout=0 WHERE id=?", b.id); }
        else settleRoundBet(b, 0, 0, 'jackpot', r.id, { pot, ticket });
      }
      run("UPDATE rounds SET status='ended', result=?, ended_at=? WHERE id=?", JSON.stringify({ pot, prize, ticket, winnerId: winner.user_id, winner: publicUser(one('SELECT * FROM users WHERE id=?', winner.user_id)) }), t, r.id);
    });
    notify(winner.user_id, 'game', 'Jackpot ваш!', `Вы выиграли ${rub(prize)}`, '/games/jackpot');
    broadcast('jackpot', { phase: 'ended', id: r.id });
  }
}
route('GET', '/api/jackpot', (c) => {
  const r = liveRound('jackpot') || one("SELECT * FROM rounds WHERE game='jackpot' ORDER BY id DESC LIMIT 1");
  const bets = r ? roundBets(r.id) : [];
  return { serverTime: now(), fee: JACKPOT_FEE, countdownMs: JACKPOT_COUNTDOWN_MS, round: roundPublic(r), bets, pot: bets.reduce((s, b) => s + b.amount, 0),
    history: lastRounds('jackpot', 15), my: userBets(c.user?.id, 'jackpot'), limits: getSetting('games').jackpot };
});
route('POST', '/api/jackpot/bet', (c) => {
  const amount = v.money(c.body.amount, 'Ставка');
  guard(c, 'jackpot', amount);
  return tx(() => {
    const r = one("SELECT * FROM rounds WHERE game='jackpot' AND status='betting' ORDER BY id DESC LIMIT 1");
    if (!r || (r.started_at && now() >= r.started_at - 1000)) throw bad('Розыгрыш уже начинается — дождитесь следующего раунда');
    if (one('SELECT COUNT(*) n FROM round_bets WHERE round_id=? AND user_id=?', r.id, c.user.id).n >= 5) throw bad('Максимум 5 ставок за раунд');
    const balance = wager(c.user.id, amount, 'jackpot', r.id);
    run('INSERT INTO round_bets(round_id,user_id,amount,choice,created_at) VALUES(?,?,?,?,?)', r.id, c.user.id, amount, 'pot', now());
    const players = one('SELECT COUNT(DISTINCT user_id) n FROM round_bets WHERE round_id=?', r.id).n;
    if (players >= 2 && !r.started_at) run('UPDATE rounds SET started_at=? WHERE id=?', now() + JACKPOT_COUNTDOWN_MS, r.id);
    broadcast('jackpot', { phase: 'bet', id: r.id });
    return { ok: true, balance };
  });
}, AUTH);

// ================= COINFLIP =================
const COINFLIP_FEE = 0.05, COINFLIP_TTL = 30 * 60_000;
function coinflipView(f: any) {
  const u = (id: number | null) => (id ? publicUser(one('SELECT * FROM users WHERE id=?', id)) : null);
  return { id: f.id, creator: u(f.creator_id), joiner: f.joiner_bot ? { id: 0, nickname: 'Бургер-бот', avatar: null, role: 'BOT' } : u(f.joiner_id), amount: f.amount, side: f.side,
    status: f.status, hash: f.server_hash, seed: f.status === 'finished' ? f.server_seed : null, clientSeed: f.client_seed, result: f.result, winnerId: f.winner_id, payout: f.payout, createdAt: f.created_at, finishedAt: f.finished_at };
}
function coinflipResolve(f: any, joinerId: number | null, joinerSeed: string) {
  const creatorSeed = activeSeed(f.creator_id).client_seed;
  const clientSeed = `${creatorSeed}:${joinerSeed}`;
  const r = floatsFrom(f.server_seed, clientSeed, f.id, 1)[0];
  const result = r < 0.5 ? 'ct' : 't';
  const creatorWins = result === f.side;
  const payout = Math.floor(f.amount * 2 * (1 - COINFLIP_FEE));
  const winnerId = creatorWins ? f.creator_id : joinerId;
  run("UPDATE coinflips SET status='finished', client_seed=?, result=?, winner_id=?, payout=?, finished_at=? WHERE id=?", clientSeed, result, winnerId, payout, now(), f.id);
  if (winnerId) change(winnerId, payout, 'win', { ref: 'coinflip', refId: f.id, reason: 'Coinflip' });
  logBet(f.creator_id, 'coinflip', f.amount, creatorWins ? payout : 0, creatorWins ? payout / f.amount : 0, { flipId: f.id, side: f.side, result });
  if (joinerId) logBet(joinerId, 'coinflip', f.amount, creatorWins ? 0 : payout, creatorWins ? 0 : payout / f.amount, { flipId: f.id, side: f.side === 'ct' ? 't' : 'ct', result });
  notify(f.creator_id, 'game', creatorWins ? 'Coinflip: победа!' : 'Coinflip: поражение', `Выпало: ${result.toUpperCase()}`, '/games/coinflip');
  broadcast('coinflip', { id: f.id, phase: 'finished' });
  return coinflipView(one('SELECT * FROM coinflips WHERE id=?', f.id));
}
route('GET', '/api/coinflip', (c) => ({
  open: all("SELECT * FROM coinflips WHERE status='open' ORDER BY amount DESC, id DESC LIMIT 50").map(coinflipView),
  recent: all("SELECT * FROM coinflips WHERE status='finished' ORDER BY id DESC LIMIT 20").map(coinflipView),
  my: userBets(c.user?.id, 'coinflip'), fee: COINFLIP_FEE, limits: getSetting('games').coinflip,
}));
route('POST', '/api/coinflip', (c) => {
  const amount = v.money(c.body.amount, 'Ставка');
  const side = v.oneOf(c.body.side, 'Сторона', ['ct', 't'] as const);
  guard(c, 'coinflip', amount);
  return tx(() => {
    if (one("SELECT COUNT(*) n FROM coinflips WHERE creator_id=? AND status='open'", c.user.id).n >= 5) throw bad('Максимум 5 открытых игр одновременно');
    const seed = newSeed();
    const id = run('INSERT INTO coinflips(creator_id,amount,side,status,server_seed,server_hash,created_at) VALUES(?,?,?,?,?,?,?)', c.user.id, amount, side, 'open', seed, sha256(seed), now()).lastInsertRowid;
    const balance = wager(c.user.id, amount, 'coinflip', id);
    broadcast('coinflip', { id, phase: 'open' });
    return { flip: coinflipView(one('SELECT * FROM coinflips WHERE id=?', id)), balance };
  });
}, AUTH);
route('POST', '/api/coinflip/:id/join', (c) => tx(() => {
  const f = one("SELECT * FROM coinflips WHERE id=? AND status='open'", v.int(c.params.id, 'id', 1));
  if (!f) throw bad('Игра уже занята или отменена');
  if (f.creator_id === c.user.id) throw bad('Нельзя играть против себя');
  guard(c, 'coinflip', f.amount);
  if (run("UPDATE coinflips SET status='playing', joiner_id=? WHERE id=? AND status='open'", c.user.id, f.id).changes !== 1) throw bad('Игра уже занята');
  wager(c.user.id, f.amount, 'coinflip', f.id);
  return { flip: coinflipResolve(f, c.user.id, activeSeed(c.user.id).client_seed) };
}), AUTH);
route('POST', '/api/coinflip/:id/bot', (c) => tx(() => {
  const f = one("SELECT * FROM coinflips WHERE id=? AND status='open' AND creator_id=?", v.int(c.params.id, 'id', 1), c.user.id);
  if (!f) throw bad('Игра недоступна');
  if (run("UPDATE coinflips SET status='playing', joiner_bot=1 WHERE id=? AND status='open'", f.id).changes !== 1) throw bad('Игра уже занята');
  return { flip: coinflipResolve(f, null, 'bot-' + randomToken(6)) };
}), AUTH);
route('POST', '/api/coinflip/:id/cancel', (c) => tx(() => {
  const f = one("SELECT * FROM coinflips WHERE id=? AND status='open' AND creator_id=?", v.int(c.params.id, 'id', 1), c.user.id);
  if (!f || run("UPDATE coinflips SET status='cancelled', finished_at=? WHERE id=? AND status='open'", now(), f.id).changes !== 1) throw bad('Игра уже занята или отменена');
  const balance = change(c.user.id, f.amount, 'refund', { ref: 'coinflip', refId: f.id, reason: 'Coinflip отменён' });
  broadcast('coinflip', { id: f.id, phase: 'cancelled' });
  return { ok: true, balance };
}), AUTH);
function coinflipTick(t: number) {
  for (const f of all("SELECT * FROM coinflips WHERE status='open' AND created_at < ?", t - COINFLIP_TTL)) {
    tx(() => {
      if (run("UPDATE coinflips SET status='cancelled', finished_at=? WHERE id=? AND status='open'", t, f.id).changes === 1) {
        change(f.creator_id, f.amount, 'refund', { ref: 'coinflip', refId: f.id, reason: 'Coinflip: истёк срок ожидания' });
        notify(f.creator_id, 'game', 'Coinflip отменён', 'Соперник не найден за 30 минут, ставка возвращена.', '/games/coinflip');
      }
    });
  }
}

// ================= ROULETTE (европейская, 0–36) =================
export const RED = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
function rouletteWins(type: string, value: number, n: number): number {
  switch (type) {
    case 'number': return n === value ? 36 : 0;
    case 'red': return n > 0 && RED.includes(n) ? 2 : 0;
    case 'black': return n > 0 && !RED.includes(n) ? 2 : 0;
    case 'even': return n > 0 && n % 2 === 0 ? 2 : 0;
    case 'odd': return n % 2 === 1 ? 2 : 0;
    case 'low': return n >= 1 && n <= 18 ? 2 : 0;
    case 'high': return n >= 19 ? 2 : 0;
    case 'dozen': return n > 0 && Math.ceil(n / 12) === value ? 3 : 0;
    case 'column': return n > 0 && ((n - 1) % 3) + 1 === value ? 3 : 0;
  }
  return 0;
}
route('GET', '/api/roulette', (c) => ({
  recent: all("SELECT b.id, b.data, b.created_at, b.amount, b.payout, u.nickname FROM bets b JOIN users u ON u.id=b.user_id WHERE b.game='roulette' ORDER BY b.id DESC LIMIT 20")
    .map((b) => ({ id: b.id, n: JSON.parse(b.data).n, nickname: b.nickname, amount: b.amount, payout: b.payout, createdAt: b.created_at })),
  my: userBets(c.user?.id, 'roulette'), red: RED, limits: getSetting('games').roulette,
}));
route('POST', '/api/roulette/spin', (c) => {
  if (!Array.isArray(c.body.bets) || !c.body.bets.length || c.body.bets.length > 40) throw bad('Сделайте от 1 до 40 ставок');
  const bets = c.body.bets.map((b: any) => {
    const type = v.oneOf(b.type, 'Тип', ['number', 'red', 'black', 'even', 'odd', 'low', 'high', 'dozen', 'column'] as const);
    const value = type === 'number' ? v.int(b.value, 'Число', 0, 36) : type === 'dozen' || type === 'column' ? v.int(b.value, 'Значение', 1, 3) : 0;
    return { type, value, amount: v.money(b.amount, 'Ставка') };
  });
  const total = bets.reduce((s: number, b: any) => s + b.amount, 0);
  guard(c, 'roulette', total);
  return tx(() => {
    wager(c.user.id, total, 'roulette', null);
    const r = roll(c.user.id, 1);
    const n = Math.floor(r.floats[0] * 37);
    const payout = bets.reduce((s: number, b: any) => s + b.amount * rouletteWins(b.type, b.value, n), 0);
    const balance = payout > 0 ? change(c.user.id, payout, 'win', { ref: 'roulette', reason: 'Roulette' }) : one('SELECT balance FROM users WHERE id=?', c.user.id).balance;
    const betId = logBet(c.user.id, 'roulette', total, payout, payout / total, { n, bets }, r);
    broadcast('roulette', { n });
    return { n, payout, balance, betId, nonce: r.nonce, serverHash: r.hash };
  });
}, AUTH);

// ================= MINES (5×5) =================
function shuffleIdx(n: number, floats: number[], offset = 0) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(floats[offset + (n - 1 - i)] * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
export function minesMult(m: number, k: number) {
  let x = 1;
  for (let i = 0; i < k; i++) x *= (25 - i) / (25 - m - i);
  return Math.floor(0.97 * x * 100) / 100;
}
function activeGame(userId: number, game: string) { return one("SELECT * FROM bets WHERE user_id=? AND game=? AND status='active' ORDER BY id DESC LIMIT 1", userId, game); }
function gameView(b: any, reveal = false) {
  if (!b) return null;
  const d = JSON.parse(b.data);
  const s = JSON.parse(b.secret || '{}');
  return { id: b.id, amount: b.amount, status: b.status, payout: b.payout, multiplier: b.multiplier, ...d, secret: reveal || b.status !== 'active' ? s : null, nonce: b.nonce, serverHash: b.server_hash };
}
function finishGame(b: any, payout: number, mult: number, game: string) {
  if (run("UPDATE bets SET status=?, payout=?, multiplier=?, settled_at=? WHERE id=? AND status='active'", payout > 0 ? 'won' : 'lost', payout, mult, now(), b.id).changes !== 1) throw bad('Игра уже завершена');
  if (payout > 0) change(b.user_id, payout, 'win', { ref: game, refId: b.id, reason: game });
  track(b.user_id, 'game');
  return gameView(one('SELECT * FROM bets WHERE id=?', b.id), true);
}
route('GET', '/api/mines', (c) => ({ game: c.user ? gameView(activeGame(c.user.id, 'mines')) : null, my: userBets(c.user?.id, 'mines'), limits: getSetting('games').mines,
  table: Array.from({ length: 24 }, (_, i) => Array.from({ length: 25 - (i + 1) }, (_, k) => minesMult(i + 1, k + 1))) }));
route('POST', '/api/mines/start', (c) => {
  const amount = v.money(c.body.amount, 'Ставка');
  const mines = v.int(c.body.mines, 'Количество мин', 1, 24);
  guard(c, 'mines', amount);
  return tx(() => {
    if (activeGame(c.user.id, 'mines')) throw bad('Завершите текущую игру');
    const balance = wager(c.user.id, amount, 'mines', null);
    const r = roll(c.user.id, 24);
    const positions = shuffleIdx(25, r.floats).slice(0, mines).sort((a, b) => a - b);
    run('INSERT INTO bets(user_id,game,amount,payout,multiplier,status,data,secret,seed_id,nonce,server_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      c.user.id, 'mines', amount, 0, 1, 'active', JSON.stringify({ mines, revealed: [] }), JSON.stringify({ mines: positions }), r.seedId, r.nonce, r.hash, now());
    return { game: gameView(activeGame(c.user.id, 'mines')), balance };
  });
}, AUTH);
route('POST', '/api/mines/reveal', (c) => tx(() => {
  const b = activeGame(c.user.id, 'mines');
  if (!b) throw bad('Нет активной игры');
  const cell = v.int(c.body.cell, 'Клетка', 0, 24);
  const d = JSON.parse(b.data);
  const s = JSON.parse(b.secret);
  if (d.revealed.includes(cell)) throw bad('Клетка уже открыта');
  d.revealed.push(cell);
  run('UPDATE bets SET data=? WHERE id=?', JSON.stringify(d), b.id);
  const fresh = one('SELECT * FROM bets WHERE id=?', b.id);
  if (s.mines.includes(cell)) return { boom: true, game: finishGame(fresh, 0, 0, 'mines') };
  const mult = minesMult(d.mines, d.revealed.length);
  run('UPDATE bets SET multiplier=? WHERE id=?', mult, b.id);
  if (d.revealed.length === 25 - d.mines) return { boom: false, game: finishGame(fresh, Math.floor(b.amount * mult), mult, 'mines') };
  return { boom: false, game: gameView(one('SELECT * FROM bets WHERE id=?', b.id)), next: minesMult(d.mines, d.revealed.length + 1) };
}), { ...AUTH, rate: [120, 10_000] });
route('POST', '/api/mines/cashout', (c) => tx(() => {
  const b = activeGame(c.user.id, 'mines');
  if (!b) throw bad('Нет активной игры');
  const d = JSON.parse(b.data);
  if (!d.revealed.length) throw bad('Откройте хотя бы одну клетку');
  const mult = minesMult(d.mines, d.revealed.length);
  return { game: finishGame(b, Math.floor(b.amount * mult), mult, 'mines'), balance: one('SELECT balance FROM users WHERE id=?', c.user.id).balance };
}), AUTH);

// ================= TOWERS (8 этажей) =================
export const TOWERS: Record<string, { cells: number; bombs: number; name: string }> = {
  easy: { cells: 4, bombs: 1, name: 'Легко' }, medium: { cells: 3, bombs: 1, name: 'Средне' },
  hard: { cells: 2, bombs: 1, name: 'Сложно' }, expert: { cells: 3, bombs: 2, name: 'Эксперт' },
};
const TOWER_LEVELS = 8;
export const towerMult = (d: string, k: number) => Math.floor(0.97 * (TOWERS[d].cells / (TOWERS[d].cells - TOWERS[d].bombs)) ** k * 100) / 100;
route('GET', '/api/towers', (c) => ({ game: c.user ? gameView(activeGame(c.user.id, 'towers')) : null, my: userBets(c.user?.id, 'towers'), limits: getSetting('games').towers, levels: TOWER_LEVELS,
  modes: Object.fromEntries(Object.entries(TOWERS).map(([k, m]) => [k, { ...m, mults: Array.from({ length: TOWER_LEVELS }, (_, i) => towerMult(k, i + 1)) }])) }));
route('POST', '/api/towers/start', (c) => {
  const amount = v.money(c.body.amount, 'Ставка');
  const diff = v.oneOf(c.body.difficulty, 'Сложность', ['easy', 'medium', 'hard', 'expert'] as const);
  guard(c, 'towers', amount);
  return tx(() => {
    if (activeGame(c.user.id, 'towers')) throw bad('Завершите текущую игру');
    const balance = wager(c.user.id, amount, 'towers', null);
    const m = TOWERS[diff];
    const per = m.cells - 1;
    const r = roll(c.user.id, TOWER_LEVELS * per);
    const bombs = Array.from({ length: TOWER_LEVELS }, (_, L) => shuffleIdx(m.cells, r.floats, L * per).slice(0, m.bombs).sort());
    run('INSERT INTO bets(user_id,game,amount,payout,multiplier,status,data,secret,seed_id,nonce,server_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      c.user.id, 'towers', amount, 0, 1, 'active', JSON.stringify({ difficulty: diff, cells: m.cells, path: [] }), JSON.stringify({ bombs }), r.seedId, r.nonce, r.hash, now());
    return { game: gameView(activeGame(c.user.id, 'towers')), balance };
  });
}, AUTH);
route('POST', '/api/towers/step', (c) => tx(() => {
  const b = activeGame(c.user.id, 'towers');
  if (!b) throw bad('Нет активной игры');
  const d = JSON.parse(b.data);
  const s = JSON.parse(b.secret);
  const col = v.int(c.body.col, 'Клетка', 0, d.cells - 1);
  const level = d.path.length;
  d.path.push(col);
  run('UPDATE bets SET data=? WHERE id=?', JSON.stringify(d), b.id);
  const fresh = one('SELECT * FROM bets WHERE id=?', b.id);
  if (s.bombs[level].includes(col)) return { boom: true, game: finishGame(fresh, 0, 0, 'towers') };
  const mult = towerMult(d.difficulty, d.path.length);
  run('UPDATE bets SET multiplier=? WHERE id=?', mult, b.id);
  if (d.path.length === TOWER_LEVELS) return { boom: false, game: finishGame(fresh, Math.floor(b.amount * mult), mult, 'towers') };
  return { boom: false, game: gameView(one('SELECT * FROM bets WHERE id=?', b.id)) };
}), { ...AUTH, rate: [120, 10_000] });
route('POST', '/api/towers/cashout', (c) => tx(() => {
  const b = activeGame(c.user.id, 'towers');
  if (!b) throw bad('Нет активной игры');
  const d = JSON.parse(b.data);
  if (!d.path.length) throw bad('Пройдите хотя бы один этаж');
  const mult = towerMult(d.difficulty, d.path.length);
  return { game: finishGame(b, Math.floor(b.amount * mult), mult, 'towers'), balance: one('SELECT balance FROM users WHERE id=?', c.user.id).balance };
}), AUTH);

// ================= CASE BATTLE =================
const BATTLE_START_MS = 5000, BATTLE_ROUND_MS = 4500;
const BOT = (slot: number) => ({ id: 0, nickname: `Бургер-бот #${slot + 1}`, avatar: null, role: 'BOT' });
function battleVisible(c: any, b: any) {
  if (!b.private || !c) return true;
  if (c.user && (b.creator_id === c.user.id || one('SELECT 1 FROM battle_players WHERE battle_id=? AND user_id=?', b.id, c.user.id) || can(c.user, 'games.manage'))) return true;
  return c.query?.get('code') === b.invite_code;
}
function battleView(b: any, c: any = null, full = false) {
  const t = now();
  const players = all('SELECT * FROM battle_players WHERE battle_id=? ORDER BY slot', b.id)
    .map((p) => ({ slot: p.slot, bot: !!p.bot, user: p.bot ? BOT(p.slot) : publicUser(one('SELECT * FROM users WHERE id=?', p.user_id)), total: b.status === 'finished' ? p.total : null }));
  const cases = JSON.parse(b.cases);
  const res = b.result ? JSON.parse(b.result) : null;
  let revealed = 0;
  if (b.status === 'finished') revealed = cases.length;
  else if (b.status === 'running') revealed = Math.min(cases.length, Math.floor((t - b.start_at) / BATTLE_ROUND_MS) + 1);
  const isMember = c?.user && (b.creator_id === c.user.id || players.some((p) => p.user?.id === c.user.id));
  return { id: b.id, mode: b.mode, maxPlayers: b.max_players, private: !!b.private, inviteCode: isMember && b.private ? b.invite_code : null, cost: b.cost,
    status: b.status, creatorId: b.creator_id, cases, players, startAt: b.start_at, roundMs: BATTLE_ROUND_MS, serverTime: t,
    rounds: res && full ? res.rounds.slice(0, revealed) : [], revealed, total: b.status === 'finished' ? b.total : null,
    winnerSlot: b.status === 'finished' ? b.winner_slot : null, hash: b.server_hash, seed: b.status === 'finished' ? b.server_seed : null,
    clientSeed: res?.clientSeed || null, createdAt: b.created_at, finishedAt: b.finished_at };
}
route('GET', '/api/battles', (c) => {
  const uid = c.user?.id || 0;
  const live = all("SELECT * FROM battles WHERE status IN ('waiting','starting','running') AND (private=0 OR creator_id=? OR EXISTS (SELECT 1 FROM battle_players p WHERE p.battle_id=battles.id AND p.user_id=?)) ORDER BY id DESC LIMIT 60", uid, uid);
  return { live: live.map((b) => battleView(b, c)), recent: all("SELECT * FROM battles WHERE status='finished' AND private=0 ORDER BY id DESC LIMIT 20").map((b) => battleView(b, c)),
    mine: uid ? all("SELECT b.* FROM battles b WHERE EXISTS (SELECT 1 FROM battle_players p WHERE p.battle_id=b.id AND p.user_id=?) ORDER BY b.id DESC LIMIT 20", uid).map((b) => battleView(b, c)) : [],
    cases: all("SELECT id, slug, name, price, image FROM cases WHERE status='published' ORDER BY price").map((x) => ({ ...x, image: x.image ? imageUrl(x.image) : null })),
    enabled: getSetting('features').battles && getSetting('games').battles.enabled };
});
route('GET', '/api/battles/:id', (c) => {
  const b = one('SELECT * FROM battles WHERE id=?', v.int(c.params.id, 'id', 1));
  if (!b || !battleVisible(c, b)) throw notFound('Битва не найдена');
  return { battle: battleView(b, c, true) };
});
route('POST', '/api/battles', (c) => {
  requireFeature('battles', 'Case Battle');
  checkRestriction(c.user, 'games');
  const ids: number[] = Array.isArray(c.body.cases) ? c.body.cases.map((x: any) => v.int(x, 'Кейс', 1)) : [];
  if (ids.length < 1 || ids.length > 25) throw bad('Выберите от 1 до 25 раундов (кейсов)');
  const players = v.int(c.body.players ?? 2, 'Игроки', 2, 4);
  const mode = v.oneOf(c.body.mode || 'classic', 'Режим', ['classic', 'crazy'] as const);
  const priv = v.bool(c.body.private);
  const cases = ids.map((id) => {
    const cs = one("SELECT * FROM cases WHERE id=? AND status='published'", id);
    if (!cs) throw bad('Кейс недоступен');
    return { id: cs.id, slug: cs.slug, name: cs.name, price: cs.price, image: cs.image ? imageUrl(cs.image) : null };
  });
  const cost = cases.reduce((s, x) => s + x.price, 0);
  gameLimits('battles', cost);
  return tx(() => {
    if (one("SELECT COUNT(*) n FROM battles WHERE creator_id=? AND status='waiting'", c.user.id).n >= 3) throw bad('Максимум 3 ожидающие битвы');
    const seed = newSeed();
    const id = run('INSERT INTO battles(creator_id,mode,cases,max_players,private,invite_code,cost,status,server_seed,server_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      c.user.id, mode, JSON.stringify(cases), players, priv ? 1 : 0, priv ? randomToken(8) : null, cost, 'waiting', seed, sha256(seed), now()).lastInsertRowid;
    change(c.user.id, -cost, 'battle', { ref: 'battle', refId: id, reason: `Case Battle #${id}` });
    track(c.user.id, 'wager', Math.floor(cost / 100));
    run('INSERT INTO battle_players(battle_id,slot,user_id,bot,client_seed,total) VALUES(?,?,?,?,?,0)', id, 0, c.user.id, 0, activeSeed(c.user.id).client_seed);
    broadcast('battle', { id, phase: 'created' });
    return { battle: battleView(one('SELECT * FROM battles WHERE id=?', id), c, true) };
  });
}, AUTH);
function battleFill(b: any) {
  const n = one('SELECT COUNT(*) n FROM battle_players WHERE battle_id=?', b.id).n;
  if (n >= b.max_players) { run("UPDATE battles SET status='starting', start_at=? WHERE id=? AND status='waiting'", now() + BATTLE_START_MS, b.id); broadcast('battle', { id: b.id, phase: 'starting' }); }
}
function freeSlot(b: any, wanted: any) {
  const taken = all('SELECT slot FROM battle_players WHERE battle_id=?', b.id).map((p) => p.slot);
  if (wanted != null && Number.isInteger(Number(wanted)) && !taken.includes(Number(wanted)) && Number(wanted) < b.max_players) return Number(wanted);
  for (let s = 0; s < b.max_players; s++) if (!taken.includes(s)) return s;
  throw bad('В битве нет свободных мест');
}
route('POST', '/api/battles/:id/join', (c) => tx(() => {
  requireFeature('battles', 'Case Battle');
  checkRestriction(c.user, 'games');
  const b = one("SELECT * FROM battles WHERE id=? AND status='waiting'", v.int(c.params.id, 'id', 1));
  if (!b) throw bad('Битва уже началась или отменена');
  if (b.private && c.body.code !== b.invite_code) throw forbidden('Нужен код приглашения');
  if (one('SELECT 1 FROM battle_players WHERE battle_id=? AND user_id=?', b.id, c.user.id)) throw bad('Вы уже в этой битве');
  const slot = freeSlot(b, c.body.slot);
  change(c.user.id, -b.cost, 'battle', { ref: 'battle', refId: b.id, reason: `Case Battle #${b.id}` });
  track(c.user.id, 'wager', Math.floor(b.cost / 100));
  run('INSERT INTO battle_players(battle_id,slot,user_id,bot,client_seed,total) VALUES(?,?,?,?,?,0)', b.id, slot, c.user.id, 0, activeSeed(c.user.id).client_seed);
  broadcast('battle', { id: b.id, phase: 'join' });
  battleFill(b);
  return { battle: battleView(one('SELECT * FROM battles WHERE id=?', b.id), c, true) };
}), AUTH);
route('POST', '/api/battles/:id/bots', (c) => tx(() => {
  const b = one("SELECT * FROM battles WHERE id=? AND status='waiting' AND creator_id=?", v.int(c.params.id, 'id', 1), c.user.id);
  if (!b) throw bad('Добавить ботов может только создатель ожидающей битвы');
  const taken = all('SELECT slot FROM battle_players WHERE battle_id=?', b.id).map((p) => p.slot);
  for (let s = 0; s < b.max_players; s++) if (!taken.includes(s)) run('INSERT INTO battle_players(battle_id,slot,user_id,bot,client_seed,total) VALUES(?,?,NULL,1,?,0)', b.id, s, 'bot-' + randomToken(6));
  battleFill(b);
  return { battle: battleView(one('SELECT * FROM battles WHERE id=?', b.id), c, true) };
}), AUTH);
route('POST', '/api/battles/:id/leave', (c) => tx(() => {
  const b = one("SELECT * FROM battles WHERE id=? AND status='waiting'", v.int(c.params.id, 'id', 1));
  if (!b) throw bad('Битва уже началась');
  const humans = all('SELECT * FROM battle_players WHERE battle_id=? AND bot=0', b.id);
  if (b.creator_id === c.user.id) {
    run("UPDATE battles SET status='cancelled', finished_at=? WHERE id=?", now(), b.id);
    for (const p of humans) {
      change(p.user_id, b.cost, 'refund', { ref: 'battle', refId: b.id, reason: `Case Battle #${b.id} отменена` });
      if (p.user_id !== c.user.id) notify(p.user_id, 'battle', 'Битва отменена', 'Создатель отменил битву, ставка возвращена.', '/battles');
    }
  } else {
    if (!humans.some((p) => p.user_id === c.user.id)) throw bad('Вы не участвуете в этой битве');
    run('DELETE FROM battle_players WHERE battle_id=? AND user_id=?', b.id, c.user.id);
    change(c.user.id, b.cost, 'refund', { ref: 'battle', refId: b.id, reason: `Выход из Case Battle #${b.id}` });
  }
  broadcast('battle', { id: b.id, phase: 'leave' });
  return { ok: true, balance: one('SELECT balance FROM users WHERE id=?', c.user.id).balance };
}), AUTH);
route('POST', '/api/battles/:id/invite', (c) => {
  const b = one("SELECT * FROM battles WHERE id=? AND status='waiting'", v.int(c.params.id, 'id', 1));
  if (!b || !one('SELECT 1 FROM battle_players WHERE battle_id=? AND user_id=?', b.id, c.user.id)) throw bad('Пригласить можно только в свою ожидающую битву');
  const fid = v.int(c.body.userId, 'Друг', 1);
  if (!one("SELECT 1 FROM friends WHERE user_id=? AND friend_id=? AND status='accepted'", c.user.id, fid)) throw bad('Приглашать можно только друзей');
  notify(fid, 'battle', `${c.user.nickname} зовёт в Case Battle`, `${JSON.parse(b.cases).length} раунд(ов), вход ${rub(b.cost)}`, `/battles/${b.id}` + (b.private ? `?code=${b.invite_code}` : ''));
  return { ok: true };
}, { auth: true, rate: [20, 60_000] });

function battleStart(b: any) {
  const players = all('SELECT * FROM battle_players WHERE battle_id=? ORDER BY slot', b.id);
  const clientSeed = players.map((p) => p.client_seed).join(':');
  const cases = JSON.parse(b.cases);
  const caseCache = new Map<number, { c: any; rows: any[] }>();
  const rounds = cases.map((cs: any, i: number) => {
    if (!caseCache.has(cs.id)) caseCache.set(cs.id, { c: one('SELECT * FROM cases WHERE id=?', cs.id), rows: caseRows(cs.id) });
    const { c, rows } = caseCache.get(cs.id)!;
    return players.map((p) => {
      const f = floatsFrom(b.server_seed, clientSeed, `${i}:${p.slot}`, 3);
      const d = dropFrom(c, rows, f);
      const it = d.item;
      const realFloat = d.float == null ? null : it.min_float + d.float * (it.max_float - it.min_float);
      const wear = hasWear(it) && realFloat != null ? wearOf(realFloat) : '';
      return { slot: p.slot, itemId: it.id, name: it.name, image: imageUrl(it.image), color: it.rarity_color, rarityName: it.rarity_name, wear, variant: d.variant,
        fl: d.float, float: realFloat, price: priceOf(it.id, wear, d.variant) };
    });
  });
  const totals = players.map((p) => rounds.reduce((s: number, r: any[]) => s + r.find((x) => x.slot === p.slot).price, 0));
  const best = b.mode === 'crazy' ? Math.min(...totals) : Math.max(...totals);
  const tied = players.filter((_, i) => totals[i] === best);
  const tie = floatsFrom(b.server_seed, clientSeed, 'tie', 1)[0];
  const winner = tied[Math.floor(tie * tied.length)];
  players.forEach((p, i) => run('UPDATE battle_players SET total=? WHERE battle_id=? AND slot=?', totals[i], b.id, p.slot));
  run("UPDATE battles SET status='running', start_at=?, result=?, total=?, winner_slot=?, winner_id=? WHERE id=?",
    now(), JSON.stringify({ rounds, clientSeed, totals }), totals.reduce((a, x) => a + x, 0), winner.slot, winner.bot ? null : winner.user_id, b.id);
  broadcast('battle', { id: b.id, phase: 'running' });
}
function battleFinish(b: any) {
  const res = JSON.parse(b.result);
  const players = all('SELECT * FROM battle_players WHERE battle_id=? ORDER BY slot', b.id);
  tx(() => {
    if (run("UPDATE battles SET status='finished', finished_at=? WHERE id=? AND status='running'", now(), b.id).changes !== 1) return;
    const invIds: number[] = [];
    if (b.winner_id) for (const r of res.rounds) for (const d of r) invIds.push(addInventory(b.winner_id, d.itemId, d.fl, d.variant, 'battle', b.id).id);
    for (const p of players.filter((x) => !x.bot)) {
      const win = p.user_id === b.winner_id;
      run('INSERT INTO bets(user_id,game,amount,payout,multiplier,status,data,created_at,settled_at) VALUES(?,?,?,?,?,?,?,?,?)', p.user_id, 'battle', b.cost, win ? b.total : 0, win ? b.total / Math.max(1, b.cost) : 0,
        win ? 'won' : 'lost', JSON.stringify({ battleId: b.id, slot: p.slot, total: p.total, invIds: win ? invIds : [] }), now(), now());
      track(p.user_id, 'battle');
      if (win) track(p.user_id, 'battle_win');
      notify(p.user_id, 'battle', win ? 'Победа в Case Battle!' : 'Case Battle завершена', win ? `Вы забрали все предметы на ${rub(b.total)}` : `Ваш итог: ${rub(p.total)}`, `/battles/${b.id}`);
    }
  });
  broadcast('battle', { id: b.id, phase: 'finished' });
}
function battlesTick(t: number) {
  for (const b of all("SELECT * FROM battles WHERE status='starting' AND start_at <= ?", t)) battleStart(b);
  for (const b of all("SELECT * FROM battles WHERE status='running'")) {
    const n = JSON.parse(b.cases).length;
    if (t >= b.start_at + n * BATTLE_ROUND_MS + 800) battleFinish(b);
  }
}

// ================= Список игр и планировщик =================
route('GET', '/api/games', () => {
  const g = getSetting('games');
  const on = getSetting('features').games;
  return { games: ['crash', 'double', 'jackpot', 'coinflip', 'roulette', 'mines', 'towers'].map((k) => ({ key: k, enabled: on && g[k].enabled, min: g[k].min, max: g[k].max,
    players: one('SELECT COUNT(DISTINCT user_id) n FROM bets WHERE game=? AND created_at > ?', k, now() - 86400_000).n })), battles: on && g.battles.enabled && getSetting('features').battles };
});
export function gamesTick() {
  const t = now();
  const g = getSetting('games');
  const steps: Array<[string, (t: number) => void]> = [['crash', crashTick], ['double', doubleTick], ['jackpot', jackpotTick], ['coinflip', coinflipTick], ['battles', battlesTick]];
  for (const [k, fn] of steps) {
    // Выключенная игра доигрывает уже начатый раунд, но не создаёт новый.
    if (!g[k]?.enabled && (k === 'crash' || k === 'double' || k === 'jackpot') && !liveRound(k)) continue;
    try { fn(t); } catch (e) { logError(e, 'tick:' + k); }
  }
}
