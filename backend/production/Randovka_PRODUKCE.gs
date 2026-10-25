/** Olympijská Randovka 2027. Install the bundled Randovka_PRODUKCE.gs only.
 * Secrets belong in Script Properties. setupSystem() never opens live sales.
 * First 12 columns remain compatible with the original reservation sheet.
 */
const R = Object.freeze({
  spreadsheet: '1kvTNS2e6IsavmOCOQG__3htPBcISzadckq_Fz0jHziA',
  liveSheet: 'Sheet1', testSheet: 'Test_rezervace_PRO', timezone: 'Europe/Prague',
  standing: 'Základní vstupenka', seated: 'Místenka ke stolu',
  waiting: 'Čeká na platbu', paid: 'Zaplaceno', expired: 'Zrušeno - Nezaplaceno',
  late: 'Pozdní platba – ruční kontrola', cancelled: 'Zrušeno',
  headers: ['Timestamp','Jméno','Email','Typ','Kusů','Cena','VS','Status','Vstupenka Hash',
    'Vybraný stůl','Rozdělit do samostatných PDF','Použité kódy','Request ID','Otisk požadavku',
    'ID objednávky','Splatnost','Potvrzení e-mail','Vstupenky e-mail','Přijato Kč','Poznámka systému','Změna stavu'],
  col: {request:12, fingerprint:13, id:14, due:15, confirmation:16, tickets:17, received:18, note:19, changed:20}
});

function props_() { return PropertiesService.getScriptProperties(); }
function ui_() { try{return SpreadsheetApp.getUi();}catch(_){return null;} }
function notify_(message) { const ui=ui_();if(ui)ui.alert(message);else console.log(message);return message; }
function cfg_() {
  const p=props_().getProperties();
  const mode=p.RUN_MODE || 'test';
  if (!['test','live'].includes(mode)) throw new Error('Neplatný RUN_MODE.');
  return {mode,open:p.SALES_OPEN==='true'&&p.SALES_OPEN_MODE===mode,gate:p.SCANNER_OPEN==='true'&&p.SCANNER_OPEN_MODE===mode,iban:(p.IBAN || 'CZ2720100000002403476467').replace(/\s/g,''),
    token:p.FIO_TOKEN || '',pin:p.SCANNER_PIN || '',secret:p.SESSION_SECRET || '',
    url:p.SCRIPT_URL || '',reply:p.REPLY_TO || 'listky.randovka@gmail.com',
    testMail:p.TEST_RECIPIENT || '',testSend:p.TEST_SEND_EMAILS==='true',
    reservationMinutes:30,graceMinutes:5};
}
function owner_() {
  const a=Session.getActiveUser().getEmail(), b=Session.getEffectiveUser().getEmail();
  if (!a || a!==b) throw new Error('Tuto akci spouštějte z editoru nebo menu vlastníka.');
}
function withLock_(fn, wait) {
  const lock=LockService.getScriptLock();
  if (!lock.tryLock(wait===undefined?20000:wait)) throw new Error('BUSY');
  try { return fn(); } finally { lock.releaseLock(); }
}
function json_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function esc_(v) { return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function text_(v) { return /^[\s]*[=+@\-]/.test(v)?"'"+v:v; }
function digest_(s) { return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,s,Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join(''); }
function sameSecret_(a,b) { const x=digest_(String(a)),y=digest_(String(b));let d=0;for(let i=0;i<x.length;i++)d|=x.charCodeAt(i)^y.charCodeAt(i);return d===0; }
function date_(v) { const t=v instanceof Date?v.getTime():Date.parse(v);return Number.isFinite(t)?t:0; }
function stamp_(v) { return Utilities.formatDate(new Date(v),R.timezone,'dd.MM.yyyy HH:mm'); }
function tables_() { const t={};for(let i=1;i<=70;i++)t['Sál - Stůl '+i]=4;for(let i=1;i<=20;i++)t['Ochoz - Stůl '+i]=4;return t; }
function book_() { return SpreadsheetApp.openById(R.spreadsheet); }
function sheet_(c) {
  const s=book_().getSheetByName(c.mode==='live'?R.liveSheet:R.testSheet);
  if(!s) throw new Error('Chybí inicializace systému.');
  const h=s.getRange(1,1,1,R.headers.length).getValues()[0];
  if(R.headers.some((v,i)=>v!==h[i])) throw new Error('Změněné hlavičky tabulky.');
  return s;
}
function rows_(s) { return s.getLastRow()<2?[]:s.getRange(2,1,s.getLastRow()-1,R.headers.length).getValues(); }
function write_(s,index,row) { s.getRange(index+2,1,1,R.headers.length).setValues([row]); }
function statusPaid_(s) { return s===R.paid || /^Zaplaceno \(Ručně\)/.test(s) || /^Částečně odbaveno \(/.test(s) || /^Odbaveno/.test(s); }
function holds_(s) { return s===R.waiting || statusPaid_(s); }
function ensureNoUnknownStatuses_(rows) {
  rows.forEach(r=>{if(r[1] && !holds_(String(r[7])) && ![R.expired,R.cancelled,R.late].includes(String(r[7])))throw new Error('Neznámý status v tabulce. Opravte jej před prodejem.');});
}
function usage_(rows) {
  const used={standing:0,seated:0,tables:tables_()};
  ensureNoUnknownStatuses_(rows);
  rows.forEach(r=>{
    if(!r[1] || !holds_(String(r[7])))return;
    const count=Number(r[4]);
    if(!Number.isInteger(count)||count<1)throw new Error('Neplatný počet v tabulce.');
    if(r[3]===R.seated){
      if(!Object.prototype.hasOwnProperty.call(used.tables,r[9]))throw new Error('Neplatný stůl v tabulce.');
      used.seated+=count;used.tables[r[9]]-=count;
    }else if(r[3]===R.standing)used.standing+=count;
    else throw new Error('Neznámý typ v tabulce.');
  });
  if(used.standing>240||used.seated>360||Object.values(used.tables).some(n=>n<0))throw new Error('Tabulka překračuje kapacitu.');
  return used;
}

function setupSystem() {
  owner_();
  withLock_(()=>{
    const p=props_(), values=p.getProperties();
    const defaults={RUN_MODE:'test',SALES_OPEN:'false',SCANNER_OPEN:'false',IBAN:'CZ2720100000002403476467',
      REPLY_TO:'listky.randovka@gmail.com',TEST_SEND_EMAILS:'false',
      SESSION_SECRET:Utilities.getUuid()+Utilities.getUuid(),
      SCRIPT_URL:'https://script.google.com/macros/s/AKfycbxeGpwuIH_j1BVdnh2Z7RcRzHhqV1uKxkEl7Qo1WZlK18Fid34421P8HFjbvzF0hBD9/exec',
      FIO_FROM_DATE:Utilities.formatDate(new Date(),R.timezone,'yyyy-MM-dd')};
    Object.keys(defaults).forEach(k=>{if(!values[k])p.setProperty(k,defaults[k]);});
    const book=book_();
    [R.liveSheet,R.testSheet].forEach(name=>{
      const s=book.getSheetByName(name)||book.insertSheet(name);
      if(s.getMaxColumns()<R.headers.length)s.insertColumnsAfter(s.getMaxColumns(),R.headers.length-s.getMaxColumns());
      if(s.getLastRow()===0)s.getRange(1,1,1,R.headers.length).setValues([R.headers]);
      else {
        const old=s.getRange(1,1,1,R.headers.length).getValues()[0];
        if(old.slice(0,12).some((v,i)=>v!==R.headers[i]))throw new Error('Nesouhlasí původní hlavičky listu '+name+'. Nic nemažte.');
        if(old.slice(12).some((v,i)=>v && v!==R.headers[i+12]))throw new Error('Sloupce M:U již používá jiný systém.');
        s.getRange(1,13,1,R.headers.length-12).setValues([R.headers.slice(12)]);
        const rows=rows_(s);
        const allVS=new Set(),allHashes=new Set();
        rows.forEach((r,i)=>{
          if(!r[1])return;
          if(allVS.has(String(r[6])))throw new Error('Duplicitní VS v listu '+name+'.');
          allVS.add(String(r[6]));
          String(r[8]).split(',').filter(Boolean).forEach(hash=>{if(allHashes.has(hash))throw new Error('Duplicitní hash vstupenky.');allHashes.add(hash);});
          if(!r[R.col.id]){
            r[R.col.id]='LEGACY-'+Utilities.getUuid();
            if(!date_(r[0]))throw new Error('Neplatné datum starší objednávky.');
            r[R.col.due]=new Date(date_(r[0])+30*60000);
            r[R.col.confirmation]='LEGACY – ověřit';r[R.col.tickets]='LEGACY – ověřit';
            r[R.col.note]='Import původního řádku; e-maily nejsou automaticky opakovány.';
            r[R.col.changed]=new Date();write_(s,i,r);
          }
        });
        usage_(rows_(s));
      }
      s.setFrozenRows(1);
      s.getRange(1,1,1,R.headers.length).setFontWeight('bold').setBackground('#0081c8').setFontColor('#ffffff');
      s.getRange('G:G').setNumberFormat('@');s.getRange('M:O').setNumberFormat('@');
    });
    ['_Platby_live','_Platby_test'].forEach(name=>{
      const s=book.getSheetByName(name)||book.insertSheet(name);
      if(s.getLastRow()===0)s.appendRow(['ID transakce','Datum','VS','Haléře','Měna']);
    });
  });
  notify_('Připraveno. Prodej nebyl zapnut. Doplňte Script Properties a přečtěte návod.');
}

function validateConfig_(c, live) {
  if(!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(c.url))throw new Error('Doplňte SCRIPT_URL nasazené aplikace /exec.');
  if((live||c.iban)&&(!/^CZ\d{22}$/.test(c.iban)||!validIban_(c.iban)))throw new Error('Neplatný IBAN. Zkopírujte jej přímo z bankovnictví.');
  if(c.pin.length<8 || /^(.)\1+$/.test(c.pin))throw new Error('SCANNER_PIN musí mít nejméně 8 znaků.');
  if(c.secret.length<32)throw new Error('Chybí SESSION_SECRET; spusťte setupSystem.');
  if(live && !/^[A-Za-z0-9]{40,100}$/.test(c.token))throw new Error('Doplňte nový FIO_TOKEN.');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.reply))throw new Error('Neplatné REPLY_TO.');
}
function validIban_(iban) {
  const digits=(iban.slice(4)+iban.slice(0,4)).replace(/[A-Z]/g,c=>String(c.charCodeAt(0)-55));
  let remainder=0;for(const ch of digits)remainder=(remainder*10+Number(ch))%97;return remainder===1;
}
function bankKey_(c) { return digest_(JSON.stringify([c.iban,c.token,props_().getProperty('FIO_FROM_DATE')])); }
function installAutomation() {
  owner_();validateConfig_(cfg_(),cfg_().mode==='live');
  const existing=ScriptApp.getProjectTriggers();
  if(!existing.some(t=>t.getHandlerFunction()==='maintenance_'))ScriptApp.newTrigger('maintenance_').timeBased().everyMinutes(1).create();
  notify_('Automatika nastavena. Prodej zůstává v aktuálním režimu.');
}
function openSales() {
  owner_();const c=cfg_();validateConfig_(c,c.mode==='live');
  if(c.mode==='live'){
    const ui=ui_();
    if(ui&&ui.alert('Spustit ostrý prodej?', 'Vzniknou skutečné rezervace a e-maily. Pokračovat?', ui.ButtonSet.YES_NO)!==ui.Button.YES)return;
    if(!checkPayments_())throw new Error('Nelze ověřit banku. Prodej zatím nezapnut.');
  }
  withLock_(()=>{usage_(rows_(sheet_(c)));props_().setProperty('SALES_OPEN_MODE',c.mode);props_().setProperty('SALES_OPEN','true');});
}
function closeSales() { owner_();props_().setProperty('SALES_OPEN','false'); }
function openGate() {
  owner_();const c=cfg_();validateConfig_(c,c.mode==='live');
  const ui=ui_();if(ui&&ui.alert('Otevřít odbavení – '+c.mode+'?', 'Načtené zaplacené vstupenky budou označovány jako použité.',ui.ButtonSet.YES_NO)!==ui.Button.YES)return;
  props_().setProperty('SCANNER_OPEN_MODE',c.mode);props_().setProperty('SCANNER_OPEN','true');
}
function closeGate() { owner_();props_().setProperty('SCANNER_OPEN','false'); }
function diagnostics() {
  owner_();const c=cfg_();let error='OK';try{validateConfig_(c,c.mode==='live');usage_(rows_(sheet_(c)));}catch(e){error=e.message;}
  return notify_('Spouštějící účet: '+Session.getEffectiveUser().getEmail()+'\nRežim: '+c.mode+'\nProdej: '+c.open+'\nOdbavení: '+c.gate+'\nKontrola: '+error+'\nZbývá adresátů e-mailů dnes: '+MailApp.getRemainingDailyQuota()+'\nPoslední banka: '+(props_().getProperty('BANK_LAST_OK')||'neověřena')+'\nKontrola vstupenek: '+c.url+'?action=scanner');
}
function onOpen() {
  SpreadsheetApp.getUi().createMenu('🎟️ Randovka – rezervace')
    .addItem('Inicializovat / zkontrolovat tabulku','setupSystem')
    .addItem('Diagnostika a odkaz na kontrolu','diagnostics')
    .addItem('Přehled zdraví systému – vytvořit / obnovit','setupOperationsDashboard')
    .addItem('Nainstalovat automatiku','installAutomation')
    .addSeparator().addItem('Otevřít prodej v nastaveném režimu','openSales').addItem('Pozastavit prodej','closeSales')
    .addItem('Otevřít odbavení v nastaveném režimu','openGate').addItem('Uzavřít odbavení','closeGate')
    .addSeparator().addItem('Zpracovat platby a e-maily nyní','runMaintenance')
    .addItem('Vybraný řádek – simulovat platbu v TESTU','simulateTestPayment')
    .addItem('Vybraný řádek – VIP vstupenky zdarma','issueVip')
    .addItem('Vybraný řádek – znovu zařadit e-mail','retrySelectedMail')
    .addItem('Vybraný řádek – zrušit rezervaci','cancelSelected').addToUi();
}

