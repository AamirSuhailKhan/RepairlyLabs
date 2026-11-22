/**
 * Read-only evidence inspection. NEVER changes records or opens a database in create mode.
 * Usage: node scripts/audit-live-db-readonly.mjs --db="C:\\...\\data\\repairlylabs.sqlite" [--baseline="...backup.sqlite"]
 * No names, phone numbers, password hashes or access tokens are printed.
 */
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const args = new Map(process.argv.slice(2).filter(x=>x.startsWith('--')&&x.includes('=')).map(x=>x.slice(2).split(/=(.*)/s).slice(0,2)));
const source = args.get('db');
if(!source || !existsSync(resolve(source))){console.error('BLOCKED: supply an existing database path using --db=...');process.exit(2);}
function inspect(file){
 const db=new DatabaseSync(resolve(file),{readOnly:true});
 try {
  const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
  const count=t=>tables.has(t)?db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get().n:null;
  const owner=tables.has('admin_owner')&&tables.has('admins')?db.prepare('SELECT a.username,a.password_hash FROM admin_owner o JOIN admins a ON a.username=o.username WHERE o.id=1').get():null;
  const auditActions=tables.has('audit')?db.prepare("SELECT action,COUNT(*) AS n FROM audit WHERE lower(action) LIKE '%password%' OR lower(action) LIKE '%recover%' OR lower(action) LIKE '%session%' GROUP BY action").all():[];
  const ids={};for(const t of ['bookings','orders','rl_part_inquiries']){
   if(tables.has(t)){
    const cols=db.prepare(`PRAGMA table_info("${t}")`).all().map(x=>x.name);
    if(cols.includes('id')) ids[t]={id_min:db.prepare(`SELECT MIN(id) AS v FROM "${t}"`).get().v,id_max:db.prepare(`SELECT MAX(id) AS v FROM "${t}"`).get().v};
   }
  }
  const integrity=db.prepare('PRAGMA integrity_check').get();
  return {integrity:Object.values(integrity)[0],counts:Object.fromEntries(['admins','sessions','admin_recovery','admin_email_links','bookings','orders','rl_part_inquiries','audit'].map(t=>[t,count(t)])),ids,owner:owner?{username:owner.username,password_hash:owner.password_hash}:null,auditActions};
 }finally{db.close();}
}
try{
 const current=inspect(source);
 let comparison='NOT TESTED: an earlier trusted database backup is required';
 if(args.has('baseline')){
  if(!existsSync(resolve(args.get('baseline'))))throw new Error('Baseline file not found.');
  const baseline=inspect(args.get('baseline'));
  comparison=!current.owner||!baseline.owner?'BLOCKED: owner missing in one database':current.owner.username!==baseline.owner.username?'CHANGED: owner identity differs':current.owner.password_hash===baseline.owner.password_hash?'MATCH: owner password hash unchanged between supplied snapshots':'CHANGED: owner password hash differs between supplied snapshots';
 }
 console.log(JSON.stringify({status:current.integrity==='ok'?'READ_ONLY_COMPLETE':'INTEGRITY_WARNING',database_integrity:current.integrity,records:current.counts,record_id_ranges:current.ids,owner_exists:!!current.owner,password_comparison:comparison,security_audit_action_counts:current.auditActions,synthetic_record_identification:'UNVERIFIED: record IDs, names and dates alone do not prove an entry is synthetic',notes:'No database rows were changed. No personal fields or password hashes were output.'},null,2));
}catch(e){console.error('BLOCKED:',e.message);process.exitCode=2;}
