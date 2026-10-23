import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';

// In-memory Apps Script contract doubles. No Google, bank or mail connection.
const source=fs.readFileSync(new URL('../backend/production/Reservations.gs',import.meta.url),'utf8');
const signedBytes=b=>[...b].map(n=>n>127?n-256:n);
let tests=0;
function fixture(){
  const properties={RUN_MODE:'test',SALES_OPEN:'true',SALES_OPEN_MODE:'test',SCANNER_OPEN:'true',SCANNER_OPEN_MODE:'test',
    SCANNER_PIN:'test-PIN-0000',SESSION_SECRET:'test-session-secret-'.repeat(3),SCANNER_GATEWAY_SECRET:'test-edge-secret-'.repeat(3),
    SCRIPT_URL:'https://script.google.com/macros/s/TEST_ONLY/exec',IBAN:'CZ2720100000002403476467',FIO_TOKEN:'T'.repeat(64),FIO_FROM_DATE:'2026-10-23'};
  let locked=false,busy=false,quota=100,bankFailure=false,flushFailure=false;
  const sheets=new Map(),cache=new Map();
  class Sheet {
    constructor(rows=[]){this.rows=rows;}
    getLastRow(){return this.rows.length;}
    appendRow(r){this.rows.push([...r]);}
    getRange(start,col,height=1,width=1){const s=this;return {
      getValues:()=>Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>s.rows[start-1+i]?.[col-1+j]??'')),
      setValues(values){values.forEach((r,i)=>{s.rows[start-1+i]??=[];r.forEach((v,j)=>s.rows[start-1+i][col-1+j]=v);});},
      createTextFinder(term){let entire=false,matchCase=true;return {matchCase(v){matchCase=v;return this;},useRegularExpression(){return this;},matchEntireCell(v){entire=v;return this;},findNext(){
        for(let i=start-1;i<Math.min(s.rows.length,start-1+height);i++){
          let value=String(s.rows[i][col-1]??''),needle=term;
          if(!matchCase){value=value.toLowerCase();needle=needle.toLowerCase();}
          if(entire?value===needle:value.includes(needle))return {getRow:()=>i+1};
        }return null;
      }};}
    };}
  }
  const p={getProperties:()=>({...properties}),getProperty:k=>properties[k]??null,setProperty(k,v){properties[k]=v;},deleteProperty(k){delete properties[k];}};
  const utilities={DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},getUuid:()=>crypto.randomUUID(),
    computeDigest:(_,value)=>signedBytes(crypto.createHash('sha256').update(value).digest()),
    computeHmacSha256Signature:(value,key)=>signedBytes(crypto.createHmac('sha256',key).update(value).digest()),
    base64EncodeWebSafe:value=>Buffer.from(typeof value==='string'?value:value.map(n=>(n+256)%256)).toString('base64url'),
    base64DecodeWebSafe:value=>[...Buffer.from(value,'base64url')],newBlob:value=>({getDataAsString:()=>Buffer.from(value).toString()}),
    formatDate:date=>date.toISOString().slice(0,10)};
  const ctx=vm.createContext({Date,console:{log(){},warn(){}},PropertiesService:{getScriptProperties:()=>p},Utilities:utilities,
    LockService:{getScriptLock:()=>({tryLock(){if(busy||locked)return false;locked=true;return true;},releaseLock(){assert(locked);locked=false;}})},
    CacheService:{getScriptCache:()=>({get:k=>cache.get(k)??null,put:(k,v)=>cache.set(k,v)})},
    SpreadsheetApp:{openById:()=>({getSheetByName:name=>sheets.get(name)}),flush(){if(flushFailure)throw Error('simulated uncertain flush');}},
    MailApp:{getRemainingDailyQuota:()=>quota,sendEmail(){throw Error('REAL MAIL FORBIDDEN');}},
    UrlFetchApp:{fetch(){assert(bankFailure,'Real network forbidden');throw Error('simulated bank outage');}},
    Session:{getActiveUser:()=>({getEmail:()=> 'owner@example.test'}),getEffectiveUser:()=>({getEmail:()=> 'owner@example.test'})},
    DocumentApp:new Proxy({},{get(){throw Error('REAL DOCUMENT FORBIDDEN');}}),DriveApp:new Proxy({},{get(){throw Error('REAL DRIVE FORBIDDEN');}})
  });
  vm.runInContext(source,ctx);const R=vm.runInContext('R',ctx);
  for(const name of ['Sheet1','Test_rezervace_PRO'])sheets.set(name,new Sheet([[...R.headers]]));
  const ledger=new Sheet([['ID','Date','VS','cents','currency']]);sheets.set('_Platby_live',ledger);
  const payload=(extra={})=>({name:'Tester',email:'tester@example.test',count:1,ticketType:R.seated,table:'Sál - Stůl 1',requestId:crypto.randomUUID(),...extra});
  const login=(pin=properties.SCANNER_PIN,client='a'.repeat(64))=>{
    const data={pin,gateway:{ts:Date.now(),nonce:crypto.randomUUID(),client}};
    data.gateway.signature=crypto.createHmac('sha256',properties.SCANNER_GATEWAY_SECRET).update(['scanner-login-v1',data.gateway.ts,data.gateway.nonce,client,crypto.createHash('sha256').update(pin).digest('hex')].join('\n')).digest('hex');
    return ctx.scannerLogin(data);
  };
  const sheet=()=>sheets.get(properties.RUN_MODE==='live'?'Sheet1':'Test_rezervace_PRO');
  return {ctx,R,properties,payload,login,sheet,ledger,setBusy:v=>busy=v,setQuota:v=>quota=v,setBankFailure:v=>bankFailure=v,setFlushFailure:v=>flushFailure=v};
}
function test(name,fn){fn();tests++;console.log('PASS',name);}
test('last seat and repeated request are serialized without overselling',()=>{
  const f=fixture(),a=f.payload({count:3});f.ctx.reserve_(a);
  const b=f.payload({email:'b@example.test'});f.ctx.reserve_(b);
  assert.throws(()=>f.ctx.reserve_(f.payload({email:'c@example.test'})),/dostatek/);
  assert.equal(f.ctx.reserve_(b).duplicate,true);assert.equal(f.sheet().rows.length,3);
  assert.throws(()=>f.ctx.reserve_({...b,count:2}),/requestId/);
  f.setBusy(true);assert.throws(()=>f.ctx.reserve_(f.payload()),/BUSY/);
});
test('partial, full, duplicate transaction and late payment',()=>{
  const f=fixture();f.ctx.reserve_(f.payload());const s=f.sheet(),r=s.rows[1],tx=(id,cents)=>({id,vs:r[6],cents,currency:'CZK',date:'2026-10-23'});
  const reconcile=txs=>f.ctx.reconcile_(s,f.ctx.rows_(s),f.ledger,txs,f.ctx.cfg_());
  reconcile([tx('1',20000)]);assert.equal(s.rows[1][7],f.R.waiting);assert.equal(s.rows[1][18],200);
  reconcile([tx('1',20000),tx('2',25000)]);assert.equal(s.rows[1][7],f.R.paid);assert.equal(s.rows[1][17],'ČEKÁ');assert.equal(f.ledger.rows.length,3);
  reconcile([tx('1',20000)]);assert.equal(s.rows[1][18],450);
  s.rows[1][7]=f.R.expired;reconcile([]);assert.equal(s.rows[1][7],f.R.late);assert(!f.ctx.statusPaid_(s.rows[1][7]));
});
test('bank outage cannot expire waiting orders',()=>{
  const f=fixture();f.ctx.reserve_(f.payload());const r=f.sheet().rows[1];r[15]=new Date(Date.now()-3600000);r[16]='ODESLÁNO';
  f.properties.RUN_MODE='live';f.sheet().rows.push([...r]);f.setBankFailure(true);
  assert.equal(f.ctx.checkPayments_(),false);assert.equal(f.sheet().rows[1][7],f.R.waiting);
});
test('quota exhaustion preserves queue and undelivered reservation',()=>{
  const f=fixture();f.ctx.reserve_(f.payload());f.properties.TEST_SEND_EMAILS='true';f.properties.TEST_RECIPIENT='test@example.test';f.setQuota(0);
  const r=f.sheet().rows[1];r[15]=new Date(Date.now()-3600000);
  f.ctx.sendOutbox_();f.ctx.expire_(f.sheet(),f.ctx.rows_(f.sheet()),f.ctx.cfg_());assert.equal(f.sheet().rows[1][16],'ČEKÁ');assert.equal(f.sheet().rows[1][7],f.R.waiting);
  const h=f.ctx.operationsHealth();assert.equal(h.queuedEmails,1);assert.equal(h.remainingRecipients,0);
});
test('one client lockout leaves another client login available; unsigned and modified proofs fail',()=>{
  const f=fixture();for(let i=0;i<10;i++)assert.equal(f.login('wrong').status,'error');
  assert.equal(f.login().status,'error');assert.equal(f.login(undefined,'b'.repeat(64)).status,'success');
  assert.equal(f.ctx.scannerLogin({pin:f.properties.SCANNER_PIN}).status,'error');
  const data={pin:f.properties.SCANNER_PIN,gateway:{ts:Date.now(),nonce:crypto.randomUUID(),client:'b'.repeat(64),signature:'f'.repeat(64)}};
  assert.equal(f.ctx.scannerLogin(data).status,'error');data.gateway.ts-=300000;assert.equal(f.ctx.scannerLogin(data).status,'error');
});
test('multiple readers admit each QR once, and no green before flush confirmation',()=>{
  const f=fixture();f.ctx.reserve_(f.payload({count:2}));const r=f.sheet().rows[1];r[7]=f.R.paid;
  const [a,b]=r[8].split(','),session=f.login().session;
  assert.equal(f.ctx.scannerScan({hash:a,session}).code,'ADMITTED');assert.equal(f.ctx.scannerScan({hash:a,session}).code,'USED');
  f.setFlushFailure(true);assert.equal(f.ctx.scannerScan({hash:b,session}).code,'ERROR');
  f.setFlushFailure(false);assert.equal(f.ctx.scannerScan({hash:b,session}).code,'USED');
  assert.equal(f.sheet().rows[1][11].split(',').length,2);
});
test('closed gate, expired/forged session, unpaid and busy never admit',()=>{
  const f=fixture();f.ctx.reserve_(f.payload());const hash=f.sheet().rows[1][8],session=f.login().session;
  assert.equal(f.ctx.scannerScan({hash,session}).code,'UNPAID');
  f.properties.SCANNER_OPEN='false';assert.equal(f.ctx.scannerScan({hash,session}).code,'CLOSED');
  assert.equal(f.ctx.scannerScan({hash,session:'forged'}).code,'AUTH');
  f.setBusy(true);assert.equal(f.ctx.scannerScan({hash,session}).code,'BUSY');assert.equal(f.sheet().rows[1][11],'');
});
const started=performance.now();for(let i=0;i<50;i++){const f=fixture();f.ctx.reserve_(f.payload());}
console.log(JSON.stringify({tests,localMock50FixturesMs:Math.round(performance.now()-started),note:'Contract tests only. Not Apps Script latency or a distributed load test.'}));
