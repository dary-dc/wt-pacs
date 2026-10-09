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
