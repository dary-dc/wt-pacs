# Frame groups in lossless AV1: protocol and decision rule

Queue row GOPMEASURE runs this protocol. The measuring session reads this file alone, not
[`gop-theory.md`](gop-theory.md); it reports the numbers first, then whether each prediction held. The rule
in §5 was fixed on 2026-10-08, before any data.

## 1 · Content

* **DBT reconstructed slices.** Every system in the CC BY collections the lab fetches. Only sets whose provenance is
  sound count (row DATAGUARD: original, uncompressed or lossless-sourced, not derived by lossy coding). Each volume is
  whole and uncropped, every slice in position order. At least two volumes per system where the collection has them.
  For each volume, record the system's scan arc and projection count wherever the DICOM header carries them (the
  X-Ray 3D Acquisition Sequence (0018,9507) and its primary positioner scan arc), and say "not recorded" otherwise.
* **Native breast ultrasound cine, ABUS, contrast angiography runs.** Only from a sound, licensed source. Without one,
  list the data needed under `## Blocked` in [`queue.md`](queue.md) and measure nothing on that type. A lossy-sourced
  set (any MPEG, any lossy JPEG, Lossy Image Compression (0028,2110) = `01`) enters no verdict.

## 2 · The statistic ρ, before any encoder runs

For each pair of adjacent frames, on the top stream of the product's representation (below):

1. Take each frame's intra residual from the LOCO-I median predictor.
2. In each 64×64 block, find the Pearson correlation of frame t's residual with frame t+1's, at the best integer
   offset within ±8 px.
3. Report per series the median and the 10th and 90th percentiles over blocks and pairs.
4. Report the same at offset 0, and the same on the low stream.

Mutate this check: feed a series whose frames are independent noise, and a series of one frame repeated. They must
give ρ ≈ 0 and ρ = 1.

## 3 · Codings

* **Representation.** The product's: `ingest/coded-frames/ingest.py --representation optimized`, i.e. row SPLITRULE's k by
  depth. Report the top and low streams apart, and their sum. Also code the plain representation (the samples
  direct) on one volume per system.
* **libaom 3.15.1**, as `lab/av1/tools/tools.sh` pins it:
  * Lossless, one thread.
  * Keyframes at exactly every G (`--kf-min-dist=G --kf-max-dist=G`).
  * G ∈ {1, 2, 3, 4, 6, 8, 12, 16, 24, 32, whole series}.
  * Alt-ref off (`--auto-alt-ref=0`) at every G.
  * Alt-ref on at G ∈ {8, 16}, used only where every frame is exact.
  * Presets `--cpu-used=0` and `good` 6, the product's.
* **SVT-AV1 v4.2.0** (`tools.sh`), `--lossless`, the same G, presets 0 and 8. Used only where every frame is exact.
* **HTJ2K**, the served profile (`ingest.py --codec htj2k`), as the reference row.

## 4 · Measurements

* **Exactness.** Every frame of every coding is decoded natively (dav1d 1.5.4 and OpenJPH, the pinned builds), each
  group on its own, and matched against the source checksum written at fetch. An inexact cell is reported and not
  used. Mutate the check: one sample of one frame flipped, and a group's frames reordered, must each be caught.
* **Bytes.** Bytes over intra (G = 1) at the same encoder and preset; bytes over HTJ2K.
* **Decode cost of an ask.**
  * Time to decode a frame at G ∈ {1, 4, 8, 16} through dav1d-WASM and through WebCodecs where the top is ≤ 10 bits.
  * Headless Chromium 141 (`lab/av1/delivery/total-time`'s pin), product decoder worker, at 1× and 4×.
  * n ≥ 10 rounds, interleaved with `lab/order.mjs`; report the median and range.
  * A mid-group ask's cost is the serial decode of frames k … N, a mean of (G + 1)/2 frames; report it beside one
    HTJ2K frame's decode.
  * Say where the host saturates.
* **Pins.** Every tool by tag and every fetched file by checksum. Nothing fetched or built is committed.

## 5 · The decision rule, fixed before the data

For each target type separately:

1. **G > 1 is adopted for a type** only if, on every sound series of that type, the best G ≤ 16 is all three of:
   * at least **20 % fewer bytes** than G = 1 on the product's representation at the shipped preset (`good` 6), every
     frame exact;
   * at most **0.80 of HTJ2K's bytes**;
   * its mid-group ask (mean serial decode at that G, WebCodecs where it applies, else dav1d-WASM, at 4×) no slower
     than one HTJ2K frame's decode plus the wire time its saved bytes buy at 20 Mbit.

   Otherwise G = 1 for that type.
2. **The question is conclusive for a type** when ≥ 2 systems (DBT), or ≥ 2 independent sound sources (the others),
   each with ≥ 2 series, all land on the same side of the 20 % line with libaom, and SVT-AV1 where exact does not
   cross it. It is not conclusive when the series disagree, or when fewer series than that are available; say which.
3. **A type with no sound data** gets no decision. It stays G = 1 by default, and the data it needs goes under Blocked.

## 6 · Predictions to check

Report each as held or not, with the numbers that decide it. *Gain* is 1 − bytes(best G) ÷ bytes(G = 1).

| # | content | prediction | refuted by |
| --- | --- | --- | --- |
| P1 | DBT, every system | median ρ (top stream) in 0.2–0.5, never above 0.6 | any system's median ρ > 0.6 or < 0.1 |
| P2 | DBT, every system | best G ≤ 16 gains under 5 %, libaom alt-ref off, cpu0 and `good` 6 | a gain ≥ 5 % on any series |
| P3 | DBT | gain ranks with ρ across series (Spearman ≥ 0.6 at ≥ 4 series); a narrower scan arc gives the higher ρ | the opposite order, or no relation at ≥ 6 series |
| P4 | DBT | G = 2 or 4 collects ≥ 80 % of the best gain; longer groups add < 0.5 points | best gain at G ≥ 8 ≥ 0.5 points over G = 4 |
| P5 | DBT, low stream | inter ≥ intra's bytes at every G | inter smaller by > 0.5 % |
| P6 | DBT, libaom alt-ref on (where exact) | no better than off by > 1 point | on better by > 1 point |
| P7 | DBT, SVT-AV1 where exact | same sign as libaom, within 2 points | opposite sign or > 2 points apart |
| P8 | native breast US cine, probe slow or still | gain ≥ 20 % at G = 8; median ρ > 0.7 | gain < 10 % |
| P9 | ABUS | gain 5–25 % | outside that range |
| P10 | contrast angiography run | gain < 5 %; ρ < 0.2 | gain ≥ 10 % |
