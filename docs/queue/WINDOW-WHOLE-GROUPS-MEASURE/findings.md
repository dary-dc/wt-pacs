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

## Timed cells (WINDOW-WHOLE-GROUPS-MEASURE-2)

WINDOW-WHOLE-GROUPS-MEASURE-2, 2026-11-25 08:07–09:45 UTC, by a session that built none of PR 446, its measure, fix or
re-review (`by:` in its status file). The brief's timed cells, on the fixed branch: `origin/claude/unified` `9170cdf39`
(the tip) against `9170cdf39` with PR 446's `0e273ee92` merged locally (`--no-ff`, never pushed; its code diff is PR 446's
seven files; `docs/lines/client.md`'s conflict taken from the tip). The rig, its forms and the prediction, written before
any row: `README.md` §The timed cells; rows `steps.jsonl` (64 visits: 4 rounds × CLEAN, LTE × 1×, 4× × `tip-a`, `tip-b`,
`pr-a`, `pr-b`, `lab/order.mjs`'s order), `steps-bare.jsonl` (16 visits without the port instrumentation, CLEAN and LTE at
1×), `steps-summary.txt` (`steps_summary.py`). 56 of 64 rows kept: 4 VOID by the relay's self-timing, 4 failed (below).
Every number here is *measured*: the median over rounds of each arm, the A/A pairs beside each other.

| form, rate | pass | MB on the wire, tip → branch | steps that waited: count, sum of their times, tip → branch | against ÷ 4 to ÷ 8 |
| --- | --- | --- | --- | --- |
| CLEAN 1× | forward | 49.4, 48.7 → 15.8 (÷ 3.1) | 1, 0.12–0.22 s → **0** | bytes miss; time beyond (÷ ∞) |
| CLEAN 1× | backward | 45.4, 47.2 → 18.7 (÷ 2.5) | 0–2, 0–0.27 s → **4, 0.67–0.84 s** | bytes miss; time **reversed** (× 3–5 slower) |
| CLEAN 4× | forward | 52.6, 50.4 → 15.8 (÷ 3.3) | 4–6, 1.1–1.7 s → **0** | bytes miss; time beyond |
| CLEAN 4× | backward | 43.5, 42.7 → 18.7 (÷ 2.3) | 2–3, 0.39–1.01 s → **4, 4.8–5.0 s** | bytes miss; time **reversed** (× 5–7 slower) |
| LTE 1× | forward | 33.7, 34.6 → 23.3 (÷ 1.5) | 24, 14.6–15.5 s → 6, 6.9 s (÷ 2.2) | both miss |
| LTE 1× | backward | 25.4, 24.3 → 18.7 (÷ 1.3) | 4, 8.9–9.7 s → 4, 8.0–8.7 s (÷ 1.1) | both miss (a tie on time) |
| LTE 4× | forward | 36.0, 34.4 → 15.8 (÷ 2.2) | 13–14, 9.1–10.4 s → **0** | bytes miss; time beyond |
| LTE 4× | backward | 31.2, 31.2 → 18.7 (÷ 1.7) | 2, 6.0–6.4 s → 4, 6.2–6.5 s (÷ 0.97; the longest ÷ 1.9) | both miss |

A/A: each pair's MB within 0.96–1.05; the branch's waited sums within 0.95–1.27; the tip's, with one to six waits a pass,
0.54–2.58. The branch's frames a pass are the same in every kept row but LTE 1× forward (49–51): 34 forward, 40 backward,
the stand-in wire's counts exactly (§The count); the tip's 104–113 forward on CLEAN and 72–77 on LTE, not the stand-in's
268: the real downloader replaces a want's unsent asks, which the stand-in delivers whole.

