# total

A whole series filled through the downloader against the real server behind the relay, wire plus
decode, every variant of a series on the same link and CPU. Queue row 23 (TOTAL) of
[`docs/av1/queue.md`](../../../../docs/av1/queue.md); the reading is in
[`docs/av1/README.md`](../../../../docs/av1/README.md) §Total time.

```bash
lab/av1/tools/tools.sh && VARIANTS=simd client/decode/wasm/dav1d/build.sh      # libaom, native dav1d, dav1d-WASM
client/decode/wasm/fetch_openjph.sh                              # OpenJPH, the shipped package
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160  # builds ojph_compress once
client/transport/ts/build.sh                                   # the client's session bundle
lab/av1/fetch_data.sh rf_fluoro us_liver dbt12_ea1141 dbt10_ea1141
for s in rf_fluoro us_liver dbt12_ea1141 dbt10_ea1141; do        # ~40 min, one core each
  lab/av1/.venv/bin/python lab/av1/delivery/total-time/make_frames.py lab/.av1-build lab/.av1-work/total lab/av1/data/$s &
done; wait
for r in $(seq 0 13); do                                         # ~45 min a round
  NODE_PATH=$(npm root -g) node lab/av1/delivery/total-time/run.mjs --rounds 1 --first-round $r --out rows.jsonl
done                                    # then --first-round 14 on any cell VOID left under n = 10
NODE_PATH=$(npm root -g) node lab/av1/delivery/total-time/run.mjs --summary --out rows.jsonl
NODE_PATH=$(npm root -g) node lab/av1/delivery/total-time/run.mjs --rounds 1 --links r50000 --throttles 1 --mutate sample
```

**Series.** The taxonomy's content this container can reach: the two breast tomosynthesis volumes
(`dbt12_ea1141`, 29 × 614×1359 12-bit; `dbt10_ea1141`, 24 × 678×1727 10-bit) and the two cines,
fluoroscopy (`rf_fluoro`, 18 × 768² 12-bit) and ultrasound (`us_liver`, 70 × 760×421 RGB 8). Breast
ultrasound and angiography are blocked on the network policy (queue §Blocked); the tomosynthesis
projections were not run.

**Variants**, each one series, every frame one store entry, the decoder the product's own choice from
what `connect` is told:

| variant | stored | `connect` | series |
| --- | --- | --- | --- |
| `htj2k` | the served HTJ2K profile | OpenJPH | all |
| `av1` | libaom 3.15.1 lossless intra, cpu0 | `codec: "av1"` → dav1d-WASM | all |
| `wc` | the same frames | `+ depth` ≤ 10 → WebCodecs | ≤ 10 bits: `dbt10`, `us_liver` |
| `t11` | split, v ≫ 2 at 12 bits + v & 3 at 8 | `+ split: 2` → dav1d-WASM | 12-bit grey |
| `t10` | split, v ≫ 3 at 10 bits + v & 7 at 8 | `+ split: 3, depth: 10` → WebCodecs | 12-bit grey |
| `gop` | the whole series one group, no alt-ref | `groupLength: n` → dav1d-WASM | `dbt10`, the one series a group beat intra on |
| `pre` | row PREVIEW's lossy preview: 10-bit 4:0:0, G = 8, CRF 20, cpu6 | `groupLength: 8` → dav1d-WASM | `rf_fluoro` |

**Row TOTAL2** adds row LLSIZE's best codings (libaom 3.15.1, cpu0, one thread), made with
`VARIANTS=l2,rct make_frames.py …` and run on the fixed links only (`--links r5000,r20000,r50000`):

| variant | stored | `connect` | series |
| --- | --- | --- | --- |
| `l2` | v ≫ 2 at its container + v & 3 at 8, `--tune-content=screen --sb-size=64` | `split: 2` → dav1d-WASM | grey |
| `l2wc` | the same frames | `+ depth` (10, or 8 on `dbt10`) → WebCodecs | grey |
| `rct` | the reversible colour transform, 10-bit 4:4:4, sRGB-tagged, screen + sb64 | `rct: true` → dav1d-WASM | `us_liver` |
| `rctwc` | the same frames | `+ depth: 10` → WebCodecs | `us_liver` |
| `rct8wc` | the same transform, G = 8, no alt-ref, libaom's default tuning | `+ groupLength: 8` → WebCodecs | `us_liver` |

