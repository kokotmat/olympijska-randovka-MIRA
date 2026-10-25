/* Shared Apps Script transport. Including this file alone does not enable sending.
 * Source integrations must preserve their own approval, schedule, limits and ledger.
 * ADMIN_BRIDGE_SECRET already belongs to this source; signature namespace is separate.
 */
function rdDeliveryRequest_(source,op,args){
  if(!['reservations','sponsors'].includes(source)||!['enqueue','status','sync','cancel','tick'].includes(op))throw new Error('DELIVERY_OPERATION_REJECTED');
  const secret=PropertiesService.getScriptProperties().getProperty('ADMIN_BRIDGE_SECRET')||'';
  if(secret.length<32)throw new Error('DELIVERY_NOT_CONFIGURED');
  const d={source:source,op:op,args:args,ts:Date.now(),nonce:Utilities.getUuid()};
  const canonical=JSON.stringify(['randovka-delivery-v1',d.ts,d.nonce,d.source,d.op,d.args]);
  d.signature=Utilities.computeHmacSha256Signature(canonical,secret).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');
  let response;
  try{response=UrlFetchApp.fetch('https://olympijskarandovka.cz/api/delivery',{method:'post',contentType:'text/plain;charset=UTF-8',payload:JSON.stringify(d),muteHttpExceptions:true,followRedirects:false});}
  catch(_){throw new Error('DELIVERY_RESULT_UNKNOWN');}
  let result;try{result=JSON.parse(response.getContentText());}catch(_){throw new Error('DELIVERY_RESULT_UNKNOWN');}
  if(response.getResponseCode()!==200||result.status!=='success'){
    const known=['MESSAGE_CONFLICT','MESSAGE_CANCELLED','MESSAGE_EXPIRED','RECIPIENT_PERMISSION_REQUIRED','RECIPIENT_SUPPRESSED','NOT_FOUND','INVALID_MESSAGE','INVALID_MODE','INVALID_POLICY','INVALID_SYNC'];
    throw new Error(known.includes(result.code)?result.code:'DELIVERY_RESULT_UNKNOWN');
  }
  return result.data;
}
function rdDeliveryMessage_(sourceId,mode,kind,message,expiresAt){
  if(!['test','live'].includes(mode))throw new Error('INVALID_MODE');
  // Stable source ID must include the mode; do not create a fresh UUID on retry.
  return {sourceId:mode+':'+sourceId,mode:mode,kind:kind,to:message.to,subject:message.subject,text:message.body||'',html:message.htmlBody||'',expiresAt:expiresAt||null,
    attachments:(message.attachments||[]).map(blob=>({filename:blob.getName(),fileblob:Utilities.base64Encode(blob.getBytes())}))};
}
function rdDeliveryState_(source,sourceId){return rdDeliveryRequest_(source,'status',{sourceId:sourceId});}
function rdDeliveryEnqueue_(source,message){return rdDeliveryRequest_(source,'enqueue',message);}
function rdDeliveryTick_(source,enabled,window){return rdDeliveryRequest_(source,'tick',{enabled:enabled,window:window||null});}
// No direct Gmail/provider fallback is allowed after an ambiguous enqueue result.
// Query the exact sourceId first. Do not regenerate a new source ID for the same mail.
