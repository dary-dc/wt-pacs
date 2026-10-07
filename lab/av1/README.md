# lab/av1 — the AV1 tools and the lossless round trip

Queue row 1 (TOOL) of [`docs/av1/queue.md`](../../docs/av1/queue.md). The phase's decisions live in
[`docs/av1/README.md`](../../docs/av1/README.md); this file holds the commands and the cells.

```bash
lab/av1/tools.sh                                                    # build once, ~4 min on 4 cores
python3 lab/av1/roundtrip.py lab/.av1-build lab/.av1-work lab/.av1-work/cells.tsv  # ~20 min
```

Both write only under `lab/.av1-build/` and `lab/.av1-work/` (gitignored).

## The folders, by what they measure

One folder a queue row grew here; read by what each measures, they fall in five groups. Row LAYOUT
(2026-10-07) proposes moving them so, renamed by subject (`README.md` §Names); the moves wait for the
rows still writing in these folders (`docs/av1/queue.md` row 56).

| group | today | proposed |
| --- | --- | --- |
| **tools** — build and pin the encoders and decoders | `tools.sh`, `dav1d-wasm/`, `versions/` | `tools/`, `tools/dav1d-wasm/`, `tools/newer/` |
| **exact** — the round trip, the coded frame's format, every engine | `roundtrip.py`, `item/`, `splitok/`, `wcap/`, `xbrowser/` | `exact/`, `exact/coded-frame/`, `exact/split/`, `exact/webcodecs/`, `exact/engines/` |
| **bytes** — what each coding costs on the wire, and to encode | `size.py`, `depth.py`, `enc.py`, `av2.py`, `llsize/`, `encx/`, `remap/`, `pocgap/`, `embed/`, `jxl/`, `lcevc/`, `breast/` | `bytes/`, `bytes/{represented, low-stream, remap, prior-gap, embedded, jpeg-xl, lcevc, breast}/` |
| **decode** — time and memory a frame, per decoder | `speed/`, `decspeed/`, `split10/`, `rep14/`, `fasthtj2k/`, `decode/`, `mixdec/`, `footprint/`, `gpu/`, `reslevel/`, `wclat/` | `decode/{per-frame, settings, split-webcodecs, high-depth, htj2k-threads, worker, mixed, memory, webgpu, resolution-level, latency}/` |
| **delivery** — a series through the downloader, wire and decode | `fill/`, `total/`, `splittime/`, `preview/`, `resid/`, `bases/`, `svc/`, `svcq/`, `svcshape/`, `svcdec/`, `wcbase/` | `delivery/{fill, total-time, split-rule, preview, residual, bases-first}/`, `delivery/scalable/{encoder, two-layer, shape, client, webcodecs-base}/` |

`fetch_data.*`, `data.json` and `requirements.txt` stay here: every group reads the series.

## Tools, pinned

