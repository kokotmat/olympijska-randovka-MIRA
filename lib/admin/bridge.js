import {AdminError} from './access.js';
const ENDPOINTS={reservations:'RESERVATIONS_ADMIN_URL',sponsors:'SPONSORS_ADMIN_URL',assistant:'ASSISTANT_ADMIN_URL'};
const SECRETS={reservations:'RESERVATIONS_ADMIN_SECRET',sponsors:'SPONSORS_ADMIN_SECRET',assistant:'ASSISTANT_ADMIN_SECRET'};
export async function signedEnvelope(op,args,actor,secret,commandId='',expectedVersion=''){
  const e={action:'adminBridge',v:1,ts:Date.now(),nonce:crypto.randomUUID(),op,args,actor,commandId,expectedVersion};
  const data=JSON.stringify(['randovka-admin-v1',e.ts,e.nonce,e.op,e.actor,e.commandId,e.expectedVersion,e.args]);
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  e.signature=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(data))),x=>x.toString(16).padStart(2,'0')).join('');return e;
}
export async function bridge(env,component,op,args,actor,commandId='',expectedVersion='',fetcher=fetch){
  const url=env[ENDPOINTS[component]],secret=env[SECRETS[component]];
  if(!url||!secret||secret.length<32)throw new AdminError('COMPONENT_NOT_CONNECTED',503);
  const target=new URL(url);
  if(target.protocol!=='https:'||component!=='assistant'&&target.hostname!=='script.google.com'||component==='assistant'&&target.hostname!=='ai.olympijskarandovka.cz')throw new AdminError('INVALID_COMPONENT_CONFIGURATION',503);
  const envelope=await signedEnvelope(op,args,actor,secret,commandId,expectedVersion);
  let response;
  try{response=await fetcher(target,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify(envelope),redirect:'follow',signal:AbortSignal.timeout(20000)});}catch{throw new AdminError(commandId?'COMMAND_RESULT_UNKNOWN':'COMPONENT_UNAVAILABLE',commandId?504:503);}
  if(!response.ok)throw new AdminError(commandId?'COMMAND_RESULT_UNKNOWN':'COMPONENT_UNAVAILABLE',response.status===401?503:502);
  let result;try{result=await response.json();}catch{throw new AdminError(commandId?'COMMAND_RESULT_UNKNOWN':'INVALID_COMPONENT_RESPONSE',502);}
  if(result.status!=='success'){
    const known=['CONFLICT','COMMAND_CONFLICT','COMMAND_UNCERTAIN','NOT_FOUND','REJECTED','BUSY','BRIDGE_NOT_CONFIGURED','AUTH'].includes(result.code);
    throw new AdminError(known?result.code:commandId?'COMMAND_RESULT_UNKNOWN':'COMPONENT_REJECTED',result.code==='CONFLICT'?409:result.code==='NOT_FOUND'?404:503);
  }
  return result.data;
}
export async function componentState(env,name,actor){
  const started=Date.now();try{return {component:name,state:'connected',checkedAt:Date.now(),data:await bridge(env,name,'health',{},actor),latencyMs:Date.now()-started};}
  catch(error){return {component:name,state:error.code==='COMPONENT_NOT_CONNECTED'?'not_connected':'unavailable',checkedAt:Date.now(),code:error.code||'UNAVAILABLE'};}
}
