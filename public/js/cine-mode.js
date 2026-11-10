// BURGER SKIN — лёгкие помощники кинодропов (без самой сцены: она грузится лениво из cinematic.js).
import { state } from './core.js';

const KEY = 'bs_cine';
export const MODES = [['full', 'Полные'], ['short', 'Короткие'], ['off', 'Выкл']];
/** Кинодропы включены на сайте (админка → Кинодропы). */
export const cineOn = () => state.site?.dropFx?.enabled !== false;
export const shareOn = () => state.site?.dropFx?.share !== false;
/** Режим игрока: full — полная сцена, short — ускоренная (~3 с), off — без сцены. */
export function cineMode() {
  let v = null;
  try { v = localStorage.getItem(KEY); } catch { v = null; }
  if (v === 'full' || v === 'short' || v === 'off') return v;
  const d = state.site?.dropFx?.defaultMode;
  return d === 'short' || d === 'off' ? d : 'full';
}
export function setCineMode(v) { try { localStorage.setItem(KEY, v); } catch { /* приватный режим */ } }
/** Самый редкий дроп среди открытых (уровень уже посчитан сервером и пришёл в ответе). */
export function bestFx(drops) {
  let b = null;
  for (const x of drops || []) {
    if (!x?.fx) continue;
    if (!b || x.fx.rank > b.fx.rank || (x.fx.rank === b.fx.rank && (x.inv?.price || 0) > (b.inv?.price || 0))) b = x;
  }
  return b;
}
export const loadCine = () => import('./cinematic.js');
