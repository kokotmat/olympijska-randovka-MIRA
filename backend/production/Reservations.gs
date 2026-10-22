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
      SCRIPT_URL:'https://script.google.com/macros/s/AKfycbxtdKDQLvyaLOAqQFZ1gF8y7tkmxOYyrAgAZcGnp_ZetpX6r2F4CV1mYmMo_g_K4Nhk/exec',
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
  SpreadsheetApp.getUi().alert('Připraveno. Prodej nebyl zapnut. Doplňte Script Properties a přečtěte návod.');
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
  SpreadsheetApp.getUi().alert('Automatika nastavena. Prodej zůstává v aktuálním režimu.');
}
function openSales() {
  owner_();const c=cfg_();validateConfig_(c,c.mode==='live');
  if(c.mode==='live'){
    if(SpreadsheetApp.getUi().alert('Spustit ostrý prodej?', 'Vzniknou skutečné rezervace a e-maily. Pokračovat?', SpreadsheetApp.getUi().ButtonSet.YES_NO)!==SpreadsheetApp.getUi().Button.YES)return;
    if(!checkPayments_())throw new Error('Nelze ověřit banku. Prodej zatím nezapnut.');
  }
  withLock_(()=>{usage_(rows_(sheet_(c)));props_().setProperty('SALES_OPEN_MODE',c.mode);props_().setProperty('SALES_OPEN','true');});
}
function closeSales() { owner_();props_().setProperty('SALES_OPEN','false'); }
function openGate() {
  owner_();const c=cfg_();validateConfig_(c,c.mode==='live');
  const ui=SpreadsheetApp.getUi();if(ui.alert('Otevřít odbavení – '+c.mode+'?', 'Načtené zaplacené vstupenky budou označovány jako použité.',ui.ButtonSet.YES_NO)!==ui.Button.YES)return;
  props_().setProperty('SCANNER_OPEN_MODE',c.mode);props_().setProperty('SCANNER_OPEN','true');
}
function closeGate() { owner_();props_().setProperty('SCANNER_OPEN','false'); }
function diagnostics() {
  owner_();const c=cfg_();let error='OK';try{validateConfig_(c,c.mode==='live');usage_(rows_(sheet_(c)));}catch(e){error=e.message;}
  SpreadsheetApp.getUi().alert('Spouštějící účet: '+Session.getEffectiveUser().getEmail()+'\nRežim: '+c.mode+'\nProdej: '+c.open+'\nOdbavení: '+c.gate+'\nKontrola: '+error+'\nZbývá adresátů e-mailů dnes: '+MailApp.getRemainingDailyQuota()+'\nPoslední banka: '+(props_().getProperty('BANK_LAST_OK')||'neověřena')+'\nKontrola vstupenek: '+c.url+'?action=scanner');
}
function onOpen() {
  SpreadsheetApp.getUi().createMenu('🎟️ Randovka – rezervace')
    .addItem('Inicializovat / zkontrolovat tabulku','setupSystem')
    .addItem('Diagnostika a odkaz na kontrolu','diagnostics')
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
    if(data.action==='scannerLogin')return json_(scannerLogin(data));
    if(data.action==='scan')return json_(scannerScan(data));
    return json_(reserve_(data));
  }catch(e){return json_({status:'error',code:e.message==='BUSY'?'BUSY':'REJECTED',message:e.message==='BUSY'?'Systém je vytížený. Opakujte se stejným requestId.':e.message});}
}
function doGet(e) {
  const p=e&&e.parameter||{};
  try {
    const c=cfg_();
    if(p.action==='scanner')return HtmlService.createHtmlOutput(scannerSource_()).setTitle('Randovka – kontrola vstupenek').addMetaTag('viewport','width=device-width, initial-scale=1, viewport-fit=cover');
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
  const c=cfg_();
  if(c.mode==='live')checkPayments_();
  else withLock_(()=>{const s=sheet_(c);expire_(s,rows_(s),c);});
  sendOutbox_();
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
function sign_(s,c) { return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(s,c.secret)).replace(/=+$/,''); }
function scannerLogin(data) {
  try {
    const c=cfg_();validateConfig_(c,c.mode==='live');
    return withLock_(()=>{
      const cache=CacheService.getScriptCache(),key='scanner-failures',fails=Number(cache.get(key)||0);
      if(fails>=20)throw new Error('Příliš mnoho chybných pokusů. Počkejte 5 minut.');
      if(!data||!sameSecret_(data.pin,c.pin)){cache.put(key,String(fails+1),300);throw new Error('Nesprávný PIN.');}
      const payload=Utilities.base64EncodeWebSafe(JSON.stringify({exp:Date.now()+6*3600000,mode:c.mode,nonce:Utilities.getUuid()})).replace(/=+$/,'');
      return {status:'success',session:payload+'.'+sign_(payload,c),mode:c.mode,expiresAt:Date.now()+6*3600000};
    },5000);
  }catch(error){return {status:'error',message:error.message==='BUSY'?'Systém je vytížený.':error.message};}
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
