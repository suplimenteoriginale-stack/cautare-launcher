#!/usr/bin/env python3
"""Construieste indexul de produse pentru launcher.

Utilizare:
  python3 build_index.py so <feed.xml> <out.json>
  python3 build_index.py pv <products.json> <out.json> [ratings.json]

so = suplimenteoriginale.ro (feed Google Shopping din Gomag)
pv = provitamine.ro (products.json public din Shopify)
"""
import json, re, sys, html


def num(s):
    m = re.search(r"[\d.]+", s or "")
    return round(float(m.group()), 2) if m else 0.0


def cdata(s):
    s = s or ""
    s = re.sub(r"^<!\[CDATA\[|\]\]>$", "", s.strip())
    return html.unescape(s).strip()


def build_so(path):
    import os
    t = open(path, encoding="utf-8").read()
    rp = os.path.join(os.path.dirname(os.path.abspath(path)), "so_ratings.json")
    ratings = json.load(open(rp)) if os.path.exists(rp) else {}
    out = []
    for it in t.split("<item>")[1:]:
        def g(tag):
            m = re.search(r"<g:%s>(.*?)</g:%s>" % (tag, tag), it, re.S)
            return cdata(m.group(1)) if m else ""
        price, sale = num(g("price")), num(g("sale_price"))
        p = sale if sale and sale < price else price
        cats = [c.strip() for c in g("product_type").split(">") if c.strip()]
        img = g("image_link").replace("/files/product/original/", "/files/product/medium/")
        desc = re.sub(r"\s+", " ", g("description"))[:400]
        out.append({
            "id": g("id"), "t": g("title"), "b": g("brand"), "c": cats,
            "p": p, "op": price if p < price else 0,
            "a": 1 if g("availability") == "in_stock" else 0,
            "img": img, "u": g("link"), "g": g("item_group_id"),
            "k": [c for c in {g("id"), g("gtin"), g("mpn")} if c],
        })
        r = ratings.get(g("id"))
        if r: out[-1]["_r"] = r
    # variantele de pe aceeasi pagina (acelasi item_group_id) au recenzii comune in Gomag:
    # le adunam pe grup si le dam tuturor variantelor
    grp = {}
    for x in out:
        r = x.pop("_r", None)
        if r:
            a = grp.setdefault(x["g"] or x["id"], [0.0, 0])
            a[0] += r["v"] * r["n"]; a[1] += r["n"]
    for x in out:
        a = grp.get(x["g"] or x["id"])
        if a and a[1]:
            x["r"], x["rc"] = round(a[0] / a[1], 1), a[1]
    return out


def build_pv(path, ratings_path=None):
    import os
    prods = json.load(open(path))
    ratings = json.load(open(ratings_path)) if ratings_path and os.path.exists(ratings_path) else {}
    pp = os.path.join(os.path.dirname(os.path.abspath(path)), "pv_popularity.json")
    pop = json.load(open(pp)) if os.path.exists(pp) else {}
    out = []
    for pr in prods:
        vs = pr["variants"]
        v = min(vs, key=lambda x: float(x["price"]))
        p = float(v["price"])
        cap = float(v["compare_at_price"] or 0)
        tags = pr["tags"] if isinstance(pr["tags"], list) else [x.strip() for x in pr["tags"].split(",")]
        img = pr["images"][0]["src"] if pr["images"] else ""
        if img:
            img += ("&" if "?" in img else "?") + "width=400"
        body = re.sub(r"<style.*?</style>", " ", pr.get("body_html") or "", flags=re.S)
        body = re.sub(r"<[^>]+>", " ", body)
        body = re.sub(r"\s+", " ", html.unescape(body))[:400]
        r = ratings.get(pr["handle"]) or {}
        out.append({
            "id": str(pr["id"]), "t": pr["title"], "b": pr["vendor"], "c": [t for t in tags if t],
            "p": p, "op": cap if cap > p else 0,
            "a": 1 if any(x["available"] for x in vs) else 0,
            "img": img, "u": "https://provitamine.ro/products/" + pr["handle"],
            "g": str(pr["id"]),
            "r": r.get("v", 0), "rc": r.get("n", 0), "h": pr["handle"], "pop": pop.get(pr["handle"], 0),
            "k": sorted({c for x in vs for c in (x.get("sku"), x.get("barcode")) if c}),
        })
    return out


if __name__ == "__main__":
    store, src, dst = sys.argv[1:4]
    data = build_so(src) if store == "so" else build_pv(src, sys.argv[4] if len(sys.argv) > 4 else None)
    json.dump(data, open(dst, "w"), ensure_ascii=False, separators=(",", ":"))
    print(store, len(data), "produse ->", dst)
