# gopmeasure — frame groups in lossless AV1, measured to a pre-registered rule

Queue row 100 (GOPMEASURE) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md) runs the protocol
`docs/av1/gop-protocol.md` (on `claude/av1` at 821a368; § numbers below are its) as written: ρ before any encoder (§2), the codings
(§3), exactness, bytes and the decode cost of an ask (§4), then the rule fixed before the data (§5) and the
predictions (§6). The session that ran it read the protocol alone.

```bash
lab/av1/tools/tools.sh && ARMS=simd client/decode/wasm/dav1d/build.sh   # libaom 3.15.1, SVT-AV1 v4.2.0, dav1d 1.5.4, dav1d-WASM
lab/av1/fetch_data.sh dbts_a1 … dbts_c5                     # 15 sound DBT volumes, five a system
P=/path/to/venv/bin/python D=lab/av1/data W=lab/.av1-work/gop B=lab/.av1-build
$P lab/av1/bytes/frame-groups/rho_test.py && $P lab/av1/bytes/frame-groups/rho.py $W/rho.jsonl $D/dbts_*          # ~1 h, 4 cores
$P lab/av1/bytes/frame-groups/arc.py $D $W/arc.jsonl dbts_a1 … dbts_c5          # fetches each source again, reads its header
$P lab/av1/bytes/frame-groups/mutate.py $B $D/dbts_a3 && $P lab/av1/bytes/frame-groups/mutate.py $B $D/dbts_b4   # 10- and 8-bit tops
$P lab/av1/bytes/frame-groups/gop.py $B $W $W/bytes.jsonl $D/dbts_* --encoder aom --presets good:6 --keep dbts_a1,dbts_b1,dbts_c1
$P lab/av1/bytes/frame-groups/gop.py $B $W $W/bytes.jsonl $D/dbts_* --encoder htj2k
$P lab/av1/bytes/frame-groups/gop.py $B $W $W/bytes.jsonl $D/dbts_{a1,b1,c1} --encoder aom --presets cpu0 --groups 1,2,4,8,16
$P lab/av1/bytes/frame-groups/gop.py $B $W $W/bytes.jsonl $D/dbts_{a1,b1,c1} --encoder svt --presets 8,0 --groups 1,2,4,8,16
$P lab/av1/bytes/frame-groups/gop.py $B $W $W/bytes.jsonl $D/dbts_* --encoder aom --groups 8,16 --altref
$P lab/av1/bytes/frame-groups/gop.py $B $W $W/bytes.jsonl $D/dbts_{a1,b1,c1} --encoder aom --representation plain
$P lab/av1/bytes/frame-groups/payloads.py $B $W $W/frames $D/dbts_{a1,b1,c1}
NODE_PATH=$(npm root -g) node lab/av1/bytes/frame-groups/time.mjs --frames $W/frames --rounds 10 --out $W/time.json
$P lab/av1/bytes/frame-groups/report.py $W
```

**`rho.py`** takes each frame's LOCO-I median-predictor residual on the optimized representation's top and low
streams (`ingest.plan`), and for every pair of adjacent slices and every 64×64 block of frame t at least 8 px from
the edge, the Pearson correlation with frame t + 1's residual at the best integer offset within ±8 px and at
offset 0; per series the 10th, 50th and 90th percentiles over blocks and pairs. A block where either residual is
constant (the air around the breast) has no correlation and is left out. **`rho_test.py`** is §2's mutation: frames
of independent noise give ρ ≈ 0, a frame repeated gives 1, and the predictor takes each of its three branches.

**`arc.py`** fetches each set's DICOM again (checked against `data.json`'s pin), reads the X-Ray 3D Acquisition
Sequence (0018,9507) from its header and deletes the file.

