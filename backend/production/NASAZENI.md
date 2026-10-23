# Aktualizace bez otevření prodeje nebo brány

Tento zdroj v GitHubu sám neaktualizuje Google Apps Script. Cloudflare nasazuje pouze veřejný web a gateway. Původní širší rozpracovaná větev rezervací zůstává oddělená.

1. `node backend/production/build.mjs` vytvoří kompletní `Randovka_PRODUKCE.gs` s lokálním generátorem QR. Celý obsah patří do hlavního souboru existujícího Apps Script projektu. Nejprve si uložte současný zdroj a číslo nasazené verze pro návrat.
2. Přidejte **stejný nový náhodný interní klíč** `SCANNER_GATEWAY_SECRET` (alespoň 32 znaků, doporučeno 64 náhodných znaků) v Cloudflare Pages → projekt webu → Settings → Variables and Secrets → Production → typ Secret, a v Apps Script → Project Settings → Script Properties. Nezadávejte jej do repozitáře ani chatu. Neměňte PIN, SESSION_SECRET, Fio token nebo nastavení otevření prodeje/brány.
3. Nejdříve nasaďte Cloudflare gateway s klíčem. Starý backend nadbytečné pole ignoruje. Potom aktualizujte Apps Script **existující nasazení** na novou verzi, aby URL zůstala stejná. Nový backend odmítá nepodepsané přihlášení, vyžaduje důvěryhodnou gateway. Vložit pouze gateway bez aktualizace backendu neopraví globální blokování!
4. Používejte skener na `https://olympijskarandovka.cz/kontrola-vstupenek.html`. Původní Apps Script odkaz zobrazí odkaz na tento skener. Podepsaná relace nadále platí šest hodin; bránu ověřuje každý scan na serveru.
5. Ověřte přihlášení a **zavřenou bránu**. Skutečné zatížení tabulky a e-mailovou frontu testujte až v samostatné kopii projektu a tabulky, s testovacími příjemci a bankovním adaptérem. Nepřepínejte ostrý projekt kvůli testům do jiného režimu.

Přihlášení je omezené na 10 chybných pokusů / 5 minut na síťovou adresu ověřenou Cloudflare. IP není předávána Googlu: gateway posílá její HMAC otisk. Klientem poslaný otisk nebo podpis je ignorován. Přímý požadavek na Apps Script nemůže obejít podpis. Obsluhy ve stejné veřejné síti sdílejí limit; pro událost mějte záložní síť. Tato ochrana není síťový DDoS filtr.

`operationsHealth()` je dostupné pouze vlastníkovi z editoru. Vrací počet čekajících/nejistých e-mailů, stáří nejstarší čekající zprávy od poslední změny stavu, zbývající adresáty a stáří poslední úspěšné bankovní synchronizace. Nevrací osobní údaje ani tajné hodnoty. Čas je orientační u ručně znovu zařazených zpráv; není to historický monitoring.

`node tests/production-system.mjs` testuje skutečné funkce proti izolovaným paměťovým náhradám Google API. Není to měření latence Google, skutečná souběžnost více procesů ani důkaz doručitelnosti e-mailů. Automatizované testy nikdy nepoužívají živé tokeny, tabulku ani banku.

Rollback: nejprve vraťte předchozí Apps Script verzi existujícího nasazení, poté odpovídající Git commit/Cloudflare deployment. Klíč může zůstat nastavený; starší backend nadbytečné podepsané pole ignoruje.
