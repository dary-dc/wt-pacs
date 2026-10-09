# splittime — the per-depth layout rule by bytes, decode and total time

Queue row 44 (SPLITTIME) of [`docs/av1/queue.md`](../../../../docs/av1/queue.md): with the split exact at
every depth and k (row 43, [`../../exact/split`](../../exact/split/README.md)), which k each depth should store, by
bytes, decode and total time against HTJ2K. The verdict is in
[`docs/av1/README.md`](../../../../docs/av1/README.md) §A3 and §Total time, and as a proposal in
[`docs/av1/item-format.md`](../../../../docs/av1/item-format.md).

```bash
lab/av1/tools/tools.sh && ARMS=simd client/decode/wasm/dav1d/build.sh      # libaom, native dav1d, dav1d-WASM
client/decode/wasm/fetch_openjph.sh                              # OpenJPH, the shipped package
PATH=lab/av1/.venv/bin:$PATH FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160  # ojph_compress
client/transport/ts/build.sh                                   # the client's session bundle
lab/av1/fetch_data.sh ct_lidc xa_dynact16 dbtproj_ge dbtproj_holo pt15_cptac mg16_cbis \
  mr_ispy1 rf_fluoro dbt12_ea1141 dbt10_ea1141 mr9_ispy2
P=lab/av1/.venv/bin/python D=lab/av1/data W=lab/.av1-work/splittime
S="$D/ct_lidc $D/xa_dynact16 $D/dbtproj_ge $D/dbtproj_holo $D/pt15_cptac $D/mg16_cbis $D/mr_ispy1 $D/rf_fluoro $D/dbt12_ea1141 $D/dbt10_ea1141 $D/mr9_ispy2"
$P lab/av1/delivery/split-rule/make_frames.py lab/.av1-build $W $S --reuse lab/.av1-work/splitok/real   # cpu0 items
$P lab/av1/delivery/split-rule/sweep.py lab/.av1-build $W $S --out sweep.json        # the shipped preset per k
NODE_PATH=$(npm root -g) node lab/av1/delivery/split-rule/decode.mjs --rounds 12 --out decode.json
for r in $(seq 0 9); do
  NODE_PATH=$(npm root -g) node lab/av1/delivery/total-time/run.mjs --frames $W --rounds 1 --first-round $r --out total.jsonl
done
NODE_PATH=$(npm root -g) node lab/av1/delivery/total-time/run.mjs --frames $W --summary --out total.jsonl
```

**Arms**, per series of b bits after its offset, named by k so none is ambiguous, each run once
however many names it has, and only where its top fits a 12-bit stream: **HTJ2K** (the served
profile); **d12**, k = max(0, b − 12); **k = 2**, the adopted optimized rule; **k = 3**; **w10**,
k = max(0, b − 10), every stream ≤ 10 bits. Each AV1 arm is the series' items
([`item-format.md`](../../../../docs/av1/item-format.md)) written by `ingest.py --split K`, libaom 3.15.1
lossless with `--tune-content=screen --sb-size=64`, and the item picks its decoder: WebCodecs where
every stream is ≤ 10 bits, dav1d-WASM otherwise. A row-43 item (`--reuse`) is the same file ingest
would write: both came from `ingest.py` at the same preset, and row 43 checked every one exact.

| b | series | arms (k) |
| --- | --- | --- |
| 16 | `mg16_cbis` | d12 4, w10 6 |
| 15 | `pt15_cptac` | d12 = k3 3, w10 5 |
| 14 | `dbtproj_ge`, `dbtproj_holo` | d12 = k2 2, k3 3, w10 4 |
| 13 | `ct_lidc`, `xa_dynact16` | d12 1, k2 2, k3 = w10 3 |
| 12 | `rf_fluoro`, `dbt12_ea1141` | d12 0, k2 = w10 2, k3 3 |
| 11 | `mr_ispy1` | d12 0, w10 1, k2 2, k3 3 |
| 10, 9 | `dbt10_ea1141`, `mr9_ispy2` | d12 = w10 0, k2 2, k3 3 |

**The port to items.** The decode harness (`decode.mjs`, `index.html`) is row REP14's with its frames
as items and its arms read from `manifest.json`; row TOTAL's `run.mjs` takes `arms.json` unchanged,
an AV1 arm being only its stored form (`ext`) under `codec: "av1"`.