**`gop.py`** codes the middle 16 slices of each series (`--frames`) in groups of G: each group of each stream in an
encoder run of its own, libaom with `--kf-min-dist=G --kf-max-dist=G --auto-alt-ref=0|1` over `ingest.py`'s
arguments, SVT-AV1 `--lossless 1 --lp 1 --keyint G --irefresh-type 2 --scd 0 --enable-tf 0|1` with grey as 4:2:0 at
mid-grey chroma (it has no 4:0:0), each group decoded alone through native dav1d, merged as the client does and
checked against the checksum written at fetch; HTJ2K through `ingest.py`'s served profile on the same frames.
**`mutate.py`** is §4's mutation: one sample of one frame flipped, and a group's frames reordered, must each make a
run inexact, and the unmutated run must stay exact.

**`payloads.py`, `time.mjs`, `page.js`** time an ask in headless Chromium through the product's decoder worker
(`client/decode/decoder.js`, `groupLength` G): a run's 16 frames asked in order, the top unit from the group
coding and the low unit from the intra one (the client decodes the low stream intra), each frame's decode by the
worker's own stamps and hashed against the truth (`--mutate` flips a sample, and every frame must then fail).
The dav1d-WASM arm is the same worker with `VideoDecoder` deleted (`dav1d-worker.js`). An ask at frame k of a group
costs the group's frames 0 … k; the summary is its mean over the run, per round, then the median over rounds.

## Measured (2026-10-08)

**What ran, and what was cut.** 4 cores, 15 GB. ρ on every adjacent pair of slices of all 15 sound DBT volumes
(`dbts_a1`…`dbts_c5`, five exams from each of systems A, B and C), both streams. The codings on the **middle 16
slices** of each volume, not the whole volume: libaom cpu0 lossless runs up to an hour on one 16-slice group of a
2.5 Mpx low stream, so whole volumes at every G and preset would take days here. So **G ∈ {24, 32, whole series}
were not run** (G = 16 is the whole run), and the cut cells are claimed nowhere. libaom `good` 6 at every G ≤ 16 on
all 15; cpu0 at G ∈ {1, 2, 4, 8, 16} on the first series of each system (`dbts_a1`, `dbts_b1`, `dbts_c1`) only;
alt-ref on at G ∈ {8, 16} at `good` 6 on all 15 (not at cpu0); SVT-AV1 presets 0 and 8 at G ∈ {1, 2, 4, 8, 16} and
the plain representation at `good` 6, both on the same three series. HTJ2K on the same 16 slices of all 15.

**Content.** Optimized representation, k = 2 by depth: systems A and C are 12-bit (a 10-bit top, a 2-bit low),
system B 10-bit (an 8-bit top, a 2-bit low). **Scan arc**: system B records 14.35–15.19° in (0018,9507)'s primary
positioner scan arc, with a primary increment of 1.03–1.09°; systems A and C record 0.0 for the arc and the
increment, which is no arc, so theirs is **not recorded**. **No series records a projection count.**

### ρ (§2)

Median [10th–90th percentile] over blocks and pairs. **The floor is 0.059**: independent noise gives that at the best
of the 289 offsets (and −0.001 at offset 0), so a best-offset ρ near 0.06 is no correlation at all.

