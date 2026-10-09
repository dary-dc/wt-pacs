# htj2kmt

One HTJ2K frame's code-blocks decoded on several threads in the browser: a frame's decode, a whole
fill through the product's downloader, and a decoder worker's memory, against today's single-threaded
decode. Queue row 78 (HTJ2KMT) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md); the reading is
in [`docs/decode/README.md`](../../../../docs/decode/README.md) §Code-blocks on threads, measured.

```bash
lab/av1/fetch_data.sh mr_ispy1 rf_fluoro us_liver dbt12_ea1141 dbt12_c dbtproj_ge syn2d_d ffdm_d
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160    # builds ojph_compress, ojph_expand once
client/decode/wasm/fetch_openjph.sh                                  # the package, the fill's `htj2k`
# emsdk 3.1.74 as client/decode/wasm/dav1d/build.sh fetches it; the four builds as lab/av1/decode/htj2k-profile/README.md
export EMSDK=$PWD/lab/.av1-build/emsdk E="-sENVIRONMENT=web,worker,node"
VARIANTS=web EXTRA_FLAGS="$E" lab/decode-bench/wasm/build.sh
VARIANTS=webpt EXTRA_FLAGS="$E -pthread" lab/decode-bench/wasm/build.sh
cp -r lab/.openjph-build/src lab/.openjph-build/src-mt
git -C lab/.openjph-build/src-mt apply "$PWD/client/decode/wasm/openjph/cb-threads.patch"
for t in 1 3; do SRC=$PWD/lab/.openjph-build/src-mt VARIANTS=cb$((t + 1)) \
  EXTRA_FLAGS="$E -pthread -DOJPH_CB_THREADS=$t -sPTHREAD_POOL_SIZE=$t" lab/decode-bench/wasm/build.sh; done
D=lab/av1/data
# A frame: the first 4 frames of each series, 512² to 3328×4096 (~35 min)
FRAMES=4 lab/av1/.venv/bin/python lab/av1/decode/htj2k-profile/make_frames.py lab/.av1-work/htj2kmt \
  $D/mr_ispy1 $D/rf_fluoro $D/us_liver $D/dbt12_ea1141 $D/dbt12_c $D/dbtproj_ge $D/syn2d_d $D/ffdm_d
NODE_PATH=$(npm root -g) node lab/av1/decode/htj2k-profile/threads.mjs --rounds 10 --throttles 1,4 --passes 3 \
  --frames lab/.av1-work/htj2kmt --variants web,webpt,cb2,cb4
# A fill: whole series, the product's downloader and decoder worker (~10 min a round)
for s in rf_fluoro dbt12_ea1141 dbtproj_ge ffdm_d; do
  lab/av1/.venv/bin/python lab/av1/decode/htj2k-threads/make_frames.py lab/.av1-work/htj2kmt-fill $D/$s; done
client/transport/ts/build.sh
for r in $(seq 0 9); do NODE_PATH=$(npm root -g) node lab/av1/delivery/total-time/run.mjs --rounds 1 --first-round $r \
  --links r50000,lte-good --throttles 1,4 --sets rf_fluoro,dbt12_ea1141,dbtproj_ge,ffdm_d \
  --variants htj2k,web,cb2,cb4 --frames lab/.av1-work/htj2kmt-fill --out fill.jsonl; done
NODE_PATH=$(npm root -g) node lab/av1/delivery/total-time/run.mjs --summary --ref web --out fill.jsonl
# A worker's memory, row FOOTPRINT's method
NODE_PATH=$(npm root -g) node lab/av1/decode/memory/run.mjs --mode mem --rounds 6 --counts 1,3 \
  --sets '{"ffdm_d":["lab/.av1-work/htj2kmt-fill",["web","cb2","cb4"]]}' --out mem.jsonl
```

**Builds**, OpenJPH 0.31.0 through `lab/decode-bench/wasm/build.sh`: `web` single-threaded, `webpt` the
same with `-pthread` (the shared heap's cost alone), `cb2` and `cb4` with row FASTHTJ2K's
`cb-threads.patch` — a row of code-blocks decoded by the caller and 1 or 3 helper threads, a pool
created once per decoder worker. The fill's `htj2k` is the package the product loads today.

**A frame** is `fasthtj2k/threads.mjs`: each build in a worker of its own, one frame at a time (an ask on
an idle decoder), the browser on 4 cores, 4× four cores each a quarter as fast; a fresh browser per
(round × throttle), throttles, series and builds in Williams orders; every frame hashed against the
checksum written when the series was fetched before it is timed.

**A fill** is `total/run.mjs`, row TOTAL's harness: the real server behind the relay, the browser on 3
cores and three decoder workers as the product starts them, so every helper thread shares a core with
another decoder. A variant in `variants.json` names its build with `openjph`.

**Checked.** `--mutate` (one byte of every decoded frame) took `cb2` and `cb4` to 0/4 on all eight
series; a pool that leaves the last block of every row undecoded (`cbmut`, the patch's
`run(blocks, num_blocks.w - (num_blocks.w > 2))`) failed 28 of 32 frames, every series caught — the
four it missed, two each of the synthesized and full-field mammograms, have an empty last block in
every row.

**Pins.** Node 22.22.0; playwright 1.56.1's Chromium 141.0.7390.37; OpenJPH 0.31.0 (`c68064d`);
emscripten 3.1.74; `@cornerstonejs/codec-openjph` 2.4.11. Nothing built or fetched is committed.
