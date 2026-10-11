# copy

P-COPY of [`docs/decode/README.md`](../../../docs/decode/README.md) §Not yet tried (queue row EMSDKMEASURE): each frame
packed into a buffer the page keeps, in a heap that is a `SharedArrayBuffer`, and three 8-bit components interleaved
by a shuffle, against the delivered build. The reading is beside the protocol in that section.

```bash
client/decode/wasm/build/build.sh                     # the delivered build (needs docker)
lab/decode-bench/copy/build.sh                        # pt and copy into lab/.openjph-build/wasm
# the frames: lab/decode-bench/emsdk/README.md's make_frames.py, with c512
NODE_PATH=$(npm root -g) node lab/decode-bench/copy/run.mjs --rounds 10 --out raw/frame.json   # --mutate sample|truth
NODE_PATH=$(npm root -g) node lab/decode-bench/copy/run.mjs --memory --rounds 3 --out raw/memory.json
node lab/decode-bench/emsdk/summary.mjs raw/frame.json --ref del --arms pt,copy --bar 0.95
```

**Arms**, one decoder worker each, every frame checked against the encoder's input:

| arm | build | worker |
| --- | --- | --- |
| `del` | the delivered build | `client/decode/decoder.js`: decode into the heap, copy into a fresh `SharedArrayBuffer` |
| `pt` | the delivered recipe with `-pthread -sPTHREAD_POOL_SIZE=0`: the heap shared, no thread started | the same |
| `copy` | `pt` with [`wrapper.patch`](wrapper.patch) | [`decoder.js`](decoder.js) on [`htj2k-copy.js`](htj2k-copy.js): the frame is a view on the heap |

`pt` names what `-pthread` alone costs, since the shared heap needs it. `wrapper.patch` mallocs each frame's buffer
and packs into it (`takeFrame` hands it over; nothing frees it while the page keeps it). On an 8-bit unsigned
three-component frame it pulls the three lines and interleaves them 16 pixels a step: two saturating narrows clamp, and
five `i8x16.shuffle`s interleave. `c512` (synthetic RGB, 87 × 512²) is the one set that takes that path; `--mutate sample`
caught it on every frame.

**Memory** (`--memory`): every frame of a set decoded and kept by the page, a fresh Chromium per set and arm, and the
sum of each browser process's peak resident set (`VmHWM`) after.

**Pins** as `lab/decode-bench/emsdk`. Nothing built is committed; `raw/` holds the rounds as measured.