## Bytes (2026-10-06)

Every frame of each series, the item's bytes (header and lengths included) over HTJ2K's at cpu0, and at
the shipped preset: the fastest of `--allintra` 9…6 and good 6…3 within 2 % of cpu0 on the first two
frames, then confirmed on the whole series (`sweep.py`; on the CT and the MR's k = 2 the two-frame pick,
`--allintra` 6, was 2.1–2.7 % over on the whole series and good 6 replaced it, as row 33 found for the
CT). **Bold** is each series' smallest arm at the shipped preset.

| b | series | d12 | k = 2 | k = 3 | w10 | shipped presets |
| --- | --- | --- | --- | --- | --- | --- |
| 16 | mammogram, 1 × 4366×6871 | k4 1.077 · 1.093 | — | — | k6 1.001 · **1.012** | a7, a6 |
| 15 | PET, 335 × 256² | k3 1.092 · 1.099 | — | = d12 | k5 1.040 · **1.040** | good 6, cpu0 |
| 14 | projections, system 1 | k2 0.953 · 0.953 | = d12 | 0.944 · **0.952** | k4 0.999 · 1.007 | a7, a7, a9 |
| 14 | projections, system 2 | k2 0.923 · **0.925** | = d12 | 0.937 · 0.948 | k4 1.046 · 1.059 | a7, a7, a9 |
| 13 | CT | k1 0.926 · 0.938 | 0.917 · **0.927** | 0.932 · 0.940 | = k3 | good 6 |
| 13 | cone-beam | k1 1.052 · 1.069 | 0.986 · 0.999 | 0.948 · **0.964** | = k3 | a6, good 6, a6 |
| 12 | fluoroscopy | k0 1.019 · 1.037 | 0.943 · 0.950 | 0.941 · **0.947** | = k2 | a6, a7, a7 |
| 12 | tomosynthesis 12-bit | k0 1.039 · 1.055 | 0.942 · 0.955 | 0.936 · **0.947** | = k2 | good 6, a7, a7 |
| 11 | MR | k0 1.032 · 1.048 | 0.989 · **0.997** | 1.003 · 1.020 | k1 0.997 · 1.009 | good 6 (k ≤ 2), a6 |
| 10 | tomosynthesis 10-bit | k0 0.971 · 0.986 | 0.944 · **0.960** | 0.962 · 0.974 | = d12 | good 6, a7, a6 |
| 9 | MR, 9 bits | k0 0.916 · **0.927** | 1.028 · 1.036 | 1.007 · 1.019 | = d12 | good 6, good 6, a6 |

Each cell is cpu0 · shipped. The mammogram has one frame, so its shipped figure is the sweep's. **At 15
and 16 bits every arm is over HTJ2K** (1.012–1.099 shipped), on the first real series of those depths
here, and w10 (more low bits) is the smaller. Under 12 bits the low two bits pay
off where the samples are noisy (the 10-bit tomosynthesis, the MR) and not on the 9-bit MR, whose top
at k = 0 is all its samples.

## Decode (2026-10-07)

A frame through the product's `decoder.js` as of `2d77d7d` (before row DECODE's changes) in headless Chromium 141, every frame of each series' cpu0
items, 12 rounds interleaved (`decode.mjs`), 59 280/59 280 frames exact. HTJ2K is ms a frame, median of
round medians at 1× · 4×; each arm the median of round-paired ratios to it. `wc` marks an arm whose
streams are all ≤ 10 bits, so WebCodecs decodes it; the rest are dav1d-WASM.

