state: done
started: 2026-11-24T12:18Z
heartbeat: 2026-11-24T13:09Z
by: 74mfjLPs
outputs: claude/phone-run-2 21c8102b0 (merges c914c7a76, 9180c0542; harness 313ad1b55, f2de84d70, 156cdb3f2); docs/phone-rows/round-2.md; no PR (the brief asks none)
## Resume
Done. PHONE-ROUND-2-PREP-REVIEW next (round-2.md §Review), by another session.
## Result
* claude/phone-run-2 from origin/claude/phone-run 8d77ba2b4: --no-ff merges of origin/claude/unified b059388b6
  (c914c7a76; controller.js, controller.test.mjs, dev-server.py, both sides kept: the memory bound with PR 378's one
  re-ask) and of claude/beacon-loss 783674e01 (9180c0542; lab/devices/README.md). PR 436 open, claude/phone-run untouched.
* round-2.md: cell 3's 48 loads under one condition (fresh Chrome before each, load 0 included; budget = the series;
  the worker with the start's fix; a firstPicture field), then cell M (8 loads on one renderer, each view at the
  default window and twice it); ~1 h 15 min (derived from 3D); MEMORY-LEAK-TRACE, VIEW-MEMORY-BOUND, BEACON-LOSS,
  STALE-CODE landed (commits named); a per-load code record not built (derived: --revalidate plus round.py's HEAD check).
* Harness (lab, one seam: ?budget reaches the Controller via viewer.js, view.js, view-worker.js; unchanged without it):
  round_plan.mjs --cells, --revalidate on every dev server; round.py sameRenderer; the round page's memory record
  (window, deviceMemory, MAX_TEXTURE_SIZE) and firstPicture. 12 mutants killed over the unit and headless tests.
* Gate OK, full, 1027 s at f2de84d70 (skips: pair invariants, native painter/window, cross-codec and Firefox, nginx).
  round_headless.sh --round2 (the dry run, fake adb, --fresh-chrome): every claim holds at 156cdb3f2.
* Not carried, each needing a build (round-2.md §5): M17, M5 at a volume's size (make_hw_units.py at 2048² fails in
  ingest.decode, measured), P1/P2, the cache's cells (CACHE-DESIGN-1124 has no output). The middle-band phone's
  section needs a static bench build first.
* Fixtures: synthetic 10-bit pair 64×48, 20 frames; one 4-core cloud container, headless Chromium, no GPU, no phone.
* Owner decision: none.
