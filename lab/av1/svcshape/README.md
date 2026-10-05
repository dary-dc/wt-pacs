# lab/av1/svcshape — the scalable shape with the least overhead

Queue row 25 (SVCSHAPE) of [`docs/av1/queue.md`](../../../docs/av1/queue.md). Row SVCQ found one
scalable AV1 payload — a lossy base and a lossless top — exact and nearly free over single-layer
lossless AV1 with two spatial layers. This sweeps the shapes on every series of rows DATA, CONTENT
and TAXO: bytes against single-layer lossless AV1 and HTJ2K, the base's bytes and quality, decode
time of the base and of the full operating point, and the time to a playable base. The verdict is
in [`docs/av1/README.md`](../../../docs/av1/README.md) §A5.

```bash
lab/av1/svc/build.sh && lab/av1/svcq/build_wasm.sh        # encoder (patched), dav1d-WASM simd-op
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160   # builds ojph_compress once
lab/av1/fetch_data.sh
lab/av1/.venv/bin/python lab/av1/svcshape/shape.py lab/.av1-build lab/.av1-work/svcshape \
  lab/.av1-work/svcshape.tsv lab/av1/data/*/                                  # ~12 min, 4 cores
lab/av1/.venv/bin/python lab/av1/svcshape/mutate.py lab/.av1-build lab/.av1-work/svcshape \
  lab/av1/data/rf_fluoro lab/av1/data/ct_lidc
NODE_PATH=$(npm root -g) node lab/av1/svcshape/time.mjs --rounds 10 --out t.json  # ~1 h 45
NODE_PATH=$(npm root -g) node lab/av1/svcshape/time.mjs --rounds 1 --throttles 1 --mutate sample
lab/av1/.venv/bin/python lab/av1/svcshape/playable.py lab/.av1-work/svcshape.tsv t.json
```

## How

**Encoder.** libaom 3.15.1's `svc_encoder_rtc` with row SVCQ's patch (`--layer-q`, one quantizer per
layer), speed 7, quantizer 0 on every top layer. The shapes:

| shape | layering mode | layers | base |
| --- | --- | --- | --- |
| single | 0 | L1T1 | — (single-layer lossless AV1) |
| half, quarter | 5 | L2T1, `-r` the example's ½ or `1/4,1/1` | ½ or ¼ size, q 20 / 40 / 60 |
| quality | 5 | L2T1, `-r 1/1,1/1` | full size, q 20 / 40 / 60 |
| three | 6 | L3T1 (¼, ½, full) | ¼ size at q, the middle at q/2 |
| L1T2, L1T3 | 1, 2 | temporal only, every layer lossless | every 2nd or 4th frame, exact |
| L2T3 half | 7 | two spatial × three temporal | ½ size at q 40 |
| k 8, k 1 | 0 and 5 | single and half q 40 | a keyframe every 8 frames, every frame |

Every other shape has one keyframe (`-k 100000`). A series over 12 bits — CT and cone-beam (13 bits
after the offset), the two projection sets (14) — is split as rows DEPTH and TAXO found best, the two
low bits apart: the scalable payload codes v ≫ 2 at 12 bits, a single-layer 8-bit lossless stream
v & 3, the same in every shape, and its bytes are in every total.

