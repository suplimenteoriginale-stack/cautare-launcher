/* Launcher de cautare fullscreen (inlocuitor Doofinder). */
(function () {
  'use strict';
  if (window.__OFS_LOADED) return; window.__OFS_LOADED = 1;

  var SCRIPT = document.currentScript || document.querySelector('script[data-ofs-store]');
  var BASE = (SCRIPT.getAttribute('data-ofs-base') || SCRIPT.src.replace(/[^/]*$/, ''));
  var STORE = SCRIPT.getAttribute('data-ofs-store') || 'so';
  var CSS = '__CSS__';
  var Engine = window.OFSEngine, norm = Engine.norm;

  var CFG = null, P = null, E = null, loading = null;
  var V = '?v=' + Math.floor(Date.now() / 36e5); // reimprospatare din ora in ora (indexul se reface la 3 ore)
  var LS = 'ofs_recent_' + STORE;
  var st = { q: '', mode: 'initial', F: newF(), sort: 0, shown: 20, ids: [], skipGuided: false, collapsed: {}, more: {}, fsearch: {} };
  var root, el = {}, origInput = null, histPushed = false, debTimer = null;

  function newF() { return { brand: new Set(), category: new Set(), stock: new Set(), price: null }; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function L(k) { return CFG.labels[k]; }
  function money(n) { return n.toLocaleString('ro-RO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ' + CFG.currency; }

  var IC = {
    search: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21" stroke-linecap="round"/></svg>',
    small: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2.4"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5 21 21" stroke-linecap="round"/></svg>',
    mic: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke-linecap="round"/></svg>',
    close: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M5 5l14 14M19 5 5 19" stroke-linecap="round"/></svg>',
    left: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M15 5l-7 7 7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    right: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M9 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    up: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 15l7-7 7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    down: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 9l7 7 7-7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    top: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M12 19V5M5 12l7-7 7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  /* ---------- incarcare date ---------- */
  function load() {
    if (loading) return loading;
    var j = function (f) { return fetch(BASE + STORE + '/' + f + V).then(function (r) { return r.json(); }); };
    loading = Promise.all([j('config.json'), j('index.json'), j('search.json')]).then(function (res) {
      CFG = res[0]; P = res[1]; E = new Engine(P, CFG, res[2], window.OFSStemmer);
      popularFromStats();
      // descrierile (pentru potriviri ca in Doofinder) se incarca in fundal
      j('desc.json').then(function (d) { E.addDesc(d); if (isOpen() && st.q) render(true); }).catch(function () {});
      return true;
    });
    return loading;
  }

  /* ---------- DOM ---------- */
  function build() {
    if (root) return;
    var t = CFG.theme;
    var style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
    root = document.createElement('div');
    root.className = 'ofs-root ofs-' + STORE + (t.brandCase === 'upper' ? ' ofs-upper' : '') + (t.cardSep ? ' ofs-sep' : '');
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
    var vars = { header: t.header, accent: t.accent, link: t.link, rail: t.rail || t.accent, 'badge-r': t.badgeRadius || '6px', 'badge-w': t.badgeWeight || '700', 'brand-c': t.brandColor || '#8a8a8a', 'brand-s': t.brandSize || '11px', 'title-s': t.titleSize || '14px', 'title-w': t.titleWeight || '400', 'sale-s': t.saleSize || '17px', 'old-s': t.oldSize || '12px', 'old-c': t.oldColor || '#8a8a8a', strong: t.linkStrong || t.header, text: t.text, font: t.font, 'badge-bg': t.badgeBg, 'badge-fg': t.badgeFg, 'card-radius': t.cardRadius, 'card-border': t.cardBorder };
    Object.keys(vars).forEach(function (k) { root.style.setProperty('--ofs-' + k, vars[k]); });
    var logo = CFG.logo ? '<img class="ofs-logo" src="' + esc(CFG.logo) + '" alt="">' : '<div class="ofs-logotext">' + esc(CFG.logoText || '') + '</div>';
    var mic = ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) ? '<button type="button" class="ofs-mic" aria-label="Căutare vocală">' + IC.mic + '</button>' : '';
    root.innerHTML =
      '<div class="ofs-backdrop"></div><div class="ofs-layer">' +
      '<div class="ofs-header"><div class="ofs-hrow">' + logo +
      '<form class="ofs-box" role="search" autocomplete="off">' + IC.search +
      '<input class="ofs-input" type="search" enterkeyhint="search" placeholder="' + esc(L('placeholder')) + '" aria-label="' + esc(L('search')) + '">' + mic + '</form>' +
      '<button type="button" class="ofs-close" aria-label="Închide">' + IC.close + '</button></div>' +
      '<div class="ofs-chips"></div></div>' +
      '<div class="ofs-body"><div class="ofs-content"></div><div class="ofs-foot"></div></div>' +
      '<button type="button" class="ofs-top" aria-label="Sus">' + IC.top + '</button></div>';
    document.body.appendChild(root);
    el.layer = root.querySelector('.ofs-layer'); el.input = root.querySelector('.ofs-input');
    el.form = root.querySelector('.ofs-box'); el.chips = root.querySelector('.ofs-chips');
    el.body = root.querySelector('.ofs-body'); el.content = root.querySelector('.ofs-content'); el.top = root.querySelector('.ofs-top');
    var logoEl = root.querySelector('.ofs-logo,.ofs-logotext');
    function indent() { var r1 = el.form.getBoundingClientRect(), r0 = root.querySelector('.ofs-hrow').getBoundingClientRect(); root.style.setProperty('--ofs-chip-indent', Math.max(0, r1.left - r0.left) + 'px'); }
    setTimeout(indent, 0); window.addEventListener('resize', indent);
    if (logoEl && logoEl.tagName === 'IMG') logoEl.addEventListener('load', indent);

    el.input.addEventListener('input', function () {
      clearTimeout(debTimer);
      debTimer = setTimeout(function () { st.q = el.input.value; st.mode = st.q.trim() ? 'suggest' : 'initial'; st.F = newF(); render(); }, 70);
    });
    el.form.addEventListener('submit', function (e) { e.preventDefault(); submit(el.input.value); });
    root.querySelector('.ofs-close').addEventListener('click', function () { close(); });
    root.querySelector('.ofs-backdrop').addEventListener('click', function () { close(); });
    el.top.addEventListener('click', function () { el.body.scrollTo({ top: 0, behavior: 'smooth' }); });
    el.body.addEventListener('scroll', onScroll);
    var micBtn = root.querySelector('.ofs-mic'); if (micBtn) micBtn.addEventListener('click', voice);
    root.addEventListener('click', onClick);
    root.addEventListener('input', onFacetInput);
    root.addEventListener('change', onFacetChange);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && isOpen()) close(); });
  }

  /* ---------- deschidere / inchidere ---------- */
  function isOpen() { return root && root.classList.contains('ofs-open'); }
  function open(q, opts) {
    opts = opts || {};
    load().then(function () {
      build();
      if (!isOpen()) {
        root.classList.add('ofs-open');
        document.documentElement.style.overflow = 'hidden';
        if (!opts.fromHash) { try { history.pushState({ ofs: 1 }, '', hashFor(q || '', opts.mode)); histPushed = true; } catch (e) {} }
      }
      el.input.value = q || '';
      st.q = q || ''; st.F = newF(); st.sort = 0; st.skipGuided = false;
      st.mode = opts.mode === 'results' && st.q.trim() ? 'results' : (st.q.trim() ? 'suggest' : 'initial');
      if (st.mode === 'results') addRecent(st.q);
      render();
      setTimeout(function () { el.input.focus(); var n = el.input.value.length; try { el.input.setSelectionRange(n, n); } catch (e) {} }, 30);
    });
  }
  function close(fromPop) {
    if (!isOpen()) return;
    root.classList.remove('ofs-open');
    document.documentElement.style.overflow = '';
    if (!fromPop && histPushed) { histPushed = false; try { history.back(); } catch (e) {} }
    else if (!fromPop) { try { history.replaceState(null, '', location.pathname + location.search); } catch (e) {} }
    if (origInput) { try { if (st.q) origInput.value = st.q; origInput.blur(); } catch (e) {} }
  }
  function hashFor(q, mode) { return '#/cauta/' + (mode === 'results' ? 'r' : 's') + '/' + encodeURIComponent(q || ''); }
  function syncHash() { if (!isOpen()) return; try { history.replaceState(history.state, '', hashFor(st.q, st.mode)); } catch (e) {} }
  window.addEventListener('popstate', function () { if (isOpen() && !/^#\/cauta\//.test(location.hash)) { histPushed = false; close(true); } });

  function submit(q) {
    clearTimeout(debTimer);
    q = (q || '').trim(); if (!q) return;
    el.input.value = q; st.q = q; st.mode = 'results'; st.F = newF(); st.sort = 0; st.shown = 20; st.skipGuided = false; st.more = {}; st.fsearch = {};
    addRecent(q); render(); el.body.scrollTop = 0;
  }

  /* ---------- cautari recente ---------- */
  function recent() { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) { return []; } }
  function setRecent(a) { try { localStorage.setItem(LS, JSON.stringify(a.slice(0, 10))); } catch (e) {} }
  function addRecent(q) { q = q.trim(); if (!q) return; var a = recent().filter(function (x) { return norm(x) !== norm(q); }); a.unshift(q); setRecent(a); }

  function suggestions(q) {
    var nq = norm(q); if (!nq) return [];
    var pool = recent().concat(CFG.popular || []), out = [], seen = {};
    pool.forEach(function (s) { var n = norm(s); if (!seen[n] && n !== nq && n.indexOf(nq) === 0) { seen[n] = 1; out.push(s); } });
    return out.slice(0, 5);
  }

  /* ---------- randare ---------- */
  function render(keep) {
    var y = keep && el.body ? el.body.scrollTop : 0;
    var c = el.content;
    root.classList.toggle('ofs-res', st.mode === 'results');
    if (st.mode === 'initial') { renderChipsInitial(); c.innerHTML = renderInitial(); }
    else if (st.mode === 'suggest') { var r = E.search(st.q, { prefix: true }); st.ids = r.ids; renderChipsSuggest(L('suggestions')); c.innerHTML = renderSuggest(); logSearch(false); }
    else { var rr = E.search(st.q); st.ids = rr.ids; renderChipsSuggest(''); c.innerHTML = renderResults(); logSearch(true); }
    el.layer.classList.toggle('ofs-short', st.mode !== 'results' && window.innerWidth >= 768 && !(st.mode === 'suggest' && !st.ids.length));
    syncHash(); onScroll();
    if (keep) el.body.scrollTop = y;
  }

  function renderChipsInitial() {
    var a = recent();
    if (!a.length) { el.chips.innerHTML = ''; return; }
    el.chips.innerHTML = '<span class="ofs-chips-title">' + esc(L('recent')) + '</span>' +
      a.map(function (q) { return '<span class="ofs-chip"><button type="button" data-q="' + esc(q) + '">' + esc(q) + '</button><button type="button" class="ofs-x" data-rm="' + esc(q) + '" aria-label="Șterge">×</button></span>'; }).join('') +
      '<button type="button" class="ofs-clear" data-clear="1">' + esc(L('clearRecent')) + '</button>';
  }
  function renderChipsSuggest(title) {
    var s = suggestions(st.q);
    if (!s.length) { el.chips.innerHTML = ''; return; }
    el.chips.innerHTML = (title ? '<span class="ofs-chips-title">' + esc(title) + '</span>' : '') +
      s.map(function (q) { return '<span class="ofs-chip"><button type="button" data-q="' + esc(q) + '"><b>' + esc(q) + '</b></button><button type="button" class="ofs-x" data-hide="1" aria-label="Ascunde">×</button></span>'; }).join('');
  }

  function stars(v) { var f = Math.round(v); return '<span class="ofs-stars">' + '★★★★★'.slice(0, f) + '<span style="color:#D9D9D9">' + '★★★★★'.slice(f) + '</span></span>'; }
  function card(i) {
    var p = P[i], t = CFG.theme, disc = p.op > p.p ? Math.round((p.op - p.p) / p.op * 100) : 0;
    var h = '<a class="ofs-card' + (p.a ? '' : ' ofs-oos') + '" href="' + esc(p.u) + '" data-pid="' + esc(p.id) + '">' +
      '<div class="ofs-img">' + (disc > 0 ? '<span class="ofs-badge">' + esc(t.badgeFormat.replace('{n}', disc)) + '</span>' : '') +
      '<img loading="lazy" src="' + esc(p.img) + '" alt="' + esc(p.t) + '">' + (p.a ? '' : '<span class="ofs-oos-label">' + esc(L('outOfStock')) + '</span>') + '</div>' +
      '<div class="ofs-info"><div class="ofs-brand">' + esc(p.b) + '</div><div class="ofs-title">' + esc(p.t) + '</div>';
    if (t.ratings && p.rc) h += '<div class="ofs-rating">' + stars(p.r) + '<span>(' + p.rc + ')</span></div>';
    if (t.stockLabel) h += '<div class="ofs-stock' + (p.a ? '' : ' ofs-no') + '">● ' + esc(p.a ? L('inStock') : L('outOfStock')) + '</div>';
    h += '<div class="ofs-price"><span class="ofs-sale">' + money(p.p) + '</span>' + (p.op > p.p ? '<span class="ofs-old">' + money(p.op) + '</span>' : '') + '</div></div></a>';
    return h;
  }
  function carousel(inner, cls) {
    return '<div class="ofs-car ' + (cls || '') + '"><button type="button" class="ofs-arrow" data-car="-1" aria-label="Înapoi">' + IC.left + '</button>' +
      '<div class="ofs-track">' + inner + '</div><button type="button" class="ofs-arrow" data-car="1" aria-label="Înainte">' + IC.right + '</button></div>';
  }

  function renderInitial() {
    var rec = (CFG.recommended || []).map(function (id) { return E.byId[id]; }).filter(function (i) { return i != null; });
    return '<div class="ofs-wrap"><div class="ofs-aside"><div class="ofs-h">' + esc(L('popular')) + '</div><div class="ofs-list">' +
      (CFG.popular || []).map(function (q) { return '<button type="button" data-go="' + esc(q) + '">' + esc(q) + '</button>'; }).join('') +
      '</div></div><div class="ofs-main"><div class="ofs-h">' + esc(L('recommended')) + '</div>' + carousel(rec.map(card).join('')) + '</div></div>';
  }

  // ecranul "fara rezultate" (textul vine din configurare, ca in Doofinder)
  function noRes() {
    return '<div class="ofs-nores"><p class="ofs-nores-t">' + esc(L('noResultsTitle')) + '</p><p class="ofs-nores-s">' + L('noResultsText') + '</p></div>';
  }
  function topN(map, n) { return Array.from(map.entries()).sort(function (a, b) { return b[1] - a[1]; }).slice(0, n); }
  function renderSuggest() {
    if (!st.ids.length) return noRes();
    var f = E.facet(st.ids.slice(0, 200), newF());
    var cats = topN(f.category, 4), brands = topN(f.brand, 4);
    return '<div class="ofs-wrap ofs-sug"><div class="ofs-aside">' +
      (cats.length ? '<div class="ofs-h">' + esc(L('categories')) + '</div><div class="ofs-list" style="margin-bottom:22px">' + cats.map(function (c) { return '<button type="button" data-gocat="' + esc(c[0]) + '">' + esc(c[0]) + '</button>'; }).join('') + '</div>' : '') +
      (brands.length ? '<div class="ofs-h">' + esc(L('brands')) + '</div><div class="ofs-list">' + brands.map(function (b) { return '<button type="button" data-gobrand="' + esc(b[0]) + '">' + esc(b[0]) + '</button>'; }).join('') + '</div>' : '') +
      '</div><div class="ofs-main"><div class="ofs-mh"><div class="ofs-h">' + esc(L('products')) + '</div><button type="button" class="ofs-seeall" data-all="1">' + esc(L('seeAll')) + '</button></div>' +
      carousel(st.ids.slice(0, 28).map(card).join('')) + '</div></div>';
  }

  function renderResults() {
    var f = E.facet(st.ids, st.F), ids = st.sort ? E.sort(f.ids, st.sort) : f.ids;
    st.view = ids;
    var h = '';
    // filtru ghidat ca in Doofinder: pe rand Brand -> Categorie -> Stoc (pana alegi sau sari)
    if (!st.skipGuided) {
      var gk = null, gvals = null;
      ['brand', 'category', 'stock'].some(function (k) {
        if (st.F[k].size || CFG.facets.indexOf(k) < 0) return false;
        var mp = f[k]; if (!mp || mp.size < 2) return false;
        gk = k; gvals = k === 'brand' ? Array.from(mp.entries()).sort(brandSort('brand')) : Array.from(mp.entries()).sort(function (a, b) { return b[1] - a[1]; });
        return true;
      });
      if (gk) {
        var gname = { brand: L('facetBrand'), category: L('facetCategory'), stock: L('facetStock') }[gk];
        var sv = L('stockValues');
        h += '<div class="ofs-guided"><div class="ofs-guided-t">' + L('guidedTitle').replace(/<b>.*<\/b>/, '<b>' + esc(gname) + '</b>') + '<button type="button" data-skipg="1">' + esc(L('guidedSkip')) + '</button></div>' +
          carousel(gvals.slice(0, 20).map(function (b) {
            var img = '';
            for (var k = 0; k < ids.length; k++) { var pp = P[ids[k]]; if (gk === 'brand' ? pp.b === b[0] : gk === 'category' ? pp._cats.indexOf(b[0]) >= 0 : String(pp.a) === b[0]) { img = pp.img; break; } }
            var label = gk === 'stock' ? sv[b[0]] : b[0];
            return '<button type="button" class="ofs-gcard" data-gkey="' + gk + '" data-gval="' + esc(b[0]) + '">' +
              '<img class="ofs-gthumb" loading="lazy" src="' + esc(img) + '" alt=""><span>' + esc(label) + '</span></button>';
          }).join('')) + '</div>';
      }
    }
    var anyF = st.F.brand.size || st.F.category.size || st.F.stock.size || st.F.price;
    h += '<div class="ofs-wrap"><div class="ofs-aside"><div class="ofs-afclose"><span>Filtre</span><button type="button" data-fclose="1">' + IC.close + '</button></div>' +
      (anyF ? '<button type="button" class="ofs-fclear" data-fclear="1">' + esc(L('clearFilters')) + '</button>' : '') + renderFacets(f) + '</div><div class="ofs-main">';
    var bn = E.banner(st.q);
    if (bn) {
      var mob = window.innerWidth < 768 && bn.mimg ? bn.mimg : bn.img;
      var bimg = '<img src="' + esc(BASE + 'assets/banners/' + mob) + '" alt="' + esc(bn.name) + '">';
      h += bn.link ? '<a class="ofs-banner" href="' + esc(bn.link) + '">' + bimg + '</a>' : '<div class="ofs-banner">' + bimg + '</div>';
    }
    if (!st.ids.length) return noRes();
    if (!ids.length) {
      h += '<div class="ofs-empty">' + esc(L('noResults')) + ' „' + esc(st.q) + '”</div>';
    } else {
      var so = L('sort');
      h += '<div class="ofs-rhead"><div><b>' + ids.length + '</b> ' + esc(L('found')) + '</div>' +
        '<button type="button" class="ofs-fbtn" data-fopen="1">Filtre</button>' +
        '<div class="ofs-sortwrap"><button type="button" class="ofs-sortbtn" data-sortopen="1">' + esc(L('sortBy')) + ' ' + esc(so[st.sort]) + ' ' + IC.down + '</button>' +
        '<div class="ofs-sortmenu">' + so.map(function (s, k) { return '<button type="button" data-sort="' + k + '" class="' + (k === st.sort ? 'ofs-on' : '') + '">' + esc(s) + '</button>'; }).join('') + '</div></div></div>' +
        '<div class="ofs-grid">' + ids.slice(0, st.shown).map(card).join('') + '</div><div class="ofs-more"></div>';
    }
    return h + '</div></div>';
  }

  // ordinea brandurilor ca in Doofinder: intai cele cu logo (in ordinea din configurare), apoi dupa numar
  function brandSort(key) {
    var order = (key === 'brand' && CFG.brandLogos && CFG.logos) ? Object.keys(CFG.logos) : [];
    return function (a, b) {
      var ia = order.indexOf(a[0]), ib = order.indexOf(b[0]);
      if (ia >= 0 || ib >= 0) return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib);
      return b[1] - a[1];
    };
  }
  function facetBlock(key, title, body) {
    return '<div class="ofs-facet' + (st.collapsed[key] ? ' ofs-col' : '') + '"><button type="button" class="ofs-fh" data-fcol="' + key + '">' + esc(title) + IC.up + '</button><div class="ofs-fb">' + body + '</div></div>';
  }
  function termsFacet(key, title, map, logos) {
    if (!map.size) return '';
    var sel = st.F[key], all = Array.from(map.entries()).sort(brandSort(key));
    var fq = norm(st.fsearch[key] || '');
    var list = fq ? all.filter(function (x) { return norm(x[0]).indexOf(fq) >= 0; }) : all;
    var lim = st.more[key] ? list.length : 5;
    var body = '<div class="ofs-fsearch">' + IC.small + '<input type="text" data-fs="' + key + '" placeholder="' + esc(L('search')) + '" value="' + esc(st.fsearch[key] || '') + '"></div>' +
      list.slice(0, lim).map(function (x) {
        var on = sel.has(x[0]), logo = logos && CFG.logos && CFG.logos[x[0]];
        return '<button type="button" class="ofs-term' + (on ? ' ofs-on' : '') + (logo ? ' ofs-vis' : '') + '" data-f="' + key + '" data-v="' + esc(x[0]) + '">' +
          (logo ? '<img class="ofs-vlogo" src="' + esc(BASE + 'assets/' + logo) + '" alt="">' : '<span class="ofs-cb"></span>') +
          '<span>' + esc(x[0]) + '</span><span class="ofs-n">' + x[1] + '</span></button>';
      }).join('');
    if (list.length > 5) body += '<div class="ofs-fmore"><span class="ofs-cnt">' + Math.min(lim, list.length) + ' ' + esc(L('of')) + ' ' + list.length + '</span><button type="button" data-fmore="' + key + '">' + esc(st.more[key] ? L('seeLess') : L('seeMore')) + ' ' + IC.down + '</button></div>';
    return facetBlock(key, title, body);
  }
  function priceFacet(f) {
    if (!isFinite(f.price[0])) return '';
    var lo = Math.floor(f.price[0]), hi = Math.ceil(f.price[1]);
    if (hi <= lo) return '';
    var cur = st.F.price || [lo, hi];
    var body = '<div class="ofs-range"><div class="ofs-rail"></div>' +
      '<input type="range" data-pr="0" min="' + lo + '" max="' + hi + '" value="' + Math.max(lo, cur[0]) + '">' +
      '<input type="range" data-pr="1" min="' + lo + '" max="' + hi + '" value="' + Math.min(hi, cur[1]) + '"></div>' +
      '<div class="ofs-pbox"><label><input type="number" data-pn="0" value="' + Math.max(lo, cur[0]) + '">' + esc(CFG.currency) + '</label>' +
      '<label><input type="number" data-pn="1" value="' + Math.min(hi, cur[1]) + '">' + esc(CFG.currency) + '</label></div>';
    return facetBlock('price', L('facetPrice'), body);
  }
  function stockFacet(f) {
    if (!f.stock.size) return '';
    var sv = L('stockValues');
    var body = Array.from(f.stock.entries()).sort(function (a, b) { return b[1] - a[1]; }).map(function (x) {
      return '<button type="button" class="ofs-term' + (st.F.stock.has(x[0]) ? ' ofs-on' : '') + '" data-f="stock" data-v="' + x[0] + '"><span class="ofs-cb"></span><span>' + esc(sv[x[0]]) + '</span><span class="ofs-n">' + x[1] + '</span></button>';
    }).join('');
    return facetBlock('stock', L('facetStock'), body);
  }
  function renderFacets(f) {
    return CFG.facets.map(function (k) {
      if (k === 'brand') return termsFacet('brand', L('facetBrand'), f.brand, CFG.brandLogos);
      if (k === 'category') return termsFacet('category', L('facetCategory'), f.category, false);
      if (k === 'price') return priceFacet(f);
      if (k === 'stock') return stockFacet(f);
      return '';
    }).join('');
  }

  /* ---------- evenimente ---------- */
  function rerenderResults(keepScroll) {
    var y = el.body.scrollTop; st.shown = 20; render(); if (keepScroll) el.body.scrollTop = y;
    var a = root.querySelector('.ofs-aside'); if (st._asideOpen && a) a.classList.add('ofs-show');
  }
  function onClick(e) {
    var b = e.target.closest('button,a'); if (!b || !root.contains(b)) return;
    var d = b.dataset;
    if (d.q != null) { submit(d.q); return; }
    if (d.go != null) { clearTimeout(debTimer); el.input.value = d.go; st.q = d.go; st.mode = 'suggest'; st.F = newF(); render(); el.input.focus(); return; }
    if (d.rm != null) { setRecent(recent().filter(function (x) { return x !== d.rm; })); renderChipsInitial(); return; }
    if (d.clear) { setRecent([]); renderChipsInitial(); return; }
    if (d.hide) { b.closest('.ofs-chip').remove(); return; }
    if (d.all) { submit(el.input.value); return; }
    if (d.gocat != null || d.gobrand != null) { submit(el.input.value); if (d.gocat != null) st.F.category.add(d.gocat); else st.F.brand.add(d.gobrand); rerenderResults(); return; }
    if (d.car) { var tr = b.parentNode.querySelector('.ofs-track'); tr.scrollBy({ left: (+d.car) * tr.clientWidth * 0.8, behavior: 'smooth' }); return; }
    if (d.skipg) { st.skipGuided = true; rerenderResults(); return; }
    if (d.gval != null) { st.F[d.gkey].add(d.gval); rerenderResults(); return; }
    if (d.fclear) { st.F = newF(); rerenderResults(); return; }
    if (d.f) { var s = st.F[d.f]; s.has(d.v) ? s.delete(d.v) : s.add(d.v); rerenderResults(true); return; }
    if (d.fcol) { st.collapsed[d.fcol] = !st.collapsed[d.fcol]; b.parentNode.classList.toggle('ofs-col'); return; }
    if (d.fmore) { st.more[d.fmore] = !st.more[d.fmore]; rerenderResults(true); return; }
    if (d.sortopen) { b.nextSibling.classList.toggle('ofs-show'); return; }
    if (d.sort != null) { st.sort = +d.sort; rerenderResults(); return; }
    if (d.fopen) { st._asideOpen = true; root.querySelector('.ofs-aside').classList.add('ofs-show'); return; }
    if (d.fclose) { st._asideOpen = false; root.querySelector('.ofs-aside').classList.remove('ofs-show'); return; }
    if (d.pid) {
      if (st.q && st.mode !== 'initial') {
        addRecent(st.q); logSearch(true);
        var list = st.mode === 'results' ? st.view : st.ids, pos = list ? list.indexOf(E.byId[d.pid]) : -1;
        track('click', { q: st.q, id: d.pid, pos: pos });
      }
    }
  }
  function onFacetInput(e) {
    var t = e.target;
    if (t.dataset.fs) {
      st.fsearch[t.dataset.fs] = t.value; var key = t.dataset.fs, pos = t.selectionStart;
      rerenderResults(true);
      var n = root.querySelector('[data-fs="' + key + '"]'); if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch (x) {} }
    } else if (t.dataset.pr) {
      var r = root.querySelectorAll('[data-pr]'), a = +r[0].value, b = +r[1].value;
      if (a > b) { if (t.dataset.pr === '0') r[0].value = a = b; else r[1].value = b = a; }
      var nb = root.querySelectorAll('[data-pn]'); nb[0].value = a; nb[1].value = b;
    }
  }
  function onFacetChange(e) {
    var t = e.target;
    if (t.dataset.pr || t.dataset.pn) {
      var sel = t.dataset.pr ? '[data-pr]' : '[data-pn]', r = root.querySelectorAll(sel);
      var a = +r[0].value, b = +r[1].value; if (a > b) { var x = a; a = b; b = x; }
      st.F.price = [a, b]; rerenderResults(true);
    }
  }
  function onScroll() {
    el.top.classList.toggle('ofs-show', st.mode === 'results' && el.body.scrollTop > 600);
    var g = root.querySelector('.ofs-guided'); if (g) g.classList.toggle('ofs-stuck', el.body.scrollTop > 40);
    if (st.mode !== 'results' || !st.view || st.shown >= st.view.length) return;
    var more = root.querySelector('.ofs-more');
    if (more && more.getBoundingClientRect().top < window.innerHeight + 600) {
      var grid = root.querySelector('.ofs-grid'), from = st.shown; st.shown += 20;
      grid.insertAdjacentHTML('beforeend', st.view.slice(from, st.shown).map(card).join(''));
    }
  }

  function voice() {
    var R = window.SpeechRecognition || window.webkitSpeechRecognition; if (!R) return;
    var rec = new R(), btn = root.querySelector('.ofs-mic'); rec.lang = 'ro-RO'; rec.interimResults = false;
    btn.classList.add('ofs-rec');
    rec.onresult = function (ev) { submit(ev.results[0][0].transcript); };
    rec.onend = function () { btn.classList.remove('ofs-rec'); };
    try { rec.start(); } catch (x) { btn.classList.remove('ofs-rec'); }
  }

  // statistici: trimite cautarile si click-urile catre worker-ul cautare-stats
  var SID = (function () { try { var k = 'ofs_sid', v = sessionStorage.getItem(k); if (!v) { v = Math.random().toString(36).slice(2, 12); sessionStorage.setItem(k, v); } return v; } catch (x) { return Math.random().toString(36).slice(2, 12); } })();
  var logged = {}, logTimer = null;
  function track(type, data) {
    var u = CFG && CFG.statsUrl; if (!u) return;
    data.sid = SID;
    var body = JSON.stringify({ s: STORE, t: type, d: data });
    try { if (!(navigator.sendBeacon && navigator.sendBeacon(u + '/e', body))) fetch(u + '/e', { method: 'POST', body: body, keepalive: true, mode: 'no-cors' }); } catch (x) {}
  }
  function logSearch(now) {
    clearTimeout(logTimer);
    var q = st.q, n = st.ids.length, k = norm(q);
    if (!k || k.length < 2 || logged[k]) return;
    var go = function () { if (norm(st.q) === k && !logged[k]) { logged[k] = 1; track('search', { q: q, n: n }); } };
    if (now) go(); else logTimer = setTimeout(go, 1500);
  }
  function popularFromStats() {
    if (!CFG.statsUrl) return;
    fetch(CFG.statsUrl + '/popular?s=' + STORE).then(function (r) { return r.json(); }).then(function (a) { if (a && a.length >= 5) { CFG.popular = a; if (isOpen() && st.mode === 'initial') render(); } }).catch(function () {});
  }

  /* ---------- legatura cu bara de cautare a site-ului ---------- */
  function trig(t) { return CFG ? CFG.trigger : SCRIPT.getAttribute('data-ofs-trigger'); }
  function matches(t) { var s = trig(); return s && t && t.matches && t.matches(s); }
  function hook(e) {
    if (!matches(e.target)) return;
    e.preventDefault(); if (e.stopPropagation) e.stopPropagation();
    origInput = e.target; var v = e.target.value || '';
    try { e.target.blur(); } catch (x) {}
    open(v, { mode: v.trim() ? 'results' : 'initial' });
  }
  function init() {
    load().then(function () {
      document.addEventListener('focusin', hook, true);
      document.addEventListener('click', hook, true);
      document.addEventListener('submit', function (e) {
        var inp = e.target.querySelector && e.target.querySelector(CFG.trigger);
        if (inp && !root?.contains(e.target)) { e.preventDefault(); open(inp.value, { mode: 'results' }); }
      }, true);
      var m = location.hash.match(/^#\/cauta\/([rs])\/(.*)$/);
      if (m) open(decodeURIComponent(m[2]), { mode: m[1] === 'r' ? 'results' : 'suggest', fromHash: true });
    });
  }
  window.OFS = { open: open, close: close };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
