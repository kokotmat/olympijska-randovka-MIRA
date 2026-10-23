(() => {
  'use strict';
  if (!window.gsap || !window.ScrollTrigger) return;
  const {gsap, ScrollTrigger}=window;
  gsap.registerPlugin(ScrollTrigger);
  const motion=gsap.matchMedia();
  motion.add('(prefers-reduced-motion: no-preference)', () => {
    const desktop=()=>window.matchMedia('(min-width: 901px)').matches;
    if(window.scrollY < 100) {
      gsap.from('.title-block > span > span',{y:42,rotation:2,opacity:0,duration:.9,stagger:.12,ease:'power3.out',clearProps:'transform,opacity'});
      gsap.from('.hero-details,.hero-actions',{y:20,opacity:0,duration:.7,stagger:.1,delay:.35,clearProps:'transform,opacity'});
      gsap.from('.photo-entrance',{rotation:-7,scale:.92,duration:1.1,ease:'power3.out',clearProps:'transform'});
    }
    gsap.to('.class-photo',{y:()=>desktop()?-45:-20,rotation:()=>desktop()?5:2.5,ease:'none',scrollTrigger:{trigger:'.hero-layout',start:'top top',end:'bottom top',scrub:1,invalidateOnRefresh:true}});
    gsap.to('.title-block > span:nth-child(2)',{x:()=>desktop()?-44:-16,ease:'none',scrollTrigger:{trigger:'.hero-layout',start:'top top',end:'bottom top',scrub:.8,invalidateOnRefresh:true}});
    gsap.to('.title-block > span:nth-child(3)',{x:()=>desktop()?44:16,ease:'none',scrollTrigger:{trigger:'.hero-layout',start:'top top',end:'bottom top',scrub:.8,invalidateOnRefresh:true}});
    gsap.from('#countdown > span',{scale:.7,y:24,opacity:0,stagger:.1,duration:.8,ease:'back.out(1.4)',clearProps:'transform,opacity',scrollTrigger:{trigger:'.countdown-row',start:'top 90%',once:true}});
    let teamContext;
    let focusHandlers=[];
    const animateTeam=()=>{
      focusHandlers.forEach(([card,handler])=>card.removeEventListener('focusin',handler));
      focusHandlers=[];
      if(teamContext)teamContext.revert();
      teamContext=gsap.context(()=>{
        gsap.utils.toArray('.student-card,.teacher-card').forEach((card,index)=>{
          const isStudent=card.classList.contains('student-card');
          const reveal=gsap.timeline({scrollTrigger:{trigger:card,start:'top 94%',once:true}});
          reveal.from(card,{y:window.innerWidth<650?28:42,scale:.985,opacity:0,duration:.85,delay:(index%5)*.045,ease:'power2.out',clearProps:'transform,opacity'});
          const image=card.querySelector('.portrait img');
          if(isStudent&&image)reveal.from(image,{scale:1.12,duration:1.1,ease:'power2.out',clearProps:'transform'},0);
          const focus=()=>reveal.progress(1);
          card.addEventListener('focusin',focus);focusHandlers.push([card,focus]);
        });
      },document.getElementById('maturanti'));
      ScrollTrigger.refresh();
    };
    animateTeam();
    document.addEventListener('ples:team-rendered',animateTeam);
    gsap.utils.toArray('.instagram-link,.reservation,.venue,.stage-link').forEach(element=>{
      gsap.from(element,{y:38,scale:.97,opacity:0,duration:.8,ease:'power3.out',clearProps:'transform,opacity',scrollTrigger:{trigger:element,start:'top 93%',once:true}});
    });
    document.fonts.ready.then(()=>ScrollTrigger.refresh());
    window.addEventListener('load',ScrollTrigger.refresh,{once:true});
    return ()=>{
      document.removeEventListener('ples:team-rendered',animateTeam);
      window.removeEventListener('load',ScrollTrigger.refresh);
      if(teamContext)teamContext.revert();
      focusHandlers.forEach(([card,handler])=>card.removeEventListener('focusin',handler));
      focusHandlers=[];
    };
  });
  motion.add('(min-width: 901px) and (min-height: 550px) and (prefers-reduced-motion: no-preference)',()=>{
    const section=document.getElementById('program');
    section.classList.add('is-horizontal');
    const track=section.querySelector('.schedule');
    const viewport=section.querySelector('.schedule-window');
    const distance=()=>Math.max(0,track.scrollWidth-viewport.clientWidth);
    const keyboard=event=>{if(!['ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();window.scrollBy({top:event.key==='ArrowRight'?240:-240,behavior:'smooth'});};
    viewport.addEventListener('keydown',keyboard);
    gsap.to(track,{x:()=>-distance(),ease:'none',scrollTrigger:{trigger:section,start:'top 104px',end:()=>'+='+Math.max(500,distance()),pin:true,scrub:1,invalidateOnRefresh:true,anticipatePin:1}});
    return ()=>{viewport.removeEventListener('keydown',keyboard);section.classList.remove('is-horizontal');gsap.set(track,{clearProps:'transform'});};
  });
})();
