(() => {
  'use strict';
  const $=id=>document.getElementById(id),dialog=$('table-picker'),select=$('selected-table');
  if(!dialog||!window.PLES_TABLE_LAYOUT)return;
  const layouts=window.PLES_TABLE_LAYOUT,labels={floor:'Sál',balcony:'Ochoz'};
  let floor='floor',count=1,pending='',snapshot=null,loading=false,generation=0,timer;
  const isLive=()=>Boolean(window.PLES_CONFIG?.reservationAdapter);
  const fresh=()=>snapshot&&Date.now()-snapshot.checkedAt<60000;
  const hasAvailability=()=>fresh()&&snapshot.state==='open';
  const name=(f,n)=>`${labels[f]} - Stůl ${n}`;
  function allowed(table){
    if(count>4)return false;
    if(hasAvailability())return snapshot.tables[table]>=count;
    return !isLive();
  }
  function status(){
    if(loading)return 'Ověřuji dostupnost…';
    if(hasAvailability())return 'Volná místa ověřena v '+new Intl.DateTimeFormat('cs-CZ',{hour:'2-digit',minute:'2-digit',second:'2-digit'}).format(snapshot.checkedAt)+'.';
    if(fresh()&&snapshot.state==='closed')return 'Ukázka výběru. Prodej zatím není otevřený; dostupnost míst se nezobrazuje.';
    return 'Dostupnost není ověřená. '+(isLive()?'Obnovte přehled.':'Můžete si prohlédnout ukázku výběru.');
  }
  function options(){
    const previous=select.value;
    select.replaceChildren(new Option('— Vyberte stůl —',''));
    for(const f of ['floor','balcony']){
      const group=document.createElement('optgroup');group.label=f==='floor'?'Velký sál · přízemí':'Ochoz · balkón';
      for(const n of Object.keys(layouts[f])){
        const table=name(f,n),seats=hasAvailability()?` · volno ${snapshot.tables[table]}/4`:'';
        const option=new Option(table+seats,table);option.disabled=!allowed(table);group.append(option);
      }
      select.append(group);
    }
    select.disabled=count>4||(isLive()&&!hasAvailability());
    if(previous&&allowed(previous))select.value=previous;
    if(pending&&!allowed(pending))pending='';
  }
  function render(){
    const focus=document.activeElement?.dataset?.table,scroll=$('table-buttons').scrollTop;
    $('table-availability').textContent=count>4?'U jednoho stolu jsou nejvýše 4 místa. Snižte počet, nebo vytvořte samostatné rezervace.':status();
    $('table-dialog-status').textContent=status();
    $('table-refresh').disabled=loading;
    $('table-picker-note').textContent=isLive()?'Místa potvrdíme až při dokončení rezervace.':'Ukázka výběru, bez vytvoření rezervace.';
    $('table-selection-summary').textContent=pending?pending+(hasAvailability()?` · volno ${snapshot.tables[pending]} ze 4 míst`:' · ukázka'):'Zatím není vybraný stůl.';
    $('confirm-table').disabled=!pending||!allowed(pending)||loading;
    document.querySelectorAll('[data-floor]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.floor===floor)));
    const list=$('table-buttons'),map=$('table-map-buttons');list.replaceChildren();map.replaceChildren();
    for(const [number,position] of Object.entries(layouts[floor])){
      const table=name(floor,number),seats=hasAvailability()?snapshot.tables[table]:null;
      const description=seats===null?'Ukázka':seats===0?'Obsazeno':`Volno ${seats}/4`;
      for(const target of [list,map]){
        const button=document.createElement('button');button.type='button';button.dataset.table=table;
        button.disabled=!allowed(table)||loading;button.setAttribute('aria-pressed',String(pending===table));
        button.setAttribute('aria-label',`${table} · ${description}${seats!==null&&seats<count?' · nedostatek míst pro vaši skupinu':''}`);
        if(target===list){button.append(document.createTextNode('Stůl '+number));const small=document.createElement('small');small.textContent=description;button.append(small);}
        else{button.textContent=number;button.style.left=position.x+'%';button.style.top=position.y+'%';}
        button.addEventListener('click',()=>{
          pending=table;render();
          // Rendering replaces the buttons: restore keyboard focus to the same table.
          [...(target===list?list:map).children].find(b=>b.dataset.table===table)?.focus({preventScroll:true});
          highlight();
        });
        target.append(button);
      }
    }
    const image=$('table-map-image'),src=floor==='floor'?'assets/plan-prizemi.webp':'assets/plan-ochoz.webp';
    if(image.getAttribute('src')!==src){image.src=src;image.height=floor==='floor'?2332:2298;}
    image.alt=floor==='floor'?'Plánek Velkého sálu · přízemí':'Plánek ochozu · balkón';
    list.scrollTop=scroll;
    if(focus)[...list.children,...map.children].find(b=>b.dataset.table===focus&&!b.disabled)?.focus({preventScroll:true});
  }
  function highlight(){
    if(!$('table-map-details').open||!pending)return;
    const marker=[...$('table-map-buttons').children].find(b=>b.dataset.table===pending);
    if(marker){const scroller=$('table-map-scroll');scroller.scrollLeft=marker.offsetLeft-scroller.clientWidth/2;scroller.scrollTop=marker.offsetTop-scroller.clientHeight/2;}
  }
  async function refresh(){
    if(loading)return;
    const request=++generation;loading=true;render();
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),20000);
    try{
      const response=await fetch('/api/tables',{cache:'no-store',signal:controller.signal});
      const data=await response.json();
      if(!response.ok||data.status!=='success'||!['open','closed'].includes(data.state)||!Number.isFinite(data.checkedAt)||Math.abs(Date.now()-data.checkedAt)>60000)throw Error('AVAILABILITY');
      if(data.state==='open'){
        const expected=[...Object.keys(layouts.floor).map(n=>name('floor',n)),...Object.keys(layouts.balcony).map(n=>name('balcony',n))];
        if(!data.tables||expected.some(t=>!Number.isInteger(data.tables[t])||data.tables[t]<0||data.tables[t]>4))throw Error('AVAILABILITY');
      }
      if(request===generation)snapshot=data;
    }catch(_){if(request===generation)snapshot=null;}
    finally{clearTimeout(timeout);if(request===generation){loading=false;options();render();}}
  }
  $('open-table-picker').addEventListener('click',()=>{
    pending=select.value;floor=pending.startsWith('Ochoz')?'balcony':'floor';render();dialog.showModal();
    if(!fresh())refresh();else highlight();
    clearInterval(timer);timer=setInterval(()=>{if(!document.hidden)refresh();},30000);
  });
  $('table-picker-close').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{clearInterval(timer);$('open-table-picker').focus({preventScroll:true});});
  document.querySelectorAll('[data-floor]').forEach(b=>b.addEventListener('click',()=>{floor=b.dataset.floor;render();}));
  $('table-map-details').addEventListener('toggle',highlight);
  $('table-refresh').addEventListener('click',refresh);
  $('confirm-table').addEventListener('click',()=>{
    if(!pending||!allowed(pending)||loading){render();return;}
    select.value=pending;select.dispatchEvent(new Event('change',{bubbles:true}));dialog.close();
  });
  select.addEventListener('change',()=>{pending=select.value;});
  // Expired snapshots can never silently authorize a live form submission.
  window.PLES_TABLE_PICKER={refresh,canSelect:allowed,setCount(value){count=value;options();render();},reset(){select.value='';pending='';render();}};
})();
