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
