# top10 — why a 12-bit series' top 10 bits cost more than its 12-bit stream

1. **Asked.** A 12-bit DBT series coded lossy as its top 10 bits (WebCodecs decodes up to 10) was 11–26 %
   larger than its 12-bit stream at the same Q 16 (P9, [`README.md`](README.md) §Profiles bytes). Why, and which
   ≤ 10-bit form reaches a lossy view with the fewest bytes at equal quality?
2. **Answer.** The top 10 bits do not cost more at equal quality. libaom's rate-distortion multiplier grows faster
   with Q at 12 bits than at 10, so the same Q buys a *different quality*: the 10-bit stream sits higher on the same
   curve. Matched on PSNR, the top 10 bits are 0.93–1.04× the 12-bit stream's bytes. Ship the top 10 bits, rounded
   to nearest, at the Q that hits the target quality (about 1–3 rungs above the 12-bit Q). A "lossy split" (a lossy
   top plus a low-bits stream) means nothing on these series: the low bits are noise, far under the lossy error.
3. **The numbers that decide it** (`dbts_a1`, `dbts_c1`, Q 12–40): at equal Q the top 10 bits are 1.07–1.19× the
   bytes at G 1 and 1.06–1.34× at G 16, always at higher PSNR (+0.02 to +0.76 dB). At equal PSNR they are 0.95–1.03×
   (G 1) and 0.93–1.04× (G 16). libaom patched to compute the multiplier from the 8-bit-equivalent step: the
   equal-Q gap falls to 0.88–1.00×, the residue being the 10-bit step's coarseness. Trellis off removes most of it (1.00–1.03× on 11 of 12 cells), and
   loop filters off leave it (1.06–1.19×). The 12-bit coder fed the top-10 data matches the 12-bit stream to 0.2 %.
