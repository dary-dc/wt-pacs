# merge-free — R, S and G against W2, end to end

Runs the protocol pre-registered in [`docs/decode/README.md`](../../../../docs/decode/README.md) §Merge-free
protocol, pre-registered (at `941a2513`), as written. The session that ran it was given only the protocol. The
reading is in that section, under *Measured*, and below.

```bash
lab/av1/tools/tools.sh aom dav1d                      # needs meson and ninja on PATH
client/decode/wasm/build/build.sh                     # the product's dav1d and XXH3 (needs docker)
lab/av1/fetch_data.sh dbts_a1 dbts_b1 dbts_c1 mr_ispy1
curl -fsSLO https://storage.googleapis.com/chrome-for-testing-public/141.0.7390.37/linux64/chrome-headless-shell-linux64.zip
unzip -d lab/.av1-build/chrome141 chrome-headless-shell-linux64.zip
W=lab/.av1-work/merge-free P=lab/av1/decode/merge-free; export NODE_PATH=$(npm root -g)
lab/av1/.venv/bin/python lab/av1/decode/passes/codings.py lab/.av1-build $W/codings $W/frames lab/av1/data/{dbts_a1,dbts_b1,dbts_c1,mr_ispy1}
$P/s/build.sh $W/kernel                               # S's kernel and its broken copy, in the product's build container
node $P/products.mjs $W/products $W/kernel            # S, S-shift-short and R-never-grown as decoder directories
node --test $P/report.test.mjs && KERNEL=$W/kernel node --test $P/s/merge.test.mjs
node $P/run.mjs --mutate --rounds 1:1 --out $W/mutate.json
node $P/run.mjs --arms S --product S=/$W/products/S-shift-short/client/decode --rounds 1:1 --out $W/s-short.json
node $P/run.mjs --arms R --product R=/$W/products/R-never-grown/client/decode --warm-from mr_ispy1 \
  --sets dbts_a1,dbts_b1,dbts_c1 --rounds 1:1 --out $W/r-never.json
node $P/run.mjs --arms R,S --warm-from mr_ispy1 --sets dbts_a1,dbts_b1,dbts_c1 --rounds 1:1 --out $W/r-control.json
node $P/run.mjs --out $W/rows.json 2> $W/run.log &    # 150 rounds at 1×, 40 at 4×; ~5.5 h
$P/busy.sh > $W/busy.log                              # the host's CPUs, until run.mjs ends
node $P/report.mjs $W/rows.json && node lab/av1/decode/passes/busy.mjs $W/busy.log $W/run.log
```

## How

**Frames.** The passes protocol's `codings.py`, unchanged, over the three DBT sets and `mr_ispy1`: the middle 16
slices, G = 1, k = 2, one tile, libaom 3.15.1 `good` 6, each frame decoded alone through native dav1d 1.5.4 and
checked against the fetch checksum. The DBT payloads come to 18 829 489, 32 793 318 and 15 890 075 B, the
2026-10-31 codings' bytes to the byte. `mr_ispy1` (512², slices 21–36) is a 10-bit top over a 2-bit low, 3 071 937 B.

**Arms**, each a worker behind `decoder.js`, one frame in flight, the series' digests passed:

| arm | decoder directory | config |
| --- | --- | --- |
| W | `client/decode`, unmodified | the viewer's: `{ codec: "av1", ...built("dav1d") }` |
| W′ | the same, a second worker (the A/A) | the same |
| W2 | the same | `onePass: true` |
| R | the same | `onePass: true, reuseCopyBuffer: true` |
| S | `client/decode` with `s/av1-frame.js` and `s/av1-webcodecs.js` in place of the product's, and `merge.wasm` | `onePass: true` |

