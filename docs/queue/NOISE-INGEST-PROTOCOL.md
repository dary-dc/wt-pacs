state: done
started: 2026-11-19T15:16Z
heartbeat: 2026-11-19T15:25Z
outputs: claude/noise-ingest abbfbda1, draft PR 413 into claude/unified
## Resume
Done. NOISE-INGEST-MEASURE runs docs/av1/noise-point.md §σ_min in the Rust ingest §Protocol, by another session.
## Result
* Theory and a pre-registered protocol: docs/av1/noise-point.md §σ_min in the Rust ingest (pointer in §7);
  docs/lines/codecs.md §Open 3 one dated line. Nothing was built, timed or encoded.
* Where: from-parser's code(), on the samples it already reads; σ_min goes in the exact series' metadata, before
  any AV1 encode; the flag's Q stays until the owner decides (codecs §Open 0.2).
* Port: equal to quality.sigma bit for bit (integer filters, NumPy's _lerp order, an exact i64 mean). Checked on
  400 synthetic frames, 400/400 equal (measured, synthetic).
* Cost predicted at 0.004–0.012 CPU s/Mpx, against Python's measured 0.049–0.087. The share of the exact path is
  wide (7–99 %) because the Rust ingest's rate is unmeasured; M3 measures it.
* Window: phase 1 reads no window (nested Frame VOI LUT Sequence; mirror.py writes none). P4 decides between
  all-samples σ now and in-window σ after phase 2.
* Rule Q at G 8 in the ingest's form (derived): 4 · 8 · 4 on dbts_a1 · b1 · c1. The flag's Q is 8.
* Found: quality.sigma narrows its caller's mask in place, so cell.series_row's step rows exclude the steepest tenth.
* PCS note drafted, not sent (four questions).
* Gate not run (docs only); check_links 0 unresolved; comment budget ok.
