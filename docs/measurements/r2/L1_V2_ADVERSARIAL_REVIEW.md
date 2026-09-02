# L1 v2 — adversarial review

**Verdict: do not decide from `l1_s_vs_q_loss_v2.tsv`.** The grid is complete and internally
tidy, but the measurement's own noise floor is larger than the decision threshold it was
built to test, and the rig biases the result toward the arm that won.

Reviewed: 120 rows, `docs/measurements/r2/l1_s_vs_q_loss_v2.tsv` @ `fd3ac9c`.
Decision rule under test: **Q beats S by > 15 % on `miss_p95_wait_ms` at 0.5 % loss.**

## 1 · What the numbers say

Median `miss_p95_wait_ms`, Q's gain over S:

| RTT | D | loss 0 % | loss 0.5 % | loss 2 % |
| --- | - | --- | --- | --- |
| 60 | 4 | +3.9 % | **+35.5 %** | −1.4 % |
| 150 | 7 | **+26.0 %** | **+29.2 %** | +3.6 % |

Bootstrap 95 % CI on the gain in the two decision cells (10 runs per arm):

| cell | gain | 95 % CI | permutation p |
| --- | --- | --- | --- |
| rtt 60 / 0.5 % | +35.5 % | **[+3.3 %, +55.3 %]** | 0.016 |
| rtt 150 / 0.5 % | +29.2 % | **[−6.3 %, +51.6 %]** | 0.101 |

Neither cell clears its own bar. The RTT-60 interval contains gains far below 15 %; the
RTT-150 interval contains zero.

## 2 · Three findings that kill the conclusion

**2.1 · The noise floor exceeds the decision threshold.**
At RTT 150, 0 % loss, D = 7 — the cell where head-of-line blocking *cannot* occur and the
arms must therefore be equal — Q wins by **26 %**. The rule asks for 15 %. An experiment
whose zero-effect control produces 26 % cannot resolve a 15 % question.

**2.2 · There is no dose–response.**
If a shared stream loses because one lost packet stalls everything behind it, Q's advantage
must grow with loss. It does not. It is 3.9 % → 35.5 % → −1.4 % at RTT 60 and
26.0 % → 29.2 % → 3.6 % at RTT 150. The advantage disappears at 2 % loss, where the
mechanism should be strongest. Measured against each arm's own lossless baseline, the
*differential* degradation at 0.5 % loss is 52 points at RTT 60 but only **12 points** at
RTT 150 — and it inverts at 2 % loss (−46 and −400 points, Q degrading more than S).
That is a spike at one grid point, not a mechanism.

**2.3 · The design is 4–8× underpowered.**
Resampling from the observed spreads, 10 runs per arm gives only a **0.27** (RTT 60) and
**0.16** (RTT 150) chance of establishing a > 15 % win even if the observed effect is real.
~40 runs/arm (RTT 60) and ~80 (RTT 150) are needed for ≈ 80–90 % power. The `MIN_VALID_LOSS=7`
gate checks that runs exist, not that they can answer the question.

## 3 · The rig biases toward Q

**3.1 · The harness re-asks frames it already holds — and that penalises S specifically.**
`window_frames()` builds a **symmetric** window `(c, c+1, c−1, c+2, c−2, c+3, c−3)`, but
`l1_one_way_80.json` is a strictly **forward** scan. Three of seven asks at D = 7 are for
frames already displayed, and `emit_window` checks only the in-flight set, never the cache,
so delivered frames are re-asked on the next step. The server has no dedup and re-sends
every one.

| | asks | unique | redundancy | bytes on wire | wire time @ 10 Mbit | trace nominal |
| --- | --- | --- | --- | --- | --- | --- |
| D = 4 | ~306 | 80 | **3.8×** | 9.8 MB | 7.8 s | 4.0 s |
| D = 7 | ~534 | 80 | **6.7×** | 17.1 MB | 13.7 s | 4.0 s |

This is not a wash across arms. In **shared** mode the redundant bytes ride the same stream
as the useful frames, so a loss anywhere in the garbage stalls real frames behind it. In
**per-frame** mode the garbage sits on its own throwaway streams and blocks nothing. The
harness manufactures roughly 75–85 % of the head-of-line exposure it then attributes to the
shared architecture.

**3.2 · The RTT labels are wrong, and the depth formula was fed the label.**
`cloud_netem.sh` adds `RTT/2` one-way on the **server's egress only**. The harness runs
locally and reaches São Paulo over an uncontrolled WAN path. Backing that path out of the
campaign's own D = 1 control (265.0 ms at "RTT 60", 325.7 ms at "RTT 150", minus 25.6 ms
serialisation and the netem delay) implies **~210 ms of unmodelled base RTT**.

- Actual paths ≈ **240 ms** and **300 ms**, not 60 and 150. The RTT axis is a 1.26× contrast,
  not the 2.5× the labels claim — the two RTT conditions are nearly the same condition.
