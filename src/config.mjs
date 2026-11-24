import {existsSync,readFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {isIP} from 'node:net';
import {fileURLToPath} from 'node:url';
export const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const file=join(ROOT,'.env');
// Isolated tests must never silently inherit live payment, email, OTP or webhook secrets from .env.
const skipDotEnv=process.env.REPAIRLYLABS_IGNORE_DOTENV==='1'||process.env.NODE_ENV==='test'||process.env.REPAIRLYLABS_TEST==='1';
if(!skipDotEnv&&existsSync(file))for(const line of readFileSync(file,'utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);if(m&&!Object.hasOwn(process.env,m[1]))process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
export const DATA_DIR=process.env.DATA_DIR ? resolve(ROOT, process.env.DATA_DIR) : (process.env.VERCEL ? '/tmp/data' : resolve(ROOT, 'data'));

export function validateEnvironment(env=process.env){
  const errors=[];
  const warnings=[];
  const prod=env.NODE_ENV==='production';
  if(prod&&(env.REPAIRLYLABS_TEST==='1'||env.KASHIFIX_TEST==='1')){
    errors.push('Unsafe production configuration: automated-test mode must be disabled.');
  }
  if(env.PORT!==undefined&&env.PORT!==''){
    const p=Number(env.PORT);
    if(!Number.isInteger(p)||p<0||p>65535) errors.push('Invalid PORT value; must be integer 0-65535.');
  }
  if(env.PUBLIC_ORIGIN){
    try{
      const u=new URL(env.PUBLIC_ORIGIN);
      if(u.protocol!=='https:'||u.username||u.password||u.pathname!=='/'||u.search||u.hash){
        errors.push('PUBLIC_ORIGIN must be an exact HTTPS origin without path, query, or credentials.');
      }
    }catch{
      errors.push('PUBLIC_ORIGIN is not a valid URL.');
    }
  }else if(prod){
    warnings.push('PUBLIC_ORIGIN is unset; sitemap.xml will fail closed (404) until set.');
  }
  if(env.TRUST_PROXY_CIDRS){
    for(const raw of String(env.TRUST_PROXY_CIDRS).split(',').map(s=>s.trim()).filter(Boolean)){
      const slash=raw.indexOf('/');
      const ip=slash>=0?raw.slice(0,slash):raw;
      const ver=isIP(ip);
      if(!ver){errors.push(`Invalid IP/CIDR in TRUST_PROXY_CIDRS: ${raw}`);continue;}
      if(slash>=0){
        const prefix=Number(raw.slice(slash+1));
        if(!Number.isInteger(prefix)||prefix<0||prefix>(ver===4?32:128)) errors.push(`Invalid CIDR prefix in TRUST_PROXY_CIDRS: ${raw}`);
      }
    }
  }
  if(env.RL_MFA_KEY&&!/^[a-f0-9]{64}$/i.test(env.RL_MFA_KEY)) errors.push('RL_MFA_KEY must be a 64-character hex string.');
  if(env.RL_BACKUP_KEY&&!/^[a-f0-9]{64}$/i.test(env.RL_BACKUP_KEY)) errors.push('RL_BACKUP_KEY must be a 64-character hex string.');
  if(env.RL_BACKUP_RETENTION!==undefined&&env.RL_BACKUP_RETENTION!==''){
    const n=Number(env.RL_BACKUP_RETENTION);
    if(!Number.isInteger(n)||n<1) errors.push('RL_BACKUP_RETENTION must be a positive integer.');
  }
  const rpVars=['RAZORPAY_KEY_ID','RAZORPAY_KEY_SECRET','RAZORPAY_WEBHOOK_SECRET'];
  const rpSet=rpVars.filter(k=>Boolean(env[k]));
  if(rpSet.length>0&&rpSet.length<rpVars.length) warnings.push('Razorpay integration is partially configured; set Key ID, Key Secret, and Webhook Secret together.');
  if(env.RL_GATEWAY_QR_ENABLED==='1'&&!(env.RAZORPAY_KEY_ID&&env.RAZORPAY_KEY_SECRET)) warnings.push('RL_GATEWAY_QR_ENABLED=1 requires RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.');
  const twVars=['TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN','TWILIO_VERIFY_SERVICE_SID'];
  const twSet=twVars.filter(k=>Boolean(env[k]));
  if(twSet.length>0&&twSet.length<twVars.length) warnings.push('Twilio SMS verification is partially configured.');
  if(env.RL_RESEND_KEY&&(!env.RL_OWNER_EMAIL||!env.RL_FROM_EMAIL)) warnings.push('RL_RESEND_KEY is set without both RL_OWNER_EMAIL and RL_FROM_EMAIL.');
  return {ok:errors.length===0,errors,warnings};
}

const startupCheck=validateEnvironment(process.env);
if(process.env.NODE_ENV==='production'){
  if(!startupCheck.ok) throw new Error(startupCheck.errors[0]);
  for(const w of startupCheck.warnings) console.warn('[config]',w);
}
