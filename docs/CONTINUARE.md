# Continuare: căutarea proprie (înlocuitor Doofinder)

Fișier pentru o conversație nouă cu Claude. Arhiva în care l-ai găsit este construită din **exact aceeași versiune care rulează live** (vezi `BUILD.txt` pentru commit și dată).

## Ce este
Fereastra de căutare fullscreen pentru două magazine, construită în noiembrie 2026 ca înlocuitor 1:1 pentru Doofinder (629 €/lună, anulat):
- **suplimenteoriginale.ro** (Gomag), cod magazin `so`
- **provitamine.ro** (Shopify), cod magazin `pv`

Căutarea rulează în browser (fără server de căutare). Un singur fișier `launcher.js` servește ambele site-uri.

## Unde rulează
- Cod: GitHub `suplimenteoriginale-stack/cautare-launcher` (public), ramura `main`.
- Publicare: GitHub Pages, `https://suplimenteoriginale-stack.github.io/cautare-launcher/`
  - `launcher.js` (pachetul: stemmer + `src/engine.js` + `src/ui.js` + CSS)
  - `so/` și `pv/`: `config.json`, `index.json`, `search.json`, `desc.json`
  - `assets/` (bannere, logo-uri), `sursa-cautare.zip` (această arhivă), `build.json`
- Workflow `.github/workflows/update-index.yml`: la fiecare push pe `main` și o dată pe oră reconstruiește indexul și publică tot. Dacă Shopify răspunde 429, păstrează indexul PV deja publicat.
- Worker Cloudflare `cautare-statistici` (cont provitaminebg, `stats/worker.js`, `stats/wrangler.toml`, D1 `cautare-stats`), publicat automat din repo (Workers Builds):
  - `POST /e` evenimente (căutări, click-uri) din launcher
  - `/popular?s=so|pv` căutări populare
  - `/stock?s=so|pv` stoc și prețuri la zi, aplicate peste index la deschidere. Cron la 2 minute: SO din API Gomag (produse modificate azi), PV din `products.json` la 4 minute
  - `/ratings` recenziile SO din Gomag (zilnic, ~04:00), folosite de build
  - `/d/<cheie>` panoul de statistici (cheia e în D1: `SELECT v FROM cfg WHERE k='dash'`), cu butonul de descărcare a acestei arhive
  - `/stock/status` starea sincronizărilor
  - Secret în Cloudflare: `GOMAG_API_KEY` (cheie Gomag cu „Produse Citire” + „Recenzii Citire”). Nu este în repo.

## Instalare pe site-uri
- **provitamine.ro**: tema live `provitamine-new/main`, `layout/theme.liquid`, înainte de `</body>`:
  `<script src="https://suplimenteoriginale-stack.github.io/cautare-launcher/launcher.js" data-ofs-store="pv" defer></script>`
  Aplicația Doofinder a fost dezinstalată.
- **suplimenteoriginale.ro**: Google Tag Manager `GTM-PG29W72`, eticheta „Cautare proprie - launcher (inlocuieste Doofinder)” (HTML personalizat, All Pages). GTM șterge atributul `data-ofs-store`, deci launcher-ul deduce magazinul și din domeniu.
- Revenire la Doofinder (nu mai e cazul, abonament anulat): GTM versiunea 28; în Shopify scoaterea liniei din `theme.liquid`.

## Structura codului
- `src/engine.js`: motorul: index inversat, BM25 pe câmpuri (titlu 3, brand 2, categorie 2, tot 1), stemmer românesc Snowball, corectare Damerau-Levenshtein, sinonime, toate cuvintele obligatorii, fără stoc la final, rezultate fixate, popularitate PV, cod produs SKU/EAN exact → doar acel produs, a doua încercare cu cuvinte apropiate când nu găsește nimic („live extension” → Life Extension).
- `src/ui.js` + `src/ui.css`: interfața (desktop: inițial / sugestii / rezultate; mobil: rezultate direct cât scrii, filtre rapide doar cu branduri, panou de filtre, completare automată gri în bară).
- `src/vendor/ro-stemmer.min.js`: stemmer.
- `build/build_index.py`, `build_search.py`, `build_config.py`, `bundle.py`: generarea fișierelor publicate.
- `config/so.json`, `config/pv.json`: teme, texte, sinonime, bannere, populare, fixate, recomandate, `mobileChipRows`.
- `data/pv_ratings.json` (Judge.me din Shopify, actualizat de o sarcină programată săptămânală în Claude), `data/pv_popularity.json` (vânzări 90 zile).
- `tests/compare_relevance.js` + listele Doofinder din 13.11.2026: test de relevanță (SO ~83%, PV ~80%).
- `stats/`: worker-ul Cloudflare.

## Cum se lucrează
- Modificare: edit în `src/` sau `config/`, `python3 build/bundle.py` pentru test local, apoi commit + push pe `main`; Pages se actualizează în 2–4 minute (vizitatorii pot avea cache câteva minute).
- Test local: `cd dist && python3 -m http.server`, apoi `src/test_so.html` cu scriptul local; Playwright pentru mobil (iPhone 13).
- Mesajele de commit și răspunsurile sunt în română; utilizatorul este Denis.
