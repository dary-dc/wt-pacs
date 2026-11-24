state: done
started: 2026-11-24T18:47Z
heartbeat: 2026-11-24T21:55Z
by: bqyisHDi
outputs: claude/transport-flags 4aa86d5de (the rig's additions, lab only), 007ab4bf4 and 5b38c8982 (rows); claude/page-runs 42f4a38b1 (docs/reviews/page-runs.md §Transport: results, rows copied in docs/reviews/page-runs-rows/); no PR
## Resume
Done. Nothing left to resume.
## Result
dbts_b1 HTJ2K, 14 rounds a cell, AD (196 visits, 3 VOID) and CR (98, 2 VOID), Williams-ordered, every frame exact.
Ratios to WT-TS (median): AD-PUB / AD-LTE / CR.
WT-TW ×0.993 / ×1.037 / ×1.000: PUB and CR hit (ties); AD-LTE misses its predicted gain ×0.70-0.88.
WT-PF ×1.549 / ×1.696 / ×0.571: AD misses above (worse); CR below the band, better than H3-frame ×0.620.
WT-AF ×0.780 / ×0.535 / ×0.676: AD hits; CR misses below ×0.97 (the fill is faster, not row 211's cost).
H3-fill, H3-frame re-measured inside their bands; WT-TS' ties (AD-LTE not conclusive, the 0.1 % loss's spread).
By §1's rules: TW and PF above ×0.8 on AD, so the GET path for asks stays the next draft; PF answers CR inside WT;
#39 (asks first, 6 MiB window) is net on these cells (AD-PUB's ×0.780 a narrow margin to ×0.8). #96 not answered.
Mutants: ignored-arg VOID (killed), af-as-pf loses AF's gain (killed), no-arm-flag ties on PUB.
Link-bound by design; busiest core 0.86 (AD), 0.47 (CR); relay at or under 90 of its 100 Mbit/s.
Limits: one DBT volume, no ultrasound; one 4-core container, headless Chromium 158; userspace relay models, not a
radio; cwnd not recorded, so TW's AD-LTE miss is not attributed.
Owner: #39 adopted as a product build row, yes or no (via PAGE-RUNS-VERDICT and BRIEF-WEEKEND).
