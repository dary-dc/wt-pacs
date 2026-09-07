# R6 — stream shape, on a rig that can produce head-of-line blocking

**Pre-registration:** [`../../lanes/R6-preregistration.md`](../../lanes/R6-preregistration.md),
written before the campaign ran.
**Instrument validation:** [`E0-validation.md`](E0-validation.md) — run first; a failure
there voids everything here.

## Why this supersedes every earlier stream-shape measurement

Every campaign before R6 used a **closed-loop reader**: it blocked until each frame arrived
before advancing to the next. The transport could therefore never fall behind the reader,
and every byte in flight was a byte the reader still wanted. Head-of-line blocking — the
mechanism that decides between a shared stream and per-frame streams — could not occur.

E0-R6a measured this directly. In the same cell, with the same server:

| reader | stranded bytes |
| ------ | -------------- |
| closed | **0.00 MB** |
| open | **18.31 MB** |

Zero. Not "little" — none, structurally. So the L4 e-series and R-series stream-shape rows
measured a rig with the mechanism under test switched off, and the conclusion drawn from
them has been withdrawn.

**Controller conclusions from L4 are unaffected** and are not re-opened here: they turned on
loss regime and queue occupancy, neither of which depends on reader mode.

## Cells

One path throughout — 50 ms RTT, 20 Mbps — varying only loss and reader speed, so that a
difference between cells cannot be a difference of link.

| cell | loss | step-scale | stranding | role |
| ---- | ---- | ---------- | --------- | ---- |
| X1 | 0.1 % | 2 | 152 frames | deployment case: both mechanisms live |
| X2 | 0 % | 1 | 137 frames | H5 alone — zero loss makes H4 impossible by construction |
| X3 | 1 % | 8 | 35 frames | loss-dominant, weak stranding |
| X3L | 1 % | 32 | 33 frames | X3 at **250 KB** frames — tests whether the penalty scales with frame size |
| X3S | 1 % | 7 | 27 frames | X3 under the **scroll** trace — stranding by overrun, not displacement |
| N0 | 0 % | 8 | 0 frames | **negative control** — all arms must tie |

Step-scale is the calibrated operating point from E0-R6b, chosen once per cell on the
incumbent arm and frozen across arms.

## Arms

| arm | server flags |
| --- | ------------ |
| `shared` | `--stream-mode shared` |
| `perframe_fair` | `--stream-mode per-frame` |
| `perframe_fifo` | `--stream-mode per-frame --send-fairness false` |

A **fixed-N pool is not an arm**: it needs a server change and this lane may not modify
`server/`. It is recorded as untested rather than inferred about.

## The real-path repeat

R6 was re-run against the Oracle rig over a real internet path shaped by `sch_netem`, which
is what [`oracle-runbook.md`](oracle-runbook.md) was written for and could not execute from
a cloud agent container. **Three of the four cells agree with the simulator; the decisive
one does not reproduce.**

| | netsim | real path |
| --- | --- | --- |
| N0, X2, X1 | tie | tie |
| **X3 (1 % loss)** | shared wins **+250 %**, separated 3/3 | **not a result** — ranges overlap, sign flips across repeats |

Read [`r6cloud-results.md`](r6cloud-results.md) before quoting any stream-shape number, and
[`real-path-notes.md`](real-path-notes.md) for how the two instruments differ. The real-path
campaign also found a defect that applies to **any** netem-based loss experiment comparing
stream shapes — netem draws loss per GSO batch, and the batch size differs by arm
([`r6cloud-results.md`](r6cloud-results.md) §3.2).

## Files

| file | what |
| ---- | ---- |
| `r6.tsv` | the main netsim campaign — every run, including VOID rows |
| `r6_250k.tsv` | X3L: the decisive cell at 250 KB frames, testing the mechanism's prediction |
| `r6scrub.tsv` | X3S: the decisive cell under the scroll trace |
| `r6scrub_scale6_VOIDED.tsv` | the run that voided 4 of 9 rows — kept as the evidence for E0-R6c |
| `E0-validation.md` | netsim instrument validation and calibration |
| `r6cloud.tsv` | **real-path campaign**, 36 rows, 0 VOID |
| `r6cloud-results.md` | real-path results, gates and adversarial review |
| `real-path-notes.md` | the rig instrument, and four ways it is not netsim |
| `x3l-run-card.md` | **the outstanding run** — X3L on the rig, and the three ways it fails silently |
| `r6cloud_calibration.tsv` | real-path E0-R6b/c sweep and per-realisation re-check |
| `r6cloud_fairness.tsv` | competing-flow fairness, two flows on one bottleneck |
| `r6cloud_fairness_controls.tsv` | each flow alone on the same bottleneck — the control that makes the split readable |
| `r6cloud_gso_cpu.tsv` | GSO segment cap: throughput and CPU per byte |
| `r6cloud_gso_batch.tsv` | measured GSO batch size, and netem's per-batch loss draw |

## Reading the TSV

Every row carries its own `verdict`. A row is VOID when it failed a condition fixed in the
pre-registration — `center-dropped`, `censored`, `no-stranding`, `depth`, `thin-tail`,
`client-bound`, `netsim-bound`. **VOID rows are kept, never deleted**: failures are
systematically the slowest runs, so dropping them flatters whichever arm fails. That
happened once already, in R2.

Apply the decision rules with:

```bash
python3 lab/scripts/r6_analyse.py docs/measurements/r6/r6.tsv
```
