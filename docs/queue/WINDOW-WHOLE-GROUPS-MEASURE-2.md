state: done
started: 2026-11-25T08:07Z
heartbeat: 2026-11-25T09:41Z
by: S8Un381p
outputs: claude/work-ledger docs/queue/WINDOW-WHOLE-GROUPS-MEASURE/ (steps.mjs, steps_summary.py, steps.jsonl, steps-bare.jsonl, steps-summary.txt, README.md §The timed cells, findings.md §Timed cells); PR 446 body §WINDOW-WHOLE-GROUPS-MEASURE-2; claude/window-whole-groups fb784125d (docs/lines/client.md); rows WINDOW-WHOLE-GROUPS-FIX-2, -FIX-2-REVIEW, -MEASURE-3 appended
## Resume
Done. Next: WINDOW-WHOLE-GROUPS-FIX-2 (a session that wrote none of PR 446, its measures, fixes or reviews). MEASURE-3 reruns
steps.mjs as README.md §The timed cells says (trees built as this file's history records).
## Result
* Timed cells, tip 9170cdf39 vs 9170cdf39 + PR 446 0e273ee92 (local merge), dbts_b1-q8-g8, CLEAN and LTE (plan.mjs forms), 1x and 4x, 4 rounds, A/A pairs; 56 of 64 visits kept, 16 bare.
* Bytes a pass, measured: /1.3 to /3.3 (predicted /4 to /8: a miss in every cell); the branch's frames 34 and 40 a pass, the stand-in's.
* Forward waits: none on the branch on CLEAN and LTE 4x (tip 1-14 steps, up to 10 s a pass); LTE 1x 6.9 s vs 15 s.
* B1 (blocker): a backward step into each group's last frame (31, 23, 15, 7) waits for the group: CLEAN 0.67-0.84 s a pass at 1x, 4.8-5.0 s at 4x, 3-7x the tip's. Not a non-regressor; FIX-2, FIX-2-REVIEW, MEASURE-3 appended (round two).
* m1: on LTE 1x a group in flight when the want moves restarts at its keyframe (downloader; BRIEF-WEEKEND's list). m2: the tip fails a pass in 4 of 32 visits and 1 of 8 bare (frame N of its group did not decode); the branch 1 of 32, 0 of 8. m3: the prediction's bytes missed.
* Fixtures and limits: dbts_b1 only (W 15, G 8), no ultrasound; 4-core cloud, no GPU, headless Chromium, software WebCodecs, page view only; 4x a thread throttle, cores not recorded; userspace relay, LTE without blackout; one reader pace (300 ms dwell).
* Docs only beyond the rows: check_links 0 unresolved, comment budget ok on claude/window-whole-groups; gate not run (no code changed).
* No owner decision.
