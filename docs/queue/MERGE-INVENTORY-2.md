state: done
started: 2026-11-15T12:47Z
heartbeat: 2026-11-15T12:54Z
outputs: claude/work-ledger:docs/queue/MERGE-INVENTORY-2-report.md
## Resume
Done. Nothing owed by this row. Next: MERGE-A-CODECS, -SERVER, -CLIENT once MERGE-BASELINE is done, from §4's frozen list.
## Result
origin re-read 2026-11-15 12:53 UTC; unified tips, main, line-hygiene unmoved since the plan.
* Moved: docs-client, cache-plan, report-plan, depth8, oq-ingest, phone-protocol, hw-probe, phone-rows (one commit
  beyond fill-split): all merge. New: hw10-routes (merge, after docs-client).
* Later pass (rows still running or not started): cache-arms (CACHE-FIX), report-arms (REPORT-BUILD-BEACON),
  native-notes (no branch yet), and the later commits of docs-client, cache-plan, report-plan.
* Frozen list: codecs 5 -s ours + 29, server 5 -s ours + 6, client 2 -s ours + 60, each with its tip.
* Riding in: PR 265's downloader fix 52bfb33a comes with every M2 branch (MERGE-A-CLIENT must resolve to the tip
  even without a conflict); PRs 309 and 370 ride in clean (their product commits stay out).
* report-arms adds a telemetry hook to server/src/transport/server.rs: a fourth input to MERGE-B's resolution.
Fixtures: one read of origin; test merges of the 11-14 tail only, from today's unified-client; no build, no gate.
Owner: six viewer-line commits (M5, parked) ride in with cine-no-skip (M4) as non-conflicting viewer behaviour
(manual step stops at the ends, rotate/flip only on DX and CR, keys ignore case): merge them, or take the tip's files?
