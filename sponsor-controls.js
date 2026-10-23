/* Sponsors: native touch scrolling, mouse dragging and an automatic loop. */
(() => {
  'use strict';
  const viewport=document.getElementById('sponsor-logos');
  const row=viewport&&viewport.closest('.sponsor-row');
  const track=viewport&&viewport.querySelector('.sponsor-track');
  if(!viewport||!row||!track)return;
  const groups=track.querySelectorAll('.sponsor-group');
  if(groups.length<2)return;
  // A third identical group provides room to drag backwards through the loop.
  if(groups.length===2)track.append(groups[1].cloneNode(true));
  viewport.classList.add('sponsor-scroll');
  viewport.tabIndex=0;viewport.setAttribute('role','region');
  viewport.setAttribute('aria-label','Sponzoři. Posunujte tažením, prstem nebo šipkami.');
  const controls=document.createElement('div');controls.className='carousel-controls';
  controls.innerHTML='<button type="button" aria-label="Předchozí sponzoři"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg></button><button type="button" aria-label="Další sponzoři"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6"/></svg></button>';
  row.append(controls);
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  let cycle=0,drag=null,hover=false,touching=false,waitUntil=0,suppressUntil=0,position=0,lastTime=0,frame=0,inView=false;
  const now=()=>performance.now();
  const pauseInteraction=()=>{waitUntil=now()+2000;};
  function normalize(){if(!cycle)return;let value=viewport.scrollLeft;while(value<cycle*.5)value+=cycle;while(value>=cycle*1.5)value-=cycle;viewport.scrollLeft=value;position=value;}
  function measure(){const previous=cycle;cycle=track.querySelector('.sponsor-group').getBoundingClientRect().width;if(!cycle)return;viewport.scrollLeft=previous?viewport.scrollLeft/previous*cycle:cycle;normalize();}
  function finish(event){
    if(!drag||event.pointerId!==drag.id)return;
    const ending=drag;drag=null;viewport.classList.remove('is-dragging');
    if(ending.moved)suppressUntil=now()+500;
    if(viewport.hasPointerCapture(ending.id))viewport.releasePointerCapture(ending.id);
    pauseInteraction();normalize();
  }
  viewport.addEventListener('pointerdown',event=>{
    pauseInteraction();
    if(event.pointerType==='touch'){touching=true;return;}
    if(event.button!==0)return;
    drag={id:event.pointerId,x:event.clientX,start:viewport.scrollLeft,moved:false};
  });
  viewport.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    const dx=event.clientX-drag.x;
    if(!drag.moved&&Math.abs(dx)<6)return;
    if(!drag.moved){drag.moved=true;viewport.setPointerCapture(event.pointerId);viewport.classList.add('is-dragging');}
    event.preventDefault();viewport.scrollLeft=drag.start-dx;position=viewport.scrollLeft;
  });
  ['pointerup','pointercancel'].forEach(type=>window.addEventListener(type,event=>{touching=false;finish(event);pauseInteraction();},{passive:true}));
  viewport.addEventListener('lostpointercapture',finish);
  viewport.addEventListener('click',event=>{if(now()<suppressUntil){event.preventDefault();event.stopPropagation();}},true);
  viewport.addEventListener('dragstart',event=>event.preventDefault());
  viewport.addEventListener('pointerenter',event=>{if(event.pointerType!=='touch')hover=true;});
  viewport.addEventListener('pointerleave',()=>{hover=false;});
  viewport.addEventListener('wheel',pauseInteraction,{passive:true});
  viewport.addEventListener('keydown',event=>{
    if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
    event.preventDefault();pauseInteraction();normalize();
    viewport.scrollLeft+=(event.key==='ArrowRight'?1:-1)*200;position=viewport.scrollLeft;
  });
  controls.querySelectorAll('button').forEach((button,index)=>button.addEventListener('click',()=>{
    pauseInteraction();normalize();viewport.scrollLeft+=(index?1:-1)*200;position=viewport.scrollLeft;
  }));
  function tick(time){
    frame=0;
    const dt=Math.min((time-lastTime)/1000,.05);lastTime=time;
    const paused=reduced.matches||row.classList.contains('paused')||hover||touching||drag||row.matches(':focus-within')||time<waitUntil;
    if(!paused&&cycle){if(position<cycle*.5||position>=cycle*1.5)normalize();position+=dt*22;viewport.scrollLeft=position;}else position=viewport.scrollLeft;
    if(!document.hidden&&!reduced.matches&&inView)frame=requestAnimationFrame(tick);
  }
  function start(){if(!frame&&!document.hidden&&!reduced.matches&&inView){lastTime=now();frame=requestAnimationFrame(tick);}}
  reduced.addEventListener('change',()=>{if(frame)cancelAnimationFrame(frame);frame=0;position=viewport.scrollLeft;start();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){if(frame)cancelAnimationFrame(frame);frame=0;}else start();});
  window.addEventListener('resize',measure,{passive:true});
  if(window.ResizeObserver){const observer=new ResizeObserver(measure);observer.observe(viewport);}
  document.fonts.ready.then(measure);
  if(window.IntersectionObserver){new IntersectionObserver(entries=>{inView=entries[0].isIntersecting;if(!inView){cancelAnimationFrame(frame);frame=0;}else start();},{rootMargin:'100px'}).observe(viewport);}else inView=true;
  measure();start();
})();
