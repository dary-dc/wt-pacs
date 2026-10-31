# breakdown — where a G = 1 AV1 frame's time goes against HTJ2K

Runs the protocol pre-registered in [`docs/decode/README.md`](../../../../docs/decode/README.md) §Where a G = 1
frame's time goes, predicted (at `57180423`), as written. The session that ran it read the protocol alone. The
reading is in that section, under *Measured*.

```bash
lab/av1/tools/tools.sh aom dav1d && VARIANTS="simd simd-mt" client/decode/wasm/dav1d/build.sh
client/decode/wasm/build/build.sh                     # the product's XXH3 the worker checks with (needs docker)
client/decode/wasm/fetch_openjph.sh                   # H: OpenJPH, the package
lab/av1/fetch_data.sh dbts_a1 dbts_b1 dbts_c1
curl -fsSLO https://storage.googleapis.com/chrome-for-testing-public/141.0.7390.37/linux64/chrome-headless-shell-linux64.zip
unzip -d lab/.av1-build/chrome141 chrome-headless-shell-linux64.zip   # row 100's Chromium; $CHROME_PATH is not read
W=lab/.av1-work/breakdown B=lab/av1/decode/breakdown; export NODE_PATH=$(npm root -g)
lab/av1/.venv/bin/python $B/codings.py lab/.av1-build $W/codings $W/frames lab/av1/data/dbts_{a1,b1,c1}   # ~25 min, 4 cores
node $B/stamp.mjs $W/stamped
node $B/attribution.mjs                                # the stamps' own check, every stamp moved; ~1 h
for b in w1 w2 z; do node $B/stamp.mjs $W/broken-$b --break $b; done   # then run.mjs --stamped $W/broken-$b, 1 round
node $B/run.mjs --mutate --rounds 1 --throttles 1 --out $W/mutate.json
node $B/run.mjs --rounds 10 --throttles 1,4 --out $W/rows.json          # ~2 h
node $B/report.mjs $W/rows.json
```

## How

