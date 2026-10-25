import {AdminError,json,errorResponse} from '../../lib/admin/access.js';
import {boundedJson} from './delivery.js';
import {DeliveryStore,digest} from '../../lib/admin/delivery.js';
import {verifyOps,saveBackup,exportSource,operationalCheck} from '../../lib/admin/ops.js';
export async function onRequest({request,env}){try{
 if(request.method!=='POST')throw new AdminError('METHOD_NOT_ALLOWED',405);if(!env.ADMIN_DB)throw new AdminError('OPS_NOT_CONFIGURED',503);
 const d=await boundedJson(request,1600000);await verifyOps(d,env);await new DeliveryStore(env.ADMIN_DB).nonce({...d,source:'ops:'+d.source},Date.now());
 let result;if(d.op==='backup')result=await saveBackup(env,d.source,d.args);
 else if(d.op==='export')result=await exportSource(env,d.source);
 else if(d.op==='check'){if(d.source!=='sponsors')throw new AdminError('FORBIDDEN',403);result=await operationalCheck(env);}
 else{if(!['ok','error'].includes(d.args.state)||!Array.isArray(d.args.issues)||d.args.issues.length>20||d.args.issues.some(x=>!/^\w{1,80}$/.test(x)))throw new AdminError('INVALID_REPORT');await env.ADMIN_DB.prepare('INSERT INTO ops_reports VALUES(?,?,?,?) ON CONFLICT(source) DO UPDATE SET state=excluded.state,checked_at=excluded.checked_at,detail=excluded.detail').bind(d.source,d.args.state,Date.now(),JSON.stringify(d.args.issues)).run();result={recorded:true};}
 return json({status:'success',data:result});
 }catch(error){return errorResponse(error);}}
