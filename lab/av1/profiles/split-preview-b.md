# split-preview-b — system B's lossy preview as its top 8 bits, against one 10-bit stream

*Row SPLITPREVIEWB. Theory, a prediction and a protocol, written 2026-11-04 before any number of its own: nothing
here was encoded, decoded or timed for it. A separate session, given only this file, runs §Split preview B protocol,
pre-registered, and writes its results under **`## Split preview B, measured`** at the end of this file.*

## Split preview B protocol, pre-registered

1. **Asked.** On system B (10-bit DBT), should a lossy preview be coded as the source's top 8 bits instead of one
   10-bit stream — in bytes at equal quality, in a frame's decode through WebCodecs at 1× and 4×, and in the
   residual's bytes?
2. **Answer, predicted.** A trade, not a win: from the noise up (≤ 47.5 dB) the top 8 bits should cost 0–12 % more
   bytes at equal PSNR and decode a frame in 0.55–0.90 of the 10-bit stream's time, with the residual within ±2 %.
   Above 49.7 dB the bytes cost climbs (5–35 % at 50–52 dB); above 58.4 dB the top 8 bits cannot reach at all.
3. **The numbers that decide it.** Rounding to a step of 4 adds an error of mean square 1.5 (RMSE 1.22) in 10-bit
   units, against B's noise σ 4.45–6.67: 3.4–7.6 % of σ². Past the noise, libaom's rate–distortion multiplier puts the
   two depths at different qualities for the same Q (up to 1.61× at Q 56), so they are compared at equal PSNR. In the
   one lossless measurement, two 8-bit decodes take 0.60–0.64 of one 10-bit decode.
4. **What it rests on.** `dbts_b1` … `dbts_b5` (and `dbts_b_max` if time allows), five whole volumes from one scanner
   model in one public trial; the bytes run's 10-bit cells (`results/cells.jsonl`); libaom 3.15.1's step tables and
   multiplier; one 4-core cloud host; Chromium 141's WebCodecs. A result holds for these volumes only.
5. **What is left.** Systems A and C (being diagnosed on `claude/av1-top10-why`); another encoder; a phone, and more
   than one decode in flight; a reader study of whether either preview is good enough; the exact frame's decode
   (residual + add), which is timed on `claude/av1-residual-apart`.

### Terms

* **Systems A, B, C** — the three DBT scanners of the EA1141 dataset ([`README.md`](README.md) §3). A and C store
  12 bits a sample; B stores 10. The B volumes here: `dbts_b1` 50 × 2560×3328, `dbts_b2` 71 × 1890×2457, `dbts_b3`
  63 × 1996×2457, `dbts_b4` 84 × 1996×2457, `dbts_b5` 66 × 1890×2457, `dbts_b_max` 53 × 3328×4096
  ([`docs/FIXTURES.md`](../../../docs/FIXTURES.md) §AV1 data). These are the only cine-like breast series of system
  B the repo has; repeated searches found no more ([`README.md`](README.md) §Larger cine fixtures).
* **The split** — how the shipped lossless payload codes a sample v: a **top stream** v ≫ k and a **low stream**
  v & (2^k − 1), each lossless, each its own AV1 stream ([`docs/av1/payload-format.md`](../../../docs/av1/payload-format.md)).
  On system B k = 2: an 8-bit top and a 2-bit low (coded as an 8-bit stream).
* **Q** — the lossy quantizer, libaom's 0–63 scale (`--cq-level`); Q 0 is lossless. libaom maps Q to the
  specification's 0–255 qindex at 4 a step ([`README.md`](README.md) §Names). A **rung** is one Q.
* **G** — frames coded together: a keyframe every G frames, the rest predicted from the frame before. G = 1 codes each
  slice alone.
* **The two forms compared** (every value in 10-bit units unless it says so):
  * **10bit** — the source coded as one lossy 10-bit stream, as the bytes run coded it ([`README.md`](README.md) §5).
  * **top8** — p = min((v + 2) ≫ 2, 255), coded as one lossy 8-bit stream (`--bit-depth=8 --profile=0`), shown as
    p̂ ≪ 2, where p̂ is the decoded top. This is §4's top-10 rule of [`README.md`](README.md) at k = 2.
  * **top8at10** (a control, never shipped) — the same values p ≪ 2, coded at 10 bits. It has top8's data and
    10bit's coder.
* **Residual** — exact − lossy, per sample: v − (p̂ ≪ 2) for top8, v − v̂ for 10bit, one offset per series making it
  unsigned, coded losslessly in HTJ2K's served profile. Lossy + residual is the exact frame. **It is never built from
  the low stream**: v & 3 completes v only when p̂ = p, and a lossy top is wrong in its high bits too.
* **Equal quality** — two forms compared where they reach the same PSNR over the series, not the same Q (method
  below). **PSNR** is over every sample of the series against the source, at peak 1023, as the bytes run measures it.
* **Displayed-level change** — for the series' first header window, the share of in-window samples whose 8-bit
  display code differs from the source's, the share differing by more than 1, and the largest change in codes
  (the bytes run's `display` field; P8 of [`README.md`](README.md) §2).
* **SSIM at the true depth** — mean SSIM over slices on the 10-bit samples, data range 1023, the bytes run's settings
  (Gaussian σ 1.5, scikit-image 0.25.2).
* **1×, 4×** — the browser unthrottled, or each browser thread capped at a quarter of a CPU
  (`lab/scripts/cpu_throttle.mjs`).
* **Anchor** — a 10bit G = 1 rung the decode is timed at: Q 16 and Q 32, the crossover rungs of system B (the first
  rung whose RMSE reaches σ: Q 16 on `dbts_b2`, Q 32 on the other four; [`README.md`](README.md) §σ, ρ, crossover,
  bend). **Partner** — the top8 rung whose G = 1 PSNR is nearest the anchor's on the same series.

### What is known already

* **System B's 10-bit lossy stream**, G = 1 ([`README.md`](README.md) §Bytes and §Quality, DBT-10): PSNR 62.0–64.9 dB at
  Q 2, 49.7–52.0 at Q 8, 44.5–47.5 at Q 16, 41.7–44.3 at Q 32, 37.5–40.0 at Q 56. Its noise σ is 4.45–6.67.
* **The split, lossless, on 10-bit DBT** ([`../delivery/split-rule/README.md`](../delivery/split-rule/README.md)
  §Decode): one 10-bit stream decodes in 4.10 · 3.80 × HTJ2K's time a frame (1× · 4×), the 8-bit top and the low
  stream together in 2.61 · 2.27 ×. Two 8-bit decodes cost 0.64 · 0.60 of one 10-bit decode (*derived*).
* **The 12-bit analogue** (P9 of [`README.md`](README.md), and `lab/av1/profiles/top10.md` on `claude/av1-top10-why`,
  not on this branch): the top 10 bits of a 12-bit series were 11–26 % larger than the 12-bit stream at the same Q 16,
  and 0.95–1.03× at equal PSNR on `dbts_a1` and `dbts_c1`. The cause there: libaom computes its multiplier from the step
  in the coded depth's units, so the same Q is a different quality at each depth. That diagnosis is another branch's,
  quoted, not re-checked here.
* **System B's 10-bit WebCodecs decode** (raw rows of the six decode shards of [`README.md`](README.md) §7,
  `rows/decode-shard-*.json`, not yet pooled or read by §7's rule — taken here only to size the run): `dbts_b1` in
  order, one slice a frame, median 83 ms at Q 16 and 68 ms at Q 32 at 1×, 241 ms at Q 32 at 4× (55 rounds over the
  shards); the paired σ of ln(one WebCodecs unit ÷ another, same worker and round) 0.046–0.061 at 1×, 0.049 at 4×;
  the A/A's 0.054–0.096.

### Theory

**T1. What the bit cut costs before AV1** (*derived*). p = (v + 2) ≫ 2 shown as 4p leaves an error v − 4p in
{−2, −1, 0, +1} (+2, +3 only at v = 1022, 1023, clamped). With v mod 4 evenly spread, its mean square is (4 + 1 + 0 + 1) ÷ 4 = 1.5,
its RMSE 1.22 and its mean −0.5. So **top8's PSNR can never exceed 20·log10(1023 ÷ 1.22) = 58.4 dB**, and the 10bit
form's Q 2 (62.0–64.9 dB) has no top8 counterpart. In noise terms the step of 4 is 0.60–0.90 σ on B, and the error's
mean square is 1.5 ÷ σ² = 3.4–7.6 % of the noise's. A step under σ leaves the noise's statistics nearly intact, so the
encoder sees the same noise, now at a quarter of the scale.

**T2. How much of it survives AV1** — two bounds (*derived*). Let D be the total error's mean square at a target PSNR.

* **Additive** — the coder keeps the rounding error as it is, so top8 must code to D − 1.5 to reach D. At the bytes
  run's 10bit points, using each series' local slope of ln bytes against PSNR between neighbouring rungs, that costs:

  | quality (10bit rung) | D | rounding ÷ D | PSNR top8 must add | top8 ÷ 10bit, bytes |
  | --- | --- | --- | --- | --- |
  | Q 2, 62.0–64.9 dB | 0.34–0.66 | > 1 | — | **unreachable** |
  | Q 8, 49.7–52.0 dB | 6.7–11.2 | 0.13–0.22 | 0.63–1.11 dB | 1.06–1.34 |
  | Q 16, 44.5–47.5 dB | 18.7–36.7 | 0.04–0.08 | 0.18–0.36 dB | 1.04–1.21 |
  | Q 32, 41.7–44.3 dB | 39–71 | 0.02–0.04 | 0.09–0.17 dB | 1.04–1.10 |
  | Q 56, 37.5–40.0 dB | 105–185 | ≈ 0.01 | 0.04–0.06 dB | 1.02–1.03 |

* **Absorbed** — once the step Δ is well over σ, the coder discards noise either way, and the rounding error is
  noise-like, so it is discarded with it. Only its mean of −0.5 (mean square 0.25) remains: top8 ÷ 10bit ≈ 1.00–1.02
  from the crossover up.

The truth lies between: absorbed from the crossover up, closer to additive at Q 8, where the coder still keeps much
of the noise. The **top8at10 control** separates the data from the coder: it has top8's data at 10bit's coder.

**T3. Why equal Q is not equal quality** (*derived* from libaom 3.15.1, read 2026-11-04). The step a qindex selects is
looked up per depth: the AV1 specification's "The function dc_q( b ) is specified as Dc_Qlookup[ (BitDepth-8) >> 1 ][
Clip3( 0, 255, b ) ]" ([L1], quoted in [`README.md`](README.md) §1b). libaom's multiplier is computed from that
step in the coded depth's units: `const int q = av1_dc_quant_QTX(qindex, 0, bit_depth); int64_t rdmult = q * q;` and
then `def_kf_rd_multiplier(q)`, which is `return 3.3 + (0.0015 * (double)qindex);` ([L2], `av1/encoder/rd.c`), before
`ROUND_POWER_OF_TWO(rdmult, 4)` brings 10 bits back to the 8-bit scale. From the tables in `av1/common/quant_common.c`
([L3]), comparing the 10-bit step with 4 × the 8-bit step, and the two multipliers on the 8-bit scale (key frames):

