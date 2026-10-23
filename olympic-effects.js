/* Interactive Olympic track: drawn geometry, no generated photograph. */
(() => {
  'use strict';
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const canvas=document.createElement('canvas');
  canvas.className='olympic-background';
  canvas.setAttribute('aria-hidden','true');
  document.body.prepend(canvas);
  const ctx=canvas.getContext('2d');
  if(!ctx){canvas.remove();return;}
  const colors=['#0085c7','#f4c52b','#17191c','#00934e','#df263d'];
  const themes=['#f3f7fc','#e1f3fb','#fff1d9','#e6f4e8','#edf3fb','#fff0f3'];
  const accents=['#096bab','#0a739e','#805a12','#087046','#235d8a','#b92142'];
  const worldIds=['domu','program','sponzori','maturanti','vstupenky','ke-stazeni'];
  const worlds=themes.map((color,index)=>({weight:index===0?1:0,zoom:1,turn:0}));
  let width=0,height=0,ratio=1,frame=0,last=0,x=0,y=0,targetX=0,targetY=0,scroll=window.scrollY,ripples=[];
  let visible=!document.hidden;
  const root=document.documentElement;
  function line(points,color,widthLine=3){ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=widthLine;points.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));ctx.stroke();}
  function ellipse(cx,cy,rx,ry,color,lineWidth=3){ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=lineWidth;ctx.ellipse(cx,cy,rx,ry,0,0,Math.PI*2);ctx.stroke();}
  function stadium(){
    for(let i=0;i<5;i++){ellipse(1040,490,720+i*28,390+i*28,colors[i],10);}
    for(let i=0;i<5;i++)line([[130+i*27,840],[650+i*27,680]],colors[i],6);
    ctx.strokeStyle='#17191c';ctx.lineWidth=2;ctx.strokeRect(115,806,185,52);
  }
  function swimming(time){
    ctx.fillStyle='#9cd8ee';ctx.fillRect(70,100,1510,700);
    for(let i=0;i<8;i++){
      const lane=130+i*185;ctx.setLineDash([12,12]);line([[lane,100],[lane,800]],i%2?'#0085c7':'#ffffff',8);ctx.setLineDash([]);
      line([[lane+87,140],[lane+87,690]],'#0085c7',4);line([[lane+52,690],[lane+122,690]],'#0085c7',4);
    }
    for(let i=0;i<8;i++){
      const offset=Math.sin(time*.0004+i)*14;
      ctx.beginPath();ctx.strokeStyle='#ffffff';ctx.lineWidth=3;
      ctx.moveTo(-100,170+i*90);ctx.bezierCurveTo(360,130+i*90+offset,880,220+i*90-offset,1700,150+i*90);ctx.stroke();
    }
  }
  function volleyball(){
    ctx.fillStyle='#f1c970';ctx.fillRect(40,80,1520,740);
    ctx.strokeStyle='#805a12';ctx.lineWidth=5;ctx.strokeRect(95,120,1410,660);
    line([[565,120],[565,780]],'#ffffff',6);line([[1035,120],[1035,780]],'#ffffff',6);
    line([[800,100],[800,800]],'#17191c',8);
    line([[782,100],[782,800]],'#17191c',2);line([[818,100],[818,800]],'#17191c',2);
    for(let y=100;y<=800;y+=28)line([[782,y],[818,y]],'#17191c',2);
    ellipse(800,95,13,13,'#df263d',5);ellipse(800,805,13,13,'#0085c7',5);
  }
  function football(){
    for(let stripe=0;stripe<10;stripe++){ctx.fillStyle=stripe%2?'#70b987':'#8ac79a';ctx.fillRect(300+stripe*100,125,100,650);}
    ctx.strokeStyle='#ffffff';ctx.lineWidth=6;ctx.strokeRect(300,125,1000,650);
    line([[800,125],[800,775]],'#ffffff',6);ellipse(800,450,92,92,'#ffffff',5);
    ellipse(800,450,5,5,'#ffffff',6);
    ctx.strokeRect(300,295,165,310);ctx.strokeRect(1135,295,165,310);
    ctx.strokeRect(300,360,55,180);ctx.strokeRect(1245,360,55,180);
    ctx.strokeRect(270,395,30,110);ctx.strokeRect(1300,395,30,110);
    ellipse(410,450,4,4,'#ffffff',5);ellipse(1190,450,4,4,'#ffffff',5);
    ctx.beginPath();ctx.arc(410,450,92,-Math.PI/3,Math.PI/3);ctx.stroke();
    ctx.beginPath();ctx.arc(1190,450,92,Math.PI*2/3,Math.PI*4/3);ctx.stroke();
  }
  function winter(){
    ctx.fillStyle='#9ac5d3';ctx.beginPath();ctx.moveTo(-100,830);ctx.lineTo(430,180);ctx.lineTo(850,670);ctx.lineTo(1190,110);ctx.lineTo(1700,830);ctx.closePath();ctx.fill();
    ctx.fillStyle='#ffffff';ctx.beginPath();ctx.moveTo(270,385);ctx.lineTo(430,180);ctx.lineTo(635,420);ctx.lineTo(468,350);ctx.lineTo(393,400);ctx.closePath();ctx.fill();
    ctx.beginPath();ctx.moveTo(1020,335);ctx.lineTo(1190,110);ctx.lineTo(1388,382);ctx.lineTo(1200,285);ctx.closePath();ctx.fill();
    for(let i=0;i<6;i++){
      const px=240+i*215,py=600+Math.sin(i)*95;
      line([[px,py],[px,py+115]],'#17191c',4);ctx.fillStyle=i%2?'#df263d':'#0085c7';ctx.fillRect(px,py,62,37);
    }
    line([[200,880],[540,560],[940,760],[1350,470]],'#00934e',5);
  }
  function celebration(){
    const rings=[[460,340,0],[640,500,1],[820,340,2],[1000,500,3],[1180,340,4]];
    rings.forEach(([cx,cy,color])=>ellipse(cx,cy,180,180,colors[color],16));
    for(let i=0;i<5;i++)line([[200+i*300,900],[260+i*300,780]],colors[i],10);
  }
  function resize(){width=window.innerWidth;height=window.innerHeight;ratio=Math.min(window.devicePixelRatio||1,width<700?1.25:1.6);canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);canvas.style.width=width+'px';canvas.style.height=height+'px';draw(0);}
  function draw(time){
    ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);
    x+=(targetX-x)*.06;y+=(targetY-y)*.06;
    const total=Math.max(1,worlds.reduce((sum,world)=>sum+world.weight,0));
    worlds.forEach((world,index)=>{
      if(world.weight<.005)return;
      ctx.save();ctx.translate(width/2+x,height/2+y);ctx.scale(world.zoom,world.zoom);ctx.rotate(world.turn);ctx.translate(-width/2,-height/2);
      // Cover the viewport, including tall phones, without affecting content layout.
      const fit=Math.max(width/1600,height/900);ctx.translate((width-1600*fit)/2,(height-900*fit)/2);ctx.scale(fit,fit);
      ctx.globalAlpha=world.weight/total*(index===0?.22:index===3||index===4?.23:.17);
      [stadium,swimming,volleyball,football,winter,celebration][index](reduced.matches?0:time);
      ctx.restore();
    });
    if(!reduced.matches){ripples=ripples.filter(r=>time-r.start<800);ripples.forEach(r=>{const p=Math.max(0,(time-r.start)/800);colors.forEach((color,i)=>{ctx.beginPath();ctx.strokeStyle=color;ctx.lineWidth=2;ctx.globalAlpha=(1-p)*.16;ctx.arc(r.x,r.y,12+p*100+i*8,0,Math.PI*2);ctx.stroke();});});}
    ctx.globalAlpha=1;
  }
  let previousFrame='';
  function tick(time){frame=0;if(!visible||reduced.matches)return;if(time-last>32){const signature=[width,height,targetX.toFixed(1),targetY.toFixed(1),x.toFixed(1),y.toFixed(1),...worlds.flatMap(w=>[w.weight.toFixed(3),w.zoom.toFixed(3),w.turn.toFixed(3)])].join('|');if(signature!==previousFrame||worlds[1].weight>.01||ripples.length){draw(time);previousFrame=signature;}last=time;}frame=requestAnimationFrame(tick);}
  function start(){if(!frame&&visible&&!reduced.matches)frame=requestAnimationFrame(tick);}
  function stop(){if(frame)cancelAnimationFrame(frame);frame=0;}
  function staticWorld(){let index=0;worldIds.forEach((id,i)=>{const element=document.getElementById(id);if(element&&element.getBoundingClientRect().top<height*.55)index=i;});worlds.forEach((world,i)=>{world.weight=i===index?1:0;world.zoom=1;world.turn=0;});root.style.setProperty('--paper',themes[index]);root.style.setProperty('--blue',accents[index]);draw(0);}
  function point(e){if(reduced.matches)return;targetX=(e.clientX/width-.5)*36;targetY=(e.clientY/height-.5)*28;}
  window.addEventListener('pointermove',point,{passive:true});
  window.addEventListener('pointerdown',e=>{if(reduced.matches)return;point(e);ripples.push({x:e.clientX,y:e.clientY,start:performance.now()});if(ripples.length>4)ripples.shift();},{passive:true});
  window.addEventListener('pointercancel',()=>{targetX=targetY=0;},{passive:true});
  window.addEventListener('pointerout',e=>{if(!e.relatedTarget)targetX=targetY=0;},{passive:true});
  window.addEventListener('scroll',()=>{scroll=window.scrollY;if(reduced.matches||!window.gsap)staticWorld();},{passive:true});
  window.addEventListener('resize',resize,{passive:true});
  document.addEventListener('visibilitychange',()=>{visible=!document.hidden;if(visible)start();else stop();});
  reduced.addEventListener('change',()=>{stop();targetX=targetY=x=y=0;ripples=[];if(reduced.matches)staticWorld();start();});
  resize();root.style.setProperty('--paper',themes[0]);if(reduced.matches||!window.gsap)staticWorld();start();
  if(window.gsap&&window.ScrollTrigger){
    window.gsap.registerPlugin(window.ScrollTrigger);
    const worldMedia=window.gsap.matchMedia();
    worldMedia.add('(prefers-reduced-motion: no-preference)',()=>{
      worldIds.slice(1).forEach((id,offset)=>{
        const index=offset+1,previous=worlds[index-1],next=worlds[index];
        const timeline=window.gsap.timeline({scrollTrigger:{trigger:'#'+id,start:'top 92%',end:'top 22%',scrub:1,invalidateOnRefresh:true}});
        timeline.fromTo(previous,{weight:1,zoom:1,turn:0},{weight:0,zoom:2.3,turn:-.07,ease:'power2.in',immediateRender:false},0)
          .fromTo(next,{weight:0,zoom:.55,turn:.07},{weight:1,zoom:1,turn:0,ease:'power2.out',immediateRender:false},0)
          .fromTo(root,{'--paper':themes[index-1],'--blue':accents[index-1]},{'--paper':themes[index],'--blue':accents[index],ease:'none',immediateRender:false},0);
      });
      window.gsap.utils.toArray('.hero-copy,.countdown-row,.sponsor-row,.teacher-card,.reservation,.venue,.stage-link').forEach((panel,index)=>{
        window.gsap.to(panel,{'--floating-y':(index%2?-1:1)*(width<650?3.5:6)+'px',duration:3.2+(index%4)*.4,repeat:-1,yoyo:true,ease:'sine.inOut',scrollTrigger:{trigger:panel,start:'top bottom',end:'bottom top',toggleActions:'play pause resume pause'}});
      });
      document.fonts.ready.then(()=>window.ScrollTrigger.refresh());
      return()=>{worlds.forEach((world,index)=>{world.weight=index===0?1:0;world.zoom=1;world.turn=0;});if(reduced.matches)staticWorld();};
    });
  }
  if(!window.gsap)return;
  const gsap=window.gsap,media=gsap.matchMedia();
  media.add('(prefers-reduced-motion: no-preference)',()=>{
    let intro;
    if(window.scrollY<100&&!window.location.hash){
      intro=document.createElement('div');intro.className='olympic-intro';intro.setAttribute('aria-hidden','true');
      intro.innerHTML='<svg viewBox="0 0 660 420" aria-hidden="true"><circle cx="115" cy="160" r="105" stroke="#0085c7"/><circle cx="225" cy="270" r="105" stroke="#f4c52b"/><circle cx="335" cy="160" r="105" stroke="#17191c"/><circle cx="445" cy="270" r="105" stroke="#00934e"/><circle cx="555" cy="160" r="105" stroke="#df263d"/></svg>';
      document.body.append(intro);
      const circles=intro.querySelectorAll('circle');
      circles.forEach(circle=>{circle.style.strokeDasharray='660';circle.style.strokeDashoffset='660';});
      gsap.timeline({onComplete:()=>intro.remove()})
        .fromTo(circles,{rotation:-80,scale:.5,transformOrigin:'50% 50%'},{strokeDashoffset:0,rotation:0,scale:1,duration:.65,stagger:.09,ease:'power3.out'})
        .to(intro.querySelector('svg'),{scale:1.5,duration:.5,ease:'power3.in'},'+=.08')
        .to(intro,{opacity:0,duration:.4},'<')
        .fromTo('.hero-copy',{y:24,scale:.97},{y:0,scale:1,duration:.65,clearProps:'transform'},'-=.2');
    }
    gsap.from('.countdown-heading img',{rotation:-20,scale:.7,duration:1,ease:'elastic.out(1,.65)',scrollTrigger:{trigger:'.countdown-row',start:'top 92%',once:true}});
    return()=>{if(intro)intro.remove();};
  });
  media.add('(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',()=>{
    const photo=document.querySelector('.class-photo');
    const image=photo.querySelector('img');image.classList.add('photo-interactive');
    const tilt=e=>{const r=photo.getBoundingClientRect();gsap.to(image,{rotationY:(e.clientX-r.left-r.width/2)/r.width*10,rotationX:-(e.clientY-r.top-r.height/2)/r.height*8,scale:1.07,transformPerspective:900,duration:.5,ease:'power2.out',overwrite:'auto'});};
    const untilt=()=>gsap.to(image,{rotationX:0,rotationY:0,scale:1,duration:.6,clearProps:'transform'});
    photo.addEventListener('pointermove',tilt);photo.addEventListener('pointerleave',untilt);
    const listeners=[];
    document.querySelectorAll('.hero-actions .button,.instagram-link').forEach(button=>{
      const move=e=>{const r=button.getBoundingClientRect();gsap.to(button,{x:(e.clientX-r.left-r.width/2)*.12,y:(e.clientY-r.top-r.height/2)*.18,duration:.35,overwrite:'auto'});};
      const leave=()=>gsap.to(button,{x:0,y:0,duration:.6,ease:'elastic.out(1,.6)',clearProps:'transform'});
      button.addEventListener('pointermove',move);button.addEventListener('pointerleave',leave);listeners.push([button,move,leave]);
    });
    return()=>{photo.removeEventListener('pointermove',tilt);photo.removeEventListener('pointerleave',untilt);image.classList.remove('photo-interactive');listeners.forEach(([el,move,leave])=>{el.removeEventListener('pointermove',move);el.removeEventListener('pointerleave',leave);});};
  });
})();
