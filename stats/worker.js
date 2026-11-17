// Cloudflare Worker "cautare-stats": colecteaza cautarile si click-urile din launcher
// si afiseaza statisticile (inlocuitor pentru Analytics din Doofinder).
// Binding necesar: D1 database ca `DB`. Panoul e la /d/<cheie>; cheia e generata automat la prima
// pornire si se citeste din D1: SELECT v FROM cfg WHERE k='dash'

const STORES = { so: 'suplimenteoriginale.ro', pv: 'provitamine.ro' };
const IDX = 'https://suplimenteoriginale-stack.github.io/cautare-launcher/';
const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS ev (ts INTEGER, day TEXT, s TEXT, t TEXT, q TEXT, n INTEGER, pid TEXT, pos INTEGER, sid TEXT)',
  'CREATE INDEX IF NOT EXISTS ev_sd ON ev (s, day)',
  'CREATE TABLE IF NOT EXISTS cfg (k TEXT PRIMARY KEY, v TEXT)',
];
let DASH_KEY = null;
let ready = false;
async function init(env) {
  if (ready) return;
  for (const q of SCHEMA) await env.DB.prepare(q).run();
  const row = await env.DB.prepare("SELECT v FROM cfg WHERE k='dash'").first();
  if (row) DASH_KEY = row.v;
  else {
    DASH_KEY = [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');
    await env.DB.prepare("INSERT OR IGNORE INTO cfg (k, v) VALUES ('dash', ?)").bind(DASH_KEY).run();
    DASH_KEY = (await env.DB.prepare("SELECT v FROM cfg WHERE k='dash'").first()).v;
  }
  ready = true;
}

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 80);
}
const json = (o, h = {}) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=600', ...h } });

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    await init(env);

    // 1) colectare evenimente (navigator.sendBeacon)
    if (url.pathname === '/e' && req.method === 'POST') {
      try {
        const b = JSON.parse(await req.text());
        const s = b.s, t = b.t, d = b.d || {};
        if (!STORES[s] || !['search', 'click'].includes(t)) return new Response('bad', { status: 400 });
        const q = norm(d.q);
        if (!q && t === 'search') return new Response('', { status: 204 });
        const now = Date.now(), day = new Date(now + 2 * 3600e3).toISOString().slice(0, 10);
        await env.DB.prepare('INSERT INTO ev (ts, day, s, t, q, n, pid, pos, sid) VALUES (?,?,?,?,?,?,?,?,?)')
          .bind(now, day, s, t, q, d.n == null ? null : +d.n, d.id ? String(d.id).slice(0, 40) : null, d.pos == null ? null : +d.pos, String(d.sid || '').slice(0, 20)).run();
        if (Math.random() < 0.002) ctx.waitUntil(env.DB.prepare('DELETE FROM ev WHERE ts < ?').bind(now - 400 * 864e5).run());
      } catch (e) { return new Response('err', { status: 400 }); }
      return new Response('', { status: 204, headers: { 'access-control-allow-origin': '*' } });
    }

    // 2) cautari populare (folosite de launcher la "Cautari populare")
    if (url.pathname === '/popular') {
      const s = STORES[url.searchParams.get('s')] ? url.searchParams.get('s') : 'so';
      const since = dayStr(30);
      const r = await env.DB.prepare(`SELECT q, COUNT(DISTINCT sid||'|'||q) c FROM ev WHERE s=? AND t='search' AND day>=? AND n>0 AND length(q)>1 GROUP BY q ORDER BY c DESC LIMIT 10`).bind(s, since).all();
      return json(r.results.map((x) => x.q));
    }

    // 3) stoc si preturi actualizate (sincronizate la 2-4 minute de cron)
    if (url.pathname === '/stock') {
      const st = url.searchParams.get('s') === 'pv' ? 'pv' : 'so';
      const cache = caches.default, key = new Request(url.origin + '/stock?s=' + st);
      let r = await cache.match(key);
      if (!r) {
        const row = await env.DB.prepare('SELECT v FROM cfg WHERE k=?').bind('stock_' + st).first();
        r = new Response(row ? row.v : '{}', { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=60' } });
        ctx.waitUntil(cache.put(key, r.clone()));
      }
      return r;
    }
    if (url.pathname === '/ratings') {
      const row = await env.DB.prepare("SELECT v FROM cfg WHERE k='ratings_so'").first();
      return new Response(row ? row.v : '{}', { headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=3600' } });
    }
    if (url.pathname === '/ratings/sync' && DASH_KEY && url.searchParams.get('k') === DASH_KEY) {
      return json(await syncReviewsSO(env), { 'cache-control': 'no-store' });
    }
    if (url.pathname === '/stock/full' && DASH_KEY && url.searchParams.get('k') === DASH_KEY) {
      await syncSO(env, true);
      const r = await env.DB.prepare("SELECT v FROM cfg WHERE k='sync_so'").first();
      return json({ status: r && r.v }, { 'cache-control': 'no-store' });
    }
    if (url.pathname === '/stock/status') {
      const r = await env.DB.prepare("SELECT k, v FROM cfg WHERE k LIKE 'sync_%'").all();
      return json(Object.fromEntries(r.results.map((x) => [x.k, x.v])), { 'cache-control': 'no-store' });
    }

    // 4) panou statistici
    const m = url.pathname.match(/^\/d\/([^/]+)\/?(api|sync|syncstatus)?$/);
    if (m && DASH_KEY && m[1] === DASH_KEY) {
      if (m[2] === 'api') return json(await stats(env, url), { 'cache-control': 'no-store' });
      if (m[2] === 'sync' && req.method === 'POST') return json(await forceSync(env, url.origin, url.searchParams.get('s') === 'pv' ? 'pv' : 'so'), { 'cache-control': 'no-store' });
      if (m[2] === 'syncstatus') return json(await stockSummary(env), { 'cache-control': 'no-store' });
      return new Response(DASH, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    return new Response('ok');
  },

  async scheduled(ev, env, ctx) {
    await init(env);
    const min = new Date(ev.scheduledTime).getUTCMinutes();
    const t0 = new Date(ev.scheduledTime);
    const jobs = [syncSO(env, t0.getUTCHours() === 1 && t0.getUTCMinutes() < 2)];
    if (min % 4 === 0) jobs.push(syncPV(env));
    const t = new Date(ev.scheduledTime);
    if (t.getUTCHours() === 2 && t.getUTCMinutes() < 2) jobs.push(syncReviewsSO(env));
    await Promise.allSettled(jobs);
  },
};

/* ---------- sincronizare stoc ---------- */
async function getMap(env, st) {
  const row = await env.DB.prepare('SELECT v FROM cfg WHERE k=?').bind('stock_' + st).first();
  try { return row ? JSON.parse(row.v) : {}; } catch (e) { return {}; }
}
async function putMap(env, st, map, info) {
  await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO cfg (k, v) VALUES (?, ?)').bind('stock_' + st, JSON.stringify(map)),
    env.DB.prepare('INSERT OR REPLACE INTO cfg (k, v) VALUES (?, ?)').bind('sync_' + st, new Date().toISOString() + ' ' + info),
  ]);
}
const r2 = (x) => Math.round(+x * 100) / 100;

// suplimenteoriginale.ro: API Gomag, doar produsele modificate azi (o comanda modifica si data produsului)
// full = tot catalogul (noaptea): reface si mesajele „Revine in stoc” ale produselor nemodificate azi
async function syncSO(env, full) {
  if (!env.GOMAG_API_KEY) return;
  try {
    // data in ora Romaniei, cu 30 de minute in urma (prinde si trecerea de la miezul noptii)
    const day = new Date(Date.now() + 2 * 3600e3 - 30 * 60e3).toISOString().slice(0, 10);
    const map = full ? {} : await getMap(env, 'so');
    let page = 1, pages = 1, n = 0;
    while (page <= pages && page <= 60) {
      const res = await fetch(`https://api.gomag.ro/api/v1/product/read/json?${full ? '' : 'updated=' + day + '&'}limit=100&page=${page}`, {
        headers: { Apikey: env.GOMAG_API_KEY, ApiShop: 'https://www.suplimenteoriginale.ro', 'User-Agent': 'Mozilla/5.0 (cautare-launcher)' },
      });
      if (!res.ok) throw new Error('gomag ' + res.status);
      const d = await res.json();
      pages = +d.pages || 1;
      for (const p of Object.values(d.products || {})) {
        if (!p.sku) continue;
        const price = r2(p.price), base = r2(p.base_price);
        const a = p.enabled === '0' ? 0 : (p.stock_status === 'instock' || (p.stockManagement === '0') ? 1 : 0);
        const e = [a, price, base > price ? base : 0];
        // mesajul din „Durata de livrare” (ex. „Revine în stoc pe 20.11.2026 (~4 zile)”), doar pentru produsele fara stoc
        const dt = String(p.delivery_time || '').replace(/<[^>]*>/g, '').trim();
        if (!a && dt && p.delivery_time_type !== 'days') e.push(dt.slice(0, 120));
        map[p.sku] = e;
        n++;
      }
      page++;
    }
    await putMap(env, 'so', map, (full ? 'complet ' : 'ok ') + n);
  } catch (e) {
    await env.DB.prepare('INSERT OR REPLACE INTO cfg (k, v) VALUES (?, ?)').bind('sync_so', new Date().toISOString() + ' eroare ' + e.message).run();
  }
}

// provitamine.ro: products.json public din Shopify (tot catalogul)
async function syncPV(env) {
  try {
    const map = {};
    let n = 0;
    for (let page = 1; page <= 20; page++) {
      let res;
      for (let t = 0; t < 3; t++) {
        res = await fetch(`https://provitamine.ro/products.json?limit=250&page=${page}`, { headers: { 'User-Agent': 'Mozilla/5.0 (cautare-launcher)' } });
        if (res.status !== 429) break;
        await new Promise((r) => setTimeout(r, 4000 * (t + 1)));
      }
      if (!res.ok) throw new Error('shopify ' + res.status);
      const ps = (await res.json()).products || [];
      if (!ps.length) break;
      await new Promise((r) => setTimeout(r, 400));
      for (const pr of ps) {
        const vs = pr.variants || [];
        if (!vs.length) continue;
        const v = vs.reduce((m, x) => (+x.price < +m.price ? x : m), vs[0]);
        const p = r2(v.price), cap = r2(v.compare_at_price || 0);
        map[String(pr.id)] = [vs.some((x) => x.available) ? 1 : 0, p, cap > p ? cap : 0];
        n++;
      }
    }
    // mesajele „Revine în stoc pe …” (metafield custom.eta_stoc), publicate de sablonul de tema collection.cautare-eta
    let ne = 0;
    try {
      for (let page = 1, pages = 1; page <= pages && page <= 20; page++) {
        const r = await fetch(`https://provitamine.ro/collections/all?view=cautare-eta&page=${page}`, { headers: { 'User-Agent': 'Mozilla/5.0 (cautare-launcher)' } });
        if (!r.ok) break;
        const d = JSON.parse(await r.text());
        pages = +d.n || 1;
        for (const id in d.e || {}) {
          const x = map[id];
          if (x && !x[0] && d.e[id]) { x.push(String(d.e[id]).slice(0, 120)); ne++; }
        }
      }
    } catch (e) {}
    if (n) await putMap(env, 'pv', map, 'ok ' + n + ', revin ' + ne);
  } catch (e) {
    await env.DB.prepare('INSERT OR REPLACE INTO cfg (k, v) VALUES (?, ?)').bind('sync_pv', new Date().toISOString() + ' eroare ' + e.message).run();
  }
}

function dayStr(back) { return new Date(Date.now() + 2 * 3600e3 - back * 864e5).toISOString().slice(0, 10); }

async function stats(env, url) {
  const s = STORES[url.searchParams.get('s')] ? url.searchParams.get('s') : 'so';
  const days = Math.min(400, Math.max(1, +url.searchParams.get('days') || 15));
  const from = dayStr(days - 1), pfrom = dayStr(2 * days - 1);
  const DB = env.DB;
  // o "cautare" = pereche unica (sesiune, termen); click = sesiunea a dat click dupa termenul respectiv
  const base = `WITH se AS (SELECT sid, q, MIN(day) day, MAX(n) n FROM ev WHERE s=?1 AND t='search' AND day>=?2 AND day<=?3 GROUP BY sid, q),
    cl AS (SELECT sid, q, COUNT(*) c, AVG(pos) p FROM ev WHERE s=?1 AND t='click' AND day>=?2 AND day<=?3 GROUP BY sid, q)`;
  const tot = (a, b) => DB.prepare(base + ` SELECT COUNT(*) searches, SUM(CASE WHEN cl.sid IS NOT NULL THEN 1 ELSE 0 END) clicked, SUM(CASE WHEN se.n=0 THEN 1 ELSE 0 END) zero, COUNT(DISTINCT se.sid) sessions, AVG(cl.p) pos FROM se LEFT JOIN cl ON cl.sid=se.sid AND cl.q=se.q`).bind(s, a, b).first();
  const [cur, prev, daily, terms, zero, prods] = await Promise.all([
    tot(from, dayStr(0)),
    tot(pfrom, dayStr(days)),
    DB.prepare(base + ` SELECT se.day, COUNT(*) searches, SUM(CASE WHEN cl.sid IS NOT NULL THEN 1 ELSE 0 END) clicked FROM se LEFT JOIN cl ON cl.sid=se.sid AND cl.q=se.q GROUP BY se.day ORDER BY se.day`).bind(s, from, dayStr(0)).all(),
    DB.prepare(base + ` SELECT se.q, COUNT(*) c, SUM(CASE WHEN cl.sid IS NOT NULL THEN 1 ELSE 0 END) k, AVG(cl.p) p, MAX(se.n) n FROM se LEFT JOIN cl ON cl.sid=se.sid AND cl.q=se.q GROUP BY se.q ORDER BY c DESC LIMIT 300`).bind(s, from, dayStr(0)).all(),
    DB.prepare(base + ` SELECT q, COUNT(*) c FROM se WHERE n=0 GROUP BY q ORDER BY c DESC LIMIT 200`).bind(s, from, dayStr(0)).all(),
    DB.prepare(`SELECT pid, COUNT(*) c, AVG(pos) p FROM ev WHERE s=? AND t='click' AND day>=? GROUP BY pid ORDER BY c DESC LIMIT 200`).bind(s, from).all(),
  ]);
  return { store: s, site: STORES[s], days, from, cur, prev, daily: daily.results, terms: terms.results, zero: zero.results, prods: prods.results, idx: IDX + s + '/index.json' };
}

const DASH = `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Statistici căutare</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#f5f6f7;color:#222}
header{background:#002F34;color:#fff;padding:16px 20px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
header h1{font-size:18px;margin:0 12px 0 0}
select,input{font:inherit;padding:6px 8px;border-radius:6px;border:1px solid #ccc}
main{padding:16px 20px;max-width:1300px;margin:auto}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin-bottom:16px}
.k{background:#fff;border-radius:10px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.k b{display:block;font-size:24px;margin:4px 0}.k small{color:#666}.up{color:#1a7f37}.dn{color:#c62828}
.card{background:#fff;border-radius:10px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.06);margin-bottom:16px;overflow:auto}
.card h2{font-size:15px;margin:0 0 10px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:800px){.grid{grid-template-columns:1fr}}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #eee}th{color:#666;font-weight:600;cursor:pointer;white-space:nowrap}td.n{text-align:right;font-variant-numeric:tabular-nums}
.bars{display:flex;align-items:flex-end;gap:3px;height:120px}.bars div{flex:1;background:#4FD1C5;min-height:1px;position:relative}.bars div:hover:after{content:attr(title);position:absolute;bottom:100%;left:50%;transform:translateX(-50%);background:#222;color:#fff;font-size:11px;padding:3px 6px;border-radius:4px;white-space:nowrap}
.flt{margin-bottom:8px}
.sync .muted{color:#666;font-size:13px;margin:0 0 10px}.syncrow{display:flex;align-items:center;gap:12px;margin:6px 0;flex-wrap:wrap}.syncrow button{background:#002F34;color:#fff;border:0;border-radius:8px;padding:8px 14px;font-size:14px;cursor:pointer;min-width:230px;text-align:left}.syncrow button:disabled{opacity:.6;cursor:wait}.syncrow span{font-size:13px;color:#444}.syncrow .ok{color:#1b8a77}.syncrow .err{color:#c62828}
#src{margin-left:auto;font-size:12px;color:rgba(255,255,255,.55);text-decoration:none;border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:4px 8px;white-space:nowrap}#src:hover{color:#fff;border-color:rgba(255,255,255,.6)}
</style></head><body>
<header><h1>Statistici căutare</h1>
<select id="s"><option value="so">suplimenteoriginale.ro</option><option value="pv">provitamine.ro</option></select>
<select id="d"><option value="1">Azi</option><option value="7">7 zile</option><option value="15" selected>15 zile</option><option value="30">30 zile</option><option value="90">90 zile</option><option value="365">365 zile</option></select>
<span id="st"></span><a id="src" href="https://suplimenteoriginale-stack.github.io/cautare-launcher/sursa-cautare.zip" download title="Arhiva cu sursa completă, din versiunea care rulează live (pentru o conversație nouă cu Claude)">⬇ Sursa</a></header>
<main><div class="card sync"><h2>Sincronizare forțată stoc</h2><p class="muted">Recitește acum stocul tuturor produselor. Produsele intrate în stoc pierd mesajul „Revine în stoc” și apar „În stoc”. Durează ~15 secunde pentru provitamine.ro și ~1–2 minute pentru suplimenteoriginale.ro; nu închide pagina până apare „Gata”.</p>
<div class="syncrow"><button type="button" data-s="so">⟳ suplimenteoriginale.ro</button><span id="sy_so"></span></div>
<div class="syncrow"><button type="button" data-s="pv">⟳ provitamine.ro</button><span id="sy_pv"></span></div></div>
<div class="kpis" id="kpis"></div>
<div class="card"><h2>Căutări pe zi</h2><div class="bars" id="bars"></div></div>
<div class="grid"><div class="card"><h2>Termeni căutați</h2><input class="flt" id="ft" placeholder="Filtrează..."><table id="terms"></table></div>
<div class="card"><h2>Produse cu click din căutare</h2><table id="prods"></table></div></div>
<div class="card"><h2>Căutări fără rezultat (de rezolvat cu sinonime)</h2><table id="zero"></table></div></main>
<script>
fetch('https://suplimenteoriginale-stack.github.io/cautare-launcher/build.json?'+Date.now()).then(r=>r.json()).then(b=>{const a=document.getElementById('src');a.textContent='⬇ Sursa ('+b.t+')';a.title+=' (commit '+b.sha+')'}).catch(()=>{});
const B=location.pathname.replace(/[/]+$/,'')+'/';
function syncInfo(x){return x.produse+' produse, '+x.faraStoc+' fără stoc ('+x.revin+' cu „Revine în stoc”) · ultima: '+String(x.ultima||'').replace('T',' ').slice(0,16)+' UTC'}
fetch(B+'syncstatus').then(r=>r.json()).then(d=>{['so','pv'].forEach(k=>{document.getElementById('sy_'+k).textContent=syncInfo(d[k])})}).catch(()=>{});
document.querySelectorAll('.syncrow button').forEach(b=>b.onclick=async()=>{const k=b.dataset.s,sp=document.getElementById('sy_'+k);b.disabled=true;sp.className='';sp.textContent='se sincronizează...';
 try{const r=await fetch(B+'sync?s='+k,{method:'POST'}).then(r=>r.json());sp.className=/eroare/.test(r.ultima)?'err':'ok';sp.textContent='Gata în '+r.secunde+' s · '+syncInfo(r)}catch(e){sp.className='err';sp.textContent='Eroare: '+e.message}b.disabled=false});
const $=id=>document.getElementById(id), pct=(a,b)=>b?(100*a/b).toFixed(1)+' %':'–', f=n=>(n||0).toLocaleString('ro-RO');
let D=null, names={};
function delta(c,p){if(!p)return'';const v=(c-p)/p*100;return '<small class="'+(v>=0?'up':'dn')+'">'+(v>=0?'+':'')+v.toFixed(1)+' % față de perioada anterioară</small>'}
function table(el,cols,rows){let sort=null,dir=-1;function draw(){let r=rows.slice();if(sort!=null)r.sort((a,b)=>{const x=cols[sort].v(a),y=cols[sort].v(b);return (x>y?1:x<y?-1:0)*dir});
el.innerHTML='<tr>'+cols.map((c,i)=>'<th data-i="'+i+'">'+c.h+'</th>').join('')+'</tr>'+r.map(x=>'<tr>'+cols.map(c=>'<td class="'+(c.n?'n':'')+'">'+c.f(x)+'</td>').join('')+'</tr>').join('');
el.querySelectorAll('th').forEach(th=>th.onclick=()=>{const i=+th.dataset.i;dir=sort===i?-dir:-1;sort=i;draw()})}draw()}
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
async function load(){$('st').textContent='se încarcă...';
 D=await fetch(B+'api?s='+$('s').value+'&days='+$('d').value).then(r=>r.json());
 if(!names[D.store]){try{const ix=await fetch(D.idx).then(r=>r.json());names[D.store]={};ix.forEach(p=>names[D.store][p.id]=p)}catch(e){names[D.store]={}}}
 const c=D.cur,p=D.prev;
 $('kpis').innerHTML=[['Căutări',f(c.searches),delta(c.searches,p.searches)],['CTR (căutări cu click)',pct(c.clicked,c.searches),'<small>anterior '+pct(p.clicked,p.searches)+'</small>'],['Sesiuni care caută',f(c.sessions),delta(c.sessions,p.sessions)],['Fără rezultat',pct(c.zero,c.searches),'<small>'+f(c.zero)+' căutări</small>'],['Poziția medie a click-ului',c.pos?(+c.pos+1).toFixed(1):'–','']].map(k=>'<div class="k"><small>'+k[0]+'</small><b>'+k[1]+'</b>'+k[2]+'</div>').join('');
 const mx=Math.max(1,...D.daily.map(x=>x.searches));$('bars').innerHTML=D.daily.map(x=>'<div style="height:'+(100*x.searches/mx)+'%" title="'+x.day+': '+x.searches+' căutări, CTR '+pct(x.clicked,x.searches)+'"></div>').join('');
 drawTerms();
 const N=names[D.store];
 table($('prods'),[{h:'Produs',f:x=>{const p=N[x.pid];return p?'<a href="'+esc(p.u)+'" target="_blank">'+esc(p.t)+'</a>':esc(x.pid)},v:x=>(N[x.pid]||{}).t||''},{h:'Click-uri',n:1,f:x=>f(x.c),v:x=>x.c},{h:'Poz. medie',n:1,f:x=>(x.p+1).toFixed(1),v:x=>x.p}],D.prods);
 table($('zero'),[{h:'Termen',f:x=>esc(x.q),v:x=>x.q},{h:'Căutări',n:1,f:x=>f(x.c),v:x=>x.c}],D.zero);
 $('st').textContent='de la '+D.from;}
function drawTerms(){const q=$('ft').value.toLowerCase();table($('terms'),[{h:'Termen',f:x=>esc(x.q),v:x=>x.q},{h:'Căutări',n:1,f:x=>f(x.c),v:x=>x.c},{h:'CTR',n:1,f:x=>pct(x.k,x.c),v:x=>x.k/x.c},{h:'Poz. click',n:1,f:x=>x.p==null?'–':(x.p+1).toFixed(1),v:x=>x.p||0},{h:'Rezultate',n:1,f:x=>f(x.n),v:x=>x.n}],D.terms.filter(x=>x.q.includes(q)))}
$('s').onchange=load;$('d').onchange=load;$('ft').oninput=drawTerms;load();
</script></body></html>`;

// suplimenteoriginale.ro: recenziile din Gomag -> media si numarul pe SKU (o data pe zi)
async function syncReviewsSO(env) {
  if (!env.GOMAG_API_KEY) return { err: 'fara cheie' };
  const H = { Apikey: env.GOMAG_API_KEY, ApiShop: 'https://www.suplimenteoriginale.ro', 'User-Agent': 'Mozilla/5.0 (cautare-launcher)' };
  const paths = ['product/review/read', 'review/read', 'product/reviews/read'];
  let base = null, tried = [];
  for (const p of paths) {
    const r = await fetch(`https://api.gomag.ro/api/v1/${p}/json?limit=1&page=1`, { headers: H });
    tried.push(p + ' ' + r.status);
    if (r.ok) { const d = await r.json().catch(() => null); if (d && !d.error) { base = p; break; } else tried.push(JSON.stringify(d).slice(0, 120)); }
  }
  if (!base) { await env.DB.prepare('INSERT OR REPLACE INTO cfg (k, v) VALUES (?, ?)').bind('sync_ratings', new Date().toISOString() + ' eroare ' + tried.join('; ')).run(); return { err: tried }; }
  const agg = {}; let n = 0;
  for (let page = 1; page <= 200; page++) {
    const r = await fetch(`https://api.gomag.ro/api/v1/${base}/json?limit=100&page=${page}`, { headers: H });
    if (!r.ok) break;
    const d = await r.json();
    const list = Object.values(d.reviews || d).filter((x) => x && typeof x === 'object' && x.rating && x.productSku);
    if (!list.length) break;
    for (const x of list) {
      if (x.parent && x.parent !== '0') continue; // raspunsuri, nu recenzii
      const k = String(x.productSku); const a = agg[k] || (agg[k] = [0, 0]);
      a[0] += +x.rating; a[1]++; n++;
    }
    if (list.length < 100) break;
  }
  const out = {};
  for (const k in agg) out[k] = { v: Math.round(agg[k][0] / agg[k][1] * 10) / 10, n: agg[k][1] };
  await env.DB.batch([
    env.DB.prepare('INSERT OR REPLACE INTO cfg (k, v) VALUES (?, ?)').bind('ratings_so', JSON.stringify(out)),
    env.DB.prepare('INSERT OR REPLACE INTO cfg (k, v) VALUES (?, ?)').bind('sync_ratings', new Date().toISOString() + ' ok ' + n + ' recenzii, ' + Object.keys(out).length + ' produse (' + base + ')'),
  ]);
  return { ok: n, produse: Object.keys(out).length, base };
}

/* ---------- sincronizare fortata (butoanele din panou) ---------- */
async function stockSummary(env) {
  const out = {};
  for (const st of ['so', 'pv']) {
    const map = await getMap(env, st);
    const v = Object.values(map);
    const row = await env.DB.prepare('SELECT v FROM cfg WHERE k=?').bind('sync_' + st).first();
    out[st] = { produse: v.length, faraStoc: v.filter((x) => !x[0]).length, revin: v.filter((x) => !x[0] && x[3]).length, ultima: row ? row.v : '' };
  }
  return out;
}
async function forceSync(env, origin, st) {
  const t = Date.now();
  if (st === 'so') await syncSO(env, true); else await syncPV(env);
  // golim copia din cache a stocului, ca launcher-ul sa ia imediat datele noi
  try { await caches.default.delete(new Request(origin + '/stock?s=' + st)); } catch (e) {}
  const sum = await stockSummary(env);
  return Object.assign({ magazin: st, secunde: Math.round((Date.now() - t) / 100) / 10 }, sum[st]);
}
