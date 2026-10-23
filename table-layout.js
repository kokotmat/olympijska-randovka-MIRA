// Table centres traced from the supplied Eurocentrum plans (1920 × 1310 / 1903 × 1280).
// These coordinates describe numbered tables, not individual assigned seats.
window.PLES_TABLE_LAYOUT=(()=>{
  const floor={},balcony={};
  const put=(set,n,x,y,w,h)=>set[n]={x:x/w*100,y:y/h*100};
  for(let i=0;i<7;i++){
    put(floor,2+i*2,1176-i*144,170,1920,1310);
    put(floor,1+i*2,1176-i*144,248,1920,1310);
    put(floor,45+i*2,1176-i*144,1165,1920,1310);
    put(floor,46+i*2,1176-i*144,1240,1920,1310);
  }
  for(let row=0;row<5;row++)for(let col=0;col<6;col++)put(floor,15+row*6+col,[748,671,594,450,381,304][col],408+row*148,1920,1310);
  for(let row=0;row<5;row++){
    put(floor,59+row*2,136,1068-row*147,1920,1310);
    put(floor,60+row*2,58,1068-row*147,1920,1310);
  }
  put(floor,69,92,248,1920,1310);put(floor,70,92,170,1920,1310);
  for(let i=1;i<=5;i++)put(balcony,i,1015-(i-1)*134,222,1903,1280);
  for(let row=0;row<5;row++){
    put(balcony,6+row*2,287,350+row*141,1903,1280);
    put(balcony,7+row*2,210,350+row*141,1903,1280);
    put(balcony,20-row,57,[384,633,777,919,1051][row],1903,1280);
  }
  return {floor,balcony};
})();

// A schematic projection of both levels, rotated so the stage is at the top.
// Each original table keeps its number and its neighbours within that level.
window.PLES_COMBINED_LAYOUT=(()=>{
  const output={};
  for(const [n,p] of Object.entries(window.PLES_TABLE_LAYOUT.floor)){
    const x=240+(p.y/100*1310-128)/1147*1120;
    const y=350+(1218-p.x/100*1920)/1168*1330;
    output['Sál - Stůl '+n]={x:x/1600*100,y:y/2100*100,floor:'floor',number:Number(n),label:'P'+n};
  }
  for(const n of Object.keys(window.PLES_TABLE_LAYOUT.balcony)){
    const number=Number(n);let x,y;
    if(number<=5){x=125;y=500+(number-1)*225;}
    else if(number<=15){x=330+Math.floor((number-6)/2)*200;y=number%2===0?1790:1880;}
    else{x=350+(20-number)*225;y=2000;}
    output['Ochoz - Stůl '+n]={x:x/1600*100,y:y/2100*100,floor:'balcony',number,label:'O'+n};
  }
  return output;
})();