**S.** `s/merge.c` is the merge in 16-bit lanes: `((top << k) | low) − offset`, a 16-bit or an 8-bit top, a scalar
tail, and the range of the merged values taken before the offset is subtracted (the same range, since the
subtraction is monotonic *derived*; `s/merge.test.mjs` checks it). It is built with the product's emscripten 3.1.74
at `-O3 -msimd128`, a bare module with its memory exported. `s/av1-webcodecs.js` is the product's with each stream's
`copyTo` writing into a region of that memory, kept per stream and grown only when a frame is larger.
`s/av1-frame.js` is the product's with `merge()` calling the kernel, then copying the merged frame out to its
`SharedArrayBuffer`. Growing the memory replaces its buffer: the WebAssembly JavaScript Interface's *refresh the
memory buffer* says "If IsFixedLengthArrayBuffer(buffer) is true, Perform ! DetachArrayBuffer(buffer,
"WebAssembly.Memory")" ([§5.3 Memories](https://webassembly.github.io/spec/js-api/#memories), fetched 2026-11-02).
So a region is never moved, the memory is not grown while a `copyTo` is pending, and the kernel takes each plane by
its byte address, not by a view.

**G was not run.** The host's WebGL2 renderer is "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)
(0x0000C0DE)), SwiftShader driver)", recorded in every row, and the protocol runs G only on a hardware GPU. So the
time is the protocol's for W–S, the page's post of the bytes → the consumer port's receipt of the frame, and the
counts are the ones without G: 150 rounds at 1×, 40 at 4×, the arms' period 10.

**Order.** A fresh headless Chromium 141.0.7390.37 shell per round × throttle; inside it the sets, then the arms,
each in a Williams order (`lab/order.mjs`). The 4× rounds are spread evenly through the 1× ones (the passes
harness's `schedule()`), as the protocol does not say how the two interleave. 4× is `lab/scripts/cpu_throttle.mjs`
on the browser's process tree. Each arm takes one warm-up frame, then the 16 one at a time; a round's value is the
median of the 16. The product's `decodeStart`→`decodeEnd` is recorded too and not decided on.

**Exact.** A frame counts when the worker's XXH3 matched the ingest's digest on WebCodecs the first time, with no
fallback (`mismatchOn`), and the page's SHA-256 of the frame matched the fetch checksum. The checks, each run before
the rounds:

| check | must read | read |
| --- | --- | --- |
| `--mutate`: one sample flipped in both truths, every arm, every set | 0 exact | 0 of 320 |
| S with the kernel's shift one short (`S-shift-short`), every set | 0 exact | 0 of 64: each mismatched on WebCodecs and was decoded again on dav1d |
| R with its buffer never grown (`R-never-grown`), the warm-up a 512² `mr_ispy1` frame, then each DBT set | 0 exact | 0 of 48: `copyTo` refused the small buffer, dav1d decoded |
| the same order through the product's R, and through S (the control) | 16 of 16 a set | 48 of 48 each |

`s/merge.test.mjs` checks the kernel against the product's `merge()` on random pictures, through the vector body,
a scalar tail, an 8-bit top and a signed offset, samples and range. It was broken four ways and failed each time:
the shift one short (the built broken copy), the tail's low not OR-ed in, the range's offset not subtracted, and the
vector lanes' minimum not reduced. `report.test.mjs` checks the rule's lines; each was broken on purpose and seen to
fail: R's upper end at 1.01, its median at 0.98, `mr_ispy1`'s 1.02 at 1.03, S's 0.90 at 0.91, the A/A void at 3,
R paired against W instead of W2, and S's condition applied to `mr_ispy1`.

**The reading** (`report.mjs`). Per cell, each round's ln(arm ÷ reference), paired in that round's browser; the
effect is their median as a ratio, and the 95 % interval the k-th and (n − k + 1)-th ordered values (the passes
harness's `effect()`: k = 63 at n = 150, 14 at n = 40).

**The host's load.** `busy.sh` reads `/proc/stat` once a second while the run goes; `passes/busy.mjs` cuts it at each
browser's end.
