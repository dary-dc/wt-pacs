state: done
started: 2026-11-16T04:17Z
heartbeat: 2026-11-16T04:57Z
outputs: claude/report-arms 59dfd328, 8d0e00d4, f379bd60, 93399c59, 50a7e184 (lab/report-arms/receiver/, lab/report-arms/nginx/, run.mjs --receiver, README, scripts/gate.sh, Cargo.toml, docs/lines/client.md); draft PR 395 body §The receivers; smoke rows docs/queue/REPORT-BUILD-RECEIVERS-smoke.jsonl
## Resume
Done. The brief and the Amendments did not change while this row ran (amendment 21). Nothing owed by this row. Claimed at 04:17, about 17 minutes after claude/report-arms last moved (04:00, REPORT-BUILD-SESSION, already done), not the 20 the procedure asks.
## Result
Built NGINX and RECEIVER (report-plan.md §3.5 as advocated) as lab arms; run.mjs --receiver puts either in front of the page (nginx proxies the pages to the sink).
- NGINX: nginx 1.31.8 early read, one escape=json line a record in <kind>-<UTC day>.jsonl, 16 KiB, POST only, load reports rate-limited; counters read from its files.
- RECEIVER: Rust crate report-receiver behind nginx (field drop + warning, UID scrub, 512-byte strings, day cap for load reports, safety synced and raised, 500 on a failed write); nginx's line as fallback on non-2xx.
- Found: the advocate's `return 204` answers before limit_req runs, so the rate limit never applied; built with `try_files /.none =204` (tested both ways).
- Departures (README): load-<day> not reports-<day>; whole-run UID match; one Mutex as the writer; the fallback also keeps RECEIVER's 400/404 bodies; TZ=UTC; out dir world-writable for nginx's worker.
- Tests written beside the code, then mutated: nginx 18/18, RECEIVER 25/25; both in the gate (nginx's where nginx >= 1.31.5).
- Smoke BEACON-Y D1–D5b, D7–D9 and KEEPALIVE-Y D1 per receiver: identical rows on both, the same as the sink's; field-outside and ack-before-write caught.
- Gate --quick OK (devices.md's two paths set aside locally); check_lab_absent passed.
- Not built: the 1.29 hop form; cell R's load generator.
Fixtures: 4-vCPU cloud host, no GPU; headless Chromium 153 only; grey-16 ×32, not dbts_c1; loopback, no relay; --wait 30, not 60; nginx built locally, not the image's.
