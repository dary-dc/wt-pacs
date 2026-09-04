# L2 ask-policy v2 — adversarial review of the corrected campaign

**Date:** 2026-09-04 · **Branch:** `cursor/l2-harness-fix-plan-c999` (PR #9)
**Under review:** harness v2 (`d0a08fe`…`899b8b2`), `l2_ask_policy_v2.tsv` (54 rows),
[`l2_ask_policy_EVIDENCE.md`](l2_ask_policy_EVIDENCE.md),
[`L2-ask-policy-harness-fix.md`](../../lanes/L2-ask-policy-harness-fix.md), and
`lab/scripts/l2_harness_smoke.sh`.

This is the second-order review the evidence freeze asked for
("Final adversarial review for ADR lock-in"). It was run early, against v2 rather than v3,
because v3 reuses the v2 harness and campaign shape unchanged.

## Verdict

The v1 defects the methodology review found **were fixed**. All 54 rows now ask the same
80 unique frames, move the same 2 560 320 bytes, and produce 119 lateness samples. That
part of the remediation is real and verifiable in the committed raw JSON.

But the corrected grid still cannot answer the lane's question. After the workload was
equalised, the only thing left that separates the arms is the **order** in which frames are
first asked — and that order is produced by a harness bug, not by ask policy.

**The loss=0 ranking (`control ≪ fixed ≈ dynamic`) is reproduced to within 0.66 % by a
two-parameter FIFO model that contains no depth term at all.** Replace the harness's
ring-shaped prefetch window with a forward-only one and the gap goes to exactly zero.

Do not amend `adr-client-window-depth.md` or D26 from any v2 cell. The number of arms in
this campaign that measure ask depth is zero.

---

## A — Blocking findings

### A1 · The loss=0 ranking is an artefact of `window_frames()` wrapping the study

`window_frames()` (`lab/window-harness/src/client.rs:588`) walks a **ring**:
`center ± radius mod n`. At the start of the trace the reader is on frame 0, so with D=16
the arm's first sixteen asks are:

```
0, 1, 79, 2, 78, 3, 77, 4, 76, 5, 75, 6, 74, 7, 73, 8
```

Seven frames from the far end of the study are queued ahead of frames 9–15 that the reader
needs in the next 100 ms. On a single ordered shared stream at ~9.4 Mbps that is ~190 ms of
head-of-line delay injected into every windowed arm and into no control arm. A viewer
scrolling forward from frame 0 does not prefetch frame 79; this is a wrap bug, not a policy.

**The check.** `lab/scripts/l2_v2_order_model.py` models the link as a FIFO pipe: frame at
queue position *k* lands at `c0 + Tf·(k+1)`. Two parameters, fitted on the **control** arm
only, then used to predict the D=16 arms with zero free parameters. No depth, no RTT, no
congestion, no loss in the model:

| cell | fitted on control | control obs / model | **D=16 predicted** | fixed obs | dynamic obs | err |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| rtt20/loss0 | Tf=27.02 ms (9.48 Mbps), c0=668 ms | 1521.9 / 1521.5 | **1622.5** | 1617.0 | 1615.6 | ≤0.43 % |
| rtt60/loss0 | Tf=27.32 ms (9.37 Mbps), c0=756 ms | 1632.1 / 1632.3 | **1733.0** | 1744.6 | 1739.4 | ≤0.66 % |
| rtt150/loss0 | Tf=27.28 ms (9.39 Mbps), c0=1036 ms | 1909.1 / 1909.3 | **2010.0** | 2014.5 | 1999.6 | ≤0.52 % |

Same model, same fitted parameters, prefetch window changed from ring to forward-only:

| depth | model p95 | gap vs control |
| --- | ---: | ---: |
| D=16 ring (what ran) | 1622.5 | **+101.0 ms** |
| D=16 forward-only | 1521.5 | **+0.0 ms** |

The model is monotone in D purely because a deeper ring injects more far-end frames
(D=4 → 1537, D=8 → 1558, D=16 → 1622, D=32 → 1750). Any "deeper window is worse" result
this harness produces is a readout of the wrap, nothing else.

The model reproduces `p95_lateness_ms` (the declared primary metric) and approximates
`mean_lateness_ms` within ~7 %; it does **not** reproduce `frac_steps_late` (predicts 0.891,
observed 0.748), so it is a strong but not complete account of the run. It does not need to
be complete — it only needs to show that the reported metric carries no depth signal, and it
does.

Run it: `python3 lab/scripts/l2_v2_order_model.py`

### A2 · The three arms differ in two variables at once

| arm | outstanding cap | prefetch shape |
| --- | --- | --- |
| control | unbounded | **none** — asks the centre frame only, just-in-time |
| fixed / dynamic | D | **ring** ±D/2 around the cursor |

`run_legacy_schedule` asks exactly one frame per step. There is no `unbounded + window` arm
and no `bounded + no-prefetch` arm, so no result in this grid can be attributed to bounding
depth rather than to prefetching. Control's `peak_outstanding` of 58–79 is a *consequence* of
the link falling behind, not a policy that asks ahead. The campaign is labelled
"unbounded vs fixed vs dynamic"; it measures "no prefetch vs ring prefetch."

### A3 · The dynamic arm never ran the specified estimator

`depth.rs:140` — when `--path-rtt-ms` is set it **overrides** the 8-frame RTT median outright:

```rust
let rtt = if let Some(path) = self.path_rtt_ms { path } else { /* median of samples */ };
```

The campaign always passes it (`l2_ask_policy_v2_cloud.sh:157`), and passes the *same*
constant that `formula_depth` uses to pick fixed's D. So across all 18 dynamic runs the
estimator's primary input was frozen to fixed's input, and the arm could only differ from
fixed through the throughput term. The lane spec is explicit — "implement as written; if
something cannot be implemented as specified, stop and report rather than substituting"
(`docs/lanes/L2-ask-policy.md`). The substitution was reasonable on the merits (the specified
input is HOL-contaminated on a shared ordered stream, per methodology review B3) but it is
not disclosed in EVIDENCE, which says only that "fixed and dynamic both ran at D=16."

### A4 · `p95_lateness_ms` cannot show what depth policy is for

Two problems compound:

1. **It is not a percentile of a spread.** In all 54 runs p95 sits within 3 % of the max, and
   lateness ramps monotonically through the forward leg. `p95_lateness_ms` is a proxy for
   "when did the 2.56 MB finish", i.e. goodput plus ordering. Since `bytes_on_wire` is
   *identical* (2 560 320) in every one of the 54 rows, ordering is the only free variable —
   which is exactly what A1 exploits.
2. **The trace contains no abandoned work.** `l2_ask_policy_scroll.json` runs 0→79 then
   79→40. The reverse leg re-reads frames the forward leg already cached, so nothing
   in-flight is ever stranded. Bounded depth exists to avoid paying for frames the reader
   walks away from; on this trace there are none, so the mechanism under test is never
   exercised. `wasted_bytes` is structurally 0.

---

## B — Evidence-integrity defects

### B1 · The `path_rtt_ms` column is not what EVIDENCE describes

`ask_first_byte_ms` and `median_ask_first_byte_ms` are **absent from all 54 raw JSONs** — the
fields did not exist when the grid ran. The committed column comes from the pre-fix probe
(`b0c00ee`): a **single** ask→**displayable** sample, not "the median of 3 one-frame
ask→first-byte probes." EVIDENCE caveat A describes the post-hoc fix (`adc938f`) in a way
that reads as though it produced the committed numbers.

### B2 · "D=16 is the correct BDP answer on this rig" is unmeasured

The fixed probe has never been run against the rig (v3 is blocked on the missing SSH key), so
no clean path-RTT measurement of the Oracle path exists. The formula crosses from interior D
to the clamp at RTT ≈ 405 ms. The only available figure — 469 ms of ask→displayable, minus
the known ~25.6 ms of `Tf` contamination ⇒ ~443 ms, **n=1** — sits ~38 ms above that
threshold. EVIDENCE states this as settled ("the correct BDP answer, not only a probe bug").
It is a single contaminated sample within noise of the line that decides whether the whole
fixed-vs-dynamic comparison was possible at all.

### B3 · A run that tripped a declared stop condition is in the dataset, unmarked

`depth_oscillating` is **not a TSV column**. `dynamic_rtt20_loss0.5_run3` set the flag; the
only trace of it is a one-line `.json.err` file. Its p95 (9674 ms) is one of the "outliers to
8–13 s" EVIDENCE cites as evidence of run variance.

The lane's stop condition — "`D` oscillates every evaluation despite the damping rule — stop
and report the trajectory" — was relaxed **during** the campaign, after it fired:

| commit | change |
| --- | --- |
| `a7efa87` | harness no longer truncates the trace on `depth_saturated` (defensible: D starts at the clamp, so `saturated` latches on every dynamic run by construction) |
| `0a4b73c` | campaign stops only on oscillation; rows are now written even when the harness exits non-zero |
| `d79fe5b` | oscillation STOP → WARN; harness completes the trace |

Completing a flagged trace instead of truncating it is the right call — a truncated row is
incomparable. Dropping the flag from the output is not.

### B4 · The three runs where D actually moved are the three worst dynamic runs

`d_current` left 16 in exactly three of eighteen dynamic runs:

| run | d_min | p95 lateness |
| --- | ---: | ---: |
| dynamic_rtt150_loss0.5_run2 | 4 | **12 599 ms** |
| dynamic_rtt20_loss0.5_run3 | 4 | **9 674 ms** (also `depth_oscillating`) |
| dynamic_rtt20_loss0.5_run1 | 11 | **2 969 ms** (worst in its cell) |
| all other 15 dynamic runs | 16 | 1612 – 2246 ms |

Causation is genuinely ambiguous — a loss burst depresses the throughput estimate, which
lowers D, so "bad run → low D" is as available as "low D → bad run". That ambiguity *is* the
finding: these are the only adaptation events in the entire campaign, the campaign has no
instrumentation to separate the two directions, and EVIDENCE folds them into undifferentiated
"huge run variance" without mentioning that they are the estimator's only three data points.

### B5 · The committed lateness/wait vectors are not in step order

`lateness_ms` and `wait_ms` are documented as "Raw per-step" (`metrics.rs:80`, `:84`), but
`record_step` is called from per-step tasks spawned with `tokio::spawn`
(`client.rs:521`, `:808`, `:824`). Index *i* is the *i*-th step to become **displayable**, not
step *i*. The pairs `(lateness[i], wait[i])` are internally consistent; the index is not a step
number. Aggregates are unaffected. Any per-step reading of the committed vectors — "when did
the arm fall behind?" — is invalid.

### B6 · Failed runs are indistinguishable from clean ones in the TSV

`l2_ask_policy_v2_cloud.sh:184-203` appends a row from whatever partial JSON exists when the
harness exits non-zero, with no column recording the exit status. (All 54 `.err` files are
empty except B3's, so the v2 rows are probably clean — but the TSV cannot show that.)

### B7 · Arm order is fixed, not randomised

`for arm in dynamic fixed control` — control runs third in every cycle of every cell. Phase 6.4
("interleave or randomize arm order within each cell") is ticked `[x]`; the code comment says
"shuffled order," which it is not. Cycling per repeat is better than blocking by arm, but any
within-cell drift is still confounded with arm.

---

## C — Smoke gates that cannot fail

`lab/scripts/l2_harness_smoke.sh` is the gate EVIDENCE cites for "harness methodology
corrected + smoke: **yes**."

| gate | what it claims | what it does |
| --- | --- | --- |
| **G2** | "Trace wall ≈ 1.90 s at 16 ms/step (not 6–30 s)" — Phase 2's whole point | Its `wall()` helper returns `bytes_on_wire*8/10e6`, **not wall clock**; the inline comment admits the wall time isn't stored. Compares 2.048 s to a 4.76 s bound. Passes for any run that transfers 80 frames. Phase 2 is untested. |
| **G3** | "Dynamic loopback: `d_max` ≤ 2 (not 16)" — cited in EVIDENCE as the "Interior-D proof for the estimator" | With `--path-rtt-ms 0`, `compute_d()` evaluates `ceil(0.95×(1+0)) = 1`, clamped to `D_MIN`. D cannot exceed the warm-up value. The gate asserts that 0.95 rounds to 1. Same for the unit test `path_rtt_zero_keeps_d_shallow`. |
| **G5** | "No systematic bytes shortfall = D" | Passes when `shortfall == 0` **or** when `shortfall == d_max` — i.e. it passes on the exact bug (methodology review S1) it was written to catch. |
| **G6** | listed in the plan, ticked `[x]` in the checklist | not implemented; the script has G1–G5 |

Two more, structural:

- **The gates ran at `DEPTH=2`.** `window_frames(c, 2, n)` returns `[c, c+1]` — the ring wrap
  first appears at D≥3. The smoke was run at the one depth where finding A1 is invisible; the
  grid ran at D=16, where it is the dominant term. No gate checks ask order at all.
- **Smoke output goes to `.local/`, which is gitignored.** Unlike the campaign raw JSON, the
  gate evidence is not in the tree, so "smoke passed on loopback before the grid" is not
  verifiable from this branch.

There is also no instrumentation for `wait_for_reader_ask_slot` (`client.rs:615`), which
*does* block the step loop when the centre frame is neither cached nor outstanding and
`in_flight == D`. On a forward scroll the next centre is normally already in the previous
window, so it rarely fires — by luck of the window shape, not by design. Nothing records
whether it fired.

---

## D — Axis and rig

- **D1 · The RTT axis is an additive startup offset.** Fitted `c0` (time to first byte) moves
  +88 ms and +368 ms across the three RTT profiles for +20 ms and +65 ms of added RTT (netem
  adds `N/2` one-way, egress only). That ratio is consistent with ~5 round trips of QUIC +
  WebTransport session setup before the first ask. The axis shifts every arm by the same
  constant, which is why the ranking is identical in all three RTT cells. It does not exercise
  depth policy.
- **D2 · Still no achieved-rate/achieved-RTT columns** (Phase 5 is honestly marked `[~]`). One
  axis parameter does check out: the fitted serialization rate is 9.37–9.48 Mbps against a
  nominal 10 Mbps, so the shaper is roughly where it should be.
- **D3 · `cloud_netem.sh` never sets netem `limit`.** The default is 1000 packets ≈ 45 frames.
  Control reaches `peak_outstanding` 58–79 frames; the D=16 arms never exceed 16. The
  unbounded arm is the only one that can overflow the bottleneck buffer, and no tc drop
  counters are recorded. Loss is egress-only, so the ask path is never lossy.
- **D4 · The loss cells are bimodal, not noisy.** Runs either land at 1.7–2.4 s
  (indistinguishable from loss=0) or blow up to 8–14 s. A median of n=3 over a bimodal
  distribution reports "did ≥2 of 3 runs escape a bad event," not a central tendency. EVIDENCE
  ranks arms on those medians before saying they are unstable.

---

## What holds up

Stated plainly, because it is most of the remediation and it is real:

- **Phase 3 (equal workload) worked.** Every one of the 54 rows: `unique_frames_asked=80`,
  `asks_sent=80`, `bytes_on_wire=2 560 320`, `wait_samples=119`. This was v1's largest defect
  (2–12× byte differences between arms) and it is gone.
- **Phase 6 (drain/audit) worked.** `drain_incomplete=0` everywhere; no `asks×32004 − bytes`
  shortfall.
- **Nearest-rank p95** is implemented correctly, with a test that pins the disagreement with
  the old index rule.
- **All six headline medians in EVIDENCE transcribe the TSV exactly.** The reporting is honest;
  the problem is entirely upstream of the numbers.
- **Per-run raw JSON is committed for all 54 rows.** This review exists only because of that
  decision. Keep it.
- **Withdrawal discipline** (`STOP.txt`, `ARCHIVE_L2_OVERRIDE.md`, "cite EVIDENCE only") is
  good practice and worked — nothing downstream picked up the v1 rankings.
- **EVIDENCE already refused to amend ADRs.** That instinct was right, for reasons narrower
  than the actual ones.

## The four "safe claims", re-scored

| # | EVIDENCE claim | after this review |
| --- | --- | --- |
| 1 | "'dynamic always wins' is false — that ranking was a harness artefact" | **Holds** (established by the methodology review, independent of v2) |
| 2 | "unbounded control is competitive or best at 0 % loss on `p95_lateness_ms`" | **Withdraw** — A1: reproduced by ask order alone, gap is 0 with a correct window |
| 3 | "adaptivity did not earn complexity on this grid; D26 remains open" | Conclusion holds; **the stated reason is wrong**. Not "both ran at D=16" but A3 (the estimator's RTT input was frozen to fixed's) plus B4 (its only three adaptation events are the three worst dynamic runs) |
| 4 | "do not amend ADRs from loss=0.5 % medians yet" | **Holds, and widen it**: do not amend ADRs from any v2 cell |

---

## Before another campaign

Ordered by what unblocks the most. Each needs an acceptance test that can fail.

1. **Fix the window shape.** Clamp `window_frames` at the study edges, or make prefetch shape
   an explicit arm dimension. Unit-test the resulting ask order against an expected list —
   this is the single test whose absence cost the campaign.
2. **Separate depth from prefetch.** Run 2×2: `{bounded, unbounded} × {no prefetch, window
   prefetch}`. Without the two missing cells no result can be attributed to depth.
3. **Give the trace abandoned work.** A jump or reversal that strands in-flight frames. Until
   the trace can waste bandwidth, bounded depth has nothing to save and `wasted_bytes` stays 0.
4. **Report the distribution, not p95.** Here p95 ≈ max. Commit lateness with its step index,
   and report median / IQR / max per cell.
5. **Decide the estimator's RTT input and say so in EVIDENCE.** Either run the lane-specified
   8-frame median, or state in the arm's own name that it is fixed-D with throughput-only
   adaptation.
6. **Make the gates able to fail.** Real wall clock in G2; an interior-D case in G3 (non-zero
   path RTT where the formula answer is 3–8, not 1 or 16); invert G5; implement G6; add G7 on
   ask order; run smoke at the campaign's D, not D=2; commit the gate output.
7. **TSV columns:** `depth_oscillating`, `run_rc`, `achieved_rtt_ms`, `achieved_mbps`,
   `netem_drops`, `netem_limit`.
8. **Set netem `limit` explicitly** and record tc drop counters per cell, so the unbounded arm
   is not silently competing against a different buffer than the bounded ones.
9. **Randomise arm order within a cell** (the comment already claims this) and raise n at
   loss>0 to ≥10, reporting the full distribution — the cells are bimodal, so n=3 medians are
   coin flips.

`l2_ask_policy_v3_loss_cloud.sh` currently inherits items 1, 2, 3, 7 and 9 unchanged. Running
it as-is would produce a larger version of the same non-result.
