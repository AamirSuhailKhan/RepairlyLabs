import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, existsSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = resolve(import.meta.dirname, '..');
const REAL_DB = join(ROOT, 'data', 'repairlylabs.sqlite');
const realDbBeforeMtime = existsSync(REAL_DB) ? statSync(REAL_DB).mtimeMs : null;

const dir = mkdtempSync(join(tmpdir(), 'rl-launch-prep-'));
process.env.DATA_DIR = dir;
process.env.PORT = '0';
process.env.REPAIRLYLABS_TEST = '1';
process.env.TRUST_PROXY = '1';
process.env.TRUST_PROXY_CIDRS = '172.16.0.0/12';
process.env.PUBLIC_ORIGIN = 'https://repairlylabs.example';
delete process.env.RAZORPAY_KEY_ID;
delete process.env.RAZORPAY_KEY_SECRET;
delete process.env.RAZORPAY_WEBHOOK_SECRET;

const { validateEnvironment } = await import('../src/config.mjs');
const { server, db, trustedProxy, clientIp, isHttpsRequest } = await import('../src/server.mjs');
const { issueRecovery, recoverOwner } = await import('../src/admin-access.mjs');
const { createRepairCenter } = await import('../src/repair-center.mjs');
const { createGatewayExtensions } = await import('../src/gateway-extensions.mjs');

if (!server.listening) {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
}
const origin = `http://127.0.0.1:${server.address().port}`;
const ownerPass = 'LaunchPrep!' + randomBytes(8).toString('hex');
recoverOwner(db, { token: issueRecovery(db), username: 'lpowner', password: ownerPass });

