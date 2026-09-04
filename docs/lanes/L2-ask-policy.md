# Lane L2 — ask policy: unbounded vs fixed vs dynamic

**Status: harness v2 evidence landed — cite
[`l2_ask_policy_EVIDENCE.md`](../measurements/r2/l2_ask_policy_EVIDENCE.md) only.**  
v1 rows remain withdrawn
([`l2_ask_policy_METHODOLOGY_REVIEW.md`](../measurements/r2/l2_ask_policy_METHODOLOGY_REVIEW.md)).  
Next: fix path-RTT probe, then loss-axis expansion (plan in the evidence doc). · Harness only ·
Round-robin the Oracle São Paulo rig with L1

## Purpose

Two questions in one run:

1. **Does bounding the ask depth help at all?** The shipping client asks for every frame in the series
   at once. The window design exists to replace that and was never implemented
2. **Does adaptivity earn its complexity over a fixed constant?**

D26 says *MVP is fixed constants on purpose; adaptive is the production end state* — it deferred the
question without evidence. **This run is that evidence.** If dynamic does not beat fixed, D26 stands
confirmed.

Run it in the **harness**, not a browser client. The harness is a client, it is far cheaper, and the
finding transfers.

## Arms — two exist, one needs writing

| arm | how |
| --- | --- |
| **control** | `--depth 0` — the legacy fire-all schedule. **Already exists** |
| **fixed** | `--depth N`, N from the formula for the cell, held for the run. **Already exists** |
| **dynamic** | harness computes `D` live. **New code** |

## Pre-run harness fix — nearest-rank p95 (same file)

L2 already edits `lab/window-harness/src/metrics.rs` for the dynamic arm and the new report columns.
Fold the percentile fix into that edit — do not leave it for another agent.

Today `wait_stats` picks
`sorted[((N - 1) * 0.95).ceil()]`. Replace it with **nearest-rank**, the rule the client telemetry
contract uses:

- sort ascending
- `rank = ceil(p / 100 × N)`, clamped to `[1, N]`
- value = `sorted[rank - 1]`

Pin with a unit test over a vector where the old index and nearest-rank disagree. Do this **before**
the campaign rows; L1 and L2 both quote `p95_wait_ms` from this function.

## The dynamic estimator — implement exactly this, do not vary it

These are design decisions, already made. Implement as written; if something cannot be implemented as
specified, stop and report rather than substituting.

- **RTT estimate:** median of (first-byte time − ask time) over the **last 8 completed frames**
- **`Tf` estimate:** median frame bytes ÷ observed throughput over the **last 8 completed frames**
- **`D = ceil(U × (1 + RTT / Tf))`**, with **`U = 0.95`**
- **Recompute** every **8 completed frames**, not per frame
- **Damping:** adopt a new `D` only if it differs by ≥ 1 **and** the same value has been computed on
  **2 consecutive** evaluations
- **Clamp** `D` to **[1, 16]**
- **Warm-up:** use the fixed value until 8 frames have completed

Record the `D` trajectory — emit `d_current` per frame so the path can be inspected, not just the
outcome.

## Grid

| | |
| --- | --- |
| Arms | control · fixed · dynamic |
| RTT | 20 / 60 / 150 ms |
| Loss | 0 and 0.5 % |
| Fixture | `frames_32k` |
| Mode | `--mode trace` |
| Metric | **`p95_lateness_ms`** (primary); also report `p95_wait_ms` diagnostic + bytes on the wire |
| Repeats | 3, all rows reported |

`--read-bps 0`. `cargo build --release` first.

## Rig

The **Oracle São Paulo** VM (`cloud-rig-access.md`) — one `netem` on the box. Round-robin with L1:
when L1 is shaping, you wait; when you are shaping, L1 waits. Do not run two shaped campaigns at once
— the second `tc qdisc replace` silently corrupts the first.

Land the nearest-rank fix in `metrics.rs` **before** either lane's shaped campaign rows, so L1 and
L2 quote the same p95 rule.

`export SSH_KEY=~/.ssh/id_ed25519_rig_agent`. The rig is 954 MB / 2 cores — do not start extra
processes.

## Report

TSV to `docs/measurements/r2/`. Columns: `arm, rtt_ms, loss_pct, run, p95_wait_ms, mean_wait_ms,
bytes_on_wire, asks_sent, d_min_observed, d_max_observed`.

Plus the per-frame `d_current` trace for the dynamic arm, as a separate file.

Raw rows. No interpretation — **especially** do not conclude whether dynamic "wins."

## Stop conditions

- the control arm (`--depth 0`) fails to complete — it is today's shipping behaviour; if it cannot
  run, the cell is wrong
- `p95_wait_ms` is zero — wrong mode, run is void
- `D` oscillates every evaluation despite the damping rule — stop and report the trajectory
