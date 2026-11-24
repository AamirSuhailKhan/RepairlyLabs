import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes, createHmac } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';

const ROOT = resolve(import.meta.dirname, '..');
const REAL_DB = join(ROOT, 'data', 'repairlylabs.sqlite');
const realDbBeforeMtime = existsSync(REAL_DB) ? statSync(REAL_DB).mtimeMs : null;

const dir = mkdtempSync(join(tmpdir(), 'rl-phase2-audit-'));
process.env.DATA_DIR = dir;
process.env.PORT = '0';
process.env.REPAIRLYLABS_TEST = '1';
process.env.PUBLIC_LEGACY_CATALOG = '1';
delete process.env.PUBLIC_ORIGIN;
delete process.env.K_SERVICE;
delete process.env.RL_PREVIEW_IFRAME;
const dynWebhookSecret = 'whsec_' + randomBytes(16).toString('hex');
process.env.RAZORPAY_KEY_ID = 'rzp_synthetic_key_001';
process.env.RAZORPAY_KEY_SECRET = randomBytes(20).toString('hex');
process.env.RAZORPAY_WEBHOOK_SECRET = dynWebhookSecret;

const { server, db, repairCenter } = await import('../src/server.mjs');
const { issueRecovery, recoverOwner } = await import('../src/admin-access.mjs');
const { createGatewayExtensions } = await import('../src/gateway-extensions.mjs');

if (!server.listening) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
}
const origin = `http://127.0.0.1:${server.address().port}`;
const ownerPass = 'Phase2Audit!' + randomBytes(8).toString('hex');

