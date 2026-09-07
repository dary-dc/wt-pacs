# L2 ask-policy v4 — reduced cloud grid (RTT profile 60)

> **VOID 2026-09-07.** `cloud_netem.sh stats` deleted the qdisc before reading it.
> Every `netem_drops` call removed rate/delay/loss after the path-RTT probe. Bulk
> ran at ~15 Mbps on a named 10 Mbit cap; all 182 `netem_drops` are 0. Do not cite
> these rows for loss, shaping, or a cap. Fix and rerun: [`L2-ask-policy-v4-methodology-fix.md`](../../lanes/L2-ask-policy-v4-methodology-fix.md).

**Date:** 2026-09-07 · **Branch:** `cursor/l2-harness-fix-plan-c999` · **Lab only** · **VOID**  
**Script:** `SKIP_SMOKE=1 HARNESS_IPV4=--ipv4 RTTS=60 lab/scripts/l2_ask_policy_v4_cloud.sh`  
**E0:** `lab/scripts/l2_e0_v4_profile.sh` — PASS (ens3 netem: 10 Mbit, delay 30 ms, limit 1000, loss 0 and 0.5 %).  
**Raw:** `.local/l2/v4/` (gitignored). Summariser: `lab/scripts/l2_v4_summarize.py`.

This is the loss question the FIFO model cannot answer. It is **not** a reading of the void v1–v3 rankings. Local loss=0 bake-off (same arms, emulated RTT): [`l2_ask_policy_v4_local_SUMMARY.md`](l2_ask_policy_v4_local_SUMMARY.md).

## Grid that ran

| | |
| - | - |
| Path | agent → Oracle São Paulo; netem profile **60** (one-way +30 ms, 10 Mbit, limit 1000) |
| Measured path RTT | **183 ms** (loss 0) / **173 ms** (loss 0.5) — WAN dominates; do not cite these cells as “RTT = 60 ms” |
| Formula `D` | 8 (from measured path RTT, not the profile name) |
| Traces | scroll, jump · 40 ms steps |
| Loss | 0 (n=3) and 0.5 % (n=10) · seven arms · shuffled |
| Rows | **182/182** `run_rc=0`, no empty waits, no drain fail, `duplicate_asks=0` |
| `netem_drops` | 0 in every row — the TSV counter did not increment; do not treat that column as proof that no frames were dropped |
| Oscillation | one `dynpath` jump/loss0.5/run6 flagged; `D` stayed 8–8 |

Full RTT 20/150 grid: **not run**. Questions 2 and 3 below are no.

## Integrity vs the simulator (loss 0)

Every loss-0 cell’s p95 is **>5 %** from `l2_policy_sim.py` at the measured path RTT (gaps 50–500 %). The model has no QUIC/WebTransport startup. On this path that startup sets p95 to ~500–530 ms for every arm. **Reported, not smoothed.** Read **median lateness** and **stranded bytes**.

## Question 1 — loss 0: does the rig reproduce the design-doc §3 ordering?

**Not on p95.** All seven arms sit at 498–526 ms. That is the session start, not the policy.

**On median lateness and stranded bytes, the mechanism matches the local grid and §3:**

| arm | scroll median (stranded KB) | jump median (stranded KB) |
| --- | ---: | ---: |
| control | 149 (0) | 154 (0) |
| **window** | **0 (0)** | **56 (224)** |
| adr | 0 (0) | 123 (160) |
| bulk | 0 (0) | 78 (768) |
| bounded | 0 (0) | 119 (160) |
| dynpath | 0 (0) | 132 (160) |
| dynclean | 0 (0) | 116 (160) |

- Scroll: any forward prefetch drives median lateness to 0; control pays the path (~150 ms). Control is the worst scroll median, as §3 said.
- Jump: **window** (forward `K`, no cap) is best. `adr` / `bounded` / dynamic sit together (~120 ms) — the cap at `D=8` binds on a ~180 ms path; locally, at emulated 60 ms and `D=4`, `adr` ≈ `window`. Bulk’s median is better than `adr` but it strands **768 KB**. Bounded ≈ adr (119 vs 123), as §3 said for that pair.
- Bulk is not “worst p95” here because p95 is startup. It is still the wasteful policy.

## Question 2 — loss 0.5 %: does any arm separate beyond its own IQR?

**No, on p95.** Jump/loss 0.5 % p95 medians are 521–523 ms; ranges overlap (e.g. control 465–530, bulk 473–578, adr 520–530).

Medians keep the same order as loss 0 (window 51, bulk 91, adr 115, control 154). Loss does not mint a new winner.

## Question 3 — does depth interact with loss?

**No.** Bounded vs bulk on jump median: 119 vs 78 at loss 0, 115 vs 91 at loss 0.5 %. The gap does not grow. Stranded bytes are unchanged (160 vs 768). Do not run the 20/150 grid for this question.

## What the lab should implement

Unchanged from the local bake-off, with one rig caveat:

1. **On-screen + forward prefetch `K` + fixed cap `D`** is the policy the lab measures (`adr` when we want the ADR formula; `window` when we want the same lookahead without the cap).
2. **Not bulk** on traces that abandon work (768 KB stranded on every jump cell).
3. **Not dynamic** as a default — `dynpath` / `dynclean` match `adr`; `dynpath` wandered `D` on some cells (6–12) without beating it.
4. **On a ~180 ms WAN path, `D=8` costs median vs unbounded `window`.** Size `D` to the *measured* path RTT, and do not read p95 on a path whose startup is larger than the policy effect.
5. **0.5 % loss does not change the policy.** The model staying silent on loss was correct: this grid has no loss-driven ranking.

Product clients are not changed. A later product PR can copy this lab policy.

## What this does not decide

- ADR / D26 text — still no product lock.
- Real browser scroll traces.
- Whether 1–2 % loss would separate arms (not run; 0.5 % did not).
- The `netem_drops` column (always 0; do not cite).
