import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, getSettings, verifyPassword, hashToken, randomToken, publicRef, CATEGORIES } from './data.mjs';
import { createRepairCenter } from './repair-center.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const WEBROOT = join(ROOT, 'public');
if (existsSync(join(ROOT, '.env'))) for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !Object.hasOwn(process.env, match[1])) process.env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
}
export const db = openDatabase();
const PORT = Number(process.env.PORT || 3001);
const IS_PROD = process.env.NODE_ENV === 'production';
const cookieName = 'repairlylabs_session';
const headers = {
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'DENY', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    'Cross-Origin-Opener-Policy': 'same-origin'
};
if (IS_PROD) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8' };
function respond(res, status, payload, more = {}) {
    const isText = typeof payload === 'string'; const body = isText ? payload : JSON.stringify(payload);
    res.writeHead(status, { ...headers, 'Content-Type': isText ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...more }); res.end(body);
}
const ok = (res, body, status = 200) => respond(res, status, body);
function err(status, message) { const e = new Error(message); e.status = status; throw e; }
const str = (x, max = 200) => String(x ?? '').trim().slice(0, max);
function required(x, name, max = 200) { const v = str(x, max); if (!v) err(400, `${name} is required.`); return v; }
function phoneNorm(v) { const n = String(v ?? '').replace(/[\s()+-]/g, '').replace(/^91(?=\d{10}$)/, ''); if (!/^[6-9]\d{9}$/.test(n)) err(400, 'Enter a valid 10-digit Indian mobile number.'); return n; }
function integer(v, min, max, name) { const n = Number(v); if (!Number.isSafeInteger(n) || n < min || n > max) err(400, `Invalid ${name}.`); return n; }
async function bodyJson(req) { let all = ''; for await (const chunk of req) { all += chunk.toString(); if (all.length > 90000) err(413, 'Request too large.'); } try { const data = JSON.parse(all || '{}'); if (!data || typeof data !== 'object' || Array.isArray(data)) throw 0; return data; } catch { err(400, 'Invalid JSON.'); } }
function clientIp(req) { const ip = req.socket.remoteAddress || 'unknown'; return process.env.TRUST_PROXY === '1' && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip) ? String(req.headers['x-forwarded-for'] || ip).split(',')[0].trim() : ip; }
const requests = new Map();
function limit(req, group, max, windowMs) { const key = group + ':' + clientIp(req); const now = Date.now(); let item = requests.get(key); if (!item || now > item.reset) { item = { count: 0, reset: now + windowMs }; requests.set(key, item); } item.count++; if (item.count > max) err(429, 'Too many requests. Please try again later.'); if (requests.size > 6000) { for (const [k, v] of requests) if (v.reset < now) requests.delete(k); } }
function checkOrigin(req) { if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return; const origin = req.headers.origin; if (origin) { let domain; try { domain = new URL(origin).host; } catch { err(403, 'Invalid origin.'); } if (domain !== req.headers.host) err(403, 'Cross-site requests are blocked.'); } }
function cookie(req) { const s = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '=')); return s?.slice(cookieName.length + 1) || ''; }
function session(req) { const token = cookie(req); if (!/^[\w-]{40,120}$/.test(token)) return null; const row = db.prepare('SELECT username,csrf,expires_at FROM sessions WHERE token_hash=?').get(hashToken(token)); if (!row || row.expires_at < Date.now()) return null; return row; }
function auth(req) { const s = session(req); if (!s) err(401, 'Please sign in.'); if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.headers['x-csrf-token'] !== s.csrf) err(403, 'Session verification failed. Refresh the page.'); return s; }
function audit(username, action, details = '') { db.prepare('INSERT INTO audit(username,action,details) VALUES(?,?,?)').run(username, action, String(details).slice(0, 400)); }
function consent(b) { if (![true, 'on', '1'].includes(b.consent)) err(400, 'Please agree to the privacy notice before submitting.'); return new Date().toISOString(); }
async function sendWebhook(kind, record) { const dest = process.env.NOTIFY_WEBHOOK_URL; if (!dest) return; try { const target = new URL(dest); if (target.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(target.hostname)) throw Error('Webhook must use HTTPS'); const body = JSON.stringify({ event: kind, record, timestamp: new Date().toISOString() }); const { createHmac } = await import('node:crypto'); const signature = createHmac('sha256', process.env.NOTIFY_WEBHOOK_SECRET || '').update(body).digest('hex'); const response = await fetch(dest, { method: 'POST', headers: { 'content-type': 'application/json', 'x-repairlylabs-signature': 'sha256=' + signature }, body, signal: AbortSignal.timeout(5000) }); if (!response.ok) throw Error('HTTP ' + response.status); } catch (e) { console.error('[notification] Optional webhook failed:', e.message); } }
function siteConfig() { const settings = getSettings(db); const brands = db.prepare('SELECT brand,COUNT(*) AS models FROM devices GROUP BY brand ORDER BY brand COLLATE NOCASE').all(); const services = db.prepare('SELECT * FROM services WHERE active=1 ORDER BY sort_order,id').all(); return { settings, brands, services, categories: CATEGORIES }; }
function publicProduct(r) { return { ...r, sample: !!r.sample, featured: !!r.featured, active: !!r.active }; }
function getProducts(url, admin = false) { const q = str(url.searchParams.get('q'), 100), brand = str(url.searchParams.get('brand'), 80), cat = str(url.searchParams.get('category'), 80), model = str(url.searchParams.get('model'), 100); const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 24)); const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0); let where = admin ? 'WHERE 1=1' : 'WHERE active=1'; const bind = []; if (q) { where += ' AND (name LIKE ? OR model LIKE ? OR brand LIKE ? OR sku LIKE ?)'; const like = '%' + q + '%'; bind.push(like, like, like, like); } if (brand) { where += ' AND brand=?'; bind.push(brand); } if (cat) { where += ' AND category=?'; bind.push(cat); } if (model) { where += ' AND model LIKE ?'; bind.push('%' + model + '%'); } const total = db.prepare('SELECT COUNT(*) n FROM products ' + where).get(...bind).n; const items = db.prepare('SELECT * FROM products ' + where + ' ORDER BY featured DESC,id DESC LIMIT ? OFFSET ?').all(...bind, limit, offset).map(publicProduct); return { items, total, limit, offset }; }
function track(ref, phone) { const p = phoneNorm(phone), r = str(ref, 50).toUpperCase(); if (!/^(RLM|RLP|KM|KP)-\d{6}-[0-9A-F]{8}$/.test(r)) err(400, 'Please enter a valid reference ID.'); if (r.startsWith('RLM-') || r.startsWith('KM-')) { const b = db.prepare('SELECT ref,name,brand,model,issue,method,date,locality,status,quote,created_at,updated_at FROM bookings WHERE ref=? AND phone=?').get(r, p); return b ? { type: 'repair', record: b } : null; } const o = db.prepare('SELECT ref,name,mode,locality,status,subtotal,created_at,updated_at FROM orders WHERE ref=? AND phone=?').get(r, p); if (!o) return null; return { type: 'order', record: o, items: db.prepare('SELECT name,quantity,unit_price FROM order_items WHERE order_id=(SELECT id FROM orders WHERE ref=?)').all(r) }; }
const states = ['pending', 'confirmed', 'in_progress', 'ready', 'completed', 'cancelled'];
const orderTransitions = { pending: ['confirmed', 'cancelled'], confirmed: ['in_progress', 'ready', 'cancelled'], in_progress: ['ready', 'cancelled'], ready: ['completed', 'cancelled'], completed: [], cancelled: [] };
// REPAIRLY_CENTER_INSTALLED
export const repairCenter = createRepairCenter({
    db,
    auth,
    ok,
    bodyJson,
    limit,
    respond,
    worker: process.env.REPAIRLYLABS_TEST !== '1' && process.env.KASHIFIX_TEST !== '1'
});
async function api(req, res, url) {
    if (url.pathname.startsWith('/api/repair-center/')) return repairCenter.handle(req, res, url);
    const { pathname } = url; const method = req.method;
    if (pathname === '/api/health' && method === 'GET') return ok(res, { ok: true, app: 'RepairlyLabs', time: new Date().toISOString() });
    if (pathname === '/api/config' && method === 'GET') return ok(res, siteConfig());
    if (pathname === '/api/models' && method === 'GET') {
        const brand = str(url.searchParams.get('brand'), 100), q = str(url.searchParams.get('q'), 100); let sql = 'SELECT id,brand,model FROM devices WHERE 1=1', params = []; if (brand) { sql += ' AND brand=?'; params.push(brand); } if (q) { sql += ' AND (model LIKE ? OR brand LIKE ?)'; params.push('%' + q + '%', '%' + q + '%'); } sql += ' ORDER BY brand COLLATE NOCASE,model LIMIT 450'; return ok(res, db.prepare(sql).all(...params));
    }
    if (pathname === '/api/products' && method === 'GET') return ok(res, getProducts(url));
    if (/^\/api\/products\/\d+$/.test(pathname) && method === 'GET') {
        const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(Number(pathname.split('/').at(-1))); if (!p) err(404, 'Part not found.'); return ok(res, publicProduct(p));
    }
    if (pathname === '/api/bookings' && method === 'POST') {
        limit(req, 'booking', 12, 3600000); const b = await bodyJson(req);
        if (b.website) return ok(res, { received: true });
        const name = required(b.name, 'Name', 100), phone = phoneNorm(b.phone), brand = required(b.brand, 'Brand', 80), model = required(b.model, 'Model', 120), issue = required(b.issue, 'Repair issue', 120), method = required(b.method, 'Service method', 40);
        if (!['Visit workshop', 'Request pickup', 'Discuss options'].includes(method)) err(400, 'Invalid appointment method.');
        if (method === 'Request pickup' && getSettings(db).pickup_enabled !== '1') err(400, 'Pickup requests are not available right now.');
        const date = str(b.date, 20); if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) err(400, 'Invalid date.');
        const consentAt = consent(b); const locality = required(b.locality, 'Area/locality', 100); const address = str(b.address, 260); const notes = str(b.notes, 800); const ref = publicRef('RLM');
        db.prepare('INSERT INTO bookings(ref,name,phone,brand,model,issue,method,date,locality,address,notes,consent_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(ref, name, phone, brand, model, issue, method, date, locality, address, notes, consentAt);
        void sendWebhook('repair.requested', { ref, name, phone, brand, model, issue, method, date, locality });
        return ok(res, { ref, repair_access: repairCenter.issueToken(ref), status: 'pending', message: 'Repair request saved. Keep your reference ID to check status.' }, 201);
    }
    if (pathname === '/api/orders' && method === 'POST') {
        limit(req, 'orders', 12, 3600000); const b = await bodyJson(req); if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 30) err(400, 'Cart must have 1–30 items.');
        const consentAt = consent(b); const name = required(b.name, 'Name', 100), phone = phoneNorm(b.phone), locality = required(b.locality, 'Area/locality', 100), address = str(b.address, 350), mode = required(b.mode, 'Fulfillment method', 30), notes = str(b.notes, 800);
        if (!['Workshop collection', 'Request delivery', 'Discuss collection options'].includes(mode)) err(400, 'Invalid fulfillment method.');
        if (mode === 'Request delivery' && getSettings(db).delivery_enabled !== '1') err(400, 'Delivery requests are currently disabled.');
        if (mode === 'Request delivery' && !address) err(400, 'Address is needed for delivery requests.');
        const verified = [], seen = new Set(); let total = 0;
        for (const item of b.items) { const id = integer(item.id, 1, 100000000, 'product'), qty = integer(item.quantity, 1, 20, 'quantity'); if (seen.has(id)) err(400, 'Duplicate product entry.'); seen.add(id); const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(id); if (!p) err(400, 'Some parts are no longer listed.'); if (qty > p.stock) err(400, `Insufficient listed stock for ${p.name}.`); total += p.price * qty; verified.push({ p, qty }); }
        const ref = publicRef('RLP'); db.exec('BEGIN IMMEDIATE'); try {
            const order = db.prepare('INSERT INTO orders(ref,name,phone,locality,address,mode,notes,subtotal,consent_at) VALUES(?,?,?,?,?,?,?,?,?)').run(ref, name, phone, locality, address, mode, notes, total, consentAt);
            const add = db.prepare('INSERT INTO order_items(order_id,product_id,sku,name,unit_price,quantity,sample) VALUES(?,?,?,?,?,?,?)'); for (const { p, qty } of verified) add.run(order.lastInsertRowid, p.id, p.sku, p.name, p.price, qty, p.sample);
            db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        void sendWebhook('parts.requested', { ref, name, phone, mode, locality, subtotal: total, items: verified.map(x => ({ sku: x.p.sku, quantity: x.qty })) });
        return ok(res, { ref, status: 'pending', subtotal: total, message: 'Order request received. Staff will verify part fit, stock, price, and fulfillment before confirmation. No payment has been taken.' }, 201);
    }
    if (pathname === '/api/contact' && method === 'POST') {
        limit(req, 'contact', 8, 3600000); const b = await bodyJson(req); if (b.website) return ok(res, { received: true });
        const consentAt = consent(b); const name = required(b.name, 'Name', 100), phone = phoneNorm(b.phone), email = str(b.email, 180), message = required(b.message, 'Message', 1400);
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) err(400, 'Invalid email.');
        db.prepare('INSERT INTO contacts(name,phone,email,message,consent_at) VALUES(?,?,?,?,?)').run(name, phone, email, message, consentAt); void sendWebhook('contact.received', { name, phone, email, message }); return ok(res, { received: true, message: 'Message saved. The team can review it in the dashboard.' }, 201);
    }
    if (pathname === '/api/track' && method === 'GET') {
        limit(req, 'track', 30, 3600000); const result = track(url.searchParams.get('ref'), url.searchParams.get('phone')); if (!result) err(404, 'No request found with that reference and phone number.'); return ok(res, result);
    }
    if (pathname === '/api/admin/login' && method === 'POST') {
        limit(req, 'login', 8, 900000); const b = await bodyJson(req), username = str(b.username, 80).toLowerCase(), pass = String(b.password || '');
        const account = db.prepare('SELECT * FROM admins WHERE username=?').get(username);
        if (!account || !verifyPassword(pass, account.password_hash)) err(401, 'Incorrect username or password.');
        const token = randomToken(), csrf = randomToken(24), expiration = Date.now() + 7 * 24 * 60 * 60 * 1000;
        db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
        db.prepare('INSERT INTO sessions(token_hash,username,csrf,expires_at) VALUES(?,?,?,?)').run(hashToken(token), username, csrf, expiration);
        const c = `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${IS_PROD ? '; Secure' : ''}`;
        audit(username, 'sign_in'); return respond(res, 200, { username, csrf }, { 'Set-Cookie': c });
    }
    if (pathname === '/api/admin/me' && method === 'GET') {
        const s = auth(req); return ok(res, { username: s.username, csrf: s.csrf });
    }
    if (pathname.startsWith('/api/admin/')) {
        const s = auth(req);
        if (pathname === '/api/admin/logout' && method === 'POST') {
            db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(cookie(req))); return respond(res, 200, { ok: true }, { 'Set-Cookie': `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${IS_PROD ? '; Secure' : ''}` });
        }
        if (pathname === '/api/admin/overview' && method === 'GET') {
            return ok(res, { bookings: db.prepare('SELECT COUNT(*) n FROM bookings').get().n, pendingBookings: db.prepare("SELECT COUNT(*) n FROM bookings WHERE status='pending'").get().n, orders: db.prepare('SELECT COUNT(*) n FROM orders').get().n, pendingOrders: db.prepare("SELECT COUNT(*) n FROM orders WHERE status='pending'").get().n, unreadMessages: db.prepare('SELECT COUNT(*) n FROM contacts WHERE read=0').get().n, listedParts: db.prepare('SELECT COUNT(*) n FROM products WHERE active=1').get().n, lowStock: db.prepare('SELECT COUNT(*) n FROM products WHERE stock<=3 AND active=1').get().n, recentBookings: db.prepare('SELECT id,ref,name,model,status,created_at FROM bookings ORDER BY id DESC LIMIT 5').all(), recentOrders: db.prepare('SELECT id,ref,name,subtotal,status,created_at FROM orders ORDER BY id DESC LIMIT 5').all() });
        }
        if (pathname === '/api/admin/bookings' && method === 'GET') return ok(res, db.prepare('SELECT * FROM bookings ORDER BY id DESC LIMIT 500').all());
        if (pathname === '/api/admin/orders' && method === 'GET') return ok(res, db.prepare('SELECT * FROM orders ORDER BY id DESC LIMIT 500').all().map(o => ({ ...o, items: db.prepare('SELECT * FROM order_items WHERE order_id=?').all(o.id) })));
        if (pathname === '/api/admin/contacts' && method === 'GET') return ok(res, db.prepare('SELECT * FROM contacts ORDER BY id DESC LIMIT 500').all());
        if (pathname === '/api/admin/products' && method === 'GET') return ok(res, getProducts(url, true));
        if (pathname === '/api/admin/services' && method === 'GET') return ok(res, db.prepare('SELECT * FROM services ORDER BY sort_order,id').all());
        if (pathname === '/api/admin/models' && method === 'GET') return ok(res, db.prepare('SELECT * FROM devices ORDER BY brand,model').all());
        if (pathname === '/api/admin/settings' && method === 'GET') return ok(res, getSettings(db));
        if (/^\/api\/admin\/bookings\/\d+$/.test(pathname) && method === 'PATCH') {
            repairCenter.guardLegacy(Number(pathname.split('/').at(-1)));
            const id = Number(pathname.split('/').at(-1)), b = await bodyJson(req), prev = db.prepare('SELECT status FROM bookings WHERE id=?').get(id); if (!prev) err(404, 'Booking not found.');
            const status = str(b.status, 30); if (!states.includes(status)) err(400, 'Invalid status.'); const quote = b.quote === '' || b.quote === null || b.quote === undefined ? null : integer(b.quote, 0, 100000000, 'quote');
            db.prepare("UPDATE bookings SET status=?,quote=?,admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status, quote, str(b.admin_note, 800), id); repairCenter.syncLegacy(id); audit(s.username, 'booking_update', String(id) + ' -> ' + status); void sendWebhook('repair.status_changed', db.prepare('SELECT ref,name,phone,status,quote FROM bookings WHERE id=?').get(id)); return ok(res, { ok: true });
        }
        if (/^\/api\/admin\/orders\/\d+$/.test(pathname) && method === 'PATCH') {
            const id = Number(pathname.split('/').at(-1)), b = await bodyJson(req), next = str(b.status, 30); db.exec('BEGIN IMMEDIATE');
            try {
                const o = db.prepare('SELECT * FROM orders WHERE id=?').get(id); if (!o) err(404, 'Order not found.');
                if (!states.includes(next) || !orderTransitions[o.status]?.includes(next) && next !== o.status) err(400, 'This order status transition is not permitted.');
                if (o.status === 'pending' && next === 'confirmed') {
                    const items = db.prepare('SELECT product_id,quantity,unit_price FROM order_items WHERE order_id=?').all(id);
                    for (const p of items) { const row = db.prepare('SELECT stock,sample,price,active FROM products WHERE id=?').get(p.product_id); if (!row || row.stock < p.quantity) err(409, 'Insufficient stock to confirm this order.'); if (row.sample || !row.active) err(409, 'Verify real inventory and remove the sample flag before confirming.'); if (row.price !== p.unit_price) err(409, 'Price has changed since the request. Contact customer and create an updated order before confirmation.'); }
                    for (const p of items) db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(p.quantity, p.product_id);
                }
                if (['confirmed', 'in_progress', 'ready'].includes(o.status) && next === 'cancelled') {
                    for (const p of db.prepare('SELECT product_id,quantity FROM order_items WHERE order_id=?').all(id)) db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(p.quantity, p.product_id);
                }
                db.prepare("UPDATE orders SET status=?,admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(next, str(b.admin_note, 800), id); db.exec('COMMIT'); audit(s.username, 'order_update', String(id) + ' -> ' + next); void sendWebhook('parts.status_changed', db.prepare('SELECT ref,name,phone,status,subtotal FROM orders WHERE id=?').get(id)); return ok(res, { ok: true });
            } catch (e) { db.exec('ROLLBACK'); throw e; }
        }
        if (/^\/api\/admin\/contacts\/\d+$/.test(pathname) && method === 'PATCH') {
            const id = Number(pathname.split('/').at(-1)), b = await bodyJson(req); db.prepare('UPDATE contacts SET read=? WHERE id=?').run(b.read ? 1 : 0, id); return ok(res, { ok: true });
        }

        if (/^\/api\/admin\/contacts\/\d+$/.test(pathname) && method === 'DELETE') {
            const id = Number(pathname.split('/').at(-1)); db.prepare('DELETE FROM contacts WHERE id=?').run(id); audit(s.username, 'contact_delete', String(id)); return ok(res, { ok: true });
        }
        if (pathname === '/api/admin/settings' && method === 'PATCH') {
            const b = await bodyJson(req), allowed = ['business_name', 'tagline', 'city', 'phone', 'whatsapp', 'email', 'address', 'hours', 'instagram', 'map_url', 'pickup_enabled', 'delivery_enabled', 'announcement', 'terms', 'warranty', 'privacy_contact'];
            const update = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
            for (const key of allowed) if (Object.hasOwn(b, key)) { let v = str(b[key], ['terms', 'warranty', 'privacy_contact'].includes(key) ? 1500 : 350); if (key.endsWith('_enabled')) v = v === '1' ? '1' : '0'; update.run(key, v); }
            audit(s.username, 'settings_update'); return ok(res, { ok: true });
        }
        if (pathname === '/api/admin/products' && method === 'POST' || /^\/api\/admin\/products\/\d+$/.test(pathname) && method === 'PUT') {
            const b = await bodyJson(req), name = required(b.name, 'Part name', 130), brand = required(b.brand, 'Brand', 80), model = required(b.model, 'Model', 120), cat = required(b.category, 'Category', 80), sku = required(b.sku, 'SKU', 60), price = integer(b.price, 0, 10000000, 'price'), stock = integer(b.stock, 0, 100000, 'stock');
            if (!CATEGORIES.includes(cat)) err(400, 'Invalid category.');
            const values = [sku, name, brand, model, cat, str(b.grade, 80) || 'Ask for details', price, stock, b.active ? 1 : 0, b.featured ? 1 : 0, b.sample ? 1 : 0, str(b.description, 900), str(b.image_kind, 30) || 'display'];
            try {
                if (method === 'POST') db.prepare('INSERT INTO products(sku,name,brand,model,category,grade,price,stock,active,featured,sample,description,image_kind) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...values);
                else { const id = Number(pathname.split('/').at(-1)); const r = db.prepare('UPDATE products SET sku=?,name=?,brand=?,model=?,category=?,grade=?,price=?,stock=?,active=?,featured=?,sample=?,description=?,image_kind=? WHERE id=?').run(...values, id); if (!r.changes) err(404, 'Part not found.'); }
            } catch (e) { if (String(e).includes('UNIQUE')) err(409, 'SKU already exists.'); throw e; }
            audit(s.username, 'product_save', sku); return ok(res, { ok: true });
        }
        if (/^\/api\/admin\/products\/\d+$/.test(pathname) && method === 'DELETE') {
            const id = Number(pathname.split('/').at(-1)); db.prepare('UPDATE products SET active=0 WHERE id=?').run(id); audit(s.username, 'product_hide', String(id)); return ok(res, { ok: true });
        }
        if (pathname === '/api/admin/services' && method === 'POST') {
            const b = await bodyJson(req), slug = required(b.slug, 'Slug', 50).toLowerCase().replace(/[^a-z0-9-]/g, '-'); const vals = [slug, required(b.title, 'Title', 110), required(b.description, 'Description', 400), str(b.icon, 40) || 'wrench', str(b.tag, 60), b.active ? 1 : 0, integer(b.sort_order ?? 0, 0, 999, 'sort order')];
            if (b.id) { db.prepare('UPDATE services SET slug=?,title=?,description=?,icon=?,tag=?,active=?,sort_order=? WHERE id=?').run(...vals, integer(b.id, 1, 100000, 'service id')); }
            else db.prepare('INSERT INTO services(slug,title,description,icon,tag,active,sort_order) VALUES(?,?,?,?,?,?,?)').run(...vals);
            audit(s.username, 'service_save', slug); return ok(res, { ok: true });
        }
        if (pathname === '/api/admin/models/bulk' && method === 'POST') {
            const b = await bodyJson(req); if (!Array.isArray(b.models) || b.models.length > 1000) err(400, 'Provide a models array with at most 1,000 rows.');
            let added = 0; const ins = db.prepare('INSERT OR IGNORE INTO devices(brand,model) VALUES(?,?)'); for (const v of b.models) { const brand = required(v.brand, 'Brand', 80), model = required(v.model, 'Model', 120); added += ins.run(brand, model).changes; }
            audit(s.username, 'models_import', String(added)); return ok(res, { added });
        }
        if (pathname === '/api/admin/password' && method === 'PATCH') {
            const b = await bodyJson(req), a = db.prepare('SELECT password_hash FROM admins WHERE username=?').get(s.username); if (!verifyPassword(String(b.current || ''), a.password_hash)) err(403, 'Current password is incorrect.');
            if (typeof b.next !== 'string' || b.next.length < 12 || b.next.length > 150) err(400, 'New password must contain at least 12 characters.');
            const { passwordHash } = await import('./data.mjs'); db.prepare('UPDATE admins SET password_hash=? WHERE username=?').run(passwordHash(b.next), s.username); db.prepare('DELETE FROM sessions WHERE username=? AND token_hash<>?').run(s.username, hashToken(cookie(req))); audit(s.username, 'password_change'); return ok(res, { ok: true });
        }
        if (pathname === '/api/admin/export' && method === 'GET') {
            const type = url.searchParams.get('type'); const queries = { bookings: 'SELECT * FROM bookings ORDER BY id DESC', orders: 'SELECT * FROM orders ORDER BY id DESC', contacts: 'SELECT * FROM contacts ORDER BY id DESC', products: 'SELECT * FROM products ORDER BY id DESC' }; if (!queries[type]) err(400, 'Unknown export.');
            const rows = db.prepare(queries[type]).all(); let fields = rows.length ? Object.keys(rows[0]) : [];
            if (!fields.length) fields = db.prepare(`PRAGMA table_info(${type})`).all().map(c => c.name);
            const cell = v => { let x = String(v ?? ''); if (/^[=+\-@\t\r]/.test(x)) x = "'" + x; return '"' + x.replaceAll('"', '""') + '"'; };
            return respond(res, 200, [fields.map(cell).join(','), ...rows.map(r => fields.map(k => cell(r[k])).join(','))].join('\r\n'), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="repairlylabs-${type}.csv"` });
        }
        err(404, 'Admin endpoint not found.');
    }
    err(404, 'API endpoint not found.');
}
function staticFile(req, res, url) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return respond(res, 405, { error: 'Method not allowed.' });
    let p; try { p = decodeURIComponent(url.pathname); } catch { err(400, 'Invalid URL.'); }
    if (p.includes('\0') || p.includes('\\') || p.split('/').includes('..')) err(400, 'Invalid path.');
    const target = resolve(WEBROOT, '.' + p);
    if (!target.startsWith(WEBROOT + sep) && target !== WEBROOT) err(403, 'Forbidden.');
    let file = target;
    if (!existsSync(file) || !statSync(file).isFile()) { if (extname(p)) err(404, 'Not found.'); file = join(WEBROOT, 'index.html'); }
    const ext = extname(file); const data = readFileSync(file);
    const pageHeaders = p === '/repair-center/index.html' ? {
        ...headers,
        'Content-Security-Policy': "default-src 'self'; script-src 'self' https://checkout.razorpay.com https://*.razorpay.com; style-src 'self' 'unsafe-inline' https://*.razorpay.com; img-src 'self' data: https://*.razorpay.com; connect-src 'self' https://*.razorpay.com; frame-src https://*.razorpay.com https://*.razorpay.co.in; font-src 'self' data: https://*.razorpay.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self' https://*.razorpay.com;",
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
        'Referrer-Policy': 'no-referrer'
    } : headers;
    res.writeHead(200, { ...pageHeaders, 'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600' }); if (req.method === 'HEAD') res.end(); else res.end(data);
}
export const server = createServer(async (req, res) => {
    try {
        checkOrigin(req); const url = new URL(req.url, 'http://localhost'); if (url.pathname.startsWith('/api/')) await api(req, res, url); else staticFile(req, res, url);
    } catch (e) { if (!e.status) console.error('[request]', e); respond(res, e.status || 500, { error: e.status ? e.message : 'An unexpected server error occurred.' }); }
});
server.on('close', () => { try { repairCenter.close(); } catch { } try { db.close(); } catch { } });
if (process.env.REPAIRLYLABS_TEST !== '1') server.listen(PORT, '0.0.0.0', () => console.log(`RepairlyLabs ready at http://localhost:${PORT}`));
