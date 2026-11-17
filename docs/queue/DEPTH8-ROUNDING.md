state: done
started: 2026-11-17T18:17Z
heartbeat: 2026-11-17T19:20Z
outputs: claude/depth8 4464fab1 (protocol, pre-registered), 853ed8fc (§10.2 results, rows, codecs line); PR 389 (body §DEPTH8-ROUNDING)
## Resume
Done. Nothing left to run.
## Result
av1-hardware-unchecked.md §9's cloud cell, depth-cut-8.md §10 (claude/depth8, PR 389): today's view decoded, then
rounded to 8 bits by round(y · 255 ÷ 1023), on 19 DBT volumes, with 59 cells and 19 round-only rows at G 1. Each
cell at today's Q reproduces §9's row exactly.
* At today's Q the worst frame reads 1.001–1.080 of σ, over the noise rule on all 19 (R2: 19 of 19 hit).
* Meeting the rule needs Q 1–3 rungs lower (Q 5–8 at D 12, 7–12 at D 10), at 1.17–1.83 × today's bytes. That is
  about the checkable 8-bit cut's 1.14–1.86 ×.
* Misses: the rounding alone reads 2.8–8.4 % low on the 10-bit volumes; the mean-error prediction misses on 18 of 19,
  because it was written for uniform codes.
* Fixtures: 19 DBT volumes, one cloud host, the rounding modelled in software; no phone, hardware decoder or reader.
