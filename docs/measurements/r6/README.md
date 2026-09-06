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

## Files

| file | what |
| ---- | ---- |
| `r6.tsv` | every run, including VOID rows |
| `E0-validation.md` | instrument validation and calibration |

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
