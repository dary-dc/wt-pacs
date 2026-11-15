### P1 · the cut alone

| volume | r, source units | e_N ÷ σ, per frame | largest |e_N ÷ r − 1| | largest |mean error| | P1 |
| --- | --: | --- | --: | --: | --- |
| `dbts_a1` | 4.61 | 0.375–0.439 | 0.2 % | 0.356 | hit |
| `dbts_b1` | 1.12 | 0.195–0.210 | 1.4 % | 0.176 | hit |
| `dbts_c1` | 4.61 | 0.309–0.383 | 0.5 % | 0.249 | hit |
| `dbt12_ea1141` | 4.61 | 0.384–0.419 | 0.4 % | 0.338 | hit |
| `dbts_b2` | 1.12 | 0.311–0.314 | 5.8 % | 0.334 | miss |
| `dbts_c4` | 4.61 | 0.257–0.311 | 0.5 % | 0.240 | hit |

### P2 · the stacking (G 1, worst frame)

| volume | Q | measured | removal | independent | in band ±0.03 | closer |
| --- | --: | --: | --: | --: | --- | --- |
| `dbts_a1` | 2 | 0.853 | 0.770 | 0.942 | yes | removal |
| `dbts_a1` | 3 | 0.965 | 0.892 | 1.068 | yes | removal |
| `dbts_a1` | 4 | 1.030 | 0.950 | 1.127 | yes | removal |
| `dbts_a1` | 5 | 1.074 | 0.978 | 1.155 | yes | independent |
| `dbts_a1` | 6 | 1.092 | 1.004 | 1.182 | yes | removal |
| `dbts_a1` | 7 | 1.108 | 1.033 | 1.211 | yes | removal |
| `dbts_b1` | 9 | 0.987 | 0.948 | 0.993 | yes | independent |
| `dbts_b1` | 10 | 1.009 | 0.965 | 1.009 | yes | independent |
| `dbts_b1` | 11 | 1.022 | 0.979 | 1.023 | yes | independent |
| `dbts_b1` | 12 | 1.034 | 0.992 | 1.037 | yes | independent |
| `dbts_b1` | 13 | 1.040 | 1.007 | 1.052 | yes | independent |
| `dbts_b1` | 14 | 1.045 | 1.023 | 1.067 | yes | independent |
| `dbts_b1` | 15 | 1.048 | 1.038 | 1.082 | yes | removal |
| `dbts_c1` | 3 | 0.872 | 0.829 | 0.964 | yes | removal |
| `dbts_c1` | 4 | 0.951 | 0.913 | 1.049 | yes | removal |
| `dbts_c1` | 5 | 1.020 | 0.959 | 1.095 | yes | removal |
| `dbts_c1` | 6 | 1.058 | 0.981 | 1.118 | yes | independent |
| `dbts_c1` | 7 | 1.092 | 1.005 | 1.142 | yes | independent |
| `dbts_c1` | 8 | 1.110 | 1.030 | 1.168 | yes | independent |
| `dbt12_ea1141` | 2 | 0.813 | 0.736 | 0.893 | yes | removal |
| `dbt12_ea1141` | 3 | 0.930 | 0.875 | 1.036 | yes | removal |
| `dbt12_ea1141` | 4 | 0.997 | 0.937 | 1.099 | yes | removal |
| `dbt12_ea1141` | 5 | 1.044 | 0.971 | 1.133 | yes | removal |
| `dbt12_ea1141` | 6 | 1.070 | 0.996 | 1.159 | yes | removal |
| `dbt12_ea1141` | 7 | 1.090 | 1.023 | 1.186 | yes | removal |
| `dbt12_ea1141` | 8 | 1.100 | 1.044 | 1.207 | yes | removal |
| `dbts_b2` | 4 | 0.925 | 0.885 | 0.989 | yes | removal |
| `dbts_b2` | 5 | 0.980 | 0.933 | 1.037 | yes | removal |
| `dbts_b2` | 6 | 1.008 | 0.965 | 1.070 | yes | removal |
| `dbts_b2` | 7 | 1.029 | 0.986 | 1.091 | yes | removal |
| `dbts_b2` | 8 | 1.042 | 1.008 | 1.113 | yes | removal |
| `dbts_b2` | 9 | 1.053 | 1.031 | 1.136 | yes | removal |
| `dbts_c4` | 5 | 0.916 | 0.905 | 0.996 | yes | removal |
| `dbts_c4` | 6 | 0.970 | 0.948 | 1.040 | yes | removal |
| `dbts_c4` | 7 | 1.017 | 0.970 | 1.062 | yes | independent |
| `dbts_c4` | 8 | 1.049 | 0.989 | 1.081 | yes | independent |
| `dbts_c4` | 9 | 1.073 | 1.009 | 1.102 | yes | independent |
| `dbts_c4` | 10 | 1.088 | 1.030 | 1.123 | yes | independent |