| b | series | HTJ2K, ms | d12 | k = 2 | k = 3 | w10 |
| --- | --- | --- | --- | --- | --- | --- |
| 16 | mammogram | 438 · 1 842 | k4 7.25 · 7.36 | — | — | k6 wc **2.12 · 1.59** |
| 15 | PET | 1.06 · 1.11 | k3 6.32 · 21.3 | — | = d12 | k5 wc **4.12 · 9.16** |
| 14 | projections, system 1 | 90 · 379 | k2 6.97 · 7.23 | = d12 | 6.86 · 7.27 | k4 wc **2.76 · 2.63** |
| 14 | projections, system 2 | 50 · 204 | k2 6.03 · 6.18 | = d12 | 6.37 · 6.51 | k4 wc **2.86 · 2.74** |
| 13 | CT | 4.54 · 16.8 | k1 6.09 · 6.67 | 6.12 · 6.82 | wc **2.96 · 2.44** | = k3 |
| 13 | cone-beam | 4.76 · 14.2 | k1 8.24 · 11.6 | 7.70 · 10.6 | wc **3.85 · 4.18** | = k3 |
| 12 | fluoroscopy | 9.78 · 36.9 | k0 7.55 · 8.59 | wc 4.15 · 4.12 | wc **3.51 · 3.47** | = k2 |
| 12 | tomosynthesis 12-bit | 12.3 · 48.8 | k0 6.14 · 6.56 | wc 3.56 · 3.27 | wc **3.07 · 2.83** | = k2 |
| 11 | MR | 4.92 · 16.6 | k0 5.61 · 6.75 | wc 3.11 · 2.98 | wc **3.03 · 2.87** | k1 3.87 · 3.80 |
| 10 | tomosynthesis 10-bit | 17.1 · 72.4 | k0 wc 4.10 · 3.80 | wc **2.61 · 2.27** | wc 2.78 · 2.53 | = d12 |
| 9 | MR, 9 bits | 1.45 · 1.90 | k0 wc 4.64 · 7.57 | wc **4.02 · 7.18** | wc 4.17 · 7.36 | = d12 |

**No arm decodes as fast as HTJ2K on any series** (0/12 rounds faster, every cell): the fastest arm is
1.59–4.12× HTJ2K's time a frame, and it is always the one WebCodecs takes, never dav1d-WASM's 12-bit top
(5.6–11.6×). The port reproduces row REP14's cells within their spread: the CT's w10 13.4 · 40.7 ms
(REP14 13.8 · 41.0), system 1's w10 246 · 999 (246 · 1 023) and its d12 635 · 2 709 (622 · 2 665). The
PET's HTJ2K frame, 256², is ~1 ms at 1× and at 4× alike: the throttle does not reach a decode that
short, so its 4× ratios overstate. `--mutate sample` and `--mutate truth` each turned every arm to 0 exact.

## Total time, 13–16 bits (2026-10-07)

Row TOTAL's `run.mjs` on these items (`--frames lab/.av1-work/splittime`), links, CPU and Williams order
unchanged, rounds 0–9, then 10–11 on every link but 50 Mbit to top up the cells `VOID` had left short; rounds 6–11 ran from a checkout frozen at the run's first revision (`90eb331`), since
the branch moved under it. 204 160/204 160 frames exact over 2 552 visits, 41 `VOID`
dropped, n = 10–12 a cell but one (9). Each HTJ2K cell is the median seconds to every frame on the page; each arm
the median of round-paired ratios to it; 1× · 4×. The port reproduces row REP14's cells within their
spread: the CT's w10 at 50 Mbit is 0.94 · 0.95 (REP14 0.94 · 0.94, HTJ2K 2.87 · 2.88 s both), d12 on
system 2 at 5 Mbit 0.93 · 0.95 (0.93 · 0.94). `--mutate sample` and `--mutate truth` each turned every arm
to 0 exact.

