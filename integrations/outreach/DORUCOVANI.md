# Sponzorská tabulka a centrální doručování

`Delivery.gs` je skutečná zdrojová integrace, nikoli druhá evidence kontaktů. Schválení, texty, příjemci a rozvrh zůstávají ve sponzorské tabulce. Trvalý pracovní outbox `_Delivery_sponsors` je v soukromé provozní tabulce určené `OPS_SPREADSHEET_ID`; uchovává stabilní ID a snímek schválené zprávy pro bezpečné opakování stejného požadavku.

## Nasazení bez odeslání

1. Použít migrace D1 `0002_delivery.sql` a `0003_delivery_cancellations.sql`. Samy nezapínají odesílání a nic nemažou.
2. Ponechat `DELIVERY_SENDING_ENABLED=off`. Nasadit serverovou část a ověřit podepsané `sync` bez zpráv.
3. Exportovat a porovnat aktuální zdroj Apps Scriptu; připravit zálohu. Spustit `node tools/build-outreach-delivery.mjs <soukromý-vstup.gs> <soukromý-výstup.gs>`. Nástroj odmítá chybějící či duplicitní integrační místa a už integrovaný zdroj. Původní zdroj celé tabulky se nezveřejňuje v repozitáři.
4. Uložit výsledný zdroj do existujícího projektu a porovnat jej po uložení. `setupOutreachDelivery` přidá tři stavové sloupce a soukromý outbox a nastaví `OUTREACH_TRANSPORT=CENTRAL` pouze při vypnutém serverovém odesílání. Nemění pracovní dny, hodiny, limity, souhlasy, texty ani kampaní přepínače. Nemění spouštěče ani klíče.
5. Aktualizovat existující implementaci webové aplikace novou verzí při zachování URL. Spustit `checkOutreachDelivery` pro skutečnou synchronizaci bez předání zpráv. Uchovat předchozí verzi.

## Chování

- Původní spouštěče volají centrální tick. Nejprve pozastaví vzdálený zdroj, načtou skutečné výsledky a potlačené adresy a před případným dalším předáním znovu ověří text, schválení, identitu a odpovědi.
- Google e-mailová kvóta neřídí externí odesílání. Gmail nadále přijímá odpovědi a AI připravuje koncepty; připomínku nepovolí neúplné nebo chybující hledání odpovědí.
- Fronta přijímá pouze `CONSENTED`, existující aktuální schválení a úspěšné kontroly původního systému. `EXISTING_RELATIONSHIP` se nepřepisuje na souhlas. BCC se při migraci tiše nevynechává: taková zpráva vyžaduje samostatnou kontrolu a nepředá se.
- První oslovení vychází z existující schválené časované fronty. Připomínky používají stávající deterministické šablony, mají vlastní rezervaci a počet zvýší teprve po potvrzeném přijetí. AI generovaná připomínka vyžaduje další ruční ověření; tato integrace sama nevyvolává nové AI požadavky.
- Před síťovým předáním se zapíše rezervace a stabilní outbox. Přijetí do vlastní fronty neznamená odeslání. `sent_at` a původní ledger se doplní po přijetí poskytovatelem nebo prokázaném doručení; `central_delivery_status` rozlišuje skutečné fáze.
- Timeout po možném zařazení se řeší čtením stejného ID. Opakovat lze jen přesně uložený požadavek pod týmž ID. Nejasný výsledek poskytovatele se automaticky neposílá znovu a nepřepíná se na Gmail.
- Změněné schválení čekající zprávu ruší. Trvalý záznam zrušení v D1 zabrání i opožděnému zařazení původního požadavku. Již běžící nebo odeslanou zprávu zrušení neoznačí zpětně za neodeslanou.
- Potlačení z externího doručování se přenáší i na dřívější Gmail kontakty. Pojistka `OUTREACH_CENTRAL_INSTALLED=TRUE` zachovává kontrolu potlačení při případném návratu na původního poskytovatele; při nedostupné kontrole se neodesílá.
- Denní rozpočet zohledňuje původní odeslání i nevyřízené a nejisté rezervace. Globální rozpočet fronty zůstává další pojistkou a není výpisem dostupné kvóty poskytovatele.

## Návrat a otevřené body

Vždy nejprve vypnout serverové odesílání a pozastavit zdroj, poté ověřit všechny stavy `sending`/`uncertain`. Neodstraňovat outbox, ledger ani `delivery_cancellations`. Záloha původního kódu je pro obnovu, nikoli pro slepé opětovné odeslání; po návratu musí zůstat účinná kontrola potlačení. Případné zapnutí skutečné kampaně je samostatný krok po kontrole aktuálních oprávnění, rozvrhu a kapacity účtu. Rezervace tato integrace nepřepíná.
