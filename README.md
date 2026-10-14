# Olympijská Randovka — frontend s GSAP animacemi

Nahrajte obsah této složky na svůj HTTPS hosting: index.html, style.css, app.js, data.js, animations.js, olympic-effects.js, sponsor-controls.js a celé složky assets a vendor. Není potřeba npm ani sestavení. Formulář stále běží v ukázkovém režimu; váš backend připojíte podle BACKEND.md. SEO a sdílení jsou popsané v SEO.md.

Bílý základ, olympijské barvy, zaoblené fotky a karty, lokální variabilní písmo Manrope a kruhový odpočet. Skutečné fotky třídy, všechny osoby a jejich údaje, sponzoři s prokliky, Instagram, plánky, Stage a copyright zůstávají zachovány. Galerie zatím není zobrazena.

## Animace

V souboru animations.js je GSAP 3.15.0 se ScrollTrigger:
- Postupný nástup nadpisu a pohyb jeho řádků při scrollování.
- Pohyb a mírné natočení třídní fotky podle scrollu.
- Nástup kruhů odpočtu a portrétů.
- Na větších obrazovkách vodorovný program ovládaný svislým scrollováním.
- Na mobilu program umožňuje běžné vodorovné listování prstem; scroll animace jsou menší.
- Respektuje prefers-reduced-motion. Bez knihoven jsou všechny sekce normálně viditelné.

GSAP a ScrollTrigger jsou místní soubory ve vendor, písmo v assets/fonts. Nevyžadují CDN. Písmo Manrope pochází z oficiálního repozitáře Google Fonts; licence OFL je přiložena. Knihovny ponechte i s původními licenčními hlavičkami.

Odkazy: https://gsap.com/docs/v3/Plugins/ScrollTrigger/ a https://github.com/google/fonts/tree/main/ofl/manrope.

## Ověření

Ověřena syntaxe JavaScriptu, vložení písma a knihoven do samostatného HTML, zachování původních údajů a všech 28 portrétních JPEGů, SEO metadata a úplnost balíčku. Vizuální a funkční kontrola již proběhla v prohlížeči na desktopu i při šířkách 375 a 320 px; podrobnosti jsou v KONTROLA.md. Backend zůstává odpojený.

Živý web nebyl změněn. Předchozí verze je uložená jako olympijska-randovka-svetla-zaloha.zip vedle aktuálního ZIPu.

## Výraznější olympijské efekty

Soubor olympic-effects.js je součást nasazení. Obsahuje úvodní kreslení olympijských kruhů, interaktivní atletický ovál kreslený na canvasu, reakci pozadí na myš/dotyk, náklon skutečné třídní fotografie a jemně magnetická tlačítka pro myš. Žádné nové AI fotografie ani rastrové pozadí nebyly vytvořeny. Intro je dekorativní, krátké a neblokuje tlačítka. Pozadí je za obsahem, text má světlé krycí plochy.

Na mobilu zůstává běžný svislý scroll, program lze listovat do stran, portréty mají dva sloupce a formulář jeden. Nadpis se přizpůsobuje šířce svého kontejneru, vstupní pole mají 16px písmo a hlavní ovládací prvky dostatečné dotykové rozměry. Při prefers-reduced-motion se úvodní a scroll animace vypnou a pozadí zůstane statické. Canvas se zastaví ve skryté kartě a rozlišení je omezené kvůli výkonu.


## Prostředí podle scrollu a ovládání sponzorů

Pozadí nyní kreslí šest stylizovaných sportovních prostředí: atletický stadion, plavecký bazén, volejbalovou halu a fotbalové hřiště, zimní svah a olympijské kruhy u afterparty. GSAP ScrollTrigger řídí jejich prolínání, přiblížení, natočení a změny barvy celé stránky i hlavního akcentu. Obsah je nad pozadím na bílých plochách; panely se jemně pohupují nezávisle na čitelném textu. Prostředí jsou kreslená vektorovou geometrií na canvasu, nikoli generované fotografie.

Sponzory lze posouvat tažením myši, běžným dotykovým scrollováním, šipkami na klávesnici i dvěma tlačítky. Automatický pohyb se zastaví při interakci, najetí a fokusu a lze ho vypnout tlačítkem pauzy. Po tažení se zabrání nechtěnému otevření odkazu; běžný klik stále otevře web firmy. Opakované skupiny log slouží plynulé smyčce a jsou vyřazené z navigace čtečkou a tabulátorem.

Soubor sponsor-controls.js musí být nahrán spolu s ostatními skripty. Při omezeném pohybu nejsou zoomy ani pohupování; prostředí se stále přepínají staticky a sponzory lze posouvat ručně. Ověřeny interakce sponzorů a kreslení všech prostředí jednotkovými kontrolami, syntaxe skriptů a úplnost balíčku. Vizuální kontrola v prohlížeči nyní proběhla; viz KONTROLA.md.



Fotografie maturantů nyní nastupují přes GSAP plynulým prolínáním, malým posunem a přiblížením snímku. Původní natočení karet bylo odstraněno. Při hledání a změně filtru se staré animace a posluchače uklidí; při ovládání klávesnicí se fokusovaná karta ihned zobrazí.
