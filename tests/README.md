# Teste de relevanță

`doofinder_*_13nov.txt` = rezultatele Doofinder live (13.11.2026) pentru căutările cele mai frecvente: termen | nr. rezultate | primele 8 produse (id).

```
cd tests && node compare_relevance.js so doofinder_so_13nov.txt
cd tests && node compare_relevance.js pv doofinder_pv_13nov.txt
```
(necesită `dist/` construit local cu scripturile din `build/`). La 13.11: SO 83% suprapunere top 8, PV 81%; numărul de rezultate aproape identic.