function input_(data) {
  if(!data || typeof data!=='object'||Array.isArray(data))throw new Error('Neplatná data.');
  const name=typeof data.name==='string'?data.name.trim():'';
  const email=typeof data.email==='string'?data.email.trim().toLowerCase():'';
  if(!name||name.length>150||/[\r\n\u0000-\u001f]/.test(name))throw new Error('Vyplňte platné jméno.');
  if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Vyplňte platný e-mail.');
  if(!Number.isInteger(data.count)||data.count<1||data.count>10)throw new Error('Počet musí být celé číslo 1 až 10.');
  if(![R.standing,R.seated].includes(data.ticketType))throw new Error('Neplatný typ vstupenky.');
  const table=typeof data.table==='string'?data.table:'';
  if(data.ticketType===R.seated&&!Object.prototype.hasOwnProperty.call(tables_(),table))throw new Error('Vyberte existující stůl.');
  if(data.ticketType===R.standing&&table)throw new Error('Vstupenka na stání nemá stůl.');
  if(data.oddelenePdf!==undefined&&typeof data.oddelenePdf!=='boolean')throw new Error('Neplatná volba PDF.');
  if(typeof data.requestId!=='string'||!/^[A-Za-z0-9-]{16,80}$/.test(data.requestId))throw new Error('Chybí requestId. Obnovte rezervační formulář.');
  return {name,email,count:data.count,ticketType:data.ticketType,table,separate:data.count>1&&data.oddelenePdf===true,requestId:data.requestId};
}
function orderResponse_(r,c,duplicate) {
  return {status:'success',mode:c.mode,orderId:String(r[R.col.id]),vs:String(r[6]),totalPrice:Number(r[5]),
    reservationStatus:String(r[7]),duplicate:!!duplicate,emailQueued:r[R.col.confirmation]==='ČEKÁ',
    testId:c.mode==='test'?String(r[R.col.id]):undefined};
}
function reserve_(data) {
  const v=input_(data),c=cfg_();validateConfig_(c,c.mode==='live');
  if(data.mode==='test'&&c.mode==='live')throw new Error('Testovací požadavek nesmí do ostrého systému.');
  const fingerprint=digest_(JSON.stringify([v.name,v.email,v.ticketType,v.count,v.table,v.separate]));
  return withLock_(()=>{
    if(cfg_().mode!==c.mode)throw new Error('Režim se změnil. Obnovte formulář.');
    const s=sheet_(c),rows=rows_(s);
    const prior=rows.find(r=>String(r[R.col.request])===v.requestId);
    if(prior){if(prior[R.col.fingerprint]!==fingerprint)throw new Error('requestId již patří jiné objednávce.');return orderResponse_(prior,c,true);}
    if(!cfg_().open)throw new Error('Rezervace jsou nyní pozastavené.');
    if(c.mode==='live'){
      const last=Number(props_().getProperty('BANK_LAST_OK')||0);
      if(Date.now()-last>10*60000||props_().getProperty('BANK_CONFIG_FINGERPRINT')!==bankKey_(c))throw new Error('Ověřování plateb není dostupné. Zkuste to později.');
      const queued=rows.filter(r=>r[R.col.confirmation]==='ČEKÁ'||r[R.col.tickets]==='ČEKÁ').length;
      if(MailApp.getRemainingDailyQuota()<=queued+5)throw new Error('Doručování je nyní vytížené. Zkuste to později.');
    }
    if(rows.filter(r=>String(r[2]).toLowerCase()===v.email&&r[7]===R.waiting).length>=2)throw new Error('Na tento e-mail již čekají dvě nezaplacené rezervace.');
    const u=usage_(rows),seated=v.ticketType===R.seated;
    if((seated?u.seated:u.standing)+v.count>(seated?360:240))throw new Error('Tento typ vstupenek je vyprodaný.');
    if(seated&&u.tables[v.table]<v.count)throw new Error('U tohoto stolu již není dostatek míst.');
    const existing=new Set(rows.map(r=>String(r[6])));let vs;
    do{vs=String(1000000000+parseInt(Utilities.getUuid().replace(/-/g,'').slice(0,12),16)%9000000000);}while(existing.has(vs));
    const id=(c.mode==='test'?'TEST-':'OBJ-')+Utilities.getUuid();
    const hashes=Array.from({length:v.count},()=>Utilities.getUuid());
    const r=[new Date(),text_(v.name),text_(v.email),v.ticketType,v.count,v.count*(seated?450:350),vs,R.waiting,
      hashes.join(','),v.table,v.separate,'',v.requestId,fingerprint,id,new Date(Date.now()+c.reservationMinutes*60000),
      'ČEKÁ','',0,'',new Date()];
    s.appendRow(r);SpreadsheetApp.flush();
    return orderResponse_(r,c,false);
  });
}
function doPost(e) {
  try {
    if(!e||!e.postData||e.postData.contents.length>10000)throw new Error('Neplatný požadavek.');
    const data=JSON.parse(e.postData.contents);
    if(data.action==='adminBridge')return json_(adminBridge_(data));
    if(data.action==='scannerLogin')return json_(scannerLogin(data));
    if(data.action==='scan')return json_(scannerScan(data));
    return json_(reserve_(data));
  }catch(e){return json_({status:'error',code:e.message==='BUSY'?'BUSY':'REJECTED',message:e.message==='BUSY'?'Systém je vytížený. Opakujte se stejným requestId.':e.message});}
}
function doGet(e) {
  const p=e&&e.parameter||{};
  try {
    const c=cfg_();
    if(p.action==='scanner')return HtmlService.createHtmlOutput('<!doctype html><html lang="cs"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Kontrola vstupenek</title><body style="font:20px system-ui;padding:32px"><h1>Kontrola vstupenek</h1><p>Pro kameru a bezpečné přihlášení otevřete skener na webu:</p><a href="https://olympijskarandovka.cz/kontrola-vstupenek.html" target="_top">Otevřít skener Randovky</a></body></html>');
    if(p.action==='validate'&&p.hash)return publicTicket_(p.hash,c);
    if(p.action==='capabilities')return json_({status:'success',mode:c.mode,protocol:'randovka-reservations-v1',salesOpen:c.open,
      sheet:c.mode==='test'?R.testSheet:R.liveSheet,emails:c.mode==='live'||c.testSend,payments:c.mode==='live',tickets:c.mode==='live',
      requiresRequestId:true,scanner:c.url+'?action=scanner'});
    if(p.action==='getTables')return json_(withLock_(()=>usage_(rows_(sheet_(c))).tables));
    return HtmlService.createHtmlOutput('<h1>Olympijská Randovka</h1><p>Rezervační systém.</p>');
  }catch(error){return json_({status:'error',message:error.message==='BUSY'?'Systém je vytížený.':error.message});}
}

// Fio never logs the token or raw account statement. Only known order VS are retained.
function fioSnapshot_(response,c) {
  if(!response||!response.accountStatement)throw new Error('BANK_FORMAT');
  const a=response.accountStatement;
  if(!a.info||String(a.info.iban).replace(/\s/g,'')!==c.iban||a.info.currency!=='CZK')throw new Error('BANK_ACCOUNT');
  if(!Object.prototype.hasOwnProperty.call(a,'transactionList'))throw new Error('BANK_FORMAT');
  if(a.transactionList===null||a.transactionList.transaction===null)return [];
  if(a.transactionList.transaction===undefined)throw new Error('BANK_FORMAT');
  const txs=Array.isArray(a.transactionList.transaction)?a.transactionList.transaction:[a.transactionList.transaction];
  return txs.map(t=>{
    const value=n=>t['column'+n]?t['column'+n].value:null;
    const amount=Number(value(1)),vs=String(value(5)||'').trim(),id=String(value(22)||'');
    return {id,date:value(0),vs,cents:Math.round(amount*100),currency:String(value(14)||'')};
  }).filter(t=>/^\d+$/.test(t.id)&&/^\d{1,10}$/.test(t.vs)&&Number.isSafeInteger(t.cents)&&t.cents>0&&t.currency==='CZK');
}
function reconcile_(s,rows,ledger,txs,c) {
  const ids=new Set(ledger.getLastRow()<2?[]:ledger.getRange(2,1,ledger.getLastRow()-1,1).getValues().map(r=>String(r[0])));
  const known=new Set(rows.filter(r=>r[1]).map(r=>String(r[6])));
  txs.forEach(t=>{if(known.has(t.vs)&&!ids.has(t.id)){ledger.appendRow([t.id,t.date,t.vs,t.cents,t.currency]);ids.add(t.id);}});
  SpreadsheetApp.flush();
  const sums={};
  if(ledger.getLastRow()>1)ledger.getRange(2,1,ledger.getLastRow()-1,5).getValues().forEach(r=>{
    sums[String(r[2])]=(sums[String(r[2])]||0)+Number(r[3]);
  });
  rows.forEach((r,i)=>{
    if(!r[1])return;
    const cents=sums[String(r[6])]||0,previous=Number(r[R.col.received]||0),required=Math.round(Number(r[5])*100);
    let changed=previous!==cents/100;
    r[R.col.received]=cents/100;
    if(cents>=required && required>0 && r[7]===R.waiting){
      r[7]=R.paid;r[R.col.tickets]='ČEKÁ';r[R.col.changed]=new Date();changed=true;
    }else if(cents>0 && [R.expired,R.cancelled].includes(r[7])){
      r[7]=R.late;r[R.col.note]='Platba po uvolnění kapacity. Vyřešte ručně; vstupenky neposílat automaticky.';changed=true;
    }
    if(cents>required&&required>0){r[R.col.note]='Přeplatek '+((cents-required)/100)+' Kč – zkontrolujte.';changed=true;}
    if(changed)write_(s,i,r);
  });
}
function checkPayments_() {
  const c=cfg_();if(c.mode!=='live')return true;
  validateConfig_(c,true);
  const permit=withLock_(()=>{
    const p=props_(),last=Number(p.getProperty('BANK_LAST_ATTEMPT')||0);
    if(Date.now()-last<35000)return false;
    p.setProperty('BANK_LAST_ATTEMPT',String(Date.now()));return true;
  });
  if(!permit)return Date.now()-Number(props_().getProperty('BANK_LAST_OK')||0)<2*60000&&
    !props_().getProperty('BANK_ERROR')&&props_().getProperty('BANK_CONFIG_FINGERPRINT')===bankKey_(c);
  try {
    const since=props_().getProperty('FIO_FROM_DATE');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(since||''))throw new Error('BANK_START_DATE');
    const to=Utilities.formatDate(new Date(),R.timezone,'yyyy-MM-dd');
    const response=UrlFetchApp.fetch('https://fioapi.fio.cz/v1/rest/periods/'+encodeURIComponent(c.token)+'/'+since+'/'+to+'/transactions.json',{muteHttpExceptions:true});
    if(response.getResponseCode()!==200)throw new Error('BANK_HTTP_'+response.getResponseCode());
    const txs=fioSnapshot_(JSON.parse(response.getContentText()),c);
    withLock_(()=>{
      if(cfg_().mode!=='live')throw new Error('MODE_CHANGED');
      const s=sheet_(c),ledger=book_().getSheetByName('_Platby_live');
      if(!ledger)throw new Error('BANK_LEDGER');
      reconcile_(s,rows_(s),ledger,txs,c);
      props_().setProperty('BANK_LAST_OK',String(Date.now()));props_().deleteProperty('BANK_ERROR');
      props_().setProperty('BANK_CONFIG_FINGERPRINT',bankKey_(c));
      expire_(s,rows_(s),c);
      SpreadsheetApp.flush();
    });return true;
  }catch(error){
    const code=/^BANK_[A-Z0-9_]+$/.test(error.message)?error.message:'BANK_UNAVAILABLE';
    props_().setProperty('BANK_ERROR',code);console.warn(code);return false;
  }
}
function expire_(s,rows,c) {
  // Only after a successful bank snapshot, or for tests. Never cancel during a bank outage.
  const now=Date.now();
  rows.forEach((r,i)=>{
    const delivered=['ODESLÁNO','TEST – neodesílá se'].includes(r[R.col.confirmation]);
    if(r[7]===R.waiting&&delivered&&date_(r[R.col.due])&&now>date_(r[R.col.due])+c.graceMinutes*60000){
      r[7]=R.expired;r[R.col.changed]=new Date();r[R.col.note]='Nezaplaceno po splatnosti a ochranné lhůtě.';write_(s,i,r);
    }
  });
}
function runMaintenance() { owner_();maintenance_(); }
function maintenance_() {
  props_().setProperty('MAINTENANCE_LAST_STARTED',String(Date.now()));
  try{
    const c=cfg_();
    if(c.mode==='live')checkPayments_();
    else withLock_(()=>{const s=sheet_(c);expire_(s,rows_(s),c);});
    sendOutbox_();
    props_().setProperty('MAINTENANCE_LAST_OK',String(Date.now()));props_().deleteProperty('MAINTENANCE_ERROR');
  }catch(error){
    props_().setProperty('MAINTENANCE_ERROR','MAINTENANCE_FAILED');props_().setProperty('MAINTENANCE_LAST_ERROR_AT',String(Date.now()));throw error;
  }finally{
    try{updateOperationsDashboard_();}catch(_){console.warn('DASHBOARD_UPDATE_FAILED');}
  }
}

