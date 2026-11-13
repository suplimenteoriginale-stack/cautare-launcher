#!/usr/bin/env python3
"""Construieste indexul de cautare (inversat, cu stemming romanesc) pentru un magazin.
Utilizare: python3 build_search.py <store> <sursa> <out_dir>
  so: sursa = feed Google Shopping (xml); pv: sursa = products.json Shopify
Scrie <out_dir>/search.json (titlu/brand/categorii, mic) si <out_dir>/desc.json (descrieri, se incarca separat).
Ordinea produselor e aceeasi ca in index.json (build_index.py)."""
import json, re, sys, html, unicodedata, collections
import snowballstemmer

RO = snowballstemmer.stemmer("romanian")


def norm(s):
    s = unicodedata.normalize("NFD", (s or "").lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    s = re.sub(r"['’`]", "", s)
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


_cache = {}


def stem(w):
    if w in _cache:
        return _cache[w]
    r = w if (len(w) < 4 or w.isdigit()) else RO.stemWord(w)
    _cache[w] = r
    return r


def toks(s):
    return [stem(w) for w in norm(s).split()]


def strip_html(s):
    s = re.sub(r"<style.*?</style>|<script.*?</script>", " ", s or "", flags=re.S)
    return html.unescape(re.sub(r"<[^>]+>", " ", s))


def docs_so(path):
    t = open(path, encoding="utf-8").read()
    out = []
    for it in t.split("<item>")[1:]:
        def g(tag):
            m = re.search(r"<g:%s>(.*?)</g:%s>" % (tag, tag), it, re.S)
            return html.unescape(re.sub(r"^<!\[CDATA\[|\]\]>$", "", m.group(1).strip())) if m else ""
        out.append(dict(t=g("title"), b=g("brand"), c=g("product_type").replace(">", " "), d=strip_html(g("description")), x=g("gtin")))
    return out


def docs_pv(path):
    out = []
    for p in json.load(open(path)):
        tags = p["tags"] if isinstance(p["tags"], list) else p["tags"].split(",")
        skus = " ".join(v.get("sku") or "" for v in p["variants"])
        out.append(dict(t=p["title"], b=p["vendor"], c=" ".join(tags), d=strip_html(p.get("body_html")), x=skus))
    return out


def inverted(field_tokens):
    # postari compacte: diferente intre id-uri de document; tf>1 urmeaza ca numar negativ
    post = collections.defaultdict(list)
    last = {}
    lens = []
    for i, tk in enumerate(field_tokens):
        lens.append(len(tk))
        for w, n in collections.Counter(tk).items():
            post[w].append(i - last.get(w, 0))
            last[w] = i
            if n > 1:
                post[w].append(-min(n, 99))
    return {"len": lens, "post": dict(post)}


if __name__ == "__main__":
    store, src, out = sys.argv[1:4]
    D = docs_so(src) if store == "so" else docs_pv(src)
    T = [toks(d["t"]) for d in D]
    B = [toks(d["b"]) for d in D]
    C = [toks(d["c"]) for d in D]
    # Doofinder indexeaza doar inceputul descrierii (~3200 caractere; masurat pe numarul de rezultate)
    A = [T[i] + B[i] + C[i] + toks(d["d"][:3200]) + norm(d["x"]).split() for i, d in enumerate(D)]
    # title.autocomplete din Doofinder: cuvintele brute din titlu, potrivite dupa prefix
    TA = [norm(d["t"]).split() for d in D]
    main = {"n": len(D), "f": {"t": inverted(T), "b": inverted(B), "c": inverted(C), "ta": inverted(TA)}}
    desc = {"n": len(D), "f": {"all": inverted(A)}}
    json.dump(main, open(out + "/search.json", "w"), separators=(",", ":"))
    json.dump(desc, open(out + "/desc.json", "w"), separators=(",", ":"))
    import os
    print(store, len(D), "docs; search.json", os.path.getsize(out + "/search.json"), "desc.json", os.path.getsize(out + "/desc.json"))
