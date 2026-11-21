state: done
started: 2026-11-21T08:16Z
heartbeat: 2026-11-21T08:19Z
outputs: `claude/htj2k-a1` at `4189ef47` (`docs/htj2k-tiles.md` §A1 review; `docs/lines/codecs.md` Open 7); PR 408
## Resume
Done. Next on this question: EXACT-LAYOUT-PAGE (not before 11-23 08:00; needs this row, now met).
## Result
* No blocker; no fix rows appended. A1's three readings stand as HTJ2K-A1-RUN wrote them.
* Every ratio recomputed from `rows/a1-run-1.jsonl` and `rows/a1-run-2.jsonl` by a separate script importing neither
  `a1.py` nor `summary.py`: all 36 medians (3 ratios × 12 cells) match to the third decimal, with n and ranges.
* Deciding cell `dbts_b1` `r5000` 4×: strips D+T3 ÷ D+T1 ×0.943 (pairs 0.9439, 0.9504, 0.9430, 0.9370), s 0.0142,
  bound ×0.963: Layout 1 stays proposed for D+T3. D+T1 ÷ D ≤ ×0.95 holds in no cell at all (lowest ×0.958).
* Registration: 288 visits, a balanced 4 × 4 Williams square (each order 18 times); readings pushed before the first
  rows; only `a1.py`, rows and docs changed since the reviewed build; R0 and the OQ digest hold; saturation test
  reproduces (×1.008–1.012 `r5000`, ×1.38–1.56 `r20000`).
* Minors written in §A1 review: m1 54 visits dropped, not 55 (one failed visit is also VOID); m2 round 2 is ×0.9504;
  m3 some non-deciding readings rest on 1–3 pairs.
* Docs-only: `scripts/check_links.py` 0 unresolved, comment budget ok; gate not run.
* Fixtures and limits: three EA1141 DBT volumes; one deciding cell of one volume, 4–5 paired rounds; 4-core cloud
  host, no GPU, headless Chromium 157, software WebCodecs, userspace relay, 4× cgroup cap (*assumption*).
* No owner decision new.