| series | arm | 5 Mbit | 20 Mbit | 50 Mbit | LTE | Wi-Fi |
| --- | --- | --- | --- | --- | --- | --- |
| ct_lidc | HTJ2K, s | 26.7 · 26.7 | 6.81 · 6.82 | 2.87 · 2.88 | 5.4 · 5.34 | 11.8 · 11.2 |
| ct_lidc | k1 | 0.93 · 0.93 | 0.93 · 0.94 | 0.94 · 1.63 | 0.95 · 1.04 | 0.89 · 0.90 |
| ct_lidc | k2 | 0.92 · 0.92 | 0.92 · 0.93 | 0.93 · 1.68 | 0.94 · 1.04 | 0.89 · 0.90 |
| ct_lidc | k3 | 0.93 · 0.93 | 0.93 · 0.94 | 0.94 · 0.95 | 0.95 · 0.96 | 0.97 · 0.93 |
| xa_dynact16 | HTJ2K, s | 24.2 · 24.2 | 6.18 · 6.19 | 2.62 · 2.63 | 5.04 · 4.99 | 9.97 · 9.85 |
| xa_dynact16 | k1 | 1.05 · 1.06 | 1.06 · 1.08 | 1.06 · 1.68 | 1.05 · 1.09 | 1.07 · 1.05 |
| xa_dynact16 | k2 | 0.99 · 0.99 | 0.99 · 1.01 | 1.00 · 1.66 | 1.00 · 1.04 | 0.98 · 1.02 |
| xa_dynact16 | k3 | 0.95 · 0.95 | 0.95 · 0.96 | 0.96 · 0.97 | 0.96 · 0.98 | 0.96 · 0.91 |
| dbtproj_ge | HTJ2K, s | 60 · 60.2 | 15.2 · 15.4 | 6.27 · 6.53 | 14.1 · 14.4 | 28 · 28.8 |
| dbtproj_ge | k2 | 0.96 · 0.99 | 0.99 · 1.11 | 1.05 · 1.69 | 0.95 · 1.09 | 0.96 · 1.03 |
| dbtproj_ge | k3 | 0.95 · 0.98 | 0.98 · 1.10 | 1.04 · 1.66 | 0.94 · 1.08 | 0.97 · 1.06 |
| dbtproj_ge | k4 | 1.00 · 1.01 | 1.01 · 1.04 | 1.03 · 1.09 | 1.01 · 1.04 | 1.01 · 1.04 |
| dbtproj_holo | HTJ2K, s | 47.9 · 48.1 | 12.1 · 12.3 | 5.03 · 5.17 | 9.2 · 9.35 | 21.5 · 21.8 |
| dbtproj_holo | k2 | 0.93 · 0.95 | 0.95 · 1.02 | 0.98 · 1.53 | 0.95 · 1.04 | 0.92 · 0.98 |
| dbtproj_holo | k3 | 0.94 · 0.96 | 0.96 · 1.04 | 0.99 · 1.57 | 0.96 · 1.06 | 0.93 · 0.96 |
| dbtproj_holo | k4 | 1.05 · 1.05 | 1.05 · 1.07 | 1.06 · 1.12 | 1.10 · 1.13 | 1.04 · 1.06 |
| pt15_cptac | HTJ2K, s | 17 · 17 | 4.38 · 4.38 | 1.9 · 1.9 | 3.76 · 3.74 | 6.42 · 6.62 |
| pt15_cptac | k3 | 1.09 · 1.09 | 1.09 · 1.09 | 1.09 · 1.91 | 1.08 · 1.22 | 1.09 · 1.10 |
| pt15_cptac | k5 | 1.04 · 1.04 | 1.04 · 1.04 | 1.04 · 1.16 | 1.04 · 1.04 | 1.06 · 1.03 |
| mg16_cbis | HTJ2K, s | 34.8 · 36.5 | 9.23 · 10.9 | 4.14 · 5.86 | 7.19 · 8.88 | 16.4 · 17 |
| mg16_cbis | k4 | 1.16 · 1.40 | 1.37 · 2.18 | 1.73 · 3.11 | 1.45 · 2.41 | 1.24 · 1.81 |
| mg16_cbis | k6 | 1.02 · 1.03 | 1.06 · 1.09 | 1.13 · 1.16 | 1.08 · 1.11 | 1.04 · 1.06 |

* **13 bits: k = 3 (= w10, WebCodecs) on every cell**, 0.91–0.98 of HTJ2K, and its first frame within
  ±20 ms of HTJ2K's (median 0–17 ms). k = 1 and k = 2 tie it where the wire is the clock on the CT and lose
  on the cone-beam (k = 1 1.05–1.09); at 4× on 50 Mbit both take 1.63–1.68, and their first frame is
  63–270 ms behind.
* **14 bits: k = 2 or k = 3 where the wire is the clock, HTJ2K where a slow CPU meets 20 Mbit or more.** At
  1× they are 0.92–0.99 but on system 1 at 50 Mbit (1.04–1.05); at 4× they win at 5 Mbit (0.95–0.99) and
  on system 2's Wi-Fi, and lose 2–69 % elsewhere. The two are within 0.03 of each other on every cell,
  k = 2 ahead on system 2, k = 3 on system 1. w10 (k = 4) is 1.00–1.13: its decode is the fastest
  (§Decode), its four low bits cost more than that buys.
* **15 and 16 bits: HTJ2K on every cell.** w10 is the better AV1 arm on both, 1.02–1.16; the 12-bit top
  (d12) 1.08–1.91 on the PET and 1.16–3.11 on the mammogram, whose one 30-megapixel frame through
  dav1d-WASM is 13 s behind HTJ2K's at 4×.
