// Импорт рыночных цен из проверенного источника.
//   npm run import:prices                              — Skinport public API (https://docs.skinport.com), валюта RUB
//   npm run import:prices -- --currency USD            — другая валюта Skinport (USD, EUR, RUB ...)
//   npm run import:prices -- --file prices.json        — локальный JSON/CSV: market_hash_name + price (или suggested_price/median_price/min_price)
//   npm run import:prices -- --file prices.csv --source steam-market
// Цены хранятся в копейках рубля. По умолчанию запрашиваются цены в RUB; конвертация по курсу не выполняется.
// После обновления цен кейсы пересобираются и пересчитываются автоматически.
import fs from 'node:fs';
import path from 'node:path';
import { DATA } from '../src/lib/db.ts';
import { importPrices, importCrates, buildThemedCases, parseImport, catalogStats, recalcAllCases } from '../src/lib/catalog.ts';
import { audit } from '../src/lib/core.ts';

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };

async function fromSkinport(currency: string) {
  const url = new URL('https://api.skinport.com/v1/items');
  url.searchParams.set('app_id', '730');
  url.searchParams.set('currency', currency);
  url.searchParams.set('tradable', '0');
  console.log('Загрузка', url.toString());
  const r = await fetch(url, { headers: { 'Accept-Encoding': 'br', 'User-Agent': 'BURGER-SKIN-importer' } });
  if (!r.ok) throw new Error(`Skinport ответил HTTP ${r.status}. Лимит API — 8 запросов за 5 минут; повторите позже или используйте --file.`);
  const text = await r.text();
  fs.mkdirSync(path.join(DATA, 'catalog'), { recursive: true });
  fs.writeFileSync(path.join(DATA, 'catalog', `skinport-${currency}.json`), text);
  return JSON.parse(text);
}

async function main() {
  const file = opt('--file');
  const currency = (opt('--currency') || 'RUB').toUpperCase();
  const rows = file ? parseImport(fs.readFileSync(file, 'utf8'), /\.csv$/i.test(file) ? 'csv' : undefined) : await fromSkinport(currency);
  const source = opt('--source') || (file ? 'file:' + path.basename(file) : `skinport:${currency}`);
  console.log(`Строк с ценами: ${rows.length}`);
  const rep = importPrices(rows, source);
  console.log(`Цены: добавлено ${rep.added}, обновлено ${rep.updated}, пропущено ${rep.skipped}, не найдено в каталоге ${rep.unmatched.length}`);
  if (rep.unmatched.length) console.log('Примеры без совпадения:', rep.unmatched.slice(0, 10));
  if (!args.includes('--no-cases')) {
    const cached = path.join(DATA, 'catalog', 'crates.json');
    if (fs.existsSync(cached)) console.log('Официальные кейсы:', importCrates(parseImport(fs.readFileSync(cached, 'utf8'))));
    console.log('Тематические кейсы:', buildThemedCases());
  }
  recalcAllCases();
  audit(null, 'prices.import', 'items', null, { source, added: rep.added, updated: rep.updated, via: 'cli' }, 'cli');
  console.log('Итог:', catalogStats());
}
main().catch((e) => { console.error('Ошибка импорта цен:', e.message); process.exit(1); });
