// Импорт цен CS2 из ЛОКАЛЬНОГО JSON-файла. Никаких сетевых запросов (Skinport API не используется).
//
//   npm run import:prices:local -- ./data/prices-rub.json
//   npm run import:prices:local -- ./data/prices-rub.json --dry-run      — только проверка и подсчёт, без записи
//
// Опции:
//   --batch N        размер пакета: столько цен пишется за одну транзакцию (по умолчанию 500)
//   --pause MS       пауза между пакетами, мс (по умолчанию 25), чтобы работающий сайт успевал обращаться к базе
//   --fields a,b     порядок полей цены (по умолчанию suggested_price,median_price,min_price,mean_price)
//   --currency RUB   ожидаемая валюта; записи с другой валютой пропускаются
//   --source TEXT    подпись источника цен (по умолчанию file:<имя файла>)
//   --no-recalc      не пересчитывать стоимость кейсов после импорта
//   --dry-run        ничего не записывать (резервная копия тоже не создаётся)
//
// Правила:
//   • Цены хранятся в копейках: 123.45 ₽ → 12345.
//   • Запись без положительной цены пропускается. Цена 0 никогда не записывается.
//   • Новые скины не создаются: цена пишется только для предметов, которые уже есть в таблице items.
//     Цены лежат в item_prices с ключом (item_id, wear, variant), поэтому повтор импорта обновляет, а не дублирует.
//   • Несколько записей на одно и то же качество (фазы Doppler, Gamma Doppler) сводятся в одну цену:
//     запись без version, если есть, иначе минимальная цена среди фаз.
//   • Перед записью создаётся резервная копия базы (VACUUM INTO) в data/backups/ и проверяется её целостность.
//   • Ничего не удаляется. Меняются только item_prices (добавление/обновление), items.base_price/price_source,
//     ev и price кейсов в авто-режиме (пересчёт по новым ценам), settings.catalog_last_prices и одна запись в audit_log.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { db, one, all, run, tx, now, DATA, DB_FILE } from '../src/lib/db.ts';
import { parseMarketName, catalogStats } from '../src/lib/catalog.ts';
import { recalcAllCases } from '../src/lib/cases.ts';
import { audit } from '../src/lib/core.ts';

// Гарантия: из этого скрипта невозможно сделать сетевой запрос.
const noNetwork = () => { throw new Error('Сетевые запросы запрещены: импорт работает только с локальным файлом'); };
(globalThis as any).fetch = noNetwork;

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const flag = (n: string) => args.includes(n);
const valueOpts = new Set(['--file', '--batch', '--pause', '--fields', '--currency', '--source']);
const positional = args.filter((a, i) => !a.startsWith('--') && !valueOpts.has(args[i - 1]));

const FILE = opt('--file') || positional[0];
const BATCH = Math.max(1, Math.min(5000, Number(opt('--batch') || 500) || 500));
const PAUSE = Math.max(0, Number(opt('--pause') || 25) || 0);
const FIELDS = (opt('--fields') || 'suggested_price,median_price,min_price,mean_price').split(',').map((s) => s.trim()).filter(Boolean);
const CURRENCY = (opt('--currency') || 'RUB').toUpperCase();
const DRY = flag('--dry-run');
const RECALC = !flag('--no-recalc');
const MSK = 3 * 3600_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const fold = (s: string) => s.trim().replace(/[A-Z]/g, (c) => c.toLowerCase()); // как COLLATE NOCASE в SQLite
const stamp = () => new Date(Date.now() + MSK).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

function pickPrice(r: any): { kop: number; field: string } | null {
  for (const f of FIELDS) {
    const v = r[f];
    const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.replace(',', '.')) : NaN;
    if (!Number.isFinite(n) || n <= 0) continue;
    const kop = Math.round(n * 100);
    if (kop > 0) return { kop, field: f };
  }
  return null;
}

