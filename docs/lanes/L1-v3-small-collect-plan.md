# L1 v3 — small collect plan (for reviewer; do not run until approved)

**Status:** scaffolding ready · **awaiting A+B sign-off** before SSH collect body ·  
governed by [`L1-v3-complete-plan.md`](L1-v3-complete-plan.md) (2026-09-05)  
**Branch:** `cursor/l1-loss-run-dbae`  
> **Do not run full collect yet.** Phase A helpers + Phase B regime/reader note are on the
> branch. `PHASE=collect` still refuses without `APPROVE_SMALL_COLLECT=1`, and even then the
> SSH body stays disabled until sign-off (`DRY_RUN=1` self-tests gates only).  
> Notable shifts: **dose-like response > fixed 15 %** for early phases; **160-frame / tail-count**
> miss budget; **regime diagnosis** before cadence freeze; interleave + directional header.  
**Depends on:** path validation PASSED · cadence annotated with
`reader_model=clinical_under_delivery` · [`L1-v3-phase-b-regime-reader.md`](L1-v3-phase-b-regime-reader.md)  
**Collect runner:** `lab/scripts/l1_v3_collect_small.sh` (gated).

---

## Purpose

Before spending a long rig night, answer:

1. Are frozen cadences sane (enough misses, no BACKLOG, asks under control)?
2. At **0 % loss**, do S / P / Q stay close? (null control smoke — S12 clause 1)
3. At **0.5 % loss**, is there a *directional* Q vs S signal (and is it P or priority)?

---

## Frozen cadences (from pilots just run)

Rule applied as written in A1: `step_interval_ms = round(1000 / (0.9 × median_f_cell))`  
with 3× S-arm pilots at `--step-interval-ms 0`.

| RTT | loss | D | f_cell runs (fps) | median | **step_ms** |
| ---: | ---: | ---: | --- | ---: | ---: |
| 60 | 0 % | 4 | 33.87, 33.90, 33.89 | 33.89 | **33** |
| 60 | 0.5 % | 4 | 32.22, **12.52**, 32.17 | 32.17 | **35** |
| 60 | 2 % | 4 | **9.65**, 31.80, 31.56 | 31.56 | **35** |
| 150 | 0 % | 7 | 28.45, 28.46, 28.46 | 28.46 | **39** |
| 150 | 0.5 % | 7 | 26.56, 28.35, **7.92** | 26.56 | **42** |

**Reviewer flags (do not ignore):**

1. **Loss cells: 1-of-3 outlier pilots** (bold). Median still tracks the “good” cluster; cadence is
   optimistic vs a mean. Consider 5 pilots or outlier rejection before powered collect.
2. **A1 prose vs formula:** text says “reader *marginally faster* than delivery,” but
   `1000/(0.9·f)` makes the reader **slower** than `f_cell` (≈0.9×). That may under-produce
   misses on the 0 % cell (the failure mode A1 was meant to avoid). Confirm whether the factor
   should be **0.9** (as frozen) or **~1.1** (faster reader) before small collect.
3. Lossless pilots are rock-stable (spread ≈1.0); trust those cells more than loss cells.

Artifacts: `l1_s_vs_q_loss_v3.pilot.tsv`, `raw/l1v3/pilot/`, `l1_v3_cadence.json`.

---

## Small-collect grid (RTT 60 only)

| cell | loss | D | arms | repeats/arm | cadence | role |
| --- | ---: | ---: | --- | ---: | ---: | --- |
| null | 0 % | 4 | S, P, Q | **10** | 33 ms | null-control smoke |
| decision sample | 0.5 % | 4 | S, P, Q | **10** | 35 ms | directional only |
| diagnostic | 2 % | 4 | S, Q | **5** | 35 ms | dose direction |

**Total:** 80 runs ≈ 1–1.5 h. Not ship power (that needs ~40/arm later).

| arm | flags |
| --- | --- |
| S | `--stream-mode shared` |
| P | `--stream-mode per-frame` |
| Q | `--stream-mode per-frame --ask-priority` |

---

## Hard stop gates

| gate | rule |
| --- | --- |
| S3 asks | `asks_sent ≤ 100` on 80-frame trace |
| A2 backlog | h2 median ≤ 1.5× h1 or mark BACKLOG |
| Miss budget | decision rows need enough positive waits (aim cache_misses ≥ ~15) |
| Null smoke | S vs Q miss_p95 at 0 % within 25 % rel or 200 ms abs |
| Cadence stamp | row `step_interval_ms` matches frozen JSON |

---

## Reviewer checklist

- [ ] Accept or revise A1 factor (0.9 vs ~1.1) given prose/formula mismatch
- [ ] Accept median-of-3 despite loss outliers, or require re-pilot
- [ ] Cadences in table look plausible for product-like stepping
- [ ] 15 % bar: keep as later powered threshold, or defer
- [ ] Approve implementing `COLLECT_MODE=small` only after the above
- [ ] **N1** null gate tightened to ≤ decision threshold (second review §4.1)
- [ ] **N2** 160-frame trace + tail-sample miss budget (§4.2)
- [ ] **N3** bimodal pilot regime diagnosed, not median-ed away (§4.3)
- [ ] **N5** arms interleaved run-by-run, rows timestamped (§4.5)
- [ ] **N6** `cloud_precheck_ratio` + frame-size assertion in the collect path (§3.1, §3.4)

**Do not start collect until this checklist is signed off.**