| tool | version | fetched as | pin |
| --- | --- | --- | --- |
| libaom `aomenc` | 3.8.2 | release tarball, `storage.googleapis.com/aom-releases` | SHA-256 `98f7d6d7…021a202` |
| libaom `aomenc` | **3.15.1 — the one the project uses** | same | SHA-256 `8ca0c527…8d01bf` |
| SVT-AV1 `SvtAv1EncApp` | v4.2.0, static | `gitlab.com/AOMediaCodec/SVT-AV1` tag | commit `9292ec8e` |
| dav1d (CLI, `-Dbitdepths=8,16`) | 1.5.4 | `github.com/videolan/dav1d` tag | commit `54706fc6` |
| AVM `avmenc`, `avmdec` (AV2's reference software) | v1.0.0 | `github.com/AOMediaCodec/avm` tag; its third-party sources are vendored in that tree | commit `966a7d7c` |

The full checksums and commits are in [`tools.sh`](tools.sh), which refuses a mismatch. Host: gcc
13.3.0, cmake 3.28.3, meson 1.3.2, nasm 2.16.01, numpy 2.4.6. The libaom git host refused this
container, so libaom comes from its release tarballs; `aomdec` (3.15.1) is built alongside and used
only as a second opinion below.

## Settings that code lossless

```
aomenc --ivf -o OUT.ivf --lossless=1 --cpu-used=N --limit=16 --profile=P \
  --bit-depth=B --input-bit-depth=B  (--monochrome | --matrix-coefficients=identity) \
  (--kf-max-dist=0 | --kf-min-dist=8 --kf-max-dist=8 --auto-alt-ref=0)  IN.y4m
SvtAv1EncApp -i IN.y4m -b OUT.ivf --lossless 1 --preset N --input-depth B -n 16 --keyint (1 | 8)
dav1d -q -i OUT.ivf -o DEC.y4m                        # the whole stream
dav1d -q -i TU.obu -o DEC.y4m --demuxer section5      # one temporal unit alone
```

* Profile: 0 for grey 8/10, 1 for RGB 8, 2 (Professional) for grey 12.
* Grey enters as Y4M `420`/`420p10`/`420p12` with neutral chroma: libaom's Y4M reader takes `mono`
  only at 8 bits, and `--monochrome` drops the chroma, so the stream is 4:0:0 and dav1d returns one
  plane (`Cmono`, `Cmono10`, `Cmono12`).
* RGB enters as Y4M `444` planes in the order G, B, R, which identity `matrix_coefficients` (0)
  means; 4:2:0 would drop colour and is not lossless.
* **`--auto-alt-ref=0` is required for inter at 10 and 12 bits** (below).
* **`--threads=1` is part of the pin:** libaom's lossless bytes change with the thread count (0.02–0.06 % a
  frame at 4 on 10-bit DBT, still exact) — [`pocgap`](pocgap/README.md).
* SVT-AV1 codes 4:2:0 only, 8 and 10 bits: grey goes in as 4:2:0 with neutral chroma and comes back
  with two chroma planes; RGB and 12-bit are not possible.

**Container and the unit.** Both encoders write IVF and dav1d is fed IVF. One IVF frame is one
temporal unit, and every stream here has one per shown frame (16 for 16 frames, alt-ref or not —
a hidden frame rides in the same unit as a shown one). The unit's bytes, the IVF frame payload after
its 12-byte header, are already a low-overhead OBU stream (temporal delimiter first, every OBU
sized), which is what the store would hold per entry. In every intra cell each unit decodes alone,
as `--demuxer section5`, to its exact frame: each carries its own sequence header.

## The cells

16 synthetic frames from `lab/scripts/gen_frame_pnm.py`: grey in `ct` mode, RGB in `cine` mode,
512×512 and a 277×333 grey 12 for odd dimensions; inter is a group of 8 (`kf-min/max-dist` 8,
`--keyint 8`). A cell is exact when every decoded frame hashes to the checksum written when its
input was made. `cpu6`/`cpu2` and `p8`/`p4` are each encoder's practical and slow preset.

| encoder | grey 8 (4:0:0) | grey 10 (4:0:0) | grey 12 (4:0:0, Prof.) | RGB 8 (4:4:4) | RGB 12 (4:4:4, Prof.) | grey 12, 277×333 |
| --- | --- | --- | --- | --- | --- | --- |
| libaom 3.8.2, intra | exact | exact | exact | exact | exact | exact |
| libaom 3.15.1, intra | exact | exact | exact | exact | **aomenc fails** | exact |
| libaom 3.8.2, inter, defaults | exact | **3–4 frames wrong**, \|Δ\| ≤ 2 | **3–8 frames wrong**, up to 59 219 samples, \|Δ\| ≤ 11 | exact | **7 frames wrong** at cpu6 (477 samples, \|Δ\| ≤ 2), exact at cpu2 | **3 frames wrong** at cpu6, exact at cpu2 |
| libaom 3.15.1, inter, defaults | exact | **3–5 frames wrong**, \|Δ\| ≤ 2 | **4–8 frames wrong**, up to 61 669 samples, \|Δ\| ≤ 11 | exact | **aomenc fails** | **1–3 frames wrong** |
| libaom 3.8.2 and 3.15.1, inter, `--auto-alt-ref=0` | exact | exact | exact | exact | exact (3.8.2) | exact |
| SVT-AV1 v4.2.0, intra (grey as 4:2:0) | exact | exact | — | — | — | — |
| SVT-AV1 v4.2.0, inter (any setting tried) | exact | **6–7 frames wrong**, \|Δ\| ≤ 3 | — | — | — | — |

