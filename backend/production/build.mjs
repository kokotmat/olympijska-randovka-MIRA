import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const read=name=>fs.readFileSync(path.join(root,name),'utf8').replace(/\r\n/g,'\n');
const decoder=read('jsQR.js');
const license=read('LICENSE-jsQR.txt');
const html=read('Scanner.html').replace('<!-- JSQR_BUNDLE -->','<script>/* jsQR, Apache-2.0; source unchanged, embedded by Randovka build. */\n'+decoder.replace(/<\/script/gi,'<\\/script')+'\n</script>');
const source=read('Reservations.gs')+'\n\n/* QR Code Generator 2.0.4, MIT; source blob df13f829bf41f36b82f0ed85751ed3b4c39cfeb8.\n'+read('LICENSE-QRCode.txt').replace(/\*\//g,'* /')+'\n*/\n'+read('QrCode.gs')+
 '\n\n/* jsQR Apache-2.0 LICENSE (unmodified upstream source embedded in scannerSource_):\n'+license.replace(/\*\//g,'* /')+'\n*/\n'+
 '\nfunction scannerSource_(){return '+JSON.stringify(html)+';}\n';
const destination=path.resolve(root,'../../../Randovka_PRODUKCE.gs');
fs.writeFileSync(destination,source);
fs.writeFileSync(path.join(root,'Randovka_PRODUKCE.gs'),source);
// Also create an inspectable local scanner preview; it cannot authenticate outside Apps Script.
fs.writeFileSync(path.join(root,'Scanner.preview.html'),html);
fs.writeFileSync(path.resolve(root,'../../kontrola-vstupenek.html'),html);
console.log('Built '+destination+' ('+Buffer.byteLength(source)+' bytes).');
