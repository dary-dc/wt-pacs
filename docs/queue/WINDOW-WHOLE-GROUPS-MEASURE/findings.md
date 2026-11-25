# WINDOW-WHOLE-GROUPS-MEASURE: findings on PR 446

Written here because editing PR 446's body was refused to this session (2026-11-25 06:11 UTC); the fix session copies this to the body if it can.

Row **WINDOW-WHOLE-GROUPS-MEASURE** of `claude/work-ledger:docs/queue-2026-11-24.md`, 2026-11-25 06:06–06:20 UTC, by a session that wrote none of `candidates.md`, this PR or its build. Read: this PR at `e8a52cfe4` against `claude/unified` `b059388b6` (unmoved since the build), `candidates.md` §2, the row's brief. Run: the two test files, the mutants by hand, and two counting scripts built from `window.test.mjs`'s own harness (`claude/work-ledger:docs/queue/WINDOW-WHOLE-GROUPS-MEASURE/`, with every row). Not run: the gate (no code changed here), and the timed cells (below).

**The standing review rule.** `window.test.mjs` fails on the tip (268 forward, measured again) and passes here; `controller.test.mjs` 47/47. The PR's six mutants re-applied, each caught where the table says (M1, M4, M5 by `window.test.mjs`; M2, M6 by `controller.test.mjs`; M3 by both). A seventh, the `viewer.js` line's group length dropped, is caught by nothing, as the PR says. Nothing outside the eight files is touched.

