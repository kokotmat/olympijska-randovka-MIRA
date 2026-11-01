import {AdminError,json,privateHeaders} from './access.js';
import {bridge} from './bridge.js';
const actors=new Set(['vasik.resl@gmail.com','miramus111@gmail.com']);
const account='maturitni.ples@olympijskarandovka.cz';
export async function mailbox(request,env,user,op){
 if(user.role!=='admin'||!actors.has(user.email))throw new AdminError('FORBIDDEN',403);
 if(request.method!=='GET'||!['list','thread','attachment'].includes(op))throw new AdminError('NOT_FOUND',404);
 const p=new URL(request.url).searchParams;
 const args={q:p.get('q')||'',folder:p.get('folder')||'inbox',cursor:p.get('cursor')||'0',id:p.get('id')||''};
 if(args.q.length>200||!/^\d{1,6}$/.test(args.cursor)||args.id.length>32)throw new AdminError('INVALID_FILTER');
 if(op==='attachment'){const n=p.get('index');if(n===null||!/^\d{1,3}$/.test(n))throw new AdminError('INVALID_FILTER');args.index=Number(n);}
 const d=await bridge(env,'sponsors',{list:'mailList',thread:'mailThread',attachment:'mailAttachment'}[op],args,user.email);
 if(d.account!==account)throw new AdminError('MAILBOX_ACCOUNT_MISMATCH',503);
 if(op!=='attachment')return json({status:'success',data:d});
 if(typeof d.base64!=='string'||d.base64.length>2700000)throw new AdminError('INVALID_COMPONENT_RESPONSE',502);
 const bytes=Uint8Array.from(atob(d.base64),c=>c.charCodeAt(0));
 const name=String(d.name||'priloha').replace(/[\x00-\x1f\x7f/\\]/g,'_').slice(0,180);
 return new Response(bytes,{headers:{...privateHeaders,'Content-Type':'application/octet-stream','Content-Disposition':"attachment; filename=attachment; filename*=UTF-8''"+encodeURIComponent(name).replace(/'/g,'%27')}});
}