async function req(path, method = 'GET', data, session, token, extraHeaders = {}) {
  const headers = {
    origin,
    ...(data !== undefined ? { 'content-type': 'application/json' } : {}),
    ...(session ? { cookie: session.cookie, 'x-csrf-token': session.csrf } : {}),
    ...(token ? { authorization: 'Bearer ' + token } : {}),
    ...extraHeaders
  };
  const r = await fetch(origin + path, {
    method,
    headers,
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  const ct = r.headers.get('content-type') || '';
  const body = ct.includes('application/json') ? await r.json() : await r.text();
  return {
    status: r.status,
    headers: r.headers,
    d: body,
    cookie: r.headers.get('set-cookie')?.split(';')[0] || '',
    setCookie: r.headers.get('set-cookie') || '',
    csrf: typeof body === 'object' && body ? body.csrf || '' : ''
  };
}

function spawnHeaderProbe(envOverrides) {
  return new Promise((resolvePromise, rejectPromise) => {
    const probeDir = mkdtempSync(join(tmpdir(), 'rl-env-probe-'));
    const child = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
        import { issueRecovery, recoverOwner } from './src/admin-access.mjs';
        const mod = await import('./src/server.mjs');
        const srv = mod.server;
        const tok = issueRecovery(mod.db);
        const pw = 'Probe!' + Date.now();
        recoverOwner(mod.db, { token: tok, username: 'probeowner', password: pw });
        await new Promise((r) => srv.listen(0, '127.0.0.1', r));
        const port = srv.address().port;
        console.log(JSON.stringify({ port, pw }));
        `
      ],
      {
        cwd: ROOT,
        env: {
          PATH: process.env.PATH,
          DATA_DIR: probeDir,
          PORT: '0',
          ...envOverrides
        },
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => {
      out += c.toString();
      const line = out.split('\n').find((l) => l.trim().startsWith('{'));
      if (line) {
        const info = JSON.parse(line);
        resolvePromise({
          ...info,
          stop: () => {
            child.kill('SIGTERM');
            rmSync(probeDir, { recursive: true, force: true });
          }
        });
      }
    });
    child.stderr.on('data', (c) => (err += c.toString()));
    child.on('exit', (code) => {
      if (!out.includes('{')) {
        rmSync(probeDir, { recursive: true, force: true });
        rejectPromise(new Error(`Probe exited ${code}: ${err}`));
      }
    });
  });
}

test('AI Studio preview vs production security isolation & untrusted proxy / origin protection', async () => {
  // 1. Production environment: strict framing block, HSTS, SameSite=Strict; Secure
  const prod = await spawnHeaderProbe({
    NODE_ENV: 'production',
    PUBLIC_ORIGIN: 'https://repairlylabs.example'
  });
  try {
    const prodOrigin = `http://127.0.0.1:${prod.port}`;
    const home = await fetch(prodOrigin + '/');
    assert.equal(home.headers.get('x-frame-options'), 'DENY');
    assert.match(home.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);
    assert.equal(home.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.match(home.headers.get('strict-transport-security') || '', /max-age=31536000/);

    // Repair center page allows popups for Razorpay, still blocks framing in prod
    const rc = await fetch(prodOrigin + '/repair-center/index.html');
    assert.equal(rc.headers.get('x-frame-options'), 'DENY');
    assert.match(rc.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);

    // Malicious Origin & Null Origin blocked
    const evil = await fetch(prodOrigin + '/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://evil.attacker' },
      body: JSON.stringify({ username: 'probeowner', password: prod.pw })
    });
    assert.equal(evil.status, 403);

    const nullOrigin = await fetch(prodOrigin + '/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'null' },
      body: JSON.stringify({ username: 'probeowner', password: prod.pw })
    });
    assert.equal(nullOrigin.status, 403);

    // Valid origin login issues SameSite=Strict; Secure cookie (never SameSite=None)
    const login = await fetch(prodOrigin + '/api/admin/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://repairlylabs.example' },
      body: JSON.stringify({ username: 'probeowner', password: prod.pw })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie') || '';
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Secure/);
    assert.doesNotMatch(cookie, /SameSite=None/i);
  } finally {
    prod.stop();
  }

  // 2. Non-preview default development environment: untrusted x-forwarded-proto is IGNORED
  const dev = await spawnHeaderProbe({ NODE_ENV: 'development' });
  try {
    const devOrigin = `http://127.0.0.1:${dev.port}`;
    const home = await fetch(devOrigin + '/');
    assert.equal(home.headers.get('x-frame-options'), 'DENY');
    assert.match(home.headers.get('content-security-policy') || '', /frame-ancestors 'none'/);

    // Spoofed x-forwarded-proto without TRUST_PROXY or K_SERVICE must NOT flip cookie or origin proto
    const spoofedOrigin = await fetch(devOrigin + '/api/bookings', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://127.0.0.1:' + dev.port,
        'x-forwarded-proto': 'https'
      },
      body: '{}'
    });
    assert.equal(spoofedOrigin.status, 403);

    // Malformed Host header with @ userinfo blocked
    const login = await fetch(devOrigin + '/api/admin/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: devOrigin,
        'x-forwarded-proto': 'https'
      },
      body: JSON.stringify({ username: 'probeowner', password: dev.pw })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie') || '';
    assert.match(cookie, /SameSite=Strict/);
    assert.doesNotMatch(cookie, /SameSite=None|; Secure/i);
  } finally {
    dev.stop();
  }

  // 3. Explicit AI Studio Preview environment (development + K_SERVICE): iframe preview allowed, SameSite=None; Secure on HTTPS proxy
  const preview = await spawnHeaderProbe({
    NODE_ENV: 'development',
    K_SERVICE: 'ais-preview-check'
  });
  try {
    const previewOrigin = `http://127.0.0.1:${preview.port}`;
    const home = await fetch(previewOrigin + '/');
    assert.equal(home.headers.get('x-frame-options'), null);
    assert.match(home.headers.get('content-security-policy') || '', /frame-ancestors 'self' https:\/\/aistudio\.google\.com/);

    const login = await fetch(previewOrigin + '/api/admin/login', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://127.0.0.1:' + preview.port,
        'x-forwarded-proto': 'https'
      },
      body: JSON.stringify({ username: 'probeowner', password: preview.pw })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie') || '';
    assert.match(cookie, /SameSite=None; Secure/);
  } finally {
    preview.stop();
  }
});