4. **What it rests on.** Two volumes, `dbts_a1` (system A) and `dbts_c1` (system C), whole, one encoder (libaom 3.15.1,
   the campaign's knobs), PSNR as the matching metric, on one 4-core host. The source reading is in §2: the AV1
   specification's step tables and three functions in libaom's `rd.c` and `txb_rdopt.c`.
5. **What is left.** Untested here: the other eight A/C volumes; another encoder (SVT-AV1, which WebCodecs streams
   might come from); a reader study. SSIM is too flat over these rungs to match on (§5). The patch is a lab
   instrument, not a proposal; whether libaom means the multiplier's argument to be a step is for its maintainers.

## Terms

* **Q** — the lossy quantizer, libaom's 0–63 scale (`--cq-level`, `--min-q`, `--max-q`). libaom maps it to the
  specification's 0–255 **qindex** at 4 a step ([L2]); Q 16 is qindex 64. A **rung** is one Q.
* **Step** — the quantizer step a qindex selects. It is looked up per bit depth, and its units are the coded depth's.
  So a 10-bit step is compared with a 12-bit step after ×4.
* **λ** (the RD multiplier, `rdmult` in libaom) — the price, in distortion, the encoder pays for one bit. A larger λ
  zeroes more coefficients: fewer bytes, more error.
* **Systems A, B, C** — the three DBT scanners of the EA1141 dataset. A and C store 12 bits and B stores 10. The fixtures
  here are A's `dbts_a1` (56 slices, 1142 × 1785) and C's `dbts_c1` (69 slices, 976 × 2513).
* **σ** — the frame's sensor noise, as the campaign measured it ([`README.md`](README.md) §σ, ρ, crossover, bend):
  13.34 (`dbts_a1`) and 14.83 (`dbts_c1`) in 12-bit units.
* **Forms** — the ways a 12-bit series reaches the encoder:
  * **12bit**: as stored, coded at 12 bits (`--profile=2`). WebCodecs does not decode it.
  * **top10**: p = min((v + 2) ≫ 2, 1023), coded at 10 bits and shown as p ≪ 2.
  * **top10at12** (a control, never shipped): the same p ≪ 2 values coded at 12 bits. It has top10's data and
    12bit's coder.
* **Residual** — exact − lossy, per sample, coded losslessly in HTJ2K (row 17). Adding it to the lossy frame gives
  the exact frame.
* **Equal quality** — bytes compared where two forms reach the same PSNR, not the same Q. ln bytes are interpolated
  linearly in PSNR between a form's two rungs that bracket the other form's PSNR (*derived*: the campaign's rule,
  one point at a time, no curve fit). PSNR here is over the series at 12-bit peak 4095. **In-window PSNR** counts only
  the samples the series' first header window paints between codes 0 and 255.

## 1 · The fact

At Q 16, G 1, the campaign measured top10 at 1.113× the bytes of 12bit on `dbts_a1`, at +0.10 dB, and 1.141× at
+0.17 dB on `dbts_c1`. Across the ten A/C volumes the range was 11–26 % ([`README.md`](README.md) §The predictions,
P9). The +0.1 dB matters. Near Q 16 these series spend about 5–8 % more bytes per extra 0.1 dB (*derived* from
the campaign's Q 8 → 16 → 32 rows), so a same-Q comparison was never at equal quality.

## 2 · What the specification and libaom say

**The steps.** The specification looks the step up per depth: "The function dc_q( b ) is specified as Dc_Qlookup[
(BitDepth-8) >> 1 ][ Clip3( 0, 255, b ) ]" and "The function ac_q( b ) is specified as Ac_Qlookup[ (BitDepth-8) >> 1
][ Clip3( 0, 255, b ) ]" ([L1] §Dequantization functions). libaom 3.15.1's `dc_qlookup_10_QTX`, `dc_qlookup_12_QTX`,
`ac_qlookup_10_QTX` and `ac_qlookup_12_QTX` (`av1/common/quant_common.c`) match the specification's tables entry for
entry. This was checked here by parsing both, 768 of 768 entries per table. In 12-bit units, the 10-bit step over
the 12-bit step is:

| Q (qindex) | 8 (32) | 12 (48) | 16 (64) | 20 (80) | 24 (96) | 32 (128) | 40 (160) | 56 (224) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DC: 4 · dc_q₁₀ ÷ dc_q₁₂ | 1.077 | 1.032 | 1.018 | 1.011 | 1.003 | 1.001 | 1.000 | 1.000 |
| AC: 4 · ac_q₁₀ ÷ ac_q₁₂ | 1.070 | 1.036 | 1.018 | 1.010 | 1.006 | 1.001 | 1.000 | 1.000 |

The 10-bit step is *coarser* at every rung (*derived* from the tables). So the step points the wrong way: by the
step alone, top10 would be the *smaller* stream. It also vanishes from Q 24 up, where the byte gap does not.

**λ.** libaom computes λ from the step in `av1_compute_rd_mult_based_on_qindex` (`av1/encoder/rd.c`) [L8]:

```c
  const int q = av1_dc_quant_QTX(qindex, 0, bit_depth);
  int64_t rdmult = q * q;
  if (update_type == KF_UPDATE) {
    double def_rd_q_mult = def_kf_rd_multiplier(q);
  …
    case AOM_BITS_10: rdmult = ROUND_POWER_OF_TWO(rdmult, 4); break;
    case AOM_BITS_12: rdmult = ROUND_POWER_OF_TWO(rdmult, 8); break;
```

The q² term is brought back to an 8-bit scale by the final shift. The multiplier is not: "// Returns the default rd
multiplier for key frames for a given qindex." … `static double def_kf_rd_multiplier(int qindex) { return 3.3 +
(0.0015 * (double)qindex); }`. The inter and ARF versions are the same, at 3.2 and 3.25. Its parameter is named
qindex, but it is given `q`, the step **in the coded depth's units**. That step is about 4× larger at 12 bits than at
10 for the same qindex. So the 12-bit λ, on the common 8-bit scale, is larger than the 10-bit λ by (step ratio)² ×
(multiplier ratio) (*derived*):

| Q | 8 | 12 | 16 | 20 | 24 | 32 | 40 | 56 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| λ₁₂ ÷ λ₁₀, key frame | 0.97 | 1.13 | 1.23 | 1.31 | 1.40 | 1.60 | 1.87 | 2.51 |
| 10-bit Q with the 12-bit stream's λ (*derived*) | 8 | 12.8 | 17.8 | 23 | 26.2 | 35.5 | 44.8 | 60 |

λ reaches the coefficients through the trellis optimisation (`av1/encoder/txb_rdopt.c`), which scales `x->rdmult` by
`(trellis_rd_mult[is_inter][plane_type] << (2 * (xd->bd - 8)))`. That code is one place where λ decides which
coefficients survive. Whether the multiplier's argument is meant to be a step and not a qindex is *unverified*: the
source comments call these functions "a first pass estimate based on data from a previous Vizer run" and do not
say. The campaign's own data agreed with this table before any new encode. At Q 8 (λ ratio 0.97) top10 was the
*smaller* stream at lower PSNR (`dbts_a1` 0.928×, −0.28 dB). From Q 16 up it was larger at higher PSNR, and the PSNR
lead grew with the ratio: +0.10 dB at Q 16, +0.26 at Q 32, +1.25 at Q 56 on `dbts_a1`.

**Other depth-dependent paths read and ruled out by the experiment.** These are the loop filter, CDEF and loop
restoration searches (`picklpf.c`, `pickcdef.c` derive their strengths from the step shifted by `bd - 8`). They are
ruled out by the "filters off" arm below. Many pruning thresholds in `tx_search.c` and `partition_strategy.c`
normalise the step as `av1_dc_quant_QTX(…) >> (xd->bd - 8)`. That is a consistent 8-bit scale and was not tested
alone.

## 3 · Hypotheses, and what would refute each

| # | hypothesis | prediction | refuted if |
| --- | --- | --- | --- |
| H1 | **Operating point**: the same Q is not the same quality; matched on PSNR, the gap closes | top10 ÷ 12bit at equal PSNR within ±5 % | outside ±5 % at equal PSNR |
| H2 | **λ's multiplier** (§2) puts the 10-bit stream at a lower λ, so it keeps more | with the multiplier fed the 8-bit-equivalent step, the equal-Q gap falls to the step tables' residue (≤ 1, falling to 1.00 by Q 24) | gap ≥ 1.05 at equal Q under the patch |
| H3 | **The data**: rounding to 10 bits changes the noise the coder sees | top10at12 ≠ 12bit | top10at12 within 1 % of 12bit in bytes and 0.02 dB |
| H4 | **Step tables** (the 10-bit step differs) | gap tracks the table | the step is coarser (§2): refuted by derivation before any encode |
| H5 | **Loop filters** (deblocking, CDEF, restoration) choose by depth | filters off removes the gap | gap persists with filters off |
| H6 | **Trellis** carries λ to the coefficients | trellis off removes most of the gap | gap persists with trellis off |

## 4 · Experiment

**Harness.** [`top10.py`](top10.py) codes one (series, form, Q, G, arm) per cell with the campaign's `aomenc_args`
unchanged ([`README.md`](README.md) §5), plus each arm's flags. It decodes with libaom's `aomdec` (the campaign
found it sample-identical to dav1d on 27 of 27 streams) and measures bytes (temporal units, IVF headers off) and
PSNR, in-window PSNR and SSIM at 12 bits. [`top10_report.py`](top10_report.py) makes every table below. The rows
are in [`results/top10.jsonl`](results/top10.jsonl).

```bash
P=lab/av1/.venv/bin/python; B=lab/.av1-build; D=lab/av1/data; W=…   # B from ingest/tools.sh; aom-lambda below
(cd $B && cp -r aom-3.15.1-src aom-lambda-src && patch -d aom-lambda-src -p1 < ../av1/profiles/top10-lambda.patch)
# cmake aom-lambda-src → $B/aom-lambda, as ingest/tools.sh builds aom-3.15.1
cd lab/av1/profiles
$P top10.py $B $W results/top10.jsonl $D/dbts_a1 $D/dbts_c1 --rungs 12,14,16,18,20,24,28,32 --forms 12bit,top10,top10at12 --ssim
$P top10.py $B $W results/top10.jsonl $D/dbts_a1 $D/dbts_c1 --rungs 12,16,20,24,32,40 --arms lambda,nofilters,notrellis
$P top10.py $B $W results/top10.jsonl $D/dbts_a1 $D/dbts_c1 --rungs 12,16,20,24,32,40 --groups 16 --arms base,lambda
$P top10.py $B $W results/top10.jsonl $D/dbts_a1 $D/dbts_c1 --rungs 40,56 --forms 12bit,top10,top10at12 --ssim
$P top10.py $B $W results/top10-low.jsonl $D/dbts_a1 $D/dbts_c1 --rungs 0 --low-bits
$P top10_report.py results/top10.jsonl
```

**Arms.** *base* is stock libaom 3.15.1. *lambda* is libaom 3.15.1 with [`top10-lambda.patch`](top10-lambda.patch),
three lines that pass `ROUND_POWER_OF_TWO(q, bit_depth - 8)` (the step on the 8-bit scale) to the three multiplier
functions. *nofilters* adds `--enable-cdef=0 --loopfilter-control=0 --enable-restoration=0`. *notrellis* adds
`--disable-trellis-quant=1`.

**Interleaving and the host.** In every (series, G, Q), the arms and forms run alternately in one pool of 4
single-thread encodes on 4 cores (`interleaved` in `top10.py`). Bytes and PSNR are a deterministic function of input
and flags: two campaign cells (`dbts_a1` Q 32, G 1, 12bit and top10) re-ran here to the byte and to 0.001 dB. So
order and load cannot move them. No timing is claimed, so the host's saturation bounds nothing below. The patched
encoder was built while the first ladder ran, and those cells' encode times are not used.

**Checks, and their mutations.**

| check | as run | mutated | verdict |
| --- | --- | --- | --- |
| harness reproduces the campaign | `dbts_a1` Q 32 G 1: 205 832 B / 44.912 dB and 235 362 B / 45.176 dB, the campaign's own cells | — (deterministic replay; see the next rows for the comparison's own mutations) | reproduces |
| equal-PSNR comparison, a form against itself | 1.0000 | the same curve's bytes planted × 1.10: **1.1000** | sees it |
| equal-PSNR comparison, top10 against 12bit at Q 16 (`dbts_a1`) | 1.0081 | top10's PSNR planted +0.30 dB: 0.764; −0.30 dB: 1.319 | sees it, in the right direction |
| the patch changes the coder | — | the λ arm's bytes differ from base on every cell (e.g. 12bit Q 16: 887 649 vs 742 851 B) | the patch is live |
| top10at12 control | equals 12bit (H3) | top10 is the same data at 10 bits: 1.07–1.19× | the control can tell the two apart |

## 5 · Results

**G 1, stock libaom: equal Q against equal quality.** Δ PSNR is top10 − 12bit at the same Q. Ratios are top10's
bytes over 12bit's.

| series | Q | 12bit PSNR | Δ PSNR at equal Q | ÷ at equal Q | ÷ at equal PSNR | ÷ at equal in-window PSNR | ÷ at equal SSIM |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dbts_a1` | 12 | 47.56 | +0.08 | 1.065 | 1.005 | 1.008 | 0.969 |
| `dbts_a1` | 14 | 46.99 | +0.12 | 1.112 | 1.006 | 1.012 | 0.923 |
| `dbts_a1` | 16 | 46.65 | +0.10 | 1.113 | 1.008 | 1.016 | 0.911 |
| `dbts_a1` | 18 | 46.40 | +0.11 | 1.105 | 1.000 | 1.010 | 0.854 |
| `dbts_a1` | 20 | 46.22 | +0.11 | 1.101 | 1.000 | 1.013 | 0.820 |
| `dbts_a1` | 24 | 45.88 | +0.15 | 1.117 | 0.995 | 1.012 | 0.787 |
| `dbts_a1` | 28 | 45.40 | +0.21 | 1.137 | 0.987 | 1.007 | 0.737 |
| `dbts_a1` | 32 | 44.91 | +0.26 | 1.143 | 1.001 | 1.012 | 0.951 |
| `dbts_a1` | 40 | 43.63 | +0.49 | 1.177 | 1.020 | 1.030 | 1.073 |
| `dbts_a1` | 56 | 39.54 | +1.25 | 1.188 | — | — | — |
| `dbts_c1` | 12 | 48.55 | +0.13 | 1.069 | 0.994 | 0.997 | 0.954 |
| `dbts_c1` | 14 | 47.84 | +0.16 | 1.110 | 0.995 | 1.007 | 0.884 |
| `dbts_c1` | 16 | 47.37 | +0.17 | 1.141 | 0.996 | 1.007 | 0.851 |
| `dbts_c1` | 18 | 47.05 | +0.16 | 1.145 | 0.996 | 1.005 | 0.857 |
| `dbts_c1` | 20 | 46.80 | +0.17 | 1.135 | 0.977 | 1.004 | 0.601 |
| `dbts_c1` | 24 | 46.41 | +0.22 | 1.135 | 0.954 | 1.002 | 0.554 |
| `dbts_c1` | 28 | 45.95 | +0.24 | 1.142 | 0.972 | 1.000 | 0.741 |
| `dbts_c1` | 32 | 45.48 | +0.29 | 1.153 | 0.997 | 1.004 | 0.988 |
| `dbts_c1` | 40 | 44.22 | +0.50 | 1.187 | 1.029 | 1.032 | 1.188 |
| `dbts_c1` | 56 | 40.18 | +1.25 | 1.202 | — | — | 1.337 |

