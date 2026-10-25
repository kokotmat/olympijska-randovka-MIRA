export async function onRequestGet({request,env}){
 const id=new URL(request.url).searchParams.get('id');if(!/^[a-f0-9-]{36}$/i.test(id||''))return new Response(null,{status:404});
 try{const r=await env.ADMIN_DB.prepare("SELECT mime,image FROM web_partners WHERE id=? AND state='published'").bind(id).first();if(!r)return new Response(null,{status:404,headers:{'Cache-Control':'no-store'}});return new Response(Uint8Array.from(atob(r.image),c=>c.charCodeAt(0)),{headers:{'Content-Type':r.mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'"}});}catch{return new Response(null,{status:503});}
}
