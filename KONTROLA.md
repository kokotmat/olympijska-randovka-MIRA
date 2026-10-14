# Kontrola finálního frontendu

Kontrola proběhla v prohlížeči na desktopu 1280 × 720 a mobilních šířkách 375 a 320 px. Jde o kontrolu responsivního zobrazení, nikoli test na fyzickém telefonu.

## Upraveno při kontrole

- Basketbal byl odstraněn: přibylo volejbalové hřiště se sítí a útočnými čarami a fotbalové hřiště s brankami, půlicí čarou, kruhem a vápny.
- Fotky maturantů mají plynulé GSAP odhalení s jemným přiblížením. Naklánění karet při nástupu je odstraněné; finální mřížka je rovná.
- Parametry pohybu hlavní fotky se přepočítávají při změně šířky okna.
- Fokus klávesnice okamžitě zobrazí kartu; změna filtru uklidí původní animace a posluchače.

## Ověřeno

- Žádné vodorovné přetékání stránky na uvedených šířkách.
- Všech 26 maturantů, původní citáty/disciplíny a 28 portrétních JPEGů zachováno.
- Všechny portréty mají shodné rámečky: 192 × 241 px na desktopu, 139 × 174 px při šířce 375 px a 111 × 139 px při 320 px. Rozměry jsou zaokrouhlené a mohou se mírně lišit podle šířky a prohlížeče.
- Nezjištěny obrázky dokončené s chybou načtení; budoucí portréty se načítají odloženě.
- Mobilní menu se otevře a po volbě odkazu zavře; kotevní odkazy vedou na správné sekce.
- Hledání Musil vrátí správnou kartu; otevření a zavření detailu funguje.
- Posun sponzorů tlačítkem a tažení myší fungují. Tažení neotevřelo odkaz. Jednotková kontrola ověřila i běžný klik, klávesové šipky, pozastavení při dotyku a omezení pohybu.
- Formulář: 10 základních vstupenek = 3 500 Kč; 10 místenek = 4 500 Kč. Maximum blokuje přidávání, zobrazí se volba PDF.
- Přehled rezervace výslovně uvádí, že jde o ukázku. Backend zůstává odpojený a žádná objednávka nebyla odeslána.
- V prohlížečové konzoli se během kontroly neobjevily chyby ani varování.
- Kreslení a přepínání všech šesti prostředí ověřeno i v režimu omezeného pohybu, s omezeným rozlišením canvasu pro telefony.
- Syntaxe skriptů, vložení knihoven a písma do samostatného HTML, lokální soubory a SEO metadata prošly kontrolou.

Backend, skutečné platby, doručování PDF/e-mailů a chování na všech modelech telefonů tím nejsou ověřeny. Pokyny k napojení jsou v BACKEND.md.
