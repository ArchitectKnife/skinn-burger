// Резервная копия базы данных: npm run backup
// Копия создаётся атомарно (VACUUM INTO) в data/backups/. Восстановление описано в README.md.
import { makeBackup } from '../src/routes/admin.ts';
import { audit } from '../src/lib/core.ts';

const r = makeBackup();
audit(null, 'backup.create', 'backup', r.file, { via: 'cli', size: r.size }, 'cli');
console.log(`Резервная копия создана: ${r.file} (${(r.size / 1024).toFixed(1)} КБ)`);
