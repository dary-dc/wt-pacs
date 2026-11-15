state: done (seven blockers open; CACHE-RUN waits until each is fixed, see Result)
started: 2026-11-15T10:16Z
heartbeat: 2026-11-15T10:34Z
outputs: claude/cache-arms 1e44c64d, 5749ae40 (docs/reviews/cache-arms.md; docs/lines/client.md), PR 394 (body unchanged)
## Resume
Done. Nothing owed by this row; the blockers' fixes are their build rows'.
## Result
Not ready for CACHE-RUN: seven blockers in docs/reviews/cache-arms.md §Verdict, each with file:line and evidence.
- OPFS-SYNC: reads first never runs (await serveReads yields microtasks only; observed, Chromium 153: read at 208 ms
  after a 207 ms write; 6.4 ms with one setTimeout(0)). OPFS-ASYNC: a refused write()/close() after its call is
  dropped at close, the frame verified from the arm's copy, off disk. CACHESTORAGE: list() opens each Cache, and that
  handle keeps the evicted space (observed, 100 MiB held 6 s) - E's late space is this build's, not the engine's.
- Harness: unwrittenAt5s sampled after every frame is handled; K's kept bar fixed at 3 and blind to queued; L's bars
  against none not computed and --mutant mutates none too (view-copy uncaught, L VOID); the floor inside L's PSS window.
- Seam changes judged: serveReads, pilot, floor medians, IDB's kept value, ASYNC's probe at new series accepted;
  "written = handed to the arm" only once late refusals reach the store and rows count what is on disk.
- Mutants: 180 across five reads (149 killed); survivors and minors listed. Six test files pass; gate --quick passes
  with the two pre-existing devices.md link paths set aside locally and its by-name skips; check_lab_absent passes.
Fixtures: 4-vCPU cloud host, no GPU, Node mocks; headless Chromium 153 probes one run a variant; no Firefox/WebKit/phone.
Owner: no build row is left to fire for the fixes (all four build rows and HARNESS are done); reopening them, or a
fix row, is the owner's. CACHE-RUN should not start on ac517958/5749ae40.
