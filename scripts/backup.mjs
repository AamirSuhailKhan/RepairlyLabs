import { mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {DATA_DIR} from '../src/config.mjs';
const dir = DATA_DIR; const source = join(dir, 'repairlylabs.sqlite'); if (!existsSync(source)) { console.error('No database found.'); process.exit(1); }
const folder = join(dir, 'backups'); mkdirSync(folder, { recursive: true }); const dest = join(folder, `repairlylabs-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`); const db = new DatabaseSync(source); db.exec(`VACUUM INTO '${dest.replaceAll("'", "''")}'`); db.close(); const check=new DatabaseSync(dest,{readOnly:true});const result=check.prepare('PRAGMA integrity_check').all();check.close();if(result.some(row=>Object.values(row)[0]!=='ok'))throw Error('Backup integrity check failed'); console.log('Backup:', dest);
