// Generates public/js/icons.js from the Lucide icon set (react-icons/lu, ISC license).
// Usage: node scripts/build-icons.mjs  (requires react-icons in node_modules)
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { existsSync } from 'node:fs';
function pkgDir(name) {
  let d = path.dirname(new URL(import.meta.url).pathname);
  for (let i = 0; i < 8; i++) { const c = path.join(d, 'node_modules', name); if (existsSync(c)) return c; d = path.dirname(d); }
  throw new Error('package not found: ' + name);
}
const RI = pkgDir('react-icons');
const luDir = path.join(RI, 'lu');
const src = readFileSync(path.join(luDir, 'index.mjs'), 'utf8');
const lib = {};
for (const m of src.matchAll(/export function (Lu\w+) \(props\) \{\s*return GenIcon\((\{.*?\})\)\(props\);/gs)) lib[m[1]] = JSON.parse(m[2]);
let simple = {};
try {
  const siSrc = readFileSync(path.join(RI, 'si', 'index.mjs'), 'utf8');
  const m = siSrc.match(/export function SiSteam \(props\) \{\s*return GenIcon\((\{.*?\})\)\(props\);/s);
  if (m) simple.steam = JSON.parse(m[1]);
} catch {}

// short name -> candidate Lucide component names (first existing wins)
const WANT = {
  cases: ['LuPackage'], battles: ['LuSwords'], upgrade: ['LuCircleArrowUp', 'LuArrowUpCircle'], contracts: ['LuFileSignature', 'LuSignature', 'LuScrollText'],
  skins: ['LuCrosshair'], pass: ['LuCrown'], bonuses: ['LuGift'], games: ['LuGamepad2'], joystick: ['LuJoystick', 'LuGamepad'],
  crash: ['LuRocket'], double: ['LuTarget'], jackpot: ['LuCoins'], coinflip: ['LuCircleDollarSign', 'LuDollarSign'], roulette: ['LuDisc3', 'LuCircleDot'],
  mines: ['LuBomb'], towers: ['LuCastle', 'LuBuilding2'], user: ['LuUser'], inventory: ['LuBackpack'], history: ['LuReceiptText', 'LuReceipt'],
  wallet: ['LuWallet'], friends: ['LuUsers'], bell: ['LuBell'], support: ['LuLifeBuoy'], settings: ['LuSettings'], admin: ['LuShieldCheck'],
  logout: ['LuLogOut'], home: ['LuHouse', 'LuHome'], events: ['LuPartyPopper'], trophy: ['LuTrophy'], medal: ['LuMedal', 'LuAward'],
  collections: ['LuLibrary'], chart: ['LuChartColumn', 'LuChartBar', 'LuBarChart3'], ticket: ['LuTicket'], news: ['LuNewspaper'],
  fair: ['LuBadgeCheck'], book: ['LuBookOpen'], lock: ['LuLock'], flame: ['LuFlame'], sparkles: ['LuSparkles'], gem: ['LuGem'],
  live: ['LuRadio', 'LuActivity'], quests: ['LuListChecks'], tag: ['LuTag'], percent: ['LuBadgePercent', 'LuPercent'], zap: ['LuZap'],
  bot: ['LuBot'], shield: ['LuShield'], link: ['LuLink'], invite: ['LuUserPlus'], paperclip: ['LuPaperclip'], copy: ['LuCopy'],
  card: ['LuCreditCard'], withdraw: ['LuArrowUpFromLine'], sun: ['LuSun'], calendar: ['LuCalendarDays', 'LuCalendar'],
  dashboard: ['LuLayoutDashboard'], flag: ['LuFlag'], download: ['LuDownload'], upload: ['LuUpload'], message: ['LuMessagesSquare', 'LuMessageSquare'],
  wrench: ['LuWrench'], sliders: ['LuSlidersHorizontal'], key: ['LuKeyRound', 'LuKey'], scroll: ['LuScrollText'], alert: ['LuTriangleAlert', 'LuAlertTriangle'],
  backup: ['LuDatabaseBackup', 'LuHardDrive'], volume: ['LuVolume2'], volumeOff: ['LuVolumeX'], plus: ['LuPlus'], minus: ['LuMinus'],
  chevronDown: ['LuChevronDown'], chevronRight: ['LuChevronRight'], chevronLeft: ['LuChevronLeft'], menu: ['LuMenu'], close: ['LuX'], search: ['LuSearch'],
  arrowLeft: ['LuArrowLeft'], arrowRight: ['LuArrowRight'], check: ['LuCheck'], star: ['LuStar'], refresh: ['LuRefreshCw'], sell: ['LuBanknote'],
  image: ['LuImage'], images: ['LuImages'], music: ['LuMusic'], dice: ['LuDices'], filter: ['LuFunnel', 'LuFilter'], sort: ['LuArrowDownUp', 'LuArrowUpDown'],
  sword: ['LuSword'], hand: ['LuHand'], crown: ['LuCrown'], play: ['LuPlay'], eye: ['LuEye'], layers: ['LuLayers'], trash: ['LuTrash2'],
  edit: ['LuPencil'], save: ['LuSave'], external: ['LuExternalLink'], info: ['LuInfo'], explosion: ['LuCircleAlert', 'LuAlertCircle'], clock: ['LuClock'],
  rocketFill: ['LuRocket'], hammer: ['LuHammer'], gauge: ['LuGauge'], shuffle: ['LuShuffle'], sparkle: ['LuSparkle'], target: ['LuTarget'],
  infinity: ['LuInfinity'], award: ['LuAward'], megaphone: ['LuMegaphone'], list: ['LuList'], grid: ['LuLayoutGrid'], wand: ['LuWandSparkles', 'LuWand2'],
  boxes: ['LuBoxes'], circleCheck: ['LuCircleCheck', 'LuCheckCircle'], circleX: ['LuCircleX', 'LuXCircle'], loader: ['LuLoaderCircle', 'LuLoader2'],
  mail: ['LuMail'], globe: ['LuGlobe'], userCog: ['LuUserCog'], ban: ['LuBan'], undo: ['LuUndo2'], coins: ['LuCoins'], banknote: ['LuBanknote'],
  ruble: ['LuRussianRuble'], trendUp: ['LuTrendingUp'], trendDown: ['LuTrendingDown'], diamond: ['LuDiamond'], hexagon: ['LuHexagon'],
};
const out = {}; const miss = [];
const ser = (n) => n.child.map((c) => `<${c.tag}${Object.entries(c.attr).map(([k, v]) => ` ${k}="${v}"`).join('')}${c.child?.length ? '>' + ser(c) + `</${c.tag}>` : '/>'}`).join('');
for (const [k, cands] of Object.entries(WANT)) {
  const hit = cands.find((c) => lib[c]);
  if (!hit) { miss.push(k + ':' + cands.join('|')); continue; }
  out[k] = ser(lib[hit]);
}
if (miss.length) { console.error('MISSING', miss.join(', ')); process.exit(1); }
const steam = simple.steam ? ser(simple.steam) : '';
const code = `// АВТОГЕНЕРАЦИЯ: scripts/build-icons.mjs. Иконки Lucide (ISC License, https://lucide.dev), единый стиль: 24×24, stroke 2.
import { raw } from './core.js';
export const ICONS = ${JSON.stringify(out, null, 0).replace(/","/g, '",\n  "')};
const STEAM = ${JSON.stringify(steam)};
// Старые значения-эмодзи из базы (иконки достижений, уведомлений) → имя иконки.
const _nk = (s) => String(s || '').split(String.fromCharCode(0xFE0F)).join('');
export const LEGACY = Object.assign(Object.fromEntries([[0x1F354,'pass'],[0x1F35F,'flame'],[0x1F373,'award'],[0x1F381,'bonuses'],[0x1F389,'events'],[0x1F392,'inventory'],[0x1F39F,'ticket'],[0x1F3A1,'roulette'],[0x1F3AE,'games'],[0x1F3AF,'target'],[0x1F3C5,'medal'],[0x1F3C6,'trophy'],[0x1F3E0,'home'],[0x1F3F7,'tag'],[0x1F464,'user'],[0x1F465,'invite'],[0x1F468,'award'],[0x1F48E,'gem'],[0x1F4A3,'mines'],[0x1F4A5,'bomb'],[0x1F4AC,'message'],[0x1F4B0,'coins'],[0x1F4B3,'card'],[0x1F4B8,'percent'],[0x1F4BE,'backup'],[0x1F4C5,'calendar'],[0x1F4CA,'chart'],[0x1F4CE,'paperclip'],[0x1F4D8,'book'],[0x1F4DC,'contracts'],[0x1F4E2,'megaphone'],[0x1F4E4,'withdraw'],[0x1F4E5,'download'],[0x1F4E6,'cases'],[0x1F4F0,'news'],[0x1F510,'key'],[0x1F512,'lock'],[0x1F514,'bell'],[0x1F517,'link'],[0x1F525,'flame'],[0x1F527,'wrench'],[0x1F52B,'skins'],[0x1F579,'joystick'],[0x1F5C2,'collections'],[0x1F5FC,'towers'],[0x1F680,'crash'],[0x1F6A8,'alert'],[0x1F6A9,'flag'],[0x1F6AA,'logout'],[0x1F6DF,'support'],[0x1F6E1,'shield'],[0x1F7E2,'live'],[0x1F916,'bot'],[0x1F91D,'friends'],[0x1F9FE,'history'],[0x1FA99,'coinflip'],[0x2398,'copy'],[0x2600,'sun'],[0x2668,'steam'],[0x2694,'battles'],[0x2699,'settings'],[0x26A1,'zap'],[0x2705,'circleCheck'],[0x2728,'sparkles'],[0x2B06,'upgrade']].map(([c, n]) => [String.fromCodePoint(c), n])), { bomb: 'explosion' });
export function iconSvg(name, cls = '') {
  const n = ICONS[name] ? name : LEGACY[_nk(name)] || '';
  if (name === 'steam' && STEAM) return '<svg class="i i-steam ' + cls + '" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + STEAM + '</svg>';
  const body = ICONS[n] || ICONS.hexagon;
  return '<svg class="i ' + cls + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + body + '</svg>';
}
export const icon = (name, cls = '') => raw(iconSvg(name, cls));
export const hasIcon = (name) => !!(ICONS[name] || LEGACY[_nk(name)]);
`;
writeFileSync(new URL('../public/js/icons.js', import.meta.url), code);
console.log('icons:', Object.keys(out).length, 'steam:', !!steam);
