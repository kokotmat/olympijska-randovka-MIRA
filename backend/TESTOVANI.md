# Oddělené testování rezervací

## Aktuální stav

V app.js zůstává reservationMode: "test" a reservationTestEndpoint: null. Formulář pouze čte kapacity a ukazuje lokální přehled; zápis zatím není aktivovaný. Návrh je mimo větev main a nebyl nasazen na ostrý web.

Původní endpoint není bezpečný testovací zapisovací endpoint: každá přijatá objednávka spustí skutečný zápis a e-mail s platebními instrukcemi. Pouhý parametr mode: "test" by to v původním skriptu nezměnil.

## Zprovoznění testovacího zápisu

1. V Google Apps Script vytvořte **nový samostatný projekt** a vložte do něj obsah TestReservations.gs. Neupravujte původní projekt a nekopírujte do nového projektu jeho bankovní, e-mailové ani odbavovací funkce.
2. V editoru jednou spusťte setupTestReservations a dokončete přihlášení ke Google účtu s právem upravovat cílovou tabulku. Funkce vytvoří pouze list Test_rezervace v tabulce s ID uvedeným v souboru; původní Sheet1 nemění. Skript vyžaduje oprávnění k tabulkám, nikoli k e-mailu nebo bankovnímu API.
3. Nasaďte nový projekt jako novou webovou aplikaci, spouštěnou vlastníkem. Veřejný formulář potřebuje endpoint dostupný bez přihlášení, pokud to účet dovoluje. Zkopírujte novou URL končící /exec. Neměňte původní nasazení ani jeho automatické spouštěče.
4. Novou URL nastavte do reservationTestEndpoint v app.js; reservationMode ponechte "test". **Nepoužívejte URL původního backendu.** Frontend před zápisem ověřuje odpověď GET ?action=capabilities; původní backend tuto kontrolu nesplní a POST se k němu neodešle.
5. Pouze na testovacím náhledu odešlete objednávku s umělými údaji a zkontrolujte list Test_rezervace. Odpověď obsahuje mode: "test" a testId s předponou TEST-. Souběžná objednávka na obsazený testovací stůl musí být odmítnuta; opakování stejného requestId nesmí vytvořit další řádek.

Žádný krok tohoto postupu nevyžaduje zapnutí režimu live. Pro úplný test je nutné dokončit nasazení v přihlášeném editoru Apps Scriptu; samotný přístup přes Google Drive tuto operaci nezpřístupňuje.

## Co test dělá

- Zapisuje pouze do explicitně pojmenovaného listu Test_rezervace.
- Používá status TEST – bez platby, prázdný hash vstupenky a identifikátor TEST-…; nevytváří platný vstupní QR kód.
- Přepočítává cenu na serveru, kontroluje přesný typ lístku, existenci stolu, počet a kapacitu pod zámkem.
- Ukládá requestId, aby opakování po výpadku spojení nezdvojilo objednávku. Nové načtení stránky vytvoří nový test; po nejisté odpovědi nejprve zkontrolujte list.
- Nemá e-mail, platební QR kód, bankovní spojení, automatickou kontrolu plateb ani PDF. Volba oddělených PDF se pouze zaznamená.
- Odstraněním reservationTestEndpoint (nastavením null) se frontend vrátí k přehledu bez zápisu. Již uložené testy zůstávají v testovacím listu.

Případná veřejná testovací webová aplikace nemá přihlášení a může do ní zapisovat každý, kdo zná URL. Používejte pouze umělé údaje a po dokončení testů testovací nasazení ukončete. Nepovažujte tento backend za připravený pro veřejný prodej.

## Ověření bez přístupu ke Google

Spusťte z kořene repozitáře `node tests/test-reservations.mjs`. Testy používají paměťovou náhradu tabulky a žádné skutečné rezervace ani e-maily neodesílají. Nepotvrzují vzdálené nasazení nebo oprávnění Google; to vyžaduje kontrolu podle kroků výše.

## Tajné údaje

Bankovní API token a vstupní PIN nepatří do repozitáře, ani soukromého. V původním ostrém projektu je uložte do Script Properties a v kódu čtěte přes PropertiesService.getScriptProperties().getProperty(...). Již sdílený token a PIN před ostrým spuštěním změňte. Tato testovací varianta žádný z nich neobsahuje ani nepotřebuje.
