# Produkční rezervace a kontrola vstupenek – Olympijská Randovka 2027

## Co vložit do Google Apps Scriptu

Soubor **Randovka_PRODUKCE.gs** je hotový sloučený skript. Obsahuje rezervace, Fio, e-mailovou frontu, PDF vstupenky, administraci, webovou kontrolu a oba lokální QR nástroje. **Vložte pouze tento soubor**, nikoli současně Reservations.gs, QrCode.gs nebo předchozí TestReservations.gs; vznikly by duplicitní funkce doGet/doPost.

Skript je určený pro tabulku `1kvTNS2e6IsavmOCOQG__3htPBcISzadckq_Fz0jHziA`, ostrý list `Sheet1`. Původní sloupce A:L zachovává; přidá sloupce M:U pro jednoznačné požadavky, splatnost a stav doručení. Testy používají **Test_rezervace_PRO**. Aktivní list se pro automatické objednávky, platby ani skeny nepoužívá.

Produkční implementace je připravená; nebyla vzdáleně nasazena, nespouštěla skutečnou banku, e-maily ani odbavení. Výchozí režim je `test` a prodej i odbavení jsou zavřené. Připravený frontend na GitHubu také zůstává v testovacím režimu.

## Instalace do existující tabulky

1. Udělejte kopii tabulky a zálohu původního Apps Scriptu. Pokud už tabulka obsahuje objednávky, neprovádějte přechod během prodeje ani odbavení.
2. V tabulce otevřete **Rozšíření → Apps Script**. U starého projektu vypněte časové spouštěče `checkPayments` a `cancelUnpaidOrders`; jiné spouštěče bezdůvodně neměňte. Nová verze používá pouze `maintenance_`.
3. Nahraďte původní kód obsahem **Randovka_PRODUKCE.gs**. Neuchovávejte staré doPost/doGet ve druhém `.gs` souboru. Uložte. Projekt musí být připojený k této tabulce kvůli vlastnímu menu.
4. V **Nastavení projektu → Vlastnosti skriptu / Script Properties** přidejte `SCANNER_PIN` (nový, minimálně 8 znaků, doporučeně náhodných 12 a více). Pro budoucí ostré platby přidejte nový `FIO_TOKEN`; starý token ze sdíleného kódu nepoužívejte. Do zdrojového kódu ani GitHubu tyto hodnoty nepatří.
5. V editoru jednou spusťte `setupSystem` a udělte požadovaná oprávnění k tabulce, dokumentům, disku, e-mailům a automatice. Inicializace používá konkrétní listy, původní řádky nemaže. Jestli hlavičky nebo kapacity nesouhlasí, zastaví se s chybou.
6. Přednastavený IBAN je potvrzený **CZ27 2010 0000 0024 0347 6467**. Script Properties přijímají i IBAN s mezerami. Ověří se kontrolní součet a při čtení Fio také shoda IBANu účtu bankovního výpisu.
7. **Nasadit → Spravovat nasazení → upravit existující webovou aplikaci → nová verze**. Spouštění nastavte jako vlastníka. Pro veřejný rezervační formulář musí být přístup dostupný bez přihlášení, pokud ho účet dovoluje. Aktualizace existujícího nasazení zachová jeho `/exec` adresu; tím se stávající endpoint přepne na nový skript stále v testovacím režimu.
8. Ve Script Properties zkontrolujte `SCRIPT_URL`. Přednastavená je dosavadní dodaná `/exec` URL. Pokud vytvoříte nové nasazení s jinou URL, opravte ji také ve webové stránce kontroly v meta tagu `randovka-backend`.
9. Otevřete znovu tabulku. V menu **🎟️ Randovka – rezervace** použijte **Diagnostika**. Potom **Nainstalovat automatiku**; vytvoří se jediný minutový spouštěč `maintenance_` pro aktuální účet. Správu spouštěčů provádějte jen pod jedním organizačním účtem.

### Nastavení

