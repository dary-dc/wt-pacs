# L1 v3 Phase C — directional summary

**NOT A DECISION.** Shape-only readout.

## Miss p95 by cell × arm (median [p10, p90])

| cell | loss | arm | n | median_ms | p10 | p90 |
| --- | ---: | --- | ---: | ---: | ---: | ---: |
| dose-high | 2 | Q | 10 | 130.3 | 66.7 | 147.9 |
| dose-high | 2 | S | 10 | 145.2 | 106.4 | 180.7 |
| dose-low | 0.5 | P | 10 | 145.4 | 67.9 | 188.3 |
| dose-low | 0.5 | Q | 10 | 61.7 | 54.8 | 70.6 |
| dose-low | 0.5 | S | 10 | 66.2 | 41.9 | 94.1 |
| null | 0 | P | 10 | 64.6 | 42.4 | 158.3 |
| null | 0 | Q | 10 | 42.2 | 29.0 | 44.4 |
| null | 0 | S | 10 | 43.8 | 29.1 | 44.8 |

## Regime rates

| cell | loss | arm | regimes |
| --- | ---: | --- | --- |
| dose-high | 2 | Q | loss_slow=8, loss_stable=2 |
| dose-high | 2 | S | loss_slow=10 |
| dose-low | 0.5 | P | loss_slow=3, loss_stable=7 |
| dose-low | 0.5 | Q | loss_slow=1, loss_stable=9 |
| dose-low | 0.5 | S | loss_slow=1, loss_stable=9 |
| null | 0 | P | clean=10 |
| null | 0 | Q | clean=10 |
| null | 0 | S | clean=10 |

## Directional shape (Q vs S, pooled)

- null loss=0.0%: S_med=43.8 Q_med=42.2 rel_gain_Q=+3.5%
- dose-low loss=0.5%: S_med=66.2 Q_med=61.7 rel_gain_Q=+6.8%
- dose-high loss=2.0%: S_med=145.2 Q_med=130.3 rel_gain_Q=+10.2%

## P vs Q at 0.5%
- P_med=145.4 Q_med=61.7

## Explicit non-claims
- Not a ship decision for Q.
- Not a 15% product-bar result.
- RTT-150 not in this collect.
