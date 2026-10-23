import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
function fixture(live=false){
  let now=Date.now(),response={status:'success',state:'closed',checkedAt:now,tables:null};
  const nodes=new Map();
  function node(){return {dataset:{},style:{setProperty(k,v){this[k]=v;}},clientWidth:800,clientHeight:600,scrollLeft:0,children:[],events:{},value:'',scrollTop:0,disabled:false,
    append(...items){this.children.push(...items);},replaceChildren(...items){this.children=items;},
    setAttribute(k,v){this[k]=v;},getAttribute(k){return this[k];},addEventListener(k,fn){this.events[k]=fn;},focus(){},dispatchEvent(e){this.events[e.type]?.(e);},getBoundingClientRect(){return {left:0,top:0};},setPointerCapture(){},
    showModal(){this.open=true;},close(){this.open=false;this.events.close?.();}};}
  const get=id=>{if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);};
  const window={PLES_CONFIG:{reservationAdapter:live?{}:null}};
  const context={window,document:{getElementById:get,querySelectorAll:()=>[],createElement:node,createTextNode:s=>s,hidden:false,activeElement:null,addEventListener(){},dispatchEvent(){}},
    Option:function(text,value){this.text=text;this.value=value;},Event,CustomEvent,Intl,AbortController,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},
    Date:class extends Date{static now(){return now;}},fetch:async()=>({ok:true,json:async()=>response})};
  vm.createContext(context);vm.runInContext(read('table-layout.js')+'\n'+read('table-picker.js'),context);
  const api=window.PLES_TABLE_PICKER;
  const snapshot=()=>({status:'success',state:'open',checkedAt:now,tables:Object.fromEntries([
    ...Object.keys(window.PLES_TABLE_LAYOUT.floor).map(n=>['Sál - Stůl '+n,4]),...Object.keys(window.PLES_TABLE_LAYOUT.balcony).map(n=>['Ochoz - Stůl '+n,4])])});
  return {api,get,snapshot,model:window.PLES_COMBINED_LAYOUT,setResponse:r=>response=r,advance:ms=>now+=ms};
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

f=fixture();f.api.setCount(2);await f.api.refresh();f.get('open-table-picker').events.click();
assert.equal(Object.keys(f.model).length,90);
assert.equal(new Set(Object.values(f.model).map(p=>p.label)).size,90);
for(const p of Object.values(f.model))assert(p.x>0&&p.x<100&&p.y>12&&p.y<100);
let markers=f.get('table-map-buttons').children;
assert.equal(markers.length,90);
markers.find(b=>b.dataset.table==='Ochoz - Stůl 10').events.click();
assert.equal(f.get('confirm-table').disabled,false);
assert.match(f.get('confirm-table').textContent,/900/);
assert.equal(f.get('table-map-buttons').children.find(b=>b.dataset.table==='Ochoz - Stůl 10')['aria-pressed'],'true');
f.get('confirm-table').events.click();assert.equal(f.get('selected-table').value,'Ochoz - Stůl 10');
const viewport=f.get('table-map-scroll'),startWidth=parseFloat(f.get('table-map-canvas').style.width);
const pointer=(id,x,y)=>({pointerId:id,pointerType:'touch',clientX:x,clientY:y,preventDefault(){}});
viewport.events.pointerdown(pointer(1,200,200));viewport.events.pointerdown(pointer(2,300,200));
viewport.events.pointermove(pointer(2,400,200));assert(parseFloat(f.get('table-map-canvas').style.width)>startWidth);
let prevented=false;viewport.events.click({preventDefault(){prevented=true;},stopPropagation(){}});assert(prevented,'A pinch cannot accidentally select a table.');
viewport.events.pointerup(pointer(2,400,200));viewport.events.pointerup(pointer(1,200,200));

f=fixture(true);const stock=f.snapshot();stock.tables['Sál - Stůl 1']=0;stock.tables['Sál - Stůl 2']=2;
f.setResponse(stock);f.api.setCount(3);await f.api.refresh();
markers=f.get('table-map-buttons').children;
assert.equal(markers.find(b=>b.dataset.table==='Sál - Stůl 1').dataset.state,'full');
assert.equal(markers.find(b=>b.dataset.table==='Sál - Stůl 2').dataset.state,'few');
assert(markers.find(b=>b.dataset.table==='Sál - Stůl 2').disabled);
f.api.setCount(2);markers=f.get('table-map-buttons').children;
assert.equal(markers.find(b=>b.dataset.table==='Sál - Stůl 2').dataset.free,'2/4');
assert(!markers.find(b=>b.dataset.table==='Sál - Stůl 2').disabled);
const poster=read('assets/plan-spolecny.svg'),background=read('assets/plan-spolecny-podklad.svg');
assert.equal((poster.match(/data-table=/g)||[]).length,90);assert(!background.includes('data-table='));
assert(poster.includes('JEVIŠTĚ'));
console.log('PASS all 90 map identities, balcony selection, totals, pinch scaling, accidental-click suppression and partial capacity states.');