| Script Property | Význam |
|---|---|
| `RUN_MODE` | `test` (výchozí) nebo později `live` |
| `SCANNER_PIN` | Váš nový PIN obsluhy, nejméně 8 znaků; není součástí dodaných souborů |
| `FIO_TOKEN` | Nový token pro čtení bankovních pohybů; pro test není používán |
| `IBAN` | Přednastavený potvrzený IBAN bez mezer |
| `SCRIPT_URL` | Skutečná nasazená adresa končící `/exec` |
| `REPLY_TO` | Výchozí `listky.randovka@gmail.com` |
| `TEST_SEND_EMAILS` | Výchozí `false`; při `true` testovací e-maily míří pouze na `TEST_RECIPIENT` |
| `TEST_RECIPIENT` | Vaše vlastní testovací schránka, pokud testovací e-maily výslovně zapnete |
| `FIO_FROM_DATE` | Začátek čtení banky `YYYY-MM-DD`. Inicializace nastaví dnešek; při přenosu starších čekajících rezervací ho posuňte před nejstarší relevantní platbu. Neměňte jej dopředu jen kvůli výkonu. |
| `SESSION_SECRET` | Vytvoří inicializace; změna zneplatní všechna přihlášení obsluhy. Nesdílet. |
| `SALES_OPEN`, `SCANNER_OPEN` | Ovládejte přes menu. Jsou oddělené a vázané na režim, v němž byly otevřeny. Přepnutí režimu nezdědí otevřený testovací prodej/odbavení. |

V testovacím režimu se Fio vůbec nevolá a platné ostré vstupenky nevznikají. Při `TEST_SEND_EMAILS=false` se e-maily označí jako testovací/neodesílané. Zapnutí testovacích e-mailů zpětně neopakuje již vyřízené řádky; pro nový test vytvořte novou objednávku nebo výslovně zařaďte vybraný e-mail z menu.

## Úplná kontrola před ostrým prodejem

1. Ponechte `RUN_MODE=test`. V menu otevřete **prodej v nastaveném režimu**. Testovací frontend musí mít stále `reservationMode: "test"` a novou URL v `reservationTestEndpoint`.
2. Vytvořte test základní vstupenky a test místenek. Zkontrolujte řádky v Test_rezervace_PRO, cenu 350/450 Kč a oddělené PDF ano/ne. Podruhé odešlete stejný `requestId`: nesmí vzniknout druhá rezervace. Vyzkoušejte poslední místa u stolu ze dvou zařízení.
3. V testovacím listu vyberte čekající objednávku a použijte **Simulovat platbu v TESTU**. Tato akce není v ostrém režimu povolená. Pro kontrolu skutečného PDF a doručení zapněte `TEST_SEND_EMAILS=true`, nastavte svou testovací schránku a spusťte **Zpracovat platby a e-maily nyní**. Testovací PDF má výrazné označení neplatnosti.
4. Z menu otevřete **odbavení v nastaveném režimu**. Otevřete kontrolní aplikaci, přihlaste obsluhu a otestujte QR z PDF. První použití musí být povoleno jako TEST, druhé odmítnuto jako použité. Nezaplacená objednávka musí být odmítnuta.
5. Ověřte kameru a zvuk na konkrétních telefonech v místě akce, při tamním osvětlení a přes použitou Wi-Fi/mobilní data. Změřte skutečnou dobu odpovědi, kterou aplikace ukazuje v dalších možnostech. Pro souběžné vstupy vyzkoušejte několik zařízení a současné načtení stejného QR. Současné reálné zatížení nebylo místními testy změřeno.
6. Vyzkoušejte výpadek internetu, opožděnou odpověď, pozastavení odbavení a odhlášení. Žlutý nebo nejasný výsledek není povolení vstupu. Při ztracené odpovědi mohl server kontrolu dokončit; opakovaný dotaz pak může správně ukázat již použito.
7. Nový Fio token a skutečné příchozí platby ověřte při řízeném přechodu vlastníkem. Lokální testy používají náhrady Google/Fio a nemohou potvrdit bankovní oprávnění, skutečné PDF z Google Docs ani doručení do schránky.

Po úspěšných kontrolách pozastavte testovací prodej i odbavení, nastavte `RUN_MODE=live`, použijte menu **Otevřít prodej v nastaveném režimu**. Systém nejprve ověří banku a konfiguraci a vyžádá potvrzení skutečného prodeje. Odbavení nechte zavřené až do akce. Přepnutí frontendu na `reservationMode: "live"` je samostatná úprava; během přípravy nebylo provedeno.

## Rychlá kontrola vstupenek

Jsou připravené dvě varianty stejné aplikace:

- **Samostatná HTTPS stránka `kontrola-vstupenek.html` na webu**: vhodná pro kameru, bez rámu Apps Scriptu; nativní BarcodeDetector a lokální jsQR jako záloha. Nastavený backend musí vracet čitelné POST odpovědi z daného hostingu. Pokud CORS neprojde, použijte variantu Apps Script nebo proxy na vlastním serveru; nepoužívejte `no-cors`, které znemožní ověřit přijetí vstupu.
- **Přímo `/exec?action=scanner`**: zahrnutá ve sloučeném skriptu, používá `google.script.run`. Bez CORS pro serverové volání. Kamera může být omezena pravidly rámu/prohlížeče; zálohou je fotografie QR, ruční zadání nebo hardwarová QR čtečka simulující klávesnici a Enter.

Aplikace se mezi skeny nenačítá znovu. Kamera čte přibližně 5 snímků za sekundu, záložní dekodér pracuje s obrazem širokým nejvýše 640 px. Současně běží jen jeden serverový požadavek. Stejný QR se znovu automaticky nekontroluje, dokud ho obsluha alespoň na 700 ms neoddálí. Dekódování se při skrytí karty zastaví. Fotografie ani obrázky z kamery se neposílají externímu QR generátoru.

Každé odbavení má jediný serverový požadavek. Cache uchovává pouze umístění řádku; při každém skenu se ověřuje skutečný hash, platba i použití z aktuálního řádku. Po přeuspořádání tabulky se neplatné umístění z cache znovu dohledá. Použití QR se zapisuje pod zámkem. Veřejný GET náhled nikdy nespotřebuje vstupenku a nezobrazuje jméno ani e-mail.

PIN se neposílá v URL ani neukládá v prohlížeči. Po přihlášení se používá podepsaná relace s životností 6 hodin, pouze v paměti stránky. Obnovení stránky vyžaduje nové přihlášení. Změna RUN_MODE zneplatní relace druhého režimu. Při úniku relace změňte SESSION_SECRET; při úniku PINu změňte i PIN.

## Platby, doručení a provozní limity

