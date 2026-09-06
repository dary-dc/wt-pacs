# L1 v3 Phase C — directional note

**Status:** small collect complete · **NOT A DECISION** · **Date:** 2026-09-05  
**Artifacts:** `docs/measurements/r2/l1_s_vs_q_loss_v3.small.tsv`, `raw/l1v3/small/`, `DIRECTIONAL_SUMMARY.md`

> **Reviewed 2026-09-06 — readouts 1–3 below do not survive re-estimation.**
> See [`../measurements/r2/L1_V3_PHASE_C_REVIEW.md`](../measurements/r2/L1_V3_PHASE_C_REVIEW.md).
> In short: the p95 in the null and dose-low cells rests on 3 tail samples; the dose-like rise
> inverts under pooled miss samples (+2.7 / +14.6 / +1.5 %); and on the reader clock both arms keep
> schedule at 0 and 0.5 % loss, so the 0.5 % cell has no reader-visible effect to power. The rows
> and the regime stamps are sound — the interpretation is what changed.

## Shape (miss p95 medians, RTT60, 160-frame, clinical 0.9)

| cell | S | P | Q | rel_gain Q vs S |
| --- | ---: | ---: | ---: | ---: |
| null 0% | 43.8 | 64.6 | 42.2 | +3.5% |
| dose-low 0.5% | 66.2 | 145.4 | 61.7 | +6.8% |
| dose-high 2% | 145.2 | — | 130.3 | +10.2% |

## Readouts (directional only)

1. **Null S≈Q** — no large S/Q unexplained gap at 0%.
2. **Dose-like** — Q vs S relative gain rises 0% → 0.5% → 2% (pooled; regimes stamped).
3. **Attribution** — at 0.5%, P ≫ Q (145 vs 62): per-frame without ask-priority is not the win; priority looks like the lever.
4. **Regimes** — dose-high mostly `loss_slow`; dose-low mostly `loss_stable`. Do not average unlabeled.

## Explicit non-claims

- Does **not** ship Q.
- Does **not** meet a 15% product bar (and was not scored against one).
- RTT-150 not collected.
- Phase E (powered decision) remains gated.

## Follow-ups before Phase E

- Treat P’s null/dose elevation as an attribution flag (priority on vs off), not as a product arm.
- Regime-split analysis for dose cells (stable vs slow) before any powered claim.
- Optional: large-frame track (Phase D) stays parallel.
