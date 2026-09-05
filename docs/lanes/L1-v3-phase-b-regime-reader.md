# L1 v3 — Phase B: regimes and reader model

**Status:** frozen for Phases C+ · **Date:** 2026-09-05 · **Branch:** `cursor/l1-loss-run-dbae`  
**Parent:** [`L1-v3-complete-plan.md`](L1-v3-complete-plan.md) Phase B  
**Evidence:** `docs/measurements/r2/raw/l1v3/pilot/*.json` (S-arm, `--step-interval-ms 0`)

---

## 1 · What the pilots showed

Lossless cells are **unimodal and stable** (`f_cell` spread ≈ 1.00):

| cell | f_cell runs (fps) | h1 median (ms) |
| --- | --- | --- |
| 60 / 0% / D4 | 33.87, 33.90, 33.89 | ~27 |
| 150 / 0% / D7 | 28.45, 28.46, 28.46 | ~27 |

Loss cells are **bimodal** — not “one noisy outlier”:

| cell | fast fps (h1) | slow fps (h1) |
| --- | --- | --- |
| 60 / 0.5% | 32.2 / 32.2 (**h1≈27**) | **12.5 (h1≈72)** |
| 60 / 2% | 31.8 / 31.6 (**h1≈27**) | **9.7 (h1≈127)** |
| 150 / 0.5% | 26.6 / 28.4 (**h1≈27–28**) | **7.9 (h1≈160)** |

Slow runs also stretch `step_loop_ms` and often show `wait_h1_median_ms ≫ wait_h2_median_ms`
(front-loaded stall). Tail counts at empirical miss p95 on **80-frame** traces are often **4–5** —
exactly why Phase A defaults collect to **160 frames** and gates on **≥5 samples at/above p95**.

**Working interpretation:** under i.i.d. loss at max-rate ask (`step=0`), most runs stay in a
**stable delivery** mode; ~1/3 enter a **loss_slow** mode where early-step waits dominate and
achieved fps collapses. Median-of-3 cadence tracking only the fast cluster is **unsafe** if collect
hits the slow mode without labeling it (BACKLOG / arm-biased voids).

---

## 2 · Named regimes (row stamp)

| `regime` | When | Collect meaning |
| --- | --- | --- |
| `clean` | loss = 0 | Null-sanity cells |
| `loss_stable` | loss > 0 and `wait_h1_median_ms < 55` and ms/frame `< 45` | Primary dose cells |
| `loss_slow` | loss > 0 and (h1 ≥ 55 **or** ms/frame ≥ 45) | **Report separately**; do not average into fast-mode medians |
| `mixed` | reserved for an explicit mixed-netem cell (not Phase C) | Production-likeness track later |

Heuristic implemented in `lab/scripts/l1_v3_common.sh` → `l1_stamp_regime`.

---

## 3 · Reader model (explicit)

**Choice: `clinical_under_delivery` (factor 0.9).**

| Field | Value |
| --- | --- |
| Name | `clinical_under_delivery` |
| Factor | **0.9** |
| Formula | `step_interval_ms = round(1000 / (0.9 × f_cell))` |
| Meaning | Reader steps at **~90% of measured max delivery** on that cell — a scrub/view rate that does **not** invent miss pressure to satisfy a metric |
| Rejected alternative | `stress_over_delivery` (factor ~1.1): allowed later as a **named stress regime**, not the default product proxy |

Justification: FoD clinical review is not “outrun the pipe.” Early phases look for **dose-like
response under a realistic reader**, not for manufactured cache misses. If 0% loss under this
model yields few misses, **that is a finding** (complete-plan §2) — change the metric or add an
explicit stress cell; do not silently speed the reader.

Cadence JSON must carry:

```json
"reader_model": {
  "name": "clinical_under_delivery",
  "factor": 0.9,
  "doc": "docs/lanes/L1-v3-phase-b-regime-reader.md"
}
```

---

## 4 · Cadence policy after this note

1. Keep per-cell `step_interval_ms` from **median f_cell** (including slow pilots in the median
   input — do not drop slow runs).
2. Stamp every collect row with `regime` from §2.
3. Analyze **loss_stable** and **loss_slow** as separate strata; primary directional read uses
   `loss_stable` unless slow fraction is itself the question.
4. Optional follow-up: 5× re-pilot on 160-frame fixture to estimate slow-mode rate with tighter CI
   — useful, not blocking if §2 stamp is live.

---

## 5 · Phase C implications

- Null cell (0%): expect `clean`; large S/Q gap → STOP (unrelated difference).
- 0.5% / 2%: expect mostly `loss_stable`; report `loss_slow` rate per arm.
- Evidence = **shape** (null ok + dose-like direction), not a 15% ship bar.
- Header: `DIRECTIONAL — NOT A DECISION`.
