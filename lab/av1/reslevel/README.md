# reslevel

HTJ2K decoded at the resolution level a phone screen needs, exact at that size, then the whole frame on zoom. Queue
row 59 (RESLEVEL) of [`docs/av1/queue.md`](../../../docs/av1/queue.md); the reading is in
[`docs/decode/README.md`](../../../docs/decode/README.md) §A frame at the level the screen needs, the proposal in
[`docs/adr/resolution-fitting-for-large-frames.md`](../../../docs/adr/resolution-fitting-for-large-frames.md) §7.

```bash
lab/decode-bench/fetch_decoder.sh                                # OpenJPH, the shipped package
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160  # builds ojph_compress once
# OpenJPEG 2.5.4, native: lab/av1/embed/build.sh's first half (tag v2.5.4, commit 6c4a29b0)
lab/av1/fetch_data.sh ffdm_a ffdm_b ffdm_c ffdm_d syn2d_a syn2d_b syn2d_c syn2d_d dbt12_c dbt10_d
W=lab/.av1-work/reslevel
for s in ffdm_a ffdm_b ffdm_c ffdm_d syn2d_a syn2d_b syn2d_c syn2d_d dbt12_c dbt10_d; do      # ~1 min
  lab/av1/.venv/bin/python lab/av1/reslevel/make_frames.py lab/.av1-build $W lab/av1/data/$s &
done; wait
node lab/av1/reslevel/prefix.mjs lab/.av1-build $W                              # and --mutate prefix|truth
NODE_PATH=$(npm root -g) node lab/av1/reslevel/bench.mjs --rounds 10 --out $W/bench.json   # ~40 min; --mutate
cargo build --release -p exact-server -p pack-study && client/transport-ts/build.sh
for r in $(seq 0 9); do                                                          # ~20 min a round
  NODE_PATH=$(npm root -g) node lab/av1/total/run.mjs --frames $W --sets ffdm_a,syn2d_b,ffdm_d,dbt12_c,dbt10_d \
    --rounds 1 --first-round $r --out $W/links.jsonl
done
node lab/av1/reslevel/summary.mjs $W/links.jsonl
```

**The level** is the most reduced of the five whose long side still holds 1 000 pixels (`--screen`): level 1 on every
series but `ffdm_d` (3328×4096), level 2 there (832×1024).

**Exact at a level.** [`make_frames.py`](make_frames.py) writes each frame in the served profile (RPCL, one layer,
one tile, five levels), checked natively against the series' checksum, and takes the level's truth from OpenJPEG's
`opj_decompress -r`, which must equal [`ll.py`](ll.py)'s reversible 5/3 analysis of the source samples clamped to
[0, 2^B − 1] — two witnesses that share no code with OpenJPH. The shipped package's `decodeSubResolution` is not that:
it clamps at 0 and at the 16-bit container, not at the declared depth, and the 5/3 low band leaves the range
(up to 1 439 on a 10-bit frame). [`level.js`](level.js) clamps to 2^B − 1 after it; with that clamp every frame of the
ten series matches both witnesses.

**The prefix.** [`prefix.mjs`](prefix.mjs) binary-searches the shortest prefix whose decode at the level (through the
package and `level.js`) is the truth, and checks, per frame: the whole codestream exact, its level exact, the prefix's
level exact, the prefix one byte short not, and OpenJPEG (`-allow-partial`) decoding the prefix to the truth. It
writes the `res` arm: entry i < F is frame i's prefix, entry F + i the rest of its codestream.

**Decode only.** [`bench.mjs`](bench.mjs) times, in headless Chromium, three arms a frame in a Williams order: `whole`
(the product's `htj2k.js` on the whole codestream), `level` (the level from the whole codestream) and `prefix` (the
level from the prefix), each as the product leaves a frame — in a `SharedArrayBuffer`, its range taken; a fresh
browser per throttle, throttles in a Williams order a round.

