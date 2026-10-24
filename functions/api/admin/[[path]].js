import {AdminError,json,errorResponse,permit} from '../../../lib/admin/access.js';
import {bridge,componentState} from '../../../lib/admin/bridge.js';
const WRITES={reservations:new Set(['cancelOrder','retryMail','closeSales','closeGate']),sponsors:new Set(['pauseCampaign','updateSponsor']),assistant:new Set(['pauseAi','resumeAi','retryJob'])};
const READS={reservations:new Set(['orders','order','history']),sponsors:new Set(['sponsors','sponsor','history']),assistant:new Set(['jobs','usage','history'])};
export async function onRequest({request,env,data}){
  try{
    const user=data.identity,url=new URL(request.url),path=url.pathname.replace(/^\/api\/admin\/?/,'').split('/').filter(Boolean);
    if(request.method==='GET'&&path[0]==='session')return json({status:'success',data:{user,release:'central-admin-v1',components:{reservations:!!env.RESERVATIONS_ADMIN_URL,sponsors:!!env.SPONSORS_ADMIN_URL,assistant:!!env.ASSISTANT_ADMIN_URL}}});
    if(request.method==='GET'&&path[0]==='overview'){
      const components=await Promise.all(['reservations','sponsors','assistant'].map(name=>componentState(env,name,user.email)));
      return json({status:'success',data:{checkedAt:Date.now(),components}});
    }
    if(request.method==='GET'&&path[0]==='history'){
      permit(user,'history');if(!env.ADMIN_DB)throw new AdminError('AUDIT_STORE_NOT_CONFIGURED',503);
      const rows=await env.ADMIN_DB.prepare('SELECT id,actor,component,operation,state,created_at,finished_at FROM commands ORDER BY created_at DESC LIMIT 100').all();
      return json({status:'success',data:{items:rows.results,checkedAt:Date.now()}});
    }
    if(request.method==='GET'&&path[0]==='commands'&&/^[a-f0-9-]{36}$/i.test(path[1]||'')){
      if(!env.ADMIN_DB)throw new AdminError('AUDIT_STORE_NOT_CONFIGURED',503);
      const row=await env.ADMIN_DB.prepare('SELECT * FROM commands WHERE id=?').bind(path[1]).first();
      if(!row)throw new AdminError('NOT_FOUND',404);
      permit(user,row.component==='assistant'?'sponsors':row.component);
      if(row.actor!==user.email&&user.role!=='admin')throw new AdminError('FORBIDDEN',403);
      if(['pending','uncertain'].includes(row.state)){
        // Read the original actor's durable receipt; never repeat the write to discover its result.
        const receipt=await bridge(env,row.component,'commandStatus',{id:row.id},row.actor);
        if(['done','rejected'].includes(receipt.state)&&receipt.result){
          await env.ADMIN_DB.prepare('UPDATE commands SET state=?,result=?,finished_at=? WHERE id=? AND state IN (?,?)').bind(receipt.state,JSON.stringify(receipt.result),Date.now(),row.id,'pending','uncertain').run();
          row.state=receipt.state;
        }
      }
      return json({status:'success',data:{id:row.id,state:row.state}});
    }
    if(request.method==='GET'&&path[0]==='web'&&path[1]==='catalog'){
      permit(user,'sponsors');
      const r=await fetch('https://api.github.com/repos/kokotmat/olympijska-randovka-MIRA/contents/sponsors.json?ref=main',{headers:{'Accept':'application/vnd.github+json','User-Agent':'Randovka-Admin'},signal:AbortSignal.timeout(7000),cf:{cacheTtl:60}});
      if(!r.ok)throw new AdminError('COMPONENT_UNAVAILABLE',503);const file=await r.json();let items;
      try{items=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(file.content.replace(/\s/g,'')),c=>c.charCodeAt(0))));}catch{throw new AdminError('INVALID_COMPONENT_RESPONSE',502);}
      if(!Array.isArray(items)||items.length>500||items.some(x=>typeof x.name!=='string'||!/^assets\/sponsors\/[a-z0-9_.-]+$/i.test(x.logo)||!/^https:\/\//.test(x.url)))throw new AdminError('INVALID_COMPONENT_RESPONSE',502);
      return json({status:'success',data:{items,version:file.sha,checkedAt:Date.now()}});
    }
    const [component,op]=path;
    if(!['reservations','sponsors','assistant'].includes(component))throw new AdminError('NOT_FOUND',404);
    permit(user,component==='assistant'?'sponsors':component,request.method==='POST');
    if(request.method==='GET'){
      if(!READS[component]?.has(op))throw new AdminError('NOT_FOUND',404);
      const args={q:(url.searchParams.get('q')||'').slice(0,120),cursor:(url.searchParams.get('cursor')||'').slice(0,100),id:(url.searchParams.get('id')||'').slice(0,100)};
      return json({status:'success',data:await bridge(env,component,op,args,user.email)});
    }
    if(request.method!=='POST'||!WRITES[component]?.has(op))throw new AdminError('NOT_FOUND',404);
    if(request.headers.get('Origin')!==url.origin||request.headers.get('X-Requested-By')!=='randovka-admin')throw new AdminError('INVALID_ORIGIN',403);
    if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new AdminError('INVALID_CONTENT_TYPE',415);
    const reader=request.body?.getReader();if(!reader)throw new AdminError('INVALID_JSON');const chunks=[];let size=0;
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>12000){await reader.cancel();throw new AdminError('REQUEST_TOO_LARGE',413);}chunks.push(value);}
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}const text=new TextDecoder().decode(bytes);
    let body;try{body=JSON.parse(text);}catch{throw new AdminError('INVALID_JSON');}
    if(!/^[a-f0-9-]{36}$/i.test(body.commandId||'')||typeof body.expectedVersion!=='string'||body.expectedVersion.length>100||!body.args||Array.isArray(body.args)||typeof body.args!=='object')throw new AdminError('INVALID_COMMAND');
    if(!env.ADMIN_DB)throw new AdminError('AUDIT_STORE_NOT_CONFIGURED',503);
    const payload=JSON.stringify({component,op,args:body.args,expectedVersion:body.expectedVersion}),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(payload))),x=>x.toString(16).padStart(2,'0')).join('');
    await env.ADMIN_DB.prepare('INSERT OR IGNORE INTO commands(id,actor,component,operation,fingerprint,state,created_at) VALUES(?,?,?,?,?,?,?)').bind(body.commandId,user.email,component,op,digest,'pending',Date.now()).run();
    const prior=await env.ADMIN_DB.prepare('SELECT actor,fingerprint,state,result FROM commands WHERE id=?').bind(body.commandId).first();
    if(prior){if(prior.actor!==user.email||prior.fingerprint!==digest)throw new AdminError('COMMAND_CONFLICT',409);if(prior.state==='done')return json(JSON.parse(prior.result));if(prior.state==='uncertain')throw new AdminError('COMMAND_UNCERTAIN',409);if(prior.state==='rejected'){const saved=JSON.parse(prior.result);throw new AdminError(saved.code||'REJECTED',409);}}
    try{
      const result={status:'success',data:await bridge(env,component,op,body.args,user.email,body.commandId,body.expectedVersion)};
      try{await env.ADMIN_DB.prepare('UPDATE commands SET state=?,result=?,finished_at=? WHERE id=?').bind('done',JSON.stringify(result),Date.now(),body.commandId).run();}
      catch{throw new AdminError('COMMAND_RESULT_UNKNOWN',504);}return json(result);
    }catch(error){
      const uncertain=['COMMAND_RESULT_UNKNOWN','COMMAND_UNCERTAIN'].includes(error.code);
      await env.ADMIN_DB.prepare('UPDATE commands SET state=?,result=?,finished_at=? WHERE id=?').bind(uncertain?'uncertain':'rejected',JSON.stringify({code:error.code||'INTERNAL_ERROR'}),Date.now(),body.commandId).run();throw error;
    }
  }catch(error){return errorResponse(error);}
}
