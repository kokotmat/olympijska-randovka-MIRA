import {AdminError,json,errorResponse} from '../../lib/admin/access.js';
import {DeliveryStore,authenticateWebhook,receiveEvent} from '../../lib/admin/delivery.js';
import {boundedJson} from './delivery.js';
export async function onRequest({request,env}){
 try{
  if(request.method!=='POST')throw new AdminError('METHOD_NOT_ALLOWED',405);
  await authenticateWebhook(request,env);if(!env.ADMIN_DB)throw new AdminError('DELIVERY_NOT_CONFIGURED',503);
  const event=await boundedJson(request,64000);return json({status:'success',data:await receiveEvent(new DeliveryStore(env.ADMIN_DB),event)});
 }catch(error){return errorResponse(error);}
}
