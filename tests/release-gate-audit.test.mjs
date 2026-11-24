import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

const ROOT = resolve(import.meta.dirname, '..');
const REAL_DB = join(ROOT, 'data', 'repairlylabs.sqlite');
const realDbBeforeMtime = existsSync(REAL_DB) ? statSync(REAL_DB).mtimeMs : null;

const dir = mkdtempSync(join(tmpdir(), 'rl-release-gate-'));
process.env.DATA_DIR = dir;
process.env.PORT = '0';
process.env.REPAIRLYLABS_TEST = '1';
process.env.PUBLIC_LEGACY_CATALOG = '1';
delete process.env.RAZORPAY_KEY_ID;
delete process.env.RAZORPAY_KEY_SECRET;
delete process.env.RAZORPAY_WEBHOOK_SECRET;

const { server, db } = await import('../src/server.mjs');
const { issueRecovery, recoverOwner } = await import('../src/admin-access.mjs');
const { createRepairCenter } = await import('../src/repair-center.mjs');

if (!server.listening) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
}
const origin = `http://127.0.0.1:${server.address().port}`;
const ownerPass = 'ReleaseGate!' + randomBytes(8).toString('hex');

async function req(path, method = 'GET', data, session, token) {
  const r = await fetch(origin + path, {
    method,
    headers: {
      origin,
      ...(data !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(session ? { cookie: session.cookie, 'x-csrf-token': session.csrf } : {}),
      ...(token ? { authorization: 'Bearer ' + token } : {})
    },
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  const ct = r.headers.get('content-type') || '';
  const d = ct.includes('application/json') ? await r.json() : await r.text();
  return {
    status: r.status,
    d,
    cookie: r.headers.get('set-cookie')?.split(';')[0] || '',
    csrf: typeof d === 'object' && d ? d.csrf || '' : ''
  };
}

test('Phase 4 release gate: simultaneous QR claims, overpayments, partial refund limits, atomic stock rollback, invoice arithmetic', async () => {
  recoverOwner(db, { token: issueRecovery(db), username: 'rgowner', password: ownerPass });
  const login = await req('/api/admin/login', 'POST', { username: 'rgowner', password: ownerPass });
  assert.equal(login.status, 200);
  const admin = { cookie: login.cookie, csrf: login.csrf };

  const validPng =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCZsAAAAASUVORK5CYII=';
  db.prepare('UPDATE rl_qr_settings SET enabled=1,merchant=?,upi=?,image=?,version=1 WHERE id=1').run(
    'Release Gate Shop',
    'rg@upi',
    validPng
  );

  // Seed two verified SKUs: SKU-OK (stock 3) and SKU-LOW (stock 0)
  db.prepare(
    "INSERT INTO products(sku,name,brand,model,category,grade,price,stock,active,featured,sample,description,image_kind) VALUES('SKU-RG-OK','Good Part','Samsung','S24','Battery','OEM',1000,3,1,0,0,'OK','battery')"
  ).run();
  db.prepare(
    "INSERT INTO products(sku,name,brand,model,category,grade,price,stock,active,featured,sample,description,image_kind) VALUES('SKU-RG-LOW','Empty Part','Samsung','S24','Display & Touch','OEM',2000,0,1,0,0,'Empty','display')"
  ).run();

  // Create repair job
  const booking = await req('/api/bookings', 'POST', {
    name: 'Gate Customer',
    phone: '9876598765',
    brand: 'Samsung',
    model: 'Galaxy S24',
    issue: 'Screen & battery',
    method: 'Visit workshop',
    locality: 'Sigra',
    consent: true
  });
  assert.equal(booking.status, 201);
  const ref = booking.d.ref;
  const custToken = booking.d.repair_access;

  assert.equal((await req(`/api/repair-center/admin/job/${ref}/diagnosis`, 'POST', { diagnosis: 'Needs screen and battery' }, admin)).status, 200);
  // Quote: 1x 100000 + 1x 200000 + labor 50000 - discount 25000 = 325000 paise, deposit 150000
  const quoteRes = await req(`/api/repair-center/admin/job/${ref}/quote`, 'POST', {
    items: [
      { name: 'Good Part', sku: 'SKU-RG-OK', qty: 1, price: 100000 },
      { name: 'Empty Part', sku: 'SKU-RG-LOW', qty: 1, price: 200000 }
    ],
    labor: 50000,
    discount: 25000,
    deposit: 150000
  }, admin);
  assert.equal(quoteRes.status, 200);
  assert.equal(quoteRes.d.total, 325000);
  assert.equal(quoteRes.d.balance, 325000);

  assert.equal((await req(`/api/repair-center/job/${ref}/approve`, 'POST', { version: 1 }, undefined, custToken)).status, 200);

  // 1. Overpayment attempt on QR claim (> deposit 150000) rejected 400
  const overClaim = await req(`/api/repair-center/job/${ref}/qr-claim`, 'POST', {
    amount: 150001,
    utr: 'OVERPAYUTR0001',
    version: 1
  }, undefined, custToken);
  assert.equal(overClaim.status, 400);

  // 2. Simultaneous QR claims with distinct UTRs -> only 1 succeeds (200), others 409
  const qrRace = await Promise.all([
    req(`/api/repair-center/job/${ref}/qr-claim`, 'POST', { amount: 150000, utr: 'RACEUTR000001', version: 1 }, undefined, custToken),
    req(`/api/repair-center/job/${ref}/qr-claim`, 'POST', { amount: 150000, utr: 'RACEUTR000002', version: 1 }, undefined, custToken),
    req(`/api/repair-center/job/${ref}/qr-claim`, 'POST', { amount: 150000, utr: 'RACEUTR000003', version: 1 }, undefined, custToken)
  ]);
  assert.equal(qrRace.filter((r) => r.status === 200).length, 1);
  assert.equal(qrRace.filter((r) => r.status === 409).length, 2);

  // Approve the single pending QR claim
  const pendingRow = db.prepare("SELECT receipt FROM rl_payments WHERE ref=? AND state='awaiting_verification'").get(ref);
  assert.equal((await req(`/api/repair-center/admin/job/${ref}/qr-review`, 'POST', {
    receipt: pendingRow.receipt,
    decision: 'approve',
    note: 'Bank credit matched',
    confirmed: true
  }, admin)).status, 200);

  // 3. Partial refund limit enforcement: 100000 succeeds, second 60000 exceeds 150000 total -> 400; remaining 50000 succeeds
  assert.equal((await req(`/api/repair-center/admin/job/${ref}/refund-record`, 'POST', {
    receipt: pendingRow.receipt,
    amount: 100000,
    reference: 'PARTREF1',
    note: 'Partial refund 1',
    confirmed: true
  }, admin)).status, 200);
  assert.equal((await req(`/api/repair-center/admin/job/${ref}/refund-record`, 'POST', {
    receipt: pendingRow.receipt,
    amount: 60000,
    reference: 'PARTREF2',
    note: 'Exceeds remaining captured',
    confirmed: true
  }, admin)).status, 400);
  // Zero refund rejected
  assert.equal((await req(`/api/repair-center/admin/job/${ref}/refund-record`, 'POST', {
    receipt: pendingRow.receipt,
    amount: 0,
    reference: 'PARTREFZERO',
    note: 'Zero refund',
    confirmed: true
  }, admin)).status, 400);

  // Settle remaining deposit via offline cash (due = 150000 - 50000 net paid = 100000)
  // Overpayment on offline cash rejected 400
  assert.equal((await req(`/api/repair-center/admin/job/${ref}/offline`, 'POST', { amount: 100001, note: 'Over' }, admin)).status, 400);
  assert.equal((await req(`/api/repair-center/admin/job/${ref}/offline`, 'POST', { amount: 100000, note: 'Exact deposit balance' }, admin)).status, 200);

  // Start repair and pass QC
  assert.equal((await req(`/api/repair-center/admin/job/${ref}/stage`, 'POST', { stage: 'repairing' }, admin)).status, 200);
  const checks = Object.fromEntries(['display', 'charging', 'camera', 'audio', 'network', 'buttons', 'condition'].map((k) => [k, 'pass']));
  assert.equal((await req(`/api/repair-center/admin/job/${ref}/quality`, 'POST', { checks }, admin)).status, 200);

  // 4. Atomic stock rollback on completion failure: SKU-RG-OK has stock=3, SKU-RG-LOW has stock=0 -> fails 409 AND SKU-RG-OK remains 3!
  const failComplete = await req(`/api/repair-center/admin/job/${ref}/stage`, 'POST', {
    stage: 'completed',
    work: [true, true],
    warranty: '90 days'
  }, admin);
  assert.equal(failComplete.status, 409);
  assert.equal(db.prepare('SELECT stock FROM products WHERE sku=?').get('SKU-RG-OK').stock, 3, 'Transaction rollback must preserve SKU-RG-OK stock');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rl_stock_usage WHERE ref=?').get(ref).n, 0);

  // Restock SKU-RG-LOW to 1, complete repair, verify stock deducted atomically
  db.prepare('UPDATE products SET stock=1 WHERE sku=?').run('SKU-RG-LOW');
  const okComplete = await req(`/api/repair-center/admin/job/${ref}/stage`, 'POST', {
    stage: 'completed',
    work: [true, true],
    warranty: '90 days'
  }, admin);
  assert.equal(okComplete.status, 200);
  assert.equal(db.prepare('SELECT stock FROM products WHERE sku=?').get('SKU-RG-OK').stock, 2);
  assert.equal(db.prepare('SELECT stock FROM products WHERE sku=?').get('SKU-RG-LOW').stock, 0);
  assert.equal(okComplete.d.paid, 150000);
  assert.equal(okComplete.d.balance, 175000);

  // Pay remaining 175000 and deliver; post-delivery refund blocked (409)
  assert.equal((await req(`/api/repair-center/admin/job/${ref}/offline`, 'POST', { amount: 175000, note: 'Final cash' }, admin)).status, 200);
  const delivered = await req(`/api/repair-center/admin/job/${ref}/stage`, 'POST', { stage: 'delivered' }, admin);
  assert.equal(delivered.status, 200);
  assert.equal(delivered.d.paid, 325000);
  assert.equal(delivered.d.balance, 0);
  assert.equal((await req(`/api/repair-center/admin/job/${ref}/refund-record`, 'POST', {
    receipt: pendingRow.receipt,
    amount: 10000,
    reference: 'POSTDELREF',
    note: 'After delivery',
    confirmed: true
  }, admin)).status, 409);

  // Verify PDF invoice contains accurate net receipts and zero balance
  const pdfRes = await fetch(origin + `/api/extended/pdf/${ref}`, {
    headers: { authorization: 'Bearer ' + custToken }
  });
  assert.equal(pdfRes.status, 200);
  const pdfText = Buffer.from(await pdfRes.arrayBuffer()).toString('latin1');
  assert.match(pdfText, /Total: INR 3250\.00/);
  assert.match(pdfText, /Net verified receipts: INR 3250\.00/);
  assert.match(pdfText, /Balance: INR 0\.00/);
});

test('Phase 4 release gate: simultaneous Razorpay order creation lock (stubbed HTTP)', async () => {
  let gatewayCalls = 0;
  const rc = createRepairCenter({
    db,
    auth: () => ({ username: 'rgowner', role: 'owner', permission: 'owner' }),
    ok: (res, d) => { res.statusCode = 200; res.d = d; },
    bodyJson: async (r) => r.body,
    limit: () => {},
    respond: () => {},
    worker: false,
    env: { RAZORPAY_KEY_ID: 'rzp_x', RAZORPAY_KEY_SECRET: 'sec_x', RAZORPAY_WEBHOOK_SECRET: 'wh_x' },
    http: async (_url, opts) => {
      gatewayCalls++;
      const parsed = JSON.parse(opts.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ id: 'order_Race01', receipt: parsed.receipt, amount: parsed.amount, currency: 'INR' })
      };
    }
  });
  const b = await req('/api/bookings', 'POST', {
    name: 'Gateway Race',
    phone: '9876598766',
    brand: 'Apple',
    model: 'iPhone 14',
    issue: 'Battery',
    method: 'Visit workshop',
    locality: 'Sigra',
    consent: true
  });
  const ref = b.d.ref;
  const tok = b.d.repair_access;
  db.prepare("UPDATE rl_jobs SET stage='approved',total=200000,deposit=100000,version=1 WHERE ref=?").run(ref);
  const url = new URL(origin + `/api/repair-center/job/${ref}/pay`);
  const fakeReq = { method: 'POST', headers: { authorization: 'Bearer ' + tok }, body: {} };
  const r1 = {}, r2 = {};
  const settled = await Promise.allSettled([rc.handle(fakeReq, r1, url), rc.handle(fakeReq, r2, url)]);
  const okCount = settled.filter((x) => x.status === 'fulfilled').length;
  assert.equal(okCount, 1, 'Only 1 concurrent Razorpay order creation may proceed while first is creating');
  assert.equal(gatewayCalls, 1, 'Gateway orders API must be invoked once');
});

test('Windows launcher fixes: browser-access PORT propagation, Intro CMD PORT=3001, Test CMD dependency-free check', () => {
  const browserAccess = readFileSync(join(ROOT, 'scripts', 'browser-access.mjs'), 'utf8');
  assert.ok(browserAccess.includes('PORT:String(port)'), 'browser-access.mjs must pass target PORT to spawned server');

  const introCmd = readFileSync(join(ROOT, 'Watch RepairlyLabs Intro in Chrome.cmd'), 'utf8');
  assert.ok(introCmd.includes('set "PORT=3001"'), 'Intro CMD launcher must set PORT=3001 before starting server');

  const testCmd = readFileSync(join(ROOT, 'Watch RepairlyLabs Test in Chrome.cmd'), 'utf8');
  assert.ok(!testCmd.includes('node_modules'), 'Test CMD launcher must not require node_modules for dependency-free app');
  assert.ok(testCmd.includes('server.mjs'), 'Test CMD launcher should verify server.mjs exists');
});

test.after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
  const realDbAfterMtime = existsSync(REAL_DB) ? statSync(REAL_DB).mtimeMs : null;
  assert.equal(realDbBeforeMtime, realDbAfterMtime, 'Real database must never be touched');
});
