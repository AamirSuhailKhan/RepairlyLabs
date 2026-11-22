/**
 * PRIVATE INTERACTIVE WINDOWS recovery helper.
 * Open a one-time browser recovery page without putting its token into
 * terminal logs, screenshots, copied reports, or shell history.
 * Run directly in your own Windows session, never inside a remote agent log.
 */
import {existsSync,readFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';

async function main(){
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);
 if(process.platform!=='win32')throw Error('This browser reset helper must run on your interactive Windows desktop.');
 const envPath=join(root,'.env');
 if(existsSync(envPath))for(const line of readFileSync(envPath,'utf8').split(/\r?\n/)){
  const m=line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
  if(m&&!Object.hasOwn(process.env,m[1]))process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');
 }
 if(process.env.NODE_ENV==='production')throw Error('Production recovery requires the host operator and HTTPS verified recovery.');
 const port=Number(process.env.PORT||3001);
 if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid local PORT.');
 const dir=resolve(process.env.DATA_DIR||'data');
 const path=join(dir,'repairlylabs.sqlite');
 if(!existsSync(path))throw Error('Existing database not found. No new database created.');
 const origin=`http://127.0.0.1:${port}`;
 const info=await fetch(origin+'/api/admin/access-info',{signal:AbortSignal.timeout(4000)}).then(r=>r.ok?r.json():null);
 if(!info||!Number.isInteger(info.version)||info.version<3)throw Error('Correct updated RepairlyLabs server not available.');
 const app=await fetch(origin+'/app.js',{signal:AbortSignal.timeout(4000)});
 if(!app.ok||!(await app.text()).includes('recoveryToken'))throw Error('Browser recovery UI not available.');
 const {openDatabase}=await import('../src/data.mjs');
 const {issueRecovery}=await import('../src/admin-access.mjs');
 const db=openDatabase(dir);let token;
 try{token=issueRecovery(db);}finally{db.close();}
 const check=await fetch(origin+'/api/admin/recovery-check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),signal:AbortSignal.timeout(4000)});
 if(!check.ok||!(await check.json()).valid)throw Error('Server database does not match local database. Browser link not opened.');
 const url=`http://localhost:${port}/admin#recover=${token}`;
 const launch=spawnSync('rundll32.exe',['url.dll,FileProtocolHandler',url],{stdio:'ignore',windowsHide:true});
 if(launch.error||launch.status!==0)throw Error('Browser launch failed. No token printed; rerun from interactive Windows terminal.');
 console.log('Private one-time reset page requested in the local browser. The link was NOT printed or logged.');
 console.log('Complete the reset personally. Do not screenshot or share a recovery token.');
}
main().catch(()=>{console.error('BLOCKED: Private browser recovery could not be opened or validated. No recovery link disclosed.');process.exitCode=2;});
