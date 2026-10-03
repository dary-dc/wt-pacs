# lab/av1 — the AV1 tools and the lossless round trip

Queue row 1 (TOOL) of [`docs/av1/queue.md`](../../docs/av1/queue.md). The phase's decisions live in
[`docs/av1/README.md`](../../docs/av1/README.md); this file holds the commands and the cells.

```bash
lab/av1/tools.sh                                                    # build once, ~4 min on 4 cores
python3 lab/av1/roundtrip.py lab/.av1-build lab/.av1-work lab/.av1-work/cells.tsv  # ~20 min
```

Both write only under `lab/.av1-build/` and `lab/.av1-work/` (gitignored).

## Tools, pinned

| tool | version | fetched as | pin |
| --- | --- | --- | --- |
| libaom `aomenc` | 3.8.2 | release tarball, `storage.googleapis.com/aom-releases` | SHA-256 `98f7d6d7…021a202` |
| libaom `aomenc` | **3.15.1 — the one the project uses** | same | SHA-256 `8ca0c527…8d01bf` |
| SVT-AV1 `SvtAv1EncApp` | v4.2.0, static | `gitlab.com/AOMediaCodec/SVT-AV1` tag | commit `9292ec8e` |
| dav1d (CLI, `-Dbitdepths=8,16`) | 1.5.4 | `github.com/videolan/dav1d` tag | commit `54706fc6` |

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

**On every real series AV1 is larger than HTJ2K, and inter coding collects nothing.** At the
slowest preset intra is the smallest AV1 coding of each set but fluoroscopy, where G = 2 is 0.04 %
smaller; a group costs up to 37 % more than intra on the ultrasound. Two checks against the
settings: on the ultrasound (8-bit, where alt-ref is exact) alt-ref on gives 1.572 at G = 8 and
1.545 whole at cpu6, no better; libaom's all-intra mode (`--usage=2`, cpu6) gives 1.040, 1.070 and
1.192 on the three sets, no better than good-quality intra.

The synthetic sets (16 frames, row TOOL's; independent noise in every frame, so inter cannot pay)
for completeness: grey 8 AV1 0.91–0.93 of HTJ2K (SVT-AV1 0.91–0.94), grey 10 1.10–1.12, grey 12
1.27–1.31, odd-sized grey 12 1.27–1.30; `cine` RGB 8, posterised to three levels, is screen
content — AV1 intra 0.055, JPEG XL 0.039 of HTJ2K — and the real ultrasound goes the other way.

**Encode time** (an ingest cost; single runs on this container's 4 cores, the ultrasound sharing
them with the synthetic run): AV1 intra at cpu0 7.6, 2.4 and 7.9 s a frame on fluoroscopy, MR and
ultrasound, at cpu6 0.3–1.4 s; HTJ2K under 1 s a set; JPEG XL 9–33 s a set.

**Mutated**: a frame moved out of its group, a group one frame short, samples off by one, the
signed shift not undone, a truth checksum corrupted — each reported inexact. A failed decode or a
short one counts as inexact rather than stopping the run (the first two mutations found that).