| series | slices | blocks | top, best offset | top, offset 0 | low, best offset | low, offset 0 | scan arc |
| --- | --: | --: | --- | --- | --- | --: | --- |
| `dbts_a1` | 56 | 19 684 | 0.112 [0.082–0.646] | 0.035 [−0.021–0.156] | 0.060 [0.050–0.079] | 0.000 | not recorded |
| `dbts_a2` | 87 | 26 870 | 0.116 [0.083–0.873] | 0.033 [−0.018–0.194] | 0.060 [0.050–0.083] | 0.000 | not recorded |
| `dbts_a3` | 43 | 9 939 | 0.109 [0.079–0.565] | 0.053 [0.009–0.236] | 0.060 [0.050–0.082] | 0.000 | not recorded |
| `dbts_a4` | 69 | 32 032 | 0.111 [0.078–0.321] | 0.016 [−0.030–0.095] | 0.060 [0.050–0.076] | 0.000 | not recorded |
| `dbts_a5` | 71 | 18 642 | 0.125 [0.090–0.769] | 0.055 [0.004–0.357] | 0.060 [0.050–0.082] | 0.000 | not recorded |
| `dbts_b1` | 50 | 35 694 | 0.181 [0.135–0.533] | 0.122 [0.022–0.213] | 0.059 [0.050–0.076] | 0.001 | 15.19° |
| `dbts_b2` | 71 | 53 277 | 0.189 [0.139–0.395] | 0.176 [0.108–0.253] | 0.058 [0.049–0.073] | 0.000 | 14.35° |
| `dbts_b3` | 63 | 38 447 | 0.266 [0.203–0.506] | 0.250 [0.158–0.324] | 0.060 [0.050–0.076] | 0.000 | 14.37° |
| `dbts_b4` | 84 | 34 821 | 0.228 [0.169–0.592] | 0.198 [0.031–0.278] | 0.060 [0.050–0.081] | 0.000 | 15.17° |
| `dbts_b5` | 66 | 27 437 | 0.215 [0.156–0.501] | 0.196 [0.106–0.279] | 0.059 [0.050–0.076] | 0.000 | 14.36° |
| `dbts_c1` | 69 | 18 105 | 0.117 [0.081–0.906] | 0.037 [−0.012–0.362] | 0.061 [0.050–0.088] | 0.000 | not recorded |
| `dbts_c2` | 56 | 15 832 | 0.117 [0.082–0.758] | 0.048 [0.006–0.325] | 0.060 [0.050–0.085] | 0.000 | not recorded |
| `dbts_c3` | 70 | 26 574 | 0.116 [0.082–0.851] | 0.032 [−0.016–0.349] | 0.060 [0.050–0.084] | 0.001 | not recorded |
| `dbts_c4` | 66 | 11 748 | 0.118 [0.081–0.908] | 0.048 [0.002–0.662] | 0.061 [0.051–0.105] | 0.001 | not recorded |
| `dbts_c5` | 73 | 22 032 | 0.113 [0.080–0.885] | 0.034 [−0.014–0.275] | 0.060 [0.050–0.083] | 0.000 | not recorded |

Per system, the median of the series' medians (top, best offset): **A 0.112** (0.109–0.125), **B 0.215**
(0.181–0.266), **C 0.117** (0.113–0.118). The low stream is at the noise floor on every series.

### Exactness (§4)

Every coding decoded group by group through native dav1d 1.5.4 and checked against the fetch checksum: **234 cells,
3 315 of 3 744 frames exact.** **libaom with alt-ref off: 159 of 159 cells exact** (2 544 frames), at both presets and
both representations. HTJ2K: 15 of 15. **Inexact, so not used:** libaom with alt-ref on, on every 10-bit top (systems
A and C, 20 of 20 cells: only 2–5 of 16 frames exact), and SVT-AV1 inter on every 10-bit top (`dbts_a1`, `dbts_c1`,
16 of 16 cells, 1–8 of 16). Both are exact on system B's 8-bit top and low. On one such group, libaom's own `aomdec`
and dav1d decode the same samples, 5–72 of them off by up to 4: the streams are not lossless, not the decoder.

### Bytes (§4)

**Gain** is 1 − bytes(G) ÷ bytes(G = 1), the sum of both streams, both coded at G; positive is smaller. G1/HTJ2K is
the intra coding's bytes over HTJ2K's on the same 16 slices. *top* and *low* are each stream's best gain over G > 1.

**libaom `good` 6 (the shipped preset), alt-ref off, every frame exact:**

