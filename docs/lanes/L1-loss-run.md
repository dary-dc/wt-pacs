# Lane L1 — the loss run

**Status: ready for cloud agent.** · Round-robin the rig with L2 · Supersedes
`stream-mode-campaign-v2.md` (executed, bannered)

## Purpose

Campaign v2 could not evaluate its own decision rule. Every cell was **lossless** — the one regime
where head-of-line blocking cannot occur, so per-frame's whole reason for existing was never
exercised — and `--mode saturate` produces **no p95**, while the rule is written in p95. This run
closes both gaps.

It is small because per-frame *without* priority is already known to lose 10–25 %.

## Grid

| | |
| --- | --- |
| Arms | **S** = shared (`main`) · **Q** = per-frame + priority (`feat/set-priority-per-frame`). **Drop P** |
| Loss | **0 / 0.5 / 2 %** |
| Mode | **`--mode trace`** — saturate yields no wait times |
| Metric | **p95 time-to-displayable** |
| RTT | 60 and 150 ms |
| Depth | **each arm at its own `D_min`** from `measurements/r2/stream_mode_campaign_v2.tsv` |
| Fixture | `frames_32k`; for a 250 KB cell use **`frames_250k_live`** (320 frames) |
| Repeats | 3, all rows reported |

`--read-bps 0`. One server process per depth. `cargo build --release` first. Build arm Q from the
branch; **do not merge it**.

## Harness p95

`p95_wait_ms` comes from `lab/window-harness/src/metrics.rs`. L2 owns the nearest-rank fix in that
file. **Do not start shaped runs until that fix is on the tree you build** — otherwise L1 and L2
quote unlike percentiles.

## Rig

The **Oracle São Paulo** VM (`cloud-rig-access.md`) — one `netem` on the box. Round-robin with L2:
when L2 is shaping, you wait; when you are shaping, L2 waits. Do not run two shaped campaigns at once
— the second `tc qdisc replace` silently corrupts the first.

`export SSH_KEY=~/.ssh/id_ed25519_rig_agent`. The rig is 954 MB / 2 cores — do not start extra
processes.

## Control — at D = 1

Compare arms at **D = 1**, where there is no concurrency to fair-share. They agreed to 0.13 Mbps in
campaign v2. **A spread at D = 1 is a stop condition.** Do not use D = 16 as a control; concurrency is
the effect under test.

## Report

TSV to `docs/measurements/r2/`. Columns: `arm, fixture, rtt_ms, loss_pct, depth, run, p95_wait_ms,
mean_wait_ms, mbps, peak_outstanding, asks_sent`.

**Verify `p95_wait_ms` is non-zero before reporting anything.** Zero means the mode is wrong and the
run is void — that is exactly what happened last time.

Raw rows. No interpretation.

## Stop conditions

- arms differ at D = 1
- `p95_wait_ms` is zero
- a run will not complete — **that is the finding.** Do not shorten a trace, drop a depth, or swap a
  fixture to make it finish

If one trips, the campaign is void from that point. Say so; do not continue and annotate.
