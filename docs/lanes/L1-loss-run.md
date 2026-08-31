# Lane L1 — the loss run (v2 methodology)

**Status: ready for cloud agent.** · Round-robin the Oracle São Paulo rig with L2  
Supersedes the v1 grid in `l1_s_vs_q_loss.tsv` (metric polluted by cache-hit zeros).

## Purpose

Decide whether **Q** (per-frame + priority) beats **S** (shared) on **miss-only p95 wait**
under loss. Decision rule (unchanged): **Q must beat S by > 15 % on miss p95 at 0.5 % loss**.

v1 failed that question: all-sample p95 mixed cache hits (0) with network waits, so arms with
different hit rates were incomparable.

## Metric (normative)

| Field | Use |
| --- | --- |
| **`miss_p95_wait_ms`** | **Decision.** Nearest-rank p95 over waits **> 0** only |
| `miss_mean_wait_ms` | Secondary |
| `cache_hit_rate`, `cache_misses` | Integrity — not the decision |
| `p95_wait_ms` (all samples) | Diagnostic only; do not decide on it |

## Grid

| | |
| --- | --- |
| Arms | **S** shared (`main`) · **Q** per-frame+priority (`feat/set-priority-per-frame`). Drop P |
| Loss | **0 / 0.5 / 2 %** |
| Mode | `--mode trace` |
| Metric | **`miss_p95_wait_ms`** |
| RTT | 60 and 150 ms |
| Depth | **formula** `D = ceil(0.95 × (1 + RTT/Tf))` with Tf = frame_bits / 10e6 — **not** saturate `D_min` |
| Fixture | `frames_32k` |
| Trace | `lab/traces/l1_one_way_80.json` — **80 unique frames, no revisits** |
| Repeats | **10** on loss > 0; **5** on lossless (incl. D=1 control) |

Formula depths for 32 KB @ 10 Mbit: **D(60)=4**, **D(150)=7**.

`--read-bps 0`. Build arm Q from the branch; **do not merge it**.

## Integrity gates (per cell)

Void the cell (record `VOID` row, stop campaign) if:

- `wait_samples == 0`
- **`cache_misses < 20`** on a loss > 0 cell (not enough miss samples for p95)
- **`cache_hit_rate > 0.90`** on a loss > 0 cell (prefetch still dominates)
- harness non-zero exit / timeout

D=1 lossless control: arms' median **miss_p95** must agree within 25 % relative or 200 ms absolute.

## Rig

Oracle São Paulo (`cloud-rig-access.md`). Round-robin with L2.  
`export SSH_KEY=~/.ssh/id_ed25519_rig_agent`.

## Report

TSV: `docs/measurements/r2/l1_s_vs_q_loss_v2.tsv`

Columns: `arm, fixture, rtt_ms, loss_pct, depth, run, miss_p95_wait_ms, miss_mean_wait_ms,
p95_wait_ms, mean_wait_ms, cache_hit_rate, cache_misses, asks_sent, peak_outstanding`

Raw rows. No interpretation in the agent report.

## Runner

`lab/scripts/l1_loss_run_v2_cloud.sh`
