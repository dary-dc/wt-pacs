# Window width and the VL view's Q

*Row WINDOWQ, 2026-11-09. This file asks whether Q 8 is the right rung for the visually lossless (VL) view: the lossy
AV1 stream at one fixed Q per series ([`../glossary.md`](../glossary.md), *lossy stream*), first chosen at Q 8 on DBT
because there the coding error reaches the frame's own noise
([`lab/av1/metrics`](../../lab/av1/metrics/README.md) §Quality metrics, measured (2026-11-08)). It looks at how that
error shows as a reader narrows the window. The answer is drawn from the quality study's committed rows. Nothing was
re-encoded, because every Q and G it needs is already there.*

## Method card

* **Input.** `lab/av1/metrics/rows/shard-{1,2,3,4}.jsonl` as the quality study committed them (branch base
  `2f04f64`). Every frame of every cell at Q 1, 2, 4, 8, 12, 16, 24 and G 1, 16, stored form, on the 21 series of
  §Fixtures: 294 cells. All seven of those Q are rungs of the study's ladder, so no Q or G had to be encoded.
* **Stored form, not a depth cut.** The streams measured are the ones the store would hold: 12-bit for systems A and
  C and the 12-bit content-2 sets, 10-bit for system B and the 10-bit content-2 sets, 8-bit for TRUS. The rows'
  top-10-bit and window forms are not read here.
* **Computed.** `lab/av1/metrics/window.py lab/av1/metrics/rows/shard-{1,2,3,4}.jsonl --tsv
  lab/av1/metrics/rows/window.tsv`, run 2026-11-09, at this file's commit. It is arithmetic on the rows (about 90 s on
  one core), and every table below is its output. Nothing here is a timing, so no host limit applies.
* **Measured.** The **header presets**: every window pair each series' header carries (A, C and 12-bit content 2: three
  SIGMOID windows, W 550–1 093; B and 10-bit content 2: one LINEAR window, W 512; TRUS: W 256, which shows the
  samples as stored). The rows count, per frame and per window, the share of shown samples whose 8-bit code moved by
  ≥ 1, ≥ 2 and ≥ 4 levels, and the largest move (§4.5 of the study).
* **Derived.** The **sweep**, LINEAR windows of W 4096, 2048, 1024, 512, 256, 128, 64 in 12-bit source units
  (÷ 4 at 10 bits, ÷ 16 at 8 bits) centred on the frame's median level. The rows hold no residual histogram, so each
  frame's in-window residual is modelled as an integer variable of the frame's own measured in-window RMS e
  (Gaussian shape, scale solved to keep RMS e), and a source move j lands on ⌊k·j⌋ or ⌊k·j⌋ + 1 levels (k = 255 ÷
  (W − 1)) with probability equal to the fractional part (uniform rounding phase). §1 checks this model against every
  measured linear preset, and the check is mutated.
* **Not derived, read directly.** Whether the coding error stays under the noise, e_N ÷ σ (both in the noise band,
  §4.4 of the study). It does not depend on W (§1).

**Terms.** **W**: window width in source units. **k**: display levels per source unit at the window's centre, 255 ÷
(W − 1) for LINEAR and 255 ÷ W for SIGMOID (whose slope is below that everywhere else). **Display level**: the 8-bit
code a sample gets through a window, as the product paints it. **e**: the frame's coding error, RMS over the samples
inside the first header window, in source units, so **k·e** is that error in display levels. **σ, e_N**: the frame's
own noise and its coding error, both in the noise band (§4.4 of the study). **Preset**: a window pair from the series'
header. **Bytes ÷ HTJ2K**: the cell's bytes over the series' lossless HTJ2K control.

## Verdict

**Claim.** Measured on the 19 DBT volumes and 2 TRUS sweeps here, stored form:

* **Under the noise.** By the criterion Q 8 was chosen by, Q 8 is right, at every window width. Every frame keeps e_N ≤ σ at Q 8 on all 5 volumes of
  B, 5 of C, 4 of content 2, and 2 to 3 of A's 5 (all 5 at Q 4). TRUS keeps it to Q 4. A window scales e_N and σ by the
  same k, so a test that holds at one width holds at every width. A higher Q fails that test: at Q 12 no series of A, C
  or 12-bit content 2 passes it, and only 2 to 3 of B's 5 volumes and both 10-bit content-2 sets do.
* **Under one display level.** Q 8's error is never held to that at any window narrower than the stored range. Its
  RMS error reaches one display level at W 4 117–4 267 on 12-bit series (the range is 4 096), 1 079–1 126 on 10-bit
  (range 1 024) and 345–355 on TRUS (range 256). At the header presets, measured on DBT, Q 8 moves 81–87 % of the shown
  pixels by ≥ 1 level (median frame) and 47–66 % by ≥ 2, with largest moves of 26–44 levels.
* **The noise is the same size.** At those presets the frame's own noise is about as large: 4.5–5.0 levels on 12-bit
  DBT, 2.0–2.7 on 10-bit, 1.7 on TRUS. Q 8's e_N is 4.3–4.6, 1.8–2.1 and 1.2 levels.
* **What the one-level reading needs.** To keep the RMS error under one level at every header preset takes Q 1 on
  12-bit DBT (Q 2 holds on 22–24 of the 36 series × presets), at 0.64–0.65 of HTJ2K's bytes against Q 8's 0.09–0.11. It
  takes Q 4 on 10-bit DBT and TRUS, at 0.37–0.53 against 0.18–0.34.

So the answer to "lower or higher Q" turns on what VL is to mean:

* **Never higher.** Above Q 8 the error exceeds the noise.
* **Q 8**, if VL means "the coding error stays within the frame's own noise".
* **Q 1–2 (12-bit) or Q 4 (10-bit, TRUS)**, if VL means "the coding error stays under one display level in the
  windows readers use".

