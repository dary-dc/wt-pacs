state: done
started: 2026-11-25T06:08Z
heartbeat: 2026-11-25T06:11Z
by: 6p2QAbap
outputs: claude/work-ledger docs/queue/WINDOW-WHOLE-GROUPS-MEASURE/ (findings.md, README.md rows, count.mjs, rock.mjs); PR 446 (body edit refused); rows WINDOW-WHOLE-GROUPS-FIX, -FIX-REVIEW, -MEASURE-2 appended
## Resume
Done. The review half and the frame counts are pushed; the timed cells wait for the fix (WINDOW-WHOLE-GROUPS-MEASURE-2).
## Result
* Standing review: window.test.mjs fails on the tip b059388b6 and passes on e8a52cfe4; PR 446's six mutants each caught as its table says; the viewer.js line caught by nothing (the PR says so).
* Counts, measured (frames on the stand-in wire, 50 frames, G 8, W 15): forward 268 -> 34, backward 280 -> 40, sawtooth 24|23 48 -> 0; G 1 unchanged.
* B1 (blocker): the want's neighbour group flips on a one-frame step; rocking 19|20 at dbts_b1's shape still puts 48 frames on the wire (the tip's number); dbts_c1's shape (W 54) at 35|36 the same; odd counts >= 3 at the boundary itself (W 24: 23|24 -> 48).
* m1: dbts_c1 meets the case at six groups; the fix's test should carry an even count over two.
* Timed cells (1x, 4x, dbts_b1-q8-g8, LTE and clean) not run: they would time code B1 changes; WINDOW-WHOLE-GROUPS-MEASURE-2 runs them after the fix.
* Fixtures and limits: synthetic 1x1 frames, stand-in transport and decoders; frames only, no time, bytes on a link or browser; window sizes derived from docs/FIXTURES.md; IMPROVE-1-REVIEW not yet run.
* PR 446's body could not be edited from this session (refused); findings.md is the record.