Every cell ran at both presets; a range is over them. Keyframes were never wrong.

**libaom 3.15.1's `aomenc` cannot encode 12-bit 4:4:4**: from Y4M or raw, with or without identity
matrix, it stops at "Failed to set chroma subsampling x" — the encoder rejects the subsampling control
the CLI sends for 12-bit input (cause not traced); 3.8.2 accepts it. Not chased further: no modality
here is 12-bit colour. The raw rows,
with bytes and encode seconds (contended, not a claim), land in `lab/.av1-work/cells.tsv`.

**The inexact inter cells are the encoder's.** The wrong streams decode to byte-identical output in
dav1d 1.5.4 and aomdec 3.15.1, two independent decoders, so the bitstream itself describes the
wrong samples. In libaom the fault goes with the alt-ref frames: `--auto-alt-ref=0` or
`--lag-in-frames=0` makes every cell exact on both versions; `--arnr-strength=0`, `--deltaq-mode=0`,
`--aq-mode=0`, `--enable-tpl-model=0`, CDEF and restoration off, and the compound, warped and
global-motion tools off do not. The mechanism is not established. Grey 8 and RGB 8 were exact
either way, here — on this content, which is not evidence that they always are. SVT-AV1's 10-bit
inter stayed wrong with `--enable-tf 0`, `--lookahead 0` and `--pred-struct 1` (low delay).

**rav1e has no lossless mode**: 0.7.1 (the distro's library, through ffmpeg 6.1.1's `librav1e`) at
`-qp 0` on one 8-bit 4:4:4 frame returned 1 674 of 196 608 samples wrong, |Δ| ≤ 2.

## The checks were mutated

Each broke the check on purpose; each was caught:

* lossy encode (`--lossless` dropped, `--cq-level=10`): 0/4 frames exact, 926 841 samples, |Δ| ≤ 139;
* RGB planes reassembled in the wrong order: 0/4 exact;
* one frame's ground-truth checksum corrupted: 3/4 exact;
* the decode-alone check fed unit 0 for every frame: 1/4 alone-exact.

## Verdict