**Checked.** The top operating point of every shape, decoded by native dav1d 1.5.4: every frame,
merged with the low bits when split, against the checksum written when the series was fetched.
The base, lossy, is measured: mean PSNR (peak 2^B − 1 of the source's coded depth) and max |Δ| in
the source's units against the source — or against its 2×2 or 4×4 mean when the base is scaled, so
the figure holds the encoder's downscaling filter as well as its coding loss. A split series' base
codes the top bits only (the low two at their midpoint). HTJ2K is row SIZE's served profile
(OpenJPH 0.31.0) on the same frames, every frame decoded and checked.

**Decode time.** `bench.mjs` in headless Chromium 141: dav1d-WASM `simd` with SVCQ's
operating-point wrapper (`simd-op`, 623 242 B here), one decoder in order over a set's first 8
temporal units after an untimed pass on another; the mean ms a frame. The base is its own stream at
its operating point (libaom numbers op i = spatial · T + temporal from the top down: a two-layer base
is op 1, a three-layer one op 2, temporal layer 0 of L1T3 op 2); the full point is op 0 on the whole
stream, plus the low-bits stream's decode on a split series. Base quantizer 40. A fresh browser per
(throttle × set) each round, throttles and sets in a Williams order (`lab/order.mjs`), arms
rotating inside; 1× and 4× (`lab/scripts/cpu_throttle.mjs`); 10 rounds; median [min–max]. One
browser at a time, dav1d single-threaded: the host is not saturated.

## Bytes

Total over single-layer lossless AV1 from the same encoder (base q 20 / 40 / 60 where there is one):

| set | single / HTJ2K | half | quarter | quality | three | L1T2 / L1T3 | L2T3 half | k 8: single / half | k 1: single / half | least overhead |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `ct_lidc` | 1.087 | 0.965 / 0.969 / 0.968 | 0.968 / 0.968 / 0.968 | 0.956 / 0.968 / 0.968 | 0.959 / 0.966 / 0.968 | 0.972 / 0.974 | 1.028 | 0.998 / 0.979 | 0.980 / 1.052 | quality-q20 0.956 (1.039 of HTJ2K) |
| `xa_dynact16` | 1.018 | 1.001 / 1.001 / 1.001 | 1.001 / 1.001 / 1.001 | 1.004 / 1.001 / 1.001 | 1.004 / 1.001 / 1.001 | 1.027 / 1.028 | 1.037 | 1.007 / 1.011 | 1.060 / 1.092 | quarter-q20 1.001 (1.019 of HTJ2K) |
| `mr_ispy1` | 1.102 | 0.991 / 0.997 / 0.998 | 0.996 / 0.997 / 0.998 | 0.981 / 0.995 / 0.998 | 0.983 / 0.992 / 0.996 | 0.997 / 0.998 | 1.056 | 0.998 / 0.997 | 0.983 / 0.998 | quality-q20 0.981 (1.081 of HTJ2K) |
| `rf_fluoro` | 1.068 | 0.992 / 0.998 / 1.000 | 0.996 / 0.999 / 1.000 | 0.977 / 0.995 / 1.000 | 0.989 / 0.993 / 0.996 | 1.002 / 1.004 | 1.063 | 1.000 / 0.999 | 0.992 / 1.004 | quality-q20 0.977 (1.043 of HTJ2K) |
| `us_liver` | 1.581 | 1.037 / 1.008 / 1.001 | 1.011 / 1.003 / 1.001 | 0.948 / 0.984 / 1.004 | 1.079 / 1.039 / 1.018 | 1.020 / 1.029 | 1.048 | 1.018 / 1.024 | 1.153 / 1.142 | quality-q20 0.948 (1.499 of HTJ2K) |
| `dbt12_ea1141` | 1.057 | 1.002 / 1.002 / 1.003 | 1.002 / 1.002 / 1.003 | 1.002 / 1.002 / 1.003 | 1.007 / 1.003 / 1.003 | 1.018 / 1.021 | 1.027 | 1.004 / 1.010 | 1.036 / 1.076 | quarter-q20 1.002 (1.059 of HTJ2K) |
| `dbt10_ea1141` | 0.937 | 1.007 / 1.002 / 1.002 | 1.002 / 1.001 / 1.002 | 1.015 / 1.005 / 1.003 | 1.028 / 1.008 / 1.004 | 1.034 / 1.040 | 1.045 | 1.008 / 1.012 | 1.087 / 1.118 | quarter-q40 1.001 (0.938 of HTJ2K) |
| `dbtproj_ge` | 1.016 | 1.000 / 1.001 / 1.001 | 1.000 / 1.001 / 1.000 | 1.000 / 1.001 / 1.002 | 1.000 / 1.000 / 1.000 | 1.000 / 1.000 | 1.043 | 1.000 / 1.001 | 0.998 / 1.006 | quality-q20 1.000 (1.015 of HTJ2K) |
| `dbtproj_holo` | 1.028 | 0.976 / 0.975 / 0.975 | 0.976 / 0.975 / 0.975 | 0.976 / 0.976 / 0.976 | 0.976 / 0.975 / 0.975 | 0.976 / 0.976 | 1.035 | 0.999 / 0.975 | 0.975 / 0.978 | quarter-q60 0.975 (1.002 of HTJ2K) |

Base bytes in % of HTJ2K's, base PSNR, max |Δ| (q 40; L1T3's base is its exact temporal layer 0):

