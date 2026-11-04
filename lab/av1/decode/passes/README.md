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
| W | the viewer's when run: `{ codec: "av1", ...built("dav1d"), onePass: false }` |
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

## Measured (2026-11-02)

**Host.** 4 vCPUs (Xeon, 2.8 GHz, one thread a core) of a container, 15 GB, Linux 6.18. Headless Chromium
141.0.7390.37, playwright 1.63.0, Node 22. One ask at a time, with two `VideoDecoder`s at most. **Where it saturates:**
it did not, in this run. Over a 1× browser the 4 CPUs were 38–40 % busy (busiest second 53 %). At 4× they were
21–24 % busy (41 %), where every thread is capped at a quarter of a CPU ([`busy.txt`](busy.txt)). The saturation
point was not looked for. Nothing here is claimed for fills, concurrency or phones.

**Checks.** **36 864 of 36 864 frames exact** (192 browsers, 2 304 runs), by both checks, first time on WebCodecs.
No frame came off WebCodecs or from the fallback. `--mutate`: **0 of 192 exact**, every arm and set. `merge()`'s shift
one short (`broken.mjs`): **W2 read 0 of 48 on the DBT sets**, each one rescued on dav1d-WASM (`mismatchOn`) and
not counted. The ultrasound read 16 of 16, as its RCT payload never reaches `merge()`.

**ms a frame** (median over rounds of each round's median [range]) and **the rule** (round-paired ratio ÷ W, the
median [95 % interval]):

| throttle | set | rounds | W | W2 | W′ ÷ W (A/A) | W2 ÷ W | rule |
| --- | --- | --: | --: | --: | --: | --: | --- |
| 1× | `dbts_a1` | 150 | 132.3 [113.2–158.6] | 122.4 [110.5–146.7] | 1.004 [0.987–1.020] | 0.930 [0.920–0.940] | met |
| 1× | `dbts_b1` | 150 | 291.7 [262.4–330.8] | 259.1 [239.1–295.3] | 1.001 [0.986–1.010] | 0.899 [0.887–0.905] | met |
| 1× | `dbts_c1` | 150 | 131.7 [118.3–155.3] | 122.3 [106.1–143.5] | 1.007 [0.995–1.017] | 0.928 [0.915–0.941] | met |
| 1× | `us_liver` | 150 | 41.7 [36.2–55.5] | 41.4 [35.9–52.2] | 0.999 [0.979–1.017] | 0.998 [0.981–1.012] | met (≤ 1.02) |
| 4× | `dbts_a1` | 42 | 514.7 [481.4–561.5] | 478.7 [426.2–529.5] | 0.990 [0.968–1.005] | 0.923 [0.908–0.935] | met |
| 4× | `dbts_b1` | 42 | 1145.0 [1044.3–1240.2] | 1001.2 [940.5–1092.3] | 0.998 [0.979–1.015] | 0.879 [0.867–0.895] | met |
| 4× | `dbts_c1` | 42 | 503.4 [456.4–550.8] | 467.0 [420.2–511.9] | 0.989 [0.972–1.001] | 0.917 [0.902–0.933] | met |
| 4× | `us_liver` | 42 | 155.5 [141.2–179.3] | 154.2 [129.9–174.5] | 0.985 [0.957–1.015] | 0.997 [0.968–1.014] | met (≤ 1.02) |

The A/A missed in 0 of 8 cells. **Verdict, by the rule: `onePass` becomes the default.** It is now on unless the
config sets `onePass: false` (`client/decode/av1.js`, `av1-webcodecs.js`). `av1.test.mjs` reads a config that does
not name it as `onePass`. That test fails with either file's default turned off, and with `false` read as on.
The post → consumer-port receipt is 0.7–1.0 ms a frame beyond `decodeStart`→`decodeEnd` in every cell and arm.
W′'s ms, and the tails, are in [`report.md`](report.md).

**Off the protocol.** The 4× rounds' placement among the 1× ones is this harness's choice (How, above). The W
times are 17–25 % above 2026-10-31's on the same bytes. Only the round-paired ratios are compared across runs.
