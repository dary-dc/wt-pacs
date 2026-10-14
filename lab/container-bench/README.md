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

## The writer (row 172)

The same `.sbnd` bytes written eight ways on four filesystems, folios counted from `/proc/kpageflags`, then the
shipped readers timed as above: [`docs/disk-layout/README.md`](../../docs/disk-layout/README.md) §The writer, §Measured.
Root is needed for the loop mounts and `/proc/kpageflags`; `mkfs.xfs` is xfsprogs 6.6.0-1ubuntu2.1.

```bash
$P lab/container-bench/writer.py mount $W                  # loop ext4, ext4 data=journal, XFS under W/fs
$P lab/container-bench/writer.py syscalls $W pt15_cptac htj2k   # the lab writer at 8 KiB issues pack-series' writes
$P lab/container-bench/writer.py make $W                   # every arm, its folios, extents and SHA-256
$P lab/container-bench/writer.py verify $W                 # every arm's frames decoded against ingest's digests
$P lab/container-bench/writer.py time $W 16
$P lab/container-bench/writer.py packtime $W 16
$P lab/container-bench/writer.py recount $W                # folios unchanged since make
python3 lab/container-bench/writer_summary.py $W
```

`writer_bench folios --mutate` reads compound heads as plain pages and must fail the folio layout check.

## The fill's read-ahead (row 197)

Five read-aheads on the shipped `FillReader` (its `with_read_ahead`) and `TileReader`, each round on fresh `O_DIRECT`
copies, one fill or four: [`docs/adr/disk-access.md`](../../docs/adr/disk-access.md) §Protocol for row 197 and its
measurement. Root is needed as for row 172; `mkfs.xfs` is xfsprogs 6.6.0-1ubuntu2.1.

```bash
lab/av1/fetch_data.sh ct_lidc dbt12_ea1141 ffdm_d pt15_cptac   # then ingest each set's htj2k as above
cargo build --release -p container-bench -p pack-series
$P lab/container-bench/readahead.py mount $W     # loop ext4, ext4 data=journal, XFS, XFS -b size=65536
$P lab/container-bench/readahead.py make $W
$P lab/container-bench/readahead.py verify $W    # every arm's frames decoded against ingest's digests
$P lab/container-bench/readahead.py mutate $W    # --mutate shift|short must fail every arm
$P lab/container-bench/readahead.py time $W 16
python3 lab/container-bench/readahead_summary.py $W
```

`cargo test -p container-bench --bin readahead_bench` checks W1's 2 MiB blocks against the fill's own advice.
