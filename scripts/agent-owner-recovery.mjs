// Trusted local operator only. Run from an agent's local terminal, never a public route.
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  process.chdir(root);
  const envPath = join(root, '.env');
  // Match the existing storefront environment parser and precedence.
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m && !Object.hasOwn(process.env, m[1])) {
        process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
      }
    }
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Local recovery only. Use the trusted production hosting operator and HTTPS for production.');
  }
  const port = Number(process.env.PORT || 3001);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT setting.');
  const dataDir = resolve(process.env.DATA_DIR || 'data');
  const dbPath = join(dataDir, 'repairlylabs.sqlite');
  if (!existsSync(dbPath)) throw new Error('Existing database not found at ' + dbPath + '. Verify the real server DATA_DIR; no new database was created.');
  const origin = `http://localhost:${port}`;
  let info;
  try {
    const res = await fetch(origin + '/api/admin/access-info', {signal: AbortSignal.timeout(4000)});
    if (!res.ok) throw new Error('HTTP ' + res.status);
    info = await res.json();
  } catch (e) {
    throw new Error('Cannot reach the updated storefront at ' + origin + '. Have the agent start the correct server and check its port. ' + e.message);
  }
  if (!Number.isInteger(info.version) || info.version < 3) throw new Error('Server has an older admin access API. Update/restart the actual project.');
  const appResponse = await fetch(origin + '/app.js', {signal: AbortSignal.timeout(4000)});
  if (!appResponse.ok || !(await appResponse.text()).includes('recoveryToken')) throw new Error('Updated browser recovery UI not served. Check public/app.js and restart the correct server.');
  const {openDatabase} = await import('../src/data.mjs');
  const {issueRecovery, owner} = await import('../src/admin-access.mjs');
  const db = openDatabase(dataDir);
  try {
    const username = owner(db);
    const token = issueRecovery(db);
    const check=await fetch(origin+'/api/admin/recovery-check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token}),signal:AbortSignal.timeout(4000)});
    if(!check.ok||!(await check.json()).valid) throw new Error('The running server did not recognize the recovery token. Verify server version and DATA_DIR; no recovery link will be displayed.');
    console.log('Database: ' + dbPath);
    console.log('Owner account: ' + (username || '(not yet created)'));
    console.log('Open this PRIVATE one-time link directly in your local browser (expires in 15 minutes):');
    console.log(origin + '/admin#recover=' + token);
    console.log('Enter your own email and password (8–150 characters). Never publish this link or password.');
  } finally { db.close(); }
}
main().catch(e => { console.error('Recovery failed: ' + e.message); process.exitCode = 1; });
