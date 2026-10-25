export async function onRequestGet({env}){
 try{const rows=await env.ADMIN_DB.prepare("SELECT id,name,url FROM web_partners WHERE state='published' ORDER BY name LIMIT 200").all();return Response.json({items:rows.results.map(r=>({...r,key:'central-'+r.id,logo:'/api/partner-logo?id='+r.id}))},{headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}catch{return Response.json({items:[]},{status:503,headers:{'Cache-Control':'no-store'}});}
}
