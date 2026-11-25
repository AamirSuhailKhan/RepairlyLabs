import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  CATEGORIES,
  DEFAULT_SETTINGS,
  getSettingsAsync,
  hashToken,
  openAppDatabase,
  passwordHash,
  randomToken,
  verifyPassword
} from '../src/data.mjs';
import { seoOrigin, structuredData } from '../src/seo.mjs';

const cookieName = 'repairlylabs_session';
const states = ['pending', 'confirmed', 'in_progress', 'ready', 'completed', 'cancelled'];
const orderTransitions = { pending: ['confirmed', 'cancelled'], confirmed: ['in_progress', 'ready', 'cancelled'], in_progress: ['ready', 'cancelled'], ready: ['completed', 'cancelled'], completed: [], cancelled: [] };

const CLOUD_EXTRA_SCHEMA_SQL = `
 CREATE TABLE IF NOT EXISTS admin_owner(id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL REFERENCES admins(username));
 CREATE TABLE IF NOT EXISTS admin_profiles(username TEXT PRIMARY KEY REFERENCES admins(username), email TEXT UNIQUE COLLATE NOCASE, disabled INTEGER NOT NULL DEFAULT 0, permission TEXT NOT NULL DEFAULT 'technician');
 CREATE TABLE IF NOT EXISTS admin_offline_codes(token_hash TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS admin_recovery(token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS booking_submissions(fingerprint TEXT PRIMARY KEY, ref TEXT NOT NULL, created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS booking_submission_time ON booking_submissions(created_at);
 CREATE TABLE IF NOT EXISTS request_keys(key_hash TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, ref TEXT NOT NULL, created_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS rl_reference_registry(ref TEXT PRIMARY KEY COLLATE NOCASE, reserved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS rl_jobs(ref TEXT PRIMARY KEY REFERENCES bookings(ref), token_hash TEXT, stage TEXT NOT NULL DEFAULT 'received', version INTEGER NOT NULL DEFAULT 0, items TEXT NOT NULL DEFAULT '[]', labor INTEGER NOT NULL DEFAULT 0, discount INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL DEFAULT 0, deposit INTEGER NOT NULL DEFAULT 0, tech TEXT NOT NULL DEFAULT '', diagnosis TEXT NOT NULL DEFAULT '', work TEXT NOT NULL DEFAULT '[]', warranty TEXT NOT NULL DEFAULT '', approved_at TEXT, invoice_at TEXT);
 CREATE TABLE IF NOT EXISTS rl_quotes(ref TEXT, version INTEGER, body TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(ref,version));
 CREATE TABLE IF NOT EXISTS rl_events(id INTEGER PRIMARY KEY, ref TEXT NOT NULL, stage TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS rl_payments(id INTEGER PRIMARY KEY, ref TEXT NOT NULL, receipt TEXT UNIQUE NOT NULL, order_id TEXT UNIQUE, payment_id TEXT UNIQUE, amount INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'creating', method TEXT NOT NULL DEFAULT 'razorpay', utr TEXT, verified_by TEXT, verified_at TEXT, review_note TEXT, updated_at TEXT, destination_version INTEGER, proof TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE UNIQUE INDEX IF NOT EXISTS rl_one_open ON rl_payments(ref) WHERE state IN ('creating','open','awaiting_verification','reconciliation_required');
 CREATE UNIQUE INDEX IF NOT EXISTS rl_payment_utr ON rl_payments(utr) WHERE utr IS NOT NULL AND state IN ('awaiting_verification','captured');
 CREATE TABLE IF NOT EXISTS rl_outbox(id INTEGER PRIMARY KEY, ref TEXT, event TEXT, channel TEXT, attempts INTEGER DEFAULT 0, next_at INTEGER DEFAULT 0, state TEXT DEFAULT 'pending', error TEXT DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS rl_seen(ref TEXT PRIMARY KEY, seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS rl_audit(id INTEGER PRIMARY KEY, ref TEXT, actor TEXT, action TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS rl_qr_settings(id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0, merchant TEXT NOT NULL DEFAULT '', upi TEXT NOT NULL DEFAULT '', image TEXT NOT NULL DEFAULT '', version INTEGER NOT NULL DEFAULT 0);
 INSERT OR IGNORE INTO rl_qr_settings(id) VALUES(1);
 CREATE TABLE IF NOT EXISTS rl_payment_adjustments(id INTEGER PRIMARY KEY, payment_row INTEGER NOT NULL REFERENCES rl_payments(id), amount INTEGER NOT NULL CHECK(amount>0), reference TEXT UNIQUE NOT NULL, actor TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS rl_stock_usage(ref TEXT NOT NULL, sku TEXT NOT NULL, quantity INTEGER NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(ref,sku));
 CREATE TABLE IF NOT EXISTS rl_quality(ref TEXT PRIMARY KEY REFERENCES rl_jobs(ref), checks TEXT NOT NULL, actor TEXT NOT NULL, checked_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS rl_parts_billing(ref TEXT PRIMARY KEY REFERENCES orders(ref), token_hash TEXT, required INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS rl_part_inquiries(
   id INTEGER PRIMARY KEY, ref TEXT NOT NULL UNIQUE, name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT NOT NULL DEFAULT '',
   whatsapp INTEGER NOT NULL DEFAULT 0, brand TEXT NOT NULL, model TEXT NOT NULL, variant TEXT NOT NULL DEFAULT '',
   colour TEXT NOT NULL DEFAULT '', category TEXT NOT NULL, description TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 1 CHECK(qty BETWEEN 1 AND 20),
   grade TEXT NOT NULL DEFAULT 'Any compatible option', method TEXT NOT NULL, locality TEXT NOT NULL,
   address TEXT NOT NULL DEFAULT '', pincode TEXT NOT NULL DEFAULT '', urgency TEXT NOT NULL DEFAULT 'Flexible',
   notes TEXT NOT NULL DEFAULT '', token_hash TEXT NOT NULL, key_hash TEXT UNIQUE, fingerprint TEXT NOT NULL,
   status TEXT NOT NULL DEFAULT 'received', availability TEXT NOT NULL DEFAULT 'checking',
   price_paise INTEGER, delivery_paise INTEGER NOT NULL DEFAULT 0, eta TEXT NOT NULL DEFAULT '',
   quote_note TEXT NOT NULL DEFAULT '', quote_valid_until TEXT NOT NULL DEFAULT '',
   read_at TEXT, replied_by TEXT, replied_at TEXT, customer_decision_at TEXT,
   city TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT '',
   consent_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 CREATE TABLE IF NOT EXISTS rl_part_inquiry_events(id INTEGER PRIMARY KEY, ref TEXT NOT NULL REFERENCES rl_part_inquiries(ref), actor TEXT NOT NULL, action TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS rl_part_inquiry_photos(ref TEXT PRIMARY KEY REFERENCES rl_part_inquiries(ref), image_data TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS admin_verified_recovery(username TEXT PRIMARY KEY, email TEXT NOT NULL, verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS admin_email_links(token_hash TEXT PRIMARY KEY, username TEXT NOT NULL, email TEXT NOT NULL, purpose TEXT NOT NULL, password_version TEXT NOT NULL, expires_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS admin_email_cooldown(username TEXT NOT NULL, purpose TEXT NOT NULL, until INTEGER NOT NULL, PRIMARY KEY(username,purpose));
`;

