import { mkdirSync, copyFileSync, existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join, basename, resolve } from 'node:path';
import { randomBytes, createCipheriv } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from '../src/config.mjs';

const dir = DATA_DIR;
const source = join(dir, 'repairlylabs.sqlite');
if (!existsSync(source)) {
  console.error('No database found.');
  process.exit(1);
}

const args = process.argv.slice(2);
const keepArg = args.find((a) => a.startsWith('--keep='));
const keepRaw = keepArg ? keepArg.slice('--keep='.length) : process.env.RL_BACKUP_RETENTION;
const keepCount = keepRaw !== undefined && keepRaw !== '' ? Number(keepRaw) : 14;
if (!Number.isInteger(keepCount) || keepCount < 1) {
  throw new Error('RL_BACKUP_RETENTION / --keep must be a positive integer.');
}
const keepPlain = args.includes('--keep-plain');
const encKeyHex = process.env.RL_BACKUP_KEY || '';
if (encKeyHex && !/^[a-f0-9]{64}$/i.test(encKeyHex)) {
  throw new Error('RL_BACKUP_KEY must be a 64-character hex string.');
}

const folder = join(dir, 'backups');
mkdirSync(folder, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const plainDest = join(folder, `repairlylabs-${stamp}.sqlite`);

const db = new DatabaseSync(source);
db.exec(`VACUUM INTO '${plainDest.replaceAll("'", "''")}'`);
db.close();

const check = new DatabaseSync(plainDest, { readOnly: true });
const integrity = check.prepare('PRAGMA integrity_check').all();
const fkIssues = check.prepare('PRAGMA foreign_key_check').all();
check.close();
if (integrity.some((row) => Object.values(row)[0] !== 'ok') || fkIssues.length) {
  try { unlinkSync(plainDest); } catch {}
  throw new Error('Backup integrity check failed.');
}

let finalDest = plainDest;
if (encKeyHex) {
  const key = Buffer.from(encKeyHex, 'hex');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plain = readFileSync(plainDest);
  const encrypted = Buffer.concat([
    Buffer.from('RLBK\x01', 'binary'),
    iv,
    cipher.update(plain),
    cipher.final(),
    cipher.getAuthTag()
  ]);
  finalDest = plainDest + '.enc';
  writeFileSync(finalDest, encrypted, { mode: 0o600 });
  if (!keepPlain) {
    unlinkSync(plainDest);
  }
}

const offsite = process.env.RL_BACKUP_OFFSITE_DIR ? resolve(process.env.RL_BACKUP_OFFSITE_DIR) : '';
if (offsite && offsite !== resolve(folder)) {
  mkdirSync(offsite, { recursive: true });
  copyFileSync(finalDest, join(offsite, basename(finalDest)));
}

const entries = readdirSync(folder)
  .filter((name) => /^repairlylabs-.*\.(?:sqlite|sqlite\.enc)$/.test(name))
  .map((name) => {
    const full = join(folder, name);
    return { name, full, mtime: statSync(full).mtimeMs };
  })
  .sort((a, b) => b.mtime - a.mtime || b.name.localeCompare(a.name));

for (const stale of entries.slice(keepCount)) {
  if (stale.full !== finalDest && stale.full !== plainDest) {
    try { unlinkSync(stale.full); } catch {}
  }
}

console.log('Backup:', finalDest);