**Frames.** The middle 16 slices of `dbts_a1`, `dbts_b1`, `dbts_c1`, optimized representation, k = 2 (a 10-, 8- and
10-bit top over a 2-bit low). `codings.py` codes them as `gop.py` does at G = 1 (libaom 3.15.1 `good` 6), each
group decoded alone through native dav1d 1.5.4 and merged against the fetch checksum. It codes them twice: as is,
and with `--tile-columns=2` on both streams (row DECSPEED's `t4`). **96 of 96 frames exact natively, both codings.**
Z's payload keeps the top unit and carries the low as its 2 bits packed MSB first and deflated at level 9, as row
ENCX codes it. Each deflated low is inflated in Python and checked against its plane. H is the served profile.

**The stamped copy.** `stamp.mjs` copies the product's decoder modules (`client/decode/*.js`) into the gitignored
work directory and edits them: each stage gets a `:s` and a `:e` stamp (`performance.timeOrigin + performance.now()`
in the worker) and a spin site; the protocol's levers sit behind lab flags in the decoder config. The product's
own files are not changed. Every edit must match its text exactly once, or the copy is not built.

| stage | where | what it brackets |
| --- | --- | --- |
| `parse` | `av1.js` | the payload parsed and the decoder chosen, up to the first stream's call |
| `top`/`low` `.copyin`, `.flush`, `.decode`, `.held` | `av1-dav1d.js` | the unit into the heap, `_av1_flush`, `_av1_decode`, `held()` |
| `top`/`low` `.config`, `.decode`, `.copyTo`, `.neutral`, `.flush` | `av1-webcodecs.js` | `configure`, chunk sent → frame out of the output callback, the buffer allocated and `copyTo` settled, `neutral()`, the flush settled |
| `place1`, `place2`, `fused` | `av1-frame.js` | the output allocated and the top placed; the low placed with the range; W2's single pass |
| `z.inflate`, `z.unpack` | `av1.js` | `DecompressionStream("deflate-raw")`; the 2-bit unpack |
| `codec`, `digest` | `decoder.js` | the codec call; the worker's XXH3 against the ingest's digest |

The page stamps the consumer port's receipt. A frame's time is the product's own `decodeStart`→`decodeEnd`.

**Arms**, each a worker of its own behind `decoder.js`, one warm-up frame, then the 16 frames one at a time:

| arm | worker | config |
| --- | --- | --- |
| H, H0 | stamped, product | OpenJPH, the package (`@cornerstonejs/codec-openjph` 2.4.11) |
| D, D0 | stamped, product, `VideoDecoder` deleted (as row 100) | dav1d-WASM `simd` 1.5.4, one thread |
| W, W0 | stamped, product | WebCodecs where it is exact (both streams ≤ 10 bits) |
| W1 | stamped, `lab.noFlush` | no flush at G = 1; a unit that is not a shown keyframe is refused (`shownKey`) |
| W2 | stamped, `lab.passes` | no `neutral()` on a `mono_chrome` stream; the two `place()` passes as one |
| W12 | both | |
| Z_D, Z_W | stamped, `lab.z` | the low inflated beside dav1d or WebCodecs' top |
| T_D | stamped | `simd-mt` at 3 threads, the 4-tile coding |
| T_W | stamped | WebCodecs, the 4-tile coding |

`0` is the product unstamped, the A/A. **Order**: a fresh Chromium 141.0.7390.37 headless shell (playwright 1.63.0,
Node 22) per round × throttle, throttles, sets and arms each in a Williams order (`lab/order.mjs`), 10 rounds; 4× is
`lab/scripts/cpu_throttle.mjs` on the browser's process tree. **ms a frame** is the median of round medians [range].

**Exact.** A frame counts when the worker's XXH3 matched the ingest's digest *on the arm's own path the first time*,
with no fallback (`mismatchOn`) and no other path, and the page's SHA-256 matched the fetch checksum. The product
rescues a wrong frame by decoding it again elsewhere. Counting a rescued frame would hide a broken lever, and it did
hide W2's (below).

**Shares** are of the frame. On dav1d everything is serial, and each stage is its spans' sum. On WebCodecs the two
streams overlap: decode and flush are the longer stream's, `copyTo` is both streams' sum, and the JS passes
(`neutral`, `place`, digest) are always summed, since they share the worker's thread. A stream's own time runs from
its `config:s` to its `flush:e`. Z_D's inflate is in flight while dav1d holds the thread, so only its time outside
every other stage counts as the low's decode.

## The stamps' own check

`attribution.mjs`, on `dbts_c1` at 1×, frames 2–5 of 6 (the first frames run before WASM tiers up), two
interleaved pairs of runs. Each stage in turn is spun for X = 100 ms. The spin must land on that stage, which must
grow by 80–123 ms. No other stage may move more than 25 ms; the other stream's stages and `codec`, which encloses
every stage, are left out. Coverage must stay ≥ 97 %. Then every stamp is moved across its work (34 copies), and the
check must fail.

**As built, 17 of 17 stages attributed** on a rerun. On the first pass `z.unpack` failed: Z_D's `top.decode`, which
the spin cannot reach, moved 48 ms between browsers, and Z_D's inflate span, which overlaps it, moved with it. A
rerun of that stage alone passed. **34 of 34 moved stamps caught**, each by the moved stage growing 0 ms instead of
100, by a stage that vanished (`decode:s`), or by coverage falling to 4 % (`codec`). The rerun caught both
`z.unpack` moves the same way; the first pass caught `z.unpack:e` only through the same noise.

**Levers broken.** W1 refuses as if `reduced_still_picture_header` were off, W2 shifts the top one bit short and Z
unpacks the low bits in reverse order: **0 of 48 frames exact for each, in every arm that carries the lever**. Every
coded unit here has `reduced_still_picture_header` set (`still_picture` too), so W1's check is that bit, and every
frame is a shown keyframe by syntax. Before exactness was counted on the arm's own path, the broken W2 read 48 of 48:
the product's mismatch path decoded each frame again on dav1d.

**`--mutate`**: one sample flipped in the page's hash and in the digest the worker gets: **0 of 624 frames exact,
every arm**, 1 round at 1×.

## Measured (2026-10-31)

**Host.** 4 vCPUs (Xeon, 2.1 GHz, one thread a core) of a container, 15 GB, Linux 6.18. One ask at a time:
two `VideoDecoder`s with Chromium's own threads at most, or 3 dav1d threads in T_D. Saturation was not measured. The
protocol's limit stands: nothing here is claimed for fills, concurrency or phones. Container numbers are not phone
numbers.

**12 480 of 12 480 frames exact** (780 runs, 10 rounds), by both checks, on the arm's own path. Coverage is
99.6–100 % in every cell. The consumer port adds 0.24–0.50 ms after `decodeEnd`.

**ms a frame** (median of round medians [range]):

| throttle | set | H | D | W | W1 | W2 | W12 | Z_D | Z_W | T_D | T_W |
| --- | --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| 1× | `dbts_a1` | 31.5 [27.2–43.1] | 208.4 [196.0–298.7] | 113.3 [104.3–131.9] | 105.5 [99.6–114.6] | 104.9 [99.1–125.0] | 102.5 [92.2–114.1] | 144.3 [130.9–185.7] | 114.3 [106.4–127.3] | 98.6 [84.5–109.6] | 73.6 [65.6–79.6] |
| 1× | `dbts_b1` | 91.8 [86.2–134.2] | 454.3 [431.7–525.2] | 233.2 [216.5–255.8] | 220.6 [210.6–244.1] | 209.5 [195.5–220.9] | 206.2 [186.1–227.6] | 306.9 [288.9–339.4] | 225.4 [218.5–260.3] | 261.1 [242.8–291.5] | 180.2 [167.9–206.9] |
| 1× | `dbts_c1` | 31.0 [27.9–46.7] | 186.1 [175.3–207.9] | 111.7 [105.7–123.8] | 105.9 [97.1–116.8] | 100.9 [94.1–113.8] | 96.8 [91.5–126.0] | 132.3 [121.3–153.6] | 120.0 [103.9–127.5] | 94.6 [81.4–105.9] | 72.5 [68.1–83.9] |
| 4× | `dbts_a1` | 127.2 [112.8–139.9] | 966.5 [903.7–997.1] | 438.4 [423.4–468.4] | 430.7 [399.0–449.0] | 415.4 [400.5–439.4] | 403.4 [363.6–430.2] | 601.8 [547.8–719.6] | 454.7 [425.3–487.7] | 371.2 [352.4–419.4] | 214.8 [197.7–223.2] |
| 4× | `dbts_b1` | 437.4 [412.8–465.3] | 2100.8 [2013.9–2195.3] | 929.5 [842.4–970.1] | 939.5 [865.3–983.3] | 836.7 [752.4–891.6] | 838.8 [760.1–874.4] | 1355.8 [1238.9–1475.6] | 955.7 [886.5–1022.9] | 1095.5 [1030.2–1199.5] | 610.0 [551.0–643.8] |
| 4× | `dbts_c1` | 127.4 [119.4–148.4] | 833.8 [756.1–894.1] | 431.1 [404.6–467.8] | 411.1 [394.3–439.0] | 387.4 [365.6–411.0] | 390.9 [377.3–403.3] | 564.2 [523.7–590.4] | 451.1 [420.6–491.2] | 333.7 [302.1–399.5] | 227.7 [191.8–237.8] |

**A/A** (stamped ÷ unstamped, the median of round-paired ratios [range]):

| throttle | set | H ÷ H0 | D ÷ D0 | W ÷ W0 |
| --- | --- | --: | --: | --: |
| 1× | `dbts_a1` | **1.067** [0.898–1.511] | **1.036** [0.881–1.277] | 1.017 [0.939–1.145] |
| 1× | `dbts_b1` | 0.994 [0.686–1.471] | 0.990 [0.933–1.063] | 1.002 [0.925–1.064] |
| 1× | `dbts_c1` | **1.042** [0.797–1.464] | 0.998 [0.914–1.152] | 1.016 [0.866–1.148] |
| 4× | `dbts_a1` | **1.041** [0.798–1.076] | 1.003 [0.926–1.101] | 1.012 [0.950–1.047] |
| 4× | `dbts_b1` | 1.012 [0.939–1.086] | **1.025** [0.974–1.045] | **0.971** [0.927–1.043] |
| 4× | `dbts_c1` | 0.993 [0.849–1.182] | **1.023** [0.944–1.070] | 0.997 [0.952–1.120] |

7 of 18 cells sit outside 2 % (bold), on both sides of 1. The rule voids the breakdown in those cells. Read
per cell, that leaves D at 1× `b1`, `c1` and 4× `a1`, and W everywhere but 4× `b1`. Read as the whole run, the
breakdown is void. The ranges cross 1 in every cell, and the 1× H rounds span 0.69–1.51.

**Stages, D** (% of the frame; the predicted range in the heading; *n*/10 is the rounds outside it by > 5 points):

| throttle | set | top decode (50–75) | low decode (18–45) | flush (< 1) | chroma + merge + range (3–8) | digest (0.3–1.3) |
| --- | --- | --: | --: | --: | --: | --: |
| 1× | `dbts_a1` † | 55.9 [55.2–56.7] · 0 | 37.4 [35.8–38.0] · 0 | 0.0 · 0 | 5.9 [5.5–6.8] · 0 | 0.5 · 0 |
| 1× | `dbts_b1` | 49.1 [48.5–49.6] · 0 | 38.7 [38.1–39.3] · 0 | 0.0 · 0 | 11.0 [10.8–11.2] · 0 | 0.9 · 0 |
| 1× | `dbts_c1` | 55.0 [54.1–55.7] · 0 | 36.3 [34.9–37.3] · 0 | 0.0 · 0 | 7.7 [7.3–8.1] · 0 | 0.6 · 0 |
| 4× | `dbts_a1` | 55.7 [55.0–57.1] · 0 | 37.1 [36.6–38.4] · 0 | 0.0 · 0 | 6.3 [5.7–6.8] · 0 | 0.3 · 0 |
| 4× | `dbts_b1` † | 48.9 [47.4–50.1] · 0 | 38.6 [37.0–39.5] · 0 | 0.0 · 0 | 11.3 [10.3–11.7] · 0 | 0.9 · 0 |
| 4× | `dbts_c1` † | 54.6 [52.7–55.2] · 0 | 36.4 [35.4–37.3] · 0 | 0.0 · 0 | 8.3 [7.1–9.2] · 0 | 0.7 · 0 |

† A/A void. The parse and the copy into the heap are ≤ 0.1 % each. **`_av1_decode`, top and low: 87.6–93.5 % of
D's frame** in every cell.

**Stages, W:**

| throttle | set | max(top, low) decode (≥ 55) | flush (7–28) | copyTo (2–5) | chroma + merge + range (5–12) | digest (0.5–2) |
| --- | --- | --: | --: | --: | --: | --: |
| 1× | `dbts_a1` | 77.7 [75.7–80.1] · 0 | 1.2 [1.1–1.3] · **10** | 5.7 [5.3–6.1] · 0 | 18.4 [17.1–21.1] · **10** | 0.9 · 0 |
| 1× | `dbts_b1` | 65.3 [62.7–67.1] · 0 | 6.6 [6.4–7.5] · 0 | 7.6 [7.3–8.0] · 0 | 29.1 [27.0–32.2] · **10** | 1.9 · 0 |
| 1× | `dbts_c1` | 73.4 [69.4–75.7] · 0 | 1.2 [1.2–1.3] · **10** | 6.9 [6.7–7.5] · 0 | 21.7 [19.7–25.4] · **10** | 1.1 · 0 |
| 4× | `dbts_a1` | 79.0 [77.0–81.3] · 0 | 1.8 [1.1–2.3] · 7 | 3.0 [2.1–4.1] · 0 | 17.6 [15.6–19.7] · 6 | 1.5 · 0 |
| 4× | `dbts_b1` † | 64.2 [62.0–66.3] · 0 | 7.3 [6.6–8.3] · 0 | 7.4 [6.9–8.0] · 0 | 30.4 [27.5–31.7] · **10** | 2.1 · 0 |
| 4× | `dbts_c1` | 73.7 [72.0–75.2] · 0 | 1.7 [1.1–2.3] · **9** | 4.5 [3.5–5.1] · 0 | 23.4 [21.5–26.4] · **10** | 1.7 · 0 |

Each stream's own time, config to flush, summed (one core's stand-in), against the frame: 165 / 113, 333 / 233
and 157 / 112 ms at 1×; 643 / 438, 1332 / 930 and 582 / 431 at 4×. In every set the top's decode is the longer
one, by a hair on `b1`, whose top is 8-bit. Of "chroma + merge + range", the two `place()` passes are 12–16 points
(24–25 on `b1`), and `neutral()` over both streams' chroma is 5–7. H: the codec call is 95–97 % of its frame, the digest 3–5 %.

