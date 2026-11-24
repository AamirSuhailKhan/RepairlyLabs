/**
 * RepairlyLabs — Cross-Platform Real Browser Audit Suite (Linux / macOS / Windows)
 * Uses Playwright Core + Chromium with an isolated temporary SQLite database,
 * ephemeral port, and synthetic test data only.
 * Preserves existing Windows-specific visible runners in tests/*.py.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const OUT_DIR = join(ROOT, 'test-results', 'browser_audit');
const INTRO_DIR = join(OUT_DIR, 'intro-frames');
const RESP_DIR = join(OUT_DIR, 'responsive');
const WORKFLOW_DIR = join(OUT_DIR, 'workflow');
const VIDEO_DIR = join(OUT_DIR, 'videos');
const TRACE_PATH = join(OUT_DIR, 'trace.zip');
const RESULTS_PATH = join(OUT_DIR, 'results.json');
const REAL_DB = join(ROOT, 'data', 'repairlylabs.sqlite');

for (const d of [OUT_DIR, INTRO_DIR, RESP_DIR, WORKFLOW_DIR, VIDEO_DIR]) {
  mkdirSync(d, { recursive: true });
}

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/ms-playwright')) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/ms-playwright';
}

async function loadPlaywright() {
  for (const mod of ['playwright', 'playwright-core']) {
    try {
      const loaded = await import(mod);
      if (loaded?.chromium) return loaded;
    } catch {}
  }
  const containerPath = '/usr/local/share/bun-global/node_modules/playwright-core/index.mjs';
  if (existsSync(containerPath)) {
    return await import(pathToFileURL(containerPath).href);
  }
  throw new Error('Playwright / playwright-core is not available in this environment.');
}

const realDbBeforeMtime = existsSync(REAL_DB) ? statSync(REAL_DB).mtimeMs : null;

// Isolated temporary DATA_DIR and sanitized environment before importing server.mjs
const tempDataDir = mkdtempSync(join(tmpdir(), 'rl-browser-audit-'));
process.env.DATA_DIR = tempDataDir;
process.env.PORT = '0';
process.env.NODE_ENV = 'test';
process.env.REPAIRLYLABS_TEST = '1';
delete process.env.PUBLIC_LEGACY_CATALOG;
delete process.env.RAZORPAY_KEY_ID;
delete process.env.RAZORPAY_KEY_SECRET;
delete process.env.RAZORPAY_WEBHOOK_SECRET;

const { server, db } = await import('../src/server.mjs');
const { issueRecovery, recoverOwner, manageTeam } = await import('../src/admin-access.mjs');

if (!server.listening) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
}
const BASE = `http://127.0.0.1:${server.address().port}`;

// Seed isolated owner, technician, active SKU, and UPI QR settings
const ownerUser = 'testowner';
const ownerPass = 'AuditBrowser!' + randomBytes(8).toString('hex');
const techPass = 'TechBrowser!' + randomBytes(8).toString('hex');
const recTok = issueRecovery(db);
recoverOwner(db, { token: recTok, username: ownerUser, password: ownerPass, email: 'owner-test@example.invalid' });
manageTeam(db, ownerUser, {
  action: 'create',
  username: 'tech1',
  permission: 'technician',
  password: techPass,
  current: ownerPass
});
const validPngBase64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC';
const validPngDataUrl = 'data:image/png;base64,' + validPngBase64;
const samplePngPath = join(tempDataDir, 'sample-part.png');
writeFileSync(samplePngPath, Buffer.from(validPngBase64, 'base64'));

db.prepare(
  "INSERT INTO products(sku,name,brand,model,category,grade,price,stock,active,featured,sample,description,image_kind) VALUES(?,?,?,?,?,?,?,?,1,0,0,?,'display')"
).run('SKU-AUDIT-001', 'OLED Display Module', 'Samsung', 'Galaxy S23', 'Display & Touch', 'OEM', 2000, 5, 'Verified synthetic test SKU');

db.prepare('UPDATE rl_qr_settings SET enabled=1,merchant=?,upi=?,image=?,version=1 WHERE id=1').run(
  'RepairlyLabs Test',
  'repairly@testbank',
  validPngDataUrl
);

const results = {
  environment: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    chromiumVersion: null,
    baseUrl: BASE,
    isolatedDb: true
  },
  intro: {},
  responsiveness: [],
  workflows: {},
  consoleErrors: [],
  pageErrors: [],
  failedAssets: [],
  failed5xx: []
};

const { chromium } = await loadPlaywright();
const launchOpts = {
  headless: process.env.RL_HEADED === '1' ? false : true,
  args: ['--no-sandbox', '--disable-dev-shm-usage']
};
if (process.env.RL_CHROME_PATH && existsSync(process.env.RL_CHROME_PATH)) {
  launchOpts.executablePath = process.env.RL_CHROME_PATH;
}
const browser = await chromium.launch(launchOpts);
results.environment.chromiumVersion = browser.version();

function attachMonitors(page, bucket) {
  page.on('pageerror', (err) => results.pageErrors.push(`${bucket}: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      const text = msg.text();
      // Ignore expected 401 probe on initial admin login check before signing in
      if (!text.includes('status of 401')) results.consoleErrors.push(`${bucket}: ${text}`);
    }
  });
  page.on('response', (res) => {
    if (res.status() >= 500) {
      results.failed5xx.push(`${bucket}: ${res.status()} ${res.url()}`);
    } else if (res.status() >= 400 && res.status() !== 401 && res.request().method() === 'GET') {
      results.failedAssets.push(`${bucket}: ${res.status()} ${res.url()}`);
    }
  });
}

try {
  // =========================================================================
  // 1. CINEMATIC BRAND INTRO (Frame-by-Frame, Skip, Escape, Reload, Reduced Motion)
  // =========================================================================
  console.error('[audit] 1. Intro verification start');
  {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 } });
    const page = await ctx.newPage();
    attachMonitors(page, 'intro');

    const startMs = Date.now();
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    const armedAtLoad = await page.evaluate(() => document.documentElement.classList.contains('rl-intro-armed'));

    const samples = [];
    const targetWait = [0, 80, 120, 150, 200, 250, 400, 700];
    for (let i = 0; i < targetWait.length; i++) {
      if (targetWait[i] > 0) await page.waitForTimeout(targetWait[i]);
      const elapsed = Date.now() - startMs;
      const snap = await page.evaluate(() => {
        const overlay = document.getElementById('rl-brand-intro');
        const img = document.querySelector('.rl-brand-intro__image');
        const petalsWrap = document.querySelector('.rl-brand-intro__petals');
        const petals = [...document.querySelectorAll('.rl-brand-intro__petal')];
        return {
          overlayPresent: !!overlay,
          overlayOpacity: overlay ? Number(getComputedStyle(overlay).opacity) : null,
          armedClass: document.documentElement.classList.contains('rl-intro-armed'),
          imgNaturalWidth: img ? img.naturalWidth : 0,
          imgOpacity: img ? Number(getComputedStyle(img).opacity) : null,
          petalsWrapOpacity: petalsWrap ? Number(getComputedStyle(petalsWrap).opacity) : null,
          petalCount: petals.length,
          petalsGeometry: petals.map((el) => {
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            const path = el.querySelector('svg path');
            return {
              opacity: Number(cs.opacity),
              clipPath: cs.clipPath,
              cx: Math.round(r.left + r.width / 2),
              cy: Math.round(r.top + r.height / 2),
              w: Math.round(r.width),
              h: Math.round(r.height),
              hasPath: !!path
            };
          })
        };
      });
      samples.push({ frame: i, elapsedMs: elapsed, ...snap });
      await page.screenshot({ path: join(INTRO_DIR, `frame-0${i}-t${elapsed}ms.png`) });
    }
    await page.waitForFunction(() => !document.getElementById('rl-brand-intro'), null, { timeout: 6000 });
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(INTRO_DIR, 'frame-08-revealed.png') });
    const afterReveal = await page.evaluate(() => ({
      overlayPresent: !!document.getElementById('rl-brand-intro'),
      armedClass: document.documentElement.classList.contains('rl-intro-armed'),
      heroVisible: !!document.querySelector('.navbar') && document.querySelector('h1')?.offsetHeight > 0
    }));

    // Verify phase ordering across recorded frames:
    // 1) An early active frame shows the master bitmap intact before petals separate.
    const intactFrame = samples.find((s) => s.overlayPresent && s.imgNaturalWidth >= 512 && s.imgOpacity >= 0.7 && s.petalsWrapOpacity === 0);
    // 2) A subsequent separating frame shows 8 intact, unclipped vector petals spreading radially.
    const spreadFrame = samples.find((s) =>
      s.overlayPresent &&
      s.petalsWrapOpacity > 0 &&
      s.petalCount === 8 &&
      s.petalsGeometry.every((p) => p.hasPath && p.clipPath === 'none') &&
      new Set(s.petalsGeometry.map((p) => `${p.cx},${p.cy}`)).size >= 4
    );

    const briefSamples = samples.map((s) => ({ f: s.frame, t: s.elapsedMs, ov: s.overlayPresent, w: s.imgNaturalWidth, op: s.imgOpacity, pw: s.petalsWrapOpacity, uniqPos: new Set(s.petalsGeometry.map((p) => `${p.cx},${p.cy}`)).size }));
    assert.equal(armedAtLoad, true, 'Intro should arm before paint on /');
    assert.ok(intactFrame, 'Master logo must appear intact in early frame(s): ' + JSON.stringify(briefSamples));
    assert.ok(spreadFrame, 'All 8 unclipped vector petals must separate radially: ' + JSON.stringify(briefSamples));
    assert.ok(intactFrame.frame < spreadFrame.frame, 'Intact logo phase must appear strictly before petal separation');
    assert.equal(afterReveal.overlayPresent, false, 'Intro overlay must be removed after completion');
    assert.equal(afterReveal.armedClass, false, 'rl-intro-armed must be cleared after completion');

    // Refresh replay + Skip button
    await page.reload({ waitUntil: 'domcontentloaded' });
    const replayPresent = await page.locator('#rl-brand-intro').isVisible();
    await page.locator('.rl-brand-intro__skip').click();
    await page.waitForTimeout(80);
    const skippedPresent = (await page.locator('#rl-brand-intro').count()) > 0;
    assert.equal(replayPresent, true, 'Intro must replay on page reload');
    assert.equal(skippedPresent, false, 'Skip button must dismiss intro cleanly');

    // Escape key dismissal
    await page.reload({ waitUntil: 'domcontentloaded' });
    const escapeReplayPresent = await page.locator('#rl-brand-intro').isVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    const escapedPresent = (await page.locator('#rl-brand-intro').count()) > 0;
    assert.equal(escapeReplayPresent, true);
    assert.equal(escapedPresent, false, 'Escape key must dismiss intro cleanly');

    await ctx.close();

    // Reduced-motion accessibility
    const rmCtx = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      reducedMotion: 'reduce'
    });
    const rmPage = await rmCtx.newPage();
    attachMonitors(rmPage, 'intro-reduced-motion');
    await rmPage.goto(BASE + '/', { waitUntil: 'networkidle' });
    const rmState = await rmPage.evaluate(() => ({
      overlayCount: document.querySelectorAll('#rl-brand-intro').length,
      armedClass: document.documentElement.classList.contains('rl-intro-armed')
    }));
    await rmCtx.close();
    assert.equal(rmState.overlayCount, 0, 'Reduced motion must immediately bypass/remove intro overlay');
    assert.equal(rmState.armedClass, false);

    results.intro = {
      status: 'PASS',
      armedAtLoad,
      masterLogoNaturalWidth: intactFrame.imgNaturalWidth,
      intactFrameMs: intactFrame.elapsedMs,
      spreadFrameMs: spreadFrame.elapsedMs,
      petalCount: spreadFrame.petalCount,
      petalsSpread: true,
      afterReveal,
      replayOnReload: replayPresent,
      skipButtonWorks: !skippedPresent,
      escapeKeyWorks: !escapedPresent,
      reducedMotionBypass: rmState.overlayCount === 0
    };
    console.error('[audit] 1. Intro verification DONE');
  }

  // =========================================================================
  // 2. END-TO-END WORKFLOWS IN REAL CHROMIUM (with Video + Trace)
  // =========================================================================
  console.error('[audit] 2. E2E workflows start');
  const adminCtx = await browser.newContext({
    viewport: { width: 1366, height: 768 },
    reducedMotion: 'reduce',
    recordVideo: { dir: VIDEO_DIR, size: { width: 1366, height: 768 } }
  });
  await adminCtx.tracing.start({ screenshots: true, snapshots: true });
  const adminPage = await adminCtx.newPage();
  attachMonitors(adminPage, 'admin-workflow');

  const custCtx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    reducedMotion: 'reduce',
    recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 800 } }
  });
  const custPage = await custCtx.newPage();
  attachMonitors(custPage, 'customer-workflow');

  // Accept all confirmation dialogs cleanly in browser flows
  adminPage.on('dialog', (d) => d.accept());
  custPage.on('dialog', (d) => d.accept());

  // 2A. Homepage interactive journey card -> Repair Booking
  await custPage.goto(BASE + '/', { waitUntil: 'networkidle' });
  await custPage.waitForSelector('.hero-process-card[data-journey-ready="1"]');
  assert.equal((await custPage.locator('#hero-step-index').innerText()).trim(), '01 / 03');
  await custPage.click('[data-hero-step="1"]');
  await custPage.waitForFunction(() => document.getElementById('hero-step-index')?.textContent?.trim() === '02 / 03');
  assert.match(await custPage.locator('#hero-step-heading').innerText(), /Compare options/);
  assert.equal(await custPage.locator('#hero-step-cta').getAttribute('href'), '/part-request/');
  await custPage.click('[data-hero-step="2"]');
  await custPage.waitForFunction(() => document.getElementById('hero-step-index')?.textContent?.trim() === '03 / 03');
  assert.equal(await custPage.locator('#hero-step-cta').getAttribute('href'), '/track');
  await custPage.click('#hero-step-index');
  await custPage.waitForFunction(() => document.getElementById('hero-step-index')?.textContent?.trim() === '01 / 03');
  await custPage.screenshot({ path: join(WORKFLOW_DIR, '01-homepage.png') });
  await custPage.locator('a[href="/repairs#booking"]').first().click();
  await custPage.waitForSelector('#booking-form');

  await custPage.fill('#booking-form [name="name"]', 'Aarav Synthetic');
  await custPage.fill('#booking-form [name="phone"]', '9876501234');
  await custPage.selectOption('#booking-form [name="brand"]', 'Samsung');
  await custPage.fill('#booking-form [name="model"]', 'Galaxy S23');
  await custPage.selectOption('#booking-form [name="issue"]', 'Screen & display repair');
  await custPage.selectOption('#booking-form [name="method"]', 'Request pickup');
  await custPage.fill('#booking-form [name="locality"]', 'Sigra');
  await custPage.fill('#booking-form [name="address"]', '14 Audit Park, Sigra, Varanasi');
  await custPage.fill('#booking-form [name="pin"]', '221010');
  await custPage.fill('#booking-form [name="notes"]', 'Synthetic Playwright test booking');
  await custPage.check('#booking-form [name="consent"]');

  const [bookingResp] = await Promise.all([
    custPage.waitForResponse((r) => r.url().endsWith('/api/bookings') && r.request().method() === 'POST'),
    custPage.click('#booking-form button[type="submit"]')
  ]);
  assert.equal(bookingResp.status(), 201, 'Repair booking should return 201');
  const bookingData = await bookingResp.json();
  const repairRef = bookingData.ref;
  assert.match(repairRef, /^RLM-\d{6}-[0-9A-F]{8}$/);
  await custPage.waitForSelector('.success-card .reference');
  await custPage.screenshot({ path: join(WORKFLOW_DIR, '02-repair-booked.png') });
  results.workflows.repairBooking = { status: 'PASS', ref: repairRef };

  // 2B. Public Tracking
  await custPage.goto(BASE + '/track', { waitUntil: 'networkidle' });
  await custPage.fill('#track-ref', repairRef);
  await custPage.fill('#track-phone', '9876501234');
  await custPage.click('form[data-form="track"] button[type="submit"]');
  await custPage.waitForSelector('#track-result .status-badge');
  const trackText = await custPage.locator('#track-result').innerText();
  assert.ok(trackText.includes(repairRef) && trackText.toLowerCase().includes('pending'));
  await custPage.screenshot({ path: join(WORKFLOW_DIR, '03-repair-tracking.png') });
  results.workflows.tracking = { status: 'PASS', ref: repairRef };

  // 2C. Admin Login + Overview + Inventory Tab Verification (regression: no 410)
  await adminPage.goto(BASE + '/admin', { waitUntil: 'networkidle' });
  await adminPage.fill('#login-username', ownerUser);
  await adminPage.fill('#access-password', ownerPass);
  await adminPage.click('form[data-form="admin-login"] button[type="submit"]');
  await adminPage.waitForSelector('.admin-shell');
  await adminPage.screenshot({ path: join(WORKFLOW_DIR, '04-admin-login.png') });

  await adminPage.click('button[data-admin-tab="products"]');
  await adminPage.waitForSelector('#admin-content table.admin-table');
  const invText = await adminPage.locator('#admin-content').innerText();
  assert.ok(invText.includes('SKU-AUDIT-001'), 'Inventory tab should list SKU-AUDIT-001');
  await adminPage.screenshot({ path: join(WORKFLOW_DIR, '09-admin-inventory.png') });
  results.workflows.adminLoginAndInventory = { status: 'PASS' };

  // 2D. Repair Desk: Open -> Assign Tech -> Diagnosis -> Quotation
  await adminPage.goto(BASE + '/repair-center/index.html?admin=1', { waitUntil: 'networkidle' });
  await adminPage.waitForSelector(`button[data-ref="${repairRef}"]`);
  await adminPage.click(`button[data-ref="${repairRef}"]`);
  await adminPage.waitForSelector('#assignment');

  await adminPage.fill('#assignment [name="tech"]', 'tech1');
  await adminPage.click('#assignment button');
  await adminPage.waitForTimeout(200);

  await adminPage.fill('#diagnosis [name="diagnosis"]', 'Cracked OLED digitizer; frame straight.');
  await adminPage.click('#diagnosis button');
  await adminPage.waitForSelector('#quote');

  await adminPage.fill('#quote .line-item [name="item"]', 'OLED Display Module');
  await adminPage.fill('#quote .line-item [name="sku"]', 'SKU-AUDIT-001');
  await adminPage.fill('#quote .line-item [name="qty"]', '1');
  await adminPage.fill('#quote .line-item [name="price"]', '2000');
  await adminPage.fill('#quote [name="labor"]', '500');
  await adminPage.fill('#quote [name="discount"]', '0');
  await adminPage.fill('#quote [name="deposit"]', '1000');
  await adminPage.click('#quote button:not([type="button"])');
  await adminPage.waitForFunction(() => document.body.innerText.includes('quoted'));
  await adminPage.screenshot({ path: join(WORKFLOW_DIR, '05-repair-diagnosis-quote.png') });

  // Issue fresh customer access link
  await adminPage.click('button[data-action="access"]');
  await adminPage.waitForSelector('#access-result input');
  const repairLink = await adminPage.locator('#access-result input').inputValue();
  results.workflows.diagnosisAndQuotation = { status: 'PASS', totalRupees: 2500, advanceRupees: 1000 };

  // 2E. Customer Quote Approval + UPI QR Claim
  await custPage.goto(repairLink, { waitUntil: 'networkidle' });
  await custPage.waitForSelector('#decision');
  await custPage.click('#decision button[value="approve"]');
  await custPage.waitForSelector('#qr-claim');
  await custPage.fill('#qr-claim [name="amount"]', '1000.00');
  await custPage.fill('#qr-claim [name="utr"]', 'UTRPLAYWRIGHT001');
  await custPage.check('#qr-claim input[type="checkbox"]');
  await custPage.click('#qr-claim button');
  await custPage.waitForFunction(() => document.body.innerText.includes('awaiting verification'));
  await custPage.screenshot({ path: join(WORKFLOW_DIR, '06-customer-approval-qr.png') });
  results.workflows.customerApprovalAndQrClaim = { status: 'PASS' };

  // 2F. Admin QR Verification -> Start Repair -> QC -> Complete -> Offline Balance -> Delivery -> Invoice
  await adminPage.click('button[data-action="refresh"]');
  await adminPage.waitForSelector('#qr-review');
  await adminPage.selectOption('#qr-review [name="decision"]', 'approve');
  await adminPage.fill('#qr-review [name="note"]', 'Verified synthetic bank credit');
  await adminPage.check('#qr-review [name="confirmed"]');
  await adminPage.click('#qr-review button');
  await adminPage.waitForSelector('button[data-stage="repairing"]');

  await adminPage.click('button[data-stage="repairing"]');
  await adminPage.waitForSelector('#quality');
  for (const field of ['display', 'charging', 'camera', 'audio', 'network', 'buttons', 'condition']) {
    await adminPage.selectOption(`#quality [name="${field}"]`, 'pass');
  }
  await adminPage.click('#quality button');
  await adminPage.waitForFunction(() => !document.querySelector('#finish button')?.disabled);

  await adminPage.check('#finish [name="work"]');
  await adminPage.fill('#finish [name="warranty"]', '90-day display warranty (test)');
  await adminPage.click('#finish button');
  await adminPage.waitForSelector('#offline');

  await adminPage.fill('#offline [name="amount"]', '1500');
  await adminPage.fill('#offline [name="note"]', 'Cash balance settled at handover');
  await adminPage.click('#offline button');
  await adminPage.waitForFunction(() => !document.querySelector('button[data-stage="delivered"]')?.disabled);

  await adminPage.click('button[data-stage="delivered"]');
  await adminPage.waitForFunction(() => document.querySelector('h1 .pill')?.textContent?.trim() === 'delivered');
  await adminPage.click('button[data-action="invoice"]');
  await adminPage.waitForSelector('.invoice');
  const invoiceText = await adminPage.locator('.invoice').innerText();
  assert.ok(invoiceText.includes('INV-' + repairRef) && invoiceText.includes('Paid in full'));
  await adminPage.screenshot({ path: join(WORKFLOW_DIR, '07-qc-complete-delivery-invoice.png') });

  // Verify stock deducted in DB for SKU-AUDIT-001 (5 -> 4)
  const stockAfterRepair = db.prepare('SELECT stock FROM products WHERE sku=?').get('SKU-AUDIT-001').stock;
  assert.equal(stockAfterRepair, 4, 'Completing repair must deduct verified inventory stock atomically');
  console.error('[audit] 2F. Repair delivered & stock verified:', stockAfterRepair);
  results.workflows.qcCompleteDeliveryInvoice = { status: 'PASS', stockAfterRepair };

  // 2G. Parts Enquiry -> Staff Quote -> Customer Accept
  await custPage.goto(BASE + '/part-request/', { waitUntil: 'networkidle' });
  await custPage.waitForSelector('#enquiry-form');
  await custPage.selectOption('#brand', 'Samsung');
  await custPage.fill('#model', 'Galaxy S23 Ultra');
  await custPage.selectOption('#category', 'Display & touchscreen');
  await custPage.fill('#qty', '1');
  await custPage.fill('#description', 'Need original service pack display assembly');
  await custPage.setInputFiles('#part-photo', samplePngPath);
  await custPage.fill('#name', 'Meera Synthetic');
  await custPage.fill('#phone', '9876509876');
  await custPage.fill('#locality', 'Indiranagar');
  await custPage.fill('#city', 'Bengaluru');
  await custPage.selectOption('#region', 'Karnataka');
  await custPage.selectOption('#method', 'Delivery requested');
  await custPage.fill('#pincode', '560038');
  await custPage.fill('#address', '42 Test Street, Indiranagar');
  await custPage.check('#consent');

  const [partResp] = await Promise.all([
    custPage.waitForResponse((r) => r.url().endsWith('/api/part-inquiries') && r.request().method() === 'POST'),
    custPage.click('#submit-enquiry')
  ]);
  assert.equal(partResp.status(), 201);
  const partData = await partResp.json();
  const partRef = partData.ref;
  const partLink = BASE + '/part-request/#' + encodeURIComponent(partRef) + ':' + encodeURIComponent(partData.access);

  await adminPage.goto(BASE + '/part-request/index.html?admin=1', { waitUntil: 'networkidle' });
  await adminPage.waitForSelector(`button[data-open="${partRef}"]`);
  await adminPage.click(`button[data-open="${partRef}"]`);
  await adminPage.waitForSelector('#staff-quote-form');
  await adminPage.selectOption('#staff-quote-form [name="status"]', 'quoted');
  await adminPage.selectOption('#staff-quote-form [name="availability"]', 'in_stock');
  await adminPage.fill('#staff-quote-form [name="price_rupees"]', '3500');
  await adminPage.fill('#staff-quote-form [name="delivery_rupees"]', '150');
  await adminPage.fill('#staff-quote-form [name="eta"]', '2 working days');
  await adminPage.fill('#staff-quote-form [name="quote_note"]', 'Verified OEM stock');
  await adminPage.click('#staff-quote-form button[type="submit"]');
  await adminPage.waitForFunction(() => document.body.innerText.includes('Quotation ready'));

  await custPage.goto(partLink, { waitUntil: 'networkidle' });
  await custPage.waitForSelector('button[data-decision="accept"]');
  await custPage.click('button[data-decision="accept"]');
  await custPage.waitForFunction(() => document.body.innerText.includes('Quote accepted'));
  await custPage.screenshot({ path: join(WORKFLOW_DIR, '08-parts-enquiry-quote-accept.png') });
  results.workflows.partsEnquiryQuoteAccept = { status: 'PASS', ref: partRef };

  // 2H. Business Operations (/operations/index.html?admin=1)
  await adminPage.goto(BASE + '/operations/index.html?admin=1', { waitUntil: 'networkidle' });
  await adminPage.waitForSelector('#supplier');
  await adminPage.fill('#supplier [name="name"]', 'Varanasi Synthetic Spares');
  await adminPage.fill('#supplier [name="contact"]', 'Vikram');
  await adminPage.fill('#supplier [name="phone"]', '9876511111');
  await adminPage.click('#supplier button');
  await adminPage.waitForFunction(() => document.querySelector('#supplier-list')?.innerText.includes('Varanasi Synthetic Spares'));

  await adminPage.fill('#expense [name="date"]', '2026-11-24');
  await adminPage.fill('#expense [name="category"]', 'Workshop tools');
  await adminPage.fill('#expense [name="amount"]', '450');
  await adminPage.fill('#expense [name="note"]', 'Synthetic precision driver set');
  await adminPage.click('#expense button');
  await adminPage.waitForFunction(() => document.querySelector('#expenses-result')?.innerText.includes('Workshop tools'));

  await adminPage.click('button[data-action="profit"]');
  await adminPage.waitForFunction(() => document.querySelector('#profit-result')?.innerText.includes('revenue'));
  await adminPage.click('button[data-action="monitor"]');
  await adminPage.waitForFunction(() => document.querySelector('#monitor-result')?.innerText.includes('uptime_seconds'));
  await adminPage.screenshot({ path: join(WORKFLOW_DIR, '10-operations.png') });
  console.error('[audit] 2H. Operations console DONE');
  results.workflows.operationsConsole = { status: 'PASS' };

  // =========================================================================
  // 3. RESPONSIVE LAYOUT AUDIT ACROSS ALL 6 VIEWPORTS
  // =========================================================================
  console.error('[audit] 3. Responsive checks start');
  const viewports = [
    { name: '360', width: 360, height: 800 },
    { name: '390', width: 390, height: 844 },
    { name: '430', width: 430, height: 932 },
    { name: '768', width: 768, height: 1024 },
    { name: '1024', width: 1024, height: 768 },
    { name: '1280', width: 1280, height: 800 },
    { name: '1366', width: 1366, height: 768 },
    { name: '1920', width: 1920, height: 1080 }
  ];
  const auditRoutes = [
    { id: 'home', path: '/', useAdmin: false },
    { id: 'repairs', path: '/repairs', useAdmin: false },
    { id: 'parts', path: '/parts', useAdmin: false },
    { id: 'track', path: '/track', useAdmin: false },
    { id: 'about', path: '/about', useAdmin: false },
    { id: 'contact', path: '/contact', useAdmin: false },
    { id: 'privacy', path: '/privacy', useAdmin: false },
    { id: 'terms', path: '/terms', useAdmin: false },
    { id: 'part-request', path: '/part-request/', useAdmin: false },
    { id: 'repair-center-admin', path: '/repair-center/index.html?admin=1', useAdmin: true },
    { id: 'operations-admin', path: '/operations/index.html?admin=1', useAdmin: true },
    { id: 'parts-payment-admin', path: '/parts-payment/index.html?admin=1', useAdmin: true }
  ];

  for (const vp of viewports) {
    await custPage.setViewportSize({ width: vp.width, height: vp.height });
    await adminPage.setViewportSize({ width: vp.width, height: vp.height });

    for (const r of auditRoutes) {
      const targetPage = r.useAdmin ? adminPage : custPage;
      await targetPage.goto(BASE + r.path, { waitUntil: 'networkidle' });
      await targetPage.waitForTimeout(150);
      const metrics = await targetPage.evaluate(() => {
        const vw = window.innerWidth;
        const sw = document.documentElement.scrollWidth;
        const overflowing = [];
        for (const el of document.querySelectorAll('nav a, nav button, form input, form select, form textarea, form button, table, .panel, h1, h2')) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          const cs = getComputedStyle(el);
          if (cs.visibility === 'hidden' || cs.display === 'none') continue;
          // Table wrappers are intentionally horizontally scrollable; check wrapper itself rather than inner wide table
          if (el.tagName === 'TABLE' && el.closest('.tablewrap, .admin-table-wrap')) continue;
          if (rect.right > vw + 2 || rect.left < -2) {
            overflowing.push({
              tag: el.tagName,
              cls: String(el.className || '').slice(0, 60),
              left: Math.round(rect.left),
              right: Math.round(rect.right),
              vw
            });
          }
        }
        // Check navbar visible items overlap
        const navItems = [...document.querySelectorAll('.navbar a, .navbar button, header a, header button')]
          .map((el) => ({ el, r: el.getBoundingClientRect(), cs: getComputedStyle(el) }))
          .filter((x) => x.r.width > 0 && x.r.height > 0 && x.cs.visibility !== 'hidden' && x.cs.display !== 'none');
        const navOverlaps = [];
        for (let i = 0; i < navItems.length; i++) {
          for (let j = i + 1; j < navItems.length; j++) {
            const a = navItems[i].r;
            const b = navItems[j].r;
            const xOv = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
            const yOv = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
            if (xOv > 4 && yOv > 4) {
              navOverlaps.push({ a: navItems[i].el.textContent?.trim(), b: navItems[j].el.textContent?.trim(), xOv: Math.round(xOv), yOv: Math.round(yOv) });
            }
          }
        }
        for (const row of document.querySelectorAll('.row')) {
          const kids = [...row.children]
            .map((el) => ({ el, r: el.getBoundingClientRect(), cs: getComputedStyle(el) }))
            .filter((x) => x.r.width > 0 && x.r.height > 0 && x.cs.visibility !== 'hidden' && x.cs.display !== 'none');
          for (let i = 0; i < kids.length; i++) {
            for (let j = i + 1; j < kids.length; j++) {
              const a = kids[i].r, b = kids[j].r;
              const xOv = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
              const yOv = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
              if (xOv > 4 && yOv > 4) {
                navOverlaps.push({ a: kids[i].el.textContent?.trim().slice(0, 30), b: kids[j].el.textContent?.trim().slice(0, 30), xOv: Math.round(xOv), yOv: Math.round(yOv) });
              }
            }
          }
        }
        // Check homepage floating hero chip vs process card overlap
        const heroCard = document.querySelector('.hero-process-card');
        const heroNote = document.querySelector('.hero-editorial-note');
        if (heroCard && heroNote) {
          const ncs = getComputedStyle(heroNote);
          if (ncs.display !== 'none' && ncs.visibility !== 'hidden') {
            const cr = heroCard.getBoundingClientRect();
            const nr = heroNote.getBoundingClientRect();
            const xOv = Math.max(0, Math.min(cr.right, nr.right) - Math.max(cr.left, nr.left));
            const yOv = Math.max(0, Math.min(cr.bottom, nr.bottom) - Math.max(cr.top, nr.top));
            if (xOv > 1 && yOv > 1) {
              navOverlaps.push({ a: 'hero-process-card', b: 'hero-editorial-note', xOv: Math.round(xOv), yOv: Math.round(yOv) });
            }
          }
        }
        return { vw, sw, overflowX: sw > vw + 1, overflowing: overflowing.slice(0, 5), navOverlaps };
      });

      // Verify mobile nav toggle works cleanly on narrow viewports
      let mobileMenuOk = true;
      if (vp.width <= 768) {
        const trigger = targetPage.locator('#mob-btn, #menu-toggle, .mobile-trigger, .nav-toggle').first();
        if ((await trigger.count()) > 0 && (await trigger.isVisible())) {
          await trigger.click();
          await targetPage.waitForTimeout(80);
          mobileMenuOk = await targetPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
          await trigger.click();
        }
      }

      if (['home', 'repairs', 'part-request', 'repair-center-admin', 'operations-admin'].includes(r.id)) {
        await targetPage.screenshot({ path: join(RESP_DIR, `${r.id}-${vp.name}px.png`) });
      }
      results.responsiveness.push({
        viewport: vp.name,
        route: r.path,
        scrollWidth: metrics.sw,
        innerWidth: metrics.vw,
        overflowX: metrics.overflowX,
        overflowingElements: metrics.overflowing,
        navOverlaps: metrics.navOverlaps,
        mobileMenuOk
      });
    }
  }

  await adminCtx.tracing.stop({ path: TRACE_PATH });
  await adminCtx.close();
  await custCtx.close();
} finally {
  await browser.close();
  server.close();
  rmSync(tempDataDir, { recursive: true, force: true });
}

const realDbAfterMtime = existsSync(REAL_DB) ? statSync(REAL_DB).mtimeMs : null;
results.environment.realDbUntouched = realDbBeforeMtime === realDbAfterMtime;

const respIssues = results.responsiveness.filter(
  (x) => x.overflowX || x.overflowingElements.length > 0 || x.navOverlaps.length > 0 || !x.mobileMenuOk
);
results.responsiveIssuesCount = respIssues.length;

writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
console.log(JSON.stringify({
  chromiumVersion: results.environment.chromiumVersion,
  realDbUntouched: results.environment.realDbUntouched,
  intro: results.intro.status,
  workflows: Object.fromEntries(Object.entries(results.workflows).map(([k, v]) => [k, v.status])),
  responsiveChecks: results.responsiveness.length,
  responsiveIssuesCount: respIssues.length,
  responsiveIssues: respIssues,
  consoleErrors: results.consoleErrors,
  pageErrors: results.pageErrors,
  failedAssets: results.failedAssets,
  failed5xx: results.failed5xx
}, null, 2));
if (results.pageErrors.length || results.failed5xx.length || results.failedAssets.length || respIssues.length) {
  process.exitCode = 1;
}
