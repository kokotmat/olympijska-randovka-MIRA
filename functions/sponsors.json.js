// Keep repository documentation and test sources outside the public website.
export function onRequest() {
  return new Response('<!doctype html><html lang="cs"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Stránka nenalezena | Olympijská Randovka</title><body style="font:18px/1.6 system-ui;padding:40px;background:#f3f7fc;color:#17191c"><h1>Stránka nenalezena</h1><p>Tento obsah není součástí veřejného webu.</p><a href="/">Zpět na Olympijskou Randovku</a></body></html>', {status:404,headers:{'Content-Type':'text/html; charset=utf-8','X-Robots-Tag':'noindex','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY'}});
}
