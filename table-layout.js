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
