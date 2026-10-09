# rep14

The layout of 13- and 14-bit samples as two AV1 streams: the two low bits apart, whose top is a
12-bit stream only dav1d decodes, against a top of 10 bits and the rest low, every stream one that
WebCodecs takes. Queue row 33 (REP14) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md); the
verdict is in [`docs/av1/README.md`](../../../../docs/av1/README.md) §A3.

```bash
lab/av1/tools/tools.sh && ARMS=simd client/decode/wasm/dav1d/build.sh      # libaom, native dav1d, dav1d-WASM
client/decode/wasm/fetch_openjph.sh                              # OpenJPH, the shipped package
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160  # builds ojph_compress once
client/transport-ts/build.sh                                   # the client's session bundle
lab/av1/fetch_data.sh dbtproj_ge dbtproj_holo ct_lidc
P="lab/av1/data/dbtproj_ge lab/av1/data/dbtproj_holo lab/av1/data/ct_lidc"
FRAMES=2 lab/av1/.venv/bin/python lab/av1/decode/high-depth/make_frames.py lab/.av1-build lab/.av1-work/rep14-sweep \
  --sweep 0,1,2,3,4,5,6,a6,a7,a8,a9 $P                         # the preset, ~40 min
lab/av1/.venv/bin/python lab/av1/decode/high-depth/make_frames.py lab/.av1-build lab/.av1-work/rep14 $P  # cpu0, ~45 min
for p in a6 a7 a9; do PRESET=$p lab/av1/.venv/bin/python lab/av1/decode/high-depth/make_frames.py \
  lab/.av1-build lab/.av1-work/rep14-$p $P; done                # the fast presets' bytes
NODE_PATH=$(npm root -g) node lab/av1/decode/high-depth/decode.mjs --rounds 12 --out decode.json
for r in $(seq 0 9); do
  NODE_PATH=$(npm root -g) node lab/av1/delivery/total-time/run.mjs --frames lab/.av1-work/rep14 --arms htj2k,d12,w10 \
    --rounds 1 --first-round $r --out total.jsonl
done                                                   # then rounds 10 and 11, which bring VOID-short cells to n >= 10
NODE_PATH=$(npm root -g) node lab/av1/delivery/total-time/run.mjs --frames lab/.av1-work/rep14 --arms htj2k,d12,w10 --summary --out total.jsonl
```

**Series.** Every frame of the two tomosynthesis projection series of row TAXO (`dbtproj_ge`,
9 × 1914×2572; `dbtproj_holo`, 15 × 1280×2048; 14 bits stored, unsigned) and the CT of row DATA
(`ct_lidc`, 100 × 512², −2048..3746, 13 bits after its +2048 offset).

**Layouts**, a sample v after the offset at b bits, a frame stored `[u32le top length][top unit][low unit]`
(`docs/av1/adr-unit.md` §2), the decoder the product's own choice from what `connect` is told:

| arm | top | low | `connect` | decoder |
| --- | --- | --- | --- | --- |
| `d12` | v ≫ 2 at 12 bits (Professional) | v & 3 at 8 | `split: 2` | dav1d-WASM |
| `w10` | v ≫ (b − 10) at 10 bits | the b − 10 low bits at 8 | `split: b − 10, depth: 10` | WebCodecs |
| `w10d` | the same frames | | `split: b − 10` | dav1d-WASM |
| `htj2k` | the served profile | | | OpenJPH |

Each stream is libaom 3.15.1, `--lossless=1 --monochrome --kf-max-dist=0 --threads=1
--tune-content=screen --sb-size=64` (row LLSIZE's best) at `--cpu-used=0`, or `aN` for
`--allintra --cpu-used=N`. `make_frames.py` decodes every unit alone with native dav1d, merges and
matches the checksum written when the series was fetched before it writes a frame.

**Preset.** The fastest preset within 2 % of cpu0's bytes, on the first two frames of each series:
good-quality 0–6, then `--allintra` 6–9. The sweep ran four encodes at once on four cores, so its
seconds rank the presets and are not ENC's uncontended figures. Bytes over cpu0's on the two frames:

| set, layout | 1–2 | 3–6 | a6 | a7 | a8 | a9 |
| --- | --- | --- | --- | --- | --- | --- |
| system 1, d12 | 1.054 | 0.994–0.995 | 1.000 | 0.999 | 1.064 | 1.062 |
| system 1, w10 | 1.000 | 1.000–1.002 | 1.005 | 1.005 | 1.011 | 1.008 |
| system 2, d12 | 1.075 | 0.999–1.000 | 1.001 | 1.002 | 1.086 | 1.085 |
| system 2, w10 | 1.002 | 1.001–1.003 | 1.006 | 1.008 | 1.018 | 1.016 |
| CT, d12 | 1.069 | 1.002–1.008 | 1.016 | 1.022 | 1.133 | 1.176 |
| CT, w10 | 1.001 | 1.003–1.007 | 1.015 | 1.023 | 1.108 | 1.130 |

At presets 1–2 libaom codes the 8-bit two-bit stream 20 % larger, which presets 0 and 3–7 do not.
On the whole series the CT's a6 is 1.026 (d12) and 1.021 (w10) of cpu0, so its fast preset is cpu6
(1.010, 1.009); the projections' a7 (d12) is 1.000 and 1.002, a9 (w10) 1.008 and 1.013.

**Decode** (`decode.mjs`): the product's `decoder.js` in headless Chromium, one worker an arm, one
warm-up frame, then every frame one at a time; the time is the worker's `decodeStart`–`decodeEnd`
(bytes in, merged samples and range out), each frame hashed against its truth. Each throttle cell is
a fresh browser in a Williams order (`lab/order.mjs`); sets and arms rotate inside it. 4× is
`lab/scripts/cpu_throttle.mjs` on the browser's process tree.

**Total time**: row TOTAL's harness ([`../../delivery/total-time`](../../delivery/total-time/README.md)) unchanged but for taking an
arm's stored form (`ext`) and `offset` from `arms.json`; its links, CPU, rig and order.

**Checked.** In `make_frames.py`, the native merge's top shifted one bit too far exits on the first
frame. In `decode.mjs`, on the CT: `--mutate sample` and `--mutate truth` turned every arm 0/100;
the offset left out of `connect`, and `split` one short, each turned all three AV1 arms 0/100 with
HTJ2K 100/100.

**Pins.** As [`../../delivery/total-time`](../../delivery/total-time/README.md): Node 22.22.0, playwright 1.56.1's Chromium
141.0.7390.37, `@cornerstonejs/codec-openjph` 2.4.11, dav1d 1.5.4 under emscripten 3.1.74
(`simd.wasm`, 623 146 B), libaom 3.15.1 and OpenJPH 0.31.0. Nothing built, fetched or generated is
committed.
