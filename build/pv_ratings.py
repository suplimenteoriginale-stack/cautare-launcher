#!/usr/bin/env python3
"""Citeste ratingul Judge.me (din JSON-LD) pentru fiecare produs provitamine.ro.
Utilizare: python3 pv_ratings.py <products.json> <out_ratings.json>"""
import json, re, sys, os, ssl, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor

ctx = ssl.create_default_context(cafile=os.environ.get("CA_BUNDLE") or None)


def one(handle, tries=4):
    for k in range(tries):
        time.sleep(0.8)
        try:
            return _one(handle)
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(20 * (k + 1)); continue
            return handle, None
        except Exception:
            time.sleep(3)
    return handle, None


def _one(handle):
    if True:
        req = urllib.request.Request("https://provitamine.ro/products/" + handle, headers={"User-Agent": "Mozilla/5.0"})
        h = urllib.request.urlopen(req, context=ctx, timeout=40).read().decode("utf-8", "ignore")
        m = re.search(r'"aggregateRating"\s*:\s*\{[^}]*"ratingValue"\s*:\s*"?([\d.]+)"?[^}]*"reviewCount"\s*:\s*"?(\d+)', h)
        if m:
            return handle, {"v": float(m.group(1)), "n": int(m.group(2))}
    return handle, {"v": 0, "n": 0}


if __name__ == "__main__":
    prods = json.load(open(sys.argv[1]))
    with ThreadPoolExecutor(2) as ex:
        res = dict(r for r in ex.map(one, [p["handle"] for p in prods]) if r[1] and r[1]["n"])
    json.dump(res, open(sys.argv[2], "w"))
    print(len(res), "ratinguri")
