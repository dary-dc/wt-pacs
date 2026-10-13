# container-bench

The `.sbnd` against the standard containers (queue row 160): each arm packed from the same coded frames, its own
index read at open into the server's (offset, length) table (`FrameStore::with_index`), then the shipped
`TileReader` and `FillReader`. The arms, settings, numbers and verdict are
[`docs/disk-layout/containers.md`](../../docs/disk-layout/containers.md) §Measured.

```bash
lab/av1/tools/tools.sh && ingest/coded-frames/build.sh            # aomenc, dav1d, OpenJPH (lab/scripts/gen_htj2k_fixtures.sh)
lab/av1/fetch_data.sh mr9_ispy2 pt15_cptac ct_lidc dbt12_ea1141 ffdm_b
P=lab/av1/.venv/bin/python W=/some/work
for s in mr9_ispy2 pt15_cptac ct_lidc dbt12_ea1141 ffdm_b; do      # pt15_cptac's AV1 adds --split 3
  $P ingest/coded-frames/ingest.py lab/.av1-build lab/av1/data/$s $W/coded/$s/htj2k --codec htj2k
  $P ingest/coded-frames/ingest.py lab/.av1-build lab/av1/data/$s $W/coded/$s/av1 --preset good:6
done
cargo build --release -p container-bench -p pack-series
$P lab/container-bench/run.py pack $W <sets>       # every arm, both payloads
$P lab/container-bench/run.py verify $W <sets>     # every frame through the fill reader, decoded, against the encoder's input
$P lab/container-bench/run.py trip $W <sets>       # FFmpeg and pydicom against our files, ours against theirs
$P lab/container-bench/run.py time $W 26 <sets>    # interleaved rounds (lab/scripts/order.py)
$P lab/container-bench/run.py packtime $W 8 <sets>
$P lab/container-bench/summary.py $W
```

A cold open reads through `O_DIRECT`, past the page cache without evicting it; a forced miss is the store's
`force_pool_reads`. `measure --mutate shift|short` breaks the index on purpose and must fail the exactness check.
