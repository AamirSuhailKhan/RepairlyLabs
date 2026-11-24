import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createDecipheriv } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from '../src/config.mjs';

const [source, destination] = process.argv.slice(2);
if (!source || !destination) {
  console.error('Usage: node scripts/restore-check.mjs <consistent backup.sqlite | backup.sqlite.enc> <new empty directory>');
  process.exit(1);
}

const src = resolve(source);
const dir = resolve(destination);
const dest = join(dir, 'repairlylabs.sqlite');
if (!existsSync(src) || dir === DATA_DIR || existsSync(dest) || existsSync(dest + '-wal') || existsSync(dest + '-shm')) {
  throw new Error('Supply a valid backup and a new directory, never the live database.');
}
if (existsSync(src + '-wal') || existsSync(src + '-shm')) {
  throw new Error('Use a consistent VACUUM INTO backup, not a live SQLite file.');
}

const rawHead = readFileSync(src);
const isEncrypted = src.endsWith('.enc') || rawHead.subarray(0, 5).toString('binary') === 'RLBK\x01';

mkdirSync(dir, { recursive: true });
if (isEncrypted) {
  const keyHex = process.env.RL_BACKUP_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(keyHex)) {
    throw new Error('RL_BACKUP_KEY (64-char hex) is required to restore an encrypted backup.');
  }
  if (rawHead.subarray(0, 5).toString('binary') !== 'RLBK\x01' || rawHead.length < 40) {
    throw new Error('Invalid encrypted backup header.');
  }
  const iv = rawHead.subarray(5, 17);
  const tag = rawHead.subarray(-16);
  const ciphertext = rawHead.subarray(17, -16);
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  writeFileSync(dest, plain, { mode: 0o600 });
} else {
  const db = new DatabaseSync(src, { readOnly: true });
  const integrity = db.prepare('PRAGMA integrity_check').all();
  const foreign = db.prepare('PRAGMA foreign_key_check').all();
  db.close();
  if (integrity.some((x) => Object.values(x)[0] !== 'ok') || foreign.length) {
    throw new Error('Backup integrity check failed.');
  }
  copyFileSync(src, dest, 1);
}

try {
  const restored = new DatabaseSync(dest, { readOnly: true });
  const result = restored.prepare('PRAGMA integrity_check').all();
  const foreign = restored.prepare('PRAGMA foreign_key_check').all();
  restored.close();
  if (result.some((x) => Object.values(x)[0] !== 'ok') || foreign.length) {
    throw new Error('Restored copy failed integrity check.');
  }
} catch (err) {
  try { unlinkSync(dest); } catch {}
  throw err;
}

console.log('Backup verified and copied to a new database directory:', dir);
console.log('No live database was replaced. Test this copy privately before a deliberate recovery.');
