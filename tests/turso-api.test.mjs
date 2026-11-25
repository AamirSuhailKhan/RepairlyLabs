import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTursoClient } from '../src/turso.mjs';
import { openDatabase } from '../src/data.mjs';
import { createCloudApp } from '../api/turso-api.mjs';

class MockRes extends EventEmitter {
  constructor() { super(); this.statusCode = 200; this.headers = {}; this.body = ''; }
  writeHead(status, hdrs = {}) { this.statusCode = status; Object.assign(this.headers, hdrs); }
  setHeader(k, v) { this.headers[k] = v; }
  end(chunk = '') { if (chunk) this.body += String(chunk); this.emit('finish'); }
}

async function callApp(handler, method, path, body = undefined, headers = {}) {
  const req = {
    method,
    url: path,
    headers: { host: 'repairly-labs.vercel.app', ...headers },
    body,
    async *[Symbol.asyncIterator]() {
      if (body !== undefined) yield Buffer.from(JSON.stringify(body));
    }
  };
  const res = new MockRes();
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch {}
  return { status: res.statusCode, headers: res.headers, body: res.body, json };
}

test('createTursoClient speaks Hrana v2 pipeline with args, types, and baton transactions', async () => {
  const seen = [];
  let baton = null;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    seen.push({ auth: req.headers.authorization, url: req.url, payload });
    const results = [];
    for (const r of payload.requests) {
      if (r.type === 'execute') {
        if (r.stmt.sql === 'BEGIN IMMEDIATE') baton = 'baton-1';
        if (r.stmt.sql === 'COMMIT' || r.stmt.sql === 'ROLLBACK') baton = null;
        results.push({
          type: 'ok',
          response: {
            type: 'execute',
            result: {
              cols: r.stmt.want_rows ? [{ name: 'id' }, { name: 'name' }] : [],
              rows: r.stmt.want_rows ? [[{ type: 'integer', value: '7' }, { type: 'text', value: 'Pixel 9' }]] : [],
              affected_row_count: r.stmt.want_rows ? 0 : 1,
              last_insert_rowid: r.stmt.want_rows ? null : '7'
            }
          }
        });
      } else {
        results.push({ type: 'ok', response: { type: r.type } });
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ baton, base_url: null, results }));
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const port = server.address().port;
    const client = createTursoClient({ url: `http://127.0.0.1:${port}`, authToken: 'tok-test' });
    await client.tx(async () => {
      const ins = await client.run('INSERT INTO t VALUES(?, ?)', 7, 'Pixel 9');
      assert.equal(ins.changes, 1);
      assert.equal(ins.lastInsertRowid, 7);
      const row = await client.get('SELECT id, name FROM t WHERE id=?', 7);
      assert.deepEqual(row, { id: 7, name: 'Pixel 9' });
    });
    assert.equal(seen[0].auth, 'Bearer tok-test');
    assert.equal(seen[0].url, '/v2/pipeline');
    assert.equal(seen[1].payload.baton, 'baton-1');
    assert.equal(seen[3].payload.requests[0].stmt.sql, 'COMMIT');
  } finally {
    server.close();
  }
});

