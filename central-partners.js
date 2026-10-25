/* Add explicitly approved central partners; the checked-in catalogue remains available offline. */
(async()=>{
 try{
  const r=await fetch('/api/partners',{cache:'no-store',signal:AbortSignal.timeout(5000)});if(!r.ok)return;
  const d=await r.json();if(!Array.isArray(d.items))return;
  const groups=[...document.querySelectorAll('.sponsor-group'),document.querySelector('.sponsor-directory')].filter(Boolean);
  for(const s of d.items){if(!/^central-[a-f0-9-]{36}$/i.test(s.key)||typeof s.name!=='string'||!s.logo?.startsWith('/api/partner-logo?id=')||!s.url?.startsWith('https://'))continue;
   for(const g of groups){if([...g.querySelectorAll('[data-sponsor]')].some(a=>a.dataset.sponsor===s.key||a.href===s.url))continue;
    const a=document.createElement('a'),img=document.createElement('img'),duplicate=g.getAttribute('aria-hidden')==='true';a.className='sponsor-logo-item';a.dataset.sponsor=s.key;a.href=s.url;a.target='_blank';a.rel='noopener noreferrer';if(duplicate)a.tabIndex=-1;else a.setAttribute('aria-label',s.name+' — web sponzora');img.src=s.logo;img.alt=duplicate?'':s.name;img.loading='lazy';img.decoding='async';a.append(img);g.append(a);
   }
  }
  const summary=document.querySelector('.all-sponsors summary'),directory=document.querySelector('.sponsor-directory');if(summary&&directory)summary.textContent='Všichni naši partneři ('+directory.children.length+')';
  window.dispatchEvent(new Event('resize'));
 }catch{/* Static sponsors remain visible if the central catalogue is unavailable. */}
})();
