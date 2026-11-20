state: done
started: 2026-11-20T03:16Z
heartbeat: 2026-11-20T03:20Z
outputs: `claude/device-theory` `5902a944` (B1), `cf9f0b43` (B2, m1-m6, `docs/lines/client.md`); PR 414 body §DEVICE-THEORY-FIX
## Resume
Done. Next: DEVICE-THEORY-FIX-REVIEW (a session that wrote none of the fix or the review), closed by 11-21 16:00.
## Result
Docs only; check_links and the comment budget green; the gate not run; nothing measured, no new source.
B1, pushed 2026-11-20 03:19 UTC, inside the pre-registration: cell 2's bands derived (fill = max(wire, floor) + rest
0.22-0.35 s, A; A on dbts_a1 from dbts_b1's measured fill × the cloud's view work ratio 0.247). B ÷ A 0.50-0.74 on
dbts_b1 (8 of 8 below 1), 0.93-1.58 on dbts_a1 (0-2 of 8); pooled 8-10 of 16, under 13; median 0.72-1.16. Outcome
unchanged: *no difference shown*; *B faster* only if the link gives over ~760-800 Mbit/s.
B2: the premium view band 33-48 ms (was 25-48, an unstated input); write rate 355-516 MB/s, view crossover 77-112.
m1-m6 in place; m5: the phone named as docs/devices.md §4 does. Old bands kept in dated correction lines.
Fixtures: three timed DBT volumes of one dataset, 4-core cloud hosts, one phone on one home link (inputs only).