"—" is a PSNR outside the other form's measured curve (no extrapolation). **H1 held**: at equal PSNR top10 is
0.954–1.029×, and at equal in-window PSNR 0.997–1.032×. The 7–20 % at equal Q is the operating point. SSIM does not
decide anything here. Over Q 12–32 a series' SSIM moves by under 0.008 while its bytes move 7×, so the equal-SSIM
ratio swings from 0.55 to 1.34 between neighbouring rungs.

**G 1, the arms at equal Q** (top10 ÷ 12bit bytes, Δ PSNR):

| series | arm | Q 12 | Q 16 | Q 20 | Q 24 | Q 32 | Q 40 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dbts_a1` | base | 1.065, +0.08 | 1.113, +0.10 | 1.101, +0.11 | 1.117, +0.15 | 1.143, +0.26 | 1.177, +0.49 |
| `dbts_a1` | lambda (patched) | 0.936, −0.11 | 0.971, −0.05 | 0.986, −0.02 | 0.999, −0.00 | 1.003, −0.00 | 1.004, +0.01 |
| `dbts_a1` | nofilters | 1.062, +0.07 | 1.111, +0.10 | 1.101, +0.11 | 1.115, +0.14 | 1.144, +0.26 | 1.177, +0.48 |
| `dbts_a1` | notrellis | 0.998, −0.03 | 1.007, +0.01 | 1.023, +0.03 | 1.030, +0.04 | 1.021, +0.05 | 1.023, +0.09 |
| `dbts_c1` | base | 1.069, +0.13 | 1.141, +0.17 | 1.135, +0.17 | 1.135, +0.22 | 1.153, +0.29 | 1.187, +0.50 |
| `dbts_c1` | lambda (patched) | 0.936, −0.13 | 0.967, −0.06 | 0.983, −0.01 | 0.994, +0.02 | 1.002, +0.01 | 0.999, −0.01 |
| `dbts_c1` | nofilters | 1.066, +0.10 | 1.138, +0.17 | 1.136, +0.16 | 1.131, +0.21 | 1.154, +0.29 | 1.187, +0.50 |
| `dbts_c1` | notrellis | 1.127, +0.23 | 1.014, +0.01 | 1.024, +0.04 | 1.033, +0.06 | 1.027, +0.07 | 1.028, +0.10 |

* **H2 held.** Under the patch, top10 is 0.94–0.99× at Q 12–20, at slightly lower PSNR. That is the coarser 10-bit
  step of §2, which sets λ at (step ratio)² ≈ 0.94, 0.97, 0.98 there. From Q 24 up it is 0.994–1.004× at ±0.02 dB:
  the two depths code alike once λ is on one scale.
* **H3 refuted.** top10at12 is 0.998–1.001× the bytes of 12bit at −0.02 to +0.004 dB on every rung (Q 12–56) of both
  series.
  Rounding to 10 bits changes nothing the coder can see, which fits the derivation: the rounding error's variance,
  1.5, is 0.4 % of the coded error's (RMSE ≈ 19 at Q 16).
* **H4 refuted** by derivation (§2): the 10-bit step is coarser.
* **H5 refuted.** With the filters off the gap is unchanged (1.06–1.19×).
* **H6 held, mostly.** With trellis off the gap falls to 1.00–1.03×, except `dbts_c1` Q 12 (1.127×). The remainder
  goes through λ's other uses (mode, partition and transform-size decisions), which this run did not separate.

**Is either stock stream wasting bytes?** Every arm's form over the stock 12bit at equal PSNR, at the stock 12bit's
PSNR at each Q:

| series | G | arm, form | Q 12 | Q 16 | Q 20 | Q 24 | Q 32 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dbts_a1` | 1 | base, top10 | 1.005 | 1.008 | 1.000 | 0.995 | 1.001 |
| `dbts_a1` | 1 | lambda, 12bit | 0.980 | 0.997 | 0.996 | 1.001 | 1.001 |
| `dbts_a1` | 1 | lambda, top10 | 0.998 | 1.009 | 1.000 | 1.004 | 1.004 |
| `dbts_a1` | 16 | base, top10 | 1.037 | 1.028 | 0.964 | 0.980 | 0.977 |
| `dbts_a1` | 16 | lambda, 12bit | 0.951 | 0.999 | 0.927 | 0.952 | 0.962 |
| `dbts_a1` | 16 | lambda, top10 | 1.024 | 1.026 | 0.953 | 0.974 | 0.975 |
| `dbts_c1` | 1 | base, top10 | 0.994 | 0.996 | 0.977 | 0.954 | 0.997 |
| `dbts_c1` | 1 | lambda, 12bit | 0.974 | 0.987 | 0.996 | 0.985 | 1.000 |
| `dbts_c1` | 1 | lambda, top10 | 0.983 | 0.990 | 0.976 | 0.965 | 0.998 |
| `dbts_c1` | 16 | base, top10 | 1.013 | 1.008 | 0.931 | 0.952 | 0.983 |
| `dbts_c1` | 16 | lambda, 12bit | 0.950 | 0.978 | 0.902 | 0.930 | 0.964 |
| `dbts_c1` | 16 | lambda, top10 | 1.002 | 1.004 | 0.916 | 0.941 | 0.981 |