| Q (qindex) | 8 (32) | 12 (48) | 16 (64) | 20 (80) | 24 (96) | 32 (128) | 40 (160) | 56 (224) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| DC step: dc_q₁₀ ÷ (4 · dc_q₈) | 0.80 | 0.89 | 0.94 | 0.97 | 0.99 | 1.00 | 1.00 | 1.00 |
| AC step: ac_q₁₀ ÷ (4 · ac_q₈) | 0.78 | 0.89 | 0.94 | 0.97 | 0.98 | 0.99 | 1.00 | 1.00 |
| λ₁₀ ÷ λ₈ | 0.66 | 0.83 | 0.96 | 1.03 | 1.08 | 1.18 | 1.27 | 1.61 |

At Q ≤ 12 the 8-bit coder is the coarser one and the cheaper one in λ: top8 is smaller and worse. From Q 20 up the
10-bit coder takes the larger λ: top8 is larger and better, as the top 10 bits were against 12 bits at λ ratios
1.13–1.60 (top10.md: 1.07–1.15× bytes, +0.08 to +0.29 dB at Q 12–32). Equal Q compares two qualities, so **the
decision is at equal PSNR**, and equal Q is reported only to be checked against this table.

**T4. The residual** (*derived*). At equal PSNR the two residuals have the same mean square. Both are mostly sensor
noise plus coding error, near Gaussian, and a lossless coder pays about log2 of a near-Gaussian's spread a sample, so
their HTJ2K bytes should match closely. top8's residual always holds the rounding error, but at equal PSNR the coding
error is smaller by just that much.

**T5. Decode** (partly *unverified*). dav1d keeps separate 8-bit and 16-bit pixel code: its build option `bitdepths`,
"choices: ['8', '16'] … 'Enable only specified bitdepths'" ([L4], `meson_options.txt`), and its picture data "should
be bytes (for 8 bpc) or words (for 10 bpc)" ([L4], `include/dav1d/picture.h`). So an 8-bit stream's prediction,
inverse transforms and loop filters run on bytes, twice the samples per vector register (*derived* from the types;
that every stage's assembly gains the full factor is *unverified*). Entropy decoding is per symbol, not per bit of depth,
and costs about the same at equal bytes. Chromium's WebCodecs runs dav1d on these streams (`Dav1dVideoDecoder`, from
the media log in [`README.md`](README.md) §Profiles decode, measured). With an entropy share s, top8 ÷ 10bit ≈ s + (1 −
s) ÷ 2 ≥ 0.5. The lossless split's 0.60–0.64 for *two* 8-bit decodes (§What is known) bounds it from the other side
only loosely, because a lossless frame is 66–84 % entropy decoding (row DECSPEED, [`docs/decode/README.md`](../../../docs/decode/README.md)).

### Prediction

Per series, written before any number. "From the noise up" means 10bit qualities from the series' crossover rung to
Q 56.

| # | prediction | refuted by |
| --- | --- | --- |
| **S1** | **Ceiling.** top8's PSNR is ≤ 58.4 dB at every rung, and the uncoded top8 (no AV1) lands at 58.4 ± 0.1 dB | any rung over 58.5 dB |
| **S2** | **Bytes at equal PSNR, from the noise up**: top8 ÷ 10bit in **1.00–1.12** at G = 1 and at G = 16 | a series outside on any matched quality from the noise up |
| **S3** | **Bytes at equal PSNR, Q 8's quality**: **1.05–1.35**, and above the matched range of S2 on the same series | outside, or not above S2's |
| **S4** | **Equal Q follows the multiplier** (T3): top8 smaller and lower PSNR at Q 8 and Q 12; larger (1.05–1.20×) and higher PSNR at Q 32 and Q 56 | the sign of bytes or PSNR wrong at any of those Q, on ≥ 3 series |
| **S5** | **The control**: top8at10 ÷ 10bit at equal PSNR within ±3 % at Q 16 and Q 32 (the data costs little); top8 ÷ top8at10 at equal Q differs from 1 as T3 says | top8at10 outside ±3 % |
| **S6** | **Quality beside PSNR**: at equal PSNR, mean SSIM within ±0.002 and the displayed-level change within ±2 points of 10bit's | outside on ≥ 3 series |
| **S7** | **Residual**: at equal PSNR, top8's residual ÷ 10bit's residual in **0.98–1.02** | outside on any series |
| **S8** | **Decode a frame, in order, at equal quality**: top8 ÷ 10bit in **0.55–0.90** through WebCodecs, at 1× and 4×, at G = 1 and G = 16 | a read cell whose interval lies wholly outside |

**What would refute the theory as a whole:** top8 under 1.00 at equal PSNR from the noise up (S2) would mean the bit
cut removes something the coder would otherwise pay for. That is noise, and T1 says a step under σ removes almost none.
top8 decoding no faster (S8) would mean the pixel stages are not where these frames spend their time.

### Protocol

**Host and limits.** One fresh cloud host, 4 cores, Linux, nothing else running. **≤ 4.5 h wall** from session start
(T0), the setup included. Every stage writes its rows and pushes them before the next starts (`git pull --rebase`
first); a stopped session keeps what it pushed and resumes at the first missing row.

**Tools.** `lab/av1/tools/tools.sh` (libaom 3.15.1, dav1d 1.5.4, OpenJPH 0.31.0) and the venv of
`lab/av1/profiles/requirements.txt`, as the bytes run. For the decode, `decode_setup.sh`'s browser and decoder steps
(Playwright 1.56.1, headless Chromium 141.0.7390.37). Its stream step is replaced: the decode reads the bytes stage's
own streams, kept. Data: `lab/av1/fetch_data.sh dbts_b1 dbts_b2 dbts_b3 dbts_b4 dbts_b5` (and `dbts_b_max` only if
§Timeline reaches it).

**Harness, the least the measurement needs** (the measuring session builds it, and it changes no product code):
`bytes.py` takes forms `top8` and `top8at10` on 10-bit series (as T1 and §Terms define them, the shift 2 recorded
in the row). `measure` and the residual use the shown value p̂ ≪ 2. A `--keep RUNGS` flag keeps the IVFs the decode
reads. `streams.py`'s `shift` is 2 for top8. `decode_block.mjs` builds this file's units (below) in place of §7's;
`decode_pool.py`'s single-block statistic is reused. `split_preview_report.py` makes every table and verdict below
from the rows.

