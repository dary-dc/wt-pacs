state: done
started: 2026-11-24T08:26Z
heartbeat: 2026-11-24T09:53Z
by: wd7duMyJ
outputs: claude/session-cost f1d5a5268 (docs/server/session-cost.md), draft PR 441 → claude/unified
## Resume
Done. First session (XtZq6YAP) pushed model.py and model-output.txt beside this file. This session (wd7duMyJ) resumed
it after it stalled at 08:32 and wrote the protocol on claude/session-cost, from claude/unified b059388b6.
check_links: 0 unresolved; comment budget: ok. No gate run (docs only). PR 441 opened.
## Result
docs/server/session-cost.md pre-registers a reading session: open, three drilling strokes, a pass, three dwells with jumps.
Arms A, A+C1, B, FIT; CLEAN and CR; 8+4 rounds in a Williams square; usb_cine B as a function check.
Theory (model.py): the view thrashes on dbts_b1 under W = 15. A asks 764 frames and 355.7 MB against B's 284.6 MB.
Predicted bytes = MB asked × 1.037–1.04. Predicted CPU = 5.0–6.5 ms a MB. Peak RSS 1–5 MB for every arm.
Both derived from the 2026-11-23 delivery and transport-arms rows.
Cheapest per session: A on dbts_a1 and dbts_c1 (5.9–15× fewer MB); FIT on dbts_b1 (3.5× fewer than B).
DICOMweb reference (PS3.18 2026e, quoted) is theory only. It costs B's bytes within 1 %.
Its HTTP/2 path's process CPU a MB is about 1/7 of WebTransport's on transport-arms (softirq not counted).
So "lowest CPU" holds only where the bytes saved outweigh that.
Fixtures and limits: 3 DBT volumes of one dataset; usb_cine is lossy-sourced; one 4-core host, no GPU; userspace relay; one session at a time.
Next: SESSION-COST-PROTOCOL-REVIEW (findings in PR 441's body). If WINDOW-WHOLE-GROUPS merges first, §3 is amended before the run.
