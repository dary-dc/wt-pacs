# splittime — the per-depth layout rule by bytes, decode and total time

Queue row 44 (SPLITTIME) of [`docs/av1/queue.md`](../../../docs/av1/queue.md): with the split exact at
every depth and k (row 43, [`../splitok`](../splitok/README.md)), which k each depth should store, by
bytes, decode and total time against HTJ2K. The verdict is in
[`docs/av1/README.md`](../../../docs/av1/README.md) §A3 and §Total time, and as a proposal in
[`docs/av1/item-format.md`](../../../docs/av1/item-format.md).

```bash
lab/av1/tools.sh && ARMS=simd lab/av1/dav1d-wasm/build.sh      # libaom, native dav1d, dav1d-WASM
lab/decode-bench/fetch_decoder.sh                              # OpenJPH, the shipped package
PATH=lab/av1/.venv/bin:$PATH FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160  # ojph_compress
client/transport-ts/build.sh                                   # the client's session bundle
lab/av1/fetch_data.sh ct_lidc xa_dynact16 dbtproj_ge dbtproj_holo pt15_cptac mg16_cbis \
  mr_ispy1 rf_fluoro dbt12_ea1141 dbt10_ea1141 mr9_ispy2
P=lab/av1/.venv/bin/python D=lab/av1/data W=lab/.av1-work/splittime
S="$D/ct_lidc $D/xa_dynact16 $D/dbtproj_ge $D/dbtproj_holo $D/pt15_cptac $D/mg16_cbis $D/mr_ispy1 $D/rf_fluoro $D/dbt12_ea1141 $D/dbt10_ea1141 $D/mr9_ispy2"
$P lab/av1/splittime/make_frames.py lab/.av1-build $W $S --reuse lab/.av1-work/splitok/real   # cpu0 items
$P lab/av1/splittime/sweep.py lab/.av1-build $W $S --out sweep.json        # the shipped preset per k
NODE_PATH=$(npm root -g) node lab/av1/splittime/decode.mjs --rounds 12 --out decode.json
for r in $(seq 0 9); do
  NODE_PATH=$(npm root -g) node lab/av1/total/run.mjs --frames $W --rounds 1 --first-round $r --out total.jsonl
done
NODE_PATH=$(npm root -g) node lab/av1/total/run.mjs --frames $W --summary --out total.jsonl
```

**Arms**, per series of b bits after its offset, named by k so none is ambiguous, each run once
however many names it has, and only where its top fits a 12-bit stream: **HTJ2K** (the served
profile); **d12**, k = max(0, b − 12); **k = 2**, the adopted optimized rule; **k = 3**; **w10**,
k = max(0, b − 10), every stream ≤ 10 bits. Each AV1 arm is the series' items
([`item-format.md`](../../../docs/av1/item-format.md)) written by `ingest.py --split K`, libaom 3.15.1
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