At G 1 the patched 12-bit stream is 0.97–1.00× the stock one: a larger λ moves an intra stream along nearly the same
curve. At G 16 it is 0.90–1.00×: the stock 12-bit stream's inter frames, at λ 1.24–1.62× the 10-bit stream's at
Q 16–32 (§2), spend up to 10 % more than they need at equal PSNR. That is why top10 can be the *cheaper* stock stream
at G 16, Q 20–32 (0.93–0.98×). Nothing past these two volumes is claimed.

**G 16** (inter, a keyframe every 16 slices; the campaign's P9 gap was largest here, 1.18× at Q 16), top10 ÷ 12bit:

| series | arm | measure | Q 12 | Q 16 | Q 20 | Q 24 | Q 32 | Q 40 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `dbts_a1` | base | at equal Q, Δ dB | 1.056, +0.02 | 1.180, +0.12 | 1.203, +0.19 | 1.230, +0.24 | 1.274, +0.42 | 1.338, +0.76 |
| `dbts_a1` | base | at equal PSNR | 1.037 | 1.028 | 0.964 | 0.980 | 0.977 | — |
| `dbts_a1` | lambda | at equal Q, Δ dB | 0.875, −0.21 | 0.956, −0.06 | 0.977, −0.04 | 0.997, −0.03 | 0.999, −0.02 | 0.997, −0.02 |
| `dbts_c1` | base | at equal Q, Δ dB | 1.073, +0.07 | 1.199, +0.16 | 1.306, +0.28 | 1.280, +0.29 | 1.275, +0.41 | 1.326, +0.69 |
| `dbts_c1` | base | at equal PSNR | 1.013 | 1.008 | 0.931 | 0.952 | 0.983 | — |
| `dbts_c1` | lambda | at equal Q, Δ dB | 0.909, −0.21 | 0.929, −0.11 | 0.968, −0.04 | 0.990, −0.02 | 1.002, −0.01 | 1.002, −0.03 |

G 16 shows the same as G 1, larger. The inter multiplier's ratio is slightly larger (§2), and at G 16 the cheap inter
frames make each extra 0.1 dB costlier. Under the patch the gap again falls to the step tables' residue (0.88–1.00×).

## 6 · The answer

**Which form, for a 12-bit series that must have a lossy view through WebCodecs.** It must be ≤ 10 bits (WebCodecs
in Chromium refuses 12-bit AV1, measured, row WCAP, [`docs/decode/README.md`](../../../docs/decode/README.md) §AV1).
Among the 10-bit forms:

* **The top 10 bits, rounded to nearest, at the Q that hits the target quality.** At equal PSNR it costs what the
  12-bit stream costs (0.95–1.03× at G 1, 0.93–1.04× at G 16). It costs no more than the 12-bit stream would if WebCodecs took 12 bits. The
  Q to use is not the 12-bit ladder's. Interpolated from the rows above, 12bit Q 16's PSNR is reached by top10 at
  about Q 17 on both series (G 1), and 12bit Q 24's at about Q 26. The λ table of §2 predicts 17.8 and 26.2 (*derived*).
  So a profile ladder for top10 is the 12-bit ladder moved up 1–3 rungs, set by measured quality. aomenc takes whole
  Q (4 qindex), so the match is to the nearest rung.
* **A different rounding** cannot move the result. Rounding to nearest has error variance 1.5 (12-bit units²)
  against a coded error of ≥ 13² wherever the stream is below its noise crossover. Any other rounding (floor,
  dither) at best removes that 0.4 % and at worst adds a bias. Measured bound: the top10at12 control, which keeps
  the rounding and drops the depth, is 0.999–1.001× (*derived* for the alternatives; not encoded).
* **A 10-bit stream whose missing low bits the HTJ2K residual carries** is the top 10 bits plus the ordinary
  residual: the residual is exact − lossy, whatever the form. The campaign's rows give it at G 1, Q 16 (P9's
  rows): lossy + residual is 68 266 028 B for 12bit and 68 225 591 B for top10 on `dbts_a1`, a 0.06 % difference.
  On `dbts_c1` they are 71 083 542 and 71 114 447, 0.04 %. The exact frame costs the same either way.
