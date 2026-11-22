import {existsSync,readFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
export const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const file=join(ROOT,'.env');
// Isolated tests must never silently inherit live payment, email, OTP or webhook secrets from .env.
const skipDotEnv=process.env.REPAIRLYLABS_IGNORE_DOTENV==='1'||process.env.NODE_ENV==='test'||process.env.REPAIRLYLABS_TEST==='1';
if(!skipDotEnv&&existsSync(file))for(const line of readFileSync(file,'utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);if(m&&!Object.hasOwn(process.env,m[1]))process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
export const DATA_DIR=process.env.DATA_DIR ? resolve(ROOT, process.env.DATA_DIR) : (process.env.VERCEL ? '/tmp/data' : resolve(ROOT, 'data'));

// A test-mode production deployment could unintentionally expose sample stock
// and bypass ordinary public catalog restrictions. Fail before starting.
if (process.env.NODE_ENV === 'production' && (process.env.REPAIRLYLABS_TEST === '1' || process.env.KASHIFIX_TEST === '1')) {
  throw new Error('Unsafe production configuration: automated-test mode must be disabled.');
}
