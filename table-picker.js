(() => {
  'use strict';
  const $=id=>document.getElementById(id),dialog=$('table-picker'),select=$('selected-table'),model=window.PLES_COMBINED_LAYOUT;
  if(!dialog||!model)return;
  let floor='all',count=1,pending='',snapshot=null,loading=false,timer,zoom=1;
  const live=()=>Boolean(window.PLES_CONFIG?.reservationAdapter),fresh=()=>snapshot&&Date.now()-snapshot.checkedAt<60000;
  const available=()=>fresh()&&snapshot.state==='open',money=n=>new Intl.NumberFormat('cs-CZ').format(n)+' Kč';
  const fits=t=>Boolean(model[t])&&count<=4&&(available()?snapshot.tables[t]>=count:!live());
  const maximum=t=>t&&available()?snapshot.tables[t]:4;
  function status(){
    if(loading)return 'Ověřuji dostupnost stolů…';
    if(available())return 'Ověřeno v '+new Intl.DateTimeFormat('cs-CZ',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(snapshot.checkedAt)+'.';
    if(fresh()&&snapshot.state==='closed')return 'Ukázka výběru. Prodej není otevřený; obsazenost se nezobrazuje.';
    return 'Dostupnost není ověřená. '+(live()?'Obnovte přehled.':'Prohlížíte si pouze ukázku.');
  }
  function options(){
    const previous=select.value;select.replaceChildren(new Option('— Vyberte stůl —',''));
    for(const f of ['floor','balcony']){
      const group=document.createElement('optgroup');group.label=f==='floor'?'Přízemí':'Ochoz · balkón';
      for(const [table,p] of Object.entries(model).filter(([,p])=>p.floor===f)){
        const o=new Option(table+(available()?` · volno ${snapshot.tables[table]}/4`:''),table);o.disabled=!fits(table);group.append(o);
      }select.append(group);
    }
    select.disabled=count>4||(live()&&!available());if(previous&&fits(previous))select.value=previous;
    if(pending&&!fits(pending))pending='';
    if(previous&&select.value!==previous)select.dispatchEvent?.(new Event('change',{bubbles:true}));
  }
  function render(){
    const a=document.activeElement,focus=a?.dataset?.table,mapFocus=a?.parentElement?.id==='table-map-buttons',scroll=$('table-buttons').scrollTop;
    $('table-availability').textContent=count>4?'U jednoho stolu jsou nejvýše 4 místa.':status();
    $('table-dialog-status').textContent=status();$('table-refresh').disabled=loading;
    $('table-picker-note').textContent=live()?'Místa potvrdíme při dokončení rezervace.':'Ukázka bez vytvoření rezervace.';
    $('table-selection-summary').textContent=pending?`${model[pending].floor==='floor'?'Přízemí':'Ochoz'} · stůl ${model[pending].number}`:'Vyberte stůl v plánku';
    $('table-selected-capacity').textContent=pending&&available()?`Volno ${snapshot.tables[pending]} ze 4 míst`:'Každý číslovaný stůl má 4 místa.';
    $('picker-count').textContent=count;$('picker-total').textContent=money(count*450);
    $('picker-minus').disabled=count<=1;$('picker-plus').disabled=count>=maximum(pending);
    $('confirm-table').textContent=(live()?'Použít výběr':'Použít v ukázce')+' · '+money(count*450);
    $('confirm-table').disabled=!pending||!fits(pending)||loading;
    $('table-choice-label').textContent=select.value||'Zatím nevybráno';$('table-choice-cta').textContent=select.value?'Změnit stůl v plánku':'Vybrat stůl v plánku';
    document.querySelectorAll('[data-floor-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.floorFilter===floor)));
    const list=$('table-buttons'),map=$('table-map-buttons');list.replaceChildren();map.replaceChildren();
    for(const [table,p] of Object.entries(model)){
      const seats=available()?snapshot.tables[table]:null,state=seats===0?'full':seats!==null&&seats<count?'few':'free';
      const description=seats===null?'Ukázka':seats===0?'Obsazeno':`Volno ${seats}/4`;
      for(const target of [list,map]){
        if(target===list&&floor!=='all'&&p.floor!==floor)continue;
        const b=document.createElement('button');b.type='button';b.dataset.table=table;b.dataset.floor=p.floor;b.dataset.state=state;
        b.disabled=!fits(table)||loading||(target===map&&floor!=='all'&&p.floor!==floor);
        b.setAttribute('aria-pressed',String(pending===table));b.setAttribute('aria-label',`${table} · ${description}${state==='few'?' · nedostatek míst pro vaši skupinu':''}`);
        if(target===map){b.textContent=p.label;b.style.left=p.x+'%';b.style.top=p.y+'%';if(seats!==null)b.dataset.free=seats===0?'×':`${seats}/4`;}
        else{b.append(document.createTextNode(p.label+' · stůl '+p.number));const small=document.createElement('small');small.textContent=description;b.append(small);}
        b.addEventListener('click',()=>{pending=table;render();[...(target===map?map:list).children].find(b=>b.dataset.table===table)?.focus({preventScroll:true});});target.append(b);
      }
    }
    list.scrollTop=scroll;if(focus)[...(mapFocus?map:list).children].find(b=>b.dataset.table===focus&&!b.disabled)?.focus({preventScroll:true});
  }
  const viewport=$('table-map-scroll'),canvas=$('table-map-canvas');
  const fit=()=>Math.max(.15,Math.min(viewport.clientWidth/1000,viewport.clientHeight/1312.5));
  const contentX=x=>(viewport.scrollLeft+x-Math.max(0,(viewport.clientWidth-1000*zoom)/2))/zoom;
  function setZoom(value,anchor){
    const x=anchor?.contentX??contentX(viewport.clientWidth/2),y=anchor?.contentY??(viewport.scrollTop+viewport.clientHeight/2)/zoom;
    zoom=Math.max(fit(),Math.min(2.5,value));canvas.style.width=Math.round(1000*zoom)+'px';
    canvas.style.setProperty('--marker-size',Math.max(10,Math.min(44,38*zoom))+'px');canvas.style.setProperty('--marker-font',Math.max(6,Math.min(16,18*zoom))+'px');
    viewport.scrollLeft=x*zoom+Math.max(0,(viewport.clientWidth-1000*zoom)/2)-(anchor?.x??viewport.clientWidth/2);viewport.scrollTop=y*zoom-(anchor?.y??viewport.clientHeight/2);
    $('table-zoom-value').textContent=Math.round(zoom*100)+' %';$('table-zoom-less').disabled=zoom<=fit()+.005;$('table-zoom-more').disabled=zoom>=2.5;
  }
  function view(map){$('table-map-panel').hidden=!map;$('table-list-panel').hidden=map;$('table-view-map').setAttribute('aria-pressed',String(map));$('table-view-list').setAttribute('aria-pressed',String(!map));}
  function quantity(delta){document.dispatchEvent(new CustomEvent('ples:quantity',{detail:Math.max(1,Math.min(maximum(pending),count+delta))}));}
  async function refresh(){
    if(loading)return;loading=true;render();const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch('/api/tables',{cache:'no-store',signal:controller.signal}),d=await response.json();
      if(!response.ok||d.status!=='success'||!['open','closed'].includes(d.state)||!Number.isFinite(d.checkedAt)||Math.abs(Date.now()-d.checkedAt)>60000)throw Error('AVAILABILITY');
      if(d.state==='open'&&(!d.tables||Object.keys(model).some(t=>!Number.isInteger(d.tables[t])||d.tables[t]<0||d.tables[t]>4)))throw Error('AVAILABILITY');snapshot=d;
    }catch(_){snapshot=null;}finally{clearTimeout(timeout);loading=false;options();render();}
  }
  $('open-table-picker').addEventListener('click',()=>{pending=select.value;floor='all';render();dialog.showModal();view(true);setZoom(fit());if(!fresh())refresh();clearInterval(timer);timer=setInterval(()=>{if(!document.hidden)refresh();},30000);});
  $('table-picker-close').addEventListener('click',()=>dialog.close());dialog.addEventListener('close',()=>{clearInterval(timer);$('open-table-picker').focus({preventScroll:true});});
  document.querySelectorAll('[data-floor-filter]').forEach(b=>b.addEventListener('click',()=>{floor=b.dataset.floorFilter;render();}));
  $('table-view-map').addEventListener('click',()=>view(true));$('table-view-list').addEventListener('click',()=>view(false));
  $('table-zoom-less').addEventListener('click',()=>setZoom(zoom-.2));$('table-zoom-more').addEventListener('click',()=>setZoom(zoom+.2));$('table-zoom-fit').addEventListener('click',()=>setZoom(fit()));
  $('picker-minus').addEventListener('click',()=>quantity(-1));$('picker-plus').addEventListener('click',()=>quantity(1));$('table-refresh').addEventListener('click',refresh);
  $('confirm-table').addEventListener('click',()=>{if(!pending||!fits(pending)||loading){render();return;}select.value=pending;select.dispatchEvent(new Event('change',{bubbles:true}));dialog.close();});
  select.addEventListener('change',()=>{pending=select.value;render();});document.addEventListener('visibilitychange',()=>{if(dialog.open&&!document.hidden&&!fresh())refresh();});
  // Map-only touch gestures. The rest of the page retains native browser zoom.
  const pointers=new Map();let pinch=null,suppressClick=0;
  const midpoint=()=>{const [a,b]=[...pointers.values()];return {x:(a.x+b.x)/2,y:(a.y+b.y)/2,distance:Math.hypot(a.x-b.x,a.y-b.y)};};
  viewport.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch')return;const r=viewport.getBoundingClientRect();pointers.set(e.pointerId,{x:e.clientX-r.left,y:e.clientY-r.top,startX:e.clientX,startY:e.clientY});if(pointers.size===2){const m=midpoint();pinch={distance:m.distance,zoom,contentX:contentX(m.x),contentY:(viewport.scrollTop+m.y)/zoom};suppressClick=Date.now()+500;}});
  viewport.addEventListener('pointermove',e=>{const p=pointers.get(e.pointerId);if(!p)return;const r=viewport.getBoundingClientRect(),n={...p,x:e.clientX-r.left,y:e.clientY-r.top};pointers.set(e.pointerId,n);if(pointers.size===2&&pinch){e.preventDefault();viewport.setPointerCapture(e.pointerId);const m=midpoint();setZoom(pinch.zoom*m.distance/Math.max(1,pinch.distance),{...m,contentX:pinch.contentX,contentY:pinch.contentY});suppressClick=Date.now()+500;}else if(Math.hypot(e.clientX-p.startX,e.clientY-p.startY)>6){e.preventDefault();viewport.setPointerCapture(e.pointerId);viewport.scrollLeft-=n.x-p.x;viewport.scrollTop-=n.y-p.y;suppressClick=Date.now()+500;}},{passive:false});
  for(const t of ['pointerup','pointercancel'])viewport.addEventListener(t,e=>{pointers.delete(e.pointerId);if(pinch)suppressClick=Date.now()+500;pinch=null;for(const p of pointers.values()){const r=viewport.getBoundingClientRect();p.startX=p.x+r.left;p.startY=p.y+r.top;}});
  viewport.addEventListener('click',e=>{if(Date.now()<suppressClick){e.preventDefault();e.stopPropagation();}},true);
  viewport.addEventListener('wheel',e=>{if(!e.ctrlKey)return;e.preventDefault();const r=viewport.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;setZoom(zoom*Math.exp(-e.deltaY*.01),{x,y,contentX:contentX(x),contentY:(viewport.scrollTop+y)/zoom});},{passive:false});
  viewport.addEventListener('keydown',e=>{if(e.target===viewport&&['+','=','-','0'].includes(e.key)){e.preventDefault();setZoom(e.key==='0'?fit():zoom+(e.key==='-'?-.2:.2));}});
  if(window.ResizeObserver)new ResizeObserver(()=>{if(dialog.open)setZoom(Math.max(fit(),zoom));}).observe(viewport);
  window.PLES_TABLE_PICKER={refresh,canSelect:fits,maxCount:()=>maximum(select.value),setCount(value){count=value;options();render();},reset(){select.value='';pending='';render();}};
})();
