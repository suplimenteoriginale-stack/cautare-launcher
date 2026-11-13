/* Motor de cautare client-side, construit sa se comporte ca Doofinder (Elasticsearch):
   - campuri si ponderi ca in Doofinder: title 3, brand 2, categories 2, df_all 1 (tot textul, inclusiv descrierea)
   - scor BM25 pe fiecare camp, se pastreaza campul cel mai bun (dis_max)
   - stemming romanesc (Snowball), corectare automata a cuvintelor scrise gresit
   - sinonime cu aceeasi frecventa (idf) pentru toti membrii grupului
   - toate cuvintele trebuie gasite (AND); produsele fara stoc x0.01; rezultate fixate
   Functioneaza in browser si in Node (pentru teste). */
(function (root) {
  'use strict';
  var K1 = 1.2, B = 0.75, process_syn = false;
  var FW = { t: 3, b: 2, c: 2, all: 1, ta: 1 };

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  // Damerau-Levenshtein marginit
  function dist(a, b, max) {
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    var pp = null, prev = [], cur, i, j;
    for (j = 0; j <= lb; j++) prev[j] = j;
    for (i = 1; i <= la; i++) {
      cur = [i]; var rowMin = i;
      for (j = 1; j <= lb; j++) {
        var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1));
        if (pp && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, pp[j - 2] + 1);
        cur[j] = v; if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      pp = prev; prev = cur;
    }
    return prev[lb];
  }

  // decodare postari: [deltaDoc, (-tf)?, deltaDoc, ...] -> Map(doc -> tf)
  function decode(arr) {
    var m = new Map(), d = 0, last = -1;
    for (var k = 0; k < arr.length; k++) {
      var v = arr[k];
      if (v < 0) { m.set(last, -v); continue; }
      d += v; last = d; m.set(d, 1);
    }
    return m;
  }

  function Field(data) {
    this.raw = data.post; this.cache = new Map(); this.len = data.len;
    var s = 0; for (var i = 0; i < data.len.length; i++) s += data.len[i];
    this.avg = s / Math.max(1, data.len.length);
    this.df = new Map();
    for (var w in data.post) {
      var a = data.post[w], c = 0;
      for (var k = 0; k < a.length; k++) if (a[k] >= 0) c++;
      this.df.set(w, c);
    }
  }
  Field.prototype.get = function (w) {
    var m = this.cache.get(w);
    if (!m) { var a = this.raw[w]; m = a ? decode(a) : null; this.cache.set(w, m); }
    return m;
  };

  function Engine(products, cfg, search, stemmer) {
    var self = this;
    this.P = products; this.cfg = cfg || {}; this.N = products.length;
    this.stemmer = stemmer;
    this.oos = this.cfg.outOfStockBoost == null ? 0.01 : this.cfg.outOfStockBoost;
    this.byId = {};
    var hideCat = new RegExp(this.cfg.hideCategories || '^$', 'i');
    products.forEach(function (p, i) {
      self.byId[p.id] = i;
      p._cats = [];
      (p.c || []).forEach(function (c) { if (p._cats.indexOf(c) < 0 && !hideCat.test(c)) p._cats.push(c); });
    });
    this.F = {};
    ['t', 'b', 'c'].forEach(function (f) { self.F[f] = new Field(search.f[f]); });
    this.TA = search.f.ta ? new Field(search.f.ta) : null;
    this.taWords = this.TA ? Array.from(this.TA.df.keys()).sort() : [];
    this.taCache = new Map();
    this.vocab = new Set();
    ['t', 'b', 'c'].forEach(function (f) { self.F[f].df.forEach(function (_, w) { self.vocab.add(w); }); });
    this._prepSyn();
    this.pins = (this.cfg.pinned || []).map(function (x) { return { term: self.stemQ(x.term), items: x.items }; });
    this.banners = (this.cfg.banners || []).map(function (b) { return { b: b, terms: b.terms.map(norm).filter(Boolean) }; });
  }

  // descrierile (df_all) vin intr-un fisier separat, incarcat dupa deschidere
  Engine.prototype.addDesc = function (desc) {
    var self = this;
    this.F.all = new Field(desc.f.all);
    this.F.all.df.forEach(function (_, w) { self.vocab.add(w); });
    this._vocabArr = null;
    this._prepSyn();
  };

  Engine.prototype.stem = function (w) {
    return (w.length < 4 || /^\d+$/.test(w) || !this.stemmer) ? w : this.stemmer.stem(w);
  };
  Engine.prototype.stemQ = function (q) { var s = this; return norm(q).split(' ').filter(Boolean).map(function (w) { return s.stem(w); }).join(' '); };

  Engine.prototype._prepSyn = function () {
    var self = this;
    this.syn = (this.cfg.synonyms || []).map(function (g) { return g.map(function (x) { return self.stemQ(x); }).filter(Boolean); });
    // frecventa comuna pe grup (ca la sinonimele Elasticsearch)
    this.dfo = {};
    Object.keys(this.F).forEach(function (f) {
      var o = self.dfo[f] = new Map(), F = self.F[f];
      self.syn.forEach(function (g) {
        var mx = 0;
        g.forEach(function (m) { m.split(' ').forEach(function (w) { mx = Math.max(mx, F.df.get(w) || 0); }); });
        g.forEach(function (m) { if (m.indexOf(' ') < 0) o.set(m, Math.max(o.get(m) || 0, mx)); });
      });
    });
  };

  Engine.prototype.vocabArr = function () {
    if (!this._vocabArr) this._vocabArr = Array.from(this.vocab).sort();
    return this._vocabArr;
  };
  Engine.prototype.dfAll = function (w) {
    var s = 0, F = this.F; for (var f in F) s += F[f].df.get(w) || 0; return s;
  };

  // corectare automata: cuvant necunoscut -> cel mai apropiat cuvant din catalog
  Engine.prototype.correct = function (w) {
    if (this.vocab.has(w) || /^\d+$/.test(w) || w.length < 4) return w;
    var max = w.length >= 8 ? 2 : 1, best = null, bd = 9, bdf = -1, V = this.vocabArr();
    for (var k = 0; k < V.length; k++) {
      var x = V[k]; if (Math.abs(x.length - w.length) > max) continue;
      var d = dist(w, x, max); if (d > max) continue;
      var df = this.dfAll(x);
      if (d < bd || (d === bd && df > bdf)) { best = x; bd = d; bdf = df; }
    }
    return best || w;
  };

  Engine.prototype.bm = function (f, w, doc, tf) {
    var F = this.F[f], df = (this.dfo[f] && this.dfo[f].get(w)) || F.df.get(w) || 0;
    var idf = Math.log(1 + (this.N - df + 0.5) / (df + 0.5));
    return FW[f] * idf * tf * (K1 + 1) / (tf + K1 * (1 - B + B * F.len[doc] / F.avg));
  };

  // title.autocomplete: documentele care au in titlu un cuvant ce incepe cu `raw`
  Engine.prototype.taScores = function (raw) {
    if (!this.TA || !raw) return null;
    var c = this.taCache.get(raw); if (c) return c;
    var W = this.taWords, lo = 0, hi = W.length, docs = new Map();
    while (lo < hi) { var mid = (lo + hi) >> 1; if (W[mid] < raw) lo = mid + 1; else hi = mid; }
    for (var j = lo; j < W.length && W[j].lastIndexOf(raw, 0) === 0; j++) this.TA.get(W[j]).forEach(function (tf, d) { docs.set(d, (docs.get(d) || 0) + tf); });
    var df = docs.size, N = this.N, F = this.TA, out = new Map();
    var idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    docs.forEach(function (tf, d) { out.set(d, FW.ta * idf * tf * (K1 + 1) / (tf + K1 * (1 - B + B * F.len[d] / F.avg))); });
    this.taCache.set(raw, out);
    return out;
  };

  // scor pentru un termen (cu eventuale extinderi prefix) -> Map(doc -> scor)
  Engine.prototype.termScores = function (alts, noDesc) {
    var out = new Map(), self = this;
    alts.forEach(function (a) {
      for (var f in self.F) {
        if (noDesc && f === 'all') continue;
        var m = self.F[f].get(a.w); if (!m) continue;
        m.forEach(function (tf, doc) {
          var s = self.bm(f, a.w, doc, tf) * a.f;
          if ((out.get(doc) || 0) < s) out.set(doc, s);
        });
      }
    });
    return out;
  };

  Engine.prototype.prefixAlts = function (w) {
    var out = [{ w: w, f: 1 }], V = this.vocabArr();
    if (w.length < 2) return out;
    var lo = 0, hi = V.length;
    while (lo < hi) { var mid = (lo + hi) >> 1; if (V[mid] < w) lo = mid + 1; else hi = mid; }
    for (var j = lo, n = 0; j < V.length && V[j].lastIndexOf(w, 0) === 0 && n < 60; j++) if (V[j] !== w) { out.push({ w: V[j], f: 0.7 }); n++; }
    return out;
  };

  Engine.prototype.variants = function (sq) {
    var out = [sq], seen = {}; seen[sq] = 1;
    var pad = ' ' + sq + ' ';
    this.syn.forEach(function (g) {
      g.forEach(function (m) {
        if (pad.indexOf(' ' + m + ' ') < 0) return;
        g.forEach(function (alt) {
          if (alt === m) return;
          var v = pad.replace(' ' + m + ' ', ' ' + alt + ' ').trim();
          if (!seen[v] && out.length < 16) { seen[v] = 1; out.push(v); }
        });
      });
    });
    return out;
  };

  // opts.prefix: completare pentru ultimul cuvant (cand utilizatorul inca scrie)
  Engine.prototype.search = function (q, opts) {
    opts = opts || {};
    var self = this, nq = norm(q);
    if (!nq) return { ids: [], q: nq };
    var words = nq.split(' ');
    var sq = words.map(function (w, k) {
      var s = self.stem(w);
      if (opts.prefix && k === words.length - 1) return s;
      return self.correct(s);
    }).join(' ');
    var best = new Map();
    var sqTok = ' ' + sq + ' ', rawOf = {};
    sq.split(' ').forEach(function (t, k) { if (words[k] && words[k].length >= 2) rawOf[t] = words[k]; });
    this.variants(sq).forEach(function (v, vi) {
      var tk = v.split(' '), acc = null;
      for (var k = 0; k < tk.length; k++) {
        var raw = rawOf[tk[k]] || null;
        var alts = (opts.prefix && k === tk.length - 1) ? self.prefixAlts(tk[k]) : [{ w: tk[k], f: 1 }];
        if (opts.prefix && k === tk.length - 1 && !self.vocab.has(tk[k])) alts.push({ w: self.correct(tk[k]), f: 0.8 });
        // sinonimele nu se cauta in descrieri (doar cuvintele scrise de client)
        var ts = self.termScores(alts, process_syn && vi > 0 && sqTok.indexOf(' ' + tk[k] + ' ') < 0);
        var ta = raw != null ? self.taScores(raw) : null;
        if (ta) ta.forEach(function (sc, d) { if ((ts.get(d) || 0) < sc) ts.set(d, sc); });
        if (!acc) acc = ts;
        else { var nx = new Map(); acc.forEach(function (s, d) { var t = ts.get(d); if (t) nx.set(d, s + t); }); acc = nx; }
        if (!acc.size) break;
      }
      if (acc) acc.forEach(function (s, d) { if ((best.get(d) || 0) < s) best.set(d, s); });
    });
    var P = this.P, oos = this.oos, arr = [], pw = this.cfg.popWeight || 0;
    best.forEach(function (s, i) {
      if (pw) s *= 1 + pw * Math.log(1 + (P[i].pop || 0));
      arr.push([i, P[i].a ? s : s * oos]);
    });
    arr.sort(function (a, b) { return b[1] - a[1] || a[0] - b[0]; });
    var ids = arr.map(function (x) { return x[0]; });
    var pin = this.pins.find(function (p) { return p.term === sq; });
    if (pin) {
      var pinned = pin.items.map(function (id) { return self.byId[id]; }).filter(function (i) { return i != null; });
      ids = pinned.concat(ids.filter(function (i) { return pinned.indexOf(i) < 0; }));
    }
    return { ids: ids, q: nq, sq: sq };
  };

  Engine.prototype.banner = function (q) {
    var padded = ' ' + norm(q) + ' ';
    for (var k = 0; k < this.banners.length; k++) {
      var b = this.banners[k];
      for (var t = 0; t < b.terms.length; t++) if (padded.indexOf(' ' + b.terms[t] + ' ') >= 0) return b.b;
    }
    return null;
  };

  Engine.prototype.facet = function (ids, F) {
    var P = this.P;
    function pass(p, skip) {
      if (skip !== 'brand' && F.brand.size && !F.brand.has(p.b)) return false;
      if (skip !== 'category' && F.category.size && !p._cats.some(function (c) { return F.category.has(c); })) return false;
      if (skip !== 'stock' && F.stock.size && !F.stock.has(String(p.a))) return false;
      if (skip !== 'price' && F.price && (p.p < F.price[0] || p.p > F.price[1] + 0.999)) return false;
      return true;
    }
    var out = { ids: [], brand: new Map(), category: new Map(), stock: new Map(), price: [Infinity, -Infinity] };
    for (var k = 0; k < ids.length; k++) {
      var p = P[ids[k]];
      if (pass(p)) out.ids.push(ids[k]);
      if (pass(p, 'brand') && p.b) out.brand.set(p.b, (out.brand.get(p.b) || 0) + 1);
      if (pass(p, 'category')) p._cats.forEach(function (c) { out.category.set(c, (out.category.get(c) || 0) + 1); });
      if (pass(p, 'stock')) out.stock.set(String(p.a), (out.stock.get(String(p.a)) || 0) + 1);
      if (pass(p, 'price')) { if (p.p < out.price[0]) out.price[0] = p.p; if (p.p > out.price[1]) out.price[1] = p.p; }
    }
    return out;
  };

  Engine.prototype.sort = function (ids, how) {
    var P = this.P, a = ids.slice();
    var coll = (typeof Intl !== 'undefined') ? new Intl.Collator('ro').compare : function (x, y) { return x < y ? -1 : x > y ? 1 : 0; };
    if (how === 1) a.sort(function (x, y) { return P[x].p - P[y].p; });
    else if (how === 2) a.sort(function (x, y) { return P[y].p - P[x].p; });
    else if (how === 3) a.sort(function (x, y) { return coll(P[x].t, P[y].t); });
    else if (how === 4) a.sort(function (x, y) { return coll(P[y].t, P[x].t); });
    return a;
  };

  Engine.norm = norm;
  root.OFSEngine = Engine;
  if (typeof module !== 'undefined') module.exports = Engine;
})(typeof window !== 'undefined' ? window : globalThis);