The ultrasound's preview is 4:2:0 colour, which neither product decoder takes, so it has no `pre`
variant. Colour is tagged sRGB (primaries BT.709, transfer sRGB, identity matrix): with the identity
matrix alone, WebCodecs reports BT.709 and the product module refuses every frame
([`docs/decode/README.md`](../../../../docs/decode/README.md) §AV1). Every exact variant's frames are
decoded natively and matched with the checksum written when the series was fetched before they
are written; `pre`'s truth is its native decode's per-frame hash.

Row TOTAL2's run: `make_frames.py` with `VARIANTS=l2,rct` into `lab/.av1-work/total2`, then rounds 0–11
of `run.mjs --links r5000,r20000,r50000 --frames lab/.av1-work/total2`, rounds 12–15 on the cells
`VOID` left under n = 10; the reading is in the same README, §Total time. `--mutate sample` and
`--mutate truth` each turned every new variant to 0 exact.

**Row TOTAL3** sets the two representations of [`payload-format.md`](../../../../docs/av1/payload-format.md)
against HTJ2K and row ENCX's encoding changes against the adopted one, made with
`VARIANTS=av1,l2,rct,x36,plain make_frames.py …` into `lab/.av1-work/total3` and run as
`--variants htj2k,plain,opt,x36 --links r5000,r20000,r50000`:

| variant | stored | `connect` | series |
| --- | --- | --- | --- |
| `plain` | `av1`'s frames: the samples direct, RGB as G, B, R | `depth` when ≤ 10 → WebCodecs, else dav1d-WASM | all |
| `opt` | `l2` on grey, `rct` on RGB | `l2wc`, `rctwc` | all |
| `x36` | `l2`'s top at v ≫ k, the low k bits packed MSB first and raw-deflated (zlib level 9); k = 3 on the fluoroscopy and the 12-bit volume (σ ≥ 17), 2 on the 10-bit one | `decoderWorker: deflate-worker.js` → the top through WebCodecs, the low through `DecompressionStream`, merged by the product's `av1-frame.js` | grey |

Rounds 0–12, 18 minutes each (10–12 topping up the cells `VOID` left short); 38 532/38 532 frames exact
over 1 170 visits, 144 `VOID`; `--summary --ref opt` sets x36 against the adopted representation. The
reading is in the same README, §Total time. `--mutate sample` and `--mutate truth` each turned every variant
to 0 exact, and the worker's unpack reading one bit off turned x36 alone to 0; ingest's merge shifted one
bit too far stops `make_frames.py` at frame 0.
The ultrasound has no `x36`: row ENCX's changes are the grey split's. `x36`'s frames are matched
with the series' checksum after a native decode and Python's inflate before they are written.

**Row ORDER** sets the order frames are asked in against the sequential fill, on the breast series
of rows 10 and 45: both tomosynthesis volumes and two four-view screening mammograms (`ffdm_c`, 4 ×
1914×2294, and `ffdm_a`, 4 × 2560×3328, 12-bit, stored R CC, L CC, R MLO, L MLO). Two variants a series,
HTJ2K and the adopted optimized payload (`k2`: k = 2, WebCodecs), made with row SPLITTIME's
`make_frames.py --k 2` into `lab/.av1-work/order`, and two orders each, run as
`--variants htj2k,k2 --orders seq,prio --links r5000,r20000,r50000`:

| order | the page | useful |
| --- | --- | --- |
| `seq` | `fill(0 … N−1)`, as today | — |
| `prio` | `requestExactFrame` for each useful frame, most needed first, then the same fill | tomosynthesis: the centre slice ⌊N/2⌋ and two either side; mammograms: the MLO pair (2, 3) |

