// Trusted local operator utility. Never deploy the launcher as a public web route.
import {readFileSync,existsSync,openSync,appendFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,execFileSync} from 'node:child_process';
import {openDatabase} from '../src/data.mjs';
import {issueRecovery} from '../src/admin-access.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');process.chdir(root);
const log=join(root,'browser-access.log');
try{
 if(existsSync('.env'))for(const line of readFileSync('.env','utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);if(m&&!Object.hasOwn(process.env,m[1]))process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
 const port=Number(process.env.PORT||3001);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid PORT setting.');
 if(process.env.NODE_ENV==='production')throw Error('This local Windows launcher is for development/local hosting. For production, use your host operator and HTTPS recovery procedure in ACCESS-README.md.');
 const origin=`http://127.0.0.1:${port}`;const browserOrigin=`http://localhost:${port}`;
 const probe=async()=>{try{const r=await fetch(origin+'/api/admin/access-info',{signal:AbortSignal.timeout(1200)});return (await r.json()).version===3?'ready':'wrong';}catch{try{const r=await fetch(origin+'/api/health',{signal:AbortSignal.timeout(1000)});return r?'wrong':'offline';}catch{return 'offline';}}};
 let state=await probe();if(state==='wrong')throw Error('An older server or another application is using this port. Stop the old RepairlyLabs server or redeploy this updated version first.');
 if(state==='offline'){const out=openSync(join(root,'repairlylabs-server.log'),'a');const child=spawn(process.execPath,[join(root,'src','server.mjs')],{cwd:root,env:{...process.env,PORT:String(port)},detached:true,windowsHide:true,stdio:['ignore',out,out]});child.unref();for(let i=0;i<30;i++){await new Promise(r=>setTimeout(r,300));state=await probe();if(state==='ready')break;}if(state!=='ready')throw Error('Server did not start. See repairlylabs-server.log.');}
 let url=browserOrigin+'/admin';
 if(process.argv[2]==='recover'){
  const dataDir=resolve(process.env.DATA_DIR||'data');
  if(!existsSync(join(dataDir,'repairlylabs.sqlite')))throw Error('Existing local SQLite database not found; no recovery link issued.');
  const db=openDatabase(dataDir);let token;try{token=issueRecovery(db);}finally{db.close();}
  const checked=await fetch(origin+'/api/admin/recovery-check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),signal:AbortSignal.timeout(4000)});
  if(!checked.ok||!(await checked.json()).valid)throw Error('The running server has a different database. Browser recovery will not open.');
  url+='#recover='+token;
 }
 // Fragment keeps the one-time secret out of server request URLs and access logs.
 if(process.platform==='win32')execFileSync('rundll32.exe',['url.dll,FileProtocolHandler',url],{windowsHide:true});else throw Error('Use the Windows launcher on your local PC.');
}catch(e){appendFileSync(log,new Date().toISOString()+' '+e.message+'\n');process.exitCode=1;}
