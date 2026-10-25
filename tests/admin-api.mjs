import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {onRequest} from '../functions/api/admin/[[path]].js';
const actor='admin@example.test',origin='https://sprava.example.test';
function fixture(){
 const db=new DatabaseSync(':memory:');db.exec(fs.readFileSync(new URL('../admin/migrations/0001_commands.sql',import.meta.url),'utf8'));
 db.exec(fs.readFileSync(new URL('../admin/migrations/0004_web_operations.sql',import.meta.url),'utf8'));
 const env={RESERVATIONS_ADMIN_URL:'https://script.google.com/macros/s/test/exec',RESERVATIONS_ADMIN_SECRET:'offline-test-secret-'.repeat(3),ADMIN_DB:{prepare(sql){let values=[];return {bind(...v){values=v;return this;},async first(){return db.prepare(sql).get(...values)||null;},async all(){return {results:db.prepare(sql).all(...values)};},async run(){db.prepare(sql).run(...values);return {success:true};}};}}};
 return {env,db,async call(path,body,headers={},role='admin'){
  const request=new Request(origin+'/api/admin/'+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','Origin':origin,'X-Requested-By':'randovka-admin',...headers},...(body?{body:JSON.stringify(body)}:{})});
  const r=await onRequest({request,env,data:{identity:{email:actor,role}}});return {status:r.status,body:await r.json()};
 }};
}
let count=0;async function test(name,fn){await fn();count++;console.log('PASS',name);}
const originalFetch=globalThis.fetch;
try{
await test('cross-origin requests and viewers cannot execute a mutation',async()=>{const f=fixture();let calls=0;globalThis.fetch=async()=>{calls++;throw Error();};const b={commandId:crypto.randomUUID(),expectedVersion:'v1',args:{id:'TEST-1'}};assert.equal((await f.call('reservations/cancelOrder',b,{Origin:'https://evil.example.test'})).status,403);assert.equal((await f.call('reservations/cancelOrder',b,{},'viewer')).status,403);assert.equal(calls,0);f.db.close();});
await test('a confirmed command replays its receipt without a second upstream call',async()=>{const f=fixture();let calls=0;globalThis.fetch=async()=>{calls++;return Response.json({status:'success',data:{closed:true}});};const b={commandId:crypto.randomUUID(),expectedVersion:'v1',args:{}};assert.equal((await f.call('reservations/closeSales',b)).status,200);assert.equal((await f.call('reservations/closeSales',b)).status,200);assert.equal(calls,1);assert.equal((await f.call('reservations/closeSales',{...b,args:{changed:true}})).status,409);assert.equal(calls,1);f.db.close();});
await test('a timeout stays uncertain and reconciliation only reads the original receipt',async()=>{const f=fixture();const b={commandId:crypto.randomUUID(),expectedVersion:'v1',args:{}};let calls=0;globalThis.fetch=async()=>{calls++;throw Error('timeout after possible write');};assert.equal((await f.call('reservations/closeSales',b)).body.code,'COMMAND_RESULT_UNKNOWN');assert.equal((await f.call('reservations/closeSales',b)).body.code,'COMMAND_UNCERTAIN');assert.equal(calls,1);globalThis.fetch=async(_,options)=>{const e=JSON.parse(options.body);assert.equal(e.op,'commandStatus');assert.equal(e.args.id,b.commandId);return Response.json({status:'success',data:{state:'done',result:{status:'success',data:{closed:true}}}});};const receipt=await f.call('commands/'+b.commandId);assert.equal(receipt.body.data.state,'done');assert.equal((await f.call('reservations/closeSales',b)).status,200);f.db.close();});
await test('an unknown component failure after a write remains uncertain',async()=>{const f=fixture();globalThis.fetch=async()=>Response.json({status:'error',code:'BRIDGE_UNAVAILABLE'});const b={commandId:crypto.randomUUID(),expectedVersion:'v1',args:{}};assert.equal((await f.call('reservations/closeGate',b)).body.code,'COMMAND_RESULT_UNKNOWN');assert.equal(f.db.prepare('SELECT state FROM commands').get().state,'uncertain');f.db.close();});
await test('the API exposes no operation to open sales, open the gate or send arbitrary mail',async()=>{const f=fixture();for(const op of ['openSales','openGate','sendEmail','setProperty'])assert.equal((await f.call('reservations/'+op,{commandId:crypto.randomUUID(),expectedVersion:'v1',args:{}})).status,404);f.db.close();});
}finally{globalThis.fetch=originalFetch;}
console.log(JSON.stringify({tests:count,network:'none',database:'temporary in-memory SQLite'}));
