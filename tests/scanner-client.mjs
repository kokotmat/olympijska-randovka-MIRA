import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html=fs.readFileSync(new URL('../kontrola-vstupenek.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('async function rpc('),html.indexOf('async function decode('));
function fixture(fetch,onLine=true,timeout=false){
  const nodes=new Map();
  const node=()=>({dataset:{},children:[],checked:false,replaceChildren(...v){this.children=v;},append(v){this.children.push(v);},focus(){}});
  const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  const context={window:{},navigator:{onLine},document:{getElementById:get,createElement:node,
    querySelector:q=>({content:q.includes('randovka-api')?'/api/scanner':'https://script.google.com/macros/s/TEST/exec'})},
    fetch,URL,AbortController,Date,performance:{now:()=>0},setTimeout(fn,delay){if(timeout&&delay===25000)queueMicrotask(fn);return 1;},clearTimeout(){}};
  vm.createContext(context);vm.runInContext("const $=id=>document.getElementById(id);let session='test-session',busy=false,stream=null,epoch=0,lastHash='',audio=null;const history=[];"+source,context);
  return {context,get};
}
const hash='abcdef01-1234-5678-90ab-abcdefabcdef';let count=0;
for(const [name,fetch,online,timeout,kind] of [
  ['offline',()=>{throw Error('No network expected');},false,false,'warn'],
  ['network loss',async()=>{throw TypeError('Failed to fetch');},true,false,'warn'],
  ['timeout after possible commit',()=>new Promise(()=>{}),true,true,'warn'],
  ['used QR after retry',async()=>Response.json({status:'error',code:'USED'}),true,false,'bad'],
  ['success missing admission code',async()=>Response.json({status:'success'}),true,false,'bad'],
  ['server rejects contradictory admission',async()=>Response.json({status:'error',code:'ADMITTED'}),true,false,'bad'],
  ['server confirmed admission',async()=>Response.json({status:'success',code:'ADMITTED',used:1,count:1}),true,false,'ok']
]){
  const f=fixture(fetch,online,timeout);await f.context.inspect(hash);assert.equal(f.get('result').dataset.kind,kind,name);count++;
}
console.log(`PASS ${count} scanner UI scenarios: offline, network error, uncertain timeout, used retry and strict server-confirmed green.`);
