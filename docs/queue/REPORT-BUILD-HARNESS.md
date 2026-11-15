state: done
started: 2026-11-15T11:17Z
heartbeat: 2026-11-15T12:03Z
outputs: claude/report-arms d9d016d5 (lab/report-arms/, lab/server-telemetry/src/link.rs + its hook in server.rs under telemetry, lab/faultbench/decode links, scripts/gate.sh, docs/lines/client.md), draft PR 395 into claude/docs-client
## Resume
Done. Nothing owed by this row; the four REPORT-BUILD rows are next (needs met), each behind lab/report-arms' seam.
## Result
Built the rig report-plan.md §7 needs, with arms off and stub only; nothing here is a result.
- Records + one field list (report-fields.json); the sink: one record in, its line appended, then 204, with counters;
  the read tool (dedup by reportId or content, outside fields named, NGINX's line form, link joined by load).
- Timings H and Y shared by the HTTP carriers; §7.4's five mutants (four on the page, ack-before-write in the sink).
- Chromium's endings by raw CDP, all seven levers checked through the harness; a process-tree kill for Firefox/WebKit
  (tested on a made-up tree only); the relay's blackout lever.
- The server's link line per session at its end, keyed by the session URL's load= token (telemetry builds only).
- The page on the fault bench (frame 10's mismatch -> a safety report); D8 forces the failure on the page.
- 52 mutants across eight tests, all killed. Smoke: off and stub x D1-D5, D7-D9: the safety report in every row, off
  no load record; each of the five mutants caught once.
- Not built: D6 under --tun (no iproute2), floor probes, cells L, C, Y, R; Firefox/WebKit kills unchecked (absent).
- The fault bench's decoder dir lacked two links decoder.js now imports; added.
Fixtures: 4-vCPU cloud host, no GPU; headless Chromium 153 only; the contract's grey-16 frame x32, not dbts_c1 (so D5
kills after the fill's end here); loopback, no relay. Gate: all up to the docker rebuild (no daemon); absence checks
pass by hand; two pre-existing devices.md paths set aside locally.
