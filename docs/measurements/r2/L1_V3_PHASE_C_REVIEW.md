# L1 v3 Phase C — adversarial review

**Date:** 2026-09-06 · **Branch:** `cursor/l1-loss-run-dbae`
**Scope:** Phases A–C as they stand at `2aadc95` — `lab/scripts/l1_v3_{common,collect_small}.sh`,
`lab/window-harness/src/{client,metrics}.rs`, `docs/lanes/L1-v3-{complete-plan,phase-b-regime-reader,phase-c-directional-note}.md`,
and the 80 rows in `l1_s_vs_q_loss_v3.small.tsv` with their committed `raw/l1v3/small/*.json`.
**Reproduce every number below:** `python3 lab/scripts/l1_v3_phase_c_review.py`

This is the review the complete plan's own checklist has open (*"Review sign-off on A+B"*), taken
after Phase C ran. **It does not reopen the v2 verdict** — that stands, twice confirmed — and it
does not dispute that v3 is a large improvement: the ask inflation is gone (`asks_sent = 160`,
redundancy 1.0×, against v2's 3.8–6.8×), the path is shaped in both directions on a rig-local veth,
arms are interleaved and timestamped, raw `wait_ms` vectors are committed, and rows carry protocol,
cadence and server hashes. Those were the things that made v2 unreadable, and they are fixed.

**Verdict: Phase C's own conclusions are safe, because it claimed almost nothing. But the design it
signs off cannot be carried into Phase E.** The primary metric is unsupported in two of three cells,
the null cell cannot exclude the effect it exists to protect, and the headline "dose-like response"
is an artifact of the estimator. One finding is not a criticism at all: **the reader-clock data
Phase C already collected answers the product question better than the metric it was collected to
serve.**

---

## Blocking findings

### B1 · The published p95 rests on 3 samples in the cells that matter

`tail_at_p95` is in the TSV, so this needs no re-derivation — only reading:

| cell | arm | median misses | median tail at p95 |
| --- | --- | ---: | ---: |
| null 0 % | S / Q | 58 / 58 | **3 / 3** |
| dose-low 0.5 % | S / Q | 71 / 59 | **4 / 3** |
| dose-high 2 % | S / Q | 152 / 150 | 8 / 8 |

**37 of 80 published rows have fewer than 5 samples at or above their own p95.**

`stream-mode-remediation.md` §R4 forbids exactly this — *"p95 needs more than ~4 tail samples"* —
and the second review's **N2** set the remedy: *"state the miss budget as a tail-sample count (≥ 5
samples at or above the p95) … If a cell cannot reach it, report the miss distribution or the mean
and say the p95 is unavailable — do not publish a max as a p95."*

The cell did not change. The gate did. `l1_v3_common.sh:l1_tail_gate` shipped as

```
need = min(L1_TAIL_MIN, max(1, ceil(0.05 * n)))
```

which at n ≈ 58 evaluates to **3**, with the comment *"so clinical under-delivery with n≈50–80 is
not an automatic fail just because the upper 5 % has fewer than 5 points."* That is the v2 failure
mode with the sign flipped: v2 retuned the workload until the metric's admission rule passed; Phase C
retuned the admission rule until the workload passed. Phase B's own §1 states the requirement the
code then relaxed — *"Phase A defaults collect to 160 frames and gates on ≥ 5 samples at/above p95"*.

Nearest-rank p95 puts ~5 % of a run's positive waits at or above it, so a 5-sample tail needs ~100
positive waits. Under `clinical_under_delivery` at 0 and 0.5 % loss the design produces 58–71. **The
cell cannot support this statistic, at any number of repeats.**

*Fixed here:* `l1_tail_gate` no longer softens `L1_TAIL_MIN`. A run below the tail count now exits 3
and the collect stamps the row `+P95_UNSUPPORTED` — the row is still collected (the lateness readout
does not need a miss tail) but no decision can quote its p95.

### B2 · The null cell cannot exclude the effect the campaign exists to detect

The runner shipped `NULL_REL_STOP=0.40`: stop only if the arms differ by more than **40 %** with no
loss present. That is *looser* than v2's 25 %, against a product bar of 15 %. The second review's
**N1** called this out as a blocker before Phase C and specified the replacement — *"the null gate
must be at most the decision threshold, and stated as an interval, not a point: the null cell's 95 %
CI must exclude 15 %."* It was not implemented.

Applying N1's rule to the rows Phase C actually produced:

