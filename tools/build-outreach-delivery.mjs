import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function buildOutreachDelivery(input){
 if(input.includes('const RD_OUTBOX_HEADERS='))throw Error('Already integrated; compare the deployed source before rebuilding.');
 let source=input.replace(/\r\n/g,'\n');
 function replace(before,after){if(source.split(before).length!==2)throw Error('Unsupported source hook: '+before.slice(0,85));source=source.replace(before,after);}
 function hook(name,line){const pattern=new RegExp('function '+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\([^)]*\\)\\s*\\{','g'),matches=[...source.matchAll(pattern)];if(matches.length!==1)throw Error('Unsupported function: '+name);const at=matches[0].index+matches[0][0].length;source=source.slice(0,at)+'\n  '+line+'\n'+source.slice(at);}
 hook('senderProvider_',"if(rdOutreachUsesCentral_())return 'CENTRAL_SMTP2GO';");
 hook('sendViaConfiguredProvider_',"if(rdOutreachUsesCentral_())throw Error('DELIVERY_CENTRAL_QUEUE_ONLY');");
 hook('sendViaGmailWorkspace_',"rdOutreachGuardLegacy_(to);");hook('sendViaSmtp2go_',"rdOutreachGuardLegacy_(to);");
 hook('sendLead_',"if(rdOutreachUsesCentral_())throw Error('DELIVERY_USE_QUEUE');");
 hook('processDueFollowups_',"if(rdOutreachUsesCentral_())return 0; // Central tick owns follow-ups and receipts.");
 hook('v15SenderCheck_',"if(rdOutreachUsesCentral_()){v200Owner_();if(clean_(s.SENDER_EMAIL).toLowerCase()!==V200.OWNER)throw Error('DELIVERY_SENDER_MISMATCH');return;}");
 hook('v16QueueTickUnlocked_',"if(rdOutreachUsesCentral_())return rdOutreachTick_(false);");
 replace("if(senderProvider_(v200Context_?v200Context_.settings:getSettings_())!=='GMAIL_WORKSPACE')return [];", "if(!['GMAIL_WORKSPACE','CENTRAL_SMTP2GO'].includes(senderProvider_(v200Context_?v200Context_.settings:getSettings_())))return []; // Preserve BCC detection; central admission requires review.");
 replace('try{if(v200Waiting_())return;return v16QueueTickUnlocked_();}', 'try{if(rdOutreachUsesCentral_())return rdOutreachTick_(false);if(v200Waiting_())return;return v16QueueTickUnlocked_();}');
 replace('    if(v200Waiting_())return;\n    processBounces_();processReplies_(false);', "    if(rdOutreachUsesCentral_()){rdDeliveryTick_('sponsors',false,rdOutreachWindow_(getSettings_()));processBounces_();processReplies_(false);return rdOutreachTick_(false);}\n    if(v200Waiting_())return;\n    processBounces_();processReplies_(false);");
 replace("provider:settings.SENDER_PROVIDER||'Neověřeno'", "provider:typeof rdOutreachUsesCentral_==='function'&&rdOutreachUsesCentral_()?'CENTRAL_SMTP2GO':settings.SENDER_PROVIDER||'Neověřeno'");
 replace("communicationStatus:get('reply_status')||get('automation_status')||get('send_status'),", "communicationStatus:get('reply_status')||get('automation_status')||get('send_status'),mailDeliveryStatus:get('central_delivery_status'),mailDeliveryCheckedAt:r[map.central_delivery_checked_at] instanceof Date?r[map.central_delivery_checked_at].getTime():null,");
 replace("SpreadsheetApp.flush();result={status:'success',data:{paused:true}};", "SpreadsheetApp.flush();if(typeof rdOutreachUsesCentral_==='function'&&rdOutreachUsesCentral_())rdDeliveryTick_('sponsors',false,rdOutreachWindow_(settings));result={status:'success',data:{paused:true}};");
 source+='\n\n'+fs.readFileSync(path.join(root,'integrations/delivery/Client.gs'),'utf8')+'\n'+fs.readFileSync(path.join(root,'integrations/outreach/Delivery.gs'),'utf8');
 new vm.Script(source);return source;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [input,output]=process.argv.slice(2);if(!input||!output)throw Error('Usage: node tools/build-outreach-delivery.mjs private-current-source.gs private-output.gs');
 fs.writeFileSync(output,buildOutreachDelivery(fs.readFileSync(input,'utf8')));console.log('Built source; no Google state or sending switches changed.');
}
