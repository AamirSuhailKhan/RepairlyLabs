import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'rl-indep-audit-'));
process.env.DATA_DIR = dir;
process.env.PORT = '0';
// Intentionally run WITHOUT REPAIRLYLABS_TEST or PUBLIC_LEGACY_CATALOG
// to verify default runtime configuration, iframe headers, and 410 catalog guard.
delete process.env.REPAIRLYLABS_TEST;
delete process.env.PUBLIC_LEGACY_CATALOG;
delete process.env.PUBLIC_ORIGIN;
delete process.env.RAZORPAY_KEY_ID;
delete process.env.RAZORPAY_KEY_SECRET;
delete process.env.RAZORPAY_WEBHOOK_SECRET;
delete process.env.TWILIO_ACCOUNT_SID;
delete process.env.TWILIO_AUTH_TOKEN;
delete process.env.TWILIO_VERIFY_SERVICE_SID;
delete process.env.RL_MFA_KEY;

const { server, db, repairCenter } = await import('../src/server.mjs');
const { issueRecovery } = await import('../src/admin-access.mjs');

if (!server.listening) {
  await new Promise((r) => server.once('listening', r));
}
const origin = `http://127.0.0.1:${server.address().port}`;
const pass = 'AuditPass!2026';
const validPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCZsAAAAASUVORK5CYII=';

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
  const body = ct.includes('application/json')
    ? await r.json()
    : ct.includes('application/pdf')
      ? Buffer.from(await r.arrayBuffer())
      : await r.text();
  return {
    status: r.status,
    headers: r.headers,
    d: body,
    cookie: r.headers.get('set-cookie')?.split(';')[0] || '',
    setCookieFull: r.headers.get('set-cookie') || '',
    csrf: typeof body === 'object' && body && !Buffer.isBuffer(body) ? body.csrf : ''
  };
}

