# Centrální provozní ovládání

Soukromá administrace je na `sprava.olympijskarandovka.cz/sprava/`. Stejná autorizace Cloudflare Access a ověření JWT chrání všechny nové akce. Nasazení samo nezapíná odesílání, prodej ani vstupní bránu.

## Zprávy a AI

- Centrální režim doručování: vypnuto, testovací příjemce, ostré doručování. Ukládá se do D1 s verzí a neměnným potvrzením operace. Výchozí hodnota bez záznamu pochází z dosavadního prostředí. Ostré doručování vyžaduje napsat `POVOLIT ODESÍLÁNÍ`.
- Denní strop 1–200 pokusů se počítá podle UTC; není výpisem zbývajícího limitu SMTP2GO. Všechny pokusy včetně nejistých spotřebovávají místní rozpočet.
- Kampaň má samostatné spuštění/pozastavení a zdrojová pravidla v Google. Nastavení režimu PILOT/LIVE, dní, hodin podle Europe/Prague, denního limitu a nejvýše tří připomenutí lze změnit pouze při pozastavení. Pro spuštění je nutný potvrzovací text `SPUSTIT KAMPAŇ`, centrální transport, kontrola DMARC a existující trigger. Spuštění nemění schválení jednotlivých kontaktů a zpráv.
- AI generuje koncepty; jejich kontrola a odeslání zůstávají v Gmailu. Není implementován webový editor obsahu, kontaktů ani jejich souhlasů.
- Vypnutí se ověřuje před každým dalším předáním. Již probíhající požadavek poskytovateli nelze odvolat.
- Nejistou zprávu lze ručně uzavřít pouze jako doložené přijetí nebo výslovné odmítnutí. Vyžaduje se popis důkazu a pro přijetí ID poskytovatele. Tato akce neprovádí nové odeslání a nepotvrzuje doručení. Prázdné vyhledávání u poskytovatele není důkaz odmítnutí. Přijetí je potvrzeno časem ručního ověření, nikoli odhadnutým původním časem.

## Web a loga

Stávající katalog z GitHubu zůstává zachován. Nová loga se publikují z D1 přes veřejná rozhraní `/api/partners` a `/api/partner-logo`. Nejsou ukládána do GitHubu; export a nezávislé zálohování D1 jsou samostatný provozní úkol.

1. U konkrétního sponzora zkontrolovat podklady a nastavit logo na Schváleno.
2. Z detailu zkopírovat identifikátor sponzora. Nahrát PNG/JPG/WebP do 300 kB, název a HTTPS odkaz.
3. Zkontrolovat neveřejný náhled a potvrdit zveřejnění. Server znovu ověří schválení u zdroje.
4. Zveřejnění lze vrátit tlačítkem Stáhnout z webu. Soubor a historie zůstanou zachovány; veřejný endpoint přestane soubor poskytovat. Dříve stažené kopie nelze odvolat.

Nejvýše 200 centrálních podkladů. Povoleny jsou pouze rastrové formáty; SVG, HTML a vzdálené stahování souborů serverem nejsou podporovány. Schválení je doloženo stavem v evidenci, nejde o automatické ověření autorských práv.

## Nasazení a návrat

Před nasazením aplikovat nedestruktivní migraci `0004_web_operations.sql`. Zdrojový Apps Script sestavit z ověřené soukromé zálohy pomocí `tools/build-outreach-delivery.mjs`, ověřit přesnou shodu uloženého kódu a aktualizovat stávající implementaci. Předchozí verzi zachovat. Nepřidávat přístupové údaje do repozitáře.

Při návratu nejprve v nové administraci vypnout centrální doručování a pozastavit kampaň, ověřit oba stavy. Předchozí aplikace nečte D1 přepínač a řídí se proměnnou prostředí; ta má při tomto nasazení zůstat `off`. Staré tabulky ani nové auditní záznamy nemazat. Obnovu dat z nezávislé zálohy tento postup nenahrazuje.
