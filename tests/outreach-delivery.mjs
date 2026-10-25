import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import crypto from 'node:crypto';
import {buildOutreachDelivery} from '../tools/build-outreach-delivery.mjs';
const extension=fs.readFileSync(new URL('../integrations/outreach/Delivery.gs',import.meta.url),'utf8');
class Sheet{
 constructor(headers,rows=[]){this.rows=[headers,...rows];this.max=headers.length;}
 getDataRange(){return {getValues:()=>this.rows.map(r=>r.slice())};}getLastRow(){return this.rows.length;}getLastColumn(){return this.rows[0].length;}getMaxColumns(){return this.max;}insertColumnsAfter(_,n){this.max+=n;}
 appendRow(r){this.rows.push(r.slice());}getRange(row,col,h=1,w=1){return {getValues:()=>Array.from({length:h},(_,i)=>Array.from({length:w},(_,j)=>this.rows[row-1+i]?.[col-1+j]??'')),setValue:v=>{this.rows[row-1]??=[];this.rows[row-1][col-1]=v;},setValues:values=>values.forEach((r,i)=>r.forEach((v,j)=>{this.rows[row-1+i]??=[];this.rows[row-1+i][col-1+j]=v;}))};}
}
function fixture(){
 const hash=v=>crypto.createHash('sha256').update(String(v)).digest('hex');
 const lead={campaign_id:'SP-1',organization_name:'Fixture Ltd',email_primary:'person@example.test',permission_status:'CONSENTED',manual_approved:'YES',email_subject:'Fixture event',email_body:'Dear Fixture Ltd, approved request.',template_version:'OWN_2027_V15',send_status:'',sent_at:'',reply_status:'',followup_count:0,next_followup_at:'',central_delivery_id:'',central_delivery_status:'',central_delivery_checked_at:'',automation_status:'READY_FOR_SEND',approved_message_hash:''};lead.approved_message_hash=hash(lead.email_subject+'\n'+lead.email_body);
 const headers=Object.keys(lead),leads=new Sheet(headers,[headers.map(k=>lead[k])]),ledger=new Sheet(['timestamp','attempt_id','type','campaign_id','row_num','email','company_key','status','provider','message_id','note','bcc_emails']),queue=new Sheet(['created_at','campaign_id','email','company_key','subject_hash','body_hash','scheduled_at','state','updated_at','note','bcc_emails']);
 const props={OUTREACH_TRANSPORT:'CENTRAL',OUTREACH_CENTRAL_INSTALLED:'TRUE',OPS_SPREADSHEET_ID:'ops'},remote=new Map(),calls=[],suppression=new Set(),settings={SENDER_EMAIL:'owner@example.test',MODE:'LIVE',CAMPAIGN_ENABLED:'TRUE',V16_QUEUE_RUNNING:'TRUE',SEND_WEEKDAYS:'MON,TUE,WED,THU,FRI',SEND_START_HOUR:8,SEND_END_HOUR:18,DAILY_SEND_LIMIT:5,MAX_SEND_PER_RUN:2,MAX_FOLLOWUPS:2,FOLLOWUP_1_DAYS:6,FOLLOWUP_2_DAYS:12};
 let globalMode='disabled',failEnqueue=false,replyFailure=false;const ops={};
 const data=sh=>({headers:sh.rows[0],rows:sh.rows.slice(1).map(r=>r.slice()),map:Object.fromEntries(sh.rows[0].map((h,i)=>[h,i]))}),obj=(h,r)=>Object.fromEntries(h.map((v,i)=>[v,r[i]]));
 const ctx=vm.createContext({console,Date,Set,Map,JSON,Number,Object,Array,Math,V200:{OWNER:'owner@example.test'},SPONSOR_SYS:{TZ:'Europe/Prague'},
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props[k]||null,setProperty:(k,v)=>{props[k]=v;}})},SpreadsheetApp:{openById:()=>({getSheetByName:n=>ops[n],insertSheet:n=>ops[n]=new Sheet([])}),flush(){}},
  MailApp:{getRemainingDailyQuota(){throw Error('Mail quota must not govern external dispatch');},sendEmail(){throw Error('NO REAL MAIL');}},GmailApp:{sendEmail(){throw Error('NO GMAIL FALLBACK');}},
  LockService:{getScriptLock:()=>({waitLock(){},tryLock:()=>true,releaseLock(){}})},Utilities:{formatDate:(v,_tz,fmt)=>fmt==='yyyy-MM-dd'?new Date(v).toISOString().slice(0,10):''},
  getSettings_:()=>settings,getLeadsSheet_:()=>leads,getSheetData_:data,rowToObject_:obj,clean_:v=>String(v??'').trim(),normalizeEmailBody_:v=>String(v??'').trim(),v16Hash_:hash,v200Owner_(){},v200Waiting_:()=>false,v200Status_:(state,detail)=>calls.push({op:'source-status',state,detail}),
  isValidEmail_:v=>typeof v==='string'&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),v17IsApproved_:l=>l.manual_approved==='YES',localEmailQA_:()=>({pass:true}),companyNameForLead_:l=>l.organization_name,
  isSuppressed_:v=>suppression.has(v),addSuppression_:v=>suppression.add(v),v15CompanyKey_:l=>l.organization_name.toLowerCase().replace(/\W/g,''),aiEnabled_:()=>false,buildFinalBody_:body=>body+'\nApproved signature',
  v17FindReplyForLead_:()=>{if(replyFailure)throw Error('REPLY_SEARCH_INCOMPLETE');return null;},generateFollowupNoAI_:l=>({data:{subject:l.email_subject,body:'Dear Fixture Ltd, follow-up.'}}),asDate_:v=>v?new Date(v):null,addDays_:(d,n)=>new Date(new Date(d).getTime()+n*86400000),num_:(v,d)=>v===undefined?d:Number(v),
  updateLeadFields_:(sh,m,r,fields)=>{for(const [k,v]of Object.entries(fields)){if(m[k]===undefined){m[k]=sh.rows[0].length;sh.rows[0].push(k);}sh.getRange(r,m[k]+1).setValue(v);}},
  v15LedgerState_:()=>({sheet:ledger,followupSet:new Set(),initialEmail:new Set(),initialCompany:new Set()}),v15Reserve_:(st,type,l,row)=>{if(ledger.rows.slice(1).some(r=>r[2]===type&&r[3]===l.campaign_id))throw Error('DUPLICATE');ledger.appendRow([new Date(),'A-'+ledger.rows.length,type,l.campaign_id,row,l.email_primary,'fixtureltd','RESERVED','','','','']);return ledger.rows.length;},v15LedgerFinish_:(st,row,status,result,note)=>st.sheet.getRange(row,8,1,4).setValues([[status,result?.provider||'',result?.messageId||'',note]]),
  v17BccForLead_:()=>[],v16GetQueue_:()=>({sh:queue,data:data(queue)}),countSentToday_:()=>0,isSendWindow_:()=>true,loadSuppressionSetForBatch_:()=>suppression,v15MappingCache_:()=>({}),v16QueueEligible_:()=>'',canSendPriority_:()=>true,bool_:(v,d)=>v===undefined?d:v===true||v==='TRUE',
  rdDeliveryTick_:(source,enabled,window)=>{calls.push({op:'tick',source,enabled,window});},
  rdDeliveryRequest_:(source,op,args)=>{calls.push({op,source,args});if(op==='sync')return {sendingMode:globalMode,items:(args.sourceIds||[]).map(id=>remote.get(id)).filter(Boolean),suppressed:(args.recipients||[]).filter(x=>suppression.has(x)).map(recipient=>({recipient,reason:'spam'}))};if(op==='cancel'){const prior=remote.get(args.sourceId);if(prior&&!['queued'].includes(prior.state))return prior;const r={sourceId:args.sourceId,state:'cancelled'};remote.set(args.sourceId,r);return r;}if(op==='enqueue'){if(!remote.has(args.sourceId))remote.set(args.sourceId,{sourceId:args.sourceId,state:'queued',providerId:null,acceptedAt:null,deliveredAt:null});if(failEnqueue)throw Error('DELIVERY_RESULT_UNKNOWN');return remote.get(args.sourceId);}throw Error('UNSUPPORTED');}
 });
 vm.runInContext(extension,ctx);ops._Delivery_sponsors=new Sheet(Array.from(vm.runInContext('RD_OUTBOX_HEADERS',ctx)));
 return {ctx,props,settings,leads,ledger,queue,ops,remote,calls,suppression,getLead:()=>obj(leads.rows[0],leads.rows[1]),setLead:fields=>ctx.updateLeadFields_(leads,data(leads).map,2,fields),mode:v=>{globalMode=v;},failEnqueue:v=>{failEnqueue=v;},replyFailure:v=>{replyFailure=v;},prepare(kind='initial'){const box=ctx.rdOutreachOutbox_(),ls=ctx.rdOutreachLeads_(),st=ctx.v15LedgerState_(),entry=ctx.rdOutreachPrepare_(ls.byId['SP-1'],kind,box,ls,settings,st);return {box,ls,st,entry};}};
}
let count=0;async function test(name,fn){await fn();count++;console.log('PASS',name);}
await test('disabled central mode reconciles but never admits, dispatches or uses Gmail quota',()=>{
 const f=fixture(),before=JSON.stringify(f.settings),r=f.ctx.rdOutreachTick_(false);assert.equal(r.mode,'disabled');assert.equal(r.admitted,0);assert(!f.calls.some(x=>x.op==='enqueue'||x.op==='tick'&&x.enabled));assert.equal(JSON.stringify(f.settings),before);assert.equal(f.ledger.rows.length,1);
});
await test('enabled source admits only its daily budget and waits for provider confirmation',()=>{
 const f=fixture();f.mode('live');f.settings.DAILY_SEND_LIMIT=1;const l=f.getLead(),h=f.ctx.v16Hash_;f.queue.appendRow([new Date(),l.campaign_id,l.email_primary,'fixtureltd',h(l.email_subject),h(l.email_body),new Date(Date.now()-1000),'QUEUED','','','']);
 const r=f.ctx.rdOutreachTick_(false);assert.equal(r.admitted,1);assert.equal(f.calls.filter(x=>x.op==='enqueue').length,1);assert(f.calls.some(x=>x.op==='tick'&&x.enabled));assert.equal(f.getLead().send_status,'RESERVED');assert.equal(f.getLead().sent_at,'');
 const p=f.ctx.rdOutreachOutbox_();assert.equal(f.ctx.rdOutreachBudget_(p,f.settings,f.ctx.v15LedgerState_()),0);
});
await test('durable intent survives timeout after remote admission without duplicate or Gmail fallback',()=>{
 const f=fixture(),p=f.prepare();assert.equal(f.getLead().send_status,'RESERVED');assert.equal(f.ledger.rows[1][7],'RESERVED');assert(p.entry.payload);f.failEnqueue(true);assert.throws(()=>f.ctx.rdOutreachReviewPending_(p.box,p.ls,f.settings,p.st),/DELIVERY_RESULT_UNKNOWN/);assert.equal(p.entry.state,'unknown');assert.equal(f.remote.size,1);
 f.failEnqueue(false);f.ctx.rdOutreachSync_(p.box,p.ls,f.settings,p.st);f.ctx.rdOutreachReviewPending_(p.box,p.ls,f.settings,p.st);assert.equal(f.calls.filter(x=>x.op==='enqueue').length,1);assert.equal(f.getLead().send_status,'RESERVED');
 const accepted={...f.remote.get(p.entry.source_id),state:'accepted',acceptedAt:Date.now(),providerId:'offline-provider'};f.ctx.rdOutreachApply_(p.box,p.entry,accepted,p.ls,f.settings,p.st);assert.equal(f.getLead().send_status,'SENT');assert.equal(f.getLead().central_delivery_status,'accepted');assert.equal(p.entry.payload,'');assert.equal(f.ledger.rows[1][7],'SENT');
 f.ctx.rdOutreachApply_(p.box,p.entry,{...accepted,state:'delivered',deliveredAt:Date.now()},p.ls,f.settings,p.st);assert.equal(f.getLead().central_delivery_status,'delivered');assert.equal(f.getLead().followup_count,0);
});
await test('changed approval cancels a queued message and preserves duplicate protection',()=>{
 const f=fixture(),p=f.prepare();f.ctx.rdOutreachReviewPending_(p.box,p.ls,f.settings,p.st);f.setLead({email_body:'Changed without approval'});f.ctx.rdOutreachReviewPending_(p.box,p.ls,f.settings,p.st);assert.equal(f.remote.get(p.entry.source_id).state,'cancelled');assert.equal(f.getLead().send_status,'CANCELLED');assert.equal(f.ledger.rows[1][7],'CANCELLED_BEFORE_SEND');assert.equal(f.calls.filter(x=>x.op==='enqueue').length,1);
});
await test('missing consent or BCC blocks before any durable reservation',()=>{
 const f=fixture();f.setLead({permission_status:'EXISTING_RELATIONSHIP'});assert.throws(()=>f.prepare(),/DELIVERY_APPROVAL_REQUIRED/);assert.equal(f.ledger.rows.length,1);f.setLead({permission_status:'CONSENTED'});f.ctx.v17BccForLead_=()=>['other@example.test'];assert.throws(()=>f.prepare(),/DELIVERY_BCC_REVIEW_REQUIRED/);assert.equal(f.ledger.rows.length,1);
});
await test('reply lookup failure never authorizes an external follow-up',()=>{
 const f=fixture();f.setLead({send_status:'SENT',sent_at:new Date(Date.now()-10*86400000)});f.replyFailure(true);assert.throws(()=>f.prepare('followup:1'),/REPLY_SEARCH_INCOMPLETE/);assert.equal(f.ledger.rows.length,1);
});
await test('accepted follow-up advances once; uncertain receipt blocks further automation',()=>{
 const f=fixture();f.setLead({send_status:'SENT',sent_at:new Date(Date.now()-10*86400000)});const p=f.prepare('followup:1'),accepted={sourceId:p.entry.source_id,state:'accepted',acceptedAt:Date.now(),providerId:'followup-provider'};
 f.ctx.rdOutreachApply_(p.box,p.entry,accepted,p.ls,f.settings,p.st);const first=f.getLead().last_followup_at;f.ctx.rdOutreachApply_(p.box,p.entry,accepted,p.ls,f.settings,p.st);assert.equal(f.getLead().followup_count,1);assert.equal(f.getLead().last_followup_at.getTime(),first.getTime());
 const g=fixture(),q=g.prepare();g.ctx.rdOutreachApply_(q.box,q.entry,{sourceId:q.entry.source_id,state:'uncertain'},q.ls,g.settings,q.st);assert.equal(g.getLead().send_status,'UNCERTAIN');assert.equal(q.entry.payload,'');assert.equal(g.getLead().next_followup_at,'');assert.equal(g.ledger.rows[1][7],'UNKNOWN');
});
await test('suppression synchronizes for Gmail contacts and legacy rollback fails closed',()=>{
 const f=fixture();f.suppression.add('person@example.test');f.ctx.rdOutreachTick_(true);assert.equal(f.getLead().automation_status,'SUPPRESSED');assert.throws(()=>f.ctx.rdOutreachGuardLegacy_('person@example.test'),/QUEUE_ONLY/);f.props.OUTREACH_TRANSPORT='GMAIL';assert.throws(()=>f.ctx.rdOutreachGuardLegacy_('person@example.test'),/RECIPIENT_BLOCKED/);
 f.ctx.rdDeliveryRequest_=()=>{throw Error('OFFLINE');};assert.throws(()=>f.ctx.rdOutreachGuardLegacy_('clear@example.test'),/OFFLINE/);
});
await test('pending and uncertain attempts consume source budget; schedules remain unchanged',()=>{
 const f=fixture(),p=f.prepare();assert.equal(f.ctx.rdOutreachBudget_(p.box,f.settings,p.st),4);p.entry.state='uncertain';assert.equal(f.ctx.rdOutreachBudget_(p.box,f.settings,p.st),4);const window=f.ctx.rdOutreachWindow_(f.settings);assert.deepEqual(Array.from(window.days),[1,2,3,4,5]);assert.equal(window.startMinute,480);assert.equal(window.endMinute,1080);assert.throws(()=>f.ctx.rdOutreachWindow_({...f.settings,SEND_WEEKDAYS:'INVALID'}),/SCHEDULE_INVALID/);
});
await test('duplicate source IDs or moved contact identity never update the wrong lead',()=>{
 const f=fixture(),p=f.prepare();f.setLead({email_primary:'changed@example.test'});assert.throws(()=>f.ctx.rdOutreachApply_(p.box,p.entry,{sourceId:p.entry.source_id,state:'accepted',acceptedAt:Date.now(),providerId:'p'},p.ls,f.settings,p.st),/IDENTITY_CHANGED/);assert.equal(f.getLead().send_status,'RESERVED');
});
await test('source builder refuses unsupported hooks and duplicate installation',()=>{
 const source=['function senderProvider_(settings){}','function sendViaConfiguredProvider_(to){}','function sendViaGmailWorkspace_(to){}','function sendViaSmtp2go_(to){}','function sendLead_(){}','function processDueFollowups_(){}','function v15SenderCheck_(s){}','function v16QueueTickUnlocked_(){}',"function v16QueueTick(){try{if(v200Waiting_())return;return v16QueueTickUnlocked_();}finally{}}",'function automationTick(){\n    if(v200Waiting_())return;\n    processBounces_();processReplies_(false);\n}',"function health(){return {provider:settings.SENDER_PROVIDER||'Neověřeno',communicationStatus:get('reply_status')||get('automation_status')||get('send_status'),};} function pause(){SpreadsheetApp.flush();result={status:'success',data:{paused:true}};}"].join('\n');
 const built=buildOutreachDelivery(source);new vm.Script(built);assert.throws(()=>buildOutreachDelivery(built),/Already integrated/);assert.throws(()=>buildOutreachDelivery(source.replace('sendViaGmailWorkspace_','unexpected_')),/Unsupported function/);assert(built.includes('rdOutreachGuardLegacy_(to)'));
});
console.log(JSON.stringify({tests:count,network:'mocked only',mail:'forbidden',sheets:'in-memory'}));

