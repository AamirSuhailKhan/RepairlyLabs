import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { readFileSync,existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { validLogin } from '../src/admin-access.mjs';
import { openDatabase, passwordHash } from '../src/data.mjs';
import {DATA_DIR} from '../src/config.mjs';
const rl=createInterface({input,output});
const username=(process.env.ADMIN_USERNAME||await rl.question('Admin username [owner]: ')||'owner').trim().toLowerCase();
const pass=process.env.ADMIN_PASSWORD||await rl.question('Admin password (at least 8 characters): ');
if(!validLogin(username)||pass.length<8||pass.length>150){console.error('Invalid username or password too short (8–150 chars).');rl.close();process.exit(1);}
const db=openDatabase(DATA_DIR);
try {
  // Bootstrap is never a password reset facility: an earlier setup script could
  // silently replace owner credentials with ADMIN_PASSWORD from an old .env.
  if (db.prepare('SELECT COUNT(*) AS n FROM admins').get().n > 0) {
    throw new Error('Existing administrator detected. No credentials changed. Use authenticated Security settings or a one-time owner recovery link instead.');
  }
  db.prepare('INSERT INTO admins(username,password_hash) VALUES(?,?)').run(username,passwordHash(pass));
  console.log(`First administrator ${username} configured. Visit /admin after npm start.`);
} catch(error) {
  console.error(error.message);process.exitCode=1;
} finally {rl.close();db.close();}

