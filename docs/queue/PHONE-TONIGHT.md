state: done
started: 2026-11-22T15:44Z
heartbeat: 2026-11-22T15:52Z
outputs: claude/phone-run 493f5ed5 (round_plan.mjs count flags + test), adec573c (next-round.md amendment: the short counts), bf988d20 (docs/phone-rows/TONIGHT.md)
## Resume
Done. The owner picks SHORT or FULL in TONIGHT.md; the run session follows it. Owed: docs/lines/devices.md (left
untouched: this row's scope was lab/devices/ and docs/phone-rows/ only).
## Result
* Short counts: --bench-reps 1 --rounds 12 --pairs 1, 66 loads: counted ~43 min, ~46 min with the warm-ups
  (derived from next-round.md §6's per-load times, which give the full 144 loads 130 min); ~1 h of phone in all.
* Cell 1 (1 repetition + drift): every arm read once, provisional (no spread across repetitions).
* Cell 2 (12 rounds, 6 a series): same rule at n = 12, 10 of 12 (p 0.039) + median <= 0.95, provisional;
  8 rounds would need 8 of 8, no margin. Device model's §2 predicts 6-8 of 12: no difference shown.
* Cell 3 (1 pair): unreachable, every measure and guard not decided (needs 16 pairs, ~45 min alone); the pair
  measures the cell's per-load time on the phone. The view's verdict is left to FULL.
* Cell 4 only if time is left. All counts set after pre-registration: next-round.md §Amendment 2026-11-22.
* Task 1: round.test.mjs 7/7; two mutants (counts under --quick's; --bench-reps to a wrong key) each fail it;
  beacon, plan, round_test.py, collector tests and comment_budget pass. Full gate not run.
* Guide adds dumpsys battery/thermalservice before and after, kept out of the commit if they name a serial or IMEI;
  strips the worktree and home paths from the plan. Anchored pkill patterns checked against real argv.
* Fixtures: container only, node 22, no phone, no adb, no NODE wrapper.
