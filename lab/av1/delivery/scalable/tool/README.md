# The scalable preview as a tool — measured on whole DBT volumes

The pre-registered protocol of [`docs/av1/README.md`](../../../../../docs/av1/README.md) §The scalable preview as a
tool (5), run on the three DBT volumes the lab holds now; the reading and the decision rule's verdict are there (6).
The breast ultrasound cine and ABUS cells wait for their dataset and were not run.

```bash
lab/av1/tools/tools.sh aom dav1d && lab/av1/delivery/scalable/encoder/build.sh && lab/av1/delivery/scalable/two-layer/build_wasm.sh
client/decode/wasm/fetch_openjph.sh && client/transport/ts/build.sh
FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160            # builds ojph_compress once
# OpenJPEG 2.5.4, native: lab/av1/bytes/embedded/build.sh's first half (tag v2.5.4, commit 6c4a29b0)
lab/av1/fetch_data.sh dbts_a1 dbts_b1 dbts_c1
P=lab/av1/.venv/bin/python W=lab/.av1-work T=lab/av1/delivery/scalable/tool
$P lab/av1/delivery/split-rule/make_frames.py lab/.av1-build $W/shipped lab/av1/data/dbts_{a1,b1,c1} --preset allintra:7 --k 2 --jobs 3
$P $T/shapes.py lab/.av1-build $W/shipped $W/preview-tool $W/preview-tool.tsv lab/av1/data/dbts_{a1,b1,c1}   # ~25 min, 3 cores
$P $T/mutate.py lab/.av1-build $W/shipped $W/preview-tool lab/av1/data/dbts_a1
NODE_PATH=$(npm root -g) node $T/time.mjs --rounds 10 --out $W/preview-tool-decode.json      # ~75 min; --mutate sample
python3 $T/summary.py shapes $W/preview-tool.tsv --decode $W/preview-tool-decode.json
for s in a1 b1 c1; do $P lab/av1/decode/resolution-level/make_frames.py lab/.av1-build $W/preview-e2e lab/av1/data/dbts_$s \
  --frames 100 --screen 850; done
node lab/av1/decode/resolution-level/prefix.mjs lab/.av1-build $W/preview-e2e
for s in a1 b1 c1; do $P $T/make_frames.py lab/.av1-build $W/shipped $W/preview-tool $W/preview-e2e lab/av1/data/dbts_$s \
  --alone two-quarter-q20,two-quarter-q40 --predicted two-quarter-q20,two-quarter-q40; done
for r in 0 1 2; do                                                            # ~2.2 h a round
  NODE_PATH=$(npm root -g) node lab/av1/delivery/total-time/run.mjs --frames $W/preview-e2e --links r5000,r20000 --throttles 1,4 \
    --variants htj2k,htj2k-aa,res,k2,alone-two-quarter-q20,alone-two-quarter-q40,predicted-two-quarter-q20,predicted-two-quarter-q40 \
    --per-frame --rounds 1 --first-round $r --out $W/preview-e2e-rows.jsonl
done
python3 $T/summary.py fills $W/preview-e2e-rows.jsonl --frames $W/preview-e2e
```

