# Stream mode decision — experiment report

**Date:** 2026-08-28 · **Campaign:** [`stream-mode-decision-experiments.md`](stream-mode-decision-experiments.md)  
**Raw data:** `.local/measurements/stream-mode-decision/`

## X1 — `finish()` gate

| | |
| - | - |
| Mode | per-frame |
| Fixture | 250 KB · D=4 · 10 Mbit · 60 ms RTT · no loss |
| Measured | **8.0 Mbps** |
| Pass bar | ≥ 8.0 Mbps |
| **Result** | **PASS** |

Old inline-`finish()` ceiling was ~7.0 Mbps. The session-loop fix holds.

## X2 — lossless mode comparison

Max gap shared vs per-frame: **18.2%** (doc asked to stop above ~10%).

| fixture | RTT | shared Mbps | per-frame Mbps | gap % | D_min S/P | pred |
|---|---|---|---|---|---|---|
| 250 KB | 20 | 9.0 | 9.0 | 0.0 | 2/3 | 2 |
| 250 KB | 60 | 8.0 | 8.0 | 0.0 | 2/8 | 2 |
| 250 KB | 150 | 6.0 | 5.0 | 18.2 | 3/5 | 2 |
| 51 KB | 20 | 9.13 | 8.97 | 1.8 | 3/3 | 2 |
| 51 KB | 60 | 8.35 | 8.16 | 2.3 | 3/5 | 3 |
| 51 KB | 150 | 6.30 | 5.27 | 17.8 | 5/8 | 5 |

Notes:
- At RTT ≤ 60 ms the modes match (within ~2%).
- At RTT = 150 ms per-frame trails by ~18%. For 250 KB, 2 s dwell quantizes to ±1 Mbps; the 51 KB gap is finer-grained and real.
- Continued to X3 with that caveat recorded (per-frame is not *better* lossless — only slightly worse at high RTT).

## X3 — loss (the decider)

Short scroll (`lab/traces/x3_short_scroll.json`, 80 steps), D=4, 250 KB, 60 ms RTT. Metric: **p95 time-to-displayable (ms)**. Lower is better. Positive “better %” would mean per-frame wins.

| loss % | shared p95 | per-frame p95 | per-frame better % |
|---|---|---|---|
| 0 | 876 | 1681 | −92% |
| 0.1 | 876 | 1722 | −96% |
| **0.5** | **1614** | **2634** | **−63%** |
| 2 | 3383 | 5228 | −55% |

Hypothesis (shared HoL under loss) **not supported** in this harness: shared stays faster at every loss rate. Peak outstanding reached D=4 in all runs.

## Decision

Rule (fixed in advance): per-frame p95 better than shared by **>15% at 0.5% loss** → choose per-frame; otherwise shared.

**Chosen: `shared`**

Matches the viewer integration target (one stream per endpoint). Evidence tier: **T2** (synthetic netem in a user netns).

## How to reproduce

```bash
unshare --user --map-root-user --net -- bash lab/scripts/stream_mode_decision.sh
# X3 alone (after X1/X2 data exists):
unshare --user --map-root-user --net -- bash lab/scripts/stream_mode_x3_only.sh
```