function qrBlob_(data,name) {
  const qr=qrcode(0,'M');qr.addData(data,'Byte');qr.make();
  const uri=qr.createDataURL(5,20);
  return Utilities.newBlob(Utilities.base64Decode(uri.slice(uri.indexOf(',')+1)),'image/gif',name+'.gif');
}
function paymentQr_(r,c) { return qrBlob_('SPD*1.0*ACC:'+c.iban+'*AM:'+Number(r[5]).toFixed(2)+'*CC:CZK*X-VS:'+r[6]+'*MSG:VSTUPENKA PLES 2027','Platba'); }
function ticketPdfs_(r,c) {
  const hashes=String(r[8]).split(',').filter(Boolean),parts=r[10]===true?hashes.map(h=>[h]):[hashes];
  return parts.map((group,part)=>{
    const doc=DocumentApp.create('Randovka-doc-'+Utilities.getUuid()),id=doc.getId();
    try {
      const b=doc.getBody();b.clear();b.setMarginTop(32).setMarginBottom(32).setMarginLeft(40).setMarginRight(40);
      group.forEach((hash,i)=>{
        if(i)b.appendPageBreak();
        const title=b.appendParagraph(c.mode==='test'?'TEST – NEPLATNÁ VSTUPENKA':'OLYMPIJSKÁ RANDOVKA 2027');
        title.setHeading(DocumentApp.ParagraphHeading.HEADING1).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
        b.appendParagraph('22. ledna 2027 • Eurocentrum Jablonec nad Nisou').setAlignment(DocumentApp.HorizontalAlignment.CENTER);
        b.appendParagraph(String(r[1])).setHeading(DocumentApp.ParagraphHeading.HEADING2);
        b.appendParagraph(r[3]+(r[9]?' • '+r[9]:''));
        b.appendParagraph('Vstupenka '+(hashes.indexOf(hash)+1)+' z '+hashes.length+' • VS '+r[6]);
        const p=b.appendParagraph('');p.setAlignment(DocumentApp.HorizontalAlignment.CENTER);
        p.appendInlineImage(qrBlob_(c.url+'?action=validate&hash='+encodeURIComponent(hash),'Vstup')).setWidth(260).setHeight(260);
        b.appendParagraph(c.mode==='test'?'Pouze test. Tento doklad nelze použít k ostrému vstupu.':'Každý QR kód opravňuje k jednomu vstupu. Nezveřejňujte jej.');
      });
      doc.saveAndClose();
      return DriveApp.getFileById(id).getAs(MimeType.PDF).setName((c.mode==='test'?'TEST_':'')+'Vstupenky_'+r[6]+(parts.length>1?'_'+(part+1):'')+'.pdf');
    }finally{try{doc.saveAndClose();}catch(_){}try{DriveApp.getFileById(id).setTrashed(true);}catch(_){console.warn('TEMP_DOCUMENT_CLEANUP_REQUIRED');}}
  });
}
function mailMessage_(r,c,kind) {
  const recipient=c.mode==='test'?c.testMail:String(r[2]);
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient))throw new Error('Neplatný příjemce e-mailu.');
  const prefix=c.mode==='test'?'[TEST – NEPLATNÉ] ':'';
  const safeName=String(r[1]).replace(/^'/,''),title=kind==='confirmation'?'Potvrzení rezervace a pokyny k platbě':'Vaše vstupenky';
  const summary='Jméno: '+safeName+'\nTyp: '+r[3]+'\nPočet: '+r[4]+'\nStůl: '+(r[9]||'Stání')+'\nCelkem: '+r[5]+' Kč\nVS: '+r[6];
  const m={to:recipient,subject:prefix+title+' | Olympijská Randovka 2027',name:'Olympijská Randovka',replyTo:c.reply,
    body:prefix+'Dobrý den, '+safeName+'.\n\n'+summary,attachments:[]};
  let details='';
  if(kind==='confirmation'){
    if(c.mode==='live'){
      const qr=paymentQr_(r,c);m.attachments=[qr];m.inlineImages={payment:qr};
      details='Zaplaťte prosím okamžitým převodem do '+stamp_(r[R.col.due])+'.\nIBAN: '+c.iban+'\nVstupenky obdržíte až po přijetí platby.';
    }else details='TEST: NIC NEPLAŤTE. Testovací objednávka není platnou rezervací pro ostrý ples.';
  }else{m.attachments=ticketPdfs_(r,c);details=c.mode==='test'?'TESTOVACÍ NEPLATNÉ VSTUPENKY.':'Platba byla přijata. Vstupenky najdete v příloze.';}
  m.body+='\n\n'+details;
  m.htmlBody='<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#17263d"><h1 style="color:#0081c8">'+esc_(prefix+title)+'</h1><p>Dobrý den, '+esc_(safeName)+',</p><pre style="font-family:Arial;white-space:pre-wrap;background:#f1f5f9;padding:20px;border-radius:12px">'+esc_(summary)+'</pre><p>'+esc_(details).replace(/\n/g,'<br>')+'</p>'+(m.inlineImages?'<img src="cid:payment" width="220" height="220" alt="Platební QR kód">':'')+'</div>';
  if(m.attachments.reduce((n,b)=>n+b.getBytes().length,0)>20*1024*1024)throw new Error('Přílohy přesahují 20 MB.');
  return m;
}
function findOrder_(s,id) {
  if(s.getLastRow()<2)return null;
  const cell=s.getRange(2,R.col.id+1,s.getLastRow()-1,1).createTextFinder(id).matchEntireCell(true).useRegularExpression(false).findNext();
  return cell?{index:cell.getRow()-2,row:s.getRange(cell.getRow(),1,1,R.headers.length).getValues()[0]}:null;
}
function sendOutbox_() {
  const deadline=Date.now()+4*60000;
  for(let n=0;n<10&&Date.now()<deadline;n++){
    const claim=withLock_(()=>{
      const c=cfg_(),s=sheet_(c),rows=rows_(s);
      for(let i=0;i<rows.length;i++){
        const r=rows[i];if(!r[1])continue;
        for(const kind of ['confirmation','tickets']){
          const col=R.col[kind],state=String(r[col]||'');
          if((state.startsWith('ODESÍLÁ SE:')||state.startsWith('PŘIPRAVUJE SE:'))&&Date.now()-Number(state.split(':')[1])>10*60000){r[col]='NEJASNÉ – ověřit odeslání';write_(s,i,r);continue;}
          if(state!=='ČEKÁ')continue;
          if(kind==='confirmation'&&r[7]!==R.waiting){r[col]='PŘESKOČENO';write_(s,i,r);continue;}
          if(kind==='tickets'&&!statusPaid_(String(r[7]))){r[col]='PŘESKOČENO';write_(s,i,r);continue;}
          if(c.mode==='test'&&!c.testSend){r[col]='TEST – neodesílá se';write_(s,i,r);continue;}
          if(MailApp.getRemainingDailyQuota()<1)return null;
          if(kind==='confirmation')r[R.col.due]=new Date(Date.now()+c.reservationMinutes*60000);
          r[col]='PŘIPRAVUJE SE:'+Date.now();write_(s,i,r);SpreadsheetApp.flush();
          return {c,row:r,kind,col};
        }
      }return null;
    });
    if(!claim)return;
    let message;
    try{message=mailMessage_(claim.row,claim.c,claim.kind);}catch(error){
      withLock_(()=>{const s=sheet_(claim.c),found=findOrder_(s,claim.row[R.col.id]);if(found){found.row[claim.col]='CHYBA PŘÍPRAVY';found.row[R.col.note]='E-mail nelze připravit; ověřte konfiguraci, kvótu dokumentů a přílohy.';write_(s,found.index,found.row);}});continue;
    }
    const allowed=withLock_(()=>{
      if(cfg_().mode!==claim.c.mode)return false;
      const s=sheet_(claim.c),f=findOrder_(s,claim.row[R.col.id]);
      if(!f || !String(f.row[claim.col]).startsWith('PŘIPRAVUJE SE:'))return false;
      if((claim.kind==='tickets'&&!statusPaid_(String(f.row[7])))||(claim.kind==='confirmation'&&f.row[7]!==R.waiting)){f.row[claim.col]='PŘESKOČENO';write_(s,f.index,f.row);return false;}
      f.row[claim.col]='ODESÍLÁ SE:'+Date.now();write_(s,f.index,f.row);SpreadsheetApp.flush();return true;
    });
    if(!allowed)continue;
    let sent=false;
    try{MailApp.sendEmail(message);sent=true;}catch(_){console.warn('MAIL_RESULT_UNKNOWN');}
    withLock_(()=>{const s=sheet_(claim.c),f=findOrder_(s,claim.row[R.col.id]);if(f){f.row[claim.col]=sent?'ODESLÁNO':'NEJASNÉ – ověřit odeslání';write_(s,f.index,f.row);}});
  }
}

function selected_(fn) {
  owner_();const c=cfg_(),s=sheet_(c),active=SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if(active.getSheetId()!==s.getSheetId())throw new Error('Vyberte objednávku v listu aktuálního režimu: '+s.getName());
  const index=active.getActiveCell().getRow()-2;if(index<0)throw new Error('Vyberte řádek objednávky.');
  return withLock_(()=>{const r=s.getRange(index+2,1,1,R.headers.length).getValues()[0];if(!r[1])throw new Error('Prázdný řádek.');return fn(s,index,r,c);});
}
function issueVip() {
  owner_();if(SpreadsheetApp.getUi().alert('VIP vstupenky zdarma','Vybraná objednávka bude označena jako zaplacená ručně a zařazena k odeslání. Pokračovat?',SpreadsheetApp.getUi().ButtonSet.YES_NO)!==SpreadsheetApp.getUi().Button.YES)return;
  selected_((s,i,r)=>{
    if(statusPaid_(String(r[7])))throw new Error('Objednávka už je zaplacená nebo odbavená.');
    if(r[7]!==R.waiting)throw new Error('VIP lze vydat jen pro aktivní rezervaci.');
    r[7]='Zaplaceno (Ručně)';r[R.col.tickets]='ČEKÁ';r[R.col.changed]=new Date();write_(s,i,r);
  });
}
function simulateTestPayment() {
  owner_();if(cfg_().mode!=='test')throw new Error('Simulace je povolena pouze v testovacím režimu.');
  selected_((s,i,r)=>{if(r[7]!==R.waiting)throw new Error('Vyberte čekající testovací rezervaci.');r[7]=R.paid;r[R.col.received]=Number(r[5]);r[R.col.tickets]='ČEKÁ';r[R.col.note]='Simulovaná testovací platba – žádné peníze nebyly přijaty.';r[R.col.changed]=new Date();write_(s,i,r);});
}
function retrySelectedMail() {
  owner_();const ui=SpreadsheetApp.getUi();
  if(ui.alert('Opakovat e-mail?', 'Nejdříve ověřte ve schránce, zda už nebyl odeslán. Opakování může doručit druhou kopii se stejnými QR kódy.',ui.ButtonSet.YES_NO)!==ui.Button.YES)return;
  selected_((s,i,r)=>{r[statusPaid_(String(r[7]))?R.col.tickets:R.col.confirmation]='ČEKÁ';write_(s,i,r);});
}
function cancelSelected() {
  owner_();const ui=SpreadsheetApp.getUi();if(ui.alert('Zrušit rezervaci?', 'Místa budou uvolněna. Pokračovat?',ui.ButtonSet.YES_NO)!==ui.Button.YES)return;
  selected_((s,i,r)=>{if(statusPaid_(String(r[7]))||Number(r[R.col.received])>0)throw new Error('Placené objednávky vyřešte ručně včetně případného vrácení peněz.');r[7]=R.cancelled;r[R.col.changed]=new Date();write_(s,i,r);});
}

// Scanner sessions are signed, mode-bound and expire after 6 hours. PIN never enters a URL.
function sign_(s,c) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(s,c.secret,Utilities.Charset.UTF_8)).replace(/=+$/,''); }
function scannerClient_(data) {
  const secret=props_().getProperty('SCANNER_GATEWAY_SECRET')||'',g=data&&data.gateway;
  if(secret.length<32)throw new Error('Přihlášení není nakonfigurováno. Kontaktujte správce.');
  if(!g||g.v!==2||!Number.isFinite(g.ts)||Math.abs(Date.now()-g.ts)>120000||
    !/^[a-f0-9-]{36}$/.test(String(g.nonce))||!/^\w{64}$/.test(String(g.client))||!/^\w{64}$/.test(String(g.network))||!/^\w{64}$/.test(String(g.signature)))throw new Error('Přihlaste se přes skener na olympijskarandovka.cz.');
  const text=['scanner-login-v2',g.ts,g.nonce,g.client,g.network,digest_(String(data.pin))].join('\n');
  const expected=Utilities.computeHmacSha256Signature(text,secret,Utilities.Charset.UTF_8).map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');
  if(!sameSecret_(g.signature,expected))throw new Error('Neplatný požadavek přihlášení.');
  return {client:g.client,network:g.network};
}
function scannerLogin(data) {
  try {
    const c=cfg_();validateConfig_(c,c.mode==='live');
    const client=scannerClient_(data);
    return withLock_(()=>{
      const p=props_(),now=Date.now(),key='SCANNER_FAIL:'+client.client,networkKey='SCANNER_FAIL:NET:'+client.network;
      // Persistent state cannot disappear on CacheService eviction. Keep one
      // small record per edge-verified address; expired records are pruned.
      const all=p.getProperties();Object.keys(all).filter(k=>k.startsWith('SCANNER_FAIL:')).forEach(k=>{
        try{if(JSON.parse(all[k]).until<=now)p.deleteProperty(k);}catch(_){p.deleteProperty(k);}
      });
      let state={count:0,until:now+300000};try{state=JSON.parse(p.getProperty(key))||state;}catch(_){}
      if(state.until<=now)state={count:0,until:now+300000};
      let network={count:0,until:now+300000};try{network=JSON.parse(p.getProperty(networkKey))||network;}catch(_){}
      if(network.until<=now)network={count:0,until:now+300000};
      if(state.count>=10)throw new Error('Příliš mnoho chybných pokusů na tomto zařízení. Počkejte 5 minut.');
      if(network.count>=100)throw new Error('Síť překročila ochranný limit. Počkejte 5 minut nebo použijte jinou síť.');
      if(!sameSecret_(data.pin,c.pin)){state.count++;network.count++;p.setProperty(key,JSON.stringify(state));p.setProperty(networkKey,JSON.stringify(network));throw new Error('Nesprávný PIN.');}
      p.deleteProperty(key);
      const payload=Utilities.base64EncodeWebSafe(JSON.stringify({exp:Date.now()+6*3600000,mode:c.mode,nonce:Utilities.getUuid()})).replace(/=+$/,'');
      return {status:'success',session:payload+'.'+sign_(payload,c),mode:c.mode,expiresAt:Date.now()+6*3600000};
    },5000);
  }catch(error){return {status:'error',message:error.message==='BUSY'?'Systém je vytížený.':error.message};}
}
function operationsHealth() {
  owner_();const result=operationsHealth_();
  console.log(JSON.stringify(result));return result;
}
function session_(token,c) {
  if(c.secret.length<32)throw new Error('AUTH');
  if(typeof token!=='string'||token.length>1000)throw new Error('AUTH');
  const parts=token.split('.');if(parts.length!==2||!sameSecret_(parts[1],sign_(parts[0],c)))throw new Error('AUTH');
  let d;try{d=JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());}catch(_){throw new Error('AUTH');}
  if(!Number.isFinite(d.exp)||d.exp<Date.now()||d.mode!==c.mode)throw new Error('AUTH');
}
function hash_(value) { const h=String(value||'').trim().toLowerCase();if(!/^[a-z0-9-]{20,100}$/.test(h))throw new Error('INVALID_QR');return h; }
function findHash_(s,hash,c) {
  const cache=CacheService.getScriptCache(),key='ticket:'+c.mode+':'+hash;
  const cached=Number(cache.get(key)||0),last=s.getLastRow();
  const read=row=>row>=2&&row<=last?s.getRange(row,1,1,R.headers.length).getValues()[0]:null;
  let row=cached,r=read(row);
  const matches=values=>values&&String(values[8]).toLowerCase().split(',').map(v=>v.trim()).includes(hash);
  if(!matches(r)){
    const cell=last>1?s.getRange(2,9,last-1,1).createTextFinder(hash).matchCase(false).useRegularExpression(false).findNext():null;
    if(!cell)return null;row=cell.getRow();r=read(row);if(!matches(r))return null;
    cache.put(key,String(row),21600);
  }
  return {row,values:r};
}
function scannerScan(data) {
  try {
    const c=cfg_();session_(data&&data.session,c);const hash=hash_(data.hash);
    return withLock_(()=>{
      if(cfg_().mode!==c.mode)throw new Error('AUTH');
      if(!cfg_().gate)return {status:'error',code:'CLOSED',title:'ODBAVENÍ UZAVŘENO',message:'Správce zatím neotevřel odbavení pro tento režim.'};
      const s=sheet_(c),found=findHash_(s,hash,c);
      if(!found)return {status:'error',code:'NOT_FOUND',title:'NEEXISTUJE',message:'Kód není v databázi tohoto režimu.'};
      const r=found.values,used=String(r[11]||'').toLowerCase().split(',').filter(Boolean);
      if(used.includes(hash))return {status:'error',code:'USED',title:'JIŽ POUŽITO',message:'Tato vstupenka už byla odbavena.',name:String(r[1])};
      if(!statusPaid_(String(r[7])))return {status:'error',code:'UNPAID',title:'NEPLATNÉ',message:'Objednávka není zaplacena nebo byla zrušena.'};
      const count=Number(r[4]),hashes=String(r[8]).split(',').filter(Boolean);
      if(!Number.isInteger(count)||count<1||hashes.length!==count||new Set(hashes).size!==count)throw new Error('Poškozená objednávka. Vyřešte u správce.');
      used.push(hash);
      r[7]=used.length>=count?'Odbaveno (Vstoupil)':'Částečně odbaveno ('+used.length+'/'+count+')';r[11]=used.join(',');r[R.col.changed]=new Date();
      s.getRange(found.row,8,1,R.headers.length-7).setValues([r.slice(7)]);
      SpreadsheetApp.flush();
      return {status:'success',code:'ADMITTED',title:c.mode==='test'?'TEST – POVOLENO':'VSTUP POVOLEN',name:String(r[1]),
        ticketType:r[3],table:r[9],used:used.length,count,mode:c.mode};
    },1500);
  }catch(error){return {status:'error',code:['AUTH','BUSY','INVALID_QR'].includes(error.message)?error.message:'ERROR',
    title:error.message==='BUSY'?'CHVÍLI POČKEJTE':error.message==='AUTH'?'PŘIHLASTE SE':'CHYBA',
    message:error.message==='BUSY'?'Nic nebylo odbaveno tímto požadavkem. Zkuste znovu.':error.message==='AUTH'?'Přihlášení vypršelo.':error.message==='INVALID_QR'?'Neplatný formát QR kódu.':'Kontrola se nezdařila. Opakujte kontrolu; při nejasném výsledku ověřte použití kódu.'};}
}
function publicTicket_(raw,c) {
  let content;
  try{
    const hash=hash_(raw),found=findHash_(sheet_(c),hash,c);
    if(!found)content='Vstupenka nebyla nalezena.';
    else {
      const r=found.values,used=String(r[11]||'').toLowerCase().split(',').includes(hash);
      content=c.mode==='test'?'TESTOVACÍ VSTUPENKA – neplatí pro ostrý vstup.':used?'Tato vstupenka již byla použita.':statusPaid_(String(r[7]))?'Vstupenka je zaplacena. U vstupu ji předložte obsluze.':'Vstupenka není platná pro vstup. Objednávka není zaplacená nebo byla zrušena.';
    }
  }catch(_){content='Neplatný kód vstupenky.';}
  return HtmlService.createHtmlOutput('<!doctype html><html lang="cs"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vstupenka – Randovka</title><body style="font:20px system-ui;padding:30px;background:#f2f6fb;color:#16223c"><h1>Olympijská Randovka</h1><p>'+esc_(content)+'</p><p>Tento náhled neprovádí odbavení.</p><a href="'+esc_(c.url)+'?action=scanner" target="_top">Přihlášení obsluhy</a></body></html>');
}

