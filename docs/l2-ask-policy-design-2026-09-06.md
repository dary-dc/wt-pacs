# L2 ask policy — what the design should be, and why

**Status: analysis complete on T2-local evidence; one rig campaign prepared, not run.**
Branch `cursor/l2-harness-fix-plan-c999`; the harness rework, the simulator and the probe are the
three commits before this one.

**Landing rule — lab only.** Any policy we adopt from this work is implemented in
`lab/window-harness` and `lab/scripts/` (and the FIFO simulator). Product clients
(`client/transport-wasm`, `client/transport-ts`, harness pages) stay as they are. If a product-shaped
ask loop is needed to measure something, copy or overlay it under `lab/` — do not edit the shipping
ask path until a separate product decision.

The lane asked two questions ([`lanes/L2-ask-policy.md`](lanes/L2-ask-policy.md)): does bounding
the ask depth help at all, and does adapting it live earn its complexity over a fixed constant?
Three rig campaigns ([`measurements/r2/l2_ask_policy_EVIDENCE.md`](measurements/r2/l2_ask_policy_EVIDENCE.md),
reviewed in [`measurements/r2/l2_ask_policy_V2_ADVERSARIAL_REVIEW.md`](measurements/r2/l2_ask_policy_V2_ADVERSARIAL_REVIEW.md))
could not answer either. This document answers both from a model validated against those
campaigns' own rows, a harness that now measures what the model describes, and one browser probe. It ends with the decision it asks for and with the ways it could be wrong.

## 1 · What the three campaigns established, and what is void

| Fact | Source | Stands? |
| - | - | - |
| Workload equalisation holds in v2: every arm asks for the same 80 frames once and pulls the same bytes | v2 TSV, all 54 rows | yes |
| The v2 "fixed" and "dynamic" arms were the same policy: both ran `D = 16` for the whole run in every cell | `d_min = d_max = 16` on every row | yes |
| Control differs from `D = 16` by 6 %, with no depth term: a two-parameter FIFO model reproduces it | v2 order model, then the simulator below (§2) | yes |
| That 6 % is the ring window asking for frames 79, 78, 77… at the study start | window code; reproduced in simulator and harness | yes |
| Ask→first-byte behind a backed-up stream measures the client's own queue, and the estimator ratchets to the clamp | v1 rows; reproduced in a unit test and on loopback (§4) | yes |
| Any ranking of control / fixed / dynamic from v1–v3 | — | **void** (one policy under two names, wrong window, estimator input overridden) |
| Loss = 0.5 % cells | v2, n = 9 per arm, sd larger than the means | **no signal either way** |

## 2 · The model, and how far it can be trusted

`lab/scripts/l2_policy_sim.py`: the shared ordered stream as a FIFO pipe. A reader walks a trace on
its own clock; at every step and every arrival the client offers the frame on screen (always) and a
prefetch window ahead of it (while in-flight < `D`); an ask reaches a serial server after `RTT/2`,
the frame serialises at `Tf` behind whatever is already queued, and lands `RTT/2` later. Lateness is
`arrival − scheduled`; "stranded" is bytes no step of the trace ever wants.

**Validation, in order of strength.**

| Check | Result |
| - | - |
| Fit (rate, per-ask cost) on the v2 **control** rows, predict the v2 **D = 16** rows with the v2 harness's wrapping window | within 0.3 % / 0.2 % / 1.2 % of the six-row means at 20 / 60 / 150 ms RTT; the rows' own run-to-run spread is 1.1 % / 0.4 % / 12 % |
| Loopback harness vs simulator, same cells, saturated reader (16 ms steps) | control 801 vs 803 ms p95; ring-D16 905 vs 906; forward-D16 790 vs 803; RTT 60 ms 861 vs 863 |
| Loopback, link faster than the reader (40 ms steps), jump trace | bulk ask 336 vs 338 ms p95; control 89 vs 86; the ordering of all seven policies is the same in both |

Where the two disagree it is in cells whose p95 is a warm-up transient of a 56-step trace (tens of
milliseconds, medians 0 in both). `lab/scripts/l2_local_crosscheck.sh` reproduces the table.

