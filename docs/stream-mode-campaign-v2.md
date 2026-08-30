# Campaign: shared vs per-frame, second attempt

> ## ✅ EXECUTED 2026-08-29 — do not re-run this spec as written
>
> Ran clean: **432/432 rows, 0 failures** (`measurements/r2/stream_mode_campaign_v2.tsv`).
> Analysis: [`measurements/r2/CAMPAIGN_V2_ANALYSIS.md`](measurements/r2/CAMPAIGN_V2_ANALYSIS.md).
>
> **What it proved.** Per-frame without priority (**P**) trails shared (**S**) by 10–25 %; per-frame
> **with** priority (**Q**) ties S. The fair-sharing mechanism is confirmed and `set_priority` fixes
> the deficit — which explains why the earlier X3 campaign's per-frame arm looked catastrophic.
>
> **Two flaws in the spec below — both in the plan, not the run:**
>
> 1. **No loss dimension.** Every cell is lossless, which is the one regime where head-of-line
>    blocking cannot occur — so per-frame's entire reason for existing was never exercised.
> 2. **`--mode saturate` produces no p95.** All 144 cells report `p95_wait_ms = 0`. The decision rule
>    fixed in advance was written in p95, so **this data cannot evaluate its own rule.**
>
> **The control below is also wrong.** "At RTT 20 all three arms should be close" was checked at
> **D = 16**, where concurrency *is* the effect under test. At **D = 1** the arms agree to within
> 0.13 Mbps. Use D = 1 as the control; a spread there is a real stop condition.
>
> **The follow-up is `parallel-work-plan-2026-08-29.md` § Lane A** — S vs Q only, loss 0/0.5/2 %,
> `--mode trace` so waits exist, each arm at its own `D_min`. Read that instead.

**For:** wt-pacs implementer (cloud) · 2026-08-29 ·
**Supersedes:** Task C of `r2-data-collection-brief.md` and R4 of `stream-mode-remediation.md`

## Purpose, in one paragraph

We still do not know whether frames should travel on **one persistent stream** or **one stream per
frame**. The first campaign produced no usable answer (`stream-mode-decision-report.md` is retracted).
Since then the harness bug that caused its "timeout" is fixed, and `set_priority` — the mechanism that
makes per-frame competitive — is implemented on `feat/set-priority-per-frame`. This campaign answers
the question with the instruments working.

## Three arms, not two

| arm | server | why it is here |
| --- | --- | --- |
| **S** shared | `--stream-mode shared` | the baseline |
| **P** per-frame, no priority | `--stream-mode per-frame`, `main` | explains why per-frame needed `D`=8 where shared needed 2 |
| **Q** per-frame + priority | `--stream-mode per-frame`, branch | the design actually worth deciding on |

**S vs P** answers the old diagnostic question. **P vs Q** measures what priority buys. **S vs Q**
decides the mode. Measuring P alone would characterise a configuration we are about to stop using;
measuring Q alone would leave the `D`=8 asymmetry unexplained.

## Where to run it — the rig, not your container

`sch_netem` will not load in the agent container. **Do not work around it with `--rtt-ms`** — it is a
userspace stand-in that was measured inert in shared mode, and it is how an earlier campaign produced
a flat 0.408 that was never a result.

Use the existing São Paulo rig. It is a VM, `netem` works there, and it is already scripted:

```
lab/scripts/cloud_common.sh              cloud_set_netem, cloud_ensure_server
lab/scripts/cloud_netem.sh               shaping profiles
lab/scripts/deploy_exact_server_cloud.sh
lab/scripts/run_cloud_experiments.sh     pattern to copy
```

`E4_CLOUD_MILD_*` in `.local/measurements/cloud/` is proof it has worked before. **You need the SSH
key; that is the only blocker.** Ask for it rather than substituting a simulated link.

> Cloud cells carry real internet RTT **plus** netem. Both arms pay it equally so comparisons hold,
> but never put cloud and local numbers in the same table.

## Make it fast — this is a saturation question

Use **`--mode saturate`**, not `--mode trace`. Task C is throughput-vs-depth; saturate measures steady
state for `--fill-dwell-ms` and stops. Trace mode walks 500 steps and is why a single run took ~140 s.

Two levers, both large:

| | |
| --- | --- |
| `--mode saturate` | ~8 s per run instead of ~140 s |
| **parallel network namespaces** | each netns has its own `lo` and its own qdisc, so cells do not interfere and may reuse the same port. 8-way is comfortable at 10 Mbit |

X2's ±1 Mbps coarseness came from a **2 s dwell**. Use **5 s**. Spend the precision; parallelism pays
for it.

## Grid

| | |
| --- | --- |
| Fixtures | `frames_250k` (250 KB), `frames_32k` (~51 KB) |
| Link | 10 Mbit |
| RTT | 20 / 60 / 150 ms — 20 is the control, 150 is where X2 saw the modes diverge |
| Depth | **1, 2, 3, 4, 6, 8, 12, 16** — every value, do not stop at the knee |
| Repeats | 3, report all three rows, never a mean alone |
| Arms | S, P, Q |
| Dwell | `--fill-dwell-ms 5000` |

`--read-bps 0` always. One server process per depth — `--depth-sweep` panics with *"rustls ring
provider already installed"*.

**Rebuild first.** `cargo build --release` — a stale harness cost an hour tonight, and the CLI changed
(`--shared-stream` became `--stream-mode`).

## What to report

TSV per row: `arm, fixture, rtt_ms, depth, run, mbps, p95_wait_ms, peak_outstanding, asks_sent`.
Commit to `docs/measurements/r2/` — **`.local/` is gitignored and results written there reach nobody.**

Raw rows only. No knee-finding, no summary, no interpretation. State facts:
*"arm Q, 250 KB, 150 ms, D=4, run 2: 7.8 Mbps"* — not *"priority helps."*

## Controls that are stop conditions

- **RTT 20 ms, all three arms should be close.** If they are not, something is wrong that has nothing
  to do with the hypothesis. Stop and report
- **A run that will not complete is the finding.** Do not shorten a trace, drop a depth, or swap a
  fixture to make it finish. That substitution is exactly what produced the last campaign's unusable
  p95
- If a stop condition trips, the campaign is void from that point. Say so; do not continue and
  annotate

## What each outcome means

Not yours to conclude, but stated so you know what is being looked for:

- **Q's `D_min` falls toward S's** → the fair-sharing explanation is right and priority fixes it
- **Q ≈ P** → priority does not help here; per-frame loses on its merits, mechanism understood
- **Q beats S at 150 ms** → per-frame becomes the candidate, and the client-side cost of out-of-order
  arrival is the next question
