5 rounds, 70 units

| set | P1 frames equal (all rounds) | σ_min, frame (M1) | rows' σ_min, frame |
| --- | --- | --- | --- |
| `dbts_a1` | 280 / 280 | 10.484796428016697, 1 | 10.484796428016697, 1 |
| `dbts_b1` | 250 / 250 | 5.257808998812966, 30 | 5.257808998812966, 30 |
| `dbts_c1` | 345 / 345 | 12.04134440803413, 0 | 12.04134440803413, 0 |

| set | Mpx a frame | M1 CPU s/Mpx (median of rounds) | each round | M5 CPU s/Mpx | M5 ÷ P2's | M5 equals the rows |
| --- | --: | --: | --- | --: | --: | --- |
| `dbts_a1` | 2.038 | 0.0033 | 0.0032 0.0034 0.0033 0.0032 0.0040 | 0.0601 | 1.23 | True |
| `dbts_b1` | 8.520 | 0.0022 | 0.0021 0.0023 0.0019 0.0022 0.0023 | 0.1089 | 1.25 | True |
| `dbts_c1` | 2.453 | 0.0025 | 0.0024 0.0026 0.0025 0.0023 0.0041 | 0.0582 | 1.19 | True |

| set | M1 ms a frame (median) | M3 ms a frame (median of rounds) | M1 ÷ M3 | T5's band | M3 wall s |
| --- | --: | --: | --: | --- | --: |
| `dbts_a1` | 6.52 | 32.6 | 20.0% | 7%–42% | 1.85 |
| `dbts_b1` | 16.72 | 140.8 | 11.9% | 17%–99% | 7.07 |
| `dbts_c1` | 5.95 | 40.7 | 14.6% | 10%–60% | 2.84 |

| set | σ_min in-window (M1) | σ_min all samples (M4), frame | M4 ≤ M1 | rule Q at G 8: M1 · M4 |
| --- | --: | --: | --- | --- |
| `dbts_a1` | 10.4848 | 6.5930, 55 | True | 4 · 4 |
| `dbts_b1` | 5.2578 | 1.4015, 36 | True | 8 · 2 |
| `dbts_c1` | 12.0413 | 4.5193, 68 | True | 4 · 2 |

| set | M2 σ_min (stream units) | M1 σ_min ÷ 4 | ratio | in 0.97–1.03 |
| --- | --: | --: | --: | --- |
| `dbts_a1` | 2.6214 | 2.6212 | 1.0001 | True |
| `dbts_c1` | 3.0135 | 3.0103 | 1.0010 | True |

σ identical in every round, M1, M2, M4: True