const headers = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin'
};

const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const err = (status, message) => { const e = new Error(message); e.status = status; throw e; };
const str = (x, max = 200) => String(x ?? '').trim().slice(0, max);
const required = (x, name, max = 200) => { const v = str(x, max); if (!v) err(400, `${name} is required.`); return v; };
const digest = v => createHash('sha256').update(v).digest('hex');
const norm = s => typeof s === 'string' ? s.trim().toLowerCase() : '';
const validLogin = s => typeof s === 'string' && s.length <= 120 && (/^[a-z0-9_.-]{3,40}$/.test(s) || /^[a-z0-9._+%-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(s));
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function phoneNorm(v) {
  const n = String(v ?? '').replace(/[\s()+-]/g, '').replace(/^91(?=\d{10}$)/, '');
  if (!/^[6-9]\d{9}$/.test(n)) err(400, 'Enter a valid 10-digit Indian mobile number.');
  return n;
}

function integer(v, min, max, name) {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < min || n > max) err(400, `Invalid ${name}.`);
  return n;
}

function respond(res, status, payload, more = {}) {
  const isText = typeof payload === 'string';
  const body = isText ? payload : JSON.stringify(payload);
  res.writeHead(status, {
    ...headers,
    'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...more
  });
  res.end(body);
}

const ok = (res, body, status = 200) => respond(res, status, body);

async function bodyJson(req) {
  if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) return req.body;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 750000) err(413, 'Request too large.');
    chunks.push(c);
  }
  const all = Buffer.concat(chunks).toString('utf8');
  try {
    const data = JSON.parse(all || '{}');
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw 0;
    return data;
  } catch {
    err(400, 'Invalid JSON.');
  }
}

