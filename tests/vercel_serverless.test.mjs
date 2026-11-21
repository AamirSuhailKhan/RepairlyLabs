import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

class MockRes extends EventEmitter {
  constructor() { super(); this.statusCode=200; this.headers={}; this.body=''; }
  setHeader(name,value){ this.headers[name]=value; }
  end(chunk=''){ this.body += String(chunk); this.emit('finish'); }
}

test('Vercel deployment fails closed before opening disposable SQLite databases', async () => {
  const oldVercel = process.env.VERCEL;
  const oldTest = process.env.REPAIRLYLABS_TEST;
  try {
    process.env.VERCEL='1';
    process.env.REPAIRLYLABS_TEST='1'; // Even test mode cannot bypass this safety gate.
    const { default: handler } = await import('../api/index.mjs');
    for (const url of ['/api/health','/api/bookings','/api/admin/login']) {
      const req={method:url.includes('bookings')?'POST':'GET',url,headers:{}};
      const res=new MockRes();
      await handler(req,res);
      assert.equal(res.statusCode,503);
      assert.equal(res.headers['Cache-Control'],'no-store');
      const body=JSON.parse(res.body);
      assert.equal(body.code,'PERSISTENT_HOST_REQUIRED');
    }
  } finally {
    if (oldVercel===undefined) delete process.env.VERCEL; else process.env.VERCEL=oldVercel;
    if (oldTest===undefined) delete process.env.REPAIRLYLABS_TEST; else process.env.REPAIRLYLABS_TEST=oldTest;
  }
});
