# emsdk

P-EMSDK of [`docs/decode/README.md`](../../../docs/decode/README.md) §Not yet tried (queue row EMSDKMEASURE): the
delivered OpenJPH build against the same recipe under emscripten 6.0.11, a frame, a cold ask and a fill. The reading is
beside the protocol in that section.

```bash
dockerd &                                   # client/decode/wasm/build needs docker
client/decode/wasm/build/build.sh           # the delivered build, checked against its manifest
lab/decode-bench/emsdk/build.sh             # the 6.0.11 arm into lab/.openjph-build/wasm/em6.*
lab/av1/fetch_data.sh dbt12_ea1141 dbt12_c dbtproj_ge syn2d_d ffdm_d
PATH=lab/av1/.venv/bin:$PATH FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160   # ojph_compress, once
D=lab/av1/data; lab/av1/.venv/bin/python lab/decode-bench/emsdk/make_frames.py lab/.av1-work/emsdk \
  g512 c512 $D/dbt12_ea1141 $D/dbt12_c $D/dbtproj_ge $D/syn2d_d $D/ffdm_d
mkdir -p lab/.av1-build/ojph-wasm                                       # a frame: the VERSIONS harness
cp client/decode/wasm/built/openjph/openjph.js lab/.av1-build/ojph-wasm/del-3.1.74.js     # and .wasm alike
cp lab/.openjph-build/wasm/em6.js lab/.av1-build/ojph-wasm/del-6.0.11.js                  # and .wasm alike
NODE_PATH=$(npm root -g) node lab/av1/tools/newer/decode.mjs --rounds 10 --throttles 1,4 --browsers 141 \
  --variants ojph-del-3.1.74,ojph-del-6.0.11 --frames lab/.av1-work/emsdk --sets g512,dbt12_ea1141,dbt12_c,dbtproj_ge,syn2d_d,ffdm_d \
  --out raw/frame.json                                                  # --mutate sample|truth: every frame fails
for r in $(seq 0 9); do NODE_PATH=$(npm root -g) node lab/av1/delivery/total-time/run.mjs --rounds 1 --first-round $r \
  --links r50000,lte-good --sets g512,dbt12_ea1141,dbt12_c,dbtproj_ge,syn2d_d,ffdm_d --variants del,em6 \
  --frames lab/.av1-work/emsdk [--fill 1] --out raw/ask.jsonl|raw/fill.jsonl; done    # a cold ask is --fill 1
node lab/decode-bench/emsdk/summary.mjs raw/frame.json --ref ojph-del-3.1.74 --arms ojph-del-6.0.11 --bar 0.97
node lab/decode-bench/emsdk/summary.mjs raw/fill.jsonl --ref del --arms em6 --bar 0.97 --key decodedMs
```

**The arms differ in the toolchain alone**, and in one link flag the toolchain made necessary. [`build.sh`](build.sh)
copies the delivered recipe (`client/decode/wasm/build`) with emscripten 6.0.11 (release `f6264d4a`, the tarball's
sha256 in [`emscripten-6.0.11.sha256`](emscripten-6.0.11.sha256)) and emsdk 6.0.11's Node, 24.19.0; the base image,
cmake, OpenJPH 0.31.0, the wrapper and every other flag are the delivered build's. Emscripten 6.0.2 dropped
`wasmBinary` and `mainScriptUrlOrBlob` from the default `INCOMING_MODULE_JS_API` (its ChangeLog), and
`client/decode/wasm-glue.js` passes both. Without them the glue ignores the pinned bytes the page checked and fetches
its own `.wasm` beside the glue — a second, unchecked download, and in the lab, where the file has another name, a
404. The arm adds both to 6.0.11's default list; the `.wasm` is byte-identical with or without the flag
(`f3b22a74…`), so the flag changes the glue only. Two builds gave the same bytes.

**Pins.** Node 22.22.0, Playwright 1.56.1's Chromium 141.0.7390.37, the relay and server of
`lab/av1/delivery/total-time`. Nothing built or fetched is committed; `raw/` holds the rounds as measured.