- `D = ceil(0.95 × (1 + RTT/Tf))` with the real RTT wants **D ≈ 10 and 13**, not 4 and 7.
  Every non-control cell ran at roughly half to a quarter of the depth its own formula
  specifies. (Campaign v2 used D = 12/16 on this fixture — consistent with the real path.)
- Loss is applied one-way only; the ask path is lossless.

**3.3 · Arms are blocked, not interleaved.**
The runner does all 10 S runs, then all 10 Q runs, per cell. The ~10 minutes of uncontrolled
WAN between the blocks is perfectly aligned with the treatment. No randomisation, no pairing,
no per-run timestamp. The D = 1 control shows the rig *can* produce a systematic arm
difference (1.4 ms, p = 0.007) in a regime where none should exist.

## 4 · The rig was not exclusive, and one decision cell straddles the breach

`9e45f59`: *"Integrity assert caught foreign delay 10ms during Q@150/0.5 r6."* The netem lock
is advisory and this runner **displaces** foreign holders by design; `assert_netem` runs
*before* a cell only, so a steal mid-cell is invisible. The S@150/0.5 block was collected in
the window immediately before the detected steal and cannot be shown clean.

Worse, the affected cell is split across the incident: Q@150/0.5 runs 1–5 landed 21:50–21:59
(median 534 ms), runs 6–10 landed 22:12–22:28 after the resume (median 417 ms), while all ten
S runs predate the pause. The RTT-150 decision cell compares one contiguous block against a
block split by a known contamination event.

## 5 · The protocol moved while data was being taken

**5.1 · The workload was retuned until the integrity gate passed.** At 21:05, 19 rows in,
`step_interval_ms` went 185 → 50 and nine collected rows were deleted (`1a07f26`). The trace
file states the reason: *"step_interval_ms=50 so display outruns D=4/7 prefetch enough to keep
cache_misses above the integrity gate."* The gate exists to protect the metric; the workload
was changed until it passed. The discarded rows (hit rates 0.43–0.96, miss_p95 41–534 ms) show
how violently the result moves with that one knob.

**5.2 · A harness change silently re-paced the reader at every depth.**
`wait_outstanding_below(outstanding, d)` → `d-1` was justified as a D = 1 fix, but it applies
everywhere: the loop now blocks each step until an ask completes. `step_interval_ms = 50` is a
floor, not the reader's rate — the reader is link-paced. The lane brief still describes the
trace as if 50 ms is what the reader does.

## 6 · The raw data is gone

`RAW_DIR` and `RUN.log` live under `.local/`, which is gitignored. Only the 120-row aggregate
survives. The per-run `wait_ms` arrays, the netem state per run, and the timings cannot be
recovered, so no one can re-derive the p95s, re-analyse under a different metric, or audit a
single cell.

## 7 · Q changes two things at once

Q = per-frame streams **and** FIFO `set_priority`. P (per-frame, no priority) was dropped on
the strength of campaign v2, which was **entirely lossless** — the regime the hypothesis says
is uninformative. A Q win under loss therefore cannot be attributed to per-frame streams
rather than to priority. Mitigating: the Q branch is a clean 10-line diff over `main`, so this
is not a stale-branch confound.

## 8 · What holds up

- 120/120 rows valid; no VOID, no FAIL; every cell at full repeat count.
- `peak_outstanding == depth` in every row — the depth was genuinely achieved.
- The miss-only metric fix is correct and necessary; v1's all-sample p95 was genuinely
  broken, and `metrics.rs` carries a unit test that proves it.
- Nearest-rank percentile is defined and tested.
- The D = 1 control does its job: it surfaces a small (~1.4 ms) systematic per-frame cost,
  which is a plausible real stream-open overhead.
- The netem steal was caught by an assert someone chose to add, and the campaign paused
  rather than continuing.
- **No conclusion was committed.** The lane delivered raw rows, as specified.

## 9 · What would make it trustworthy

1. **Fix the window.** Ask forward-only on a forward trace, and never re-ask a frame already
   in cache. Re-baseline every cell — the current numbers do not survive this.
2. **Put the harness on the shaped path.** Run it on the rig or a box in the same region so
   netem is the only path; measure real RTT per run and recompute D from the measurement.
3. **Interleave arms run-by-run** (S,Q,S,Q…) and stamp every row with a timestamp.
4. **Take the rig exclusively**, and assert netem *after* each run as well as before.
5. **Commit the raw per-run JSON.**
6. **Power it before running it:** ≈ 40 runs/arm at RTT 60, ≈ 80 at RTT 150.
7. **Re-add P under loss**, or accept that a Q win cannot be attributed.
8. **Freeze the protocol before the first row**, and if it must change, void everything
   collected under the old one — including the D = 1 control.
