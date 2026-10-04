# total

A whole series filled through the downloader against the real server behind the relay, wire plus
decode, every arm of a series on the same link and CPU. Queue row 23 (TOTAL) of
[`docs/av1/queue.md`](../../../docs/av1/queue.md); the reading is in
[`docs/av1/README.md`](../../../docs/av1/README.md) §Total time.

```bash
lab/av1/tools.sh && ARMS=simd lab/av1/dav1d-wasm/build.sh      # libaom, native dav1d, dav1d-WASM
lab/decode-bench/fetch_decoder.sh                              # OpenJPH, the shipped package
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160  # builds ojph_compress once
client/transport-ts/build.sh                                   # the client's session bundle
lab/av1/fetch_data.sh rf_fluoro us_liver dbt12_ea1141 dbt10_ea1141
for s in rf_fluoro us_liver dbt12_ea1141 dbt10_ea1141; do        # ~40 min, one core each
  lab/av1/.venv/bin/python lab/av1/total/make_frames.py lab/.av1-build lab/.av1-work/total lab/av1/data/$s &
done; wait
for r in $(seq 0 13); do                                         # ~45 min a round
  NODE_PATH=$(npm root -g) node lab/av1/total/run.mjs --rounds 1 --first-round $r --out rows.jsonl
done                                    # then --first-round 14 on any cell VOID left under n = 10
NODE_PATH=$(npm root -g) node lab/av1/total/run.mjs --summary --out rows.jsonl
NODE_PATH=$(npm root -g) node lab/av1/total/run.mjs --rounds 1 --links r50000 --throttles 1 --mutate sample
```

**Series.** The taxonomy's content this container can reach: the two breast tomosynthesis volumes
(`dbt12_ea1141`, 29 × 614×1359 12-bit; `dbt10_ea1141`, 24 × 678×1727 10-bit) and the two cines,
fluoroscopy (`rf_fluoro`, 18 × 768² 12-bit) and ultrasound (`us_liver`, 70 × 760×421 RGB 8). Breast
ultrasound and angiography are blocked on the network policy (queue §Blocked); the tomosynthesis
projections were not run.

**Arms**, each one study, every frame one store entry, the decoder the product's own choice from
what `connect` is told:

| arm | stored | `connect` | series |
| --- | --- | --- | --- |
| `htj2k` | the served HTJ2K profile | OpenJPH | all |
| `av1` | libaom 3.15.1 lossless intra, cpu0 | `codec: "av1"` → dav1d-WASM | all |
| `wc` | the same frames | `+ depth` ≤ 10 → WebCodecs | ≤ 10 bits: `dbt10`, `us_liver` |
| `t11` | split, v ≫ 2 at 12 bits + v & 3 at 8 | `+ split: 2` → dav1d-WASM | 12-bit grey |
| `t10` | split, v ≫ 3 at 10 bits + v & 7 at 8 | `+ split: 3, depth: 10` → WebCodecs | 12-bit grey |
| `gop` | the whole series one group, no alt-ref | `groupLength: n` → dav1d-WASM | `dbt10`, the one series a group beat intra on |
| `pre` | row PREVIEW's lossy preview: 10-bit 4:0:0, G = 8, CRF 20, cpu6 | `groupLength: 8` → dav1d-WASM | `rf_fluoro` |

**Row TOTAL2** adds row LLSIZE's best codings (libaom 3.15.1, cpu0, one thread), made with
`ARMS=l2,rct make_frames.py …` and run on the fixed links only (`--links r5000,r20000,r50000`):

| arm | stored | `connect` | series |
| --- | --- | --- | --- |
| `l2` | v ≫ 2 at its container + v & 3 at 8, `--tune-content=screen --sb-size=64` | `split: 2` → dav1d-WASM | grey |
| `l2wc` | the same frames | `+ depth` (10, or 8 on `dbt10`) → WebCodecs | grey |
| `rct` | the reversible colour transform, 10-bit 4:4:4, sRGB-tagged, screen + sb64 | `rct: true` → dav1d-WASM | `us_liver` |
| `rctwc` | the same frames | `+ depth: 10` → WebCodecs | `us_liver` |
| `rct8wc` | the same transform, G = 8, no alt-ref, libaom's default tuning | `+ groupLength: 8` → WebCodecs | `us_liver` |

The ultrasound's preview is 4:2:0 colour, which neither product decoder takes, so it has no `pre`
arm. Colour is tagged sRGB (primaries BT.709, transfer sRGB, identity matrix): with the identity
matrix alone, WebCodecs reports BT.709 and the product module refuses every frame
([`docs/decode/README.md`](../../../docs/decode/README.md) §AV1). Every exact arm's frames are
decoded natively and matched with the checksum written when the series was fetched before they
are written; `pre`'s truth is its native decode's per-frame hash.

**Links.** `r5000`, `r20000`, `r50000`: a fixed rate, 40 ms round trip, a 200-packet queue, as row
FILL. `lte-good` and `wifi-home`: row PROF's profiles (`lab/scripts/profile_cells.sh`) — mahimahi's
`TMobile-LTE-short` trace (16.7 Mbit mean, 50 ms, Gilbert–Elliott 0.01 % in bursts of 3.5, a 500 ms
FIFO) and the Wi-Fi steps 15/40/10/30/15 Mbit of 12 s (30 ms, 0.5 %, 300 ms) — **without** PROF's
competing flow and outage, which this harness does not run. The trace is fetched into
`~/.cache/wtpacs-traces` and checked against the hash PROF recorded.

**A visit** is its own `exact-server`, relay (`link_impair.py --self-timing`) and headless Chromium;
the page connects the downloader as the product does — three decoders, two frames outstanding each,
no warm-up — and fills the whole series once connected. *First* is frame 0's pixels on the page,
*all* the last frame's, both from the fill's issue; every frame's pixels are hashed against its
truth once the fill is done. 4× is `lab/scripts/cpu_throttle.mjs` on the browser's process tree.
(set × link × throttle) cells run in a Williams order each round (`lab/order.mjs`), the arms inside
each cell the same way offset by the cell's position; a visit whose relay prints `VOID` is dropped.

**The rig.** Four cores: the relay alone on core 3 at `chrt -f 50`, browser and server on 0–2.

**Checked.** `--mutate sample` (one bit of every decoded frame) and `--mutate truth` (one hex digit
of every checksum) each turned every arm of all four series to 0 exact.

**Pins.** Node 22.22.0; playwright's Chromium 141.0.7390.37 (`CHROME_PATH` overrides);
`@cornerstonejs/codec-openjph` 2.4.11; dav1d 1.5.4 under emscripten 3.1.74 (`simd.wasm`,
623 146 B since SVCDEC; the 14 rounds of `bc35549` ran on the 623 042 B build before it); libaom 3.15.1 and OpenJPH 0.31.0 as `tools.sh` and `gen_htj2k_fixtures.sh` pin them;
`TMobile-LTE-short.down` sha256 `4f33dce8dd811b5702272af64aaf64d3913719919abd776edf1e0f7c0965da43`. Nothing built, fetched or generated is committed.
