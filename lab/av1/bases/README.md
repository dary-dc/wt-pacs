# bases

Scalable AV1 delivered bases first, end to end in the lab: row SVCORDER's layer-major layout
([`docs/av1/adr-unit.md`](../../../docs/av1/adr-unit.md) §5, option B) through the unchanged downloader,
server and store, timed on row TOTAL's links and CPU. Queue row 40 (SVC) of
[`docs/av1/queue.md`](../../../docs/av1/queue.md); the reading is in
[`docs/av1/README.md`](../../../docs/av1/README.md) §A5, *Bases first, measured*.

```bash
lab/av1/svc/build.sh && ARMS=simd lab/av1/dav1d-wasm/build.sh   # patched svc_encoder_rtc, dav1d-WASM simd
lab/decode-bench/fetch_decoder.sh && client/transport-ts/build.sh
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160  # builds ojph_compress once
lab/av1/fetch_data.sh rf_fluoro us_liver
for s in rf_fluoro us_liver; do                                  # ~25 min, one core each
  lab/av1/.venv/bin/python lab/av1/bases/make_frames.py lab/.av1-build lab/.av1-work/bases lab/av1/data/$s &
done; wait
for r in $(seq 0 9); do                                           # ~15 min a round
  NODE_PATH=$(npm root -g) node lab/av1/total/run.mjs --frames lab/.av1-work/bases \
    --links r5000,r20000,r50000 --rounds 1 --first-round $r --out rows.jsonl
done
NODE_PATH=$(npm root -g) node lab/av1/total/run.mjs --frames lab/.av1-work/bases --links r5000,r20000,r50000 --summary --out rows.jsonl
```

**Arms**, each one study through the product's downloader, three decoders, two frames outstanding each:

| arm | stored | entries | decoder |
| --- | --- | --- | --- |
| `htj2k` | the served HTJ2K profile | F | OpenJPH |
| `av1` | libaom 3.15.1 lossless intra, cpu0 (row TOTAL's) | F | dav1d-WASM, G = 1 |
| `single` | `svc_encoder_rtc`, one lossless layer, one keyframe, speed 7 | F, frame order | dav1d-WASM, one group of F |
| `svc` | the same encoder at row SVCSHAPE's shape: a ¼-size base at q 40, a lossless top, one keyframe | 2F, layer-major | `decoder.js` here, a group of F per layer |

`svc`'s entry i < F is frame i's temporal unit up to its first OBU of spatial layer 1 — checked equal,
unit by unit, to the encoder's own base-layer stream — and entry F + i the whole unit; the bundle's
`frameCount` is 2F. The fill asks entries 0 … 2F − 1, so the downloader's one contiguous run is every
base and then every exact unit. `single` isolates the layering's cost from the encoder and the group:
`svc` and `single` are the same encoder, speed and keyframe interval.

**The decoder.** [`decoder.js`](decoder.js) speaks `client/downloader/decoder.js`'s protocol and is
handed to the downloader through its `decoderWorker` seam, so the product's worker is untouched. A
base entry decodes on dav1d-WASM (the product's `simd` build) to its spatial layer 0 and is posted as
`preview: true`, which the consumer hands to `onPreview`; an exact entry skips its unit's base picture
uncopied and posts the top. Bases decode in order on one decoder and exact units on another (each layer
is one group). The page ([`../total/page.js`](../total/page.js)) maps entry F + N to frame N and
counts a base that arrives after its frame's exact pixels as *late*, never shown.

**Measured**, per visit, from the fill's issue: the first picture of any frame; *shown*, the time every
frame has a picture on the page (its base, or its exact frame if that came first); *all*, every frame
exact. Truth: every exact frame against the checksum of the encoder's input — the ultrasound is 421
rows high and `svc_encoder_rtc` refuses odd sizes, so `single` and `svc` code it with its last row
repeated once (760×422) and are checked against that input; every base against the hash of native
dav1d 1.5.4's decode of the base stream at operating point 1. Links, rig, 4× and the Williams order
are row TOTAL's ([`../total/README.md`](../total/README.md)); fixed rates only.

**Checked, and mutated** (fluoroscopy, 50 Mbit/s, 1×): `--mutate sample` and `--mutate truth` turned
every arm to 0/18 exact and every base to 0/18 as native; a base entry decoded to the top layer failed
every base by name; previews left unmarked showed 0/18 previews and 18 stray exact frames; previews
posted 3 s late showed 18 late and *shown* fell back to the exact frames.

## Reading

13 rounds (10, then 3 more for the cells `VOID` thinned), 624 visits, 133 dropped `VOID`, n = 4–13 a
cell; 27 456/27 456 frames exact, 6 864/6 864 bases as native, none late, no stray. ms from the fill's
issue, median [min–max]; *shown* is every frame with a picture, *all* every frame exact:

| set, link | HTJ2K all | `av1` all | `single` all | `svc` first / shown | `svc` all | `svc` ÷ `single` |
| --- | --- | --- | --- | --- | --- | --- |
| fluoroscopy 5 Mbit 1× | 15 188 | 15 622 | 16 287 | 77 / 150 [137–167] | 16 297 | 1.00 |
| fluoroscopy 5 Mbit 4× | 15 228 | 15 915 | 16 602 | 127 / 339 [295–401] | 16 614 | 1.00 |
| fluoroscopy 20 Mbit 1× | 3 930 | 4 100 | 4 260 | 69 / 143 [125–188] | 4 276 | 1.00 |
| fluoroscopy 20 Mbit 4× | 3 970 | 4 395 | 7 614 | 128 / 327 [306–420] | 8 080 | 1.06 |
| fluoroscopy 50 Mbit 1× | 1 730 | 1 855 | 2 040 | 68 / 132 [123–178] | 2 138 | 1.05 |
| fluoroscopy 50 Mbit 4× | 1 775 | 3 206 | 7 513 | 129 / 364 [312–416] | 8 127 | 1.08 |
| ultrasound 5 Mbit 1× | 29 437 | 32 912 | 46 560 | 86 / 328 [299–386] | 46 782 | 1.00 |
| ultrasound 5 Mbit 4× | 29 475 | 33 096 | 46 788 | 164 / 1 012 [947–1 120] | 47 040 | 1.01 |
| ultrasound 20 Mbit 1× | 7 492 | 8 393 | 11 817 | 79 / 327 [305–377] | 11 874 | 1.00 |
| ultrasound 20 Mbit 4× | 7 526 | 8 609 | 23 337 | 156 / 1 096 [1 073–1 122] | 23 800 (n = 4) | 1.02 |
| ultrasound 50 Mbit 1× | 3 152 | 3 549 | 5 722 | 77 / 330 [294–415] | 5 874 | 1.03 |
| ultrasound 50 Mbit 4× | 3 192 | 7 266 | 22 909 | 163 / 1 098 [975–1 249] | 23 505 | 1.03 |

Bytes, the fill's whole: fluoroscopy HTJ2K 9 267 247, `av1` 1.024 of it, `single` 1.068, `svc` 1.067
(its bases 5 854 B, 0.063 %, counted twice); ultrasound HTJ2K 18 019 334, `av1` 1.117, `single` 1.581,
`svc` 1.589 (bases 63 728 B, 0.35 %). `single` and `svc` decode the series as one group on one decoder,
which is the 4× columns' clock; the bases decode on another, ahead of it.

**Pins.** As row TOTAL's, plus `svc_encoder_rtc` from libaom 3.15.1 with
[`../svc/svc_encoder_rtc.patch`](../svc/svc_encoder_rtc.patch). Nothing built, fetched or generated is
committed.
