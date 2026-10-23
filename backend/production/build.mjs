import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const read=name=>fs.readFileSync(path.join(root,name),'utf8').replace(/\r\n/g,'\n');
const output=read('Reservations.gs')+'\n'+read('Operations.gs')+'\n/* QR Code Generator, MIT license:\n'+read('LICENSE-QRCode.txt').replaceAll('*/','* /')+'\n*/\n'+read('QrCode.gs');
fs.writeFileSync(path.join(root,'Randovka_PRODUKCE.gs'),output);
console.log('Built backend/production/Randovka_PRODUKCE.gs. No credentials or mode settings are changed.');
