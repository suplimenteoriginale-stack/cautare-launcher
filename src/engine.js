/* Motor de cautare client-side. Functioneaza si in browser si in Node (pentru teste). */
(function (root) {
  'use strict';

  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim();
  }
  function toks(s) { var n = norm(s); return n ? n.split(' ') : []; }

  // Levenshtein marginit (Damerau simplificat pentru transpozitii)
  function dist(a, b, max) {
    var la = a.length, lb = b.length;
    if (Math.abs(la - lb) > max) return max + 1;
    var prev2 = null, prev = new Array(lb + 1), cur;
    for (var j = 0; j <= lb; j++) prev[j] = j;
    for (var i = 1; i <= la; i++) {
      cur = new Array(lb + 1); cur[0] = i; var rowMin = i;
      for (j = 1; j <= lb; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        var v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (prev2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
        cur[j] = v; if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      prev2 = prev; prev = cur;
    }
    return prev[lb];
  }

  var FIELDS = [['t', 10], ['b', 8], ['c', 4], ['d', 1]];

  function Engine(products, cfg) {
    this.P = products;
    this.cfg = cfg || {};
    this.oos = this.cfg.outOfStockBoost == null ? 0.01 : this.cfg.outOfStockBoost;
    var post = new Map();
    var hideCat = new RegExp(this.cfg.hideCategories || '^$', 'i');
    this.nt = new Array(products.length);
    this.byId = {};
    for (var i = 0; i < products.length; i++) {
      var p = products[i];
      this.byId[p.id] = i;
      this.nt[i] = ' ' + norm(p.t) + ' ';
      p._cats = [];
      (p.c || []).forEach(function (c) { if (p._cats.indexOf(c) < 0 && !hideCat.test(c)) p._cats.push(c); });
      for (var f = 0; f < FIELDS.length; f++) {
        var val = FIELDS[f][0] === 'c' ? (p.c || []).join(' ') : p[FIELDS[f][0]];
        var w = FIELDS[f][1];
        var tk = toks(val);
        for (var k = 0; k < tk.length; k++) {
          var t = tk[k];
          var m = post.get(t); if (!m) { m = new Map(); post.set(t, m); }
          if ((m.get(i) || 0) < w) m.set(i, w);
        }
      }
    }
    this.post = post;
    this.vocab = Array.from(post.keys()).sort();
    var syn = (this.cfg.synonyms || []).map(function (g) { return g.map(norm).filter(Boolean); });
    this.syn = syn;
    this.pins = (this.cfg.pinned || []).map(function (x) { return { term: norm(x.term), items: x.items }; });
    this.banners = (this.cfg.banners || []).map(function (b) {
      return { b: b, terms: b.terms.map(norm).filter(Boolean) };
    });
  }

  // potriviri pentru un singur termen din cautare -> Map(produs -> scor)
  Engine.prototype.termMatches = function (qt, isLast) {
    var self = this, res = new Map();
    function add(tok, mult) {
      var m = self.post.get(tok); if (!m) return;
      m.forEach(function (w, i) { var s = w * mult; if ((res.get(i) || 0) < s) res.set(i, s); });
    }
    add(qt, 1);
    var numeric = /^\d+$/.test(qt);
    // prefix
    if (qt.length >= 2) {
      var lo = 0, hi = this.vocab.length;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (this.vocab[mid] < qt) lo = mid + 1; else hi = mid; }
      for (var j = lo; j < this.vocab.length && this.vocab[j].lastIndexOf(qt, 0) === 0; j++) {
        if (this.vocab[j] !== qt) add(this.vocab[j], isLast ? 0.9 : 0.75);
      }
    }
    // greseli de scriere
    if (!numeric && qt.length >= 4) {
      var max = qt.length >= 8 ? 2 : 1;
      for (var v = 0; v < this.vocab.length; v++) {
        var tok = this.vocab[v];
        if (tok === qt || /^\d/.test(tok)) continue;
        if (Math.abs(tok.length - qt.length) > max && !(isLast && tok.length > qt.length)) continue;
        var d = dist(qt, tok, max);
        if (d <= max) { add(tok, d === 1 ? 0.6 : 0.4); continue; }
        // prefix aproximativ pentru ultimul cuvant (utilizatorul inca scrie)
        if (isLast && tok.length > qt.length && dist(qt, tok.slice(0, qt.length), 1) <= 1) add(tok, 0.5);
      }
    }
    return res;
  };

  Engine.prototype.variants = function (nq) {
    var out = [{ q: nq, f: 1 }], seen = {}; seen[nq] = 1;
    var padded = ' ' + nq + ' ';
    this.syn.forEach(function (g) {
      g.forEach(function (m) {
        if (padded.indexOf(' ' + m + ' ') < 0) return;
        g.forEach(function (alt) {
          if (alt === m) return;
          var v = (' ' + nq + ' ').replace(' ' + m + ' ', ' ' + alt + ' ').trim();
          if (!seen[v] && out.length < 12) { seen[v] = 1; out.push({ q: v, f: 0.95 }); }
        });
      });
    });
    return out;
  };

  Engine.prototype.scoreVariant = function (vq, mode) {
    var tk = vq.split(' ').filter(Boolean), n = tk.length;
    var per = tk.map(function (t, k) { return this.termMatches(t, k === n - 1); }, this);
    var scores = new Map(), cnt = new Map();
    per.forEach(function (m) {
      m.forEach(function (s, i) { scores.set(i, (scores.get(i) || 0) + s); cnt.set(i, (cnt.get(i) || 0) + 1); });
    });
    var need = mode === 'and' ? n : Math.max(1, Math.ceil(n / 2));
    var out = new Map(), padded = ' ' + vq + ' ';
    var self = this;
    scores.forEach(function (s, i) {
      var c = cnt.get(i);
      if (c < need) return;
      if (mode !== 'and') s = s * c / n;
      if (n > 1 && self.nt[i].indexOf(padded) >= 0) s += 15;
      if (self.nt[i].lastIndexOf(' ' + vq, 0) === 0) s += 5;
      out.set(i, s);
    });
    return out;
  };

  // cautarea propriu-zisa: intoarce lista de indici sortata dupa relevanta
  Engine.prototype.search = function (q) {
    var nq = norm(q);
    if (!nq) return { ids: [], q: nq };
    var vars = this.variants(nq), self = this, best = new Map(), mode = 'and';
    function run(m) {
      vars.forEach(function (v) {
        self.scoreVariant(v.q, m).forEach(function (s, i) { s *= v.f; if ((best.get(i) || 0) < s) best.set(i, s); });
      });
    }
    run('and');
    if (!best.size) { mode = 'or'; run('or'); }
    var P = this.P, oos = this.oos;
    var arr = [];
    best.forEach(function (s, i) { arr.push([i, P[i].a ? s : s * oos]); });
    arr.sort(function (a, b) { return b[1] - a[1] || a[0] - b[0]; });
    var ids = arr.map(function (x) { return x[0]; });
    // rezultate fixate (custom results)
    var pin = this.pins.find(function (p) { return p.term === nq; });
    if (pin) {
      var pinned = pin.items.map(function (id) { return self.byId[id]; }).filter(function (i) { return i != null; });
      ids = pinned.concat(ids.filter(function (i) { return pinned.indexOf(i) < 0; }));
    }
    return { ids: ids, q: nq, mode: mode };
  };

  Engine.prototype.banner = function (q) {
    var padded = ' ' + norm(q) + ' ';
    for (var k = 0; k < this.banners.length; k++) {
      var b = this.banners[k];
      for (var t = 0; t < b.terms.length; t++) if (padded.indexOf(' ' + b.terms[t] + ' ') >= 0) return b.b;
    }
    return null;
  };

  // filtrare + fatete (disjunctive: fiecare fateta ignora propriul filtru)
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
