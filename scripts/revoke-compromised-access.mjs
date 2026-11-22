/**
 * TRUSTED LOCAL OPERATOR ONLY. Deletes every administrator browser session and
 * every outstanding locally stored password recovery credential.
 * Never changes passwords, customer records, or payment data.
 * Default is a safe non-mutating failure. Requires existing absolute --db and
 * --confirm-revoke. An integrity-checked consistent SQLite backup is mandatory.
 * Usage: node scripts/revoke-compromised-access.mjs --db="C:\\...\\repairlylabs.sqlite" --confirm-revoke
 */
import {resolve,isAbsolute,dirname,join} from 'node:path';
import {existsSync,mkdirSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const opts = new Map(process.argv.slice(2).filter(x=>x.startsWith('--')&&x.includes('=')).map(x=>x.slice(2).split(/=(.*)/s).slice(0,2)));
const input = opts.get('db');
if (!input || !isAbsolute(input) || !existsSync(input) || !process.argv.includes('--confirm-revoke')) {
  console.error('BLOCKED: Provide an existing ABSOLUTE --db=... and --confirm-revoke. No changes made.');
  process.exit(2);
}
const file=resolve(input);
const db=new DatabaseSync(file,{timeout:5000});
try {
  const table=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(x=>x.name));
  if(!['admins','admin_owner','sessions','admin_recovery','admin_offline_codes'].every(x=>table.has(x)))
    throw Error('Incomplete RepairlyLabs security schema. No data changed.');
  const owner=db.prepare('SELECT a.username,a.password_hash FROM admin_owner o JOIN admins a ON a.username=o.username WHERE o.id=1').get();
  if(!owner)throw Error('Owner account not found. No data changed.');
  if(Object.values(db.prepare('PRAGMA integrity_check').get())[0]!=='ok')throw Error('Source database integrity check failed.');

  const backupDir=join(dirname(file),'backups');mkdirSync(backupDir,{recursive:true});
  const backup=join(backupDir,'pre-access-revocation-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomBytes(4).toString('hex')+'.sqlite');
  db.exec(`VACUUM INTO '${backup.replaceAll("'","''")}'`);
  const verify=new DatabaseSync(backup,{readOnly:true});
  try {
    const ok=Object.values(verify.prepare('PRAGMA integrity_check').get())[0]==='ok';
    const before=verify.prepare('SELECT password_hash FROM admins WHERE username=?').get(owner.username)?.password_hash;
    if(!ok || before!==owner.password_hash)throw Error('Consistent backup validation failed; no access revoked.');
    for(const name of ['bookings','orders','rl_part_inquiries']){
      if(table.has(name) && verify.prepare(`SELECT COUNT(*) n FROM "${name}"`).get().n!==db.prepare(`SELECT COUNT(*) n FROM "${name}"`).get().n)
        throw Error('Backup business record counts differ; no access revoked.');
    }
  } finally {verify.close();}

  const ownerSessionCount=db.prepare('SELECT COUNT(*) n FROM sessions WHERE username=?').get(owner.username).n;
  db.exec('BEGIN IMMEDIATE');
  const removed={};
  try {
    // The reported compromise included publicly exposed recovery URLs and
    // audit credentials. Revoking OWNER sessions only would leave staff sessions.
    for(const name of ['sessions','admin_recovery','admin_offline_codes','admin_email_links']){
      removed[name]=table.has(name)?db.prepare(`DELETE FROM "${name}"`).run().changes:0;
    }
    if(table.has('audit'))db.prepare('INSERT INTO audit(username,action,details) VALUES(?,?,?)').run(owner.username,'operator_access_revocation','Admin sessions and all pending recovery credentials revoked; password unchanged');
    db.exec('COMMIT');
  } catch(e){db.exec('ROLLBACK');throw e;}

  if(db.prepare('SELECT password_hash FROM admins WHERE username=?').get(owner.username)?.password_hash!==owner.password_hash)
    throw Error('POST-CHECK FAILED: owner password hash changed unexpectedly. Inspect the verified backup.');
  console.log(JSON.stringify({result:'SUCCESS',admin_sessions_revoked:removed.sessions,
    owner_sessions_revoked:ownerSessionCount,
    recovery_links_revoked:removed.admin_recovery+removed.admin_offline_codes+removed.admin_email_links,
    offline_codes_revoked:removed.admin_offline_codes, email_links_revoked:removed.admin_email_links,
    backup_created:true,backup_location:backup,password_changed:false,customer_records_changed:false,
    scope:'ALL admin sessions and pending recovery credentials; no password or business records altered'},null,2));
} catch(e){console.error('BLOCKED:',e.message);process.exitCode=2;}
finally {db.close();}
