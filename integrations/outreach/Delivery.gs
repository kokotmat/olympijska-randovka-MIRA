/* Source-owned outbox. Requires delivery/Client.gs and the audited source hooks.
 * No SMTP API key here. Installation routes sends to CENTRAL but never enables it.
 */
const RD_OUTBOX_HEADERS=['source_id','campaign_id','kind','recipient','company_key','snapshot_hash','ledger_attempt_id','state','provider_id','accepted_at','delivered_at','checked_at','last_error','created_at','payload'];
function rdOutreachUsesCentral_(){return PropertiesService.getScriptProperties().getProperty('OUTREACH_TRANSPORT')==='CENTRAL';}
function rdOutreachWindow_(s){
  const names=['MON','TUE','WED','THU','FRI','SAT','SUN'],days=String(s.SEND_WEEKDAYS||'MON,TUE,WED,THU,FRI').split(',').map(v=>names.indexOf(v.trim().toUpperCase())+1);
  const start=Number(s.SEND_START_HOUR??8)*60,end=Number(s.SEND_END_HOUR??18)*60;
  if(!days.length||days.some(d=>d<1)||!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>1440||start>=end)throw Error('DELIVERY_SCHEDULE_INVALID');
  return {days,startMinute:start,endMinute:end};
}
function rdOutreachOutbox_(){
  const id=PropertiesService.getScriptProperties().getProperty('OPS_SPREADSHEET_ID');if(!id)throw Error('DELIVERY_NOT_CONFIGURED');
  const book=SpreadsheetApp.openById(id),sheet=book.getSheetByName('_Delivery_sponsors');if(!sheet)throw Error('DELIVERY_SETUP_REQUIRED');
  const data=sheet.getDataRange().getValues(),headers=data.shift()||[];
  if(JSON.stringify(headers)!==JSON.stringify(RD_OUTBOX_HEADERS))throw Error('DELIVERY_SCHEMA');
  const rows=data.map((r,i)=>Object.assign(Object.fromEntries(headers.map((h,j)=>[h,r[j]])),{row:i+2}));
  if(new Set(rows.map(r=>r.source_id)).size!==rows.length)throw Error('DELIVERY_DUPLICATE_ID');
  return {sheet,rows};
}
function rdOutreachSave_(outbox,entry,fields){
  for(const key of Object.keys(fields)){const col=RD_OUTBOX_HEADERS.indexOf(key);if(col<0)throw Error('DELIVERY_SCHEMA');outbox.sheet.getRange(entry.row,col+1).setValue(fields[key]);entry[key]=fields[key];}
}
function rdOutreachLeads_(){
  const sheet=getLeadsSheet_(),data=getSheetData_(sheet),byId={};
  data.rows.forEach((r,i)=>{const lead=rowToObject_(data.headers,r),id=clean_(lead.campaign_id);if(!id)return;if(byId[id])throw Error('DELIVERY_DUPLICATE_CAMPAIGN');byId[id]={lead,row:i+2};});
  return {sheet,data,byId};
}
function rdOutreachFresh_(leads,id){
  const ref=leads.byId[id];if(!ref)return null;
  const lead=rowToObject_(leads.data.headers,leads.sheet.getRange(ref.row,1,1,leads.data.headers.length).getValues()[0]);
  if(clean_(lead.campaign_id)!==id)throw Error('DELIVERY_ROW_MOVED');return {lead,row:ref.row};
}
function rdOutreachText_(lead,kind,s){
  const initialSubject=clean_(lead.email_subject),initialBody=normalizeEmailBody_(lead.email_body);
  if(clean_(lead.permission_status).toUpperCase()!=='CONSENTED'||!v17IsApproved_(lead)||clean_(lead.approved_message_hash)!==v16Hash_(initialSubject+'\n'+initialBody))throw Error('DELIVERY_APPROVAL_REQUIRED');
  if(clean_(lead.template_version)!=='OWN_2027_V15'||!localEmailQA_(lead,initialSubject,initialBody).pass||!initialBody.includes(companyNameForLead_(lead,s)))throw Error('DELIVERY_QA_FAILED');
  if(clean_(lead.reply_status)||isSuppressed_(clean_(lead.email_primary)))throw Error('DELIVERY_RECIPIENT_BLOCKED');
  let subject=initialSubject,body=initialBody;
  if(kind!=='initial'){
    const n=Number(kind.split(':')[1]);if(!/^followup:[1-3]$/.test(kind)||!Number.isInteger(n)||n>Number(s.MAX_FOLLOWUPS??2)||clean_(lead.manual_approved).toUpperCase()!=='YES')throw Error('DELIVERY_FOLLOWUP_NOT_APPROVED');
    if(clean_(lead.send_status)!=='SENT'||!asDate_(lead.sent_at))throw Error('DELIVERY_INITIAL_NOT_SENT');
    // External follow-ups use existing deterministic approved templates. AI replies remain drafts.
    if(aiEnabled_())throw Error('DELIVERY_AI_FOLLOWUP_REVIEW_REQUIRED');
    const found=[];if(v17FindReplyForLead_(lead,new Set([V200.OWNER]),null,found))throw Error('DELIVERY_REPLY_FOUND');
    const follow=generateFollowupNoAI_(lead,s,n);subject=clean_(follow.data.subject||initialSubject);body=normalizeEmailBody_(follow.data.body);
    if(!localEmailQA_(lead,subject,body).pass)throw Error('DELIVERY_QA_FAILED');
  }
  const text=buildFinalBody_(body,s),recipient=clean_(lead.email_primary).toLowerCase();
  if(!isValidEmail_(recipient))throw Error('DELIVERY_RECIPIENT_INVALID');
  return {subject,text,snapshot:v16Hash_(JSON.stringify([clean_(lead.campaign_id),recipient,v15CompanyKey_(lead),initialSubject,initialBody,clean_(lead.approved_message_hash),kind,subject,text]))};
}
function rdOutreachLedgerRow_(ledger,attempt){
  const data=getSheetData_(ledger.sheet),found=[];data.rows.forEach((r,i)=>{if(clean_(r[data.map.attempt_id])===attempt)found.push(i+2);});if(found.length!==1)throw Error('DELIVERY_LEDGER_IDENTITY');return found[0];
}
function rdOutreachQueueMark_(id,state,note){
  const q=v16GetQueue_();q.data.rows.forEach((r,i)=>{const x=rowToObject_(q.data.headers,r);if(clean_(x.campaign_id)===id&&['QUEUED','PROCESSING','CENTRAL_QUEUED','CENTRAL_REVIEW'].includes(clean_(x.state)))q.sh.getRange(i+2,8,1,3).setValues([[state,new Date(),note]]);});
}
function rdOutreachApply_(outbox,entry,receipt,leads,s,ledger){
  if(receipt.sourceId!==entry.source_id)throw Error('DELIVERY_RECEIPT_MISMATCH');
  const oldAccepted=Number(entry.accepted_at)||0,fields={state:receipt.state,provider_id:receipt.providerId||entry.provider_id||'',accepted_at:receipt.acceptedAt||oldAccepted||'',delivered_at:receipt.deliveredAt||entry.delivered_at||'',checked_at:new Date(),last_error:receipt.errorCode||''};
  if(!['prepared','unknown','queued','sending'].includes(receipt.state))fields.payload='';
  rdOutreachSave_(outbox,entry,fields);SpreadsheetApp.flush();
  const ref=rdOutreachFresh_(leads,entry.campaign_id);
  if(!ref||clean_(ref.lead.email_primary).toLowerCase()!==entry.recipient||v15CompanyKey_(ref.lead)!==entry.company_key)throw Error('DELIVERY_SOURCE_IDENTITY_CHANGED');
  const lead=ref.lead,update={},accepted=Number(entry.accepted_at)||Number(entry.delivered_at)||0,ledgerRow=rdOutreachLedgerRow_(ledger,entry.ledger_attempt_id);
  if(accepted){
    v15LedgerFinish_(ledger,ledgerRow,'SENT',{provider:'CENTRAL_SMTP2GO',messageId:entry.provider_id},'Poskytovatel potvrdil přijetí; doručení eviduje central_delivery_status.');
    if(entry.kind==='initial'&&!asDate_(lead.sent_at))Object.assign(update,{send_status:'SENT',sent_at:new Date(accepted),sender_provider:'CENTRAL_SMTP2GO',provider_message_id:entry.provider_id,followup_count:0,next_followup_at:lead.reply_status?'':addDays_(new Date(accepted),num_(s.FOLLOWUP_1_DAYS,6)),automation_status:lead.reply_status?lead.automation_status:'WAITING_REPLY'});
    if(entry.kind!=='initial'&&Number(lead.followup_count||0)<Number(entry.kind.split(':')[1])){
      const n=Number(entry.kind.split(':')[1]),max=Math.min(3,Number(s.MAX_FOLLOWUPS??2)),next=n<max&&n===1?addDays_(asDate_(lead.sent_at),num_(s.FOLLOWUP_2_DAYS,12)):'';
      Object.assign(update,{followup_count:n,last_followup_at:new Date(accepted),sender_provider:'CENTRAL_SMTP2GO',provider_message_id:entry.provider_id,next_followup_at:lead.reply_status?'':next,automation_status:lead.reply_status?lead.automation_status:n>=max?'WAITING_FINAL_REPLY':'WAITING_REPLY'});
    }
  }
  if(['uncertain','rejected','bounced','suppressed','cancelled','expired'].includes(receipt.state)){
    if(!accepted)v15LedgerFinish_(ledger,ledgerRow,receipt.state==='cancelled'?'CANCELLED_BEFORE_SEND':'UNKNOWN',null,'Externí fronta: '+receipt.state+'; automatické opakování blokováno.');
    Object.assign(update,{next_followup_at:'',automation_status:'MANUAL_RECONCILIATION',last_error:'CENTRAL_'+receipt.state.toUpperCase()});
    if(entry.kind==='initial')update.send_status=receipt.state.toUpperCase();
  }
  if(clean_(lead.central_delivery_id)===entry.source_id||!clean_(lead.central_delivery_id))Object.assign(update,{central_delivery_id:entry.source_id,central_delivery_status:receipt.state,central_delivery_checked_at:new Date()});
  if(Object.keys(update).length)updateLeadFields_(leads.sheet,leads.data.map,ref.row,update);
  if(entry.kind==='initial')rdOutreachQueueMark_(entry.campaign_id,accepted?'ACCEPTED':receipt.state==='queued'?'CENTRAL_QUEUED':['prepared','unknown'].includes(receipt.state)?'CENTRAL_REVIEW':receipt.state.toUpperCase(),'Externí fronta: '+receipt.state);
}
function rdOutreachSync_(outbox,leads,s,ledger){
  const addresses=[...new Set(Object.values(leads.byId).map(x=>clean_(x.lead.email_primary).toLowerCase()).filter(isValidEmail_))];
  // Every address is checked before any dispatch, including contacts previously sent by Gmail.
  let mode=null;for(let i=0;i<Math.max(1,addresses.length);i+=100){const r=rdDeliveryRequest_('sponsors','sync',{recipients:addresses.slice(i,i+100),sourceIds:[]});mode=r.sendingMode;
    for(const x of r.suppressed){addSuppression_(x.recipient,'EXTERNAL_'+String(x.reason).toUpperCase(),'central_delivery');for(const ref of Object.values(leads.byId))if(clean_(ref.lead.email_primary).toLowerCase()===x.recipient)updateLeadFields_(leads.sheet,leads.data.map,ref.row,{next_followup_at:'',automation_status:'SUPPRESSED',last_error:'CENTRAL_SUPPRESSED'});}
  }
  const active=outbox.rows.filter(x=>!['delivered','bounced','rejected','suppressed','cancelled','expired'].includes(x.state)),terminal=outbox.rows.filter(x=>!active.includes(x));
  const props=PropertiesService.getScriptProperties(),cursor=Number(props.getProperty('OUTREACH_RECEIPT_CURSOR')||0)%Math.max(1,terminal.length),selected=active.concat(terminal.slice(cursor,cursor+50));
  props.setProperty('OUTREACH_RECEIPT_CURSOR',String(cursor+50>=terminal.length?0:cursor+50));
  for(let i=0;i<selected.length;i+=50){const entries=selected.slice(i,i+50),r=rdDeliveryRequest_('sponsors','sync',{sourceIds:entries.map(x=>x.source_id),recipients:[]});mode=r.sendingMode;
    for(const receipt of r.items){const entry=entries.find(x=>x.source_id===receipt.sourceId);if(!entry)throw Error('DELIVERY_RECEIPT_MISMATCH');rdOutreachApply_(outbox,entry,receipt,leads,s,ledger);}
  }
  return mode;
}
function rdOutreachPending_(entry){return ['prepared','unknown','queued'].includes(entry.state);}
function rdOutreachReviewPending_(outbox,leads,s,ledger){
  for(const entry of outbox.rows.filter(rdOutreachPending_)){
    try{const ref=rdOutreachFresh_(leads,entry.campaign_id);if(!ref)throw Error('DELIVERY_SOURCE_MISSING');
      if(entry.kind==='initial'&&(asDate_(ref.lead.sent_at)||!['','RESERVED'].includes(clean_(ref.lead.send_status))))throw Error('DELIVERY_SOURCE_CHANGED');
      if(entry.kind!=='initial'&&Number(ref.lead.followup_count||0)!==Number(entry.kind.split(':')[1])-1)throw Error('DELIVERY_SOURCE_CHANGED');
      const pack=rdOutreachText_(ref.lead,entry.kind,s);if(pack.snapshot!==entry.snapshot_hash||v15CompanyKey_(ref.lead)!==entry.company_key)throw Error('DELIVERY_APPROVAL_CHANGED');}
    catch(e){const receipt=rdDeliveryRequest_('sponsors','cancel',{sourceId:entry.source_id});rdOutreachApply_(outbox,entry,receipt,leads,s,ledger);continue;}
    if(['prepared','unknown'].includes(entry.state)){
      try{const receipt=rdDeliveryRequest_('sponsors','enqueue',JSON.parse(entry.payload));rdOutreachApply_(outbox,entry,receipt,leads,s,ledger);}
      catch(e){if(['MESSAGE_CANCELLED','RECIPIENT_SUPPRESSED','MESSAGE_CONFLICT'].includes(e.message)){const receipt=rdDeliveryRequest_('sponsors','cancel',{sourceId:entry.source_id});rdOutreachApply_(outbox,entry,receipt,leads,s,ledger);}else{rdOutreachSave_(outbox,entry,{state:'unknown',last_error:'DELIVERY_RESULT_UNKNOWN',checked_at:new Date()});throw Error('DELIVERY_RESULT_UNKNOWN');}}
    }
  }
}
function rdOutreachBudget_(outbox,s,ledger){
  const today=Utilities.formatDate(new Date(),SPONSOR_SYS.TZ,'yyyy-MM-dd'),sameDay=v=>v&&Utilities.formatDate(new Date(v),SPONSOR_SYS.TZ,'yyyy-MM-dd')===today,data=getSheetData_(ledger.sheet);
  const gmail=data.rows.filter(r=>{const x=rowToObject_(data.headers,r);return clean_(x.status)==='SENT'&&clean_(x.provider)!=='CENTRAL_SMTP2GO'&&sameDay(x.timestamp);}).length;
  const accepted=outbox.rows.filter(x=>sameDay(x.accepted_at||x.delivered_at)).length,pending=outbox.rows.filter(x=>['prepared','unknown','queued','sending','uncertain'].includes(x.state)).length;
  const limit=Number(s.DAILY_SEND_LIMIT??20);if(!Number.isFinite(limit)||limit<0)throw Error('DELIVERY_LIMIT_INVALID');
  return Math.max(0,Math.floor(limit)-Math.max(countSentToday_(),gmail+accepted)-pending);
}
function rdOutreachPrepare_(ref,kind,outbox,leads,s,ledger){
  const current=rdOutreachFresh_(leads,clean_(ref.lead.campaign_id));if(!current)throw Error('DELIVERY_SOURCE_MISSING');const lead=current.lead,pack=rdOutreachText_(lead,kind,s);
  if(kind==='initial'&&(clean_(lead.send_status)||asDate_(lead.sent_at)))throw Error('DELIVERY_ALREADY_RESERVED');
  if(kind==='initial'&&v17BccForLead_(lead,ledger).length)throw Error('DELIVERY_BCC_REVIEW_REQUIRED');
  const type=kind==='initial'?'FIRST':'FOLLOWUP_'+kind.split(':')[1],index=v15Reserve_(ledger,type,lead,current.row,''),attempt=String(ledger.sheet.getRange(index,2).getValues()[0][0]);
  const id='live:sponsor:'+v16Hash_(JSON.stringify([clean_(lead.campaign_id),type,attempt])),payload={sourceId:id,mode:'live',kind,permission:'CONSENTED',to:clean_(lead.email_primary).toLowerCase(),subject:pack.subject,text:pack.text,html:'',attachments:[],expiresAt:null};
  const values={source_id:id,campaign_id:clean_(lead.campaign_id),kind,recipient:payload.to,company_key:v15CompanyKey_(lead),snapshot_hash:pack.snapshot,ledger_attempt_id:attempt,state:'prepared',provider_id:'',accepted_at:'',delivered_at:'',checked_at:new Date(),last_error:'',created_at:new Date(),payload:JSON.stringify(payload)};
  outbox.sheet.appendRow(RD_OUTBOX_HEADERS.map(h=>values[h]));const entry={...values,row:outbox.sheet.getLastRow()};outbox.rows.push(entry);SpreadsheetApp.flush();
  updateLeadFields_(leads.sheet,leads.data.map,current.row,{...(kind==='initial'?{send_status:'RESERVED'}:{}),central_delivery_id:id,central_delivery_status:'prepared',automation_status:'CENTRAL_QUEUED',last_processed_at:new Date()});SpreadsheetApp.flush();
  return entry;
}
function rdOutreachAdmit_(outbox,leads,s,ledger){
  const perRun=Number(s.MAX_SEND_PER_RUN??1);if(!Number.isFinite(perRun)||perRun<0)throw Error('DELIVERY_LIMIT_INVALID');
  const q=v16GetQueue_(),supp=loadSuppressionSetForBatch_(),mapping=v15MappingCache_(),max=Math.min(20,Math.floor(perRun),rdOutreachBudget_(outbox,s,ledger));let admitted=0;
  for(const r of q.data.rows){if(admitted>=max)break;const x=rowToObject_(q.data.headers,r);if(clean_(x.state)!=='QUEUED')continue;const due=asDate_(x.scheduled_at);if(due&&due>new Date())continue;
    const ref=leads.byId[clean_(x.campaign_id)];if(!ref)continue;const lead=ref.lead;
    if(clean_(lead.permission_status).toUpperCase()!=='CONSENTED'||v16QueueEligible_(lead,s,ledger,new Set(),new Set(),supp,mapping))continue;
    if(clean_(lead.email_primary).toLowerCase()!==clean_(x.email).toLowerCase()||v15CompanyKey_(lead)!==clean_(x.company_key)||v16Hash_(clean_(lead.email_subject))!==clean_(x.subject_hash)||v16Hash_(normalizeEmailBody_(lead.email_body))!==clean_(x.body_hash)||clean_(x.bcc_emails))continue;
    rdOutreachPrepare_(ref,'initial',outbox,leads,s,ledger);admitted++;
  }
  for(const ref of Object.values(leads.byId)){if(admitted>=max)break;const lead=ref.lead,n=Number(lead.followup_count||0)+1,due=asDate_(lead.next_followup_at);
    if(clean_(lead.send_status)!=='SENT'||!due||due>new Date()||n>Math.min(3,Number(s.MAX_FOLLOWUPS??2))||!canSendPriority_(lead,s,clean_(s.MODE).toUpperCase())||ledger.followupSet.has(clean_(lead.email_primary).toLowerCase()+'|FOLLOWUP_'+n))continue;
    try{rdOutreachPrepare_(ref,'followup:'+n,outbox,leads,s,ledger);admitted++;}catch(e){if(!/^DELIVERY_/.test(e.message))throw e;updateLeadFields_(leads.sheet,leads.data.map,ref.row,{automation_status:'MANUAL_REVIEW',last_error:e.message});}
  }
  return admitted;
}
function rdOutreachTick_(reconcileOnly){
  v200Owner_();const s=getSettings_(),window=rdOutreachWindow_(s);rdDeliveryTick_('sponsors',false,window);
  if(clean_(s.SENDER_EMAIL).toLowerCase()!==V200.OWNER)throw Error('DELIVERY_SENDER_MISMATCH');
  const maxFollowups=Number(s.MAX_FOLLOWUPS??2);if(!Number.isInteger(maxFollowups)||maxFollowups<0||maxFollowups>3)throw Error('DELIVERY_FOLLOWUP_POLICY_INVALID');
  const outbox=rdOutreachOutbox_(),leads=rdOutreachLeads_(),ledger=v15LedgerState_(),mode=rdOutreachSync_(outbox,leads,s,ledger);
  const allowed=!reconcileOnly&&mode==='live'&&bool_(s.CAMPAIGN_ENABLED,false)&&bool_(s.V16_QUEUE_RUNNING,false)&&['PILOT','LIVE'].includes(clean_(s.MODE).toUpperCase())&&isSendWindow_(s)&&!v200Waiting_();
  // No admission or enqueue retries while global dispatch or the source is paused.
  if(!allowed){v200Status_('CENTRAL_PAUSED','Synchronizováno; externí odesílání vypnuté nebo mimo rozvrh.');return {transport:'CENTRAL',mode,admitted:0,pending:outbox.rows.filter(rdOutreachPending_).length,consented:Object.values(leads.byId).filter(x=>clean_(x.lead.permission_status).toUpperCase()==='CONSENTED').length,contacts:Object.keys(leads.byId).length};}
  rdOutreachReviewPending_(outbox,leads,s,ledger);const admitted=rdOutreachAdmit_(outbox,leads,s,ledger);rdOutreachReviewPending_(outbox,leads,s,ledger);
  // A read/identity failure above never reaches the dispatch heartbeat.
  rdDeliveryTick_('sponsors',true,window);v200Status_('CENTRAL_RUNNING','Předáno frontě: '+admitted+'; odeslání potvrzuje poskytovatel.');return {transport:'CENTRAL',mode,admitted};
}
function setupOutreachDelivery(){
  v200Owner_();const lock=LockService.getScriptLock();lock.waitLock(10000);try{
    const s=getSettings_(),window=rdOutreachWindow_(s);rdDeliveryTick_('sponsors',false,window);const check=rdDeliveryRequest_('sponsors','sync',{sourceIds:[],recipients:[]});
    if(check.sendingMode!=='disabled')throw Error('DELIVERY_DISABLE_FIRST');
    const props=PropertiesService.getScriptProperties(),book=SpreadsheetApp.openById(props.getProperty('OPS_SPREADSHEET_ID'));let sheet=book.getSheetByName('_Delivery_sponsors');
    if(!sheet){sheet=book.insertSheet('_Delivery_sponsors');sheet.appendRow(RD_OUTBOX_HEADERS);}
    const leads=getLeadsSheet_(),headers=leads.getRange(1,1,1,leads.getLastColumn()).getValues()[0],missing=['central_delivery_id','central_delivery_status','central_delivery_checked_at'].filter(h=>!headers.includes(h));
    if(missing.length){const end=headers.length+missing.length;if(leads.getMaxColumns()<end)leads.insertColumnsAfter(leads.getMaxColumns(),end-leads.getMaxColumns());leads.getRange(1,headers.length+1,1,missing.length).setValues([missing]);}
    rdOutreachOutbox_();SpreadsheetApp.flush();props.setProperty('OUTREACH_CENTRAL_INSTALLED','TRUE');props.setProperty('OUTREACH_TRANSPORT','CENTRAL');v200Status_('CENTRAL_PAUSED','Připojeno bez odeslání; nastavený rozvrh, limity a schválení zachovány.');
    console.log('CENTRAL_DELIVERY_INSTALLED_DISABLED');
  }finally{lock.releaseLock();}
}
function checkOutreachDelivery(){v200Owner_();const lock=LockService.getScriptLock();if(!lock.tryLock(1000))throw Error('BUSY');try{const result=rdOutreachTick_(true);console.log(JSON.stringify(result));return result;}finally{lock.releaseLock();}}
function rdOutreachGuardLegacy_(to){
  if(rdOutreachUsesCentral_())throw Error('DELIVERY_CENTRAL_QUEUE_ONLY');
  if(PropertiesService.getScriptProperties().getProperty('OUTREACH_CENTRAL_INSTALLED')!=='TRUE')return;
  // Rollback must not bypass a provider unsubscribe, spam report or hard bounce.
  const r=rdDeliveryRequest_('sponsors','sync',{sourceIds:[],recipients:[clean_(to).toLowerCase()]});
  for(const x of r.suppressed)addSuppression_(x.recipient,'EXTERNAL_'+String(x.reason).toUpperCase(),'central_delivery');
  if(r.suppressed.length)throw Error('DELIVERY_RECIPIENT_BLOCKED');
}
