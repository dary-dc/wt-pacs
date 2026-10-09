# lab/av1/delivery/scalable/encoder — libaom's real-time scalable encoder, lossless

Queue row 15 (SVC) of [`docs/av1/queue.md`](../../../../../docs/av1/queue.md). Whether
`svc_encoder_rtc`, libaom's real-time scalable (SVC) example, codes losslessly at 8, 10 and 12 bits,
4:0:0 and 4:4:4, every layer's frames checked against the encoder's input. The verdict is also in
[`docs/av1/README.md`](../../../../../docs/av1/README.md) §Measured here.

```bash
lab/av1/delivery/scalable/encoder/build.sh                      # tools.sh, then the example stock and patched, ~2 min
lab/av1/fetch_data.sh rf_fluoro mr_ispy1 us_liver
python3 lab/av1/delivery/scalable/encoder/svc.py lab/.av1-build lab/.av1-work/svc OUT.tsv SET_DIR ...   # ~2 h, 4 cores
```

The synthetic sets are `roundtrip.py`'s frames (16 × 512², grey in `ct` mode, RGB in `cine` mode)
at 8, 10 and 12 bits, made with `roundtrip.frames_for`; the real ones are row DATA's fluoroscopy
(18 × 768², 12-bit), MR (58 × 512², 11 bits coded at 12) and RGB ultrasound (70 × 760×421, 8-bit).

## Tools

libaom **3.15.1**, from the tarball `tools.sh` pins (SHA-256 `8ca0c527…8d01bf`): the stock example
from `tools.sh`'s own build tree, and a second build with
[`svc_encoder_rtc.patch`](svc_encoder_rtc.patch) applied. The patch touches the example's command
line only, not the library: `--bit-depth=12` (profile 2), `--profile=N`, `--monochrome`,
`--layer-q` (row SVCQ's per-layer quantizers) and `--rgb` (row WCBASE: 4:4:4 tagged as G, B, R —
BT.709 primaries, sRGB transfer, identity matrix — as dav1d's and WebCodecs' paths in the product
require), the last two unused here. Without
it the example takes 8 and 10 bits only, sets profile 0, and has no way to ask for 4:0:0. It stays in
the lab; nothing in the product encodes. dav1d 1.5.4 decodes.

## Settings

```
svc_encoder_rtc -o OUT -lm MODE -sl S -tl T -b 600000×S -bl 600000,… --min-q=0 --max-q=0 \
  -k 100000 -sp (7 | 10) -d B [-r 1/1,1/1[,1/1]] [--profile=P --monochrome]  IN.y4m
dav1d -q -i OUT_j.av1 -o DEC.y4m --alllayers (1 | 0)
```

* **`--min-q=0 --max-q=0` is the lossless control**: quantizer 0 is AV1's lossless mode, and no
  hook was needed. The rate is set far above any lossless frame so rate control never drops one;
  each layer's frames are checked against the pattern it must carry, so a dropped frame fails the
  cell.
* Layouts (`-lm`): L1T1 (0), L1T3 (2), L2T1 (5), L3T3 (9) with the example's 1/2 and 1/4 spatial
  scaling, and L2T1 and L3T3 again with every spatial layer full size (`-r 1/1,…`) — quality layers
  that can each be checked against the input. Speeds 7 (the example's default) and 10.
* The example writes one IVF per operating point, `OUT_j` for spatial layer s and temporal layer t
  at j = s·T + t, holding that layer and every layer below it; each is decoded alone. A full-size
  layout outputs every spatial layer (`--alllayers 1`), a scaled one only its top (`--alllayers 0`).
  Each decoded frame is matched to its input frame by the IVF timestamp.
* Grey enters as 4:2:0 with neutral chroma (as in row TOOL): the stock example codes that chroma and
  it is checked to come back neutral; the patched one drops it (`--monochrome`, dav1d returns
  `mono`). RGB enters as 4:4:4 planes G, B, R. The example refuses odd sizes, so the ultrasound's
  421 rows are padded by one edge row and the decoded frame cropped before it is compared.
* A downscaled spatial layer is a picture the encoder made, with no checksum outside the encoder,
  so it is decoded (its frame count checked) but not compared.

## The cells

Every layout × both speeds per cell; "exact" means every compared layer of every one of them.

| example | grey 8 (4:0:0) | grey 10 (4:0:0) | grey 12 (4:0:0) | RGB 8 (4:4:4) | RGB 10 (4:4:4) | RGB 12 (4:4:4) |
| --- | --- | --- | --- | --- | --- | --- |
| stock | exact (as 4:2:0) | exact (as 4:2:0) | **not encodable**: `-d 12` refused | **not encodable**: "Failed to encode frame: Invalid parameter" (profile 0) | **not encodable**, the same | **not encodable**: `-d 12` refused |
| patched | exact | exact | exact | exact | exact | exact |

| real series | stock | patched |
| --- | --- | --- |
| `rf_fluoro`, 12-bit grey | not encodable (12-bit) | exact, 692 frames over 38 layers |
| `mr_ispy1`, 11 bits at 12 | not encodable (12-bit) | exact, 2 212 frames |
| `us_liver`, RGB 8 | not encodable (4:4:4) | exact, 2 668 frames |

In all, 418 compared layers and 10 436 decoded frames, every one exact; 154 scaled layers decoded
with the right frame count and not compared; 84 stock encodes refused. Raw rows with each operating
point's bytes land in `OUT.tsv`.

**Bytes, by the way** (not this row's question; the top operating point's IVF over row SIZE's
HTJ2K): L1T1 at speed 7 is 1.067 of HTJ2K on fluoroscopy, 1.102 on MR and 1.581 on the ultrasound —
above `aomenc`'s slowest intra (1.024, 1.034, 1.117). Three temporal layers (L1T3) move it by −0.2 to +2.9 % at speed 7
and +1.1 to +8.8 % at speed 10.

## The checks were mutated

Each broke the check on purpose; each was caught:

* lossy encode (`--min-q=8 --max-q=8`, grey 10, L1T3): 0/28 frames exact;
* decoded frames matched to the next timestamp (grey 10, L3T3 full-size): 6 of 168 exact;
* frame 5's checksum corrupted (L1T3): 15/16 in the top layer, the lower two, which do not carry
  frame 5, still exact;
* the stock example's neutral chroma off by one: 0/28 exact;
* frame 8 dropped from every layer's timestamps: every layer reported frames missing.

## Verdict

**libaom 3.15.1's real-time SVC encoder is lossless at quantizer 0 in every cell it can encode**:
grey and RGB at 8, 10 and 12 bits, one to three spatial and temporal layers, speeds 7 and 10,
synthetic and real content. The stock example can encode only 8- and 10-bit 4:2:0; 12-bit and
4:4:4 (and so 4:0:0 without chroma) need its command line patched, the library unchanged. Measured
on 16–70 frames a set with a keyframe only at the start: a long live run, other speeds and the
library's other real-time options are not.
