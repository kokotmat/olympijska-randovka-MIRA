# Centrální provozní ovládání

Soukromá administrace je na `sprava.olympijskarandovka.cz/sprava/`. Stejná autorizace Cloudflare Access a ověření JWT chrání všechny nové akce. Nasazení samo nezapíná odesílání, prodej ani vstupní bránu.

## Zprávy a AI

- Centrální režim doručování: vypnuto, testovací příjemce, ostré doručování. Ukládá se do D1 s verzí a neměnným potvrzením operace. Výchozí hodnota bez záznamu pochází z dosavadního prostředí. Ostré doručování vyžaduje napsat `POVOLIT ODESÍLÁNÍ`.
- Denní strop 1–200 pokusů se počítá podle Europe/Prague; není výpisem zbývajícího limitu SMTP2GO. Všechny pokusy včetně nejistých spotřebovávají místní rozpočet.
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


## Automatický provoz a dohled

Migrace 0005 přidává absolutní nejdřívější čas odesílání, nezávislý stav kontrol a datové zálohy. `/stats/email_cycle` se čte stávajícím omezeným klíčem. Před předáním zprávy musí být kvóta ověřená a kladná; místní pokusy se konzervativně odečítají i při zpoždění statistik poskytovatele. Vyčerpaný český denní limit ponechá zprávy ve frontě a další pracovní den dovolí další dávku. Nejasný pokus se znovu neposílá.

Do obou existujících Google projektů patří samostatný soubor `integrations/operations/Operations.gs`. Spuštění `installOperations` přidá právě jeden 15minutový monitor a zachová stávající spouštěče. Každý den vznikne datová záloha hlavní i provozní tabulky v D1. Vlastní část centrální fronty se uloží v opačném směru do neveřejného listu `_Central_snapshot`. Tento list se v následné záloze vynechává, aby nevznikala rekurzivní kopie.

Sponzorský monitor ověřuje dostupnost komponent, skutečnou kvótu, nejisté zprávy a stáří záloh. Upozornění na vasik.resl@gmail.com vyžaduje dvě chybové kontroly; stejný stav má šestihodinovou prodlevu, celkem nejvýše tři upozornění za český den. Při vyčerpané Google kvótě nelze zaručit odeslání upozornění; stav zůstává v administraci. Monitor v Google sám nezjistí celkový výpadek všech služeb Google; zastaralý heartbeat je viditelný v Cloudflare administraci.

AI server nahrává jednou denně konzistentní kopii SQLite do odděleného zdroje assistant v D1. Viz `integrations/assistant/README.md`. Tajné údaje a OAuth tokeny nejsou obsahem záloh. Tabulková záloha ukládá data, vzorce a číselné formáty, nikoli úplnou nativní grafickou podobu všech Google objektů.

Při obnově nejdříve pracovat v oddělené tabulce/databázi, zkontrolovat SHA-256 a integritu, ponechat odesílání, prodej a bránu vypnuté. Před obnovením odesílání porovnat stabilní identifikátory a potvrzení s aktuální centrální frontou. Nikdy se nesmí po návratu starší kopie znovu rozeslat už přijatá zpráva.
