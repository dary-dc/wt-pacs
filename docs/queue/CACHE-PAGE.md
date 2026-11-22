state: done
started: 2026-11-22T08:47Z
heartbeat: 2026-11-22T08:52Z
outputs: claude/reviews-2026-11-28 77f39701 (docs/decisions/cache.md; README.md index line; docs/lines/client.md); draft PR 405 ("do not merge: decision pages"), no new PR
## Resume
Done. Read only, from pushed results: claude/cache-plan 70aba834 (§8-§10), claude/cache-arms e988f9c6 (rows), claude/docs-client
6120da78, claude/device-theory 055f152b. Nothing run. Docs-only: check_links 3 unresolved before and after (pre-existing, lab-list.md),
comment budget ok, the gate not run. Nothing owed by this row.
## Result
Fixtures: one 4-vCPU container, Chromium 153 headless, Firefox 159 on Xvfb, synthetic 16-bit frames, feeders not decoders, warm
page cache, O's F from M1; WebKitGTK not run (no SharedArrayBuffer); no phone (cell 5 not run on 11-21), no Safari, no ultrasound cine.
* No store passes §8.5 on either engine (measured). Candidates after one more run (derived): Firefox OPFS-SYNC (fails only L's PSS
  at 512², inside A/A noise); Chromium OPFS-ASYNC (PSS bars only); OPFS-SYNC on Chromium also needs Q and T.
* IndexedDB and Cache Storage lose reads to their own API floors on both engines, so §10.4 items 2 and 5 cannot change the
  choice (derived): recommended dropped.
* B13: 0 of 66 none rounds errored in counted L and B cells (measured): no verdict moves; recommended an unjudged round VOIDs
  its cell unless the period is rerun whole (Williams balance).
* Phones (derived, device-model.md): a fill asks 85-516 MB/s of the store; the CDD floor is 5 MB/s write (class V 150).
Owner, last (cache.md §2): keep the cache off; queue §10.4 narrowed to items 1, 3, 4, then P2 and P1; confirm
frame-memory-ownership.md questions 3 and 4 as printed; option F as the frame for what stays on a device.
