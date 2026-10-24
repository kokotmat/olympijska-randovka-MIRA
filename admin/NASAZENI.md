# Soukromá administrace

Zdrojový web sám neaktualizuje Apps Script ani OMV. Chybějící propojení se zobrazuje jako nepřipojené; testovací rozhraní ani ukázkové záznamy nejsou součástí produkčního buildu.

## Konfigurace Cloudflare Pages

- `ACCESS_ISSUER`: přesný HTTPS issuer organizace Cloudflare Access.
- `ACCESS_AUD`: veřejný AUD identifikátor konkrétní aplikace Access.
- `ADMIN_ROLES`: JSON objekt e-mail → role (`admin`, `reservations`, `sponsors`, `viewer`). Access politika i toto mapování musí souhlasit. Role není převzata z klienta.
- `RESERVATIONS_ADMIN_URL`, `SPONSORS_ADMIN_URL`: existující Apps Script webová nasazení.
- `ASSISTANT_ADMIN_URL`: HTTPS `/bridge` na stávajícím asistentovi.
- Tři různé šifrované Secrets: `RESERVATIONS_ADMIN_SECRET`, `SPONSORS_ADMIN_SECRET`, `ASSISTANT_ADMIN_SECRET`.
- Vazba D1 `ADMIN_DB`, inicializovaná souborem `migrations/0001_commands.sql`.

Přístupová politika chrání celou doménu správy. Middleware samostatně ověřuje podpis JWT, issuer, audience, časovou platnost a povolenou roli také na `/api/admin/*` a na alternativních doménách. Nepoužívat žádnou výjimku Bypass pro administraci. Nastavit fail closed; nepublikovat tajné hodnoty do souborů webu, repozitáře, Sheets ani logů.

## Zdrojové systémy

Každý přijímač má svůj odlišný `ADMIN_BRIDGE_SECRET` a explicitní `ADMIN_ALLOWED_EMAILS`. Secrets odpovídají příslušnému protějšku v Pages. Podpis zahrnuje aktéra, operaci, argumenty, verzi záznamu, ID příkazu, čas a nonce.

- Rezervace: `node backend/production/build.mjs`; aktualizovat stejné webové nasazení bez změny URL. `OPS_SPREADSHEET_ID` ukazuje na soukromou provozní tabulku. Přijímač přidává vlastní list `_Admin_commands`.
- Sponzoři: k ověřenému aktuálnímu zdroji připojit `integrations/outreach/AdminBridge.gs`. `setupOutreachAdmin` pouze přidá chybějící metadata sloupců; neinstaluje automatiku a nemění limity. `OPS_SPREADSHEET_ID` směřuje na soukromé provozní úložiště, příkazy mají list `_Admin_sponsors`. Nevkládat druhý `doPost`, pokud projekt již nějaký má.
- Asistent: modul `integrations/email-assistant/admin_bridge.py` a FastAPI cesta POST `/bridge`. SQLite změny jsou přídavné. Samotné kopírování Python souborů nestačí: image vyžaduje Build a Up při zachování svazku a konfigurace.

Úpravy darů přepisují pouze schválené administrační buňky; nepřepisují vzorce a příznaky odesílání. Změna má otisk verze. Příkaz se stejným ID a jinými argumenty je odmítnut.

## Nejisté výsledky

Před zápisem musí existovat trvalý záznam příkazu. Po timeoutu se výsledek označí jako nejistý. V historii lze ověřit původní potvrzení ze zdrojového systému; tato kontrola znovu neprovádí změnu. Pokud zdroj dokončení nepotvrdí, nepoužívat nové ID a nepředpokládat, že původní zápis neproběhl.

Odeslaná zpráva, přijetí poskytovatelem, koncept v Gmailu a doručení nejsou totožné stavy. Tato verze administrativního bridge nemá obecnou operaci odesílání zpráv ani otevření prodeje či brány.

## Zálohy a návrat

Před změnami uložit přesný živý zdroj a konfiguraci mimo veřejný repozitář. `integrations/email-assistant/backup.py` pořídí konzistentní SQLite snapshot včetně WAL a OAuth tokenu před migrací; integrita se ověřuje. Snapshot je ve stejném svazku a sám o sobě není nezávislá záloha pro ztrátu disku. Kopii na oddělené úložiště je třeba řešit samostatně.

Image verzovat, předchozí image ponechat. Nepoužívat `down -v`. Při návratu nejprve vrátit kód/image, svazek zachovat. Starší databázi neobnovovat přes novější skutečné operace bez porovnání a dohledání výsledků v Gmailu a ve zdrojové evidenci.

## Ověření

`tests/admin-security.mjs`, `admin-api.mjs`, `admin-bridge.mjs` a `outreach-admin.mjs` používají izolovaná data. Nejsou měřením latence nebo souběhu Google Apps Scriptu. Živě samostatně ověřit Access přihlášení, zamítnutí cizí identity, stav komponent, uloženou auditní stopu a propojení. Pro testy nepoužívat ostré rezervace, skutečné příjemce ani bankovní operace.
