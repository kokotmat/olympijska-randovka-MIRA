/** Narrow server-to-server administration. No sales/gate opening or credential changes. */
const ADMIN_RELEASE='central-admin-v1';
function adminEnvelope_(d){
  const p=props_(),secret=p.getProperty('ADMIN_BRIDGE_SECRET')||'';
  const allowed=String(p.getProperty('ADMIN_ALLOWED_EMAILS')||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
  if(secret.length<32||!allowed.length)throw Error('BRIDGE_NOT_CONFIGURED');
  if(d.v!==1||!Number.isSafeInteger(d.ts)||Math.abs(Date.now()-d.ts)>120000||!/^[a-f0-9-]{36}$/i.test(d.nonce||'')||!allowed.includes(d.actor)||typeof d.op!=='string'||!d.args||typeof d.args!=='object'||Array.isArray(d.args))throw Error('AUTH');
  const value=JSON.stringify(['randovka-admin-v1',d.ts,d.nonce,d.op,d.actor,d.commandId||'',d.expectedVersion||'',d.args]);
  const expected=Utilities.computeHmacSha256Signature(value,secret,Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');
  if(!sameSecret_(expected,d.signature))throw Error('AUTH');
  const cache=CacheService.getScriptCache(),key='admin-nonce:'+d.nonce;
  if(cache.get(key))throw Error('AUTH');cache.put(key,'1',180);
}
function adminOrder_(r){
  return {id:String(r[R.col.id]),name:String(r[1]),email:String(r[2]),ticketType:String(r[3]),count:Number(r[4]),
    total:Number(r[5]),vs:String(r[6]),status:String(r[7]),table:String(r[9]),confirmation:String(r[R.col.confirmation]),
    tickets:String(r[R.col.tickets]),received:Number(r[R.col.received]||0),note:String(r[R.col.note]||''),
    createdAt:date_(r[0]),dueAt:date_(r[R.col.due]),changedAt:date_(r[R.col.changed]),version:digest_(JSON.stringify(r))};
}
function adminLedger_(){
  const id=props_().getProperty('OPS_SPREADSHEET_ID');if(!id)throw Error('BRIDGE_NOT_CONFIGURED');
  const b=SpreadsheetApp.openById(id),name='_Admin_commands';let s=b.getSheetByName(name);
  const h=['command_id','fingerprint','actor','operation','state','result','created_at','finished_at'];
  if(!s){s=b.insertSheet(name);s.appendRow(h);SpreadsheetApp.flush();}
  else if(JSON.stringify(s.getRange(1,1,1,h.length).getValues()[0])!==JSON.stringify(h))throw Error('BRIDGE_SCHEMA');
  return s;
}
function adminBridge_(d){
  try{
    adminEnvelope_(d);
    const read=['health','orders','order','history','commandStatus'];
    const write=['cancelOrder','retryMail','closeSales','closeGate'];
    if(!read.includes(d.op)&&!write.includes(d.op))throw Error('REJECTED');
    return withLock_(()=>{
      const c=cfg_(),s=sheet_(c);
      if(d.op==='health')return {status:'success',data:{...operationsHealth_(),release:ADMIN_RELEASE,checkedAt:Date.now()}};
      if(d.op==='orders'){
        const q=String(d.args.q||'').slice(0,120).toLowerCase(),offset=Math.max(0,parseInt(d.args.cursor||'0',10)||0);
        const data=rows_(s).filter(r=>r[1]&&r[R.col.id]).reverse().filter(r=>!q||[r[1],r[2],r[6],r[R.col.id]].some(v=>String(v).toLowerCase().includes(q)));
        return {status:'success',data:{items:data.slice(offset,offset+40).map(adminOrder_),nextCursor:offset+40<data.length?String(offset+40):null,total:data.length,mode:c.mode,checkedAt:Date.now()}};
      }
      if(d.op==='order'){
        const f=findOrder_(s,String(d.args.id||''));if(!f)throw Error('NOT_FOUND');
        return {status:'success',data:{item:adminOrder_(f.row),mode:c.mode,checkedAt:Date.now()}};
      }
      const ledger=adminLedger_();
      if(d.op==='commandStatus'){
        const rows=ledger.getLastRow()>1?ledger.getRange(2,1,ledger.getLastRow()-1,8).getValues():[];
        const row=rows.find(r=>r[0]===d.args.id&&r[2]===d.actor);
        return {status:'success',data:row?{state:row[4],result:row[5]?JSON.parse(row[5]):null}:{state:'not_found'}};
      }
      if(d.op==='history'){
        const start=Math.max(2,ledger.getLastRow()-49),height=ledger.getLastRow()-start+1;
        return {status:'success',data:{items:height>0?ledger.getRange(start,1,height,8).getValues().reverse().map(r=>({id:r[0],actor:r[2],operation:r[3],state:r[4],createdAt:date_(r[6]),finishedAt:date_(r[7])})):[],checkedAt:Date.now()}};
      }
      if(!/^[a-f0-9-]{36}$/i.test(d.commandId||''))throw Error('REJECTED');
      const fingerprint=digest_(JSON.stringify([d.actor,d.op,d.args,d.expectedVersion||'']));
      const all=ledger.getLastRow()>1?ledger.getRange(2,1,ledger.getLastRow()-1,8).getValues():[],prior=all.find(r=>r[0]===d.commandId);
      if(prior){if(prior[1]!==fingerprint)throw Error('COMMAND_CONFLICT');if(prior[4]==='done'||prior[4]==='rejected')return JSON.parse(prior[5]);throw Error('COMMAND_UNCERTAIN');}
      ledger.appendRow([d.commandId,fingerprint,text_(d.actor),d.op,'pending','',new Date(),'']);SpreadsheetApp.flush();
      const index=ledger.getLastRow();let result;
      try{
        if(d.op==='closeSales'||d.op==='closeGate'){
          const name=d.op==='closeSales'?'SALES_OPEN':'SCANNER_OPEN';
          const version=digest_(JSON.stringify([c.mode,c.open,c.gate]));if(d.expectedVersion!==version)throw Error('CONFLICT');
          props_().setProperty(name,'false');result={status:'success',data:{closed:true,mode:c.mode}};
        }else{
          const f=findOrder_(s,String(d.args.id||''));if(!f)throw Error('NOT_FOUND');
          if(adminOrder_(f.row).version!==d.expectedVersion)throw Error('CONFLICT');
          if(d.op==='cancelOrder'){
            if(f.row[7]!==R.waiting||Number(f.row[R.col.received])>0)throw Error('REJECTED');
            f.row[7]=R.cancelled;f.row[R.col.changed]=new Date();f.row[R.col.note]='Zrušeno správcem přes centrální administraci.';
          }else{
            const col=statusPaid_(String(f.row[7]))?R.col.tickets:R.col.confirmation,state=String(f.row[col]||'');
            if(!state.startsWith('CHYBA')&&!state.startsWith('NEJASNÉ'))throw Error('REJECTED');
            if(state.startsWith('NEJASNÉ')&&d.args.verifiedNotSent!==true)throw Error('REJECTED');
            if(!statusPaid_(String(f.row[7]))&&f.row[7]!==R.waiting)throw Error('REJECTED');
            f.row[col]='ČEKÁ';f.row[R.col.changed]=new Date();
          }
          write_(s,f.index,f.row);SpreadsheetApp.flush();result={status:'success',data:{item:adminOrder_(f.row),mode:c.mode}};
        }
      }catch(error){
        if(['CONFLICT','NOT_FOUND','REJECTED'].includes(error.message))result={status:'error',code:error.message};
        else throw Error('COMMAND_UNCERTAIN');
      }
      ledger.getRange(index,5,1,4).setValues([[result.status==='success'?'done':'rejected',JSON.stringify(result),ledger.getRange(index,7).getValues()[0][0],new Date()]]);SpreadsheetApp.flush();return result;
    },5000);
  }catch(error){return {status:'error',code:['AUTH','BRIDGE_NOT_CONFIGURED','CONFLICT','COMMAND_CONFLICT','COMMAND_UNCERTAIN','NOT_FOUND','REJECTED','BUSY'].includes(error.message)?error.message:'BRIDGE_UNAVAILABLE'};}
}