**B1 (blocker). A backward step into a group waits for the whole group, where the tip did not.** On CLEAN the branch waits
on four steps a backward pass, always 31, 23, 15 and 7 (each group's last frame): 0.12–0.25 s each at 1×, 0.96–1.39 s at
4×, sum × 3–5 and × 5–7 the tip's. *Theory*: a backward entry lands on a group's last frame, which needs its group decoded
from the keyframe; the branch wants the group behind three frames before its last (r-m1, *derived*), and three steps at
this rig's pace (a 300 ms dwell and the paint) are shorter than a group's wire and eight chained decodes here. The tip held
frames on both sides of the one in view, so going back met them held. It is "low latency on every jump" lost in the
commonest reversal, so the branch is not a non-regressor. Fix (any that holds, the brief's own words first): the
neighbour group chosen by "the side the reader is … moving toward" — moving back, the group behind is wanted from the
group's first backward step, a lead of up to G − 1 frames — or r-m2's wider margin; a test that on a backward pass at W =
15, G = 8 the group behind is wanted at least G − 1 steps before its last frame is reached, failing on `0e273ee92`,
mutated; the one-frame rock's test kept. What it costs (forward lead, a reader reversing) stated in the PR body.

**m1 (minor, not PR 446's; for BRIEF-WEEKEND's list).** On LTE 1× a group still in flight when the want moves is asked
again from its keyframe: the branch delivers frames 24–28, 32–36 and 40–45 twice a forward pass and waits 2.2–3.0 s at 32
and 48 (1.2 s at 40), in all four rounds; at 4× (slower steps) it never does. The tip does it more (72–77 frames). The
downloader's "a group is asked whole, from its keyframe" against a moving want; a downloader row, not this PR's.

**m2 (minor, an observation for the sync row). The tip fails a pass; the branch rarely.** The tip: 4 of 32 instrumented
visits (CLEAN 1× "no paint in 60 s" at forward 32, forward 42, backward 21; CLEAN 4× "error: frame 38: frame 37 of its group
did not decode") and 1 of 8 bare visits (LTE 1×, "error: frame 44: frame 43 of its group did not decode"): reproduced with
no instrumentation, so the product's. The branch: 1 of 32 instrumented (LTE 1× backward 36, "no paint in 60 s"), 0 of 8
bare. Not diagnosed here; the group-decode failure under the tip's refetching is a point for PR 446 once B1 is closed.

**m3 (the prediction).** The bytes' ÷ 4 to ÷ 8 missed in every cell (÷ 1.3 to ÷ 3.3): the ratio was taken from the
stand-in's tip count, which the real downloader halves. The branch's own counts are the stand-in's.

**Verdict.** One blocker (B1). PR 446 is not a non-regressor: no sync row merges it. The fix loop's second round is
appended (WINDOW-WHOLE-GROUPS-FIX-2, -FIX-2-REVIEW, -MEASURE-3); a blocker left after it is the owner's.

Fixtures and limits: `dbts_b1-q8-g8` and its exact series `dbts_b1` (50 frames, 2560 × 3328, 10-bit, W = 15, G = 8)
only, coded here by `ingest_coded.py` as `scripts/demo-series.sh` does; no ultrasound clip, no other DBT volume (`dbts_c1`,
W = 54, not timed). One 4-core cloud container, no GPU, headless Chromium, software WebCodecs and WebGL (SwiftShader), the
page view only (the worker view's frames do not pass the page's ports); 4× by `cpu_throttle.mjs`'s per-thread cap from
the end of the fill (its check: 1× 144 ms, 4× 684 ms), not a phone; the host's cores not recorded, so where it saturates
is not stated and nothing is claimed of the 4× cells but the arms' order. A userspace relay (`link_impair.py`, its own
core), not a radio; LTE without its 30 s blackout. One reader pace (a 300 ms dwell after each paint), one pass each way
from frame 0 after the window's fill. Bytes are the frames' coded bytes handed to the page, not packets.

*How it serves the value statement:* the branch cuts a pass's bytes by 1.3 to 3.3 and every forward wait on CLEAN; until
B1 is fixed it makes the backward jump slower, which "low latency on every jump" does not allow.

## FIX-2 (WINDOW-WHOLE-GROUPS-FIX-2)

WINDOW-WHOLE-GROUPS-FIX-2, 2026-11-25 10:27–, by a session that wrote none of PR 446, its measures, fix or reviews (`by:`
in its status file). §Timed cells B1 on `claude/window-whole-groups`.

* **Which fix holds.** r-m2's wider margin cannot: with two groups (W = 15, G = 8) a margin *M* on the wanted group moves
  the backward switch later, not earlier (*derived*: the group behind wins at position *p* of a group only when
  *p* + 1 < 8 − *p* − *M*, so its lead is 3 at *M* = 1 and shrinks as *M* grows; G − 1 = 7 needs *p* = 6). So the brief's own words: the neighbour the reader is moving toward.
* **The failing test first (`d0b7adeb8`).** `window.test.mjs`, "a backward pass wants the group behind G − 1 steps ahead of
  its last frame": after a forward pass, a backward pass at W = 15, G = 8 over 50 frames; each group's last frame must
  cross the wire at least G − 1 steps before it is shown. On `0e273ee92`'s code: "frame 7, its group's last, on the wire
  3 steps before it is reached" (*measured*, the stand-in transport).
* **The change (`4bfc75247`, `client/view/controller.js`).** The controller keeps the last step's sign; `toward` is that
  sign once two steps in a row agree, else 0, so a one-frame rock sets no direction. In `nearestGroups` the neighbour
  `toward` ranks a whole group (`g`) nearer. With three groups or more both neighbours are in the window already, so only
  the two-group case changes which groups are held.
* **Measured** (node 22.23.5, 4-core cloud container): `window.test.mjs` 4/4 (the rocking test kept, unchanged);
  `controller.test.mjs` 47/47. Mutants, each on a copy of `client/`: M14 the bonus dropped, M15 `toward` never set, M16
  its sign flipped, M18 the bonus G − 2: each fails the new test (leads 3, 3, 0, 6); M17 one step sets the direction:
  the sawtooth test fails (23|24: groups 4 and 2 by turns, 48 frames). The rocking test passes the rest.
* **Derived** (`toward.mjs` here, `wantFrom` alone, on both commits), steps from a group's entering the want to its
  frame reached:

  | n / G / W | forward lead, 0e273ee92 → now | backward lead | reader turning back p frames into a group, the group behind |
  | --- | --- | --- | --- |
  | 50 / 8 / 15 | 4 → 8 | 3 → 7 | p 1–3: held → 1, 2, 3; p 4: 3 → 3; p 5–7: 3 → 4, 5, 6 |
  | 50 / 8 / 24 | 8 → 8 | 7 → 8 | held → held |
  | 69 / 8 / 54 | 20 → 20 | 19 → 19 | held → held |
  | 50 / 16 / 40 | 8 → 16 | 7 → 15 | p 1–7: held → p; p 8–15: 7 → p − 1 |

  **The cost:** a reader who turns back early in a group (p ≤ 3 at G = 8) finds the group behind let go (it went on
  entering the group, where before it stayed to the group's middle) and asked p steps before reaching it. Its time,
  and whether 7 steps cover a group's wire and decode at 4×, are MEASURE-3's.

Fixtures and limits: synthetic 1×1 frames, 50 and 69, G = 8 and 16, the stand-in transport and decoders of
`window.test.mjs`, each miss delivered before the next step; `toward.mjs` runs `wantFrom` alone, feeding it the controller's
rule. Frames and steps counted; no time, no bytes on a link, no browser beyond the gate; no DBT volume or ultrasound clip
opened. The cost of a reversal is derived, not timed. Rocks two frames wide (r-m2) not re-counted.

*How it serves the value statement:* "low latency on every jump" on the commonest reversal, a backward pass, with the forward
lead doubled; a reader turning back early in a group is the price, timed next.

## Re-review 2

WINDOW-WHOLE-GROUPS-FIX-2-REVIEW, 2026-11-25 11:08–11:45 UTC, by a session that wrote none of PR 446, its measures, fixes
or reviews (`by:` in its status file). Read: `0e273ee92..94d447835` (`git diff --stat`: `client/view/controller.js`,
`client/view/window.test.mjs`, `docs/client/evidence/what-a-view-asks-for.md`, `docs/lines/client.md`; nothing else);
PR 446's body at 11:30; §Timed cells and §FIX-2 above. Run (node 22.23.5, a 4-core cloud container): both test files on
`94d447835`; the new test with `0e273ee92`'s `controller.js`; five mutants of this review's own; `toward.mjs` on both
commits; `reach.mjs` and `reach-repeat.mjs` (here); `scripts/comment_budget.sh`, `scripts/check_links.py`. Not run: the
gate (FIX-2's full gate at `94d447835`, GATE OK in 937 s, stands; this review changed no code).

* **§Timed cells B1: closed (in the count; its time is MEASURE-3's).** *Measured:* `window.test.mjs` 4/4 in 58 s and
  `controller.test.mjs` 47/47 on `94d447835`; with `0e273ee92`'s `controller.js` the new test fails, "frame 7, its group's
  last, on the wire 3 steps before it is reached". The test is not vacuous: with a probe, all five group ends it checks (7,
  15, 23, 31, 39) cross the wire during the backward pass, each exactly 7 steps ahead. *Derived, recomputed:* `toward.mjs`
  reproduces §FIX-2's table on both commits, every cell. The fix is the brief's first option ("the neighbour group by the
  direction of travel"); FIX-2's argument that r-m2's margin cannot give the lead holds (at W = 15, *M* moves the switch later).
* **The invariant the types do not enforce, checked.** With a bonus of `g` a neighbour could in principle outrank the
  frame's own group (unreachable sets give it: c = 15, toward −1, wanted {0, 2, 3, 4}). *Measured* over every state the rule
  reaches from frame 0 (`reach.mjs`; one- and two-frame steps, and separately every jump; n/G/W 50/8/15, 50/8/24, 69/8/54,
  50/16/40, 64/8/15, 20/8/15; 75–271 states each): the current frame is first in the want in every reached state, and
  recomputing the want three times at a state (the page view's `#have()` calls `want()` again) never changes it.
* **Mutants of this review** (each on a copy of `client/`, both test files): MF, a rock keeps the last direction
  (`: 0` → `: this.#toward`), is caught by the sawtooth test (23|24, 48 frames). Survivors, each argued: MA, the
  `toward !== 0 &&` guard dropped, is equivalent (with toward 0 the bonus lands on the frame's own group, which is always
  held: r2-n1); MB, the sign without the modulo, differs only at a wrap, which no test steps (r2-n2); MC, `#fillSize` without
  `toward`, differs only when a partial last group is chosen, so the fill's progress count, which no test reads there
  (r2-n3); ME, a bonus of G − 1, passes, since the backward lead is 7 under either (below), and halves only the forward lead's
  last step, which no test asserts (r2-n3).
* **r2-n1 (nit, simplification).** `nearestGroups`'s `toward !== 0 &&` is redundant (MA): `ahead` is the own group when
  `toward` is 0. Dropping it is one term less; keeping it reads as "no direction, no bonus". Either.
* **r2-n2 (nit).** At a cine loop's wrap (49 → 0) the step's sign is −1, so `toward` is 0 for two steps after it. *Derived:*
  harmless (at frame 0 the nearer neighbour is group 1, the direction anyway), and the window was never circular, so group 0
  is not prefetched before the wrap, as on `0e273ee92`. Not this PR's to change.
* **r2-n3 (nit, docs).** "So it is wanted on entering a group" (PR body §The change, `what-a-view-asks-for.md`) holds
  forward only. *Derived* (`wantFrom`, W = 15, G = 8): backward, entering group 3 at 31 the want stays {3, 4} (a tie between
  groups 2 and 4, to the later); group 2 joins at 30, one step in, hence the lead of G − 1, not G. The test's threshold is
  G − 1, which is why ME survives. One clause in each place ("forward on entering, backward one frame in") or the tie broken
  toward `toward` (lead G); not a blocker, the brief asks G − 1.
* **The cost is stated** in the PR body (§What it costs: the forward lead doubled, a reader turning back *p* ≤ 3 frames
  into a group), as the brief asks; memory unchanged (two groups).

`scripts/comment_budget.sh` ok; `scripts/check_links.py` 0 unresolved (428 files) on `94d447835`.

**Verdict.** No blocker open. WINDOW-WHOLE-GROUPS-MEASURE-3 may run (`steps.mjs`'s cells on `94d447835` against the tip);
r2-n1 to r2-n3 are nits any later session on the branch may take. A sync row merges PR 446 only after MEASURE-3 finds it a
non-regressor (its brief); PR 446 is `dirty` against `claude/unified` in `docs/lines/client.md`, for that sync row.

Fixtures and limits: synthetic 1×1 frames in series of 20 to 69, G = 8 and 16, `window.test.mjs`'s stand-in transport and
decoders, each miss delivered before the next step; `toward.mjs` and `reach.mjs` run `wantFrom` alone, fed the controller's
rule, without the store or the downloader. Frames and steps counted; no time, no bytes on a link, no browser; no DBT volume
or ultrasound clip opened. Whether 7 steps cover a group's wire and decode at 4× is MEASURE-3's, not claimed here.

*How it serves the value statement:* the backward pass, the commonest reversal, keeps "low latency on every jump" in the
count with the one-frame rock still free on the wire; its time is the next row's.

## Timed cells again (WINDOW-WHOLE-GROUPS-MEASURE-3)

WINDOW-WHOLE-GROUPS-MEASURE-3, 2026-11-25 12:02–13:25 UTC, by a session that built none of PR 446, its measures, fixes or
reviews (`by:` in its status file). `steps.mjs` unchanged, on `origin/claude/unified` `8459a0a7b` (`tip-a`, `tip-b`) against
`8459a0a7b` with PR 446's `94d447835` merged locally (`pr-a`, `pr-b`; `--no-ff`, never pushed; the code diff is PR 446's
seven files). The prediction was written before any row (`README.md` §The timed cells again, `1187f17b9`). Rows
`steps-3.jsonl`: 4 rounds × CLEAN, LTE × 1×, 4× × four arms (64 visits), then 2 more rounds of LTE only (rounds 4–5, 16
visits) because 11 of the first 64 were VOID and one LTE 4× arm kept a single row; 60 of 80 kept, 19 VOID by the relay's
self-timing (p99 over 1 ms), 1 failed (round 2, CLEAN 4×, `tip-b`: "forward 9: no paint in 60 s", the tip's, as §Timed
cells m2). Summary `steps-3-summary.txt`. Every number *measured*: the median over kept rounds of each arm.

| form, rate | pass | MB, tip → branch | steps that waited: count, sum, tip → branch | prediction |
| --- | --- | --- | --- | --- |
| CLEAN 1× | forward | 46.1, 48.1 → 15.8 (÷ 3.0) | 2, 0.13–0.26 s → **0** | (4) held; bytes ÷ 4–8 miss (3, held) |
| CLEAN 1× | backward | 42.3, 43.4 → 18.7 (÷ 2.3) | 0–2, 0–0.39 s → **0** | (1) held |
| CLEAN 4× | forward | 50.3, 50.3 → 15.8 (÷ 3.2) | 4–6, 1.2–1.9 s → **0** | (4) held |
| CLEAN 4× | backward | 43.2, 42.5 → 18.7 (÷ 2.3) | 1–2, 0.31–0.50 s → **0** | (1) held |
| LTE 1× | forward | 32.7, 32.2 → 19.1 (÷ 1.7) | 25–27, 14.4–14.5 s → 1–2, 1.3–1.5 s (÷ 10) | (not predicted) |
| LTE 1× | backward | 26.5, 25.9 → 18.7 (÷ 1.4) | 4, 9.6–10.4 s → 4, 4.2–4.3 s (÷ 2.4) | (2) **missed**: the four waits stay |
| LTE 4× | forward | 33.9, 35.0 → 15.8 (÷ 2.2) | 12–13, 8.8–9.5 s → **0** | (4) held |
| LTE 4× | backward | 31.0, 33.1 → 18.7 (÷ 1.7) | 3–4, 6.7–7.2 s → **0** | (2) held |

A/A: MB within 0.94–1.03 in every cell; the branch's waited sums (LTE 1×, the one cell with waits) 0.92 and 0.99; the
tip's 0.50–1.65 with zero to six waits a pass on CLEAN. The branch's frames are the stand-in's 34 and 40 a pass in every kept
row but LTE 1× forward (38–45: §Timed cells m1's refetch, still there).

* **§Timed cells B1: closed in time.** On CLEAN the branch waits on no step either way, at 1× and 4× (MEASURE-2: four waits a
  backward pass, 0.67–0.84 s and 4.8–5.0 s). The seven-step lead covers a group's wire and its eight chained decodes at
  both rates (prediction 1). Forward waits stay at zero (prediction 4).
* **No cell regresses.** The branch's waited sum is at most the tip's in every cell, well outside the tip's A/A spread where
  it is lower; its bytes ÷ 1.4 to ÷ 3.2 (the brief's ÷ 4 to ÷ 8 missed again, as predicted in (3) and explained in §Timed
  cells m3). By the brief, PR 446 is a **non-regressor** on these cells.
* **o1 (observation, prediction 2 missed).** On LTE 1× the branch still waits at 31, 23, 15 and 7 on the backward pass
  (0.34–2.2 s each, in all eight kept rows), half the tip's sum. At 1× a step takes about 0.35 s (dwell and paint), so 7
  steps are about 2.4 s; a group is 0.6 s on the 50 Mbit/s wire (*derived*, `candidates.md` §2). The lead should cover it
  and does not: not diagnosed here. At 4× (slower steps) the waits vanish, which points at the rate of asking rather than
  the lead (*theory*, not tested). Not a blocker: the tip waits on the same four steps, longer. For BRIEF-WEEKEND's list
  with §Timed cells m1, which it may share a cause with.
* **o2.** The tip failed 1 of 40 instrumented visits (above); the branch 0 of 40. §Timed cells m2's count is not
  re-diagnosed.
* **What it costs** (§FIX-2: a reader turning back early in a group) is not in these cells: a pass runs one way to the end.
  It stays *derived* only.

**Verdict.** No blocker open. PR 446 is a non-regressor on `dbts_b1-q8-g8`'s timed cells: a sync row may merge it (amendment
28 rule 1), its conflict in `docs/lines/client.md` its own to resolve. §Timed cells m1 and o1 go to BRIEF-WEEKEND's list.

Fixtures and limits: `dbts_b1-q8-g8` and its exact series `dbts_b1` only (50 frames, 2560 × 3328, 10-bit, W = 15, G = 8),
coded here by `ingest_coded.py` as `scripts/demo-series.sh` does; no ultrasound clip, no other DBT volume (`dbts_c1`'s six
groups not timed; there §FIX-2's change moves nothing). One 4-core cloud container (no GPU), the browsers, servers and driver
on cores 0–2 and the relay on core 3, load average about 3.2: the host is near saturation at 4×, so of the 4× cells only
the arms' order is claimed. Headless Chromium, software WebCodecs and WebGL, the page view only; 4× by `cpu_throttle.mjs`'s
per-thread cap (its check here: 1× 148 ms, 4× 703 ms), not a phone. A userspace relay (`link_impair.py`), not a radio; LTE
without its 30 s blackout; the relay's self-timing VOIDed 19 visits here against 4 in MEASURE-2 on the same rig (a noisier
host; VOID rows not read). One reader pace (a 300 ms dwell), one pass each way from frame 0 after the window's fill. The
extra LTE rounds are a deviation from the four planned, named here; they changed no cell's reading.

*How it serves the value statement:* on CLEAN and LTE 4× no step waits either way, and the bytes of a pass fall by 1.4 to
3.2: "low latency on every jump" and "the lowest … network cost per reading session"; on LTE 1× the backward waits halve but
remain (o1). On these links at 1× the link binds (LTE: ÷ 10 forward waits from asking less); at 4× the decode does.
