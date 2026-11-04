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

*Partial, 2026-11-04 23:10 UTC: stages 1 and 2 done, stage 3 (decode) running. The decode, S8 and the verdict follow.*

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

**S1–S7**

* S1 held by its clause: highest top8 PSNR 50.127 dB over 40 cells (edge 58.5)
  its second part, uncoded top8 at 58.4 ± 0.1 dB: dbts_b1 63.07 dB (mean square 0.516), dbts_b2 60.25 dB (mean square 0.988), dbts_b3 61.32 dB (mean square 0.773), dbts_b4 60.35 dB (mean square 0.966), dbts_b5 60.15 dB (mean square 1.012) — outside on ['dbts_b1', 'dbts_b2', 'dbts_b3', 'dbts_b4', 'dbts_b5']
* S2 (from the noise up, 1.00–1.12) refuted: 14 matched points, range 0.950–1.258; outside 1.0–1.12: dbts_b1 G1 Q56 0.950, dbts_b2 G1 Q56 0.982, dbts_b2 G1 Q16 1.125, dbts_b2 G16 Q32 1.132, dbts_b2 G16 Q16 1.256, dbts_b3 G1 Q56 0.983, dbts_b4 G1 Q56 0.952, dbts_b4 G1 Q32 1.258, dbts_b4 G16 Q32 1.214, dbts_b5 G1 Q56 0.974, dbts_b5 G1 Q32 1.227, dbts_b5 G16 Q32 1.206
* S3 (Q 8's quality: above the 10bit Q 12 rung's PSNR, 1.05–1.35) held: 5 matched points, range 1.134–1.173
  S3 refuted also: not above S2's range on ['dbts_b2', 'dbts_b4', 'dbts_b5']
* S4 refuted: series with a wrong sign, by Q: Q 32: ['dbts_b2', 'dbts_b4', 'dbts_b5']
* S5 refuted: top8at10 ÷ 10bit at equal PSNR: dbts_b2 Q32 1.008, dbts_b2 Q16 1.022, dbts_b5 Q32 1.018, dbts_b5 Q16 1.043
* S6 refuted: series with a matched point outside ±0.002 SSIM or ±2 points: ['dbts_b1', 'dbts_b2', 'dbts_b3', 'dbts_b4', 'dbts_b5']
* S7 refuted: 40 matched points, residual ratio 0.9685–1.0227

