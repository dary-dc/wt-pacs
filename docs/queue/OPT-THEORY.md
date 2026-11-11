state: started
started: 2026-11-11 01:43
heartbeat: 2026-11-11 01:46
outputs: claude/proposals (from claude/demo-fixes-0 618e13c8), PR pending
## Resume
Read: docs/lines/optimal-quality.md, client.md, WIRE.md, transport-conclusions §3 (first ask, idle radio), §7, §9,
decode/hardware.md, client/README.md §Optimal quality (DEMO-E2E-2 numbers), downloader.js, viewer.js, av1-webcodecs.js,
ingest.py lossy_args. claude/proposals from main 017a3ca6. Plan, most promising first:
P1 tiles in the OQ encode (Chromium's dav1d tile threads; per-frame decode, jump mid-group); P2 BBR on the OQ series
server for the fill (owner's open call, §9.2); P3 radio wake on pointerdown via end_stream on the exact session
(no fill there, so harmless); P4 larger initial window on the exact server only (exact session never warms);
P5 defer the exact dial and OpenJPH start until the first picture. Rejected: exact prefetch (breaks explicit
request / remove work), hardware decode (hardware.md §1), 0-RTT, pooling (closed).
Next: fetch official sources, write docs/lines/proposals.md §Optimize, push to claude/proposals, draft PR into main.
## Result