The model has no congestion control and no loss. The per-ask cost fitted on the rig (0.5–0.9 s per
run, growing with RTT) is QUIC's start-up; it is a constant per run and cancels in every comparison.

## 3 · What the model shows

Two regimes, decided by one ratio: frame time `Tf` (32 KB at 10 Mbps: 25.6 ms) against the reader's
step. All campaigns so far ran the first.

**Reader faster than the link (16 ms steps, demand/supply 1.6).** Every frame is late and lateness
grows linearly with the step; the pipe never idles, so no ask policy can move the number — except
by putting frames the reader does not want ahead of the ones it does. p95 lateness, RTT 60 ms:

| Policy | scroll | reversal | jump |
| - | - | - | - |
| control (ask what is on screen, unbounded) | 803 | 537 | 595 |
| ADR window (`D = 4`, prefetch 3) | 803 | 537 | 595 |
| `D = 16`, prefetch 15 (the v2 arms) | 803 | 537 | 671 |
| bulk ask (everything, unbounded) — the shipping client | 803 | 537 | 1 209 |
| bounded commitment (`D = 4`, prefetch everything) | 803 | 537 | 595 |

The lever in this regime is stride, not depth — the ADR already says so.

**Link faster than the reader (40 ms steps, demand/supply 0.64).** Now prefetch is what removes
lateness, and depth is what limits the damage of a jump. p95 lateness, RTT 60 ms, with the bytes
stranded on a reversal / jump:

| Policy | scroll | reversal (stranded) | jump (stranded) |
| - | - | - | - |
| control | 86 | 86 (0 KB) | 86 (0 KB) |
| prefetch 3, unbounded | 14 | 42 (96 KB) | 71 (96 KB) |
| ADR window (`D = 4`, prefetch 3) | 14 | 42 (96 KB) | 71 (96 KB) |
| `D = 16`, prefetch 15 | 14 | 42 (480 KB) | 81 (480 KB) |
| bulk ask — the shipping client | 14 | 42 (928 KB) | **297** (768 KB) |
| bounded commitment (`D = 4`, prefetch everything) | 14 | 42 (896 KB) | 70 (448 KB) |

Read across: without prefetch every frame waits `RTT + Tf`; with any prefetch that covers that much
reader time, lateness after warm-up is zero. Depth changes nothing until the lookahead is large:
then a jump lands behind everything in flight, and the cap bounds that to `D × Tf`. The shipping
client's bulk ask is the worst policy in every cell where policies differ, by 4× on a jump.

## 4 · The estimator's input

The dynamic arm needs a path RTT. Its three candidate inputs, each checked:

| Input | Where checked | What happens |
| - | - | - |
| the transport's own estimate (`WebTransport.getStats().smoothedRtt`) | `lab/bench/wt_stats_probe.html` in Chromium 141 | **the method does not exist** in this Chromium; a page has no RTT from the browser |
| ask→first-byte, median of the last 8 (the lane's spec) | unit test; loopback, saturated scroll | ratchets 4 → 16 within 48 frames and stays there; it measures the client's queue |
| ask→first-byte from asks issued into an empty pipe | unit test; loopback | holds the warm-up value while the pipe is busy (which is exactly when depth does not matter), settles on the interior `D` when it idles |
| a value measured out of band (`--path-rtt-ms`) | loopback, jump at 40 ms | settles on the formula's 4 |

So the estimator can be made honest, but in the only regime where it has clean samples, `D` does
not matter beyond "at least the prefetch count"; and in the regime where `D` would matter it has no
clean samples. There is nothing left for it to adapt to.

## 5 · Recommendation

1. **Ask policy for the interactive viewer: the frame on screen at once, a forward prefetch window,
   an in-flight cap; all fixed.** Prefetch `K` covers one RTT plus one frame time at the reader's
   cadence (`K = ceil((RTT + Tf) / step)`; 3–4 at 60 ms, 6–7 at 150 ms for this fixture); the cap
   `D` is the ADR formula at a conservative RTT (150 ms → 7 for 32 KB at 10 Mbps), or simply `D = K`.
   The window never wraps and never asks behind the direction of travel.
2. **No dynamic depth.** D26 (fixed constants) stands — confirmed by structure rather than by the
   void campaigns. Revisit only if a browser exposes a transport RTT.
3. **The bulk ask stays for non-interactive preload only** (a study opened to be read end to end):
   it is the cheapest policy when nothing is abandoned and the worst when anything is.
4. **Metric.** Report lateness as median / p75 / p95 / max by step, plus stranded bytes. On a
   56–119-step trace p95 is the warm-up; the v2 "fixed beats control" rows were that transient.

## 6 · The harness now (fix list of the v2 adversarial review, §"what to fix")

| # | Item | State |
| - | - | - |
| 1 | window shape + ask-order unit test | forward window clamped at the edges (default); ring kept only to reproduce v2; three tests |
| 2 | depth separated from prefetch | `--depth` caps in flight (0 = unbounded; the on-screen frame is exempt), `--prefetch` is the lookahead; deferred prefetch takes a freed slot on arrival |
| 3 | abandoned-work traces | `lab/traces/l2_reversal.json`, `l2_jump.json` (generated by the simulator, so both tools run the same trace) |
| 4 | distribution with step index | `lateness_ms` in step order; median / p75 / p95 / max; `wall_ms`, `achieved_mbps`, `stranded_bytes` |
| 5 | estimator RTT input | `--rtt-source path|first-byte|clean`; no silent override; `clean` holds `D` rather than guessing |
| 6 | gates that can fail | `l2_harness_smoke.sh`: 10 gates, measured wall clock, interior-`D`, inverted shortfall, concurrency invariant, ask order with a negative control that must fail; 10/10 on loopback |
| 7–8 | TSV columns, netem limit and drop counters | `l2_ask_policy_v4_cloud.sh`, `cloud_netem.sh stats`; the v1–v3 campaign scripts stay as the record of what ran and predate the new flags |
| 9 | arm order, n ≥ 10 at loss > 0 | v4 script |
| — | emulated RTT on the ask path (`--rtt-ms`), `--ipv4` restored, 5 build warnings gone | done |

**Merge note.** `cursor/l1-loss-run-dbae` also reworks this crate (open-loop reader, `WindowShape`,
`late_*` metrics, stranded bytes) for its own campaign. The two agree on what to measure and differ
in names and in one semantic — L1 drops a prefetch that does not fit, this harness defers it. Whoever
lands second ports the other's flags; neither result depends on the difference.

## 7 · Evidence still owed

- **Loss.** Reduced cloud v4 (netem profile 60) is in
  [`measurements/r2/l2_ask_policy_v4_SUMMARY.md`](measurements/r2/l2_ask_policy_v4_SUMMARY.md):
  182/182 rows, 0.5 % loss does not separate arms on p95, medians keep the local-grid order.
  Full RTT 20/150 not run. `netem_drops` did not increment — do not cite that column.
- **The browser clients.** The harness is a Rust client; the WASM and TS clients still bulk-ask.
  That stays true on purpose: this branch does not change product ask code. A later product PR can
  copy the lab policy once the evidence is accepted.
- **Reader traces.** 16 and 40 ms steps bracket the regime boundary for this fixture; a real scroll
  log would replace both.

## 8 · Self-review — how this could be wrong

- The simulator is a FIFO with two fitted constants. It reproduces every row it was shown, but the
  rows are all from the saturated regime; the other regime is cross-checked only against the
  harness on loopback, and the harness's bottleneck is its own read pacer, not a network.
- The on-screen frame is exempt from the cap here; the v2 harness made the reader wait for a slot.
  Under v2 semantics a bounded `D` looks worse on a jump, never better, so the recommendation does
  not depend on the choice — but a product client must ask for the on-screen frame unconditionally.
- Traces are synthetic, 56–119 steps; p95 is a transient. Medians and maxima are reported for that
  reason; the ordering does not change under either.
- The 12 % outlier in v2 (dynamic, 150 ms, run 1) is unexplained; nothing here depends on it.
- The `getStats` result is one browser version on one platform; the API is in the spec and may ship.

## 9 · Decisions requested

1. Adopt §5 as the ask policy the **lab** implements (harness defaults / campaign arms); drop the
   dynamic arm from the lane. Product clients are unchanged until a later decision.
2. Run v4 for the loss question only, or close the lane without it.
3. Where the harness rework lands relative to L1's (this branch, L1's, or a merge of both).