| set | half | quarter | quality | three | L1T3 (TL 0, exact) |
| --- | --- | --- | --- | --- | --- |
| `ct_lidc` | 0.09 %, 36.36 dB, 2122 | 0.04 %, 34.05 dB, 2453 | 0.17 %, 38.3 dB, 2064 | 0.04 %, 33.97 dB, 2473 | 16.9 %, 25 frames |
| `xa_dynact16` | 0.04 %, 36.52 dB, 2072 | 0.02 %, 35.62 dB, 2532 | 0.06 %, 36.56 dB, 2266 | 0.02 %, 35.6 dB, 2473 | 20.1 %, 16 frames |
| `mr_ispy1` | 0.07 %, 38.76 dB, 618 | 0.03 %, 38.49 dB, 648 | 0.19 %, 38.94 dB, 498 | 0.03 %, 38.54 dB, 635 | 28.4 %, 15 frames |
| `rf_fluoro` | 0.15 %, 40.75 dB, 1448 | 0.07 %, 39.07 dB, 862 | 0.41 %, 41.67 dB, 1786 | 0.07 %, 39.05 dB, 886 | 30.6 %, 5 frames |
| `us_liver` | 2.38 %, 27.21 dB, 161 | 0.36 %, 29.75 dB, 90 | 11.42 %, 32.35 dB, 162 | 0.36 %, 29.76 dB, 100 | 44.2 %, 18 frames |
| `dbt12_ea1141` | 0.06 %, 40.03 dB, 914 | 0.03 %, 40.02 dB, 780 | 0.18 %, 42.9 dB, 605 | 0.03 %, 39.97 dB, 781 | 30.4 %, 8 frames |
| `dbt10_ea1141` | 0.15 %, 37.23 dB, 425 | 0.05 %, 36.06 dB, 432 | 0.53 %, 38.9 dB, 393 | 0.05 %, 36.07 dB, 432 | 25.7 %, 6 frames |
| `dbtproj_ge` | 0.02 %, 48.95 dB, 4023 | 0.01 %, 33.48 dB, 8222 | 0.04 %, 51.21 dB, 2194 | 0.01 %, 33.49 dB, 8222 | 22.8 %, 3 frames |
| `dbtproj_holo` | 0.02 %, 46.29 dB, 1534 | 0.01 %, 46.74 dB, 940 | 0.03 %, 51.86 dB, 699 | 0.01 %, 46.74 dB, 937 | 15.8 %, 4 frames |

Every top frame of every one of the 180 codings exact (20 shapes × 9 series, 387 frames a shape). A split series' totals carry its low-bits stream, 27–41 % of them. The GE projections'
quarter base is 644 samples wide where 2572/4 is 643 (libaom keeps a layer's size even), so its box
mean drifts by up to a source sample across the width: its 33.5 dB and max |Δ| 8 222 are a floor, not
the coding's loss; the holographic set's (2048/4 = 512) gives 46.7 dB. L1T3's split bases (76–83 dB,
max |Δ| 2) are the top bits at the low bits' midpoint.

## Decode time

ms a frame, median of 10 rounds, single as median [min–max]; for each shape the base / the full
operating point, and in brackets the full point over single. A split series' exact frame also
decodes its low bits (their column), the same for every shape. Every full point and single exact,
80/80 frames a cell, 108 cells:

**1×**