**On the links.** `lab/av1/total/run.mjs` (row TOTAL's harness: the real server behind the relay, the product's
downloader, row 23's five links, 1× and 4×) carries the `res` arm through [`decoder.js`](decoder.js), handed in by the
downloader's `decoderWorker` seam: a prefix is posted as a preview at the level, a rest is joined to its prefix and
decoded whole by the product's module. Prefixes are shared between the decoder workers over a `BroadcastChannel`,
since a rest may reach another. The fill asks entries 0 … 2F − 1, so every level picture comes first and every
whole frame after; [`summary.mjs`](summary.mjs) pairs it with `htj2k` by round.

## Measured (2026-10-07)

**Bytes.** The first 4 frames (2 or 3 where the series has fewer); the prefix is the smallest exact one.

| series | frames | level, size | B | low band out of range (above 2^B − 1) | HTJ2K a frame | prefix a frame | share |
| --- | --: | --- | --: | --- | --: | --: | --: |
| `ffdm_a` | 4 × 2560×3328 | 1, 1280×1664 | 12 | 4 484 (22, 3 frames) | 2.87 MB | 0.747 MB | 25.9–26.3 % |
| `ffdm_b` | 2 × 1914×2294 | 1, 957×1147 | 12 | 0 | 2.76 MB | 0.726 MB | 26.2–26.3 % |
| `ffdm_c` | 4 × 1914×2294 | 1, 957×1147 | 12 | 374 (0) | 1.89 MB | 0.502 MB | 26.4–26.6 % |
| `ffdm_d` | 4 × 3328×4096 | 2, 832×1024 | 12 | 8 538 (1 585, 4 frames) | 4.81 MB | 0.346 MB | 7.0–7.5 % |
| `syn2d_a` | 2 × 2560×3328 | 1, 1280×1664 | 10 | 4 379 (33, 1 frame) | 2.67 MB | 0.691 MB | 25.8–26.1 % |
| `syn2d_b` | 4 × 2394×2850 | 1, 1197×1425 | 12 | 4 359 (148, 2 frames) | 3.36 MB | 0.897 MB | 26.7–26.8 % |
| `syn2d_c` | 3 × 1996×2457 | 1, 998×1229 | 10 | 5 681 (823, 3 frames) | 1.62 MB | 0.450 MB | 27.8–28.0 % |
| `syn2d_d` | 4 × 2394×2850 | 1, 1197×1425 | 12 | 4 385 (174, 2 frames) | 3.06 MB | 0.813 MB | 26.5–26.7 % |
| `dbt12_c` | 4 × 931×2124 | 1, 466×1062 | 12 | 6 544 (0) | 1.02 MB | 0.280 MB | 27.4–27.5 % |
| `dbt10_d` | 4 × 757×2336 | 1, 379×1168 | 10 | 4 686 (0) | 0.88 MB | 0.253 MB | 28.9–29.0 % |

35/35 frames pass every check of `prefix.mjs`; the prefix one byte short, and a wrong truth, each fail 35/35; the
clamp removed from `level.js` fails the 15 frames whose band rises above 2^B − 1.

**Decode only** (Chromium 141, n = 10 rounds, the median of each round's median; the ratio is the median of paired
round ratios, its range in brackets). 2 100/2 100 pictures exact; `--mutate` (one byte of every picture flipped)
turns every cell to 0.

| series | 1× whole ms | 1× level from the prefix | 4× whole ms | 4× level from the prefix |
| --- | --: | --- | --: | --- |
| `ffdm_a` | 58.5 | 17.0, ×0.286 [0.269–0.317] | 249.6 | 73.4, ×0.282 [0.252–0.323] |
| `ffdm_b` | 47.5 | 13.1, ×0.270 [0.251–0.295] | 197.2 | 56.1, ×0.275 [0.262–0.295] |
| `ffdm_c` | 34.6 | 9.81, ×0.291 [0.275–0.325] | 149.1 | 45.7, ×0.295 [0.266–0.370] |
| `ffdm_d` | 102.3 | 8.16, ×0.077 [0.069–0.083] | 444.9 | 37.4, ×0.084 [0.063–0.091] |
| `syn2d_a` | 63.9 | 18.5, ×0.290 [0.189–0.330] | 271.6 | 77.5, ×0.279 [0.177–0.356] |
| `syn2d_b` | 60.7 | 17.1, ×0.282 [0.273–0.296] | 259.5 | 76.7, ×0.295 [0.274–0.306] |
| `syn2d_c` | 36.1 | 10.8, ×0.292 [0.272–0.318] | 158.5 | 46.9, ×0.289 [0.227–0.345] |
| `syn2d_d` | 61.6 | 17.3, ×0.276 [0.260–0.363] | 256.8 | 71.2, ×0.276 [0.153–0.292] |
| `dbt12_c` | 17.6 | 5.38, ×0.292 [0.275–0.321] | 76.9 | 21.0, ×0.269 [0.197–0.346] |
| `dbt10_d` | 16.2 | 4.76, ×0.295 [0.286–0.362] | 72.0 | 21.3, ×0.308 [0.216–0.346] |

The level from the whole codestream is within a few per cent of the level from the prefix (×0.28–0.31 of whole at
level 1, ×0.094 at level 2): the decoder stops at the level either way.
