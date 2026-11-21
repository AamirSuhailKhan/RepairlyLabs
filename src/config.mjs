import {existsSync,readFileSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
export const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const file=join(ROOT,'.env');
if(existsSync(file))for(const line of readFileSync(file,'utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);if(m&&!Object.hasOwn(process.env,m[1]))process.env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');}
export const DATA_DIR=process.env.DATA_DIR ? resolve(ROOT, process.env.DATA_DIR) : (process.env.VERCEL ? '/tmp/data' : resolve(ROOT, 'data'));
