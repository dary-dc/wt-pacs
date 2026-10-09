# fasthtj2k

Where an HTJ2K frame's decode goes on the real series, and what a thread pool inside one frame buys.
Queue row 41 (FASTHTJ2K) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md); the reading and the
ranked levers are in [`docs/decode/README.md`](../../../../docs/decode/README.md) §Faster HTJ2K in the browser.

```bash
lab/av1/fetch_data.sh rf_fluoro mr_ispy1 us_liver ct_lidc xa_dynact16 dbt12_ea1141 dbtproj_ge
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160    # builds ojph_compress, ojph_expand once
D=lab/av1/data; lab/av1/.venv/bin/python lab/av1/decode/htj2k-profile/make_frames.py lab/.av1-work/fasthtj2k \
  $D/rf_fluoro $D/mr_ispy1 $D/us_liver $D/ct_lidc $D/xa_dynact16 $D/dbt12_ea1141 $D/dbtproj_ge
# emsdk 3.1.74 as client/decode/wasm/dav1d/build.sh fetches it; E names every variant's environment
export EMSDK=$PWD/lab/.av1-build/emsdk E="-sENVIRONMENT=web,worker,node"
VARIANTS=profweb EXTRA_FLAGS="--profiling-funcs $E" lab/decode-bench/wasm/build.sh
VARIANTS=web EXTRA_FLAGS="$E" lab/decode-bench/wasm/build.sh
VARIANTS=webpt EXTRA_FLAGS="$E -pthread" lab/decode-bench/wasm/build.sh
cp -r lab/.openjph-build/src lab/.openjph-build/src-mt
git -C lab/.openjph-build/src-mt apply "$PWD/client/decode/wasm/openjph/cb-threads.patch"
for t in 1 3; do SRC=$PWD/lab/.openjph-build/src-mt VARIANTS=cb$((t + 1)) \
  EXTRA_FLAGS="$E -pthread -DOJPH_CB_THREADS=$t -sPTHREAD_POOL_SIZE=$t" lab/decode-bench/wasm/build.sh; done
NODE_PATH=$(npm root -g) node lab/av1/decode/htj2k-profile/profile.mjs --rounds 5 --throttles 1,4 --passes 6   # ~15 min
NODE_PATH=$(npm root -g) node lab/av1/decode/htj2k-profile/threads.mjs --rounds 6 --throttles 1,4 --passes 2   # ~70 min
```

**Frames.** The first 8 frames of seven row DATA, CONTENT and TAXO series as the served profile
(part 15, reversible 5/3, 5 levels, 64² blocks, RPCL, a signed series signed in SIZ):
fluoroscopy 768² 12-bit, MR 512², RGB ultrasound 760×421, CT 512² signed, cone-beam 512² 13-bit,
tomosynthesis 614×1359 12-bit, tomosynthesis projections 1914×2572 14-bit. `make_frames.py` is row
SPEED's HTJ2K variant: `ojph_expand` against the checksum written when the series was fetched.

**Profile** (`profile.mjs`, `index.html`). OpenJPH 0.31.0 under emscripten 3.1.74 with names kept,
on the page's thread of a fresh headless Chromium per (round × throttle), the throttles in a Williams
order; one set at a time: every frame decoded and hashed against its truth, `passes` timed passes,
then `passes` more under V8's sampling profiler (100 µs). Self time is grouped by function name into
`STAGES`; the JS copy out of the heap is its own stage. 4× is `lab/scripts/cpu_throttle.mjs` on one
core. `--mutate` flips one byte of every decoded frame: 7/7 sets went 0/8.

**Threads** (`threads.mjs`, `threads.html`, `worker.js`). Each variant in a worker of its own, as the
product runs a decoder, one frame at a time (an ask on an idle decoder): `web` the plain build,
`webpt` the same with `-pthread` (the shared heap's cost alone), `cb2` and `cb4` with
`cb-threads.patch` — a row of code-blocks decoded by the caller and 1 or 3 helper threads
(`subband::pull_line`, the seam the decode doc's §The decode tail on a slow CPU (b) named). Browser on 4 cores (`taskset`), at
4× four cores each a quarter as fast; a fresh browser per (round × throttle), the throttles, sets
and variants in Williams orders. A frame's time is `readHeader` + `decode`. Checked: `--mutate` (one
byte of every frame) made `cb4` 0/56, and a build whose pool skips the last block of every row
(`cbmut`) 0/56; a pool decoding the row's blocks in a rotated order stayed 56/56, as it should — every
block is still decoded once into its own buffer.

**Pins.** Node 22.22.0; playwright 1.56.1's Chromium 141.0.7390.37; OpenJPH 0.31.0 (tag, `c68064d`
as cloned); emscripten 3.1.74; `@cornerstonejs/codec-openjph` 2.4.11 is not used here (the profile
needs names). Nothing built or fetched is committed.
