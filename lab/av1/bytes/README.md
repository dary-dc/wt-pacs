# lab/av1/bytes — what each coding costs, on the wire and to encode

One folder a subject, each with its own README ([`../README.md`](../README.md) §The folders, by what they measure).
`enc.py` and `av2.py` sit here; their cells follow. `size.py` and `depth.py` stay one folder up, since every group
imports them.

## ENC — what lossless encoding costs

Queue row 14. libaom 3.15.1, `--lossless=1 --threads=1`, every `cpu-used` each usage accepts:
`--good` 0–6 and `--allintra` 0–9 as intra (`--kf-max-dist=0`), `--rt` 5–12 as low-delay inter
(one keyframe, the rest predicted — the shape of a live encode); against `ojph_compress` in the
served profile. The first 8 frames of each row-DATA and row-CONTENT set; a set over 12 bits is DEPTH's top11+low,
two streams timed together. Every output decoded with dav1d and matched the checksums written when
the frames were made: 546/546 runs exact, the `--rt` inter streams at 10–13 bits included.

```bash
python3 lab/av1/bytes/enc.py lab/.av1-build lab/.av1-work/enc OUT.tsv 8 3 lab/av1/data/mr_ispy1 …  # ~2 h
python3 lab/av1/bytes/enc.py summary OUT.tsv 8
```

The tomosynthesis sets ran as a second campaign under the same check, after row CONTENT landed.

**Uncontended, and how that was checked.** One encode at a time on the container's 4 cores, one
thread, nothing else started during the campaign; before each run two `/proc` samples 0.5 s apart
summed every other process's CPU — at most 0.22 of a core over the 546 — and each child's CPU time
was ≥ 0.96 of its wall time on every run over 1 s (≥ 0.88 on the shortest, where start-up and file
I/O weigh most). Arms interleaved per set
(`lab/scripts/order.py`), n = 3 rounds; bytes were identical in every round. A time is wall clock
over 8 frames with the process's start and its Y4M read inside, so the fastest presets read slow by
a few ms a frame. Container numbers, x86-64 with libaom's assembly.

ms a frame, median of 3 [min–max]; bytes over `--good` cpu0's (the slowest preset) in brackets:

| set (frame) | `ojph` | good 0 | good 6 | allintra 0 | allintra 5 | allintra 6 | allintra 7 | allintra 9 | rt 5 | rt 12 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `mr_ispy1` 512², 11-bit | 8.8 (0.987) | 3 016 [2 974–3 248] | 382 (1.020) | 2 550 (1.003) | 835 (1.013) | 132 (1.032) | 69 (1.036) | **27.2** [25.4–40.9] (1.049) | 240 (1.019) | 35.4 (1.061) |
| `ct_lidc` 512², 13-bit, 2 streams | 7.4 (1.108) | 10 133 [9 609–10 245] | 1 375 (1.008) | 8 475 (1.001) | 1 923 (1.006) | **496** (1.016) | 258 (1.022) | **30.0** [29.0–34.0] (1.186) | 288 (1.087) | 46.1 (1.175) |
| `xa_dynact16` 512², 13-bit, 2 streams | 7.4 (1.003) | 5 242 [5 187–5 250] | **908** (1.018) | 4 105 (1.004) | 1 240 (1.009) | 290 (1.027) | 153 (1.031) | 37.4 [35.6–39.9] (1.103) | 265 (1.022) | 45.5 (1.054) |
| `rf_fluoro` 768², 12-bit | 12.1 (0.974) | 9 326 [8 920–9 673] | 1 654 (1.014) | 9 276 (1.000) | 1 967 (1.004) | 612 (1.014) | **345** (1.017) | 68.8 [63.9–71.5] (1.047) | 551 (1.031) | 95.4 (1.076) |
| `us_liver` 760×421 RGB 8 | 13.6 (0.895) | 9 481 [9 422–9 742] | 638 (1.558) | **7 232** (1.001) | 827 (1.039) | 313 (1.066) | 171 (1.576) | 61.9 [60.1–63.4] (1.632) | 415 (1.298) | 69.1 (1.339) |
| `dbt10_ea1141` 678×1727, 10-bit | 17.2 (1.023) | 11 141 [10 990–11 288] | **936** (1.019) | 7 292 (1.005) | 2 178 (1.009) | 488 (1.021) | 280 (1.030) | 81.1 [78.1–86.1] (1.055) | 460 (0.992) | 111.1 (1.006) |
| `dbt12_ea1141` 614×1359, 12-bit | 13.2 (0.962) | 7 399 [7 378–8 026] | 731 (1.026) | 5 931 (1.012) | **1 618** (1.015) | 285 (1.033) | 208 (1.037) | 78.8 [76.2–81.4] (1.068) | 547 (1.025) | 91.2 (1.061) |

