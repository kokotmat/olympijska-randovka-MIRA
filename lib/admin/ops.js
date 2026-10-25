import {AdminError} from './access.js';
import {digest} from './delivery.js';
import {componentState} from './bridge.js';
import {providerQuota} from './quota.js';
const keys={sponsors:'SPONSORS_ADMIN_SECRET',reservations:'RESERVATIONS_ADMIN_SECRET',assistant:'ASSISTANT_ADMIN_SECRET'};
export async function opsSignature(d,secret){const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(JSON.stringify(['randovka-ops-v1',d.ts,d.nonce,d.source,d.op,d.args])))),b=>b.toString(16).padStart(2,'0')).join('');}
export async function verifyOps(d,env,now=Date.now()){
 if(!d||!keys[d.source]||!['report','backup','export','check'].includes(d.op)||!Number.isSafeInteger(d.ts)||Math.abs(now-d.ts)>120000||!/^[a-f0-9-]{36}$/i.test(d.nonce||'')||!d.args||typeof d.args!=='object'||Array.isArray(d.args))throw new AdminError('AUTH',401);
 const secret=env[keys[d.source]];if(!secret||secret.length<32)throw new AdminError('OPS_NOT_CONFIGURED',503);const a=await digest(String(d.signature)),b=await digest(await opsSignature(d,secret));let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);if(diff)throw new AdminError('AUTH',401);
}
export async function saveBackup(env,source,a,now=Date.now()){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(a.day||'')||!['sheets-json-gzip-v1','sqlite-gzip-v1'].includes(a.format)||source==='assistant'&&a.format!=='sqlite-gzip-v1'||source!=='assistant'&&a.format!=='sheets-json-gzip-v1'||!/^.{64}$/.test(a.sha256||'')||typeof a.payload!=='string'||a.payload.length>1500000||!a.payload.length||a.payload.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(a.payload))throw new AdminError('INVALID_BACKUP');
 const bytes=Uint8Array.from(atob(a.payload),c=>c.charCodeAt(0));if(bytes[0]!==31||bytes[1]!==139)throw new AdminError('INVALID_BACKUP');
 const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');if(sha!==a.sha256)throw new AdminError('INVALID_BACKUP');
 // Keep the first complete daily snapshot. A retry cannot replace a good copy.
 await env.ADMIN_DB.prepare('INSERT OR IGNORE INTO ops_backups VALUES(?,?,?,?,?,?)').bind(source,a.day,now,sha,a.format,a.payload).run();
 const row=await env.ADMIN_DB.prepare('SELECT created_at,sha256 FROM ops_backups WHERE source=? AND day=?').bind(source,a.day).first();return {stored:true,createdAt:row.created_at,sha256:row.sha256};
}
export async function exportSource(env,source){
 if(source==='assistant')throw new AdminError('FORBIDDEN',403);
 const tables={};for(const t of ['delivery_jobs','delivery_attempts','delivery_events','delivery_controls','delivery_cancellations','delivery_resolutions']){
  const clause=['delivery_attempts','delivery_events'].includes(t)?'job_id IN (SELECT id FROM delivery_jobs WHERE source=?)':t==='delivery_resolutions'?'job_id IN (SELECT id FROM delivery_jobs WHERE source=?)':'source=?';
  tables[t]=(await env.ADMIN_DB.prepare('SELECT * FROM '+t+' WHERE '+clause).bind(source).all()).results;
 }
 // Suppressions are limited to this source's actual recipients.
 tables.delivery_suppressions=(await env.ADMIN_DB.prepare('SELECT * FROM delivery_suppressions WHERE recipient IN (SELECT recipient FROM delivery_jobs WHERE source=?)').bind(source).all()).results;
 if(source==='sponsors')tables.web_partners=(await env.ADMIN_DB.prepare('SELECT * FROM web_partners').all()).results;
 tables.commands=(await env.ADMIN_DB.prepare('SELECT * FROM commands WHERE component=?').bind(source).all()).results;
 if(source==='sponsors'){tables.delivery_settings=(await env.ADMIN_DB.prepare('SELECT * FROM delivery_settings').all()).results;tables.provider_quota=(await env.ADMIN_DB.prepare('SELECT * FROM provider_quota').all()).results;tables.admin_actions=(await env.ADMIN_DB.prepare("SELECT * FROM admin_actions WHERE operation LIKE 'web/%' OR operation='delivery/settings'").all()).results;}
 return {format:'central-source-json-v1',source,createdAt:Date.now(),tables};
}
export async function operationalCheck(env,fetcher=fetch){
 const actor='vasik.resl@gmail.com',components=await Promise.all(['reservations','sponsors','assistant'].map(name=>componentState(env,name,actor)));const issues=[];
 for(const c of components){if(c.state!=='connected')issues.push(c.component.toUpperCase()+'_UNAVAILABLE');else if(c.component==='assistant'&&!c.data.ready)issues.push('ASSISTANT_NOT_READY');else if(c.component==='reservations'&&(c.data.maintenanceError||c.data.maintenanceAgeSeconds===null||c.data.maintenanceAgeSeconds>600))issues.push('RESERVATIONS_MAINTENANCE_STALE');else if(c.component==='sponsors'&&(!c.data.lastHeartbeat||Date.now()-Date.parse(c.data.lastHeartbeat)>1200000))issues.push('SPONSORS_TRIGGER_STALE');}
 let quota;try{quota=await providerQuota(env,fetcher);if(quota.effectiveRemaining===0)issues.push('MONTHLY_QUOTA_EXHAUSTED');else if(quota.effectiveRemaining<150)issues.push('MONTHLY_QUOTA_LOW');}catch{issues.push('PROVIDER_QUOTA_UNAVAILABLE');}
 const uncertain=await env.ADMIN_DB.prepare("SELECT COUNT(*) AS n FROM delivery_jobs WHERE state='uncertain'").first();if(uncertain.n)issues.push('DELIVERY_UNCERTAIN');
 const oldest=await env.ADMIN_DB.prepare("SELECT MIN(created_at) AS oldest FROM delivery_jobs WHERE state='queued'").first();
 const backups=(await env.ADMIN_DB.prepare('SELECT source,MAX(created_at) AS created_at FROM ops_backups GROUP BY source').all()).results;
 const reports=(await env.ADMIN_DB.prepare("SELECT source,state,checked_at FROM ops_reports WHERE source IN ('reservations','assistant')").all()).results;for(const r of reports)if(r.state==='error')issues.push(r.source.toUpperCase()+'_OPERATIONS_ERROR');else if(Date.now()-r.checked_at>1800000)issues.push(r.source.toUpperCase()+'_OPERATIONS_STALE');
 return {checkedAt:Date.now(),issues,backups,quota:quota?{remaining:quota.effectiveRemaining,used:quota.used,allowance:quota.allowance,cycleEnd:quota.cycle_end,checkedAt:quota.checked_at}:null,oldestQueuedAt:oldest.oldest};
}