| pair | observed null gap | 95 % CI upper | excludes 15 %? |
| --- | ---: | ---: | --- |
| Q vs S | 3.7 % | **16.2 %** | no |
| P vs S | 47.5 % | 158.2 % | no |
| P vs Q | 52.9 % | 164.4 % | no |

Q vs S is the important row. The point estimate is reassuring — the arms really do look alike at
0 % loss — but with 10 repeats the interval still reaches 16.2 %. **A design whose zero-effect cell
cannot rule out a 16 % arm gap cannot certify a 15 % effect anywhere else in the grid.** That is a
property of the design, not of this particular sample, and more repeats in the *dose* cells will not
change it; only more repeats (or a tighter statistic) in the *null* cell will.

The P rows are a separate matter and are **not** an unexplained gap: per-frame without ask-priority
fair-shares bandwidth across concurrent streams, which `CAMPAIGN_V2_ANALYSIS.md` established as a
lossless effect. The gate as written does not distinguish "expected lossless mechanism" from
"unexplained instrumentation gap", so it would stop the campaign for the wrong reason. Phase E should
scope the null gate to the arms whose difference is supposed to require loss — S vs Q.

*Fixed here:* `l1_null_gate` implements N1's CI rule and `null_gap_check` calls it. Run against the
committed Phase C TSV it fails, correctly.

### B3 · The "dose-like response" is an artifact of the estimator

The Phase C note's first readout is *"Q vs S relative gain rises 0 % → 0.5 % → 2 %"*. It rises under
the estimator the note used. Under four other defensible readings of the same 80 rows:

