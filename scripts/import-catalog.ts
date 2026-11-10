// Импорт каталога скинов CS2 и официальных кейсов.
//
// Источник по умолчанию — открытый каталог ByMykel/CSGO-API (MIT), данные из файлов игры, изображения с CDN Steam.
//   npm run import:catalog                          — скачать skins.json + crates.json и импортировать
//   npm run import:catalog -- --download-images     — дополнительно сохранить картинки локально (public/img/items/ext)
//   npm run import:catalog -- --file skins.json --crates crates.json   — импорт из локальных файлов (JSON или CSV)
//   npm run import:catalog -- --no-cases            — не перестраивать кейсы
// Кейсы собираются только из предметов с изображением И ценой, поэтому после каталога запустите import:prices.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA, ROOT, all, run } from '../src/lib/db.ts';
import { importItems, importCrates, buildThemedCases, parseImport, catalogStats, recalcAllCases } from '../src/lib/catalog.ts';
import { audit } from '../src/lib/core.ts';

const BASES = ['https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/', 'https://bymykel.github.io/CSGO-API/api/en/'];
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const CACHE = path.join(DATA, 'catalog');
fs.mkdirSync(CACHE, { recursive: true });

async function download(name: string): Promise<string> {
  let last: any = null;
  for (const base of BASES) {
    try {
      const url = new URL(name, base).toString();
      console.log('Загрузка', url);
      const r = await fetch(url, { headers: { 'User-Agent': 'BURGER-SKIN-importer' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const text = await r.text();
      fs.writeFileSync(path.join(CACHE, name), text);
      return text;
    } catch (e: any) { last = e; console.warn('  не удалось:', e.message); }
  }
  throw new Error(`Не удалось скачать ${name}: ${last?.message}. Проверьте интернет или используйте --file.`);
}

async function downloadImages(limitConc = 8) {
  const dir = path.join(ROOT, 'public', 'img', 'items', 'ext');
  fs.mkdirSync(dir, { recursive: true });
  const rows = all("SELECT id, image FROM items WHERE image LIKE 'https://%'");
  let ok = 0, fail = 0, i = 0;
  const worker = async () => {
    while (i < rows.length) {
      const r = rows[i++];
      const name = crypto.createHash('sha1').update(r.image).digest('hex').slice(0, 20) + '.png';
      const file = path.join(dir, name);
      try {
        if (!fs.existsSync(file)) {
          const res = await fetch(r.image);
          if (!res.ok) throw new Error('HTTP ' + res.status);
          const type = res.headers.get('content-type') || '';
          if (!/^image\//.test(type)) throw new Error('не изображение');
          fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
        }
        run('UPDATE items SET image=? WHERE id=?', '/img/items/ext/' + name, r.id);
        ok++;
      } catch { fail++; }
      if ((ok + fail) % 250 === 0) console.log(`  изображения: ${ok + fail}/${rows.length}`);
    }
  };
  await Promise.all(Array.from({ length: limitConc }, worker));
  return { ok, fail, total: rows.length };
}

async function main() {
  const file = opt('--file');
  const skinsText = file ? fs.readFileSync(file, 'utf8') : await download('skins.json');
  const rows = parseImport(skinsText, file && /\.csv$/i.test(file) ? 'csv' : undefined);
  console.log(`Предметов в источнике: ${rows.length}`);
  let use = rows;
  if (flag('--wishlist') || flag('--premium')) {
    // Только предметы из scripts/premium-wishlist.json, которые реально присутствуют в источнике.
    const norm = (x: any) => String(x || '').replace(/^\u2605\s*/, '').trim().toLowerCase();
    const wl = JSON.parse(fs.readFileSync(path.resolve('scripts/premium-wishlist.json'), 'utf8'));
    const want = new Set<string>((wl.items || []).map((x: any) => norm(x.name)));
    use = rows.filter((r: any) => want.has(norm(r.name || r.market_hash_name)));
    const found = new Set(use.map((r: any) => norm(r.name || r.market_hash_name)));
    console.log(`Премиум-список: найдено ${found.size} из ${want.size}`);
    const miss = [...want].filter((n) => !found.has(n));
    if (miss.length) console.log('Нет в источнике:', miss.slice(0, 40).join('; '));
  }
  const rep = importItems(use, file ? 'file:' + path.basename(file) : 'bymykel');
  console.log(`Каталог: добавлено ${rep.added}, обновлено ${rep.updated}, пропущено ${rep.skipped}, ошибок ${rep.errors.length}`);
  if (rep.errors.length) console.log(rep.errors.slice(0, 15));
  if (flag('--download-images')) console.log('Изображения:', await downloadImages());
  if (!flag('--no-cases')) {
    let cratesText: string | null = null;
    const cf = opt('--crates');
    if (cf) cratesText = fs.readFileSync(cf, 'utf8');
    else if (!file) { try { cratesText = await download('crates.json'); } catch (e: any) { console.warn(e.message); } }
    if (cratesText) { fs.writeFileSync(path.join(CACHE, 'crates.json'), cratesText); console.log('Официальные кейсы:', importCrates(parseImport(cratesText))); }
    console.log('Тематические кейсы:', buildThemedCases());
    recalcAllCases();
  }
  audit(null, 'catalog.import', 'items', null, { added: rep.added, updated: rep.updated, via: 'cli' }, 'cli');
  console.log('Итог:', catalogStats());
}
main().catch((e) => { console.error('Ошибка импорта:', e.message); process.exit(1); });
