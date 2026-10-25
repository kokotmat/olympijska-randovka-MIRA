/** Private sponsorship bridge. Explicit fields only; never sends or creates a draft. */
const OUTREACH_ADMIN_FIELDS={giftStatus:'admin_gift_status',contractStatus:'admin_contract_status',logoStatus:'admin_logo_status',note:'admin_note',giftDescription:'admin_agreed_gift',receivedDescription:'admin_received_gift',deliveryStatus:'admin_delivery_status',contractReference:'admin_contract_reference',promotion:'admin_promised_promotion'};
function outreachAdminBook_(){return SpreadsheetApp.openById(V200.ID);}
function outreachAdminData_(sheet){const data=sheet.getDataRange().getValues(),headers=(data.shift()||[]).map(String);return {headers,rows:data,map:Object.fromEntries(headers.map((v,i)=>[v,i]))};}
function outreachAdminRows_(){
  const s=outreachAdminBook_().getSheetByName('FINAL_SPONSORS');if(!s)throw Error('BRIDGE_SCHEMA');
  const d=outreachAdminData_(s);if(d.map.campaign_id===undefined||d.map.email_primary===undefined||d.map.organization_name===undefined&&d.map.brand_name===undefined)throw Error('BRIDGE_SCHEMA');
  const ids=d.rows.map(r=>String(r[d.map.campaign_id]||'')).filter(Boolean);if(new Set(ids).size!==ids.length)throw Error('BRIDGE_SCHEMA');
  return {sheet:s,...d};
}
function outreachAdminHash_(v){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(v),Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');}
function outreachAdminVerify_(d){
  const p=PropertiesService.getScriptProperties(),secret=p.getProperty('ADMIN_BRIDGE_SECRET')||'',allowed=String(p.getProperty('ADMIN_ALLOWED_EMAILS')||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
  if(secret.length<32||!allowed.length)throw Error('BRIDGE_NOT_CONFIGURED');
  if(d.v!==1||!Number.isSafeInteger(d.ts)||Math.abs(Date.now()-d.ts)>120000||!/^[a-f0-9-]{36}$/i.test(d.nonce||'')||!allowed.includes(d.actor)||!d.args||typeof d.args!=='object'||Array.isArray(d.args))throw Error('AUTH');
  const value=JSON.stringify(['randovka-admin-v1',d.ts,d.nonce,d.op,d.actor,d.commandId||'',d.expectedVersion||'',d.args]);
  const expected=Utilities.computeHmacSha256Signature(value,secret,Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');
  const x=outreachAdminHash_(String(d.signature)),y=outreachAdminHash_(expected);let diff=0;for(let i=0;i<x.length;i++)diff|=x.charCodeAt(i)^y.charCodeAt(i);if(diff)throw Error('AUTH');
}
function outreachAdminSettings_(){const s=outreachAdminBook_().getSheetByName('SETTINGS');if(!s)throw Error('BRIDGE_SCHEMA');return Object.fromEntries(s.getDataRange().getValues().slice(1).filter(r=>r[0]).map(r=>[String(r[0]),String(r[1])]));}
function outreachAdminControlVersion_(s){return outreachAdminHash_(['CAMPAIGN_ENABLED','V16_QUEUE_RUNNING','MODE','DAILY_SEND_LIMIT','SEND_WEEKDAYS','SEND_START_HOUR','SEND_END_HOUR','MAX_FOLLOWUPS'].map(k=>s[k]||''));}
function outreachAdminControl_(s){return {enabled:s.CAMPAIGN_ENABLED==='TRUE'&&s.V16_QUEUE_RUNNING==='TRUE',mode:s.MODE,dailyLimit:Number(s.DAILY_SEND_LIMIT),weekdays:s.SEND_WEEKDAYS,startHour:Number(s.SEND_START_HOUR),endHour:Number(s.SEND_END_HOUR),maxFollowups:Number(s.MAX_FOLLOWUPS),version:outreachAdminControlVersion_(s)};}
function outreachAdminSponsor_(r,map){const get=k=>String(r[map[k]]||'');return {id:get('campaign_id'),name:get('organization_name')||get('brand_name')||get('legal_entity'),email:get('email_primary'),
  communicationStatus:get('reply_status')||get('automation_status')||get('send_status'),mailDeliveryStatus:get('central_delivery_status'),mailDeliveryCheckedAt:r[map.central_delivery_checked_at] instanceof Date?r[map.central_delivery_checked_at].getTime():null,giftStatus:get(OUTREACH_ADMIN_FIELDS.giftStatus)||'Neověřeno',contractStatus:get(OUTREACH_ADMIN_FIELDS.contractStatus)||'Neověřeno',logoStatus:get(OUTREACH_ADMIN_FIELDS.logoStatus)||'Neověřeno',note:get(OUTREACH_ADMIN_FIELDS.note),...Object.fromEntries(['giftDescription','receivedDescription','deliveryStatus','contractReference','promotion'].map(k=>[k,get(OUTREACH_ADMIN_FIELDS[k])])),version:outreachAdminHash_(r)};}
function setupOutreachAdmin(){
  v200Owner_();const d=outreachAdminRows_();const missing=Object.values(OUTREACH_ADMIN_FIELDS).filter(h=>!d.headers.includes(h));
  if(missing.length){const end=d.headers.length+missing.length,max=d.sheet.getMaxColumns();if(max<end)d.sheet.insertColumnsAfter(max,end-max);d.sheet.getRange(1,d.headers.length+1,1,missing.length).setValues([missing]);}
  // This setup adds columns only. It does not change limits, schedule, providers or pause switches.
}
function outreachAdminLedger_(){
  const id=PropertiesService.getScriptProperties().getProperty('OPS_SPREADSHEET_ID');if(!id)throw Error('BRIDGE_NOT_CONFIGURED');
  const b=SpreadsheetApp.openById(id);let s=b.getSheetByName('_Admin_sponsors');
  const h=['command_id','fingerprint','actor','operation','state','result','created_at','finished_at'];
  if(!s){s=b.insertSheet('_Admin_sponsors');s.appendRow(h);SpreadsheetApp.flush();}
  else if(JSON.stringify(s.getRange(1,1,1,8).getValues()[0])!==JSON.stringify(h))throw Error('BRIDGE_SCHEMA');return s;
}
function doPost(e){
  let result;try{if(!e||!e.postData||e.postData.contents.length>12000)throw Error('REJECTED');result=outreachAdmin_(JSON.parse(e.postData.contents));}catch(_){result={status:'error',code:'REJECTED'};}
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}
function outreachAdmin_(d){
  let lock;try{
    outreachAdminVerify_(d);if(!['health','campaign','configureCampaign','resumeCampaign','sponsors','sponsor','history','commandStatus','pauseCampaign','updateSponsor'].includes(d.op))throw Error('REJECTED');
    lock=LockService.getScriptLock();if(!lock.tryLock(5000))throw Error('BUSY');
    const settings=outreachAdminSettings_(),p=PropertiesService.getScriptProperties();
    if(d.op==='campaign')return {status:'success',data:outreachAdminControl_(settings)};
    if(d.op==='health')return {status:'success',data:{release:'central-admin-v1',checkedAt:Date.now(),provider:typeof rdOutreachUsesCentral_==='function'&&rdOutreachUsesCentral_()?'CENTRAL_SMTP2GO':settings.SENDER_PROVIDER||'Neověřeno',queueRunning:settings.V16_QUEUE_RUNNING==='TRUE',state:p.getProperty('V200_STATE')||'Neověřeno',remainingRecipients:MailApp.getRemainingDailyQuota(),lastHeartbeat:p.getProperty('V200_HEARTBEAT'),version:outreachAdminHash_([settings.CAMPAIGN_ENABLED,settings.V16_QUEUE_RUNNING])}};
    let data;if(['sponsors','sponsor','updateSponsor'].includes(d.op))data=outreachAdminRows_();
    if(d.op==='sponsors'){
      const q=String(d.args.q||'').slice(0,120).toLowerCase(),offset=Math.max(0,parseInt(d.args.cursor||'0',10)||0);
      const rows=data.rows.filter(r=>r[data.map.campaign_id]).map(r=>outreachAdminSponsor_(r,data.map)).filter(r=>!q||[r.name,r.email,r.id].some(v=>v.toLowerCase().includes(q)));
      return {status:'success',data:{items:rows.slice(offset,offset+40),nextCursor:offset+40<rows.length?String(offset+40):null,total:rows.length,checkedAt:Date.now()}};
    }
    if(d.op==='sponsor'){const row=data.rows.find(r=>String(r[data.map.campaign_id])===d.args.id);if(!row)throw Error('NOT_FOUND');return {status:'success',data:{item:outreachAdminSponsor_(row,data.map)}};}
    const ledger=outreachAdminLedger_(),all=ledger.getLastRow()>1?ledger.getRange(2,1,ledger.getLastRow()-1,8).getValues():[];
    if(d.op==='commandStatus'){const row=all.find(r=>r[0]===d.args.id&&r[2]===d.actor);return {status:'success',data:row?{state:row[4],result:row[5]?JSON.parse(row[5]):null}:{state:'not_found'}};}
    if(d.op==='history')return {status:'success',data:{items:all.slice(-100).reverse().map(r=>({id:r[0],actor:r[2],operation:r[3],state:r[4],createdAt:r[6]}))}};
    if(!/^[a-f0-9-]{36}$/i.test(d.commandId||''))throw Error('REJECTED');const fingerprint=outreachAdminHash_([d.actor,d.op,d.args,d.expectedVersion||'']);
    const prior=all.find(r=>r[0]===d.commandId);if(prior){if(prior[1]!==fingerprint)throw Error('COMMAND_CONFLICT');if(prior[4]==='done'||prior[4]==='rejected')return JSON.parse(prior[5]);throw Error('COMMAND_UNCERTAIN');}
    ledger.appendRow([d.commandId,fingerprint,d.actor,d.op,'pending','',new Date(),'']);SpreadsheetApp.flush();const index=ledger.getLastRow();let result;
    try{
      if(['configureCampaign','resumeCampaign'].includes(d.op)){
        if(outreachAdminControlVersion_(settings)!==d.expectedVersion)throw Error('CONFLICT');
        if(typeof rdOutreachUsesCentral_!=='function'||!rdOutreachUsesCentral_())throw Error('REJECTED');
        let fields;
        if(d.op==='configureCampaign'){
          const a=d.args;if(settings.CAMPAIGN_ENABLED==='TRUE'||settings.V16_QUEUE_RUNNING==='TRUE'||!['PILOT','LIVE'].includes(a.mode)||!Number.isInteger(a.dailyLimit)||a.dailyLimit<1||a.dailyLimit>200||!Array.isArray(a.days)||!a.days.length||a.days.length>7||a.days.some(x=>!Number.isInteger(x)||x<1||x>7)||!Number.isInteger(a.startHour)||!Number.isInteger(a.endHour)||a.startHour<0||a.endHour>24||a.startHour>=a.endHour||!Number.isInteger(a.maxFollowups)||a.maxFollowups<0||a.maxFollowups>3)throw Error('REJECTED');
          fields={MODE:a.mode,DAILY_SEND_LIMIT:String(a.dailyLimit),SEND_WEEKDAYS:[...new Set(a.days)].sort().map(x=>['MON','TUE','WED','THU','FRI','SAT','SUN'][x-1]).join(','),SEND_START_HOUR:String(a.startHour),SEND_END_HOUR:String(a.endHour),MAX_FOLLOWUPS:String(a.maxFollowups)};
        }else{
          if(d.args.confirmation!=='SPUSTIT KAMPAŇ'||!['LIVE','PILOT'].includes(settings.MODE)||p.getProperty('V201_DMARC_STATE')!=='OK'||!Number.isInteger(Number(settings.DAILY_SEND_LIMIT))||Number(settings.DAILY_SEND_LIMIT)<1||Number(settings.DAILY_SEND_LIMIT)>200)throw Error('REJECTED');
          const handlers=ScriptApp.getProjectTriggers().map(t=>t.getHandlerFunction());if(!handlers.includes('v16QueueTick'))throw Error('REJECTED');
          rdOutreachWindow_(settings);fields={CAMPAIGN_ENABLED:'TRUE',V16_QUEUE_RUNNING:'TRUE'};
        }
        const sheet=outreachAdminBook_().getSheetByName('SETTINGS'),rows=sheet.getDataRange().getValues();
        if(Object.keys(fields).some(k=>rows.findIndex(r=>r[0]===k)<1))throw Error('REJECTED');
        for(const [key,value]of Object.entries(fields))sheet.getRange(rows.findIndex(r=>r[0]===key)+1,2).setValue(value);
        SpreadsheetApp.flush();result={status:'success',data:outreachAdminControl_({...settings,...fields})};
      }else if(d.op==='pauseCampaign'){
        if(outreachAdminHash_([settings.CAMPAIGN_ENABLED,settings.V16_QUEUE_RUNNING])!==d.expectedVersion)throw Error('CONFLICT');
        const s=outreachAdminBook_().getSheetByName('SETTINGS'),values=s.getDataRange().getValues();
        for(const key of ['CAMPAIGN_ENABLED','V16_QUEUE_RUNNING']){const i=values.findIndex(r=>r[0]===key);if(i<1)throw Error('BRIDGE_SCHEMA');s.getRange(i+1,2).setValue('FALSE');}
        SpreadsheetApp.flush();if(typeof rdOutreachUsesCentral_==='function'&&rdOutreachUsesCentral_())rdDeliveryTick_('sponsors',false,rdOutreachWindow_(settings));result={status:'success',data:{paused:true}};
      }else{
        const i=data.rows.findIndex(r=>String(r[data.map.campaign_id])===d.args.id);if(i<0)throw Error('NOT_FOUND');const row=data.rows[i];
        if(outreachAdminHash_(row)!==d.expectedVersion)throw Error('CONFLICT');const fields=d.args.fields;
        if(!fields||typeof fields!=='object'||Array.isArray(fields)||Object.keys(fields).some(k=>!Object.prototype.hasOwnProperty.call(OUTREACH_ADMIN_FIELDS,k)))throw Error('REJECTED');
        const options={giftStatus:['Neověřeno','Domluveno','Doručeno','Nepřijato'],contractStatus:['Neověřeno','Není potřeba','Připravuje se','Podepsáno'],logoStatus:['Neověřeno','Vyžádáno','Dodáno','Schváleno'],deliveryStatus:['Neověřeno','Čekáme','Na cestě','Převzato','Nevyzvednuto']};
        const next=[...row];for(const [field,value]of Object.entries(fields)){
          const col=data.map[OUTREACH_ADMIN_FIELDS[field]];if(col===undefined)throw Error('BRIDGE_SCHEMA');if(typeof value!=='string'||value.length>(options[field]?100:1500)||options[field]&&!options[field].includes(value))throw Error('REJECTED');
          next[col]=/^[\s]*[=+@-]/.test(value)?"'"+value:value;
        }
        // Only metadata cells are written. Never replace source formulas, mail flags or approvals.
        for(const field of Object.keys(fields)){const col=data.map[OUTREACH_ADMIN_FIELDS[field]];data.sheet.getRange(i+2,col+1).setValue(next[col]);}
        SpreadsheetApp.flush();result={status:'success',data:{item:outreachAdminSponsor_(next,data.map)}};
      }
    }catch(error){if(['CONFLICT','NOT_FOUND','REJECTED'].includes(error.message))result={status:'error',code:error.message};else throw Error('COMMAND_UNCERTAIN');}
    ledger.getRange(index,5,1,4).setValues([[result.status==='success'?'done':'rejected',JSON.stringify(result),ledger.getRange(index,7).getValues()[0][0],new Date()]]);SpreadsheetApp.flush();return result;
  }catch(error){return {status:'error',code:['AUTH','BRIDGE_NOT_CONFIGURED','CONFLICT','COMMAND_CONFLICT','COMMAND_UNCERTAIN','NOT_FOUND','REJECTED','BUSY'].includes(error.message)?error.message:'BRIDGE_UNAVAILABLE'};}
  finally{if(lock&&lock.hasLock())lock.releaseLock();}
}
