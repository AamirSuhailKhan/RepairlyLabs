import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { BlockList, isIP } from 'node:net';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, extname, join, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase, getSettings, verifyPassword, hashToken, randomToken, publicRef, CATEGORIES } from './data.mjs';
import { createRepairCenter } from './repair-center.mjs';
import { initAccess, profile, findAccount, recoverOwner, manageTeam, updateEmail, owner, recoveryValid, generateOfflineCodes } from './admin-access.mjs';
import { seoOrigin,sitemap,catalogPage,structuredData } from './seo.mjs';
import { financialReport,ledgerCSV } from './finance.mjs';
import { createEmailRecovery } from './email-recovery.mjs';
import { createGatewayExtensions } from './gateway-extensions.mjs';
import { createExtendedOps } from './extended-ops.mjs';
import { createPartsPayments } from './parts-payment.mjs';
import { createPartInquiries } from './part-inquiries.mjs';
import { createReferenceAllocator } from './repair-reference.mjs';

import { ROOT, DATA_DIR } from './config.mjs';
const WEBROOT = join(ROOT, 'public');
export const db = openDatabase(DATA_DIR);
initAccess(db);
db.exec(`CREATE TABLE IF NOT EXISTS booking_submissions (fingerprint TEXT PRIMARY KEY, ref TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS booking_submission_time ON booking_submissions(created_at);
CREATE TABLE IF NOT EXISTS request_keys (key_hash TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, ref TEXT NOT NULL, created_at INTEGER NOT NULL);`);
const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';
const IS_TEST = process.env.REPAIRLYLABS_TEST === '1';
const IS_PREVIEW = !IS_PROD && !IS_TEST && (Boolean(process.env.K_SERVICE) || process.env.RL_PREVIEW_IFRAME === '1');
const FRAME_ANCESTORS = IS_PREVIEW ? "frame-ancestors 'self' https://aistudio.google.com https://*.google.com https://*.googleusercontent.com" : "frame-ancestors 'none'";
const cookieName = 'repairlylabs_session';
const headers = {
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin',
    ...(IS_PREVIEW ? {} : { 'X-Frame-Options': 'DENY' }), 'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; object-src 'none'; ${FRAME_ANCESTORS}; base-uri 'self'; form-action 'self'`,
    'Cross-Origin-Opener-Policy': IS_PREVIEW ? 'same-origin-allow-popups' : 'same-origin'
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
const digest=value=>createHash('sha256').update(value).digest('hex');
function requestKey(b){if(b.request_key===undefined)return null;if(typeof b.request_key!=='string'||! /^[a-f0-9]{64}$/.test(b.request_key))err(400,'Invalid request identifier.');return digest(b.request_key);}
function checkKey(key,fingerprint){if(!key)return null;const row=db.prepare('SELECT * FROM request_keys WHERE key_hash=?').get(key);if(row&&row.fingerprint!==fingerprint)err(409,'This submission identifier was already used for different details. Start a new request.');return row;}
function rememberKey(key,fingerprint,ref){if(key)db.prepare('INSERT INTO request_keys(key_hash,fingerprint,ref,created_at) VALUES(?,?,?,?)').run(key,fingerprint,ref,Date.now());}
function bookingReplay(b,old){const token=createHash('sha256').update('repairly-booking:'+b.request_key+':'+old.ref).digest('base64url');const j=db.prepare('SELECT token_hash FROM rl_jobs WHERE ref=?').get(old.ref);if(!j)err(409,'The earlier request is unavailable. Contact staff.');return {ref:old.ref,status:'pending',...(j.token_hash===digest(token)?{repair_access:token}:{}),message:'Your earlier request was already saved.'};}
function phoneNorm(v) { const n = String(v ?? '').replace(/[\s()+-]/g, '').replace(/^91(?=\d{10}$)/, ''); if (!/^[6-9]\d{9}$/.test(n)) err(400, 'Enter a valid 10-digit Indian mobile number.'); return n; }
function integer(v, min, max, name) { const n = Number(v); if (!Number.isSafeInteger(n) || n < min || n > max) err(400, `Invalid ${name}.`); return n; }
async function bodyJson(req) { const chunks = []; let size = 0; for await (const chunk of req) { size += chunk.length; if (size > (req.method==='POST' && req.url?.split('?')[0]==='/api/part-inquiries'?750000:/^\/api\/extended\/job\/[A-Z0-9-]+\/photos$/.test(req.url?.split('?')[0]||'')?750000:req.url?.split('?')[0]==='/api/repair-center/admin/qr-settings'?750000:/\/api\/repair-center\/job\/[A-Z0-9-]+\/qr-claim$/.test(req.url?.split('?')[0]||'')?750000:/^\/api\/parts-payment\/order\/[A-Z0-9-]+\/claim$/.test(req.url?.split('?')[0]||'')?750000:90000)) err(413, 'Request too large.'); chunks.push(chunk); } const all = Buffer.concat(chunks).toString('utf8'); try { const data = JSON.parse(all || '{}'); if (!data || typeof data !== 'object' || Array.isArray(data)) throw 0; return data; } catch { err(400, 'Invalid JSON.'); } }
function normalizeIp(raw){const s=String(raw||'').trim();if(!s)return '';const mapped=s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);return mapped?mapped[1]:s;}
function buildProxyList(cidrsRaw){
  const bl=new BlockList();
  bl.addSubnet('127.0.0.0',8,'ipv4');
  bl.addAddress('::1','ipv6');
  if(!cidrsRaw)return bl;
  for(const entry of String(cidrsRaw).split(',').map(x=>x.trim()).filter(Boolean)){
    const slash=entry.indexOf('/');
    const addr=normalizeIp(slash>=0?entry.slice(0,slash):entry);
    const ver=isIP(addr);
    if(!ver)throw new Error(`Invalid trusted proxy IP/CIDR: ${entry}`);
    const type=ver===4?'ipv4':'ipv6';
    if(slash>=0){
      const prefix=Number(entry.slice(slash+1));
      if(!Number.isInteger(prefix)||prefix<0||prefix>(ver===4?32:128))throw new Error(`Invalid trusted proxy CIDR prefix: ${entry}`);
      bl.addSubnet(addr,prefix,type);
    }else{
      bl.addAddress(addr,type);
    }
  }
  return bl;
}
const proxyAllowList=buildProxyList(process.env.TRUST_PROXY_CIDRS);
function isProxyAllowListed(ip){const norm=normalizeIp(ip);const ver=isIP(norm);return ver?proxyAllowList.check(norm,ver===4?'ipv4':'ipv6'):false;}
export function trustedProxy(req){return Boolean(process.env.VERCEL||(IS_PREVIEW&&process.env.K_SERVICE)||(process.env.TRUST_PROXY==='1'&&isProxyAllowListed(req.socket?.remoteAddress)));}
export function isHttpsRequest(req){const proto=String(req.headers['x-forwarded-proto']||'').split(',')[0].trim().toLowerCase();return Boolean(req.socket?.encrypted||(trustedProxy(req)&&proto==='https'));}
function sessionCookieAttrs(req){return IS_PREVIEW&&isHttpsRequest(req)?'SameSite=None; Secure':`SameSite=Strict${IS_PROD||isHttpsRequest(req)?'; Secure':''}`;}
export function clientIp(req){
  const sockIp=normalizeIp(req.socket?.remoteAddress)||'unknown';
  if(!trustedProxy(req))return sockIp;
  const xff=String(req.headers['x-forwarded-for']||'').split(',').map(x=>normalizeIp(x)).filter(Boolean);
  for(let i=xff.length-1;i>=0;i--){
    const cand=xff[i];
    if(!isIP(cand))return sockIp;
    if(!isProxyAllowListed(cand))return cand;
  }
  return xff[0]||sockIp;
}
const requests = new Map();
function limit(req, group, max, windowMs) { const key=group+':'+clientIp(req), now=Date.now(); let item=requests.get(key); if(!item || now>=item.reset) { if(requests.size>=6000) { for(const [k,v] of requests) if(v.reset<=now) requests.delete(k); if(requests.size>=6000 && !requests.has(key)) err(429,'Too many requests. Please try again later.'); } item={count:0,reset:now+windowMs}; requests.set(key,item); } if(++item.count>max) err(429,'Too many requests. Please try again later.'); }
function checkOrigin(req) { if (!['POST','PUT','PATCH','DELETE'].includes(req.method)) return; const origin=req.headers.origin; if(!origin) return; const proto=isHttpsRequest(req) ? 'https':'http'; const host=String(req.headers.host||''); if(!process.env.PUBLIC_ORIGIN && (!host || /[\s@/?#]/.test(host))) err(403,'Invalid origin.'); let expected; try { const u=new URL(process.env.PUBLIC_ORIGIN || `${proto}://${host}`); if(u.username||u.password) throw 0; expected=u.origin; } catch { err(403,'Invalid origin.'); } if(origin!==expected) err(403,'Cross-site requests are blocked.'); }
function safeEqualString(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const ba=Buffer.from(a),bb=Buffer.from(b);return ba.length===bb.length&&timingSafeEqual(ba,bb);}
function cookie(req) { const s = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '=')); return s?.slice(cookieName.length + 1) || ''; }
function session(req) { const token = cookie(req); if (!/^[\w-]{40,120}$/.test(token)) return null; const row = db.prepare('SELECT username,csrf,expires_at FROM sessions WHERE token_hash=?').get(hashToken(token)); if (!row || row.expires_at < Date.now() || profile(db,row.username).disabled) return null; return row; }
function auth(req) { const s = session(req); if (!s) err(401, 'Please sign in.'); if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !safeEqualString(req.headers['x-csrf-token'], s.csrf)) err(403, 'Session verification failed. Refresh the page.'); return {...s, ...profile(db,s.username)}; }
function audit(username, action, details = '') { db.prepare('INSERT INTO audit(username,action,details) VALUES(?,?,?)').run(username, action, String(details).slice(0, 400)); }
function consent(b) { if (![true, 'on', '1'].includes(b.consent)) err(400, 'Please agree to the privacy notice before submitting.'); return new Date().toISOString(); }
async function sendWebhook(kind, record) { const dest = process.env.NOTIFY_WEBHOOK_URL; if (!dest) return; try { const target = new URL(dest); if (target.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(target.hostname)) throw Error('Webhook must use HTTPS'); const body = JSON.stringify({ event: kind, record, timestamp: new Date().toISOString() }); const { createHmac } = await import('node:crypto'); const signature = createHmac('sha256', process.env.NOTIFY_WEBHOOK_SECRET || '').update(body).digest('hex'); const response = await fetch(dest, { method: 'POST', headers: { 'content-type': 'application/json', 'x-repairlylabs-signature': 'sha256=' + signature }, body, signal: AbortSignal.timeout(5000) }); if (!response.ok) throw Error('HTTP ' + response.status); } catch (e) { console.error('[notification] Optional webhook failed:', e.message); } }
function siteConfig() { const settings = getSettings(db); const brands = db.prepare('SELECT brand,COUNT(*) AS models FROM devices GROUP BY brand COLLATE NOCASE ORDER BY brand COLLATE NOCASE').all(); const services = db.prepare('SELECT * FROM services WHERE active=1 ORDER BY sort_order,id').all(); return { settings, brands, services, categories: CATEGORIES }; }
function publicProduct(r) { return { ...r, sample: !!r.sample, featured: !!r.featured, active: !!r.active }; }
function getProducts(url, admin = false) { const q = str(url.searchParams.get('q'), 100), brand = str(url.searchParams.get('brand'), 80), cat = str(url.searchParams.get('category'), 80), model = str(url.searchParams.get('model'), 100); const limit = Math.min(100, Math.max(1, Math.trunc(Number(url.searchParams.get('limit')) || 24))); const offset = Math.min(100000000, Math.max(0, Math.trunc(Number(url.searchParams.get('offset')) || 0))); let where = admin ? 'WHERE 1=1' : 'WHERE active=1'; const bind = []; if (q) { where += ' AND (name LIKE ? OR model LIKE ? OR brand LIKE ? OR sku LIKE ?)'; const like = '%' + q + '%'; bind.push(like, like, like, like); } if (brand) { where += ' AND brand=? COLLATE NOCASE'; bind.push(brand); } if (cat) { where += ' AND category=?'; bind.push(cat); } if (model) { where += ' AND model LIKE ?'; bind.push('%' + model + '%'); } const total = db.prepare('SELECT COUNT(*) n FROM products ' + where).get(...bind).n; const items = db.prepare('SELECT * FROM products ' + where + ' ORDER BY featured DESC,id DESC LIMIT ? OFFSET ?').all(...bind, limit, offset).map(publicProduct); return { items, total, limit, offset }; }
function track(ref, phone) { const p = phoneNorm(phone), r = str(ref, 50).toUpperCase(); if (!/^(RLM|RLP|KM|KP)-\d{6}-[0-9A-F]{8}$/.test(r)) err(400, 'Please enter a valid reference ID.'); if (r.startsWith('RLM-') || r.startsWith('KM-')) { const b = db.prepare('SELECT ref,name,brand,model,issue,method,date,locality,status,quote,created_at,updated_at FROM bookings WHERE ref=? AND phone=?').get(r, p); return b ? { type: 'repair', record: b } : null; } const o = db.prepare('SELECT ref,name,mode,locality,status,subtotal,created_at,updated_at FROM orders WHERE ref=? AND phone=?').get(r, p); if (!o) return null; return { type: 'order', record: o, items: db.prepare('SELECT name,quantity,unit_price FROM order_items WHERE order_id=(SELECT id FROM orders WHERE ref=?)').all(r) }; }
const states = ['pending', 'confirmed', 'in_progress', 'ready', 'completed', 'cancelled'];
const orderTransitions = { pending: ['confirmed', 'cancelled'], confirmed: ['in_progress', 'ready', 'cancelled'], in_progress: ['ready', 'cancelled'], ready: ['completed', 'cancelled'], completed: [], cancelled: [] };
// REPAIRLY_CENTER_INSTALLED
// REPAIRLY_INTAKE_V2
export const allocateRepairlyRef = createReferenceAllocator(db);
export const repairCenter = createRepairCenter({
    db,
    auth,
    ok,
    bodyJson,
    limit,
    respond,
    verifyOwner: (actor,password)=>owner(db)===actor && typeof password==='string' && password.length<=150 && verifyPassword(password,findAccount(db,actor).password_hash),
    phoneSession: (req,ref)=>extended.phoneSession(req,ref),
    onWebhook: (event)=>gatewayExtensions.handleWebhook(event),
    worker: process.env.REPAIRLYLABS_TEST !== '1' && process.env.KASHIFIX_TEST !== '1'
});
const partInquiries=createPartInquiries({db,auth,ok,bodyJson,limit,notify:sendWebhook});
const emailRecovery=createEmailRecovery({db});
const partsPayments=createPartsPayments({db,auth,ok,bodyJson,limit,phoneSession:(req,ref)=>extended.phoneSession(req,ref)});
const extended=createExtendedOps({db,auth,ok,bodyJson,limit,verifyPassword,findAccount,dataDir:DATA_DIR});
export const gatewayExtensions=createGatewayExtensions({db,auth,ok,bodyJson,limit,access:extended.access,worker:process.env.REPAIRLYLABS_TEST!=='1'});
async function api(req, res, url) {
    if(url.pathname.startsWith('/api/part-inquiries'))return partInquiries.handle(req,res,url);
    if(url.pathname.startsWith('/api/gateway-extension/'))return gatewayExtensions.handle(req,res,url);
    if(url.pathname.startsWith('/api/extended/'))return extended.handle(req,res,url);
    if(url.pathname.startsWith('/api/parts-payment/'))return partsPayments.handle(req,res,url);
    if (url.pathname.startsWith('/api/repair-center/')) return repairCenter.handle(req, res, url);
    const { pathname } = url; const method = req.method;
    if(pathname==='/api/ready'&&method==='GET'){try{db.prepare('SELECT 1').get();return ok(res,{ok:true});}catch{return ok(res,{ok:false},503);}}
    if (pathname === '/api/health' && method === 'GET') return ok(res, { ok: true, app: 'RepairlyLabs', time: new Date().toISOString() });
    if (pathname === '/api/config' && method === 'GET') return ok(res, siteConfig());
    if (pathname === '/api/models' && method === 'GET') {
        const brand = str(url.searchParams.get('brand'), 100), q = str(url.searchParams.get('q'), 100); let sql = 'SELECT id,brand,model FROM devices WHERE 1=1', params = []; if (brand) { sql += ' AND brand=? COLLATE NOCASE'; params.push(brand); } if (q) { sql += ' AND (model LIKE ? OR brand LIKE ?)'; params.push('%' + q + '%', '%' + q + '%'); } sql += ' ORDER BY brand COLLATE NOCASE,model LIMIT 450'; return ok(res, db.prepare(sql).all(...params));
    }
    if (pathname === '/api/products' && method === 'GET') { if(process.env.PUBLIC_LEGACY_CATALOG!=='1' && process.env.REPAIRLYLABS_TEST!=='1') err(410,'The public price catalog is no longer offered. Request any part at /part-request/.'); return ok(res,getProducts(url)); }
    if (/^\/api\/products\/\d+$/.test(pathname) && method === 'GET') {
        if(process.env.PUBLIC_LEGACY_CATALOG!=='1' && process.env.REPAIRLYLABS_TEST!=='1') err(410,'Part listings are no longer public. Ask the team for a verified quote at /part-request/.');
        const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(Number(pathname.split('/').at(-1))); if (!p) err(404, 'Part not found.'); return ok(res, publicProduct(p));
    }
    if (pathname === '/api/bookings' && method === 'POST') {
        limit(req, 'booking', 12, 3600000); const b = await bodyJson(req);
        if (b.website) return ok(res, { received: true });
        const name = required(b.name, 'Name', 100), phone = phoneNorm(b.phone), brand = required(b.brand, 'Brand', 80), model = required(b.model, 'Model', 120), issue = required(b.issue, 'Repair issue', 120), method = required(b.method, 'Service method', 40);
        if (!['Visit workshop', 'Request pickup', 'Discuss options'].includes(method)) err(400, 'Invalid appointment method.');
        if (method === 'Request pickup' && getSettings(db).pickup_enabled !== '1') err(400, 'Pickup requests are not available right now.');
        const date = str(b.date, 20); if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date)) err(400, 'Invalid date.');
        const consentAt = consent(b); const locality = required(b.locality, 'Area/locality', 100); const address = str(b.address, 260);
        if (method === 'Request pickup' && !address) err(400, 'Full address is required for pickup.');
        const notes = str(b.notes, 800); const email=str(b.email,180), pin=str(b.pin,6), slot=str(b.slot,30), whatsapp=b.whatsapp===true||b.whatsapp==='on'?1:0; if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))err(400,'Invalid email.'); if(pin&&!/^[1-9]\d{5}$/.test(pin))err(400,'Enter a valid 6-digit PIN code.'); if(slot&&!['Morning','Afternoon','Evening'].includes(slot))err(400,'Invalid appointment time preference.');
        const fingerprint=digest(JSON.stringify(['booking',name,phone,brand,model,issue,method,date,locality,address,notes,email,pin,slot,whatsapp])),key=requestKey(b);const old=checkKey(key,fingerprint);if(old)return ok(res,bookingReplay(b,old),200);
        const previous=db.prepare('SELECT ref FROM booking_submissions WHERE fingerprint=? AND created_at>?').get(fingerprint,Date.now()-120000);
        if(previous) err(409,'An identical repair request was recently received. Check your original confirmation or contact the repair team.');
        const ref = allocateRepairlyRef('RLM'); db.exec('BEGIN IMMEDIATE'); let access;
        try {
        const same=checkKey(key,fingerprint);if(same){db.exec('COMMIT');return ok(res,bookingReplay(b,same),200);}
        if(db.prepare('SELECT ref FROM booking_submissions WHERE fingerprint=? AND created_at>?').get(fingerprint,Date.now()-120000))err(409,'Identical request already received.');
        extended.capacity(date,slot);
        db.prepare('INSERT INTO bookings(ref,name,phone,brand,model,issue,method,date,locality,address,notes,consent_at,email,pin,slot,whatsapp) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(ref, name, phone, brand, model, issue, method, date, locality, address, notes, consentAt,email,pin,slot,whatsapp);
        access=repairCenter.issueToken(ref,key?createHash('sha256').update('repairly-booking:'+b.request_key+':'+ref).digest('base64url'):undefined); rememberKey(key,fingerprint,ref); if(whatsapp)db.prepare('INSERT INTO rl_outbox(ref,event,channel) VALUES(?,?,?)').run(ref,'booking.received','customer_whatsapp'); if(email)db.prepare('INSERT INTO rl_outbox(ref,event,channel) VALUES(?,?,?)').run(ref,'booking.received','customer_email'); db.prepare('DELETE FROM booking_submissions WHERE created_at<?').run(Date.now()-120000); db.prepare('INSERT INTO booking_submissions(fingerprint,ref,created_at) VALUES(?,?,?)').run(fingerprint,ref,Date.now()); db.exec('COMMIT'); } catch(e){db.exec('ROLLBACK');throw e;}
        void sendWebhook('repair.requested', { ref, name, phone, brand, model, issue, method, date, locality });
        return ok(res, { ref, repair_access: access, status: 'pending', message: 'Repair request saved. Keep your reference ID to check status.' }, 201);
    }
    if (pathname === '/api/orders' && method === 'POST') {
        if(process.env.PUBLIC_LEGACY_CATALOG!=='1' && process.env.REPAIRLYLABS_TEST!=='1') err(410,'Direct catalog checkout is unavailable. Send a parts enquiry at /part-request/ for a personalised quote.');
        limit(req, 'orders', 12, 3600000); const b = await bodyJson(req); if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 30) err(400, 'Cart must have 1–30 items.');
        const consentAt = consent(b); const name = required(b.name, 'Name', 100), phone = phoneNorm(b.phone), locality = required(b.locality, 'Area/locality', 100), address = str(b.address, 350), mode = required(b.mode, 'Fulfillment method', 30), notes = str(b.notes, 800);
        if (!['Workshop collection', 'Request delivery', 'Discuss collection options'].includes(mode)) err(400, 'Invalid fulfillment method.');
        if (mode === 'Request delivery' && getSettings(db).delivery_enabled !== '1') err(400, 'Delivery requests are currently disabled.');
        if (mode === 'Request delivery' && !address) err(400, 'Address is needed for delivery requests.');
        const key=requestKey(b),fingerprint=digest(JSON.stringify(['order',name,phone,locality,address,mode,notes,b.items.map(i=>i&&typeof i==='object'?[i.id,i.quantity]:i)]));const orderReplay=old=>{const o=db.prepare('SELECT ref,status,subtotal FROM orders WHERE ref=?').get(old.ref);if(!o)err(409,'Previous order unavailable.');return {...o,order_access:partsPayments.replay(o.ref,createHash('sha256').update(b.request_key+':parts:'+o.ref).digest('base64url')),message:'Your earlier order was already received.'};};const old=checkKey(key,fingerprint);if(old)return ok(res,orderReplay(old));
        const verified = [], seen = new Set(); let total = 0;
        for (const item of b.items) { if (!item || typeof item !== 'object' || Array.isArray(item)) err(400,'Invalid cart item.'); const id = integer(item.id, 1, 100000000, 'product'), qty = integer(item.quantity, 1, 20, 'quantity'); if (seen.has(id)) err(400, 'Duplicate product entry.'); seen.add(id); const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(id); if (!p) err(400, 'Some parts are no longer listed.'); if (qty > p.stock) err(400, `Insufficient listed stock for ${p.name}.`); total += p.price * qty; verified.push({ p, qty }); }
        const ref = allocateRepairlyRef('RLP'); let orderAccess; db.exec('BEGIN IMMEDIATE'); try {
            const same=checkKey(key,fingerprint);if(same){db.exec('COMMIT');return ok(res,orderReplay(same));}
            const order = db.prepare('INSERT INTO orders(ref,name,phone,locality,address,mode,notes,subtotal,consent_at) VALUES(?,?,?,?,?,?,?,?,?)').run(ref, name, phone, locality, address, mode, notes, total, consentAt);
            const add = db.prepare('INSERT INTO order_items(order_id,product_id,sku,name,unit_price,quantity,sample) VALUES(?,?,?,?,?,?,?)'); for (const { p, qty } of verified) add.run(order.lastInsertRowid, p.id, p.sku, p.name, p.price, qty, p.sample);
            orderAccess=partsPayments.issue(ref,key?createHash('sha256').update(b.request_key+':parts:'+ref).digest('base64url'):undefined);rememberKey(key,fingerprint,ref);db.exec('COMMIT');
        } catch (e) { db.exec('ROLLBACK'); throw e; }
        void sendWebhook('parts.requested', { ref, name, phone, mode, locality, subtotal: total, items: verified.map(x => ({ sku: x.p.sku, quantity: x.qty })) });
        return ok(res, { ref, order_access:orderAccess, status: 'pending', subtotal: total, message: 'Order request received. Staff will verify part fit, stock, price, and fulfillment before confirmation. No payment has been taken.' }, 201);
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
    if(pathname==='/api/account-recovery/request'&&method==='POST'){limit(req,'email-reset-request',5,900000);const b=await bodyJson(req);return ok(res,await emailRecovery.requestReset(b.email));}
    if(pathname==='/api/account-recovery/verify'&&method==='POST'){limit(req,'email-verify',8,900000);const b=await bodyJson(req);return ok(res,emailRecovery.verify(b.token));}
    if(pathname==='/api/account-recovery/reset'&&method==='POST'){limit(req,'email-reset',8,900000);const b=await bodyJson(req);return ok(res,emailRecovery.reset(b.token,b.password));}
    if (pathname === '/api/admin/access-info' && method === 'GET') return ok(res,{version:3});
    if (pathname === '/api/admin/recovery-check' && method === 'POST') { limit(req,'recovery-check',8,900000); const b=await bodyJson(req); if(typeof b.token!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(b.token)) err(403,'Recovery link invalid or expired.'); if(!recoveryValid(db,b.token)) err(403,'Recovery link invalid or expired.'); return ok(res,{valid:true}); }
    if (pathname === '/api/admin/recover' && method === 'POST') { limit(req,'recover',8,900000); const b=await bodyJson(req); return ok(res,recoverOwner(db,b)); }
    if (pathname === '/api/admin/login' && method === 'POST') {
        limit(req, 'login', 8, 900000); const b = await bodyJson(req), login = str(b.username, 120).toLowerCase(), pass = String(b.password || '');
        const account = findAccount(db,login);
        if (!account || account.disabled || pass.length>150 || !verifyPassword(pass, account.password_hash)) err(401, 'Incorrect username or password.');
        const username=account.username;
        extended.verifyMfa(username,b.otp);
        const token = randomToken(), csrf = randomToken(24), expiration = Date.now() + 7 * 24 * 60 * 60 * 1000;
        db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
        db.prepare('INSERT INTO sessions(token_hash,username,csrf,expires_at) VALUES(?,?,?,?)').run(hashToken(token), username, csrf, expiration);
        const c = `${cookieName}=${token}; Path=/; HttpOnly; ${sessionCookieAttrs(req)}; Max-Age=604800`;
        audit(username, 'sign_in'); return respond(res, 200, { ...profile(db,username), csrf }, { 'Set-Cookie': c });
    }
    if (pathname === '/api/admin/me' && method === 'GET') {
        const s = auth(req); return ok(res, { ...profile(db,s.username), csrf: s.csrf });
    }
    if(pathname==='/api/finance/report'||pathname==='/api/finance/export'){const s=auth(req);if(s.role!=='owner'&&s.permission!=='accountant')err(403,'Finance access required.');if(method!=='GET')err(405,'Method not allowed.');if(pathname.endsWith('/report'))return ok(res,financialReport(db));audit(s.username,'finance_export');return respond(res,200,ledgerCSV(db),{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename=repairlylabs-payment-ledger.csv'});}
    if (pathname.startsWith('/api/admin/')) {
        const s = auth(req); const adminBody=async()=>{const b=await bodyJson(req);auth(req);return b;};
        if(s.role!=='owner') {
            const ownRoutes=['/api/admin/email','/api/admin/password','/api/admin/logout','/api/admin/sessions'];
            const managerRoutes=/^\/api\/admin\/(overview|bookings|orders|contacts|products|models|services)(?:\/.*)?$/;
            if(!ownRoutes.includes(pathname) && !(s.permission==='manager' && managerRoutes.test(pathname))) err(403,'This operation requires owner or assigned manager permission.');
        }
        if(pathname==='/api/admin/audit-log'&&method==='GET'){const offset=Math.max(0,Math.min(1000000,Math.trunc(Number(url.searchParams.get('offset'))||0)));return ok(res,{items:db.prepare("SELECT username actor,action,details ref,created_at FROM audit UNION ALL SELECT actor,action,ref,created_at FROM rl_audit ORDER BY created_at DESC LIMIT 100 OFFSET ?").all(offset),offset});}
        if(pathname==='/api/admin/email-recovery'&&method==='GET')return ok(res,emailRecovery.info(s.username));
        if(pathname==='/api/admin/email-recovery'&&method==='POST'){limit(req,'email-verification-start',5,900000);const b=await adminBody();auth(req);return ok(res,await emailRecovery.beginVerification(s.username,b.current));}
        if(pathname==='/api/admin/sessions'&&method==='GET')return ok(res,db.prepare('SELECT created_at,expires_at,token_hash=? current FROM sessions WHERE username=? AND expires_at>? ORDER BY created_at DESC').all(hashToken(cookie(req)),s.username,Date.now()));
        if(pathname==='/api/admin/sessions'&&method==='POST'){limit(req,'session-revoke',5,900000);const b=await adminBody();auth(req);if(typeof b.current!=='string'||b.current.length>150||!verifyPassword(b.current,findAccount(db,s.username).password_hash))err(403,'Current password required.');db.prepare('DELETE FROM sessions WHERE username=? AND token_hash<>?').run(s.username,hashToken(cookie(req)));audit(s.username,'other_sessions_revoked');return ok(res,{ok:true});}
        if(pathname==='/api/admin/recovery-codes'&&method==='POST'){limit(req,'offline-codes',5,900000);const b=await adminBody();return ok(res,generateOfflineCodes(db,s.username,b.current));}
        if (pathname === '/api/admin/team' && method === 'GET') { if(owner(db)!==s.username)err(403,'Only the owner can manage team accounts.');return ok(res,db.prepare('SELECT username,created_at FROM admins ORDER BY username').all().map(a=>({...a,...profile(db,a.username)}))); }
        if (pathname === '/api/admin/team' && method === 'POST') { limit(req,'team',20,900000); return ok(res,manageTeam(db,s.username,await adminBody())); }
        if (pathname === '/api/admin/email' && method === 'PATCH') { limit(req,'email',10,900000);return ok(res,updateEmail(db,s.username,await adminBody())); }
        if (pathname === '/api/admin/logout' && method === 'POST') {
            db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(cookie(req))); return respond(res, 200, { ok: true }, { 'Set-Cookie': `${cookieName}=; Path=/; HttpOnly; ${sessionCookieAttrs(req)}; Max-Age=0` });
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
            const id = Number(pathname.split('/').at(-1)), b = await adminBody(); repairCenter.guardLegacy(id); const prev = db.prepare('SELECT status FROM bookings WHERE id=?').get(id); if (!prev) err(404, 'Booking not found.');
            const status = str(b.status, 30); if (!states.includes(status)) err(400, 'Invalid status.'); if(!['pending','confirmed'].includes(status)||!['pending','confirmed'].includes(prev.status)||(prev.status==='confirmed'&&status==='pending')) err(409,'Use Repair Desk for repair progression, payment and cancellation.'); const quote = b.quote === '' || b.quote === null || b.quote === undefined ? null : integer(b.quote, 0, 100000000, 'quote');
            db.prepare("UPDATE bookings SET status=?,quote=?,admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(status, quote, str(b.admin_note, 800), id); repairCenter.syncLegacy(id); audit(s.username, 'booking_update', String(id) + ' -> ' + status); void sendWebhook('repair.status_changed', db.prepare('SELECT ref,name,phone,status,quote FROM bookings WHERE id=?').get(id)); return ok(res, { ok: true });
        }
        if (/^\/api\/admin\/orders\/\d+$/.test(pathname) && method === 'PATCH') {
            const id = Number(pathname.split('/').at(-1)), b = await adminBody(), next = str(b.status, 30); db.exec('BEGIN IMMEDIATE');
            try {
                const o = db.prepare('SELECT * FROM orders WHERE id=?').get(id); if (!o) err(404, 'Order not found.');
                if (!states.includes(next) || !orderTransitions[o.status]?.includes(next) && next !== o.status) err(400, 'This order status transition is not permitted.');
                partsPayments.checkTransition(o,next);
                if (o.status === 'pending' && next === 'confirmed') {
                    const items = db.prepare('SELECT product_id,quantity,unit_price FROM order_items WHERE order_id=?').all(id);
                    for (const p of items) { const row = db.prepare('SELECT stock,sample,price,active FROM products WHERE id=?').get(p.product_id); if (!row || row.stock < p.quantity) err(409, 'Insufficient stock to confirm this order.'); if (row.sample || !row.active) err(409, 'Verify real inventory and remove the sample flag before confirming.'); if (row.price !== p.unit_price) err(409, 'Price has changed since the request. Contact customer and create an updated order before confirmation.'); }
                    for (const p of items) { if (!db.prepare('UPDATE products SET stock=stock-? WHERE id=? AND stock>=?').run(p.quantity, p.product_id, p.quantity).changes) err(409, 'Insufficient stock to confirm this order.'); }
                }
                if (['confirmed', 'in_progress', 'ready'].includes(o.status) && next === 'cancelled') {
                    for (const p of db.prepare('SELECT product_id,quantity FROM order_items WHERE order_id=?').all(id)) db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(p.quantity, p.product_id);
                }
                db.prepare("UPDATE orders SET status=?,admin_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(next, str(b.admin_note, 800), id); db.exec('COMMIT'); audit(s.username, 'order_update', String(id) + ' -> ' + next); void sendWebhook('parts.status_changed', db.prepare('SELECT ref,name,phone,status,subtotal FROM orders WHERE id=?').get(id)); return ok(res, { ok: true });
            } catch (e) { db.exec('ROLLBACK'); throw e; }
        }
        if (/^\/api\/admin\/contacts\/\d+$/.test(pathname) && method === 'PATCH') {
            const id = Number(pathname.split('/').at(-1)), b = await adminBody(); if(!db.prepare('UPDATE contacts SET read=? WHERE id=?').run(b.read ? 1 : 0, id).changes) err(404,'Contact not found.'); return ok(res, { ok: true });
        }

        if (/^\/api\/admin\/contacts\/\d+$/.test(pathname) && method === 'DELETE') {
            const id = Number(pathname.split('/').at(-1)); if(!db.prepare('DELETE FROM contacts WHERE id=?').run(id).changes) err(404,'Contact not found.'); audit(s.username, 'contact_delete', String(id)); return ok(res, { ok: true });
        }
        if (pathname === '/api/admin/settings' && method === 'PATCH') {
            const b = await adminBody(), allowed = ['business_name', 'tagline', 'city', 'phone', 'whatsapp', 'email', 'address', 'hours', 'instagram', 'map_url', 'pickup_enabled', 'delivery_enabled', 'announcement', 'terms', 'warranty', 'privacy_contact'];
            const update = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
            for (const key of allowed) if (Object.hasOwn(b, key)) { let v = str(b[key], ['terms', 'warranty', 'privacy_contact'].includes(key) ? 1500 : 350); if (key.endsWith('_enabled')) v = v === '1' ? '1' : '0'; update.run(key, v); }
            audit(s.username, 'settings_update'); return ok(res, { ok: true });
        }
        if (pathname === '/api/admin/products' && method === 'POST' || /^\/api\/admin\/products\/\d+$/.test(pathname) && method === 'PUT') {
            const b = await adminBody(), name = required(b.name, 'Part name', 130), brand = required(b.brand, 'Brand', 80), model = required(b.model, 'Model', 120), cat = required(b.category, 'Category', 80), sku = required(b.sku, 'SKU', 60), price = integer(b.price, 0, 10000000, 'price'), stock = integer(b.stock, 0, 100000, 'stock');
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
            const b = await adminBody(), slug = required(b.slug, 'Slug', 50).toLowerCase().replace(/[^a-z0-9-]/g, '-'); const vals = [slug, required(b.title, 'Title', 110), required(b.description, 'Description', 400), str(b.icon, 40) || 'wrench', str(b.tag, 60), b.active ? 1 : 0, integer(b.sort_order ?? 0, 0, 999, 'sort order')];
            if (b.id) { db.prepare('UPDATE services SET slug=?,title=?,description=?,icon=?,tag=?,active=?,sort_order=? WHERE id=?').run(...vals, integer(b.id, 1, 100000, 'service id')); }
            else db.prepare('INSERT INTO services(slug,title,description,icon,tag,active,sort_order) VALUES(?,?,?,?,?,?,?)').run(...vals);
            audit(s.username, 'service_save', slug); return ok(res, { ok: true });
        }
        if (pathname === '/api/admin/models/bulk' && method === 'POST') {
            const b = await adminBody(); if (!Array.isArray(b.models) || b.models.length > 1000) err(400, 'Provide a models array with at most 1,000 rows.');
            const rows=b.models.map(v=>{if(!v||typeof v!=='object'||Array.isArray(v))err(400,'Invalid model row.');return [required(v.brand,'Brand',80),required(v.model,'Model',120)];}); let added=0; const ins=db.prepare('INSERT OR IGNORE INTO devices(brand,model) VALUES(?,?)'); db.exec('BEGIN IMMEDIATE'); try {for(const row of rows) added+=ins.run(...row).changes;db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
            audit(s.username, 'models_import', String(added)); return ok(res, { added });
        }
        if (pathname === '/api/admin/password' && method === 'PATCH') {
            const b = await adminBody(), a = db.prepare('SELECT password_hash FROM admins WHERE username=?').get(s.username); if (typeof b.current!=='string'||b.current.length>150||!verifyPassword(b.current, a.password_hash)) err(403, 'Current password is incorrect.');
            if (typeof b.next !== 'string' || b.next.length < 8 || b.next.length > 150) err(400, 'New password must contain at least 8 characters.');
            const { passwordHash } = await import('./data.mjs'); db.prepare('UPDATE admins SET password_hash=? WHERE username=?').run(passwordHash(b.next), s.username); db.prepare('DELETE FROM sessions WHERE username=? AND token_hash<>?').run(s.username, hashToken(cookie(req))); audit(s.username, 'password_change'); return ok(res, { ok: true });
        }
        if (pathname === '/api/admin/export' && method === 'GET') {
            const type = url.searchParams.get('type'); const queries = { bookings: 'SELECT * FROM bookings ORDER BY id DESC', orders: 'SELECT * FROM orders ORDER BY id DESC', contacts: 'SELECT * FROM contacts ORDER BY id DESC', products: 'SELECT * FROM products ORDER BY id DESC' }; if (!Object.hasOwn(queries,type)) err(400, 'Unknown export.');
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
    const canonical=seoOrigin();
    if(p==='/sitemap.xml'){if(!canonical)err(404,'Set PUBLIC_ORIGIN to your HTTPS domain to publish the sitemap.');res.writeHead(200,{...headers,'Content-Type':'application/xml; charset=utf-8','Cache-Control':'no-cache'});return res.end(req.method==='HEAD'?undefined:sitemap(db,canonical));}
    if(p==='/robots.txt'){const robots='User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /repair-center\nDisallow: /parts-payment\nDisallow: /part-request?admin\nDisallow: /account-recovery\nDisallow: /operations\nDisallow: /track\n'+(canonical?'Sitemap: '+canonical+'/sitemap.xml\n':'');res.writeHead(200,{...headers,'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-cache'});return res.end(req.method==='HEAD'?undefined:robots);}
    if(/^\/(service|part)\//.test(p)){const content=catalogPage(db,p,getSettings(db),canonical);if(!content)err(404,'Listing not found.');res.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'});return res.end(req.method==='HEAD'?undefined:content);}
    const target = resolve(WEBROOT, '.' + p);
    if (!target.startsWith(WEBROOT + sep) && target !== WEBROOT) err(403, 'Forbidden.');
    let file = ['/part-request','/part-request/'].includes(p) ? join(WEBROOT,'part-request','index.html') : ['/repair-center','/repair-center/'].includes(p) ? join(WEBROOT,'repair-center','index.html') : ['/parts-payment','/parts-payment/'].includes(p)?join(WEBROOT,'parts-payment','index.html'):['/account-recovery','/account-recovery/'].includes(p)?join(WEBROOT,'account-recovery','index.html'):['/operations','/operations/'].includes(p)?join(WEBROOT,'operations','index.html'):target;
    if (!existsSync(file) || !statSync(file).isFile()) { if (extname(p)) err(404, 'Not found.'); file = join(WEBROOT, 'index.html'); }
    const ext = extname(file); let data = readFileSync(file);
    if(file===join(WEBROOT,'index.html')&&canonical&&['/','/repairs','/parts','/about','/contact','/privacy','/terms'].includes(p)){
        const extraHead=`<link rel="canonical" href="${canonical}${p}">\n${p==='/'?structuredData(getSettings(db),canonical)+'\n':''}`;
        data=Buffer.from(data.toString().replace('</head>',extraHead+'</head>'));
    }
    const privatePage=/^\/(admin|track|repair-center|parts-payment|account-recovery|operations)(?:\/|$)/.test(p) || (p.startsWith('/part-request') && url.searchParams.has('admin'));
    const cacheHeader=(ext!=='.html'&&url.searchParams.has('v'))?'public, max-age=31536000, immutable':(ext!=='.html'&&['.css','.js','.mjs','.png','.webp','.svg','.ico'].includes(ext))?'public, max-age=300':'no-cache, no-store, must-revalidate';
    const pageHeaders = file === join(WEBROOT,'repair-center','index.html') ? {
        ...headers,
        'Content-Security-Policy': `default-src 'self'; script-src 'self' https://checkout.razorpay.com https://*.razorpay.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://*.razorpay.com; img-src 'self' data: https://*.razorpay.com; connect-src 'self' https://*.razorpay.com; frame-src https://*.razorpay.com https://*.razorpay.co.in; font-src 'self' data: https://fonts.gstatic.com https://*.razorpay.com; object-src 'none'; base-uri 'self'; ${FRAME_ANCESTORS}; form-action 'self' https://*.razorpay.com;`,
        'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
        'Referrer-Policy': 'no-referrer'
    } : p.startsWith('/operations') ? {...headers,'Content-Security-Policy':headers['Content-Security-Policy'].replace("img-src 'self' data:","img-src 'self' data: https://*.razorpay.com https://*.razorpay.co.in")} : headers;
    res.writeHead(200, { ...pageHeaders, ...(privatePage?{'X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'}:{}), 'Content-Type': mime[ext] || 'application/octet-stream', 'Cache-Control': cacheHeader }); if (req.method === 'HEAD') res.end(); else res.end(data);
}
export async function handleRequest(req, res) {
    const started=Date.now();if(process.env.RL_REQUEST_LOG==='1')res.once('finish',()=>{const raw=String(req.url||'').split('?')[0];const group=raw.startsWith('/api/')?'api/'+(raw.split('/')[2]||'other'):'page';const safe=/^(api\/[a-z-]{1,32}|page)$/.test(group)?group:'other';console.log(JSON.stringify({event:'http',group:safe,method:req.method,status:res.statusCode,ms:Date.now()-started}));});
    try {
        checkOrigin(req); const url = new URL(req.url, 'http://localhost'); if (url.pathname.startsWith('/api/')) await api(req, res, url); else staticFile(req, res, url);
    } catch (e) { if (!e.status) console.error('[request]', e); respond(res, e.status || 500, { error: e.status ? e.message : 'An unexpected server error occurred.' }); }
}
export const server = createServer(handleRequest);
server.on('close', () => { try { gatewayExtensions.close(); repairCenter.close(); } catch { } try { db.close(); } catch { } });
function gracefulShutdown(signal) {
    console.log(`[server] Received ${signal}, closing gracefully...`);
    const force = setTimeout(() => process.exit(1), 10000);
    force.unref();
    server.close(() => { clearTimeout(force); process.exit(0); });
}
if (process.env.REPAIRLYLABS_TEST !== '1' && !process.env.VERCEL) {
    process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.once('SIGINT', () => gracefulShutdown('SIGINT'));
    server.listen(PORT, '0.0.0.0', () => console.log(`RepairlyLabs ready at http://localhost:${PORT}`));
}
