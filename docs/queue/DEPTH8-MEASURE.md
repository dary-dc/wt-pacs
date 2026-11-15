state: done
started: 2026-11-14T23:15Z
heartbeat: 2026-11-15T03:11Z
outputs: claude/depth8 at ddd3ec0e (PR 389, draft into claude/docs-client): rows lab/av1/depth8/rows/stage-{a,b,c}.jsonl,
  reports rows/report.md and report-c.md, results docs/av1/depth-cut-8.md §9, amendment §7 (before any run)
## Resume
Done. Amendment A1–A6 before any run (bc012920); measure.py, its tests (m1–m4 killed) and report.py; stages A, B, C
run and reported (aa6e8cd7, ddd3ec0e); codecs line §Open 7 updated. Nothing next for this row.
## Result
* Measured, §7 as amended: 249 cells (A 78 + 6 cut-only, B 18 at G 16, C 153) on all 19 DBT volumes.
* P1 (cut alone): 5/6 hit; dbts_b2 reads 5.8 % under r (1.056 vs 1.118). P2: 128/128 cut8 cells inside the
  removal–independent band; the closer model is the volume's (removal on 13 of 19, mostly). P3: 38/38 hit.
* P4: the 8-bit view costs 1.14–1.86x today's bytes at its highest Q under 1.00 (Q 3–6 at 12 bits, 5–11 at 10);
  12/14 hit, dbts_b2 (1.85) and dbts_b5 (1.71) just above their bands; the removal end (0.82–1.09) never occurred.
* P5: 4:2:0 grey adds +0.01–0.12 % bytes (2/12 hit: predicted +0.1–2 %, cheaper), e_N within 0.005, chroma 128.
* Stage B: G 16 keeps G 1's highest Q on 5 of 6; dbt12_ea1141 fails at 1.0007. m5: detected, wording missed on 8/19.
* Fixtures and limits: 19 DBT volumes of three systems (G 16 and 4:2:0 on six); libaom 3.15.1 cpu6 one thread,
  dav1d 1.5.4; one σ estimator; one 4-core cloud host, cores saturated, no time claimed; no GPU, browser or reader.
* Gate: lab tests, comment budget, links, lab absence green; full scripts/gate.sh not run (lab and docs only).
* Owner: whether an 8-bit view at 1.14–1.86x the bytes is worth a checked hardware path that exists only on desktop
  Chromium and is still unmeasured there.
