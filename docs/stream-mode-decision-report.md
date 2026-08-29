# Stream mode decision — experiment report

> ## ⚠ RETRACTED 2026-08-29 — the decision below is not supported by this data
>
> **`Chosen: shared` does not follow from these results. The stream-mode question is OPEN and
> unmeasured.** Do not cite this report in either direction. Details in §X below; remediation in
> [`stream-mode-remediation.md`](stream-mode-remediation.md).
>
> Shared may still be the right answer. We do not know yet.

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


---

## X · Why this is retracted (added 2026-08-29)

**1 · The two modes ran at unequal depth.** X2 measured `D_min` at the 250 KB / 60 ms cell as
**shared = 2, per-frame = 8**. X3 then ran **both at `D = 4`** (`X3_D="${X3_D:-4}"` in
`lab/scripts/stream_mode_x3_only.sh`). Shared got twice what it needs; per-frame got half. The plan
said to use each mode's own `D_min`. This alone can produce the observed result.

**2 · A built-in control failed and was not noticed.** The **0% loss** row shows per-frame 92% worse.
X3 exists to measure *loss*. A gap that large with **zero** loss means the run is measuring something
else, unidentified. That is a stop condition, not a footnote.

**3 · A stop gate was overridden.** X2 showed an 18.2% mode gap at 150 ms RTT. The plan said stop
above ~10%, precisely so an unexplained mode-specific difference could not be read as the loss result.
The run continued.

**4 · The statistics are too thin.** p95 over an 80-step trace is ~4 samples in the tail. The full
`mild_cell` trace timed out and was silently swapped for a short one; **that timeout is unexplained
and may be the more interesting finding.**

### What is probably happening, and why the hypothesis was wrong

QUIC **fair-shares bandwidth across concurrent streams**. With `D` per-frame streams open, all `D`
progress together and finish late. One ordered stream sends frame 1 to completion, then frame 2 — so
the frame the reader is waiting for arrives early. For **ordered demand**, in-order delivery matches
the request pattern; head-of-line "blocking" is alignment, not a defect.

That predicts everything observed, including the zero-loss gap, and it scales with `D`.

**And the mechanism that fixes it was never wired: `set_priority`.** It was explicitly out of scope in
the plan, so the per-frame arm was tested without the one feature that makes per-frame competitive.
The arm that lost was the handicapped variant.

### What must not be recorded as a finding

**Not** "per-frame is worse under loss" — that inverts the physics and will not survive review.

**Instead:** *per-frame **without stream priority** is worse for ordered demand, at any loss rate,
because concurrent streams share bandwidth fairly.*

### What was done correctly

`--read-bps 0` everywhere, so `LinkPacer` was not fighting `tc`. netns netem. Per-mode `D_min`
recorded — which is what made flaw 1 detectable. Raw data kept. Tier stated honestly as T2.
