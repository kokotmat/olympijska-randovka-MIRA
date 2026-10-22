import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const backend = fs.readFileSync(new URL('../backend/TestReservations.gs', import.meta.url), 'utf8');
const headers = ['Timestamp','Jméno','Email','Typ','Kusů','Cena','ID testu','Status',
  'Vstupenka Hash','Vybraný stůl','Rozdělit do samostatných PDF','Použité kódy','Request ID'];
let rows = [headers], busy = false, released = 0, namedSheet = true;
const sheet = {
  getRange: () => ({getValues: () => [headers]}),
  getDataRange: () => ({getValues: () => rows}),
  appendRow: row => rows.push(row)
};
const context = {
  ContentService: {MimeType:{JSON:'json'},createTextOutput: text => ({text,setMimeType(){return this;}})},
  LockService: {getScriptLock: () => ({waitLock(){if(busy)throw new Error('busy');},releaseLock(){released++;}})},
  SpreadsheetApp: {openById(id){assert.equal(id, '1kvTNS2e6IsavmOCOQG__3htPBcISzadckq_Fz0jHziA');return {
    getSheetByName(name){assert.equal(name,'Test_rezervace');return namedSheet ? sheet : null;}
  };},flush(){}},
  Utilities: {getUuid: () => 'test-uuid'},
  // Any accidental use of banking, email or QR/PDF dependencies fails the test.
  MailApp: new Proxy({}, {get(){throw new Error('Email forbidden');}}),
  UrlFetchApp: new Proxy({}, {get(){throw new Error('External HTTP forbidden');}})
};
vm.createContext(context);
vm.runInContext(backend, context);
const post = data => JSON.parse(context.doPost({postData:{contents:JSON.stringify(data)}}).text);
const get = action => JSON.parse(context.doGet({parameter:{action}}).text);
const payload = {mode:'test',requestId:'request-1234567890',name:'Tester',email:'test@example.com',
  ticketType:'Místenka ke stolu',count:2,totalPrice:1,table:'Sál - Stůl 1',oddelenePdf:true};
assert.equal(get('capabilities').mode,'test');
assert.equal(Object.keys(get('getTables')).length,90);
assert.equal(post(payload).status,'success');
assert.equal(rows.length,2);
assert.equal(rows[1][5],900, 'Price must be computed on server');
assert.equal(rows[1][7],'TEST – bez platby');
assert.equal(rows[1][8],'', 'No valid ticket hashes');
assert.equal(get('getTables')['Sál - Stůl 1'],2);
assert.equal(post(payload).status,'success');
assert.equal(rows.length,2, 'Retry must not duplicate order');
assert.equal(post({...payload,count:1}).status,'error', 'Changed payload must not reuse request ID');
assert.equal(post({...payload,requestId:'request-2234567890',count:3}).status,'error');
for (const change of [{mode:'live'},{count:0},{count:1.5},{count:11},{count:'2'},
  {ticketType:'Other'},{table:'Sál - Stůl 999'},{table:''},{email:'bad'},{name:''},{requestId:''}]) {
  assert.equal(post({...payload,...change}).status,'error');
}
assert.equal(rows.length,2);
const standing = {...payload,requestId:'request-3234567890',ticketType:'Základní vstupenka',
  table:'',count:1,name:'=FORMULA',oddelenePdf:true};
assert.equal(post(standing).status,'success');
assert.equal(rows[2][1],"'=FORMULA");
assert.equal(rows[2][5],350);
assert.equal(rows[2][10],false);
busy=true;
const releaseBefore= released;
assert.equal(post({...payload,requestId:'request-4234567890'}).status,'error');
assert.equal(released,releaseBefore, 'Failed lock acquisition must not release an unowned lock');
busy=false; namedSheet=false;
assert.equal(get('capabilities').status,'error');
namedSheet=true;

const frontend = fs.readFileSync(new URL('../app.js', import.meta.url),'utf8');
let calls=[], responses=[];
const client = {window:{},URL,fetch:async(url,options)=>{
  calls.push({url:String(url),options});
  return {ok:true,json:async()=>responses.shift()};
}};
vm.runInNewContext(frontend.slice(0,frontend.indexOf('(() => {')),client);
const config=client.window.PLES_CONFIG, adapter=config.reservationAdapter;
assert.equal(config.reservationMode,'test');
assert.equal(config.reservationTestEndpoint,null);
await assert.rejects(()=>adapter.submit(payload));
await assert.rejects(()=>adapter.submitTest(payload,payload.requestId));
assert.equal(calls.length,0);
config.reservationTestEndpoint='https://script.google.com/macros/s/TEST_ONLY/exec';
responses=[{'Sál - Stůl 1':4}];
await assert.rejects(()=>adapter.submitTest(payload,payload.requestId));
assert.equal(calls.length,1, 'Original backend must not receive a POST after failed handshake');
calls=[];
responses=[get('capabilities'),{status:'success',mode:'test',testId:'TEST-id'}];
assert.equal((await adapter.submitTest(payload,payload.requestId)).mode,'test');
assert.equal(calls.length,2);
assert.equal(new URL(calls[0].url).searchParams.get('action'),'capabilities');
assert.equal(calls[1].options.method,'POST');
assert.equal(JSON.parse(calls[1].options.body).mode,'test');
assert.equal(JSON.parse(calls[1].options.body).requestId,payload.requestId);
console.log('PASS: isolated test sheet, strict validation, server prices, capacity, idempotency, formula protection, lock errors, no email/bank/ticket calls, frontend test handshake and POST protection.');