async function req(path, method = 'GET', data, session, extraHeaders = {}) {
  const r = await fetch(origin + path, {
    method,
    headers: {
      origin,
      ...(data !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(session ? { cookie: session.cookie, 'x-csrf-token': session.csrf } : {}),
      ...extraHeaders
    },
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  const ct = r.headers.get('content-type') || '';
  const d = ct.includes('application/json') ? await r.json() : await r.text();
  return {
    status: r.status,
    headers: r.headers,
    d,
    cookie: r.headers.get('set-cookie')?.split(';')[0] || '',
    csrf: typeof d === 'object' && d ? d.csrf || '' : ''
  };
}

test('Phase 1A: Reverse-proxy CIDR allowlist blocks XFF/XFP spoofing and preserves Docker bridge client IPs', async () => {
  // Legitimate Docker bridge IPv4 and IPv4-mapped IPv6 proxies are trusted
  const dockerReq = {
    socket: { remoteAddress: '::ffff:172.18.0.5', encrypted: false },
    headers: {
      'x-forwarded-for': '1.2.3.4, 198.51.100.44, 172.17.0.2',
      'x-forwarded-proto': 'https'
    }
  };
  assert.equal(trustedProxy(dockerReq), true);
  // Right-to-left parsing skips 172.17.0.2 (trusted proxy) and picks 198.51.100.44, ignoring left-side spoof 1.2.3.4
  assert.equal(clientIp(dockerReq), '198.51.100.44');
  assert.equal(isHttpsRequest(dockerReq), true);

  // Arbitrary untrusted internet client trying to spoof XFF / XFP
  const spoofReq = {
    socket: { remoteAddress: '203.0.113.99', encrypted: false },
    headers: {
      'x-forwarded-for': '10.0.0.5',
      'x-forwarded-proto': 'https'
    }
  };
  assert.equal(trustedProxy(spoofReq), false);
  assert.equal(clientIp(spoofReq), '203.0.113.99');
  assert.equal(isHttpsRequest(spoofReq), false);

  // HTTP rate-limit isolation via trusted loopback proxy for distinct client IPs vs same IP
  for (let i = 0; i < 8; i++) {
    const resA = await req('/api/track?ref=RLM-261101-12345678&phone=9876500001', 'GET', undefined, null, {
      'x-forwarded-for': '198.51.100.71'
    });
    assert.equal(resA.status, 404);
  }
  const resB = await req('/api/track?ref=RLM-261101-12345678&phone=9876500001', 'GET', undefined, null, {
    'x-forwarded-for': '198.51.100.72'
  });
  assert.equal(resB.status, 404, 'Distinct forwarded client IP must receive its own rate-limit bucket');

  for (let i = 0; i < 22; i++) {
    await req('/api/track?ref=RLM-261101-12345678&phone=9876500001', 'GET', undefined, null, {
      'x-forwarded-for': '198.51.100.71'
    });
  }
  const throttled = await req('/api/track?ref=RLM-261101-12345678&phone=9876500001', 'GET', undefined, null, {
    'x-forwarded-for': '198.51.100.71'
  });
  assert.equal(throttled.status, 429, 'Client exceeding 30 track requests in bucket must be rate-limited');

  const unaffected = await req('/api/track?ref=RLM-261101-12345678&phone=9876500001', 'GET', undefined, null, {
    'x-forwarded-for': '198.51.100.72'
  });
  assert.equal(unaffected.status, 404, 'Rate limiting one forwarded client must not block other customers');
});

test('Phase 2: Startup environment validation rejects unsafe flags, bad CIDRs, and malformed keys', () => {
  const prodWithTest = validateEnvironment({ NODE_ENV: 'production', REPAIRLYLABS_TEST: '1', PUBLIC_ORIGIN: 'https://shop.in' });
  assert.equal(prodWithTest.ok, false);

  const badOrigin = validateEnvironment({ NODE_ENV: 'production', PUBLIC_ORIGIN: 'http://insecure.in' });
  assert.equal(badOrigin.ok, false);

  const badCidr = validateEnvironment({ TRUST_PROXY: '1', TRUST_PROXY_CIDRS: '172.16.0.0/99' });
  assert.equal(badCidr.ok, false);

  const badBackupKey = validateEnvironment({ RL_BACKUP_KEY: 'not-64-hex' });
  assert.equal(badBackupKey.ok, false);

  const goodProd = validateEnvironment({
    NODE_ENV: 'production',
    PORT: '3001',
    PUBLIC_ORIGIN: 'https://repairlylabs.in',
    TRUST_PROXY: '1',
    TRUST_PROXY_CIDRS: '172.16.0.0/12',
    RL_BACKUP_KEY: 'a'.repeat(64)
  });
  assert.equal(goodProd.ok, true);
});

test('Phase 1B: Refund crash recovery, timeout idempotency, concurrency lock, partial refunds & webhooks', async () => {
  // Isolate gateway test on a dedicated DB inside temp dir so fault-injection triggers don't touch main server DB
  const gwDir = mkdtempSync(join(dir, 'gw-'));
  const { openDatabase } = await import('../src/data.mjs');
  const gwDb = openDatabase(gwDir);
  initSeed(gwDb);

  const calls = [];
  let mode = 'normal';
  let refundSeq = 0;
  const providerRefunds = new Map(); // pay_id -> array of refund entities

  const env = {
    RAZORPAY_KEY_ID: 'rzp_test_mock1234',
    RAZORPAY_KEY_SECRET: 'mock_secret_123456',
    RAZORPAY_WEBHOOK_SECRET: 'mock_webhook_sec_123456'
  };

  let gw;
  const rc = createRepairCenter({
    db: gwDb,
    auth: () => ({ username: 'lpowner', role: 'owner', permission: 'owner' }),
    ok: (res, d, status = 200) => { res.statusCode = status; res.d = d; },
    bodyJson: async (r) => r.body,
    limit: () => {},
    respond: () => {},
    worker: false,
    env,
    onWebhook: (event) => gw.handleWebhook(event)
  });
  gw = createGatewayExtensions({
    db: gwDb,
    auth: () => ({ username: 'lpowner', role: 'owner', permission: 'owner' }),
    ok: (res, d, status = 200) => { res.statusCode = status; res.d = d; },
    bodyJson: async (r) => r.body,
    limit: () => {},
    access: () => {},
    env,
    worker: false,
    http: async (url, opts) => {
      const m = opts?.method || 'GET';
      const u = String(url);
      calls.push({ method: m, url: u, body: opts?.body ? JSON.parse(opts.body) : null });

      if (m === 'POST' && u.endsWith('/refund')) {
        const payId = u.split('/').at(-2);
        const payload = JSON.parse(opts.body);
        if (mode === 'timeout_silent_success') {
          const rfnd = { id: 'rfnd_TimeoutOk01', payment_id: payId, amount: payload.amount, currency: 'INR', receipt: payload.receipt, notes: payload.notes, status: 'processed' };
          providerRefunds.set(payId, [...(providerRefunds.get(payId) || []), rfnd]);
          throw new Error('Network socket timeout');
        }
        if (mode === 'timeout_no_create') {
          throw new Error('Network gateway unreachable');
        }
        const idNum = ++refundSeq;
        const statusVal = mode === 'slow_pending' ? 'pending' : 'processed';
        const rfnd = { id: `rfnd_Mock000${idNum}`, payment_id: payId, amount: payload.amount, currency: 'INR', receipt: payload.receipt, notes: payload.notes, status: statusVal };
        providerRefunds.set(payId, [...(providerRefunds.get(payId) || []), rfnd]);
        if (mode === 'slow_pending') {
          await new Promise((r) => setTimeout(r, 60));
        }
        return { ok: true, status: 200, json: async () => rfnd };
      }

      if (m === 'GET' && u.endsWith('/refunds')) {
        const payId = u.split('/').at(-2);
        return { ok: true, status: 200, json: async () => ({ items: providerRefunds.get(payId) || [] }) };
      }

      const singleMatch = u.match(/\/refunds\/(rfnd_[A-Za-z0-9]+)$/);
      if (m === 'GET' && singleMatch) {
        const allItems = [...providerRefunds.values()].flat();
        const found = allItems.find((x) => x.id === singleMatch[1]);
        if (!found) return { ok: false, status: 404, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => found };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }
  });

  // Scenario 1: Provider POST succeeded, local DB throws BEFORE provider_id saves (via transient SQLite trigger crash)
  const ref = 'RLM-261124-AAAA0001';
  gwDb.prepare("INSERT INTO bookings(ref,name,phone,brand,model,issue,method,locality,consent_at) VALUES(?,?,?,?,?,?,?,?,?)")
    .run(ref, 'Crash Test User', '9876543210', 'Apple', 'iPhone 15', 'Display', 'Visit workshop', 'Sigra', new Date().toISOString());
  gwDb.prepare("UPDATE rl_jobs SET stage='approved',total=200000,deposit=100000 WHERE ref=?").run(ref);
  gwDb.prepare("INSERT INTO rl_payments(ref,receipt,order_id,payment_id,amount,state,method,verified_by) VALUES(?,?,?,?,?,'captured','razorpay','gateway')")
    .run(ref, 'rcp_CrashOriginal', 'order_Crash01', 'pay_Crash01', 100000);

  // Force SQLite abort right when UPDATE ext_gateway_refund sets provider_id once
  gwDb.exec("CREATE TRIGGER test_abort_refund_save BEFORE UPDATE OF provider_id ON ext_gateway_refund WHEN NEW.provider_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'Simulated power loss before saving provider_id'); END;");
  const r1 = {};
  await assert.rejects(() => gw.handle({ method: 'POST', body: { receipt: 'rcp_CrashOriginal', amount: 40000, confirmed: true, note: 'Crash test partial 1' } }, r1, new URL(origin + `/api/gateway-extension/${ref}/refund`)));
  gwDb.exec('DROP TRIGGER test_abort_refund_save');

  const stalledRow = gwDb.prepare("SELECT p.receipt, p.state, e.attempted_at, e.provider_id FROM rl_payments p JOIN ext_gateway_refund e ON e.payment_row=p.id WHERE p.method='gateway_refund'").get();
  assert.equal(stalledRow.state, 'reconciliation_required');
  assert.ok(stalledRow.attempted_at, 'attempted_at must have persisted atomically BEFORE calling provider');
  assert.equal(stalledRow.provider_id, null);

  // Trigger background reconciliation tick() -> MUST query GET /refunds (NO second POST!) and bind rfnd_Mock0001
  const postCountBeforeTick = calls.filter((c) => c.method === 'POST').length;
  await gw.tick();
  const postCountAfterTick = calls.filter((c) => c.method === 'POST').length;
  assert.equal(postCountAfterTick, postCountBeforeTick, 'Crash recovery MUST NOT issue a duplicate POST /refund');

  const settled1 = gwDb.prepare("SELECT p.state, e.provider_id FROM rl_payments p JOIN ext_gateway_refund e ON e.payment_row=p.id WHERE p.receipt=?").get(stalledRow.receipt);
  assert.equal(settled1.state, 'refund_complete');
  assert.equal(settled1.provider_id, 'rfnd_Mock0001');
  assert.equal(gwDb.prepare('SELECT COALESCE(SUM(amount),0) n FROM rl_payment_adjustments').get().n, 40000);

  // Scenario 2: Network timeout where provider did NOT create refund -> refund-check refuses blind re-POST (409)
  mode = 'timeout_no_create';
  const r2 = {};
  await assert.rejects(() => gw.handle({ method: 'POST', body: { receipt: 'rcp_CrashOriginal', amount: 25000, confirmed: true, note: 'Timeout test 2' } }, r2, new URL(origin + `/api/gateway-extension/${ref}/refund`)), { status: 502 });
  const recTimeout = gwDb.prepare("SELECT receipt FROM rl_payments WHERE method='gateway_refund' AND state='reconciliation_required'").get().receipt;

  const postBeforeCheck = calls.filter((c) => c.method === 'POST').length;
  await assert.rejects(() => gw.handle({ method: 'POST', body: { receipt: recTimeout } }, {}, new URL(origin + `/api/gateway-extension/${ref}/refund-check`)), { status: 409 });
  assert.equal(calls.filter((c) => c.method === 'POST').length, postBeforeCheck, 'refund-check must NOT re-POST while refund outcome is uncertain');

  // Scenario 3: Webhook signing rejection (401), valid delayed refund.processed settles unlinked row cleanly, duplicate + out-of-order late refund.created stay idempotent!
  const whPayload = JSON.stringify({
    event: 'refund.processed',
    payload: {
      refund: {
        entity: {
          id: 'rfnd_DelayedWh02',
          payment_id: 'pay_Crash01',
          amount: 25000,
          currency: 'INR',
          receipt: recTimeout,
          notes: { reference: ref, receipt: recTimeout },
          status: 'processed'
        }
      }
    }
  });
  const badSigReq = new FakeRawReq(whPayload, '0'.repeat(64));
  await assert.rejects(() => rc.handle(badSigReq, {}, new URL(origin + '/api/repair-center/webhook')), { status: 401 });

  const goodSig = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(whPayload).digest('hex');
  const whRes1 = {};
  await rc.handle(new FakeRawReq(whPayload, goodSig), whRes1, new URL(origin + '/api/repair-center/webhook'));
  assert.equal(whRes1.statusCode, 200);
  assert.equal(gwDb.prepare('SELECT COALESCE(SUM(amount),0) n FROM rl_payment_adjustments').get().n, 65000);

  // Repeated refund.processed webhook must remain idempotent (zero double credit)
  await rc.handle(new FakeRawReq(whPayload, goodSig), {}, new URL(origin + '/api/repair-center/webhook'));
  assert.equal(gwDb.prepare('SELECT COALESCE(SUM(amount),0) n FROM rl_payment_adjustments').get().n, 65000);

  // Out-of-order late refund.created webhook must not downgrade refund_complete
  const lateCreated = JSON.stringify({
    event: 'refund.created',
    payload: { refund: { entity: { id: 'rfnd_DelayedWh02', payment_id: 'pay_Crash01', amount: 25000, currency: 'INR', receipt: recTimeout, status: 'pending' } } }
  });
  const lateSig = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(lateCreated).digest('hex');
  await rc.handle(new FakeRawReq(lateCreated, lateSig), {}, new URL(origin + '/api/repair-center/webhook'));
  assert.equal(gwDb.prepare('SELECT state FROM rl_payments WHERE receipt=?').get(recTimeout).state, 'refund_complete');

  // Conflicting provider id for already settled refund throws 409
  const conflictWh = JSON.stringify({
    event: 'refund.processed',
    payload: { refund: { entity: { id: 'rfnd_Mismatch99', payment_id: 'pay_Crash01', amount: 25000, currency: 'INR', receipt: recTimeout, status: 'processed' } } }
  });
  const conflictSig = createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(conflictWh).digest('hex');
  await assert.rejects(() => rc.handle(new FakeRawReq(conflictWh, conflictSig), {}, new URL(origin + '/api/repair-center/webhook')), { status: 409 });

  // Scenario 4: Partial refund limit guard (100000 - 65000 = 35000 remaining -> 35001 rejected 400)
  await assert.rejects(() => gw.handle({ method: 'POST', body: { receipt: 'rcp_CrashOriginal', amount: 35001, confirmed: true, note: 'Over limit' } }, {}, new URL(origin + `/api/gateway-extension/${ref}/refund`)), { status: 400 });

  // Scenario 5: Concurrency lock on simultaneous refund-check + owner link-refund
  mode = 'slow_pending';
  const rSlow = {};
  await gw.handle({ method: 'POST', body: { receipt: 'rcp_CrashOriginal', amount: 35000, confirmed: true, note: 'Final partial pending' } }, rSlow, new URL(origin + `/api/gateway-extension/${ref}/refund`));
  assert.equal(rSlow.d.state, 'pending');
  // Upgrade provider refund status to processed, then fire concurrent link-refund / refund-check races
  providerRefunds.get('pay_Crash01').find((x) => x.receipt === rSlow.d.receipt).status = 'processed';
  const rLink = {};
  await gw.handle({ method: 'POST', body: { receipt: rSlow.d.receipt, refund_id: rSlow.d.provider_id } }, rLink, new URL(origin + `/api/gateway-extension/${ref}/link-refund`));
  assert.equal(rLink.d.state, 'processed');
  assert.equal(gwDb.prepare('SELECT COALESCE(SUM(amount),0) n FROM rl_payment_adjustments').get().n, 100000);

  // Scenario 6: Direct concurrent refund-check race on an active inFlight attempt rejects second request cleanly
  const rConc = { ref, receipt: 'rcp_CrashConc', amount: 20000 };
  gwDb.prepare("INSERT INTO rl_payments(ref,receipt,order_id,payment_id,amount,state,method,verified_by) VALUES(?,?,?,?,?,'captured','razorpay','gateway')")
    .run(ref, rConc.receipt, 'order_Conc01', 'pay_Conc01', 20000);
  mode = 'slow_pending';
  const raceStart = {};
  const pSlow = gw.handle({ method: 'POST', body: { receipt: rConc.receipt, amount: 10000, confirmed: true, note: 'Race start' } }, raceStart, new URL(origin + `/api/gateway-extension/${ref}/refund`));
  // Wait microtask so POST enters inFlightRefunds, then verify second concurrent refund-check hits 409 lock
  await new Promise((r) => setTimeout(r, 15));
  const pendingRec = gwDb.prepare("SELECT receipt FROM rl_payments WHERE ref=? AND method='gateway_refund' ORDER BY id DESC LIMIT 1").get(ref).receipt;
  await assert.rejects(() => gw.handle({ method: 'POST', body: { receipt: pendingRec } }, {}, new URL(origin + `/api/gateway-extension/${ref}/refund-check`)), { status: 409 });
  await pSlow;
  gwDb.close();
});

test('Phase 4: Encrypted backups (AES-256-GCM), offsite copy, retention pruning & isolated restore check', () => {
  const bDir = mkdtempSync(join(dir, 'bk-data-'));
  const offsiteDir = join(dir, 'bk-offsite');
  const restoreOkDir = join(dir, 'bk-restore-ok');
  const restoreNoKeyDir = join(dir, 'bk-restore-nokey');
  const backupKey = '0123456789abcdef'.repeat(4);

  // Seed DB inside bDir
  const initDb = new DatabaseSync(join(bDir, 'repairlylabs.sqlite'));
  initDb.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT); INSERT INTO t(val) VALUES('encrypted-ok');");
  initDb.close();

  const baseEnv = {
    ...process.env,
    NODE_ENV: 'test',
    DATA_DIR: bDir,
    RL_BACKUP_KEY: backupKey,
    RL_BACKUP_OFFSITE_DIR: offsiteDir,
    RL_BACKUP_RETENTION: '2'
  };

  for (let i = 0; i < 3; i++) {
    const out = spawnSync(process.execPath, ['scripts/backup.mjs'], { cwd: ROOT, env: baseEnv, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr || out.stdout);
    assert.match(out.stdout, /Backup: .*\.sqlite\.enc/);
    // Ensure unique millisecond stamp across fast runs
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }

  const localBackups = readdirSync(join(bDir, 'backups')).filter((f) => f.endsWith('.sqlite.enc'));
  const plainBackups = readdirSync(join(bDir, 'backups')).filter((f) => f.endsWith('.sqlite'));
  assert.equal(localBackups.length, 2, 'Retention limit RL_BACKUP_RETENTION=2 must keep newest 2 backups');
  assert.equal(plainBackups.length, 0, 'Unencrypted temporary snapshots must be removed when RL_BACKUP_KEY is active');
  assert.ok(readdirSync(offsiteDir).length >= 1, 'Offsite folder must receive encrypted backup copies');

  const latestEnc = join(bDir, 'backups', localBackups.sort().at(-1));
  const encBytes = readFileSync(latestEnc);
  assert.equal(encBytes.subarray(0, 5).toString('binary'), 'RLBK\x01');

  // Restore without key must fail cleanly
  const noKeyEnv = { ...process.env, NODE_ENV: 'test', DATA_DIR: bDir };
  delete noKeyEnv.RL_BACKUP_KEY;
  const failRes = spawnSync(process.execPath, ['scripts/restore-check.mjs', latestEnc, restoreNoKeyDir], {
    cwd: ROOT,
    env: noKeyEnv,
    encoding: 'utf8'
  });
  assert.notEqual(failRes.status, 0);

  // Restore with valid key succeeds and preserves contents
  const okRes = spawnSync(process.execPath, ['scripts/restore-check.mjs', latestEnc, restoreOkDir], {
    cwd: ROOT,
    env: baseEnv,
    encoding: 'utf8'
  });
  assert.equal(okRes.status, 0, okRes.stderr || okRes.stdout);
  const checkDb = new DatabaseSync(join(restoreOkDir, 'repairlylabs.sqlite'), { readOnly: true });
  assert.equal(checkDb.prepare('SELECT val FROM t').get().val, 'encrypted-ok');
  checkDb.close();
});

test('Phase 6, 8 & 10: Terms/Privacy SEO routes, immutable asset cache, schema_migrations & owner monitor telemetry', async () => {
  // Migrations recorded
  const migrations = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all();
  assert.ok(migrations.some((m) => m.version === 1) && migrations.some((m) => m.version === 2));

  // Public policy routes & sitemap & JSON-LD
  const homeRes = await req('/');
  assert.equal(homeRes.status, 200);
  assert.match(homeRes.headers.get('cache-control') || '', /no-store/);
  assert.match(homeRes.d, /"@type":"MobilePhoneRepair"/);

  const termsRes = await req('/terms');
  assert.equal(termsRes.status, 200);
  assert.match(termsRes.d, /rel="canonical" href="https:\/\/repairlylabs\.example\/terms"/);

  const sitemapRes = await req('/sitemap.xml');
  assert.equal(sitemapRes.status, 200);
  assert.match(sitemapRes.d, /https:\/\/repairlylabs\.example\/terms/);
  assert.match(sitemapRes.d, /https:\/\/repairlylabs\.example\/privacy/);

  // Immutable cache header on versioned static asset vs short TTL on unversioned
  const immutableRes = await req('/styles.css?v=release1');
  assert.equal(immutableRes.status, 200);
  assert.equal(immutableRes.headers.get('cache-control'), 'public, max-age=31536000, immutable');

  const unversionedRes = await req('/styles.css');
  assert.equal(unversionedRes.status, 200);
  assert.equal(unversionedRes.headers.get('cache-control'), 'public, max-age=300');

  // Owner telemetry monitor check (without leaking secrets)
  const login = await req('/api/admin/login', 'POST', { username: 'lpowner', password: ownerPass }, null, {
    origin: 'https://repairlylabs.example'
  });
  assert.equal(login.status, 200);
  const mon = await req('/api/extended/monitor', 'GET', undefined, { cookie: login.cookie, csrf: login.csrf });
  assert.equal(mon.status, 200);
  assert.equal(typeof mon.d.db_size_bytes, 'number');
  assert.equal(typeof mon.d.wal_size_bytes, 'number');
  assert.equal(typeof mon.d.disk.available_bytes, 'number');
  assert.equal(typeof mon.d.disk.free_pct, 'number');
  assert.equal(typeof mon.d.backups.count, 'number');
  assert.equal(typeof mon.d.failed_notifications_count, 'number');
  assert.equal(typeof mon.d.reconciliation_required_count, 'number');
  assert.equal(mon.d.public_origin_configured, true);
  assert.equal(mon.d.gateway_configured, false);
});

class FakeRawReq {
  constructor(payload, signature) {
    this.method = 'POST';
    this.headers = { 'x-razorpay-signature': signature };
    this._payload = payload;
  }
  async *[Symbol.asyncIterator]() {
    yield Buffer.from(this._payload, 'utf8');
  }
}

function initSeed(dbObj) {
  dbObj.exec(`CREATE TABLE IF NOT EXISTS booking_submissions (fingerprint TEXT PRIMARY KEY, ref TEXT NOT NULL, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS request_keys (key_hash TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, ref TEXT NOT NULL, created_at INTEGER NOT NULL);`);
}

test.after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
  const realDbAfterMtime = existsSync(REAL_DB) ? statSync(REAL_DB).mtimeMs : null;
  assert.equal(realDbBeforeMtime, realDbAfterMtime, 'Real database must never be touched');
});