libaom 3.15.1 is pinned. Lossless, every (depth × layout) asked for is exact intra on both
versions, and inter only with `--auto-alt-ref=0` (12-bit 4:4:4 only through 3.8.2's `aomenc`) — which the project's inter encodes must always
carry, and whose round trip must be re-checked on real content (row DATA). SVT-AV1 is intra-only
for grey 8 and 10 (as 4:2:0) and 8-bit inter; its 10-bit inter is not used. rav1e is not used.

## SIZE — lossless bytes against HTJ2K

Queue row 6. Every coding below was decoded and matched the checksum written when its frame was
made (122/122 cells); each AV1 group was decoded alone, from its own keyframe, as a group served
as the transport's unit would be.

```bash
lab/av1/fetch_data.sh                    # row DATA's series, docs/FIXTURES.md §AV1 data
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160   # builds OpenJPH 0.31.0 once
python3 lab/av1/size.py lab/.av1-build lab/.av1-work/size OUT.tsv lab/av1/data/rf_fluoro …
```

* **HTJ2K** is the served profile (`docs/FIXTURES.md` §HTJ2K sets) at the series' `BitsStored`, a
  signed series shifted by 2^(B−1) as `sign_htj2k.py` serves it; decoded with `ojph_expand`.
* **JPEG XL** is a reference column only: the distro's `cjxl` 0.7.0, `-d 0 -e 7`, decoded with
  `djxl`. Fed as 16-bit above 8 bits, because 0.7.0 from a 12-bit PGM is **not lossless**
  (550 694 of 589 824 samples wrong, \|Δ\| ≤ 8, on one fluoroscopy frame); declared 16-bit, exact.
* **AV1** is libaom 3.15.1 as row TOOL found exact: `--auto-alt-ref=0` for every G > 1, keyframes
  at exactly every G (`--kf-min-dist=G --kf-max-dist=G`), intra `--kf-max-dist=0`; `cpu-used` 0
  (slowest) and 6. A series is offset by its minimum if negative and coded at the smallest of 8, 10,
  12 bits that holds it: MR's 0..1765 at 12. CT (−2048..3746) and the cone-beam set (0..7364) need
  13 bits, which AV1 cannot code — row DEPTH's split. SVT-AV1 runs only where row TOOL found it
  exact, grey 8 and intra grey 10: on synthetic sets only, since no real set is 8- or 10-bit grey.

Bytes over HTJ2K's (lower is better); HTJ2K's own bytes over raw in brackets:

| set | HTJ2K | JPEG XL | AV1 | G = 1 | 2 | 4 | 8 | 16 | 32 | whole |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `rf_fluoro`, 18 × 768², 12-bit, 2 frames/s | 9.27 MB (0.436) | 0.934 | cpu0 | **1.024** | 1.024 | 1.026 | 1.024 | 1.027 | — | 1.027 |
| | | | cpu6 | 1.039 | 1.053 | 1.061 | 1.063 | 1.067 | — | 1.068 |
| `mr_ispy1`, 58 × 512², 11-bit | 10.82 MB (0.356) | 0.917 | cpu0 | **1.034** | 1.048 | 1.055 | 1.059 | 1.061 | 1.062 | 1.062 |
| | | | cpu6 | 1.058 | 1.058 | 1.059 | 1.059 | 1.059 | 1.059 | 1.060 |
| `us_liver`, 70 × 760×421, RGB 8 | 18.02 MB (0.268) | 0.857 | cpu0 | **1.117** | 1.333 | 1.440 | 1.497 | 1.512 | 1.525 | 1.534 |
| | | | cpu6 | 1.747 | 1.650 | 1.615 | 1.594 | 1.584 | 1.579 | 1.572 |
| `ct_lidc`, 100 × 512², 13 bits signed | 16.36 MB (0.312) | 0.831 | — | DEPTH | | | | | | |
| `xa_dynact16`, 64 × 512², 13 bits | 14.81 MB (0.441) | 0.913 | — | DEPTH | | | | | | |
| `dbt12_ea1141`, 29 × 614×1359, 12-bit tomosynthesis, 1 mm | 14.48 MB (0.299) | 0.917 | cpu0 | **1.043** | 1.056 | 1.062 | 1.066 | 1.068 | — | 1.068 |
| | | | cpu6 | 1.071 | 1.071 | 1.072 | 1.071 | 1.071 | — | 1.071 |
| `dbt10_ea1141`, 24 × 678×1727, 10-bit tomosynthesis, 1 mm | 13.64 MB (0.243) | 0.851 | cpu0 | 0.977 | 0.974 | 0.978 | 0.974 | 0.973 | — | **0.971** |
| | | | cpu6 | 0.996 | 0.987 | 0.982 | 0.980 | 0.979 | — | 0.978 |
| `dbtproj_ge`, 9 × 1914×2572, 14-bit tomosynthesis projections | 36.73 MB (0.415) | 0.937 | — | DEPTH | | | | | | |
| `dbtproj_holo`, 15 × 1280×2048, 14-bit tomosynthesis projections | 29.34 MB (0.373) | 0.929 | — | DEPTH | | | | | | |

**On every real series AV1 is larger than HTJ2K, and inter coding collects nothing** — *corrected
by CONTENT (below): the 10-bit tomosynthesis is the one series where AV1 coded whole is smaller.* At the
slowest preset intra is the smallest AV1 coding of each set but fluoroscopy, where G = 2 is 0.04 %
smaller; a group costs up to 37 % more than intra on the ultrasound. Two checks against the
settings: on the ultrasound (8-bit, where alt-ref is exact) alt-ref on gives 1.572 at G = 8 and
1.545 whole at cpu6, no better; libaom's all-intra mode (`--usage=2`, cpu6) gives 1.040, 1.070 and
1.192 on the three sets, no better than good-quality intra.

The synthetic sets (16 frames, row TOOL's; independent noise in every frame, so inter cannot pay)
for completeness: grey 8 AV1 0.91–0.93 of HTJ2K (SVT-AV1 0.91–0.94), grey 10 1.10–1.12, grey 12
1.27–1.31, odd-sized grey 12 1.27–1.30; `cine` RGB 8, posterised to three levels, is screen
content — AV1 intra 0.055, JPEG XL 0.039 of HTJ2K — and the real ultrasound goes the other way.

**Tomosynthesis (queue row CONTENT).** Two reconstructed volumes, 1 mm slices, from two
reconstruction systems ([`docs/FIXTURES.md`](../../docs/FIXTURES.md) §AV1 data) — the content
where neighbouring frames share most, and still **inter collects at most 1.8 %**: the best group
against intra is 1.2 % *larger* on the 12-bit volume (G = 2, cpu0) and 0.6 % smaller on the 10-bit
one (whole volume, cpu0; 1.8 % at cpu6). On the 10-bit volume AV1 is under HTJ2K at every G, by
2–3 % at cpu0 — the first series where AV1 coded whole is; SVT-AV1 intra there 0.988 (preset 0) and
1.046 (8). The 12-bit volume is 4–7 % over. Every coding exact (30/30, each group decoded alone).

**Tomosynthesis projections (queue row TAXO).** The raw views two vendors' systems reconstruct a
volume from, one per tube angle ([`docs/FIXTURES.md`](../../docs/FIXTURES.md) §AV1 data) — the
taxonomy's other cine-like content. Both need 14 bits as stored (one saturated value, 16383, above
data that ends at 3648 and 1794), so AV1 codes them only split: DEPTH below, groups included.

**Encode time** (an ingest cost; single runs on this container's 4 cores, the ultrasound sharing
them with the synthetic run): AV1 intra at cpu0 7.6, 2.4 and 7.9 s a frame on fluoroscopy, MR and
ultrasound, at cpu6 0.3–1.4 s; HTJ2K under 1 s a set; JPEG XL 9–33 s a set.

**Mutated**: a frame moved out of its group, a group one frame short, samples off by one, the
signed shift not undone, a truth checksum corrupted — each reported inexact. A failed decode or a
short one counts as inexact rather than stopping the run (the first two mutations found that).

**The breast family (queue row BREAST, [`breast`](breast/README.md)).** Ten more series — a third DBT
reconstruction system and a second 10-bit volume, a third system's projections, two FFDM and two synthesized-2D
series, breast ultrasound cine (grey, RGB) and stills — as items, every item exact natively, in Node and in
Chromium. **The optimized item is 0.873–0.962 of HTJ2K's bytes on 8 of 10** at cpu0 (0.888–0.979 at the shipped
preset); a stretched-range mammogram is 1.006 (plain AV1 1.238) and the 276×305 stills 1.002. **Inter does not pay on
DBT** — four slice series, 0.963–1.054 of intra at cpu0 and 0.998–1.050 at `good` 6 — **nor on the RGB cine (0.98–1.00);
on the grey cine it halves the bytes** (G = 16 0.53 of intra, 0.47 of HTJ2K) and the decode, but that clip is a lossy
MPEG-4 recording whose unchanged blocks repeat exactly, so the gain is the source's, not a scanner's.