/** Private operations dashboard. No public HTTP route, no personal order data. */
const OPS_SHEET='_Provoz_rezervaci';
const OPS_TITLE='Randovka · zdraví rezervací';
function operationsHealth_(){
  const c=cfg_(),now=Date.now(),p=props_().getProperties();
  let rows=[],dataError=false,configOk=true;
  try{rows=rows_(sheet_(c));usage_(rows);}catch(_){dataError=true;}
  try{validateConfig_(c,c.mode==='live');}catch(_){configOk=false;}
  const queue=[];let uncertain=0,preparing=0,mailErrors=0,latePayments=0;
  rows.filter(r=>r[1]).forEach(r=>{
    if(r[7]===R.late)latePayments++;
    [R.col.confirmation,R.col.tickets].forEach(col=>{
      const state=String(r[col]||'');
      if(state==='ČEKÁ')queue.push(date_(r[R.col.changed])||date_(r[0])||now);
      if(state.startsWith('NEJASNÉ')||state.startsWith('LEGACY'))uncertain++;
      if(/^(PŘIPRAVUJE SE|ODESÍLÁ SE):/.test(state)){if(now-Number(state.split(':')[1])>600000)uncertain++;else preparing++;}
      if(state.startsWith('CHYBA'))mailErrors++;
    });
  });
  let remainingRecipients=null,maintenanceTrigger=null;
  try{remainingRecipients=MailApp.getRemainingDailyQuota();}catch(_){}
  try{maintenanceTrigger=ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='maintenance_');}catch(_){}
  const age=value=>Number(value)>0?Math.max(0,Math.floor((now-Number(value))/1000)):null;
  const bankMatches=c.mode==='live'&&p.BANK_CONFIG_FINGERPRINT===bankKey_(c);
  return {checkedAt:now,mode:c.mode,salesOpen:c.open,gateOpen:c.gate,configOk,dataError,
    queuedEmails:queue.length,oldestQueuedEmailSeconds:queue.length?Math.max(0,Math.floor((now-Math.min(...queue))/1000)):0,
    uncertainEmails:uncertain,preparingEmails:preparing,mailErrors,latePayments,remainingRecipients,
    bankAgeSeconds:age(p.BANK_LAST_OK),bankLastOk:Number(p.BANK_LAST_OK)||null,bankConfigMatches:bankMatches,
    bankError:/^BANK_[A-Z0-9_]+$/.test(p.BANK_ERROR||'')?p.BANK_ERROR:null,
    maintenanceTrigger,maintenanceAgeSeconds:age(p.MAINTENANCE_LAST_OK),maintenanceLastOk:Number(p.MAINTENANCE_LAST_OK)||null,
    maintenanceError:p.MAINTENANCE_ERROR==='MAINTENANCE_FAILED'?'MAINTENANCE_FAILED':null,
    lastIncidentAt:Number(p.MAINTENANCE_LAST_ERROR_AT)||null,
    controlsVersion:digest_(JSON.stringify([c.mode,c.open,c.gate]))};
}
function setupOperationsDashboard(){
  owner_();
  const id=props_().getProperty('OPS_SPREADSHEET_ID');
  const book=id?SpreadsheetApp.openById(id):SpreadsheetApp.create('Randovka · soukromý přehled zdraví rezervací',40,4);
  if(!id)props_().setProperty('OPS_SPREADSHEET_ID',book.getId());
  let s=book.getSheetByName(OPS_SHEET);
  if(s&&s.getLastRow()>0&&s.getRange(1,1).getValue()!==OPS_TITLE)throw Error('List '+OPS_SHEET+' již obsahuje jiná data. Nic nebylo přepsáno.');
  if(!s){if(!id)s=book.getSheets()[0].setName(OPS_SHEET);else s=book.insertSheet(OPS_SHEET);}
  if(s.getMaxColumns()<4)s.insertColumnsAfter(s.getMaxColumns(),4-s.getMaxColumns());
  s.getRange('A1:D1').merge().setValue(OPS_TITLE).setBackground('#0081c8').setFontColor('#ffffff').setFontSize(20).setFontWeight('bold');
  s.getRange('A2:D2').merge().setValue('Soukromý provozní přehled · automatická aktualizace při údržbě · bez změn objednávek, plateb a e-mailů.').setWrap(true).setFontColor('#475569');
  s.setRowHeight(1,48);s.setRowHeight(2,48);s.setFrozenRows(4);
  s.setColumnWidth(1,210);s.setColumnWidth(2,150);s.setColumnWidth(3,270);s.setColumnWidth(4,430);
  s.getRange('A4:D4').setValues([['Oblast','Stav','Hodnota / poslední ověření','Doporučený postup']]).setBackground('#e8f2fa').setFontWeight('bold');
  refreshOperationsDashboard();
  // Remove only our newly generated dashboard from the link-shared reservation
  // workbook. Original order/payment sheets and their sharing are untouched.
  const original=book_(),legacy=original.getSheetByName(OPS_SHEET);
  if(legacy&&legacy.getRange(1,1).getValue()===OPS_TITLE&&original.getId()!==book.getId())original.deleteSheet(legacy);
  const url=book.getUrl()+'#gid='+s.getSheetId();console.log(url);return url;
}
function refreshOperationsDashboard(){owner_();return updateOperationsDashboard_();}
function updateOperationsDashboard_(){
  const id=props_().getProperty('OPS_SPREADSHEET_ID');if(!id)return null;
  const s=SpreadsheetApp.openById(id).getSheetByName(OPS_SHEET);if(!s)return null;
  if(s.getRange(1,1).getValue()!==OPS_TITLE)throw Error('DASHBOARD_SCHEMA');
  const h=operationsHealth_(),when=t=>t?stamp_(t):'Zatím nezaznamenáno',age=s=>s===null?'Neověřeno':s<60?s+' s':Math.floor(s/60)+' min';
  const bankOk=h.mode==='live'&&h.bankConfigMatches&&!h.bankError&&h.bankAgeSeconds!==null&&h.bankAgeSeconds<600;
  const state=(count,issue)=>h.dataError?'NEOVĚŘENO':count?issue:'OK',total=(count,unit)=>h.dataError?'Data nejsou ověřená':count+' '+unit;
  const rows=[
    ['Aktualizace přehledu','INFORMACE',when(h.checkedAt),'Časy jsou v českém časovém pásmu. Zastaralý čas znamená, že přehled nemusí odpovídat současnosti.'],
    ['Režim',h.mode==='live'?'INFORMACE':'TEST',h.mode==='live'?'Ostrý systém':'Testovací systém','Tento přehled nemění režim systému.'],
    ['Prodej / odbavení','INFORMACE',(h.salesOpen?'Prodej otevřen':'Prodej zavřen')+' · '+(h.gateOpen?'Brána otevřena':'Brána zavřena'),'Zobrazuje aktuální nastavení; nic automaticky neotvírá.'],
    ['Konfigurace',h.configOk?'OK':'CHYBA',h.configOk?'Základní kontroly prošly':'Konfigurace vyžaduje kontrolu','Při chybě spusťte diagnostiku v editoru; tajné hodnoty nejsou součástí přehledu.'],
    ['Integrita rezervací',h.dataError?'CHYBA':'OK',h.dataError?'Nelze ověřit data nebo kapacitu':'Hlavičky, stavy a kapacita ověřeny','Při chybě zkontrolujte hlavičky, počty a stavy objednávek v aktuálním listu.'],
    ['Banka',h.mode==='test'?'TEST':bankOk?'OK':'POZOR',h.mode==='test'?'V testu se banka neověřuje':(h.bankError||(!h.bankConfigMatches?'Chybí ověření aktuální konfigurace':'Stáří: '+age(h.bankAgeSeconds))),'Poslední úspěch: '+when(h.bankLastOk)+'. Čtení přehledu nezavolá banku.'],
    ['E-mailová kvóta',h.remainingRecipients===null?'NEOVĚŘENO':h.remainingRecipients===0?'POZOR':h.remainingRecipients<=h.queuedEmails+5?'POZOR':'OK',h.remainingRecipients===null?'Kvótu se nepodařilo přečíst':h.remainingRecipients+' zbývajících adresátů','Kvóta patří účtu, který skript spouští, a může ji čerpat i jiný skript. Nejde o počet zpráv.'],
    ['Čekající e-maily',h.dataError?'NEOVĚŘENO':h.queuedEmails&&h.oldestQueuedEmailSeconds>300?'POZOR':'OK',h.dataError?'Data nejsou ověřená':h.queuedEmails+' zpráv · nejstarší '+age(h.oldestQueuedEmailSeconds),'Stáří je od poslední změny stavu objednávky; nejde o přesný historický čas zařazení.'],
    ['Příprava / odesílání',state(h.preparingEmails,'INFORMACE'),total(h.preparingEmails,'zpráv'),'Zpracování může chvíli trvat. Neposílejte kopie ručně během běžícího odesílání.'],
    ['Nejisté doručení',state(h.uncertainEmails,'POZOR'),total(h.uncertainEmails,'zpráv'),'Nejdříve ověřte odeslanou poštu. Zpráva se mohla odeslat; neopakujte ji naslepo. Zahrnuje starší importy a zaseklé odesílání.'],
    ['Chyby přípravy e-mailů',state(h.mailErrors,'CHYBA'),total(h.mailErrors,'zpráv'),'Zkontrolujte poznámku u objednávky, kvótu dokumentů a přílohy. Po opravě lze zprávu znovu zařadit přes menu.'],
    ['Pozdní platby',state(h.latePayments,'POZOR'),total(h.latePayments,'objednávek k ruční kontrole'),'Ověřte platbu a kapacitu. Pozdní platba automaticky nezíská uvolněná místa.'],
    ['Automatická údržba',h.maintenanceTrigger===null?'NEOVĚŘENO':!h.maintenanceTrigger||h.maintenanceError?'CHYBA':h.maintenanceAgeSeconds===null||h.maintenanceAgeSeconds>300?'POZOR':'OK',h.maintenanceTrigger===null?'Trigger neověřen':h.maintenanceTrigger?'Trigger existuje · úspěch '+age(h.maintenanceAgeSeconds):'Chybí trigger údržby','Poslední úspěch: '+when(h.maintenanceLastOk)+'. Trigger nastaví vlastník přes menu Nainstalovat automatiku.'],
    ['Poslední incident údržby',h.maintenanceError?'CHYBA':'INFORMACE',when(h.lastIncidentAt),h.maintenanceError?'Poslední běh selhal. Podrobnosti ověřte v historii spuštění Apps Scriptu.':'Historický čas chyby; aktuální stav posuzujte podle řádku automatické údržby.']
  ];
  const range=s.getRange(5,1,rows.length,4);range.setValues(rows).setWrap(true).setVerticalAlignment('middle').setFontSize(11);
  s.setRowHeights(5,rows.length,66);
  const palette={OK:'#e6f4ea',POZOR:'#fff4ce',CHYBA:'#fce8e6',TEST:'#edf2fa',INFORMACE:'#f1f5f9',NEOVĚŘENO:'#fff4ce'};
  s.getRange(5,2,rows.length,1).setBackgrounds(rows.map(r=>[palette[r[1]]])).setFontWeight('bold');
  return h;
}

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

