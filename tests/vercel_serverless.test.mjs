import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

class MockReq extends EventEmitter {
  constructor(method, url, headers = {}, body = null) {
    super();
    this.method = method;
    this.url = url;
    this.headers = headers;
    this.socket = { remoteAddress: '127.0.0.1', encrypted: true };
    this._body = body;
  }
  [Symbol.asyncIterator]() {
    const chunk = this._body ? Buffer.from(typeof this._body === 'string' ? this._body : JSON.stringify(this._body)) : null;
    let done = false;
    return {
      async next() {
        if (!chunk || done) return { done: true, value: undefined };
        done = true;
        return { done: false, value: chunk };
      }
    };
  }
}

class MockRes extends EventEmitter {
  constructor() {
    super();
    this.statusCode = 200;
    this.headers = {};
    this.body = '';
  }
  writeHead(code, headers) {
    this.statusCode = code;
    Object.assign(this.headers, headers);
  }
  setHeader(name, value) {
    this.headers[name] = value;
  }
  end(chunk) {
    if (chunk) this.body += chunk.toString();
    this.emit('finish');
    return this;
  }
}

test('Vercel serverless handler executes API routes correctly', async () => {
  process.env.VERCEL = '1';
  process.env.REPAIRLYLABS_TEST = '1';
  
  const { default: handler } = await import('../api/index.mjs');

  // Test 1: Health check
  {
    const req = new MockReq('GET', '/api/health');
    const res = new MockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.ok, true);
    assert.equal(data.app, 'RepairlyLabs');
  }

  // Test 2: Ready check
  {
    const req = new MockReq('GET', '/api/ready');
    const res = new MockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.ok, true);
  }

  // Test 3: Config check
  {
    const req = new MockReq('GET', '/api/config');
    const res = new MockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.equal(data.settings.business_name, 'RepairlyLabs');
  }

  // Test 4: Products check
  {
    const req = new MockReq('GET', '/api/products?limit=5');
    const res = new MockRes();
    await handler(req, res);
    assert.equal(res.statusCode, 200);
    const data = JSON.parse(res.body);
    assert.ok(Array.isArray(data.items));
    assert.ok(data.items.length > 0);
  }
});
