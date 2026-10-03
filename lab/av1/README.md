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
