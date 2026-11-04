# grey-path — M and R on unsplit grey streams, end to end

Runs the protocol pre-registered in [`docs/decode/README.md`](../../../../docs/decode/README.md) §Grey path
protocol, pre-registered (at `e0474332`), as written. The session that ran it was given only the protocol. The
reading is in that file, §Grey path, measured.

```bash
lab/av1/tools/tools.sh aom dav1d                      # libaom 3.15.1 (aomenc, aomdec), dav1d 1.5.4; needs meson and ninja
client/decode/wasm/build/build.sh                     # the product's dav1d and XXH3 (needs docker)
lab/av1/fetch_data.sh usb_cine dbts_b1 dbts_b3
curl -fsSLO https://storage.googleapis.com/chrome-for-testing-public/141.0.7390.37/linux64/chrome-headless-shell-linux64.zip
unzip -d lab/.av1-build/chrome141 chrome-headless-shell-linux64.zip
W=lab/.av1-work/grey-path P=lab/av1/decode/grey-path; export NODE_PATH=$(npm root -g)
lab/av1/.venv/bin/python lab/av1/decode/passes/codings.py lab/.av1-build $W/codings $W/frames lab/av1/data/usb_cine
lab/av1/.venv/bin/python $P/lossy.py lab/.av1-build $W/frames lab/av1/data/{usb_cine,dbts_b1,dbts_b3}
node $P/products.mjs $W/products                      # the broken copies
node --test $P/report.test.mjs
node $P/run.mjs --mutate --rounds 1:1 --out $W/mutate.json
B=/$W/products/neutral-off-by-one/client/decode
node $P/run.mjs --arms W,W2,R --product W=$B,W2=$B,R=$B --rounds 1:1 --out $W/neutral.json
node $P/run.mjs --arms R --product R=/$W/products/R-copy-skipped/client/decode --rounds 1:1 --out $W/r-skip.json
FIREFOX_PATH=.../FirefoxApp/firefox node $P/firefox.mjs --out $W/firefox.json
node $P/run.mjs --out $W/rows.json 2> $W/run.log &    # 148 rounds at 1×, 40 at 4×; resumes from --out
$P/busy.sh > $W/busy.log                              # the host's CPUs, until run.mjs ends
node $P/report.mjs $W/rows.json && node lab/av1/decode/passes/busy.mjs $W/busy.log $W/run.log
```

Firefox 157.0.1 is conda-forge `firefox-157.0.1-hee9eb32_0.conda` installed by micromamba 2.9.0, as
[`grey-420`](../../delivery/grey-420/README.md) installs it.

## How

**Cells.** Four unsplit grey sets at G = 1 (every frame a keyframe), one tile, each at 1× and 4×:

| set | source | coding |
| --- | --- | --- |
| `usb_cine` | `usb_cine`, frames 24–39 | lossless: `passes/codings.py`, unchanged (optimized representation, libaom 3.15.1 `good` 6) |
| `usb_cine_q10` | the same frames | lossy, Q = 10 (`lossy.py`) |
| `dbts_b1_q10` | `dbts_b1`, the middle 16 slices | lossy, Q = 10, one 10-bit 4:0:0 stream |
| `dbts_b3_q10` | `dbts_b3`, the middle 16 slices | the same |

`lossy.py` codes a set as `lab/av1/size.py`'s `av1_cell` does at G = 1 (`--kf-max-dist=0`, `--monochrome`, the
set's depth), with `--lossless=1` replaced by `--end-usage=q --cq-level=10` and `--cpu-used=6 --good`, the 16 frames
in one encoder run. Each unit is then decoded alone by native dav1d 1.5.4 and by `aomdec` 3.15.1; the two must agree
on every sample, or the script stops. The decoded frame is the truth: its SHA-256 for the page, its XXH3-64 for the
worker (`docs/FIXTURES.md` §Frame digests), both over the frame as `decodeFrame` hands it on (8-bit: a byte a sample;
10-bit: two, little-endian). The payload header is `bits` = `depth` = the stream's, split 0, no flags, offset 0.

**Arms**, each a worker of the product's `client/decode`, unmodified, behind `decoder.js`, one frame in flight, the
set's digests passed:

| arm | config |
| --- | --- |
| W | `{ codec: "av1", ...built("dav1d"), onePass: false }` |
| W′ | the same, a second worker (the A/A) |
| W2 | `onePass: true`, the default |
| R | `onePass: true, reuseCopyBuffer: true` |

**Time.** The product's `decodeStart`→`decodeEnd`, decided on. The page's post → the consumer port's receipt is
recorded as a check. Each arm takes one warm-up frame (frame 0, untimed, its digest checked), then the 16 one at a
time; a round's value is the median of the 16.

**Order.** A fresh headless Chromium 141.0.7390.37 shell per round × throttle; inside it the sets, then the arms,
each in a Williams order (`lab/order.mjs`). The protocol does not say how the 1× and 4× rounds interleave; the 4×
rounds are spread evenly through the 1× ones, as the merge-free run did (`passes/run.mjs`'s `schedule()`). 4× is
`lab/scripts/cpu_throttle.mjs` on the browser's process tree.

**Exact.** A frame counts when the worker's XXH3 matched on `av1-webcodecs` the first time, with no fallback
(`mismatchOn` absent), and the page's SHA-256 of the frame matched the truth. The broken copies
(`products.mjs`, each one line of the product replaced):

| check | the line | must read |
| --- | --- | --- |
| `--mutate`: one sample flipped in both truths | — | every arm 0 exact |
| `neutral-off-by-one` | `neutral()` compares with `mid + 1` | W 0 exact on `av1-webcodecs`; W2 and R all exact |
| `R-copy-skipped` | a buffer copied into once is not copied into again | R exact on each worker's first frame only |

**The reading** (`report.mjs`). Per cell, each round's ln(arm ÷ reference), paired in that round's browser; the
effect is their median as a ratio, the 95 % interval the k-th and (n − k + 1)-th ordered values (`passes/report.mjs`'s
`effect()`). M is W2 ÷ W, R is R ÷ W2, the A/A W′ ÷ W. A lever is a speed-up in a cell when its interval lies entirely
below 1, a cost when entirely above, not resolved otherwise. The run is void if a frame is not exact or the A/A
misses in two cells or more. `report.test.mjs` checks these lines; each was broken on purpose and seen to fail: the
speed-up at an upper end of 1, the cost at a lower end of 1, R against W instead of W2, the void at 3 misses, and
M's cost read from R.

**Firefox** (`firefox.mjs`). Firefox has no driver here, so `index.html?firefox` runs one untimed round of the four
sets through the default config (W2) and posts its rows back. Every frame must report `av1-dav1d`, with its digest
and SHA-256 matched and no fallback.

**Committed results.** `manifest.json` is the four sets' frames and truths as coded; `checks.json.gz` the rows of the
three broken-copy checks and the Firefox round. The reading is in `docs/decode/README.md` §Grey path, measured.

## Measured (2026-11-04)

[`report.md`](report.md) is `report.mjs` over `rows.json.gz`; `busy.txt` is `passes/busy.mjs` over the host's CPUs,
cut by `run.log`. 188 browsers, 48 128 of 48 128 frames exact; the reading by the protocol's rule is in
`docs/decode/README.md` §Grey path, measured.
