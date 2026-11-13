#!/usr/bin/env python3
"""Lipeste engine.js + ui.js (+ CSS) in dist/launcher.js."""
import os, json
R = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
css = open(os.path.join(R, "src/ui.css")).read()
css = " ".join(l.strip() for l in css.splitlines() if l.strip() and not l.strip().startswith("/*"))
eng = open(os.path.join(R, "src/engine.js")).read()
ui = open(os.path.join(R, "src/ui.js")).read().replace("'__CSS__'", json.dumps(css))
open(os.path.join(R, "dist/launcher.js"), "w").write("/* launcher cautare v1 */\n" + eng + "\n" + ui)
print("dist/launcher.js", os.path.getsize(os.path.join(R, "dist/launcher.js")), "bytes")
