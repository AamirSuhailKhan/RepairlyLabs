import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,existsSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {openDatabase,passwordHash,randomToken,hashToken} from '../src/data.mjs';
import {initAccess,issueRecovery,recoveryValid,recoverOwner} from '../src/admin-access.mjs';
const root=resolve(import.meta.dirname,'..');
const script=join(root,'scripts','revoke-compromised-access.mjs');
const reader=join(root,'scripts','audit-live-db-readonly.mjs');
const run=(file,args=[])=>spawnSync(process.execPath,[file,...args],{cwd:root,encoding:'utf8',env:{PATH:process.env.PATH,HOME:process.env.HOME||'',NODE_ENV:'test'}});
test('operator access revocation backs up database, does not alter owner password or business data, and invalidates leaked reset links',()=>{
 const dir=mkdtempSync(join(tmpdir(),'repairly-security-revocation-'));
 try{
  const db=openDatabase(dir);initAccess(db);
  const pass=passwordHash('unique-isolated-fixture-only');
  db.prepare('INSERT INTO admins(username,password_hash) VALUES(?,?)').run('owner',pass);
  db.prepare('INSERT INTO admin_owner(id,username) VALUES(1,?)').run('owner');
  db.prepare('INSERT INTO admins(username,password_hash) VALUES(?,?)').run('team',passwordHash('team-isolated-secret'));
  db.prepare('INSERT INTO sessions(token_hash,username,csrf,expires_at) VALUES(?,?,?,?)').run(hashToken(randomToken()),'owner','csrf',Date.now()+50000);
  db.prepare('INSERT INTO sessions(token_hash,username,csrf,expires_at) VALUES(?,?,?,?)').run(hashToken(randomToken()),'team','csrf',Date.now()+50000);
  db.prepare('INSERT INTO admin_offline_codes(token_hash,created_at) VALUES(?,?)').run(hashToken('other-old-recovery-code'),Date.now());
  db.exec("CREATE TABLE admin_email_links(token_hash TEXT PRIMARY KEY,username TEXT NOT NULL,email TEXT NOT NULL,purpose TEXT NOT NULL,password_version TEXT NOT NULL,expires_at INTEGER NOT NULL)");
  db.prepare('INSERT INTO admin_email_links(token_hash,username,email,purpose,password_version,expires_at) VALUES(?,?,?,?,?,?)').run(hashToken('old-email-link'),'owner','owner@example.test','reset',hashToken(pass),Date.now()+50000);
  db.prepare('INSERT INTO audit(username,action) VALUES(?,?)').run('owner','prior_business_audit_marker');
  const token=issueRecovery(db);
  const before=db.prepare('SELECT COUNT(*) n FROM devices').get().n;
  assert.equal(recoveryValid(db,token),true);
  const file=join(dir,'repairlylabs.sqlite');db.close();
  const noConfirmation=run(script,[`--db=${file}`]);assert.equal(noConfirmation.status,2);
  const result=run(script,[`--db=${file}`,'--confirm-revoke']);assert.equal(result.status,0,result.stderr);
  const report=JSON.parse(result.stdout);assert.equal(report.result,'SUCCESS');assert.equal(report.password_changed,false);
  assert.equal(report.admin_sessions_revoked,2);assert.equal(report.owner_sessions_revoked,1);
  assert.equal(report.recovery_links_revoked,3);assert.equal(report.offline_codes_revoked,1);
  assert.equal(report.email_links_revoked,1);assert.ok(existsSync(report.backup_location));
  const after=openDatabase(dir);initAccess(after);
  assert.equal(after.prepare('SELECT password_hash FROM admins WHERE username=?').get('owner').password_hash,pass);
  assert.equal(after.prepare('SELECT COUNT(*) n FROM sessions').get().n,0);
  assert.equal(after.prepare('SELECT COUNT(*) n FROM admin_recovery').get().n,0);
  assert.equal(after.prepare('SELECT COUNT(*) n FROM admin_offline_codes').get().n,0);
  assert.equal(after.prepare('SELECT COUNT(*) n FROM admin_email_links').get().n,0);
  assert.equal(after.prepare('SELECT COUNT(*) n FROM devices').get().n,before);
  assert.equal(after.prepare("SELECT COUNT(*) n FROM audit WHERE action='prior_business_audit_marker'").get().n,1);
  assert.equal(recoveryValid(after,token),false);after.close();
  const baseline=run(reader,[`--db=${file}`,`--baseline=${report.backup_location}`]);
  assert.equal(baseline.status,0,baseline.stderr);
  const evidence=JSON.parse(baseline.stdout);
  assert.match(evidence.password_comparison,/^MATCH/);
  assert.equal(evidence.database_integrity,'ok');
  assert.equal(baseline.stdout.includes(pass),false,'Never print password hashes');
  assert.equal(baseline.stdout.includes(token),false,'Never print recovery tokens');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('legacy visible browser audit entrypoints are hard-blocked from using the live port by default',()=>{
 for(const filename of ['master_browser_audit.py','master_visible_suite.py','test_vivo_phone_integration.py','verify_visible_desktop.py','test_india_enquiry_e2e.py','test_navbar_refinement.py']){
  const content=readFileSync(join(root,'tests',filename),'utf8');
  assert.ok(content.includes('isolated_visible_lifecycle.py'),filename);
  assert.ok(!content.includes('127.0.0.1:3001'),filename);
 }
});

test('owner password recovery invalidates all previously issued offline backup codes and verified-email reset links',()=>{
 const dir=mkdtempSync(join(tmpdir(),'repairly-recovery-rotates-'));
 try{
  const db=openDatabase(dir);initAccess(db);
  db.prepare('INSERT INTO admins(username,password_hash) VALUES(?,?)').run('owner',passwordHash('isolated-old-password'));
  db.prepare('INSERT INTO admin_owner(id,username) VALUES(1,?)').run('owner');
  db.prepare('INSERT INTO admin_offline_codes(token_hash,created_at) VALUES(?,?)').run(hashToken('stand-in-old-backup-code'),Date.now());
  db.exec("CREATE TABLE admin_email_links(token_hash TEXT PRIMARY KEY,username TEXT NOT NULL,email TEXT NOT NULL,purpose TEXT NOT NULL,password_version TEXT NOT NULL,expires_at INTEGER NOT NULL)");
  db.prepare('INSERT INTO admin_email_links(token_hash,username,email,purpose,password_version,expires_at) VALUES(?,?,?,?,?,?)').run(hashToken('stand-in-old-email-code'),'owner','owner@example.test','reset','old-password-hash',Date.now()+90000);
  const token=issueRecovery(db);
  assert.equal(recoveryValid(db,token),true);
  recoverOwner(db,{token,password:'isolated-new-password-for-test'});
  assert.equal(db.prepare('SELECT COUNT(*) n FROM admin_offline_codes').get().n,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM admin_email_links').get().n,0);
  assert.equal(recoveryValid(db,token),false);
  db.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('local recovery launcher never prints a bearer reset URL to terminal or writes it into an audit report',()=>{
 const script=readFileSync(join(root,'scripts','agent-owner-recovery.mjs'),'utf8');
 assert.ok(!script.includes("console.log(origin + '/admin#recover='"));
 assert.ok(script.includes('spawnSync'));
 assert.ok(script.includes('/api/admin/recovery-check'));
});

test('isolated Chrome runner blocks dotenv secrets and enforces an isolated browser profile',()=>{
 const python=readFileSync(join(root,'tests','isolated_visible_lifecycle.py'),'utf8');
 const config=readFileSync(join(root,'src','config.mjs'),'utf8');
 assert.ok(python.includes('REPAIRLYLABS_IGNORE_DOTENV'));
 assert.ok(config.includes('skipDotEnv'));
 assert.ok(config.includes("process.env.NODE_ENV==='test'"));
 assert.ok(python.includes('current_windows_desktop_name'));
 assert.ok(python.includes('capture_physical_desktop_proof'));
});