/* QR Code Generator, MIT license:
MIT License

Copyright (c) 2009 Kazuhiko Arase

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

*/
//---------------------------------------------------------------------
//
// QR Code Generator for JavaScript
//
// Copyright (c) 2009 Kazuhiko Arase
//
// URL: http://www.d-project.com/
//
// Licensed under the MIT license:
//  http://www.opensource.org/licenses/mit-license.php
//
// The word 'QR Code' is registered trademark of
// DENSO WAVE INCORPORATED
//  http://www.denso-wave.com/qrcode/faqpatent-e.html
//
//---------------------------------------------------------------------

var qrcode = function() {

  //---------------------------------------------------------------------
  // qrcode
  //---------------------------------------------------------------------

  /**
   * qrcode
   * @param typeNumber 1 to 40
   * @param errorCorrectionLevel 'L','M','Q','H'
   */
  var qrcode = function(typeNumber, errorCorrectionLevel) {

    var PAD0 = 0xEC;
    var PAD1 = 0x11;

    var _typeNumber = typeNumber;
    var _errorCorrectionLevel = QRErrorCorrectionLevel[errorCorrectionLevel];
    var _modules = null;
    var _moduleCount = 0;
    var _dataCache = null;
    var _dataList = [];

    var _this = {};

    var makeImpl = function(test, maskPattern) {

      _moduleCount = _typeNumber * 4 + 17;
      _modules = function(moduleCount) {
        var modules = new Array(moduleCount);
        for (var row = 0; row < moduleCount; row += 1) {
          modules[row] = new Array(moduleCount);
          for (var col = 0; col < moduleCount; col += 1) {
            modules[row][col] = null;
          }
        }
        return modules;
      }(_moduleCount);

      setupPositionProbePattern(0, 0);
      setupPositionProbePattern(_moduleCount - 7, 0);
      setupPositionProbePattern(0, _moduleCount - 7);
      setupPositionAdjustPattern();
      setupTimingPattern();
      setupTypeInfo(test, maskPattern);

      if (_typeNumber >= 7) {
        setupTypeNumber(test);
      }

      if (_dataCache == null) {
        _dataCache = createData(_typeNumber, _errorCorrectionLevel, _dataList);
      }

      mapData(_dataCache, maskPattern);
    };

    var setupPositionProbePattern = function(row, col) {

      for (var r = -1; r <= 7; r += 1) {

        if (row + r <= -1 || _moduleCount <= row + r) continue;

        for (var c = -1; c <= 7; c += 1) {

          if (col + c <= -1 || _moduleCount <= col + c) continue;

          if ( (0 <= r && r <= 6 && (c == 0 || c == 6) )
              || (0 <= c && c <= 6 && (r == 0 || r == 6) )
              || (2 <= r && r <= 4 && 2 <= c && c <= 4) ) {
            _modules[row + r][col + c] = true;
          } else {
            _modules[row + r][col + c] = false;
          }
        }
      }
    };

    var getBestMaskPattern = function() {

      var minLostPoint = 0;
      var pattern = 0;

      for (var i = 0; i < 8; i += 1) {

        makeImpl(true, i);

        var lostPoint = QRUtil.getLostPoint(_this);

        if (i == 0 || minLostPoint > lostPoint) {
          minLostPoint = lostPoint;
          pattern = i;
        }
      }

      return pattern;
    };

    var setupTimingPattern = function() {

      for (var r = 8; r < _moduleCount - 8; r += 1) {
        if (_modules[r][6] != null) {
          continue;
        }
        _modules[r][6] = (r % 2 == 0);
      }

      for (var c = 8; c < _moduleCount - 8; c += 1) {
        if (_modules[6][c] != null) {
          continue;
        }
        _modules[6][c] = (c % 2 == 0);
      }
    };

    var setupPositionAdjustPattern = function() {

      var pos = QRUtil.getPatternPosition(_typeNumber);

      for (var i = 0; i < pos.length; i += 1) {

        for (var j = 0; j < pos.length; j += 1) {

          var row = pos[i];
          var col = pos[j];

          if (_modules[row][col] != null) {
            continue;
          }

          for (var r = -2; r <= 2; r += 1) {

            for (var c = -2; c <= 2; c += 1) {

              if (r == -2 || r == 2 || c == -2 || c == 2
                  || (r == 0 && c == 0) ) {
                _modules[row + r][col + c] = true;
              } else {
                _modules[row + r][col + c] = false;
              }
            }
          }
        }
      }
    };

    var setupTypeNumber = function(test) {

      var bits = QRUtil.getBCHTypeNumber(_typeNumber);

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[Math.floor(i / 3)][i % 3 + _moduleCount - 8 - 3] = mod;
      }

      for (var i = 0; i < 18; i += 1) {
        var mod = (!test && ( (bits >> i) & 1) == 1);
        _modules[i % 3 + _moduleCount - 8 - 3][Math.floor(i / 3)] = mod;
      }
    };

    var setupTypeInfo = function(test, maskPattern) {

      var data = (_errorCorrectionLevel << 3) | maskPattern;
      var bits = QRUtil.getBCHTypeInfo(data);

      // vertical
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 6) {
          _modules[i][8] = mod;
        } else if (i < 8) {
          _modules[i + 1][8] = mod;
        } else {
          _modules[_moduleCount - 15 + i][8] = mod;
        }
      }

      // horizontal
      for (var i = 0; i < 15; i += 1) {

        var mod = (!test && ( (bits >> i) & 1) == 1);

        if (i < 8) {
          _modules[8][_moduleCount - i - 1] = mod;
        } else if (i < 9) {
          _modules[8][15 - i - 1 + 1] = mod;
        } else {
          _modules[8][15 - i - 1] = mod;
        }
      }

      // fixed module
      _modules[_moduleCount - 8][8] = (!test);
    };

    var mapData = function(data, maskPattern) {

      var inc = -1;
      var row = _moduleCount - 1;
      var bitIndex = 7;
      var byteIndex = 0;
      var maskFunc = QRUtil.getMaskFunction(maskPattern);

      for (var col = _moduleCount - 1; col > 0; col -= 2) {

        if (col == 6) col -= 1;

        while (true) {

          for (var c = 0; c < 2; c += 1) {

            if (_modules[row][col - c] == null) {

              var dark = false;

              if (byteIndex < data.length) {
                dark = ( ( (data[byteIndex] >>> bitIndex) & 1) == 1);
              }

              var mask = maskFunc(row, col - c);

              if (mask) {
                dark = !dark;
              }

              _modules[row][col - c] = dark;
              bitIndex -= 1;

              if (bitIndex == -1) {
                byteIndex += 1;
                bitIndex = 7;
              }
            }
          }

          row += inc;

          if (row < 0 || _moduleCount <= row) {
            row -= inc;
            inc = -inc;
            break;
          }
        }
      }
    };

    var createBytes = function(buffer, rsBlocks) {

      var offset = 0;

      var maxDcCount = 0;
      var maxEcCount = 0;

      var dcdata = new Array(rsBlocks.length);
      var ecdata = new Array(rsBlocks.length);

      for (var r = 0; r < rsBlocks.length; r += 1) {

        var dcCount = rsBlocks[r].dataCount;
        var ecCount = rsBlocks[r].totalCount - dcCount;

        maxDcCount = Math.max(maxDcCount, dcCount);
        maxEcCount = Math.max(maxEcCount, ecCount);

        dcdata[r] = new Array(dcCount);

        for (var i = 0; i < dcdata[r].length; i += 1) {
          dcdata[r][i] = 0xff & buffer.getBuffer()[i + offset];
        }
        offset += dcCount;

        var rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        var rawPoly = qrPolynomial(dcdata[r], rsPoly.getLength() - 1);

        var modPoly = rawPoly.mod(rsPoly);
        ecdata[r] = new Array(rsPoly.getLength() - 1);
        for (var i = 0; i < ecdata[r].length; i += 1) {
          var modIndex = i + modPoly.getLength() - ecdata[r].length;
          ecdata[r][i] = (modIndex >= 0)? modPoly.getAt(modIndex) : 0;
        }
      }

      var totalCodeCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalCodeCount += rsBlocks[i].totalCount;
      }

      var data = new Array(totalCodeCount);
      var index = 0;

      for (var i = 0; i < maxDcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < dcdata[r].length) {
            data[index] = dcdata[r][i];
            index += 1;
          }
        }
      }

      for (var i = 0; i < maxEcCount; i += 1) {
        for (var r = 0; r < rsBlocks.length; r += 1) {
          if (i < ecdata[r].length) {
            data[index] = ecdata[r][i];
            index += 1;
          }
        }
      }

      return data;
    };

    var createData = function(typeNumber, errorCorrectionLevel, dataList) {

      var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectionLevel);

      var buffer = qrBitBuffer();

      for (var i = 0; i < dataList.length; i += 1) {
        var data = dataList[i];
        buffer.put(data.getMode(), 4);
        buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
        data.write(buffer);
      }

      // calc num max data.
      var totalDataCount = 0;
      for (var i = 0; i < rsBlocks.length; i += 1) {
        totalDataCount += rsBlocks[i].dataCount;
      }

      if (buffer.getLengthInBits() > totalDataCount * 8) {
        throw 'code length overflow. ('
          + buffer.getLengthInBits()
          + '>'
          + totalDataCount * 8
          + ')';
      }

      // end code
      if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) {
        buffer.put(0, 4);
      }

      // padding
      while (buffer.getLengthInBits() % 8 != 0) {
        buffer.putBit(false);
      }

      // padding
      while (true) {

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD0, 8);

        if (buffer.getLengthInBits() >= totalDataCount * 8) {
          break;
        }
        buffer.put(PAD1, 8);
      }

      return createBytes(buffer, rsBlocks);
    };

    _this.addData = function(data, mode) {

      mode = mode || 'Byte';

      var newData = null;

      switch(mode) {
      case 'Numeric' :
        newData = qrNumber(data);
        break;
      case 'Alphanumeric' :
        newData = qrAlphaNum(data);
        break;
      case 'Byte' :
        newData = qr8BitByte(data);
        break;
      case 'Kanji' :
        newData = qrKanji(data);
        break;
      default :
        throw 'mode:' + mode;
      }

      _dataList.push(newData);
      _dataCache = null;
    };

    _this.isDark = function(row, col) {
      if (row < 0 || _moduleCount <= row || col < 0 || _moduleCount <= col) {
        throw row + ',' + col;
      }
      return _modules[row][col];
    };

    _this.getModuleCount = function() {
      return _moduleCount;
    };

    _this.make = function() {
      if (_typeNumber < 1) {
        var typeNumber = 1;

        for (; typeNumber < 40; typeNumber++) {
          var rsBlocks = QRRSBlock.getRSBlocks(typeNumber, _errorCorrectionLevel);
          var buffer = qrBitBuffer();

          for (var i = 0; i < _dataList.length; i++) {
            var data = _dataList[i];
            buffer.put(data.getMode(), 4);
            buffer.put(data.getLength(), QRUtil.getLengthInBits(data.getMode(), typeNumber) );
            data.write(buffer);
          }

          var totalDataCount = 0;
          for (var i = 0; i < rsBlocks.length; i++) {
            totalDataCount += rsBlocks[i].dataCount;
          }

          if (buffer.getLengthInBits() <= totalDataCount * 8) {
            break;
          }
        }

        _typeNumber = typeNumber;
      }

      makeImpl(false, getBestMaskPattern() );
    };

    _this.createTableTag = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var qrHtml = '';

      qrHtml += '<table style="';
      qrHtml += ' border-width: 0px; border-style: none;';
      qrHtml += ' border-collapse: collapse;';
      qrHtml += ' padding: 0px; margin: ' + margin + 'px;';
      qrHtml += '">';
      qrHtml += '<tbody>';

      for (var r = 0; r < _this.getModuleCount(); r += 1) {

        qrHtml += '<tr>';

        for (var c = 0; c < _this.getModuleCount(); c += 1) {
          qrHtml += '<td style="';
          qrHtml += ' border-width: 0px; border-style: none;';
          qrHtml += ' border-collapse: collapse;';
          qrHtml += ' padding: 0px; margin: 0px;';
          qrHtml += ' width: ' + cellSize + 'px;';
          qrHtml += ' height: ' + cellSize + 'px;';
          qrHtml += ' background-color: ';
          qrHtml += _this.isDark(r, c)? '#000000' : '#ffffff';
          qrHtml += ';';
          qrHtml += '"/>';
        }

        qrHtml += '</tr>';
      }

      qrHtml += '</tbody>';
      qrHtml += '</table>';

      return qrHtml;
    };

    _this.createSvgTag = function(cellSize, margin, alt, title) {

      var opts = {};
      if (typeof arguments[0] == 'object') {
        // Called by options.
        opts = arguments[0];
        // overwrite cellSize and margin.
        cellSize = opts.cellSize;
        margin = opts.margin;
        alt = opts.alt;
        title = opts.title;
      }

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      // Compose alt property surrogate
      alt = (typeof alt === 'string') ? {text: alt} : alt || {};
      alt.text = alt.text || null;
      alt.id = (alt.text) ? alt.id || 'qrcode-description' : null;

      // Compose title property surrogate
      title = (typeof title === 'string') ? {text: title} : title || {};
      title.text = title.text || null;
      title.id = (title.text) ? title.id || 'qrcode-title' : null;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var c, mc, r, mr, qrSvg='', rect;

      rect = 'l' + cellSize + ',0 0,' + cellSize +
        ' -' + cellSize + ',0 0,-' + cellSize + 'z ';

      qrSvg += '<svg version="1.1" xmlns="http://www.w3.org/2000/svg"';
      qrSvg += !opts.scalable ? ' width="' + size + 'px" height="' + size + 'px"' : '';
      qrSvg += ' viewBox="0 0 ' + size + ' ' + size + '" ';
      qrSvg += ' preserveAspectRatio="xMinYMin meet"';
      qrSvg += (title.text || alt.text) ? ' role="img" aria-labelledby="' +
          escapeXml([title.id, alt.id].join(' ').trim() ) + '"' : '';
      qrSvg += '>';
      qrSvg += (title.text) ? '<title id="' + escapeXml(title.id) + '">' +
          escapeXml(title.text) + '</title>' : '';
      qrSvg += (alt.text) ? '<description id="' + escapeXml(alt.id) + '">' +
          escapeXml(alt.text) + '</description>' : '';
      qrSvg += '<rect width="100%" height="100%" fill="white" cx="0" cy="0"/>';
      qrSvg += '<path d="';

      for (r = 0; r < _this.getModuleCount(); r += 1) {
        mr = r * cellSize + margin;
        for (c = 0; c < _this.getModuleCount(); c += 1) {
          if (_this.isDark(r, c) ) {
            mc = c*cellSize+margin;
            qrSvg += 'M' + mc + ',' + mr + rect;
          }
        }
      }

      qrSvg += '" stroke="transparent" fill="black"/>';
      qrSvg += '</svg>';

      return qrSvg;
    };

    _this.createDataURL = function(cellSize, margin) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      return createDataURL(size, size, function(x, y) {
        if (min <= x && x < max && min <= y && y < max) {
          var c = Math.floor( (x - min) / cellSize);
          var r = Math.floor( (y - min) / cellSize);
          return _this.isDark(r, c)? 0 : 1;
        } else {
          return 1;
        }
      } );
    };

    _this.createImgTag = function(cellSize, margin, alt) {

      cellSize = cellSize || 2;
      margin = (typeof margin == 'undefined')? cellSize * 4 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;

      var img = '';
      img += '<img';
      img += '\u0020src="';
      img += _this.createDataURL(cellSize, margin);
      img += '"';
      img += '\u0020width="';
      img += size;
      img += '"';
      img += '\u0020height="';
      img += size;
      img += '"';
      if (alt) {
        img += '\u0020alt="';
        img += escapeXml(alt);
        img += '"';
      }
      img += '/>';

      return img;
    };

    var escapeXml = function(s) {
      var escaped = '';
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charAt(i);
        switch(c) {
        case '<': escaped += '&lt;'; break;
        case '>': escaped += '&gt;'; break;
        case '&': escaped += '&amp;'; break;
        case '"': escaped += '&quot;'; break;
        default : escaped += c; break;
        }
      }
      return escaped;
    };

    var _createHalfASCII = function(margin) {
      var cellSize = 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r1, r2, p;

      var blocks = {
        '██': '█',
        '█ ': '▀',
        ' █': '▄',
        '  ': ' '
      };

      var blocksLastLineNoMargin = {
        '██': '▀',
        '█ ': '▀',
        ' █': ' ',
        '  ': ' '
      };

      var ascii = '';
      for (y = 0; y < size; y += 2) {
        r1 = Math.floor((y - min) / cellSize);
        r2 = Math.floor((y + 1 - min) / cellSize);
        for (x = 0; x < size; x += 1) {
          p = '█';

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r1, Math.floor((x - min) / cellSize))) {
            p = ' ';
          }

          if (min <= x && x < max && min <= y+1 && y+1 < max && _this.isDark(r2, Math.floor((x - min) / cellSize))) {
            p += ' ';
          }
          else {
            p += '█';
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          ascii += (margin < 1 && y+1 >= max) ? blocksLastLineNoMargin[p] : blocks[p];
        }

        ascii += '\n';
      }

      if (size % 2 && margin > 0) {
        return ascii.substring(0, ascii.length - size - 1) + Array(size+1).join('▀');
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.createASCII = function(cellSize, margin) {
      cellSize = cellSize || 1;

      if (cellSize < 2) {
        return _createHalfASCII(margin);
      }

      cellSize -= 1;
      margin = (typeof margin == 'undefined')? cellSize * 2 : margin;

      var size = _this.getModuleCount() * cellSize + margin * 2;
      var min = margin;
      var max = size - margin;

      var y, x, r, p;

      var white = Array(cellSize+1).join('██');
      var black = Array(cellSize+1).join('  ');

      var ascii = '';
      var line = '';
      for (y = 0; y < size; y += 1) {
        r = Math.floor( (y - min) / cellSize);
        line = '';
        for (x = 0; x < size; x += 1) {
          p = 1;

          if (min <= x && x < max && min <= y && y < max && _this.isDark(r, Math.floor((x - min) / cellSize))) {
            p = 0;
          }

          // Output 2 characters per pixel, to create full square. 1 character per pixels gives only half width of square.
          line += p ? white : black;
        }

        for (r = 0; r < cellSize; r += 1) {
          ascii += line + '\n';
        }
      }

      return ascii.substring(0, ascii.length-1);
    };

    _this.renderTo2dContext = function(context, cellSize) {
      cellSize = cellSize || 2;
      var length = _this.getModuleCount();
      for (var row = 0; row < length; row++) {
        for (var col = 0; col < length; col++) {
          context.fillStyle = _this.isDark(row, col) ? 'black' : 'white';
          context.fillRect(col * cellSize, row * cellSize, cellSize, cellSize);
        }
      }
    }

    return _this;
  };

  //---------------------------------------------------------------------
  // qrcode.stringToBytes
  //---------------------------------------------------------------------

  qrcode.stringToBytesFuncs = {
    'default' : function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        bytes.push(c & 0xff);
      }
      return bytes;
    }
  };

  qrcode.stringToBytes = qrcode.stringToBytesFuncs['default'];

  //---------------------------------------------------------------------
  // qrcode.createStringToBytes
  //---------------------------------------------------------------------

  /**
   * @param unicodeData base64 string of byte array.
   * [16bit Unicode],[16bit Bytes], ...
   * @param numChars
   */
  qrcode.createStringToBytes = function(unicodeData, numChars) {

    // create conversion map.

    var unicodeMap = function() {

      var bin = base64DecodeInputStream(unicodeData);
      var read = function() {
        var b = bin.read();
        if (b == -1) throw 'eof';
        return b;
      };

      var count = 0;
      var unicodeMap = {};
      while (true) {
        var b0 = bin.read();
        if (b0 == -1) break;
        var b1 = read();
        var b2 = read();
        var b3 = read();
        var k = String.fromCharCode( (b0 << 8) | b1);
        var v = (b2 << 8) | b3;
        unicodeMap[k] = v;
        count += 1;
      }
      if (count != numChars) {
        throw count + ' != ' + numChars;
      }

      return unicodeMap;
    }();

    var unknownChar = '?'.charCodeAt(0);

    return function(s) {
      var bytes = [];
      for (var i = 0; i < s.length; i += 1) {
        var c = s.charCodeAt(i);
        if (c < 128) {
          bytes.push(c);
        } else {
          var b = unicodeMap[s.charAt(i)];
          if (typeof b == 'number') {
            if ( (b & 0xff) == b) {
              // 1byte
              bytes.push(b);
            } else {
              // 2bytes
              bytes.push(b >>> 8);
              bytes.push(b & 0xff);
            }
          } else {
            bytes.push(unknownChar);
          }
        }
      }
      return bytes;
    };
  };

  //---------------------------------------------------------------------
  // QRMode
  //---------------------------------------------------------------------

  var QRMode = {
    MODE_NUMBER :    1 << 0,
    MODE_ALPHA_NUM : 1 << 1,
    MODE_8BIT_BYTE : 1 << 2,
    MODE_KANJI :     1 << 3
  };

  //---------------------------------------------------------------------
  // QRErrorCorrectionLevel
  //---------------------------------------------------------------------

  var QRErrorCorrectionLevel = {
    L : 1,
    M : 0,
    Q : 3,
    H : 2
  };

  //---------------------------------------------------------------------
  // QRMaskPattern
  //---------------------------------------------------------------------

  var QRMaskPattern = {
    PATTERN000 : 0,
    PATTERN001 : 1,
    PATTERN010 : 2,
    PATTERN011 : 3,
    PATTERN100 : 4,
    PATTERN101 : 5,
    PATTERN110 : 6,
    PATTERN111 : 7
  };

  //---------------------------------------------------------------------
  // QRUtil
  //---------------------------------------------------------------------

  var QRUtil = function() {

    var PATTERN_POSITION_TABLE = [
      [],
      [6, 18],
      [6, 22],
      [6, 26],
      [6, 30],
      [6, 34],
      [6, 22, 38],
      [6, 24, 42],
      [6, 26, 46],
      [6, 28, 50],
      [6, 30, 54],
      [6, 32, 58],
      [6, 34, 62],
      [6, 26, 46, 66],
      [6, 26, 48, 70],
      [6, 26, 50, 74],
      [6, 30, 54, 78],
      [6, 30, 56, 82],
      [6, 30, 58, 86],
      [6, 34, 62, 90],
      [6, 28, 50, 72, 94],
      [6, 26, 50, 74, 98],
      [6, 30, 54, 78, 102],
      [6, 28, 54, 80, 106],
      [6, 32, 58, 84, 110],
      [6, 30, 58, 86, 114],
      [6, 34, 62, 90, 118],
      [6, 26, 50, 74, 98, 122],
      [6, 30, 54, 78, 102, 126],
      [6, 26, 52, 78, 104, 130],
      [6, 30, 56, 82, 108, 134],
      [6, 34, 60, 86, 112, 138],
      [6, 30, 58, 86, 114, 142],
      [6, 34, 62, 90, 118, 146],
      [6, 30, 54, 78, 102, 126, 150],
      [6, 24, 50, 76, 102, 128, 154],
      [6, 28, 54, 80, 106, 132, 158],
      [6, 32, 58, 84, 110, 136, 162],
      [6, 26, 54, 82, 110, 138, 166],
      [6, 30, 58, 86, 114, 142, 170]
    ];
    var G15 = (1 << 10) | (1 << 8) | (1 << 5) | (1 << 4) | (1 << 2) | (1 << 1) | (1 << 0);
    var G18 = (1 << 12) | (1 << 11) | (1 << 10) | (1 << 9) | (1 << 8) | (1 << 5) | (1 << 2) | (1 << 0);
    var G15_MASK = (1 << 14) | (1 << 12) | (1 << 10) | (1 << 4) | (1 << 1);

    var _this = {};

    var getBCHDigit = function(data) {
      var digit = 0;
      while (data != 0) {
        digit += 1;
        data >>>= 1;
      }
      return digit;
    };

    _this.getBCHTypeInfo = function(data) {
      var d = data << 10;
      while (getBCHDigit(d) - getBCHDigit(G15) >= 0) {
        d ^= (G15 << (getBCHDigit(d) - getBCHDigit(G15) ) );
      }
      return ( (data << 10) | d) ^ G15_MASK;
    };

    _this.getBCHTypeNumber = function(data) {
      var d = data << 12;
      while (getBCHDigit(d) - getBCHDigit(G18) >= 0) {
        d ^= (G18 << (getBCHDigit(d) - getBCHDigit(G18) ) );
      }
      return (data << 12) | d;
    };

    _this.getPatternPosition = function(typeNumber) {
      return PATTERN_POSITION_TABLE[typeNumber - 1];
    };

    _this.getMaskFunction = function(maskPattern) {

      switch (maskPattern) {

      case QRMaskPattern.PATTERN000 :
        return function(i, j) { return (i + j) % 2 == 0; };
      case QRMaskPattern.PATTERN001 :
        return function(i, j) { return i % 2 == 0; };
      case QRMaskPattern.PATTERN010 :
        return function(i, j) { return j % 3 == 0; };
      case QRMaskPattern.PATTERN011 :
        return function(i, j) { return (i + j) % 3 == 0; };
      case QRMaskPattern.PATTERN100 :
        return function(i, j) { return (Math.floor(i / 2) + Math.floor(j / 3) ) % 2 == 0; };
      case QRMaskPattern.PATTERN101 :
        return function(i, j) { return (i * j) % 2 + (i * j) % 3 == 0; };
      case QRMaskPattern.PATTERN110 :
        return function(i, j) { return ( (i * j) % 2 + (i * j) % 3) % 2 == 0; };
      case QRMaskPattern.PATTERN111 :
        return function(i, j) { return ( (i * j) % 3 + (i + j) % 2) % 2 == 0; };

      default :
        throw 'bad maskPattern:' + maskPattern;
      }
    };

    _this.getErrorCorrectPolynomial = function(errorCorrectLength) {
      var a = qrPolynomial([1], 0);
      for (var i = 0; i < errorCorrectLength; i += 1) {
        a = a.multiply(qrPolynomial([1, QRMath.gexp(i)], 0) );
      }
      return a;
    };

    _this.getLengthInBits = function(mode, type) {

      if (1 <= type && type < 10) {

        // 1 - 9

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 10;
        case QRMode.MODE_ALPHA_NUM : return 9;
        case QRMode.MODE_8BIT_BYTE : return 8;
        case QRMode.MODE_KANJI     : return 8;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 27) {

        // 10 - 26

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 12;
        case QRMode.MODE_ALPHA_NUM : return 11;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 10;
        default :
          throw 'mode:' + mode;
        }

      } else if (type < 41) {

        // 27 - 40

        switch(mode) {
        case QRMode.MODE_NUMBER    : return 14;
        case QRMode.MODE_ALPHA_NUM : return 13;
        case QRMode.MODE_8BIT_BYTE : return 16;
        case QRMode.MODE_KANJI     : return 12;
        default :
          throw 'mode:' + mode;
        }

      } else {
        throw 'type:' + type;
      }
    };

    _this.getLostPoint = function(qrcode) {

      var moduleCount = qrcode.getModuleCount();

      var lostPoint = 0;

      // LEVEL1

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount; col += 1) {

          var sameCount = 0;
          var dark = qrcode.isDark(row, col);

          for (var r = -1; r <= 1; r += 1) {

            if (row + r < 0 || moduleCount <= row + r) {
              continue;
            }

            for (var c = -1; c <= 1; c += 1) {

              if (col + c < 0 || moduleCount <= col + c) {
                continue;
              }

              if (r == 0 && c == 0) {
                continue;
              }

              if (dark == qrcode.isDark(row + r, col + c) ) {
                sameCount += 1;
              }
            }
          }

          if (sameCount > 5) {
            lostPoint += (3 + sameCount - 5);
          }
        }
      };

      // LEVEL2

      for (var row = 0; row < moduleCount - 1; row += 1) {
        for (var col = 0; col < moduleCount - 1; col += 1) {
          var count = 0;
          if (qrcode.isDark(row, col) ) count += 1;
          if (qrcode.isDark(row + 1, col) ) count += 1;
          if (qrcode.isDark(row, col + 1) ) count += 1;
          if (qrcode.isDark(row + 1, col + 1) ) count += 1;
          if (count == 0 || count == 4) {
            lostPoint += 3;
          }
        }
      }

      // LEVEL3

      for (var row = 0; row < moduleCount; row += 1) {
        for (var col = 0; col < moduleCount - 6; col += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row, col + 1)
              &&  qrcode.isDark(row, col + 2)
              &&  qrcode.isDark(row, col + 3)
              &&  qrcode.isDark(row, col + 4)
              && !qrcode.isDark(row, col + 5)
              &&  qrcode.isDark(row, col + 6) ) {
            lostPoint += 40;
          }
        }
      }

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount - 6; row += 1) {
          if (qrcode.isDark(row, col)
              && !qrcode.isDark(row + 1, col)
              &&  qrcode.isDark(row + 2, col)
              &&  qrcode.isDark(row + 3, col)
              &&  qrcode.isDark(row + 4, col)
              && !qrcode.isDark(row + 5, col)
              &&  qrcode.isDark(row + 6, col) ) {
            lostPoint += 40;
          }
        }
      }

      // LEVEL4

      var darkCount = 0;

      for (var col = 0; col < moduleCount; col += 1) {
        for (var row = 0; row < moduleCount; row += 1) {
          if (qrcode.isDark(row, col) ) {
            darkCount += 1;
          }
        }
      }

      var ratio = Math.abs(100 * darkCount / moduleCount / moduleCount - 50) / 5;
      lostPoint += ratio * 10;

      return lostPoint;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // QRMath
  //---------------------------------------------------------------------

  var QRMath = function() {

    var EXP_TABLE = new Array(256);
    var LOG_TABLE = new Array(256);

    // initialize tables
    for (var i = 0; i < 8; i += 1) {
      EXP_TABLE[i] = 1 << i;
    }
    for (var i = 8; i < 256; i += 1) {
      EXP_TABLE[i] = EXP_TABLE[i - 4]
        ^ EXP_TABLE[i - 5]
        ^ EXP_TABLE[i - 6]
        ^ EXP_TABLE[i - 8];
    }
    for (var i = 0; i < 255; i += 1) {
      LOG_TABLE[EXP_TABLE[i] ] = i;
    }

    var _this = {};

    _this.glog = function(n) {

      if (n < 1) {
        throw 'glog(' + n + ')';
      }

      return LOG_TABLE[n];
    };

    _this.gexp = function(n) {

      while (n < 0) {
        n += 255;
      }

      while (n >= 256) {
        n -= 255;
      }

      return EXP_TABLE[n];
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrPolynomial
  //---------------------------------------------------------------------

  function qrPolynomial(num, shift) {

    if (typeof num.length == 'undefined') {
      throw num.length + '/' + shift;
    }

    var _num = function() {
      var offset = 0;
      while (offset < num.length && num[offset] == 0) {
        offset += 1;
      }
      var _num = new Array(num.length - offset + shift);
      for (var i = 0; i < num.length - offset; i += 1) {
        _num[i] = num[i + offset];
      }
      return _num;
    }();

    var _this = {};

    _this.getAt = function(index) {
      return _num[index];
    };

    _this.getLength = function() {
      return _num.length;
    };

    _this.multiply = function(e) {

      var num = new Array(_this.getLength() + e.getLength() - 1);

      for (var i = 0; i < _this.getLength(); i += 1) {
        for (var j = 0; j < e.getLength(); j += 1) {
          num[i + j] ^= QRMath.gexp(QRMath.glog(_this.getAt(i) ) + QRMath.glog(e.getAt(j) ) );
        }
      }

      return qrPolynomial(num, 0);
    };

    _this.mod = function(e) {

      if (_this.getLength() - e.getLength() < 0) {
        return _this;
      }

      var ratio = QRMath.glog(_this.getAt(0) ) - QRMath.glog(e.getAt(0) );

      var num = new Array(_this.getLength() );
      for (var i = 0; i < _this.getLength(); i += 1) {
        num[i] = _this.getAt(i);
      }

      for (var i = 0; i < e.getLength(); i += 1) {
        num[i] ^= QRMath.gexp(QRMath.glog(e.getAt(i) ) + ratio);
      }

      // recursive call
      return qrPolynomial(num, 0).mod(e);
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // QRRSBlock
  //---------------------------------------------------------------------

  var QRRSBlock = function() {

    var RS_BLOCK_TABLE = [

      // L
      // M
      // Q
      // H

      // 1
      [1, 26, 19],
      [1, 26, 16],
      [1, 26, 13],
      [1, 26, 9],

      // 2
      [1, 44, 34],
      [1, 44, 28],
      [1, 44, 22],
      [1, 44, 16],

      // 3
      [1, 70, 55],
      [1, 70, 44],
      [2, 35, 17],
      [2, 35, 13],

      // 4
      [1, 100, 80],
      [2, 50, 32],
      [2, 50, 24],
      [4, 25, 9],

      // 5
      [1, 134, 108],
      [2, 67, 43],
      [2, 33, 15, 2, 34, 16],
      [2, 33, 11, 2, 34, 12],

      // 6
      [2, 86, 68],
      [4, 43, 27],
      [4, 43, 19],
      [4, 43, 15],

      // 7
      [2, 98, 78],
      [4, 49, 31],
      [2, 32, 14, 4, 33, 15],
      [4, 39, 13, 1, 40, 14],

      // 8
      [2, 121, 97],
      [2, 60, 38, 2, 61, 39],
      [4, 40, 18, 2, 41, 19],
      [4, 40, 14, 2, 41, 15],

      // 9
      [2, 146, 116],
      [3, 58, 36, 2, 59, 37],
      [4, 36, 16, 4, 37, 17],
      [4, 36, 12, 4, 37, 13],

      // 10
      [2, 86, 68, 2, 87, 69],
      [4, 69, 43, 1, 70, 44],
      [6, 43, 19, 2, 44, 20],
      [6, 43, 15, 2, 44, 16],

      // 11
      [4, 101, 81],
      [1, 80, 50, 4, 81, 51],
      [4, 50, 22, 4, 51, 23],
      [3, 36, 12, 8, 37, 13],

      // 12
      [2, 116, 92, 2, 117, 93],
      [6, 58, 36, 2, 59, 37],
      [4, 46, 20, 6, 47, 21],
      [7, 42, 14, 4, 43, 15],

      // 13
      [4, 133, 107],
      [8, 59, 37, 1, 60, 38],
      [8, 44, 20, 4, 45, 21],
      [12, 33, 11, 4, 34, 12],

      // 14
      [3, 145, 115, 1, 146, 116],
      [4, 64, 40, 5, 65, 41],
      [11, 36, 16, 5, 37, 17],
      [11, 36, 12, 5, 37, 13],

      // 15
      [5, 109, 87, 1, 110, 88],
      [5, 65, 41, 5, 66, 42],
      [5, 54, 24, 7, 55, 25],
      [11, 36, 12, 7, 37, 13],

      // 16
      [5, 122, 98, 1, 123, 99],
      [7, 73, 45, 3, 74, 46],
      [15, 43, 19, 2, 44, 20],
      [3, 45, 15, 13, 46, 16],

      // 17
      [1, 135, 107, 5, 136, 108],
      [10, 74, 46, 1, 75, 47],
      [1, 50, 22, 15, 51, 23],
      [2, 42, 14, 17, 43, 15],

      // 18
      [5, 150, 120, 1, 151, 121],
      [9, 69, 43, 4, 70, 44],
      [17, 50, 22, 1, 51, 23],
      [2, 42, 14, 19, 43, 15],

      // 19
      [3, 141, 113, 4, 142, 114],
      [3, 70, 44, 11, 71, 45],
      [17, 47, 21, 4, 48, 22],
      [9, 39, 13, 16, 40, 14],

      // 20
      [3, 135, 107, 5, 136, 108],
      [3, 67, 41, 13, 68, 42],
      [15, 54, 24, 5, 55, 25],
      [15, 43, 15, 10, 44, 16],

      // 21
      [4, 144, 116, 4, 145, 117],
      [17, 68, 42],
      [17, 50, 22, 6, 51, 23],
      [19, 46, 16, 6, 47, 17],

      // 22
      [2, 139, 111, 7, 140, 112],
      [17, 74, 46],
      [7, 54, 24, 16, 55, 25],
      [34, 37, 13],

      // 23
      [4, 151, 121, 5, 152, 122],
      [4, 75, 47, 14, 76, 48],
      [11, 54, 24, 14, 55, 25],
      [16, 45, 15, 14, 46, 16],

      // 24
      [6, 147, 117, 4, 148, 118],
      [6, 73, 45, 14, 74, 46],
      [11, 54, 24, 16, 55, 25],
      [30, 46, 16, 2, 47, 17],

      // 25
      [8, 132, 106, 4, 133, 107],
      [8, 75, 47, 13, 76, 48],
      [7, 54, 24, 22, 55, 25],
      [22, 45, 15, 13, 46, 16],

      // 26
      [10, 142, 114, 2, 143, 115],
      [19, 74, 46, 4, 75, 47],
      [28, 50, 22, 6, 51, 23],
      [33, 46, 16, 4, 47, 17],

      // 27
      [8, 152, 122, 4, 153, 123],
      [22, 73, 45, 3, 74, 46],
      [8, 53, 23, 26, 54, 24],
      [12, 45, 15, 28, 46, 16],

      // 28
      [3, 147, 117, 10, 148, 118],
      [3, 73, 45, 23, 74, 46],
      [4, 54, 24, 31, 55, 25],
      [11, 45, 15, 31, 46, 16],

      // 29
      [7, 146, 116, 7, 147, 117],
      [21, 73, 45, 7, 74, 46],
      [1, 53, 23, 37, 54, 24],
      [19, 45, 15, 26, 46, 16],

      // 30
      [5, 145, 115, 10, 146, 116],
      [19, 75, 47, 10, 76, 48],
      [15, 54, 24, 25, 55, 25],
      [23, 45, 15, 25, 46, 16],

      // 31
      [13, 145, 115, 3, 146, 116],
      [2, 74, 46, 29, 75, 47],
      [42, 54, 24, 1, 55, 25],
      [23, 45, 15, 28, 46, 16],

      // 32
      [17, 145, 115],
      [10, 74, 46, 23, 75, 47],
      [10, 54, 24, 35, 55, 25],
      [19, 45, 15, 35, 46, 16],

      // 33
      [17, 145, 115, 1, 146, 116],
      [14, 74, 46, 21, 75, 47],
      [29, 54, 24, 19, 55, 25],
      [11, 45, 15, 46, 46, 16],

      // 34
      [13, 145, 115, 6, 146, 116],
      [14, 74, 46, 23, 75, 47],
      [44, 54, 24, 7, 55, 25],
      [59, 46, 16, 1, 47, 17],

      // 35
      [12, 151, 121, 7, 152, 122],
      [12, 75, 47, 26, 76, 48],
      [39, 54, 24, 14, 55, 25],
      [22, 45, 15, 41, 46, 16],

      // 36
      [6, 151, 121, 14, 152, 122],
      [6, 75, 47, 34, 76, 48],
      [46, 54, 24, 10, 55, 25],
      [2, 45, 15, 64, 46, 16],

      // 37
      [17, 152, 122, 4, 153, 123],
      [29, 74, 46, 14, 75, 47],
      [49, 54, 24, 10, 55, 25],
      [24, 45, 15, 46, 46, 16],

      // 38
      [4, 152, 122, 18, 153, 123],
      [13, 74, 46, 32, 75, 47],
      [48, 54, 24, 14, 55, 25],
      [42, 45, 15, 32, 46, 16],

      // 39
      [20, 147, 117, 4, 148, 118],
      [40, 75, 47, 7, 76, 48],
      [43, 54, 24, 22, 55, 25],
      [10, 45, 15, 67, 46, 16],

      // 40
      [19, 148, 118, 6, 149, 119],
      [18, 75, 47, 31, 76, 48],
      [34, 54, 24, 34, 55, 25],
      [20, 45, 15, 61, 46, 16]
    ];

    var qrRSBlock = function(totalCount, dataCount) {
      var _this = {};
      _this.totalCount = totalCount;
      _this.dataCount = dataCount;
      return _this;
    };

    var _this = {};

    var getRsBlockTable = function(typeNumber, errorCorrectionLevel) {

      switch(errorCorrectionLevel) {
      case QRErrorCorrectionLevel.L :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 0];
      case QRErrorCorrectionLevel.M :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 1];
      case QRErrorCorrectionLevel.Q :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 2];
      case QRErrorCorrectionLevel.H :
        return RS_BLOCK_TABLE[(typeNumber - 1) * 4 + 3];
      default :
        return undefined;
      }
    };

    _this.getRSBlocks = function(typeNumber, errorCorrectionLevel) {

      var rsBlock = getRsBlockTable(typeNumber, errorCorrectionLevel);

      if (typeof rsBlock == 'undefined') {
        throw 'bad rs block @ typeNumber:' + typeNumber +
            '/errorCorrectionLevel:' + errorCorrectionLevel;
      }

      var length = rsBlock.length / 3;

      var list = [];

      for (var i = 0; i < length; i += 1) {

        var count = rsBlock[i * 3 + 0];
        var totalCount = rsBlock[i * 3 + 1];
        var dataCount = rsBlock[i * 3 + 2];

        for (var j = 0; j < count; j += 1) {
          list.push(qrRSBlock(totalCount, dataCount) );
        }
      }

      return list;
    };

    return _this;
  }();

  //---------------------------------------------------------------------
  // qrBitBuffer
  //---------------------------------------------------------------------

  var qrBitBuffer = function() {

    var _buffer = [];
    var _length = 0;

    var _this = {};

    _this.getBuffer = function() {
      return _buffer;
    };

    _this.getAt = function(index) {
      var bufIndex = Math.floor(index / 8);
      return ( (_buffer[bufIndex] >>> (7 - index % 8) ) & 1) == 1;
    };

    _this.put = function(num, length) {
      for (var i = 0; i < length; i += 1) {
        _this.putBit( ( (num >>> (length - i - 1) ) & 1) == 1);
      }
    };

    _this.getLengthInBits = function() {
      return _length;
    };

    _this.putBit = function(bit) {

      var bufIndex = Math.floor(_length / 8);
      if (_buffer.length <= bufIndex) {
        _buffer.push(0);
      }

      if (bit) {
        _buffer[bufIndex] |= (0x80 >>> (_length % 8) );
      }

      _length += 1;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrNumber
  //---------------------------------------------------------------------

  var qrNumber = function(data) {

    var _mode = QRMode.MODE_NUMBER;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var data = _data;

      var i = 0;

      while (i + 2 < data.length) {
        buffer.put(strToNum(data.substring(i, i + 3) ), 10);
        i += 3;
      }

      if (i < data.length) {
        if (data.length - i == 1) {
          buffer.put(strToNum(data.substring(i, i + 1) ), 4);
        } else if (data.length - i == 2) {
          buffer.put(strToNum(data.substring(i, i + 2) ), 7);
        }
      }
    };

    var strToNum = function(s) {
      var num = 0;
      for (var i = 0; i < s.length; i += 1) {
        num = num * 10 + chatToNum(s.charAt(i) );
      }
      return num;
    };

    var chatToNum = function(c) {
      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      }
      throw 'illegal char :' + c;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrAlphaNum
  //---------------------------------------------------------------------

  var qrAlphaNum = function(data) {

    var _mode = QRMode.MODE_ALPHA_NUM;
    var _data = data;

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _data.length;
    };

    _this.write = function(buffer) {

      var s = _data;

      var i = 0;

      while (i + 1 < s.length) {
        buffer.put(
          getCode(s.charAt(i) ) * 45 +
          getCode(s.charAt(i + 1) ), 11);
        i += 2;
      }

      if (i < s.length) {
        buffer.put(getCode(s.charAt(i) ), 6);
      }
    };

    var getCode = function(c) {

      if ('0' <= c && c <= '9') {
        return c.charCodeAt(0) - '0'.charCodeAt(0);
      } else if ('A' <= c && c <= 'Z') {
        return c.charCodeAt(0) - 'A'.charCodeAt(0) + 10;
      } else {
        switch (c) {
        case ' ' : return 36;
        case '$' : return 37;
        case '%' : return 38;
        case '*' : return 39;
        case '+' : return 40;
        case '-' : return 41;
        case '.' : return 42;
        case '/' : return 43;
        case ':' : return 44;
        default :
          throw 'illegal char :' + c;
        }
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qr8BitByte
  //---------------------------------------------------------------------

  var qr8BitByte = function(data) {

    var _mode = QRMode.MODE_8BIT_BYTE;
    var _data = data;
    var _bytes = qrcode.stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return _bytes.length;
    };

    _this.write = function(buffer) {
      for (var i = 0; i < _bytes.length; i += 1) {
        buffer.put(_bytes[i], 8);
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // qrKanji
  //---------------------------------------------------------------------

  var qrKanji = function(data) {

    var _mode = QRMode.MODE_KANJI;
    var _data = data;

    var stringToBytes = qrcode.stringToBytesFuncs['SJIS'];
    if (!stringToBytes) {
      throw 'sjis not supported.';
    }
    !function(c, code) {
      // self test for sjis support.
      var test = stringToBytes(c);
      if (test.length != 2 || ( (test[0] << 8) | test[1]) != code) {
        throw 'sjis not supported.';
      }
    }('\u53cb', 0x9746);

    var _bytes = stringToBytes(data);

    var _this = {};

    _this.getMode = function() {
      return _mode;
    };

    _this.getLength = function(buffer) {
      return ~~(_bytes.length / 2);
    };

    _this.write = function(buffer) {

      var data = _bytes;

      var i = 0;

      while (i + 1 < data.length) {

        var c = ( (0xff & data[i]) << 8) | (0xff & data[i + 1]);

        if (0x8140 <= c && c <= 0x9FFC) {
          c -= 0x8140;
        } else if (0xE040 <= c && c <= 0xEBBF) {
          c -= 0xC140;
        } else {
          throw 'illegal char at ' + (i + 1) + '/' + c;
        }

        c = ( (c >>> 8) & 0xff) * 0xC0 + (c & 0xff);

        buffer.put(c, 13);

        i += 2;
      }

      if (i < data.length) {
        throw 'illegal char at ' + (i + 1);
      }
    };

    return _this;
  };

  //=====================================================================
  // GIF Support etc.
  //

  //---------------------------------------------------------------------
  // byteArrayOutputStream
  //---------------------------------------------------------------------

  var byteArrayOutputStream = function() {

    var _bytes = [];

    var _this = {};

    _this.writeByte = function(b) {
      _bytes.push(b & 0xff);
    };

    _this.writeShort = function(i) {
      _this.writeByte(i);
      _this.writeByte(i >>> 8);
    };

    _this.writeBytes = function(b, off, len) {
      off = off || 0;
      len = len || b.length;
      for (var i = 0; i < len; i += 1) {
        _this.writeByte(b[i + off]);
      }
    };

    _this.writeString = function(s) {
      for (var i = 0; i < s.length; i += 1) {
        _this.writeByte(s.charCodeAt(i) );
      }
    };

    _this.toByteArray = function() {
      return _bytes;
    };

    _this.toString = function() {
      var s = '';
      s += '[';
      for (var i = 0; i < _bytes.length; i += 1) {
        if (i > 0) {
          s += ',';
        }
        s += _bytes[i];
      }
      s += ']';
      return s;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64EncodeOutputStream
  //---------------------------------------------------------------------

  var base64EncodeOutputStream = function() {

    var _buffer = 0;
    var _buflen = 0;
    var _length = 0;
    var _base64 = '';

    var _this = {};

    var writeEncoded = function(b) {
      _base64 += String.fromCharCode(encode(b & 0x3f) );
    };

    var encode = function(n) {
      if (n < 0) {
        // error.
      } else if (n < 26) {
        return 0x41 + n;
      } else if (n < 52) {
        return 0x61 + (n - 26);
      } else if (n < 62) {
        return 0x30 + (n - 52);
      } else if (n == 62) {
        return 0x2b;
      } else if (n == 63) {
        return 0x2f;
      }
      throw 'n:' + n;
    };

    _this.writeByte = function(n) {

      _buffer = (_buffer << 8) | (n & 0xff);
      _buflen += 8;
      _length += 1;

      while (_buflen >= 6) {
        writeEncoded(_buffer >>> (_buflen - 6) );
        _buflen -= 6;
      }
    };

    _this.flush = function() {

      if (_buflen > 0) {
        writeEncoded(_buffer << (6 - _buflen) );
        _buffer = 0;
        _buflen = 0;
      }

      if (_length % 3 != 0) {
        // padding
        var padlen = 3 - _length % 3;
        for (var i = 0; i < padlen; i += 1) {
          _base64 += '=';
        }
      }
    };

    _this.toString = function() {
      return _base64;
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // base64DecodeInputStream
  //---------------------------------------------------------------------

  var base64DecodeInputStream = function(str) {

    var _str = str;
    var _pos = 0;
    var _buffer = 0;
    var _buflen = 0;

    var _this = {};

    _this.read = function() {

      while (_buflen < 8) {

        if (_pos >= _str.length) {
          if (_buflen == 0) {
            return -1;
          }
          throw 'unexpected end of file./' + _buflen;
        }

        var c = _str.charAt(_pos);
        _pos += 1;

        if (c == '=') {
          _buflen = 0;
          return -1;
        } else if (c.match(/^\s$/) ) {
          // ignore if whitespace.
          continue;
        }

        _buffer = (_buffer << 6) | decode(c.charCodeAt(0) );
        _buflen += 6;
      }

      var n = (_buffer >>> (_buflen - 8) ) & 0xff;
      _buflen -= 8;
      return n;
    };

    var decode = function(c) {
      if (0x41 <= c && c <= 0x5a) {
        return c - 0x41;
      } else if (0x61 <= c && c <= 0x7a) {
        return c - 0x61 + 26;
      } else if (0x30 <= c && c <= 0x39) {
        return c - 0x30 + 52;
      } else if (c == 0x2b) {
        return 62;
      } else if (c == 0x2f) {
        return 63;
      } else {
        throw 'c:' + c;
      }
    };

    return _this;
  };

  //---------------------------------------------------------------------
  // gifImage (B/W)
  //---------------------------------------------------------------------

  var gifImage = function(width, height) {

    var _width = width;
    var _height = height;
    var _data = new Array(width * height);

    var _this = {};

    _this.setPixel = function(x, y, pixel) {
      _data[y * _width + x] = pixel;
    };

    _this.write = function(out) {

      //---------------------------------
      // GIF Signature

      out.writeString('GIF87a');

      //---------------------------------
      // Screen Descriptor

      out.writeShort(_width);
      out.writeShort(_height);

      out.writeByte(0x80); // 2bit
      out.writeByte(0);
      out.writeByte(0);

      //---------------------------------
      // Global Color Map

      // black
      out.writeByte(0x00);
      out.writeByte(0x00);
      out.writeByte(0x00);

      // white
      out.writeByte(0xff);
      out.writeByte(0xff);
      out.writeByte(0xff);

      //---------------------------------
      // Image Descriptor

      out.writeString(',');
      out.writeShort(0);
      out.writeShort(0);
      out.writeShort(_width);
      out.writeShort(_height);
      out.writeByte(0);

      //---------------------------------
      // Local Color Map

      //---------------------------------
      // Raster Data

      var lzwMinCodeSize = 2;
      var raster = getLZWRaster(lzwMinCodeSize);

      out.writeByte(lzwMinCodeSize);

      var offset = 0;

      while (raster.length - offset > 255) {
        out.writeByte(255);
        out.writeBytes(raster, offset, 255);
        offset += 255;
      }

      out.writeByte(raster.length - offset);
      out.writeBytes(raster, offset, raster.length - offset);
      out.writeByte(0x00);

      //---------------------------------
      // GIF Terminator
      out.writeString(';');
    };

    var bitOutputStream = function(out) {

      var _out = out;
      var _bitLength = 0;
      var _bitBuffer = 0;

      var _this = {};

      _this.write = function(data, length) {

        if ( (data >>> length) != 0) {
          throw 'length over';
        }

        while (_bitLength + length >= 8) {
          _out.writeByte(0xff & ( (data << _bitLength) | _bitBuffer) );
          length -= (8 - _bitLength);
          data >>>= (8 - _bitLength);
          _bitBuffer = 0;
          _bitLength = 0;
        }

        _bitBuffer = (data << _bitLength) | _bitBuffer;
        _bitLength = _bitLength + length;
      };

      _this.flush = function() {
        if (_bitLength > 0) {
          _out.writeByte(_bitBuffer);
        }
      };

      return _this;
    };

    var getLZWRaster = function(lzwMinCodeSize) {

      var clearCode = 1 << lzwMinCodeSize;
      var endCode = (1 << lzwMinCodeSize) + 1;
      var bitLength = lzwMinCodeSize + 1;

      // Setup LZWTable
      var table = lzwTable();

      for (var i = 0; i < clearCode; i += 1) {
        table.add(String.fromCharCode(i) );
      }
      table.add(String.fromCharCode(clearCode) );
      table.add(String.fromCharCode(endCode) );

      var byteOut = byteArrayOutputStream();
      var bitOut = bitOutputStream(byteOut);

      // clear code
      bitOut.write(clearCode, bitLength);

      var dataIndex = 0;

      var s = String.fromCharCode(_data[dataIndex]);
      dataIndex += 1;

      while (dataIndex < _data.length) {

        var c = String.fromCharCode(_data[dataIndex]);
        dataIndex += 1;

        if (table.contains(s + c) ) {

          s = s + c;

        } else {

          bitOut.write(table.indexOf(s), bitLength);

          if (table.size() < 0xfff) {

            if (table.size() == (1 << bitLength) ) {
              bitLength += 1;
            }

            table.add(s + c);
          }

          s = c;
        }
      }

      bitOut.write(table.indexOf(s), bitLength);

      // end code
      bitOut.write(endCode, bitLength);

      bitOut.flush();

      return byteOut.toByteArray();
    };

    var lzwTable = function() {

      var _map = {};
      var _size = 0;

      var _this = {};

      _this.add = function(key) {
        if (_this.contains(key) ) {
          throw 'dup key:' + key;
        }
        _map[key] = _size;
        _size += 1;
      };

      _this.size = function() {
        return _size;
      };

      _this.indexOf = function(key) {
        return _map[key];
      };

      _this.contains = function(key) {
        return typeof _map[key] != 'undefined';
      };

      return _this;
    };

    return _this;
  };

  var createDataURL = function(width, height, getPixel) {
    var gif = gifImage(width, height);
    for (var y = 0; y < height; y += 1) {
      for (var x = 0; x < width; x += 1) {
        gif.setPixel(x, y, getPixel(x, y) );
      }
    }

    var b = byteArrayOutputStream();
    gif.write(b);

    var base64 = base64EncodeOutputStream();
    var bytes = b.toByteArray();
    for (var i = 0; i < bytes.length; i += 1) {
      base64.writeByte(bytes[i]);
    }
    base64.flush();

    return 'data:image/gif;base64,' + base64;
  };

  //---------------------------------------------------------------------
  // returns qrcode function.

  return qrcode;
}();

// multibyte support
!function() {

  qrcode.stringToBytesFuncs['UTF-8'] = function(s) {
    // http://stackoverflow.com/questions/18729405/how-to-convert-utf8-string-to-byte-array
    function toUTF8Array(str) {
      var utf8 = [];
      for (var i=0; i < str.length; i++) {
        var charcode = str.charCodeAt(i);
        if (charcode < 0x80) utf8.push(charcode);
        else if (charcode < 0x800) {
          utf8.push(0xc0 | (charcode >> 6),
              0x80 | (charcode & 0x3f));
        }
        else if (charcode < 0xd800 || charcode >= 0xe000) {
          utf8.push(0xe0 | (charcode >> 12),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
        // surrogate pair
        else {
          i++;
          // UTF-16 encodes 0x10000-0x10FFFF by
          // subtracting 0x10000 and splitting the
          // 20 bits of 0x0-0xFFFFF into two halves
          charcode = 0x10000 + (((charcode & 0x3ff)<<10)
            | (str.charCodeAt(i) & 0x3ff));
          utf8.push(0xf0 | (charcode >>18),
              0x80 | ((charcode>>12) & 0x3f),
              0x80 | ((charcode>>6) & 0x3f),
              0x80 | (charcode & 0x3f));
        }
      }
      return utf8;
    }
    return toUTF8Array(s);
  };

}();

(function (factory) {
  if (typeof define === 'function' && define.amd) {
      define([], factory);
  } else if (typeof exports === 'object') {
      module.exports = factory();
  }
}(function () {
    return qrcode;
}));