**Encoder** — the bytes run's knobs, unchanged ([`README.md`](README.md) §5, `bytes.py` `aomenc_args`): `--good
--cpu-used=6 --threads=1 --passes=1 --tune=psnr --end-usage=q --cq-level=Q --min-q=Q --max-q=Q --deltaq-mode=0
--aq-mode=0 --denoise-noise-level=0 --lag-in-frames=0 --auto-alt-ref=0 --monochrome`, `--profile=0` and
`--bit-depth=8` for top8. Whole volumes, every slice.

#### Setup, T0 → 0:35, and stage 1 — checks and mutations (§Checks), → 0:55

The setup's wall time is reported. If it ends after T0 + 0:35, every later stage shifts by the overrun, and stage 4 is the first thing dropped.

#### Stage 2 — bytes and quality, T0 + 0:55 → 2:15

Cells, in this order. Each item finishes before the next starts, and the item's cells run interleaved: within an item,
every (series, form, Q) goes into one pool of 4 single-thread processes in an order alternating the forms. G = 1 unless
it says otherwise; the 10bit cells at Q 2, 8, 16, 32, 56 and G = 16 are the bytes run's (`results/cells.jsonl`), and one
of them is re-run as a check.

1. top8 at Q 12, 16, 24, 32 and 10bit at Q 12, 24, on all five series (the anchors' partners come from these);
2. top8 at G = 16 at each anchor's partner rung;
3. top8 at Q 8 and Q 56;
4. top8at10 at Q 16 and Q 32 on `dbts_b2` and `dbts_b5` (σ 4.45, where the rounding is the largest share of the noise).

Sized from the bytes run's own cell times (`cell_wall`, B's 10bit cells: 1 070–3 040 cell-s a (form, rung) over five
series at G = 1, about 1 350 at G = 16): items 1–2 about 3.8 cell-h, 58 min on four processes; items 3–4 about 17 min
(*derived*). An item not finished by T0 + 2:15 is stopped, and its missing cells are reported as not run. Item 1 is
never cut: the decode needs it.

Each cell records the bytes run's fields: bytes, PSNR and in-window PSNR, RMSE, max |Δ|, SSIM mean and minimum frame,
the displayed-level change, the residual's HTJ2K bytes, offset and bits, and exact frames.

**Equal PSNR** (top10.md's rule on `claude/av1-top10-why`, *derived*): for each top8 point, the 10bit curve's ln bytes interpolated linearly in
PSNR between the two 10bit rungs that bracket it, on the same series and G. No point outside the other curve is
extrapolated: it is reported as "—". The same holds for the residual's bytes, SSIM and displayed-level change. **The
interpolation's own error**, per series and G, is the largest |error| of predicting each interior 10bit rung from its
two neighbours. It is called *tol*, and it is conservative because the neighbours sit twice as far apart as in use.

#### Stage 3 — decode, T0 + 2:15 → 3:45

**Units, per (series, anchor):** 10bit S1, 10bit S1′ (the same unit twice, the A/A), 10bit S16, and top8 S1 and top8 S16
at the partner rung. S_G is the G-coded stream decoded **in order**: a fresh `VideoDecoder` primed off the clock from
the first middle slice's keyframe, then the middle 16 slices (`dbts_b1` 17–32; the others their middle 16), each timed
from its unit handed in to its samples written, back-conversion (≪ 2 for top8) included. A unit's figure is the median
over its 16 slices, in ms. **Latency only, one decode in flight**; no throughput is quoted.

**Decoder settings: §7's**: `{ codec: the stream's own string, hardwareAcceleration: "prefer-software",
optimizeForLatency: true }`, `flush()` only at a unit's end. WebCodecs only: dav1d-WASM is not asked.

**Content:** at 1× both anchors on all five series, 50 units; at 4× the crossover anchor only (Q 32, or Q 16 on
`dbts_b2`), 25 units.

**Order, interleaved:** a round is 1× and 4×, which goes first alternating by round, each in a fresh headless Chromium.
Inside a throttle, the (series, anchor) run in that round's Williams row (`lab/order.mjs`), each in one worker holding
both forms' streams. Inside the worker, its 5 units run in that round's Williams row, so the two forms alternate
position and predecessor. Rows are pushed every two rounds.

**Rounds:** as many as fit until T0 + 3:45 (`--until`), **at least 10** (§7's floor). After round 2, if the median
round time projects fewer than 10 rounds by T0 + 3:45, drop the S16 units (both forms), then if still short the 1×
non-crossover anchor, in that order, and say so. *Sizing* (*derived*): §7's shards took 6–10 min for 140 units at 1× and 6–15 min for 47 at
4×, about half of them dav1d-WASM, which is 2–3× slower; these frames are 1.3× theirs on average. These 75 WebCodecs
units should take 4–9 min a round: 10–22 rounds.

**Precision this buys** (*derived* from the shards' paired σ 0.046–0.061): a single block's 95 % interval on a
median ratio is about ± 1.96 · √(π/2) · σ ÷ √n = ±4–5 % at n = 10, ±3.5–4.3 % at n = 14. S8's band edges sit 10–45 %
from 1, so a cell is decided unless its estimate lies within that of an edge.

#### Stage 4 — `dbts_b_max`, if it fits, T0 + 3:45 → 4:10

Only if stage 3 reached 10 rounds and ≥ 25 min remain before T0 + 4:10: top8 and 10bit, G = 1, Q 16 and Q 32, four cells
in one pool (*derived*: `dbts_b1`'s 307–411 cell-s scaled by pixels, 1.7×, about 12 min). Bytes and quality only: the
same equal-Q table, and the equal-PSNR ratio only if the two rungs bracket. Otherwise it is listed as left.

#### Statistics and decision rules

**Bytes, residual, SSIM, display (stages 2 and 4).** These are deterministic: the same input and flags give the same
bytes (§Checks, C1), so no interval is formed and order cannot move them. Per series, G and matched point: r = top8 ÷
10bit at equal PSNR. **Smaller** if ln r < −tol, **larger** if ln r > tol, **tie** otherwise (tol from the data, above).
S1–S7 are decided by their refutation clauses as written.

**Decode (stage 3).** Formed inside the block, paired by round within (series, anchor, throttle, G): ln(top8 S_G ÷
10bit S_G). The cell's figure is the median over rounds, with a distribution-free 95 % interval (order statistics k
and n + 1 − k, k from the binomial(n, ½) tails), as [`README.md`](README.md) §7 forms a block's statistic. **Faster**
if the interval lies wholly under 1, **slower** if wholly over, **not decided** otherwise: §7's rule for a question with
no band. S8 holds where the interval lies inside 0.55–0.90 and is refuted where it lies wholly outside.

* **A/A void** (§7's rule): per throttle, the median of ln(10bit S1′ ÷ 10bit S1) over every (series, anchor) and round,
  with the same interval. If it lies wholly beyond ±ln 1.05, every cell at that throttle is void: the block measured
  position, not forms.
* **Order effect** (§7's rule, `docs/rig-limits.md` §6): a cell is not read when the largest |median by the
  numerator's predecessor ÷ median − 1| exceeds 10 % **and** under 5 % of 400 shuffles of the predecessors reach it.
* **Quality mismatch in the decode.** A partner is a rung, not an interpolated point: its PSNR differs from the anchor's
  by Δ. On `dbts_b1` the 10bit stream's decode moved from 83 to 68 ms over Q 16 → 32, 2.6 dB: about 8 % a dB
  (*derived*, shards' raw medians). Each decode cell reports Δ and that bound. A cell with |Δ| · 8 % larger than its
  interval's distance from 1 is reported as **not decided at equal quality**, whatever its interval says.
* **One block: one host.** No between-host spread is measured, so nothing is claimed for another host.

**The verdict, per series and quality**, by dominance (*derived*: no weight between bytes and time is assumed).
**top8 better** where it is smaller or tied in bytes, smaller or tied in the residual, and faster. **top8 worse** where
it is larger in bytes and not faster. **A trade** otherwise, stated with its two numbers: x % more bytes for y % less
decode time a frame. **top8 unreachable** above its ceiling. The owner weighs a trade; this protocol does not.

#### Checks, each mutated once before stage 2

Run on `dbts_b2` (the fastest whole volume) unless it says otherwise. Each check is broken on purpose and must fail;
the report gives every outcome.

| # | check | as it should read | mutation | must read |
| --- | --- | --- | --- | --- |
| C1 | the harness reproduces the bytes run | 10bit Q 32 G = 1: the same bytes as `results/cells.jsonl`, PSNR to 0.001 dB | `--cq-level` 33 | a mismatch named |
| C2 | the rounding identity | uncoded top8 (p ≪ 2) against the source: mean square equal to the v mod 4 histogram weighted by 0, 1, 4, 1 (residues 0–3; the clamp's 4 and 9 at 1022, 1023), to 1e−9 | p = v ≫ 2 (floor) | mismatch (mean square ≈ 3.5) |
| C3 | the exact frame, every frame of every cell | lossy + residual = source, every frame | the residual built from the low bits, v & 3, onto p̂ ≪ 2 | 0 exact on a lossy top8 cell (Q 16); and every frame exact when the same construction is applied to the split's own lossless top (v ≫ 2, Q 0), so the failure is the lossy top's, as §Terms says |
| C4 | top8's back-conversion | aomdec's top8 frames ≪ 2 against the source give the row's PSNR | shift 0 | PSNR far under, mismatch named |
| C5 | equal PSNR | a curve against itself 1.000; tol finite | the same curve's bytes planted × 1.10 → 1.100; its PSNR planted +0.3 dB → ratio < 1, −0.3 → > 1 | as stated |
| C6 | decoded frames | every frame, after back-conversion, hashes as native dav1d 1.5.4's decode ≪ shift (precomputed) | `--mutate hash`; and top8's shift set to 0 | 0 matched on the mutated units, the others intact |
| C7 | the decode statistics | `split_preview_report.py --test`: synthetic rounds with known ratio 0.75 and A/A 1.00 recovered inside their intervals | a mean in place of the median; the A/A rule off; pairs taken across rounds; predecessors never shuffled | each fails the test |
| C8 | the partner rule | the partner of each anchor printed with its Δ PSNR | the rule given the 10bit curve as top8's | partner = anchor, Δ = 0: the test sees the swap |

#### Saturation

* **Bytes (stages 2, 4):** four single-thread processes on four cores. The host is saturated by design, and **no
  encode time is claimed**: bytes and PSNR do not depend on load (C1).
* **Decode (stage 3):** one decode in flight. WebCodecs runs its own decoder threads, so a cell is not a one-core
  figure at either throttle; at 4× every browser thread is capped at a quarter of a CPU. **Nothing is claimed past 4×,
  for concurrent decodes, for a phone, or for another host.** Nothing else runs during stage 3.

#### What the measuring session writes

Under `## Split preview B, measured` at the end of this file: five plain lines first (what ran, the answer, the
numbers, what it rests on, what is left), then the host, the timeline as run, C1–C8 with their mutations, the tables
(equal Q; equal PSNR per series and G with tol; residual; SSIM and display; decode per cell with n, interval, Δ PSNR
and order effect; the A/A), S1–S8 each held, refuted or not decided with its deciding numbers, and the verdict per
series and quality. Rows go to `lab/av1/profiles/results/split-preview-b/`. Nothing above this heading is changed; a
deviation is written down there with its reason.