**The rule.** Lever ÷ W, round-paired, the median [range], and the rounds of 10 the lever was faster:

| lever | 1× `a1` | 1× `b1` | 1× `c1` | 4× `a1` | 4× `b1` | 4× `c1` |
| --- | --: | --: | --: | --: | --: | --: |
| W1 | 0.942 · 10 | 0.961 · 9 | 0.921 · 9 | 0.967 · 7 | 1.024 · 2 | 0.960 · 9 |
| W2 | 0.944 · 8 | 0.902 · 10 | 0.920 · 10 | 0.950 · 10 | 0.914 · 10 | 0.901 · 10 |
| W12 | 0.893 · 9 | 0.884 · 10 | 0.873 · 8 | 0.913 · 10 | 0.912 · 10 | 0.902 · 10 |

Ranges, and every arm's stages, are in [`report.md`](report.md), `report.mjs`'s output for this run; the stamps' check is [`attribution.txt`](attribution.txt) (first pass). Every lever frame is exact (160 of 160 a cell). **W1: not built**: it is
faster in 2 rounds of 10 at 4× `b1` (1.024), and short of 5 % in five cells. **W2: not built**: it is faster in 8
of 10 at 1× `a1`, and 4× `a1`'s median is 0.950, at the line and not below it. W12 is not named in the rule. It
is 0.873–0.913 everywhere and faster in 8–10 rounds of 10.

