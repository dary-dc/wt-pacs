state: done
started: 2026-11-20T15:17Z
heartbeat: 2026-11-20T17:21Z
outputs: claude/worker-flake 5ca31b35, draft PR #419 into claude/unified
## Resume
Done. Next: a review row for #419 (none is queued; the standing rule asks one per build).
## Result
* Reproduced: 100 worker runs of dbts_a1-q8-g16-cut, 1 failed (row 83, "received 23" against 24); 95 % interval
  0.03-5.4 %, consistent with CLEAN-PRODUCT's 1 in 40.
* Cause: the check, not the product. The view worker posts progress at most every 100 ms (PROGRESS_MS), so the
  status's count lags in the worker view; the check read it at the pass's end, ~100 ms after the jump. Probe: 20-23
  at the jump's paint in 10/10 worker passes, 24 within 100 ms; 24 at once in 4/4 page passes. A first reading (the
  jump drops group 0's tail) was refuted by a 2 Mbit/s --link run and the failed row's arrivals.
* Fix (#419): on demand the count is read once it comes, bounded 2 s. Mutants: fixed 0/7 fail; wait removed 4/5
  worker (0/2 page); 20 ms wait 2/3; product never posts progress 2/2.
* #418 touches the same lines and keeps the racy read: whichever merges second takes the other's part.
* Gate --quick OK 571 s (skips in #419). Fixtures: one series, one dataset, 4-core cloud, Chromium 157 SwiftShader,
  loopback.
* Owner: merging #419 is the yes.