| series | G1/HTJ2K | G2 | G3 | G4 | G6 | G8 | G12 | G16 | top | low |
| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| `dbts_a1` | 0.945 | −1.06% | −1.63% | −1.82% | −1.73% | −2.20% | −2.33% | −2.38% | −1.41% | −0.26% |
| `dbts_a2` | 0.945 | −1.50% | −1.86% | −2.23% | −2.41% | −2.61% | −2.51% | −2.68% | −2.03% | −0.26% |
| `dbts_a3` | 0.947 | −0.75% | −0.93% | −1.12% | −1.22% | −1.32% | −1.30% | −1.40% | −0.93% | −0.30% |
| `dbts_a4` | 0.946 | −1.61% | −1.98% | −1.99% | −2.94% | −2.57% | −2.37% | −2.87% | −0.81% | −3.55% |
| `dbts_a5` | 0.952 | −1.03% | −1.55% | −1.80% | −1.86% | −1.98% | −1.76% | −1.90% | −1.35% | −0.28% |
| `dbts_b1` | 0.939 | −0.16% | −0.22% | −0.24% | −0.26% | −0.27% | −0.25% | −0.25% | −0.14% | −0.19% |
| `dbts_b2` | 0.950 | −0.29% | −0.73% | −0.90% | −0.96% | −0.99% | −0.93% | −1.62% | −0.03% | −0.65% |
| `dbts_b3` | 0.939 | +0.74% | +0.95% | +1.13% | +1.24% | +1.36% | +1.40% | **+1.51%** | +2.65% | −0.28% |
| `dbts_b4` | 0.747 | −5.52% | −6.76% | −8.31% | −9.38% | −10.54% | −11.51% | −12.30% | −1.49% | −12.65% |
| `dbts_b5` | 0.781 | −4.93% | −7.02% | −8.01% | −9.46% | −9.83% | −11.21% | −12.55% | −1.71% | −10.08% |
| `dbts_c1` | 0.943 | −1.39% | −1.73% | −2.43% | −2.24% | −2.44% | −2.37% | −2.54% | −1.82% | −0.37% |
| `dbts_c2` | 0.956 | −1.14% | −1.37% | −1.67% | −1.74% | −3.01% | −1.96% | −2.13% | −1.39% | −0.50% |
| `dbts_c3` | 0.947 | −1.41% | −1.76% | −2.12% | −2.29% | −2.49% | −2.43% | −2.59% | −1.84% | −0.37% |
| `dbts_c4` | 0.948 | −1.39% | −1.70% | −2.08% | −2.26% | −2.44% | −2.23% | −2.31% | −1.78% | −0.38% |
| `dbts_c5` | 0.945 | −1.23% | −1.51% | −1.82% | −1.97% | −2.14% | −2.07% | −2.24% | −1.59% | −0.36% |

**On 14 of the 15 series every G > 1 is larger than intra**; the one gain is `dbts_b3`'s, +1.51 % at G = 16. With
the low stream kept intra (the client decodes it intra) and only the top at G, the best is still +1.70 % (`dbts_b3`)
and every other series stays below zero.

**libaom cpu0, alt-ref off** (G ∈ {2, 4, 8, 16}): `dbts_a1` 0.940 of HTJ2K intra, −0.96 / −2.37 / −3.60 / −4.42 %;
`dbts_b1` 0.935, −0.57 / −0.48 / −0.26 / −0.03 %; `dbts_c1` 0.938, +0.05 / +0.07 / +0.09 / **+0.13 %**. Top alone at
best +0.30 %, low alone at best −0.06 %.

**libaom `good` 6, alt-ref on** (exact on system B only), G = 8 / 16: `dbts_b1` +0.97 / +1.39 %, `dbts_b2` −0.63 /
−0.13 %, `dbts_b3` +2.67 / **+3.19 %**, `dbts_b4` −5.40 / −5.45 %, `dbts_b5` −5.51 / −6.42 %: **1.2–6.8 points better
than alt-ref off** at the same G on every series but `dbts_b2` at G = 8 (+0.36). The gain is all in the top
(+2.5 to +6.5 %); the low stream's inter is 2.6–20.6 % larger than its intra.

