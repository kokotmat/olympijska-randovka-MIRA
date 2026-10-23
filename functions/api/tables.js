const BACKEND='https://script.google.com/macros/s/AKfycbxeGpwuIH_j1BVdnh2Z7RcRzHhqV1uKxkEl7Qo1WZlK18Fid34421P8HFjbvzF0hBD9/exec';
const names=[...Array.from({length:70},(_,i)=>`Sál - Stůl ${i+1}`),...Array.from({length:20},(_,i)=>`Ochoz - Stůl ${i+1}`)];
const reply=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
// Read-only, fixed upstream. Never forwards client parameters, credentials or order data.
export async function onRequest({request,waitUntil}){
  if(request.method!=='GET')return reply({status:'error',message:'Použijte GET.'},405);
  const cache=globalThis.caches?.default,key=new Request(new URL('/api/tables',request.url));
  if(cache){try{const hit=await cache.match(key);if(hit)return reply(await hit.json());}catch(_){}}
  const success=data=>{
    if(cache){const save=cache.put(key,Response.json(data,{headers:{'Cache-Control':'public, max-age=15'}})).catch(()=>{});if(waitUntil)waitUntil(save);}
    return reply(data);
  };
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),18000);
  const read=async action=>{
    const r=await fetch(BACKEND+'?action='+action,{signal:controller.signal,redirect:'follow'});
    if(!r.ok)throw Error('UPSTREAM');return r.json();
  };
  try{
    const caps=await read('capabilities');
    if(caps.status!=='success'||!['test','live'].includes(caps.mode)||typeof caps.salesOpen!=='boolean')throw Error('FORMAT');
    if(caps.mode!=='live'||!caps.salesOpen)return success({status:'success',state:'closed',tables:null,checkedAt:Date.now()});
    const data=await read('getTables');
    if(!data||Object.keys(data).length!==names.length||names.some(name=>!Number.isInteger(data[name])||data[name]<0||data[name]>4))throw Error('FORMAT');
    const tables=Object.fromEntries(names.map(name=>[name,data[name]]));
    return success({status:'success',state:'open',tables,checkedAt:Date.now()});
  }catch(_){return reply({status:'error',message:'Dostupnost se nepodařilo ověřit. Zkuste obnovit přehled.'},503);}
  finally{clearTimeout(timer);}
}
