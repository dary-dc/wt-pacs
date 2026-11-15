state: done
started: 2026-11-15T03:16Z
heartbeat: 2026-11-15T03:20Z
outputs: claude/cache-plan f26a78f0 (docs/client/evidence/cache-plan.md §8 · Protocol; docs/lines/client.md), on draft PR 385
## Resume
Done. Nothing owed by this row; CACHE-BUILD-HARNESS is next (needs met).
## Result
Pre-registered 2026-11-15 by a session that designed, advocated and built nothing; theory only, nothing run.
- §8.1: four shared proposals enter for all four arms (a second tab reads and writes nothing; a slot freed once a writer
  holds its copy; a miss on an unwritten frame served from what the writer holds; a bounded wait after eviction); two do not.
- Arms none, OPFS-SYNC, OPFS-ASYNC, IDB, CACHESTORAGE, OPFS-SYNC′ (A/A); one Williams period per cell (L at S2 1×: two).
- Eleven cells (L, W, R-idle, R-busy, B busy page, O reopen, E eviction, K kill/torn, Q quota, T two tabs, P private),
  each with its bar and per-arm prediction; floor probe beside every timing run; six mutants; pilot rules from §7.
- Predicted at risk: IDB and CACHESTORAGE at S1 (a transaction/put a frame) and at S3's miss; OPFS-ASYNC on Chromium's
  delivered rate (marginal); on WebKit's busy page OPFS-ASYNC and IDB fail, CACHESTORAGE and OPFS-SYNC pass.
- Engines: Chromium (Playwright's), Firefox 159 (Mozilla archive, reachable), WebKitGTK 2.52.6 + WebKitWebDriver
  installable from Ubuntu 24.04's archive (checked, not installed or run). ~10–12 host-hours an engine.
- Phone cells P1–P3 checked present in claude/phone-protocol:docs/phone-rows/next-round.md §4 cell 5; nothing added.
Fixtures: 4-vCPU cloud host, no GPU, synthetic 16-bit frames S1–S3, feeders not decoders, a relay not a radio.
