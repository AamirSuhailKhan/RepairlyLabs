import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFileSync,existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { validLogin } from '../src/admin-access.mjs';
import { openDatabase, passwordHash } from '../src/data.mjs';
const file=resolve('.env');if(existsSync(file))for(const line of readFileSync(file,'utf8').split(/\r?\n/)){const m=line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^['"]|['"]$/g,'');}
const rl=createInterface({input,output});
const username=(process.env.ADMIN_USERNAME||await rl.question('Admin username [owner]: ')||'owner').trim().toLowerCase();
const pass=process.env.ADMIN_PASSWORD||await rl.question('Admin password (at least 12 characters): ');
if(!validLogin(username)||pass.length<12){console.error('Invalid username or password too short (12+ chars).');rl.close();process.exit(1);}
const db=openDatabase();db.prepare('INSERT INTO admins(username,password_hash) VALUES(?,?) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash').run(username,passwordHash(pass));db.prepare('DELETE FROM sessions WHERE username=?').run(username);rl.close();db.close();console.log(`Admin ${username} configured. Visit /admin after npm start.`);
