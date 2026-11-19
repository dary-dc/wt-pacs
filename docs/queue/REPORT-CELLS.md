state: done
started: 2026-11-19T12:47Z
heartbeat: 2026-11-19T14:21Z
outputs: `claude/report-arms` `115a3529`..`56d27bb7` (8 commits), draft PR 395 (body: §The missing cells); smoke rows `docs/queue/REPORT-CELLS-smoke.jsonl` here
## Resume
Done. Next: REPORT-CELLS-REVIEW (a session that built none of it), then REPORT-RUN-2. Host setup for either: `apt-get install
-y iproute2`; nginx 1.31.8 from nginx.org's tarball (`NGINX_BIN`, and its `mime.types` in `/etc/nginx/` for the gate's web
host check); Firefox from Mozilla's linux64 release (`FIREFOX_PATH` for run.mjs and bidi.check.mjs, unset for the gate);
`cargo build --release -p series-server --features telemetry -p pack-series -p report-receiver`.
## Result
* Built, each test first and mutated (38/40 killed, 2 equivalent): D5's kill timed from the decoder's fault; cells L,
  Lbusy, C; the floor beside L and C (HTTP arms); R for NGINX and RECEIVER; Y's records and body bytes per load; D6 under
  `link_impair.py --tun`; Firefox 160.0.1 by BiDi, every lever checked (`bidi.check.mjs`).
* Not built: SESSION's floor (a bare session's first stream is its control stream); R's server row; Y's wire bytes at
  the relay (no relay flow is the reports' alone: an amendment before REPORT-RUN-2); WebKitGTK (not on this host).
* Engine limits: Firefox observes no long tasks (C's long-task bar not judgeable); the sink's `no-store` keeps D7 out of
  Firefox's bfcache; its renderer kill takes every content process.
* Smoke, one round each, not counted: at 50 ms after the fault every arm had already handed its safety report on, so
  D5a on this host may not reach the race even timed right.
* Gate: full `scripts/gate.sh` OK in 413 s on `56d27bb7` (decoders rebuilt to the committed bytes, absence checks
  green); skipped by name: numpy/pydicom, lavapipe/Xvfb, the viewer's cross-codec arm; devices.md :57, :60 set aside
  locally (pre-existing).
* Fixtures: a 4-vCPU cloud container without a GPU; headless Chromium 153 and Firefox 160.0.1; the contract's grey-16
  frame x32, not `dbts_c1`; the fault bench's forced mismatch; loopback or a userspace relay, not a radio.
* Owner: nothing forced. The rig's sink header for Firefox's D7 and Y's wire-byte amendment are the review's to weigh.