test('independent audit: default runtime headers, full repair lifecycle, spare-parts enquiries, and fixed regressions', async () => {
  try {
    // 1. Default runtime mode: catalog disabled (410), frame-ancestors allows AI Studio, HTTPS proxy gets SameSite=None
    const rootRes = await req('/');
    assert.equal(rootRes.status, 200);
    const csp = rootRes.headers.get('content-security-policy') || '';
    assert.ok(csp.includes('https://aistudio.google.com'), 'CSP should allow AI Studio preview iframe');
    assert.equal(rootRes.headers.get('x-frame-options'), null, 'X-Frame-Options should be omitted outside test mode');
    assert.equal(rootRes.headers.get('x-content-type-options'), 'nosniff');

    assert.equal((await req('/api/products')).status, 410);
    assert.equal((await req('/api/products/1')).status, 410);
    assert.equal(
      (await req('/api/orders', 'POST', { name: 'A', phone: '9876543210', locality: 'Sigra', mode: 'Workshop collection', consent: true, items: [{ id: 1, quantity: 1 }] })).status,
      410
    );

    // Sitemap fails closed (404) when PUBLIC_ORIGIN is unset
    assert.equal((await req('/sitemap.xml')).status, 404);

    // Cross-origin POST check
    assert.equal(
      (await req('/api/contact', 'POST', { name: 'X', phone: '9876543210', message: 'Hi', consent: true }, undefined, undefined, { origin: 'https://evil.example' })).status,
      403
    );

    // Portal & asset live HTTP availability
    for (const p of [
      '/repairs',
      '/parts',
      '/track',
      '/about',
      '/contact',
      '/privacy',
      '/admin',
      '/part-request/',
      '/repair-center/',
      '/operations/',
      '/parts-payment/',
      '/account-recovery/',
      '/api/ready',
      '/api/health',
      '/api/config',
      '/manifest.webmanifest',
      '/robots.txt',
      '/smooth-brand-intro.js',
      '/smooth-brand-intro.css',
      '/assets/brand/prismatic-spiral-transparent.webp',
      '/assets/brand/repairlylabs-logo-128.png'
    ]) {
      const res = await req(p);
      assert.equal(res.status, 200, `Expected 200 for ${p}, got ${res.status}`);
    }

    // 2. Owner recovery + staff roles + cookie SameSite attributes
    assert.equal((await req('/api/admin/recover', 'POST', { token: issueRecovery(db), password: pass, email: 'owner@audit.test' })).status, 200);
    const owner = await req('/api/admin/login', 'POST', { username: 'owner', password: pass });
    assert.equal(owner.status, 200);
    assert.ok(owner.setCookieFull.includes('HttpOnly'));
    assert.ok(owner.setCookieFull.includes('SameSite=Strict'));

    // Simulated HTTPS reverse proxy login (like AI Studio preview proxy) receives SameSite=None; Secure
    const { request: httpRequest } = await import('node:http');
    const proxyOwner = await new Promise((resolve, reject) => {
      const payload = JSON.stringify({ username: 'owner', password: pass });
      const r = httpRequest(
        origin + '/api/admin/login',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(payload),
            'x-forwarded-proto': 'https',
            host: 'audit-preview.run.app',
            origin: 'https://audit-preview.run.app'
          }
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            resolve({
              status: res.statusCode,
              setCookieFull: (res.headers['set-cookie'] || []).join('; '),
              d: JSON.parse(Buffer.concat(chunks).toString('utf8'))
            });
          });
        }
      );
      r.on('error', reject);
      r.end(payload);
    });
    assert.equal(proxyOwner.status, 200);
    assert.ok(proxyOwner.setCookieFull.includes('SameSite=None; Secure'));

    // Create manager, technician, accountant
    for (const [username, permission] of [
      ['mgr1', 'manager'],
      ['tech1', 'technician'],
      ['acc1', 'accountant']
    ]) {
      assert.equal((await req('/api/admin/team', 'POST', { action: 'create', username, password: pass, current: pass, permission }, owner)).status, 200);
    }
    const mgr = await req('/api/admin/login', 'POST', { username: 'mgr1', password: pass });
    const tech = await req('/api/admin/login', 'POST', { username: 'tech1', password: pass });
    const acc = await req('/api/admin/login', 'POST', { username: 'acc1', password: pass });
    assert.equal(mgr.status, 200);
    assert.equal(tech.status, 200);
    assert.equal(acc.status, 200);

    // CSRF missing check
    const noCsrf = await fetch(origin + '/api/admin/settings', {
      method: 'PATCH',
      headers: { origin, cookie: owner.cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ phone: '9876543210' })
    });
    assert.equal(noCsrf.status, 403);

    // Fix verification: invalid notification-retry ID rejected with 400
    assert.equal((await req('/api/repair-center/admin/notification-retry', 'POST', { id: 'abc' }, owner)).status, 400);
    assert.equal((await req('/api/repair-center/admin/notification-retry', 'POST', { id: 0 }, owner)).status, 400);
    assert.equal((await req('/api/repair-center/admin/notification-retry', 'POST', { id: -5 }, owner)).status, 400);

    // Fail-closed 503 when external providers unconfigured
    assert.equal((await req('/api/extended/otp/start', 'POST', { phone: '9876543210' })).status, 503);
    assert.equal((await req('/api/repair-center/webhook', 'POST', {})).status, 503);

    // 3. Complete repair lifecycle (RLM-...) + cancelled logistics guard
    const bookingPayload = {
      name: 'Audit Customer',
      phone: '9876543210',
      brand: 'Samsung',
      model: 'Galaxy S24',
      issue: 'Screen Replacement',
      method: 'Visit workshop',
      locality: 'Sigra',
      consent: true
    };
    const bRes = await req('/api/bookings', 'POST', bookingPayload);
    assert.equal(bRes.status, 201);
    assert.ok(/^RLM-\d{6}-[0-9A-F]{8}$/.test(bRes.d.ref));
    assert.equal(bRes.d.repair_access.length, 43);

    // Duplicate booking blocked
    assert.equal((await req('/api/bookings', 'POST', bookingPayload)).status, 409);

    // Customer tracking requires matching phone
    assert.equal((await req(`/api/track?ref=${bRes.d.ref}&phone=9999999999`)).status, 404);
    assert.equal((await req(`/api/track?ref=${bRes.d.ref}&phone=9876543210`)).status, 200);

    const admJob = `/api/repair-center/admin/job/${bRes.d.ref}`;
    const custJob = `/api/repair-center/job/${bRes.d.ref}`;

    // Tech cannot view unassigned job
    assert.equal((await req(admJob, 'GET', undefined, tech)).status, 403);
    // Assign tech1
    assert.equal((await req(admJob + '/assign', 'POST', { tech: 'tech1' }, mgr)).status, 200);
    // Diagnosis by tech1
    assert.equal((await req(admJob + '/diagnosis', 'POST', { diagnosis: 'Cracked AMOLED assembly' }, tech)).status, 200);
    // Quotation by manager
    assert.equal(
      (await req(admJob + '/quote', 'POST', { items: [{ name: 'Display assembly', qty: 1, price: 450000 }], labor: 50000, discount: 0, deposit: 200000 }, mgr)).status,
      200
    );
    // Customer approves quote v1
    assert.equal((await req(custJob + '/approve', 'POST', { version: 1 }, undefined, bRes.d.repair_access)).status, 200);
    // Unconfigured Razorpay pay fails closed (503)
    assert.equal((await req(custJob + '/pay', 'POST', {}, undefined, bRes.d.repair_access)).status, 503);

    // Owner enables static UPI QR; customer submits UTR claim; accountant verifies bank credit
    assert.equal((await req('/api/repair-center/admin/qr-settings', 'POST', { enabled: true, merchant: 'RepairlyLabs', upi: 'shop@upi', image: validPng, current: pass }, owner)).status, 200);
    const qrClaim = await req(custJob + '/qr-claim', 'POST', { amount: 200000, utr: 'AUDITUTR123456', version: 1, proof: validPng }, undefined, bRes.d.repair_access);
    assert.equal(qrClaim.status, 200);
    assert.equal(qrClaim.d.paid, 0);
    assert.equal(qrClaim.d.open_payment, 'awaiting_verification');

    const payRows = (await req(admJob, 'GET', undefined, acc)).d.payments;
    assert.equal((await req(admJob + '/qr-review', 'POST', { receipt: payRows[0].receipt, decision: 'approve', note: 'Bank credit verified', confirmed: true }, acc)).status, 200);

    // Tech executes repair + QC + completion
    assert.equal((await req(admJob + '/stage', 'POST', { stage: 'repairing' }, tech)).status, 200);
    const checks = Object.fromEntries(['display', 'charging', 'camera', 'audio', 'network', 'buttons', 'condition'].map((k) => [k, 'pass']));
    assert.equal((await req(admJob + '/quality', 'POST', { checks }, tech)).status, 200);
    assert.equal((await req(admJob + '/stage', 'POST', { stage: 'completed', work: [true], warranty: '90 days' }, tech)).status, 200);

    // Tech cannot mark delivered (role boundary)
    assert.equal((await req(admJob + '/stage', 'POST', { stage: 'delivered' }, tech)).status, 403);
    // Remaining balance recorded by accountant, then manager delivers
    assert.equal((await req(admJob + '/offline', 'POST', { amount: 300000, note: 'Cash balance paid' }, acc)).status, 200);
    assert.equal((await req(admJob + '/stage', 'POST', { stage: 'delivered' }, mgr)).status, 200);

    // PDF invoice generation succeeds with customer access token
    const pdfRes = await req(`/api/extended/pdf/${bRes.d.ref}`, 'GET', undefined, undefined, bRes.d.repair_access);
    assert.equal(pdfRes.status, 200);
    assert.equal(pdfRes.d.subarray(0, 8).toString(), '%PDF-1.4');

    // Fix verification: cancelled repair rejects logistics update (409)
    const bCancel = await req('/api/bookings', 'POST', { ...bookingPayload, phone: '9876543211', model: 'Pixel 8' });
    assert.equal(bCancel.status, 201);
    assert.equal((await req(`/api/repair-center/admin/job/${bCancel.d.ref}/cancel`, 'POST', {}, mgr)).status, 200);
    assert.equal((await req(`/api/extended/job/${bCancel.d.ref}/delivery`, 'POST', { stage: 'pickup_scheduled' }, mgr)).status, 409);

    // 4. Complete spare-parts enquiry lifecycle (RLI-...)
    const partBase = {
      name: 'Parts Enquirer',
      phone: '9876543212',
      brand: 'Vivo',
      model: 'Vivo V40',
      category: 'Display & touchscreen',
      qty: 1,
      description: 'Need AMOLED display assembly',
      grade: 'Original / OEM preference',
      urgency: 'This week',
      method: 'Delivery requested',
      locality: 'Andheri East',
      city: 'Mumbai',
      region: 'Maharashtra',
      pincode: '400069',
      address: 'Flat 12, Marol Road, Andheri East',
      consent: true,
      request_key: 'c'.repeat(64)
    };
    // Invalid PIN rejected
    assert.equal((await req('/api/part-inquiries', 'POST', { ...partBase, pincode: '000000' })).status, 400);
    // Spoofed image magic bytes rejected
    assert.equal((await req('/api/part-inquiries', 'POST', { ...partBase, image: 'data:image/png;base64,AAAAAAAAAAAA' })).status, 400);
    const pRes = await req('/api/part-inquiries', 'POST', { ...partBase, image: validPng });
    assert.equal(pRes.status, 201, JSON.stringify(pRes.d));
    assert.ok(/^RLI-\d{6}-[0-9A-F]{16}$/.test(pRes.d.ref));

    // Customer checks enquiry
    const pView = await req('/api/part-inquiries/access', 'POST', { ref: pRes.d.ref, access: pRes.d.access });
    assert.equal(pView.status, 200);
    assert.equal(pView.d.status, 'received');

    // Staff cannot mark in_stock without price or set expiry in the past
    assert.equal((await req(`/api/part-inquiries/admin/${pRes.d.ref}`, 'PATCH', { status: 'quoted', availability: 'in_stock', price_rupees: 0, delivery_rupees: 0 }, mgr)).status, 400);
    assert.equal(
      (await req(`/api/part-inquiries/admin/${pRes.d.ref}`, 'PATCH', { status: 'quoted', availability: 'in_stock', price_rupees: 4200, delivery_rupees: 150, eta: '2 days', quote_valid_until: '2020-01-01', quote_note: 'OEM pack' }, mgr)).status,
      400
    );
    assert.equal(
      (await req(`/api/part-inquiries/admin/${pRes.d.ref}`, 'PATCH', { status: 'quoted', availability: 'in_stock', price_rupees: 4200, delivery_rupees: 150, eta: '2 days', quote_valid_until: '2099-12-31', quote_note: 'OEM pack' }, mgr)).status,
      200
    );
    // Simulate quote passing its expiry date and verify customer cannot accept expired quote (409)
    db.prepare('UPDATE rl_part_inquiries SET quote_valid_until=? WHERE ref=?').run('2020-01-01', pRes.d.ref);
    assert.equal((await req('/api/part-inquiries/decision', 'POST', { ref: pRes.d.ref, access: pRes.d.access, decision: 'accept' })).status, 409);

    // Restore future validity and accept once; conflicting subsequent decision fails (409)
    db.prepare('UPDATE rl_part_inquiries SET quote_valid_until=? WHERE ref=?').run('2099-12-31', pRes.d.ref);
    assert.equal((await req('/api/part-inquiries/decision', 'POST', { ref: pRes.d.ref, access: pRes.d.access, decision: 'accept' })).status, 200);
    assert.equal((await req('/api/part-inquiries/decision', 'POST', { ref: pRes.d.ref, access: pRes.d.access, decision: 'decline' })).status, 409);

    // 5. Static frontend code checks for UX/cross-browser bug fixes
    const mainAppJs = readFileSync(resolve('public/app.js'), 'utf8');
    assert.ok(mainAppJs.includes("dRaw.replace(' ','T')"), 'renderTrack should normalize space before T for Safari');
    assert.ok(mainAppJs.includes("try{state.products=(await api('/api/products?limit=100')).items;}catch{state.products=[];}"), 'admin-product should ignore 410 when legacy catalog is off');

    const rcAppJs = readFileSync(resolve('public/repair-center/app.js'), 'utf8');
    assert.ok(!rcAppJs.includes('<form id="diagnosis" class="stack"><label>Technician account username<input name="tech"'), 'Diagnosis form should not display misleading editable tech input');
    assert.ok(rcAppJs.includes("['owner','manager'].includes(staffRole)?`<button data-stage=\"delivered\""), 'Mark delivered button should be hidden from technicians');

    const prAppJs = readFileSync(resolve('public/part-request/app.js'), 'utf8');
    assert.ok(prAppJs.includes("models(type.get('brand'))"), 'Brand prefill from URL should load model autocomplete list');

    const introJs = readFileSync(resolve('public/smooth-brand-intro.js'), 'utf8');
    assert.ok(introJs.includes("e.key === 'Escape'") && introJs.includes("removeEventListener('keydown', onKey)"), 'Cinematic intro should support Escape dismissal with cleanup');
  } finally {
    repairCenter.close();
    await new Promise((r) => server.close(r));
    rmSync(dir, { recursive: true, force: true });
  }
});
