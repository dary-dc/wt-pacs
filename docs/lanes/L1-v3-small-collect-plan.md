# L1 v3 — small collect plan

**Status:** Phase C **SSH body enabled** · run with `APPROVE_SMALL_COLLECT=1`  
**Governed by:** [`L1-v3-complete-plan.md`](L1-v3-complete-plan.md)  
**Branch:** `cursor/l1-loss-run-dbae`  
**Collect runner:** `lab/scripts/l1_v3_collect_small.sh`

> **DIRECTIONAL — NOT A DECISION.** Phase C answers shape (null sanity, dose-like
> response, P vs Q attribution). It does **not** ship Q or claim a 15 % product bar.

---

## Purpose

1. Are frozen cadences sane (enough miss-tail samples, asks under control, regimes stamped)?
2. At **0 % loss**, do S / P / Q stay close? (null sanity)
3. At **0.5 % / 2 %**, does miss-p95 show a **dose-like** directional Q vs S signal?

---

## Grid (complete plan Phase C · RTT 60 · 160-frame)

| cell | loss | D | arms | repeats/arm | role |
| --- | ---: | ---: | --- | ---: | --- |
| null | 0 % | 4 | S, P, Q | 10 | null sanity |
| dose-low | 0.5 % | 4 | S, P, Q | 10 | directional + attribution |
| dose-high | 2 % | 4 | S, Q | 10 | dose-like response smoke |

Cadence from `docs/measurements/r2/l1_v3_cadence.json` (clinical_under_delivery ×0.9).  
Prefer a **160-frame re-pilot** (`L1_FIX_FC=160 PHASE=pilot`) before collect so fixture paths match.

| arm | flags | port |
| --- | --- | ---: |
| S | `--stream-mode shared` | 4435 |
| P | `--stream-mode per-frame` | 4436 |
| Q | `--stream-mode per-frame --ask-priority` | 4437 |

---

## Hard stops

| gate | rule |
| --- | --- |
| Approval | `APPROVE_SMALL_COLLECT=1` |
| Asks | `asks_sent ≤ 1.25 × frame_count` |
| Tail | ≥ 5 positive waits at/above miss p95 |
| Frame bytes | observed mean ≈ fixture (±64 B) |
| Precheck | clinical demand/supply ∈ [0.55, 0.98] |
| Null gap | large unexplained pairwise gap (rel>40% **and** abs>200 ms) |
| Backlog | h2 > 1.5× h1 → mark `+BACKLOG` (row kept, labeled) |

---

## How to run

```bash
# optional: refresh cadence on 160-frame
L1_FIX_FC=160 CELLS='60:0:4 60:0.5:4 60:2:4' PHASE=pilot \
  bash lab/scripts/l1_loss_run_v3_cloud.sh

APPROVE_SMALL_COLLECT=1 SKIP_BUILD=0 \
  bash lab/scripts/l1_v3_collect_small.sh

# gates only:
APPROVE_SMALL_COLLECT=1 DRY_RUN=1 bash lab/scripts/l1_v3_collect_small.sh
```

Artifacts: `l1_s_vs_q_loss_v3.small.tsv`, `raw/l1v3/small/`, `DIRECTIONAL_SUMMARY.md`.