* **Saturation.** As rows TOTAL and REP14 found: at 4× on 50 Mbit, and on 20 Mbit for the projections and
  the mammogram, dav1d-WASM's decode is the fill's clock. Nothing is claimed about a phone.

## Total time, 9–12 bits: the controls (2026-10-07)

The same harness and frozen checkout on the fixed links only (`--links r5000,r20000,r50000`, as rows TOTAL2
and TOTAL3), rounds 0–9: 42 600/42 600 frames exact over 1 260 visits, 31 `VOID` dropped, n = 8–10 a cell.

| series | arm | 5 Mbit | 20 Mbit | 50 Mbit |
| --- | --- | --- | --- | --- |
| mr_ispy1 | HTJ2K, s | 17.7 · 17.7 | 4.55 · 4.56 | 1.97 · 1.98 |
| mr_ispy1 | k0 | 1.03 · 1.04 | 1.04 · 1.05 | 1.04 · 1.50 |
| mr_ispy1 | k1 | 1.00 · 1.00 | 1.00 · 1.01 | 1.00 · 1.02 |
| mr_ispy1 | k2 | 0.99 · 0.99 | 0.99 · 0.99 | 0.99 · 1.01 |
| mr_ispy1 | k3 | 1.00 · 1.00 | 1.00 · 1.01 | 1.01 · 1.02 |
| rf_fluoro | HTJ2K, s | 15.2 · 15.2 | 3.92 · 3.95 | 1.72 · 1.74 |
| rf_fluoro | k0 | 1.02 · 1.04 | 1.03 · 1.09 | 1.05 · 1.54 |
| rf_fluoro | k2 | 0.95 · 0.95 | 0.95 · 0.98 | 0.97 · 1.02 |
| rf_fluoro | k3 | 0.94 · 0.95 | 0.95 · 0.97 | 0.96 · 1.01 |
| dbt12_ea1141 | HTJ2K, s | 23.7 · 23.7 | 6.05 · 6.08 | 2.57 · 2.6 |
| dbt12_ea1141 | k0 | 1.04 · 1.05 | 1.05 · 1.08 | 1.06 · 1.52 |
| dbt12_ea1141 | k2 | 0.94 · 0.95 | 0.95 · 0.96 | 0.96 · 0.99 |
| dbt12_ea1141 | k3 | 0.94 · 0.94 | 0.94 · 0.95 | 0.95 · 0.97 |
| dbt10_ea1141 | HTJ2K, s | 22.3 · 22.3 | 5.71 · 5.75 | 2.44 · 2.49 |
| dbt10_ea1141 | k0 | 0.97 · 0.98 | 0.98 · 1.01 | 1.00 · 1.15 |
| dbt10_ea1141 | k2 | 0.95 · 0.95 | 0.95 · 0.96 | 0.96 · 0.99 |
| dbt10_ea1141 | k3 | 0.96 · 0.97 | 0.97 · 0.98 | 0.98 · 1.02 |
| mr9_ispy2 | HTJ2K, s | 2.31 · 2.31 | 0.7 · 0.703 | 0.463 · 0.482 |
| mr9_ispy2 | k0 | 0.93 · 0.95 | 0.94 · 0.95 | 0.98 · 1.01 |
| mr9_ispy2 | k2 | 1.03 · 1.03 | 1.03 · 1.05 | 1.05 · 1.07 |
| mr9_ispy2 | k3 | 1.01 · 1.02 | 1.02 · 1.03 | 1.04 · 1.03 |

* **12 bits: k = 3 by a hair, k = 2 within 0.02 of it.** Both are 0.94–0.97 at 1× and 0.94–1.02 at 4×; d12 (k = 0, the samples whole at 12 bits through dav1d-WASM) is 1.02–1.09, and 1.52–1.54 at 4×
  on 50 Mbit.
* **11 bits (MR): a tie.** k = 1, 2 and 3 are 0.99–1.02 of HTJ2K; k = 2 is the only arm at or under 1.00 on
  every cell but one (1.01).
* **10 bits: k = 2**, 0.95–0.99; the whole samples (k = 0, WebCodecs) 0.97–1.15.
* **9 bits: k = 0**, the samples whole at 10 bits through WebCodecs, 0.93–1.01; k = 2 and 3 are 1.01–1.07, their
  bytes (§Bytes).
