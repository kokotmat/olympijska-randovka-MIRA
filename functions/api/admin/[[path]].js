import {AdminError,json,errorResponse,permit} from '../../../lib/admin/access.js';
import {bridge,componentState} from '../../../lib/admin/bridge.js';
import {operations,deliverySettings} from '../../../lib/admin/operations.js';
import {providerQuota,pragueDay} from '../../../lib/admin/quota.js';
import {digest as sha256} from '../../../lib/admin/delivery.js';
const WRITES={reservations:new Set(['cancelOrder','retryMail','closeSales','closeGate']),sponsors:new Set(['pauseCampaign','updateSponsor','configureCampaign','resumeCampaign']),assistant:new Set(['pauseAi','resumeAi','retryJob'])};
const READS={reservations:new Set(['orders','order','history']),sponsors:new Set(['campaign','sponsors','sponsor','history']),assistant:new Set(['jobs','usage','history'])};
export async function onRequest({request,env,data}){
  try{
    const user=data.identity,url=new URL(request.url),path=url.pathname.replace(/^\/api\/admin\/?/,'').split('/').filter(Boolean);
    if(path[0]==='delivery'&&['settings','resolve'].includes(path[1])||path[0]==='web'&&['partners','draft','publish','withdraw','preview'].includes(path[1]))return await operations({request,env,data},path);
    if(request.method==='GET'&&path[0]==='session')return json({status:'success',data:{user,release:'central-admin-v1',components:{reservations:!!env.RESERVATIONS_ADMIN_URL,sponsors:!!env.SPONSORS_ADMIN_URL,assistant:!!env.ASSISTANT_ADMIN_URL}}});
    if(request.method==='GET'&&path[0]==='overview'){
      const components=await Promise.all(['reservations','sponsors','assistant'].map(name=>componentState(env,name,user.email)));
      return json({status:'success',data:{checkedAt:Date.now(),components}});
    }
    if(request.method==='GET'&&path[0]==='operations'){
      if(user.role!=='admin')throw new AdminError('FORBIDDEN',403);if(!env.ADMIN_DB)throw new AdminError('OPS_NOT_CONFIGURED',503);
      if(path[1]==='backup'){
        const row=await env.ADMIN_DB.prepare('SELECT * FROM ops_backups WHERE source=? AND day=?').bind(url.searchParams.get('source'),url.searchParams.get('day')).first();if(!row)throw new AdminError('NOT_FOUND',404);
        return new Response(Uint8Array.from(atob(row.payload),c=>c.charCodeAt(0)),{headers:{'Content-Type':'application/gzip','Content-Disposition':'attachment; filename="randovka-'+row.source+'-'+row.day+'.gz"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
      }
      const reports=await env.ADMIN_DB.prepare('SELECT * FROM ops_reports').all(),backups=await env.ADMIN_DB.prepare('SELECT source,day,created_at,sha256,format FROM ops_backups ORDER BY created_at DESC LIMIT 30').all();return json({status:'success',data:{reports:reports.results,backups:backups.results,checkedAt:Date.now()}});
    }
    if(request.method==='GET'&&path[0]==='delivery'&&path[1]==='messages'){
      if(!['admin','viewer','sponsors','reservations'].includes(user.role))throw new AdminError('FORBIDDEN',403);if(!env.ADMIN_DB)throw new AdminError('DELIVERY_NOT_CONFIGURED',503);
      const sources=['sponsors','reservations'].includes(user.role)?[user.role]:['sponsors','reservations'],clauses=['source IN ('+sources.map(()=>'?').join(',')+')'],args=[...sources];
      const state=url.searchParams.get('state')||'',source=url.searchParams.get('source')||'',q=(url.searchParams.get('q')||'').slice(0,120);
      if(state){if(!['queued','sending','uncertain','accepted','processed','delivered','bounced','rejected','suppressed','expired','cancelled'].includes(state))throw new AdminError('INVALID_FILTER');clauses.push('state=?');args.push(state);}
      if(source){if(!sources.includes(source))throw new AdminError('FORBIDDEN',403);clauses.push('source=?');args.push(source);}
      if(q){clauses.push("(recipient LIKE ? ESCAPE '\\' OR subject LIKE ? ESCAPE '\\' OR id=?)");const term='%'+q.replace(/[\\%_]/g,'\\$&')+'%';args.push(term,term,q);}
      const cursor=url.searchParams.get('cursor');if(cursor){try{if(cursor.length>300)throw Error();const [at,id]=JSON.parse(atob(cursor.replace(/-/g,'+').replace(/_/g,'/')));if(!Number.isSafeInteger(at)||!/^\w{64}$/.test(id))throw Error();clauses.push('(created_at<? OR (created_at=? AND id<?))');args.push(at,at,id);}catch{throw new AdminError('INVALID_CURSOR');}}
      const r=await env.ADMIN_DB.prepare('SELECT id,source,source_id,mode,kind,recipient,subject,state,created_at,accepted_at,delivered_at,error_code,provider_id,event_at FROM delivery_jobs WHERE '+clauses.join(' AND ')+' ORDER BY created_at DESC,id DESC LIMIT 51').bind(...args).all();const items=r.results.slice(0,50);for(const x of items)if(x.state==='uncertain')x.version=await sha256(JSON.stringify([x.id,x.state,x.provider_id,x.event_at]));
      const last=items.at(-1),nextCursor=r.results.length>50?btoa(JSON.stringify([last.created_at,last.id])).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''):null;return json({status:'success',data:{items,nextCursor,checkedAt:Date.now()}});
    }
    if(request.method==='GET'&&path[0]==='delivery'&&path[1]==='overview'){
      if(!env.ADMIN_DB)throw new AdminError('DELIVERY_NOT_CONFIGURED',503);
      const sources=user.role==='sponsors'?['sponsors']:user.role==='reservations'?['reservations']:['reservations','sponsors'];
      if(!['admin','sponsors','reservations','viewer'].includes(user.role))throw new AdminError('FORBIDDEN',403);
      try{
        const placeholders=sources.map(()=>'?').join(',');
        const states=await env.ADMIN_DB.prepare('SELECT state,COUNT(*) AS count,MIN(created_at) AS oldest FROM delivery_jobs WHERE source IN ('+placeholders+') GROUP BY state').bind(...sources).all();
        const items=await env.ADMIN_DB.prepare('SELECT id,source,source_id,mode,kind,recipient,subject,state,created_at,accepted_at,delivered_at,error_code FROM delivery_jobs WHERE source IN ('+placeholders+') ORDER BY created_at DESC LIMIT 50').bind(...sources).all();
        const lastAccepted=await env.ADMIN_DB.prepare('SELECT accepted_at,mode FROM delivery_jobs WHERE source IN ('+placeholders+') AND accepted_at IS NOT NULL ORDER BY accepted_at DESC LIMIT 1').bind(...sources).first();
        const lastWebhook=await env.ADMIN_DB.prepare('SELECT e.received_at,e.event,j.mode FROM delivery_events e JOIN delivery_jobs j ON j.id=e.job_id WHERE j.source IN ('+placeholders+') ORDER BY e.received_at DESC LIMIT 1').bind(...sources).first();
        const checkedAt=Date.now(),oldestQueuedAt=states.results.find(x=>x.state==='queued')?.oldest??null;
        const settings=await deliverySettings(env);for(const r of items.results)if(r.state==='uncertain'){const full=await env.ADMIN_DB.prepare('SELECT provider_id,event_at FROM delivery_jobs WHERE id=?').bind(r.id).first();r.version=await sha256(JSON.stringify([r.id,r.state,full.provider_id,full.event_at]));}
        let quota=null;try{quota=await providerQuota(env);}catch{}const attempts=await env.ADMIN_DB.prepare('SELECT COUNT(*) AS n FROM delivery_attempts WHERE started_at>=?').bind(pragueDay(checkedAt).start).first();
        return json({status:'success',data:{states:states.results,items:items.results,settings,quota,dailyAttempts:attempts.n,dailyRemaining:Math.max(0,settings.daily_budget-attempts.n),health:{lastAccepted,lastWebhook,oldestQueuedAt,queueAgeMs:oldestQueuedAt===null?null:Math.max(0,checkedAt-oldestQueuedAt)},sendingMode:settings.mode,providerKeyConfigured:!!env.SMTP2GO_API_KEY,webhookConfigured:!!env.SMTP2GO_WEBHOOK_SECRET,checkedAt,quotaNote:'Denní strop se obnovuje o české půlnoci a zahrnuje i nejisté pokusy. Měsíční kvóta se ověřuje u SMTP2GO; při neověřeném nebo vyčerpaném zůstatku se nové odeslání zablokuje.'}});
      }catch{throw new AdminError('DELIVERY_NOT_CONFIGURED',503);}
    }
    if(request.method==='GET'&&path[0]==='history'){
      permit(user,'history');if(!env.ADMIN_DB)throw new AdminError('AUDIT_STORE_NOT_CONFIGURED',503);
      const rows=await env.ADMIN_DB.prepare("SELECT id,actor,component,operation,state,created_at,finished_at FROM commands UNION ALL SELECT id,actor,CASE WHEN operation LIKE 'web/%' THEN 'sponsors' ELSE 'delivery' END,operation,'done',created_at,created_at FROM admin_actions ORDER BY created_at DESC LIMIT 100").all();
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