*Centre* is the first useful frame on the page, *useful* the last of them, both from the fill's issue.
The downloader takes asks before the fill and serves a fill as contiguous runs, lowest first
([`docs/ARCHITECTURE.md`](../../../../docs/ARCHITECTURE.md) §The downloader), so `prio` is the order a
client can already ask for, with no product change. `--mutate sample` and `--mutate truth` each turned
both orders of both variants to 0 exact.

**Links.** `r5000`, `r20000`, `r50000`: a fixed rate, 40 ms round trip, a 200-packet queue, as row
FILL. `lte-good` and `wifi-home`: row PROF's profiles (`lab/scripts/profile_cells.sh`) — mahimahi's
`TMobile-LTE-short` trace (16.7 Mbit mean, 50 ms, Gilbert–Elliott 0.01 % in bursts of 3.5, a 500 ms
FIFO) and the Wi-Fi steps 15/40/10/30/15 Mbit of 12 s (30 ms, 0.5 %, 300 ms) — **without** PROF's
competing flow and outage, which this harness does not run. The trace is fetched into
`lab/.traces/` and checked against the hash PROF recorded.

**A visit** is its own `series-server`, relay (`link_impair.py --self-timing`) and headless Chromium;
the page connects the downloader as the product does — three decoders, two frames outstanding each,
no warm-up — and fills the whole series once connected. *First* is frame 0's pixels on the page,
*all* the last frame's, both from the fill's issue; every frame's pixels are hashed against its
truth once the fill is done. 4× is `lab/scripts/cpu_throttle.mjs` on the browser's process tree, from the
page's `hello` on (since row TOTAL4; before it, from the browser's launch): after the browser's start, before the dial.
(set × link × throttle) cells run in a Williams order each round (`lab/order.mjs`), the variants inside
each cell the same way offset by the cell's position; a visit whose relay prints `VOID` is dropped.

**The rig.** Four cores: the relay alone on core 3 at `chrt -f 50`, browser and server on 0–2.

**Checked.** `--mutate sample` (one bit of every decoded frame) and `--mutate truth` (one hex digit
of every checksum) each turned every variant of all four series to 0 exact.

**Pins.** Node 22.22.0; playwright's Chromium 141.0.7390.37 (`CHROME_PATH` overrides);
`@cornerstonejs/codec-openjph` 2.4.11; dav1d 1.5.4 under emscripten 3.1.74 (`simd.wasm`,
623 146 B since SVCDEC; the 14 rounds of `bc35549` ran on the 623 042 B build before it); libaom 3.15.1 and OpenJPH 0.31.0 as `tools.sh` and `gen_htj2k_fixtures.sh` pin them;
Firefox 157.0.1 (BuildID 20261005135250, conda-forge `firefox-157.0.1-hee9eb32_0.conda`, SHA-256
`f1b53de244dc14b0a0d2d848aa41d7cf0edb95992cd477dccac40ff4d7127f35`, by micromamba 2.9.0, `micromamba-2.9.0-0.tar.bz2`
SHA-256 `8761c382127e6363bd9e0a2451aa3ef90d071a79133f736e2f759a3bf13040dd`);
`TMobile-LTE-short.down` sha256 `4f33dce8dd811b5702272af64aaf64d3913719919abd776edf1e0f7c0965da43`. Nothing built, fetched or generated is committed.

