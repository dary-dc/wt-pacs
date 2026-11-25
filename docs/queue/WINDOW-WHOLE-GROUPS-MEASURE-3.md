state: done
started: 2026-11-25T11:47Z
heartbeat: 2026-11-25T13:28Z
by: tbvS32jH
outputs: claude/work-ledger 96c98cd63 (docs/queue/WINDOW-WHOLE-GROUPS-MEASURE/: steps-3.jsonl, steps-3-summary.txt, README.md §The timed cells again, findings.md §Timed cells again); PR 446 body §WINDOW-WHOLE-GROUPS-MEASURE-3; claude/window-whole-groups 15edbfcb7 (docs/lines/client.md)
## Resume
Done. Next: a sync row (UNIFIED-SYNC-1126) may merge PR 446 (no blocker open, a non-regressor); its docs/lines/client.md conflict is the sync's.
## Result
* Timed cells again: origin/claude/unified 8459a0a7b vs 8459a0a7b + PR 446 94d447835 (local merge, not pushed), dbts_b1-q8-g8, page view, CLEAN and LTE, 1x and 4x, A/A pairs interleaved (lab/order.mjs); 4 rounds + 2 more of LTE only (VOIDs); 80 visits, 60 kept (19 VOID relay self-timing, 1 tip failure).
* Prediction written before any row (README.md §The timed cells again, 1187f17b9).
* Measured: on CLEAN 1x and 4x and LTE 4x the branch waits on no step either way (tip: 1-6 waits, up to 9.5 s a pass); MEASURE-2's B1 closed in time.
* LTE 1x: waited sum /10 forward, /2.4 backward; the four backward waits at 31, 23, 15, 7 remain (o1: prediction 2 missed, not diagnosed).
* Bytes a pass /1.4 to /3.2 (the brief's /4 to /8 missed, as predicted from MEASURE-2's m3). A/A MB 0.94-1.03.
* Verdict: no blocker; PR 446 a non-regressor on these cells; a sync row may merge it. MEASURE-2's m1 and o1 for BRIEF-WEEKEND's list.
* Fixtures and limits: dbts_b1 only (W 15, G 8), no ultrasound, no other DBT volume; 4-core cloud, no GPU, headless Chromium, software WebCodecs, page view only; host near saturation at 4x (load ~3.2), only order claimed there; 4x a thread throttle, not a phone; userspace relay, LTE without blackout; one reader pace; the reversal's cost not timed.
* No owner decision.