### Sources

Read 2026-11-04.

* [L1] AOM, *AV1 Bitstream & Decoding Process Specification*, <https://aomediacodec.github.io/av1-spec/>, §Dequantization
  functions, as quoted in [`README.md`](README.md) §1b and §Sources [L1].
* [L2] libaom v3.15.1, `av1/encoder/rd.c`,
  <https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/av1/encoder/rd.c>: `av1_compute_rd_mult_based_on_qindex`
  ("const int q = av1_dc_quant_QTX(qindex, 0, bit_depth); int64_t rdmult = q * q;") and `def_kf_rd_multiplier`
  ("return 3.3 + (0.0015 * (double)qindex);"); the inter and ARF versions 3.2 and 3.25.
* [L3] libaom v3.15.1, `av1/common/quant_common.c`,
  <https://aomedia.googlesource.com/aom/+/refs/tags/v3.15.1/av1/common/quant_common.c>: `dc_qlookup_QTX`,
  `dc_qlookup_10_QTX`, `ac_qlookup_QTX`, `ac_qlookup_10_QTX`. T3's table is *derived* from these entries (qindex 32
  … 224), with the multiplier of [L2].
* [L4] dav1d 1.5.4, <https://github.com/videolan/dav1d/tree/1.5.4> (mirror of code.videolan.org): `meson_options.txt`
  ("option('bitdepths', type: 'array', choices: ['8', '16'], description: 'Enable only specified bitdepths')") and
  `include/dav1d/picture.h` ("The data should be bytes (for 8 bpc) or words (for 10 bpc).").

## Split preview B, measured (2026-11-04)

