/* Frontend configuration. Existing Apps Script payload names are retained. */
window.PLES_CONFIG = {
  "reservationMode": "test",
  "reservationTestEndpoint": null,
  "sponsors": [
    {
      "name": "Jablotron",
      "key": "jablotron",
      "logo": "assets/sponsors/jablotron.png",
      "url": "https://www.jablotron.com/"
    },
    {
      "name": "Bit of Happiness",
      "key": "happiness",
      "logo": "assets/sponsors/bit-of-happiness.png",
      "url": "https://www.bfhappiness.com/"
    },
    {
      "name": "Autoškola Šefr",
      "key": "autoskola",
      "logo": "assets/sponsors/autoskola.png",
      "url": "https://www.autoskola-sefr.cz/"
    },
    {
      "name": "Kitl",
      "key": "kitl",
      "logo": "assets/sponsors/kitl.png",
      "url": "https://www.kitl.cz/"
    },
    {
      "name": "Svijany",
      "key": "svijany",
      "logo": "assets/sponsors/svijany.png",
      "url": "https://www.pivovarsvijany.cz/"
    }
  ],
  "reservationAdapter": {
    endpoint: 'https://script.google.com/macros/s/AKfycbxtdKDQLvyaLOAqQFZ1gF8y7tkmxOYyrAgAZcGnp_ZetpX6r2F4CV1mYmMo_g_K4Nhk/exec',
    async getTables() {
      const testEndpoint = window.PLES_CONFIG.reservationMode === 'test' && window.PLES_CONFIG.reservationTestEndpoint;
      const url = new URL(testEndpoint || this.endpoint);
      url.searchParams.set('action', 'getTables');
      const response = await fetch(url, { redirect: 'follow' });
      if (!response.ok) throw new Error('Nepodařilo se načíst stoly.');
      const data = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Neplatný seznam stolů.');
      }
      if (data.status === 'error') throw new Error(data.message || 'Chyba načítání.');
      if (Object.values(data).some(seats => !Number.isInteger(seats) || seats < 0)) {
        throw new Error('Neplatné kapacity stolů.');
      }
      return data;
    },
    async submitTest(payload, requestId) {
      const config = window.PLES_CONFIG;
      if (config.reservationMode !== 'test' || !config.reservationTestEndpoint) {
        throw new Error('Testovací backend není nastaven.');
      }
      const url = new URL(config.reservationTestEndpoint);
      if (url.origin !== 'https://script.google.com' || !/^\/macros\/s\/[^/]+\/exec$/.test(url.pathname)) {
        throw new Error('Neplatná adresa testovacího backendu.');
      }
      url.searchParams.set('action', 'capabilities');
      const check = await fetch(url, { redirect: 'follow' });
      if (!check.ok) throw new Error('Testovací backend není dostupný.');
      const capabilities = await check.json();
      if (!capabilities || capabilities.status !== 'success' || capabilities.mode !== 'test' ||
          capabilities.protocol !== 'randovka-test-v1' || capabilities.sheet !== 'Test_rezervace' ||
          capabilities.emails !== false || capabilities.payments !== false || capabilities.tickets !== false) {
        throw new Error('Backend nepotvrdil oddělený testovací režim. Objednávka nebyla odeslána.');
      }
      const response = await fetch(config.reservationTestEndpoint, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ ...payload, mode: 'test', requestId })
      });
      if (!response.ok) throw new Error('Testovací objednávku se nepodařilo odeslat.');
      const data = await response.json();
      if (!data || data.status !== 'success' || data.mode !== 'test' || typeof data.testId !== 'string') {
        throw new Error(data && data.message || 'Testovací objednávka nebyla potvrzena.');
      }
      return data;
    },
    async submit(payload) {
      if (window.PLES_CONFIG.reservationMode !== 'live') {
        throw new Error('Testovací režim: objednávky se neodesílají.');
      }
      const response = await fetch(this.endpoint, {
        method: 'POST', redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify(payload)
      });
      if (!response.ok) throw new Error('Objednávku se nepodařilo odeslat.');
      const data = await response.json();
      if (!data || typeof data !== 'object' || Array.isArray(data)) {
        throw new Error('Neplatná odpověď rezervačního systému.');
      }
      if (data.status !== 'success') throw new Error(data.message || 'Rezervace nebyla přijata.');
      return data;
    }
  }
};
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const { studentsData, topTeachersData } = window.PLES_DATA;
  const config = window.PLES_CONFIG;
  const testMode = config.reservationMode !== 'live';
  const esc = value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const initials = name => name.split(' ').map(part=>part[0]).slice(0,2).join('');
  function photo(person, lazy = true) {
    return person.img ? `<img src="${esc(person.img)}" alt="${esc(person.name)}" ${lazy ? 'loading="lazy"' : ''} decoding="async">` : `<span class="initials" aria-label="Fotografie zatím není k dispozici">${esc(initials(person.name))}</span>`;
  }
  document.querySelectorAll('dialog').forEach(dialog => {
    dialog.querySelector('.dialog-close').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', event => {if(event.target === dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  });
  function openPerson(person) {
    $('modal-photo').innerHTML = photo(person,false);
    $('modal-name').textContent = person.name;
    const role = person.discipline === 'Disciplína' ? '' : (person.discipline || person.role);
    $('modal-role').textContent = role;
    $('modal-role').hidden = !role;
    const quote = /^(Hláška|Moje oblíbená hláška)\.{3}$/.test(person.quote) ? '' : person.quote;
    $('modal-quote').textContent = quote ? '„'+quote+'“' : '';
    $('modal-quote').hidden = !quote;
    $('student-modal').showModal();
  }
  let filter='all';
  const normalize = value=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const groups = [
    {section:'top-teachers-section',container:'top-teachers-container',data:topTeachersData,type:'teachers'},
    {section:'students-section',container:'students-grid',data:studentsData,type:'students'}
  ];
  function renderTeam() {
    const query=normalize($('student-search').value.trim());
    let results=0;
    groups.forEach(group=>{
      const people=group.data.filter(person=>(filter==='all'||filter===group.type)&&normalize(person.name+' '+(person.discipline||person.role)).includes(query));
      $(group.section).hidden=people.length===0;
      $(group.container).replaceChildren();
      results+=people.length;
      people.forEach(person=>{
        const button=document.createElement('button');
        button.type='button';
        button.className=group.type==='students'?'student-card':'teacher-card';
        button.setAttribute('aria-label','Detail: '+person.name);
        button.innerHTML=group.type==='students'
          ? `<div class="portrait">${photo(person)}</div><div class="person-meta"><span>${person.discipline === 'Disciplína' ? '' : esc(person.discipline || '')}</span></div><h4>${esc(person.name)}</h4>`
          : `${photo(person)}<div><h4>${esc(person.name)}</h4><blockquote>„${esc(person.quote)}“</blockquote></div>`;
        button.addEventListener('click',()=>openPerson(person));
        $(group.container).append(button);
      });
    });
    $('search-status').textContent=query ? (results ? 'Nalezeno: '+results : 'Žádný výsledek. Zkuste jiné jméno nebo disciplínu.') : '';
    document.dispatchEvent(new Event('ples:team-rendered'));
  }
  document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{
    filter=button.dataset.filter;
    document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    renderTeam();
  }));
  $('student-search').addEventListener('input',renderTeam);
  renderTeam();
  const targetDate=new Date('2027-01-22T19:00:00+01:00').getTime();
  function updateCountdown(){
    const difference=Math.max(0,targetDate-Date.now());
    if(!difference){$('countdown').textContent='Olympijský oheň už byl zapálen.';return;}
    const values=[Math.floor(difference/86400000),Math.floor(difference/3600000)%24,Math.floor(difference/60000)%60,Math.floor(difference/1000)%60];
    ['days','hours','minutes','seconds'].forEach((part,i)=>$('cd-'+part).textContent=String(values[i]).padStart(2,'0'));
  }
  updateCountdown();setInterval(updateCountdown,1000);
  const menu=$('mobile-menu-btn');
  function closeMenu(){menu.setAttribute('aria-expanded','false');$('main-nav').classList.remove('open');}
  menu.addEventListener('click',()=>{const expanded=menu.getAttribute('aria-expanded')!=='true';menu.setAttribute('aria-expanded',String(expanded));$('main-nav').classList.toggle('open',expanded);});
  $('main-nav').querySelectorAll('a').forEach(a=>a.addEventListener('click',closeMenu));
  document.addEventListener('keydown',e=>{if(e.key==='Escape')closeMenu();});
  const motionButton = $('sponsor-motion');
  if (motionButton) motionButton.addEventListener('click', () => {
    const paused = motionButton.getAttribute('aria-pressed') !== 'true';
    motionButton.setAttribute('aria-pressed', String(paused));
    motionButton.setAttribute('aria-label', paused ? 'Spustit pohyb sponzorů' : 'Pozastavit pohyb sponzorů');
    document.querySelector('.sponsor-row').classList.toggle('paused', paused);
  });
  if(config.sponsors.length){
    if(motionButton) motionButton.hidden = false;
    const track=document.createElement('div');
    track.className='sponsor-track';
    [false,true,true].forEach(duplicate=>{
      const group=document.createElement('div');
      group.className='sponsor-group';
      if(duplicate) group.setAttribute('aria-hidden','true');
      config.sponsors.forEach(sponsor=>{
        const element=document.createElement('a');
        element.className='sponsor-logo-item';
        element.dataset.sponsor=sponsor.key;
        element.href=sponsor.url;
        element.target='_blank';
        element.rel='noopener';
        if(duplicate) element.tabIndex=-1;
        else element.setAttribute('aria-label',sponsor.name+' — web firmy');
        const img=document.createElement('img');
        img.src=sponsor.logo;
        img.alt=duplicate?'':sponsor.name;
        img.decoding='async';
        element.append(img);
        group.append(element);
      });
      track.append(group);
    });
    $('sponsor-logos').replaceChildren(track);
  }
  let count=1, tables={}, tableRequest=0, pendingTest=null;
  const money=value=>new Intl.NumberFormat('cs-CZ').format(value)+' Kč';
  const selectedType=()=>document.querySelector('input[name="ticketType"]:checked').value;
  function populateTables(){
    const select=$('selected-table'), previous=select.value;
    select.replaceChildren(new Option('-- Vyberte stůl z nabídky --',''));
    const floor=document.createElement('optgroup');floor.label='Velký sál (Přízemí)';
    const balcony=document.createElement('optgroup');balcony.label='Ochoz (Balkón)';
    Object.entries(tables).forEach(([name,seats])=>{if(Number(seats)>=count)(name.startsWith('Sál')?floor:balcony).append(new Option(name+' (Volno: '+seats+' míst)',name));});
    select.append(floor,balcony);select.disabled=false;
    if([...select.options].some(option=>option.value===previous))select.value=previous;
    if(select.options.length===1){select.options[0].textContent='Pro vybraný počet osob nejsou stoly';}
  }
  async function loadTables(){
    if(!config.reservationAdapter)return;
    const request=++tableRequest;
    $('selected-table').disabled=true;
    $('selected-table').replaceChildren(new Option('Načítám volné stoly…',''));
    try{const result=await config.reservationAdapter.getTables();if(request!==tableRequest)return;tables=result;populateTables();}
    catch(error){if(request!==tableRequest)return;$('selected-table').replaceChildren(new Option('Chyba spojení. Zkuste změnit typ vstupenky.',''));$('form-status').textContent='Nepodařilo se načíst stoly.';}
  }
  function updateTickets(){
    const seating=selectedType()==='450';
    $('ticket-count').textContent=count;
    $('total-price').textContent=money(Number(selectedType())*count);
    $('table-selection-box').hidden=!seating;
    $('selected-table').required=seating&&Boolean(config.reservationAdapter);
    $('pdf-options-box').hidden=count===1;
    if(count===1)$('separate-pdf').checked=false;
    $('minus').disabled=count===1;$('plus').disabled=count===10;
    if(seating&&Object.keys(tables).length)populateTables();
  }
  $('minus').addEventListener('click',()=>{count=Math.max(1,count-1);updateTickets();});
  $('plus').addEventListener('click',()=>{count=Math.min(10,count+1);updateTickets();});
  document.querySelectorAll('input[name="ticketType"]').forEach(radio=>radio.addEventListener('change',()=>{updateTickets();if(selectedType()==='450')loadTables();}));
  $('reservation-modal').querySelector('.dialog-done').addEventListener('click',()=>$('reservation-modal').close());
  if(config.reservationAdapter){
    document.querySelector('.submit').textContent=testMode?(config.reservationTestEndpoint?'Uložit testovací rezervaci':'Zkontrolovat testovací rezervaci'):'Dokončit rezervaci';
    document.querySelector('.submit + .form-note').textContent=testMode
      ?(config.reservationTestEndpoint?'Testovací režim. Objednávka se uloží pouze do testovacího listu. Platby, e-maily ani platné vstupenky se nevytvářejí.':'Testovací režim. Volná místa se načítají ze systému; objednávky, platby ani e-maily se neodesílají.')
      :'Platební instrukce obdržíte e-mailem. Vstupenky zašleme po přijetí platby.';
  }
  $('ticket-form').addEventListener('submit',async event=>{
    event.preventDefault();
    const seating=selectedType()==='450';
    const payload={name:$('buyer-name').value.trim(),email:$('buyer-email').value.trim(),ticketType:seating?'Místenka ke stolu':'Základní vstupenka',count,totalPrice:count*Number(selectedType()),table:seating?$('selected-table').value:'',oddelenePdf:$('separate-pdf').checked};
    if(!payload.name){$('buyer-name').setCustomValidity('Vyplňte jméno a příjmení.');$('buyer-name').reportValidity();return;}
    if(config.reservationAdapter&&seating&&(!payload.table||Number(tables[payload.table])<count)){$('form-status').textContent='Vyberte stůl s dostatkem volných míst.';return;}
    const rows=[['Jméno',payload.name],['E-mail',payload.email],['Vstupenka',payload.ticketType],['Počet',payload.count],['Stůl',payload.table||(seating?'Bude vybrán při spuštění rezervací':'Bez místenky')],['PDF',payload.oddelenePdf?'Samostatné soubory':'Společný soubor'],['Celkem',money(payload.totalPrice)]];
    $('reservation-summary').innerHTML=rows.map(([label,value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('');
    if(!config.reservationAdapter||(testMode&&!config.reservationTestEndpoint)){
      $('reservation-heading').textContent='Testovací rezervace připravena';
      document.querySelector('.preview-notice').textContent='Toto je test. Objednávka nebyla odeslána, místo není rezervováno a žádný e-mail ani PDF se neposílá.';
      $('reservation-modal').showModal();return;
    }
    const submit=document.querySelector('.submit');submit.disabled=true;submit.textContent='Odesílám…';$('form-status').textContent='';
    try{
      const fingerprint=JSON.stringify(payload);
      if(testMode&&(!pendingTest||pendingTest.fingerprint!==fingerprint))pendingTest={fingerprint,id:crypto.randomUUID()};
      const result=testMode?await config.reservationAdapter.submitTest(payload,pendingTest.id):await config.reservationAdapter.submit(payload);
      if(result.status!=='success')throw new Error(result.message||'Rezervace nebyla přijata.');
      $('reservation-heading').textContent=testMode?'Testovací rezervace uložena':'Objednávka přijata!';
      document.querySelector('.preview-notice').textContent=testMode?'Test byl uložen do samostatného testovacího listu. Bez platby, e-mailu a platné vstupenky.':'Vaše objednávka byla přijata. Další informace obdržíte e-mailem.';
      pendingTest=null;
      $('reservation-modal').showModal();$('ticket-form').reset();count=1;tables={};updateTickets();
    }catch(error){$('form-status').textContent='Chyba při rezervaci: '+error.message;}
    finally{submit.disabled=false;submit.textContent=testMode?'Uložit testovací rezervaci':'Dokončit rezervaci';}
  });
  $('buyer-name').addEventListener('input',()=>$('buyer-name').setCustomValidity(''));
  updateTickets();
})();

// Switch the fixed navigation to its compact glass appearance after the hero starts scrolling.
(function(){
 const header=document.querySelector('.site-header');
 let scheduled=false;
 const update=()=>{header.classList.toggle('is-scrolled',window.scrollY>64);scheduled=false;};
 window.addEventListener('scroll',()=>{if(!scheduled){scheduled=true;requestAnimationFrame(update);}},{passive:true});
 update();
})();
