# L1 v3 — small collect plan (for reviewer; do not run until approved)

**Status:** awaiting review · **Date:** 2026-09-04 · **Branch:** `cursor/l1-loss-run-dbae`  
**Depends on:** path validation PASSED · A1 cadence frozen in
[`l1_v3_cadence.json`](../../measurements/r2/l1_v3_cadence.json)  
**Does not run:** full S9 grid (~10.5 h). This is a methodology smoke + first sample only.

---

## Purpose

Before spending a long rig night, answer:

1. Are frozen cadences sane (enough misses, no BACKLOG, asks under control)?
2. At **0 % loss**, do S / P / Q stay close? (null control smoke — S12 clause 1)
3. At **0.5 % loss**, is there a *directional* Q vs S signal (and is it P or priority)?

A clean small collect unlocks a powered RTT-60 collect later. A dirty one stops the campaign
cheaply.

---

## Grid (RTT 60 only)

| cell | loss | D | arms | repeats/arm | role |
| --- | ---: | ---: | --- | ---: | --- |
| null | 0 % | 4 | S, P, Q | **10** | null-control smoke |
| decision sample | 0.5 % | 4 | S, P, Q | **10** | directional only — **not** ship power |
| diagnostic | 2 % | 4 | S, Q | **5** | dose direction (optional) |

**Total:** 10×3 + 10×3 + 5×2 = **80 runs** ≈ **1–1.5 h** wall (incl. reconnect).

Cadence: each cell uses the **frozen** `step_interval_ms` from `l1_v3_cadence.json` for **all**
arms in that cell. No mid-run retune.

Arms:

| arm | server flags |
| --- | --- |
| S | `--stream-mode shared` |
| P | `--stream-mode per-frame` |
| Q | `--stream-mode per-frame --ask-priority` |

Same binary; three ports (4435/4436/4437) live for the whole small collect (C3).

---

## Execution rules

1. **S11:** tree clean under `lab/` + `docs/lanes/` before start; stamp `protocol_sha` on every row.
2. **Interleave** arms run-by-run within a cell (S,P,Q,S,P,Q…), not arm-blocks.
3. **Assert netem** after every run; capture `tc` snapshot beside raw JSON.
4. **Pilots never enter** the decision TSV (`role=pilot` stays in `.pilot.tsv` only).
5. Output TSV: `docs/measurements/r2/l1_s_vs_q_loss_v3.small.tsv`  
   Raw: `docs/measurements/r2/raw/l1v3/small/`

---

## Hard stop gates (any fail → do not scale up)

| gate | rule |
| --- | --- |
| S3 asks | `asks_sent ≤ 1.25 × frame_count` (≤100 on 80-frame trace) |
| A2 backlog | `wait_h2_median ≤ 1.5 × wait_h1_median` or mark BACKLOG / exclude |
| Miss samples | each decision-sample row has enough positive waits to compute miss_p95 (target: cache_misses ≥ ~15) |
| Null smoke | median miss_p95 S vs Q at 0 % within **25 % relative or 200 ms abs** (path-style); large gap → STOP |
| Cadence used | every row’s `step_interval_ms` matches frozen JSON for that cell |

---

## What we will *not* claim from this

- Not “Q wins / loses” for shipping (n=10 under-powered vs S9’s 40).
- Not RTT 150 behaviour.
- Not bursty (A6) or depth-sweep (A4) claims.

**After review + green small collect:** scale RTT-60 null+decision to 40 repeats/arm (± A6), still
before any overnight full grid.

---

## Reviewer checklist (before approving a run)

- [ ] `l1_v3_cadence.json` present; step intervals look plausible (not 50 ms cargo-cult; derived from pilots)
- [ ] Pilot TSV shows stable `f_cell` across 3 repeats per cell
- [ ] Isolation / path notes still hold (excess is post-enqueue; not blocking this smoke)
- [ ] 15 % bar still accepted as *directional* threshold for later powered collect (or explicitly deferred)
- [ ] No collect runner started until this plan is approved

---

## How to run (after approval only)

```bash
# Already done for calibration:
PHASE=pilot bash lab/scripts/l1_loss_run_v3_cloud.sh

# After reviewer OK — implement/enable small collect, then e.g.:
# PHASE=collect COLLECT_MODE=small bash lab/scripts/l1_loss_run_v3_cloud.sh
```

Until `COLLECT_MODE=small` is implemented and this doc is approved, `PHASE=collect` must refuse.
