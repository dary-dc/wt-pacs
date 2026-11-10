state: done
started: 2026-11-10 08:22
heartbeat: 2026-11-10 08:43
outputs: claude/double-decode-check c83a7465 (test 59d61a4d, fix c83a7465), draft PR #349 into claude/core
## Resume
Done. Line note: docs/lines/client.md on claude/work-ledger (30a4e137).
## Result
* Reached by the default page view, on claude/core: viewer.js (view=page, fill on) → controller.js show →
  consumer.js requestExactFrame ("ask") → downloader.js askFor → ask. A frame the ended run has on the wire lands
  on the run and on its ask; arrived re-queues it and dispatches it twice unless the ack came first.
  #299's own path (want/serveWant) is ?view=worker only.
* The demo tip did not exist at 08:21 (no demo-fixes-2/1/0, core-next-fixes, core-next), so only claude/core was
  checked, and the PR base is claude/core, not claude/core-next as the brief says.
* Test aFrameAskedDuringAFillIsDecodedOnce fails on claude/core (frame 5 dispatched twice); fix = #299's check.
  Mutants: old check (!rec) killed; drop-only-queued killed; drop-only-decoding survives, equivalent (a queued
  copy replaces identical bytes, dispatched once). Frequency not measured; fixtures: none (Node fakes).
* Gate: --no-browser OK in 333 s. Full gate fails only at run_browser.sh's 7 "exact … undefined" checks, the
  GATE-CLOUD cause (no built/xxh3; fixed by #341, not in claude/core): the decoder docker build was refused by
  Docker Hub (429). Every downloader check in the browser otherwise passed (ts 164/171 with those 7, wasm 102/102).
* Owner decision: the demo cannot reach main without this fix (or #299); #349 is the minimal one, merging cleanly
  beside #299. DEMO-INTEGRATE merges claude/double-decode-check.
