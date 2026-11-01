import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {centralDeliveryActivity,operationalCheck} from '../lib/admin/ops.js';
import {onRequest as adminRequest} from '../functions/api/admin/[[path]].js';
function fixture(){
 const sql=new DatabaseSync(':memory:');
 for(const name of ['0001_commands.sql','0002_delivery.sql','0003_delivery_cancellations.sql','0004_web_operations.sql','0005_operations.sql'])sql.exec(fs.readFileSync(new URL('../admin/migrations/'+name,import.meta.url),'utf8'));
 const db={prepare(q){let a=[];return{bind(...v){a=v;return this;},async first(){return sql.prepare(q).get(...a)||null;},async all(){return{results:sql.prepare(q).all(...a)};},async run(){return{meta:sql.prepare(q).run(...a)};}};}};
 const env={ADMIN_DB:db,SMTP2GO_API_KEY:'offline-unused-key',DELIVERY_SENDING_ENABLED:'live'};
 for(const name of ['SPONSORS','RESERVATIONS','ASSISTANT']){
  env[name+'_ADMIN_SECRET']='offline-secret'.repeat(4);
  env[name+'_ADMIN_URL']=name==='ASSISTANT'?'https://ai.olympijskarandovka.cz/bridge':'https://script.google.com/macros/s/offline-'+name.toLowerCase()+'/exec';
 }
 function job(state){sql.prepare('INSERT INTO delivery_jobs(id,source,source_id,fingerprint,mode,kind,priority,recipient,subject,payload,state,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run('fixture-'+state,'sponsors','fixture-'+state,'offline','live','initial',1,'fixture@example.test','Offline','{}',state,Date.now());}
 function control(enabled){sql.prepare('INSERT INTO delivery_controls VALUES(?,?,?,?)').run('sponsors',enabled,'{}',Date.now());}
 let providerCalls=0;
 const provider=async()=>{providerCalls++;return Response.json({error:'offline suspended provider'},{status:403});};
 const health=async(url)=>{
  if(String(url).includes('/stats/email_cycle'))return provider();
  const now=Date.now(),u=String(url);
  const data=u.includes('offline-sponsors')?{provider:'GMAIL_WORKSPACE',state:'WAIT_WINDOW',remainingRecipients:97,lastHeartbeat:new Date(now).toISOString()}:u.includes('offline-reservations')?{maintenanceAgeSeconds:10,maintenanceError:null,remainingRecipients:97}:{ready:true};
  return Response.json({status:'success',data});
 };
 return{sql,env,job,control,provider,health,calls:()=>providerCalls};
}
let count=0;
async function test(name,fn){await fn();console.log('PASS',name);count++;}
async function check(f){const previous=globalThis.fetch;globalThis.fetch=f.health;try{return await operationalCheck(f.env,f.provider);}finally{globalThis.fetch=previous;}}
await test('Google migration ignores retained SMTP credentials and historical external deliveries',async()=>{
 const f=fixture();f.control(0);for(const s of ['delivered','bounced','cancelled'])f.job(s);
 const r=await check(f);assert.deepEqual(r.issues,[]);assert.equal(r.provider.quotaRequired,false);assert.equal(r.quota,null);assert.equal(f.calls(),0);f.sql.close();
});
await test('enabled external source still reports unavailable quota even with an empty queue',async()=>{
 const f=fixture();f.control(1);const r=await check(f);assert(r.issues.includes('PROVIDER_QUOTA_UNAVAILABLE'));assert.equal(f.calls(),1);f.sql.close();
});
for(const state of ['queued','sending','uncertain'])await test('paused external '+state+' work keeps quota monitoring',async()=>{
 const f=fixture();f.control(0);f.job(state);const r=await check(f);assert(r.provider.quotaRequired);assert(r.issues.includes('PROVIDER_QUOTA_UNAVAILABLE'));assert.equal(r.issues.includes('DELIVERY_UNCERTAIN'),state==='uncertain');assert.equal(f.calls(),1);f.sql.close();
});
await test('disabled global transport does not poll provider just because a source setting remains enabled',async()=>{
 const f=fixture();f.control(1);f.sql.prepare('INSERT INTO delivery_settings VALUES(1,?,?,?,?,?,?)').run('disabled',150,1,Date.now(),'offline',0);
 assert.equal((await centralDeliveryActivity(f.env)).quotaRequired,false);f.sql.close();
});
await test('genuine source failures stay visible when SMTP monitoring is inactive',async()=>{
 const f=fixture();f.control(0);f.health=async()=>Response.json({status:'error',code:'BUSY'});
 const r=await check(f);assert(r.issues.includes('SPONSORS_UNAVAILABLE'));assert(r.issues.includes('RESERVATIONS_UNAVAILABLE'));assert(!r.issues.includes('PROVIDER_QUOTA_UNAVAILABLE'));assert.equal(f.calls(),0);f.sql.close();
});
await test('Google delivery overview makes no obsolete quota request and explains the inactive provider',async()=>{
 const f=fixture();f.control(0);const previous=globalThis.fetch;globalThis.fetch=async()=>{throw Error('NETWORK MUST NOT BE USED');};
 try{const r=await adminRequest({env:f.env,data:{identity:{role:'admin',email:'fixture@example.test'}},request:new Request('https://fixture.test/api/admin/delivery/overview')});assert.equal(r.status,200);const b=await r.json();assert.equal(b.data.provider.quotaRequired,false);assert.match(b.data.quotaNote,/SMTP2GO je neaktivní/);assert.match(b.data.quotaNote,/Googlu/);}finally{globalThis.fetch=previous;f.sql.close();}
});
console.log(JSON.stringify({tests:count,network:'mock only',emails:'none'}));