**Row DATA3's series ([`breast`](breast/README.md) §Row DATA3's series).** Nine more, 9–16 bits, every frame
exact at every k of its depth natively, in Node and in three engines. Smallest arm over HTJ2K at cpu0: MR 9-bit
0.910 (k = 0), synthesized 2D 0.938 and 0.951, FFDM 0.986 and 0.989, the two signed CTs 0.899 and 0.939, PET 15-bit
0.996 (w10), film 16-bit 1.001 (w10); one vendor's FFDM is a stretched range where plain AV1 is 1.29.

## DEPTH — samples AV1 cannot code in one stream

Queue row 7. AV1 codes at most 12 bits, unsigned. A series is offset by its minimum when that is
negative, then needs `bit_length(max + offset)` bits — measured per series, never assumed:

| set | stored | range | offset | bits needed | one AV1 stream? |
| --- | --- | --- | --- | --- | --- |
| `ct_lidc` | 16-bit signed | −2048..3746 (−1097..3746 without the pad) | +2048 | 13 | no |
| `xa_dynact16` | 16-bit unsigned | 0..7364 | 0 | 13 | no |
| `dbt12_ea1141` | 12 of 16 bits | 0..2690 | 0 | 12 | yes, at 12 bits (Professional) |
| `dbt10_ea1141` | 10 of 16 bits | 0..1012 | 0 | 10 | yes, at 10 bits |
| `mr_ispy1` | 16-bit signed, no negative sample | 0..1765 | 0 | 11 | yes, at 12 bits (Professional) |
| `rf_fluoro` | 12 of 16 bits | 26..3984 | 0 | 12 | yes, at 12 bits (Professional) |
| `dbtproj_ge` | 14 of 16 bits | 0..3648, and 16383 | 0 | 14 | no |
| `dbtproj_holo` | 14 of 16 bits | 103..1794, and 16383 | 0 | 14 | no |

