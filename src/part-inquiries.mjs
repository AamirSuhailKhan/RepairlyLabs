import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

/** Customer part enquiries and staff-issued quotes. The quote is never a payment claim. */
export function createPartInquiries({db,auth,ok,bodyJson,limit,notify}) {
  db.exec(`CREATE TABLE IF NOT EXISTS rl_part_inquiries (
    id INTEGER PRIMARY KEY,
    ref TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT NOT NULL DEFAULT '', whatsapp INTEGER NOT NULL DEFAULT 0,
    brand TEXT NOT NULL, model TEXT NOT NULL, variant TEXT NOT NULL DEFAULT '', colour TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL, description TEXT NOT NULL, qty INTEGER NOT NULL DEFAULT 1 CHECK(qty BETWEEN 1 AND 20),
    grade TEXT NOT NULL DEFAULT 'Any compatible option',
    method TEXT NOT NULL, locality TEXT NOT NULL, address TEXT NOT NULL DEFAULT '', pincode TEXT NOT NULL DEFAULT '',
    urgency TEXT NOT NULL DEFAULT 'Flexible', notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'received' CHECK(status IN ('received','reviewing','quoted','unavailable','accepted','declined','closed')),
    availability TEXT NOT NULL DEFAULT 'checking' CHECK(availability IN ('checking','in_stock','sourcing','unavailable')),
    price_paise INTEGER CHECK(price_paise IS NULL OR price_paise>=0),
    delivery_paise INTEGER NOT NULL DEFAULT 0 CHECK(delivery_paise>=0),
    eta TEXT NOT NULL DEFAULT '', quote_note TEXT NOT NULL DEFAULT '', quote_valid_until TEXT NOT NULL DEFAULT '',
    token_hash TEXT NOT NULL, key_hash TEXT UNIQUE, fingerprint TEXT NOT NULL,
    read_at TEXT, replied_by TEXT, replied_at TEXT, customer_decision_at TEXT,
    consent_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_rl_part_inquiries_status ON rl_part_inquiries(status, created_at);
  CREATE INDEX IF NOT EXISTS idx_rl_part_inquiries_phone ON rl_part_inquiries(phone, created_at);
  CREATE TABLE IF NOT EXISTS rl_part_inquiry_events (
    id INTEGER PRIMARY KEY, ref TEXT NOT NULL REFERENCES rl_part_inquiries(ref), actor TEXT NOT NULL,
    action TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_rl_part_inquiry_events_ref ON rl_part_inquiry_events(ref,id);
  CREATE TABLE IF NOT EXISTS rl_part_inquiry_photos(ref TEXT PRIMARY KEY REFERENCES rl_part_inquiries(ref),image_data TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`);

  const prepare = (sql) => db.prepare(sql);
  const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
  const trim=(v, max=200)=>typeof v==='string'?v.trim().slice(0,max):'';
  const needed=(v,name,max=200)=>{const a=trim(v,max);if(!a)fail(400,`${name} is required.`);return a;};
  const phone=(v)=>{const n=String(v??'').replace(/[\s()+-]/g,'').replace(/^91(?=\d{10}$)/,'');if(!/^[6-9]\d{9}$/.test(n))fail(400,'Enter a valid Indian mobile number.');return n;};
  const hash=x=>createHash('sha256').update(x).digest('hex');
  const keyToken=(key,ref)=>createHash('sha256').update('repairlylabs:part-request:'+key+':'+ref).digest('base64url');
  const safeRef=r=>{const x=trim(r,64).toUpperCase();if(!/^RLI-\d{6}-[0-9A-F]{16}$/.test(x))fail(400,'Invalid request reference.');return x;};
  const query=(s,...p)=>prepare(s).get(...p);
  const all=(s,...p)=>prepare(s).all(...p);
  const run=(s,...p)=>prepare(s).run(...p);
  const tx=fn=>{db.exec('BEGIN IMMEDIATE');try {const r=fn();db.exec('COMMIT');return r;} catch(e){db.exec('ROLLBACK');throw e;}};
  const log=(ref,actor,action,note='')=>run('INSERT INTO rl_part_inquiry_events(ref,actor,action,note) VALUES(?,?,?,?)',ref,actor,action,trim(note,400));
  const view=r=>({ref:r.ref,brand:r.brand,model:r.model,variant:r.variant,colour:r.colour,category:r.category,description:r.description,qty:r.qty,grade:r.grade,method:r.method,status:r.status,availability:r.availability,price_paise:r.price_paise,delivery_paise:r.delivery_paise,eta:r.eta,quote_note:r.quote_note,quote_valid_until:r.quote_valid_until,replied_at:r.replied_at,created_at:r.created_at,updated_at:r.updated_at,customer_decision_at:r.customer_decision_at});
  const requireAccess=(b)=>{const ref=safeRef(b.ref),token=trim(b.access,200),r=query('SELECT * FROM rl_part_inquiries WHERE ref=?',ref);if(!r|| !/^[A-Za-z0-9_-]{43}$/.test(token))fail(404,'Request not found or access code invalid.');const expected=Buffer.from(r.token_hash,'hex'),actual=Buffer.from(hash(token),'hex');if(!timingSafeEqual(expected,actual))fail(404,'Request not found or access code invalid.');return r;};
  const staff=req=>{const a=auth(req);if(!['owner','manager'].includes(a.permission))fail(403,'Owner or manager access required.');return a;};
  const eventNotify=(event,data)=>{try {Promise.resolve(notify?.(event,data)).catch(e=>console.error('[part-request notify]',e.message));}catch(e){console.error('[part-request notify]',e.message);}};
  function makeRef(){for(let i=0;i<40;i++){
    const d=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Kolkata',day:'2-digit',month:'2-digit',year:'2-digit'}).formatToParts(new Date());const part=t=>d.find(z=>z.type===t)?.value||'';
    const ref=`RLI-${part('year')}${part('month')}${part('day')}-${randomBytes(8).toString('hex').toUpperCase()}`;
    if(!query('SELECT 1 FROM rl_part_inquiries WHERE ref=?',ref) && !query('SELECT 1 FROM rl_reference_registry WHERE ref=?',ref))return ref;
  }fail(503,'Cannot allocate reference now. Please retry.');}
  async function handle(req,res,url){
    const path=url.pathname.replace('/api/part-inquiries',''),method=req.method;
    if(path==='' && method==='POST'){
      limit(req,'part-inquiry-create',8,60*60*1000);
      const b=await bodyJson(req);if(b.website)return ok(res,{received:true});
      if(b.consent!==true&&b.consent!=='on')fail(400,'Please agree to the privacy notice.');
      const name=needed(b.name,'Name',100),mobile=phone(b.phone),email=trim(b.email,180);
      if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))fail(400,'Invalid email address.');
      const brand=needed(b.brand,'Brand',80),model=needed(b.model,'Model',120),category=needed(b.category,'Required part',80),description=needed(b.description,'Part details',650);
      const variant=trim(b.variant,120),colour=trim(b.colour,70),notes=trim(b.notes,800);
      const qty=Number(b.qty??1);if(!Number.isSafeInteger(qty)||qty<1||qty>20)fail(400,'Quantity must be 1–20.');
      const grade=trim(b.grade,70)||'Any compatible option';if(!['Any compatible option','Original / OEM preference','High-quality compatible','Budget compatible','Not sure'].includes(grade))fail(400,'Invalid part quality preference.');
      const method=trim(b.method,45);if(!['Workshop collection','Delivery requested','Discuss options'].includes(method))fail(400,'Invalid delivery preference.');
      const locality=needed(b.locality,'Area / locality',100),address=trim(b.address,350),pincode=trim(b.pincode,6);
      if(method==='Delivery requested'&&!address)fail(400,'Full address is needed for delivery requests.');
      if(pincode&&!/^[1-9]\d{5}$/.test(pincode))fail(400,'Enter a valid 6-digit PIN code.');
      const urgency=trim(b.urgency,25)||'Flexible';if(!['Flexible','Within 24 hours','This week','As soon as possible'].includes(urgency))fail(400,'Invalid urgency.');
      const whatsapp=(b.whatsapp===true||b.whatsapp==='on')?1:0;
      let image=null;
      if(b.image!==undefined && b.image!==null && b.image!==''){
        if(typeof b.image!=='string' || b.image.length>500000 || !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(b.image))fail(400,'Attach only PNG or JPEG under 350 KB.');
        const bytes=Buffer.from(b.image.split(',')[1],'base64');
        if(bytes.length<24||bytes.length>350000||(b.image.startsWith('data:image/png')?bytes.subarray(0,8).toString('hex')!=='89504e470d0a1a0a':bytes.subarray(0,3).toString('hex')!=='ffd8ff'))fail(400,'Invalid image.');
        image=b.image;
      }
      if(typeof b.request_key!=='string'||!/^[0-9a-f]{64}$/.test(b.request_key))fail(400,'Refresh the page and retry your request.');
      const key_hash=hash(b.request_key),fingerprint=hash(JSON.stringify([name,mobile,email,brand,model,variant,colour,category,description,qty,grade,method,locality,address,pincode,urgency,notes,whatsapp,image?hash(image):'']));
      let result;
      tx(()=>{
        const prior=query('SELECT * FROM rl_part_inquiries WHERE key_hash=?',key_hash);
        if(prior){if(prior.fingerprint!==fingerprint)fail(409,'Submission identifier was already used for different details. Refresh the form.');result={ref:prior.ref,access:keyToken(b.request_key,prior.ref),status:prior.status,replayed:true};return;}
        if(query("SELECT 1 FROM rl_part_inquiries WHERE fingerprint=? AND created_at>=datetime('now','-2 minutes')",fingerprint))fail(409,'An identical parts enquiry was recently received. Use your previous reference or contact the team.');
        const ref=makeRef(),access=keyToken(b.request_key,ref);
        run(`INSERT INTO rl_part_inquiries(ref,name,phone,email,whatsapp,brand,model,variant,colour,category,description,qty,grade,method,locality,address,pincode,urgency,notes,token_hash,key_hash,fingerprint,consent_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,ref,name,mobile,email,whatsapp,brand,model,variant,colour,category,description,qty,grade,method,locality,address,pincode,urgency,notes,hash(access),key_hash,fingerprint,new Date().toISOString());
        if(image)run('INSERT INTO rl_part_inquiry_photos(ref,image_data) VALUES(?,?)',ref,image);
        run('INSERT INTO rl_reference_registry(ref) VALUES(?)',ref);log(ref,'customer','submitted',`${brand} ${model}: ${category}`);
        result={ref,access,status:'received',replayed:false};
      });
      if(!result.replayed)eventNotify('parts.inquiry_requested',{ref:result.ref,name,phone:mobile,email,brand,model,category,description,qty,locality,address,pincode,urgency,created_at:new Date().toISOString()});
      return ok(res,{...result,message:'Your parts enquiry is saved. We will check actual stock and respond with pricing and availability. A reply time is not guaranteed.'},result.replayed?200:201);
    }
    if(path==='/access' && method==='POST'){
      limit(req,'part-inquiry-access',40,60*60*1000);
      const r=requireAccess(await bodyJson(req));
      return ok(res,{...view(r),events:all("SELECT action,created_at FROM rl_part_inquiry_events WHERE ref=? AND action IN ('quoted','unavailable','accepted','declined','reviewing') ORDER BY id DESC LIMIT 20",r.ref)});
    }
    if(path==='/decision' && method==='POST'){
      limit(req,'part-inquiry-decision',30,60*60*1000);const b=await bodyJson(req);const decision=trim(b.decision,10);
      if(!['accept','decline'].includes(decision))fail(400,'Choose accept or decline.');
      let changed;
      tx(()=>{
        const r=requireAccess(b);
        if(r.status==='accepted'&&decision==='accept'){changed=view(r);return;}
        if(r.status==='declined'&&decision==='decline'){changed=view(r);return;}
        if(r.status!=='quoted')fail(409,'This quote is not awaiting a decision.');
        if(r.quote_valid_until&&new Date(r.quote_valid_until+'T23:59:59+05:30').getTime()<Date.now())fail(409,'This quote has expired. Please request an updated quote.');
        const status=decision==='accept'?'accepted':'declined';
        run('UPDATE rl_part_inquiries SET status=?,customer_decision_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE ref=?',status,r.ref);
        log(r.ref,'customer',status);changed=view(query('SELECT * FROM rl_part_inquiries WHERE ref=?',r.ref));
      });
      eventNotify('parts.inquiry_'+changed.status,{ref:changed.ref,model:changed.model,status:changed.status});
      return ok(res,changed);
    }
    if(path==='/admin/overview' && method==='GET'){
      staff(req);const s=trim(url.searchParams.get('status'),30),search=trim(url.searchParams.get('q'),110),page=Number(url.searchParams.get('page')||1);
      if(!Number.isSafeInteger(page)||page<1||page>10000)fail(400,'Invalid page.');
      if(s&&!['received','reviewing','quoted','unavailable','accepted','declined','closed'].includes(s))fail(400,'Invalid status.');
      let where='WHERE 1=1',args=[];
      if(s){where+=' AND status=?';args.push(s);}
      if(search){where+=' AND (ref LIKE ? OR name LIKE ? OR phone LIKE ? OR brand LIKE ? OR model LIKE ? OR category LIKE ? OR locality LIKE ?)';const a='%'+search+'%';args.push(...Array(7).fill(a));}
      const total=query('SELECT COUNT(*) n FROM rl_part_inquiries '+where,...args).n;
      const rows=all(`SELECT id,ref,name,phone,brand,model,category,qty,method,locality,status,availability,read_at,price_paise,delivery_paise,created_at,replied_at,updated_at FROM rl_part_inquiries ${where} ORDER BY CASE WHEN status='received' THEN 0 WHEN status='reviewing' THEN 1 ELSE 2 END, CASE WHEN status IN ('received','reviewing') THEN created_at END ASC, created_at DESC LIMIT 50 OFFSET ?`,...args,(page-1)*50);
      const summary=all('SELECT status,COUNT(*) n FROM rl_part_inquiries GROUP BY status');const unread=query("SELECT COUNT(*) n FROM rl_part_inquiries WHERE read_at IS NULL").n;const overdue=query("SELECT COUNT(*) n FROM rl_part_inquiries WHERE status IN ('received','reviewing') AND created_at<datetime('now','-10 minutes')").n;
      return ok(res,{items:rows,total,page,page_size:50,summary:Object.fromEntries(summary.map(r=>[r.status,r.n])),unread,overdue,server_time:new Date().toISOString()});
    }
    const match=path.match(/^\/admin\/([A-Z0-9-]+)$/);
    if(match){const actor=staff(req),ref=safeRef(match[1]);
      if(method==='GET'){
        const result=tx(()=>{const r=query('SELECT * FROM rl_part_inquiries WHERE ref=?',ref);if(!r)fail(404,'Parts request not found.');
          if(!r.read_at)run('UPDATE rl_part_inquiries SET read_at=CURRENT_TIMESTAMP WHERE ref=?',ref);
          return {...query('SELECT * FROM rl_part_inquiries WHERE ref=?',ref),events:all('SELECT actor,action,note,created_at FROM rl_part_inquiry_events WHERE ref=? ORDER BY id DESC',ref)};});
        result.image= query('SELECT image_data FROM rl_part_inquiry_photos WHERE ref=?',ref)?.image_data||null;delete result.token_hash;delete result.key_hash;delete result.fingerprint;return ok(res,result);
      }
      if(method==='PATCH'){
        const b=await bodyJson(req);auth(req);
        const status=trim(b.status,30),availability=trim(b.availability,30);
        if(!['reviewing','quoted','unavailable','closed'].includes(status))fail(400,'Invalid staff status.');
        if(!['checking','in_stock','sourcing','unavailable'].includes(availability))fail(400,'Invalid availability.');
        const validUntil=trim(b.quote_valid_until,10),eta=trim(b.eta,90),note=trim(b.quote_note,1000);
        if(validUntil&&(!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)||!Number.isFinite(Date.parse(validUntil))||new Date(validUntil+'T00:00:00Z').toISOString().slice(0,10)!==validUntil))fail(400,'Invalid quote expiry date.');
        if(validUntil&&new Date(validUntil+'T23:59:59+05:30').getTime()<Date.now())fail(400,'Quote expiry must be in the future.');
        const price=Number(b.price_rupees),delivery=Number(b.delivery_rupees??0);
        if(status==='quoted'){
          if(!['in_stock','sourcing'].includes(availability))fail(400,'Specify whether the part is in stock or being sourced.');
          if(!Number.isSafeInteger(price)||price<=0||price>10000000)fail(400,'Enter a positive unit price in rupees.');
        }
        if(!Number.isSafeInteger(delivery)||delivery<0||delivery>100000)fail(400,'Invalid delivery charges.');
        let changed;
        tx(()=>{
          const existing=query('SELECT * FROM rl_part_inquiries WHERE ref=?',ref);if(!existing)fail(404,'Request not found.');
          if(['accepted','closed'].includes(existing.status))fail(409,'Accepted or closed requests cannot be edited.');
          const nextStatus=status;
          if(status==='quoted'&&existing.method==='Workshop collection'&&delivery>0)fail(400,'Delivery charges are not applicable for workshop collection.');
          if(status==='unavailable'&&availability!=='unavailable')fail(400,'Set availability to unavailable.');
          run(`UPDATE rl_part_inquiries SET status=?,availability=?,price_paise=?,delivery_paise=?,eta=?,quote_note=?,quote_valid_until=?,replied_by=?,replied_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP,read_at=COALESCE(read_at,CURRENT_TIMESTAMP) WHERE ref=?`,nextStatus,availability,status==='quoted'?price*100:null,status==='quoted'?delivery*100:0,eta,note,status==='quoted'?validUntil:'',actor.username,ref);
          log(ref,actor.username,nextStatus,note);changed=view(query('SELECT * FROM rl_part_inquiries WHERE ref=?',ref));
        });
        eventNotify('parts.inquiry_'+status,{ref,status,availability,price_paise:changed.price_paise,delivery_paise:changed.delivery_paise,eta,model:changed.model});
        return ok(res,changed);
      }
    }
    fail(404,'Parts enquiry route not found.');
  }
  return {handle};
}
