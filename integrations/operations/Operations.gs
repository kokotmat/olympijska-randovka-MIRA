/* Independent operations checks and off-provider data snapshots. No credentials are backed up. */
function rdOpsSource_(){return typeof V200!=='undefined'?'sponsors':'reservations';}
function rdOpsRequest_(op,args){
 const source=rdOpsSource_(),secret=PropertiesService.getScriptProperties().getProperty('ADMIN_BRIDGE_SECRET')||'';if(secret.length<32)throw Error('OPS_NOT_CONFIGURED');
 const d={source:source,op:op,args:args,ts:Date.now(),nonce:Utilities.getUuid()};
 d.signature=Utilities.computeHmacSha256Signature(JSON.stringify(['randovka-ops-v1',d.ts,d.nonce,source,op,args]),secret,Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');
 const r=UrlFetchApp.fetch('https://olympijskarandovka.cz/api/ops',{method:'post',contentType:'text/plain',payload:JSON.stringify(d),muteHttpExceptions:true});let body;try{body=JSON.parse(r.getContentText());}catch(_){throw Error('OPS_UNREADABLE');}if(r.getResponseCode()!==200||body.status!=='success')throw Error(body.code||'OPS_UNAVAILABLE');return body.data;
}
function rdOpsDay_(){return Utilities.formatDate(new Date(),'Europe/Prague','yyyy-MM-dd');}
function rdOpsHash_(bytes){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,bytes).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');}
function rdOpsBackup_(){
 const p=PropertiesService.getScriptProperties(),day=rdOpsDay_(),source=rdOpsSource_();if(p.getProperty('OPS_BACKUP_DAY')===day)return;
 const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;
 let blob;try{
  const ids=[source==='sponsors'?V200.ID:R.spreadsheet,p.getProperty('OPS_SPREADSHEET_ID')].filter(Boolean),books=[];
  for(const id of [...new Set(ids)]){const book=SpreadsheetApp.openById(id),sheets=[];for(const sheet of book.getSheets()){
   if(sheet.getName()==='_Central_snapshot')continue;const range=sheet.getDataRange();
   sheets.push({name:sheet.getName(),id:sheet.getSheetId(),frozenRows:sheet.getFrozenRows(),frozenColumns:sheet.getFrozenColumns(),values:range.getValues().map(row=>row.map(v=>v instanceof Date?{date:v.toISOString()}:v)),formulas:range.getFormulas(),numberFormats:range.getNumberFormats()});
  }books.push({id:id,name:book.getName(),timezone:book.getSpreadsheetTimeZone(),sheets:sheets});}
  blob=Utilities.gzip(Utilities.newBlob(JSON.stringify({format:'sheets-json-v1',source:source,createdAt:new Date().toISOString(),books:books}),'application/json'));
 }finally{lock.releaseLock();}
 const bytes=blob.getBytes(),payload=Utilities.base64Encode(bytes);if(payload.length>1500000)throw Error('OPS_BACKUP_TOO_LARGE');
 const saved=rdOpsRequest_('backup',{day:day,format:'sheets-json-gzip-v1',sha256:rdOpsHash_(bytes),payload:payload});
 // Also keep this source's central delivery data outside Cloudflare, in its private operations workbook.
 const data=rdOpsRequest_('export',{}),central=Utilities.gzip(Utilities.newBlob(JSON.stringify(data),'application/json')).getBytes(),encoded=Utilities.base64Encode(central),sha=rdOpsHash_(central),id='ops:'+source+':'+day;
 const book=SpreadsheetApp.openById(p.getProperty('OPS_SPREADSHEET_ID'));let sheet=book.getSheetByName('_Central_snapshot');if(!sheet){sheet=book.insertSheet('_Central_snapshot');sheet.appendRow(['snapshot_id','sha256','chunk','total','gzip_base64']);sheet.hideSheet();}
 const rows=[];for(let offset=0;offset<encoded.length;offset+=45000)rows.push([id,sha,rows.length,Math.ceil(encoded.length/45000),encoded.slice(offset,offset+45000)]);
 const start=sheet.getLastRow()+1;if(sheet.getMaxRows()<start+rows.length)sheet.insertRowsAfter(sheet.getMaxRows(),start+rows.length-sheet.getMaxRows());sheet.getRange(start,1,rows.length,5).setValues(rows);SpreadsheetApp.flush();
 const check=sheet.getRange(start,1,rows.length,5).getValues();if(check.map(r=>r[4]).join('')!==encoded)throw Error('OPS_BACKUP_READBACK_FAILED');
 p.setProperties({OPS_BACKUP_DAY:day,OPS_BACKUP_AT:new Date().toISOString(),OPS_BACKUP_SHA:saved.sha256});
}
function rdOpsAlert_(issues){
 const p=PropertiesService.getScriptProperties(),key=issues.slice().sort().join('|');if(!key){p.setProperty('OPS_FAIL_COUNT','0');return;}
 const count=Number(p.getProperty('OPS_FAIL_COUNT')||0)+1;p.setProperty('OPS_FAIL_COUNT',String(count));if(count<2)return;
 const last=Number(p.getProperty('OPS_ALERT_AT')||0);if(p.getProperty('OPS_ALERT_KEY')===key&&Date.now()-last<6*3600000)return;
 const day=rdOpsDay_(),sent=p.getProperty('OPS_ALERT_DAY')===day?Number(p.getProperty('OPS_ALERT_COUNT')||0):0;if(sent>=3)return;
 if(MailApp.getRemainingDailyQuota()<1){console.log('OPS_ALERT_QUOTA_EMPTY');return;}
 MailApp.sendEmail({to:'vasik.resl@gmail.com',subject:'Randovka – provozní upozornění',body:'Automatická kontrola zjistila: '+key+'\n\nStav a doporučené řešení: https://sprava.olympijskarandovka.cz/sprava/\nBez obsahu zpráv a údajů sponzorů.',name:'Randovka · provoz'});
 p.setProperties({OPS_ALERT_KEY:key,OPS_ALERT_AT:String(Date.now()),OPS_ALERT_DAY:day,OPS_ALERT_COUNT:String(sent+1)});
}
function rdOperationsTick(){
 if(Session.getEffectiveUser().getEmail().toLowerCase()!=='maturitni.ples@olympijskarandovka.cz')throw Error('OPS_OWNER_ONLY');
 const issues=[];try{rdOpsBackup_();}catch(_){issues.push('OPS_BACKUP_FAILED');}
 if(rdOpsSource_()==='sponsors'){try{const status=rdOpsRequest_('check',{});issues.push(...status.issues);for(const source of ['sponsors','reservations','assistant']){const b=status.backups.find(x=>x.source===source);if(!b||Date.now()-b.created_at>36*3600000)issues.push('BACKUP_'+source.toUpperCase()+'_STALE');}}catch(_){issues.push('CENTRAL_CHECK_UNAVAILABLE');}}
 try{rdOpsRequest_('report',{state:issues.length?'error':'ok',issues:[...new Set(issues)]});}catch(_){issues.push('OPS_REPORT_UNAVAILABLE');}
 if(rdOpsSource_()==='sponsors')rdOpsAlert_([...new Set(issues)]);
 console.log(JSON.stringify({operations:rdOpsSource_(),issues:[...new Set(issues)],backupDay:PropertiesService.getScriptProperties().getProperty('OPS_BACKUP_DAY')}));
}
function installOperations(){
 if(Session.getEffectiveUser().getEmail().toLowerCase()!=='maturitni.ples@olympijskarandovka.cz')throw Error('OPS_OWNER_ONLY');
 if(!ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='rdOperationsTick'))ScriptApp.newTrigger('rdOperationsTick').timeBased().everyMinutes(15).create();
 rdOperationsTick();
}
