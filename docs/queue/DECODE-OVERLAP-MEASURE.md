state: done
started: 2026-11-25T06:17Z
heartbeat: 2026-11-25T06:56Z
by: 8rHJATFk
outputs: claude/work-ledger docs/queue/DECODE-OVERLAP-MEASURE/ (findings.md, README.md, rows.jsonl, summary.md, bench.js, run.mjs, busy.py); PR 447 (body edit refused)
## Resume
Done. Nothing left. PR 447's body could not be edited from this session (refused); findings.md is the record.
## Result
* Standing review: each of PR 447's new tests fails with its file reverted to the tip; cccac3363 is caught by the
  dispatch rig (788/789), cfb7c6a04 by depth-cut.browser.mjs (2 failed); nothing else touched; no blocker.
* Measured, decode bench (three product decoder workers, coded bytes in memory), 6 rounds, Williams order, A/A arm:
  fill -10 to -19 % (1x: -15, -12, -19 %; 4x: -16, -10, -10 % on a1, b1, c1), predicted -14 to -27 %.
* A request at offset 7: -21 to -26 % at 4x (predicted -18 to -32 %), unchanged at 1x (a miss); offset 3 -7 to -29 % at
  4x, unchanged at 1x; offset 0 unchanged at 1x, +13 %, -8 %, +16 % at 4x: inside the A/A spread, not decided.
* A/A medians 0.94-1.09. Every frame on av1-webcodecs, none failed, samples identical across arms.
* The host saturates: at 1x the branch keeps 2.9-3.6 of 4 cores busy (tip 2.4-2.8); nothing claimed past it.
* Verdict: a non-regressor on the fill and offsets 3 and 7; left for a sync row (amendment 28 rule 1).
* Fixtures and limits: dbts_a1 (cut), dbts_b1, dbts_c1 (cut) at Q 8 G 8 coded here; a 4-core cloud host, headless
  Chromium, software WebCodecs; 4x by cgroup throttle, not a phone; the bench, not the view; no wire, Firefox,
  ultrasound or phone.
