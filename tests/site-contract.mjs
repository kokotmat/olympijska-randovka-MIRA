import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const html=read('index.html');
assert.match(html,/<html lang="cs">/);
assert.equal((html.match(/<h1\b/g)||[]).length,1);
assert.match(html,/<link rel="canonical" href="https:\/\/olympijskarandovka.cz\/">/);
assert.doesNotMatch(read('sitemap.xml'),/\/test/);
assert.match(read('_redirects'),/^\/test \/ 301$/m);
assert(fs.existsSync(path.join(root,'404.html')));
const event=JSON.parse(html.match(/<script type="application\/ld\+json">\s*([\s\S]*?)<\/script>/)[1]);
assert.equal(event['@type'],'Event');assert.equal(event.url,'https://olympijskarandovka.cz/');
assert.equal(event.location.address.streetAddress,'Jiráskova 2047/7');
assert.match(event.startDate,/2027-01-22T18:00:00\+01:00/);
const image=html.match(/property="og:image" content="([^"]+)"/)[1];
assert.equal(image,'https://olympijskarandovka.cz/assets/sdileni-2027.jpg');
for(const match of html.matchAll(/(?:src|href)="([^"]+)"/g)){
  const value=match[1];
  if(value.startsWith('#'))assert(html.includes(`id="${value.slice(1)}"`),value);
  else if(!/^(https?:|mailto:)/.test(value))assert(fs.existsSync(path.join(root,value.split('?')[0].replace(/^\//,''))),value);
}
assert.match(html,/<form id="ticket-form" method="post">/);
for(const id of ['buyer-name','buyer-email']){
  const input=html.match(new RegExp(`<input id="${id}"[^>]*>`))[0];
  assert.match(input,/\bdisabled\b/);assert.doesNotMatch(input,/\bname=/);
}
assert.match(html,/<button class="button submit" type="submit" disabled>/);
assert.match(html,/vstupenka na ples zde neplatí/);
const sponsors=JSON.parse(read('sponsors.json'));
const scope={window:{}};vm.runInNewContext(read('sponsors.js'),scope);
assert.equal(JSON.stringify(scope.window.PLES_SPONSORS),JSON.stringify(sponsors));
assert.equal(new Set(sponsors.map(s=>s.key)).size,sponsors.length);
for(const s of sponsors){assert.match(s.url,/^https:\/\//);assert(fs.existsSync(path.join(root,s.logo)));assert(html.includes(`data-sponsor="${s.key}" href="${s.url}"`));}
assert(sponsors.some(s=>s.key==='cityzen'&&s.logo.endsWith('.svg')));
assert(sponsors.some(s=>s.key==='shocart'&&s.url==='https://shocart.cz/'));
assert(fs.statSync(path.join(root,'assets/favicon-32.png')).size<15000);
assert(fs.statSync(path.join(root,'assets/sdileni-2027.jpg')).size<300000);
const scanner=read('kontrola-vstupenek.html');
assert(scanner.includes('OSTRÝ REŽIM'));assert(!scanner.includes('OSTRÉ ODBAVENÍ'));
assert(scanner.includes('body.message'));assert(scanner.includes('background:#006b96;color:white'));
for(const name of ['app.js','sponsors.js','data.js','animations.js','olympic-effects.js','sponsor-controls.js','table-layout.js','table-picker.js'])new vm.Script(read(name),{filename:name});
for(const s of scanner.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(s[1]);
for(const name of ['SKENER.md.js','KONTROLA.md.js','BACKEND.md.js','README.md.js','SEO.md.js','sponsors.json.js','tests/[[path]].js','scripts/[[path]].js']){
  const source=read('functions/'+name);
  const module=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const response=module.onRequest();assert.equal(response.status,404);assert.equal(response.headers.get('X-Robots-Tag'),'noindex');
}
console.log('PASS: canonical, event data, share image, safe pre-sale form, 404 routing, local links, sponsor consistency, asset budgets, scanner contrast and script syntax.');
