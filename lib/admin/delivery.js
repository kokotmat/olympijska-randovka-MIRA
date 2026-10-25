import {AdminError} from './access.js';
const enc=new TextEncoder(),hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
const email=v=>typeof v==='string'&&v.length<=254&&/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(v);
export const DELIVERY_SENDER='maturitni.ples@olympijskarandovka.cz';
export async function digest(v){return hex(await crypto.subtle.digest('SHA-256',enc.encode(v)));}
export async function deliverySignature(d,secret){
 const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return hex(await crypto.subtle.sign('HMAC',key,enc.encode(JSON.stringify(['randovka-delivery-v1',d.ts,d.nonce,d.source,d.op,d.args]))));
}
async function same(a,b){const x=await digest(String(a)),y=await digest(String(b));let n=0;for(let i=0;i<x.length;i++)n|=x.charCodeAt(i)^y.charCodeAt(i);return n===0;}
export async function verifyDelivery(d,env,now=Date.now()){
 if(!d||!['reservations','sponsors'].includes(d.source)||!Number.isSafeInteger(d.ts)||Math.abs(now-d.ts)>120000||!/^[a-f0-9-]{36}$/i.test(d.nonce||'')||!['enqueue','status','sync','cancel','tick'].includes(d.op)||!d.args||typeof d.args!=='object'||Array.isArray(d.args))throw new AdminError('AUTH',401);
 const secret=env[d.source==='reservations'?'RESERVATIONS_ADMIN_SECRET':'SPONSORS_ADMIN_SECRET'];
 if(!secret||secret.length<32)throw new AdminError('DELIVERY_NOT_CONFIGURED',503);
 if(!await same(d.signature,await deliverySignature(d,secret)))throw new AdminError('AUTH',401);
}
export function validateJob(source,a,now=Date.now()){
 if(!['test','live'].includes(a?.mode))throw new AdminError('INVALID_MODE');
 if(!a||typeof a.sourceId!=='string'||!/^[a-zA-Z0-9:_-]{1,160}$/.test(a.sourceId)||!email(a.to)||typeof a.subject!=='string'||!a.subject.trim()||a.subject.length>300||/[\r\n]/.test(a.subject)||typeof a.text!=='string'||a.text.length>100000||a.html!==undefined&&(typeof a.html!=='string'||a.html.length>250000))throw new AdminError('INVALID_MESSAGE');
 if(source==='sponsors'&&(!/^initial$|^followup:[1-3]$/.test(a.kind||'')||a.permission!=='CONSENTED'))throw new AdminError('RECIPIENT_PERMISSION_REQUIRED',403);
 if(source==='reservations'&&!['confirmation','tickets'].includes(a.kind))throw new AdminError('INVALID_MESSAGE');
 const attachments=a.attachments||[];if(!Array.isArray(attachments)||attachments.length>12)throw new AdminError('INVALID_ATTACHMENTS');let size=0;
 for(const x of attachments){if(!x||typeof x.filename!=='string'||!/^.{1,100}\.(pdf|png)$/i.test(x.filename)||/[\r\n/\\]/.test(x.filename)||typeof x.fileblob!=='string'||!x.fileblob.length||!/^[A-Za-z0-9+/]*={0,2}$/.test(x.fileblob)||x.fileblob.length%4)throw new AdminError('INVALID_ATTACHMENTS');size+=x.fileblob.length;}
 if(size>8*1024*1024)throw new AdminError('ATTACHMENTS_TOO_LARGE',413);
 const expiresAt=a.expiresAt??null;if(expiresAt!==null&&(!Number.isSafeInteger(expiresAt)||expiresAt<=now))throw new AdminError('MESSAGE_EXPIRED',409);
 if(source==='reservations'&&a.kind==='confirmation'&&expiresAt===null)throw new AdminError('EXPIRY_REQUIRED');
 return {sourceId:a.sourceId,mode:a.mode,to:a.to.toLowerCase(),subject:a.subject,text:a.text,html:a.html||'',kind:a.kind,attachments:attachments.map(x=>({filename:x.filename,fileblob:x.fileblob,mimetype:/\.pdf$/i.test(x.filename)?'application/pdf':'image/png'})),expiresAt,replyTo:DELIVERY_SENDER,priority:source==='reservations'?(a.kind==='tickets'?0:10):20};
}
export function validatePolicy(source,a){
 if(typeof a.enabled!=='boolean')throw new AdminError('INVALID_POLICY');
 if(source==='reservations')return {enabled:a.enabled,window:null};
 const w=a.window;if(!w||!Array.isArray(w.days)||!w.days.length||w.days.length>7||w.days.some(d=>!Number.isInteger(d)||d<1||d>7)||!Number.isInteger(w.startMinute)||!Number.isInteger(w.endMinute)||w.startMinute<0||w.endMinute>1440||w.startMinute>=w.endMinute)throw new AdminError('INVALID_POLICY');
 return {enabled:a.enabled,window:{days:[...new Set(w.days)],startMinute:w.startMinute,endMinute:w.endMinute}};
}
export function sourceAllowed(control,now){
 if(!control||!control.enabled||now-control.checked_at>600000||control.checked_at>now+60000)return false;
 if(control.source==='reservations')return true;
 let p;try{p=JSON.parse(control.policy);}catch{return false;}if(!p.window)return false;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(now)).map(x=>[x.type,x.value]));
 const day=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].indexOf(parts.weekday)+1,minute=Number(parts.hour)*60+Number(parts.minute);
 return p.window.days.includes(day)&&minute>=p.window.startMinute&&minute<p.window.endMinute;
}
const projection=r=>({id:r.id,sourceId:r.source_id,source:r.source,mode:r.mode,kind:r.kind,to:r.recipient,subject:r.subject,state:r.state,createdAt:r.created_at,acceptedAt:r.accepted_at,deliveredAt:r.delivered_at,providerId:r.provider_id,errorCode:r.error_code});
export class DeliveryStore{
 constructor(db){this.db=db;}
 async get(source,sourceId){return this.db.prepare('SELECT * FROM delivery_jobs WHERE source=? AND source_id=?').bind(source,sourceId).first();}
 async enqueue(source,args,now=Date.now()){
  const a=validateJob(source,args,now),id=await digest(source+'\n'+a.sourceId),fingerprint=await digest(JSON.stringify(a));
  const prior=await this.get(source,a.sourceId);if(prior){if(prior.fingerprint!==fingerprint)throw new AdminError('MESSAGE_CONFLICT',409);return projection(prior);}
  if(await this.db.prepare('SELECT recipient FROM delivery_suppressions WHERE recipient=?').bind(a.to).first())throw new AdminError('RECIPIENT_SUPPRESSED',409);
  await this.db.prepare('INSERT OR IGNORE INTO delivery_jobs(id,source,source_id,fingerprint,mode,kind,priority,recipient,subject,payload,state,created_at,expires_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM delivery_cancellations WHERE source=? AND source_id=?)').bind(id,source,a.sourceId,fingerprint,a.mode,a.kind,a.priority,a.to,a.subject,JSON.stringify(a),'queued',now,a.expiresAt,source,a.sourceId).run();
  const row=await this.get(source,a.sourceId);if(!row)throw new AdminError('MESSAGE_CANCELLED',409);if(row.fingerprint!==fingerprint)throw new AdminError('MESSAGE_CONFLICT',409);return projection(row);
 }
 async control(source,args,now=Date.now()){
  const p=validatePolicy(source,args);await this.db.prepare('INSERT INTO delivery_controls(source,enabled,policy,checked_at) VALUES(?,?,?,?) ON CONFLICT(source) DO UPDATE SET enabled=excluded.enabled,policy=excluded.policy,checked_at=excluded.checked_at WHERE excluded.checked_at>delivery_controls.checked_at OR (excluded.checked_at=delivery_controls.checked_at AND excluded.enabled=0)').bind(source,Number(p.enabled),JSON.stringify(p),now).run();
 }
 async status(source,args){if(typeof args.sourceId!=='string'||args.sourceId.length>160)throw new AdminError('INVALID_MESSAGE');const r=await this.get(source,args.sourceId);if(!r)throw new AdminError('NOT_FOUND',404);return projection(r);}
 async sync(source,args){
  const ids=args.sourceIds||[],recipients=args.recipients||[];
  if(!Array.isArray(ids)||ids.length>50||ids.some(v=>typeof v!=='string'||!/^[a-zA-Z0-9:_-]{1,160}$/.test(v))||!Array.isArray(recipients)||recipients.length>100||recipients.some(v=>!email(v)))throw new AdminError('INVALID_SYNC');
  const sourceIds=[...new Set(ids)],addresses=[...new Set(recipients.map(v=>v.toLowerCase()))];let items=[],suppressed=[];
  if(sourceIds.length){const marks=sourceIds.map(()=>'?').join(','),rows=await this.db.prepare('SELECT * FROM delivery_jobs WHERE source=? AND source_id IN ('+marks+')').bind(source,...sourceIds).all();items=rows.results.map(projection);
   const cancelled=await this.db.prepare('SELECT source_id FROM delivery_cancellations WHERE source=? AND source_id IN ('+marks+')').bind(source,...sourceIds).all();for(const row of cancelled.results)if(!items.some(x=>x.sourceId===row.source_id))items.push({source,sourceId:row.source_id,state:'cancelled'});
  }
  if(addresses.length)suppressed=(await this.db.prepare('SELECT recipient,reason,created_at FROM delivery_suppressions WHERE recipient IN ('+addresses.map(()=>'?').join(',')+')').bind(...addresses).all()).results;
  return {items,suppressed,checkedAt:Date.now()};
 }
 async cancel(source,args,now=Date.now()){
  if(typeof args.sourceId!=='string'||!/^[a-zA-Z0-9:_-]{1,160}$/.test(args.sourceId))throw new AdminError('INVALID_MESSAGE');
  await this.db.batch([this.db.prepare('INSERT OR IGNORE INTO delivery_cancellations(source,source_id,created_at) VALUES(?,?,?)').bind(source,args.sourceId,now),this.db.prepare("UPDATE delivery_jobs SET state='cancelled',payload='',error_code='SOURCE_CANCELLED' WHERE source=? AND source_id=? AND state='queued'").bind(source,args.sourceId)]);
  const row=await this.get(source,args.sourceId);return row?projection(row):{source,sourceId:args.sourceId,state:'cancelled'};
 }
 async nonce(d,now){await this.db.prepare('DELETE FROM delivery_nonces WHERE expires_at<?').bind(now).run();try{await this.db.prepare('INSERT INTO delivery_nonces(id,expires_at) VALUES(?,?)').bind(d.source+':'+d.nonce,now+180000).run();}catch{throw new AdminError('REPLAY',409);}}
 async overview(){const rows=await this.db.prepare('SELECT state,COUNT(*) AS count,MIN(created_at) AS oldest FROM delivery_jobs GROUP BY state').all();return {states:rows.results,checkedAt:Date.now()};}
}
export async function processQueue(env,fetcher=fetch,now=Date.now()){
 // Deployment does not enable sending; an explicit operational switch is required.
 if(!['test','live'].includes(env.DELIVERY_SENDING_ENABLED)||!env.SMTP2GO_API_KEY)return {state:'disabled',processed:0};
 const db=env.ADMIN_DB,owner=crypto.randomUUID();
 const lock=await db.prepare('UPDATE delivery_lock SET owner=?,until_at=? WHERE id=1 AND until_at<? RETURNING owner').bind(owner,now+90000,now).first();if(!lock)return {state:'busy',processed:0};
 let processed=0;
 try{
  // A crash after the durable send claim is ambiguous. Never send it a second time.
  await db.prepare("UPDATE delivery_jobs SET state='uncertain',error_code='WORKER_INTERRUPTED' WHERE state='sending' AND attempt_at<?").bind(now-90000).run();
  await db.prepare("UPDATE delivery_jobs SET state='expired',error_code='MESSAGE_EXPIRED',payload='' WHERE state='queued' AND expires_at IS NOT NULL AND expires_at<=?").bind(now).run();
  await db.prepare("UPDATE delivery_jobs SET payload='' WHERE state='uncertain' AND attempt_at<?").bind(now-7*86400000).run();
  const controls=(await db.prepare('SELECT * FROM delivery_controls').all()).results.filter(c=>sourceAllowed(c,now));
  if(!controls.length)return {state:'waiting_source',processed};
  const sources=controls.map(c=>c.source),rows=(await db.prepare("SELECT * FROM delivery_jobs WHERE state='queued' AND mode=? AND source IN ("+sources.map(()=>'?').join(',')+") ORDER BY priority,created_at LIMIT 3").bind(env.DELIVERY_SENDING_ENABLED,...sources).all()).results;
  for(const row of rows){
   const fresh=Date.now(),budget=Math.min(200,Math.max(0,Number(env.DELIVERY_DAILY_BUDGET||150))),day=Date.UTC(new Date(fresh).getUTCFullYear(),new Date(fresh).getUTCMonth(),new Date(fresh).getUTCDate());
   if(!Number.isFinite(budget))throw new AdminError('INVALID_DELIVERY_BUDGET',503);
   const count=await db.prepare('SELECT COUNT(*) AS n FROM delivery_attempts WHERE started_at>=?').bind(day).first();if(count.n>=budget)return {state:'local_budget',processed};
   const currentControl=await db.prepare('SELECT * FROM delivery_controls WHERE source=?').bind(row.source).first();if(!sourceAllowed(currentControl,fresh))continue;
   if(await db.prepare('SELECT recipient FROM delivery_suppressions WHERE recipient=?').bind(row.recipient).first()){await db.prepare("UPDATE delivery_jobs SET state='suppressed',payload='',error_code='RECIPIENT_SUPPRESSED' WHERE id=? AND state='queued'").bind(row.id).run();continue;}
   if(row.mode==='test'&&row.recipient!==String(env.DELIVERY_TEST_RECIPIENT||'').toLowerCase())continue;
   const renewed=await db.prepare('UPDATE delivery_lock SET until_at=? WHERE id=1 AND owner=? AND until_at>? RETURNING owner').bind(fresh+90000,owner,fresh).first();if(!renewed)return {state:'lease_lost',processed};
   if(row.expires_at&&row.expires_at<=fresh)continue;
   const attempt=crypto.randomUUID();
   // A source can cancel between selection and dispatch. Only the winning claim may send.
   const claimed=await db.prepare("UPDATE delivery_jobs SET state='sending',attempt_at=? WHERE id=? AND state='queued' RETURNING id").bind(fresh,row.id).first();if(!claimed)continue;
   await db.prepare("INSERT INTO delivery_attempts(id,job_id,started_at,state) VALUES(?,?,?,'sending')").bind(attempt,row.id,fresh).run();
   let state='uncertain',providerId=null,errorCode='PROVIDER_RESULT_UNKNOWN';
   try{
    const a=JSON.parse(row.payload),response=await fetcher('https://api.smtp2go.com/v3/email/send',{method:'POST',headers:{'Content-Type':'application/json','X-Smtp2go-Api-Key':env.SMTP2GO_API_KEY},body:JSON.stringify({sender:'Maturitní ples Randovka <'+DELIVERY_SENDER+'>',to:[a.to],subject:a.subject,text_body:a.text,...(a.html?{html_body:a.html}:{}),attachments:a.attachments,fastaccept:false,custom_headers:[{header:'Reply-To',value:a.replyTo},{header:'X-Randovka-Message-ID',value:row.id}]}),redirect:'manual',signal:AbortSignal.timeout(15000)});
    // Non-2xx responses may occur after acceptance. Do not infer safe retry.
    if(response.ok){const r=await response.json(),d=r.data;if(d&&Number(d.succeeded)===1&&Number(d.failed||0)===0&&typeof d.email_id==='string'&&d.email_id.length<200){state='accepted';providerId=d.email_id;errorCode=null;}else if(d&&Number(d.succeeded)===0&&Number(d.failed)===1){state='rejected';errorCode='PROVIDER_REJECTED';}}
   }catch{/* No provider response, request body or address is written to logs. */}
   const end=Date.now();
   await db.batch([db.prepare('UPDATE delivery_jobs SET state=?,provider_id=COALESCE(provider_id,?),accepted_at=CASE WHEN ?=\'accepted\' THEN ? ELSE accepted_at END,error_code=?,payload=CASE WHEN ? IN (\'accepted\',\'rejected\') THEN \'\' ELSE payload END WHERE id=? AND state=\'sending\'').bind(state,providerId,state,end,errorCode,state,row.id),db.prepare('UPDATE delivery_attempts SET state=?,finished_at=?,provider_id=?,error_code=? WHERE id=?').bind(state,end,providerId,errorCode,attempt)]);processed++;
   // A webhook may have advanced the state before the API response. Keep its state,
   // but still retain the API's positive acceptance timestamp and matching ID.
   if(state==='accepted')await db.prepare('UPDATE delivery_jobs SET accepted_at=COALESCE(accepted_at,?),provider_id=COALESCE(provider_id,?) WHERE id=? AND (provider_id IS NULL OR provider_id=?)').bind(end,providerId,row.id,providerId).run();
  }return {state:'processed',processed};
 }finally{await db.prepare('UPDATE delivery_lock SET until_at=0 WHERE id=1 AND owner=?').bind(owner).run();}
}
export async function receiveEvent(store,event,now=Date.now()){
 // SMTP2GO groups unsubscribe/resubscribe in one checkbox. Reconsent requires review.
 if(event?.event==='resubscribe')return {ignored:true,reason:'MANUAL_REVIEW_REQUIRED'};
 // Bounded field codes diagnose provider format changes without exposing payloads.
 if(!event||!['processed','delivered','bounce','reject','spam','unsubscribe'].includes(event.event))throw new AdminError('INVALID_EVENT_TYPE');
 if(typeof event.id!=='string'||!event.id||event.id.length>200)throw new AdminError('INVALID_EVENT_ID');
 if(typeof event.email_id!=='string'||!event.email_id||event.email_id.length>200)throw new AdminError('INVALID_EVENT_EMAIL_ID');
 // Processed events may describe all recipients instead of a per-recipient rcpt.
 // Only this non-final event can use the documented recipients field.
 let recipients=email(event.rcpt)?[event.rcpt]:null;
 if(!recipients&&event.event==='processed'){
  const list=Array.isArray(event.recipients)?event.recipients:typeof event.recipients==='string'?event.recipients.split(',').map(v=>v.trim()):null;
  if(list?.length&&list.length<=50&&list.every(email))recipients=list;
 }
 if(!recipients)throw new AdminError('INVALID_EVENT_RECIPIENT');
 recipients=[...new Set(recipients.map(v=>v.toLowerCase()))];
 const time=String(event.time||''),stamp=/^\d{10}$/.test(time)?Number(time)*1000:/^\d{13}$/.test(time)?Number(time):Date.parse(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(time)?time.replace(' ','T')+'Z':time);
 if(!Number.isFinite(stamp)||stamp<0||stamp>now+300000)throw new AdminError('INVALID_EVENT_TIME');
 const custom=event['X-Randovka-Message-ID']||event['x-randovka-message-id'];
 let row;if(typeof custom==='string'&&/^[a-f0-9]{64}$/.test(custom))row=await store.db.prepare('SELECT * FROM delivery_jobs WHERE id=?').bind(custom).first();
 if(!row)row=await store.db.prepare('SELECT * FROM delivery_jobs WHERE provider_id=?').bind(event.email_id).first();
 if(!row)return {ignored:true};
 if(!recipients.includes(row.recipient)||row.provider_id&&row.provider_id!==event.email_id||!['sending','uncertain','accepted','processed','delivered','bounced','rejected','suppressed'].includes(row.state))throw new AdminError('EVENT_MISMATCH',409);
 const eventKey=await digest(JSON.stringify([event.id,event.email_id,event.event,stamp,row.recipient]));
 if(await store.db.prepare('SELECT id FROM delivery_events WHERE id=?').bind(eventKey).first())return {duplicate:true};
 const state={processed:'processed',delivered:'delivered',bounce:'bounced',reject:'rejected',spam:'suppressed',unsubscribe:'suppressed'}[event.event];
 // Preserve final outcomes against delayed processing/acceptance notifications.
 const final=['delivered','bounced','rejected','suppressed'].includes(row.state),advance=(!final||!['accepted','processed'].includes(state))&&(!row.event_at||stamp>=row.event_at);
 const suppression=['spam','unsubscribe'].includes(event.event)||event.event==='bounce'&&event.bounce==='hard';
 await store.db.batch([store.db.prepare('INSERT OR IGNORE INTO delivery_events(id,job_id,event,provider_id,occurred_at,received_at) VALUES(?,?,?,?,?,?)').bind(eventKey,row.id,event.event,event.email_id,stamp,now),...(suppression?[store.db.prepare('INSERT OR IGNORE INTO delivery_suppressions(recipient,reason,created_at) VALUES(?,?,?)').bind(row.recipient,event.event,now)]:[]),...(advance?[store.db.prepare('UPDATE delivery_jobs SET state=?,provider_id=?,event_at=?,delivered_at=CASE WHEN ?=\'delivered\' THEN ? ELSE delivered_at END,payload=\'\',error_code=NULL WHERE id=? AND (event_at IS NULL OR event_at<=?) AND NOT(state IN (\'delivered\',\'bounced\',\'rejected\',\'suppressed\') AND ?=\'processed\')').bind(state,event.email_id,stamp,state,stamp,row.id,stamp,state)]:[])]);
 return {recorded:true};
}
export async function authenticateWebhook(request,env){if(!env.SMTP2GO_WEBHOOK_SECRET||env.SMTP2GO_WEBHOOK_SECRET.length<32)throw new AdminError('WEBHOOK_NOT_CONFIGURED',503);if(!await same(request.headers.get('Authorization'), 'Bearer '+env.SMTP2GO_WEBHOOK_SECRET))throw new AdminError('AUTH',401);}
