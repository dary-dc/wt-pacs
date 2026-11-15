state: done
started: 2026-11-15T05:17Z
heartbeat: 2026-11-15T05:34Z
outputs: claude/report-plan 805c2424, cb1c90d8 (docs/client/evidence/report-plan.md §7 Protocol; docs/lines/client.md), on REPORT-OPTIONS' PR; claude/phone-protocol 04797972 (docs/phone-rows/next-round.md §4 Report cells)
## Resume
Done. Nothing owed by this row; REPORT-BUILD-HARNESS is next (needs met). It must first check the levers this row
could not: Firefox's and WebKit's renderer kill, WebKit's browser kill, Firefox and WebKitGTK inside the --tun namespace.
## Result
Pre-registered 2026-11-15 by a session that designed, advocated and built nothing; theory, plus lever checks only.
- §7.1: thirteen shared proposals enter for every arm; RECEIVER's daily cap is no cell; NGINX's 1.29 hop not run.
- Arms off, off′ (A/A), BEACON-H/-Y, KEEPALIVE-H/-Y, SESSION-1/-Y/-H; williams(9), 18 rounds a cell; floor beside L, C.
- Cells: D delivery by nine endings (navigate, close, hidden+renderer kill, hidden+browser kill, visible kill at
  50/500 ms, link drop under relay --tun, bfcache, session never opens, hidden 60 s); L safety latency (bar p50 250 ms,
  p99 1 s idle); C page thread (0.98–1.02 of off); Y bytes (no 64 KiB refusal); R receivers incl. the server.
- Predicted: SESSION fails D8; -H arms lose the visible kill; KEEPALIVE's worker send at risk on Chromium at 50 ms.
- Levers checked: Chromium 153 only by raw CDP (a Playwright page never hid, never entered bfcache); Firefox 159 BiDi
  and WebKitGTK 2.52.6 (MiniBrowser under Xvfb; --headless hangs) hide and bfcache; closing the last Firefox tab
  sends nothing, so D2 keeps a second tab; about:crashcontent does not crash from BiDi; relay --tun blackout drops TCP.
- ~19 host-hours. Phone endings R1–R4 written as asks (only am force-stop sourced).
Fixtures: 4-vCPU cloud host, no GPU, dbts_c1's view, forced mismatch, userspace relay, no phone, no Safari.
