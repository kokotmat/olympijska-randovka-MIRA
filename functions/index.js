export function onRequest({request,next}){
  if(new URL(request.url).hostname==='sprava.olympijskarandovka.cz')return Response.redirect(new URL('/sprava/',request.url),302);
  return next();
}
