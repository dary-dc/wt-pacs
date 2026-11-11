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
node $P/run.mjs --out $W/rows.json 2> $W/run.log &    # 150 rounds at 1×, 40 at 4×; ~5.5 h; resumes from --out
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
| W | `client/decode`, unmodified | the viewer's when run: `{ codec: "av1", ...built("dav1d"), onePass: false }` |
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

## Measured (2026-11-03)

[`report.md`](report.md) is `report.mjs` over the rows, which are in `rows.json.gz`. Chromium 141.0.7390.37, 190
browsers, 3 800 arm runs, **60 800 of 60 800 frames exact**, none off WebCodecs and none rescued by the fallback.

**The run was cut and resumed on another host.** A usage limit stopped the session after 149 browsers (117 at 1×,
32 at 4×) on 2026-11-02 at 21:53 UTC. It resumed on 2026-11-03 at 12:28 UTC from the rows (`run.mjs` skips a
(round, throttle) already in them) on a host with the same shape but a slower clock: 4 KVM vCPUs of an Intel Xeon
at 2.80 GHz before, at 2.10 GHz after. Every ratio is paired within one browser, so the rule reads the run whole, as
the protocol fixes it. Cut at the resume, each half alone gives the same verdict, read by the same rule
(informational, not decided on): on the first host R fails on `dbts_a1` at 1× (median 0.970 > 0.97) and on
`mr_ispy1` at 4× (upper end 1.035), and S on `dbts_a1` at 4× (0.908). On the second, with 33 rounds at 1× and 8 at
4×, R fails on `mr_ispy1` at both throttles and `dbts_a1` at 4×, and S on `dbts_a1` at both throttles and `dbts_c1`
at 4×.

**ms a frame**, the page's post → the consumer port's receipt, the median over rounds of each round's median of 16:

| throttle | set | W | W′ | W2 | R | S |
| --- | --- | --: | --: | --: | --: | --: |
| 1× | `dbts_a1` | 118.0 | 119.9 | 110.3 | 107.2 | 97.2 |
| 1× | `dbts_b1` | 247.1 | 245.3 | 222.1 | 208.0 | 173.3 |
| 1× | `dbts_c1` | 116.8 | 116.4 | 109.0 | 103.5 | 92.4 |
| 1× | `mr_ispy1` | 20.8 | 20.7 | 19.9 | 19.7 | 17.9 |
| 4× | `dbts_a1` | 471.8 | 470.6 | 433.1 | 423.5 | 388.2 |
| 4× | `dbts_b1` | 986.6 | 969.4 | 876.9 | 827.4 | 674.7 |
| 4× | `dbts_c1` | 455.4 | 451.8 | 417.8 | 397.4 | 360.7 |
| 4× | `mr_ispy1` | 64.7 | 64.6 | 61.1 | 61.3 | 59.7 |

**The rule**, round-paired, the median [95 % interval]; 150 rounds at 1×, 40 at 4×:

| throttle | set | W′ ÷ W | R ÷ W2 | R's condition met | S ÷ W2 | S's condition met | R ÷ W | S ÷ W |
| --- | --- | --: | --: | --- | --: | --- | --: | --: |
| 1× | `dbts_a1` | 1.000 [0.986–1.013] | 0.968 [0.958–0.978] | yes | 0.877 [0.867–0.886] | yes | 0.908 [0.895–0.920] | 0.824 [0.815–0.833] |
| 1× | `dbts_b1` | 0.988 [0.981–1.000] **miss** | 0.932 [0.926–0.940] | yes | 0.778 [0.771–0.788] | yes | 0.838 [0.826–0.848] | 0.697 [0.689–0.702] |
| 1× | `dbts_c1` | 1.003 [0.988–1.011] | 0.951 [0.940–0.966] | yes | 0.849 [0.839–0.861] | yes | 0.882 [0.872–0.892] | 0.784 [0.778–0.796] |
| 1× | `mr_ispy1` | 1.001 [0.986–1.015] | 0.976 [0.967–0.998] | yes (≤ 1.02) | 0.909 [0.890–0.926] | — | 0.948 [0.929–0.968] | 0.869 [0.850–0.893] |
| 4× | `dbts_a1` | 0.999 [0.982–1.013] | 0.964 [0.943–0.976] | yes | 0.891 [0.881–0.908] | **no**: upper end 0.908 ≥ 0.90 | 0.899 [0.886–0.922] | 0.837 [0.820–0.847] |
| 4× | `dbts_b1` | 0.987 [0.977–1.011] | 0.936 [0.926–0.944] | yes | 0.773 [0.758–0.784] | yes | 0.833 [0.825–0.848] | 0.686 [0.675–0.695] |
| 4× | `dbts_c1` | 0.991 [0.971–1.004] | 0.968 [0.936–0.984] | yes | 0.868 [0.852–0.883] | yes | 0.876 [0.853–0.905] | 0.788 [0.774–0.804] |
| 4× | `mr_ispy1` | 0.984 [0.935–1.037] | 0.986 [0.950–1.024] | **no**: upper end 1.024 > 1.02 | 0.946 [0.923–0.996] | — | 0.957 [0.911–0.982] | 0.913 [0.883–0.946] |

The A/A missed in one cell of 8 (its upper end, shown 1.000, is just under 1), which the protocol allows. **Verdict,
by the rule as written: R does not become the default** (it fails on `mr_ispy1` at 4×); **S is not proposed for
building** (it fails on `dbts_a1` at 4×); **G was not run** (no hardware GPU), so G ÷ S was not read.

**The host.** 4 vCPUs, one ask at a time, two `VideoDecoder`s at most. `busy.sh` over the run: at 1× a browser kept
29–42 % of the 4 CPUs busy on average (median 39 %), and its busiest second reached 49 %; at 4×, 20–25 % and 38 %. No
second reached 95 %. The host did not saturate in this run, and where it saturates was not measured, so nothing is
claimed for fills, concurrency or phones. Each cell is in ms a frame, latency only.