| set | single | low bits | half | quarter | quality | three | L1T3 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ct_lidc` | 14.8 [14.2–19.2] | 10.7 | 0.831 / 16.9 (1.14) | 0.253 / 15.6 (1.06) | 2.42 / 17.3 (1.17) | 0.245 / 16.7 (1.13) | 15.2 / 15.4 (1.04) |
| `xa_dynact16` | 22.7 [21.6–28.6] | 11.1 | 0.84 / 23.9 (1.05) | 0.25 / 23 (1.01) | 2.57 / 25.1 (1.11) | 0.244 / 24.6 (1.08) | 25.2 / 24.4 (1.07) |
| `mr_ispy1` | 25.8 [24.9–31.7] | — | 0.652 / 26.3 (1.02) | 0.191 / 25.6 (1.00) | 1.84 / 27.2 (1.05) | 0.198 / 26.9 (1.04) | 27.2 / 26.9 (1.04) |
| `rf_fluoro` | 74.5 [70.5–82.2] | — | 3.84 / 80.5 (1.08) | 1.12 / 74.9 (1.01) | 15 / 88 (1.18) | 1.14 / 82.8 (1.11) | 78.5 / 73.7 (0.99) |
| `us_liver` | 53.1 [50–57.7] | — | 7.01 / 60.6 (1.14) | 1.6 / 55.4 (1.04) | 24.4 / 69.4 (1.31) | 1.66 / 61.6 (1.16) | 60.5 / 54.1 (1.02) |
| `dbt12_ea1141` | 76.8 [71.9–80.9] | — | 3.44 / 79.5 (1.04) | 1.1 / 75.7 (0.99) | 10.2 / 85.6 (1.11) | 0.93 / 80.7 (1.05) | 79.3 / 75.9 (0.99) |
| `dbt10_ea1141` | 73.2 [70.3–86.3] | — | 6.33 / 84 (1.15) | 1.97 / 77 (1.05) | 23.6 / 96.7 (1.32) | 1.79 / 85.4 (1.17) | 84.9 / 78.9 (1.08) |
| `dbtproj_ge` | 377 [356–404] | 227 | 14.6 / 396 (1.05) | 4.2 / 377 (1.00) | 54.3 / 423 (1.12) | 3.93 / 406 (1.08) | 391 / 385 (1.02) |
| `dbtproj_holo` | 170 [160–177] | 133 | 6.47 / 165 (0.97) | 2.04 / 165 (0.97) | 20.6 / 182 (1.07) | 1.97 / 173 (1.02) | 168 / 163 (0.96) |

**4×**

| set | single | low bits | half | quarter | quality | three | L1T3 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `ct_lidc` | 61.6 [59.6–80.6] | 49 | 3.43 / 71.9 (1.17) | 1 / 67.5 (1.10) | 11.1 / 73.9 (1.20) | 1.39 / 73.3 (1.19) | 66 / 65.8 (1.07) |
| `xa_dynact16` | 96.4 [90.9–118] | 46.1 | 3.68 / 104 (1.08) | 1.42 / 100 (1.04) | 11.2 / 108 (1.13) | 1.17 / 108 (1.12) | 112 / 102 (1.05) |
| `mr_ispy1` | 109 [103–117] | — | 2.95 / 118 (1.08) | 1.01 / 111 (1.02) | 7.42 / 119 (1.10) | 1.35 / 125 (1.15) | 116 / 112 (1.03) |
| `rf_fluoro` | 319 [292–385] | — | 16.8 / 341 (1.07) | 5.13 / 329 (1.03) | 61.6 / 374 (1.17) | 5.72 / 356 (1.11) | 328 / 325 (1.02) |
| `us_liver` | 226 [213–254] | — | 30.1 / 260 (1.15) | 7.07 / 244 (1.08) | 107 / 296 (1.31) | 8.23 / 262 (1.16) | 269 / 234 (1.03) |
| `dbt12_ea1141` | 327 [311–388] | — | 15.9 / 344 (1.05) | 4.47 / 329 (1.01) | 45.9 / 375 (1.15) | 4.19 / 350 (1.07) | 342 / 330 (1.01) |
| `dbt10_ea1141` | 340 [304–376] | — | 27.1 / 342 (1.01) | 8.1 / 344 (1.01) | 100 / 430 (1.27) | 7.25 / 375 (1.10) | 379 / 328 (0.97) |
| `dbtproj_ge` | 1604 [1514–1823] | 959 | 64.1 / 1662 (1.04) | 17.4 / 1641 (1.02) | 243 / 1854 (1.16) | 18 / 1782 (1.11) | 1675 / 1655 (1.03) |
| `dbtproj_holo` | 723 [662–770] | 561 | 25.4 / 703 (0.97) | 9.26 / 700 (0.97) | 89.6 / 779 (1.08) | 8.19 / 737 (1.02) | 725 / 702 (0.97) |

## Time to a playable base

Arithmetic over the bytes and decode times above (`playable.py`): every base of the series first,
back to back at the link's rate (row SVCORDER's bases-first, proposed, not built), each frame an
equal share, one decoder in order — the base is inter-coded — and playable when the last base is
decoded; the link's own latency left out. Seconds, base q 40. The scaled bases are decode-bound: the
same at 5, 20 and 50 Mbit/s but for the ultrasound's half base at 5 (0.69 s at 1×). The exact series,
every byte and then its frames decoded, single-layer against the quarter shape:

| set | quarter base, 1× / 4× | half | quality | L1T3's exact quarter-rate base, 5 / 20 / 50 Mbit/s, 1× | exact series, single → quarter: 5 Mbit/s 1× | 50 Mbit/s 4× |
| --- | --- | --- | --- | --- | --- | --- |
| `ct_lidc` | 0.03 / 0.1 s | 0.08 / 0.34 | 0.24 / 1.11 | 4.43 / 1.12 / 0.46 | 28.48 → 27.57 | 11.09 → 11.67 |
| `xa_dynact16` | 0.02 / 0.09 s | 0.05 / 0.24 | 0.16 / 0.72 | 4.79 / 1.22 / 0.5 | 24.17 → 24.18 | 9.16 → 9.39 |
| `mr_ispy1` | 0.01 / 0.06 s | 0.04 / 0.17 | 0.11 / 0.43 | 4.94 / 1.26 / 0.52 | 19.10 → 19.05 | 6.35 → 6.45 |
| `rf_fluoro` | 0.02 / 0.09 s | 0.07 / 0.3 | 0.27 / 1.11 | 4.61 / 1.21 / 0.53 | 15.91 → 15.89 | 5.84 → 6.02 |
| `us_liver` | 0.11 / 0.5 s | 0.69 / 2.11 | 3.32 / 7.54 | 12.79 / 3.24 / 1.33 | 45.65 → 45.77 | 15.89 → 17.12 |
| `dbt12_ea1141` | 0.03 / 0.13 s | 0.1 / 0.46 | 0.3 / 1.33 | 7.12 / 1.84 / 0.78 | 24.56 → 24.62 | 9.56 → 9.64 |
| `dbt10_ea1141` | 0.05 / 0.19 s | 0.15 / 0.65 | 0.57 / 2.41 | 5.7 / 1.49 / 0.65 | 20.51 → 20.55 | 8.23 → 8.34 |
| `dbtproj_ge` | 0.04 / 0.16 s | 0.13 / 0.58 | 0.49 / 2.19 | 13.78 / 3.74 / 1.73 | 60.30 → 60.33 | 23.74 → 24.07 |
| `dbtproj_holo` | 0.03 / 0.14 s | 0.1 / 0.38 | 0.31 / 1.34 | 7.57 / 2.02 / 0.91 | 48.56 → 47.35 | 19.59 → 19.23 |

## The checks were mutated

* top coded lossy (`--layer-q=40,8`), fluoroscopy: 0/18 frames exact;
* one truth checksum corrupted: 17/18;
* split CT merged as built 100/100; its low bits dropped 0/100; merged at the wrong shift 0/100;
* the base PSNR on the source itself: 99 (identical); on the source + 1: 72.25 dB = 20·log10(4095),
  max |Δ| 1;
* `--mutate sample` (one bit of every decoded frame) in the timing bench: CT (split) and ultrasound,
  every full point 0/8.

## Verdict

**The quarter-size base — two spatial layers, ¼ size, q 40 — is the shape with the least overhead
on every series**: its total is 0.968–1.003 of single-layer lossless AV1 (within 0.3 % of the
smallest shape everywhere but CT, ultrasound, MR and fluoroscopy, where a full-size q 20 base is
1.2–5.5 % smaller), its exact frame decodes in 0.97–1.06× single's time at 1× and 0.97–1.10× at 4×
(the full-size base 1.05–1.32×), and its base is 0.01–0.36 % of HTJ2K's bytes and decodes in
0.19–4.2 ms (1×), so **the whole series' bases are playable in 0.01–0.11 s at 1× and 0.06–0.5 s at
4×, at 5, 20 and 50 Mbit/s alike**, against 16–60 s for the exact series at 5 Mbit/s. The base's
quality is 30 dB on the ultrasound, 34–39 dB on the 512² CT, cone-beam and MR and 36–47 dB on the
larger grey series (the GE projections' 33.5 dB a floor, above).

Not worth it: a third layer (0.96–1.08 of single, decodes 1.02–1.19×, no better base than the
quarter's); temporal layers (−3 to +4 %; their base is exact but 16–44 % of HTJ2K's bytes, a
quarter-rate cine in 0.5–14 s); two spatial and three temporal layers together (+3–6 %); a keyframe
every 8 frames (single-layer 1.00–1.02 of one keyframe) or every frame (0.975–1.153). Whatever the shape, the payload keeps
lossless AV1's size at this encoder's speed: **0.94 (10-bit tomosynthesis) to 1.59 (ultrasound) of
HTJ2K's bytes**, and its exact series lands within 3.2 % of single-layer's on 5 Mbit/s and −2 to
+8 % from it at 4× on 50 Mbit/s, where decoding is the clock. Container numbers, not a phone's.
