import {AdminError,permit,json} from './access.js';
import {digest,deliverySettings} from './delivery.js';
export {deliverySettings} from './delivery.js';
import {bridge} from './bridge.js';
export function validateSettings(a){
 if(!['disabled','test','live'].includes(a.mode)||!Number.isInteger(a.dailyBudget)||a.dailyBudget<1||a.dailyBudget>200)throw new AdminError('INVALID_POLICY');
 if(a.mode==='live'&&a.confirmation!=='POVOLIT ODESÍLÁNÍ')throw new AdminError('CONFIRMATION_REQUIRED',409);
}
export function validatePartner(a){
 if(typeof a.sponsorId!=='string'||!a.sponsorId.trim()||a.sponsorId.length>100||typeof a.name!=='string'||!a.name.trim()||a.name.length>120)throw new AdminError('INVALID_PARTNER');
 let u;try{u=new URL(a.url);}catch{throw new AdminError('INVALID_PARTNER');}
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.href.length>500||/^(localhost|.*\.local|[\d.]+|\[.*\])$/i.test(u.hostname))throw new AdminError('INVALID_PARTNER');
 if(typeof a.image!=='string'||a.image.length>400000||!a.image.length||a.image.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(a.image))throw new AdminError('INVALID_IMAGE');
 const bytes=Uint8Array.from(atob(a.image),c=>c.charCodeAt(0));let mime;
 if(bytes.length>300000||bytes.length<32)throw new AdminError('INVALID_IMAGE');
 if([137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))mime='image/png';
 else if(bytes[0]===255&&bytes[1]===216&&bytes[2]===255)mime='image/jpeg';
 else if(String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP')mime='image/webp';
 else throw new AdminError('INVALID_IMAGE');
 return {name:a.name.trim(),url:u.href,mime};
}
export async function operations({request,env,data},path){
 const [area,op]=path,user=data.identity,db=env.ADMIN_DB;if(!db)throw new AdminError('AUDIT_STORE_NOT_CONFIGURED',503);
 permit(user,area==='web'?'sponsors':'history',request.method==='POST');
 if(area==='delivery'&&user.role!=='admin')throw new AdminError('FORBIDDEN',403);
 if(request.method==='GET'){
  if(area==='delivery'&&op==='settings')return json({status:'success',data:await deliverySettings(env)});
  if(area==='web'&&op==='partners'){const rows=await db.prepare('SELECT id,sponsor_id,name,url,state,revision,updated_at FROM web_partners ORDER BY updated_at DESC LIMIT 200').all();return json({status:'success',data:{items:rows.results}});}
  if(area==='web'&&op==='preview'){const r=await db.prepare('SELECT mime,image FROM web_partners WHERE id=?').bind(new URL(request.url).searchParams.get('id')).first();if(!r)throw new AdminError('NOT_FOUND',404);return new Response(Uint8Array.from(atob(r.image),c=>c.charCodeAt(0)),{headers:{'Content-Type':r.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
  throw new AdminError('NOT_FOUND',404);
 }
 if(request.method!=='POST'||!['settings','resolve','draft','publish','withdraw'].includes(op))throw new AdminError('NOT_FOUND',404);
 const url=new URL(request.url);
 if(request.headers.get('Origin')!==url.origin||request.headers.get('X-Requested-By')!=='randovka-admin')throw new AdminError('INVALID_ORIGIN',403);
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new AdminError('INVALID_CONTENT_TYPE',415);
 const reader=request.body?.getReader();if(!reader)throw new AdminError('INVALID_JSON');let size=0,parts=[];
 while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;if(size>410000){await reader.cancel();throw new AdminError('REQUEST_TOO_LARGE',413);}parts.push(r.value);}
 let body;try{const bytes=new Uint8Array(size);let i=0;for(const p of parts){bytes.set(p,i);i+=p.length;}body=JSON.parse(new TextDecoder().decode(bytes));}catch{throw new AdminError('INVALID_JSON');}
 if(!/^[a-f0-9-]{36}$/i.test(body.commandId||'')||!body.args||typeof body.args!=='object'||Array.isArray(body.args)||typeof body.expectedVersion!=='string')throw new AdminError('INVALID_COMMAND');
 const a=body.args,fingerprint=await digest(JSON.stringify([area,op,a,body.expectedVersion])),prior=await db.prepare('SELECT * FROM admin_actions WHERE id=?').bind(body.commandId).first();
 if(prior){if(prior.actor!==user.email||prior.fingerprint!==fingerprint)throw new AdminError('COMMAND_CONFLICT',409);return json(JSON.parse(prior.result));}
 const now=Date.now(),statements=[];let result,guard='1',guardArgs=[];
 if(area==='delivery'&&op==='settings'){
  validateSettings(a);if(a.mode!=='disabled'&&(!env.SMTP2GO_API_KEY||!env.SMTP2GO_WEBHOOK_SECRET))throw new AdminError('DELIVERY_NOT_CONFIGURED',503);
  const current=await deliverySettings(env);if(String(current.revision)!==body.expectedVersion)throw new AdminError('CONFLICT',409);
  guard='COALESCE((SELECT revision FROM delivery_settings WHERE id=1),0)=?';guardArgs=[current.revision];
  statements.push(db.prepare('INSERT INTO delivery_settings VALUES(1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET mode=excluded.mode,daily_budget=excluded.daily_budget,revision=excluded.revision,updated_at=excluded.updated_at,actor=excluded.actor WHERE delivery_settings.revision=?').bind(a.mode,a.dailyBudget,current.revision+1,now,user.email,current.revision));
  result={mode:a.mode,daily_budget:a.dailyBudget,revision:current.revision+1};
 }else if(area==='delivery'&&op==='resolve'){
  const job=await db.prepare('SELECT * FROM delivery_jobs WHERE id=?').bind(a.id).first();if(!job)throw new AdminError('NOT_FOUND',404);
  if(job.state!=='uncertain'||await digest(JSON.stringify([job.id,job.state,job.provider_id,job.event_at]))!==body.expectedVersion)throw new AdminError('CONFLICT',409);
  guard="EXISTS(SELECT 1 FROM delivery_jobs WHERE id=? AND state='uncertain' AND provider_id IS ? AND event_at IS ?)";guardArgs=[job.id,job.provider_id,job.event_at];
  if(!['accepted','rejected'].includes(a.outcome)||typeof a.evidence!=='string'||a.evidence.trim().length<20||a.evidence.length>1500||a.outcome==='accepted'&&(!/^[A-Za-z0-9_-]{3,199}$/.test(a.providerId||'')||job.provider_id&&job.provider_id!==a.providerId))throw new AdminError('EVIDENCE_REQUIRED',409);
  statements.push(db.prepare('INSERT INTO delivery_resolutions VALUES(?,?,?,?,?,?)').bind(job.id,user.email,a.outcome,a.evidence.trim(),a.outcome==='accepted'?a.providerId:null,now));
  statements.push(db.prepare("UPDATE delivery_jobs SET state=?,provider_id=COALESCE(provider_id,?),accepted_at=CASE WHEN ?='accepted' THEN COALESCE(accepted_at,?) ELSE accepted_at END,error_code='MANUALLY_RECONCILED',payload='' WHERE id=? AND state='uncertain'").bind(a.outcome,a.outcome==='accepted'?a.providerId:null,a.outcome,now,job.id));result={id:job.id,state:a.outcome};
 }else if(area==='web'&&op==='draft'){
  const v=validatePartner(a),id=body.commandId;guard='(SELECT COUNT(*) FROM web_partners)<200';statements.push(db.prepare("INSERT INTO web_partners VALUES(?,?,?,?,?,?,'draft',1,?,?)").bind(id,a.sponsorId,v.name,v.url,v.mime,a.image,user.email,now));result={id,state:'draft'};
 }else if(area==='web'&&['publish','withdraw'].includes(op)){
  const r=await db.prepare('SELECT * FROM web_partners WHERE id=?').bind(a.id).first();if(!r)throw new AdminError('NOT_FOUND',404);if(String(r.revision)!==body.expectedVersion)throw new AdminError('CONFLICT',409);
  guard='EXISTS(SELECT 1 FROM web_partners WHERE id=? AND revision=?)';guardArgs=[r.id,r.revision];
  if(op==='publish'){const s=await bridge(env,'sponsors','sponsor',{id:r.sponsor_id},user.email);if(s.item?.logoStatus!=='Schváleno')throw new AdminError('LOGO_APPROVAL_REQUIRED',409);}
  const state=op==='publish'?'published':'withdrawn';statements.push(db.prepare('UPDATE web_partners SET state=?,revision=revision+1,updated_at=?,actor=? WHERE id=? AND revision=?').bind(state,now,user.email,r.id,r.revision));result={id:r.id,state};
 }else throw new AdminError('NOT_FOUND',404);
 const response={status:'success',data:result};
 // The audit receipt and mutation commit together. A unique command ID prevents double execution.
 statements.unshift(db.prepare('INSERT INTO admin_actions SELECT ?,?,?,?,?,? WHERE '+guard).bind(body.commandId,user.email,area+'/'+op,fingerprint,JSON.stringify(response),now,...guardArgs));
 // Abort the whole transaction when a concurrent writer wins the optimistic check.
 // A deliberate NOT NULL violation rolls back the receipt as well as every following statement.
 statements.splice(1,0,db.prepare('INSERT INTO admin_actions(id,actor,operation,fingerprint,result,created_at) SELECT ?,NULL,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM admin_actions WHERE id=?)').bind(crypto.randomUUID(),'guard',fingerprint,'{}',now,body.commandId));
 try{await db.batch(statements);}catch{const saved=await db.prepare('SELECT * FROM admin_actions WHERE id=?').bind(body.commandId).first();if(saved&&saved.actor===user.email&&saved.fingerprint===fingerprint)return json(JSON.parse(saved.result));throw new AdminError('CONFLICT',409);}return json(response);
}
