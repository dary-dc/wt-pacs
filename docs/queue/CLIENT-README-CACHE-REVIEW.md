state: done (one blocker open; amendment 17 rows CLIENT-README-CACHE-FIX and -FIX-REVIEW appended)
started: 2026-11-22T11:46Z
heartbeat: 2026-11-22T11:48Z
outputs: this file; the two fix rows in `docs/queue-2026-11-14.md` (no PR: CLIENT-README-CACHE opened none)
## Resume
Done. Next: CLIENT-README-CACHE-FIX, by a session that wrote neither `61bce9e1` nor this review.
## Result
* Read only, against `origin/claude/unified` `4a2b4277` (`61bce9e1` is its ancestor): nothing run, the gate not run
  (no change but ledger files). Fixtures: none; a docs claim checked against code.
* Holds: "There is no cache by default." `client/viewer/viewer.js:29` `const writer = lab.writer;`;
  `lab/viewer/levers.js:14` sets it only from `?writer=` (and refuses it under `view=page`, `WORKER_ONLY`, line 8);
  `client/view/view-worker.js:87` opens the cache only `if (writer && opts.digests)`; `client/view/cache.js:35` is
  the one start of `viewer/store.js`. The read-back re-check and re-ask hold (`client/view/store.js` reading loop,
  `reasked`, `present.delete`). Both links resolve.
* **B1.** The corrected bullet re-words, and so asserts, "past 256 MiB the frames on disk farthest from the current one
  leave memory". The code has no such bound: `FrameStore`'s `budget` is in frames, `budget = Infinity` by default
  (`client/view/store.js:29-32`), and neither caller passes one (`client/viewer/viewer.js:102`,
  `client/view/view-worker.js:55`), so no frame ever leaves memory, writer or not. Already reported as
  `docs/proposals/simplify-fable.md` P2 item 1, which no row owns. CLIENT-README-CACHE's "nothing left to change" is
  wrong by this sentence.
* m1. CLIENT-README-CACHE's Result cites *Where the frames are*' link as `core-against-main.md`; at the tip it is
  `speed-of-the-assembled-design.md` §The core, assembled (it resolves). Status-file note only.
* The cache stays off: true. Line doc not changed (no output branch); CLIENT-README-CACHE-FIX updates
  `docs/lines/client.md` on its branch.