function tableCounts(d: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all())
    out[t.name] = Number(d.prepare(`SELECT COUNT(*) n FROM "${String(t.name).replace(/"/g, '""')}"`).get().n);
  return out;
}
function protectedSnapshot() {
  return {
    counts: tableCounts(db),
    balance: Number(one('SELECT COALESCE(SUM(balance),0) s FROM users').s),
    inventoryValue: Number(one('SELECT COALESCE(SUM(price),0) s FROM inventory').s),
  };
}

function makeBackup(): { file: string; size: number } {
  const dir = path.join(DATA, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `burger-${stamp()}-before-prices.sqlite`);
  if (fs.existsSync(file)) throw new Error('Резервная копия с таким именем уже есть, повторите через секунду');
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const copy = new DatabaseSync(file, { readOnly: true });
  try {
    const check = String((copy.prepare('PRAGMA quick_check').get() as any).quick_check);
    if (check !== 'ok') throw new Error(`резервная копия повреждена: ${check}`);
    const a = tableCounts(copy), b = tableCounts(db);
    for (const t of Object.keys(b)) if (a[t] !== b[t]) throw new Error(`в резервной копии не совпало число строк в ${t}`);
  } finally { copy.close(); }
  return { file, size: fs.statSync(file).size };
}

async function main() {
  if (!FILE) throw new Error('Укажите файл: npm run import:prices:local -- ./data/prices-rub.json');
  const abs = path.resolve(FILE);
  if (!fs.existsSync(abs)) throw new Error(`Файл не найден: ${abs}`);
  console.log(`База: ${DB_FILE}`);
  console.log(`Файл: ${abs} (${(fs.statSync(abs).size / 1048576).toFixed(1)} МБ)${DRY ? '  [пробный запуск, без записи]' : ''}`);

  // ---------- 1. Чтение и проверка формата ----------
  let data: any;
  try { data = JSON.parse(fs.readFileSync(abs, 'utf8').replace(/^\uFEFF/, '')); }
  catch (e: any) { throw new Error(`Файл не является корректным JSON: ${e.message}`); }
  const rows: any[] | null = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : null;
  if (!rows) throw new Error('Ожидается JSON-массив записей (или объект с полем items)');
  if (!rows.length) throw new Error('В файле нет записей');

  // ---------- 2. Сопоставление с каталогом (в памяти, без запросов на каждую строку) ----------
  const index = new Map<string, number>();
  for (const it of all('SELECT id, name FROM items WHERE archived=0 ORDER BY id')) {
    const k = fold(String(it.name));
    if (!index.has(k)) index.set(k, Number(it.id));
  }

  const st = { total: rows.length, invalid: 0, wrongCurrency: 0, noPrice: 0, unmatched: 0, matched: 0, merged: 0 };
  const usedField: Record<string, number> = {};
  const unmatched: string[] = [];
  const noPriceNames: string[] = [];
  type Cand = { itemId: number; wear: string; variant: string; price: number; version: string | null };
  const groups = new Map<string, Cand[]>();

  for (const r of rows) {
    const name = r && typeof r === 'object' && typeof r.market_hash_name === 'string' ? r.market_hash_name.trim() : '';
    if (!name) { st.invalid++; continue; }
    if (r.currency != null && String(r.currency).toUpperCase() !== CURRENCY) { st.wrongCurrency++; continue; }
    const p = pickPrice(r);
    if (!p) { st.noPrice++; noPriceNames.push(name); continue; }
    const parsed = parseMarketName(name);
    const itemId = index.get(fold(parsed.name));
    if (itemId == null) { st.unmatched++; unmatched.push(name); continue; }
    st.matched++;
    usedField[p.field] = (usedField[p.field] || 0) + 1;
    const key = `${itemId}|${parsed.wear}|${parsed.variant}`;
    const list = groups.get(key) || [];
    list.push({ itemId, wear: parsed.wear, variant: parsed.variant, price: p.kop, version: r.version == null || r.version === '' ? null : String(r.version) });
    groups.set(key, list);
  }

  const entries: Cand[] = [];
  for (const list of groups.values()) {
    if (list.length > 1) st.merged += list.length - 1;
    const plain = list.filter((c) => c.version == null);
    const pool = plain.length ? plain : list;
    entries.push(pool.reduce((a, b) => (b.price < a.price ? b : a)));
  }

  const existing = new Map<string, number>();
  for (const p of all('SELECT item_id, wear, variant, price FROM item_prices')) existing.set(`${p.item_id}|${p.wear}|${p.variant}`, Number(p.price));
  const toWrite = entries.filter((e) => existing.get(`${e.itemId}|${e.wear}|${e.variant}`) !== e.price);
  const added = toWrite.filter((e) => !existing.has(`${e.itemId}|${e.wear}|${e.variant}`)).length;
  const changed = toWrite.length - added;
  const unchanged = entries.length - toWrite.length;
  const touchedItems = [...new Set(entries.map((e) => e.itemId))];

  console.log(`Записей в файле: ${st.total}. Совпало с каталогом: ${st.matched}, без цены: ${st.noPrice}, не найдено в каталоге: ${st.unmatched}` +
    (st.invalid ? `, без названия: ${st.invalid}` : '') + (st.wrongCurrency ? `, другая валюта: ${st.wrongCurrency}` : ''));
  console.log(`Поле цены: ${Object.entries(usedField).map(([k, v]) => `${k} — ${v}`).join(', ') || 'нет'}`);

  const source = opt('--source') || `file:${path.basename(abs)}`;
  const reportBase = {
    file: abs, source, at: new Date().toISOString(), dryRun: DRY, batch: BATCH, fields: FIELDS, currency: CURRENCY,
    records: st.total, matchedRecords: st.matched, skippedNoPrice: st.noPrice, unmatched: st.unmatched, invalid: st.invalid,
    wrongCurrency: st.wrongCurrency, mergedDuplicates: st.merged, priceRows: { added, updated: changed, unchanged }, skinsUpdated: touchedItems.length,
  };

  if (DRY) {
    console.log('\nПробный запуск завершён, база не изменялась.');
    printSummary(reportBase, null);
    return;
  }

  // ---------- 3. Резервная копия и снимок защищённых данных ----------
  const before = protectedSnapshot();
  const bk = makeBackup();
  console.log(`Резервная копия: ${bk.file} (${(bk.size / 1048576).toFixed(2)} МБ), проверка целостности пройдена`);

  // ---------- 4. Запись цен пакетами ----------
  const t0 = Date.now();
  const ts = now();
  const UPSERT = 'INSERT INTO item_prices(item_id,wear,variant,price,source,updated_at) VALUES(?,?,?,?,?,?) ' +
    'ON CONFLICT(item_id,wear,variant) DO UPDATE SET price=excluded.price, source=excluded.source, updated_at=excluded.updated_at';
  let batches = 0;
  for (let i = 0; i < toWrite.length; i += BATCH) {
    const chunk = toWrite.slice(i, i + BATCH);
    tx(() => { for (const e of chunk) if (e.price > 0) run(UPSERT, e.itemId, e.wear, e.variant, e.price, source, ts); });
    batches++;
    process.stdout.write(`\rЦены: ${Math.min(i + BATCH, toWrite.length)}/${toWrite.length} (пакетов: ${batches})`);
    if (PAUSE) await sleep(PAUSE);
  }
  if (toWrite.length) process.stdout.write('\n');

  // ---------- 5. Базовая цена скина (items.base_price) — тоже пакетами ----------
  let baseUpdated = 0;
  for (let i = 0; i < touchedItems.length; i += BATCH) {
    const chunk = touchedItems.slice(i, i + BATCH);
    tx(() => {
      for (const id of chunk) {
        const p = one("SELECT price, source FROM item_prices WHERE item_id=? AND variant='' AND price>0 ORDER BY CASE wear WHEN 'FT' THEN 0 WHEN '' THEN 0 WHEN 'MW' THEN 1 WHEN 'WW' THEN 2 WHEN 'FN' THEN 3 ELSE 4 END LIMIT 1", id)
          || one('SELECT price, source FROM item_prices WHERE item_id=? AND price>0 ORDER BY price LIMIT 1', id);
        if (!p) continue;
        baseUpdated += run('UPDATE items SET base_price=?, price_source=?, updated_at=? WHERE id=? AND (base_price IS NOT ? OR price_source IS NOT ?)', p.price, p.source, now(), id, p.price, p.source).changes;
      }
    });
    if (PAUSE) await sleep(PAUSE);
  }

  // ---------- 6. Пересчёт кейсов (ничего не удаляет: меняет только ev и цену кейсов в авто-режиме) ----------
  if (RECALC) tx(() => recalcAllCases());

  const report = { ...reportBase, backup: path.basename(bk.file), baseUpdated, batches, seconds: Math.round((Date.now() - t0) / 100) / 10, casesRecalculated: RECALC };
  run('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
    'catalog_last_prices', JSON.stringify({ source, at: now(), added, updated: changed, skipped: st.noPrice, unmatched: st.unmatched }), now());
  audit(null, 'prices.import', 'items', null, { source, added, updated: changed, unchanged, skippedNoPrice: st.noPrice, unmatched: st.unmatched, skins: touchedItems.length, backup: report.backup, via: 'cli-local-file' }, 'cli');

  // ---------- 7. Проверка, что ничего лишнего не изменилось ----------
  const after = protectedSnapshot();
  const expectedGrowth: Record<string, number> = { item_prices: added, audit_log: 1 };
  const problems: string[] = [];
  for (const t of Object.keys(before.counts)) {
    if (t === 'settings') { if (after.counts[t] < before.counts[t]) problems.push(t); continue; }
    if (after.counts[t] !== before.counts[t] + (expectedGrowth[t] || 0)) problems.push(`${t}: было ${before.counts[t]}, стало ${after.counts[t]}`);
  }
  if (after.balance !== before.balance) problems.push(`сумма балансов: было ${before.balance}, стало ${after.balance}`);
  if (after.inventoryValue !== before.inventoryValue) problems.push('стоимость предметов в инвентарях изменилась');
  const zero = Number(one('SELECT COUNT(*) n FROM item_prices WHERE price<=0').n);
  if (zero) problems.push(`цен ≤ 0: ${zero}`);

  fs.mkdirSync(path.join(DATA, 'catalog'), { recursive: true });
  const reportFile = path.join(DATA, 'catalog', `price-import-${stamp()}.json`);
  fs.writeFileSync(reportFile, JSON.stringify({ ...report, checks: problems.length ? problems : 'ok', unmatchedNames: unmatched, noPriceNames }, null, 2));

  printSummary(report, problems);
  console.log(`Полный отчёт (со списком несовпавших и пропущенных): ${reportFile}`);
  const s = catalogStats();
  console.log(`Каталог: скинов ${s.items}, с ценой ${s.withPrice}, кейсов опубликовано ${s.cases}`);
  if (problems.length) { console.error('ВНИМАНИЕ: проверка нашла расхождения. Восстановите базу из резервной копии:', bk.file); process.exitCode = 2; }
}

function printSummary(r: any, problems: string[] | null) {
  console.log('\n================ ИТОГ ИМПОРТА ================');
  console.log(`Записей в JSON:                     ${r.records}`);
  console.log(`Обновлено скинов (предметов):       ${r.skinsUpdated}`);
  console.log(`  цен добавлено / изменено / без изменений: ${r.priceRows.added} / ${r.priceRows.updated} / ${r.priceRows.unchanged}`);
  console.log(`  дублей фаз объединено:             ${r.mergedDuplicates}`);
  console.log(`Пропущено (нет цены, 0 не ставится): ${r.skippedNoPrice}`);
  console.log(`Не совпало с каталогом:             ${r.unmatched}`);
  if (r.invalid) console.log(`Некорректных записей:               ${r.invalid}`);
  if (r.wrongCurrency) console.log(`Другая валюта:                      ${r.wrongCurrency}`);
  if (problems) console.log(`Проверка сохранности данных:        ${problems.length ? 'РАСХОЖДЕНИЯ: ' + problems.join('; ') : 'ok (пользователи, инвентари, балансы, кейсы не тронуты)'}`);
  console.log('==============================================');
}

main().catch((e) => { console.error('\nОшибка импорта цен:', e.message); process.exit(1); });
