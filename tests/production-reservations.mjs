import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
const core=fs.readFileSync(new URL('../backend/production/Reservations.gs',import.meta.url),'utf8');
const qrSource=fs.readFileSync(new URL('../backend/production/QrCode.gs',import.meta.url),'utf8');
const decoderSource=fs.readFileSync(new URL('../backend/production/jsQR.js',import.meta.url),'utf8');
const plain=v=>JSON.parse(JSON.stringify(v));
let now=Date.now(),lockHeld=false,lockBlocked=false,mailFail=false,quota=500,bankResponse=null,bankHttp=200,fetches=0;
const RealDate=Date;
class Clock extends RealDate{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
class Sheet {
 constructor(name,headers){this.name=name;this.data=[headers.slice()];}
 getLastRow(){return this.data.length;}
 getName(){return this.name;}
 getMaxColumns(){return 26;}
 setFrozenRows(){}
 getRange(row,col,height=1,width=1){
  const s=this;
  return {setNumberFormat(){return this;},setFontWeight(){return this;},setBackground(){return this;},setFontColor(){return this;},getValues:()=>Array.from({length:height},(_,i)=>Array.from({length:width},(_,j)=>s.data[row+i-1]?.[col+j-1]??'')),
   setValues(values){for(let i=0;i<height;i++){s.data[row+i-1]??=[];for(let j=0;j<width;j++)s.data[row+i-1][col+j-1]=values[i][j];}return this;},
   createTextFinder(term){let exact=false,matchCase=true;const f={matchEntireCell(v){exact=v;return f;},useRegularExpression(){return f;},matchCase(v){matchCase=v;return f;},findNext(){for(let i=row-1;i<Math.min(s.data.length,row-1+height);i++)for(let j=col-1;j<col-1+width;j++){let value=String(s.data[i]?.[j]??''),needle=String(term);if(!matchCase){value=value.toLowerCase();needle=needle.toLowerCase();}if(exact?value===needle:value.includes(needle))return{getRow:()=>i+1};}return null;}};return f;}};
 }
 appendRow(row){this.data.push(row.slice());}
}
const values={RUN_MODE:'test',SALES_OPEN:'true',SALES_OPEN_MODE:'test',SCANNER_OPEN:'true',SCANNER_OPEN_MODE:'test',IBAN:'CZ2720100000002403476467',SCRIPT_URL:'https://script.google.com/macros/s/TEST_ONLY/exec',SCANNER_PIN:'87654321',SESSION_SECRET:'secret'.repeat(12),FIO_TOKEN:'T'.repeat(64),REPLY_TO:'tickets@example.com',FIO_FROM_DATE:'2026-01-01'};
const cache=new Map(),mails=[],documents=[];
const properties={getProperties:()=>({...values}),getProperty:k=>values[k]??null,setProperty(k,v){values[k]=v;return properties;},deleteProperty(k){delete values[k];return properties;}};
const blob=(bytes,type,name)=>({getBytes:()=>[...bytes],getDataAsString:()=>Buffer.from(bytes).toString(),setName(n){name=n;return this;},getName:()=>name,getAs(){return this;}});
const context={Date:Clock,console,Buffer,
 PropertiesService:{getScriptProperties:()=>properties},
 Utilities:{getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},
  computeDigest:(alg,s)=>[...crypto.createHash('sha256').update(s).digest()],computeHmacSha256Signature:(s,key)=>[...crypto.createHmac('sha256',key).update(s).digest()],
  base64EncodeWebSafe:v=>Buffer.from(typeof v==='string'?v:new Uint8Array(v)).toString('base64url'),base64DecodeWebSafe:v=>[...Buffer.from(v,'base64url')],base64Decode:v=>[...Buffer.from(v,'base64')],
  newBlob:(data,type,name)=>blob(typeof data==='string'?Buffer.from(data):data,type,name),formatDate:d=>new RealDate(d).toISOString().slice(0,10)},
 LockService:{getScriptLock:()=>({tryLock(){if(lockHeld||lockBlocked)return false;lockHeld=true;return true;},releaseLock(){assert.equal(lockHeld,true);lockHeld=false;}})},
 CacheService:{getScriptCache:()=>({get:k=>cache.get(k)??null,put:(k,v)=>cache.set(k,v)})},
 Session:{getActiveUser:()=>({getEmail:()=>''}),getEffectiveUser:()=>({getEmail:()=> 'owner@example.com'})},
 MailApp:{getRemainingDailyQuota:()=>quota,sendEmail:m=>{if(mailFail)throw new Error('unknown transport failure');mails.push(m);}},
 UrlFetchApp:{fetch:(url)=>{assert.equal(new URL(url).hostname,'fioapi.fio.cz');fetches++;return {getResponseCode:()=>bankHttp,getContentText:()=>JSON.stringify(bankResponse)};}},
 ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({text,setMimeType(){return this;}})},
 HtmlService:{createHtmlOutput:html=>({html,setTitle(){return this;},addMetaTag(){return this;}})},
 DocumentApp:{ParagraphHeading:{HEADING1:1,HEADING2:2},HorizontalAlignment:{CENTER:'center'},create:name=>{
  const doc={getId:()=>name,saveAndClose(){},getBody(){return body;}};
  const paragraph={setHeading(){return this;},setAlignment(){return this;},appendInlineImage(){return{setWidth(){return this;},setHeight(){return this;}};}};
  const body={clear(){},setMarginTop(){return this;},setMarginBottom(){return this;},setMarginLeft(){return this;},setMarginRight(){return this;},appendParagraph(){return paragraph;},appendPageBreak(){}};
  documents.push(name);return doc;}},
 DriveApp:{getFileById:()=>({getAs:()=>blob([1,2,3],'application/pdf','ticket.pdf'),setTrashed(){}})},MimeType:{PDF:'application/pdf'}
};
vm.createContext(context);vm.runInContext(core+'\n'+qrSource,context);
const R=vm.runInContext('R',context);
const sheets={Sheet1:new Sheet('Sheet1',R.headers),Test_rezervace_PRO:new Sheet('Test_rezervace_PRO',R.headers),_Platby_live:new Sheet('_Platby_live',['ID','Date','VS','Cents','Currency']),_Platby_test:new Sheet('_Platby_test',['ID','Date','VS','Cents','Currency'])};
context.SpreadsheetApp={openById:id=>{assert.equal(id,'1kvTNS2e6IsavmOCOQG__3htPBcISzadckq_Fz0jHziA');return{getSheetByName:name=>sheets[name]??null};},flush(){}};
const callPost=data=>JSON.parse(context.doPost({postData:{contents:JSON.stringify(data)}}).text);
const base={name:'Tester',email:'test@example.com',ticketType:'Místenka ke stolu',count:2,totalPrice:1,table:'Sál - Stůl 1',oddelenePdf:true};
const order=(change={})=>({...base,requestId:crypto.randomUUID(),...change});
const first=order();assert.equal(callPost(first).status,'success');
const test=sheets.Test_rezervace_PRO;
assert.equal(test.data[1][5],900);assert.equal(test.data[1][7],'Čeká na platbu');
assert.equal(callPost(first).duplicate,true);assert.equal(test.data.length,2);
assert.equal(callPost({...first,count:1}).status,'error');
assert.equal(callPost(order({count:3,email:'other@example.com'})).status,'error');
assert.equal(callPost(order({count:2,email:'other@example.com'})).status,'success');
assert.equal(callPost(order({count:1,email:'third@example.com'})).status,'error');
for(const change of [{count:0},{count:1.5},{count:'2'},{count:11},{ticketType:'Unknown'},{table:'Sál - Stůl 999'},{name:'\n'},{email:'a@b\n.com'},{requestId:''},{oddelenePdf:'false'}])assert.equal(callPost(order(change)).status,'error');
lockBlocked=true;assert.equal(callPost(order()).code,'BUSY');lockBlocked=false;
assert.equal(context.validIban_('CZ8420100000002403476467'),false);
assert.equal(context.validIban_('CZ2720100000002403476467'),true);
assert.throws(()=>context.owner_());
assert.equal(context.scannerLogin({pin:'bad'}).status,'error');
const login=context.scannerLogin({pin:values.SCANNER_PIN});assert.equal(login.status,'success');
assert.equal(callPost({action:'scannerLogin',pin:values.SCANNER_PIN}).status,'success');
const hash=test.data[1][8].split(',')[0];
let scan=context.scannerScan({session:login.session,hash});assert.equal(scan.code,'UNPAID');
const before=test.data[1][11];
context.doGet({parameter:{action:'validate',hash,pin:values.SCANNER_PIN}});assert.equal(test.data[1][11],before);
test.data[1][7]='Zaplaceno';
scan=context.scannerScan({session:login.session,hash});assert.equal(scan.code,'ADMITTED');assert.equal(scan.used,1);
assert.equal(context.scannerScan({session:login.session,hash}).code,'USED');
const originalA=test.data[1],originalB=test.data[2];test.data[1]=originalB;test.data[2]=originalA;
assert.equal(context.scannerScan({session:login.session,hash}).code,'USED','Stale row cache after a sheet sort must resolve the exact hash again');
test.data[1]=originalA;test.data[2]=originalB;
lockBlocked=true;assert.equal(context.scannerScan({session:login.session,hash}).code,'BUSY');lockBlocked=false;
assert.equal(context.scannerScan({session:'forged',hash}).code,'AUTH');
const secondHash=test.data[1][8].split(',')[1];
assert.equal(context.scannerScan({session:login.session,hash:secondHash}).code,'ADMITTED');
assert.equal(test.data[1][7],'Odbaveno (Vstoupil)');
const publicView=context.publicTicket_(hash,context.cfg_()).html;
assert.equal(publicView.includes('Tester'),false);assert.equal(publicView.includes('test@example.com'),false);
values.RUN_MODE='live';assert.equal(context.scannerScan({session:login.session,hash}).code,'AUTH');
assert.equal(context.cfg_().open,false,'Changing mode must never inherit an open test sale');
assert.equal(context.cfg_().gate,false,'Changing mode must never inherit an open test gate');
values.SALES_OPEN_MODE='live';
const live=sheets.Sheet1;
values.BANK_LAST_OK=String(now);
values.BANK_CONFIG_FINGERPRINT=context.bankKey_(context.cfg_());
const liveFirst=order();assert.equal(callPost(liveFirst).status,'success');
assert.equal(callPost(order({mode:'test'})).status,'error');
const vs=live.data[1][6],tx=(id,amount,variable=vs)=>({column22:{value:id},column1:{value:amount},column5:{value:variable},column14:{value:'CZK'},column0:{value:'2026-10-22'}});
const statement=transactions=>({accountStatement:{info:{iban:values.IBAN,currency:'CZK'},transactionList:{transaction:transactions}}});
bankResponse=statement([tx('10001',400),tx('10002',500),tx('10003',500,'9999999999')]);
assert.equal(context.checkPayments_(),true);assert.equal(live.data[1][7],'Zaplaceno');assert.equal(live.data[1][18],900);
assert.equal(sheets._Platby_live.data.length,3);
now+=36000;assert.equal(context.checkPayments_(),true);assert.equal(sheets._Platby_live.data.length,3,'Same bank transaction must never count twice');
const attemptCount=fetches;assert.equal(context.checkPayments_(),true);assert.equal(fetches,attemptCount);
assert.throws(()=>context.fioSnapshot_({accountStatement:{info:{iban:'OTHER',currency:'CZK'}}},context.cfg_()));
context.sendOutbox_();assert.equal(mails.length,1,'Paid order should skip confirmation and send tickets');assert.equal(mails[0].attachments.length,2);assert.equal(documents.length,2);
context.sendOutbox_();assert.equal(mails.length,1,'Sent email must not automatically repeat');
const expiry=order({email:'expire@example.com',table:'Sál - Stůl 2'});assert.equal(callPost(expiry).status,'success');
live.data[2][15]=new Clock(now-36*60000);live.data[2][16]='ODESLÁNO';
bankHttp=500;now+=36000;assert.equal(context.checkPayments_(),false);assert.equal(live.data[2][7],'Čeká na platbu','Bank failure must not expire reservation');
bankHttp=200;now+=36000;context.checkPayments_();assert.equal(live.data[2][7],'Zrušeno - Nezaplaceno');
bankResponse=statement([tx('10001',400),tx('10002',500),tx('10004',900,live.data[2][6])]);now+=36000;
context.checkPayments_();assert.equal(live.data[2][7],'Pozdní platba – ruční kontrola');assert.equal(live.data[2][17],'');
const mailOrder=order({email:'mail@example.com',table:'Sál - Stůl 3'});callPost(mailOrder);
mailFail=true;context.sendOutbox_();assert.equal(live.data[3][16],'NEJASNÉ – ověřit odeslání');
mailFail=false;const sentBefore=mails.length;context.sendOutbox_();assert.equal(mails.length,sentBefore,'Ambiguous mail failure must not blindly resend');
values.RUN_MODE='test';values.TEST_SEND_EMAILS='false';context.sendOutbox_();assert.equal(mails.length,sentBefore);
values.SCANNER_OPEN='false';assert.equal(context.scannerScan({session:login.session,hash}).code,'CLOSED');values.SCANNER_OPEN='true';
// Real QR encoder / decoder round trip, without external requests.
const decoder={};vm.createContext(decoder);vm.runInContext(decoderSource,decoder);
for(const value of ['https://script.google.com/macros/s/TEST_ONLY/exec?action=validate&hash='+hash,'SPD*1.0*ACC:'+values.IBAN+'*AM:900.00*CC:CZK*X-VS:1234567890']){
 const qr=context.qrcode(0,'M');qr.addData(value,'Byte');qr.make();const scale=5,border=4,size=(qr.getModuleCount()+2*border)*scale;
 const pixels=new Uint8ClampedArray(size*size*4);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){const r=Math.floor(y/scale)-border,c=Math.floor(x/scale)-border,dark=r>=0&&c>=0&&r<qr.getModuleCount()&&c<qr.getModuleCount()&&qr.isDark(r,c),i=(y*size+x)*4;pixels[i]=pixels[i+1]=pixels[i+2]=dark?0:255;pixels[i+3]=255;}
 assert.equal(decoder.jsQR(pixels,size,size).data,value);
 assert.equal(context.qrBlob_(value,'QR').getBytes().slice(0,3).map(v=>String.fromCharCode(v)).join(''),'GIF');
}
now+=7*3600000;assert.equal(context.scannerScan({session:login.session,hash}).code,'AUTH');
// Schema extension must preserve original ticket hashes and never queue old emails.
context.Session.getActiveUser=()=>({getEmail:()=> 'owner@example.com'});
context.SpreadsheetApp.getUi=()=>({alert(){}});
const legacyHash=crypto.randomUUID();
live.data.push([new Clock(),'Legacy','legacy@example.com','Základní vstupenka',1,350,'1234567890','Zaplaceno',legacyHash,'',false,'']);
context.setupSystem();
const legacy=live.data.at(-1);
assert.equal(legacy[8],legacyHash);assert.equal(legacy[6],'1234567890');assert.equal(legacy[16],'LEGACY – ověřit');assert.equal(legacy[17],'LEGACY – ověřit');
assert.ok(legacy[14].startsWith('LEGACY-'));
live.data[0][0]='wrong header';assert.throws(()=>context.setupSystem(),/hlavičky/);live.data[0][0]='Timestamp';
context.SpreadsheetApp.getUi=()=>{throw new Error('Cannot call SpreadsheetApp.getUi() from this context.');};
assert.doesNotThrow(()=>context.setupSystem());
assert.match(context.diagnostics(),/Spouštějící účet/);
assert.equal(lockHeld,false);
console.log('PASS: production reservations, prices, request idempotency, capacity, inputs, IBANs, owner checks, signed sessions, unpaid/used/concurrent scans, no GET mutation, privacy, Fio split payments and deduplication, bank outage/expiry/late payments, PDF mail queue and ambiguous-send protection, real local QR encode/decode.');
