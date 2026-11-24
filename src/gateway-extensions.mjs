import {randomBytes} from 'node:crypto';
const fail=(status,message)=>{throw Object.assign(Error(message),{status})};
export function createGatewayExtensions({db,auth,ok,bodyJson,limit,access,env=process.env,http=fetch,worker=true}){
 db.exec(`CREATE TABLE IF NOT EXISTS ext_gateway_qr(payment_row INTEGER PRIMARY KEY REFERENCES rl_payments(id),qr_id TEXT UNIQUE,image_url TEXT,close_by INTEGER);
 CREATE TABLE IF NOT EXISTS ext_gateway_refund(payment_row INTEGER PRIMARY KEY REFERENCES rl_payments(id),original_row INTEGER NOT NULL REFERENCES rl_payments(id),provider_id TEXT UNIQUE,actor TEXT NOT NULL,note TEXT NOT NULL);
 CREATE TRIGGER IF NOT EXISTS ext_qr_order_paid_guard BEFORE UPDATE OF status ON orders WHEN NEW.status='completed' AND EXISTS(SELECT 1 FROM rl_payments WHERE ref=NEW.ref AND method='gateway_qr' AND state='captured') AND (SELECT COALESCE(SUM(amount),0) FROM rl_payments WHERE ref=NEW.ref AND state='captured')-(SELECT COALESCE(SUM(a.amount),0) FROM rl_payment_adjustments a JOIN rl_payments p ON p.id=a.payment_row WHERE p.ref=NEW.ref)<>NEW.subtotal*100 BEGIN SELECT RAISE(ABORT,'Outstanding gateway payment'); END;`);
 const refundCols=new Set(db.prepare('PRAGMA table_info(ext_gateway_refund)').all().map(c=>c.name));
 for(const [col,def] of Object.entries({attempted_at:'TEXT',provider_status:"TEXT NOT NULL DEFAULT ''",definite_failure:'INTEGER NOT NULL DEFAULT 0',last_error:"TEXT NOT NULL DEFAULT ''",updated_at:'TEXT'}))if(!refundCols.has(col))db.exec(`ALTER TABLE ext_gateway_refund ADD COLUMN ${col} ${def}`);
 const q=(s,...v)=>db.prepare(s).get(...v),all=(s,...v)=>db.prepare(s).all(...v),run=(s,...v)=>db.prepare(s).run(...v);
 const tx=f=>{db.exec('BEGIN IMMEDIATE');try{const x=f();db.exec('COMMIT');return x}catch(e){db.exec('ROLLBACK');throw e}};
 const enabled=()=>env.RL_GATEWAY_QR_ENABLED==='1'&&!!(env.RAZORPAY_KEY_ID&&env.RAZORPAY_KEY_SECRET);
 const rp=async(method,path,body,extra={})=>{if(!env.RAZORPAY_KEY_ID||!env.RAZORPAY_KEY_SECRET)fail(503,'Gateway not configured.');let r;try{r=await http('https://api.razorpay.com/v1/'+path,{method,headers:{Authorization:'Basic '+Buffer.from(env.RAZORPAY_KEY_ID+':'+env.RAZORPAY_KEY_SECRET).toString('base64'),'Content-Type':'application/json',...extra},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)})}catch{fail(502,'Gateway unavailable; do not retry with a different reference.')}if(!r.ok)throw Object.assign(Error('Gateway rejected or deferred request.'),{status:502,definite:[400,401,403,422].includes(r.status)});return r.json()};
 const paid=ref=>q("SELECT COALESCE(SUM(amount),0) n FROM rl_payments WHERE ref=? AND state='captured'",ref).n-q('SELECT COALESCE(SUM(a.amount),0) n FROM rl_payment_adjustments a JOIN rl_payments p ON p.id=a.payment_row WHERE p.ref=?',ref).n;
 const pending=ref=>q("SELECT * FROM rl_payments WHERE ref=? AND state IN ('creating','open','awaiting_verification','reconciliation_required')",ref);
 const due=ref=>{const j=q('SELECT * FROM rl_jobs WHERE ref=?',ref),o=q('SELECT * FROM orders WHERE ref=?',ref);if(j&&['approved','completed'].includes(j.stage))return (j.stage==='approved'?j.deposit:j.total)-paid(ref);if(o&&['confirmed','in_progress','ready'].includes(o.status))return o.subtotal*100-paid(ref);return 0};
 const log=(ref,actor,action)=>{run('INSERT INTO rl_audit(ref,actor,action) VALUES(?,?,?)',ref,actor,action);for(const channel of ['webhook','email','whatsapp'])run('INSERT INTO rl_outbox(ref,event,channel) VALUES(?,?,?)',ref,action,channel);if(q('SELECT whatsapp FROM bookings WHERE ref=?',ref)?.whatsapp)run('INSERT INTO rl_outbox(ref,event,channel) VALUES(?,?,?)',ref,action,'customer_whatsapp');if(q('SELECT email FROM bookings WHERE ref=?',ref)?.email)run('INSERT INTO rl_outbox(ref,event,channel) VALUES(?,?,?)',ref,action,'customer_email');};
 const safeImage=url=>{try{const u=new URL(url);return u.protocol==='https:'&&!u.username&&!u.password&&(u.hostname==='razorpay.com'||u.hostname.endsWith('.razorpay.com')||u.hostname.endsWith('.razorpay.co.in'))}catch{return false}};
 const inFlightRefunds=new Set();
 function qrView(row){const e=q('SELECT * FROM ext_gateway_qr WHERE payment_row=?',row.id);return {receipt:row.receipt,state:row.state,amount:row.amount,qr_id:e?.qr_id||null,image_url:e?.image_url||null,close_by:e?.close_by||null};}
 async function createQR(ref){if(!enabled())fail(503,'Dynamic gateway QR is disabled.');const existing=pending(ref);if(existing){if(existing.method!=='gateway_qr')fail(409,'Resolve the existing payment first.');return qrView(existing);}const {id,amount,receipt,reuse}=tx(()=>{const curPending=pending(ref);if(curPending){if(curPending.method!=='gateway_qr')fail(409,'Resolve the existing payment first.');return {reuse:curPending};}const amount=due(ref);if(!Number.isSafeInteger(amount)||amount<100)fail(409,'No eligible gateway payment due.');const receipt='gqr_'+randomBytes(12).toString('hex');const id=run("INSERT INTO rl_payments(ref,receipt,amount,state,method) VALUES(?,?,?,'creating','gateway_qr')",ref,receipt,amount).lastInsertRowid;run('INSERT INTO ext_gateway_qr(payment_row) VALUES(?)',id);if(q('SELECT 1 FROM orders WHERE ref=?',ref))run('UPDATE rl_parts_billing SET required=1 WHERE ref=?',ref);return {id,amount,receipt}});if(reuse)return qrView(reuse);try{const data=await rp('POST','payments/qr_codes',{type:'upi_qr',name:'RepairlyLabs',usage:'single_use',fixed_amount:true,payment_amount:amount,close_by:Math.floor(Date.now()/1000)+1800,description:'RepairlyLabs bill',notes:{reference:receipt}});if(!/^qr_[A-Za-z0-9]+$/.test(data.id||'')||data.payment_amount!==amount||data.fixed_amount!==true||data.usage!=='single_use'||!safeImage(data.image_url))fail(502,'Unexpected QR response; reconcile with provider.');tx(()=>{run('UPDATE ext_gateway_qr SET qr_id=?,image_url=?,close_by=? WHERE payment_row=?',data.id,data.image_url,data.close_by||null,id);run("UPDATE rl_payments SET state='open' WHERE id=?",id)});}catch(e){run('UPDATE rl_payments SET state=?,review_note=? WHERE id=?',e.definite?'failed':'reconciliation_required','Gateway QR creation requires review',id);throw e}return qrView(q('SELECT * FROM rl_payments WHERE id=?',id));}
 async function reconcileQR(row){const ext=q('SELECT * FROM ext_gateway_qr WHERE payment_row=?',row.id);if(!ext?.qr_id)return qrView(row);if(row.state==='captured')return qrView(row);const d=await rp('GET','payments/qr_codes/'+ext.qr_id+'/payments');if(!Array.isArray(d.items))fail(502,'Invalid provider response.');const items=d.items.filter(p=>p.status==='captured');if(items.length){if(items.length!==1||items[0].currency!=='INR'||items[0].amount!==row.amount||!/^pay_[A-Za-z0-9]+$/.test(items[0].id||''))fail(409,'Unexpected provider payment; staff reconciliation required.');const p=items[0];tx(()=>{const current=q('SELECT * FROM rl_payments WHERE id=?',row.id);if(current.state==='captured'){if(current.payment_id!==p.id)fail(409,'Conflicting capture.');return;}if(!['open','reconciliation_required'].includes(current.state))fail(409,'Payment state conflict.');run("UPDATE rl_payments SET state='captured',payment_id=?,verified_by='gateway',verified_at=CURRENT_TIMESTAMP WHERE id=?",p.id,row.id);log(row.ref,'gateway','payment.gateway_qr_captured')});}else if(d.items.length===0){const qr=await rp('GET','payments/qr_codes/'+ext.qr_id);if(qr.id===ext.qr_id&&qr.status==='closed'&&qr.payments_count_received===0&&qr.payments_amount_received===0&&qr.close_reason!=='paid'&&Number.isFinite(qr.closed_at)&&qr.closed_at*1000<Date.now()-300000){// Do not unlock an expired QR until provider reports closure and zero captures.
 run("UPDATE rl_payments SET state='failed',review_note='Provider closed QR without captured payments' WHERE id=? AND state='open'",row.id);}}
 return qrView(q('SELECT * FROM rl_payments WHERE id=?',row.id));}
 function validateRefundEntity(data,original,row,e){
  if(!data||typeof data!=='object'||!/^rfnd_[A-Za-z0-9]+$/.test(data.id||'')||data.payment_id!==original.payment_id||data.amount!==row.amount||(data.currency&&data.currency!=='INR')||(e.provider_id&&data.id!==e.provider_id)){
   fail(409,'Refund response mismatch.');
  }
 }
 function applyRefundState(data,original,rowId){
  return tx(()=>{
   const row=q('SELECT * FROM rl_payments WHERE id=?',rowId),e=q('SELECT * FROM ext_gateway_refund WHERE payment_row=?',rowId);
   if(!row||!e)fail(404,'Refund record not found.');
   validateRefundEntity(data,original,row,e);
   const status=String(data.status||'pending');
   if(row.state==='refund_complete'){
    return {state:'processed',receipt:row.receipt,provider_id:e.provider_id||data.id};
   }
   run('UPDATE ext_gateway_refund SET provider_id=?,provider_status=?,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE payment_row=?',data.id,status,'',rowId);
   if(status==='processed'){
    const prior=q('SELECT payment_row,amount FROM rl_payment_adjustments WHERE reference=?',data.id);
    if(prior&&(prior.payment_row!==original.id||prior.amount!==row.amount))fail(409,'Refund reference conflicts with existing ledger.');
    if(!prior){
     const refundedSoFar=q('SELECT COALESCE(SUM(amount),0) n FROM rl_payment_adjustments WHERE payment_row=?',original.id).n;
     if(refundedSoFar+row.amount>original.amount)fail(409,'Refund exceeds captured payment amount.');
     run('INSERT INTO rl_payment_adjustments(payment_row,amount,reference,actor,note) VALUES(?,?,?,?,?)',original.id,row.amount,data.id,e.actor,e.note);
    }
    run("UPDATE rl_payments SET state='refund_complete',updated_at=CURRENT_TIMESTAMP WHERE id=?",rowId);
    log(row.ref,e.actor,'payment.gateway_refund_processed');
    return {state:'processed',receipt:row.receipt,provider_id:data.id};
   }
   if(status==='failed'){
    run("UPDATE ext_gateway_refund SET definite_failure=1,provider_status='failed',updated_at=CURRENT_TIMESTAMP WHERE payment_row=?",rowId);
    run("UPDATE rl_payments SET state='failed',review_note='Provider confirmed refund failed',updated_at=CURRENT_TIMESTAMP WHERE id=?",rowId);
    return {state:'failed',receipt:row.receipt,provider_id:data.id};
   }
   run("UPDATE rl_payments SET state='reconciliation_required',updated_at=CURRENT_TIMESTAMP WHERE id=?",rowId);
   return {state:status,receipt:row.receipt,provider_id:data.id};
  });
 }
 async function findExistingRefundOnProvider(original,row){
  const list=await rp('GET','payments/'+original.payment_id+'/refunds');
  const items=Array.isArray(list?.items)?list.items:[];
  const byReceipt=items.filter(i=>i&&/^rfnd_[A-Za-z0-9]+$/.test(i.id||'')&&(i.receipt===row.receipt||i.notes?.receipt===row.receipt));
  if(byReceipt.length===1)return byReceipt[0];
  if(byReceipt.length>1)fail(409,'Multiple provider refunds matched this receipt; staff reconciliation required.');
  const byRefAndAmount=items.filter(i=>i&&/^rfnd_[A-Za-z0-9]+$/.test(i.id||'')&&i.notes?.reference===row.ref&&i.amount===row.amount&&!q('SELECT 1 FROM ext_gateway_refund WHERE provider_id=?',i.id));
  if(byRefAndAmount.length===1)return byRefAndAmount[0];
  return null;
 }
 async function executeRefund(rowInput){
  const rowId=rowInput.id;
  if(inFlightRefunds.has(rowId))fail(409,'Refund processing is already in progress for this attempt.');
  inFlightRefunds.add(rowId);
  try{
   const row=q('SELECT * FROM rl_payments WHERE id=?',rowId),e=q('SELECT * FROM ext_gateway_refund WHERE payment_row=?',rowId),original=e?q('SELECT * FROM rl_payments WHERE id=?',e.original_row):null;
   if(!row||!e||!original)fail(404,'Refund attempt not found.');
   if(row.state==='refund_complete')return {state:'processed',receipt:row.receipt,provider_id:e.provider_id};
   if(row.state==='failed')fail(409,'Provider confirmed refund failed.');
   let data;
   try{
    if(e.provider_id){
     data=await rp('GET','refunds/'+e.provider_id);
    }else if(e.attempted_at){
     // Crash/timeout recovery: inspect existing refunds for this payment instead of blindly re-POSTing.
     data=await findExistingRefundOnProvider(original,row);
     if(!data){
      if(e.definite_failure===1){
       tx(()=>{run("UPDATE rl_payments SET state='failed',review_note='Provider rejected earlier refund attempt and no refund record exists',updated_at=CURRENT_TIMESTAMP WHERE id=? AND state!='refund_complete'",rowId);});
       fail(409,'Earlier refund request was rejected by provider; start a new refund request if needed.');
      }
      fail(409,'Refund was already sent to provider and has not appeared on provider refund list yet. Wait for webhook or verify via Link Refund.');
     }
     tx(()=>{
      const nowE=q('SELECT provider_id FROM ext_gateway_refund WHERE payment_row=?',rowId);
      if(!nowE?.provider_id)run('UPDATE ext_gateway_refund SET provider_id=?,updated_at=CURRENT_TIMESTAMP WHERE payment_row=?',data.id,rowId);
     });
    }else{
     // Persist attempted_at before calling provider so local crashes never trigger duplicate POSTs.
     tx(()=>{
      const nowE=q('SELECT attempted_at,provider_id FROM ext_gateway_refund WHERE payment_row=?',rowId);
      if(nowE.attempted_at||nowE.provider_id)fail(409,'Refund attempt already initiated.');
      run('UPDATE ext_gateway_refund SET attempted_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE payment_row=?',rowId);
     });
     data=await rp('POST','payments/'+original.payment_id+'/refund',{amount:row.amount,receipt:row.receipt,notes:{reference:row.ref,receipt:row.receipt}},{'X-Refund-Idempotency':row.receipt});
     validateRefundEntity(data,original,row,q('SELECT * FROM ext_gateway_refund WHERE payment_row=?',rowId));
     // Persist provider_id immediately before applying ledger updates.
     tx(()=>{run('UPDATE ext_gateway_refund SET provider_id=?,provider_status=?,updated_at=CURRENT_TIMESTAMP WHERE payment_row=? AND provider_id IS NULL',data.id,String(data.status||'pending'),rowId);});
    }
    return applyRefundState(data,original,rowId);
   }catch(err){
    try{
     const errMsg=String(err?.message||'Refund deferred').slice(0,250);
     run('UPDATE ext_gateway_refund SET definite_failure=CASE WHEN ? THEN 1 ELSE definite_failure END,last_error=?,updated_at=CURRENT_TIMESTAMP WHERE payment_row=?',err?.definite?1:0,errMsg,rowId);
     run("UPDATE rl_payments SET state='reconciliation_required',review_note=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND state NOT IN ('refund_complete','failed')",errMsg,rowId);
    }catch{}
    throw err;
   }
  }finally{
   inFlightRefunds.delete(rowId);
  }
 }
 async function handleWebhook(event){
  const ev=String(event?.event||'');
  if(!['refund.created','refund.processed','refund.failed'].includes(ev))return false;
  const rfnd=event?.payload?.refund?.entity;
  if(!rfnd||!/^rfnd_[A-Za-z0-9]+$/.test(rfnd.id||'')||!/^pay_[A-Za-z0-9]+$/.test(rfnd.payment_id||''))fail(400,'Invalid refund webhook event.');
  let matchRow=q("SELECT p.*,e.original_row FROM rl_payments p JOIN ext_gateway_refund e ON e.payment_row=p.id WHERE e.provider_id=?",rfnd.id);
  if(!matchRow&&(rfnd.receipt||rfnd.notes?.receipt)){
   const rec=String(rfnd.receipt||rfnd.notes?.receipt);
   matchRow=q("SELECT p.*,e.original_row FROM rl_payments p JOIN ext_gateway_refund e ON e.payment_row=p.id WHERE p.method='gateway_refund' AND p.receipt=?",rec);
  }
  if(!matchRow&&rfnd.notes?.reference){
   const candidates=all("SELECT p.*,e.original_row FROM rl_payments p JOIN ext_gateway_refund e ON e.payment_row=p.id JOIN rl_payments orig ON orig.id=e.original_row WHERE p.method='gateway_refund' AND p.ref=? AND orig.payment_id=? AND p.amount=? AND p.state!='failed'",String(rfnd.notes.reference),rfnd.payment_id,rfnd.amount);
   if(candidates.length===1)matchRow=candidates[0];
  }
  if(!matchRow)return false;
  const original=q('SELECT * FROM rl_payments WHERE id=?',matchRow.original_row);
  if(!original)return false;
  const normalized={...rfnd,status:ev==='refund.processed'?'processed':ev==='refund.failed'?'failed':(rfnd.status||'pending')};
  if(matchRow.state==='refund_complete'){
   const ext=q('SELECT * FROM ext_gateway_refund WHERE payment_row=?',matchRow.id);
   validateRefundEntity(normalized,original,matchRow,ext);
   return true;
  }
  if(ev==='refund.created'&&matchRow.state==='failed')return true;
  applyRefundState(normalized,original,matchRow.id);
  return true;
 }
 async function handle(req,res,url){const match=url.pathname.match(/^\/api\/gateway-extension\/([A-Z0-9-]+)\/(qr|check|refund|refund-check|link-qr|link-refund)$/);if(!match)fail(404,'Unknown gateway route.');const [,ref,action]=match;limit(req,'gateway-extension',30,60000);if(req.method==='GET'&&action==='qr'){access(req,ref);const row=pending(ref);return ok(res,{enabled:enabled(),active:row?.method==='gateway_qr'?qrView(row):null});}if(req.method!=='POST')fail(405,'Method not allowed.');const b=await bodyJson(req);if(['qr','check'].includes(action)){access(req,ref);if(!req.headers.authorization){const staff=auth(req);if(staff.role!=='owner'&&staff.permission!=='accountant')fail(403,'Payment access required.');}if(action==='qr')return ok(res,await createQR(ref));const row=q("SELECT * FROM rl_payments WHERE ref=? AND receipt=? AND method='gateway_qr'",ref,b.receipt);if(!row)fail(404,'QR attempt not found.');return ok(res,await reconcileQR(row));}
 const s=auth(req);if(s.role!=='owner')fail(403,'Owner permission required for gateway refunds and reconciliation.');
 if(action==='link-qr'){const row=pending(ref);if(!row||row.method!=='gateway_qr'||!['creating','reconciliation_required'].includes(row.state)||!/^qr_[A-Za-z0-9]+$/.test(b.qr_id||''))fail(409,'No unresolved gateway QR.');const d=await rp('GET','payments/qr_codes/'+b.qr_id);if(d.id!==b.qr_id||d.notes?.reference!==row.receipt||d.payment_amount!==row.amount||d.fixed_amount!==true||d.usage!=='single_use'||!safeImage(d.image_url))fail(409,'QR does not match reserved payment.');tx(()=>{run('UPDATE ext_gateway_qr SET qr_id=?,image_url=?,close_by=? WHERE payment_row=?',d.id,d.image_url,d.close_by||null,row.id);run("UPDATE rl_payments SET state='open' WHERE id=?",row.id)});return ok(res,await reconcileQR(q('SELECT * FROM rl_payments WHERE id=?',row.id)));}
 if(action==='link-refund'){const refundId=String(b.refund_id||'').trim(),rec=String(b.receipt||'').trim();if(!/^rfnd_[A-Za-z0-9]+$/.test(refundId)||!rec)fail(400,'Valid refund receipt and provider refund ID (rfnd_...) required.');const row=q("SELECT * FROM rl_payments WHERE ref=? AND receipt=? AND method='gateway_refund'",ref,rec);if(!row)fail(404,'Refund attempt not found.');const e=q('SELECT * FROM ext_gateway_refund WHERE payment_row=?',row.id),original=e?q('SELECT * FROM rl_payments WHERE id=?',e.original_row):null;if(!e||!original)fail(404,'Refund attempt not found.');if(e.provider_id&&e.provider_id!==refundId)fail(409,'Another provider refund ID is already linked.');const d=await rp('GET','refunds/'+refundId);validateRefundEntity(d,original,row,e);if(d.receipt&&d.receipt!==row.receipt)fail(409,'Provider refund receipt does not match.');return ok(res,applyRefundState(d,original,row.id));}
 if(action==='refund-check'){const row=q("SELECT * FROM rl_payments WHERE ref=? AND receipt=? AND method='gateway_refund'",ref,b.receipt);if(!row)fail(404,'Refund attempt not found.');if(row.state==='failed')fail(409,'Provider confirmed refund failed.');return ok(res,await executeRefund(row));}
 if(b.confirmed!==true||typeof b.note!=='string'||!b.note.trim())fail(409,'Eligible gateway payment, owner confirmation and reason required before delivery.');const id=tx(()=>{const original=q("SELECT * FROM rl_payments WHERE ref=? AND receipt=? AND state='captured' AND method IN ('razorpay','gateway_qr')",ref,b.receipt);const j=q('SELECT stage FROM rl_jobs WHERE ref=?',ref),o=q('SELECT status FROM orders WHERE ref=?',ref);if(!original||!/^pay_[A-Za-z0-9]+$/.test(original.payment_id||'')||pending(ref)||j?.stage==='delivered'||o?.status==='completed')fail(409,'Eligible gateway payment, owner confirmation and reason required before delivery.');const max=original.amount-q('SELECT COALESCE(SUM(amount),0) n FROM rl_payment_adjustments WHERE payment_row=?',original.id).n;if(!Number.isSafeInteger(b.amount)||b.amount<1||b.amount>max)fail(400,'Invalid refund amount.');const receipt='grf_'+randomBytes(12).toString('hex');const id=run("INSERT INTO rl_payments(ref,receipt,amount,state,method) VALUES(?,?,?,'reconciliation_required','gateway_refund')",ref,receipt,b.amount).lastInsertRowid;run('INSERT INTO ext_gateway_refund(payment_row,original_row,actor,note) VALUES(?,?,?,?)',id,original.id,s.username,b.note.trim().slice(0,300));return id});return ok(res,await executeRefund(q('SELECT * FROM rl_payments WHERE id=?',id)));}
 let busy=false;async function tick(){if(busy||!env.RAZORPAY_KEY_ID||!env.RAZORPAY_KEY_SECRET)return;busy=true;try{for(const row of all("SELECT p.* FROM rl_payments p JOIN ext_gateway_qr e ON e.payment_row=p.id WHERE p.state='open' AND e.qr_id IS NOT NULL ORDER BY COALESCE(p.updated_at,p.created_at),p.id LIMIT 10")){run('UPDATE rl_payments SET updated_at=CURRENT_TIMESTAMP WHERE id=?',row.id);try{await reconcileQR(row)}catch{}}for(const row of all("SELECT p.* FROM rl_payments p JOIN ext_gateway_refund e ON e.payment_row=p.id WHERE p.state='reconciliation_required' AND (e.provider_id IS NOT NULL OR e.attempted_at IS NOT NULL) ORDER BY COALESCE(p.updated_at,p.created_at),p.id LIMIT 10")){run('UPDATE rl_payments SET updated_at=CURRENT_TIMESTAMP WHERE id=?',row.id);try{await executeRefund(row)}catch{}}}finally{busy=false}}
 const timer=worker?setInterval(()=>void tick().catch(()=>{}),60000):null;timer?.unref();return {handle,handleWebhook,close:()=>clearInterval(timer),tick};
}
