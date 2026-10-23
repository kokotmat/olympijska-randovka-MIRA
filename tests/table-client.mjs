import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
function fixture(live=false){
  let now=Date.now(),response={status:'success',state:'closed',checkedAt:now,tables:null};
  const nodes=new Map();
  function node(){return {dataset:{},style:{},children:[],events:{},value:'',scrollTop:0,disabled:false,
    append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},
    setAttribute(k,v){this[k]=v;},getAttribute(k){return this[k];},addEventListener(k,fn){this.events[k]=fn;},focus(){},
    showModal(){this.open=true;},close(){this.open=false;this.events.close?.();}};}
  const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  const window={PLES_CONFIG:{reservationAdapter:live?{}:null}};
  const context={window,document:{getElementById:get,querySelectorAll:()=>[],createElement:node,createTextNode:s=>s,hidden:false,activeElement:null},
    Option:function(text,value){this.text=text;this.value=value;},Event,Intl,AbortController,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
    Date:class extends Date{static now(){return now;}},fetch:async()=>({ok:true,json:async()=>response})};
  vm.createContext(context);vm.runInContext(read('table-layout.js')+'\n'+read('table-picker.js'),context);
  const api=window.PLES_TABLE_PICKER;
  const snapshot=()=>({status:'success',state:'open',checkedAt:now,tables:Object.fromEntries([
    ...Object.keys(window.PLES_TABLE_LAYOUT.floor).map(n=>['Sál - Stůl '+n,4]),...Object.keys(window.PLES_TABLE_LAYOUT.balcony).map(n=>['Ochoz - Stůl '+n,4])])});
  return {api,get,snapshot,setResponse:r=>response=r,advance:ms=>now+=ms};
}
let f=fixture();f.api.setCount(1);await f.api.refresh();assert.match(f.get('table-dialog-status').textContent,/Ukázka/);assert(f.api.canSelect('Sál - Stůl 1'));
f=fixture(true);f.api.setCount(1);await f.api.refresh();assert(!f.api.canSelect('Sál - Stůl 1'));assert(f.get('selected-table').disabled);
const data=f.snapshot();data.tables['Sál - Stůl 1']=0;data.tables['Sál - Stůl 2']=2;f.setResponse(data);await f.api.refresh();
assert(!f.api.canSelect('Sál - Stůl 1'));assert(f.api.canSelect('Sál - Stůl 2'));
f.api.setCount(3);assert(!f.api.canSelect('Sál - Stůl 2'));assert(f.api.canSelect('Ochoz - Stůl 1'));
f.api.setCount(5);assert(!f.api.canSelect('Ochoz - Stůl 1'));assert.match(f.get('table-availability').textContent,/nejvýše 4/);
f.api.setCount(1);f.advance(61000);assert(!f.api.canSelect('Ochoz - Stůl 1'));
f.setResponse({...f.snapshot(),tables:{}});await f.api.refresh();assert(!f.api.canSelect('Ochoz - Stůl 1'));assert.match(f.get('table-dialog-status').textContent,/není ověřená/);
console.log('PASS preview/live distinction, full tables, group size, 60-second expiry and invalid availability fail closed.');
