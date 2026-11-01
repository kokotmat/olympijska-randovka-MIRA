/** Read-only shared mailbox. No sending, draft creation or mark-as-read side effects. */
function rdMailbox_(op,args,actor){
  const account='maturitni.ples@olympijskarandovka.cz';
  if(!['vasik.resl@gmail.com','miramus111@gmail.com'].includes(actor))throw Error('AUTH');
  if(String(Session.getEffectiveUser().getEmail()).toLowerCase()!==account)throw Error('MAILBOX_ACCOUNT_MISMATCH');
  const id=String(args.id||''),cursor=String(args.cursor||'0');
  if(!/^\d{1,6}$/.test(cursor))throw Error('REJECTED');
  const offset=Number(cursor),checkedAt=Date.now();
  if(op==='mailList'){
    const filters={all:'in:anywhere -in:trash -in:spam',inbox:'in:inbox',sent:'in:sent',drafts:'in:drafts',trash:'in:trash',spam:'in:spam'};
    const folder=args.folder||'inbox';if(!Object.prototype.hasOwnProperty.call(filters,folder))throw Error('REJECTED');
    const q=String(args.q||'');if(q.length>200||/[\r\n\x00]/.test(q))throw Error('REJECTED');
    const threads=GmailApp.search(filters[folder]+(q?' ('+q+')':''),offset,21);
    const items=threads.slice(0,20).map(t=>({id:t.getId(),subject:t.getFirstMessageSubject(),count:t.getMessageCount(),lastAt:t.getLastMessageDate().getTime(),unread:t.isUnread()}));
    return {account,items,nextCursor:threads.length>20?String(offset+20):null,checkedAt,source:'GMAIL_WORKSPACE'};
  }
  if(!/^[a-f0-9]{10,32}$/i.test(id))throw Error('REJECTED');
  if(op==='mailThread'){
    const thread=GmailApp.getThreadById(id);if(!thread)throw Error('NOT_FOUND');
    const all=thread.getMessages();
    const items=all.slice(offset,offset+10).map(m=>{
      const plain=m.getPlainBody(),attachments=m.getAttachments({includeInlineImages:false,includeAttachments:true});
      return {id:m.getId(),threadId:id,from:m.getFrom(),to:m.getTo(),cc:m.getCc(),bcc:m.getBcc(),subject:m.getSubject(),date:m.getDate().getTime(),text:plain.slice(0,100000),truncated:plain.length>100000,draft:m.isDraft(),attachments:attachments.map((a,index)=>({index,name:a.getName(),type:a.getContentType(),size:a.getSize()}))};
    });
    return {account,id,items,total:all.length,nextCursor:offset+10<all.length?String(offset+10):null,checkedAt,source:'GMAIL_WORKSPACE'};
  }
  if(op==='mailAttachment'){
    if(!Number.isInteger(args.index)||args.index<0||args.index>100)throw Error('REJECTED');
    const m=GmailApp.getMessageById(id);if(!m)throw Error('NOT_FOUND');
    const a=m.getAttachments({includeInlineImages:false,includeAttachments:true})[args.index];if(!a)throw Error('NOT_FOUND');
    if(a.getSize()>2000000)throw Error('ATTACHMENT_TOO_LARGE');
    return {account,name:a.getName(),base64:Utilities.base64Encode(a.getBytes()),checkedAt};
  }
  throw Error('REJECTED');
}
