# Centrální doručování – stav této etapy

Implementace přidává trvalou frontu v existujícím Cloudflare D1 a oddělený příjem událostí. Samotné nasazení neodesílá zprávy. `DELIVERY_SENDING_ENABLED` je bez výslovného nastavení vypnuté. Nevytváří se druhá evidence plateb ani kapacity.

## Nastavení

- Migrace `admin/migrations/0002_delivery.sql` v existující `ADMIN_DB`.
- Secret `SMTP2GO_API_KEY`: nový oddělený klíč pouze s `/email/send`. Stávající klíče neměnit. Potřebný je až pro skutečné odeslání.
- Secret `SMTP2GO_WEBHOOK_SECRET`: samostatná náhodná hodnota minimálně 32 znaků.
- Jeden SMTP2GO webhook: HTTPS `https://olympijskarandovka.cz/api/delivery-webhook`, JSON, Authorization Bearer se stejným webhook secret. Události processed, delivered, bounce, reject, spam, unsubscribe. Přidat vracený vlastní e-mailový header `X-Randovka-Message-ID`. Ve filtru Users výslovně zahrnout nový odesílací API klíč; výběr původního SMTP uživatele nový klíč nepokrývá. Do URL nedávat žádný klíč.
- `DELIVERY_SENDING_ENABLED`: nenastaveno/vypnuto, `test`, nebo `live`. Test režim smí odesílat jen přesně na `DELIVERY_TEST_RECIPIENT`. Změna na test/live vyžaduje zvlášť schválené odesílání.
- `DELIVERY_DAILY_BUDGET`: vlastní konzervativní denní rozpočet této fronty, výchozí 150, maximum 200. Není to živý údaj o zbývající kvótě celého účtu. Ostatní odesílání stejným účtem může kvótu spotřebovat také.

## Transport zdrojů

`Client.gs` je společný podepsaný transport pro Google projekty. Zahrnutí souboru neposílá ani nepřepíná poskytovatele. Napojení konkrétních zdrojových front vyžaduje samostatnou revizi a ověření jejich stavů; v této etapě ještě není aktivované.

Každý zdroj má vlastní již existující `ADMIN_BRIDGE_SECRET`. Namespace podpisu je `randovka-delivery-v1`; podpis administrace se zde nepřijímá. Zdroj může číst jen své zprávy. Nonce se evidují a znovupoužití se odmítá. Stabilní sourceId obsahuje režim, identitu zdrojového záznamu a druh zprávy. Změněný obsah pod stejným ID vyvolá konflikt.

Zdroj musí nejdéle každých 10 minut potvrdit svůj stav a aktuální rozvrh příkazem tick; při zastarání se odesílání jeho zpráv zastaví. Sponzorský rozvrh se vyhodnocuje v Europe/Prague včetně přechodu na letní/zimní čas. Zdroj stále musí vynucovat ruční schválení, potlačené příjemce a vlastní denní limity. SMTP2GO zde přijímá sponzory pouze s výslovným CONSENTED; pouhý nalezený kontakt ani EXISTING_RELATIONSHIP nejsou automaticky přeneseny jako souhlas.

Rezervace a vstupenky mají přednost před sponzory. Potvrzení rezervace má povinnou dobu platnosti, po jejímž konci se nezašle starý platební pokyn. PDF/PNG se přenášejí jako Base64 příloha. Inline CID obrázky ještě vyžadují adaptaci zdrojové šablony nebo podporu inlines před aktivací pro rezervace; zatím se používá Google.

## Výsledky

- queued: přijato vlastní frontou, dosud neposláno poskytovateli.
- accepted: SMTP2GO potvrdilo přijetí a poskytlo email_id.
- processed: poskytovatel zpracovává; žádné potvrzené doručení.
- delivered: doručení potvrdil server příjemce. Není to přečtení ani důkaz umístění v hlavní schránce.
- uncertain: timeout, přerušení nebo nejednoznačná odpověď. Automaticky se neopakuje ani nepřepíná na jiného poskytovatele.
- bounced/rejected/suppressed/expired: samostatné konečné výsledky.

Trvalý pokus vzniká před síťovým voláním. Běžící worker drží D1 lease; více ticků neposílá současně stejnou zprávu. Událost přicházející během síťového volání má přednost před pozdější odpovědí API. Opakované události se deduplikují, staré processed nepřepíše delivered. Obsah přijaté nebo konečné zprávy se z fronty odstraňuje; před ostrým režimem doplnit retenční pravidlo nejistých zpráv a provozní export.

## Živě ověřená doručovací vrstva, 25. 10. 2026

Po jednotlivých souhlasech byly odeslány dvě technické zprávy bez příloh. Příjemce potvrdil obě. U druhé skutečný webhook automaticky zapsal `processed` a poté `delivered` do D1. Šest testovacích událostí SMTP2GO prošlo HTTP 200. Po ověření byl zdroj pozastaven a režim `off` znovu nasazen; ostré odesílání nebylo zapnuté.

Událost `processed` může místo `rcpt` obsahovat `recipients`. Podpora seznamu je omezená na tuto nezávěrečnou událost, příjemce i provider ID musí odpovídat uložené zprávě. Samotný seznam nikdy nepotvrzuje doručení. Neexistující testovací zprávy se ignorují a nemění skutečné záznamy.

Soukromý přehled ukazuje poslední skutečně uloženou událost, přijetí poskytovatelem a stáří čekající fronty podle oprávnění zdroje. Úspěch testovací zprávy je výslovně označený jako test a nezaručuje budoucí dostupnost ani platnost klíče.

## Zbývající ověření před zapnutím

Přílohy a zdrojové šablony; připojení a zpětná synchronizace konkrétních Google front; globální potlačení po unsubscribe/spam i při budoucím Gmail odesílání; vyzkoušený provozní návrat těchto integrací. Nikdy neoznačovat ověřený transport za dokončené přepnutí Google automatizace před těmito kontrolami.
