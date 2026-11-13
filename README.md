# cautare-launcher

Fereastra de căutare fullscreen pentru **suplimenteoriginale.ro** (Gomag) și **provitamine.ro** (Shopify), copie 1:1 a layer-ului Doofinder folosit până în noiembrie 2026.

- Căutarea rulează în browser (fără server): toleranță la greșeli, sinonime, bannere pe termeni, rezultate fixate, produse fără stoc la final, filtre (brand, categorie, preț, stoc), sortare, căutări recente/populare, căutare vocală.
- Indexul se reconstruiește automat la fiecare 3 ore (GitHub Actions) din feed-ul Gomag și din catalogul public Shopify, apoi se publică pe GitHub Pages.

## Instalare
suplimenteoriginale.ro (Gomag, cod extern în footer):
```html
<script src="https://suplimenteoriginale-stack.github.io/cautare-launcher/launcher.js" data-ofs-store="so" defer></script>
```
provitamine.ro (Shopify, `theme.liquid` înainte de `</body>`):
```html
<script src="https://suplimenteoriginale-stack.github.io/cautare-launcher/launcher.js" data-ofs-store="pv" defer></script>
```

## Unde se modifică
- `config/so.json`, `config/pv.json`: sinonime, bannere, rezultate fixate, căutări populare, produse recomandate, texte, culori.
- `assets/banners/`: imaginile bannerelor (desktop + mobil).
- `src/engine.js`: logica de căutare; `src/ui.js` + `src/ui.css`: interfața.
