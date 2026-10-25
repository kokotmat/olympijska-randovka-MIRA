import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {DeliveryStore,deliverySignature,verifyDelivery,processQueue,receiveEvent,sourceAllowed} from '../lib/admin/delivery.js';
import {onRequest} from '../functions/api/delivery.js';
import {onRequest as adminRequest} from '../functions/api/admin/[[path]].js';
import {onRequest as webhookRequest} from '../functions/api/delivery-webhook.js';
function fixture(){
 const sqlite=new DatabaseSync(':memory:');for(const file of ['0002_delivery.sql','0003_delivery_cancellations.sql'])sqlite.exec(fs.readFileSync(new URL('../admin/migrations/'+file,import.meta.url),'utf8'));
 const db={prepare(sql){let args=[];return {bind(...v){args=v;return this;},async first(){return sqlite.prepare(sql).get(...args)||null;},async all(){return {results:sqlite.prepare(sql).all(...args)};},async run(){const r=sqlite.prepare(sql).run(...args);return {success:true,meta:{changes:r.changes}};}};},async batch(items){sqlite.exec('BEGIN IMMEDIATE');try{const r=[];for(const item of items)r.push(await item.run());sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
 const env={ADMIN_DB:db,RESERVATIONS_ADMIN_SECRET:'offline-reservations-key-'.repeat(2),SPONSORS_ADMIN_SECRET:'offline-sponsors-key-'.repeat(2),SMTP2GO_API_KEY:'offline-never-transmit',DELIVERY_SENDING_ENABLED:'live'};
 return {sqlite,db,env,store:new DeliveryStore(db)};
}
const message=(sourceId,more={})=>({sourceId,mode:'live',kind:'tickets',to:'person@example.test',subject:'Offline verification',text:'No real email',...more});
const policy={enabled:true,window:{days:[1,2,3,4,5,6,7],startMinute:0,endMinute:1440}};
const accept=(id='offline-provider-id')=>Response.json({data:{succeeded:1,failed:0,email_id:id}});
let count=0;async function test(name,fn){await fn();count++;console.log('PASS',name);}
await test('invalid webhook fields report bounded codes without recording data',async()=>{
 const f=fixture(),e={event:'processed',id:'sample-webhook',email_id:'sample-email',rcpt:'person@example.test',time:new Date().toISOString()};
 for(const [change,code] of [[{event:'unknown'},'INVALID_EVENT_TYPE'],[{id:''},'INVALID_EVENT_ID'],[{email_id:null},'INVALID_EVENT_EMAIL_ID'],[{rcpt:null},'INVALID_EVENT_RECIPIENT'],[{time:'invalid'},'INVALID_EVENT_TIME']])await assert.rejects(receiveEvent(f.store,{...e,...change}),x=>x.code===code);
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM delivery_events').get().n,0);f.sqlite.close();
});
await test('processed recipients lists correlate to the stored recipient without confirming delivery',async()=>{
 const f=fixture(),job=await f.store.enqueue('reservations',message('processed-list'));
 f.sqlite.prepare("UPDATE delivery_jobs SET state='accepted',provider_id='list-provider' WHERE id=?").run(job.id);
 const e={event:'processed',id:'processed-list-webhook',email_id:'list-provider',recipients:['other@example.test','PERSON@example.test'],time:new Date().toISOString()};
 assert.deepEqual(await receiveEvent(f.store,e),{recorded:true});let row=await f.store.get('reservations','processed-list');assert.equal(row.state,'processed');assert.equal(row.delivered_at,null);
 assert.deepEqual(await receiveEvent(f.store,{...e,rcpt:'person@example.test',recipients:undefined}),{duplicate:true});
 await assert.rejects(receiveEvent(f.store,{...e,id:'wrong',recipients:['other@example.test']}),x=>x.code==='EVENT_MISMATCH');
 await assert.rejects(receiveEvent(f.store,{...e,id:'wrong-provider',email_id:'other-provider','X-Randovka-Message-ID':job.id}),x=>x.code==='EVENT_MISMATCH');
 await assert.rejects(receiveEvent(f.store,{...e,event:'delivered'}),x=>x.code==='INVALID_EVENT_RECIPIENT');
 for(const recipients of [[],['not-email'],[{}],Array(51).fill('person@example.test')])await assert.rejects(receiveEvent(f.store,{...e,recipients}),x=>x.code==='INVALID_EVENT_RECIPIENT');
 assert.deepEqual(await receiveEvent(f.store,{...e,id:'string-list',recipients:'other@example.test, person@example.test'}),{recorded:true});
 assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM delivery_events').get().n,2);f.sqlite.close();
});
await test('signed source cannot be swapped and replayed nonce is rejected',async()=>{
 const f=fixture(),e={source:'reservations',op:'status',args:{sourceId:'x'},ts:Date.now(),nonce:crypto.randomUUID()};e.signature=await deliverySignature(e,f.env.RESERVATIONS_ADMIN_SECRET);await verifyDelivery(e,f.env);await assert.rejects(verifyDelivery({...e,source:'sponsors'},f.env),x=>x.code==='AUTH');await f.store.nonce(e,Date.now());await assert.rejects(f.store.nonce(e,Date.now()),x=>x.code==='REPLAY');f.sqlite.close();
});
await test('same source ID returns one receipt and changed content conflicts',async()=>{
 const f=fixture(),a=message('reservation:123:tickets');const one=await f.store.enqueue('reservations',a),two=await f.store.enqueue('reservations',a);assert.equal(one.id,two.id);await assert.rejects(f.store.enqueue('reservations',{...a,text:'Changed'}),x=>x.code==='MESSAGE_CONFLICT');assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM delivery_jobs').get().n,1);await assert.rejects(f.store.enqueue('sponsors',message('sponsor:1',{kind:'initial'})),x=>x.code==='RECIPIENT_PERMISSION_REQUIRED');f.sqlite.close();
});
await test('source synchronization is bounded and never exposes another source receipt',async()=>{
 const f=fixture();await f.store.enqueue('reservations',message('shared-id'));await f.store.enqueue('sponsors',message('sponsor-id',{kind:'initial',permission:'CONSENTED'}));
 f.sqlite.prepare('INSERT INTO delivery_suppressions VALUES(?,?,?)').run('blocked@example.test','spam',Date.now());
 const r=await f.store.sync('sponsors',{sourceIds:['shared-id','sponsor-id'],recipients:['BLOCKED@example.test','clear@example.test']});assert.equal(r.items.length,1);assert.equal(r.items[0].source,'sponsors');assert.equal(r.suppressed[0].recipient,'blocked@example.test');assert(!JSON.stringify(r).includes('No real email'));
 await assert.rejects(f.store.sync('sponsors',{sourceIds:Array(51).fill('x')}),x=>x.code==='INVALID_SYNC');await assert.rejects(f.store.sync('sponsors',{recipients:['invalid']}),x=>x.code==='INVALID_SYNC');f.sqlite.close();
});
await test('durable cancellation blocks delayed admission and never reverses acceptance',async()=>{
 const f=fixture();assert.equal((await f.store.cancel('sponsors',{sourceId:'late'})).state,'cancelled');await assert.rejects(f.store.enqueue('sponsors',message('late',{kind:'initial',permission:'CONSENTED'})),x=>x.code==='MESSAGE_CANCELLED');
 assert.equal((await f.store.sync('sponsors',{sourceIds:['late']})).items[0].state,'cancelled');
 const job=await f.store.enqueue('reservations',message('queued'));assert.equal((await f.store.cancel('reservations',{sourceId:'queued'})).state,'cancelled');assert.equal((await f.store.get('reservations','queued')).payload,'');
 const accepted=await f.store.enqueue('reservations',message('accepted'));f.sqlite.prepare("UPDATE delivery_jobs SET state='accepted',accepted_at=? WHERE id=?").run(Date.now(),accepted.id);assert.equal((await f.store.cancel('reservations',{sourceId:'accepted'})).state,'accepted');
 assert.equal((await f.store.enqueue('reservations',message('late'))).state,'queued');f.sqlite.close();
});
await test('cancellation winning after selection prevents a provider call and attempt',async()=>{
 const f=fixture();await f.store.control('reservations',{enabled:true});await f.store.enqueue('reservations',message('race-cancel'));
 const prepare=f.db.prepare.bind(f.db);let intercepted=false;
 f.db.prepare=sql=>{const q=prepare(sql);if(sql.includes("state='sending'")&&sql.includes('RETURNING id')){const first=q.first.bind(q);q.first=async()=>{if(!intercepted){intercepted=true;await f.store.cancel('reservations',{sourceId:'race-cancel'});}return first();};}return q;};
 await processQueue(f.env,async()=>{throw Error('cancelled job must not send');});assert(intercepted);assert.equal((await f.store.get('reservations','race-cancel')).state,'cancelled');assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM delivery_attempts').get().n,0);f.sqlite.close();
});
await test('reservations have priority, attachments preserved, acceptance is not delivery',async()=>{
 const f=fixture();await f.store.control('reservations',{enabled:true});await f.store.control('sponsors',policy);
 await f.store.enqueue('sponsors',message('s1',{kind:'initial',permission:'CONSENTED'}));await f.store.enqueue('reservations',message('r1',{kind:'confirmation',expiresAt:Date.now()+600000}));await f.store.enqueue('reservations',message('r2',{attachments:[{filename:'Ticket.pdf',fileblob:Buffer.from('%PDF-1.4 offline fixture').toString('base64')}]}));
 const sent=[];await processQueue(f.env,async(url,options)=>{assert.equal(url,'https://api.smtp2go.com/v3/email/send');const p=JSON.parse(options.body);sent.push(p);return accept('provider-'+sent.length);});
 const records=f.sqlite.prepare('SELECT * FROM delivery_jobs ORDER BY priority').all();assert.deepEqual(records.map(r=>r.source_id),['r2','r1','s1']);assert.equal(sent[0].attachments[0].mimetype,'application/pdf');assert.equal(sent[0].attachments[0].fileblob,Buffer.from('%PDF-1.4 offline fixture').toString('base64'));assert(records.every(r=>r.state==='accepted'&&r.delivered_at===null&&r.payload===''));assert.deepEqual(sent.map(p=>p.custom_headers.find(x=>x.header==='X-Randovka-Message-ID').value),records.map(r=>r.id));f.sqlite.close();
});
await test('inline image bytes and CID filename are preserved without external downloads',async()=>{
 const f=fixture();await f.store.control('sponsors',policy);await f.store.enqueue('sponsors',message('photo',{kind:'initial',permission:'CONSENTED',html:'<img src="cid:classPhoto.jpg">',inlines:[{filename:'classPhoto.jpg',fileblob:'/9j/2Q=='}]}));
 await processQueue(f.env,async(url,options)=>{const a=JSON.parse(options.body);assert.equal(url,'https://api.smtp2go.com/v3/email/send');assert.equal(a.inlines[0].filename,'classPhoto.jpg');assert.equal(a.inlines[0].fileblob,'/9j/2Q==');assert.equal(a.inlines[0].mimetype,'image/jpeg');assert.equal(a.html_body,'<img src="cid:classPhoto.jpg">');return accept();});
 for(const inline of [{filename:'bad.svg',fileblob:'AAAA'},{filename:'../photo.jpg',fileblob:'AAAA'},{filename:'photo.jpg',fileblob:'invalid'}])await assert.rejects(f.store.enqueue('reservations',message('bad',{inlines:[inline]})),e=>e.code==='INVALID_INLINES');f.sqlite.close();
});
await test('timeout after possible send is uncertain and never automatically sent again',async()=>{
 const f=fixture();await f.store.control('reservations',{enabled:true});await f.store.enqueue('reservations',message('timeout'));let calls=0;
 await processQueue(f.env,async()=>{calls++;throw Error('timeout after provider accepted');});await processQueue(f.env,async()=>{calls++;return accept();});assert.equal(calls,1);assert.equal((await f.store.get('reservations','timeout')).state,'uncertain');f.sqlite.close();
});
await test('concurrent ticks, disabled sending and source pause cannot duplicate sends',async()=>{
 const f=fixture();await f.store.enqueue('reservations',message('race'));await f.store.control('reservations',{enabled:true});let calls=0;
 await processQueue({...f.env,DELIVERY_SENDING_ENABLED:'false'},async()=>{throw Error('must not call');});await Promise.all([processQueue(f.env,async()=>{calls++;return accept();}),processQueue(f.env,async()=>{calls++;return accept();})]);assert.equal(calls,1);
 await f.store.enqueue('reservations',message('paused'));await f.store.control('reservations',{enabled:false});await processQueue(f.env,async()=>{throw Error('paused source');});assert.equal((await f.store.get('reservations','paused')).state,'queued');f.sqlite.close();
});
await test('expired confirmations and lost source heartbeat stop sending; Prague schedule respects DST',async()=>{
 const f=fixture(),now=Date.now();await f.store.control('reservations',{enabled:true});await f.store.enqueue('reservations',message('expired',{kind:'confirmation',expiresAt:now+1}),now);await processQueue(f.env,async()=>{throw Error('expired');},now+20);assert.equal((await f.store.get('reservations','expired')).state,'expired');
 const c={source:'sponsors',enabled:1,policy:JSON.stringify({window:{days:[1],startMinute:9*60,endMinute:17*60}})};
 for(const timestamp of ['2026-07-06T07:00:00Z','2026-12-07T08:00:00Z']){const n=Date.parse(timestamp);assert(sourceAllowed({...c,checked_at:n},n));assert(!sourceAllowed({...c,checked_at:n-600001},n));}const n=Date.parse('2026-12-07T16:00:00Z');assert(!sourceAllowed({...c,checked_at:n},n));f.sqlite.close();
});
await test('webhooks deduplicate and delayed processing never reverses delivered state',async()=>{
 const f=fixture();await f.store.control('reservations',{enabled:true});const job=await f.store.enqueue('reservations',message('event'));await processQueue(f.env,async()=>accept());
 const e={id:'webhook-1',event:'delivered',email_id:'offline-provider-id',rcpt:'person@example.test',time:new Date().toISOString(),'X-Randovka-Message-ID':job.id};assert.deepEqual(await receiveEvent(f.store,e),{recorded:true});assert.deepEqual(await receiveEvent(f.store,e),{duplicate:true});await receiveEvent(f.store,{...e,event:'processed',time:new Date(Date.now()+1).toISOString()});assert.equal((await f.store.get('reservations','event')).state,'delivered');assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM delivery_events').get().n,2);await assert.rejects(receiveEvent(f.store,{...e,id:'bad',rcpt:'other@example.test'}),x=>x.code==='EVENT_MISMATCH');f.sqlite.close();
});
await test('webhook arriving during provider request wins over later acceptance response',async()=>{
 const f=fixture();await f.store.control('reservations',{enabled:true});const job=await f.store.enqueue('reservations',message('early-event'));
 await processQueue(f.env,async()=>{await receiveEvent(f.store,{id:'early',event:'delivered',email_id:'early-id',rcpt:'person@example.test',time:new Date().toISOString(),'X-Randovka-Message-ID':job.id});return accept('early-id');});const row=await f.store.get('reservations','early-event');assert.equal(row.state,'delivered');assert(row.accepted_at>0);assert.equal(row.provider_id,'early-id');f.sqlite.close();
});
await test('test mode is isolated and can only dispatch to explicitly configured test recipient',async()=>{
 const f=fixture();await f.store.control('reservations',{enabled:true});await f.store.enqueue('reservations',message('live'));await f.store.enqueue('reservations',message('test',{mode:'test'}));let calls=0;
 await processQueue({...f.env,DELIVERY_SENDING_ENABLED:'test'},async()=>{throw Error('missing test recipient');});await processQueue({...f.env,DELIVERY_SENDING_ENABLED:'test',DELIVERY_TEST_RECIPIENT:'person@example.test'},async()=>{calls++;return accept();});assert.equal(calls,1);assert.equal((await f.store.get('reservations','live')).state,'queued');f.sqlite.close();
});
await test('signed HTTP enqueue stores one job and never invokes sending',async()=>{
 const f=fixture(),d={source:'reservations',op:'enqueue',args:message('http'),ts:Date.now(),nonce:crypto.randomUUID()};d.signature=await deliverySignature(d,f.env.RESERVATIONS_ADMIN_SECRET);
 const r=await onRequest({request:new Request('https://example.test/api/delivery',{method:'POST',body:JSON.stringify(d)}),env:f.env,waitUntil:()=>{throw Error('enqueue must not send');}});assert.equal(r.status,200);assert.equal((await r.json()).data.state,'queued');f.sqlite.close();
});
await test('unsubscribe blocks both future admission and already queued messages',async()=>{
 const f=fixture();await f.store.control('reservations',{enabled:true});const first=await f.store.enqueue('reservations',message('optout-first'));await processQueue(f.env,async()=>accept());await f.store.enqueue('reservations',message('optout-pending'));
 await receiveEvent(f.store,{id:'optout',event:'unsubscribe',email_id:'offline-provider-id',rcpt:'person@example.test',time:new Date().toISOString(),'X-Randovka-Message-ID':first.id});
 assert.deepEqual(await receiveEvent(f.store,{event:'resubscribe'}),{ignored:true,reason:'MANUAL_REVIEW_REQUIRED'});
 await assert.rejects(f.store.enqueue('reservations',message('optout-next')),e=>e.code==='RECIPIENT_SUPPRESSED');await processQueue(f.env,async()=>{throw Error('suppressed must not send');});assert.equal((await f.store.get('reservations','optout-pending')).state,'suppressed');f.sqlite.close();
});
await test('unsigned webhook is denied before any database operation',async()=>{
 const f=fixture(),r=await webhookRequest({request:new Request('https://example.test/api/delivery-webhook',{method:'POST',body:'{}'}),env:{...f.env,SMTP2GO_WEBHOOK_SECRET:'offline-webhook-secret-'.repeat(2)}});assert.equal(r.status,401);assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM delivery_events').get().n,0);f.sqlite.close();
});
await test('component roles see only their own deliveries and no message bodies',async()=>{
 const f=fixture();await f.store.enqueue('reservations',message('private-reservation'));await f.store.enqueue('sponsors',message('private-sponsor',{kind:'initial',permission:'CONSENTED',to:'sponsor@example.test'}));
 for(const role of ['sponsors','reservations']){const r=await adminRequest({request:new Request('https://example.test/api/admin/delivery/overview'),env:f.env,data:{identity:{email:'offline@example.test',role}}});const j=await r.json();assert.equal(r.status,200);assert.equal(j.data.items.length,1);assert.equal(j.data.items[0].source,role);assert(!JSON.stringify(j).includes('No real email'));}f.sqlite.close();
});
await test('delivery health distinguishes test receipts and isolates component metrics',async()=>{
 const f=fixture(),now=Date.now(),pending=await f.store.enqueue('reservations',message('health-pending'),now-120000);
 const sent=await f.store.enqueue('sponsors',message('health-sent',{mode:'test',kind:'initial',permission:'CONSENTED'}),now-60000);
 f.sqlite.prepare("UPDATE delivery_jobs SET state='accepted',provider_id='health-provider',accepted_at=? WHERE id=?").run(now-30000,sent.id);
 await receiveEvent(f.store,{id:'health-event',event:'delivered',email_id:'health-provider',rcpt:'person@example.test',time:new Date(now-10000).toISOString()},now-5000);
 async function health(role){const r=await adminRequest({request:new Request('https://example.test/api/admin/delivery/overview'),env:f.env,data:{identity:{email:'offline@example.test',role}}});assert.equal(r.status,200);return (await r.json()).data.health;}
 const reservations=await health('reservations');assert.equal(reservations.oldestQueuedAt,now-120000);assert(reservations.queueAgeMs>=120000);assert.equal(reservations.lastAccepted,null);assert.equal(reservations.lastWebhook,null);
 const sponsors=await health('sponsors');assert.equal(sponsors.queueAgeMs,null);assert.equal(sponsors.lastAccepted.accepted_at,now-30000);assert.equal(sponsors.lastAccepted.mode,'test');assert.equal(sponsors.lastWebhook.event,'delivered');assert.equal(sponsors.lastWebhook.received_at,now-5000);assert.equal(sponsors.lastWebhook.mode,'test');
 const admin=await health('admin');assert.equal(admin.oldestQueuedAt,reservations.oldestQueuedAt);assert.deepEqual(admin.lastWebhook,sponsors.lastWebhook);f.sqlite.close();
});
await test('a delayed old heartbeat cannot undo a newer pause',async()=>{const f=fixture(),n=Date.now();await f.store.control('reservations',{enabled:true},n-1000);await f.store.control('reservations',{enabled:false},n);await f.store.control('reservations',{enabled:true},n-500);await f.store.control('reservations',{enabled:true},n);const c=await f.db.prepare('SELECT * FROM delivery_controls WHERE source=?').bind('reservations').first();assert.equal(c.enabled,0);f.sqlite.close();});
console.log(JSON.stringify({tests:count,network:'none',emails:'none',database:'isolated in-memory SQLite'}));