Every `cpu-used` is in the TSV. In 23 of the 182 (set × arm) cells one round of three is 13–50 % off
the median, all but two (CT `--good` 3 at 2.3 s, fluoroscopy `--rt` 5 at 0.55 s) under 0.3 s a
frame; the median is quoted.

**The fastest preset within 2 % of the slowest's bytes** (bold above): MR `--good` 6, 2.6 frames/s a
core (`--rt` 5's inter, 1.019, gives 4.2); CT `--allintra` 6, 2.0; cone-beam `--good` 6, 1.1;
fluoroscopy `--allintra` 7, 2.9; the ultrasound only `--allintra` 0 itself, 0.14 frames/s — every
faster preset costs it ≥ 3.2 %, and `--good` 6 and `--allintra` 7–9 jump to 1.56–1.63; tomosynthesis
10-bit `--good` 6, 1.1, and 12-bit `--allintra` 5, 0.62. **On the 10-bit tomosynthesis the real-time
inter coding is smaller than every intra one**: `--rt` 8–10 at 0.959–0.963 of the slowest preset
(0.937–0.941 of HTJ2K) and 5.5–9.6 frames/s — the one set here where a fast preset is also the
smallest, consistent with row CONTENT's finding that AV1 coded whole is under HTJ2K on that volume;
on the 12-bit one `--rt` 10 is within 2 % at 9.9 frames/s. Two preset
pairs code identically lossless (`--good` 1 = 2, `--rt` 11 = 12), and `cpu-used` is not monotonic in
time (`--good` 3 is faster than 4 on every set).

**30 frames/s of 512² on one core, lossless:** reached only by `--allintra` 9, on MR (36.7 f/s) and
CT (33.3, two streams) — at 1.049 and 1.186 of the slowest preset's bytes, 1.063 and 1.070 of
HTJ2K's; cone-beam reaches 26.8, and no `--rt` preset reaches it (best 28.3, MR). `ojph_compress`
encodes the same frames at 73–136 frames/s a core (58 and 75 on the larger tomosynthesis frames),
process start included, into fewer bytes than every AV1 intra preset that fast. Row CONTENT found no
open angiography run, so none is here.

**Mutated**: lossy encode, OpenJPH irreversible, the low plane of a split dropped, one frame short,
RGB planes misordered — each reported inexact; a `yes` loop beside the run showed as 1.02 cores in
the contention probe.

## AV2 — AVM v1.0.0 lossless against libaom and HTJ2K

Queue row 32. AVM is AV2's reference software ([`docs/av1/licensing.md`](../../../docs/av1/licensing.md));
no browser decoder exists, and none is built.

```bash
lab/av1/tools/tools.sh                         # AVM v1.0.0 beside libaom 3.15.1 and dav1d
lab/av1/fetch_data.sh                    # every row-DATA, CONTENT and TAXO series
AV2_GROUPS=rf_fluoro:2,dbt10_ea1141:4 AV2_PRESETS=6 python3 lab/av1/bytes/av2.py lab/.av1-build WORK OUT.tsv 10 lab/av1/data/…
```

**AV2 has no profile over 10 bits.** AVM v1.0.0 defines Main 4:2:0, 4:2:2 and 4:4:4 at 10 bits
(`av2/common/enums.h`); 12-bit is a build flag marked test-only, "not defined in AV2 spec", and is not
built here. So a sample over 10 bits is coded split, v ≫ k at 10 bits and v & (2^k − 1) at 8, with
the fewest k that fits (1 on 11-bit MR, 2 at 12 bits, 3 at 13, 4 at 14), and also at k = 2, DEPTH's
rule, wherever that fits. libaom codes the same planes, and its best split (k = 2, the top up to 12
bits) beside them. Grey is 4:0:0, RGB 4:4:4 identity (`--profile=4`). Every stream is decoded by its
own codec's decoder (`avmdec`, `dav1d`), merged, and matched with the checksum written when the
frame was made: **34/34 cells exact** at `cpu-used` 6.

**The frames.** AVM codes ~3 200 samples a second on one core at its fastest lossless setting, so
the series' **middle frame** stands in for each series, and HTJ2K and libaom are measured on the
same frame. `cpu-used` 6, 8 and 9 code identically (AVM has no speed feature past 6); 0 is the
slowest. Every stream is decoded by its own codec's decoder, merged and matched with the checksum
written when the frame was made: **68/68 cells exact**, 34 a preset.

Bytes over HTJ2K's on that frame, `cpu-used` 0 (6) for both encoders; encode seconds a frame at
`cpu-used` 0 on one core, three or four encodes at a time on four cores; native decode ms a frame,
one thread, process start included, medians of 10 interleaved rounds with one other core busy:

| set | HTJ2K B | AV2 k | AV2 | libaom, same k | libaom best | encode s: libaom · AV2 | decode ms: OpenJPH · dav1d · avmdec |
| --- | --: | --- | --- | --- | --- | --- | --- |
| `rf_fluoro` 768², 12-bit | 506 722 | 2 | **0.937** (0.944) | 0.947 (0.951) | k 2 | 17 · 1 653 | 9.6 · 60 · 236 |
| `mr_ispy1` 512², 11-bit | 191 534 | 2 | **0.953** (0.957) | 1.001 (1.012) | k 2 | 5.6 · 477 | 7.2 · 28 · 137 |
| `us_liver` 760×421, RGB 8 | 256 736 | 0 | 1.648 (1.646) | **1.117** (1.747) | whole | 9.3 · 454 | 10.7 · 38 · 148 |
| `ct_lidc` 512², 13 bits | 163 624 | 3 | 0.954 (0.971) | 1.000 (1.009) | **0.922** (0.933), k 2 | 5.4 · 605 | 7.2 · 22 · 144 |
| `xa_dynact16` 512², 13 bits | 231 739 | 3 | **0.964** (0.974) | 1.000 (1.011) | 0.997 (1.016), k 2 | 5.6 · 505 | 7.5 · 28 · 156 |
| `dbt12_ea1141` 614×1359, 12-bit | 508 789 | 2 | **0.941** (0.951) | 0.944 (0.951) | k 2 | 15 · 1 468 | 11.3 · 67 · 273 |
| `dbt10_ea1141` 678×1727, 10-bit | 571 039 | 2 | **0.941** (0.955) | 0.950 (0.957) | k 2 | 21 · 2 115 | 12.7 · 74 · 314 |
| `dbtproj_ge` 1914×2572, 14-bit | 4 090 008 | 4 | 0.992 (0.998) | 1.000 (1.002) | **0.953** (0.951), k 2 | 182 · 11 864 | 44 · 424 · 1 381 |
| `dbtproj_holo` 1280×2048, 14-bit | 1 958 459 | 4 | 1.009 (1.010) | 1.045 (1.045) | **0.925** (0.927), k 2 | 61 · 5 606 | 27 · 217 · 682 |

Coded whole, the 10-bit tomosynthesis is 0.963 (0.975) through AV2 and 0.980 (0.999) through
libaom. Groups, the best G of rows SIZE and CONTENT, on the middle frames: four tomosynthesis slices
as one group, coded whole, are **0.922 (0.928) through AV2** against libaom's 0.978 (0.981) — the one
place AV2's inter coding collects something, AV2 intra on those four frames not run; the
fluoroscopy at G = 2, k = 2, is 0.958 (0.972) through AV2 and 0.947 (0.962) through libaom.

**On grey, AV2 is the smallest coding here on every series up to 13 bits but CT**: on the
same planes it is 0.4–4.7 % under libaom at `cpu-used` 0, and 0.937–0.964 of HTJ2K on the 10- to
13-bit series. It has no profile over 10 bits, so it cannot code libaom's best split (the top at 12
bits) on CT and the 14-bit projections, where libaom stays 3–8 % smaller. **On the RGB ultrasound it
loses**: 1.648 of HTJ2K at either preset, against libaom's 1.117 at `cpu-used` 0. It costs **450–11 900
s to encode a frame**, 50–110× libaom's on the same planes (140–350× at `cpu-used` 6, where AVM takes
150–2 600 s), and **3.1–6.5× dav1d's native decode time**, 14–31× OpenJPH's. One frame a series: not a
series' bytes; and AV2's specification text could not be read here, so its claims about lossless are
neither confirmed nor refuted beyond these frames.

**Mutated** (on 64×48 crops of the real series): the top plane's shift one bit short, one truth
checksum corrupted, a group decoded one frame short, RGB planes misordered at input — each reported
inexact in every cell it reaches, and nowhere else.