**SVT-AV1** (exact on `dbts_b1` only), G = 2 / 4 / 8 / 16: preset 0 +0.87 / +1.75 / +2.21 / **+2.43 %** over its own
intra, which is 1.009 of HTJ2K's bytes; preset 8 −1.89 / +0.46 / +0.73 / +0.87 % over an intra at 1.029. Its best,
preset 0 at G = 16, is 0.985 of HTJ2K's bytes, 5 % over libaom's intra at either preset.

**Plain representation, `good` 6** (G = 2 … 16): `dbts_a1` 1.052 of HTJ2K intra, −1.05 to −1.83 %; `dbts_b1` 0.973,
−0.34 to −0.67 %; `dbts_c1` 1.064, −1.26 to −2.33 %. Every G > 1 larger than intra, as on the optimized.

### Decode cost of an ask (§4)

Headless Chromium 141.0.7390.37 (playwright 1.56.1, Node 22.22.0), the product's `decoder.js` worker, one ask at a
time; the 16-slice runs of `dbts_a1`, `dbts_b1`, `dbts_c1` at `good` 6; 1× and 4× CPU throttle, each a fresh browser
every round, 10 rounds in a Williams order (`lab/order.mjs`), arms and sets rotating inside. **Mean ask, ms**: the
median over rounds of each round's mean over the run's asks, [range], n = 10; every one of 5 760 frames exact.

| throttle | series | HTJ2K | dav1d-WASM G1 | WebCodecs G1 | G4 | G8 | G16 | rule's bound, G4–G16 |
| --- | --- | --: | --: | --: | --: | --: | --: | --: |
| 1× | `dbts_a1` | 35.0 [32.0–44.9] | 216.9 [199.7–222.4] | 115.4 [109.4–122.9] | 285.4 [267.0–308.6] | 515.8 [488.5–565.2] | 989.8 [908.3–1074.7] | 54–56 |
| 1× | `dbts_b1` | 111.9 [102.2–121.9] | 486.6 [475.9–547.1] | 243.2 [232.5–267.5] | 579.1 [545.0–640.3] | 1022.2 [1002.5–1157.1] | 2057.1 [1970.9–2122.8] | 164 |
| 1× | `dbts_c1` | 35.8 [32.3–38.4] | 193.8 [188.5–207.5] | 114.2 [105.3–121.8] | 278.2 [260.4–307.0] | 499.2 [450.0–543.9] | 930.3 [848.9–1050.3] | 51–52 |
| 4× | `dbts_a1` | 145.4 [134.3–166.6] | 929.3 [892.2–1030.3] | 465.9 [449.0–491.5] | 1163.7 [1113.8–1239.7] | 2068.5 [1951.6–2239.6] | 4064.0 [3741.9–4223.6] | 165–166 |
| 4× | `dbts_b1` | 449.4 [436.9–497.6] | 2083.9 [2034.8–2170.0] | 946.9 [903.7–988.6] | 2319.8 [2190.6–2663.6] | 4139.3 [4004.8–4405.5] | 7837.5 [7431.5–8026.7] | 502 |
| 4× | `dbts_c1` | 146.6 [127.6–165.4] | 852.1 [787.4–871.8] | 452.9 [411.9–478.3] | 1100.4 [1058.1–1170.0] | 2019.5 [1871.7–2104.5] | 3808.9 [3598.7–4235.5] | 161–163 |

The rule's bound is one HTJ2K frame's decode plus the wire time, at 20 Mbit/s, of the bytes a frame saves against
HTJ2K at that G (top at G, low intra). **Every G > 1 is 4.6–24.6× over it at 4×**; already at G = 1 WebCodecs takes
2.1–3.3× HTJ2K's time on these frames. **dav1d-WASM at G > 1 could not be timed in the product worker**: every split
group fails at its second frame (`undecodable: frame 0 was not decoded before it here`) — `av1.js` decodes the low unit
on the same dav1d instance as `{ key: true }`, which flushes it and clears the top's predecessor, so the next top unit
has nothing to predict from. WebCodecs keeps a decoder per stream and is not affected. One decode at a time on a
4-core host does not saturate it; nothing here is claimed for concurrent asks, and container numbers are not phone
numbers.