function checkOrigin(req, env = process.env) {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
  const origin = req.headers.origin;
  if (!origin) return;
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim().toLowerCase() === 'http' ? 'http' : 'https';
  const host = String(req.headers.host || '');
  if (!env.PUBLIC_ORIGIN && (!host || /[\s@/?#]/.test(host))) err(403, 'Invalid origin.');
  let expected;
  try {
    const u = new URL(env.PUBLIC_ORIGIN || `${proto}://${host}`);
    if (u.username || u.password) throw 0;
    expected = u.origin;
  } catch {
    err(403, 'Invalid origin.');
  }
  if (origin !== expected) err(403, 'Cross-site requests are blocked.');
}

const rateBuckets = new Map();
function limit(req, group, max, windowMs) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  const key = `${group}:${ip}`;
  const now = Date.now();
  let item = rateBuckets.get(key);
  if (!item || now >= item.reset) {
    if (rateBuckets.size >= 4000) rateBuckets.clear();
    item = { count: 0, reset: now + windowMs };
    rateBuckets.set(key, item);
  }
  if (++item.count > max) err(429, 'Too many requests. Please try again later.');
}

function cookie(req) {
  const s = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='));
  return s?.slice(cookieName.length + 1) || '';
}

export function createCloudApp({ env = process.env, dbOverride = null } = {}) {
  let initPromise = null;

  async function getDb() {
    if (!initPromise) {
      initPromise = (async () => {
        const db = dbOverride || await openAppDatabase({ env });
        let m3 = null;
        try { m3 = await db.get('SELECT 1 AS ok FROM schema_migrations WHERE version=3'); } catch {}
        if (!m3) {
          await db.exec(CLOUD_EXTRA_SCHEMA_SQL);
          await db.run('INSERT OR IGNORE INTO schema_migrations(version,name) VALUES(?,?)', 3, 'cloud_full_schema');
        }
        await ensureEnvOwner(db);
        return db;
      })().catch(e => { initPromise = null; throw e; });
    }
    return initPromise;
  }

  async function owner(db) {
    let o = await db.get('SELECT username FROM admin_owner WHERE id=1');
    if (!o) {
      const a = await db.get("SELECT username FROM admins ORDER BY CASE WHEN username='owner' THEN 0 ELSE 1 END,created_at,username LIMIT 1");
      if (a) {
        await db.run('INSERT OR IGNORE INTO admin_owner(id,username) VALUES(1,?)', a.username);
        o = await db.get('SELECT username FROM admin_owner WHERE id=1');
      }
    }
    return o?.username || null;
  }

  async function profile(db, username) {
    const p = await db.get('SELECT email,disabled,permission FROM admin_profiles WHERE username=?', username);
    const isOwner = (await owner(db)) === username;
    return {
      username,
      email: p?.email || '',
      role: isOwner ? 'owner' : 'team',
      disabled: !!p?.disabled,
      permission: isOwner ? 'owner' : p?.permission || 'technician'
    };
  }

  async function findAccount(db, login) {
    return db.get('SELECT a.*,COALESCE(p.disabled,0) disabled FROM admins a LEFT JOIN admin_profiles p ON a.username=p.username WHERE a.username=? COLLATE NOCASE OR p.email=? COLLATE NOCASE LIMIT 1', login, login);
  }

  async function setEmail(db, username, email) {
    if (email) {
      const existing = await findAccount(db, email);
      if (existing && existing.username !== username) err(409, 'That email or username is already assigned.');
    }
    await db.run('INSERT INTO admin_profiles(username,email) VALUES(?,?) ON CONFLICT(username) DO UPDATE SET email=excluded.email', username, email);
  }

  async function ensureEnvOwner(db) {
    const email = norm(env.OWNER_EMAIL || env.RL_OWNER_EMAIL || '');
    const pass = String(env.OWNER_PASSWORD || '');
    if (!email || !pass || pass.length < 8 || pass.length > 150 || !validLogin(email) || !email.includes('@')) return;
    await db.tx(async () => {
      const currentOwner = await owner(db);
      if (!currentOwner) {
        const username = 'owner';
        await db.run('INSERT INTO admins(username,password_hash) VALUES(?,?)', username, passwordHash(pass));
        await db.run('INSERT INTO admin_owner(id,username) VALUES(1,?)', username);
        await setEmail(db, username, email);
        await db.run('INSERT INTO audit(username,action,details) VALUES(?,?,?)', username, 'owner_env_bootstrap', email);
        return;
      }
      const p = await profile(db, currentOwner);
      const acc = await findAccount(db, currentOwner);
      if (!p.email && acc && verifyPassword(pass, acc.password_hash)) {
        await setEmail(db, currentOwner, email);
      }
    });
  }

  async function session(db, req) {
    const token = cookie(req);
    if (!/^[\w-]{40,120}$/.test(token)) return null;
    const row = await db.get('SELECT username,csrf,expires_at FROM sessions WHERE token_hash=?', hashToken(token));
    if (!row || row.expires_at < Date.now()) return null;
    const p = await profile(db, row.username);
    if (p.disabled) return null;
    return { ...row, ...p };
  }

  async function auth(db, req) {
    const s = await session(db, req);
    if (!s) err(401, 'Please sign in.');
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !safeEqual(String(req.headers['x-csrf-token'] || ''), s.csrf)) {
      err(403, 'Session verification failed. Refresh the page.');
    }
    return s;
  }

  async function recoveryValid(db, token) {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    const h = hashToken(token);
    if (env.OWNER_RECOVERY_TOKEN && safeEqual(token, env.OWNER_RECOVERY_TOKEN)) return true;
    return !!((await db.get('SELECT 1 FROM admin_recovery WHERE token_hash=? AND expires_at>?', h, Date.now())) ||
      (await db.get('SELECT 1 FROM admin_offline_codes WHERE token_hash=?', h)));
  }

  async function allocateRef(db, prefix) {
    const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: '2-digit', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
    const part = t => date.find(x => x.type === t).value;
    for (let i = 0; i < 64; i++) {
      const suffix = randomBytes(4).toString('hex').toUpperCase();
      const ref = `${prefix}-${part('year')}${part('month')}${part('day')}-${suffix}`;
      if ((await db.run('INSERT OR IGNORE INTO rl_reference_registry(ref) VALUES(?)', ref)).changes === 1) return ref;
    }
    err(503, 'Could not allocate reference; please retry.');
  }

  async function siteConfig(db) {
    const settings = await getSettingsAsync(db);
    const brands = await db.all('SELECT brand,COUNT(*) AS models FROM devices GROUP BY brand COLLATE NOCASE ORDER BY brand COLLATE NOCASE');
    const services = await db.all('SELECT * FROM services WHERE active=1 ORDER BY sort_order,id');
    return { settings, brands, services, categories: CATEGORIES };
  }

  async function handleApi(db, req, res, url) {
    const { pathname } = url;
    const method = req.method;

    if (pathname === '/api/ready' && method === 'GET') {
      await db.get('SELECT 1 AS ok');
      return ok(res, { ok: true, mode: 'turso' });
    }
    if (pathname === '/api/health' && method === 'GET') {
      return ok(res, { ok: true, app: 'RepairlyLabs', mode: 'turso', time: new Date().toISOString() });
    }
    if (pathname === '/api/config' && method === 'GET') {
      return ok(res, await siteConfig(db));
    }
    if (pathname === '/api/models' && method === 'GET') {
      const brand = str(url.searchParams.get('brand'), 100);
      const q = str(url.searchParams.get('q'), 100);
      let sql = 'SELECT id,brand,model FROM devices WHERE 1=1';
      const params = [];
      if (brand) { sql += ' AND brand=? COLLATE NOCASE'; params.push(brand); }
      if (q) { sql += ' AND (model LIKE ? OR brand LIKE ?)'; params.push('%' + q + '%', '%' + q + '%'); }
      sql += ' ORDER BY brand COLLATE NOCASE,model LIMIT 450';
      return ok(res, await db.all(sql, ...params));
    }

    if (pathname === '/api/bookings' && method === 'POST') {
      limit(req, 'booking', 12, 3600000);
      const b = await bodyJson(req);
      if (b.website) return ok(res, { received: true });
      if (![true, 'on', '1'].includes(b.consent)) err(400, 'Please agree to the privacy notice before submitting.');
      const consentAt = new Date().toISOString();
      const name = required(b.name, 'Name', 100);
      const phone = phoneNorm(b.phone);
      const brand = required(b.brand, 'Brand', 80);
      const model = required(b.model, 'Model', 120);
      const issue = required(b.issue, 'Repair issue', 120);
      const methodVal = required(b.method, 'Service method', 40);
      if (!['Visit workshop', 'Request pickup', 'Discuss options'].includes(methodVal)) err(400, 'Invalid appointment method.');
      const settings = await getSettingsAsync(db);
      if (methodVal === 'Request pickup' && settings.pickup_enabled !== '1') err(400, 'Pickup requests are not available right now.');
      const date = str(b.date, 20);
      if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + 'T00:00:00Z')) || new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) !== date)) err(400, 'Invalid date.');
      const locality = required(b.locality, 'Area/locality', 100);
      const address = str(b.address, 260);
      if (methodVal === 'Request pickup' && !address) err(400, 'Full address is required for pickup.');
      const notes = str(b.notes, 800);
      const email = str(b.email, 180), pin = str(b.pin, 6), slot = str(b.slot, 30);
      const whatsapp = b.whatsapp === true || b.whatsapp === 'on' ? 1 : 0;
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err(400, 'Invalid email.');
      if (pin && !/^[1-9]\d{5}$/.test(pin)) err(400, 'Enter a valid 6-digit PIN code.');
      if (slot && !['Morning', 'Afternoon', 'Evening'].includes(slot)) err(400, 'Invalid appointment time preference.');

      const key = b.request_key === undefined ? null : (/^[a-f0-9]{64}$/.test(String(b.request_key)) ? digest(b.request_key) : err(400, 'Invalid request identifier.'));
      const fingerprint = digest(JSON.stringify(['booking', name, phone, brand, model, issue, methodVal, date, locality, address, notes, email, pin, slot, whatsapp]));
      const ref = await allocateRef(db, 'RLM');
      const access = randomToken(32);

      const replay = await db.tx(async () => {
        if (key) {
          const old = await db.get('SELECT * FROM request_keys WHERE key_hash=?', key);
          if (old) {
            if (old.fingerprint !== fingerprint) err(409, 'This submission identifier was already used for different details. Start a new request.');
            return { ref: old.ref, status: 'pending', message: 'Your earlier request was already saved.' };
          }
        }
        const prev = await db.get('SELECT ref FROM booking_submissions WHERE fingerprint=? AND created_at>?', fingerprint, Date.now() - 120000);
        if (prev) err(409, 'An identical repair request was recently received. Check your original confirmation or contact the repair team.');
        await db.run(
          'INSERT INTO bookings(ref,name,phone,brand,model,issue,method,date,locality,address,notes,consent_at,email,pin,slot,whatsapp) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
          ref, name, phone, brand, model, issue, methodVal, date, locality, address, notes, consentAt, email, pin, slot, whatsapp
        );
        await db.run('INSERT OR IGNORE INTO rl_jobs(ref,token_hash) VALUES(?,?)', ref, hashToken(access));
        await db.run('INSERT INTO rl_events(ref,stage) VALUES(?,?)', ref, 'received');
        if (key) await db.run('INSERT INTO request_keys(key_hash,fingerprint,ref,created_at) VALUES(?,?,?,?)', key, fingerprint, ref, Date.now());
        await db.run('DELETE FROM booking_submissions WHERE created_at<?', Date.now() - 120000);
        await db.run('INSERT INTO booking_submissions(fingerprint,ref,created_at) VALUES(?,?,?)', fingerprint, ref, Date.now());
        return null;
      });
      if (replay) return ok(res, replay, 200);
      return ok(res, { ref, repair_access: access, status: 'pending', message: 'Repair request saved. Keep your reference ID to check status.' }, 201);
    }

    if (pathname === '/api/contact' && method === 'POST') {
      limit(req, 'contact', 8, 3600000);
      const b = await bodyJson(req);
      if (b.website) return ok(res, { received: true });
      if (![true, 'on', '1'].includes(b.consent)) err(400, 'Please agree to the privacy notice before submitting.');
      const name = required(b.name, 'Name', 100), phone = phoneNorm(b.phone), email = str(b.email, 180), message = required(b.message, 'Message', 1400);
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err(400, 'Invalid email.');
      await db.run('INSERT INTO contacts(name,phone,email,message,consent_at) VALUES(?,?,?,?,?)', name, phone, email, message, new Date().toISOString());
      return ok(res, { received: true, message: 'Message saved. The team can review it in the dashboard.' }, 201);
    }

    if (pathname === '/api/track' && method === 'GET') {
      limit(req, 'track', 30, 3600000);
      const p = phoneNorm(url.searchParams.get('phone'));
      const r = str(url.searchParams.get('ref'), 50).toUpperCase();
      if (!/^(RLM|RLP|KM|KP)-\d{6}-[0-9A-F]{8}$/.test(r)) err(400, 'Please enter a valid reference ID.');
      if (r.startsWith('RLM-') || r.startsWith('KM-')) {
        const b = await db.get('SELECT ref,name,brand,model,issue,method,date,locality,status,quote,created_at,updated_at FROM bookings WHERE ref=? AND phone=?', r, p);
        if (!b) err(404, 'No request found with that reference and phone number.');
        return ok(res, { type: 'repair', record: b });
      }
      const o = await db.get('SELECT ref,name,mode,locality,status,subtotal,created_at,updated_at FROM orders WHERE ref=? AND phone=?', r, p);
      if (!o) err(404, 'No request found with that reference and phone number.');
      const items = await db.all('SELECT name,quantity,unit_price FROM order_items WHERE order_id=(SELECT id FROM orders WHERE ref=?)', r);
      return ok(res, { type: 'order', record: o, items });
    }

    if (pathname.startsWith('/api/part-inquiries')) {
      return handlePartInquiries(db, req, res, url, { auth, limit });
    }

    if (pathname === '/api/admin/access-info' && method === 'GET') return ok(res, { version: 3 });

    if (pathname === '/api/admin/recovery-check' && method === 'POST') {
      limit(req, 'recovery-check', 8, 900000);
      const b = await bodyJson(req);
      if (!(await recoveryValid(db, b.token))) err(403, 'Recovery link invalid or expired.');
      return ok(res, { valid: true });
    }

    if (pathname === '/api/admin/recover' && method === 'POST') {
      limit(req, 'recover', 8, 900000);
      const b = await bodyJson(req);
      if (!(await recoveryValid(db, b.token))) err(403, 'Recovery link invalid or expired.');
      const pass = String(b.password || '');
      if (pass.length < 8 || pass.length > 150) err(400, 'Choose a password of 8–150 characters.');
      const email = norm(b.email || '');
      if (email && (!validLogin(email) || !email.includes('@'))) err(400, 'Enter a valid email address.');
      const resAcc = await db.tx(async () => {
        let username = await owner(db);
        if (!username) {
          username = norm(b.username) || 'owner';
          if (!validLogin(username)) err(400, 'Enter a valid username or email.');
          await db.run('INSERT INTO admins(username,password_hash) VALUES(?,?)', username, passwordHash(pass));
          await db.run('INSERT INTO admin_owner(id,username) VALUES(1,?)', username);
        } else {
          await db.run('UPDATE admins SET password_hash=? WHERE username=?', passwordHash(pass), username);
        }
        if (email) await setEmail(db, username, email);
        await db.run('UPDATE admin_profiles SET disabled=0 WHERE username=?', username);
        await db.run('DELETE FROM sessions WHERE username=?', username);
        await db.exec('DELETE FROM admin_recovery; DELETE FROM admin_offline_codes;');
        await db.run('INSERT INTO audit(username,action,details) VALUES(?,?,?)', username, 'owner_recovery', 'Authorized recovery');
        return { username, email: (await profile(db, username)).email };
      });
      return ok(res, resAcc);
    }

    if (pathname === '/api/admin/login' && method === 'POST') {
      limit(req, 'login', 12, 900000);
      const b = await bodyJson(req);
      const login = str(b.username, 120).toLowerCase();
      const pass = String(b.password || '');
      const account = await findAccount(db, login);
      if (!account) {
        if (!(await owner(db))) {
          err(401, 'No owner account is set up yet. Add OWNER_EMAIL and OWNER_PASSWORD in Vercel Environment Variables and redeploy.');
        }
        err(401, 'Incorrect username or password.');
      }
      if (account.disabled || pass.length > 150 || !verifyPassword(pass, account.password_hash)) {
        err(401, 'Incorrect username or password.');
      }
      const username = account.username;
      const token = randomToken(), csrf = randomToken(24), expiration = Date.now() + 7 * 24 * 60 * 60 * 1000;
      await db.run('DELETE FROM sessions WHERE expires_at<?', Date.now());
      await db.run('INSERT INTO sessions(token_hash,username,csrf,expires_at) VALUES(?,?,?,?)', hashToken(token), username, csrf, expiration);
      const setCookie = `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=604800`;
      await db.run('INSERT INTO audit(username,action,details) VALUES(?,?,?)', username, 'sign_in', login);
      return respond(res, 200, { ...(await profile(db, username)), csrf }, { 'Set-Cookie': setCookie });
    }

    if (pathname === '/api/admin/me' && method === 'GET') {
      const s = await auth(db, req);
      return ok(res, { username: s.username, email: s.email, role: s.role, disabled: s.disabled, permission: s.permission, csrf: s.csrf });
    }

    if (pathname.startsWith('/api/admin/')) {
      const s = await auth(db, req);
      const adminBody = async () => { const b = await bodyJson(req); await auth(db, req); return b; };
      if (s.role !== 'owner') {
        const ownRoutes = ['/api/admin/email', '/api/admin/password', '/api/admin/logout', '/api/admin/sessions'];
        const managerRoutes = /^\/api\/admin\/(overview|bookings|orders|contacts|products|models|services)(?:\/.*)?$/;
        if (!ownRoutes.includes(pathname) && !(s.permission === 'manager' && managerRoutes.test(pathname))) {
          err(403, 'This operation requires owner or assigned manager permission.');
        }
      }

      if (pathname === '/api/admin/logout' && method === 'POST') {
        await db.run('DELETE FROM sessions WHERE token_hash=?', hashToken(cookie(req)));
        return respond(res, 200, { ok: true }, { 'Set-Cookie': `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Secure; Max-Age=0` });
      }
      if (pathname === '/api/admin/overview' && method === 'GET') {
        return ok(res, {
          bookings: (await db.get('SELECT COUNT(*) n FROM bookings')).n,
          pendingBookings: (await db.get("SELECT COUNT(*) n FROM bookings WHERE status='pending'")).n,
          orders: (await db.get('SELECT COUNT(*) n FROM orders')).n,
          pendingOrders: (await db.get("SELECT COUNT(*) n FROM orders WHERE status='pending'")).n,
          unreadMessages: (await db.get('SELECT COUNT(*) n FROM contacts WHERE read=0')).n,
          listedParts: (await db.get('SELECT COUNT(*) n FROM products WHERE active=1')).n,
          lowStock: (await db.get('SELECT COUNT(*) n FROM products WHERE stock<=3 AND active=1')).n,
          recentBookings: await db.all('SELECT id,ref,name,model,status,created_at FROM bookings ORDER BY id DESC LIMIT 5'),
          recentOrders: await db.all('SELECT id,ref,name,subtotal,status,created_at FROM orders ORDER BY id DESC LIMIT 5')
        });
      }
      if (pathname === '/api/admin/bookings' && method === 'GET') return ok(res, await db.all('SELECT * FROM bookings ORDER BY id DESC LIMIT 500'));
      if (pathname === '/api/admin/orders' && method === 'GET') {
        const orders = await db.all('SELECT * FROM orders ORDER BY id DESC LIMIT 500');
        for (const o of orders) o.items = await db.all('SELECT * FROM order_items WHERE order_id=?', o.id);
        return ok(res, orders);
      }
      if (pathname === '/api/admin/contacts' && method === 'GET') return ok(res, await db.all('SELECT * FROM contacts ORDER BY id DESC LIMIT 500'));
      if (pathname === '/api/admin/services' && method === 'GET') return ok(res, await db.all('SELECT * FROM services ORDER BY sort_order,id'));
      if (pathname === '/api/admin/models' && method === 'GET') return ok(res, await db.all('SELECT * FROM devices ORDER BY brand,model'));
      if (pathname === '/api/admin/settings' && method === 'GET') return ok(res, await getSettingsAsync(db));
      if (pathname === '/api/admin/sessions' && method === 'GET') {
        return ok(res, await db.all('SELECT created_at,expires_at,token_hash=? current FROM sessions WHERE username=? AND expires_at>? ORDER BY created_at DESC', hashToken(cookie(req)), s.username, Date.now()));
      }
      if (pathname === '/api/admin/sessions' && method === 'POST') {
        const b = await adminBody();
        const acc = await findAccount(db, s.username);
        if (typeof b.current !== 'string' || !verifyPassword(b.current, acc.password_hash)) err(403, 'Current password required.');
        await db.run('DELETE FROM sessions WHERE username=? AND token_hash<>?', s.username, hashToken(cookie(req)));
        return ok(res, { ok: true });
      }
      if (pathname === '/api/admin/audit-log' && method === 'GET') {
        const offset = Math.max(0, Math.trunc(Number(url.searchParams.get('offset')) || 0));
        return ok(res, { items: await db.all('SELECT username actor,action,details ref,created_at FROM audit UNION ALL SELECT actor,action,ref,created_at FROM rl_audit ORDER BY created_at DESC LIMIT 100 OFFSET ?', offset), offset });
      }
      if (pathname === '/api/admin/email-recovery' && method === 'GET') {
        return ok(res, { configured: false, email: s.email, verified: false, verified_at: null });
      }
      if (pathname === '/api/admin/recovery-codes' && method === 'POST') {
        const b = await adminBody();
        const acc = await findAccount(db, s.username);
        if (s.role !== 'owner' || !verifyPassword(String(b.current || ''), acc.password_hash)) err(403, 'Owner password required.');
        const codes = Array.from({ length: 5 }, () => randomToken(32));
        await db.tx(async () => {
          await db.exec('DELETE FROM admin_offline_codes');
          for (const c of codes) await db.run('INSERT INTO admin_offline_codes(token_hash,created_at) VALUES(?,?)', hashToken(c), Date.now());
          await db.run('INSERT INTO audit(username,action) VALUES(?,?)', s.username, 'offline_codes_rotated');
        });
        return ok(res, { codes });
      }
      if (pathname === '/api/admin/team' && method === 'GET') {
        if (s.role !== 'owner') err(403, 'Only the owner can manage team accounts.');
        const rows = await db.all('SELECT username,created_at FROM admins ORDER BY username');
        const result = [];
        for (const r of rows) result.push({ ...r, ...(await profile(db, r.username)) });
        return ok(res, result);
      }
      if (pathname === '/api/admin/team' && method === 'POST') {
        if (s.role !== 'owner') err(403, 'Only the owner can manage team accounts.');
        const b = await adminBody();
        const acc = await findAccount(db, s.username);
        if (typeof b.current !== 'string' || !verifyPassword(b.current, acc.password_hash)) err(403, 'Your current owner password is incorrect.');
        const username = norm(b.username);
        if (!validLogin(username)) err(400, 'Enter a valid username or email.');
        await db.tx(async () => {
          if (b.action === 'create') {
            if (await findAccount(db, username)) err(409, 'Username or email already exists.');
            const pass = String(b.password || '');
            if (pass.length < 8 || pass.length > 150) err(400, 'Choose a password of 8–150 characters.');
            const email = norm(b.email || '');
            if (email && (!validLogin(email) || !email.includes('@'))) err(400, 'Enter a valid email address.');
            const permission = b.permission || 'technician';
            if (!['manager', 'technician', 'accountant'].includes(permission)) err(400, 'Invalid team permission.');
            await db.run('INSERT INTO admins(username,password_hash) VALUES(?,?)', username, passwordHash(pass));
            await setEmail(db, username, email || null);
            await db.run('UPDATE admin_profiles SET permission=? WHERE username=?', permission, username);
          } else {
            const target = await findAccount(db, username);
            if (!target || target.username === s.username) err(400, 'Choose a team account, not the owner.');
            if (b.action === 'permission') {
              if (!['manager', 'technician', 'accountant'].includes(b.permission)) err(400, 'Invalid team permission.');
              await db.run('INSERT INTO admin_profiles(username,permission) VALUES(?,?) ON CONFLICT(username) DO UPDATE SET permission=excluded.permission', target.username, b.permission);
            } else if (b.action === 'reset') {
              const pass = String(b.password || '');
              if (pass.length < 8 || pass.length > 150) err(400, 'Choose a password of 8–150 characters.');
              await db.run('UPDATE admins SET password_hash=? WHERE username=?', passwordHash(pass), target.username);
            } else if (['disable', 'enable'].includes(b.action)) {
              await db.run('INSERT INTO admin_profiles(username,disabled) VALUES(?,?) ON CONFLICT(username) DO UPDATE SET disabled=excluded.disabled', target.username, b.action === 'disable' ? 1 : 0);
            } else err(400, 'Invalid team action.');
            await db.run('DELETE FROM sessions WHERE username=?', target.username);
          }
          await db.run('INSERT INTO audit(username,action,details) VALUES(?,?,?)', s.username, 'team_' + b.action, username);
        });
        return ok(res, { ok: true });
      }
      if (pathname === '/api/admin/email' && method === 'PATCH') {
        const b = await adminBody();
        const acc = await findAccount(db, s.username);
        if (typeof b.current !== 'string' || !verifyPassword(b.current, acc.password_hash)) err(403, 'Current password is incorrect.');
        const email = norm(b.email || '');
        if (email && (!validLogin(email) || !email.includes('@'))) err(400, 'Enter a valid email address.');
        await db.tx(async () => {
          await setEmail(db, s.username, email || null);
          await db.run('INSERT INTO audit(username,action) VALUES(?,?)', s.username, 'login_email_updated');
        });
        return ok(res, await profile(db, s.username));
      }
      if (pathname === '/api/admin/password' && method === 'PATCH') {
        const b = await adminBody();
        const acc = await findAccount(db, s.username);
        if (typeof b.current !== 'string' || !verifyPassword(b.current, acc.password_hash)) err(403, 'Current password is incorrect.');
        if (typeof b.next !== 'string' || b.next.length < 8 || b.next.length > 150) err(400, 'New password must contain at least 8 characters.');
        await db.run('UPDATE admins SET password_hash=? WHERE username=?', passwordHash(b.next), s.username);
        await db.run('DELETE FROM sessions WHERE username=? AND token_hash<>?', s.username, hashToken(cookie(req)));
        await db.run('INSERT INTO audit(username,action) VALUES(?,?)', s.username, 'password_change');
        return ok(res, { ok: true });
      }
      if (pathname === '/api/admin/settings' && method === 'PATCH') {
        const b = await adminBody();
        const allowedKeys = ['business_name', 'tagline', 'city', 'phone', 'whatsapp', 'email', 'address', 'hours', 'instagram', 'map_url', 'pickup_enabled', 'delivery_enabled', 'announcement', 'terms', 'warranty', 'privacy_contact'];
        for (const k of allowedKeys) {
          if (Object.hasOwn(b, k)) {
            let v = str(b[k], ['terms', 'warranty', 'privacy_contact'].includes(k) ? 1500 : 350);
            if (k.endsWith('_enabled')) v = v === '1' ? '1' : '0';
            await db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, v);
          }
        }
        await db.run('INSERT INTO audit(username,action) VALUES(?,?)', s.username, 'settings_update');
        return ok(res, { ok: true });
      }
      if (/^\/api\/admin\/contacts\/\d+$/.test(pathname) && method === 'PATCH') {
        const id = Number(pathname.split('/').at(-1)), b = await adminBody();
        if (!(await db.run('UPDATE contacts SET read=? WHERE id=?', b.read ? 1 : 0, id)).changes) err(404, 'Contact not found.');
        return ok(res, { ok: true });
      }
      if (/^\/api\/admin\/contacts\/\d+$/.test(pathname) && method === 'DELETE') {
        const id = Number(pathname.split('/').at(-1));
        if (!(await db.run('DELETE FROM contacts WHERE id=?', id)).changes) err(404, 'Contact not found.');
        await db.run('INSERT INTO audit(username,action,details) VALUES(?,?,?)', s.username, 'contact_delete', String(id));
        return ok(res, { ok: true });
      }
      if (pathname === '/api/admin/services' && method === 'POST') {
        const b = await adminBody(), slug = required(b.slug, 'Slug', 50).toLowerCase().replace(/[^a-z0-9-]/g, '-');
        const vals = [slug, required(b.title, 'Title', 110), required(b.description, 'Description', 400), str(b.icon, 40) || 'wrench', str(b.tag, 60), b.active ? 1 : 0, integer(b.sort_order ?? 0, 0, 999, 'sort order')];
        if (b.id) await db.run('UPDATE services SET slug=?,title=?,description=?,icon=?,tag=?,active=?,sort_order=? WHERE id=?', ...vals, integer(b.id, 1, 100000, 'service id'));
        else await db.run('INSERT INTO services(slug,title,description,icon,tag,active,sort_order) VALUES(?,?,?,?,?,?,?)', ...vals);
        await db.run('INSERT INTO audit(username,action,details) VALUES(?,?,?)', s.username, 'service_save', slug);
        return ok(res, { ok: true });
      }
      if (pathname === '/api/admin/models/bulk' && method === 'POST') {
        const b = await adminBody();
        if (!Array.isArray(b.models) || b.models.length > 1000) err(400, 'Provide a models array with at most 1,000 rows.');
        const rows = b.models.map(v => { if (!v || typeof v !== 'object' || Array.isArray(v)) err(400, 'Invalid model row.'); return [required(v.brand, 'Brand', 80), required(v.model, 'Model', 120)]; });
        let added = 0;
        await db.tx(async () => {
          for (const row of rows) added += (await db.run('INSERT OR IGNORE INTO devices(brand,model) VALUES(?,?)', ...row)).changes;
        });
        await db.run('INSERT INTO audit(username,action,details) VALUES(?,?,?)', s.username, 'models_import', String(added));
        return ok(res, { added });
      }
      if (pathname === '/api/admin/export' && method === 'GET') {
        const type = url.searchParams.get('type');
        const queries = { bookings: 'SELECT * FROM bookings ORDER BY id DESC', orders: 'SELECT * FROM orders ORDER BY id DESC', contacts: 'SELECT * FROM contacts ORDER BY id DESC', products: 'SELECT * FROM products ORDER BY id DESC' };
        if (!Object.hasOwn(queries, type)) err(400, 'Unknown export.');
        const rows = await db.all(queries[type]);
        let fields = rows.length ? Object.keys(rows[0]) : (await db.all(`PRAGMA table_info(${type})`)).map(c => c.name);
        const cell = v => { let x = String(v ?? ''); if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; return '"' + x.replaceAll('"', '""') + '"'; };
        return respond(res, 200, [fields.map(cell).join(','), ...rows.map(r => fields.map(k => cell(r[k])).join(','))].join('\r\n'), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="repairlylabs-${type}.csv"` });
      }
      err(404, 'Admin endpoint not found.');
    }

    if (pathname.startsWith('/api/repair-center/')) {
      return handleRepairCenterCloud(db, req, res, url, { auth });
    }

    err(404, 'API endpoint not found.');
  }

  return async function handleRequest(req, res) {
    try {
      checkOrigin(req, env);
      const url = new URL(req.url, 'http://localhost');
      const db = await getDb();
      if (url.pathname.startsWith('/api/')) {
        await handleApi(db, req, res, url);
        return;
      }
      const canonical = seoOrigin(env);
      if (url.pathname === '/robots.txt') {
        const robots = 'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /repair-center\nDisallow: /parts-payment\nDisallow: /part-request?admin\nDisallow: /account-recovery\nDisallow: /operations\nDisallow: /track\n' + (canonical ? 'Sitemap: ' + canonical + '/sitemap.xml\n' : '');
        res.writeHead(200, { ...headers, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(req.method === 'HEAD' ? undefined : robots);
      }
      if (url.pathname === '/sitemap.xml') {
        if (!canonical) err(404, 'Set PUBLIC_ORIGIN to your HTTPS domain to publish the sitemap.');
        const slugs = await db.all('SELECT slug FROM services WHERE active=1 ORDER BY sort_order,id');
        const routes = ['/', '/repairs', '/parts', '/about', '/contact', '/privacy', '/terms', ...slugs.map(r => '/service/' + encodeURIComponent(r.slug)), '/part-request/'];
        const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' + routes.map(r => '<url><loc>' + esc(canonical + r) + '</loc></url>').join('') + '</urlset>';
        res.writeHead(200, { ...headers, 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(req.method === 'HEAD' ? undefined : xml);
      }
      if (url.pathname.startsWith('/service/')) {
        const slug = url.pathname.slice('/service/'.length);
        const row = await db.get('SELECT title,description FROM services WHERE slug=? AND active=1', slug);
        if (!row) err(404, 'Listing not found.');
        const settings = await getSettingsAsync(db);
        const title = row.title + ' in ' + (settings.city || 'Varanasi');
        const name = settings.business_name || 'RepairlyLabs';
        const html = `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title + ' | ' + name)}</title><meta name="description" content="${esc(row.description)}">${canonical ? `<link rel="canonical" href="${esc(canonical + url.pathname)}">` : ''}${structuredData(settings, canonical)}<link rel="stylesheet" href="/styles.css"></head><body><main class="container" style="max-width:850px;padding:45px 20px"><nav><a href="/">${esc(name)}</a></nav><section class="form-panel" style="margin-top:30px"><h1>${esc(title)}</h1><p>${esc(row.description)}</p><a class="btn btn-primary" href="/repairs">Request this repair</a></section></main></body></html>`;
        res.writeHead(200, { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        return res.end(req.method === 'HEAD' ? undefined : html);
      }
      err(404, 'Not found.');
    } catch (e) {
      if (!e.status) console.error('[cloud-request]', e);
      respond(res, e.status || 500, { error: e.status ? e.message : 'An unexpected server error occurred.' });
    }
  };
}

async function handlePartInquiries(db, req, res, url, { auth }) {
  const path = url.pathname.replace('/api/part-inquiries', ''), method = req.method;
  const trim = (v, max = 200) => typeof v === 'string' ? v.trim().slice(0, max) : '';
  const needed = (v, name, max = 200) => { const a = trim(v, max); if (!a) err(400, `${name} is required.`); return a; };
  const keyToken = (key, ref) => createHash('sha256').update('repairlylabs:part-request:' + key + ':' + ref).digest('base64url');
  const safeRef = r => { const x = trim(r, 64).toUpperCase(); if (!/^RLI-\d{6}-[0-9A-F]{16}$/.test(x)) err(400, 'Invalid request reference.'); return x; };
  const view = r => ({ ref: r.ref, brand: r.brand, model: r.model, variant: r.variant, colour: r.colour, category: r.category, description: r.description, qty: r.qty, grade: r.grade, method: r.method, city: r.city, region: r.region, status: r.status, availability: r.availability, price_paise: r.price_paise, delivery_paise: r.delivery_paise, eta: r.eta, quote_note: r.quote_note, quote_valid_until: r.quote_valid_until, replied_at: r.replied_at, created_at: r.created_at, updated_at: r.updated_at, customer_decision_at: r.customer_decision_at });

  if (path === '' && method === 'POST') {
    limit(req, 'part-inquiry-create', 8, 3600000);
    const b = await bodyJson(req);
    if (b.website) return ok(res, { received: true });
    if (b.consent !== true && b.consent !== 'on') err(400, 'Please agree to the privacy notice.');
    const name = needed(b.name, 'Name', 100), mobile = phoneNorm(b.phone), email = trim(b.email, 180);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err(400, 'Invalid email address.');
    const brand = needed(b.brand, 'Brand', 80), model = needed(b.model, 'Model', 120), category = needed(b.category, 'Required part', 80), description = needed(b.description, 'Part details', 650);
    const variant = trim(b.variant, 120), colour = trim(b.colour, 70), notes = trim(b.notes, 800);
    const qty = Number(b.qty ?? 1); if (!Number.isSafeInteger(qty) || qty < 1 || qty > 20) err(400, 'Quantity must be 1–20.');
    const grade = trim(b.grade, 70) || 'Any compatible option';
    const methodVal = trim(b.method, 45);
    if (!['Workshop collection', 'Delivery requested', 'Discuss options'].includes(methodVal)) err(400, 'Invalid delivery preference.');
    const locality = needed(b.locality, 'Area / locality', 100), city = trim(b.city, 100), region = trim(b.region, 80), address = trim(b.address, 350), pincode = trim(b.pincode, 6);
    if (methodVal === 'Delivery requested' && (!address || !city || !region || !/^[1-9]\d{5}$/.test(pincode))) err(400, 'Full address, city, state and 6-digit PIN code are required for delivery.');
    if (typeof b.request_key !== 'string' || !/^[0-9a-f]{64}$/.test(b.request_key)) err(400, 'Refresh the page and retry your request.');
    const keyHash = digest(b.request_key), fingerprint = digest(JSON.stringify([name, mobile, email, brand, model, variant, colour, category, description, qty, grade, methodVal, locality, city, region, address, pincode, notes]));
    const d = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: '2-digit' }).formatToParts(new Date());
    const part = t => d.find(z => z.type === t)?.value || '';
    const ref = `RLI-${part('year')}${part('month')}${part('day')}-${randomBytes(8).toString('hex').toUpperCase()}`;
    const access = keyToken(b.request_key, ref);

    const out = await db.tx(async () => {
      const prior = await db.get('SELECT * FROM rl_part_inquiries WHERE key_hash=?', keyHash);
      if (prior) {
        if (prior.fingerprint !== fingerprint) err(409, 'Submission identifier was already used for different details. Refresh the form.');
        return { ref: prior.ref, access: keyToken(b.request_key, prior.ref), status: prior.status, replayed: true };
      }
      await db.run(
        `INSERT INTO rl_part_inquiries(ref,name,phone,email,whatsapp,brand,model,variant,colour,category,description,qty,grade,method,locality,address,pincode,urgency,notes,token_hash,key_hash,fingerprint,city,region,consent_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        ref, name, mobile, email, (b.whatsapp === true || b.whatsapp === 'on') ? 1 : 0, brand, model, variant, colour, category, description, qty, grade, methodVal, locality, address, pincode, trim(b.urgency, 25) || 'Flexible', notes, digest(access), keyHash, fingerprint, city, region, new Date().toISOString()
      );
      await db.run('INSERT OR IGNORE INTO rl_reference_registry(ref) VALUES(?)', ref);
      await db.run('INSERT INTO rl_part_inquiry_events(ref,actor,action,note) VALUES(?,?,?,?)', ref, 'customer', 'submitted', `${brand} ${model}: ${category}`);
      return { ref, access, status: 'received', replayed: false };
    });
    return ok(res, { ...out, message: 'Your parts enquiry is saved.' }, out.replayed ? 200 : 201);
  }

  if (path === '/access' && method === 'POST') {
    const b = await bodyJson(req);
    const ref = safeRef(b.ref), token = trim(b.access, 200);
    const r = await db.get('SELECT * FROM rl_part_inquiries WHERE ref=?', ref);
    if (!r || !/^[A-Za-z0-9_-]{43}$/.test(token) || !safeEqual(r.token_hash, digest(token))) err(404, 'Request not found or access code invalid.');
    const events = await db.all("SELECT action,created_at FROM rl_part_inquiry_events WHERE ref=? AND action IN ('quoted','unavailable','accepted','declined','reviewing') ORDER BY id DESC LIMIT 20", r.ref);
    return ok(res, { ...view(r), events });
  }

  if (path === '/admin/overview' && method === 'GET') {
    const a = await auth(db, req);
    if (!['owner', 'manager'].includes(a.permission)) err(403, 'Owner or manager access required.');
    const status = trim(url.searchParams.get('status'), 30), search = trim(url.searchParams.get('q'), 110), page = Math.max(1, Number(url.searchParams.get('page') || 1));
    let where = 'WHERE 1=1', args = [];
    if (status) { where += ' AND status=?'; args.push(status); }
    if (search) { where += ' AND (ref LIKE ? OR name LIKE ? OR phone LIKE ? OR brand LIKE ? OR model LIKE ?)'; const s = '%' + search + '%'; args.push(s, s, s, s, s); }
    const total = (await db.get('SELECT COUNT(*) n FROM rl_part_inquiries ' + where, ...args)).n;
    const items = await db.all(`SELECT id,ref,name,phone,brand,model,category,qty,method,locality,city,region,status,availability,read_at,price_paise,delivery_paise,created_at,replied_at,updated_at FROM rl_part_inquiries ${where} ORDER BY id DESC LIMIT 50 OFFSET ?`, ...args, (page - 1) * 50);
    const summary = await db.all('SELECT status,COUNT(*) n FROM rl_part_inquiries GROUP BY status');
    const unread = (await db.get('SELECT COUNT(*) n FROM rl_part_inquiries WHERE read_at IS NULL')).n;
    return ok(res, { items, total, page, page_size: 50, summary: Object.fromEntries(summary.map(x => [x.status, x.n])), unread, overdue: 0, server_time: new Date().toISOString() });
  }

  err(404, 'Parts enquiry route not found.');
}

