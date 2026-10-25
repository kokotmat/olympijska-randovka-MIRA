import {AdminError,json,errorResponse} from '../../lib/admin/access.js';
import {DeliveryStore,verifyDelivery,processQueue} from '../../lib/admin/delivery.js';
export async function boundedJson(request,limit){
 const reader=request.body?.getReader();if(!reader)throw new AdminError('INVALID_JSON');const chunks=[];let size=0;
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw new AdminError('REQUEST_TOO_LARGE',413);}chunks.push(value);}
 const bytes=new Uint8Array(size);let n=0;for(const part of chunks){bytes.set(part,n);n+=part.byteLength;}try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new AdminError('INVALID_JSON');}
}
export async function onRequest(context){
 const {request,env}=context;
 try{
  if(request.method!=='POST')throw new AdminError('METHOD_NOT_ALLOWED',405);
  if(!env.ADMIN_DB)throw new AdminError('DELIVERY_NOT_CONFIGURED',503);
  const d=await boundedJson(request,10*1024*1024);await verifyDelivery(d,env);const store=new DeliveryStore(env.ADMIN_DB);await store.nonce(d,Date.now());
  if(d.op==='enqueue')return json({status:'success',data:await store.enqueue(d.source,d.args)});
  if(d.op==='status')return json({status:'success',data:await store.status(d.source,d.args)});
  await store.control(d.source,d.args,d.ts);context.waitUntil(processQueue(env).catch(()=>console.warn('DELIVERY_PROCESSING_INTERRUPTED')));
  return json({status:'success',data:{state:'tick_accepted'}});
 }catch(error){return errorResponse(error);}
}
