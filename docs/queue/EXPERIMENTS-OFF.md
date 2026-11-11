state: done
started: 2026-11-11 15:38 UTC
heartbeat: 2026-11-11 16:07 UTC
outputs: claude/demo-clean abbb441d (from the demo tip claude/demo-fixes-1 daee0d1d); docs/reviews/experiments-off.md; no PR
## Resume
Done. claude/demo-clean: removals adc69a37, 45aff07c, 35d05b14, 3a4a5922, 614033bd, 05eab56b, d1aa8c60, 13f1edb7,
b0d8381a; the list 12d5d677 (+ gate 26cd1658, abbb441d); line file docs/lines/optimal-quality.md 1ef93a6e.
## Result
* docs/reviews/experiments-off.md on claude/demo-clean: 16 items of main...daee0d1d, each with where it lives
  after and a yes/no column. Nine removals prepared, one commit each, -8 273 lines in 110 files: lab/target-review,
  recv-loop, opfs-arms, native-fill (+native_cache_cells.sh), paint-read, L1's 38 lab/av1/decode files, lab/viewer's
  settle/view/wait-ahead runs, lab/opfs-cache's M1-M5 harness, two lab/README rows.
* Each folder's git tree is byte-identical at a named line-branch commit (7f335cc0, cf38708b, 0920153d, a237cf3e,
  696c15d6); doc links pinned there; check_links 0 unresolved. No archive tag pushed (outside this row's
  permissions; check_links refuses a cited tag missing on origin): proposed names in the list.
* No running row (DEMO-UX, MEASURE-1, PHONE-RUN) touches a removed path.
* Not prepared: client/native is product of the native line (docs/lines/native.md), not an experiment;
  lab/frame-clock (levers.js and the nightly's total-time import it); opfs-cache/browser.mjs (settle-check imports
  it); lab hooks in product modules, the image's check files, server lab flags (refactors, after FREEZE-E2E).
* Gate: full scripts/gate.sh GATE OK in 395 s on 1ef93a6e (first try failed only for no Docker daemon). Skipped:
  native painter/window, cross-codec arm and Firefox, nginx check. demo-check.mjs not run. No fixtures timed;
  4-core cloud host, no GPU.
* Owner decisions: yes/no per item 1-9 (FIX-2 merges only the yeses); client/native keep on main or hold off;
  whether to push the archive tags; items 11-16 now or after the demo.
