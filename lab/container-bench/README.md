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

## In a container (row 195)

The shipped read path on the host (H, and H′ as its A/A control), in a bind mount (B), a named volume (V) and the
container's own layer (O), on rootless Podman: [`docs/adr/disk-access.md`](../../docs/adr/disk-access.md) §6 In a
container has the protocol, the predictions and the decision rule. Everything runs niced; builds take two cores;
timed visits are pinned to cores 2 and 3, inside `podman exec` too. The arms are [`dockerread-arms.json`](dockerread-arms.json), one entry each:
how the series is placed, the container's `podman run` options and where the reader finds it.

```bash
W=~/.cache/wt-pacs-dockerread-data P="nice -n 19 ionice -c3" Q="--cpu-period 100000 --cpu-quota 200000"
$P podman build $Q -f deploy/Containerfile --target server -t wt-pacs-server --secret id=build_ca,src=/dev/null .
$P podman build $Q -f lab/container-bench/Containerfile.dockerread --target rig -t wt-pacs-dockerread-rig .
$P podman build $Q -f lab/container-bench/Containerfile.dockerread --target data -t wt-pacs-dockerread-data .
D=lab/container-bench/dockerread.py
python3 $D data $W      # tools, fetch and HTJ2K ingest of pt15_cptac, ct_lidc, dbt12_ea1141, in the data image
python3 $D place $W     # the arms; containers wtpacs-dr-{B,V,O}, volume wtpacs-dr-V; every file's SHA-256 against H's
python3 $D check $W     # untimed: read_fast_path=, ring=, the io_uring WARN, settings and limits, into W/check.txt
sudo nice -n 19 ionice -c3 python3 -I $D folios $W before
python3 $D time $W 20   # a quiet machine: 20 rounds × 5 arms × 4 cells, into W/time.jsonl
sudo nice -n 19 ionice -c3 python3 -I $D folios $W after    # each file's folios must equal before's
```

A visit is VOID when its pinned cores were busy outside the bench for over 5 % of their time (`measure`'s
`others_busy_frac`: `/proc/stat` less the process's own CPU) or when a store that has `RWF_NOWAIT` missed in its hit
pass. `measure --pooled-ok` runs where the flag is refused (O), whose every read then goes through the pool.
