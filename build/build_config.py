#!/usr/bin/env python3
"""Transforma config/<store>.json in dist/<store>/config.json (rezolva titlurile in id-uri).
Utilizare: python3 build_config.py <store>"""
import json, sys, os, re, unicodedata

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def norm(s):
    s = unicodedata.normalize("NFD", s.lower())
    s = "".join(c for c in s if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


def find(idx, title):
    n = norm(title)
    for p in idx:  # prefer in stoc
        if p["a"] and norm(p["t"]).startswith(n):
            return p["id"]
    for p in idx:
        if norm(p["t"]).startswith(n) or n in norm(p["t"]):
            return p["id"]
    return None


store = sys.argv[1]
cfg = json.load(open(os.path.join(ROOT, "config", store + ".json")))
idx = json.load(open(os.path.join(ROOT, "dist", store, "index.json")))
missing = []
rec = []
for t in cfg["recommended"]:
    i = find(idx, t)
    (rec.append(i) if i else missing.append(t))
cfg["recommended"] = rec
for pin in cfg["pinned"]:
    ids = []
    for t in pin["items"]:
        i = find(idx, t)
        (ids.append(i) if i else missing.append(t))
    pin["items"] = ids
if cfg.get("brandLogos"):
    logos = json.load(open(os.path.join(ROOT, "assets", "logos.json")))
    logos["Applied Nutrition"] = logos.get("Applied Nutrition Ltd")
    cfg["logos"] = logos
json.dump(cfg, open(os.path.join(ROOT, "dist", store, "config.json"), "w"), ensure_ascii=False, separators=(",", ":"))
print(store, "config ok; recomandate", len(rec), "; negasite:", missing)
