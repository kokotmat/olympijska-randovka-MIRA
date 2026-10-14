# SEO a nasazení

Připraveno pro původní veřejnou adresu `https://olympijskarandovka.cz/test`.

## Co už je v HTML

- Český jazyk, mobilní viewport, jeden H1 a popisné nadpisy.
- Titulek „Maturitní ples Randovka 2027 | Jablonec nad Nisou“.
- Meta description s místem, datem a vstupným.
- Jablonec nad Nisou přirozeně v úvodu, u místa konání a v patičce. Žádné seznamy nesouvisejících obcí ani skrytá klíčová slova.
- Canonical a Open Graph URL pro `/test`.
- Open Graph / Twitter karta s vlastním sdílecím obrázkem 1200 × 630 px vytvořeným ze skutečné třídní fotografie, názvu, data a místa.
- Schema.org Event: název plesu, popis, datum, časové pásmo, konec ve 02:00 následující den, Eurocentrum, Jablonec nad Nisou, Liberecký kraj a organizátor. Afterparty je samostatné pokračování po skončení plesu.
- Alt texty skutečných fotografií, vysoká priorita hlavní fotky a odložené načítání portrétů.
- Odkaz na oficiální web školy.

Záměrně neuvádíme vymyšlenou přesnou adresu, hodnocení ani dostupnost rezervací. Vstupné je viditelné na stránce; strukturované nabídky vstupenek doplňte při skutečném spuštění prodeje.

## Při nasazení

1. Nahrajte HTML, CSS, JS a složku `assets` na vlastní hosting. Pro `index.html` na adrese `/test` se relativní cesta `assets/…` vyhodnotí jako `/assets/…`; pro `/test/` se vyhodnotí jako `/test/assets/…`. Zachovejte odpovídající strukturu nebo upravte cesty.
2. Pokud web nasadíte na hlavní stránku `/` místo `/test`, změňte všechny výskyty produkční URL v canonical, `og:url`, JSON-LD a sitemap.xml. Open Graph a Twitter musí odkazovat na skutečnou veřejnou cestu k `assets/og-image.png`; obrázek události v JSON-LD odkazuje na `assets/trida.jpg`.
3. `robots.txt` a `sitemap.xml` patří do kořene domény. Pokud už tam existují, doplňte tento web do stávajících souborů, nenahrazujte seznam ostatních stránek. Pro testovací kopii, která nemá být v Googlu, použijte `noindex`; indexujte až finální veřejnou stránku.
4. I při nasazení samostatného HTML souboru nahrajte `assets/og-image.png` pro náhled sdíleného odkazu a `assets/trida.jpg` pro obrázek strukturované události. Fotka vložená uvnitř HTML funguje v prohlížeči, ale sociální sítě potřebují vlastní veřejnou URL obrázku.
5. Ověřte doménu v Google Search Console a odešlete sitemapu. Zkontrolujte veřejnou stránku v Rich Results Test. Výsledek ve vyhledávání se projeví až po nasazení a indexaci; samotná metadata pořadí nezaručují.

Oficiální reference: https://developers.google.com/search/docs/appearance/structured-data/event
