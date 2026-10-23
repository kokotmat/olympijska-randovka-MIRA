# Napojení Google Apps Script backendu

Frontend v app.js má reservationMode: "test" a reservationTestEndpoint: null. Výchozí režim načítá dostupné stoly z dodané webové aplikace přes GET ?action=getTables a zobrazuje pouze lokální přehled. Žádný POST se v tomto nastavení neodesílá. Přímé volání adapter.submit() je v testovacím a neznámém režimu zablokováno před síťovým požadavkem.

Pro skutečný zápis testovacích objednávek je připraven samostatný backend backend/TestReservations.gs a metoda adapter.submitTest(). Postup je v backend/TESTOVANI.md. Testovací endpoint musí před POST potvrdit protokol randovka-test-v1, samostatný list Test_rezervace a vypnuté e-maily, platby a vstupenky. Výchozí konfigurace žádný takový endpoint neobsahuje a nebylo provedeno jeho vzdálené nasazení.

Přístupná tabulka se jmenuje „Rezervační system listky.randovka - zatim nastaveno jako /test“. Dodaný původní Apps Script byl zkontrolován: nemá testovací režim, používá aktivní list a po zápisu objednávky odesílá skutečné platební instrukce. Jeho platby, vstupenky a tajné údaje nejsou součástí testovacího backendu ani této veřejné kopie zdrojů. Název tabulky s /test sám o sobě neodděluje ostré a testovací rezervace.

## Nasazení

V Apps Scriptu nasaďte projekt jako webovou aplikaci: Deploy → New deployment → Web app. Použijte produkční URL končící /exec. Vývojová /dev je jen pro editory projektu. Veřejný formulář potřebuje endpoint dostupný bez přihlášení, pokud to váš účet dovoluje; Google tabulka přitom nemusí být veřejná. Nastavte vykonávající účet podle svého backendu. Po změnách aktualizujte verzi nasazení.

Frontend nahrajte na HTTPS hosting. Pro úpravy používejte app.js, nikoli samostatný HTML náhled.

## Zapnutí adaptéru

V horní části app.js ve window.PLES_CONFIG je již reservationAdapter aktivní. Jeho endpoint určuje URL webové aplikace; pro testování nastavte URL samostatného testovacího nasazení. Následující příklad popisuje původní minimální rozhraní adaptéru. Sponzory ponechte.

```js
"reservationAdapter": {
  async getTables() {
    const url = new URL('https://script.google.com/macros/s/VASE_ID/exec');
    url.searchParams.set('action', 'getTables');
    const response = await fetch(url, { redirect: 'follow' });
    if (!response.ok) throw new Error('Nepodařilo se načíst stoly.');
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Neplatný seznam stolů.');
    }
    if (data.status === 'error') throw new Error(data.message || 'Chyba načítání.');
    if (Object.values(data).some(n => !Number.isInteger(n) || n < 0)) {
      throw new Error('Neplatné kapacity stolů.');
    }
    return data;
  },
  async submit(payload) {
    const response = await fetch('https://script.google.com/macros/s/VASE_ID/exec', {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) throw new Error('Objednávku se nepodařilo odeslat.');
    return response.json();
  }
}
```

Aktivní adaptér zpřístupní výběr stolů. reservationMode: "test" zachová pouze čtení a lokální přehled. Odesílání vyžaduje výslovnou změnu režimu na "live" ve zdrojovém kódu; tato změna nyní není požadována ani provedena. Parametr URL režim nepřepíná. Původní minimální příklad výše bezpečnostní kontrolu režimu neobsahuje, proto jím nenahrazujte aktuální adaptér. Pro úplné testování zápisu použijte izolované testovací nasazení backendu.

## Rozhraní stolů

GET ?action=getTables volá doGet(e). Očekávaný JSON:

```json
{ "Sál 1": 8, "Sál 2": 4, "Ochoz 1": 6 }
```

Čísla jsou volné kapacity. Klíče začínající Sál patří do přízemí, ostatní do ochozu. Frontend nabízí stoly s dostatkem míst pro zvolený počet. Při vyprodání vraťte {}. Pokud váš backend vrací {tables: {...}}, adaptér musí validovat a vracet data.tables.

## Rozhraní objednávek

POST volá doPost(e); JSON tělo čtěte přes JSON.parse(e.postData.contents). Přesná pole:

```json
{
  "name": "Testovací objednávka",
  "email": "test@example.com",
  "ticketType": "Místenka ke stolu",
  "count": 2,
  "totalPrice": 900,
  "table": "Sál 1",
  "oddelenePdf": true
}
```

Typy jsou Základní vstupenka (350 Kč) a Místenka ke stolu (450 Kč). Počet je celé číslo 1–10. Základní vstupenka má table prázdný řetězec. oddelenePdf je boolean; při jedné vstupence false. Backend musí cenu přepočítat, ověřit data, stůl a kapacitu; totalPrice od klienta není důvěryhodná cena.

Po uložení vraťte {"status":"success"}. Při odmítnutí vraťte například {"status":"error","message":"U stolu již nejsou volná místa."}. Potvrzení frontend ukazuje jen pro status success. Přijetí objednávky není potvrzením platby. Texty o e-mailu v app.js upravte, pokud vstupenky posíláte až po zaplacení.

JSON odpovědi vytvořte takto:

```js
return ContentService.createTextOutput(JSON.stringify(data))
  .setMimeType(ContentService.MimeType.JSON);
```

## Co zajistí váš backend

Zápis objednávek, ID objednávky, platby, PDF a e-maily zajišťuje váš existující systém. Kapacity ověřujte a rezervujte atomicky, například pod LockService.getScriptLock(), aby souběžné objednávky nepřeprodaly stůl. Frontend blokuje tlačítko jen během jednoho odesílání; pro bezpečné opakování po výpadku rozšiřte frontend i backend o identifikátor požadavku a ochranu před duplicitou. Nevkládejte hesla ani přístupové tokeny do frontendu.

## Spojení a kontrola před spuštěním

Content Service přesměrovává odpovědi; adaptér přesměrování následuje. text/plain pro JSON tělo omezuje potíže s preflightem. Přesto ověřte čitelnost odpovědí z vašeho konkrétního HTTPS hostingu. Nepoužívejte mode: no-cors, protože pak nelze ověřit odpověď. Při CORS problému použijte endpoint na svém hostingu, který předá požadavek Apps Scriptu a vrátí JSON; jeho URL pak vložte do adaptéru.

Před prodejem na testovací tabulce ověřte základní vstupenku i místenku, počet 1 a více, správné ceny, vyprodání, dvě souběžné objednávky na poslední místa, obě varianty PDF a doručení e-mailu. Otestujte chybná data a výpadek spojení: bez potvrzeného uložení se nesmí ukázat úspěch. Zkontrolujte nové načtení kapacit po objednávce a mobilní formulář.

Oficiální dokumentace:
- [Web apps](https://developers.google.com/apps-script/guides/web)
- [Content Service](https://developers.google.com/apps-script/guides/content)
- [LockService](https://developers.google.com/apps-script/reference/lock/lock-service)