Closer model per volume (cells): `dbts_a1` removal 5, independent 1; `dbts_b1` removal 1, independent 6; `dbts_c1` removal 3, independent 3; `dbt12_ea1141` removal 7, independent 0; `dbts_b2` removal 6, independent 0; `dbts_c4` removal 2, independent 4

### P3 · the highest Q, and P4 · bytes (G 1)

| volume | bar | cut8 measured | predicted (indep.–removal) | P3 | today measured | today predicted | cut8 ÷ today, bytes | predicted, widened | P4 |
| --- | --: | --: | --- | --- | --: | --: | --: | --- | --- |
| `dbts_a1` | 1.00 | 3 | 2–5 | hit | 7 | 7 | 1.86 | 0.96–2.44 | hit |
| `dbts_a1` | 1.03 | 4 | 2–6 | hit | 8 | 7 | 1.95 | 0.78–2.44 | — |
| `dbts_b1` | 1.00 | 9 | 9–12 | hit | 12 | 13 | 1.32 | 0.88–1.53 | hit |
| `dbts_b1` | 1.03 | 11 | 11–14 | hit | 15 | 15 | 1.62 | 0.92–1.58 | — |
| `dbts_c1` | 1.00 | 4 | 3–6 | hit | 7 | 8 | 1.33 | 0.98–2.00 | hit |
| `dbts_c1` | 1.03 | 5 | 3–7 | hit | 8 | 9 | 1.33 | 1.02–2.69 | — |
| `dbt12_ea1141` | 1.00 | 4 | 2–6 | hit | 8 | 7 | 1.69 | 0.80–2.12 | hit |
| `dbt12_ea1141` | 1.03 | 4 | 2–7 | hit | 9 | 8 | 2.13 | 0.79–2.66 | — |
| `dbts_b2` | 1.00 | 5 | 4–7 | hit | 10 | 9 | 1.85 | 0.98–1.82 | miss |
| `dbts_b2` | 1.03 | 7 | 4–8 | hit | 17 | 10 | 3.59 | 0.99–2.19 | — |
| `dbts_c4` | 1.00 | 6 | 5–8 | hit | 9 | 9 | 1.31 | 0.79–1.63 | hit |
| `dbts_c4` | 1.03 | 7 | 5–9 | hit | 10 | 10 | 1.32 | 0.82–2.06 | — |

### P5 · the 4:2:0 cost (G 1)

| volume | Q | largest |Δ e_N ÷ σ| | bytes 420 ÷ mono | chroma samples ≠ 128 | P5 |
| --- | --: | --: | --: | --: | --- |
| `dbts_a1` | 2 | 0.0036 | 1.0003 | 0 | miss |
| `dbts_a1` | 5 | 0.0030 | 1.0010 | 0 | miss |
| `dbts_b1` | 9 | 0.0017 | 1.0007 | 0 | miss |
| `dbts_b1` | 12 | 0.0012 | 1.0002 | 0 | miss |
| `dbts_c1` | 3 | 0.0047 | 1.0006 | 0 | miss |
| `dbts_c1` | 6 | 0.0039 | 1.0007 | 0 | miss |
| `dbt12_ea1141` | 2 | 0.0040 | 1.0012 | 0 | hit |
| `dbt12_ea1141` | 6 | 0.0030 | 1.0005 | 0 | miss |
| `dbts_b2` | 4 | 0.0024 | 1.0001 | 0 | miss |
| `dbts_b2` | 7 | 0.0014 | 1.0005 | 0 | miss |
| `dbts_c4` | 5 | 0.0047 | 1.0007 | 0 | miss |
| `dbts_c4` | 8 | 0.0036 | 1.0011 | 0 | hit |