**Store levers, for the owner** (bytes ÷ the base AV1 coding's; ms ÷ their own decoder's arm, round-paired):

| lever | bytes | `a1` 1× / 4× | `b1` 1× / 4× | `c1` 1× / 4× |
| --- | --: | --: | --: | --: |
| Z_D (low deflated, dav1d) | +0.23 to +0.36 % | 0.682 / 0.625 | 0.684 / 0.652 | 0.710 / 0.686 |
| Z_W (low deflated, WebCodecs) | same | 1.010 / 1.022 | 0.994 / 1.050 | 1.026 / 1.055 |
| T_D (4 tiles, 3 threads) | +0.04 to +0.09 % | 0.461 / 0.400 | 0.579 / 0.515 | 0.488 / 0.404 |
| T_W (4 tiles) | same | 0.654 / 0.487 | 0.774 / 0.655 | 0.643 / 0.515 |

Neither is built. T adds threads, so it is reported for an ask only. Every AV1 coding is 0.939–0.945 of HTJ2K's
bytes on these 16 slices.

**Off the protocol.** The host's `$CHROME_PATH` points at a Chromium 153. A smoke run took it before `run.mjs` was
pinned to 141, and nothing above comes from it. `simd-mt` built 635 278 B here, against the 635 174 B in
`client/decode/wasm/dav1d/README.md`.
