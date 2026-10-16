# disk-access-bench

The server's read path, variant against variant: how a frame's bytes leave the series file (the shipped
`FillReader` and `TileReader`, and every candidate and rejected variant beside them), cold and warm, by depth,
readers and frame size. The bins: `read_campaign` (the read-path campaign, one factor per axis),
`server_ab` (an A/B client against the product server), `ring_scale` (what a ring per session costs at
thousands of sessions), `evict` (whole-file eviction, asserted), and `disk-access-bench` (the first campaign: mmap, pread,
`madvise`). The decision, every reading and the rule each number obeys are
[`docs/adr/disk-access.md`](../../docs/adr/disk-access.md); how to re-run them is its §12, *Re-running the
evidence*:

```bash
NAME=frames_250k_big BYTES=250000 FRAMES=2048 ./lab/scripts/gen_live_cell_fixture.sh
cargo build -p disk-access-bench -p check-fastpath --release
lab/scripts/read_path_ab.sh <base-commit>   # FillReader / TileReader
lab/scripts/server_ab.sh <base-commit>      # the product server
target/release/ring_scale <series.sbnd> <count>
```

A cold cell needs a fixture larger than the host's cache and a stride past `read_ahead_kb`; where every read
must miss, use the server's `--force-pool-reads`, not eviction (§12). `tokio_fs` reads through tokio's io_uring driver
(`tokio_fs_uring`) only with `--features tokio-uring` and `RUSTFLAGS="--cfg tokio_unstable"`. The gate compiles it (`scripts/gate.sh`).

## The frame cache against the server as it ships (rows 209, 256)

B0, B0′, B1 (`series-server --features lab-frame-cache`: `src/frame_cache.rs` in front of both readers, budget
`LAB_FRAME_CACHE_BYTES`, admission on a second ask), B1s (B1's binary under `LAB_FRAME_CACHE_ADMIT=session`: admission on
a second *session's* ask) and B1z (B1 with `--features lab-fit-zeroed`), a fresh server process per arm, cell and round,
each session filling the series three times over its one connection (`server_ab --passes 3`):
[`docs/adr/disk-access.md`](../../docs/adr/disk-access.md) §13, *Row 256*. Row 209 ran B2 and two passes, each its own
connection: the script at its commit. `server_ab --coded DIR` checks every frame received against its coded file's
XXH3-64; `LAB_FRAME_CACHE_MUTATE=stale` must fail it wherever the cache holds an entry.

```bash
P=lab/av1/.venv/bin/python
OUT=W/data lab/av1/fetch_data.sh pt15_cptac ct_lidc dbt12_ea1141
for s in pt15_cptac ct_lidc dbt12_ea1141; do $P ingest/coded-frames/ingest.py lab/.av1-build W/data/$s W/coded/$s/htj2k --codec htj2k; done
cargo build --release -p series-server --features lab-frame-cache,lab-fit-zeroed && cp target/release/series-server W/bin/b1z
cargo build --release -p series-server --features lab-frame-cache && cp target/release/series-server W/bin/b1
cargo build --release -p series-server -p disk-access-bench -p pack-series && cp target/release/series-server W/bin/b0
$P lab/disk-access-bench/frame_cache_ab.py make W           # the .sbnd of each set, and the synthetic 3 MB series
$P lab/disk-access-bench/frame_cache_ab.py verify W         # W/data/SET is the fetched set, for the decode
$P lab/disk-access-bench/frame_cache_ab.py mutate W
$P lab/disk-access-bench/frame_cache_ab.py time W 16
$P lab/disk-access-bench/frame_cache_ab.py summary W/frame_cache.jsonl
```