This run's outputs are committed here: [`shapes.tsv`](shapes.tsv) (stage 1's codings), [`decode.json`](decode.json)
(its decode rounds) and [`rows.jsonl`](rows.jsonl) (stage 2's visits); the fill summary also reads each volume's
`variants.json` for F and the bytes.

## Stage 1, offline

**Shapes.** `shapes.py` codes each with `svc_encoder_rtc` (libaom 3.15.1, the patched example of
[`../encoder`](../encoder/README.md), speed 7, every top at quantizer 0), a keyframe every 8 frames:

| shape | layers | base |
| --- | --- | --- |
| `two-quarter-q{20,40,60}` | 2 (mode 5, `-r 1/4,1/1`) | ¼ size at q |
| `two-half-q{20,40,60}` | 2 (mode 5) | ½ size at q |
| `three-q{20,40,60}` | 3 (mode 6: ¼, ½, full) | ¼ size at q, the middle at q/2 |
| `two-quarter-q40-one-key` | 2 | ¼ at q 40, one keyframe: the bases-first measurement's shape |

Each in three families. **Predicted**: base and lossless top in one stream — on the 12-bit volumes as a split, the
stream coding v ≫ 2 at 10 bits and the low bits the shipped payload's own low units; on the 10-bit `dbts_b1` whole.
**Predicted, unsplit**: the 12-bit volumes coded at 12 bits whole. **Alone**: the predicted stream's base layer
(its operating-point stream, the base's own OBUs) stored beside the shipped payload, which is
[`../../split-rule`](../../split-rule/README.md)'s at `allintra` 7 and k = 2 — 0.948, 0.939 and 0.948 of HTJ2K's bytes,
as the DBT-at-scale measurement found.

**Checked.** Every frame of every top, decoded by native dav1d and merged with its low bits when split, against the
checksum written at the fetch: 3 000/3 000 frames, 50 codings. A base is measured, not checked: mean PSNR (peak
2^12 − 1 or 2^10 − 1) and max |Δ| against the source's 4×4 or 2×2 box mean, as
[`../shape`](../shape/README.md) does. **Mutated** (`mutate.py`, `dbts_a1`): the low bits dropped, the next frame's
low bits, the merge at the wrong shift, a truth corrupted (each 0/56 or 55/56); the shipped payload read at its frame
length rather than its top's (dav1d refuses the low stream). `time.mjs --mutate sample` turns every checked decode to
0/8.

**Decode** (`time.mjs`, shape.py's method): dav1d-WASM `simd-op` in headless Chromium 153, one decoder in order on a
volume's first 8 temporal units after an untimed pass; base quantizer 40 only, so q 20 and q 60 take q 40's times;
a split top adds the low stream's decode, alone's exact frame is the shipped payload's top and low through the same
decoder. A fresh browser per (throttle × volume), Williams order, 10 rounds, 1× and 4×
(`lab/scripts/cpu_throttle.mjs`); median ms a frame; 46 checked cells × 80/80 frames exact. One browser at a time,
one decoder thread: the host is not saturated.

| shape | `dbts_a1` bytes ÷ shipped · base % of HTJ2K · dB · d_b / d_x ms 1× · 4× | `dbts_b1` bytes ÷ shipped · base % of HTJ2K · dB · d_b / d_x ms 1× · 4× | `dbts_c1` bytes ÷ shipped · base % of HTJ2K · dB · d_b / d_x ms 1× · 4× | dropped for |
| --- | --- | --- | --- | --- |
| alone three-q20 | 1.001 · 0.075 % · 41.0 · 1.7 / 172 · 8.2 / 753 | 1.002 · 0.173 % · 46.4 · 4.5 / 353 · 20.9 / 1521 | 1.001 · 0.098 % · 42.2 · 1.8 / 156 · 8.4 / 680 | — |
| alone three-q40 | 1.000 · 0.023 % · 39.2 · 1.7 / 172 · 8.2 / 753 | 1.000 · 0.039 % · 41.8 · 4.5 / 353 · 20.9 / 1521 | 1.000 · 0.035 % · 40.1 · 1.8 / 156 · 8.4 / 680 | — |
| alone three-q60 | 1.000 · 0.009 % · 35.0 · 1.7 / 172 · 8.2 / 753 | 1.000 · 0.011 % · 36.0 · 4.5 / 353 · 20.9 / 1521 | 1.000 · 0.015 % · 34.9 · 1.8 / 156 · 8.4 / 680 | — |
| alone two-half-q20 | 1.002 · 0.203 % · 39.7 · 5.5 / 172 · 24.0 / 753 | 1.007 · 0.651 % · 46.6 · 18.7 / 353 · 85.3 / 1521 | 1.003 · 0.244 % · 43.2 · 5.1 / 156 · 24.2 / 680 | — |
| alone two-half-q40 | 1.001 · 0.055 % · 39.0 · 5.5 / 172 · 24.0 / 753 | 1.001 · 0.116 % · 42.8 · 18.7 / 353 · 85.3 / 1521 | 1.001 · 0.070 % · 41.6 · 5.1 / 156 · 24.2 / 680 | — |
| alone two-half-q60 | 1.000 · 0.018 % · 36.3 · 5.5 / 172 · 24.0 / 753 | 1.000 · 0.028 % · 37.7 · 18.7 / 353 · 85.3 / 1521 | 1.000 · 0.026 % · 37.3 · 5.1 / 156 · 24.2 / 680 | alone two-quarter-q40-one-key |
| alone two-quarter-q20 | 1.001 · 0.075 % · 41.0 · 1.7 / 172 · 7.9 / 753 | 1.002 · 0.172 % · 46.4 · 4.5 / 353 · 22.2 / 1521 | 1.001 · 0.098 % · 42.3 · 2.0 / 156 · 7.7 / 680 | — |
| alone two-quarter-q40 | 1.000 · 0.023 % · 39.2 · 1.7 / 172 · 7.9 / 753 | 1.000 · 0.039 % · 41.8 · 4.5 / 353 · 22.2 / 1521 | 1.000 · 0.035 % · 40.1 · 2.0 / 156 · 7.7 / 680 | — |
| alone two-quarter-q40-one-key | 1.000 · 0.016 % · 39.1 · 1.7 / 172 · 7.7 / 753 | 1.000 · 0.026 % · 41.6 · 4.8 / 353 · 21.2 / 1521 | 1.000 · 0.024 % · 39.9 · 2.2 / 156 · 8.0 / 680 | — |
| alone two-quarter-q60 | 1.000 · 0.009 % · 35.0 · 1.7 / 172 · 7.9 / 753 | 1.000 · 0.011 % · 36.0 · 4.5 / 353 · 22.2 / 1521 | 1.000 · 0.015 % · 34.9 · 2.0 / 156 · 7.7 / 680 | — |
| predicted three-q20 | 0.994 · 0.075 % · 41.0 · 1.7 / 177 · 8.2 / 786 | 1.016 · 0.173 % · 46.4 · 4.5 / 273 · 20.9 / 1231 | 0.992 · 0.098 % · 42.2 · 1.8 / 161 · 8.4 / 690 | — |
| predicted three-q40 | 0.992 · 0.023 % · 39.2 · 1.7 / 177 · 8.2 / 786 | 1.009 · 0.039 % · 41.8 · 4.5 / 273 · 20.9 / 1231 | 0.991 · 0.035 % · 40.1 · 1.8 / 161 · 8.4 / 690 | — |
| predicted three-q60 | 0.992 · 0.009 % · 35.0 · 1.7 / 177 · 8.2 / 786 | 1.009 · 0.011 % · 36.0 · 4.5 / 273 · 20.9 / 1231 | 0.992 · 0.015 % · 34.9 · 1.8 / 161 · 8.4 / 690 | predicted three-q40 |
| predicted two-half-q20 | 0.990 · 0.203 % · 39.7 · 5.5 / 176 · 24.0 / 742 | 1.005 · 0.651 % · 46.6 · 18.7 / 280 · 85.3 / 1223 | 0.988 · 0.244 % · 43.2 · 5.1 / 159 · 24.2 / 688 | — |
| predicted two-half-q40 | 0.992 · 0.055 % · 39.0 · 5.5 / 176 · 24.0 / 742 | 1.006 · 0.116 % · 42.8 · 18.7 / 280 · 85.3 / 1223 | 0.991 · 0.070 % · 41.6 · 5.1 / 159 · 24.2 / 688 | predicted two-half-q20 |
| predicted two-half-q60 | 0.995 · 0.018 % · 36.3 · 5.5 / 176 · 24.0 / 742 | 1.023 · 0.028 % · 37.7 · 18.7 / 280 · 85.3 / 1223 | 0.998 · 0.026 % · 37.3 · 5.1 / 159 · 24.2 / 688 | predicted two-half-q20 |
| predicted two-quarter-q20 | 0.991 · 0.075 % · 41.0 · 1.7 / 171 · 7.9 / 728 | 1.003 · 0.172 % · 46.4 · 4.5 / 257 · 22.2 / 1151 | 0.988 · 0.098 % · 42.3 · 2.0 / 157 · 7.7 / 667 | — |
| predicted two-quarter-q40 | 0.994 · 0.023 % · 39.2 · 1.7 / 171 · 7.9 / 728 | 1.007 · 0.039 % · 41.8 · 4.5 / 257 · 22.2 / 1151 | 0.992 · 0.035 % · 40.1 · 2.0 / 157 · 7.7 / 667 | predicted two-quarter-q20 |
| predicted two-quarter-q40-one-key | 0.989 · 0.016 % · 39.1 · 1.7 / 172 · 7.7 / 722 | 0.996 · 0.026 % · 41.6 · 4.8 / 254 · 21.2 / 1156 | 0.983 · 0.024 % · 39.9 · 2.2 / 155 · 8.0 / 668 | — |
| predicted two-quarter-q60 | 0.995 · 0.009 % · 35.0 · 1.7 / 171 · 7.9 / 728 | 1.024 · 0.011 % · 36.0 · 4.5 / 257 · 22.2 / 1151 | 0.999 · 0.015 % · 34.9 · 2.0 / 157 · 7.7 / 667 | predicted two-quarter-q20 |
| predicted-unsplit three-q20 | 1.101 · 0.075 % · 41.0 · 1.8 / 168 · 8.5 / 746 | — | 1.119 · 0.099 % · 42.2 · 2.4 / 142 · 8.6 / 680 | — |
| predicted-unsplit three-q40 | 1.101 · 0.025 % · 39.1 · 1.8 / 168 · 8.5 / 746 | — | 1.124 · 0.036 % · 40.0 · 2.4 / 142 · 8.6 / 680 | — |
| predicted-unsplit three-q60 | 1.103 · 0.011 % · 34.5 · 1.8 / 168 · 8.5 / 746 | — | 1.125 · 0.017 % · 34.4 · 2.4 / 142 · 8.6 / 680 | predicted-unsplit three-q20 |
| predicted-unsplit two-half-q20 | 1.098 · 0.206 % · 39.7 · 5.3 / 159 · 26.1 / 714 | — | 1.116 · 0.247 % · 43.2 · 5.4 / 142 · 23.9 / 641 | — |
| predicted-unsplit two-half-q40 | 1.104 · 0.058 % · 39.0 · 5.3 / 159 · 26.1 / 714 | — | 1.127 · 0.073 % · 41.6 · 5.4 / 142 · 23.9 / 641 | predicted-unsplit two-half-q20 |
| predicted-unsplit two-half-q60 | 1.110 · 0.021 % · 36.0 · 5.3 / 159 · 26.1 / 714 | — | 1.136 · 0.031 % · 36.8 · 5.4 / 142 · 23.9 / 641 | predicted-unsplit two-half-q20 |
| predicted-unsplit two-quarter-q20 | 1.100 · 0.075 % · 41.0 · 1.8 / 155 · 7.9 / 694 | — | 1.117 · 0.098 % · 42.2 · 1.9 / 146 · 9.2 / 633 | — |
| predicted-unsplit two-quarter-q40 | 1.107 · 0.024 % · 39.1 · 1.8 / 155 · 7.9 / 694 | — | 1.129 · 0.036 % · 40.0 · 1.9 / 146 · 9.2 / 633 | predicted-unsplit two-quarter-q20 |
| predicted-unsplit two-quarter-q40-one-key | 1.097 · 0.017 % · 39.0 · 1.7 / 157 · 7.8 / 696 | — | 1.110 · 0.025 % · 40.0 · 1.9 / 141 · 8.8 / 630 | — |
| predicted-unsplit two-quarter-q60 | 1.110 · 0.011 % · 34.5 · 1.8 / 155 · 7.9 / 694 | — | 1.137 · 0.016 % · 34.4 · 1.9 / 146 · 9.2 / 633 | predicted-unsplit two-quarter-q20 |

Bytes are the whole volume over the shipped payload's (alone: shipped + base); the base in % of HTJ2K's bytes, its
PSNR, and d_b / d_x ms a frame at 1× · 4×. *Dropped for* names a shape at least as good on every key on every volume;
the q 20 and q 60 drops lean on q 40's decode times. The unsplit 12-bit predicted coding is 1.097–1.137 of the shipped
bytes on both 12-bit volumes, out by the rule's bytes clause.

**What went on.** Fourteen shapes are undominated and within the rule's 1.02 of the shipped bytes on every volume —
more than the protocol's four, and it names no ranking. The four run: the quarter base, two layers, a keyframe every
8, at q 20 (the best base that passes everywhere: 41.0–46.4 dB) and at q 40 (the protocol's named shape), each alone
and predicted. The three-layer shapes carry the same ¼ base with a predicted top up to 1.3 % larger and 3–8 % slower to
decode; the half bases decode 3–4× slower than the quarter; the one-keyframe shape is the bases-first measurement's link, one
group on one decoder. Predicted q 40 is dominated by q 20 only through q 40's decode times standing in for q 20's,
so it was kept.

## Stage 2, end to end

**Rig.** [`../../total-time`](../../total-time/README.md)'s, the downloader, server and store unchanged: a fresh
server, relay and headless Chromium 153 a visit, fixed 5 and 20 Mbit/s with 20 ms each way, 1× and 4×
(`cpu_throttle.mjs`), cells in a Williams order each round and the variants inside each cell the same way, 3 rounds
(the protocol asks ≥ 10; a round of the 12 cells took ~2.2 h). Two lab-only changes to the rig: `--per-frame`
records each frame's preview and exact times, and a two-layer variant may name its decoder worker and start its
exact layer at `exactAt` — the next multiple of 8 after F — so its keyframe groups line up with the downloader's
(F = 50 and 69 are not multiples of 8; the entries between are never asked for).

**Variants.** `htj2k` (and `htj2k-aa`, the same files: the A/A arm); `res`, HTJ2K's half-size prefix first
([`../../../decode/resolution-level`](../../../decode/resolution-level/README.md), `--screen 850` puts all three at
level 1; every prefix checked by its own and OpenJPEG's decode); `k2`, the shipped payload, which the product
decodes through WebCodecs; and the four shapes layer-major — entry i the base unit, entry `exactAt` + i the shipped
payload (alone) or the whole scalable unit wrapped as a split payload (predicted), both through
[`decoder.js`](decoder.js): bases on dav1d-WASM as previews, exact payloads through the product's `av1.js`.
`svc_encoder_rtc` refuses odd sizes, so on `dbts_a1` and `dbts_c1` the predicted top is one row taller: its low
stream is coded again at the shipped settings with the last row repeated once and its exact frames checked against
that input, as bases-first did — a product payload would need the crop.

**Checked.** Every exact frame against its checksum and every base against native dav1d's decode of the bases at
operating point 1, on the page. 288 visits, 29 `VOID` by the relay's self-timing (p99 over 1 ms) and dropped, n = 1–3
a cell kept. Over every visit 16 794/16 800 frames exact and 10 500/10 500 bases as native, none late, none stray.
The six: one `VOID` visit (round 2, `dbts_b1`, 5 Mbit, 4×, predicted q 40) in which one group's exact frames failed to
decode — `frame 65 was not decoded before it here`, the product's group order check, no resume recorded — failed,
not wrong; *diagnosed since* (§The failed visit): WebCodecs' stall guard flushed a slow exact frame mid-group. **Mutated** (`dbts_a1`, 50 Mbit, 1×): `--mutate sample` and `--mutate truth` turned both
layouts to 0/56 exact and 0/56 bases as native; bases posted unmarked showed 0 previews and 56 strays.

**Host.** 4 vCPU at 2.1 GHz, the relay on a core of its own, browser and server on three; 15 GB. The links run
are far under the browser's receive ceiling (~100 MB/s, [`docs/rig-limits.md`](../../../../../docs/rig-limits.md)
§1), and at 4× every exact series stayed link-bound (HTJ2K and shipped within 1.3 % of their 1× times), so this run
does not reach where three slowed cores saturate. Nothing is claimed above 20 Mbit/s.

**Reading** (`summary.py fills`): seconds from the fill's issue, medians; t_P every slice with a picture, t_X every
slice exact; t_X ÷ shipped the median of round-paired ratios; *v 15* the share of slices a reader scrolling from
slice 0 at 15 slices/s finds with a picture as it reaches them, read off the fill's per-frame times (the viewer asks
nothing new while scrolling, the protocol's 4). The A/A arm's t_X ratios were 0.998–1.003.

| volume, link, CPU | HTJ2K t_X, s | shipped t_X | prefix t_P · v 15 | `alone-two-quarter-q20` t_P s · t_X ÷ shipped · v 15 | `alone-two-quarter-q40` t_P s · t_X ÷ shipped · v 15 | `predicted-two-quarter-q20` t_P s · t_X ÷ shipped · v 15 | `predicted-two-quarter-q40` t_P s · t_X ÷ shipped · v 15 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `dbts_a1` 20 Mbit 1× (n ≥ 3) | 27.8 | 26.4 | 7.6 · 0 % | 0.31 · 1.000 · 96 % | 0.28 · 1.000 · 95 % | 0.33 · 0.992 · 96 % | 0.29 · 0.993 · 95 % |
| `dbts_a1` 20 Mbit 4× (n ≥ 1) | 27.9 | 26.7 | 7.6 · 0 % | 0.62 · 1.003 · 89 % | 0.57 · 0.999 · 91 % | 0.55 · 0.990 · 95 % | 0.55 · 0.992 · 93 % |
| `dbts_a1` 5 Mbit 1× (n ≥ 2) | 110.5 | 104.9 | 30.0 · 0 % | 0.28 · 1.001 · 96 % | 0.35 · 1.000 · 96 % | 0.33 · 0.992 · 96 % | 0.28 · 0.994 · 96 % |
| `dbts_a1` 5 Mbit 4× (n ≥ 2) | 110.6 | 105.2 | 30.0 · 0 % | 0.56 · 1.001 · 91 % | 0.61 · 1.000 · 90 % | 0.61 · 0.992 · 91 % | 0.45 · 0.994 · 95 % |
| `dbts_b1` 20 Mbit 1× (n ≥ 1) | 43.9 | 41.4 | 12.0 · 0 % | 0.51 · 1.002 · 94 % | 0.61 · 1.001 · 93 % | 0.51 · 1.006 · 94 % | 0.50 · 1.008 · 92 % |
| `dbts_b1` 20 Mbit 4× (n ≥ 2) | 44.2 | 41.9 | 12.1 · 0 % | 1.04 · 1.007 · 84 % | 0.98 · 1.003 · 84 % | 1.10 · 1.021 · 84 % | 0.96 · 1.022 · 84 % |
| `dbts_b1` 5 Mbit 1× (n ≥ 1) | 175.1 | 164.5 | 47.5 · 0 % | 0.58 · 1.002 · 94 % | 0.50 · 1.001 · 92 % | 0.46 · 1.006 · 96 % | 0.49 · 1.009 · 93 % |
| `dbts_b1` 5 Mbit 4× (n ≥ 2) | 175.3 | 165.1 | 47.6 · 0 % | 0.93 · 1.002 · 84 % | 0.91 · 1.000 · 84 % | 0.94 · 1.006 · 84 % | 0.98 · 1.009 · 84 % |
| `dbts_c1` 20 Mbit 1× (n ≥ 1) | 28.9 | 27.5 | 8.0 · 0 % | 0.41 · 1.001 · 96 % | 0.42 · 1.000 · 96 % | 0.39 · 0.989 · 96 % | 0.36 · 0.993 · 97 % |
| `dbts_c1` 20 Mbit 4× (n ≥ 2) | 29.0 | 27.8 | 8.0 · 0 % | 0.61 · 1.002 · 93 % | 0.59 · 1.003 · 94 % | 0.72 · 0.991 · 93 % | 0.60 · 0.997 · 93 % |
| `dbts_c1` 5 Mbit 1× (n ≥ 2) | 115.2 | 109.2 | 31.5 · 0 % | 0.35 · 1.001 · 97 % | 0.39 · 1.000 · 96 % | 0.34 · 0.989 · 97 % | 0.37 · 0.992 · 97 % |
| `dbts_c1` 5 Mbit 4× (n ≥ 2) | 115.2 | 109.4 | 31.5 · 0 % | 0.63 · 1.001 · 94 % | 0.61 · 1.000 · 94 % | 0.64 · 0.989 · 94 % | 0.65 · 0.992 · 93 % |

Over every kept visit, t_P was 0.003–0.025 of HTJ2K's t_X; t_X 0.999–1.007 of the shipped payload's alone and
0.989–1.022 predicted; the fill's bytes 1.000–1.002 of the shipped alone and 0.989–1.007 predicted (bases twice). The
first picture came 69–256 ms after the issue against HTJ2K's 744–4 340 ms and the prefix's 306–1 250. On the scroll,
84–97 % of slices showed a picture at 15 slices/s (94–99 % at 5, 62–96 % at 30); HTJ2K and its prefix first, 0 %
at 15 and 30 (the prefix 0–93 % at 5).

## The failed visit

*2026-11-02.* The six frames of round 2's `dbts_b1`, 5 Mbit, 4×, predicted q 40 visit are exact frames 10–15, entries
66–71: the rest of the group of 8 that entries 64 and 65 began. Entry 65 (frame 9) landed 4.69 s after frame 8; in
the cell's nine visits every other step between frames 0 and 20 took 2.4–3.8 s (`rows.jsonl`'s `exactMs`). So frame
9's decode ran over 2 s.

**The cause.** `client/decode/av1-webcodecs.js` flushes a unit that has given neither a frame nor an error after
2 s, against a unit that never will (docs/decode/README.md §WebCodecs without a flush). A slow frame is such a unit
too. The flush gives its frame, so frame 9 was exact, but it also ends the group: WebCodecs then takes only a key
chunk. Frame 10's chunk throws `A key frame is required after configure() or flush()`. `av1.js` then tries
dav1d-WASM. That decoder never held the group, so it refuses the unit by name (the message in the row) and hides the
WebCodecs error. Each of frames 11–15 fails the same way. Frame 16 is a keyframe and decodes.

**Reproduced** ([`stall`](stall/)): a 16-frame 10-bit grey series at `dbts_b1`'s 2560×3328, coded lossless by libaom
(ffmpeg's `libaom-av1`, a keyframe every 8, no look-ahead), every unit through `av1.js` as the exact layer is.
dav1d-WASM is not built here: `stub-dav1d.js` is its `picture()` up to the decode, so the refusal is the same.
Headless Chromium 153, every thread capped by `lab/scripts/cpu_throttle.mjs`.

```bash
W=lab/.av1-work/stall; node lab/av1/delivery/scalable/tool/stall/make_group.mjs $W        # ~1 min
NODE_PATH=$(npm root -g) node lab/av1/delivery/scalable/tool/stall/run.mjs $W --rate 4 [--stall-ms 10000]
NODE_PATH=$(npm root -g) node lab/av1/delivery/scalable/tool/stall/run.mjs $W --rate 1 --hole 3 --frames 12 [--stall-ms 10000]
```

| run, 3 rounds interleaved | frames exact | failed | slowest frame |
| --- | --- | --- | --- |
| 1×, the 2 s bound (one run) | 16/16 | — | 0.95 s |
| 4×, the 2 s bound | 3, 2, 2 of 16 | the rest of each group after the first frame over 2 s, by name | 2.8–3.2 s |
| 4×, `stallMs` 10 000 | 16/16 each round | — | 4.0–4.9 s |
| 1×, a bare delimiter at frame 3, either bound | 0–2 and 8–11 | 3–7, by name, after 2 s or 10 s | — |

Through `av1-webcodecs.js` alone, the unit after the flushed one throws WebCodecs' `DataError`, as the specification
says it must.

**The fix, lab only.** `av1-webcodecs.js` takes `stallMs` from the decoder config, default 2 000 ms, so the product
is unchanged. This tool's worker sets 10 000 ms, the downloader's own `decodeMs`. A unit that never gives a frame
still fails by name (last row). Not fixed, since it is the product's: at G > 1 the fixed bound loses groups on any
CPU slow enough for one frame to take 2 s. And `av1.js` reports dav1d-WASM's refusal of a unit it never held, not
the WebCodecs error behind it. Both are proposed in docs/av1/README.md §The scalable preview as a tool, 7.
