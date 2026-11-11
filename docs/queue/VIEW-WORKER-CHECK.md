state: done
started: 2026-11-11 01:34
heartbeat: 2026-11-11 02:26
outputs: claude/demo-view-worker 8f43ca7d, draft PR #361 into claude/demo-fixes-0
## Resume
Done. 66521fc5 failing check, 2b0dff99 --view fix, README §Demo line, 8f43ca7d record + docs/lines/client.md.
## Result
* demo-check.mjs --view page|worker sets the page's `view` parameter. The check now requires the status line to
  name that view. It failed before the fix. Mutants killed: no view in the URL; the URL hardcoded to worker under --view page.
* 20 series x 2 views, interleaved by series: 40 of 40 passed (docs/reviews/view-worker-check.md). The view worker
  meets the page's correctness bar on this check. Correctness only; no latency or throughput claimed.
* view/clock.js is already in deploy/web-files.sh: nothing added.
* Gate --quick OK in 474 s. Skipped: lavapipe painter/window, GL-display viewer arm and Firefox, nginx.
  The gate first stopped on a missing xxh3 reference hasher (fetch_xxh3.sh). Cloud setup lists miss that script.
* Fixtures: dbts_a1, dbts_b1, dbts_c1 from one dataset; no ultrasound cine; 4-core cloud host, no GPU, loopback.
* Owner decision: which view the demo shows (page or worker).