**Row CLIENT** times a change to the downloader itself: `VARIANTS=none make_frames.py` (HTJ2K only) for
`rf_fluoro` and `dbt10_ea1141`, then `downloader_variant.sh f136363^ before` adds a variant running the
downloader as it was before the row, beside `htj2k` (the tree's), and (row SEAM, `downloader_variant.sh 541ceaf seambefore`) its decoder modules with it, and
`run.mjs --links r20000,r50000 --variants htj2k,before --rounds 10`. The reading is in
[`docs/ARCHITECTURE.md`](../../../../docs/ARCHITECTURE.md) §The downloader.

**Row LOSSLINK** puts loss or jitter on top of each link and times an ask apart from the fill. The
10-bit volume as HTJ2K (`VARIANTS=l2 make_frames.py`, its `htj2k`) and as the adopted optimized payload
(`ingest/coded-frames/ingest.py --representation optimized --preset cpu0`, each `NNN.av1` linked in as
`NNN.opt.av1` and `variants.json` set to `{"htj2k": {}, "opt": {"ext": "opt.av1"}}`), then rounds 0–12 of

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
variants to 0 of 12 exact (`--fill 8 --asks-after 4`, `l1` on 50 Mbit). The server's controller is its default, `cubic-restart`. The reading is in
[`docs/av1/README.md`](../../../../docs/av1/README.md) §Under loss and jitter.

**Row TOTAL4** sets the payload as ingest now writes it against the served HTJ2K, in Chromium and in Firefox,
with every change of its round in the product: row 72's split by depth, row 67's codec string, row 49's
decoder interface and row 74's 8-bit GBR read. Each set's first N frames through `ingest.py` both ways
(cpu0, the optimized representation; every payload and codestream decoded in-process and matched before it
is written), one series per class the split rule tells apart:

```bash
D=lab/av1/data
ingest/coded-frames/build.sh                      # ingest's in-process decoders, after tools.sh and gen_htj2k_fixtures.sh
lab/av1/delivery/total-time/payload_frames.sh lab/.av1-build lab/.av1-work/total4 $D/mr9_ispy2:34 $D/rf_fluoro:18 \
  $D/dbt10_ea1141:16 $D/ffdm_c:4 $D/dbtproj_holo:5 $D/us_liver:40 $D/ct_lidc:60       # ~25 min
export FIREFOX_PATH=...                    # Firefox 157.0.1, below
R="taskset -c 0-2 node lab/av1/delivery/total-time/run.mjs --frames lab/.av1-work/total4 --rounds 1 --out rows.jsonl"
for r in $(seq 0 11); do                   # ~33 min a round; the two engines' order alternates
  $R --engines chromium --first-round $r
  $R --engines firefox --links r20000,r50000,lte-good,wifi-home --first-round $r
  $R --engines firefox --links r5000 --sets mr9_ispy2 --first-round $r
done
```

| set | frames | content, bits after the offset | k | the top stream |
| --- | --- | --- | --- | --- |
| `mr9_ispy2` | 34 × 320², all | MR, 9 | 0 | 10-bit grey |
| `dbt10_ea1141` | 16 of 24, 678×1727 | tomosynthesis, 10 | 2 | 8-bit grey |
| `rf_fluoro` | 18 × 768², all | fluoroscopy, 12 | 2 | 10-bit grey |
| `ffdm_c` | 4 × 1914×2294, all | mammogram, 12 | 2 | 10-bit grey |
| `ct_lidc` | 60 of 100, 512² | CT, 13 signed | 3 | 10-bit grey |
| `dbtproj_holo` | 5 of 15, 1280×2048 | tomosynthesis projections, 14 | 2 | 12-bit grey: dav1d-WASM only |
| `us_liver` | 40 of 70, 760×421 | ultrasound, RGB 8 | — | the colour transform, 10-bit 4:4:4 |

A longer series is cut at 9.1–10.3 MB of HTJ2K, so a round fits in half an hour; 15–16 bits are
HTJ2K's by the rule and have no AV1 variant. Firefox is launched as a process (as row XBROWSER's) and the page
POSTs its result to the harness; Chromium's result comes the same way. Firefox runs no 5 Mbit cell but the
probe: its WebTransport dial through the relay at 5 Mbit does not settle (below).

