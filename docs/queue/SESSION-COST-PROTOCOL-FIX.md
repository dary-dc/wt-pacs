state: done
started: 2026-11-24T14:18Z
heartbeat: 2026-11-24T14:25Z
by: tk4SZCpd
outputs: claude/session-cost ef2309252 (docs/server/session-cost.md, docs/lines/codecs.md), PR 441 body §SESSION-COST-PROTOCOL-FIX; claude/work-ledger docs/queue/SESSION-COST-PROTOCOL-FIX/ (harness, raw output)
## Resume
2026-11-24T14:25Z: done. Next: SESSION-COST-PROTOCOL-FIX-REVIEW (a session that wrote none of PR 441, its review or this fix); SESSION-COST-RUN waits on it.
## Result
B1-B4, m1-m6 and the nit fixed in place in session-cost.md (§9 lists each).
* §3 from the product's code (the review's harness, rerun and reproduced; model.py retired).
* T1 (b059388b6) and T2 (PR 446) both pre-registered with §4's wire, CPU and length per cell; the run takes its pinned commit's.
* FIT's W set by FIT-ARM-BUILD, predicted at 15 (84.85 MB wire) and 63 (35.04 MB); on T2 dbts_b1 orders FIT@63 < A < FIT@15.
* PS3.18's rendered frames (viewport, window, image/jpeg) quoted, theory 7-32 MB a session; every claim kept to the frame retrieve.
* Corrected in place: "lowest server CPU" on dbts_b1 for FIT x3.5 fell under HTTP/2's x5.7-7.9; now dbts_a1 A, dbts_c1 A on T2, FIT at W 63.
Fixtures and limits: frames counted with 1x1 stand-ins and an instant transport; three timed DBT volumes of one dataset; usb_cine theory; JPEG bits a pixel an assumption.
Checks: check_links 0 unresolved, comment budget ok; gate not run (docs only).
No owner decision.
