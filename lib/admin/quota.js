import {AdminError} from './access.js';
export function pragueDay(now){
 const date=new Date(now),parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(p=>[p.type,p.value]));
 const key=parts.year+'-'+parts.month+'-'+parts.day;let low=now-30*3600000,high=now;
 // Find the start of this actual local day, including both DST changes.
 const localKey=t=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t));
 while(high-low>1){const mid=Math.floor((low+high)/2);if(localKey(mid)===key)high=mid;else low=mid;}return {key,start:high};
}
export function quotaData(d,now){
 const stamp=v=>typeof v==='string'?Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(v)?v:v+'Z'):NaN;
 const start=stamp(d?.cycle_start),end=stamp(d?.cycle_end);
 if(!Number.isFinite(start)||!Number.isFinite(end)||start>now||end<=now||!['cycle_used','cycle_remaining','cycle_max'].every(k=>Number.isSafeInteger(d[k])&&d[k]>=0)||d.cycle_remaining>d.cycle_max||d.cycle_max>100000000)throw new AdminError('PROVIDER_QUOTA_INVALID',503);
 return {cycle_start:start,cycle_end:end,used:d.cycle_used,remaining:d.cycle_remaining,allowance:d.cycle_max,checked_at:now,error_code:null};
}
export async function providerQuota(env,fetcher=fetch,now=Date.now(),force=false){
 const db=env.ADMIN_DB;let q=await db.prepare('SELECT * FROM provider_quota WHERE id=1').first();
 if(force||!q||q.error_code||now-q.checked_at>120000||q.cycle_end<=now){
  const prior=q;
  try{const r=await fetcher('https://eu-api.smtp2go.com/v3/stats/email_cycle',{method:'POST',headers:{'Content-Type':'application/json','X-Smtp2go-Api-Key':env.SMTP2GO_API_KEY},body:'{}',redirect:'manual',signal:AbortSignal.timeout(8000)});if(!r.ok)throw Error();q=quotaData((await r.json()).data,now);
   const all=await db.prepare('SELECT COUNT(*) AS n FROM delivery_attempts WHERE started_at>=?').bind(q.cycle_start).first();q.external_used=Math.max(0,q.used-all.n,prior?.cycle_start===q.cycle_start?prior.external_used:0);
   await db.prepare('INSERT INTO provider_quota VALUES(1,?,?,?,?,?,?,NULL,?) ON CONFLICT(id) DO UPDATE SET cycle_start=excluded.cycle_start,cycle_end=excluded.cycle_end,used=excluded.used,remaining=excluded.remaining,allowance=excluded.allowance,checked_at=excluded.checked_at,error_code=NULL,external_used=excluded.external_used').bind(q.cycle_start,q.cycle_end,q.used,q.remaining,q.allowance,q.checked_at,q.external_used).run();
  }catch{await db.prepare("UPDATE provider_quota SET error_code='PROVIDER_QUOTA_UNAVAILABLE' WHERE id=1").run();throw new AdminError('PROVIDER_QUOTA_UNAVAILABLE',503);}
 }
 const local=await db.prepare('SELECT COUNT(*) AS n FROM delivery_attempts WHERE started_at>=?').bind(q.cycle_start).first();
 return {...q,effectiveRemaining:Math.max(0,Math.min(q.remaining,q.allowance-q.external_used-local.n))};
}
