# Campaign v2 — analysis

**Data:** `stream_mode_campaign_v2.tsv`, 432 rows, 0 failures · **T2** (São Paulo rig, server netem)
**Analysed:** 2026-08-29

## What it establishes

**The fair-sharing mechanism is confirmed, and `set_priority` fixes it.**

`frames_32k` (the finer-resolution fixture — more frames per dwell, so less quantisation):

| RTT | D | S shared | P per-frame | Q per-frame + priority |
| --- | - | --- | --- | --- |
| 60 ms | 12 | **7.920** | 7.032 | **7.920** |
| 150 ms | 12 | **7.408** | 6.350 | **7.374** |
| 150 ms | 8 | 6.520 | 5.052 | 5.991 |

- **P trails S by 10–25 %** across the grid. Per-frame without priority genuinely loses
- **Q tracks S closely** at almost every depth. Priority recovers the deficit
- **Q does not beat S.** It ties

This explains X3. Its per-frame arm was the P configuration at a depth below saturation, which is why
it looked catastrophic. The mechanism proposed then — QUIC fair-shares bandwidth across concurrent
streams, so all of them finish late — is now measured rather than argued.

## The control — my specification was wrong, the agent was right to continue

I specified *"at RTT 20 all three arms should be close"* and the agent checked it at **D = 16**, found
a 1.200 Mbps spread, flagged it, and continued.

The spread is real, not noise — run-to-run spread was **0.000–0.800** while arm spread was 1.200. But
**D = 16 is exactly where fair-sharing bites**, so the control was measuring the effect under test.

At **D = 1**, where there is no concurrency to share, the arms agree:

```
frames_250k  D=1:  S=4.800  P=4.800  Q=4.667   spread=0.133
frames_32k   D=1:  S=0.990  P=1.024  Q=1.024   spread=0.034
```

**That is the control, and it passes.** Divergence begins at D = 2, which is the first depth where
per-frame has two streams to share between — precisely the predicted onset.

## What it does NOT establish — two gaps, both mine

**1 · No loss dimension.** I dropped it when rewriting the grid for three arms. **The entire original
hypothesis — that per-frame wins under loss because head-of-line blocking only hurts a shared stream —
is untested by this campaign.** Every cell is lossless, which is the regime where the two are expected
to be equivalent.

**2 · No p95.** All 144 cells have `p95_wait_ms = 0`: `--mode saturate` measures link utilisation and
does not produce a per-frame wait. I chose saturate for speed. But the decision rule fixed in advance
was *"per-frame p95 better than shared by > 15 % at 0.5 % loss"* — **a p95 rule this data cannot
evaluate.**

So: the campaign answers *"does priority fix per-frame's deficit?"* (yes) and not *"should we use
per-frame?"* (still open).

## Anomalies, recorded not explained

- **Q at `frames_32k` / 150 ms / D=16 = 5.701**, against 7.374 at D=12 and S = 7.391. A single-point drop
- **S at `frames_250k` / 60 ms collapses** at high depth: 7.200 (D=8) → 3.867 (D=12) → 2.933 (D=16).
  A shared stream should not degrade with depth past saturation
- `frames_250k` values quantise in 0.4 Mbps steps — 80 frames at a 5 s dwell is too few. Prefer
  `frames_32k` for anything fine-grained

## What would close it

Small and targeted — **S vs Q only**, since P is now known to lose:

| | |
| --- | --- |
| Arms | S, Q |
| Loss | **0 / 0.5 / 2 %** — the missing dimension |
| Mode | **`--mode trace`**, which produces waits. Saturate cannot |
| Metric | **p95 time-to-displayable** |
| Depth | each arm's `D_min` from this campaign, not a shared constant |
| Fixture | `frames_32k`; `frames_250k_live` if a 250 KB cell is wanted (the 80-frame fixture is too small) |

Decision rule, unchanged: **Q must beat S by > 15 % at 0.5 % loss** to justify the client-side cost of
out-of-order arrival. Lossless it only ties, and a tie is not a reason to change a working design.
