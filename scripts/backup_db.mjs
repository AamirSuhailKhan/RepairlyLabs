import { openDatabase } from '../src/data.mjs';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const db = openDatabase();
mkdirSync('data/backups', { recursive: true });

try {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
} catch (e) {
  console.log('Checkpoint note:', e.message);
}

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const backupPath = join(process.cwd(), 'data', 'backups', `repairlylabs_backup_${ts}.sqlite`);
const sanitizedPath = backupPath.replace(/\\/g, '/');

db.exec(`VACUUM INTO '${sanitizedPath}';`);
console.log('SUCCESS: Database safely backed up to:', sanitizedPath);

process.exit(0);
