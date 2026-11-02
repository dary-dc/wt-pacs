# passes — `onePass` against the WebCodecs default, end to end

Runs the protocol pre-registered in [`docs/decode/README.md`](../../../../docs/decode/README.md) §JS passes
protocol, pre-registered (at `0a227368`), as written. The session that ran it was given only the protocol. The
reading is in that section, under *Measured*.

```bash
lab/av1/tools/tools.sh aom dav1d
client/decode/wasm/build/build.sh                     # the product's dav1d and XXH3 (needs docker)
lab/av1/fetch_data.sh dbts_a1 dbts_b1 dbts_c1 us_liver
curl -fsSLO https://storage.googleapis.com/chrome-for-testing-public/141.0.7390.37/linux64/chrome-headless-shell-linux64.zip
unzip -d lab/.av1-build/chrome141 chrome-headless-shell-linux64.zip   # the protocol's Chromium; $CHROME_PATH is not read
W=lab/.av1-work/passes P=lab/av1/decode/passes; export NODE_PATH=$(npm root -g)
lab/av1/.venv/bin/python $P/codings.py lab/.av1-build $W/codings $W/frames lab/av1/data/{dbts_a1,dbts_b1,dbts_c1,us_liver}
node --test $P/report.test.mjs
node $P/run.mjs --mutate --rounds 1:1 --out $W/mutate.json
node $P/broken.mjs $W/broken && node $P/run.mjs --product /$W/broken/client/decode --arms W2 --rounds 1:1 --out $W/broken.json
node $P/run.mjs --out $W/rows.json 2> $W/run.log &    # 150 rounds at 1×, 42 at 4×; ~4 h
$P/busy.sh > $W/busy.log                               # the host's CPUs, until run.mjs ends
node $P/report.mjs $W/rows.json && node $P/busy.mjs $W/busy.log $W/run.log
```

## How

**Frames.** The middle 16 slices of `dbts_a1`, `dbts_b1`, `dbts_c1` (optimized representation, k = 2: a 10-, 8- and
10-bit top over a 2-bit low) and the middle 16 frames of `us_liver` (760×421, RGB 8, an RCT payload with no split).
`codings.py` codes them with the breakdown's own `coding()` at G = 1, one tile (libaom 3.15.1 `good` 6), each frame
decoded alone through native dav1d 1.5.4 and checked against the fetch checksum. `gop.py`'s check reads one plane, so
for an RCT frame `codings.py` merges all three; with the planes in the wrong order it read 0 of 16 exact. The three
DBT sets' payloads come to 18 829 489, 32 793 318 and 15 890 075 B, the 2026-10-31 codings' bytes to the byte
([`breakdown/report.md`](../breakdown/report.md)); the ultrasound's to 3 974 824 B.

**Arms**, each a worker of the product's own `client/decode/decoder.js`, unmodified:

| arm | decoder config |
| --- | --- |
| W | the viewer's: `{ codec: "av1", ...built("dav1d") }` |
| W′ | the same, in a second worker (the A/A) |
| W2 | the same with `onePass: true` |

Each arm takes one warm-up frame, then the 16 frames one at a time. A frame's time is the product's
`decodeStart`→`decodeEnd`; a round's value is the median of the 16. The page also records its post → the consumer
port's receipt, as a check.

**Order.** A fresh headless Chromium 141.0.7390.37 shell per round × throttle; inside it the sets, then the arms, each
in a Williams order (`lab/order.mjs`, period 6 for 3 arms). 4× is `lab/scripts/cpu_throttle.mjs` on the browser's
process tree. The protocol fixes 150 rounds at 1× and 42 at 4× and does not say how the two interleave: `run.mjs`
spreads the 4× rounds evenly through the 1× ones, the pair sharing a slot in Williams order.

**The host's load.** `busy.sh` reads `/proc/stat` once a second while the run goes; `busy.mjs` cuts it at each
browser's end and gives the share of the 4 CPUs busy.

**Exact.** A frame counts when the worker's XXH3 matched the ingest's digest on WebCodecs the first time, with no
fallback (`mismatchOn`), and the page's SHA-256 matched the fetch checksum.

**The reading** (`report.mjs`). Per cell, each round's ln(arm ÷ W), paired in that round's browser; the effect is
their median as a ratio, and the 95 % interval is the k-th and (n − k + 1)-th ordered values, with k the largest for
which P(Binomial(n, ½) ≤ k − 1) ≤ 0.025 (k = 63 at n = 150, 15 at n = 42). `report.test.mjs` checks the rank, the
interval and the rule's lines; each was broken on purpose and seen to fail (rank at 0.05, the interval one rank
in, the 0.97 line at 0.99, the ultrasound's 1.02 at 1.05, the A/A void at 3 misses).
