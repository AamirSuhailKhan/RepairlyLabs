import { timingSafeEqual } from 'node:crypto';
import { wrapDb } from './turso.mjs';

export const CUSTOMER_SCHEMA_SQL = `
 CREATE TABLE IF NOT EXISTS customer_accounts(
   id INTEGER PRIMARY KEY,
   name TEXT NOT NULL,
   email TEXT UNIQUE NOT NULL COLLATE NOCASE,
   phone TEXT NOT NULL DEFAULT '',
   password_hash TEXT NOT NULL,
   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 CREATE TABLE IF NOT EXISTS customer_sessions(
   token_hash TEXT PRIMARY KEY,
   customer_id INTEGER NOT NULL REFERENCES customer_accounts(id),
   csrf TEXT NOT NULL,
   expires_at INTEGER NOT NULL,
   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
`;

const COOKIE_NAME = 'repairlylabs_customer';
const err = (status, message) => { const e = new Error(message); e.status = status; throw e; };
const str = (x, max = 200) => String(x ?? '').trim().slice(0, max);
const safeEqual = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function readCustomerCookie(req) {
  const s = String(req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE_NAME + '='));
  return s?.slice(COOKIE_NAME.length + 1) || '';
}

function normalizeEmail(raw) {
  const email = str(raw, 120).toLowerCase();
  if (!email || !/^[a-z0-9._+%-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) {
    err(400, 'Enter a valid email address.');
  }
  return email;
}

/**
 * Shared customer authentication & self-service request history handler
 * compatible with both synchronous node:sqlite and remote Turso via wrapDb.
 */
export function createCustomerAuth({
  db: rawDb,
  limit,
  bodyJson,
  ok,
  respond,
  cookieAttrs,
  phoneNorm,
  passwordHash,
  verifyPassword,
  hashToken,
  randomToken
}) {
  const db = wrapDb(rawDb);
  let readyPromise = null;

  async function ensureReady() {
    if (!readyPromise) {
      readyPromise = (async () => {
        if (!(await db.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='customer_sessions'"))) {
          await db.exec(CUSTOMER_SCHEMA_SQL);
        }
      })().catch(e => { readyPromise = null; throw e; });
    }
    return readyPromise;
  }

  async function session(req) {
    await ensureReady();
    const token = readCustomerCookie(req);
    if (!/^[\w-]{40,120}$/.test(token)) return null;
    const row = await db.get(
      `SELECT s.csrf, s.expires_at, c.id, c.name, c.email, c.phone
       FROM customer_sessions s
       JOIN customer_accounts c ON c.id = s.customer_id
       WHERE s.token_hash = ?`,
      hashToken(token)
    );
    if (!row || row.expires_at < Date.now()) return null;
    return row;
  }

  async function issueSession(req, customer) {
    const token = randomToken(32);
    const csrf = randomToken(24);
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    await db.run('DELETE FROM customer_sessions WHERE expires_at < ?', Date.now());
    await db.run(
      'INSERT INTO customer_sessions(token_hash, customer_id, csrf, expires_at) VALUES(?,?,?,?)',
      hashToken(token), customer.id, csrf, expiresAt
    );
    const cookieHeader = `${COOKIE_NAME}=${token}; Path=/; HttpOnly; ${cookieAttrs(req)}; Max-Age=604800`;
    return {
      cookieHeader,
      payload: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone, csrf }
    };
  }

  async function handle(req, res, url) {
    await ensureReady();
    const path = url.pathname.slice('/api/customer'.length);
    const method = req.method;

    if (path === '/register' && method === 'POST') {
      limit(req, 'customer-register', 10, 900000);
      const b = await bodyJson(req);
      const name = str(b.name, 100);
      if (!name) err(400, 'Your name is required.');
      const email = normalizeEmail(b.email);
      const phone = str(b.phone, 20) ? phoneNorm(b.phone) : '';
      const pass = String(b.password || '');
      if (pass.length < 8 || pass.length > 150) err(400, 'Choose a password of 8–150 characters.');

      const existing = await db.get('SELECT id FROM customer_accounts WHERE email = ? COLLATE NOCASE', email);
      if (existing) err(409, 'An account with this email already exists. Please sign in.');

      const ins = await db.run(
        'INSERT INTO customer_accounts(name, email, phone, password_hash) VALUES(?,?,?,?)',
        name, email, phone, passwordHash(pass)
      );
      const customer = { id: Number(ins.lastInsertRowid), name, email, phone };
      const { cookieHeader, payload } = await issueSession(req, customer);
      return respond(res, 201, payload, { 'Set-Cookie': cookieHeader });
    }

    if (path === '/login' && method === 'POST') {
      limit(req, 'customer-login', 12, 900000);
      const b = await bodyJson(req);
      const email = normalizeEmail(b.email);
      const pass = String(b.password || '');
      const acc = await db.get('SELECT * FROM customer_accounts WHERE email = ? COLLATE NOCASE', email);
      if (!acc) {
        return respond(res, 401, {
          error: 'No account exists for this email yet. Create an account first to sign in.',
          code: 'ACCOUNT_NOT_FOUND'
        });
      }
      if (pass.length > 150 || !verifyPassword(pass, acc.password_hash)) {
        return respond(res, 401, {
          error: 'Wrong password for this account. Click Show to check your password.',
          code: 'INVALID_PASSWORD'
        });
      }
      const { cookieHeader, payload } = await issueSession(req, acc);
      return respond(res, 200, payload, { 'Set-Cookie': cookieHeader });
    }

    if (path === '/me' && method === 'GET') {
      const s = await session(req);
      if (!s) err(401, 'Please sign in.');
      return ok(res, { id: s.id, name: s.name, email: s.email, phone: s.phone, csrf: s.csrf });
    }

    if (path === '/logout' && method === 'POST') {
      const s = await session(req);
      if (s && !safeEqual(String(req.headers['x-csrf-token'] || ''), s.csrf)) {
        err(403, 'Session verification failed. Refresh the page.');
      }
      const token = readCustomerCookie(req);
      if (token) await db.run('DELETE FROM customer_sessions WHERE token_hash = ?', hashToken(token));
      return respond(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE_NAME}=; Path=/; HttpOnly; ${cookieAttrs(req)}; Max-Age=0` });
    }

    if (path === '/requests' && method === 'GET') {
      const s = await session(req);
      if (!s) err(401, 'Please sign in to view your requests.');
      const repairs = await db.all(
        `SELECT ref, brand, model, issue, method, locality, status, quote, created_at, updated_at
         FROM bookings WHERE email = ? COLLATE NOCASE ORDER BY id DESC LIMIT 100`,
        s.email
      );
      let partInquiries = [];
      if (await db.get("SELECT 1 FROM sqlite_master WHERE type='table' AND name='rl_part_inquiries'")) {
        partInquiries = await db.all(
          `SELECT ref, brand, model, category, qty, status, availability, price_paise, delivery_paise, eta, created_at
           FROM rl_part_inquiries WHERE email = ? COLLATE NOCASE ORDER BY id DESC LIMIT 100`,
          s.email
        );
      }
      return ok(res, { repairs, partInquiries });
    }

    err(404, 'Customer endpoint not found.');
  }

  return { ensureReady, session, handle };
}
