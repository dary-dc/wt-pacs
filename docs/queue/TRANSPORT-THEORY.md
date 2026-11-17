state: done
started: 2026-11-17T21:17Z
heartbeat: 2026-11-17T21:30Z
outputs: claude/transport-design 516dd4cc (docs/transport/evidence/stacks.md; pointers in docs/transport/design.md §Open and docs/lines/codecs.md); on draft PR #391
## Resume
Done. Nothing owed by this row; TRANSPORT-PROTOCOL is next (a session that wrote none of this and will not run it).
## Result
docs/transport/evidence/stacks.md: HTJ2K alone (dbts_b1, 50 frames) over WebTransport (TS, WASM), HTTP/3 fetch, HTTP/2 fetch
and WebSocket, theory only, nothing run. Sources quoted verbatim: RFC 9000, 9113, 6455, 8446, 9293, 8441/9220,
draft-ietf-webtrans-http3-17, Chromium net/ at 141.0.7390.37 and 158.0.8127.42, Linux v6.12 docs (Kconfig, ip-sysctl).
Predictions per LINK-TARGETS profile, as ratios to WT-TS: the fill ties (x0.95-1.05) wherever the wire binds (same
Cubic family, both restart slow start after idle, 6 MB stream credit in Chromium for QUIC and HTTP/2); the shared
stream's 6 MiB credit binds first on mmWave (~900 Mbit/s at 56 ms) and on LTE's loaded RTT (~61 Mbit/s), where an
HTTP/3 GET a frame has 2.5x the credit; a cold first frame costs ~1 RTT more over TCP (x1.03-1.15); an ask during a
fill x0.7-2.0 by arm; server CPU predicted lower over TCP, unsourced as a number. Only WT and WS are built.
Fixtures and limits: one series' bytes; profiles as LINK-TARGETS left them (one measured); Android tcp_rmem/wmem,
Firefox/Safari stacks and Blink's fetch priority mapping not read. check_links and check_personal_paths green; no code.
Owner: none.
