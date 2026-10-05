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

**Pins.** As row TOTAL's, plus `svc_encoder_rtc` from libaom 3.15.1 with
[`../svc/svc_encoder_rtc.patch`](../svc/svc_encoder_rtc.patch). Nothing built, fetched or generated is
committed.
