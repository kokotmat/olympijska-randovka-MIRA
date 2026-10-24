const jwksCache=new Map();
export class AdminError extends Error{constructor(code,status=400){super(code);this.code=code;this.status=status;}}
const decode=s=>{if(!/^[A-Za-z0-9_-]+$/.test(s))throw Error();return Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(s.length/4)*4,'=')),c=>c.charCodeAt(0));};
export async function identity(request,env,fetcher=fetch){
  const issuer=String(env.ACCESS_ISSUER||'').replace(/\/$/,'');
  if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer)||!env.ACCESS_AUD||!env.ADMIN_ROLES)throw new AdminError('ACCESS_NOT_CONFIGURED',503);
  let roles;try{roles=JSON.parse(env.ADMIN_ROLES);if(!roles||typeof roles!=='object'||Array.isArray(roles))throw Error();}catch{throw new AdminError('ACCESS_NOT_CONFIGURED',503);}
  const token=request.headers.get('Cf-Access-Jwt-Assertion');
  if(!token||token.length>16000)throw new AdminError('SIGN_IN_REQUIRED',401);
  let verificationStage='format';
  try{
    const parts=token.split('.');if(parts.length!==3)throw Error();
    const head=JSON.parse(new TextDecoder().decode(decode(parts[0]))),claims=JSON.parse(new TextDecoder().decode(decode(parts[1])));
    verificationStage='algorithm';
    if(head.alg!=='RS256'||typeof head.kid!=='string'||head.kid.length>200)throw Error();
    const now=Date.now()/1000,aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
    verificationStage='issuer';if(claims.iss!==issuer)throw Error();
    verificationStage='audience';if(!aud.includes(env.ACCESS_AUD))throw Error();
    verificationStage='expiry';if(!Number.isFinite(claims.exp)||claims.exp<=now)throw Error();
    verificationStage='issued_at';if(!Number.isFinite(claims.iat)||claims.iat>now+60)throw Error();
    verificationStage='not_before';if(claims.nbf!==undefined&&(!Number.isFinite(claims.nbf)||claims.nbf>now+30))throw Error();
    verificationStage='signing_keys';
    let entry=jwksCache.get(issuer);
    if(!entry||entry.until<Date.now()||!entry.keys.some(k=>k.kid===head.kid)&&Date.now()-entry.fetchedAt>60000){
      // Workers rejects redirect:'error'; manual still refuses every redirect via !ok.
      const r=await fetcher(issuer+'/cdn-cgi/access/certs',{signal:AbortSignal.timeout(5000),redirect:'manual'});
      if(!r.ok)throw new AdminError('IDENTITY_PROVIDER_UNAVAILABLE',503);
      const data=await r.json();if(!Array.isArray(data.keys)||data.keys.length>20)throw Error();
      entry={keys:data.keys,until:Date.now()+300000,fetchedAt:Date.now()};jwksCache.set(issuer,entry);
    }
    verificationStage='signing_key';
    const jwk=entry.keys.find(k=>k.kid===head.kid&&k.kty==='RSA'&&(!k.alg||k.alg==='RS256'));
    if(!jwk)throw Error();
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    verificationStage='signature';
    if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,decode(parts[2]),new TextEncoder().encode(parts.slice(0,2).join('.'))))throw Error();
    const email=String(claims.email||'').toLowerCase(),role=roles[email];
    if(!['admin','reservations','sponsors','viewer'].includes(role))throw new AdminError('FORBIDDEN',403);
    return {email,role};
  }catch(error){if(error instanceof AdminError)throw error;const denied=new AdminError('INVALID_IDENTITY',401);denied.verificationStage=verificationStage;throw denied;}
}
export function permit(user,area,write=false){
  if(user.role==='admin')return;
  if(write&&(user.role==='viewer'||user.role!==area))throw new AdminError('FORBIDDEN',403);
  if(!write&&area!=='overview'&&area!=='history'&&user.role!=='viewer'&&user.role!==area)throw new AdminError('FORBIDDEN',403);
}
export const privateHeaders={'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'"};
export const json=(data,status=200)=>Response.json(data,{status,headers:privateHeaders});
export const errorResponse=error=>json({status:'error',code:error instanceof AdminError?error.code:'INTERNAL_ERROR',...(error instanceof AdminError&&error.code==='INVALID_IDENTITY'?{verificationStage:error.verificationStage}:{})},error instanceof AdminError?error.status:500);
export async function protect(context){
  try{context.data.identity=await identity(context.request,context.env);const result=await context.next();const r=new Response(result.body,result);for(const [k,v]of Object.entries(privateHeaders))r.headers.set(k,v);return r;}catch(error){return errorResponse(error);}
}
