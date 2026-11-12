state: done
started: 2026-11-12T05:23Z
heartbeat: 2026-11-12T05:45Z
outputs: claude/lab-off-main 3d196b96 (from claude/demo-fixes-2 18d2d1ff): docs/reviews/lab-off-main.md, docs/lines/coordination.md §Decisions pointer; no PR (proposal, docs only)
## Resume
Done; nothing left for this row.
## Result
* Read on the demo tip 18d2d1ff (holds main 017a3ca6); counts from git ls-files / git grep, nothing measured.
* lab/: 994 files, ~126 000 lines, 22.7 MB, 49 dirs. History keeps every byte: the gain is the tree, not the clone.
* Eight ties main->lab/ named (§2): six workspace crates; three server lab features; head.js's lab gate; product tests
  using lab helpers (order.mjs, the Firefox driver, gen_frame_pnm.py, window_grey16); BUILD dir lab/.av1-build;
  demo-series.sh's OQ writer lab/av1/tools/ingest_coded.py; 11 of the gate's 52 steps and the perf job; 1 441 doc
  mentions of lab/ paths in 62 docs files (297 links), each checked by check_links.py.
* Options: A keep today's rule; B one lab branch; C split by line; D a lab repository; E only the product's reach into
  lab/ moved out (T4-T6), lab/ stays. Tables of what each keeps and loses, how an agent measures, cost as assumptions.
* Recommendation: E now, B judged after on its total effect; C and D dominated by B.
* Checks: scripts/check_links.py 0 unresolved; the full gate not run (docs only).
* Fixtures and limits: one read of one tree; no cost measured; how often a product PR broke a lab driver not counted.
* Owner: A-E (E then B recommended); under B the lab branch's name and CI cadence, and the server's lab features off main.
