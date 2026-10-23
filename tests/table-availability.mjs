import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const {onRequest}=await import('data:text/javascript;base64,'+Buffer.from(read('functions/api/tables.js')).toString('base64'));
const request=new Request('https://example.test/api/tables?endpoint=https://attacker.invalid');
const original=globalThis.fetch;let calls=[];
const scope={window:{}};vm.runInNewContext(read('table-layout.js'),scope);
const layout=scope.window.PLES_TABLE_LAYOUT;
assert.equal(Object.keys(layout.floor).length,70);assert.equal(Object.keys(layout.balcony).length,20);
for(const entries of Object.values(layout))for(const p of Object.values(entries))assert(p.x>0&&p.x<100&&p.y>0&&p.y<100);
const tables=Object.fromEntries([...Object.keys(layout.floor).map(n=>['Sál - Stůl '+n,4]),...Object.keys(layout.balcony).map(n=>['Ochoz - Stůl '+n,4])]);
try{
  globalThis.fetch=async(url,opts)=>{calls.push(url);assert.match(url,/^https:\/\/script.google.com\/macros\/s\/[\w-]+\/exec\?action=(capabilities|getTables)$/);assert(!opts.method||opts.method==='GET');return Response.json({status:'success',mode:'test',salesOpen:true});};
  assert.equal((await onRequest({request:new Request(request.url,{method:'POST'})})).status,405);assert.equal(calls.length,0);
  let r=await onRequest({request}),data=await r.json();assert.equal(data.state,'closed');assert.equal(data.tables,null);assert.equal(calls.length,1);
  globalThis.fetch=async url=>Response.json(url.endsWith('capabilities')?{status:'success',mode:'live',salesOpen:true}:tables);
  r=await onRequest({request});data=await r.json();assert.equal(data.state,'open');assert.equal(Object.keys(data.tables).length,90);assert.equal(r.headers.get('Cache-Control'),'no-store');
  tables['Sál - Stůl 1']=-1;assert.equal((await onRequest({request})).status,503);tables['Sál - Stůl 1']=0;
  data=await (await onRequest({request})).json();assert.equal(data.tables['Sál - Stůl 1'],0);
  globalThis.fetch=async()=>{throw Error('bank-token-or-private-order');};r=await onRequest({request});assert.equal(r.status,503);assert(!(await r.text()).includes('bank-token'));
}finally{globalThis.fetch=original;}
console.log('PASS 90 map coordinates, fixed read-only upstream, closed/test state, validated availability and safe outage.');
