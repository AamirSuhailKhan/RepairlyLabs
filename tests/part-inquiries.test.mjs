import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const temp=mkdtempSync(join(tmpdir(),'repairly-inquiry-'));
process.env.DATA_DIR=temp;process.env.REPAIRLYLABS_TEST='1';
const {server,db}=await import('../src/server.mjs');
const {issueRecovery}=await import('../src/admin-access.mjs');
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const url='http://127.0.0.1:'+server.address().port;
async function request(route,method='GET',body,session){
 const response=await fetch(url+route,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(session?{'Cookie':session.cookie,'x-csrf-token':session.csrf}:{})},body:body===undefined?undefined:JSON.stringify(body)});
 const type=response.headers.get('content-type')||'';
 const data=type.includes('application/json')?await response.json():await response.text();
 return {code:response.status,data,cookie:response.headers.get('set-cookie')?.split(';')[0],csrf:data.csrf,headers:response.headers};
}
const expect=async(r,code)=>{assert.equal(r.code,code,JSON.stringify(r.data).slice(0,500));return r;};
const entry={name:'Customer Example',phone:'9876543210',email:'client@example.test',whatsapp:true,brand:'Apple',model:'iPhone 13',variant:'A2633',colour:'Black',category:'Display & touchscreen',description:'Need OLED display for exact iPhone 13 model',qty:2,grade:'High-quality compatible',method:'Delivery requested',locality:'Sigra',city:'Varanasi',region:'Uttar Pradesh',address:'Example customer provided address near Sigra Varanasi',pincode:'221010',urgency:'As soon as possible',notes:'Please quote both quality variants',consent:true,request_key:'1'.repeat(64)};

