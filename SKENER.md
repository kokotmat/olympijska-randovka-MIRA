# Mobilní kontrola vstupenek

Stránka `/kontrola-vstupenek.html` je samostatný skener pro HTTPS hosting Cloudflare Pages. Nevkládat do iframe: kamera potřebuje oprávnění přímo pro doménu webu. Přihlášení používá PIN uložený v Google Apps Script Properties; v tomto repozitáři žádný PIN ani bankovní token není.

Zdroj a sestavení se udržují v `backend/production/Scanner.html` v návrhu produkčního systému. Soubor na webu obsahuje i lokální jsQR (Apache-2.0), bez načítání knihoven ze sítě. Zachovejte přiloženou licenci v tomto souboru. `_headers` povoluje kameru pro vlastní doménu, zakazuje vložení stránky do rámce a vypíná ukládání stránky do cache.

QR se dekóduje v telefonu. Na server odchází jen jeho hodnota a podepsaná relace obsluhy. Server ověří zaplacení i použití a pod zámkem zaznamená vstup. Jeden sken znamená jeden požadavek, současně běží nejvýše jeden. Zelený výsledek se zobrazí až po potvrzení serverem. Čas odezvy je vidět přímo nad výsledkem; hodnota zahrnuje síť i server, není to měření samotného čtení tabulky.

Na Cloudflare stránka posílá požadavky na `/api/scanner`, definované v meta tagu `randovka-api`. Pages Function `functions/api/scanner.js` je předá na pevně určený Apps Script backend; povoluje jen přihlášení a sken, kontroluje původ a velikost požadavku a odpovědi neukládá do cache. Tato brána odstraňuje závislost na přímém CORS spojení mobilního prohlížeče s Googlem. Backend nadále ověřuje PIN, relaci, zaplacení a použití; brána žádnou kontrolu nenahrazuje. Při změně nasazení opravte backend v bráně i meta tag `randovka-backend`. Samotná varianta bez meta tagu `randovka-api` podporuje přímý POST, ale jeho chování závisí na konkrétním prohlížeči a přesměrování Googlu.

Testy brány: `node tests/scanner-gateway.mjs`. Kamera a výkon na fyzických telefonech vyžadují následné ověření. Odbavení je samostatný přepínač backendu, zveřejnění stránky jej neotevírá.

Apps Script HTMLService omezuje kameru v sandboxu; proto mobilní obsluha používá tuto samostatnou stránku. Když kamera není dostupná, aplikace rozliší blokování rámcem, chybějící HTTPS, zamítnuté oprávnění, chybějící nebo obsazenou kameru. Zálohou zůstává fotografie QR či hardwarová čtečka.
