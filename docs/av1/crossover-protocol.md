# Where AV1 fills first — the measurement protocol

Pre-registered by row 105 (CROSSOVER), 2026-10-09, before any of its data; run by row 106 (CROSSMEASURE) in a session
given this file alone. The measuring session reports the numbers, then whether each prediction held by the rule below.

## What is measured

Total time to every frame on the page (row TOTAL's `lab/av1/delivery/total-time/run.mjs`, unchanged), HTJ2K against
one AV1 variant per series, the payloads as ingest writes them, every frame matched against the encoder's input.

| series | frames (as rows 95 and 96 timed them) | AV1 variant |
| --- | --- | --- |
| `dbts_a5`, DBT 12-bit | every 8th slice | k = 2 |
| `dbts_b2`, DBT 10-bit | every 8th slice | k = 2 |
| `dbts_b4`, DBT 10-bit | every 8th slice | k = 2 |
| `ffdms_c1`, FFDM for presentation 12-bit | all four | k = 2 |
| `syn2ds_a3`, synthesized 2D 12-bit | all four | k = 2 |
| `syn2ds_b3`, synthesized 2D 10-bit | all four | k = 2 |

Engines: Chromium 141 (playwright 1.56.1's) and Firefox 157.0.1 (the conda-forge build row TOTAL4 pinned). CPU: 1× and
4× (`lab/scripts/cpu_throttle.mjs`), the browser on three cores (`taskset -c 0-2`), three decoders.

## The cells

Fixed-rate links (`r<kbit>`, 40 ms round trip, as row TOTAL). Each cell is named with the side the model predicts and
its predicted ratio, AV1's time over HTJ2K's. — is no cell: none on that side within 5–100 Mbit/s, or Firefox below
10 Mbit/s, which its dial does not reach.

| series | engine, CPU | AV1 predicted first | HTJ2K predicted first |
| --- | --- | --- | --- |
| `dbts_a5` | Chromium 1× | 5 Mbit (0.96) | 100 Mbit (1.04) |
| | Chromium 4× | 5 Mbit (0.97) | 30 Mbit (1.07) |
| | Firefox 1× | 10 Mbit (0.98) | 50 Mbit (1.05) |
| | Firefox 4× | — | 10 Mbit (1.04) |
| `dbts_b2` | Chromium 1× | 5 Mbit (0.96) | 100 Mbit (1.02) |
| | Chromium 4× | 5 Mbit (0.97) | 30 Mbit (1.04) |
| | Firefox 1× | 10 Mbit (0.98) | 50 Mbit (1.04) |
| | Firefox 4× | — | 10 Mbit (1.03) |
| `dbts_b4` | Chromium 1× | 20 Mbit (0.79) | — |
| | Chromium 4× | 20 Mbit (0.82) | 100 Mbit (1.95) |
| | Firefox 1× | 20 Mbit (0.81) | — |
| | Firefox 4× | 10 Mbit (0.83) | 50 Mbit (1.55) |
| `ffdms_c1` | Chromium 1× | — | 20 Mbit (1.03) |
| | Chromium 4× | — | 10 Mbit (1.07) |
| | Firefox 1× | — | 20 Mbit (1.07) |
| | Firefox 4× | — | 10 Mbit (1.16) |
| `syn2ds_a3` | Chromium 1× | 5 Mbit (0.98) | 30 Mbit (1.03) |
| | Chromium 4× | — | 10 Mbit (1.05) |
| | Firefox 1× | — | 20 Mbit (1.06) |
| | Firefox 4× | — | 10 Mbit (1.15) |
| `syn2ds_b3` | Chromium 1× | 5 Mbit (0.95) | 100 Mbit (1.06) |
| | Chromium 4× | 5 Mbit (0.97) | 30 Mbit (1.09) |
| | Firefox 1× | — | 30 Mbit (1.07) |
| | Firefox 4× | — | 10 Mbit (1.12) |

**The rule's cells**: every series on `lte-good` (row PROF's LTE trace, as row TOTAL4), both engines, 1× and 4×.
Predicted ratios there, from the trace's 16.7 Mbit/s mean (Chromium 1× · 4×, Firefox 1× · 4×): `dbts_a5` 0.97 · 1.02,
0.99 · 1.10; `dbts_b2` 0.97 · 1.01, 0.99 · 1.08; `dbts_b4` 0.79 · 0.81, 0.80 · 0.87; `ffdms_c1` 1.02 · 1.11,
1.06 · 1.27; `syn2ds_a3` 1.00 · 1.09, 1.05 · 1.26; `syn2ds_b3` 0.97 · 1.03, 1.02 · 1.21.

## How it is run

* **n ≥ 10 kept visits a cell, each variant**, paired by round; a cell's ratio is the median of round-paired ratios,
  reported with the count of pairs in which AV1 was faster.
* **Interleaved**: within a round, one series at a time, its cells and both variants in a Williams order
  (`lab/order.mjs`); the series' order rotates by round.
* **`VOID` under 20 %**: a visit is `VOID` when the relay's p99 exceeds 1 ms (row TOTAL's rule). Run one series and its
  two variants at a time, nothing else on the host; read the host's steal time (`/proc/stat`) for 10 s before each
  round and wait while it exceeds 2 %. A cell over 20 % `VOID` gets more rounds until it has 10 kept; `VOID` visits are
  never counted, and the share is reported per cell.
* **Exact**: every delivered frame against its source's checksum; `--mutate sample` and `--mutate truth` each take one
  cell to 0 exact before the run.
* Say where the host saturates (the decode on three cores as the fill's clock) and claim nothing past it.

## The decision rule

1. **The model holds** for a series, engine and CPU where every one of its cells falls on its predicted side: an
   AV1-side cell's ratio below 1.00, an HTJ2K-side cell's above 1.00. A cell on the other side, or within ±0.01 of 1.00,
   fails the model there, and is reported by name with its numbers.
2. **A per-link rule is worth building** only if some series gains ≥ 5 % of fill time (ratio ≤ 0.95, AV1 faster in at
   least 8 of 10 pairs) on `lte-good` or on a fixed link ≤ 20 Mbit/s, at 1× and at 4×, in Chromium and in Firefox,
   **and** its input — the client's throughput and decode rate — is known before the first frame is asked. The
   second condition is a fact about the client, assessed by the review (row 107), not measured here.
3. A series that gains ≥ 5 % on every phone link at both CPU speeds in both engines is a per-series choice, not a
   per-link one; report it as such.
