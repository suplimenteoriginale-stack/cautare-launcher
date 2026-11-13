const E=require('../src/engine.js'),fs=require('fs');
const ro=require('../src/vendor/ro-stemmer.min.js').newStemmer();
const st=process.argv[2], file=process.argv[3], D=`../dist/${st}/`;
const P=JSON.parse(fs.readFileSync(D+'index.json')), C=JSON.parse(fs.readFileSync(D+'config.json'));
let t=Date.now(); const e=new E(P,C,JSON.parse(fs.readFileSync(D+'search.json')),ro); const t1=Date.now()-t; t=Date.now();
if(!process.env.NODESC) e.addDesc(JSON.parse(fs.readFileSync(D+'desc.json'))); console.log('build',t1,'ms; desc',Date.now()-t,'ms');
const T=id=>{const i=st==="pv"?P.findIndex(p=>p.id.endsWith(id)):e.byId[id]; return (i==null||i<0)?'?'+id:(P[i].a?'':'(x)')+P[i].t.slice(0,30)};
let s8=0,s1=0,k=0,ms=0;
for(const line of fs.readFileSync(file,'utf8').trim().split('\n')){
 const [q,n,ids]=line.split('|'); const d=ids?ids.split(',').filter(x=>x!=='?'):[]; t=Date.now(); const r=e.search(q); ms=Math.max(ms,Date.now()-t); const o=r.ids.slice(0,8).map(i=>st==="pv"?P[i].id.slice(-6):P[i].id);
 const ov=d.slice(0,8).filter(x=>o.includes(x)).length, den=Math.min(8,d.length);
 if(den){s8+=ov/den;k++; if(d[0]===o[0])s1++;}
 console.log(`${q.padEnd(21)} DF ${n.padStart(4)} NOI ${String(r.ids.length).padStart(4)}  top8 ${ov}/${den} ${d[0]===o[0]?'1=':'1≠'}`);
 if(process.env.V&&ov<6){console.log('  DF :',d.slice(0,4).map(T).join(' | '));console.log('  NOI:',o.slice(0,4).map(T).join(' | '));}
}
console.log(`MEDIE top8: ${(100*s8/k).toFixed(0)}%   primul identic: ${s1}/${k}   max ${ms}ms/cautare`);
