# Výběr stolů

Společný vektorový plánek zobrazuje 70 stolů přízemí a 20 stolů ochozu, jeviště nahoře. P/O rozlišuje stejná čísla různých podlaží. Jde o schematickou projekci dodaných originálů, nikoli zaměření stavby. Podklad a číslovaný náhled generuje `node scripts/plans.mjs` z `table-layout.js`.

- Modrá: přízemí; zelená: ochoz; žlutá: aktuální výběr.
- Bílá s křížem: obsazeno nebo méně míst, než potřebuje skupina. Text a počet míst rozlišují důvod.
- Jedna rezervace: 1–4 místa u jednoho stolu, případně 1–10 vstupenek na stání. Konkrétní židle se nepřidělují.
- Plánek podporuje přiblížení dvěma prsty, posun jedním prstem, tlačítka přiblížení a klávesy +, −, 0. Alternativou je seznam a nativní výběrové pole.
- Kliknutí na stůl nic neblokuje. Backend musí při dokončení znovu ověřit kapacitu pod společným ScriptLock; stávající `reserve_()` to již provádí. Frontendový přehled není příslib dostupnosti.
- Bez čerstvých ověřených dat nelze v ostrém režimu potvrdit výběr. Zavřený prodej ukazuje výslovně označenou ukázku bez údajů o skutečné obsazenosti.

Ověření: všech sedm sad v `.github/workflows/web.yml`; rozšířené klientské testy kontrolují 90 identit, výběr ochozu, součet, částečnou kapacitu, zvětšení gestem a potlačení náhodného kliknutí po gestu. Backendové testy používají pouze paměťová data, žádný skutečný bankovní, poštovní ani rezervační zápis. Vizuálně ověřeno v prohlížeči na desktopu a při rozměru 390 × 844. Fyzický iPhone/Safari a skutečný distribuovaný nápor tímto ověřeny nejsou.

Změna nezapíná prodej ani odbavení a nemění přístupové údaje. Před otevřením prodeje je stále nutné samostatně zapojit a ověřit skutečný frontendový rezervační adaptér; `reservationAdapter` zůstává `null`.
