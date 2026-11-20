import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const dir=mkdtempSync(join(tmpdir(),'rl-regression-'));process.env.DATA_DIR=dir;process.env.REPAIRLYLABS_TEST='1';process.env.TRUST_PROXY='1';process.env.RAZORPAY_WEBHOOK_SECRET='test-only-secret';
const {server,db}=await import('../src/server.mjs');const {issueRecovery}=await import('../src/admin-access.mjs');const {createHmac}=await import('node:crypto');
await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
let cookie='',csrf='';async function req(path,body,extra={},method=body===undefined?'GET':'POST'){return fetch(base+path,{method,headers:{...(body===undefined?{}:{'content-type':'application/json'}),...(cookie?{cookie,'x-csrf-token':csrf}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});}
test('audit regression: canonical routes, CSP, validation, credentials, rate limits, webhook',async()=>{try{
for(const p of ['/repair-center','/repair-center/','/repair-center/index.html']){const r=await req(p);assert.equal(r.status,200);assert.match(r.headers.get('content-security-policy'),/checkout\.razorpay\.com/);assert.match(r.headers.get('content-security-policy'),/fonts\.googleapis\.com/);const page=await r.text();assert.match(page,/RepairlyLabs \| Repair Center/);assert.doesNotMatch(page,/<script\s*>/)}
assert.equal((await req('/api/products?limit=2.5&offset=1.5')).status,200);assert.equal((await req('/api/products?offset=Infinity')).status,200);
const token=issueRecovery(db);assert.equal((await req('/api/admin/recovery-check',{token:'x'.repeat(43)})).status,403);assert.equal((await req('/api/admin/recovery-check',{token})).status,200);assert.equal((await req('/api/admin/recover',{token,password:'seven12'})).status,400);assert.equal((await req('/api/admin/recover',{token,password:'eight888',email:'owner@example.test'})).status,200);
assert.equal((await req('/api/admin/recovery-check',{token})).status,403);
const login=await req('/api/admin/login',{username:'owner@example.test',password:'eight888'});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];csrf=(await login.json()).csrf;
assert.equal((await req('/api/admin/password',{current:'eight888',next:'newpass8'},{},'PATCH')).status,200);
assert.equal((await req('/api/admin/export?type=constructor')).status,400);
assert.equal((await req('/api/admin/models/bulk',{models:[null]})).status,400);
assert.equal((await req('/api/orders',{items:[null],consent:true,name:'Demo',phone:'9876543210',locality:'Sigra',mode:'Workshop collection'})).status,400);
const ref=(await (await req('/api/bookings',{name:'Demo',phone:'9876543210',brand:'Apple',model:'iPhone 13',issue:'Display',method:'Discuss options',locality:'Sigra',consent:true})).json()).ref;
for(const id of [ref,'RLM-000000-00000000'])assert.equal((await req('/api/repair-center/job/'+id)).status,401);
const event={event:'payment.captured'};const signature=createHmac('sha256',process.env.RAZORPAY_WEBHOOK_SECRET).update(JSON.stringify(event)).digest('hex');assert.equal((await req('/api/repair-center/webhook',event,{'x-razorpay-signature':signature})).status,400);
assert.equal((await req('/api/admin/login',{username:'none',password:'bad'},{origin:base.replace('http:','https:')})).status,403);
for(let i=0;i<9;i++){const r=await req('/api/admin/login',{username:'none',password:'bad'},{'x-forwarded-for':`10.0.0.${i+1}, 192.0.2.90`});assert.equal(r.status,i<8?401:429)}
}finally{await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true})}});