| reading | null 0 % | dose-low 0.5 % | dose-high 2 % |
| --- | ---: | ---: | ---: |
| median-of-run p95 (as reported) | +3.5 % | +6.8 % | +10.2 % |
| BACKLOG excluded (`l1_v3_analyze.py`'s own rule) | +3.5 % | +4.1 % | +5.9 % |
| regime-matched (`loss_slow` only) | — | n = 1/1 | +8.9 % |
| **pooled miss samples** (N11's preference) | +2.7 % | **+14.6 %** | **+1.5 %** |
| reader lateness (median run) | on schedule | on schedule | +28.5 % |

Pooling every positive wait — 581–1528 samples per arm per cell instead of 10 per-run p95s — is what
**N11** asked for (*"Prefer pooled miss samples over median-of-p95"*). It inverts the shape: the
apparent gain peaks at 0.5 % and all but vanishes at 2 %. No reading has a 95 % CI excluding zero at
0.5 % (pooled: **[−7.3, +26.3]**), and the one cell with a tight interval is dose-high at **+1.5 %,
CI [+0.6, +5.1]** — real, and an order of magnitude below the product bar.

A readout that changes sign of slope with the estimator is not evidence of a mechanism. The note
labels itself directional and non-binding, which is right; the problem is that its *one substantive
claim* is the one that does not survive re-estimation, and Phase E is gated on "if C is clean."

### B4 · `DRY_RUN=1` deleted the campaign's published results

`l1_v3_collect_small.sh` writes the TSV header with `>` before the `DRY_RUN` branch, so the mode
documented as *"local A-gates only"* truncated the tracked 80-row results file to its header. This
was hit while preparing this review; the file was restored from git.

Neither the raw JSONs nor the summary are regenerable without the rig, so a rehearsal command that
silently empties them is a data-loss defect, not an inconvenience.

*Fixed here:* `DRY_RUN` writes its header preview to a temp file, and
`l1_write_directional_header` refuses to truncate a TSV that already holds data rows unless
`L1_OVERWRITE_TSV=1`.

---

## The finding that is not a criticism

### The reader-clock data already collected answers the product question better

Every row carries `step_loop_ms`, and the step loop advances on an absolute schedule
(`start + i·interval`), so a run of n steps is *scheduled* to take (n−1)·interval. Everything beyond
that is time the reader spent behind its own cadence — and `miss_p95_wait_ms`, timed from the
harness's ask, cannot see it.

| cell | arm | median lateness | p90 | max | runs on schedule |
| --- | --- | ---: | ---: | ---: | ---: |
| null 0 % | S | 1 ms | 2 ms | 2 ms | 10/10 |
| null 0 % | Q | 1 ms | 1 ms | 2 ms | 10/10 |
| null 0 % | P | 1 ms | 116 ms | 415 ms | 7/10 |
| dose-low 0.5 % | S | 1 ms | 272 ms | 4449 ms | 8/10 |
| dose-low 0.5 % | Q | 2 ms | **48 ms** | 3902 ms | 9/10 |
| dose-low 0.5 % | P | 488 ms | 3693 ms | 4338 ms | 3/10 |
| dose-high 2 % | S | **6420 ms** | 8834 ms | 9844 ms | 0/10 |
| dose-high 2 % | Q | **4593 ms** | 8132 ms | 9504 ms | 0/10 |

Three things follow, and all of them are more decision-relevant than any p95 in the grid.

**1 · At 0.5 % loss the transport choice does not reach the reader.** Both arms keep the cadence in
9–10 runs of 10; the median run is on schedule to within 2 ms. The 66 ms vs 62 ms difference in
miss p95 is a difference in how long the client waited *after asking*, absorbed entirely by the
prefetch window. It is not a difference the reader experiences. Phase B's §3 anticipated exactly
this and pre-authorised the response: *"If 0 % loss under this model yields few misses, that is a
finding — change the metric or add an explicit stress cell; do not silently speed the reader."*
That finding arrived, and the metric was not changed.

**2 · Where the arms do separate at 0.5 %, it is in the tail, and Q is ahead.** S's p90 lateness is
272 ms against Q's 48 ms; each arm has exactly one catastrophic run (S 4.4 s, Q 3.9 s). With n = 10
that is a hint, not a result — but it is a hint on a quantity that has 160 samples per run instead
of 3, and it is the shape a head-of-line story predicts: rare, tail-shaped, invisible in the median.

**3 · The only cell where Q clearly wins is one where the reader model has already failed.** At 2 %
both arms are seconds late in every run, and BACKLOG is stamped on 4/10 S and 5/10 Q rows. Q's
−28.5 % lateness is the largest, cleanest effect in the campaign, and it is measured in a regime the
lane's own reader model does not describe. It is a real finding about degraded links; it is not the
0.5 % decision the rule names.

Taken together the campaign is measuring at an operating point where the effect under test is, for
the chosen reader, mostly invisible — and its one visible cell is outside the reader model. That is
a cell-selection result, which `stream-mode-remediation.md` §R5 says is design work, not a repeat
count to be raised.

*Landed here:* `wait_displayable` now takes the step's scheduled display time and records
`lateness_ms` per step, with `late_p95_ms`, `late_mean_ms`, `late_max_ms` and `on_time_rate` in the
metrics and in the collect TSV. Two unit tests pin the behaviour, including the honest limit that a
single late step sits above the p95 rank, so `late_max_ms` must be read alongside it.

`lab/scripts/l1_v3_lateness_demo.sh` shows the divergence in two runs of one arm on loopback:

| reader | miss_p95_wait_ms | late_p95_ms | on_time_rate |
| --- | ---: | ---: | ---: |
| clinical, 31 ms/step | 10.3 ms | 1.1 ms | 1.000 |
| stress, 15 ms/step | **28.8 ms** | **1767 ms** | **0.056** |

The ask-anchored metric reports 29 ms for a run in which 94 % of steps missed their scheduled time.

---

## Serious findings

**S1 · Phase E as scoped cannot resolve the decision cell.** Resampling Phase C's own spread, and
asking only for a CI that excludes **zero** (far weaker than 15 %):

| cell / metric | n = 10 | n = 20 | n = 40 | n = 80 |
| --- | ---: | ---: | ---: | ---: |
| dose-low 0.5 %, miss p95 | 3.5 % | 13.5 % | 24.0 % | 43.5 % |
| dose-high 2 %, miss p95 | 14.0 % | 38.0 % | 70.5 % | **97.5 %** |
| dose-high 2 %, reader lateness | 17.0 % | 29.0 % | 41.0 % | 65.5 % |

E2 proposes *"~40/arm RTT60 decision cells."* At 40/arm the decision cell resolves in **24 %** of
campaigns — and that is for a sign, not a margin. Raising repeats is the wrong lever: the dose-low
cell has almost no signal to find because the reader is not exposed to the transport there (see
above). Change the operating point, then power it.

**S2 · Regime imbalance is stamped but still pooled.** At dose-high, S is `loss_slow` in 10/10 runs
and Q in 8/10; the two `loss_stable` Q runs are its two fastest (66.7, 93.9 ms) and pull its median
down. The note's own readout 4 says *"Do not average unlabeled"* — the rows are labelled, and then
averaged. Regime-matched, the dose-high gain is +8.9 % rather than +10.2 %; BACKLOG-excluded it is
+5.9 %. The direction survives; the headline number does not.

**S3 · P is compared on a statistic with a different denominator.** The attribution readout — *"at
0.5 %, P ≫ Q (145 vs 62)"* — compares a p95 over ~112 misses against one over ~59. Different sample
sizes put the nearest-rank p95 at different depths into each arm's tail. The conclusion happens to
be right and survives on the metric that *is* comparable — P's median lateness is 488 ms against Q's
2 ms, and P keeps schedule in 3/10 runs against Q's 9/10 — but the number quoted should not be the
p95 pair.

**S4 · The `loss_slow` regime is still a label, not a mechanism.** Phase B calls it a *"working
interpretation"* and detects it by a threshold fitted to pilot behaviour (`h1 ≥ 55 ms` or
`step_loop/n ≥ 45 ms`). At 2 % it is 18 of 20 runs, so the dose-high cell is essentially *defined* by
it. A regime that dominates the only decidable cell needs a cause before that cell decides anything.
Same standing risk as **N8** (the RTT-proportional excess, gated on an empirically fitted band): a
threshold fitted to the data cannot detect what it was fitted to.

**S5 · `peak_outstanding == depth` on all 80 rows, and the second review predicted it should not
be.** §2 of that review is explicit: after cache dedup and a forward window, `peak < D` becomes a
legitimate steady state, and a `peak == D` gate would now void good runs. Every row reads exactly 4.
That may be correct — a forward window at D = 4 with a reader slower than the link should keep the
set full — but **N10** ("decide what `peak_outstanding` should assert post-dedup") is still open, and
a column that is constant across every cell, arm and loss rate is asserting nothing.

**S6 · The complete plan's checklist is stale.** It shows `[ ] Phase C` and an unchecked
*"Review sign-off on A+B"*, while Phase C has run and published. Phase C proceeding before its own
gate is how v2's overridden stop gate started. Corrected in this commit.

---

## Smaller things

- `l1_v3_analyze.py` (the frozen decision analyzer) reads a column set the Phase C TSV does not
  have, and still encodes the median-of-p95 estimator N11 asked to replace. It needs a schema and
  an estimator pass before Phase E, not during it.
- `DIRECTIONAL_SUMMARY.md` reports p10/p90 of 10 values as if they were percentiles; at n = 10 both
  are the second and ninth order statistics. Say "min/max of 10" or give a CI.
- `bytes_on_wire` is 5 120 640 = 160 × 32 004 in every row including the 2 % loss rows. It counts
  application payload, so retransmissions are invisible; it cannot support a "bytes on the wire"
  comparison between arms under loss.
- The RTT-150 axis remains uncollected and blocked on **N8**. Nothing here changes that.

---

## What must change before Phase E

In dependency order. 1–4 are landed in this commit; 5–7 are design decisions.

1. **Tail gate binding** (B1) — `l1_tail_gate` no longer softens `L1_TAIL_MIN`; rows below it are
   stamped `P95_UNSUPPORTED`.
2. **Null gate as an interval** (B2) — `l1_null_gate` requires the null CI to exclude the effect bar.
3. **Reader lateness recorded per step** (§the finding that is not a criticism) — `lateness_ms`,
   `late_p95_ms`, `late_mean_ms`, `late_max_ms`, `on_time_rate`, in the metrics and in the TSV.
4. **`DRY_RUN` and re-runs cannot destroy tracked results** (B4).
5. **Make lateness the primary readout and miss p95 a diagnostic.** It has 160 samples per run
   instead of 3, it is what §R4 and the v2 review both demanded ("anchor the metric to the reader's
   clock"), it is already recorded, and it is the only metric on which the arms separate
   interpretably.
6. **Re-pick the operating point so the reader is exposed to the transport.** Under
   `clinical_under_delivery` at 0.5 %, neither arm makes the reader wait, so there is nothing for a
   powered run to resolve. The named alternatives already exist in the lane: the
   `stress_over_delivery` reader (`l1_precheck_ratio` supports it today), the large-frame cell
   (Phase D), or bursty loss (A6, `gemodel` already wired in `cloud_netem.sh`). Pick one and state,
   per §R5, what result the cell cannot produce.
7. **Power the chosen cell from its own pilot, not from Phase C.** The table in S1 is the method,
   not the answer — the numbers change with the operating point, and the pre-registration (E1) must
   be written against the cell that is actually going to run.

**Nothing here authorises a product change.** `stream-mode-remediation.md` §R0b still decides that,
and the S-vs-Q outcome is still not known.
