state: done
started: 2026-11-11 01:34
heartbeat: 2026-11-11 02:27
outputs: claude/demo-tests-mobile 439a2556 (from claude/demo-fixes-0 618e13c8; no PR: tests and findings)
## Resume
Done. Commits: 4397519b controller tests; 37f13e82 av1 route tests; f33c272f, ed24cfe1 demo-check.mjs (retry claim,
--link through lab/scripts/link_impair.py, a fill's progress named); round rows and 6b603b79
docs/reviews/demo-tests-mobile.md; 439a2556 docs/lines/optimal-quality.md. Full gate OK on 439a2556 (728 s; skipped
lavapipe painter/window, GL-display arm and Firefox, nginx).
## Result
* Node: five controller tests (every label state through a failed ask and its retry, unchecked, `l` before connect,
  one ask per frame, a window change) and three av1 route checks; 12 of 13 mutants killed, the 13th equivalent.
* Browser: demo-check now asserts the wrong digest's `l` retry in order (mutant "no retry" killed); it passes.
* netem: the cloud kernel has no sch_netem, so `demo-check.mjs --link` uses the repository's userspace relay.
* Over the relay, wherever a run finished, every claim held (routes, label order, never Lossless on a bad digest).
* Failures, all of time: dbts_a1 cut at 80±20 ms 5 % and dbts_b1 at 40 ms 2 % (with or without jitter) do not
  fill in 120 s; at 40 ms 2 % dbts_a1 fills in 36 s, Lossless 3–6 s, a jump 10 s (with jitter: 73 s, 16–17 s).
* Fixtures: dbts_a1, dbts_b1 from one dataset; no ultrasound cine; 4-core cloud host, no GPU, SwiftShader; one
  run per cell; the jitter and no-jitter cells were not interleaved.
* Owner decision: which link the demo promises (the fill at 2 % loss is loss-limited Cubic; BBR is rig-limits §3's
  priced, untaken lever); FIX-1 has no failing correctness test from this row to fix.
