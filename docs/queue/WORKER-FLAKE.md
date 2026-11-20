state: started
started: 2026-11-20T15:17Z
heartbeat: 2026-11-20T17:09Z
outputs: claude/worker-flake a9e624a3 (loop, 100 rows, fix, mutants, findings); PR after the gate
## Resume
Loop: 100 runs, 1 failure (row 83: "received 23" against 24). Cause, corrected from the first reading: not a frame
dropped. The view worker posts progress at most every 100 ms (PROGRESS_MS, client/view/view-worker.js), so in the
worker view the status's "received" lags the frames held by up to 100 ms; the check read the final status at the
pass's end, ~100 ms after the jump's paint. Probe (scratch, not committed): at the jump's paint the count read 20-23 in
10 of 10 worker on-demand passes, 24 within 0-100 ms; 24 at once in 4 of 4 page passes. Fix a75d1e56: on demand the
count is read once it reaches the expected value (bounded 2 s) after the jump. Running: mutants (scratch mut.sh ->
lab/worker-flake/mutants.jsonl): fixed x5 worker x2 page; M1 the wait removed; M2 a 20 ms wait; P1 the worker's flush
removed. Next (findings, line doc pushed): gate --quick (wasm-pack installed first), then the, draft PR into
claude/unified naming the overlap with #418 (same lines).
## Result