Neither reading is visual losslessness. That needs readers (the flicker test of the study's §6, not run), and every
figure here is a proxy for what a reader sees.

**An automatic exact request on narrow windows** would have to be set as a number of display levels X that readers
accept. At Q 8 the request fires below W = 1 + 255 · e ÷ X (§4):

| X | 12-bit DBT | 10-bit DBT | TRUS |
| --: | --: | --: | --: |
| 1 | every width up to the full range | every width up to the full range | every width up to the full range |
| 2 | 2 100–2 130 | 540–560 | 175–180 |
| 4 | 1 050–1 070 | 270–280 | 90 |

With X = 1 the request fires everywhere, so it is the exact profile under another name. With X = 2 it fires on every
DBT preset. With X = 4 it fires on the 12-bit presets (35 of 36) and on no 10-bit one. This file does not choose X.

**Proof chain.**

1. The quality study's rows (fixtures checked against their SHA-256 pins, fixed-Q encodes, dav1d decodes, per-frame
   metrics checked and mutated: the study's §7) give each frame's in-window e, e_N, σ, its largest |Δ| and each
   preset's code moves.
2. The display arithmetic is *derived*: a LINEAR window maps W source units onto 255 code steps, so k = 255 ÷ (W − 1).
   A SIGMOID window's slope peaks at 255 ÷ W at its centre.
3. The residual model reproduces every measured LINEAR preset (§1). On B and 10-bit content 2 it is off by at most
   0.015 in share (median 0.003) over 5 684 frame × window readings, and on TRUS by at most 0.056. The mutation, a
   Laplacian shape, is off by 0.13–0.18, so the check can see the difference. On the SIGMOID presets the model at
   the centre slope is an upper bound on all 31 794 readings.
4. The largest-move bound ⌈k · max|Δ|⌉ holds on every measured reading. Its mutation, ⌊…⌋, fails 948 of them.
5. §2–§5 tabulate the presets as measured, the widths, the Q 8 thresholds and the sweep.

**What would change it.**

* The flicker test with readers. It is the only test of either reading, and it could find Q 8's noise-sized error
  invisible within the noise, or visible as a changed noise pattern when the two frames alternate. Neither is
  measured here.
* A measured sweep. Its shares would replace the model's. The model is within 0.015 on 10-bit DBT but untested at
  W below the presets, and it assumes the residual's RMS does not depend on the grey level. A narrow window at another
  level sees other samples (*unverified*).
* Zoom or interpolation on screen, which average the error and the noise alike. Not modelled.
* A noise measure over the full band: DBT's noise is correlated, and e (full band) exceeds σ (finest band) at Q 8.
* A display whose window is not the product's (another VOI function, or a GSDF LUT applied after the window).

**What is owed.**

* The flicker test (study §6).
* A measured sweep: an in-window |Δ| histogram per frame in `cell.py`, then the same 294 cells re-encoded. This file
  did not do that, because the brief asks for an encode only where a Q or G is missing.
* Breast ultrasound cine and ABUS. No lossless fixture exists, so nothing here speaks for them. TRUS is the nearest
  swept volume and decides nothing for ABUS.
* The depth-cut forms, if the store ever holds one.

## Fixtures

All 21 series are from [`FIXTURES.md`](../FIXTURES.md) §AV1 data, as the quality study ran them (its §2). A result here
is claimed for these series only:

| family | series | stored form | header presets |
| --- | --- | --- | --- |
| system A | `dbts_a1` … `dbts_a5` | 12-bit | 3 SIGMOID, W 550–850 |
| system B | `dbts_b1` … `dbts_b5` | 10-bit | 1 LINEAR, W 512 |
| system C | `dbts_c1` … `dbts_c5` | 12-bit | 3 SIGMOID, W 550–1 093 |
| content 2 DBT, 10-bit | `dbt10_ea1141`, `dbt10_d` | 10-bit | 1 LINEAR, W 512 |
| content 2 DBT, 12-bit | `dbt12_ea1141`, `dbt12_c` | 12-bit | 3 SIGMOID, W 550–966 |
| TRUS | `ustrus_1`, `ustrus_2` | 8-bit | 1 LINEAR, W 256 (as stored) |

What is not here:

* **Breast ultrasound cine and ABUS.** There is no lossless dataset. The breast cine sets in the rows were lossy
  before they were archived, so they are left out, as the study leaves them out of its verdicts.
* **The three largest DBT volumes** (`dbts_*_max`). They were never run.

## 1 · The arithmetic, and the model's check

A window maps the W source units across its width onto 255 code steps. A source error e therefore shows as k·e display
levels, and display-unit PSNR is about 20 log10(W ÷ e) (*derived*). Two things make the true value differ:

* **Rounding.** The displayed code is an integer, so a move of a fraction of a level still flips a whole level on
  that fraction of samples. Computed from the codes, display PSNR is up to 10 dB below the formula where k·e < 1. For
  example, at Q 1 and W 4 096 on 12-bit DBT the codes give 60.3 dB and the formula 70.1 dB. The two agree within
  about 0.5 dB from k·e ≈ 1 up, which covers Q 8 at every W ≤ 2 048. The sweep tables give both.
* **Clipping.** A sample the window clips to 0 or 255 moves no level and is left out of every count, as the study
  counts it. So every share is over the samples the window shows, and e is taken over the first header window's shown
  samples. A SIGMOID window clips almost nothing (its code is 0 only beyond 1.56 W below the centre), but its slope
  falls away from the centre, so the centre slope gives an upper bound, as the check below confirms.

**The noise test does not depend on W.** e_N and σ are both multiplied by the same k, so e_N ÷ σ is the same at every
width, apart from the samples a narrow window clips. Those samples drop out of both terms.


| family (linear windows) | model | frames × windows | largest error, share ≥ 1 or ≥ 2 | median error |
| --- | --- | --: | --: | --: |
| system B | gaussian | 4676 | 0.015 | 0.0025 |
| system B | laplacian | 4676 | 0.128 | 0.1117 |
| content 2 DBT, 10-bit | gaussian | 1008 | 0.011 | 0.0028 |
| content 2 DBT, 10-bit | laplacian | 1008 | 0.128 | 0.1101 |
| TRUS | gaussian | 7840 | 0.056 | 0.0101 |
| TRUS | laplacian | 7840 | 0.177 | 0.1176 |

| family | Q 1 | Q 2 | Q 4 | Q 8 | Q 12 | Q 16 | Q 24 |  (largest error, share ≥ 1, gaussian)
| --- | --: | --: | --: | --: | --: | --: | --: |
| system B | 0.004 | 0.004 | 0.004 | 0.002 | 0.003 | 0.004 | 0.006 |
| content 2 DBT, 10-bit | 0.004 | 0.004 | 0.003 | 0.001 | 0.002 | 0.004 | 0.004 |
| TRUS | 0.001 | 0.004 | 0.015 | 0.027 | 0.028 | 0.026 | 0.031 |

Sigmoid presets: measured share ≥ 1 ÷ the centre-slope prediction is at most 1 on 31794 of 31794 frame × window readings; 0.61–0.98, median 0.93.
Largest move above ⌈k · max|Δ|⌉: 0 readings; with ⌊k · max|Δ|⌋ (the mutation): 948.



Read: on the linear presets the Gaussian model is within 0.015 of every measured share on 10-bit DBT, and within 0.031 for share ≥ 1 on TRUS (0.056 for ≥ 2). The Laplacian mutation is 0.13–0.18 off. The model is used only for linear windows; a SIGMOID preset is reported as measured.

## 2 · The header presets, measured

From the rows: the shares are over each window's shown samples, the median frame of the median series, and the worst frame of any series. RMS error in levels is k·e at the centre slope, worst frame, across the family's presets. σ and e_N are in levels at the centre slope, median.

| family | G | Q | presets, W | ≥ 1 level, med · worst | ≥ 2 levels, med · worst | largest move | RMS error in levels, worst frame | σ · e_N in levels, median |
| --- | --: | --: | --- | --- | --- | --: | --- | --- |
| system A | 1 | 1 | 550–850 sigmoid | 23.5 % · 30.4 % | 0.1 % · 0.6 % | 3 | 0.39–0.60 | 4.5 · 0.5 |
| system A | 1 | 2 | 550–850 sigmoid | 44.3 % · 53.5 % | 4.5 % · 9.6 % | 7 | 0.77–1.18 | 4.5 · 1.0 |
| system A | 1 | 4 | 550–850 sigmoid | 72.2 % · 78.2 % | 31.9 % · 43.7 % | 17 | 1.94–2.97 | 4.5 · 2.4 |
| system A | 1 | 8 | 550–850 sigmoid | 87.3 % · 90.8 % | 65.5 % · 73.9 % | 44 | 4.77–7.70 | 4.5 · 4.4 |
| system A | 1 | 12 | 550–850 sigmoid | 90.6 % · 93.5 % | 73.6 % · 81.4 % | 66 | 6.65–11.20 | 4.5 · 4.6 |
| system A | 1 | 16 | 550–850 sigmoid | 91.5 % · 94.3 % | 76.2 % · 83.7 % | 92 | 7.41–12.59 | 4.5 · 4.6 |
| system A | 1 | 24 | 550–850 sigmoid | 92.4 % · 94.8 % | 78.3 % · 85.0 % | 133 | 8.05–13.73 | 4.5 · 4.6 |
| system A | 16 | 1 | 550–850 sigmoid | 23.4 % · 30.4 % | 0.1 % · 0.6 % | 3 | 0.39–0.60 | 4.5 · 0.5 |
| system A | 16 | 2 | 550–850 sigmoid | 45.8 % · 54.9 % | 5.5 % · 11.0 % | 7 | 0.81–1.25 | 4.5 · 1.0 |
| system A | 16 | 4 | 550–850 sigmoid | 72.5 % · 78.3 % | 32.1 % · 43.9 % | 16 | 1.95–2.99 | 4.5 · 2.4 |
| system A | 16 | 8 | 550–850 sigmoid | 87.1 % · 90.7 % | 65.1 % · 73.9 % | 44 | 4.75–7.69 | 4.5 · 4.4 |
| system A | 16 | 12 | 550–850 sigmoid | 90.5 % · 93.5 % | 73.4 % · 81.4 % | 65 | 6.63–11.19 | 4.5 · 4.6 |
| system A | 16 | 16 | 550–850 sigmoid | 91.6 % · 94.3 % | 76.3 % · 83.7 % | 97 | 7.44–12.67 | 4.5 · 4.6 |
| system A | 16 | 24 | 550–850 sigmoid | 92.5 % · 94.9 % | 78.7 % · 85.4 % | 131 | 8.25–14.15 | 4.5 · 4.6 |
| system B | 1 | 1 | 512–512 linear | 19.2 % · 19.3 % | < 0.1 % · < 0.1 % | 2 | 0.31–0.31 | 2.7 · 0.3 |
| system B | 1 | 2 | 512–512 linear | 35.7 % · 36.1 % | 0.4 % · 0.5 % | 4 | 0.49–0.50 | 2.7 · 0.5 |
| system B | 1 | 4 | 512–512 linear | 61.1 % · 62.1 % | 12.6 % · 13.7 % | 12 | 0.95–0.99 | 2.7 · 1.0 |
| system B | 1 | 8 | 512–512 linear | 81.9 % · 82.2 % | 49.2 % · 49.9 % | 31 | 2.05–2.20 | 2.7 · 2.1 |
| system B | 1 | 12 | 512–512 linear | 87.9 % · 88.2 % | 64.7 % · 65.6 % | 57 | 2.84–3.37 | 2.7 · 2.7 |
| system B | 1 | 16 | 512–512 linear | 90.1 % · 90.5 % | 70.8 % · 72.1 % | 92 | 3.37–4.23 | 2.7 · 2.8 |
| system B | 1 | 24 | 512–512 linear | 91.4 % · 92.2 % | 74.5 % · 76.8 % | 113 | 3.97–5.21 | 2.7 · 2.8 |
| system B | 16 | 1 | 512–512 linear | 20.4 % · 20.5 % | < 0.1 % · < 0.1 % | 9 | 0.33–0.33 | 2.7 · 0.3 |
| system B | 16 | 2 | 512–512 linear | 35.8 % · 36.2 % | 0.4 % · 0.5 % | 15 | 0.49–0.50 | 2.7 · 0.5 |
| system B | 16 | 4 | 512–512 linear | 61.5 % · 62.1 % | 12.9 % · 13.7 % | 21 | 0.96–0.99 | 2.7 · 1.0 |
| system B | 16 | 8 | 512–512 linear | 81.5 % · 82.1 % | 48.4 % · 49.8 % | 37 | 2.05–2.20 | 2.7 · 2.0 |
| system B | 16 | 12 | 512–512 linear | 87.7 % · 88.2 % | 64.3 % · 65.5 % | 56 | 2.84–3.36 | 2.7 · 2.7 |
| system B | 16 | 16 | 512–512 linear | 89.9 % · 90.5 % | 70.5 % · 72.1 % | 73 | 3.37–4.23 | 2.7 · 2.8 |
| system B | 16 | 24 | 512–512 linear | 91.4 % · 92.3 % | 74.6 % · 77.3 % | 95 | 4.05–5.29 | 2.7 · 2.8 |
| system C | 1 | 1 | 550–1093 sigmoid | 21.8 % · 33.2 % | < 0.1 % · 0.9 % | 3 | 0.30–0.60 | 5.0 · 0.5 |
| system C | 1 | 2 | 550–1093 sigmoid | 41.8 % · 56.6 % | 3.3 % · 12.0 % | 7 | 0.60–1.18 | 5.0 · 0.9 |
| system C | 1 | 4 | 550–1093 sigmoid | 69.7 % · 79.5 % | 28.7 % · 47.4 % | 15 | 1.50–2.94 | 5.0 · 2.3 |
| system C | 1 | 8 | 550–1093 sigmoid | 85.8 % · 91.6 % | 63.4 % · 76.9 % | 42 | 3.81–7.76 | 5.0 · 4.6 |
| system C | 1 | 12 | 550–1093 sigmoid | 89.3 % · 94.2 % | 72.6 % · 83.8 % | 75 | 5.48–11.86 | 5.0 · 5.2 |
| system C | 1 | 16 | 550–1093 sigmoid | 90.6 % · 95.0 % | 75.3 % · 86.0 % | 85 | 6.24–14.03 | 5.0 · 5.2 |
| system C | 1 | 24 | 550–1093 sigmoid | 91.5 % · 95.6 % | 77.4 % · 87.6 % | 129 | 6.88–15.70 | 5.0 · 5.2 |
| system C | 16 | 1 | 550–1093 sigmoid | 21.7 % · 33.2 % | < 0.1 % · 0.9 % | 10 | 0.30–0.60 | 5.0 · 0.4 |
| system C | 16 | 2 | 550–1093 sigmoid | 43.2 % · 56.6 % | 4.1 % · 11.9 % | 10 | 0.63–1.19 | 5.0 · 0.9 |
| system C | 16 | 4 | 550–1093 sigmoid | 69.9 % · 79.5 % | 29.0 % · 47.4 % | 18 | 1.51–2.94 | 5.0 · 2.3 |
| system C | 16 | 8 | 550–1093 sigmoid | 85.7 % · 91.6 % | 62.9 % · 76.9 % | 41 | 3.80–7.75 | 5.0 · 4.6 |
| system C | 16 | 12 | 550–1093 sigmoid | 89.3 % · 94.2 % | 72.4 % · 83.8 % | 75 | 5.45–11.82 | 5.0 · 5.2 |
| system C | 16 | 16 | 550–1093 sigmoid | 90.6 % · 95.0 % | 75.3 % · 86.1 % | 93 | 6.25–14.02 | 5.0 · 5.2 |
| system C | 16 | 24 | 550–1093 sigmoid | 91.8 % · 95.7 % | 77.9 % · 87.9 % | 135 | 7.06–16.24 | 5.0 · 5.2 |
| content 2 DBT, 10-bit | 1 | 1 | 512–512 linear | 19.2 % · 19.3 % | 0.0 % · < 0.1 % | 2 | 0.31–0.31 | 2.0 · 0.3 |
| content 2 DBT, 10-bit | 1 | 2 | 512–512 linear | 35.9 % · 36.1 % | 0.4 % · 0.4 % | 3 | 0.50–0.50 | 2.0 · 0.5 |
| content 2 DBT, 10-bit | 1 | 4 | 512–512 linear | 61.5 % · 62.1 % | 13.0 % · 13.6 % | 6 | 0.96–0.98 | 2.0 · 1.0 |
| content 2 DBT, 10-bit | 1 | 8 | 512–512 linear | 81.3 % · 81.5 % | 47.8 % · 48.2 % | 26 | 2.10–2.12 | 2.0 · 1.8 |
| content 2 DBT, 10-bit | 1 | 12 | 512–512 linear | 86.8 % · 87.0 % | 61.8 % · 62.3 % | 52 | 3.02–3.07 | 2.0 · 2.0 |
| content 2 DBT, 10-bit | 1 | 16 | 512–512 linear | 89.2 % · 89.5 % | 68.5 % · 69.3 % | 71 | 3.72–3.85 | 2.0 · 2.0 |
| content 2 DBT, 10-bit | 1 | 24 | 512–512 linear | 91.3 % · 91.7 % | 74.4 % · 75.4 % | 94 | 4.65–4.88 | 2.0 · 2.1 |
| content 2 DBT, 10-bit | 16 | 1 | 512–512 linear | 19.9 % · 20.5 % | < 0.1 % · < 0.1 % | 10 | 0.32–0.33 | 2.0 · 0.3 |
| content 2 DBT, 10-bit | 16 | 2 | 512–512 linear | 35.9 % · 36.2 % | 0.4 % · 0.5 % | 12 | 0.50–0.50 | 2.0 · 0.5 |
| content 2 DBT, 10-bit | 16 | 4 | 512–512 linear | 61.7 % · 62.0 % | 13.2 % · 13.6 % | 23 | 0.97–0.98 | 2.0 · 1.0 |
| content 2 DBT, 10-bit | 16 | 8 | 512–512 linear | 81.0 % · 81.4 % | 47.1 % · 48.1 % | 29 | 2.10–2.12 | 2.0 · 1.7 |
| content 2 DBT, 10-bit | 16 | 12 | 512–512 linear | 86.6 % · 87.0 % | 61.4 % · 62.3 % | 52 | 3.01–3.07 | 2.0 · 2.0 |
| content 2 DBT, 10-bit | 16 | 16 | 512–512 linear | 89.1 % · 89.5 % | 68.1 % · 69.1 % | 66 | 3.71–3.84 | 2.0 · 2.0 |
| content 2 DBT, 10-bit | 16 | 24 | 512–512 linear | 91.4 % · 91.8 % | 74.5 % · 75.8 % | 77 | 4.68–4.97 | 2.0 · 2.1 |
| content 2 DBT, 12-bit | 1 | 1 | 550–966 sigmoid | 23.3 % · 32.8 % | < 0.1 % · 0.9 % | 3 | 0.34–0.60 | 4.5 · 0.5 |
| content 2 DBT, 12-bit | 1 | 2 | 550–966 sigmoid | 44.0 % · 56.0 % | 4.1 % · 12.2 % | 6 | 0.67–1.18 | 4.5 · 0.9 |
| content 2 DBT, 12-bit | 1 | 4 | 550–966 sigmoid | 71.0 % · 79.0 % | 31.5 % · 46.4 % | 15 | 1.69–2.94 | 4.5 · 2.2 |
| content 2 DBT, 12-bit | 1 | 8 | 550–966 sigmoid | 86.6 % · 91.0 % | 64.4 % · 74.6 % | 41 | 4.35–7.35 | 4.5 · 4.3 |
| content 2 DBT, 12-bit | 1 | 12 | 550–966 sigmoid | 90.1 % · 93.4 % | 73.3 % · 81.7 % | 61 | 6.45–10.44 | 4.5 · 4.7 |
| content 2 DBT, 12-bit | 1 | 16 | 550–966 sigmoid | 91.3 % · 94.4 % | 76.6 % · 84.0 % | 91 | 7.40–12.20 | 4.5 · 4.7 |
| content 2 DBT, 12-bit | 1 | 24 | 550–966 sigmoid | 92.3 % · 94.9 % | 79.0 % · 85.5 % | 112 | 8.24–13.74 | 4.5 · 4.7 |
| content 2 DBT, 12-bit | 16 | 1 | 550–966 sigmoid | 23.2 % · 32.8 % | < 0.1 % · 0.9 % | 3 | 0.34–0.60 | 4.5 · 0.5 |
| content 2 DBT, 12-bit | 16 | 2 | 550–966 sigmoid | 44.7 % · 56.0 % | 4.4 % · 12.2 % | 6 | 0.71–1.18 | 4.5 · 0.9 |
| content 2 DBT, 12-bit | 16 | 4 | 550–966 sigmoid | 71.0 % · 79.0 % | 31.5 % · 46.4 % | 15 | 1.71–2.96 | 4.5 · 2.2 |
| content 2 DBT, 12-bit | 16 | 8 | 550–966 sigmoid | 86.5 % · 90.8 % | 64.1 % · 74.6 % | 37 | 4.34–7.34 | 4.5 · 4.3 |
| content 2 DBT, 12-bit | 16 | 12 | 550–966 sigmoid | 90.0 % · 93.4 % | 73.2 % · 81.4 % | 53 | 6.43–10.36 | 4.5 · 4.7 |
| content 2 DBT, 12-bit | 16 | 16 | 550–966 sigmoid | 91.3 % · 94.3 % | 76.5 % · 84.0 % | 76 | 7.40–12.31 | 4.5 · 4.7 |
| content 2 DBT, 12-bit | 16 | 24 | 550–966 sigmoid | 92.4 % · 95.1 % | 79.3 % · 86.0 % | 112 | 8.47–14.23 | 4.5 · 4.7 |
| TRUS | 1 | 1 | 256–256 linear | 15.7 % · 17.0 % | < 0.1 % · < 0.1 % | 4 | 0.41–0.41 | 1.7 · 0.4 |
| TRUS | 1 | 2 | 256–256 linear | 30.1 % · 30.8 % | 0.3 % · 0.4 % | 5 | 0.56–0.56 | 1.7 · 0.6 |
| TRUS | 1 | 4 | 256–256 linear | 51.2 % · 52.2 % | 5.2 % · 5.8 % | 27 | 0.83–0.84 | 1.7 · 0.8 |
| TRUS | 1 | 8 | 256–256 linear | 68.8 % · 70.1 % | 23.7 % · 25.4 % | 38 | 1.34–1.36 | 1.7 · 1.2 |
| TRUS | 1 | 12 | 256–256 linear | 75.9 % · 78.0 % | 36.6 % · 40.8 % | 38 | 1.84–1.88 | 1.7 · 1.6 |
| TRUS | 1 | 16 | 256–256 linear | 79.7 % · 82.3 % | 44.9 % · 50.4 % | 46 | 2.33–2.35 | 1.7 · 1.8 |
| TRUS | 1 | 24 | 256–256 linear | 83.5 % · 86.6 % | 53.9 % · 61.4 % | 57 | 3.18–3.20 | 1.7 · 2.2 |
| TRUS | 16 | 1 | 256–256 linear | 18.7 % · 20.6 % | < 0.1 % · < 0.1 % | 7 | 0.45–0.45 | 1.7 · 0.4 |
| TRUS | 16 | 2 | 256–256 linear | 32.4 % · 34.3 % | 0.4 % · 0.5 % | 11 | 0.60–0.60 | 1.7 · 0.6 |
| TRUS | 16 | 4 | 256–256 linear | 53.1 % · 54.1 % | 6.0 % · 6.6 % | 13 | 0.86–0.87 | 1.7 · 0.8 |
| TRUS | 16 | 8 | 256–256 linear | 69.3 % · 70.7 % | 24.4 % · 26.3 % | 28 | 1.37–1.39 | 1.7 · 1.3 |
| TRUS | 16 | 12 | 256–256 linear | 76.2 % · 78.5 % | 37.2 % · 41.5 % | 32 | 1.90–1.92 | 1.7 · 1.6 |
| TRUS | 16 | 16 | 256–256 linear | 79.8 % · 82.4 % | 45.0 % · 50.9 % | 35 | 2.37–2.38 | 1.7 · 1.8 |
| TRUS | 16 | 24 | 256–256 linear | 83.6 % · 86.7 % | 54.1 % · 61.9 % | 57 | 3.23–3.27 | 1.7 · 2.2 |


## 3 · The narrowest widths, per Q

These are source units, median over the family's series with the largest in brackets. Column by column:

* **e_N ÷ σ ≤ 1** counts the series on which every frame passes, at any W.
* **The RMS error is 1 level** at W = 1 + 255 · e, worst frame. Narrower windows show it as more than one level.
* **The bound for no move ≥ 2** comes from the frame-wide largest |Δ|. It is loose, because it uses the frame-wide largest |Δ|; the in-window moves measured at the presets (§2) sit well under it.
* **σ is 1 level** at W = 1 + 255 · σ, median frame. Narrower windows show the frame's own noise as more than one level.
* **Presets under 1 level** counts series × presets.
* **JOD** is the visibility model's score at the first preset, as the study measured it (10 = no visible difference).

| family | G | Q | e_N ÷ σ ≤ 1, every frame | W where the RMS error = 1 level | W bound, no move ≥ 2 | W where σ = 1 level | presets with the RMS error under 1 level | bytes ÷ HTJ2K | JOD |
| --- | --: | --: | --- | --- | --- | --- | --- | --- | --- |
| system A | 1 | 1 | 5 of 5 | 329 (330) | 6886 (9436) | 3048 (3613) | 15 of 15 | 0.640 | 10.00–10.00 |
| system A | 1 | 2 | 5 of 5 | 652 (653) | 7906 (10456) | 3048 (3613) | 10 of 15 | 0.489 | 10.00–10.00 |
| system A | 1 | 4 | 5 of 5 | 1647 (1652) | 20401 (21931) | 3048 (3613) | 0 of 15 | 0.279 | 9.96–9.98 |
| system A | 1 | 8 | 2 of 5 | 4185 (4237) | 61711 (75481) | 3048 (3613) | 0 of 15 | 0.090 | 9.67–9.77 |
| system A | 1 | 12 | 0 of 5 | 5951 (6161) | 82111 (109651) | 3048 (3613) | 0 of 15 | 0.029 | 9.03–9.27 |
| system A | 1 | 16 | 0 of 5 | 6665 (6927) | 99961 (132091) | 3048 (3613) | 0 of 15 | 0.013 | 8.15–8.66 |
| system A | 1 | 24 | 0 of 5 | 7254 (7550) | 140506 (176971) | 3048 (3613) | 0 of 15 | 0.006 | 6.77–7.77 |
| system A | 16 | 1 | 5 of 5 | 329 (330) | 13261 (14281) | 3048 (3613) | 15 of 15 | 0.644 | 10.00–10.00 |
| system A | 16 | 2 | 5 of 5 | 691 (693) | 19126 (26776) | 3048 (3613) | 8 of 15 | 0.476 | 10.00–10.00 |
| system A | 16 | 4 | 5 of 5 | 1655 (1658) | 34681 (41566) | 3048 (3613) | 0 of 15 | 0.279 | 9.96–9.98 |
| system A | 16 | 8 | 3 of 5 | 4157 (4228) | 52531 (65026) | 3048 (3613) | 0 of 15 | 0.088 | 9.68–9.77 |
| system A | 16 | 12 | 0 of 5 | 5876 (6156) | 82111 (86446) | 3048 (3613) | 0 of 15 | 0.025 | 9.02–9.28 |
| system A | 16 | 16 | 0 of 5 | 6654 (6971) | 96901 (108631) | 3048 (3613) | 0 of 15 | 0.008 | 8.08–8.62 |
| system A | 16 | 24 | 0 of 5 | 7446 (7782) | 115771 (176971) | 3048 (3613) | 0 of 15 | 0.002 | 6.47–7.51 |
| system B | 1 | 1 | 5 of 5 | 161 (162) | 2296 (4846) | 1399 (1430) | 5 of 5 | 0.771 | 10.00–10.00 |
| system B | 1 | 2 | 5 of 5 | 254 (256) | 4591 (5356) | 1399 (1430) | 5 of 5 | 0.594 | 10.00–10.00 |
| system B | 1 | 4 | 5 of 5 | 491 (505) | 7906 (9181) | 1399 (1430) | 5 of 5 | 0.377 | 9.99–10.00 |
| system B | 1 | 8 | 5 of 5 | 1114 (1126) | 21676 (33406) | 1399 (1430) | 0 of 5 | 0.185 | 9.95–9.96 |
| system B | 1 | 12 | 3 of 5 | 1707 (1721) | 52531 (60436) | 1399 (1430) | 0 of 5 | 0.096 | 9.83–9.86 |
| system B | 1 | 16 | 0 of 5 | 2106 (2161) | 66301 (85936) | 1399 (1430) | 0 of 5 | 0.053 | 9.65–9.71 |
| system B | 1 | 24 | 0 of 5 | 2455 (2663) | 66301 (94096) | 1399 (1430) | 0 of 5 | 0.022 | 9.12–9.31 |
| system B | 16 | 1 | 5 of 5 | 168 (168) | 5611 (6376) | 1399 (1430) | 5 of 5 | 0.742 | 10.00–10.00 |
| system B | 16 | 2 | 5 of 5 | 255 (257) | 6886 (8671) | 1399 (1430) | 5 of 5 | 0.588 | 10.00–10.00 |
| system B | 16 | 4 | 5 of 5 | 495 (505) | 10711 (12751) | 1399 (1430) | 5 of 5 | 0.374 | 9.99–9.99 |
| system B | 16 | 8 | 5 of 5 | 1113 (1124) | 19636 (21931) | 1399 (1430) | 0 of 5 | 0.182 | 9.95–9.96 |
| system B | 16 | 12 | 2 of 5 | 1707 (1719) | 42076 (66046) | 1399 (1430) | 0 of 5 | 0.088 | 9.82–9.86 |
| system B | 16 | 16 | 0 of 5 | 2104 (2161) | 61456 (69616) | 1399 (1430) | 0 of 5 | 0.043 | 9.61–9.71 |
| system B | 16 | 24 | 0 of 5 | 2475 (2706) | 79306 (87211) | 1399 (1430) | 0 of 5 | 0.014 | 8.98–9.24 |
| system C | 1 | 1 | 5 of 5 | 329 (331) | 7651 (9436) | 3697 (4033) | 15 of 15 | 0.648 | 10.00–10.00 |
| system C | 1 | 2 | 5 of 5 | 651 (652) | 8416 (9436) | 3697 (4033) | 10 of 15 | 0.503 | 10.00–10.00 |
| system C | 1 | 4 | 5 of 5 | 1633 (1651) | 20146 (28561) | 3697 (4033) | 0 of 15 | 0.303 | 9.96–9.98 |
| system C | 1 | 8 | 5 of 5 | 4208 (4267) | 71401 (89251) | 3697 (4033) | 0 of 15 | 0.111 | 9.70–9.84 |
| system C | 1 | 12 | 0 of 5 | 6094 (6522) | 90016 (111436) | 3697 (4033) | 0 of 15 | 0.038 | 9.10–9.48 |
| system C | 1 | 16 | 0 of 5 | 7005 (7716) | 125716 (146881) | 3697 (4033) | 0 of 15 | 0.017 | 8.35–8.97 |
| system C | 1 | 24 | 0 of 5 | 7827 (8635) | 145861 (198136) | 3697 (4033) | 0 of 15 | 0.007 | 7.04–8.11 |
| system C | 16 | 1 | 5 of 5 | 329 (331) | 13771 (14281) | 3697 (4033) | 15 of 15 | 0.650 | 10.00–10.00 |
| system C | 16 | 2 | 5 of 5 | 689 (691) | 18616 (26521) | 3697 (4033) | 10 of 15 | 0.488 | 10.00–10.00 |
| system C | 16 | 4 | 5 of 5 | 1644 (1656) | 36211 (37741) | 3697 (4033) | 0 of 15 | 0.302 | 9.96–9.98 |
| system C | 16 | 8 | 5 of 5 | 4172 (4266) | 60946 (80071) | 3697 (4033) | 0 of 15 | 0.112 | 9.70–9.84 |
| system C | 16 | 12 | 0 of 5 | 6066 (6504) | 72931 (97921) | 3697 (4033) | 0 of 15 | 0.035 | 9.13–9.49 |
| system C | 16 | 16 | 0 of 5 | 6995 (7714) | 100471 (133366) | 3697 (4033) | 0 of 15 | 0.012 | 8.28–8.96 |
| system C | 16 | 24 | 0 of 5 | 8061 (8935) | 137701 (151216) | 3697 (4033) | 0 of 15 | 0.003 | 6.71–7.94 |
| content 2 DBT, 10-bit | 1 | 1 | 2 of 2 | 162 (162) | 2296 (2296) | 1026 (1054) | 2 of 2 | 0.793 | 10.00–10.00 |
| content 2 DBT, 10-bit | 1 | 2 | 2 of 2 | 255 (256) | 3316 (4336) | 1026 (1054) | 2 of 2 | 0.623 | 10.00–10.00 |
| content 2 DBT, 10-bit | 1 | 4 | 2 of 2 | 496 (503) | 5738 (6886) | 1026 (1054) | 2 of 2 | 0.426 | 10.00–10.00 |
| content 2 DBT, 10-bit | 1 | 8 | 2 of 2 | 1080 (1086) | 21038 (21676) | 1026 (1054) | 0 of 2 | 0.207 | 9.96–9.96 |
| content 2 DBT, 10-bit | 1 | 12 | 2 of 2 | 1558 (1572) | 52021 (61201) | 1026 (1054) | 0 of 2 | 0.118 | 9.87–9.89 |
| content 2 DBT, 10-bit | 1 | 16 | 0 of 2 | 1935 (1970) | 84788 (87466) | 1026 (1054) | 0 of 2 | 0.075 | 9.73–9.76 |
| content 2 DBT, 10-bit | 1 | 24 | 0 of 2 | 2436 (2497) | 106336 (113476) | 1026 (1054) | 0 of 2 | 0.038 | 9.33–9.39 |
| content 2 DBT, 10-bit | 16 | 1 | 2 of 2 | 166 (169) | 5228 (6376) | 1026 (1054) | 2 of 2 | 0.786 | 10.00–10.00 |
| content 2 DBT, 10-bit | 16 | 2 | 2 of 2 | 256 (258) | 6504 (7396) | 1026 (1054) | 2 of 2 | 0.619 | 10.00–10.00 |
| content 2 DBT, 10-bit | 16 | 4 | 2 of 2 | 501 (503) | 9691 (11731) | 1026 (1054) | 2 of 2 | 0.417 | 10.00–10.00 |
| content 2 DBT, 10-bit | 16 | 8 | 2 of 2 | 1079 (1085) | 15811 (16576) | 1026 (1054) | 0 of 2 | 0.197 | 9.96–9.96 |
| content 2 DBT, 10-bit | 16 | 12 | 2 of 2 | 1555 (1571) | 36976 (47176) | 1026 (1054) | 0 of 2 | 0.106 | 9.87–9.89 |
| content 2 DBT, 10-bit | 16 | 16 | 0 of 2 | 1930 (1965) | 39526 (45646) | 1026 (1054) | 0 of 2 | 0.061 | 9.71–9.75 |
| content 2 DBT, 10-bit | 16 | 24 | 0 of 2 | 2466 (2539) | 79306 (92056) | 1026 (1054) | 0 of 2 | 0.024 | 9.26–9.31 |
| content 2 DBT, 12-bit | 1 | 1 | 2 of 2 | 330 (330) | 5101 (6631) | 3298 (3677) | 6 of 6 | 0.643 | 10.00–10.00 |
| content 2 DBT, 12-bit | 1 | 2 | 2 of 2 | 652 (652) | 6376 (7906) | 3298 (3677) | 4 of 6 | 0.497 | 10.00–10.00 |
| content 2 DBT, 12-bit | 1 | 4 | 2 of 2 | 1627 (1638) | 15046 (17341) | 3298 (3677) | 0 of 6 | 0.293 | 9.96–9.98 |
| content 2 DBT, 12-bit | 1 | 8 | 2 of 2 | 4127 (4208) | 58141 (74206) | 3298 (3677) | 0 of 6 | 0.103 | 9.69–9.84 |
| content 2 DBT, 12-bit | 1 | 12 | 0 of 2 | 5989 (6233) | 73824 (97411) | 3298 (3677) | 0 of 6 | 0.038 | 9.06–9.49 |
| content 2 DBT, 12-bit | 1 | 16 | 0 of 2 | 6928 (7148) | 86446 (102256) | 3298 (3677) | 0 of 6 | 0.018 | 8.26–9.00 |
| content 2 DBT, 12-bit | 1 | 24 | 0 of 2 | 7762 (7964) | 114751 (126481) | 3298 (3677) | 0 of 6 | 0.008 | 6.91–8.07 |
| content 2 DBT, 12-bit | 16 | 1 | 2 of 2 | 330 (330) | 8416 (10456) | 3298 (3677) | 6 of 6 | 0.648 | 10.00–10.00 |
| content 2 DBT, 12-bit | 16 | 2 | 2 of 2 | 671 (690) | 15556 (18361) | 3298 (3677) | 4 of 6 | 0.489 | 10.00–10.00 |
| content 2 DBT, 12-bit | 16 | 4 | 2 of 2 | 1639 (1649) | 28051 (31876) | 3298 (3677) | 0 of 6 | 0.294 | 9.96–9.98 |
| content 2 DBT, 12-bit | 16 | 8 | 2 of 2 | 4117 (4196) | 48578 (55591) | 3298 (3677) | 0 of 6 | 0.103 | 9.68–9.84 |
| content 2 DBT, 12-bit | 16 | 12 | 0 of 2 | 5959 (6216) | 83896 (104041) | 3298 (3677) | 0 of 6 | 0.034 | 9.08–9.50 |
| content 2 DBT, 12-bit | 16 | 16 | 0 of 2 | 6959 (7147) | 100088 (104296) | 3298 (3677) | 0 of 6 | 0.012 | 8.16–8.97 |
| content 2 DBT, 12-bit | 16 | 24 | 0 of 2 | 8006 (8185) | 125971 (132346) | 3298 (3677) | 0 of 6 | 0.004 | 6.53–7.83 |
| TRUS | 1 | 1 | 2 of 2 | 106 (106) | 894 (1021) | 422 (424) | 2 of 2 | 0.819 | 10.00–10.00 |
| TRUS | 1 | 2 | 2 of 2 | 145 (145) | 1276 (1276) | 422 (424) | 2 of 2 | 0.698 | 10.00–10.00 |
| TRUS | 1 | 4 | 2 of 2 | 215 (216) | 6248 (6886) | 422 (424) | 2 of 2 | 0.531 | 10.00–10.00 |
| TRUS | 1 | 8 | 0 of 2 | 345 (348) | 8288 (9691) | 422 (424) | 0 of 2 | 0.342 | 9.99–9.99 |
| TRUS | 1 | 12 | 0 of 2 | 476 (482) | 8544 (9691) | 422 (424) | 0 of 2 | 0.243 | 9.97–9.98 |
| TRUS | 1 | 16 | 0 of 2 | 598 (600) | 10711 (11731) | 422 (424) | 0 of 2 | 0.185 | 9.95–9.96 |
| TRUS | 1 | 24 | 0 of 2 | 814 (817) | 12114 (14536) | 422 (424) | 0 of 2 | 0.118 | 9.88–9.89 |
| TRUS | 16 | 1 | 2 of 2 | 117 (117) | 1658 (1786) | 422 (424) | 2 of 2 | 0.716 | 10.00–10.00 |
| TRUS | 16 | 2 | 2 of 2 | 153 (154) | 2806 (2806) | 422 (424) | 2 of 2 | 0.601 | 10.00–10.00 |
| TRUS | 16 | 4 | 1 of 2 | 221 (222) | 3061 (3316) | 422 (424) | 2 of 2 | 0.439 | 10.00–10.00 |
| TRUS | 16 | 8 | 0 of 2 | 353 (355) | 6504 (7141) | 422 (424) | 0 of 2 | 0.264 | 9.99–9.99 |
| TRUS | 16 | 12 | 0 of 2 | 488 (490) | 7906 (8161) | 422 (424) | 0 of 2 | 0.180 | 9.97–9.97 |
| TRUS | 16 | 16 | 0 of 2 | 607 (607) | 8416 (8926) | 422 (424) | 0 of 2 | 0.131 | 9.95–9.95 |
| TRUS | 16 | 24 | 0 of 2 | 830 (834) | 13644 (14536) | 422 (424) | 0 of 2 | 0.079 | 9.86–9.87 |


## 4 · Q 8 and an automatic exact request

The width below which Q 8's worst-frame RMS error exceeds X levels, 1 + (W_rms − 1) ÷ X, largest over the family. The last column counts the presets (series × preset) at which Q 8 already exceeds X. X is for readers to set.

| family | G | X = 1 | X = 2 | X = 4 | X = 8 | header presets past X, at X = 1 · 2 · 4 · 8 |
| --- | --: | --: | --: | --: | --: | --- |
| system A | 1 | 4237 | 2119 | 1060 | 530 | 15 of 15 · 15 of 15 · 15 of 15 · 0 of 15 |
| system A | 16 | 4228 | 2115 | 1058 | 529 | 15 of 15 · 15 of 15 · 15 of 15 · 0 of 15 |
| system B | 1 | 1126 | 564 | 282 | 142 | 5 of 5 · 5 of 5 · 0 of 5 · 0 of 5 |
| system B | 16 | 1124 | 562 | 282 | 141 | 5 of 5 · 5 of 5 · 0 of 5 · 0 of 5 |
| system C | 1 | 4267 | 2134 | 1067 | 534 | 15 of 15 · 15 of 15 · 14 of 15 · 0 of 15 |
| system C | 16 | 4266 | 2134 | 1067 | 534 | 15 of 15 · 15 of 15 · 14 of 15 · 0 of 15 |
| content 2 DBT, 10-bit | 1 | 1086 | 543 | 272 | 137 | 2 of 2 · 2 of 2 · 0 of 2 · 0 of 2 |
| content 2 DBT, 10-bit | 16 | 1085 | 543 | 272 | 137 | 2 of 2 · 2 of 2 · 0 of 2 · 0 of 2 |
| content 2 DBT, 12-bit | 1 | 4208 | 2104 | 1053 | 527 | 6 of 6 · 6 of 6 · 6 of 6 · 0 of 6 |
| content 2 DBT, 12-bit | 16 | 4196 | 2098 | 1050 | 525 | 6 of 6 · 6 of 6 · 6 of 6 · 0 of 6 |
| TRUS | 1 | 348 | 174 | 88 | 44 | 2 of 2 · 0 of 2 · 0 of 2 · 0 of 2 |
| TRUS | 16 | 355 | 178 | 90 | 45 | 2 of 2 · 0 of 2 · 0 of 2 · 0 of 2 |


## 5 · The sweep (*derived*)

These are LINEAR windows at the frame's median level. The column header is in 12-bit units; a 10-bit series is read at W ÷ 4 and TRUS at W ÷ 16. Once k ≥ 1 (W ≤ 256 at 12 bits, ≤ 64 at 10, ≤ 16 at 8), every nonzero source error moves at least one level, so the share ≥ 1 stops growing and the share ≥ 2 catches it up. Every value per series is in `lab/av1/metrics/rows/window.tsv`.
**Display PSNR from the codes, dB**: median series' median frame · worst series' worst frame

| family | G | Q | W 4096 | W 2048 | W 1024 | W 512 | W 256 | W 128 | W 64 |
| --- | --: | --: | --- | --- | --- | --- | --- | --- | --- |
| system A | 1 | 1 | 60.3 · 60.3 | 57.3 · 57.3 | 54.3 · 54.3 | 50.8 · 50.8 | 45.9 · 45.9 | 39.9 · 39.9 | 33.8 · 33.8 |
| system A | 1 | 2 | 57.2 · 57.1 | 54.1 · 54.1 | 50.6 · 50.6 | 45.7 · 45.7 | 40.0 · 40.0 | 33.9 · 33.9 | 27.9 · 27.8 |
| system A | 1 | 4 | 53.0 · 53.0 | 49.1 · 49.0 | 43.8 · 43.7 | 37.9 · 37.9 | 32.0 · 31.9 | 25.9 · 25.9 | 19.8 · 19.8 |
| system A | 1 | 8 | 47.7 · 47.2 | 42.2 · 41.7 | 36.3 · 35.7 | 30.3 · 29.8 | 24.2 · 23.7 | 18.2 · 17.7 | 12.1 · 11.6 |
| system A | 1 | 12 | 45.1 · 44.3 | 39.3 · 38.5 | 33.4 · 32.5 | 27.4 · 26.5 | 21.3 · 20.5 | 15.3 · 14.4 | 9.2 · 8.3 |
| system A | 1 | 16 | 44.1 · 43.3 | 38.2 · 37.5 | 32.3 · 31.5 | 26.3 · 25.5 | 20.2 · 19.5 | 14.2 · 13.4 | 8.1 · 7.3 |
| system A | 1 | 24 | 43.2 · 42.6 | 37.3 · 36.7 | 31.4 · 30.8 | 25.3 · 24.7 | 19.3 · 18.7 | 13.3 · 12.6 | 7.2 · 6.6 |
| system A | 16 | 1 | 60.3 · 60.3 | 57.3 · 57.3 | 54.3 · 54.3 | 50.9 · 50.8 | 46.0 · 45.9 | 39.9 · 39.9 | 33.8 · 33.8 |
| system A | 16 | 2 | 56.9 · 56.9 | 53.9 · 53.9 | 50.3 · 50.2 | 45.2 · 45.2 | 39.5 · 39.5 | 33.4 · 33.4 | 27.4 · 27.3 |
| system A | 16 | 4 | 53.0 · 53.0 | 49.0 · 49.0 | 43.7 · 43.7 | 37.9 · 37.9 | 31.9 · 31.9 | 25.9 · 25.8 | 19.8 · 19.7 |
| system A | 16 | 8 | 47.8 · 47.2 | 42.3 · 41.7 | 36.4 · 35.8 | 30.4 · 29.8 | 24.4 · 23.7 | 18.3 · 17.7 | 12.2 · 11.6 |
| system A | 16 | 12 | 45.2 · 44.3 | 39.4 · 38.5 | 33.5 · 32.5 | 27.5 · 26.5 | 21.4 · 20.5 | 15.4 · 14.4 | 9.3 · 8.3 |
| system A | 16 | 16 | 44.1 · 43.3 | 38.2 · 37.4 | 32.3 · 31.4 | 26.3 · 25.4 | 20.2 · 19.4 | 14.2 · 13.3 | 8.1 · 7.3 |
| system A | 16 | 24 | 43.0 · 42.4 | 37.1 · 36.5 | 31.1 · 30.5 | 25.1 · 24.5 | 19.1 · 18.4 | 13.0 · 12.4 | 6.9 · 6.3 |
| system B | 1 | 1 | 58.4 · 58.4 | 55.4 · 55.4 | 52.2 · 52.2 | 46.1 · 46.1 | 40.0 · 40.0 | 33.9 · 33.8 | 27.6 · 27.5 |
| system B | 1 | 2 | 55.6 · 55.5 | 52.5 · 52.4 | 48.2 · 48.1 | 42.1 · 42.1 | 36.0 · 36.0 | 29.9 · 29.8 | 23.6 · 23.5 |
| system B | 1 | 4 | 52.3 · 52.1 | 48.0 · 47.7 | 42.5 · 42.2 | 36.4 · 36.2 | 30.3 · 30.1 | 24.2 · 23.9 | 17.9 · 17.6 |
| system B | 1 | 8 | 46.9 · 46.8 | 41.3 · 41.2 | 35.3 · 35.2 | 29.3 · 29.2 | 23.2 · 23.1 | 17.0 · 16.9 | 10.7 · 10.6 |
| system B | 1 | 12 | 43.5 · 43.4 | 37.7 · 37.5 | 31.7 · 31.6 | 25.7 · 25.5 | 19.6 · 19.4 | 13.4 · 13.2 | 7.1 · 6.9 |
| system B | 1 | 16 | 41.8 · 41.5 | 35.9 · 35.6 | 29.9 · 29.6 | 23.9 · 23.5 | 17.8 · 17.4 | 11.6 · 11.3 | 5.3 · 5.0 |
| system B | 1 | 24 | 40.5 · 39.7 | 34.6 · 33.8 | 28.6 · 27.8 | 22.5 · 21.7 | 16.4 · 15.6 | 10.3 · 9.5 | 4.0 · 3.1 |
| system B | 16 | 1 | 58.1 · 58.1 | 55.1 · 55.1 | 51.8 · 51.8 | 45.7 · 45.7 | 39.6 · 39.6 | 33.5 · 33.5 | 27.2 · 27.2 |
| system B | 16 | 2 | 55.6 · 55.5 | 52.4 · 52.4 | 48.2 · 48.1 | 42.1 · 42.0 | 36.0 · 35.9 | 29.9 · 29.8 | 23.6 · 23.5 |
| system B | 16 | 4 | 52.2 · 52.1 | 47.9 · 47.7 | 42.4 · 42.2 | 36.3 · 36.2 | 30.3 · 30.1 | 24.1 · 23.9 | 17.8 · 17.6 |
| system B | 16 | 8 | 47.0 · 46.8 | 41.5 · 41.2 | 35.5 · 35.3 | 29.5 · 29.2 | 23.4 · 23.1 | 17.2 · 17.0 | 10.9 · 10.6 |
| system B | 16 | 12 | 43.7 · 43.4 | 37.8 · 37.5 | 31.8 · 31.6 | 25.8 · 25.5 | 19.7 · 19.4 | 13.5 · 13.3 | 7.2 · 7.0 |
| system B | 16 | 16 | 41.9 · 41.5 | 36.0 · 35.6 | 30.0 · 29.6 | 24.0 · 23.5 | 17.9 · 17.4 | 11.7 · 11.3 | 5.4 · 5.0 |
| system B | 16 | 24 | 40.5 · 39.6 | 34.6 · 33.6 | 28.5 · 27.6 | 22.5 · 21.6 | 16.4 · 15.5 | 10.2 · 9.3 | 3.9 · 3.0 |
| system C | 1 | 1 | 60.3 · 60.3 | 57.3 · 57.3 | 54.3 · 54.3 | 50.8 · 50.8 | 46.0 · 45.9 | 39.9 · 39.8 | 33.8 · 33.7 |
| system C | 1 | 2 | 57.2 · 57.2 | 54.2 · 54.1 | 50.7 · 50.6 | 45.7 · 45.7 | 40.0 · 40.0 | 34.0 · 33.9 | 27.9 · 27.8 |
| system C | 1 | 4 | 53.1 · 53.0 | 49.1 · 49.0 | 43.9 · 43.7 | 38.0 · 37.9 | 32.1 · 31.9 | 26.0 · 25.9 | 19.9 · 19.8 |
| system C | 1 | 8 | 47.5 · 47.2 | 42.0 · 41.6 | 36.1 · 35.7 | 30.1 · 29.7 | 24.1 · 23.7 | 18.1 · 17.6 | 12.0 · 11.5 |
| system C | 1 | 12 | 44.5 · 43.8 | 38.7 · 38.0 | 32.7 · 32.0 | 26.7 · 26.0 | 20.7 · 20.0 | 14.6 · 13.9 | 8.5 · 7.8 |
| system C | 1 | 16 | 43.3 · 42.4 | 37.5 · 36.6 | 31.5 · 30.6 | 25.5 · 24.5 | 19.4 · 18.5 | 13.4 · 12.5 | 7.3 · 6.4 |
| system C | 1 | 24 | 42.4 · 41.5 | 36.5 · 35.6 | 30.5 · 29.6 | 24.5 · 23.6 | 18.5 · 17.5 | 12.4 · 11.5 | 6.3 · 5.4 |
| system C | 16 | 1 | 60.3 · 60.3 | 57.3 · 57.3 | 54.3 · 54.2 | 50.9 · 50.8 | 46.0 · 45.9 | 39.9 · 39.8 | 33.8 · 33.7 |
| system C | 16 | 2 | 56.9 · 56.9 | 53.9 · 53.9 | 50.3 · 50.3 | 45.3 · 45.2 | 39.6 · 39.5 | 33.5 · 33.4 | 27.4 · 27.3 |
| system C | 16 | 4 | 53.1 · 53.0 | 49.1 · 49.0 | 43.8 · 43.7 | 38.0 · 37.9 | 32.0 · 31.9 | 25.9 · 25.8 | 19.8 · 19.7 |
| system C | 16 | 8 | 47.6 · 47.2 | 42.1 · 41.6 | 36.3 · 35.7 | 30.3 · 29.7 | 24.2 · 23.7 | 18.2 · 17.6 | 12.1 · 11.5 |
| system C | 16 | 12 | 44.6 · 43.8 | 38.8 · 38.0 | 32.9 · 32.0 | 26.9 · 26.0 | 20.8 · 20.0 | 14.8 · 13.9 | 8.7 · 7.9 |
| system C | 16 | 16 | 43.3 · 42.4 | 37.5 · 36.6 | 31.5 · 30.6 | 25.5 · 24.6 | 19.4 · 18.5 | 13.4 · 12.5 | 7.3 · 6.4 |
| system C | 16 | 24 | 42.2 · 41.2 | 36.3 · 35.3 | 30.3 · 29.3 | 24.3 · 23.3 | 18.3 · 17.2 | 12.2 · 11.2 | 6.1 · 5.1 |
| content 2 DBT, 10-bit | 1 | 1 | 58.4 · 58.4 | 55.4 · 55.4 | 52.2 · 52.1 | 46.1 · 46.1 | 40.0 · 40.0 | 33.8 · 33.8 | 27.6 · 27.5 |
| content 2 DBT, 10-bit | 1 | 2 | 55.6 · 55.5 | 52.4 · 52.4 | 48.2 · 48.1 | 42.1 · 42.1 | 36.0 · 36.0 | 29.9 · 29.8 | 23.6 · 23.5 |
| content 2 DBT, 10-bit | 1 | 4 | 52.2 · 52.1 | 47.9 · 47.7 | 42.4 · 42.2 | 36.3 · 36.2 | 30.2 · 30.1 | 24.1 · 23.9 | 17.8 · 17.6 |
| content 2 DBT, 10-bit | 1 | 8 | 47.1 · 47.1 | 41.5 · 41.5 | 35.6 · 35.6 | 29.6 · 29.5 | 23.5 · 23.4 | 17.3 · 17.3 | 11.0 · 10.9 |
| content 2 DBT, 10-bit | 1 | 12 | 44.2 · 44.1 | 38.4 · 38.3 | 32.5 · 32.3 | 26.4 · 26.3 | 20.3 · 20.2 | 14.2 · 14.0 | 7.8 · 7.7 |
| content 2 DBT, 10-bit | 1 | 16 | 42.5 · 42.3 | 36.6 · 36.4 | 30.6 · 30.4 | 24.5 · 24.3 | 18.4 · 18.2 | 12.3 · 12.1 | 6.0 · 5.8 |
| content 2 DBT, 10-bit | 1 | 24 | 40.5 · 40.3 | 34.6 · 34.3 | 28.6 · 28.3 | 22.5 · 22.3 | 16.4 · 16.2 | 10.3 · 10.0 | 4.0 · 3.7 |
| content 2 DBT, 10-bit | 16 | 1 | 58.2 · 58.1 | 55.2 · 55.0 | 51.9 · 51.8 | 45.9 · 45.7 | 39.8 · 39.6 | 33.6 · 33.5 | 27.3 · 27.2 |
| content 2 DBT, 10-bit | 16 | 2 | 55.6 · 55.5 | 52.5 · 52.4 | 48.2 · 48.1 | 42.1 · 42.0 | 36.0 · 35.9 | 29.9 · 29.8 | 23.6 · 23.5 |
| content 2 DBT, 10-bit | 16 | 4 | 52.2 · 52.2 | 47.8 · 47.8 | 42.3 · 42.3 | 36.3 · 36.2 | 30.2 · 30.1 | 24.0 · 23.9 | 17.7 · 17.6 |
| content 2 DBT, 10-bit | 16 | 8 | 47.2 · 47.1 | 41.7 · 41.5 | 35.8 · 35.6 | 29.7 · 29.5 | 23.6 · 23.4 | 17.5 · 17.3 | 11.2 · 11.0 |
| content 2 DBT, 10-bit | 16 | 12 | 44.3 · 44.1 | 38.5 · 38.3 | 32.6 · 32.3 | 26.5 · 26.3 | 20.4 · 20.2 | 14.3 · 14.0 | 7.9 · 7.7 |
| content 2 DBT, 10-bit | 16 | 16 | 42.6 · 42.3 | 36.7 · 36.4 | 30.7 · 30.4 | 24.6 · 24.3 | 18.5 · 18.3 | 12.4 · 12.1 | 6.1 · 5.8 |
| content 2 DBT, 10-bit | 16 | 24 | 40.5 · 40.1 | 34.6 · 34.2 | 28.5 · 28.2 | 22.5 · 22.1 | 16.4 · 16.0 | 10.2 · 9.9 | 3.9 · 3.6 |
| content 2 DBT, 12-bit | 1 | 1 | 60.3 · 60.3 | 57.3 · 57.3 | 54.3 · 54.3 | 50.8 · 50.8 | 45.9 · 45.9 | 39.9 · 39.9 | 33.8 · 33.8 |
| content 2 DBT, 12-bit | 1 | 2 | 57.2 · 57.2 | 54.1 · 54.1 | 50.6 · 50.6 | 45.7 · 45.7 | 40.0 · 40.0 | 33.9 · 33.9 | 27.9 · 27.8 |
| content 2 DBT, 12-bit | 1 | 4 | 53.1 · 53.1 | 49.1 · 49.1 | 43.9 · 43.8 | 38.0 · 38.0 | 32.1 · 32.0 | 26.0 · 25.9 | 19.9 · 19.8 |
| content 2 DBT, 12-bit | 1 | 8 | 47.6 · 47.3 | 42.1 · 41.7 | 36.2 · 35.8 | 30.2 · 29.8 | 24.2 · 23.8 | 18.1 · 17.7 | 12.0 · 11.6 |
| content 2 DBT, 12-bit | 1 | 12 | 44.8 · 44.2 | 39.0 · 38.4 | 33.1 · 32.4 | 27.0 · 26.4 | 21.0 · 20.4 | 15.0 · 14.3 | 8.9 · 8.2 |
| content 2 DBT, 12-bit | 1 | 16 | 43.5 · 43.1 | 37.7 · 37.2 | 31.7 · 31.2 | 25.7 · 25.2 | 19.7 · 19.2 | 13.6 · 13.1 | 7.5 · 7.0 |
| content 2 DBT, 12-bit | 1 | 24 | 42.5 · 42.2 | 36.7 · 36.3 | 30.7 · 30.3 | 24.7 · 24.3 | 18.6 · 18.2 | 12.6 · 12.2 | 6.5 · 6.1 |
| content 2 DBT, 12-bit | 16 | 1 | 60.3 · 60.3 | 57.3 · 57.3 | 54.3 · 54.3 | 50.8 · 50.8 | 46.0 · 45.9 | 39.9 · 39.9 | 33.8 · 33.8 |
| content 2 DBT, 12-bit | 16 | 2 | 57.0 · 56.9 | 54.0 · 53.9 | 50.5 · 50.3 | 45.5 · 45.2 | 39.8 · 39.5 | 33.7 · 33.4 | 27.6 · 27.3 |
| content 2 DBT, 12-bit | 16 | 4 | 53.1 · 53.0 | 49.1 · 49.0 | 43.9 · 43.7 | 38.0 · 37.9 | 32.1 · 31.9 | 26.0 · 25.9 | 19.9 · 19.8 |
| content 2 DBT, 12-bit | 16 | 8 | 47.7 · 47.3 | 42.2 · 41.7 | 36.3 · 35.8 | 30.3 · 29.8 | 24.3 · 23.8 | 18.2 · 17.8 | 12.1 · 11.7 |
| content 2 DBT, 12-bit | 16 | 12 | 44.8 · 44.2 | 39.1 · 38.4 | 33.1 · 32.4 | 27.1 · 26.4 | 21.1 · 20.4 | 15.0 · 14.3 | 8.9 · 8.2 |
| content 2 DBT, 12-bit | 16 | 16 | 43.5 · 43.1 | 37.7 · 37.2 | 31.7 · 31.2 | 25.7 · 25.2 | 19.7 · 19.2 | 13.6 · 13.1 | 7.5 · 7.0 |
| content 2 DBT, 12-bit | 16 | 24 | 42.3 · 41.9 | 36.4 · 36.0 | 30.4 · 30.1 | 24.4 · 24.0 | 18.4 · 18.0 | 12.3 · 11.9 | 6.2 · 5.9 |
| TRUS | 1 | 1 | 56.1 · 55.8 | 50.1 · 49.8 | 44.0 · 43.7 | 37.8 · 37.5 | 31.5 · 31.2 | 24.9 · 24.6 | 17.6 · 17.2 |
| TRUS | 1 | 2 | 53.2 · 53.1 | 47.2 · 47.0 | 41.1 · 40.9 | 34.9 · 34.8 | 28.6 · 28.5 | 22.0 · 21.9 | 14.6 · 14.5 |
| TRUS | 1 | 4 | 49.8 · 49.6 | 43.8 · 43.6 | 37.7 · 37.5 | 31.5 · 31.3 | 25.2 · 25.0 | 18.6 · 18.4 | 11.2 · 11.0 |
| TRUS | 1 | 8 | 45.7 · 45.5 | 39.7 · 39.4 | 33.6 · 33.3 | 27.4 · 27.2 | 21.1 · 20.9 | 14.5 · 14.2 | 7.1 · 6.9 |
| TRUS | 1 | 12 | 43.2 · 42.6 | 37.2 · 36.6 | 31.1 · 30.5 | 24.9 · 24.3 | 18.6 · 18.0 | 12.0 · 11.4 | 4.6 · 4.0 |
| TRUS | 1 | 16 | 41.6 · 40.7 | 35.5 · 34.7 | 29.4 · 28.6 | 23.3 · 22.4 | 17.0 · 16.1 | 10.4 · 9.5 | 3.0 · 2.1 |
| TRUS | 1 | 24 | 39.4 · 38.0 | 33.4 · 32.0 | 27.3 · 25.9 | 21.1 · 19.7 | 14.8 · 13.4 | 8.2 · 6.8 | 0.9 · -0.6 |
| TRUS | 16 | 1 | 55.4 · 55.0 | 49.3 · 48.9 | 43.2 · 42.8 | 37.1 · 36.7 | 30.8 · 30.4 | 24.2 · 23.7 | 16.8 · 16.4 |
| TRUS | 16 | 2 | 52.9 · 52.6 | 46.8 · 46.5 | 40.7 · 40.4 | 34.5 · 34.3 | 28.2 · 28.0 | 21.6 · 21.4 | 14.3 · 14.0 |
| TRUS | 16 | 4 | 49.5 · 49.4 | 43.5 · 43.3 | 37.4 · 37.2 | 31.2 · 31.1 | 24.9 · 24.8 | 18.3 · 18.1 | 10.9 · 10.8 |
| TRUS | 16 | 8 | 45.6 · 45.3 | 39.5 · 39.2 | 33.4 · 33.1 | 27.3 · 27.0 | 21.0 · 20.7 | 14.3 · 14.1 | 7.0 · 6.7 |
| TRUS | 16 | 12 | 43.1 · 42.5 | 37.1 · 36.4 | 31.0 · 30.3 | 24.8 · 24.2 | 18.5 · 17.9 | 11.9 · 11.3 | 4.5 · 3.9 |
| TRUS | 16 | 16 | 41.5 · 40.6 | 35.5 · 34.6 | 29.4 · 28.5 | 23.2 · 22.3 | 16.9 · 16.0 | 10.3 · 9.4 | 3.0 · 2.0 |
| TRUS | 16 | 24 | 39.4 · 37.8 | 33.3 · 31.8 | 27.2 · 25.7 | 21.1 · 19.5 | 14.8 · 13.2 | 8.2 · 6.6 | 0.8 · -0.7 |

**Share moving ≥ 1 level**: median series' median frame · worst series' worst frame

| family | G | Q | W 4096 | W 2048 | W 1024 | W 512 | W 256 | W 128 | W 64 |
| --- | --: | --: | --- | --- | --- | --- | --- | --- | --- |
| system A | 1 | 1 | 6.1 % · 6.1 % | 12.1 % · 12.2 % | 24.2 % · 24.3 % | 46.0 % · 46.1 % | 69.0 % · 69.1 % | 69.0 % · 69.1 % | 69.0 % · 69.1 % |
| system A | 1 | 2 | 12.5 % · 12.5 % | 25.0 % · 25.1 % | 47.1 % · 47.2 % | 69.8 % · 69.9 % | 84.4 % · 84.4 % | 84.4 % · 84.4 % | 84.4 % · 84.4 % |
| system A | 1 | 4 | 31.8 % · 31.9 % | 55.7 % · 55.9 % | 75.9 % · 76.0 % | 87.6 % · 87.7 % | 93.8 % · 93.8 % | 93.8 % · 93.8 % | 93.8 % · 93.8 % |
| system A | 1 | 8 | 62.3 % · 64.2 % | 79.9 % · 81.1 % | 89.8 % · 90.4 % | 94.9 % · 95.2 % | 97.4 % · 97.6 % | 97.4 % · 97.6 % | 97.4 % · 97.6 % |
| system A | 1 | 12 | 71.9 % · 74.4 % | 85.5 % · 86.9 % | 92.7 % · 93.4 % | 96.3 % · 96.7 % | 98.2 % · 98.3 % | 98.2 % · 98.3 % | 98.2 % · 98.3 % |
| system A | 1 | 16 | 75.1 % · 77.1 % | 87.2 % · 88.3 % | 93.6 % · 94.1 % | 96.8 % · 97.1 % | 98.4 % · 98.5 % | 98.4 % · 98.5 % | 98.4 % · 98.5 % |
| system A | 1 | 24 | 77.4 % · 78.9 % | 88.5 % · 89.2 % | 94.2 % · 94.6 % | 97.1 % · 97.3 % | 98.6 % · 98.7 % | 98.6 % · 98.7 % | 98.6 % · 98.7 % |
| system A | 16 | 1 | 6.0 % · 6.1 % | 12.1 % · 12.2 % | 24.1 % · 24.3 % | 45.8 % · 46.1 % | 68.9 % · 69.1 % | 68.9 % · 69.1 % | 68.9 % · 69.1 % |
| system A | 16 | 2 | 13.3 % · 13.3 % | 26.5 % · 26.6 % | 49.2 % · 49.4 % | 71.4 % · 71.5 % | 85.2 % · 85.3 % | 85.2 % · 85.3 % | 85.2 % · 85.3 % |
| system A | 16 | 4 | 31.8 % · 32.0 % | 55.8 % · 56.1 % | 75.9 % · 76.1 % | 87.7 % · 87.8 % | 93.8 % · 93.9 % | 93.8 % · 93.9 % | 93.8 % · 93.9 % |
| system A | 16 | 8 | 61.9 % · 64.1 % | 79.7 % · 81.0 % | 89.7 % · 90.4 % | 94.8 % · 95.2 % | 97.4 % · 97.6 % | 97.4 % · 97.6 % | 97.4 % · 97.6 % |
| system A | 16 | 12 | 71.7 % · 74.4 % | 85.4 % · 86.8 % | 92.6 % · 93.4 % | 96.3 % · 96.7 % | 98.2 % · 98.3 % | 98.2 % · 98.3 % | 98.2 % · 98.3 % |
| system A | 16 | 16 | 75.1 % · 77.2 % | 87.2 % · 88.4 % | 93.6 % · 94.2 % | 96.8 % · 97.1 % | 98.4 % · 98.5 % | 98.4 % · 98.5 % | 98.4 % · 98.5 % |
| system A | 16 | 24 | 78.0 % · 79.5 % | 88.8 % · 89.6 % | 94.4 % · 94.8 % | 97.2 % · 97.4 % | 98.6 % · 98.7 % | 98.6 % · 98.7 % | 98.6 % · 98.7 % |
| system B | 1 | 1 | 9.4 % · 9.4 % | 18.8 % · 18.9 % | 36.9 % · 37.0 % | 36.9 % · 37.0 % | 36.9 % · 37.0 % | 36.9 % · 37.0 % | 36.9 % · 37.0 % |
| system B | 1 | 2 | 18.0 % · 18.2 % | 35.5 % · 35.9 % | 59.8 % · 60.2 % | 59.8 % · 60.2 % | 59.8 % · 60.2 % | 59.8 % · 60.2 % | 59.8 % · 60.2 % |
| system B | 1 | 4 | 36.7 % · 37.8 % | 60.9 % · 62.0 % | 79.2 % · 79.8 % | 79.2 % · 79.8 % | 79.2 % · 79.8 % | 79.2 % · 79.8 % | 79.2 % · 79.8 % |
| system B | 1 | 8 | 65.5 % · 65.9 % | 81.9 % · 82.1 % | 90.8 % · 91.0 % | 90.8 % · 91.0 % | 90.8 % · 91.0 % | 90.8 % · 91.0 % | 90.8 % · 91.0 % |
| system B | 1 | 12 | 76.5 % · 76.9 % | 88.0 % · 88.2 % | 94.0 % · 94.1 % | 94.0 % · 94.1 % | 94.0 % · 94.1 % | 94.0 % · 94.1 % | 94.0 % · 94.1 % |
| system B | 1 | 16 | 80.7 % · 81.4 % | 90.2 % · 90.6 % | 95.1 % · 95.3 % | 95.1 % · 95.3 % | 95.1 % · 95.3 % | 95.1 % · 95.3 % | 95.1 % · 95.3 % |
| system B | 1 | 24 | 83.4 % · 84.8 % | 91.6 % · 92.4 % | 95.8 % · 96.2 % | 95.8 % · 96.2 % | 95.8 % · 96.2 % | 95.8 % · 96.2 % | 95.8 % · 96.2 % |
| system B | 16 | 1 | 10.1 % · 10.1 % | 20.2 % · 20.3 % | 39.4 % · 39.5 % | 39.4 % · 39.5 % | 39.4 % · 39.5 % | 39.4 % · 39.5 % | 39.4 % · 39.5 % |
| system B | 16 | 2 | 18.0 % · 18.2 % | 35.7 % · 36.0 % | 59.9 % · 60.3 % | 59.9 % · 60.3 % | 59.9 % · 60.3 % | 59.9 % · 60.3 % | 59.9 % · 60.3 % |
| system B | 16 | 4 | 37.0 % · 37.8 % | 61.2 % · 62.0 % | 79.4 % · 79.8 % | 79.4 % · 79.8 % | 79.4 % · 79.8 % | 79.4 % · 79.8 % | 79.4 % · 79.8 % |
| system B | 16 | 8 | 64.8 % · 65.8 % | 81.5 % · 82.1 % | 90.6 % · 90.9 % | 90.6 % · 90.9 % | 90.6 % · 90.9 % | 90.6 % · 90.9 % | 90.6 % · 90.9 % |
| system B | 16 | 12 | 76.1 % · 76.9 % | 87.8 % · 88.2 % | 93.9 % · 94.1 % | 93.9 % · 94.1 % | 93.9 % · 94.1 % | 93.9 % · 94.1 % | 93.9 % · 94.1 % |
| system B | 16 | 16 | 80.5 % · 81.4 % | 90.1 % · 90.6 % | 95.0 % · 95.3 % | 95.0 % · 95.3 % | 95.0 % · 95.3 % | 95.0 % · 95.3 % | 95.0 % · 95.3 % |
| system B | 16 | 24 | 83.4 % · 85.1 % | 91.6 % · 92.5 % | 95.8 % · 96.2 % | 95.8 % · 96.2 % | 95.8 % · 96.2 % | 95.8 % · 96.2 % | 95.8 % · 96.2 % |
| system C | 1 | 1 | 6.0 % · 6.1 % | 12.1 % · 12.2 % | 24.2 % · 24.4 % | 45.9 % · 46.2 % | 68.9 % · 69.2 % | 68.9 % · 69.2 % | 68.9 % · 69.2 % |
| system C | 1 | 2 | 12.5 % · 12.5 % | 24.9 % · 25.0 % | 47.0 % · 47.1 % | 69.7 % · 69.8 % | 84.3 % · 84.4 % | 84.3 % · 84.4 % | 84.3 % · 84.4 % |
| system C | 1 | 4 | 31.4 % · 31.9 % | 55.3 % · 55.9 % | 75.6 % · 76.0 % | 87.5 % · 87.7 % | 93.7 % · 93.8 % | 93.7 % · 93.8 % | 93.7 % · 93.8 % |
| system C | 1 | 8 | 62.8 % · 64.4 % | 80.3 % · 81.2 % | 90.0 % · 90.5 % | 95.0 % · 95.2 % | 97.5 % · 97.6 % | 97.5 % · 97.6 % | 97.5 % · 97.6 % |
| system C | 1 | 12 | 73.8 % · 75.7 % | 86.5 % · 87.6 % | 93.2 % · 93.7 % | 96.6 % · 96.9 % | 98.3 % · 98.4 % | 98.3 % · 98.4 % | 98.3 % · 98.4 % |
| system C | 1 | 16 | 77.1 % · 79.3 % | 88.3 % · 89.5 % | 94.1 % · 94.7 % | 97.1 % · 97.4 % | 98.5 % · 98.7 % | 98.5 % · 98.7 % | 98.5 % · 98.7 % |
| system C | 1 | 24 | 79.4 % · 81.4 % | 89.5 % · 90.6 % | 94.8 % · 95.3 % | 97.4 % · 97.6 % | 98.7 % · 98.8 % | 98.7 % · 98.8 % | 98.7 % · 98.8 % |
| system C | 16 | 1 | 6.0 % · 6.1 % | 12.0 % · 12.2 % | 24.1 % · 24.4 % | 45.7 % · 46.2 % | 68.8 % · 69.2 % | 68.8 % · 69.2 % | 68.8 % · 69.2 % |
| system C | 16 | 2 | 13.2 % · 13.3 % | 26.3 % · 26.6 % | 49.0 % · 49.3 % | 71.2 % · 71.4 % | 85.1 % · 85.3 % | 85.1 % · 85.3 % | 85.1 % · 85.3 % |
| system C | 16 | 4 | 31.7 % · 32.0 % | 55.6 % · 56.0 % | 75.8 % · 76.0 % | 87.6 % · 87.7 % | 93.8 % · 93.9 % | 93.8 % · 93.9 % | 93.8 % · 93.9 % |
| system C | 16 | 8 | 62.3 % · 64.4 % | 80.0 % · 81.2 % | 89.8 % · 90.5 % | 94.9 % · 95.2 % | 97.5 % · 97.6 % | 97.5 % · 97.6 % | 97.5 % · 97.6 % |
| system C | 16 | 12 | 73.4 % · 75.7 % | 86.3 % · 87.5 % | 93.1 % · 93.7 % | 96.5 % · 96.9 % | 98.3 % · 98.4 % | 98.3 % · 98.4 % | 98.3 % · 98.4 % |
| system C | 16 | 16 | 77.1 % · 79.3 % | 88.3 % · 89.5 % | 94.1 % · 94.7 % | 97.1 % · 97.4 % | 98.5 % · 98.7 % | 98.5 % · 98.7 % | 98.5 % · 98.7 % |
| system C | 16 | 24 | 79.9 % · 82.0 % | 89.8 % · 90.9 % | 94.9 % · 95.4 % | 97.4 % · 97.7 % | 98.7 % · 98.9 % | 98.7 % · 98.9 % | 98.7 % · 98.9 % |
| content 2 DBT, 10-bit | 1 | 1 | 9.4 % · 9.5 % | 18.9 % · 18.9 % | 37.0 % · 37.1 % | 37.0 % · 37.1 % | 37.0 % · 37.1 % | 37.0 % · 37.1 % | 37.0 % · 37.1 % |
| content 2 DBT, 10-bit | 1 | 2 | 18.0 % · 18.1 % | 35.6 % · 35.8 % | 59.9 % · 60.1 % | 59.9 % · 60.1 % | 59.9 % · 60.1 % | 59.9 % · 60.1 % | 59.9 % · 60.1 % |
| content 2 DBT, 10-bit | 1 | 4 | 37.1 % · 37.7 % | 61.3 % · 61.9 % | 79.4 % · 79.7 % | 79.4 % · 79.7 % | 79.4 % · 79.7 % | 79.4 % · 79.7 % | 79.4 % · 79.7 % |
| content 2 DBT, 10-bit | 1 | 8 | 64.6 % · 64.8 % | 81.3 % · 81.4 % | 90.6 % · 90.6 % | 90.6 % · 90.6 % | 90.6 % · 90.6 % | 90.6 % · 90.6 % | 90.6 % · 90.6 % |
| content 2 DBT, 10-bit | 1 | 12 | 74.5 % · 74.8 % | 86.9 % · 87.1 % | 93.4 % · 93.5 % | 93.4 % · 93.5 % | 93.4 % · 93.5 % | 93.4 % · 93.5 % | 93.4 % · 93.5 % |
| content 2 DBT, 10-bit | 1 | 16 | 79.2 % · 79.7 % | 89.4 % · 89.7 % | 94.7 % · 94.8 % | 94.7 % · 94.8 % | 94.7 % · 94.8 % | 94.7 % · 94.8 % | 94.7 % · 94.8 % |
| content 2 DBT, 10-bit | 1 | 24 | 83.4 % · 83.8 % | 91.6 % · 91.8 % | 95.8 % · 95.9 % | 95.8 % · 95.9 % | 95.8 % · 95.9 % | 95.8 % · 95.9 % | 95.8 % · 95.9 % |
| content 2 DBT, 10-bit | 16 | 1 | 9.9 % · 10.2 % | 19.7 % · 20.3 % | 38.5 % · 39.5 % | 38.5 % · 39.5 % | 38.5 % · 39.5 % | 38.5 % · 39.5 % | 38.5 % · 39.5 % |
| content 2 DBT, 10-bit | 16 | 2 | 18.0 % · 18.3 % | 35.6 % · 36.1 % | 59.9 % · 60.4 % | 59.9 % · 60.4 % | 59.9 % · 60.4 % | 59.9 % · 60.4 % | 59.9 % · 60.4 % |
| content 2 DBT, 10-bit | 16 | 4 | 37.3 % · 37.6 % | 61.5 % · 61.8 % | 79.5 % · 79.7 % | 79.5 % · 79.7 % | 79.5 % · 79.7 % | 79.5 % · 79.7 % | 79.5 % · 79.7 % |
| content 2 DBT, 10-bit | 16 | 8 | 64.0 % · 64.8 % | 81.0 % · 81.4 % | 90.4 % · 90.6 % | 90.4 % · 90.6 % | 90.4 % · 90.6 % | 90.4 % · 90.6 % | 90.4 % · 90.6 % |
| content 2 DBT, 10-bit | 16 | 12 | 74.2 % · 74.8 % | 86.8 % · 87.1 % | 93.4 % · 93.5 % | 93.4 % · 93.5 % | 93.4 % · 93.5 % | 93.4 % · 93.5 % | 93.4 % · 93.5 % |
| content 2 DBT, 10-bit | 16 | 16 | 79.0 % · 79.6 % | 89.3 % · 89.7 % | 94.6 % · 94.8 % | 94.6 % · 94.8 % | 94.6 % · 94.8 % | 94.6 % · 94.8 % | 94.6 % · 94.8 % |
| content 2 DBT, 10-bit | 16 | 24 | 83.4 % · 84.1 % | 91.6 % · 92.0 % | 95.8 % · 96.0 % | 95.8 % · 96.0 % | 95.8 % · 96.0 % | 95.8 % · 96.0 % | 95.8 % · 96.0 % |
| content 2 DBT, 12-bit | 1 | 1 | 6.1 % · 6.1 % | 12.1 % · 12.2 % | 24.3 % · 24.3 % | 46.0 % · 46.1 % | 69.0 % · 69.1 % | 69.0 % · 69.1 % | 69.0 % · 69.1 % |
| content 2 DBT, 12-bit | 1 | 2 | 12.5 % · 12.5 % | 25.0 % · 25.1 % | 47.1 % · 47.2 % | 69.8 % · 69.8 % | 84.3 % · 84.4 % | 84.3 % · 84.4 % | 84.3 % · 84.4 % |
| content 2 DBT, 12-bit | 1 | 4 | 31.4 % · 31.7 % | 55.3 % · 55.6 % | 75.6 % · 75.8 % | 87.5 % · 87.6 % | 93.7 % · 93.8 % | 93.7 % · 93.8 % | 93.7 % · 93.8 % |
| content 2 DBT, 12-bit | 1 | 8 | 62.6 % · 64.0 % | 80.1 % · 80.9 % | 89.9 % · 90.3 % | 94.9 % · 95.2 % | 97.5 % · 97.6 % | 97.5 % · 97.6 % | 97.5 % · 97.6 % |
| content 2 DBT, 12-bit | 1 | 12 | 72.9 % · 74.7 % | 86.0 % · 87.0 % | 93.0 % · 93.5 % | 96.5 % · 96.7 % | 98.2 % · 98.4 % | 98.2 % · 98.4 % | 98.2 % · 98.4 % |
| content 2 DBT, 12-bit | 1 | 16 | 76.5 % · 77.7 % | 88.0 % · 88.6 % | 93.9 % · 94.3 % | 97.0 % · 97.1 % | 98.5 % · 98.6 % | 98.5 % · 98.6 % | 98.5 % · 98.6 % |
| content 2 DBT, 12-bit | 1 | 24 | 79.0 % · 79.9 % | 89.3 % · 89.8 % | 94.6 % · 94.9 % | 97.3 % · 97.4 % | 98.7 % · 98.7 % | 98.7 % · 98.7 % | 98.7 % · 98.7 % |
| content 2 DBT, 12-bit | 16 | 1 | 6.0 % · 6.1 % | 12.1 % · 12.2 % | 24.2 % · 24.3 % | 45.9 % · 46.1 % | 68.9 % · 69.1 % | 68.9 % · 69.1 % | 68.9 % · 69.1 % |
| content 2 DBT, 12-bit | 16 | 2 | 12.9 % · 13.3 % | 25.7 % · 26.5 % | 48.1 % · 49.2 % | 70.5 % · 71.4 % | 84.8 % · 85.2 % | 84.8 % · 85.2 % | 84.8 % · 85.2 % |
| content 2 DBT, 12-bit | 16 | 4 | 31.4 % · 31.9 % | 55.3 % · 55.9 % | 75.6 % · 75.9 % | 87.5 % · 87.7 % | 93.7 % · 93.8 % | 93.7 % · 93.8 % | 93.7 % · 93.8 % |
| content 2 DBT, 12-bit | 16 | 8 | 62.2 % · 63.9 % | 79.9 % · 80.9 % | 89.8 % · 90.3 % | 94.9 % · 95.1 % | 97.4 % · 97.6 % | 97.4 % · 97.6 % | 97.4 % · 97.6 % |
| content 2 DBT, 12-bit | 16 | 12 | 72.7 % · 74.6 % | 85.9 % · 87.0 % | 92.9 % · 93.4 % | 96.4 % · 96.7 % | 98.2 % · 98.4 % | 98.2 % · 98.4 % | 98.2 % · 98.4 % |
| content 2 DBT, 12-bit | 16 | 16 | 76.5 % · 77.7 % | 88.0 % · 88.6 % | 94.0 % · 94.3 % | 97.0 % · 97.1 % | 98.5 % · 98.6 % | 98.5 % · 98.6 % | 98.5 % · 98.6 % |
| content 2 DBT, 12-bit | 16 | 24 | 79.6 % · 80.4 % | 89.6 % · 90.1 % | 94.8 % · 95.0 % | 97.4 % · 97.5 % | 98.7 % · 98.8 % | 98.7 % · 98.8 % | 98.7 % · 98.8 % |
| TRUS | 1 | 1 | 15.7 % · 17.0 % | 15.7 % · 17.0 % | 15.7 % · 17.0 % | 15.7 % · 17.0 % | 15.7 % · 17.0 % | 15.7 % · 17.0 % | 15.7 % · 17.0 % |
| TRUS | 1 | 2 | 30.1 % · 30.8 % | 30.1 % · 30.8 % | 30.1 % · 30.8 % | 30.1 % · 30.8 % | 30.1 % · 30.8 % | 30.1 % · 30.8 % | 30.1 % · 30.8 % |
| TRUS | 1 | 4 | 51.5 % · 52.7 % | 51.5 % · 52.7 % | 51.5 % · 52.7 % | 51.5 % · 52.7 % | 51.5 % · 52.7 % | 51.5 % · 52.7 % | 51.5 % · 52.7 % |
| TRUS | 1 | 8 | 69.8 % · 70.6 % | 69.8 % · 70.6 % | 69.8 % · 70.6 % | 69.8 % · 70.6 % | 69.8 % · 70.6 % | 69.8 % · 70.6 % | 69.8 % · 70.6 % |
| TRUS | 1 | 12 | 77.4 % · 78.8 % | 77.4 % · 78.8 % | 77.4 % · 78.8 % | 77.4 % · 78.8 % | 77.4 % · 78.8 % | 77.4 % · 78.8 % | 77.4 % · 78.8 % |
| TRUS | 1 | 16 | 81.2 % · 83.0 % | 81.2 % · 83.0 % | 81.2 % · 83.0 % | 81.2 % · 83.0 % | 81.2 % · 83.0 % | 81.2 % · 83.0 % | 81.2 % · 83.0 % |
| TRUS | 1 | 24 | 85.3 % · 87.5 % | 85.3 % · 87.5 % | 85.3 % · 87.5 % | 85.3 % · 87.5 % | 85.3 % · 87.5 % | 85.3 % · 87.5 % | 85.3 % · 87.5 % |
| TRUS | 16 | 1 | 18.7 % · 20.5 % | 18.7 % · 20.5 % | 18.7 % · 20.5 % | 18.7 % · 20.5 % | 18.7 % · 20.5 % | 18.7 % · 20.5 % | 18.7 % · 20.5 % |
| TRUS | 16 | 2 | 32.4 % · 34.1 % | 32.4 % · 34.1 % | 32.4 % · 34.1 % | 32.4 % · 34.1 % | 32.4 % · 34.1 % | 32.4 % · 34.1 % | 32.4 % · 34.1 % |
| TRUS | 16 | 4 | 53.1 % · 53.9 % | 53.1 % · 53.9 % | 53.1 % · 53.9 % | 53.1 % · 53.9 % | 53.1 % · 53.9 % | 53.1 % · 53.9 % | 53.1 % · 53.9 % |
| TRUS | 16 | 8 | 70.3 % · 71.3 % | 70.3 % · 71.3 % | 70.3 % · 71.3 % | 70.3 % · 71.3 % | 70.3 % · 71.3 % | 70.3 % · 71.3 % | 70.3 % · 71.3 % |
| TRUS | 16 | 12 | 77.6 % · 79.2 % | 77.6 % · 79.2 % | 77.6 % · 79.2 % | 77.6 % · 79.2 % | 77.6 % · 79.2 % | 77.6 % · 79.2 % | 77.6 % · 79.2 % |
| TRUS | 16 | 16 | 81.3 % · 83.2 % | 81.3 % · 83.2 % | 81.3 % · 83.2 % | 81.3 % · 83.2 % | 81.3 % · 83.2 % | 81.3 % · 83.2 % | 81.3 % · 83.2 % |
| TRUS | 16 | 24 | 85.4 % · 87.8 % | 85.4 % · 87.8 % | 85.4 % · 87.8 % | 85.4 % · 87.8 % | 85.4 % · 87.8 % | 85.4 % · 87.8 % | 85.4 % · 87.8 % |

**Share moving ≥ 2 levels**: median series' median frame · worst series' worst frame

| family | G | Q | W 4096 | W 2048 | W 1024 | W 512 | W 256 | W 128 | W 64 |
| --- | --: | --: | --- | --- | --- | --- | --- | --- | --- |
| system A | 1 | 1 | < 0.1 % · < 0.1 % | < 0.1 % · < 0.1 % | < 0.1 % · < 0.1 % | 2.6 % · 2.6 % | 23.1 % · 23.3 % | 69.0 % · 69.1 % | 69.0 % · 69.1 % |
| system A | 1 | 2 | < 0.1 % · < 0.1 % | < 0.1 % · < 0.1 % | 2.9 % · 3.0 % | 24.5 % · 24.6 % | 55.4 % · 55.5 % | 84.4 % · 84.4 % | 84.4 % · 84.4 % |
| system A | 1 | 4 | 0.2 % · 0.2 % | 7.8 % · 7.9 % | 35.7 % · 35.9 % | 64.1 % · 64.3 % | 81.6 % · 81.7 % | 93.8 % · 93.8 % | 93.8 % · 93.8 % |
| system A | 1 | 8 | 14.0 % · 16.3 % | 44.6 % · 47.3 % | 70.1 % · 71.8 % | 84.8 % · 85.6 % | 92.4 % · 92.8 % | 97.4 % · 97.6 % | 97.4 % · 97.6 % |
| system A | 1 | 12 | 28.1 % · 32.7 % | 58.3 % · 62.0 % | 78.3 % · 80.3 % | 89.0 % · 90.1 % | 94.5 % · 95.0 % | 98.2 % · 98.3 % | 98.2 % · 98.3 % |
| system A | 1 | 16 | 34.0 % · 38.2 % | 62.9 % · 65.9 % | 80.9 % · 82.5 % | 90.4 % · 91.2 % | 95.2 % · 95.6 % | 98.4 % · 98.5 % | 98.4 % · 98.5 % |
| system A | 1 | 24 | 39.0 % · 42.1 % | 66.4 % · 68.5 % | 82.8 % · 83.9 % | 91.3 % · 91.9 % | 95.7 % · 96.0 % | 98.6 % · 98.7 % | 98.6 % · 98.7 % |
| system A | 16 | 1 | < 0.1 % · < 0.1 % | < 0.1 % · < 0.1 % | < 0.1 % · < 0.1 % | 2.5 % · 2.6 % | 22.9 % · 23.3 % | 68.9 % · 69.1 % | 68.9 % · 69.1 % |
| system A | 16 | 2 | < 0.1 % · < 0.1 % | < 0.1 % · < 0.1 % | 3.8 % · 3.9 % | 27.1 % · 27.4 % | 57.6 % · 57.8 % | 85.2 % · 85.3 % | 85.2 % · 85.3 % |
| system A | 16 | 4 | 0.2 % · 0.2 % | 7.9 % · 8.0 % | 35.8 % · 36.1 % | 64.2 % · 64.4 % | 81.6 % · 81.7 % | 93.8 % · 93.9 % | 93.8 % · 93.9 % |
| system A | 16 | 8 | 13.5 % · 16.2 % | 44.1 % · 47.2 % | 69.7 % · 71.7 % | 84.6 % · 85.6 % | 92.3 % · 92.8 % | 97.4 % · 97.6 % | 97.4 % · 97.6 % |
| system A | 16 | 12 | 27.6 % · 32.7 % | 58.0 % · 61.9 % | 78.1 % · 80.3 % | 89.0 % · 90.1 % | 94.5 % · 95.0 % | 98.2 % · 98.3 % | 98.2 % · 98.3 % |
| system A | 16 | 16 | 34.0 % · 38.5 % | 62.9 % · 66.1 % | 80.9 % · 82.6 % | 90.4 % · 91.2 % | 95.2 % · 95.6 % | 98.4 % · 98.5 % | 98.4 % · 98.5 % |
| system A | 16 | 24 | 40.2 % · 43.5 % | 67.2 % · 69.4 % | 83.2 % · 84.4 % | 91.6 % · 92.2 % | 95.8 % · 96.1 % | 98.6 % · 98.7 % | 98.6 % · 98.7 % |
| system B | 1 | 1 | < 0.1 % · < 0.1 % | < 0.1 % · < 0.1 % | 0.8 % · 0.9 % | 36.9 % · 37.0 % | 36.9 % · 37.0 % | 36.9 % · 37.0 % | 36.9 % · 37.0 % |
| system B | 1 | 2 | < 0.1 % · < 0.1 % | 0.4 % · 0.5 % | 11.4 % · 11.8 % | 59.8 % · 60.2 % | 59.8 % · 60.2 % | 59.8 % · 60.2 % | 59.8 % · 60.2 % |
| system B | 1 | 4 | 0.5 % · 0.7 % | 12.5 % · 13.7 % | 42.8 % · 44.3 % | 79.2 % · 79.8 % | 79.2 % · 79.8 % | 79.2 % · 79.8 % | 79.2 % · 79.8 % |
| system B | 1 | 8 | 18.0 % · 18.5 % | 49.2 % · 49.7 % | 73.0 % · 73.3 % | 90.8 % · 91.0 % | 90.8 % · 91.0 % | 90.8 % · 91.0 % | 90.8 % · 91.0 % |
| system B | 1 | 12 | 37.0 % · 37.8 % | 65.1 % · 65.6 % | 82.1 % · 82.4 % | 94.0 % · 94.1 % | 94.0 % · 94.1 % | 94.0 % · 94.1 % | 94.0 % · 94.1 % |
| system B | 1 | 16 | 46.4 % · 48.1 % | 71.2 % · 72.3 % | 85.4 % · 85.9 % | 95.1 % · 95.3 % | 95.1 % · 95.3 % | 95.1 % · 95.3 % | 95.1 % · 95.3 % |
| system B | 1 | 24 | 52.9 % · 56.6 % | 75.2 % · 77.3 % | 87.4 % · 88.6 % | 95.8 % · 96.2 % | 95.8 % · 96.2 % | 95.8 % · 96.2 % | 95.8 % · 96.2 % |
| system B | 16 | 1 | < 0.1 % · < 0.1 % | < 0.1 % · < 0.1 % | 1.2 % · 1.2 % | 39.4 % · 39.5 % | 39.4 % · 39.5 % | 39.4 % · 39.5 % | 39.4 % · 39.5 % |
| system B | 16 | 2 | < 0.1 % · < 0.1 % | 0.4 % · 0.5 % | 11.5 % · 11.9 % | 59.9 % · 60.3 % | 59.9 % · 60.3 % | 59.9 % · 60.3 % | 59.9 % · 60.3 % |
| system B | 16 | 4 | 0.6 % · 0.7 % | 12.8 % · 13.7 % | 43.3 % · 44.3 % | 79.4 % · 79.8 % | 79.4 % · 79.8 % | 79.4 % · 79.8 % | 79.4 % · 79.8 % |
| system B | 16 | 8 | 17.1 % · 18.5 % | 48.3 % · 49.7 % | 72.4 % · 73.3 % | 90.6 % · 90.9 % | 90.6 % · 90.9 % | 90.6 % · 90.9 % | 90.6 % · 90.9 % |
| system B | 16 | 12 | 36.3 % · 37.8 % | 64.5 % · 65.6 % | 81.8 % · 82.4 % | 93.9 % · 94.1 % | 93.9 % · 94.1 % | 93.9 % · 94.1 % | 93.9 % · 94.1 % |
| system B | 16 | 16 | 45.9 % · 48.1 % | 70.9 % · 72.3 % | 85.2 % · 85.9 % | 95.0 % · 95.3 % | 95.0 % · 95.3 % | 95.0 % · 95.3 % | 95.0 % · 95.3 % |
| system B | 16 | 24 | 53.1 % · 57.2 % | 75.3 % · 77.7 % | 87.5 % · 88.7 % | 95.8 % · 96.2 % | 95.8 % · 96.2 % | 95.8 % · 96.2 % | 95.8 % · 96.2 % |
| system C | 1 | 1 | < 0.1 % · < 0.1 % | < 0.1 % · < 0.1 % | < 0.1 % · < 0.1 % | 2.5 % · 2.6 % | 23.0 % · 23.4 % | 68.9 % · 69.2 % | 68.9 % · 69.2 % |
| system C | 1 | 2 | < 0.1 % · < 0.1 % | < 0.1 % · < 0.1 % | 2.9 % · 3.0 % | 24.3 % · 24.5 % | 55.3 % · 55.4 % | 84.3 % · 84.4 % | 84.3 % · 84.4 % |
| system C | 1 | 4 | 0.1 % · 0.2 % | 7.5 % · 7.9 % | 35.1 % · 35.9 % | 63.7 % · 64.3 % | 81.3 % · 81.6 % | 93.7 % · 93.8 % | 93.7 % · 93.8 % |
| system C | 1 | 8 | 14.6 % · 16.5 % | 45.3 % · 47.6 % | 70.6 % · 72.0 % | 85.0 % · 85.7 % | 92.5 % · 92.9 % | 97.5 % · 97.6 % | 97.5 % · 97.6 % |
| system C | 1 | 12 | 31.6 % · 35.4 % | 61.1 % · 63.9 % | 79.8 % · 81.4 % | 89.8 % · 90.6 % | 94.9 % · 95.3 % | 98.3 % · 98.4 % | 98.3 % · 98.4 % |
| system C | 1 | 16 | 38.3 % · 43.1 % | 65.9 % · 69.1 % | 82.5 % · 84.2 % | 91.2 % · 92.1 % | 95.6 % · 96.0 % | 98.5 % · 98.7 % | 98.5 % · 98.7 % |
| system C | 1 | 24 | 43.4 % · 48.1 % | 69.3 % · 72.3 % | 84.3 % · 85.9 % | 92.1 % · 92.9 % | 96.1 % · 96.5 % | 98.7 % · 98.8 % | 98.7 % · 98.8 % |
| system C | 16 | 1 | < 0.1 % · < 0.1 % | < 0.1 % · < 0.1 % | < 0.1 % · < 0.1 % | 2.5 % · 2.7 % | 22.8 % · 23.5 % | 68.8 % · 69.2 % | 68.8 % · 69.2 % |
| system C | 16 | 2 | < 0.1 % · < 0.1 % | < 0.1 % · < 0.1 % | 3.7 % · 3.9 % | 26.8 % · 27.2 % | 57.4 % · 57.7 % | 85.1 % · 85.3 % | 85.1 % · 85.3 % |
| system C | 16 | 4 | 0.2 % · 0.2 % | 7.7 % · 8.0 % | 35.5 % · 36.0 % | 64.0 % · 64.4 % | 81.5 % · 81.7 % | 93.8 % · 93.9 % | 93.8 % · 93.9 % |
| system C | 16 | 8 | 14.0 % · 16.5 % | 44.7 % · 47.6 % | 70.2 % · 72.0 % | 84.8 % · 85.7 % | 92.4 % · 92.9 % | 97.5 % · 97.6 % | 97.5 % · 97.6 % |
| system C | 16 | 12 | 30.8 % · 35.3 % | 60.5 % · 63.8 % | 79.5 % · 81.4 % | 89.7 % · 90.6 % | 94.8 % · 95.3 % | 98.3 % · 98.4 % | 98.3 % · 98.4 % |
| system C | 16 | 16 | 38.2 % · 43.1 % | 65.9 % · 69.1 % | 82.5 % · 84.2 % | 91.2 % · 92.1 % | 95.6 % · 96.0 % | 98.5 % · 98.7 % | 98.5 % · 98.7 % |
| system C | 16 | 24 | 44.5 % · 49.5 % | 70.0 % · 73.2 % | 84.7 % · 86.4 % | 92.3 % · 93.2 % | 96.2 % · 96.6 % | 98.7 % · 98.9 % | 98.7 % · 98.9 % |
| content 2 DBT, 10-bit | 1 | 1 | < 0.1 % · < 0.1 % | < 0.1 % · < 0.1 % | 0.9 % · 0.9 % | 37.0 % · 37.1 % | 37.0 % · 37.1 % | 37.0 % · 37.1 % | 37.0 % · 37.1 % |
| content 2 DBT, 10-bit | 1 | 2 | < 0.1 % · < 0.1 % | 0.4 % · 0.5 % | 11.5 % · 11.7 % | 59.9 % · 60.1 % | 59.9 % · 60.1 % | 59.9 % · 60.1 % | 59.9 % · 60.1 % |
| content 2 DBT, 10-bit | 1 | 4 | 0.6 % · 0.7 % | 12.9 % · 13.5 % | 43.4 % · 44.1 % | 79.4 % · 79.7 % | 79.4 % · 79.7 % | 79.4 % · 79.7 % | 79.4 % · 79.7 % |
| content 2 DBT, 10-bit | 1 | 8 | 16.8 % · 17.1 % | 47.9 % · 48.2 % | 72.2 % · 72.4 % | 90.6 % · 90.6 % | 90.6 % · 90.6 % | 90.6 % · 90.6 % | 90.6 % · 90.6 % |
| content 2 DBT, 10-bit | 1 | 12 | 33.0 % · 33.6 % | 62.2 % · 62.6 % | 80.5 % · 80.7 % | 93.4 % · 93.5 % | 93.4 % · 93.5 % | 93.4 % · 93.5 % | 93.4 % · 93.5 % |
| content 2 DBT, 10-bit | 1 | 16 | 43.0 % · 44.0 % | 69.1 % · 69.7 % | 84.2 % · 84.6 % | 94.7 % · 94.8 % | 94.7 % · 94.8 % | 94.7 % · 94.8 % | 94.7 % · 94.8 % |
| content 2 DBT, 10-bit | 1 | 24 | 52.9 % · 54.1 % | 75.2 % · 75.9 % | 87.5 % · 87.8 % | 95.8 % · 95.9 % | 95.8 % · 95.9 % | 95.8 % · 95.9 % | 95.8 % · 95.9 % |
| content 2 DBT, 10-bit | 16 | 1 | < 0.1 % · < 0.1 % | < 0.1 % · < 0.1 % | 1.1 % · 1.2 % | 38.5 % · 39.5 % | 38.5 % · 39.5 % | 38.5 % · 39.5 % | 38.5 % · 39.5 % |
| content 2 DBT, 10-bit | 16 | 2 | < 0.1 % · < 0.1 % | 0.4 % · 0.5 % | 11.5 % · 12.0 % | 59.9 % · 60.4 % | 59.9 % · 60.4 % | 59.9 % · 60.4 % | 59.9 % · 60.4 % |
| content 2 DBT, 10-bit | 16 | 4 | 0.6 % · 0.7 % | 13.1 % · 13.5 % | 43.6 % · 44.1 % | 79.5 % · 79.7 % | 79.5 % · 79.7 % | 79.5 % · 79.7 % | 79.5 % · 79.7 % |
| content 2 DBT, 10-bit | 16 | 8 | 16.1 % · 17.0 % | 47.1 % · 48.2 % | 71.7 % · 72.4 % | 90.4 % · 90.6 % | 90.4 % · 90.6 % | 90.4 % · 90.6 % | 90.4 % · 90.6 % |
| content 2 DBT, 10-bit | 16 | 12 | 32.4 % · 33.6 % | 61.8 % · 62.6 % | 80.3 % · 80.7 % | 93.4 % · 93.5 % | 93.4 % · 93.5 % | 93.4 % · 93.5 % | 93.4 % · 93.5 % |
| content 2 DBT, 10-bit | 16 | 16 | 42.4 % · 43.9 % | 68.7 % · 69.7 % | 84.0 % · 84.6 % | 94.6 % · 94.8 % | 94.6 % · 94.8 % | 94.6 % · 94.8 % | 94.6 % · 94.8 % |
| content 2 DBT, 10-bit | 16 | 24 | 53.1 % · 54.8 % | 75.3 % · 76.3 % | 87.5 % · 88.0 % | 95.8 % · 96.0 % | 95.8 % · 96.0 % | 95.8 % · 96.0 % | 95.8 % · 96.0 % |
| content 2 DBT, 12-bit | 1 | 1 | < 0.1 % · < 0.1 % | < 0.1 % · < 0.1 % | < 0.1 % · < 0.1 % | 2.6 % · 2.6 % | 23.2 % · 23.3 % | 69.0 % · 69.1 % | 69.0 % · 69.1 % |
| content 2 DBT, 12-bit | 1 | 2 | < 0.1 % · < 0.1 % | < 0.1 % · < 0.1 % | 2.9 % · 3.0 % | 24.4 % · 24.5 % | 55.4 % · 55.5 % | 84.3 % · 84.4 % | 84.3 % · 84.4 % |
| content 2 DBT, 12-bit | 1 | 4 | 0.1 % · 0.2 % | 7.5 % · 7.7 % | 35.1 % · 35.5 % | 63.7 % · 64.0 % | 81.3 % · 81.5 % | 93.7 % · 93.8 % | 93.7 % · 93.8 % |
| content 2 DBT, 12-bit | 1 | 8 | 14.3 % · 16.0 % | 45.0 % · 47.0 % | 70.4 % · 71.6 % | 84.9 % · 85.5 % | 92.4 % · 92.8 % | 97.5 % · 97.6 % | 97.5 % · 97.6 % |
| content 2 DBT, 12-bit | 1 | 12 | 29.9 % · 33.3 % | 59.8 % · 62.4 % | 79.1 % · 80.6 % | 89.5 % · 90.2 % | 94.7 % · 95.1 % | 98.2 % · 98.4 % | 98.2 % · 98.4 % |
| content 2 DBT, 12-bit | 1 | 16 | 36.9 % · 39.6 % | 65.0 % · 66.8 % | 82.0 % · 83.0 % | 90.9 % · 91.5 % | 95.5 % · 95.7 % | 98.5 % · 98.6 % | 98.5 % · 98.6 % |
| content 2 DBT, 12-bit | 1 | 24 | 42.5 % · 44.5 % | 68.8 % · 70.1 % | 84.0 % · 84.7 % | 92.0 % · 92.3 % | 96.0 % · 96.2 % | 98.7 % · 98.7 % | 98.7 % · 98.7 % |
| content 2 DBT, 12-bit | 16 | 1 | < 0.1 % · < 0.1 % | < 0.1 % · < 0.1 % | < 0.1 % · < 0.1 % | 2.5 % · 2.6 % | 23.0 % · 23.2 % | 68.9 % · 69.1 % | 68.9 % · 69.1 % |
| content 2 DBT, 12-bit | 16 | 2 | < 0.1 % · < 0.1 % | < 0.1 % · < 0.1 % | 3.4 % · 3.8 % | 25.7 % · 27.2 % | 56.4 % · 57.7 % | 84.8 % · 85.2 % | 84.8 % · 85.2 % |
| content 2 DBT, 12-bit | 16 | 4 | 0.1 % · 0.2 % | 7.5 % · 7.9 % | 35.1 % · 35.9 % | 63.7 % · 64.2 % | 81.3 % · 81.6 % | 93.7 % · 93.8 % | 93.7 % · 93.8 % |
| content 2 DBT, 12-bit | 16 | 8 | 13.9 % · 15.9 % | 44.6 % · 46.8 % | 70.1 % · 71.5 % | 84.7 % · 85.5 % | 92.3 % · 92.7 % | 97.4 % · 97.6 % | 97.4 % · 97.6 % |
| content 2 DBT, 12-bit | 16 | 12 | 29.5 % · 33.2 % | 59.4 % · 62.3 % | 78.9 % · 80.5 % | 89.4 % · 90.2 % | 94.7 % · 95.1 % | 98.2 % · 98.4 % | 98.2 % · 98.4 % |
| content 2 DBT, 12-bit | 16 | 16 | 37.0 % · 39.6 % | 65.0 % · 66.8 % | 82.0 % · 83.0 % | 91.0 % · 91.5 % | 95.5 % · 95.7 % | 98.5 % · 98.6 % | 98.5 % · 98.6 % |
| content 2 DBT, 12-bit | 16 | 24 | 43.8 % · 45.8 % | 69.6 % · 70.8 % | 84.5 % · 85.1 % | 92.2 % · 92.5 % | 96.1 % · 96.3 % | 98.7 % · 98.8 % | 98.7 % · 98.8 % |
| TRUS | 1 | 1 | < 0.1 % · < 0.1 % | 15.7 % · 17.0 % | 15.7 % · 17.0 % | 15.7 % · 17.0 % | 15.7 % · 17.0 % | 15.7 % · 17.0 % | 15.7 % · 17.0 % |
| TRUS | 1 | 2 | 0.3 % · 0.3 % | 30.1 % · 30.8 % | 30.1 % · 30.8 % | 30.1 % · 30.8 % | 30.1 % · 30.8 % | 30.1 % · 30.8 % | 30.1 % · 30.8 % |
| TRUS | 1 | 4 | 5.2 % · 5.8 % | 51.5 % · 52.7 % | 51.5 % · 52.7 % | 51.5 % · 52.7 % | 51.5 % · 52.7 % | 51.5 % · 52.7 % | 51.5 % · 52.7 % |
| TRUS | 1 | 8 | 24.4 % · 25.9 % | 69.8 % · 70.6 % | 69.8 % · 70.6 % | 69.8 % · 70.6 % | 69.8 % · 70.6 % | 69.8 % · 70.6 % | 69.8 % · 70.6 % |
| TRUS | 1 | 12 | 38.8 % · 42.1 % | 77.4 % · 78.8 % | 77.4 % · 78.8 % | 77.4 % · 78.8 % | 77.4 % · 78.8 % | 77.4 % · 78.8 % | 77.4 % · 78.8 % |
| TRUS | 1 | 16 | 47.6 % · 52.0 % | 81.2 % · 83.0 % | 81.2 % · 83.0 % | 81.2 % · 83.0 % | 81.2 % · 83.0 % | 81.2 % · 83.0 % | 81.2 % · 83.0 % |
| TRUS | 1 | 24 | 57.9 % · 63.8 % | 85.3 % · 87.5 % | 85.3 % · 87.5 % | 85.3 % · 87.5 % | 85.3 % · 87.5 % | 85.3 % · 87.5 % | 85.3 % · 87.5 % |
| TRUS | 16 | 1 | < 0.1 % · < 0.1 % | 18.7 % · 20.5 % | 18.7 % · 20.5 % | 18.7 % · 20.5 % | 18.7 % · 20.5 % | 18.7 % · 20.5 % | 18.7 % · 20.5 % |
| TRUS | 16 | 2 | 0.4 % · 0.6 % | 32.4 % · 34.1 % | 32.4 % · 34.1 % | 32.4 % · 34.1 % | 32.4 % · 34.1 % | 32.4 % · 34.1 % | 32.4 % · 34.1 % |
| TRUS | 16 | 4 | 6.1 % · 6.6 % | 53.1 % · 53.9 % | 53.1 % · 53.9 % | 53.1 % · 53.9 % | 53.1 % · 53.9 % | 53.1 % · 53.9 % | 53.1 % · 53.9 % |
| TRUS | 16 | 8 | 25.3 % · 26.9 % | 70.3 % · 71.3 % | 70.3 % · 71.3 % | 70.3 % · 71.3 % | 70.3 % · 71.3 % | 70.3 % · 71.3 % | 70.3 % · 71.3 % |
| TRUS | 16 | 12 | 39.2 % · 42.9 % | 77.6 % · 79.2 % | 77.6 % · 79.2 % | 77.6 % · 79.2 % | 77.6 % · 79.2 % | 77.6 % · 79.2 % | 77.6 % · 79.2 % |
| TRUS | 16 | 16 | 47.8 % · 52.5 % | 81.3 % · 83.2 % | 81.3 % · 83.2 % | 81.3 % · 83.2 % | 81.3 % · 83.2 % | 81.3 % · 83.2 % | 81.3 % · 83.2 % |
| TRUS | 16 | 24 | 58.1 % · 64.5 % | 85.4 % · 87.8 % | 85.4 % · 87.8 % | 85.4 % · 87.8 % | 85.4 % · 87.8 % | 85.4 % · 87.8 % | 85.4 % · 87.8 % |

**20 log10((W − 1) ÷ e), dB, median**: median series' median frame · worst series' worst frame

| family | G | Q | W 4096 | W 2048 | W 1024 | W 512 | W 256 | W 128 | W 64 |
| --- | --: | --: | --- | --- | --- | --- | --- | --- | --- |
| system A | 1 | 1 | 70.1 | 64.0 | 58.0 | 52.0 | 45.9 | 39.9 | 33.8 |
| system A | 1 | 2 | 64.1 | 58.1 | 52.1 | 46.0 | 40.0 | 33.9 | 27.9 |
| system A | 1 | 4 | 56.1 | 50.0 | 44.0 | 38.0 | 32.0 | 25.9 | 19.8 |
| system A | 1 | 8 | 48.4 | 42.3 | 36.3 | 30.3 | 24.2 | 18.2 | 12.1 |
| system A | 1 | 12 | 45.5 | 39.4 | 33.4 | 27.4 | 21.3 | 15.3 | 9.2 |
| system A | 1 | 16 | 44.3 | 38.3 | 32.3 | 26.3 | 20.2 | 14.2 | 8.1 |
| system A | 1 | 24 | 43.4 | 37.4 | 31.4 | 25.3 | 19.3 | 13.3 | 7.2 |
| system A | 16 | 1 | 70.1 | 64.1 | 58.0 | 52.0 | 46.0 | 39.9 | 33.8 |
| system A | 16 | 2 | 63.6 | 57.6 | 51.6 | 45.5 | 39.5 | 33.4 | 27.4 |
| system A | 16 | 4 | 56.0 | 50.0 | 44.0 | 38.0 | 31.9 | 25.9 | 19.8 |
| system A | 16 | 8 | 48.5 | 42.4 | 36.4 | 30.4 | 24.4 | 18.3 | 12.2 |
| system A | 16 | 12 | 45.5 | 39.5 | 33.5 | 27.5 | 21.4 | 15.4 | 9.3 |
| system A | 16 | 16 | 44.3 | 38.3 | 32.3 | 26.3 | 20.2 | 14.2 | 8.1 |
| system A | 16 | 24 | 43.2 | 37.2 | 31.1 | 25.1 | 19.1 | 13.0 | 6.9 |
| system B | 1 | 1 | 64.2 | 58.2 | 52.2 | 46.1 | 40.0 | 33.9 | 27.6 |
| system B | 1 | 2 | 60.3 | 54.2 | 48.2 | 42.1 | 36.1 | 29.9 | 23.6 |
| system B | 1 | 4 | 54.5 | 48.5 | 42.5 | 36.4 | 30.3 | 24.2 | 17.9 |
| system B | 1 | 8 | 47.4 | 41.4 | 35.3 | 29.3 | 23.2 | 17.0 | 10.7 |
| system B | 1 | 12 | 43.8 | 37.7 | 31.7 | 25.7 | 19.6 | 13.4 | 7.1 |
| system B | 1 | 16 | 42.0 | 35.9 | 29.9 | 23.9 | 17.8 | 11.6 | 5.3 |
| system B | 1 | 24 | 40.6 | 34.6 | 28.6 | 22.5 | 16.4 | 10.3 | 4.0 |
| system B | 16 | 1 | 63.9 | 57.8 | 51.8 | 45.7 | 39.7 | 33.5 | 27.2 |
| system B | 16 | 2 | 60.2 | 54.2 | 48.2 | 42.1 | 36.0 | 29.9 | 23.6 |
| system B | 16 | 4 | 54.5 | 48.4 | 42.4 | 36.4 | 30.3 | 24.1 | 17.8 |
| system B | 16 | 8 | 47.6 | 41.6 | 35.5 | 29.5 | 23.4 | 17.2 | 10.9 |
| system B | 16 | 12 | 43.9 | 37.9 | 31.8 | 25.8 | 19.7 | 13.5 | 7.2 |
| system B | 16 | 16 | 42.1 | 36.1 | 30.0 | 24.0 | 17.9 | 11.7 | 5.4 |
| system B | 16 | 24 | 40.6 | 34.6 | 28.5 | 22.5 | 16.4 | 10.2 | 3.9 |
| system C | 1 | 1 | 70.1 | 64.1 | 58.0 | 52.0 | 46.0 | 39.9 | 33.8 |
| system C | 1 | 2 | 64.1 | 58.1 | 52.1 | 46.1 | 40.0 | 34.0 | 27.9 |
| system C | 1 | 4 | 56.2 | 50.2 | 44.1 | 38.1 | 32.1 | 26.0 | 19.9 |
| system C | 1 | 8 | 48.2 | 42.2 | 36.2 | 30.1 | 24.1 | 18.1 | 12.0 |
| system C | 1 | 12 | 44.8 | 38.8 | 32.8 | 26.7 | 20.7 | 14.6 | 8.5 |
| system C | 1 | 16 | 43.5 | 37.5 | 31.5 | 25.5 | 19.4 | 13.4 | 7.3 |
| system C | 1 | 24 | 42.6 | 36.5 | 30.5 | 24.5 | 18.5 | 12.4 | 6.3 |
| system C | 16 | 1 | 70.1 | 64.1 | 58.1 | 52.0 | 46.0 | 39.9 | 33.9 |
| system C | 16 | 2 | 63.7 | 57.7 | 51.6 | 45.6 | 39.6 | 33.5 | 27.4 |
| system C | 16 | 4 | 56.1 | 50.1 | 44.1 | 38.0 | 32.0 | 25.9 | 19.8 |
| system C | 16 | 8 | 48.3 | 42.3 | 36.3 | 30.3 | 24.2 | 18.2 | 12.1 |
| system C | 16 | 12 | 45.0 | 38.9 | 32.9 | 26.9 | 20.8 | 14.8 | 8.7 |
| system C | 16 | 16 | 43.6 | 37.5 | 31.5 | 25.5 | 19.4 | 13.4 | 7.3 |
| system C | 16 | 24 | 42.4 | 36.3 | 30.3 | 24.3 | 18.3 | 12.2 | 6.1 |
| content 2 DBT, 10-bit | 1 | 1 | 64.2 | 58.2 | 52.2 | 46.1 | 40.0 | 33.9 | 27.6 |
| content 2 DBT, 10-bit | 1 | 2 | 60.2 | 54.2 | 48.2 | 42.1 | 36.0 | 29.9 | 23.6 |
| content 2 DBT, 10-bit | 1 | 4 | 54.4 | 48.4 | 42.4 | 36.3 | 30.2 | 24.1 | 17.8 |
| content 2 DBT, 10-bit | 1 | 8 | 47.7 | 41.7 | 35.6 | 29.6 | 23.5 | 17.3 | 11.0 |
| content 2 DBT, 10-bit | 1 | 12 | 44.5 | 38.5 | 32.5 | 26.4 | 20.3 | 14.2 | 7.8 |
| content 2 DBT, 10-bit | 1 | 16 | 42.6 | 36.6 | 30.6 | 24.5 | 18.4 | 12.3 | 6.0 |
| content 2 DBT, 10-bit | 1 | 24 | 40.6 | 34.6 | 28.6 | 22.5 | 16.4 | 10.3 | 4.0 |
| content 2 DBT, 10-bit | 16 | 1 | 64.0 | 58.0 | 51.9 | 45.9 | 39.8 | 33.6 | 27.3 |
| content 2 DBT, 10-bit | 16 | 2 | 60.2 | 54.2 | 48.2 | 42.1 | 36.0 | 29.9 | 23.6 |
| content 2 DBT, 10-bit | 16 | 4 | 54.4 | 48.4 | 42.3 | 36.3 | 30.2 | 24.0 | 17.7 |
| content 2 DBT, 10-bit | 16 | 8 | 47.8 | 41.8 | 35.8 | 29.7 | 23.6 | 17.5 | 11.2 |
| content 2 DBT, 10-bit | 16 | 12 | 44.6 | 38.6 | 32.6 | 26.5 | 20.4 | 14.3 | 7.9 |
| content 2 DBT, 10-bit | 16 | 16 | 42.8 | 36.7 | 30.7 | 24.6 | 18.5 | 12.4 | 6.1 |
| content 2 DBT, 10-bit | 16 | 24 | 40.6 | 34.6 | 28.5 | 22.5 | 16.4 | 10.2 | 3.9 |
| content 2 DBT, 12-bit | 1 | 1 | 70.0 | 64.0 | 58.0 | 52.0 | 45.9 | 39.9 | 33.8 |
| content 2 DBT, 12-bit | 1 | 2 | 64.1 | 58.1 | 52.1 | 46.0 | 40.0 | 34.0 | 27.9 |
| content 2 DBT, 12-bit | 1 | 4 | 56.2 | 50.2 | 44.1 | 38.1 | 32.1 | 26.0 | 19.9 |
| content 2 DBT, 12-bit | 1 | 8 | 48.3 | 42.3 | 36.2 | 30.2 | 24.2 | 18.1 | 12.0 |
| content 2 DBT, 12-bit | 1 | 12 | 45.1 | 39.1 | 33.1 | 27.0 | 21.0 | 15.0 | 8.9 |
| content 2 DBT, 12-bit | 1 | 16 | 43.8 | 37.8 | 31.8 | 25.7 | 19.7 | 13.6 | 7.5 |
| content 2 DBT, 12-bit | 1 | 24 | 42.7 | 36.7 | 30.7 | 24.7 | 18.6 | 12.6 | 6.5 |
| content 2 DBT, 12-bit | 16 | 1 | 70.1 | 64.1 | 58.0 | 52.0 | 46.0 | 39.9 | 33.8 |
| content 2 DBT, 12-bit | 16 | 2 | 63.9 | 57.9 | 51.8 | 45.8 | 39.8 | 33.7 | 27.6 |
| content 2 DBT, 12-bit | 16 | 4 | 56.2 | 50.2 | 44.1 | 38.1 | 32.1 | 26.0 | 19.9 |
| content 2 DBT, 12-bit | 16 | 8 | 48.4 | 42.3 | 36.3 | 30.3 | 24.3 | 18.2 | 12.1 |
| content 2 DBT, 12-bit | 16 | 12 | 45.2 | 39.2 | 33.2 | 27.1 | 21.1 | 15.0 | 8.9 |
| content 2 DBT, 12-bit | 16 | 16 | 43.8 | 37.8 | 31.7 | 25.7 | 19.7 | 13.6 | 7.5 |
| content 2 DBT, 12-bit | 16 | 24 | 42.5 | 36.5 | 30.5 | 24.4 | 18.4 | 12.3 | 6.2 |
| TRUS | 1 | 1 | 56.1 | 50.1 | 44.0 | 37.8 | 31.5 | 24.9 | 17.6 |
| TRUS | 1 | 2 | 53.2 | 47.2 | 41.1 | 34.9 | 28.6 | 22.0 | 14.6 |
| TRUS | 1 | 4 | 49.8 | 43.8 | 37.7 | 31.5 | 25.2 | 18.6 | 11.2 |
| TRUS | 1 | 8 | 45.7 | 39.7 | 33.6 | 27.4 | 21.1 | 14.5 | 7.1 |
| TRUS | 1 | 12 | 43.2 | 37.2 | 31.1 | 24.9 | 18.6 | 12.0 | 4.6 |
| TRUS | 1 | 16 | 41.6 | 35.5 | 29.5 | 23.3 | 17.0 | 10.4 | 3.0 |
| TRUS | 1 | 24 | 39.4 | 33.4 | 27.3 | 21.1 | 14.8 | 8.2 | 0.9 |
| TRUS | 16 | 1 | 55.4 | 49.3 | 43.3 | 37.1 | 30.8 | 24.2 | 16.8 |
| TRUS | 16 | 2 | 52.9 | 46.8 | 40.7 | 34.6 | 28.2 | 21.6 | 14.3 |
| TRUS | 16 | 4 | 49.5 | 43.5 | 37.4 | 31.2 | 24.9 | 18.3 | 10.9 |
| TRUS | 16 | 8 | 45.6 | 39.5 | 33.4 | 27.3 | 21.0 | 14.3 | 7.0 |
| TRUS | 16 | 12 | 43.1 | 37.1 | 31.0 | 24.8 | 18.5 | 11.9 | 4.5 |
| TRUS | 16 | 16 | 41.5 | 35.5 | 29.4 | 23.2 | 16.9 | 10.3 | 3.0 |
| TRUS | 16 | 24 | 39.4 | 33.3 | 27.3 | 21.1 | 14.8 | 8.2 | 0.8 |
