state: done
started: 2026-11-14T21:15Z
heartbeat: 2026-11-14T21:17Z
outputs: claude/report-plan 2c9c4d19 (docs/client/evidence/report-plan.md §3.1, docs/lines/client.md), PR #388
## Resume
Done. §3.1 amended in place on claude/report-plan; nothing else owed by this row.
## Result
Docs only, theory; nothing built or timed. Sources quoted verbatim at §0's pins (Beacon, Fetch, HTML lifecycle) and
BCD api/Document.json 69fcf3608174.
Amendments (each marked advocate): a true sendBeacon outlives the page (Fetch keepalive note), so every send is one
synchronous call; the hybrid (bulk at fill end, a seq'd delta per hide) is BEACON's design, the hide-once build its A
arm; pagehide beside visibilitychange (Safari < 14.1 per BCD), never unload; string body, text/plain, no preflight,
the reports the page's whole 64 KiB (no other keepalive in client/); safety reports coalesced per task, sent first,
resent on false while the page lives; workers post serialized records.
Left for the protocol to price: page thread only, no outcome, the UA MAY delay, no headers (compression forces
RECEIVER), killed-visible-before-fill sends nothing. Proposed for all carriers: serialize where found; format work at
fill end, never in a hide handler.
Timings run: at hidden (A) and the hybrid; safety report at once.
Owner: the per-hide delta departs from the 2026-11-11 "sent once" brief; adopting it is the owner's.