```bash
python3 lab/av1/depth.py lab/.av1-build lab/.av1-work/depth OUT.tsv 15 lab/av1/data/ct_lidc …
DEPTH_SPLITS=top11+low DEPTH_GROUPS=1,2,4,8,0 python3 lab/av1/depth.py … 0 lab/av1/data/dbtproj_ge
```

`depth.py` splits each sample v (after the offset; b = 13, 14 for the projections) into planes, codes
each as a 4:0:0 intra stream with libaom 3.15.1 (cpu0 and cpu6, `--lossless=1`), decodes them with
dav1d and merges; every merged frame matched its checksum (44/44 cells; with the two
tomosynthesis sets of row CONTENT, run with 0 rounds — bytes only, not timed — 68/68).

| split | planes (stream bits) | merge |
| --- | --- | --- |
| direct | v (12) | — |
| hi8+lo8 | v ≫ 8 (8), v & 255 (8) | hi ≪ 8 \| lo |
| top12+low | v ≫ 1 (12), v & 1 (8) | top ≪ 1 \| low |
| top11+low | v ≫ 2 (12), v & 3 (8) | top ≪ 2 \| low |
| top10+low | v ≫ 3 (10), v & 7 (8) | top ≪ 3 \| low — every stream ≤ 10 bits |
| low12+top | v & 4095 (12), v ≫ 12 (8) | top ≪ 12 \| low |

Bytes over HTJ2K's (SIZE's served profile), cpu0 (cpu6):

| set | direct | hi8+lo8 | top12+low | **top11+low** | top10+low | low12+top |
| --- | --- | --- | --- | --- | --- | --- |
| `ct_lidc` | — | 1.199 (1.243) | 0.927 (0.938) | **0.918 (0.927)** | 0.994 (1.002) | 0.980 (1.009) |
| `xa_dynact16` | — | 1.336 (1.365) | 1.075 (1.102) | **0.997 (1.015)** | 1.000 (1.011) | 1.184 (1.218) |
| `dbt12_ea1141` | 1.043 (1.071) | 1.269 (1.303) | 0.970 (0.986) | **0.943 (0.948)** | 0.990 (0.993) | 1.043 (1.071) |
| `dbt10_ea1141` | 0.977 (0.996) | 1.038 (1.060) | 0.950 (0.958) | **0.946 (0.952)** | 1.029 (1.036) | 0.978 (0.996) |
| `mr_ispy1` | 1.034 (1.058) | 1.069 (1.091) | 1.000 (1.009) | **0.990 (0.997)** | 1.071 (1.077) | 1.034 (1.058) |
| `rf_fluoro` | 1.024 (1.039) | 1.263 (1.287) | 0.967 (0.973) | **0.946 (0.950)** | 0.999 (1.002) | 1.024 (1.039) |
| `dbtproj_ge` | — | 1.312 (1.341) | **0.952 (0.951)** | 0.998 (0.995) | 1.000 (1.001) | 1.067 (1.093) |
| `dbtproj_holo` | — | 1.081 (1.089) | **0.923 (0.924)** | 1.002 (1.002) | 1.047 (1.047) | 0.950 (0.951) |