1. **What ran.** §Split preview B protocol, pre-registered, on `dbts_b1` … `dbts_b5`: checks C1–C8 each with its mutation; 54 bytes cells (40 top8, 4 top8at10, 10 new 10bit) beside the bytes run's 10bit cells; the WebCodecs decode in 21 rounds on one host, after 8 rounds on another were cut by a worker restart; stage 4, `dbts_b_max` at Q 16 and Q 32, fitted and ran.
2. **The answer, by the rule as written.** S1 held by its clause; S2–S7 refuted; S8 not decided (5 cells held, 8 not decided, 17 not read, none refuted). The verdict is **a trade** on 8 of the 10 (series, quality) pairs and **not decided** on 2. No pair is "top8 better" or "top8 worse": every bytes ratio is a tie within tol, and at no quality is every decode cell both read and faster.
3. **The numbers.** At equal PSNR top8 costs 1.05–1.26× the 10bit stream's bytes at G = 1 and 1.08–1.26× at G = 16 from the noise up (0.95–0.98 at the Q 56 points; 1.18–1.43 at G = 16, Q 16 on the four series whose crossover is Q 32), and 1.13–1.17× at Q 8's quality — every one a tie, because tol is 0.28–1.12 in ln; its residual is 0.97–1.02× the 10bit form's. In decode a frame takes 0.76–0.82 (the median over 21 rounds in each of the 30 cells on host 2; their intervals within 0.67–1.03) of the 10bit stream's time. The bit cut's own error is 0.52–1.01 in mean square, not T1's 1.5: uncoded top8 sits at 60.1–63.1 dB, not 58.4.
4. **What it rests on.** Five whole volumes of system B (one scanner model, one public trial), libaom 3.15.1 at the bytes run's knobs, headless Chromium 141.0.7390.37's WebCodecs (that it runs dav1d is §T5's, from an earlier media log: *unverified* here) on one 4-core cloud host per decode block. It holds for these five volumes, this encoder and this browser only.
5. **What is left.** Everything the protocol's own line 5 lists; rungs between the bytes run's, so that *tol* (below) stops deciding the bytes; `dbts_b_max` at more rungs and in decode; a decode design whose intervals reach the ±4–5 % the protocol sized for: the first unit in a worker runs faster, and that, not the round count, set the widths here (§Decode, below).

**Terms first used here.** A **cell** is one (series, form, Q, G) coded and measured; a **unit** one decode of the middle 16 slices in one worker; a **round** every unit once at each throttle; a **block** every round on one host. A **matched point** is a top8 cell whose PSNR lies between two 10bit rungs of the same series and G, so the 10bit value there is interpolated, never extrapolated. **tol** is §Equal PSNR's interpolation error, in ln units. **Host 1, host 2**: the two machines stage 3 ran on (below).

### Host, and where it saturates

* **Host 1** (setup, stages 1–2, stage 3 rounds 0–7): Intel Xeon @ 2.10 GHz, 4 cores, one thread a core, 16 GB, Linux 6.18. **Host 2** (stage 3 from 23:30, stage 4 and C1 again): Intel Xeon @ 2.80 GHz, 4 cores, 16 GB, Linux 6.18; the session's worker was restarted onto it at about 23:29 UTC, with the disk kept. The two decode blocks are read apart: ms never leave their block, and nothing is pooled across hosts.
* **Bytes:** four single-thread processes on four cores, saturated by design; from 22:02 to 22:50, eight (below). No encode time is claimed. Bytes and PSNR did not move with load: C1 reproduced the bytes run's cell byte for byte, and the 20 10bit anchor streams re-coded for the decode matched the bytes run's unit sizes, every unit (`streams.jsonl`).
* **Decode:** one decode in flight. On host 1, vmstat's 5 s samples read 29–34 % CPU busy over a 1× phase and 16–25 % over a 4× phase (about 1.2 and 0.8 of 4 cores): the host is not saturated at either throttle. Nothing is claimed past 4×, for concurrent decodes, for a phone or for another host.

### Timeline as run, and deviations

T0 21:30:30 UTC. Setup done 21:36 (0:06); stage 1 21:35–21:48 (C5, C7, C8 need the stage-2 rows and ran after them); stage 2 21:48–22:57; stage 3 22:57–01:13:46 (host 1 to 23:29, host 2 from 23:30:24); stage 4 01:13:47–01:28:17, with 26 min left at its start (≥ 25 needed). Every stage ended inside its window. `results/split-preview-b/timeline.txt` holds the minute-by-minute record.

* **Stage 2's items overlapped.** A waiter script misread item 1 as finished (twice, at 21:49 and 22:02). The second time items 2, 3 and 4 ran beside item 1, eight processes on four cores, and item 2 saw only the one partner then known (`dbts_b1` Q 16) and coded that one cell. Item 2 was run again in full after item 1. Bytes do not depend on order or load (C1), so every row stands; only "each item finishes before the next starts" was not kept.
* **Rows restored.** A `git stash` replaced the file item 1 was appending to; its rows were read back through the process's open handle. A later copy cut items 2–4's rows from the file; they were restored from the commits that held them (7b404705, c981a744, 95aa441e). All 54 cells are in `cells.jsonl`, each once, each with every frame exact.
* **Two decode blocks.** Stage 3 was cut at 23:29 after 8 complete rounds on host 1 (`decode-host1.json`); it restarted as a new block on host 2 (`decode.json`). Host 1's block is under §7's floor of 10 rounds and is reported, not read.
* **Partners.** Every partner is the anchor's own Q (table below); S1 and S16 at the partner rung are what the decode ran.
* **"Q 8's quality" (S3)** was read as the top8 points whose PSNR lies above the 10bit Q 12 rung's: the top8 Q 8 cells, 47.97–50.13 dB. The protocol does not define the band further.
* **"In order" (§Stage 3)** follows §7's in-order pattern: a fresh decoder, the chain from the first middle slice's keyframe decoded off the clock (none at G = 1), then the 16 slices timed.

### Checks, each with its mutation

| # | as it read | mutated | the mutation read |
| --- | --- | --- | --- |
| C1 | 10bit Q 32 G 1 on `dbts_b2`: 1 169 647 B, 42.805 dB, the bytes run's to the byte and 0.001 dB; the 20 anchor streams unit for unit the bytes run's | `--cq-level` 33 | 1 076 014 B, 42.676 dB: mismatch named |
| C2 | uncoded top8's mean square equals the v mod 4 histogram weighted 0, 1, 4, 1 (clamp 4, 9) to 1e−9 on all five series: 0.516, 0.988, 0.773, 0.966, 1.012 | floor, p = v ≫ 2 | 1.20, 2.30, 1.80, 2.26, 2.50 against the same histogram: mismatch on every series (the protocol expected ≈ 3.5; the residues are not evenly spread, see S1) |
| C3 | every frame of every cell exact (3 614 frames, 54 cells) | the residual taken as v & 3 onto p̂ ≪ 2 | 0 of 71 exact on top8 Q 16 `dbts_b2`; 71 of 71 when applied to the split's own lossless top (v ≫ 2, Q 0) |
| C4 | top8 Q 16 `dbts_b2`: aomdec's frames equal dav1d's sample for sample, and ≪ 2 give 45.170 dB, the row's | shift 0 | 12.93 dB: mismatch named |
| C5 | each 10bit curve against itself: 1.000 at every point; tol finite (0.28–0.37 at G 1, 0.71–1.12 at G 16) | bytes × 1.10; PSNR ± 0.3 dB | 1.100 at every point; +0.3 dB → 0.79–0.98 (< 1), −0.3 dB → 1.02–1.27 (> 1), every series and G |
| C6 | every timed frame of every unit, after back-conversion, hashes as native dav1d's ≪ shift (16 of 16, every unit of every round of both blocks) | `--mutate hash`; top8's shift 0 | 0 of 16 on every unit; 0 of 16 on the two top8 units, 16 of 16 on the three 10bit units |
| C7 | `split_preview_report.py --test`: ratio 0.75 and A/A 1.00 recovered inside their intervals, under a per-round drift too | mean for median; A/A rule off; pairs across rounds; no shuffles | each fails its assertion: the mean misses 0.75 under slow rounds, a 20 % A/A is kept, cross-round pairs miss 0.75 under drift, a noise-only order spread is flagged |
| C8 | partners printed with Δ PSNR (table below), Δ −0.47 to +0.01 dB | the 10bit curve given as top8's | partner = anchor, Δ = 0.000 on all ten |

### Bytes and quality (stage 2)

**Equal Q, G = 1** (bytes over the series; PSNR dB; top8 ÷ 10bit bytes; Δ PSNR top8 − 10bit)

| series | Q | 10bit B | 10bit dB | top8 B | top8 dB | bytes ratio | Δ dB |
| --- | --- | --- | --- | --- | --- | --- | --- |
| dbts_b1 | 8 | 23477229 | 51.953 | 17310138 | 49.779 | 0.737 | -2.174 |
| dbts_b1 | 12 | 10876970 | 48.330 | 9032587 | 47.551 | 0.830 | -0.779 |
| dbts_b1 | 16 | 5648353 | 46.604 | 5390718 | 46.360 | 0.954 | -0.244 |
| dbts_b1 | 24 | 2642917 | 45.257 | 2714766 | 45.186 | 1.027 | -0.072 |
| dbts_b1 | 32 | 1217807 | 44.004 | 1283651 | 44.016 | 1.054 | +0.012 |
| dbts_b1 | 56 | 151074 | 39.676 | 171097 | 40.041 | 1.133 | +0.365 |
| dbts_b2 | 8 | 21589763 | 49.735 | 16026990 | 47.972 | 0.742 | -1.763 |
| dbts_b2 | 12 | 10482562 | 46.949 | 8956251 | 46.252 | 0.854 | -0.697 |
| dbts_b2 | 16 | 5885102 | 45.473 | 5613578 | 45.170 | 0.954 | -0.303 |
| dbts_b2 | 24 | 2677071 | 44.031 | 2768677 | 43.923 | 1.034 | -0.107 |
| dbts_b2 | 32 | 1169647 | 42.805 | 1245489 | 42.782 | 1.065 | -0.023 |
| dbts_b2 | 56 | 157681 | 38.766 | 180199 | 39.071 | 1.143 | +0.305 |
| dbts_b3 | 8 | 28263372 | 50.285 | 21565216 | 48.031 | 0.763 | -2.254 |
| dbts_b3 | 12 | 14363936 | 46.513 | 12048288 | 45.636 | 0.839 | -0.878 |
| dbts_b3 | 16 | 7786566 | 44.542 | 7333068 | 44.272 | 0.942 | -0.270 |
| dbts_b3 | 24 | 3128856 | 42.815 | 3269115 | 42.780 | 1.045 | -0.035 |
| dbts_b3 | 32 | 1347287 | 41.688 | 1419086 | 41.689 | 1.053 | +0.002 |
| dbts_b3 | 56 | 192623 | 37.521 | 223258 | 37.873 | 1.159 | +0.352 |
| dbts_b4 | 8 | 23273374 | 51.877 | 17977300 | 49.813 | 0.772 | -2.063 |
| dbts_b4 | 12 | 12075090 | 48.353 | 10388272 | 47.434 | 0.860 | -0.919 |
| dbts_b4 | 16 | 6711955 | 46.499 | 6465327 | 46.058 | 0.963 | -0.440 |
| dbts_b4 | 24 | 2675179 | 44.705 | 2858275 | 44.546 | 1.068 | -0.159 |
| dbts_b4 | 32 | 960544 | 43.433 | 1063287 | 43.189 | 1.107 | -0.244 |
| dbts_b4 | 56 | 147437 | 39.865 | 176060 | 40.296 | 1.194 | +0.431 |
| dbts_b5 | 8 | 13050687 | 51.905 | 10136480 | 50.127 | 0.777 | -1.779 |
| dbts_b5 | 12 | 6947935 | 49.051 | 6155888 | 48.220 | 0.886 | -0.830 |
| dbts_b5 | 16 | 4157799 | 47.470 | 4086561 | 46.998 | 0.983 | -0.471 |
| dbts_b5 | 24 | 1973804 | 45.798 | 2061699 | 45.527 | 1.045 | -0.271 |
| dbts_b5 | 32 | 806333 | 44.277 | 878380 | 44.013 | 1.089 | -0.264 |
| dbts_b5 | 56 | 116531 | 39.996 | 137732 | 40.424 | 1.182 | +0.428 |
| dbts_b_max | 16 | 7994364 | 47.270 | 7866404 | 46.726 | 0.984 | -0.544 |
| dbts_b_max | 32 | 1502875 | 44.658 | 1638948 | 44.233 | 1.091 | -0.425 |

**The control at equal Q** (top8at10; G = 1)

| series | Q | top8at10 B | top8at10 dB | top8at10 ÷ 10bit | top8 ÷ top8at10 | Δ dB top8 − top8at10 |
| --- | --- | --- | --- | --- | --- | --- |
| dbts_b2 | 16 | 5929922 | 45.447 | 1.008 | 0.947 | -0.277 |
| dbts_b2 | 32 | 1170396 | 42.790 | 1.001 | 1.064 | -0.008 |
| dbts_b5 | 16 | 4229735 | 47.414 | 1.017 | 0.966 | -0.416 |
| dbts_b5 | 32 | 805599 | 44.236 | 0.999 | 1.090 | -0.223 |

**Equal PSNR** (each point against the 10bit curve at its PSNR; ratios top8 ÷ 10bit for bytes and residual, differences for SSIM and the displayed-level change in points; — outside the 10bit curve)

| series | form | G | Q | dB | bytes ratio | class | tol (ln) | residual ratio | class | Δ SSIM | Δ differ pts | Δ >1 pts |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dbts_b1 | top8 | 1 | 56 | 40.041 | 0.950 | tie | 0.370 | 1.003 | tie | +0.0280 | +0.17 | +0.51 |
| dbts_b1 | top8 | 1 | 32 | 44.016 | 1.046 | tie | 0.370 | 1.002 | tie | +0.0007 | +0.11 | +0.33 |
| dbts_b1 | top8 | 1 | 24 | 45.186 | 1.074 | tie | 0.370 | 1.002 | tie | +0.0001 | +0.13 | +0.39 |
| dbts_b1 | top8 | 1 | 16 | 46.360 | 1.095 | tie | 0.370 | 1.002 | tie | +0.0003 | +0.14 | +0.48 |
| dbts_b1 | top8 | 1 | 12 | 47.551 | 1.116 | tie | 0.370 | 1.002 | tie | +0.0005 | +0.13 | +0.61 |
| dbts_b1 | top8 | 1 | 8 | 49.779 | 1.170 | tie | 0.370 | 1.003 | tie | +0.0009 | +0.17 | +1.20 |
| dbts_b1 | top8 | 16 | 32 | 44.001 | 1.083 | tie | 0.880 | 1.002 | tie | +0.0004 | +0.12 | +0.33 |
| dbts_b1 | top8 | 16 | 16 | 46.392 | 1.182 | tie | 0.880 | 1.004 | tie | +0.0002 | +0.16 | +0.52 |
| dbts_b2 | top8 | 1 | 56 | 39.071 | 0.982 | tie | 0.335 | 1.007 | tie | +0.0134 | +0.21 | +0.60 |
| dbts_b2 | top8 | 1 | 32 | 42.782 | 1.077 | tie | 0.335 | 1.005 | tie | +0.0000 | +0.20 | +0.58 |
| dbts_b2 | top8 | 1 | 24 | 43.923 | 1.112 | tie | 0.335 | 1.006 | tie | -0.0000 | +0.21 | +0.65 |
| dbts_b2 | top8 | 1 | 16 | 45.170 | 1.125 | tie | 0.335 | 1.006 | tie | +0.0003 | +0.22 | +0.75 |
| dbts_b2 | top8 | 1 | 12 | 46.252 | 1.122 | tie | 0.335 | 1.005 | tie | +0.0006 | +0.20 | +0.84 |
| dbts_b2 | top8 | 1 | 8 | 47.972 | 1.173 | tie | 0.335 | 1.005 | tie | +0.0010 | +0.22 | +1.26 |
| dbts_b2 | top8 | 16 | 32 | 42.623 | 1.132 | tie | 0.787 | 1.006 | tie | -0.0001 | +0.21 | +0.58 |
| dbts_b2 | top8 | 16 | 16 | 45.120 | 1.256 | tie | 0.787 | 1.007 | tie | +0.0001 | +0.31 | +0.90 |
| dbts_b2 | top8at10 | 1 | 32 | 42.790 | 1.008 | tie | 0.335 | 1.000 | tie | +0.0001 | +0.06 | +0.16 |
| dbts_b2 | top8at10 | 1 | 16 | 45.447 | 1.022 | tie | 0.335 | 1.000 | tie | +0.0002 | +0.06 | +0.15 |
| dbts_b3 | top8 | 1 | 56 | 37.873 | 0.983 | tie | 0.300 | 1.003 | tie | +0.0167 | +0.14 | +0.41 |
| dbts_b3 | top8 | 1 | 32 | 41.689 | 1.052 | tie | 0.300 | 1.002 | tie | +0.0002 | +0.10 | +0.30 |
| dbts_b3 | top8 | 1 | 24 | 42.780 | 1.073 | tie | 0.300 | 1.002 | tie | +0.0002 | +0.10 | +0.32 |
| dbts_b3 | top8 | 1 | 16 | 44.272 | 1.086 | tie | 0.300 | 1.002 | tie | +0.0006 | +0.10 | +0.41 |
| dbts_b3 | top8 | 1 | 12 | 45.636 | 1.102 | tie | 0.300 | 1.001 | tie | +0.0009 | +0.10 | +0.57 |
| dbts_b3 | top8 | 1 | 8 | 48.031 | 1.143 | tie | 0.300 | 1.002 | tie | +0.0015 | +0.15 | +1.24 |
| dbts_b3 | top8 | 16 | 32 | 41.595 | 1.091 | tie | 1.104 | 1.001 | tie | -0.0001 | +0.10 | +0.30 |
| dbts_b3 | top8 | 16 | 16 | 44.295 | 1.211 | tie | 1.104 | 1.003 | tie | +0.0005 | +0.14 | +0.49 |
| dbts_b4 | top8 | 1 | 56 | 40.296 | 0.952 | tie | 0.298 | 1.000 | tie | +0.0015 | +0.21 | +0.62 |
| dbts_b4 | top8 | 1 | 32 | 43.189 | 1.258 | tie | 0.298 | 1.003 | tie | -0.0208 | -0.04 | -0.10 |
| dbts_b4 | top8 | 1 | 24 | 44.546 | 1.214 | tie | 0.298 | 1.002 | tie | -0.0088 | +0.03 | +0.09 |
| dbts_b4 | top8 | 1 | 16 | 46.058 | 1.207 | tie | 0.298 | 1.008 | tie | -0.0046 | -0.01 | +0.09 |
| dbts_b4 | top8 | 1 | 12 | 47.434 | 1.151 | tie | 0.298 | 0.994 | tie | -0.0019 | +0.01 | +0.34 |
| dbts_b4 | top8 | 1 | 8 | 49.813 | 1.134 | tie | 0.298 | 0.968 | tie | +0.0000 | +0.23 | +1.44 |
| dbts_b4 | top8 | 16 | 32 | 43.257 | 1.214 | tie | 1.115 | 1.002 | tie | -0.0091 | +0.05 | +0.14 |
| dbts_b4 | top8 | 16 | 16 | 46.137 | 1.397 | tie | 1.115 | 1.023 | tie | -0.0039 | +0.04 | +0.19 |
| dbts_b5 | top8 | 1 | 56 | 40.424 | 0.974 | tie | 0.279 | 1.002 | tie | +0.0047 | +0.24 | +0.68 |
| dbts_b5 | top8 | 1 | 32 | 44.013 | 1.227 | tie | 0.279 | 1.004 | tie | -0.0179 | -0.02 | -0.06 |
| dbts_b5 | top8 | 1 | 24 | 45.527 | 1.225 | tie | 0.279 | 1.007 | tie | -0.0095 | +0.01 | +0.06 |
| dbts_b5 | top8 | 1 | 16 | 46.998 | 1.213 | tie | 0.279 | 1.009 | tie | -0.0047 | -0.01 | +0.12 |
| dbts_b5 | top8 | 1 | 12 | 48.220 | 1.160 | tie | 0.279 | 0.995 | tie | -0.0021 | +0.03 | +0.40 |
| dbts_b5 | top8 | 1 | 8 | 50.127 | 1.150 | tie | 0.279 | 0.976 | tie | -0.0007 | +0.18 | +1.20 |
| dbts_b5 | top8 | 16 | 32 | 44.028 | 1.206 | tie | 0.705 | 1.005 | tie | -0.0098 | +0.07 | +0.19 |
| dbts_b5 | top8 | 16 | 16 | 47.000 | 1.430 | tie | 0.705 | 1.022 | tie | -0.0046 | +0.07 | +0.25 |
| dbts_b5 | top8at10 | 1 | 32 | 44.236 | 1.018 | tie | 0.279 | 1.000 | tie | -0.0017 | +0.03 | +0.08 |
| dbts_b5 | top8at10 | 1 | 16 | 47.414 | 1.043 | tie | 0.279 | 1.001 | tie | -0.0011 | +0.01 | +0.02 |
| dbts_b_max | top8 | 1 | 32 | 44.233 | — | — | nan | — | — | — | — | — |
| dbts_b_max | top8 | 1 | 16 | 46.726 | 1.394 | no tol | nan | 1.018 | no tol | -0.0073 | -0.13 | -0.28 |

**Partners** (top8 G = 1 rung nearest the 10bit anchor's PSNR)

| series | anchor Q | anchor dB | partner Q | Δ dB |
| --- | --- | --- | --- | --- |
| dbts_b1 | 16 | 46.604 | 16 | -0.244 |
| dbts_b1 | 32 | 44.004 | 32 | +0.012 |
| dbts_b2 | 16 | 45.473 | 16 | -0.303 |
| dbts_b2 | 32 | 42.805 | 32 | -0.023 |
| dbts_b3 | 16 | 44.542 | 16 | -0.270 |
| dbts_b3 | 32 | 41.688 | 32 | +0.002 |
| dbts_b4 | 16 | 46.499 | 16 | -0.440 |
| dbts_b4 | 32 | 43.433 | 32 | -0.244 |
| dbts_b5 | 16 | 47.470 | 16 | -0.471 |
| dbts_b5 | 32 | 44.277 | 32 | -0.264 |

Read by its clauses, with what drives each:

* **tol decides the bytes.** At G = 1 the largest error predicting an interior 10bit rung from its neighbours is 0.28–0.37 in ln, set by Q 8 predicted from Q 2 and Q 12 (the smallest interior error per series is 0.035–0.16); at G = 16, with rungs 2, 8, 16, 32, 56 only, 0.71–1.12. Every top8 ÷ 10bit ratio, 0.95–1.43, lies within it: **a tie in every cell by the rule**, though the point ratios run 1.05–1.26 at G = 1 and 1.08–1.43 at G = 16 from the crossover up. The same holds for the residual (ratios 0.97–1.02, the residual curve's tol 0.04–0.07 ln at G = 1 and 0.06–0.12 at G = 16).
* **The Q 56 points** (0.95–0.98) are interpolated across the 10bit Q 32–Q 56 gap, 4 dB wide, where the curve bends; they carry most of S2's and S6's misses below 1 and in SSIM.
* **S4's sign at Q 32**: top8 has lower PSNR than 10bit at Q 32 on `dbts_b2`, `dbts_b4`, `dbts_b5` (−0.02, −0.24, −0.26 dB) while larger in bytes, where T3 predicted higher PSNR.
* **The control** (S5): top8at10 ÷ 10bit at equal PSNR is 1.008–1.043; top8 ÷ top8at10 at equal Q is 0.95–0.97 at Q 16 and 1.06–1.09 at Q 32, the sign T3's λ ratio (0.96, 1.18) gives. So most of top8's extra bytes at Q 32 are the 8-bit coder's, not the data's — on `dbts_b2` and `dbts_b5` only.

### Decode (stage 3)

**Host 2, the block read** (21 rounds):

* A/A 1×: 10bit S1′ ÷ 10bit S1 1.005 [0.993–1.013] over 210 pairs — kept
* A/A 4×: 10bit S1′ ÷ 10bit S1 0.987 [0.977–1.001] over 105 pairs — kept
| series | anchor Q | throttle | G | n | 10bit ms | top8 ms | top8 ÷ 10bit [95 %] | speed | Δ dB | |Δ|·8 % | order effect | state | S8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dbts_b1 | 16 | 1× | 1 | 21 | 89.7 | 70.6 | 0.787 [0.754–1.005] | not decided | -0.244 | 2.0% | 24% (p 0.448) | read | not decided |
| dbts_b1 | 16 | 1× | 16 | 21 | 103.1 | 82.6 | 0.806 [0.707–0.853] | faster | -0.303 | 2.4% | 23% (p 0.018) | not read: order | — |
| dbts_b1 | 32 | 1× | 1 | 21 | 76.3 | 59.4 | 0.787 [0.756–0.993] | faster | +0.012 | 0.1% | 29% (p 0.195) | read | not decided |
| dbts_b1 | 32 | 1× | 16 | 21 | 82.1 | 63.3 | 0.783 [0.725–0.831] | faster | +0.037 | 0.3% | 33% (p 0.013) | not read: order | — |
| dbts_b1 | 32 | 4× | 1 | 21 | 280.4 | 210.1 | 0.767 [0.701–1.026] | not decided | +0.012 | 0.1% | 31% (p 0.520) | read | not decided |
| dbts_b1 | 32 | 4× | 16 | 21 | 275.7 | 211.1 | 0.785 [0.735–0.832] | faster | +0.037 | 0.3% | 34% (p 0.065) | read | held |
| dbts_b2 | 16 | 1× | 1 | 21 | 55.2 | 43.7 | 0.793 [0.732–0.943] | faster | -0.303 | 2.4% | 22% (p 0.198) | read | not decided |
| dbts_b2 | 16 | 1× | 16 | 21 | 62.7 | 50.1 | 0.798 [0.757–0.880] | faster | -0.375 | 3.0% | 19% (p 0.037) | not read: order | — |
| dbts_b2 | 16 | 4× | 1 | 21 | 165.1 | 127.4 | 0.776 [0.667–0.921] | faster | -0.303 | 2.4% | 27% (p 0.185) | read | not decided |
| dbts_b2 | 16 | 4× | 16 | 21 | 178.8 | 136.5 | 0.796 [0.720–0.842] | faster | -0.375 | 3.0% | 31% (p 0.013) | not read: order | — |
| dbts_b2 | 32 | 1× | 1 | 21 | 44.3 | 35.9 | 0.806 [0.718–0.929] | faster | -0.023 | 0.2% | 28% (p 0.022) | not read: order | — |
| dbts_b2 | 32 | 1× | 16 | 21 | 45.0 | 34.7 | 0.765 [0.722–0.831] | faster | -0.025 | 0.2% | 15% (p 0.320) | read | held |
| dbts_b3 | 16 | 1× | 1 | 21 | 65.4 | 50.7 | 0.797 [0.729–0.860] | faster | -0.270 | 2.2% | 21% (p 0.025) | not read: order | — |
| dbts_b3 | 16 | 1× | 16 | 21 | 71.2 | 57.9 | 0.822 [0.774–0.902] | faster | -0.329 | 2.6% | 22% (p 0.015) | not read: order | — |
| dbts_b3 | 32 | 1× | 1 | 21 | 46.9 | 37.6 | 0.791 [0.757–0.919] | faster | +0.002 | 0.0% | 30% (p 0.040) | not read: order | — |
| dbts_b3 | 32 | 1× | 16 | 21 | 49.0 | 38.5 | 0.798 [0.735–0.836] | faster | +0.017 | 0.1% | 28% (p 0.018) | not read: order | — |
| dbts_b3 | 32 | 4× | 1 | 21 | 159.8 | 126.1 | 0.770 [0.724–1.034] | not decided | +0.002 | 0.0% | 32% (p 0.520) | read | not decided |
| dbts_b3 | 32 | 4× | 16 | 21 | 164.3 | 121.6 | 0.762 [0.691–0.820] | faster | +0.017 | 0.1% | 39% (p 0.065) | read | held |
| dbts_b4 | 16 | 1× | 1 | 21 | 58.7 | 47.5 | 0.807 [0.773–0.922] | faster | -0.440 | 3.5% | 21% (p 0.113) | read | not decided |
| dbts_b4 | 16 | 1× | 16 | 21 | 66.1 | 53.8 | 0.795 [0.767–0.858] | faster | -0.466 | 3.7% | 21% (p 0.035) | not read: order | — |
| dbts_b4 | 32 | 1× | 1 | 21 | 46.2 | 37.7 | 0.816 [0.723–0.976] | faster | -0.244 | 2.0% | 30% (p 0.015) | not read: order | — |
| dbts_b4 | 32 | 1× | 16 | 21 | 49.3 | 38.5 | 0.801 [0.709–0.864] | faster | -0.057 | 0.5% | 29% (p 0.013) | not read: order | — |
| dbts_b4 | 32 | 4× | 1 | 21 | 164.3 | 125.0 | 0.813 [0.717–0.938] | faster | -0.244 | 2.0% | 39% (p 0.007) | not read: order | — |
| dbts_b4 | 32 | 4× | 16 | 21 | 159.7 | 122.6 | 0.770 [0.713–0.841] | faster | -0.057 | 0.5% | 36% (p 0.058) | read | held |
| dbts_b5 | 16 | 1× | 1 | 21 | 51.4 | 41.4 | 0.817 [0.784–0.946] | faster | -0.471 | 3.8% | 21% (p 0.015) | not read: order | — |
| dbts_b5 | 16 | 1× | 16 | 21 | 58.9 | 47.5 | 0.815 [0.762–0.850] | faster | -0.575 | 4.6% | 18% (p 0.013) | not read: order | — |
| dbts_b5 | 32 | 1× | 1 | 21 | 43.4 | 35.0 | 0.814 [0.711–0.995] | faster | -0.264 | 2.1% | 30% (p 0.025) | not read: order | — |
| dbts_b5 | 32 | 1× | 16 | 21 | 45.4 | 34.7 | 0.770 [0.730–0.826] | faster | -0.081 | 0.7% | 22% (p 0.163) | read | held |
| dbts_b5 | 32 | 4× | 1 | 21 | 155.2 | 116.9 | 0.758 [0.716–0.974] | faster | -0.264 | 2.1% | 33% (p 0.282) | read | not decided |
| dbts_b5 | 32 | 4× | 16 | 21 | 144.3 | 114.4 | 0.787 [0.744–0.855] | faster | -0.081 | 0.7% | 38% (p 0.015) | not read: order | — |

**Host 1, reported, not read** (8 rounds, under §7's floor of 10):

* A/A 1×: 10bit S1′ ÷ 10bit S1 1.003 [0.989–1.032] over 80 pairs — kept
* A/A 4×: 10bit S1′ ÷ 10bit S1 0.988 [0.955–1.018] over 40 pairs — kept
| series | anchor Q | throttle | G | n | 10bit ms | top8 ms | top8 ÷ 10bit [95 %] | speed | Δ dB | |Δ|·8 % | order effect | state | S8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dbts_b1 | 16 | 1× | 1 | 8 | 85.7 | 68.3 | 0.870 [0.610–1.022] | not decided | -0.244 | 2.0% | 30% (p 0.258) | not read: 8 rounds | — |
| dbts_b1 | 16 | 1× | 16 | 8 | 99.4 | 72.2 | 0.763 [0.576–0.909] | faster | -0.303 | 2.4% | 25% (p 0.273) | not read: 8 rounds | — |
| dbts_b1 | 32 | 1× | 1 | 8 | 73.3 | 58.8 | 0.822 [0.543–1.039] | not decided | +0.012 | 0.1% | 34% (p 0.258) | not read: 8 rounds | — |
| dbts_b1 | 32 | 1× | 16 | 8 | 78.2 | 62.6 | 0.780 [0.560–1.062] | not decided | +0.037 | 0.3% | 28% (p 0.713) | not read: 8 rounds | — |
| dbts_b1 | 32 | 4× | 1 | 8 | 263.8 | 209.2 | 0.819 [0.487–1.083] | not decided | +0.012 | 0.1% | 41% (p 0.258) | not read: 8 rounds | — |
| dbts_b1 | 32 | 4× | 16 | 8 | 278.1 | 210.7 | 0.796 [0.514–1.015] | not decided | +0.037 | 0.3% | 35% (p 0.273) | not read: 8 rounds | — |
| dbts_b2 | 16 | 1× | 1 | 8 | 55.1 | 41.4 | 0.743 [0.525–0.969] | faster | -0.303 | 2.4% | 29% (p 0.453) | not read: 8 rounds | — |
| dbts_b2 | 16 | 1× | 16 | 8 | 57.2 | 45.4 | 0.765 [0.607–0.919] | faster | -0.375 | 3.0% | 21% (p 0.273) | not read: 8 rounds | — |
| dbts_b2 | 16 | 4× | 1 | 8 | 159.3 | 118.8 | 0.735 [0.477–1.015] | not decided | -0.303 | 2.4% | 35% (p 0.507) | not read: 8 rounds | — |
| dbts_b2 | 16 | 4× | 16 | 8 | 167.4 | 116.1 | 0.726 [0.494–0.983] | faster | -0.375 | 3.0% | 32% (p 0.475) | not read: 8 rounds | — |
| dbts_b2 | 32 | 1× | 1 | 8 | 41.3 | 30.5 | 0.783 [0.495–0.996] | faster | -0.023 | 0.2% | 37% (p 0.258) | not read: 8 rounds | — |
| dbts_b2 | 32 | 1× | 16 | 8 | 43.4 | 34.5 | 0.765 [0.539–1.069] | not decided | -0.025 | 0.2% | 30% (p 0.713) | not read: 8 rounds | — |
| dbts_b3 | 16 | 1× | 1 | 8 | 62.7 | 47.4 | 0.764 [0.574–0.936] | faster | -0.270 | 2.2% | 25% (p 0.258) | not read: 8 rounds | — |
| dbts_b3 | 16 | 1× | 16 | 8 | 67.3 | 52.5 | 0.789 [0.642–0.928] | faster | -0.329 | 2.6% | 19% (p 0.273) | not read: 8 rounds | — |
| dbts_b3 | 32 | 1× | 1 | 8 | 45.1 | 34.6 | 0.827 [0.521–1.086] | not decided | +0.002 | 0.0% | 37% (p 0.258) | not read: 8 rounds | — |
| dbts_b3 | 32 | 1× | 16 | 8 | 46.7 | 34.7 | 0.747 [0.533–0.931] | faster | +0.017 | 0.1% | 29% (p 0.273) | not read: 8 rounds | — |
| dbts_b3 | 32 | 4× | 1 | 8 | 161.4 | 115.0 | 0.756 [0.447–0.998] | faster | +0.002 | 0.0% | 41% (p 0.258) | not read: 8 rounds | — |
| dbts_b3 | 32 | 4× | 16 | 8 | 159.9 | 114.3 | 0.746 [0.450–1.038] | not decided | +0.017 | 0.1% | 40% (p 0.273) | not read: 8 rounds | — |
| dbts_b4 | 16 | 1× | 1 | 8 | 55.3 | 45.2 | 0.858 [0.514–0.985] | faster | -0.440 | 3.5% | 40% (p 0.258) | not read: 8 rounds | — |
| dbts_b4 | 16 | 1× | 16 | 8 | 62.5 | 48.9 | 0.819 [0.604–0.959] | faster | -0.466 | 3.7% | 26% (p 0.273) | not read: 8 rounds | — |
| dbts_b4 | 32 | 1× | 1 | 8 | 44.5 | 34.4 | 0.817 [0.508–1.201] | not decided | -0.244 | 2.0% | 38% (p 0.472) | not read: 8 rounds | — |
| dbts_b4 | 32 | 1× | 16 | 8 | 46.6 | 35.5 | 0.769 [0.555–1.020] | not decided | -0.057 | 0.5% | 28% (p 0.500) | not read: 8 rounds | — |
| dbts_b4 | 32 | 4× | 1 | 8 | 151.3 | 119.7 | 0.794 [0.527–1.019] | not decided | -0.244 | 2.0% | 34% (p 0.258) | not read: 8 rounds | — |
| dbts_b4 | 32 | 4× | 16 | 8 | 155.0 | 109.9 | 0.747 [0.481–0.986] | faster | -0.057 | 0.5% | 36% (p 0.273) | not read: 8 rounds | — |
| dbts_b5 | 16 | 1× | 1 | 8 | 47.2 | 39.7 | 0.816 [0.566–1.040] | not decided | -0.471 | 3.8% | 31% (p 0.258) | not read: 8 rounds | — |
| dbts_b5 | 16 | 1× | 16 | 8 | 55.4 | 42.8 | 0.843 [0.614–0.941] | faster | -0.575 | 4.6% | 27% (p 0.273) | not read: 8 rounds | — |
| dbts_b5 | 32 | 1× | 1 | 8 | 41.4 | 30.6 | 0.790 [0.500–1.006] | not decided | -0.264 | 2.1% | 37% (p 0.258) | not read: 8 rounds | — |
| dbts_b5 | 32 | 1× | 16 | 8 | 42.2 | 31.5 | 0.809 [0.587–0.986] | faster | -0.081 | 0.7% | 27% (p 0.273) | not read: 8 rounds | — |
| dbts_b5 | 32 | 4× | 1 | 8 | 153.7 | 118.1 | 0.735 [0.535–1.002] | not decided | -0.264 | 2.1% | 27% (p 0.733) | not read: 8 rounds | — |
| dbts_b5 | 32 | 4× | 16 | 8 | 159.2 | 109.0 | 0.702 [0.479–1.022] | not decided | -0.081 | 0.7% | 32% (p 0.713) | not read: 8 rounds | — |

Read with these:

* **The A/A held** at both throttles on host 2 (1.005 [0.993–1.013] at 1×, 0.987 [0.977–1.001] at 4×), so no cell is void.
* **The intervals are 2–4 times the sizing's ±4–5 %.** The cause is in the rows: the unit run first in its worker takes 0.66–0.88 (median 0.77) of the same unit's time in the other positions, on host 2. The Williams rows put each unit first equally often, so the median is balanced, but the per-round ratio spreads with who ran first. The same effect is what §7's order rule flags in 17 of the 30 cells (largest predecessor median 18–39 % from the whole, beyond 95 % of 400 shuffles); those are not read.
* **Equal quality**: every partner is the anchor's own Q, Δ −0.58 to +0.04 dB; |Δ| · 8 % is at most 4.6 %, under every decided cell's distance from 1, so no cell is set aside for it.
* **Host 1's block** (8 rounds) gives medians 0.70–0.87 in the same cells, consistent with host 2's, and is not read: under 10 rounds, and on another CPU.
* *Throughput is not quoted*: every figure is the latency of one frame, one decode in flight.

### S1–S8

* **S1 held by its clause** (no rung over 58.5 dB: the highest top8 PSNR is 50.13 dB). Its second part is wrong: the uncoded top8 lands at **60.15–63.07 dB**, not 58.4 ± 0.1 (mean square 0.52–1.01, not 1.5). T1 assumed v mod 4 evenly spread; on these volumes it is not (C2 matches the histogram exactly), so the ceiling is per series and 1.7–4.7 dB higher than T1's.
* **S2 refuted**: 14 matched points from the noise up, 0.950–1.258; outside 1.00–1.12 on every series (above on `dbts_b2` G 1 Q 16 1.125, `dbts_b4` and `dbts_b5` at Q 32, 1.21–1.26 at G 1 and G 16, `dbts_b2` G 16 1.13–1.26; below at every Q 56 point, 0.95–0.98).
* **S3 refuted**: the five Q 8 points are 1.134–1.173, inside 1.05–1.35, but not above S2's range on `dbts_b2`, `dbts_b4`, `dbts_b5`.
* **S4 refuted**: at Q 8 and Q 12 top8 is smaller and lower in PSNR on all five, as predicted (0.74–0.89×, −0.70 to −2.25 dB); at Q 56 larger (1.13–1.19×) and higher (+0.31 to +0.43 dB) on all five; at Q 32 larger (1.05–1.11×) on all five but lower in PSNR on `dbts_b2`, `dbts_b4`, `dbts_b5` (−0.02 to −0.26 dB) — three series, the clause's count.
* **S5 refuted**: top8at10 ÷ 10bit at equal PSNR 1.008 and 1.022 on `dbts_b2`, 1.018 and **1.043** on `dbts_b5` (Q 32, Q 16): one outside ±3 %. Its second part held: top8 ÷ top8at10 at equal Q 0.947, 0.966 at Q 16 and 1.064, 1.090 at Q 32, the signs of T3's λ ratio.
* **S6 refuted**: SSIM differs by more than 0.002 at a matched point on all five series (+0.0015 to +0.028 at the Q 56 points, −0.018 and −0.021 at Q 32 on `dbts_b5`, `dbts_b4`); the displayed-level change is inside ±2 points everywhere (share differing −0.04 to +0.31 points, differing by more than one code −0.10 to +1.44).
* **S7 refuted**: residual ratio 0.968–1.023 over 40 matched points; outside 0.98–1.02 at Q 8 on `dbts_b4` (0.968) and `dbts_b5` (0.976), and at G 16 Q 16 on `dbts_b4` (1.023) and `dbts_b5` (1.022).
* **S8 not decided**: of 30 cells, 13 read; 5 held (inside 0.55–0.90: 4× G 16 on `dbts_b1`, `dbts_b3`, `dbts_b4`, 1× G 16 on `dbts_b2` Q 32 and `dbts_b5` Q 32), 8 not decided (their interval reaches past 0.90), none refuted; 17 not read for order.

### The verdict per series and quality

| series | anchor Q | partner Q | bytes ratio | bytes | residual ratio | residual | decode | verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dbts_b1 | 16 | 16 | 1.095 | tie | 1.002 | tie | 1 of 2 read, not all faster | a trade: +9.5% bytes (a tie) for 21% less decode time a frame in the read cells |
| dbts_b1 | 32 | 32 | 1.046 | tie | 1.002 | tie | 3 of 4 read, not all faster | a trade: +4.6% bytes (a tie) for 21%, 23%, 22% less decode time a frame in the read cells |
| dbts_b2 | 16 | 16 | 1.125 | tie | 1.006 | tie | 2 of 4 read, not all faster | a trade: +12.5% bytes (a tie) for 21%, 22% less decode time a frame in the read cells |
| dbts_b2 | 32 | 32 | 1.077 | tie | 1.005 | tie | 1 of 2 read, not all faster | a trade: +7.7% bytes (a tie) for 23% less decode time a frame in the read cells |
| dbts_b3 | 16 | 16 | 1.086 | tie | 1.002 | tie | 0 of 2 read, not all faster | not decided (no decode cell read) |
| dbts_b3 | 32 | 32 | 1.052 | tie | 1.002 | tie | 2 of 4 read, not all faster | a trade: +5.2% bytes (a tie) for 23%, 24% less decode time a frame in the read cells |
| dbts_b4 | 16 | 16 | 1.207 | tie | 1.008 | tie | 1 of 2 read, not all faster | a trade: +20.7% bytes (a tie) for 19% less decode time a frame in the read cells |
| dbts_b4 | 32 | 32 | 1.258 | tie | 1.003 | tie | 1 of 4 read, not all faster | a trade: +25.8% bytes (a tie) for 23% less decode time a frame in the read cells |
| dbts_b5 | 16 | 16 | 1.213 | tie | 1.009 | tie | 0 of 2 read, not all faster | not decided (no decode cell read) |
| dbts_b5 | 32 | 32 | 1.227 | tie | 1.004 | tie | 2 of 4 read, not all faster | a trade: +22.7% bytes (a tie) for 23%, 24% less decode time a frame in the read cells |

### `dbts_b_max` (stage 4)

Two 10bit rungs only (Q 16 47.27 dB, Q 32 44.66 dB), so no tol: top8 Q 16 (46.73 dB) is bracketed and reads **1.394** at equal PSNR, residual 1.018, SSIM −0.0073; top8 Q 32 (44.23 dB) lies under the curve and is not extrapolated. At equal Q: 0.984× and −0.54 dB at Q 16, 1.091× and −0.43 dB at Q 32 — at Q 32 the same wrong PSNR sign as three of the five. Coded on host 2, where C1 reproduced the bytes run's cell byte for byte first. One volume, two rungs: reported, not read into S1–S8.

Files: `lab/av1/profiles/results/split-preview-b/` — `cells.jsonl` (stage 2 and 4 rows), `checks.jsonl`, `c6-*.json`, `streams.jsonl`, `partners.json`, `decode.json` (host 2), `decode-host1.json`, `timeline.txt`. Harness: `split_preview_bytes.py`, `split_preview_run.sh`, `split_preview_block.mjs` with its worker `split_preview_block.js`, `split_preview_report.py`; `bytes.py` gained the top8 and top8at10 forms, the C2–C4 mutations and the stream writer behind the driver's `--keep`. The tables above are `split_preview_report.py`'s output.
