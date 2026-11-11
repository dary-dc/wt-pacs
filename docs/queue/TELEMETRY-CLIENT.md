state: done
started: 2026-11-11T18:57Z
heartbeat: 2026-11-11T19:28Z
outputs: claude/telemetry-client b097f5b9, draft PR #370 into claude/demo-fixes-2 (a proposal, not for the demo)
## Resume
Done. Nothing pending.
## Result
Design: docs/adr/telemetry-in-production.md §8 (brought from claude/telemetry-production-design; §3 corrected in place).
The load report, client/viewer/load-report.js: one object per sampled load, sendBeacon once at hide; off unless the
transport file sets telemetry {rate,url}; series as sourceFingerprint; URLs stripped from errors; on a false return,
resent once without per-frame rows. Worst case 5.4/4.9/6.6 KB on a1/b1/c1, against Fetch's 64 KiB.
Controller.summary (no digests); viewer.js wiring; lab/phone/beacon.js now a switch over it (one implementation);
dev-server --beacon takes one object per load; the runner ends each report with its verdict.
Mutants killed: load-report 16/16, summary 4/4, dev-server 3/3, viewer wiring 6/6 via run_test.sh, the hide trigger 1/1.
Headless demo pair dbts_a1 + dbts_a1-q8-g8-cut, 4 loads page/worker: one report each, 56/56 frames, fill set, ~4.5 KB.
Full gate OK 679 s (skipped: native painter/window, cross-codec+Firefox, nginx).
Fixtures: synthetic 10-bit 64x48x20 pair and one DBT volume (dbts_a1), loopback, headless Chromium/SwiftShader,
4-core cloud host; no phone; nothing timed (§5's cost and delivery runs owed).
Deviation: sent at hide only (a load has no earlier end the page can see); the runner ends a load explicitly.
Owner: sample rate (default 0.01), sink (nginx log / receiver / outside collector), retention (30 days), errors as
messages without URLs or codes only. PR #370 carries PR #369's commits until #369 lands.
