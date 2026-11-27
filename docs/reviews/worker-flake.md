# WORKER-FLAKE: one worker run of `dbts_a1-q8-g16-cut` failed in 40

2026-11-20, row WORKER-FLAKE of `claude/work-ledger:docs/queue-2026-11-14.md`, on `claude/unified` `4a2b4277`. The
question: CLEAN-PRODUCT's demo check (2026-11-11) passed 39 of 40 runs; the worker view's run of `dbts_a1-q8-g16-cut`
failed once, its claim not captured, then passed 6 of 6 reruns (`claude/work-ledger:docs/queue/CLEAN-PRODUCT.md`).
CLEAN-2, UNIFY-CLIENT and FREEZE-E2E passed 40 of 40 each, so 1 failure in 160 runs before this row.

**Fixtures and limits.** One series, `dbts_a1-q8-g16-cut` (56 frames, G 16, Q 8, a depth cut; its exact series
`dbts_a1`), one dataset; one 4-core cloud container, no GPU; headless Chromium 157.0.8103.78 (Playwright 1.63.0) on
SwiftShader; loopback, no `--link`; nothing timed beyond the check's own clock. CLEAN-PRODUCT ran on Chromium 153 with
20 series interleaved, so its host's load differed; the cause below does not depend on it.

## Result

* **Reproduced** (measured): `lab/worker-flake/loop.sh` ran the cell 100 times in the worker view
  (`lab/worker-flake/rows.jsonl`, one row a run). One failed, run 83 at 16:27 UTC, on the on-demand claim:
  "13 steps and a jump asked the whole groups, 24 frames: … received 23". 1 in 100; the 95 % interval (Clopper-Pearson)
  is 0.03 % to 5.4 %, which holds CLEAN-PRODUCT's 1 in 40.
* **Cause** (from the code, then measured): the product is right, the check reads too early. The view worker posts
  its progress at most every 100 ms (`PROGRESS_MS`, `client/view/view-worker.js`), and at once only when the last frame
  of the series arrives, which on demand never happens. So in the worker view the status line's `received` trails the
  frames held by up to 100 ms; in the page view the controller writes it at each arrival. The check read the count
  from the last status written before the page closed, the end of the pass, which comes after the jump's paint by two
  `l` presses (`losslessMs` 49–116 ms over the 100 runs). When the 24th frame's progress was still in its 100 ms
  window, the count read 23. In the failed row group 0's 16 frames had arrived by 1464 ms and group 3's eighth, frame 56,
  was painted, yet only 23 were counted: a count that lagged, not a frame missing.
* **Probe** (measured, a scratch copy of the check, not committed): the count at the jump's paint read 20 to 23 in
  10 of 10 on-demand worker passes and reached 24 0 to 100 ms later; it read 24 at once in 4 of 4 page passes.
* **First reading, set aside:** that the jump ends group 0's run and its tail is dropped (`downloader.js`, *a late
  frame of an ended run … is dropped*). A 2 Mbit/s `--link` run did not produce it (24 counted), and the failed row's
  arrivals show group 0 whole.

## Fix

`client/viewer/demo-check.mjs`: on demand, after the jump's paint, the check waits up to 2 s for the status's count to
reach the expected 24 and judges the count it read then (`atJump`), not the final status's. The page view is
unchanged in effect. Mutants, each run in the worker view unless named (`lab/worker-flake/mutants.jsonl`):

| arm | what changed | runs | failed | count read on demand |
| --- | --- | --- | --- | --- |
| fixed | — | 5 worker, 2 page | 0 | 24 every run |
| M1 | the wait removed: the count read at the jump's paint | 5 worker | 4 | 21, 21, 22, 22; one 24 |
| M1 | the same | 2 page | 0 | 24, 24: the page view does not lag |
| M2 | the wait bounded at 20 ms, under the 100 ms window | 3 worker | 2 | 22, 23; one 24 |
| P1 | product mutant: the view worker never posts progress short of the last frame | 2 worker | 2 | 0, 0 |

M1 and M2 are the test of the fix: in the worker view they fail most runs where the fixed check fails none, and P1
shows the wait still fails a count that never comes.

## Overlap

PR #418 (DEMO-CHECK-MUTANTS, not merged) rewrites the same claim's lines to share `groupsOf`; it keeps the final
status's exact count, so it carries this race too. Whichever merges second takes the other's read: #418's `groupsOf`
for the expected count, this branch's read after the jump. Its per-step check (no frame from a group no step has
reached) reads the same lagging count, so it can pass a frame asked ahead that has not yet been posted; it cannot
fail a correct run for it, since a lagging count is only lower.
