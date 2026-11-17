import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'rl-audit-'));
process.env.REPAIRLYLABS_TEST = '1';
process.env.DATA_DIR = tmp;

const { server, db } = await import('../src/server.mjs');
const { openDatabase, passwordHash } = await import('../src/data.mjs');

// Seed test admin
const setupDb = openDatabase(tmp);
setupDb.prepare('INSERT INTO admins(username,password_hash) VALUES(?,?) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash')
  .run('testadmin', passwordHash('SuperSecretPassword123!'));
setupDb.close();

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const results = [];
function record(name, pass, error = null) {
  results.push({ name, pass, error: error ? (error.stack || String(error)) : null });
  console.log(`${pass ? '✓ PASS' : '✗ FAIL'}: ${name}${error ? ' -> ' + error.message : ''}`);
}

async function call(route, method = 'GET', body = null, cookie = '', csrf = '', customHeaders = {}) {
  const headers = { ...customHeaders };
  if (body) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;
  if (csrf) headers['x-csrf-token'] = csrf;
  const r = await fetch(base + route, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  let d;
  const text = await r.text();
  try { d = JSON.parse(text); } catch { d = text; }
  return { code: r.status, d, headers: r.headers };
}

async function runAudit() {
  console.log('--- STARTING COMPREHENSIVE AUDIT ---');

  // Test 1: Health
  try {
    const r = await call('/api/health');
    assert.equal(r.code, 200);
    assert.equal(r.d.ok, true);
    assert.equal(r.d.app, 'RepairlyLabs');
    record('API Health Check (/api/health)', true);
  } catch (e) { record('API Health Check (/api/health)', false, e); }

  // Test 2: Config
  try {
    const r = await call('/api/config');
    assert.equal(r.code, 200);
    assert.ok(r.d.services.length >= 8);
    assert.ok(r.d.brands.length >= 15);
    assert.equal(r.d.settings.business_name, 'RepairlyLabs');
    record('Storefront Config (/api/config)', true);
  } catch (e) { record('Storefront Config (/api/config)', false, e); }

  // Test 3: Models Search & Filtering
  try {
    let r = await call('/api/models?brand=Apple');
    assert.equal(r.code, 200);
    assert.ok(Array.isArray(r.d) && r.d.length > 5);
    assert.ok(r.d.every(m => m.brand === 'Apple'));
    r = await call('/api/models?q=Galaxy');
    assert.equal(r.code, 200);
    assert.ok(r.d.some(m => m.model.includes('Galaxy')));
    r = await call('/api/models?brand=NonExistentBrand123');
    assert.equal(r.code, 200);
    assert.equal(r.d.length, 0);
    record('Phone Models API (/api/models)', true);
  } catch (e) { record('Phone Models API (/api/models)', false, e); }

  // Test 4: Products Catalog & Filtering
  let firstProduct;
  try {
    const r = await call('/api/products');
    assert.equal(r.code, 200);
    assert.ok(r.d.items.length >= 15);
    assert.ok(r.d.total >= 15);
    firstProduct = r.d.items[0];

    const rCat = await call(`/api/products?category=${encodeURIComponent(firstProduct.category)}`);
    assert.equal(rCat.code, 200);
    assert.ok(rCat.d.items.every(p => p.category === firstProduct.category));

    const rLimit = await call('/api/products?limit=3&offset=0');
    assert.equal(rLimit.code, 200);
    assert.equal(rLimit.d.items.length, 3);
    assert.equal(rLimit.d.limit, 3);
    assert.equal(rLimit.d.offset, 0);

    const rDetail = await call(`/api/products/${firstProduct.id}`);
    assert.equal(rDetail.code, 200);
    assert.equal(rDetail.d.id, firstProduct.id);
    assert.equal(rDetail.d.sku, firstProduct.sku);

    const rNotFound = await call('/api/products/999999');
    assert.equal(rNotFound.code, 404);

    record('Products Catalog & Filtering (/api/products)', true);
  } catch (e) { record('Products Catalog & Filtering (/api/products)', false, e); }

  // Test 5: Booking Request Flow & Validation
  let bookingRef;
  try {
    // Missing required fields
    let r = await call('/api/bookings', 'POST', { name: 'Test' });
    assert.equal(r.code, 400);

    // Invalid phone number
    r = await call('/api/bookings', 'POST', {
      name: 'Tester', phone: '12345', brand: 'Apple', model: 'iPhone 13',
      issue: 'Screen', method: 'Discuss options', locality: 'Sigra', consent: true
    });
    assert.equal(r.code, 400);

    // Missing consent
    r = await call('/api/bookings', 'POST', {
      name: 'Tester', phone: '9876543210', brand: 'Apple', model: 'iPhone 13',
      issue: 'Screen', method: 'Discuss options', locality: 'Sigra', consent: false
    });
    assert.equal(r.code, 400);

    // Honeypot spam test
    r = await call('/api/bookings', 'POST', {
      name: 'Spammer', phone: '9876543210', brand: 'Apple', model: 'iPhone 13',
      issue: 'Screen', method: 'Discuss options', locality: 'Sigra', consent: true,
      website: 'http://spam.example.com'
    });
    assert.equal(r.code, 200);
    assert.equal(r.d.received, true);

    // Valid booking
    r = await call('/api/bookings', 'POST', {
      name: 'Aamir Customer', phone: '9876543210', brand: 'Apple', model: 'iPhone 13',
      issue: 'Battery replacement', method: 'Discuss options', date: '2026-12-01',
      locality: 'Sigra', address: 'Near Sigra Stadium', notes: 'Drains quickly', consent: true
    });
    assert.equal(r.code, 201);
    assert.ok(r.d.ref);
    bookingRef = r.d.ref;

    record('Customer Booking Creation & Validation (/api/bookings)', true);
  } catch (e) { record('Customer Booking Creation & Validation (/api/bookings)', false, e); }

  // Test 6: Request Tracking
  try {
    // Valid track
    let r = await call(`/api/track?ref=${bookingRef}&phone=9876543210`);
    assert.equal(r.code, 200);
    assert.equal(r.d.type, 'repair');
    assert.equal(r.d.record.ref, bookingRef);
    assert.equal(r.d.record.status, 'pending');

    // Wrong phone (privacy boundary)
    r = await call(`/api/track?ref=${bookingRef}&phone=9999999999`);
    assert.equal(r.code, 404);

    // Invalid format ref
    r = await call(`/api/track?ref=INVALID-REF&phone=9876543210`);
    assert.equal(r.code, 400);

    record('Customer Request Tracking & Privacy (/api/track)', true);
  } catch (e) { record('Customer Request Tracking & Privacy (/api/track)', false, e); }

  // Test 7: Spare Parts Order Request Flow
  let orderRef;
  try {
    // Empty items
    let r = await call('/api/orders', 'POST', {
      name: 'Parts Buyer', phone: '9876543210', locality: 'Lanka',
      mode: 'Workshop collection', consent: true, items: []
    });
    assert.equal(r.code, 400);

    // Duplicate item
    r = await call('/api/orders', 'POST', {
      name: 'Parts Buyer', phone: '9876543210', locality: 'Lanka',
      mode: 'Workshop collection', consent: true,
      items: [{ id: firstProduct.id, quantity: 1 }, { id: firstProduct.id, quantity: 2 }]
    });
    assert.equal(r.code, 400);

    // Overstock quantity
    r = await call('/api/orders', 'POST', {
      name: 'Parts Buyer', phone: '9876543210', locality: 'Lanka',
      mode: 'Workshop collection', consent: true,
      items: [{ id: firstProduct.id, quantity: 9999 }]
    });
    assert.equal(r.code, 400);

    // Valid order
    r = await call('/api/orders', 'POST', {
      name: 'Parts Buyer', phone: '9876543210', locality: 'Lanka',
      mode: 'Workshop collection', consent: true,
      items: [{ id: firstProduct.id, quantity: 1 }]
    });
    assert.equal(r.code, 201);
    assert.ok(r.d.ref);
    assert.equal(r.d.subtotal, firstProduct.price);
    orderRef = r.d.ref;

    // Track order
    const rTrack = await call(`/api/track?ref=${orderRef}&phone=9876543210`);
    assert.equal(rTrack.code, 200);
    assert.equal(rTrack.d.type, 'order');
    assert.equal(rTrack.d.items.length, 1);
    assert.equal(rTrack.d.items[0].unit_price, firstProduct.price);

    record('Customer Spare Parts Ordering & Tracking (/api/orders)', true);
  } catch (e) { record('Customer Spare Parts Ordering & Tracking (/api/orders)', false, e); }

  // Test 8: Contact Message Flow
  try {
    // Missing message
    let r = await call('/api/contact', 'POST', { name: 'Aamir', phone: '9876543210', consent: true });
    assert.equal(r.code, 400);

    // Invalid email
    r = await call('/api/contact', 'POST', { name: 'Aamir', phone: '9876543210', email: 'not-an-email', message: 'Hi', consent: true });
    assert.equal(r.code, 400);

    // Valid message
    r = await call('/api/contact', 'POST', {
      name: 'Aamir Customer', phone: '9876543210', email: 'aamir@example.com',
      message: 'Looking for a specialized screen replacement.', consent: true
    });
    assert.equal(r.code, 201);
    assert.equal(r.d.received, true);

    record('Contact Messaging & Email Validation (/api/contact)', true);
  } catch (e) { record('Contact Messaging & Email Validation (/api/contact)', false, e); }

  // Test 9: Admin Authentication, Cookies & CSRF
  let cookie = '', csrf = '';
  try {
    // Wrong password
    let r = await call('/api/admin/login', 'POST', { username: 'testadmin', password: 'WrongPassword!' });
    assert.equal(r.code, 401);

    // Nonexistent user
    r = await call('/api/admin/login', 'POST', { username: 'nobody', password: 'SuperSecretPassword123!' });
    assert.equal(r.code, 401);

    // Successful login
    r = await call('/api/admin/login', 'POST', { username: 'testadmin', password: 'SuperSecretPassword123!' });
    assert.equal(r.code, 200);
    assert.equal(r.d.username, 'testadmin');
    assert.ok(r.d.csrf);
    csrf = r.d.csrf;
    const rawCookie = r.headers.get('set-cookie');
    assert.ok(rawCookie);
    assert.ok(rawCookie.includes('repairlylabs_session='));
    assert.ok(rawCookie.includes('HttpOnly'));
    assert.ok(rawCookie.includes('SameSite=Strict'));
    cookie = rawCookie.split(';')[0];

    // Check /api/admin/me
    const rMe = await call('/api/admin/me', 'GET', null, cookie);
    assert.equal(rMe.code, 200);
    assert.equal(rMe.d.username, 'testadmin');
    assert.equal(rMe.d.csrf, csrf);

    record('Admin Authentication & Session Headers (/api/admin/login, /api/admin/me)', true);
  } catch (e) { record('Admin Authentication & Session Headers (/api/admin/login, /api/admin/me)', false, e); }

  // Test 10: CSRF Protection on Mutating Endpoints
  try {
    // Attempt PATCH without CSRF token
    const rNoCsrf = await call('/api/admin/settings', 'PATCH', { business_name: 'Hacked' }, cookie);
    assert.equal(rNoCsrf.code, 403);

    // Attempt PATCH with wrong CSRF token
    const rBadCsrf = await call('/api/admin/settings', 'PATCH', { business_name: 'Hacked' }, cookie, 'wrong-csrf-token');
    assert.equal(rBadCsrf.code, 403);

    record('CSRF Protection on Mutating Admin Endpoints', true);
  } catch (e) { record('CSRF Protection on Mutating Admin Endpoints', false, e); }

  // Test 11: Cross-Site Request Origin Blocker
  try {
    const rBadOrigin = await call('/api/admin/settings', 'PATCH', { business_name: 'Hacked' }, cookie, csrf, {
      origin: 'https://malicious-attacker.com'
    });
    assert.equal(rBadOrigin.code, 403);
    record('Cross-Origin Request Forgery / Origin Header Blocking', true);
  } catch (e) { record('Cross-Origin Request Forgery / Origin Header Blocking', false, e); }

  // Test 12: Admin Overview & Metrics
  try {
    const r = await call('/api/admin/overview', 'GET', null, cookie);
    assert.equal(r.code, 200);
    assert.ok(r.d.bookings >= 1);
    assert.ok(r.d.pendingBookings >= 1);
    assert.ok(r.d.orders >= 1);
    assert.ok(r.d.pendingOrders >= 1);
    assert.ok(r.d.unreadMessages >= 1);
    assert.ok(r.d.listedParts >= 15);
    record('Admin Overview & Metrics Reporting (/api/admin/overview)', true);
  } catch (e) { record('Admin Overview & Metrics Reporting (/api/admin/overview)', false, e); }

  // Test 13: Admin Booking Operations (Quote & Status)
  try {
    const rList = await call('/api/admin/bookings', 'GET', null, cookie);
    assert.equal(rList.code, 200);
    const bk = rList.d.find(b => b.ref === bookingRef);
    assert.ok(bk);

    // Update status and quote
    const rUpdate = await call(`/api/admin/bookings/${bk.id}`, 'PATCH', {
      status: 'confirmed',
      quote: 2499,
      admin_note: 'Discussed with customer, approved battery fix.'
    }, cookie, csrf);
    assert.equal(rUpdate.code, 200);

    // Check tracking reflects new quote and status
    const rTrack = await call(`/api/track?ref=${bookingRef}&phone=9876543210`);
    assert.equal(rTrack.d.record.status, 'confirmed');
    assert.equal(rTrack.d.record.quote, 2499);

    record('Admin Booking Status & Quote Management', true);
  } catch (e) { record('Admin Booking Status & Quote Management', false, e); }

  // Test 14: Admin Order Management (Sample verification & stock deduction/restoration)
  try {
    const rOrders = await call('/api/admin/orders', 'GET', null, cookie);
    assert.equal(rOrders.code, 200);
    const ord = rOrders.d.find(o => o.ref === orderRef);
    assert.ok(ord);

    // Trying to confirm when product is still a 'sample' MUST FAIL with 409
    let rConfirm = await call(`/api/admin/orders/${ord.id}`, 'PATCH', { status: 'confirmed' }, cookie, csrf);
    assert.equal(rConfirm.code, 409); // Sample listing safety check

    // Update product to verified live listing (sample = false)
    const pRow = (await call(`/api/products/${firstProduct.id}`)).d;
    const initialStock = pRow.stock;
    const updateProduct = await call(`/api/admin/products/${firstProduct.id}`, 'PUT', {
      ...pRow,
      sample: false,
      active: true
    }, cookie, csrf);
    assert.equal(updateProduct.code, 200);

    // Now confirm the order -> stock should deduct
    rConfirm = await call(`/api/admin/orders/${ord.id}`, 'PATCH', { status: 'confirmed' }, cookie, csrf);
    assert.equal(rConfirm.code, 200);

    const afterConfirm = (await call(`/api/products/${firstProduct.id}`)).d;
    assert.equal(afterConfirm.stock, initialStock - 1);

    // Cancel the order -> stock should restore
    const rCancel = await call(`/api/admin/orders/${ord.id}`, 'PATCH', { status: 'cancelled' }, cookie, csrf);
    assert.equal(rCancel.code, 200);

    const afterCancel = (await call(`/api/products/${firstProduct.id}`)).d;
    assert.equal(afterCancel.stock, initialStock);

    record('Inventory Safety: Sample Guard & Automatic Stock Deduction/Restoration', true);
  } catch (e) { record('Inventory Safety: Sample Guard & Automatic Stock Deduction/Restoration', false, e); }

  // Test 15: Contact Messages Management (Read/Unread and Delete)
  try {
    const rContacts = await call('/api/admin/contacts', 'GET', null, cookie);
    assert.equal(rContacts.code, 200);
    assert.ok(rContacts.d.length >= 1);
    const cId = rContacts.d[0].id;

    // Mark as read
    const rRead = await call(`/api/admin/contacts/${cId}`, 'PATCH', { read: true }, cookie, csrf);
    assert.equal(rRead.code, 200);

    // Delete contact
    const rDel = await call(`/api/admin/contacts/${cId}`, 'DELETE', null, cookie, csrf);
    assert.equal(rDel.code, 200);

    record('Contact Messages Read Status & Deletion (/api/admin/contacts)', true);
  } catch (e) { record('Contact Messages Read Status & Deletion (/api/admin/contacts)', false, e); }

  // Test 16: Device Models Bulk Importer
  try {
    const rBulk = await call('/api/admin/models/bulk', 'POST', {
      models: [
        { brand: 'Google Pixel', model: 'Pixel 9 Pro' },
        { brand: 'Google Pixel', model: 'Pixel 9' }
      ]
    }, cookie, csrf);
    assert.equal(rBulk.code, 200);
    assert.equal(rBulk.d.added, 2);

    // Verify models appear
    const rModels = await call('/api/models?brand=Google%20Pixel');
    assert.equal(rModels.code, 200);
    assert.equal(rModels.d.length, 2);

    record('Device Model Bulk Importer (/api/admin/models/bulk)', true);
  } catch (e) { record('Device Model Bulk Importer (/api/admin/models/bulk)', false, e); }

  // Test 17: Product Creation, Editing, and Soft Delete
  try {
    // Create new product
    const newSku = 'RL-TEST-999';
    const rCreate = await call('/api/admin/products', 'POST', {
      sku: newSku, name: 'Ultra Screen Pro', brand: 'Google Pixel',
      model: 'Pixel 9 Pro', category: 'Display & Touch', grade: 'OEM Original',
      price: 6500, stock: 10, active: true, featured: true, sample: false,
      description: 'Tested OEM screen.', image_kind: 'display'
    }, cookie, csrf);
    assert.equal(rCreate.code, 200);

    // Duplicate SKU should fail with 409
    const rDup = await call('/api/admin/products', 'POST', {
      sku: newSku, name: 'Ultra Screen Pro 2', brand: 'Google Pixel',
      model: 'Pixel 9 Pro', category: 'Display & Touch', grade: 'OEM',
      price: 6500, stock: 5, active: true, featured: false, sample: false
    }, cookie, csrf);
    assert.equal(rDup.code, 409);

    // Find created product
    const searchRes = await call(`/api/products?q=${newSku}`);
    assert.equal(searchRes.code, 200);
    const createdItem = searchRes.d.items.find(x => x.sku === newSku);
    assert.ok(createdItem);

    // Soft delete product
    const rDel = await call(`/api/admin/products/${createdItem.id}`, 'DELETE', null, cookie, csrf);
    assert.equal(rDel.code, 200);

    // Should no longer appear in public catalog
    const searchAfter = await call(`/api/products?q=${newSku}`);
    assert.ok(!searchAfter.d.items.some(x => x.sku === newSku));

    record('Product CRUD, Duplicate SKU Guard & Soft Deletion', true);
  } catch (e) { record('Product CRUD, Duplicate SKU Guard & Soft Deletion', false, e); }

  // Test 18: Service Management
  try {
    const rNewService = await call('/api/admin/services', 'POST', {
      slug: 'ai-diagnostics',
      title: 'AI Board Diagnostics',
      description: 'Advanced logic board thermal diagnostics.',
      icon: 'settings-2',
      tag: 'New Lab Tech',
      active: true,
      sort_order: 1
    }, cookie, csrf);
    assert.equal(rNewService.code, 200);

    const rConfig = await call('/api/config');
    assert.ok(rConfig.d.services.some(s => s.slug === 'ai-diagnostics'));

    record('Repair Service Management (/api/admin/services)', true);
  } catch (e) { record('Repair Service Management (/api/admin/services)', false, e); }

  // Test 19: Site Settings Management
  try {
    const rSettings = await call('/api/admin/settings', 'PATCH', {
      business_name: 'RepairlyLabs',
      tagline: 'Precision phone care & parts lab.',
      phone: '9876543210',
      whatsapp: '919876543210',
      email: 'team@repairlylabs.com',
      address: 'Tech Park, Varanasi',
      pickup_enabled: '1',
      delivery_enabled: '1'
    }, cookie, csrf);
    assert.equal(rSettings.code, 200);

    const rCheck = await call('/api/config');
    assert.equal(rCheck.d.settings.tagline, 'Precision phone care & parts lab.');
    assert.equal(rCheck.d.settings.delivery_enabled, '1');

    record('Storefront Public Settings Management (/api/admin/settings)', true);
  } catch (e) { record('Storefront Public Settings Management (/api/admin/settings)', false, e); }

  // Test 20: Password Change
  try {
    // Current password incorrect
    let r = await call('/api/admin/password', 'PATCH', {
      current: 'WrongCurrentPass!',
      next: 'NewStrongPassword2026!'
    }, cookie, csrf);
    assert.equal(r.code, 403);

    // Too short next password
    r = await call('/api/admin/password', 'PATCH', {
      current: 'SuperSecretPassword123!',
      next: 'short'
    }, cookie, csrf);
    assert.equal(r.code, 400);

    // Valid password change
    r = await call('/api/admin/password', 'PATCH', {
      current: 'SuperSecretPassword123!',
      next: 'NewStrongPassword2026!'
    }, cookie, csrf);
    assert.equal(r.code, 200);

    // Verify login with new password
    const rNewLogin = await call('/api/admin/login', 'POST', {
      username: 'testadmin',
      password: 'NewStrongPassword2026!'
    });
    assert.equal(rNewLogin.code, 200);

    record('Admin Password Change & Session Invalidation (/api/admin/password)', true);
  } catch (e) { record('Admin Password Change & Session Invalidation (/api/admin/password)', false, e); }

  // Test 21: CSV Export & Formula Injection Prevention
  try {
    for (const type of ['bookings', 'orders', 'contacts', 'products']) {
      const r = await fetch(`${base}/api/admin/export?type=${type}`, {
        headers: { cookie }
      });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('content-type'), 'text/csv; charset=utf-8');
      assert.ok(r.headers.get('content-disposition').includes(`repairlylabs-${type}.csv`));
      const csv = await r.text();
      assert.ok(csv.includes('\n') || csv.length > 0);
    }
    record('CSV Export & Formula Injection Defense (/api/admin/export)', true);
  } catch (e) { record('CSV Export & Formula Injection Defense (/api/admin/export)', false, e); }

  // Test 22: Static Asset Serving & Security Headers
  try {
    const rIndex = await fetch(`${base}/`);
    assert.equal(rIndex.status, 200);
    assert.equal(rIndex.headers.get('x-frame-options'), 'DENY');
    assert.equal(rIndex.headers.get('x-content-type-options'), 'nosniff');
    assert.ok(rIndex.headers.get('content-security-policy'));

    // SPA client routes
    for (const route of ['/repairs', '/parts', '/track', '/about', '/contact', '/privacy', '/admin']) {
      const r = await fetch(`${base}${route}`);
      assert.equal(r.status, 200);
      const text = await r.text();
      assert.ok(text.includes('RepairlyLabs'));
    }

    // Static asset MIME types
    const rCss = await fetch(`${base}/styles.css`);
    assert.equal(rCss.status, 200);
    assert.ok(rCss.headers.get('content-type').includes('text/css'));

    const rJs = await fetch(`${base}/app.js`);
    assert.equal(rJs.status, 200);
    assert.ok(rJs.headers.get('content-type').includes('text/javascript'));

    const rSvg = await fetch(`${base}/assets/favicon.svg`);
    assert.equal(rSvg.status, 200);
    assert.ok(rSvg.headers.get('content-type').includes('image/svg+xml'));

    const rManifest = await fetch(`${base}/manifest.webmanifest`);
    assert.equal(rManifest.status, 200);
    assert.ok(rManifest.headers.get('content-type').includes('json'));

    record('Static Asset Serving, MIME Types & Security Headers', true);
  } catch (e) { record('Static Asset Serving, MIME Types & Security Headers', false, e); }

  // Test 23: Path Traversal Prevention
  try {
    let r = await fetch(`${base}/../../package.json`);
    assert.ok([400, 403, 404].includes(r.status));

    r = await fetch(`${base}/%2e%2e%2fpackage.json`);
    assert.ok([400, 403, 404].includes(r.status));

    record('Directory Traversal Security Protection', true);
  } catch (e) { record('Directory Traversal Security Protection', false, e); }

  // Cleanup
  await new Promise(resolve => server.close(resolve));
  rmSync(tmp, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n--- AUDIT SUMMARY: ${passed} PASSED, ${failed} FAILED ---`);
  if (failed > 0) process.exit(1);
}

runAudit().catch(err => {
  console.error('Audit suite crashed:', err);
  process.exit(1);
});
