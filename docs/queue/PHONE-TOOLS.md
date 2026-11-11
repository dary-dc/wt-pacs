state: started
started: 2026-11-11T17:48Z
heartbeat: 2026-11-11T18:15Z
outputs: claude/phone-tools 07b42c09 (claude/demo-ux 14605f41 + --no-ff claude/demo-fixes-2, conflict in docs/lines/optimal-quality.md resolved keeping both)
## Resume
Done: branch and merge (07b42c09). Next, one commit each, failing test first, mutated, push after each:
1. deploy/Containerfile: ARG REVISION + LABEL org.opencontainers.image.revision in `server` and `web`; compose passes it.
2. ARG FEATURES (empty default) on the server build; `--build-arg FEATURES=telemetry` for a test-only image.
3. Disk path: the server's log line naming io_uring or the pool; README command for the phone session.
4. Beacon: lab/phone/beacon.js through head.js's lab gate (`?beacon=<controller>`), via the existing lab hook
   `finished` (ledger gains wireBytes/decodeMs per frame); dev-server.py `--beacon-log PATH` (off by default).
5. Runner: lab/phone/runner.js (`?run=`, steps and origins in the URL), presses the lossless button, fixed gap,
   stops on failure; a start page lab/phone/index.html.
Then gate (follow README §Prerequisites from gate-cloud), line file, draft PR into claude/demo-fixes-2.
## Result
(pending)
