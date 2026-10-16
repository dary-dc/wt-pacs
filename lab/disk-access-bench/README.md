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
must miss, use the server's `--force-pool-reads`, not eviction (§12); a real miss without eviction is a copy written
past the cache, `read_campaign --fresh DIR` per cold cell. `tokio_fs` reads through tokio's io_uring driver
(`tokio_fs_uring`) only with `--features tokio-uring` and `RUSTFLAGS="--cfg tokio_unstable"`. The gate compiles it (`scripts/gate.sh`).

## The frame cache against the server as it ships (row 209)

B0, B0′, B1 (`series-server --features lab-frame-cache`: `src/frame_cache.rs` in front of both readers, budget
`LAB_FRAME_CACHE_BYTES`) and B2 (`GLIBC_TUNABLES=glibc.malloc.hugetlb=1`), two fills per fresh server process:
[`docs/adr/disk-access.md`](../../docs/adr/disk-access.md) §13, *Measured (row 209)*. `server_ab --coded DIR` checks
every frame received against its coded file's XXH3-64; `LAB_FRAME_CACHE_MUTATE=stale` must fail it.

```bash
lab/av1/fetch_data.sh pt15_cptac ct_lidc dbt12_ea1141     # then ingest each set's htj2k into W/coded/SET/htj2k
cargo build --release -p series-server --features lab-frame-cache && cp target/release/series-server W/bin/b1
cargo build --release -p series-server -p disk-access-bench -p pack-series && cp target/release/series-server W/bin/b0
P=lab/av1/.venv/bin/python
$P lab/disk-access-bench/frame_cache_ab.py make W           # the .sbnd of each set, and the synthetic 3 MB series
$P lab/disk-access-bench/frame_cache_ab.py verify W         # W/data/SET is the fetched set, for the decode
$P lab/disk-access-bench/frame_cache_ab.py mutate W
$P lab/disk-access-bench/frame_cache_ab.py time W 16
$P lab/disk-access-bench/frame_cache_ab.py summary W/frame_cache.jsonl
```


## Idle sessions' buffers (row 255)

R0 (the base), R0′, R1 (a reader holds a buffer only while it holds a frame), and R0m / R1m under
`MALLOC_MMAP_THRESHOLD_=1048576`: two release builds of `series-server`, the base's `read_path.rs` and this
branch's. `server_ab --mode idle` opens 64 sessions in turn, each a depth-4 batch of tiles and a fill, holds them
all open asking nothing, then reads the server's RSS: [`docs/adr/disk-access.md`](../../docs/adr/disk-access.md)
§9, *Idle sessions' buffers (row 255)*.

```bash
lab/av1/fetch_data.sh ct_lidc dbt12_ea1141 ffdm_d          # then ingest each set's htj2k into W/coded/SET/htj2k
git show <base>:server/src/media/read_path.rs > server/src/media/read_path.rs
cargo build --release -p series-server && cp target/release/series-server W/bin/r0 && git checkout server/src/media/read_path.rs
cargo build --release -p series-server -p disk-access-bench -p pack-series && cp target/release/series-server W/bin/r1
$P lab/disk-access-bench/idle_buffers_ab.py make W
$P lab/disk-access-bench/idle_buffers_ab.py time W 16
$P lab/disk-access-bench/idle_buffers_ab.py summary W/idle_buffers.jsonl
```
