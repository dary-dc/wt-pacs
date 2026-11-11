state: done
started: 2026-11-11 01:38
heartbeat: 2026-11-11 02:20
outputs: claude/demo-understand f06d697a, docs/reviews/understand/clean.md; docs/lines/optimal-quality.md §Open 11; no PR (findings)
## Resume
Done. Read from the demo tip claude/demo-fixes-0 618e13c8; commits 798e7b8e, d2ceff18, f06d697a.
## Result
* viewer.js: ~110 of 334 lines are check/lab hooks; one module loaded only under ?check= or the lab would hold them.
  `?deadline=` is set by nothing in the repo; `?mutate=sample` only by two lab runners (belongs in levers.js).
* Five lab settings (settle, glAfterDial, viewWorkerFirst, holdEveryOther, pageDials) plus ledger/flip ride the
  view worker's and painter's product signatures; fold into one lab object or archive concluded experiments.
* onePass (on, decided) and reuseCopyBuffer (off, decided) are still flags: ~20 lines and one test could go.
* The web image ships check-page.js and view/check.js, so production honours ?check=1; web-files.sh lists
  viewer/store.js twice. paint/reference.js is product (valueAt).
* L1: 38 paths / 3 132 lines (not 40 / 3 337), byte-identical on av1-unified-mainbase 696c15d6; 8 links in
  docs/decode/README.md to pin.
* Server lab features are soundly gated; six lab crates in the workspace make the image build copy lab sources;
  lab_frame_cache.rs #[path]-includes a lab crate.
* Fixtures: none run; read from one commit. check_links.py 0 unresolved.
* Owner decisions: which items to do and when (suggested: 4 and 5 any time; 1–3, 6 after FREEZE-E2E).