* **The windowed map** is out: it clips the air and the tails (P9, −34 dB).
* **The patched λ** is not a form, and nothing ships it. It shows that the gap was λ. The same operating point is
  reached in stock libaom by choosing Q.

**Does a "lossy split" mean anything below the noise?** No, on these two series. A lossy split here means a lossy
stream of the top 10 bits plus a stream of the two low bits. The low-bits stream was measured
(`results/top10-low.jsonl`: v & 3 as a 2-bit plane, HTJ2K lossless as served, every frame):

| series | low-bits stream | per sample | entropy, whole frame | entropy, in-window samples | ÷ HTJ2K lossless of the series | ÷ top10's lossy stream, G 1, Q 16 |
| --- | --- | --- | --- | --- | --- | --- |
| `dbts_a1` | 27 618 197 B | 1.94 bits | 1.80 bits | 2.000 bits | 0.41 | 33× |
| `dbts_c1` | 38 351 413 B | 1.81 bits | 1.48 bits | 2.000 bits | 0.54 | 31× |

The two low bits of systems A and C (σ 13–18) are noise. On the in-window samples each of the four values occurs
0.250 ± 0.0002 of the time: 2.000 bits, nothing to code but their own size. The whole-frame entropy is lower only
because the air is constant. Coded losslessly they cost 31–33× the lossy stream they would sit beside. Added to a lossy top they repair only the
rounding (error variance 1.5 out of ≈ 360 at Q 16, +0.02 dB, *derived*). The top's own error is 19 units RMS,
against a low-bits range of 0–3. A split pays sense only when the top is *exact*: that is the lossless split as
shipped (row 100), not a lossy one. For a lossy view with an exact frame on request, the one extra stream worth
having is the residual. It carries the low bits and the lossy error together, at ≈ HTJ2K's cost, and only when
asked.

## Sources

Read 2026-11-04.

* [L1] AOM, *AV1 Bitstream & Decoding Process Specification*, the editors' HTML edition,
  <https://aomediacodec.github.io/av1-spec/>: §Dequantization functions (`Dc_Qlookup`, `Ac_Qlookup`), parsed and
  compared here entry for entry with libaom's tables.
* [L2] libaom v3.15.1, `av1/encoder/av1_quantize.c`, `quantizer_to_qindex[]`,
  <https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/av1/encoder/av1_quantize.c> (as [`README.md`](README.md)
  [L2]).
* [L8] libaom v3.15.1 release tarball (`libaom-3.15.1.tar.gz`, the SHA-256 `ingest/tools.sh` pins), `av1/encoder/rd.c`
  (`def_kf_rd_multiplier`, `def_inter_rd_multiplier`, `def_arf_rd_multiplier`,
  `av1_compute_rd_mult_based_on_qindex`), `av1/encoder/txb_rdopt.c` (trellis `rdmult`), `av1/common/quant_common.c`
  (`dc_qlookup_*_QTX`, `ac_qlookup_*_QTX`); the same files at
  <https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/av1/encoder/rd.c>.
