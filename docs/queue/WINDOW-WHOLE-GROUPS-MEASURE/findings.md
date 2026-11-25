# WINDOW-WHOLE-GROUPS-MEASURE: findings on PR 446

Written here because editing PR 446's body was refused to this session (2026-11-25 06:2x UTC); the fix session copies this to the body if it can.

Row **WINDOW-WHOLE-GROUPS-MEASURE** of `claude/work-ledger:docs/queue-2026-11-24.md`, 2026-11-25 06:06–06:20 UTC, by a session that wrote none of `candidates.md`, this PR or its build. Read: this PR at `e8a52cfe4` against `claude/unified` `b059388b6` (unmoved since the build), `candidates.md` §2, the row's brief. Run: the two test files, the mutants by hand, and two counting scripts built from `window.test.mjs`'s own harness (`claude/work-ledger:docs/queue/WINDOW-WHOLE-GROUPS-MEASURE/`, with every row). Not run: the gate (no code changed here), and the timed cells (below).

**The standing review rule.** `window.test.mjs` fails on the tip (268 forward, measured again) and passes here; `controller.test.mjs` 47/47. The PR's six mutants re-applied, each caught where the table says (M1, M4, M5 by `window.test.mjs`; M2, M6 by `controller.test.mjs`; M3 by both). A seventh, the `viewer.js` line's group length dropped, is caught by nothing, as the PR says. Nothing outside the eight files is touched.

**The count, tip against branch** (*measured*, frames on the stand-in wire; 50 frames, G = 8, W = 15, `dbts_b1`'s shape): forward 268 → 34, backward 280 → 40, a 24|23 sawtooth 48 → 0. G = 1 unchanged (35, 35, 6 on both). 64 frames: 392 → 48 each way. The prediction "each frame on the wire once a pass" holds for every pass counted.

**B1 (blocker). The want's neighbour group flips on a one-frame step, so a reader rocking at the flip point refetches a whole group every step: the defect moved, it did not go.** `nearestGroups` ranks groups by their distance from the current frame alone, so the set changes where two groups' distances cross. With two groups (`dbts_b1`) that is a group's middle: rocking 19|20 puts **48 frames on the wire in six steps (the tip's number)**, groups 1 and 3 by turns (`24…31, 8…15, 24…31, …`). With an even count it is the middle (`dbts_c1`'s W = 54, six groups: 35|36 → 48), with an odd count ≥ 3 the boundary itself (W = 24 or 31: 23|24 → 48), the case the brief names: "A sawtooth across a group boundary must not fetch a group twice." G = 16 at W = 40: 96 at 23|24. `window.test.mjs`'s sawtooth checks 23|24 at W = 15 only, the one point where two groups do not flip. Fix (any that holds): the set does not change while the current frame stays in its group (the neighbour chosen on entry, by the side entered from or the direction of travel — the brief's "or moving toward"), or a held group outranks an unheld one at a distance within G; and a test that rocks every adjacent pair 0|1 … n−2|n−1 at W = 15, 24 and 54 with G = 8 and finds no frame on the wire twice, mutated.

**m1.** The PR's limits say the gate's fixtures never meet the case; `dbts_c1` (69 × 976×2513, W = 54, *derived* from `docs/FIXTURES.md`) does meet it at six groups, so the fix's test should carry an even count over two.

**The timed cells** (1× and 4×, `dbts_b1-q8-g8`, relay LTE and clean: a step's time at the window's edge and the bytes, predicted ÷ 4 to ÷ 8) are **not run**: they would time code B1 changes. Appended for after the fix: WINDOW-WHOLE-GROUPS-FIX, -FIX-REVIEW and WINDOW-WHOLE-GROUPS-MEASURE-2 (the timed cells).

**Verdict.** One blocker (B1). Not yet for a sync row.

Fixtures and limits: synthetic 1×1 frames in series of 50, 64 and 69, the stand-in transport and decoders of `window.test.mjs`, each miss delivered before the next step; frames counted, no time, no bytes on a link, no browser, no DBT volume or ultrasound clip opened; `dbts_b1` and `dbts_c1`'s windows derived from `docs/FIXTURES.md`'s sizes at two bytes a sample. IMPROVE-1-REVIEW, which checks `candidates.md` §2's premise, has not run.

*How it serves the value statement:* a reader rocking over two slices is the commonest DBT motion; until B1 is fixed it still pays a group a step there.
