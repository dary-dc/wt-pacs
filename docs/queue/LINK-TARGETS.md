state: done
started: 2026-11-14T19:02Z
heartbeat: 2026-11-14T19:12Z
outputs: claude/link-targets a3b35708 (from origin/claude/docs-client 526a54af), draft PR #386 into claude/docs-client
## Resume
Done. a3b35708: docs/transport/link-profiles.md (new); docs/client/design.md §Open delivery comparison +1 line; docs/lines/client.md §Owed runs. Gate not run (docs only); comment_budget.sh passes.
## Result
Theory and sources only; nothing run. Fixtures: dbts_b1 bytes (50 frames; view Q8 G8 464 KB a frame, exact 2.15 MB), one phone's decode (Chrome 157, software WebCodecs, ~45 ms effective), one fitted link (home Wi-Fi, server on the same router, a best case).
Six profiles quoted verbatim with URL, date, region, method; ITU-R M.2410 numbers labelled targets.
The view is decode-bound above ~83 Mbit/s goodput (median home Wi-Fi, 5G, mmWave) and wire-bound below (LTE, one far stream, every p10).
HTJ2K is wire-bound below ~470-660 Mbit/s IF its phone decode keeps the cloud's 1.24-1.74 ratio: unmeasured; it decides whether B beats A on the decode-bound profiles.
The exact frame on request is round-trip bound: 5-8 round trips of slow start after a silence (0.04-0.53 s), 6 MiB / goodput behind a fill.
Cubic's loss bound (RFC 9438): one session at 0.01 % random loss and 60 ms is ~20 Mbit/s, so loss reaching the transport is the other open fact.
Length moves bytes, memory and cache, not the regime. netem forms per profile, assumed; above the rig's ~58-100 Mbit/s only scaled forms (queues, not fill times).
Not reached: Opensignal, Ofcom (403), Sui and Fezeu hosts, Jiang. Hospital Wi-Fi: no measurement exists.
Owner decision: none; the first phone cell owed is HTJ2K's decode per frame.
