state: done
started: 2026-11-22T10:47Z
heartbeat: 2026-11-22T11:27Z
outputs: `claude/names-unified` at ad950041, draft PR #427 into `claude/unified`
## Resume
Done. Next: UNIFIED-SIMPLIFY-REVIEW (PRs 426 and 427), by a session that wrote neither.
## Result
* NAMES-1's leftovers, one commit each: `exactSource` -> `exactClient` (item 6); lab's `requestExactFrame` and `info.path`
  in four files (r3_arm.test.mjs failed on the base, passes); mark and status line *no digest* (item 2's screen words,
  `info.exact` keeps `"unchecked"`); *lossy stream* -> optimal-quality series in rules-for-showing-lossy-pictures.md:31.
* git grep: no old name left in client/, lab/, scripts/; dated records left as written.
* Mutants killed: controller.js read (controller.test), viewer.js and view-worker.js assignment (demo-check.mjs page,
  worker; no gate step catches these), mark text (screen.test).
* Gate OK 883 s at 02ddeb32; skipped: native painter, native window, cross-codec arm and Firefox, web host (no nginx).
  build.sh first failed on Docker Hub 429; the gate's own rebuild then matched the committed bytes. Links 0, budget ok.
* Finding for EXACT-LAYOUT-PAGE: `claude/htj2k-a1`'s stage3/page.js calls `requestExactFrame`, absent from its
  consumer.js, yet A1's arm D rows show Lossless answered; the run's page provenance is unexplained (PR 427 body).
* Fixtures: `dbts_b1-q8-g16`, one of 19 DBT volumes of one dataset, for demo-check; nothing timed; 4-core cloud host,
  no GPU, software WebCodecs, headless Chromium.
* Owner: merging #427 is the yes.
