const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
export async function renderMailbox({view,api,active,notice},filters={folder:'inbox',q:'',cursor:'0'}){
 const form=node('form',undefined,'toolbar mailbox-toolbar'),select=node('select'),input=node('input'),submit=node('button','Hledat','button');
 select.setAttribute('aria-label','Složka pošty');input.setAttribute('aria-label','Hledat v poště');input.placeholder='Jméno, předmět, adresa…';input.maxLength=200;input.value=filters.q||'';
 for(const [value,label] of Object.entries({inbox:'Příchozí',sent:'Odeslané',drafts:'Koncepty',all:'Veškerá pošta',spam:'Spam',trash:'Koš'})){const o=node('option',label);o.value=value;select.append(o);}select.value=filters.folder;
 form.append(select,input,submit);
 const reload=()=>renderMailbox({view,api,active,notice},{folder:select.value,q:input.value,cursor:'0'}).catch(e=>notice(e.message,true));
 form.addEventListener('submit',e=>{e.preventDefault();reload();});select.addEventListener('change',reload);
 const list=node('div',undefined,'mail-list'),status=node('p','Načítám skutečnou poštu…','muted');status.setAttribute('role','status');view.replaceChildren(form,status,list);
 const requestId=crypto.randomUUID();view.dataset.mailRequest=requestId;
 const d=await api('mail/list?'+new URLSearchParams(filters));if(!active()||view.dataset.mailRequest!==requestId)return;
 status.textContent=d.account+' · načteno '+new Date(d.checkedAt).toLocaleString('cs-CZ',{timeZone:'Europe/Prague'});
 const freshness=document.getElementById('last-check');if(freshness){freshness.textContent='Načteno '+new Date(d.checkedAt).toLocaleString('cs-CZ');freshness.dataset.loadedAt=String(d.checkedAt);freshness.classList.remove('data-stale');}
 if(!d.items.length)list.append(node('p','Žádná vlákna pro tento výběr.'));
 for(const t of d.items){const b=node('button',undefined,'mail-row');b.type='button';b.append(node('strong',t.subject||'(bez předmětu)'),node('span',new Date(t.lastAt).toLocaleString('cs-CZ')+' · '+t.count+' zpráv'+(t.unread?' · nepřečtené':'')));b.addEventListener('click',()=>showThread(t.id,api,notice,active));list.append(b);}
 const paging=node('div',undefined,'actions');
 for(const [label,cursor]of [['Předchozí stránka',Number(filters.cursor)>0?String(Math.max(0,Number(filters.cursor)-20)):null],['Další stránka',d.nextCursor]])if(cursor!==null&&cursor!==undefined){const b=node('button',label,'button secondary');b.type='button';b.addEventListener('click',()=>renderMailbox({view,api,active,notice},{...filters,cursor}).catch(e=>notice(e.message,true)));paging.append(b);}list.append(paging);
}
let detailRequest=0;
async function showThread(id,api,notice,active,cursor='0',append=false){
 const request=++detailRequest,dialog=document.getElementById('detail-dialog'),c=document.getElementById('detail-content');
 if(!append){document.getElementById('detail-title').textContent='E-mailové vlákno';c.replaceChildren(node('p','Načítám zprávy…'));if(!dialog.open){dialog.addEventListener('close',()=>{detailRequest++;},{once:true});dialog.showModal();}}
 try{const d=await api('mail/thread?'+new URLSearchParams({id,cursor}));if(request!==detailRequest||!dialog.open||!active())return;if(!append)c.replaceChildren();
 for(const m of d.items){const article=node('article',undefined,'mail-message');article.append(node('h3',m.subject||'(bez předmětu)'),node('p',(m.draft?'Koncept · ':'')+new Date(m.date).toLocaleString('cs-CZ')));
 for(const [label,value]of [['Od',m.from],['Komu',m.to],['Kopie',m.cc],['Skrytá kopie',m.bcc]])if(value)article.append(node('p',label+': '+value,'mail-address'));
 article.append(node('pre',m.text,'mail-body'));if(m.truncated)article.append(node('p','Zobrazeno prvních 100 000 znaků. Celý text je dostupný v Gmailu.','notice'));
 for(const a of m.attachments){const link=node('a',a.name+' ('+Math.ceil(a.size/1024)+' kB)');if(a.size<=2000000){link.href='/api/admin/mail/attachment?'+new URLSearchParams({id:m.id,index:String(a.index)});link.setAttribute('download','');}else{link.textContent+=' — otevři v Gmailu';}article.append(link,node('br'));}c.append(article);}
 const gmail=node('a','Otevřít originál v Gmailu ↗');gmail.href='https://mail.google.com/mail/u/?authuser='+encodeURIComponent(d.account)+'#all/'+encodeURIComponent(id);gmail.target='_blank';gmail.rel='noopener noreferrer';c.append(gmail);
 if(d.nextCursor){const more=node('button','Další zprávy ve vlákně','button secondary');more.type='button';more.addEventListener('click',()=>{more.disabled=true;showThread(id,api,notice,active,d.nextCursor,true).then(ok=>{if(ok)more.remove();else more.disabled=false;});});c.append(more);}
 return true;}catch(e){if(request===detailRequest&&dialog.open&&active())c.append(node('p',e.message,'notice error'));}
}