async function handleRepairCenterCloud(db, req, res, url, { auth }) {
  const path = url.pathname.slice('/api/repair-center'.length);
  if (path.startsWith('/admin/')) {
    const s = await auth(db, req);
    if (path === '/admin/inbox-summary' && req.method === 'GET') {
      return ok(res, {
        unread: (await db.get('SELECT COUNT(*) n FROM bookings b JOIN rl_jobs j ON j.ref=b.ref LEFT JOIN rl_seen s ON s.ref=b.ref WHERE s.ref IS NULL')).n,
        latest_id: (await db.get('SELECT COALESCE(MAX(id),0) n FROM bookings')).n
      });
    }
    if ((path === '/admin/jobs' || path === '/admin/inbox') && req.method === 'GET') {
      const records = await db.all('SELECT b.ref,b.name,b.phone,b.brand,b.model,b.issue,b.method,b.date,b.locality,b.address,b.notes,b.created_at,j.stage,j.total,s.seen_at FROM bookings b JOIN rl_jobs j ON j.ref=b.ref LEFT JOIN rl_seen s ON s.ref=b.ref ORDER BY b.id DESC LIMIT 100');
      return ok(res, path === '/admin/jobs' ? records : { items: records, total: records.length, offset: 0, limit: 50 });
    }
    if (path === '/admin/qr-settings' && req.method === 'GET') {
      return ok(res, await db.get('SELECT * FROM rl_qr_settings WHERE id=1'));
    }
  }
  err(404, 'Repair center endpoint unavailable.');
}