### The predictions (§6)

*Gain* is the best G ≤ 16's, G = 1 included (so never below 0), libaom alt-ref off, unless said otherwise.

| # | held? | the deciding numbers |
| --- | --- | --- |
| P1 | **did not hold** for A and C, not refuted | system medians A 0.112, B 0.215, C 0.117: none above 0.6 or below 0.1, but A and C are under the predicted 0.2 (the floor is 0.059) |
| P2 | **held** | largest gain on any series, `good` 6: +1.51 % (`dbts_b3`, G16); cpu0: +0.13 % (`dbts_c1`, G16); none ≥ 5 % |
| P3 | **did not hold** | Spearman(gain, ρ) over 15 series +0.46 (14 gains are 0), and +0.11 on the best G > 1's own gain: under 0.6, and at ≥ 6 series no relation on the second. Scan arc: recorded by system B alone (14.35–15.19°), Spearman(arc, ρ) −0.10 over its 5 series; across systems not testable |
| P4 | **not refuted**; its 80 % clause failed where there was a gain | best G ≥ 8 over G4: at most +0.39 points (`good` 6, `dbts_b3`) and +0.45 (cpu0, `dbts_b1`), under 0.5; on the two series with any gain G2 or G4 holds 75 % (`dbts_b3`, G4) and 54 % (cpu0 `dbts_c1`, G4) of it |
| P5 | **held** | the low stream's inter is never smaller than its intra: at best −0.06 % (cpu0 `dbts_c1`), −0.19 % (`good` 6 `dbts_b1`); with alt-ref on −2.55 % or worse; SVT preset 0 `dbts_b1` +0.13 %, under 0.5 % |
| P6 | **refuted** (system B; A and C inexact) | alt-ref on beats off by +1.23 to +6.84 points on 9 of 10 exact cells (`dbts_b4` G16 +6.84) |
| P7 | **refuted** (`dbts_b1` alone exact) | SVT-AV1 preset 0 +2.43 % (G16) against libaom cpu0's best G > 1 −0.03 %; preset 8 +0.87 % against `good` 6's −0.16 %: opposite signs, 2.46 points apart at the slow presets |
| P8–P10 | **not testable here** | no sound breast ultrasound cine, ABUS or contrast angiography run |

### The rule (§5)

* **DBT: G = 1.** No sound series meets the first test — the best gain at `good` 6 is +1.51 % against the 20 % it
  needs — nor the third (every mean ask at 4× is over its bound); the second, ≤ 0.80 of HTJ2K's bytes, is met only
  by `dbts_b4` and `dbts_b5` at G = 1 (0.747, 0.781) and by neither at any G > 1 (0.788 and 0.819 at their best).
* **Conclusive for DBT**: three systems, five series each, all under the 20 % line with libaom (`good` 6 at most
  +1.51 %, cpu0 at most +0.13 %), and SVT-AV1 where exact does not cross it (+2.43 %). Measured on the middle 16
  slices of each volume and G ≤ 16; G ∈ {24, 32, whole} were not run.
* **Breast ultrasound cine, ABUS, contrast angiography: no decision**, G = 1 by default. None of the sets the lab
  fetches is a sound one of these (the breast cine are MPEG-4 Part 2 clips). Each needs, from ≥ 2 independent sources
  with ≥ 2 series each: native frames stored uncompressed or losslessly (no MPEG, no lossy JPEG, (0028,2110) absent
  or `00`), whole and in acquisition order, under a licence that allows commercial use (CC BY or alike, not CC BY-NC)
  — B-mode cine with the probe slow or still for P8, ABUS volumes for P9, contrast angiography runs for P10. Listed
  for `## Blocked` in [`docs/av1/queue.md`](../../../../docs/av1/queue.md), which this row does not edit.