test('parts enquiry: unique ID, private token, queue, response, acceptance, immutable acceptance, duplicate key and role protection',async()=>{
 try{
  const docs=await request('/part-request/');assert.equal(docs.code,200);assert.match(docs.data,/Request Mobile Parts/);
  assert.equal((await request('/part-request/app.js')).code,200);
  assert.equal((await request('/api/part-inquiries','POST',{...entry,consent:false})).code,400);
  assert.equal((await request('/api/part-inquiries','POST',{...entry,qty:0})).code,400);
  assert.equal((await request('/api/part-inquiries','POST',{...entry,method:'Delivery requested',address:''})).code,400);
  const made=(await expect(await request('/api/part-inquiries','POST',entry),201)).data;
  assert.match(made.ref,/^RLI-\d{6}-[0-9A-F]{16}$/);assert.equal(made.access.length,43);
  assert.equal((await expect(await request('/api/part-inquiries','POST',entry),200)).data.access,made.access);
  assert.equal((await request('/api/part-inquiries','POST',{...entry,name:'Changed name'})).code,409);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rl_part_inquiries').get().n,1);
  assert.equal(db.prepare('SELECT 1 FROM rl_reference_registry WHERE ref=?').get(made.ref)['1'],1);
  assert.equal((await request('/api/part-inquiries/access','POST',{ref:made.ref,access:'a'.repeat(43)})).code,404);
  const customer=(await expect(await request('/api/part-inquiries/access','POST',{ref:made.ref,access:made.access}),200)).data;
  assert.equal(customer.model,'iPhone 13');assert.equal(customer.phone,undefined);assert.equal(customer.address,undefined);
  assert.equal(customer.status,'received');
  assert.equal((await request('/api/part-inquiries/admin/overview')).code,401);
  const password='eight8888';
  await expect(await request('/api/admin/recover','POST',{token:issueRecovery(db),password}),200);
  const own=await expect(await request('/api/admin/login','POST',{username:'owner',password}),200);
  for(const [u,p] of [['tech','technician'],['manager','manager']])await expect(await request('/api/admin/team','POST',{action:'create',username:u,permission:p,password,current:password},own),200);
  const tech=await expect(await request('/api/admin/login','POST',{username:'tech',password}),200),manager=await expect(await request('/api/admin/login','POST',{username:'manager',password}),200);
  assert.equal((await request('/api/part-inquiries/admin/overview','GET',undefined,tech)).code,403);
  assert.equal((await request('/api/part-inquiries/admin/overview','GET',undefined,own)).data.unread,1);
  const adminDetail=(await expect(await request('/api/part-inquiries/admin/'+made.ref,'GET',undefined,manager),200)).data;
  assert.equal(adminDetail.address,entry.address);assert.equal(adminDetail.city,'Varanasi');assert.equal(adminDetail.region,'Uttar Pradesh');assert.equal(adminDetail.phone,entry.phone);assert.ok(adminDetail.created_at);
  assert.equal((await request('/api/part-inquiries/admin/overview','GET',undefined,own)).data.unread,0);
  const quote={status:'quoted',availability:'in_stock',price_rupees:1250,delivery_rupees:80,eta:'1–2 working days',quote_note:'Compatible OLED. Staff verified the part grade.',quote_valid_until:'2099-12-31'};
  assert.equal((await request('/api/part-inquiries/admin/'+made.ref,'PATCH',quote)).code,401);
  assert.equal((await request('/api/part-inquiries/admin/'+made.ref,'PATCH',{...quote,price_rupees:-1},manager)).code,400);
  assert.equal((await request('/api/part-inquiries/admin/'+made.ref,'PATCH',{...quote,availability:'checking'},manager)).code,400);
  assert.equal((await request('/api/part-inquiries/admin/'+made.ref,'PATCH',quote,tech)).code,403);
  const quoted=(await expect(await request('/api/part-inquiries/admin/'+made.ref,'PATCH',quote,manager),200)).data;
  assert.equal(quoted.price_paise,125000);assert.equal(quoted.delivery_paise,8000);
  const customerQuote=(await expect(await request('/api/part-inquiries/access','POST',{ref:made.ref,access:made.access}),200)).data;
  assert.equal(customerQuote.quote_note,quote.quote_note);assert.equal(customerQuote.price_paise,125000);
  assert.equal((await request('/api/part-inquiries/decision','POST',{ref:made.ref,access:'a'.repeat(43),decision:'accept'})).code,404);
  const accepted=(await expect(await request('/api/part-inquiries/decision','POST',{ref:made.ref,access:made.access,decision:'accept'}),200)).data;
  assert.equal(accepted.status,'accepted');
  assert.equal((await request('/api/part-inquiries/admin/'+made.ref,'PATCH',quote,manager)).code,409);
  assert.equal((await request('/api/part-inquiries/decision','POST',{ref:made.ref,access:made.access,decision:'decline'})).code,409);
  assert.equal((await request('/api/part-inquiries/decision','POST',{ref:made.ref,access:made.access,decision:'accept'})).code,200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rl_part_inquiry_events WHERE ref=?').get(made.ref).n,3);
  const second=(await expect(await request('/api/part-inquiries','POST',{...entry,request_key:'2'.repeat(64),category:'Battery',description:'Need battery replacement pack'}),201)).data;
  assert.notEqual(second.ref,made.ref);
  const unavailable=(await expect(await request('/api/part-inquiries/admin/'+second.ref,'PATCH',{status:'unavailable',availability:'unavailable',price_rupees:0,delivery_rupees:0,quote_note:'Not in stock'},own),200)).data;
  assert.equal(unavailable.status,'unavailable');
  assert.equal((await request('/api/part-inquiries/decision','POST',{ref:second.ref,access:second.access,decision:'accept'})).code,409);
  const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aCZsAAAAASUVORK5CYII=';
  const pictured=(await expect(await request('/api/part-inquiries','POST',{...entry,request_key:'3'.repeat(64),category:'Camera',description:'Camera lens for exact phone model',image:photo}),201)).data;
  assert.equal((await expect(await request('/api/part-inquiries/admin/'+pictured.ref,'GET',undefined,own),200)).data.image,photo);
  assert.equal((await request('/api/part-inquiries/access','POST',{ref:pictured.ref,access:pictured.access})).data.image,undefined);
  assert.equal((await request('/api/part-inquiries/admin/overview?q=Galaxy%20S9','GET',undefined,manager)).data.total,0);
  assert.equal((await request('/api/part-inquiries/admin/overview?q=iPhone','GET',undefined,manager)).data.total,3);
 }finally {await new Promise(r=>server.close(r));rmSync(temp,{recursive:true,force:true});}
});