- Systém má 240 vstupenek na stání a 360 místenek: 70 stolů v sále a 20 na ochozu, každý po 4 místech. Počet 1–10, cenu a existenci stolu kontroluje server. Přechod zastaví, pokud stará data překračují kapacitu nebo obsahují neznámé aktivní stavy.
- `requestId` je povinný. Aktualizovaný app.js v návrhu na GitHubu jej přidává a při nejasné odpovědi uchová ve sessionStorage pod otiskem objednávky, bez uložení jména nebo e-mailu do klíče. Starý frontend bez requestId bude odmítnut s vysvětlením. Chyba nesmí být vydávána za úspěch.
- Objednávka se uloží před zařazením e-mailu. Fronta dovolí rychlou odpověď formuláři; PDF a e-maily nevznikají pod zámkem rezervací. Jeden minutový běh zpracuje nejvýše 10 e-mailů a nejvýše přibližně 4 minuty přípravy. Není to garance okamžitého doručení při hromadném náporu.
- Po úspěšném potvrzovacím e-mailu je splatnost 30 minut, následovaná 5minutovou ochrannou lhůtou. Nezaplacené rezervace se ruší až po úspěšné aktuální kontrole banky, ne během jejího výpadku. Nejasné doručení potvrzení se samo neruší; je potřeba zkontrolovat řádek a schránku. Automatika běží přibližně po minutě, nikoli s přesností na sekundu.
- Fio se nevolá častěji než po 35 sekundách. Jednotlivé pohyby mají trvalá jedinečná ID v _Platby_live; více plateb pod stejným VS se sčítá v haléřích. Cizí měny, odchozí pohyby a neznámé VS automaticky neplatí objednávky. Systém nikdy neposílá bankovní převody.
- Platba přijatá po uvolnění kapacity jde do ruční kontroly; sama neobnoví rezervaci ani neodešle vstupenky. Přeplatek je označen k ověření. Refundace se neprovádějí automaticky.
- Stav e-mailu `NEJASNÉ – ověřit odeslání` se automaticky neopakuje: transport mohl e-mail přijmout i přes chybu. Obsluha ověří schránku a teprve potom použije opakování z menu. Opakované PDF používá stejné QR kódy, nevytváří další platné vstupy. `CHYBA PŘÍPRAVY` vyžaduje opravu příčiny a ruční opakování. Po pádu během přípravy/odesílání se starý nárok po 10 minutách označí jako nejasný.
- Google kvóty nelze kódem odstranit. Aktuální dokumentace uvádí pro osobní účet 100 e-mailových adresátů denně, pro Google Workspace 1 500; samostatné limity mají i vytvářené dokumenty, PDF konverze a automatické běhy. Jedna objednávka obvykle potřebuje dva e-maily. **Osobní Gmail proto nestačí pro rychlý prodej stovek objednávek za den.** Ověřte typ odesílajícího účtu a kvóty před spuštěním. Diagnostika ukazuje zbývající e-mailovou kvótu a při jejím vyčerpání se fronta pozastaví.
- Samotné zahájení placeného Workspace neznamená jisté zvýšení kvóty následující den. Google pro přechod ze zkušební verze uvádí kumulativní úhradu domény alespoň 100 USD a alespoň 60 dní od dosažení této hranice. Ověřujte skutečnou kvótu přes diagnostiku. Automatiku i webovou aplikaci musí provozovat příslušný licencovaný účet; pouhá změna REPLY_TO na doménovou adresu nezmění účet běhu. Diagnostika proto ukazuje i spouštějící účet. Viz [oficiální kvóty](https://developers.google.com/apps-script/guides/services/quotas).
- Apps Script má studené starty a síťovou latenci. Rozhraní je optimalizované pro průběžné skenování, ale bez reálného testu na telefonech a hostingu není možné slíbit konstantní dobu odezvy. Během odbavení neměňte strukturu listu ani ručně nepřepisujte použité kódy.

### Staré objednávky

Prvních 12 sloupců zůstane zachováno včetně původních VS a hashů. Doplní se metadata; e-maily starých řádků dostanou `LEGACY – ověřit`, aby se automaticky neposílaly znovu. Před zapnutím zkontrolujte zaplacení, předchozí odeslání a splatnost těchto řádků. Nejisté staré čekající rezervace se automaticky neruší. Pro migraci starých plateb nastavte FIO_FROM_DATE dostatečně zpět. Listy _Platby_live a _Platby_test nemažte ani ručně neupravujte.

## Co bylo ověřeno při přípravě

`node tests/production-reservations.mjs` ověřuje validaci, serverové ceny, kapacity, odolnost proti opakování, podpisy relací, odmítnutí nezaplacených/použitých QR, zámky, cache po přesunu řádku, neškodnost GET, párování rozdělených plateb, ochranu před dvojím započtením, výpadek banky, pozdní platby a frontu e-mailů s nejasným výsledkem. Skutečný QR generátor a dekodér prošly společným testem zakódování/rozpoznání platebního i vstupního kódu. Google Docs a PDF přenos byly v testech nahrazeny, nikoli spuštěny v Google.

Mobilní UI bylo ověřeno při šířce 390 px s místní simulací serveru, včetně zeleného povolení a červeného odmítnutí. Tento test není měření rychlosti ostrého Apps Scriptu ani test fyzické kamery.

## Zdroje a licence

- Fio JSON: column22 = ID, column1 = částka, column5 = VS, column14 = měna. [Oficiální API dokumentace](https://www.fio.cz/docs/cz/API_Bankovnictvi.pdf).
- [Apps Script webové aplikace](https://developers.google.com/apps-script/guides/web), [LockService](https://developers.google.com/apps-script/reference/lock/lock-service), [Script Properties](https://developers.google.com/apps-script/guides/properties), [kvóty](https://developers.google.com/apps-script/guides/services/quotas).
- QR Code Generator 2.0.4 – Kazuhiko Arase, MIT, blob `df13f829bf41f36b82f0ed85751ed3b4c39cfeb8`, [zdroj](https://github.com/kazuhikoarase/qrcode-generator/blob/master/js/dist/qrcode.js).
- jsQR – upstream blob `99ea9df26907009e5553233ffe03c529c1521739`, Apache-2.0, [zdroj](https://github.com/cozmo/jsQR/blob/master/dist/jsQR.js). Obě licence jsou přiložené. Knihovny se načítají z dodaného kódu, nikoli z CDN.
