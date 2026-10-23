const BACKEND = 'https://script.google.com/macros/s/AKfycbxeGpwuIH_j1BVdnh2Z7RcRzHhqV1uKxkEl7Qo1WZlK18Fid34421P8HFjbvzF0hBD9/exec';
const headers = {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Strict-Transport-Security':'max-age=31536000'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
const failure=(message,status)=>reply({status:'error',code:'ERROR',message},status);

// Only scanner operations are exposed. The backend still verifies PIN/session,
// gate state, payment and one-time use. Never log credentials or ticket codes.
export async function onRequest({request,env={}}) {
  if(request.method!=='POST')return failure('Použijte POST.',405);
  if(request.headers.get('Origin')!==new URL(request.url).origin)return failure('Nepovolený původ požadavku.',403);
  let data;
  try {
    const reader=request.body?.getReader();if(!reader)return failure('Chybí požadavek.',400);
    const chunks=[];let length=0;
    while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>4096){await reader.cancel();return failure('Požadavek je příliš velký.',413);}chunks.push(value);}
    const bytes=new Uint8Array(length);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.byteLength;}
    data=JSON.parse(new TextDecoder().decode(bytes));
  }catch(_){return failure('Neplatný požadavek.',400);}
  let payload;
  if(data?.action==='scannerLogin'&&typeof data.pin==='string'&&data.pin.length<=128)payload={action:'scannerLogin',pin:data.pin};
  else if(data?.action==='scan'&&typeof data.hash==='string'&&/^[a-z0-9-]{20,100}$/i.test(data.hash)&&typeof data.session==='string'&&data.session.length<=1000)payload={action:'scan',hash:data.hash,session:data.session};
  else return failure('Neplatná operace skeneru.',400);
  // During migration the deployed backend still accepts legacy login. The new
  // backend requires this proof and rejects unsigned direct login requests.
  if(payload.action==='scannerLogin'&&env.SCANNER_GATEWAY_SECRET){
    const secret=env.SCANNER_GATEWAY_SECRET,ip=request.headers.get('CF-Connecting-IP');
    if(secret.length<32||!ip)return failure('Přihlášení skeneru není správně nakonfigurováno.',503);
    const enc=new TextEncoder(),hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
    const key=await crypto.subtle.importKey('raw',enc.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
    const hmac=async value=>hex(await crypto.subtle.sign('HMAC',key,enc.encode(value)));
    const client=await hmac('scanner-client-v1\n'+ip),ts=Date.now(),nonce=crypto.randomUUID();
    const pinHash=hex(await crypto.subtle.digest('SHA-256',enc.encode(payload.pin)));
    const signature=await hmac(['scanner-login-v1',ts,nonce,client,pinHash].join('\n'));
    payload.gateway={ts,nonce,client,signature};
  }
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),23000);
  try {
    const response=await fetch(BACKEND,{method:'POST',redirect:'follow',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify(payload),signal:controller.signal});
    if(!response.ok)return failure('Backend není dostupný. Výsledek případné kontroly je nejasný.',502);
    let result;try{result=await response.json();}catch(_){return failure('Backend vrátil nečitelnou odpověď. Výsledek případné kontroly je nejasný.',502);}
    if(!result||!['success','error'].includes(result.status))return failure('Backend vrátil neplatnou odpověď.',502);
    return reply(result);
  }catch(_){return failure('Backend včas neodpověděl. Výsledek případné kontroly je nejasný.',504);}
  finally{clearTimeout(timer);}
}
