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
    lastIncidentAt:Number(p.MAINTENANCE_LAST_ERROR_AT)||null};
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