**Coding the two lowest bits apart is smaller than coding the sample whole** — on every set,
including the two AV1 can code directly (MR 0.990 against 1.034, fluoroscopy 0.946 against 1.024),
and on every set but the 10-bit tomosynthesis it is the only AV1 coding below HTJ2K. Why libaom codes the bits better apart is not
established. Splitting off three bits gives back the gain but keeps every stream at ≤ 10 bits; hi/lo
bytes, the obvious split, is the worst (1.04–1.37). A set under 13 bits is split as if it were
13 (the 10-bit volume's top11 is v ≫ 2, 8 bits in a 12-bit stream), and the gain holds on 10-bit
tomosynthesis too: 0.946 against 0.977 direct. Measured on 10- to 13-bit data only: what
top11+low costs on a full 16-bit series (a 5-bit low plane) is not.

**On 14 bits the rule is the two low bits apart, which is top12+low there** (v ≫ 2, v & 3 — the
same cut top11+low makes on 13 bits): 0.952 and 0.923 of HTJ2K on the two projection sets, where
top11+low, three bits apart, is 0.998 and 1.002. JPEG XL (reference) is 0.937 and 0.929. On the
second vendor's views low12+top, which leaves the saturated value alone in a nearly empty top plane
(3–4 KB), is 0.950; on the first it is 1.067.

**Groups on a split (row TAXO).** `DEPTH_GROUPS=1,2,4,8,0` codes both planes in groups of G (0 is
the whole series; `--auto-alt-ref=0`, keyframes at every G, as SIZE) and decodes each group alone.
top11+low on the projections, bytes over HTJ2K, cpu0 (cpu6):

| set | G = 1 | 2 | 4 | 8 | whole |
| --- | --- | --- | --- | --- | --- |
| `dbtproj_ge` (whole = 9) | 0.998 (0.995) | 0.997 (0.994) | 0.996 (0.994) | **0.995 (0.993)** | 0.995 (0.993) |
| `dbtproj_holo` (whole = 15) | **1.002 (1.002)** | 1.004 (1.006) | 1.005 (1.008) | 1.005 (1.009) | 1.005 (1.010) |

**Inter does not pay on projections**: at most 0.29 % under intra (first vendor, G = 8, cpu0), and
0.2–1.0 % over it on the second. Groups were run on top11+low, chosen before the 14-bit result made
top12+low the better split; groups on top12+low were not run. Every cell exact (32/32 on the two
sets, each group decoded alone); 0 rounds, so bytes only. Mutated: the group window shifted by one
unit, keyframes one frame off, a group's frames reversed — each reported inexact in every cell it
reaches.

**What each costs the decoder.** Native dav1d 1.5.4 (its assembly on), one thread, a whole cpu6
stream a process with its start-up, output discarded; ms a frame summed over a split's streams,
median [min–max], n = 15, arms interleaved per set; container numbers (tomosynthesis not timed):

| set | direct | hi8+lo8 | top12+low | top11+low | top10+low | low12+top |
| --- | --- | --- | --- | --- | --- | --- |
| `ct_lidc` 512² | — | 19.0 [16.9–21.0] | 16.9 [13.5–17.7] | 15.6 [12.4–16.7] | 13.3 [11.4–14.6] | 13.7 [11.5–15.3] |
| `xa_dynact16` 512² | — | 25.5 [23.0–27.3] | 25.2 [20.3–26.6] | 23.0 [20.7–24.1] | 19.0 [15.9–20.3] | 22.5 [19.6–23.9] |
| `mr_ispy1` 512² | 16.2 [14.1–18.5] | 18.5 [15.8–20.2] | 19.1 [16.0–20.9] | 16.5 [14.6–19.2] | 14.9 [12.6–17.0] | 17.3 [13.4–18.2] |
| `rf_fluoro` 768² | 46.9 [40.3–50.4] | 59.6 [49.3–63.8] | 52.8 [42.4–56.4] | 47.1 [40.6–50.9] | 39.2 [32.7–41.1] | 49.3 [37.8–53.3] |

Two decodes do not cost two: decode work follows the bytes, so top11+low decodes in the time of
direct, within the spread (MR 16.5 against 16.2, fluoroscopy 47.1 against 46.9). The merge is a shift
and an or, 0.05 ms per 512² frame in numpy. What a split costs in WASM is row SPEED's.

**Which decoder takes which stream.** 12-bit (direct, top12/top11+low, low12+top): dav1d native and
dav1d-WASM, exact (rows TOOL, WASM); WebCodecs in Chromium 141 refuses 12-bit at `decode()` (row
WCAP). 8- and 10-bit (hi8+lo8, top10+low): all three. A signed series costs nothing but its offset:
CT went through it here (+2048), exact.

**Mutated**: the high plane shifted by 7, the low plane dropped, CT's offset not undone — each
reported inexact.

**A third system's projections (row BREAST)**, 14 bits after the offset with no saturated outlier inside the crop
(122..16370): plain (two low bits off a 12-bit top), k = 2 and w10 are within 1 % of each other, 0.962–0.971 of HTJ2K
at cpu0.

**Rare levels mapped out instead of split (row REMAP)**: the level census and the remapped plane's bytes and decode
against the split are in [`remap`](remap/README.md).

## ENC — what lossless encoding costs

Queue row 14. libaom 3.15.1, `--lossless=1 --threads=1`, every `cpu-used` each usage accepts:
`--good` 0–6 and `--allintra` 0–9 as intra (`--kf-max-dist=0`), `--rt` 5–12 as low-delay inter
(one keyframe, the rest predicted — the shape of a live encode); against `ojph_compress` in the
served profile. The first 8 frames of each row-DATA and row-CONTENT set; a set over 12 bits is DEPTH's top11+low,
two streams timed together. Every output decoded with dav1d and matched the checksums written when
the frames were made: 546/546 runs exact, the `--rt` inter streams at 10–13 bits included.

```bash
python3 lab/av1/enc.py lab/.av1-build lab/.av1-work/enc OUT.tsv 8 3 lab/av1/data/mr_ispy1 …  # ~2 h
python3 lab/av1/enc.py summary OUT.tsv 8
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

## VERSIONS — the newer tools against the pinned

Row 57: libaom's and dav1d's heads, OpenJPH 0.32.0, emscripten 6.0.11 and Chromium 154 against the pins.
Nothing gains enough to adopt; libaom's head writes the same bytes. Commands, sources and cells:
[`versions/README.md`](versions/README.md).

## AV2 — AVM v1.0.0 lossless against libaom and HTJ2K

Queue row 32. AVM is AV2's reference software ([`docs/av1/licensing.md`](../../docs/av1/licensing.md));
no browser decoder exists, and none is built.

```bash
lab/av1/tools.sh                         # AVM v1.0.0 beside libaom 3.15.1 and dav1d
lab/av1/fetch_data.sh                    # every row-DATA, CONTENT and TAXO series
AV2_GROUPS=rf_fluoro:2,dbt10_ea1141:4 AV2_PRESETS=6 python3 lab/av1/av2.py lab/.av1-build WORK OUT.tsv 10 lab/av1/data/…
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
