state: done
started: 2026-11-22T18:17Z
heartbeat: 2026-11-22T18:22Z
outputs: `claude/integrity-model` `14994d1dc` (B1), `c07368c9d` (m1-m11), `39d8a8837` (`docs/lines/client.md`); PR 429's body §INTEGRITY-MODEL-FIX (the *Fixed* list)
## Resume
Done. Nothing to continue. Next: INTEGRITY-MODEL-FIX-REVIEW (findings in PR 429's body §Re-review), by a session that
wrote none of the model, its review or this fix; then INTEGRITY-PAGE. No row appended; nothing scheduled.
## Result
Docs only: `scripts/check_links.py` 0 unresolved, comment budget ok, the gate not run. Code read at
`origin/claude/unified` `4a2b4277f` and `origin/claude/oq-integrity-build` `a59aa4310`; the store's half run once in
a scratch check, not committed (FrameStore at both refs: frame 1 failed, then two equal wants -> the downloader is sent
[1] once). No fixture used; no browser run.
* B1: a refused frame is acked, dropped from the owed list and sent again by the next want naming it: one re-ask per
  failure, unbounded, about once a step under a fill in the worker view. Refused: PR 368's failed reconstruction
  check; on both refs a depth cut at the wrong depth, a server refusal or a decoder error on a fill frame. An exact
  frame that fails its check is stored and painted NOT EXACT, never asked again. Named a finding against amendment 22;
  fault-bench cell 12 added; §1, §5, §6, §9 corrected.
* m1-m11 fixed in place (four green-label faults; the mutants; ✓ by branch; unified keeps the old label too; a re-ask
  mends a transient decoder fault; demo-check's sequences; EuroSys'11's population; the WebCodecs quote, re-fetched;
  T.800 superseded; "the check runs at"; ADR §8's reveal, PHONE-FIX-378's "once", RFC 9000 §13.3).
Owner: nothing new beyond §9; item 2 now also asks that a refused frame stay out of later wants.