The run (2026-10-08): rounds 0–13 (round 4 cut short at 154 of 256 visits by a full disk; each Firefox
visit's profile is now removed after it), then rounds 14–15 on the cells short of n = 10, through
`--sets`/`--links`/`--throttles` per engine. 3 746 visits, **90 949/90 949 delivered frames exact**; 1 706
`VOID` (46 %: the relay's p99 over 1 ms, from 17 % in round 0 to 33–61 % after, on a quiet rig — this
container's timing, not the variants') and 182 Firefox visits that never dialled: 49 of 60 at 5 Mbit, 125 of
394 at 20 Mbit, 8 of 394 at 50 Mbit, none on the profiles. 1 930 visits kept, round-paired n = 0–13 a cell;
the cells short of 10 are named in [`docs/av1/README.md`](../../../../docs/av1/README.md) §Every change of
the round. `--mutate sample` and `--mutate truth` each turned both variants of every set to 0 of 708 delivered
frames exact, in both engines (50 Mbit, 1×).

**Row LOSSCC** sets the server's controller under row LOSSLINK's cells: today's `cubic-restart` against
`bbr`, each with both codecs. The 10-bit volume's first 8 frames, through the product's ingest both ways
(`payload_frames.sh lab/.av1-build lab/.av1-work/losscc $D/dbt10_ea1141:8`; 0.943 of HTJ2K's bytes), with
`variants.json` given two more variants, `htj2kbbr` (`"codec": "htj2k", "congestion": "bbr"`) and `optbbr`
(`"ext": "opt.av1", "congestion": "bbr"`). A visit refuses to run when the server's banner names
another controller than the variant's. Then rounds 0–11 of

```bash
taskset -c 0-2 run.mjs --frames lab/.av1-work/losscc --links r5000,r20000,r50000,lte-good \
  --impairs clean,l1,l2,l5,j20 --fill 4 --asks-after 4 --rounds 1 --first-round $r
```

±5 ms is not run: row LOSSLINK found it ±20 ms's row, less. `--mutate sample` and `--mutate truth` each
turned both BBR variants to 0 of 8 exact (`l1` on 50 Mbit), and a variant started under `cubic` while it named
`bbr` stopped the run. Plain Cubic is not a variant: `cubic-restart` has been the default since 2026-10-02,
and row CC1 measured the two side by side ([`docs/transport/transport-conclusions.md`](../../../../docs/transport/transport-conclusions.md) §1).

**Row ASKDEADLINE** times the downloader's own deadlines under loss. Row LOSSLINK's HTJ2K frames
(`VARIANTS=none make_frames.py`), `downloader_variant.sh cf4db15 before` for the downloader before the row, and
in `variants.json` a third variant `stall15` (`"codec": "htj2k", "survival": {"stallMs": 15000}`); every variant with
`"transport": "/lab/av1/delivery/total-time/quiet-transport.js"`, the product's transport that tells the page each
silence over 1 s it lived through and how long it had been quiet when closed. Then

```bash
run.mjs --frames lab/.av1-work/losslink --links r20000,lte-good --impairs clean,l2,l5 --throttles 1 \
  --fill 4 --asks-after 8 --rounds 10
```

whose summary adds per variant the asks failed, the resumes and the silences survived. Chromium 141's
`WebTransport.getStats()` gave a probe no `packetsReceived` in two visits, so a silence is the application's, not the
socket's. The reading is in [`client/README.md`](../../../../client/README.md)
§A session that dies is resumed.

**Row LOSSCC, the first claim's run** (`c0a3d8`, set stale mid-run) sets the server's three controllers against each other on row LOSSLINK's cells: the same
frames, made the same way into `lab/.av1-work/losscc`, with `variants.json` naming six variants — `htj2k` and
`opt` under the default `cubic-restart`, and each again as `-bbr` and `-cubic` (`"congestion": "bbr"`).
A variant's `congestion` is passed to `series-server --congestion`, and a visit stops unless the server's
`transport=` line names that controller (Cubic, the one it leaves unprinted, when none is printed).
Rounds 0–9 of the LOSSLINK command above with `--frames lab/.av1-work/losscc`, then rounds 10–12 on
`--impairs clean,j5,j20`. Passing no `--congestion` stopped the run at the first `-bbr` visit;
`--mutate sample` and `--mutate truth` each turned all six variants to 0 of 8 exact. The reading is in
[`docs/transport/transport-conclusions.md`](../../../../docs/transport/transport-conclusions.md) §1 (LOSSCC, first run).

**Row EXACT** times the decoder worker's frame check: `VARIANTS=check make_frames.py` (HTJ2K only) for the
ADR's four series, `mr_ispy1`, `rf_fluoro`, `dbtproj_ge` and `ffdm_a`, adds `check` — `htj2k`'s frames, `connect`
told the series' frame digests (the variant's `digests`, from `ingest.py`'s `frame_digest`) —
then `run.mjs --frames lab/.av1-work/exact --links r20000,r50000,wifi-home --variants htj2k,check --rounds 10`.
A row's `checked` counts `frame.info.exact` by value: `check` owes every frame `true`, `htj2k` every frame
`"unchecked"`. `--mutate digest` flips each digest's first hex digit and turned every `check` frame `false`. The
reading is in [`docs/adr/exactness-in-production.md`](../../../../docs/adr/exactness-in-production.md) §Built.

**Row VIEWER** times the product's page against this one, which has no paint, on row INGEST's CT series
(`ct_nlst`: its HTJ2K and AV1 bundles' frames, from `lab/av1/exact/from-dicom/check.py`'s `fill/`). The variants
`viewer` and `av1viewer` (`"viewer": "<metadata file>"` in `variants.json`) load `client/viewer/index.html` on the
same decoders (`?opts=`), and `--origin navigation` times both pages from navigation:
`run.mjs --frames lab/.av1-work/from-dicom --sets ct_nlst --variants htj2k,viewer,av1,av1viewer --rounds 12
--origin navigation`. A row's first frame is the viewer's first exact frame on screen. The reading is in
[`docs/ARCHITECTURE.md`](../../../../docs/ARCHITECTURE.md) §The viewer.


**Row DECODEPACE** sets the downloader's `followQueue` lab flag against today's pool on the delivered OpenJPH
build, whole series (`variants.json`'s `"openjph": "delivered"`, and `"followQueue": true` on `pace`):

```bash
client/decode/wasm/build/build.sh && lab/av1/fetch_data.sh dbt12_ea1141 ffdm_d
for s in dbt12_ea1141 ffdm_d; do
  lab/av1/.venv/bin/python lab/av1/decode/htj2k-threads/make_frames.py lab/.av1-work/pace lab/av1/data/$s
  python3 -c 'import json,sys; p=sys.argv[1]; s=json.load(open(p)); b={"ext":"htj2k","codec":"htj2k","openjph":"delivered"}
s["variants"]={"today":b,"pace":{**b,"followQueue":True}}; json.dump(s,open(p,"w"),indent=1)' lab/.av1-work/pace/$s/variants.json
done
for r in $(seq 0 15); do NODE_PATH=$(npm root -g) node lab/av1/delivery/total-time/run.mjs --rounds 1 --first-round $r \
  --links r20000,r50000,lte-good --throttles 1,4 --sets dbt12_ea1141,ffdm_d --frames lab/.av1-work/pace \
  --out lab/av1/delivery/total-time/rows-decodepace.jsonl; done                  # ~3 min a round
python3 lab/av1/delivery/total-time/pace_summary.py lab/av1/delivery/total-time/rows-decodepace.jsonl
```

A row adds, for Chromium, the decoder worker threads' CPU busy time (`utime` + `stime`) and voluntary context
switches, read from `/proc/<pid>/task/<tid>` under the browser's process tree at the page's hello and again once
every frame is in, before the page closes the client (`/filled`); the threads are those named `DedicatedWorker`,
the lowest tid — the downloader's, started first — left out and reported apart (`downloaderCpuMs`). The decoders
used, the most busy at once and the mean busy over the fill come from the frames' decode stamps. Rounds 10–15
topped up the cells `VOID` left under n = 10. `--mutate sample` turned both arms to 0 of 29. The reading is in
[`docs/ARCHITECTURE.md`](../../../../docs/ARCHITECTURE.md) §Follow the queue, measured.
