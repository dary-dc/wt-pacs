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

Row TOTAL2's run: `make_frames.py` with `ARMS=l2,rct` into `lab/.av1-work/total2`, then rounds 0–11
of `run.mjs --links r5000,r20000,r50000 --frames lab/.av1-work/total2`, rounds 12–15 on the cells
`VOID` left under n = 10; the reading is in the same README, §Total time. `--mutate sample` and
`--mutate truth` each turned every new arm to 0 exact.

**Row TOTAL3** sets the two representations of [`item-format.md`](../../../docs/av1/item-format.md)
against HTJ2K and row ENCX's encoding changes against the adopted one, made with
`ARMS=av1,l2,rct,x36,plain make_frames.py …` into `lab/.av1-work/total3` and run as
`--arms htj2k,plain,opt,x36 --links r5000,r20000,r50000`:

| arm | stored | `connect` | series |
| --- | --- | --- | --- |
| `plain` | `av1`'s frames: the samples direct, RGB as G, B, R | `depth` when ≤ 10 → WebCodecs, else dav1d-WASM | all |
| `opt` | `l2` on grey, `rct` on RGB | `l2wc`, `rctwc` | all |
| `x36` | `l2`'s top at v ≫ k, the low k bits packed MSB first and raw-deflated (zlib level 9); k = 3 on the fluoroscopy and the 12-bit volume (σ ≥ 17), 2 on the 10-bit one | `decoderWorker: deflate-worker.js` → the top through WebCodecs, the low through `DecompressionStream`, merged by the product's `av1-frame.js` | grey |

Rounds 0–12, 18 minutes each (10–12 topping up the cells `VOID` left short); 38 532/38 532 frames exact
over 1 170 visits, 144 `VOID`; `--summary --ref opt` sets x36 against the adopted representation. The
reading is in the same README, §Total time. `--mutate sample` and `--mutate truth` each turned every arm
to 0 exact, and the worker's unpack reading one bit off turned x36 alone to 0; ingest's merge shifted one
bit too far stops `make_frames.py` at frame 0.
The ultrasound has no `x36`: row ENCX's changes are the grey split's. `x36`'s frames are matched
with the series' checksum after a native decode and Python's inflate before they are written.

**Row ORDER** sets the order frames are asked in against the sequential fill, on the breast series
of rows 10 and 45: both tomosynthesis volumes and two four-view screening mammograms (`ffdm_c`, 4 ×
1914×2294, and `ffdm_a`, 4 × 2560×3328, 12-bit, stored R CC, L CC, R MLO, L MLO). Two arms a series,
HTJ2K and the adopted optimized item (`k2`: k = 2, WebCodecs), made with row SPLITTIME's
`make_frames.py --k 2` into `lab/.av1-work/order`, and two orders each, run as
`--arms htj2k,k2 --orders seq,prio --links r5000,r20000,r50000`:

| order | the page | useful |
| --- | --- | --- |
| `seq` | `fill(0 … N−1)`, as today | — |
| `prio` | `requestExactFrame` for each useful frame, most needed first, then the same fill | tomosynthesis: the centre slice ⌊N/2⌋ and two either side; mammograms: the MLO pair (2, 3) |

*Centre* is the first useful frame on the page, *useful* the last of them, both from the fill's issue.
The downloader takes asks before the fill and serves a fill as contiguous runs, lowest first
([`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md) §The downloader), so `prio` is the order a
client can already ask for, with no product change. `--mutate sample` and `--mutate truth` each turned
both orders of both arms to 0 exact.

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

**Row CLIENT** times a change to the downloader itself: `ARMS=none make_frames.py` (HTJ2K only) for
`rf_fluoro` and `dbt10_ea1141`, then `downloader_arm.sh f136363^ before` adds an arm running the
downloader as it was before the row, beside `htj2k` (the tree's), and (row SEAM, `downloader_arm.sh 541ceaf seambefore`) its decoder modules with it, and
`run.mjs --links r20000,r50000 --arms htj2k,before --rounds 10`. The reading is in
[`docs/ARCHITECTURE.md`](../../../docs/ARCHITECTURE.md) §The downloader.

**Row LOSSLINK** puts loss or jitter on top of each link and times an ask apart from the fill. The
10-bit volume as HTJ2K (`ARMS=l2 make_frames.py`, its `htj2k`) and as the adopted optimized item
(`lab/av1/item/ingest.py --representation optimized --preset cpu0`, each `NNN.av1` linked in as
`NNN.opt.av1` and `arms.json` set to `{"htj2k": {}, "opt": {"ext": "opt.av1"}}`), then rounds 0–12 of

```bash
run.mjs --frames lab/.av1-work/losslink --links r5000,r20000,r50000,lte-good \
  --impairs clean,l1,l2,l5,j5,j20 --fill 4 --asks-after 4
```

and rounds 13–14 on `--impairs clean,j5,j20`, the cells `VOID` left shortest. `l<p>` is p % loss each
way — iid on a fixed rate; on `lte-good` its Gilbert–Elliott bursts of 3.5 packets at a mean of p %, in
place of its 0.01 % — and `j<ms>` is ± that jitter each way, `--jitter-mode ordered` (one radio leg:
nothing overtaken); the relay's tally of server → client packets lost is kept a visit (`s2c`) and read
1.00–1.10 %, 2.04–2.13 %, 5.03–5.21 % a cell. A visit fills frames 0–3 (`--fill`), then once they are on the
page asks frames 4–7 one at a time (`--asks-after`), each timed from `requestExactFrame` to its pixels;
every frame of both hashed against its truth. `--mutate sample` and `--mutate truth` each turned both
arms to 0 of 12 exact (`--fill 8 --asks-after 4`, `l1` on 50 Mbit). The server's controller is its default, `cubic-restart`. The reading is in
[`docs/av1/README.md`](../../../docs/av1/README.md) §Under loss and jitter.