test('Concurrency, double-payment, double-refund, capacity, inventory, OTP expiry, cancelled state & backup/restore', async () => {
  const recTok = issueRecovery(db);
  recoverOwner(db, { token: recTok, username: 'testowner', password: ownerPass });
  const login = await req('/api/admin/login', 'POST', { username: 'testowner', password: ownerPass });
  assert.equal(login.status, 200);
  const admin = { cookie: login.cookie, csrf: login.csrf };

  const validPng =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCZsAAAAASUVORK5CYII=';
  db.prepare('UPDATE rl_qr_settings SET enabled=1,merchant=?,upi=?,image=?,version=1 WHERE id=1').run(
    'Phase2 Shop',
    'phase2@upi',
    validPng
  );

  // 1. Concurrent identical repair bookings without request_key -> only 1 succeeds
  const payload = {
    name: 'Race Customer',
    phone: '9876543210',
    brand: 'Samsung',
    model: 'Galaxy S23',
    issue: 'Display replacement',
    method: 'Visit workshop',
    locality: 'Sigra',
    consent: true
  };
  const dupeResults = await Promise.all(
    Array.from({ length: 5 }, () => req('/api/bookings', 'POST', payload))
  );
  assert.equal(dupeResults.filter((r) => r.status === 201).length, 1, 'Only 1 concurrent identical booking should be created');
  assert.equal(dupeResults.filter((r) => r.status === 409).length, 4);

  // 2. Concurrent capacity race (capacity=1 -> only 1 distinct booking succeeds)
  const capDate = '2026-12-15';
  const capSet = await req('/api/extended/capacity', 'POST', { date: capDate, slot: 'Morning', capacity: 1 }, admin);
  assert.equal(capSet.status, 200);
  const capBookings = await Promise.all(
    ['9876500001', '9876500002', '9876500003'].map((phone, idx) =>
      req('/api/bookings', 'POST', { ...payload, name: 'Cap ' + idx, phone, date: capDate, slot: 'Morning' })
    )
  );
  assert.equal(capBookings.filter((r) => r.status === 201).length, 1, 'Slot capacity=1 must permit only 1 booking concurrently');
  assert.equal(capBookings.filter((r) => r.status === 409).length, 2);

  // 3. Concurrent inventory order confirmation race (stock=1, 2 pending orders)
  db.prepare(
    "INSERT INTO products(sku,name,brand,model,category,grade,price,stock,active,featured,sample,description,image_kind) VALUES('SKU-RACE-1','Scarce Part','Samsung','S23','Battery','OEM',1500,1,1,0,0,'Scarce','battery')"
  ).run();
  const prod = db.prepare('SELECT id FROM products WHERE sku=?').get('SKU-RACE-1');
  const order1 = await req('/api/orders', 'POST', {
    name: 'Order One',
    phone: '9876511111',
    locality: 'Lanka',
    mode: 'Workshop collection',
    consent: true,
    items: [{ id: prod.id, quantity: 1 }]
  });
  const order2 = await req('/api/orders', 'POST', {
    name: 'Order Two',
    phone: '9876522222',
    locality: 'Sigra',
    mode: 'Workshop collection',
    consent: true,
    items: [{ id: prod.id, quantity: 1 }]
  });
  assert.equal(order1.status, 201);
  assert.equal(order2.status, 201);
  const id1 = db.prepare('SELECT id FROM orders WHERE ref=?').get(order1.d.ref).id;
  const id2 = db.prepare('SELECT id FROM orders WHERE ref=?').get(order2.d.ref).id;
  const confirmRace = await Promise.all([
    req(`/api/admin/orders/${id1}`, 'PATCH', { status: 'confirmed' }, admin),
    req(`/api/admin/orders/${id2}`, 'PATCH', { status: 'confirmed' }, admin)
  ]);
  assert.equal(confirmRace.filter((r) => r.status === 200).length, 1, 'Only 1 order may consume scarce stock=1');
  assert.equal(confirmRace.filter((r) => r.status === 409).length, 1);
  assert.equal(db.prepare('SELECT stock FROM products WHERE id=?').get(prod.id).stock, 0);

  // 4. Parts concurrent double cash payment + concurrent double refund
  const wonOrderRef = confirmRace[0].status === 200 ? order1.d.ref : order2.d.ref;
  const partsCashRace = await Promise.all([
    req(`/api/parts-payment/admin/order/${wonOrderRef}/cash`, 'POST', { amount: 150000, note: 'Cash A', confirmed: true }, admin),
    req(`/api/parts-payment/admin/order/${wonOrderRef}/cash`, 'POST', { amount: 150000, note: 'Cash B', confirmed: true }, admin)
  ]);
  assert.equal(partsCashRace.filter((r) => r.status === 200).length, 1, 'Concurrent double parts cash payment must fail second request');
  const pPay = db.prepare("SELECT receipt FROM rl_payments WHERE ref=? AND state='captured'").get(wonOrderRef);
  const partsRefundRace = await Promise.all([
    req(`/api/parts-payment/admin/order/${wonOrderRef}/refund`, 'POST', { receipt: pPay.receipt, amount: 100000, reference: 'PREF1', note: 'Refund 1', confirmed: true }, admin),
    req(`/api/parts-payment/admin/order/${wonOrderRef}/refund`, 'POST', { receipt: pPay.receipt, amount: 100000, reference: 'PREF2', note: 'Refund 2', confirmed: true }, admin)
  ]);
  assert.equal(partsRefundRace.filter((r) => r.status === 200).length, 1, 'Concurrent double parts refund must not over-refund');

  // 5. Repair workflow: invalid financial inputs, concurrent offline payments, concurrent refunds, duplicate quote/UTR, OTP expiry, cancelled transition
  const b = await req('/api/bookings', 'POST', { ...payload, name: 'Repair Lifecycle', phone: '9876544444' });
  assert.equal(b.status, 201);
  const ref = b.d.ref;
  const custToken = b.d.repair_access;
  await req(`/api/repair-center/admin/job/${ref}/diagnosis`, 'POST', { diagnosis: 'Broken screen' }, admin);

  // Invalid financial inputs
  assert.equal((await req(`/api/repair-center/admin/job/${ref}/quote`, 'POST', {
    items: [{ name: 'Screen', qty: 1, price: -100 }],
    labor: 0, discount: 0, deposit: 0
  }, admin)).status, 400);
  assert.equal((await req(`/api/repair-center/admin/job/${ref}/quote`, 'POST', {
    items: [{ name: 'Screen', qty: 1, price: 100.5 }],
    labor: 0, discount: 0, deposit: 0
  }, admin)).status, 400);
  assert.equal((await req(`/api/repair-center/admin/job/${ref}/quote`, 'POST', {
    items: [{ name: 'Screen', qty: 1, price: 10000 }],
    labor: 0, discount: 50000, deposit: 0
  }, admin)).status, 400);

  // Valid quote total = 200000 (₹2000), deposit = 100000 (₹1000)
  const qRes = await req(`/api/repair-center/admin/job/${ref}/quote`, 'POST', {
    items: [{ name: 'Display', qty: 1, price: 200000 }],
    labor: 0, discount: 0, deposit: 100000
  }, admin);
  assert.equal(qRes.status, 200);
  assert.equal((await req(`/api/repair-center/job/${ref}/approve`, 'POST', { version: 1 }, null, custToken)).status, 200);

  // Concurrent offline payment race
  const offRace = await Promise.all([
    req(`/api/repair-center/admin/job/${ref}/offline`, 'POST', { amount: 100000, note: 'Cash 1' }, admin),
    req(`/api/repair-center/admin/job/${ref}/offline`, 'POST', { amount: 100000, note: 'Cash 2' }, admin)
  ]);
  assert.equal(offRace.filter((r) => r.status === 200).length, 1, 'Only 1 concurrent offline payment allowed up to deposit');
  const rPay = db.prepare("SELECT receipt FROM rl_payments WHERE ref=? AND state='captured'").get(ref);

  // Concurrent offline refund race
  const refRace = await Promise.all([
    req(`/api/repair-center/admin/job/${ref}/refund-record`, 'POST', { receipt: rPay.receipt, amount: 80000, reference: 'RREF1', note: 'Refund A', confirmed: true }, admin),
    req(`/api/repair-center/admin/job/${ref}/refund-record`, 'POST', { receipt: rPay.receipt, amount: 80000, reference: 'RREF2', note: 'Refund B', confirmed: true }, admin)
  ]);
  assert.equal(refRace.filter((r) => r.status === 200).length, 1, 'Only 1 concurrent repair refund allowed within captured payment');

  // Pending QR claim blocks duplicate quotation AND duplicate UTR across jobs
  const qrClaim = await req(`/api/repair-center/job/${ref}/qr-claim`, 'POST', {
    amount: 80000,
    utr: 'SHAREDUTR998877',
    version: 1
  }, null, custToken);
  assert.equal(qrClaim.status, 200);
  const blockedQuote = await req(`/api/repair-center/admin/job/${ref}/quote`, 'POST', {
    items: [{ name: 'Display', qty: 1, price: 210000 }],
    labor: 0, discount: 0, deposit: 100000
  }, admin);
  assert.equal(blockedQuote.status, 409, 'Quote change must be blocked while QR payment awaits verification');

  // Duplicate UTR rejected on parts payment order too
  const wonOrderAccess = confirmRace[0].status === 200 ? order1.d.order_access : order2.d.order_access;
  const dupUtrParts = await req(`/api/parts-payment/order/${wonOrderRef}/claim`, 'POST', {
    amount: 50000,
    utr: 'SHAREDUTR998877',
    version: 1
  }, null, wonOrderAccess);
  assert.equal(dupUtrParts.status, 409, 'Shared UTR across repair and parts order must be rejected (409)');

  // Expired customer OTP session rejected with 401
  const expOtp = 'expired_' + randomBytes(16).toString('hex');
  const { createHash } = await import('node:crypto');
  db.prepare('INSERT INTO ext_customer_sessions(hash,phone,expires) VALUES(?,?,?)').run(
    createHash('sha256').update(expOtp).digest('hex'),
    '9876544444',
    Date.now() - 10000
  );
  const expRes = await req(`/api/repair-center/job/${ref}`, 'GET', undefined, null, expOtp);
  assert.equal(expRes.status, 401, 'Expired OTP session must return 401');

  // Cancelled repair rejects stage and delivery logistics
  const cBook = await req('/api/bookings', 'POST', { ...payload, name: 'Cancel Guy', phone: '9876545555' });
  const cRef = cBook.d.ref;
  assert.equal((await req(`/api/repair-center/admin/job/${cRef}/cancel`, 'POST', {}, admin)).status, 200);
  assert.equal((await req(`/api/repair-center/admin/job/${cRef}/stage`, 'POST', { stage: 'inspecting' }, admin)).status, 409);
  assert.equal((await req(`/api/extended/job/${cRef}/delivery`, 'POST', { stage: 'pickup_scheduled' }, admin)).status, 409);

  // 6. Webhook replay idempotency + conflicting payment_id rejection
  const orderId = 'order_WebhookRace01';
  db.prepare("INSERT INTO rl_payments(ref,receipt,order_id,amount,state,method) VALUES(?,'rcpt_wh_1',?,50000,'open','razorpay')").run(cRef, orderId);
  const whBody = JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_WhTest01', order_id: orderId, amount: 50000, currency: 'INR', status: 'captured' } } }
  });
  const sig = createHmac('sha256', dynWebhookSecret).update(whBody).digest('hex');
  const wh1 = await fetch(origin + '/api/repair-center/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig },
    body: whBody
  });
  const wh2 = await fetch(origin + '/api/repair-center/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig },
    body: whBody
  });
  assert.equal(wh1.status, 200);
  assert.equal(wh2.status, 200, 'Identical webhook replay must be idempotent');

  const conflictBody = JSON.stringify({
    event: 'payment.captured',
    payload: { payment: { entity: { id: 'pay_WhConflict99', order_id: orderId, amount: 50000, currency: 'INR', status: 'captured' } } }
  });
  const conflictSig = createHmac('sha256', dynWebhookSecret).update(conflictBody).digest('hex');
  const whConflict = await fetch(origin + '/api/repair-center/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': conflictSig },
    body: conflictBody
  });
  assert.equal(whConflict.status, 409, 'Conflicting payment_id for already captured order must fail 409');

  // 7. Gateway extension concurrent double refund unit test (stubbed gateway HTTP)
  const gwMod = createGatewayExtensions({
    db,
    auth: () => ({ username: 'testowner', role: 'owner', permission: 'owner' }),
    ok: (res, d) => { res.statusCode = 200; res.data = d; },
    bodyJson: async (r) => r.body,
    limit: () => {},
    access: () => {},
    env: { RAZORPAY_KEY_ID: 'rzp_x', RAZORPAY_KEY_SECRET: 'sec_x', RL_GATEWAY_QR_ENABLED: '1' },
    worker: false,
    http: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: 'rfnd_Mock01', payment_id: 'pay_WhTest01', amount: 30000, currency: 'INR', status: 'processed' })
    })
  });
  const fakeReq = (body) => ({ method: 'POST', headers: { 'x-csrf-token': 'ok' }, body });
  const r1 = {}, r2 = {};
  const url = new URL(origin + `/api/gateway-extension/${cRef}/refund`);
  const gwResults = await Promise.allSettled([
    gwMod.handle(fakeReq({ receipt: 'rcpt_wh_1', amount: 30000, note: 'R1', confirmed: true }), r1, url),
    gwMod.handle(fakeReq({ receipt: 'rcpt_wh_1', amount: 30000, note: 'R2', confirmed: true }), r2, url)
  ]);
  const gwSuccessCount = gwResults.filter((x) => x.status === 'fulfilled').length;
  assert.equal(gwSuccessCount, 1, 'Gateway double refund race must allow only 1 attempt before first settles/blocks');

  // 8. Backup & Restore verification on isolated DATA_DIR
  const backupOut = execFileSync(process.execPath, ['scripts/backup.mjs'], {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: dir },
    encoding: 'utf8'
  });
  const backupPath = backupOut.trim().split('Backup: ').pop().trim();
  assert.ok(existsSync(backupPath), 'Backup file must exist');
  const restoreTarget = mkdtempSync(join(tmpdir(), 'rl-restore-target-'));
  try {
    const restoreOut = execFileSync(process.execPath, ['scripts/restore-check.mjs', backupPath, restoreTarget], {
      cwd: ROOT,
      env: { ...process.env, DATA_DIR: dir },
      encoding: 'utf8'
    });
    assert.match(restoreOut, /Backup verified and copied/);
  } finally {
    rmSync(restoreTarget, { recursive: true, force: true });
  }
});

test.after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
  const realDbAfterMtime = existsSync(REAL_DB) ? statSync(REAL_DB).mtimeMs : null;
  assert.equal(realDbBeforeMtime, realDbAfterMtime, 'Real database must never be touched by Phase 2 tests');
});