test('createCloudApp bootstraps OWNER_EMAIL, signs in via email, manages team emails, bookings, and tracking', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rl-cloud-'));
  try {
    const syncDb = openDatabase(dir);
    const { wrapDb } = await import('../src/turso.mjs');
    const handler = createCloudApp({
      env: {
        NODE_ENV: 'production',
        PUBLIC_ORIGIN: 'https://repairly-labs.vercel.app',
        OWNER_EMAIL: 'crmsoftware99@gmail.com',
        OWNER_PASSWORD: 'StrongPassword123!'
      },
      dbOverride: wrapDb(syncDb)
    });

    const cfg = await callApp(handler, 'GET', '/api/config');
    assert.equal(cfg.status, 200);
    assert.ok(cfg.json.brands.length >= 10);

    const badLogin = await callApp(handler, 'POST', '/api/admin/login', {
      username: 'crmsoftware99@gmail.com',
      password: 'wrong-password'
    });
    assert.equal(badLogin.status, 401);

    const login = await callApp(handler, 'POST', '/api/admin/login', {
      username: 'crmsoftware99@gmail.com',
      password: 'StrongPassword123!'
    });
    assert.equal(login.status, 200);
    assert.equal(login.json.email, 'crmsoftware99@gmail.com');
    assert.equal(login.json.role, 'owner');
    const setCookie = login.headers['Set-Cookie'].split(';')[0];
    const csrf = login.json.csrf;

    const me = await callApp(handler, 'GET', '/api/admin/me', undefined, { cookie: setCookie });
    assert.equal(me.status, 200);
    assert.equal(me.json.email, 'crmsoftware99@gmail.com');

    // Create a second team member with a different email ID and verify login works from any configured email
    const addTeam = await callApp(handler, 'POST', '/api/admin/team', {
      action: 'create',
      current: 'StrongPassword123!',
      username: 'staff1',
      email: 'staff.team@example.com',
      password: 'StaffPassword123!',
      permission: 'manager'
    }, { cookie: setCookie, 'x-csrf-token': csrf });
    assert.equal(addTeam.status, 200);

    const staffLogin = await callApp(handler, 'POST', '/api/admin/login', {
      username: 'staff.team@example.com',
      password: 'StaffPassword123!'
    });
    assert.equal(staffLogin.status, 200);
    assert.equal(staffLogin.json.email, 'staff.team@example.com');
    assert.equal(staffLogin.json.permission, 'manager');

    // Booking + Track round-trip
    const booking = await callApp(handler, 'POST', '/api/bookings', {
      name: 'Aamir Khan',
      phone: '9876543210',
      brand: 'Apple',
      model: 'iPhone 15',
      issue: 'Battery replacement',
      method: 'Visit workshop',
      locality: 'Sigra',
      consent: true
    });
    assert.equal(booking.status, 201);
    assert.match(booking.json.ref, /^RLM-\d{6}-[0-9A-F]{8}$/);

    const track = await callApp(handler, 'GET', `/api/track?ref=${booking.json.ref}&phone=9876543210`);
    assert.equal(track.status, 200);
    assert.equal(track.json.record.model, 'iPhone 15');

    // Public customer account registration with any email ID & strict isolation from /admin and other customers
    const reg = await callApp(handler, 'POST', '/api/customer/register', {
      name: 'Ravi Sharma',
      email: 'ravi.sharma@gmail.com',
      phone: '9876501234',
      password: 'CustomerPass123!'
    });
    assert.equal(reg.status, 201);
    assert.equal(reg.json.email, 'ravi.sharma@gmail.com');
    const custCookie = reg.headers['Set-Cookie'].split(';')[0];
    const custCsrf = reg.json.csrf;

    // Customer cannot access /admin/overview
    const blockedAdmin = await callApp(handler, 'GET', '/api/admin/overview', undefined, { cookie: custCookie });
    assert.equal(blockedAdmin.status, 401);

    // Duplicate email rejected
    const dupReg = await callApp(handler, 'POST', '/api/customer/register', {
      name: 'Another User',
      email: 'RAVI.SHARMA@gmail.com',
      password: 'CustomerPass123!'
    });
    assert.equal(dupReg.status, 409);

    // Customer creates a booking while signed in (auto-linked to email) and sees only their own booking
    const custBooking = await callApp(handler, 'POST', '/api/bookings', {
      name: 'Ravi Sharma',
      phone: '9876501234',
      brand: 'Samsung',
      model: 'Galaxy S24',
      issue: 'Screen & display repair',
      method: 'Visit workshop',
      locality: 'Lanka',
      consent: true
    }, { cookie: custCookie });
    assert.equal(custBooking.status, 201);

    const myReqs = await callApp(handler, 'GET', '/api/customer/requests', undefined, { cookie: custCookie });
    assert.equal(myReqs.status, 200);
    assert.equal(myReqs.json.repairs.length, 1);
    assert.equal(myReqs.json.repairs[0].model, 'Galaxy S24');

    // Logout requires CSRF and clears session
    const logoutBad = await callApp(handler, 'POST', '/api/customer/logout', {}, { cookie: custCookie });
    assert.equal(logoutBad.status, 403);
    const logoutOk = await callApp(handler, 'POST', '/api/customer/logout', {}, { cookie: custCookie, 'x-csrf-token': custCsrf });
    assert.equal(logoutOk.status, 200);

    // Login again with registered email
    const custLogin = await callApp(handler, 'POST', '/api/customer/login', {
      email: 'ravi.sharma@gmail.com',
      password: 'CustomerPass123!'
    });
    assert.equal(custLogin.status, 200);
    assert.equal(custLogin.json.name, 'Ravi Sharma');

    // Distinguish unregistered email vs wrong password clearly
    const missingLogin = await callApp(handler, 'POST', '/api/customer/login', {
      email: 'nobody-yet@gmail.com',
      password: 'CustomerPass123!'
    });
    assert.equal(missingLogin.status, 401);
    assert.equal(missingLogin.json.code, 'ACCOUNT_NOT_FOUND');

    const badPassLogin = await callApp(handler, 'POST', '/api/customer/login', {
      email: 'ravi.sharma@gmail.com',
      password: 'WrongPassword!'
    });
    assert.equal(badPassLogin.status, 401);
    assert.equal(badPassLogin.json.code, 'INVALID_PASSWORD');

    syncDb.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