### P6 · displayed levels, first window, each form at its highest Q under 1.00 (no verdict)

| volume | form | Q | worst e_N ÷ σ | moved ≥ 1 | moved ≥ 2 | largest move | σ of its frame |
| --- | --- | --: | --: | --: | --: | --: | --: |
| `dbts_a1` | cut8 | 3 | 0.965 | 83.8 % | 56.0 % | 22 | 11.70 |
| `dbts_a1` | top10 | 7 | 0.991 | 87.1 % | 64.3 % | 28 | 10.75 |
| `dbts_b1` | cut8 | 9 | 0.987 | 87.0 % | 63.1 % | 38 | 5.34 |
| `dbts_b1` | 10bit | 12 | 0.999 | 88.0 % | 65.2 % | 51 | 5.34 |
| `dbts_c1` | cut8 | 4 | 0.951 | 78.2 % | 45.0 % | 19 | 12.35 |
| `dbts_c1` | top10 | 7 | 0.947 | 79.8 % | 47.8 % | 22 | 12.34 |
| `dbt12_ea1141` | cut8 | 4 | 0.997 | 87.7 % | 66.2 % | 30 | 11.31 |
| `dbt12_ea1141` | top10 | 8 | 0.999 | 89.8 % | 72.0 % | 37 | 11.57 |
| `dbts_b2` | cut8 | 5 | 0.980 | 79.6 % | 46.2 % | 17 | 3.38 |
| `dbts_b2` | 10bit | 10 | 0.997 | 83.8 % | 54.1 % | 32 | 3.39 |
| `dbts_c4` | cut8 | 6 | 0.970 | 90.0 % | 72.9 % | 42 | 16.41 |
| `dbts_c4` | top10 | 9 | 0.982 | 90.6 % | 74.9 % | 45 | 15.01 |

### Stage B · G 16

| volume | form | Q | worst e_N ÷ σ | ≤ 1.00 | ≤ 1.03 | bytes | G 1 worst at the same Q |
| --- | --- | --: | --: | --- | --- | --: | --: |
| `dbt12_ea1141` | cut8 | 4 | 1.001 | no | yes | 2193824 | 0.997 |
| `dbt12_ea1141` | cut8 | 5 | 1.050 | no | no | 1714603 | 1.044 |
| `dbt12_ea1141` | top10 | 8 | 0.997 | yes | yes | 1309397 | 0.999 |
| `dbts_a1` | cut8 | 3 | 0.986 | yes | yes | 11715597 | 0.965 |
| `dbts_a1` | cut8 | 4 | 1.037 | no | no | 8969464 | 1.030 |
| `dbts_a1` | top10 | 7 | 0.990 | yes | yes | 6415842 | 0.991 |
| `dbts_b1` | 10bit | 12 | 1.000 | no | yes | 10175977 | 0.999 |
| `dbts_b1` | cut8 | 9 | 0.988 | yes | yes | 14106082 | 0.987 |
| `dbts_b1` | cut8 | 10 | 1.010 | no | yes | 11964457 | 1.009 |
| `dbts_b2` | 10bit | 10 | 0.997 | yes | yes | 13249665 | 0.997 |
| `dbts_b2` | cut8 | 5 | 0.987 | yes | yes | 26711814 | 0.980 |
| `dbts_b2` | cut8 | 6 | 1.014 | no | yes | 22039691 | 1.008 |
| `dbts_c1` | cut8 | 4 | 0.967 | yes | yes | 10785990 | 0.951 |
| `dbts_c1` | cut8 | 5 | 1.029 | no | yes | 8352179 | 1.020 |
| `dbts_c1` | top10 | 7 | 0.944 | yes | yes | 8181794 | 0.947 |
| `dbts_c4` | cut8 | 6 | 0.980 | yes | yes | 5004558 | 0.970 |
| `dbts_c4` | cut8 | 7 | 1.028 | no | yes | 4042193 | 1.017 |
| `dbts_c4` | top10 | 9 | 0.980 | yes | yes | 3810048 | 0.982 |