**The count, tip against branch** (*measured*, frames on the stand-in wire; 50 frames, G = 8, W = 15, `dbts_b1`'s shape): forward 268 → 34, backward 280 → 40, a 24|23 sawtooth 48 → 0. G = 1 unchanged (35, 35, 6 on both). 64 frames: 392 → 48 each way. The prediction "each frame on the wire once a pass" holds for every pass counted.

**B1 (blocker). The want's neighbour group flips on a one-frame step, so a reader rocking at the flip point refetches a whole group every step: the defect moved, it did not go.** `nearestGroups` ranks groups by their distance from the current frame alone, so the set changes where two groups' distances cross. With two groups (`dbts_b1`) that is a group's middle: rocking 19|20 puts **48 frames on the wire in six steps (the tip's number)**, groups 1 and 3 by turns (`24…31, 8…15, 24…31, …`). With an even count it is the middle (`dbts_c1`'s W = 54, six groups: 35|36 → 48), with an odd count ≥ 3 the boundary itself (W = 24 or 31: 23|24 → 48), the case the brief names: "A sawtooth across a group boundary must not fetch a group twice." G = 16 at W = 40: 96 at 23|24. `window.test.mjs`'s sawtooth checks 23|24 at W = 15 only, the one point where two groups do not flip. Fix (any that holds): the set does not change while the current frame stays in its group (the neighbour chosen on entry, by the side entered from or the direction of travel — the brief's "or moving toward"), or a held group outranks an unheld one at a distance within G; and a test that rocks every adjacent pair 0|1 … n−2|n−1 at W = 15, 24 and 54 with G = 8 and finds no frame on the wire twice, mutated.

**m1.** The PR's limits say the gate's fixtures never meet the case; `dbts_c1` (69 × 976×2513, W = 54, *derived* from `docs/FIXTURES.md`) does meet it at six groups, so the fix's test should carry an even count over two.

**The timed cells** (1× and 4×, `dbts_b1-q8-g8`, relay LTE and clean: a step's time at the window's edge and the bytes, predicted ÷ 4 to ÷ 8) are **not run**: they would time code B1 changes. Appended for after the fix: WINDOW-WHOLE-GROUPS-FIX, -FIX-REVIEW and WINDOW-WHOLE-GROUPS-MEASURE-2 (the timed cells).

**Verdict.** One blocker (B1). Not yet for a sync row.

Fixtures and limits: synthetic 1×1 frames in series of 50, 64 and 69, the stand-in transport and decoders of `window.test.mjs`, each miss delivered before the next step; frames counted, no time, no bytes on a link, no browser, no DBT volume or ultrasound clip opened; `dbts_b1` and `dbts_c1`'s windows derived from `docs/FIXTURES.md`'s sizes at two bytes a sample. IMPROVE-1-REVIEW, which checks `candidates.md` §2's premise, has not run.

*How it serves the value statement:* a reader rocking over two slices is the commonest DBT motion; until B1 is fixed it still pays a group a step there.

## Re-review

WINDOW-WHOLE-GROUPS-FIX-REVIEW, 2026-11-25 07:48–08:10 UTC, by a session that wrote none of PR 446, its measure or its
fix (`by:` in its status file). Read: the fix `e8a52cfe4..0e273ee92` (`git diff --stat`: `client/view/controller.js`,
`client/view/window.test.mjs`, `docs/client/evidence/what-a-view-asks-for.md`, `docs/lines/client.md`, nothing else);
PR 446's body at 07:50; this file. Run (node 22.23.5, a 4-core cloud container): both test files on `0e273ee92`; the new
test against `e8a52cfe4`'s `controller.js`; four mutants; `entries.mjs` (here, `wantFrom` alone) on both; the test's
harness at a two-frame rock; `scripts/comment_budget.sh`, `scripts/check_links.py`. Not run: the gate (the fix's full gate
at `0e273ee92`, GATE OK in 782 s, stands; this review changed no code).

* **B1: closed.** *Measured:* the rocking test fails with `e8a52cfe4`'s `controller.js` at the first flip ("W = 15,
  rocking over 11|12": `16…23, 0…7` three times, 48 frames) and passes on `0e273ee92` with the other two tests (54 s);
  `controller.test.mjs` 47/47. Mutants, each applied and reverted: M7 (the rank's `- wanted.has(j)` dropped), M8 (the
  controller never stores `wanted`), M11 (the sign flipped) fail it as the PR says; a new one, M13 (a half-frame rank,
  `wanted.has(j) / 2`, so only the tie moves), fails at 11|12 too. *Theory, checked:* with the bonus of one and ties to
  the later group, a switch to an unwanted group *u* over a wanted *w* needs gap(*u*) ≤ gap(*w*) − 1 (*u* later) or
  − 2; the switch back then needs a swing of at least −2 − (+1) in the other direction, more than a one-frame step's
  two. The body's "at least two frames nearer" omits the tie's case (r-n1); the conclusion holds. The fix is the
  rank margin, not B1's two named options (the set kept while in the group; a held group outranking within *G*); B1
  said "any that holds", and the brief's criterion is the adjacent-pair test, which holds.
* **m1: closed.** The test carries W = 54 over 69 (six groups); the PR's limits line is corrected in place, dated.
* **r-m1 (minor). The cost line is wrong for a forward pass.** PR 446's §What it costs and `what-a-view-asks-for.md`
  say "on a pass the next group is asked one frame later than before (at W = 15 … at frame 21 rather than 20)".
  *Derived* from `wantFrom` alone (`entries.mjs`, `ascending` both ways): forward, every group enters at the same frame
  on both commits (W = 15: 12, 20, 28, 36, 44; W = 24, 54 and G = 16 at W = 40 likewise), since a tie already goes to the
  later group; backward, one frame later (W = 15: 42, 34, 26, 18, 10 against 43, 35, 27, 19, 11), so the lead behind
  falls from 4 frames to 3. Fix: both places say "backward only, one frame". Not built here (a review).
* **r-m2 (minor, a trade-off for MEASURE-2 and BRIEF-WEEKEND). The two-frame rock.** *Measured* with the test's
  harness: a rock *x*|*x* + 2, each pair reached from either side, puts a frame on the wire twice on 10 of 96 starts at
  W = 15 and 8 of 96 at W = 24, worst 48 frames in six steps (the fix's limits say "22 pairs"; the count's method
  differs, the finding stands). *Derived* (`wantFrom` alone): set changes 10/20 at widths 2/3 at W = 15 (the tip:
  10/20/30 at widths 1/2/3). A margin of *M* holds rocks *M* wide and, by r-m1, costs only the backward lead (*M*
  frames), not the forward one; at W = 15 *M* = 3 would leave a backward lead of 1. Not a blocker: the brief and B1
  ask the one-frame rock, and the trade-off is named. MEASURE-2's timed cells should time the backward edge, not only
  the forward; the margin is one line for BRIEF-WEEKEND's table if a wider rock is to be held.
* **r-n1 (nit).** The body's "a switch needs the unwanted group at least two frames nearer": one, when it is the later.
* **r-n2 (nit).** The rocking test's 56 s: both sweeps kept (each pair reached with a different history); no cut.

`scripts/comment_budget.sh` ok; `scripts/check_links.py` 0 unresolved (428 files) on `0e273ee92`.

**Verdict.** No blocker open. WINDOW-WHOLE-GROUPS-MEASURE-2 may run (its brief: the timed cells on the fixed branch);
r-m1 is a two-line doc fix any later session on the branch may take, r-m2 is for MEASURE-2 and BRIEF-WEEKEND. A sync
row merges PR 446 only after MEASURE-2, a non-regressor.

Fixtures and limits: synthetic 1×1 frames in series of 50 and 69, G = 8 and 16, the stand-in transport and decoders of
`window.test.mjs`, each miss delivered before the next step; `entries.mjs` runs `wantFrom` alone, without the store or
the downloader. Frames counted, no time, no bytes on a link, no browser; no DBT volume or ultrasound clip opened;
`dbts_b1`'s W = 15 and `dbts_c1`'s W = 54 as the measure derived them. IMPROVE-1-REVIEW has not run.

*How it serves the value statement:* the one-frame rock, the commonest DBT motion, now costs nothing on the wire; the
backward edge and wider rocks are what remain for "low latency on every jump".
