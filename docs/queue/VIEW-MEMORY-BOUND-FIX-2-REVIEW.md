state: done
started: 2026-11-23T08:17Z
heartbeat: 2026-11-23T08:20Z
outputs: PR 435 body §Re-review 2 (against claude/view-memory-bound d05e53274); claude/view-memory-bound 5bad5d387 (docs/lines/client.md)
## Resume
Done. No blocker open, so no fix rows appended. PR 435 is mergeable by a sync row under amendment 28 rule 1 once the gate
passes on the merge.
## Result
* Round two's B1 closed: past its window with no cache the page view links its store to the downloader and each step asks
  the frames entering the window ahead of the reader; on demand and for a fitting series nothing changed. m1 (progress
  counts the window's frames) and n1 closed; m2 (viewer.js untested) argued, the gap named in the body.
* Every named mutant re-run and killed, plus two of mine; controller 46/46, comment budget ok, check_links 0 unresolved.
  The gate was not rerun (the fix's GATE OK is at the same head; this review changed no code).
* New minors: a cache-past-the-window progress mutant survives (no test); a step during the page view's fill now ends the
  fill's run as the worker view's does (unit probe), unmeasured in both views; step latency past the window is theory.
* Fixtures and limits: unit tests and one unit probe on synthetic 3x2 frames in Node; nothing run in a browser or on a
  device; memory and step latency not measured.
