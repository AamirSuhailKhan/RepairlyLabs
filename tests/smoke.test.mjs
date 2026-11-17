import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const tmp=mkdtempSync(join(tmpdir(),'repairlylabs-test-'));
process.env.REPAIRLYLABS_TEST='1';process.env.DATA_DIR=tmp;
const {server}=await import('../src/server.mjs');
const {openDatabase,passwordHash}=await import('../src/data.mjs');
const db=openDatabase(tmp);db.prepare('INSERT INTO admins(username,password_hash) VALUES(?,?)').run('owner',passwordHash('YourVeryStrongTestPass2026!'));db.close();
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
async function call(route,method='GET',body=null,cookie='',csrf=''){
 const headers={};if(body){headers['content-type']='application/json';}if(cookie)headers.cookie=cookie;if(csrf)headers['x-csrf-token']=csrf;
 const r=await fetch(base+route,{method,headers,body:body?JSON.stringify(body):undefined});const d=await r.json();return {code:r.status,d,headers:r.headers};
}
test('complete customer + admin journey',async()=>{try{
 let r=await call('/api/health');assert.equal(r.code,200);assert.equal(r.d.ok,true);
 r=await call('/api/config');assert.equal(r.code,200);assert.ok(r.d.services.length>=8);assert.ok(r.d.brands.length>=15);
 r=await call('/api/models?brand=Apple');assert.ok(r.d.some(m=>m.model==='iPhone 13'));
 r=await call('/api/products');assert.ok(r.d.items.length>=15);const p=r.d.items[0],stock=p.stock;
 r=await call('/api/bookings','POST',{name:'Customer Test',phone:'9876543210',brand:'Apple',model:'iPhone 13',issue:'Battery replacement',method:'Discuss options',date:'',locality:'Sigra',notes:'Battery drain',consent:true});assert.equal(r.code,201);const bookingRef=r.d.ref;
 r=await call('/api/track?ref='+bookingRef+'&phone=9876543210');assert.equal(r.d.record.status,'pending');
 r=await call('/api/track?ref='+bookingRef+'&phone=9999999999');assert.equal(r.code,404);
 r=await call('/api/orders','POST',{name:'Parts Customer',phone:'9876543210',locality:'Lanka',mode:'Workshop collection',consent:true,items:[{id:p.id,quantity:2}]});assert.equal(r.code,201);assert.equal(r.d.subtotal,p.price*2);const orderRef=r.d.ref;
 r=await call('/api/contact','POST',{name:'Contact Customer',phone:'9876543210',message:'Need an old phone component.',consent:true});assert.equal(r.code,201);
 r=await call('/api/admin/login','POST',{username:'owner',password:'bad'});assert.equal(r.code,401);
 r=await call('/api/admin/login','POST',{username:'owner',password:'YourVeryStrongTestPass2026!'});assert.equal(r.code,200);const cookie=r.headers.get('set-cookie').split(';')[0],csrf=r.d.csrf;
 r=await call('/api/admin/overview','GET',null,cookie);assert.equal(r.d.pendingBookings,1);assert.equal(r.d.pendingOrders,1);assert.equal(r.d.unreadMessages,1);
 r=await call('/api/admin/settings','PATCH',{phone:'9988776655'},cookie);assert.equal(r.code,403); // missing CSRF
 r=await call('/api/admin/orders','GET',null,cookie);const order=r.d[0];
 r=await call('/api/admin/products','GET',null,cookie);const original=r.d.items.find(x=>x.id===p.id);
 const revised={...original,sample:false,active:true,featured:original.featured};
 r=await call('/api/admin/products/'+p.id,'PUT',revised,cookie,csrf);assert.equal(r.code,200);
 r=await call('/api/admin/orders/'+order.id,'PATCH',{status:'confirmed',admin_note:'Confirmed'},cookie,csrf);assert.equal(r.code,200);
 r=await call('/api/products/'+p.id);assert.equal(r.d.stock,stock-2);
 r=await call('/api/admin/orders/'+order.id,'PATCH',{status:'cancelled',admin_note:'Cancelled test'},cookie,csrf);assert.equal(r.code,200);
 r=await call('/api/products/'+p.id);assert.equal(r.d.stock,stock);
 r=await call('/api/admin/bookings','GET',null,cookie);const booking=r.d[0];
 r=await call('/api/admin/bookings/'+booking.id,'PATCH',{status:'confirmed',quote:1800,admin_note:'Spoken to customer'},cookie,csrf);assert.equal(r.code,200);
 r=await call('/api/track?ref='+bookingRef+'&phone=9876543210');assert.equal(r.d.record.status,'confirmed');assert.equal(r.d.record.quote,1800);
 r=await call('/api/admin/settings','PATCH',{phone:'9988776655',pickup_enabled:'0'},cookie,csrf);assert.equal(r.code,200);
 r=await call('/api/config');assert.equal(r.d.settings.phone,'9988776655');
 r=await call('/api/admin/models/bulk','POST',{models:[{brand:'Test Brand',model:'TestPhone 1'}]},cookie,csrf);assert.equal(r.d.added,1);
 r=await call('/api/admin/products','POST',{sku:'REAL-001',name:'Test Part',brand:'Test Brand',model:'TestPhone 1',category:'Battery',grade:'Compatible',price:1234,stock:4,active:true,featured:false,sample:false},cookie,csrf);assert.equal(r.code,200);
 r=await call('/api/products?q=TestPhone');assert.ok(r.d.items.some(p=>p.sku==='REAL-001'));
 r=await fetch(base+'/repairs');assert.equal(r.status,200);assert.ok((await r.text()).includes('app.js'));
 r=await fetch(base+'/styles.css');assert.equal(r.status,200);
 console.log('Passed: site, catalog, booking, tracking, order, inventory, admin, CSRF, settings, contact, static routes');
 }finally{await new Promise(resolve=>server.close(resolve));rmSync(tmp,{recursive:true,force:true,maxRetries:10,retryDelay:50});}
});
