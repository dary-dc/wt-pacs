# server-load

How many concurrent fills one server core carries before it, not the links, is the clock. Queue row 81
(SERVERLOAD) of [`docs/av1/queue.md`](../../docs/av1/queue.md); the reading is in
[`docs/transport/transport-conclusions.md`](../../docs/transport/transport-conclusions.md) §6, *Many fills at once*.

```bash
lab/av1/tools.sh && lab/av1/item/build.sh                       # aomenc 3.15.1, dav1d 1.5.4, the check's decoders
PATH=$PWD/lab/av1/.venv/bin:$PATH FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160   # OpenJPH
lab/av1/fetch_data.sh dbt10_ea1141
cargo build --release -p exact-server -p pack-study -p window-harness
W=lab/.av1-work/load P=lab/av1/.venv/bin/python
$P lab/av1/item/ingest.py lab/.av1-build lab/av1/data/dbt10_ea1141 $W/htj2k --codec htj2k
$P lab/av1/item/ingest.py lab/.av1-build lab/av1/data/dbt10_ea1141 $W/av1 --representation optimized --preset good:6
for c in htj2k av1; do target/release/pack-study --metadata $W/$c/metadata.json --frames $W/$c --output $W/$c/$c.sbnd; done
python3 lab/server-load/run.py --study htj2k=$W/htj2k,htj2k --study av1=$W/av1,av1 --rounds 10 --out rows.jsonl
python3 lab/server-load/run.py --summary --out rows.jsonl
python3 lab/server-load/run.py --study htj2k=$W/htj2k,htj2k --study av1=$W/av1,av1 --sessions 1,32 --rates 0 --mutate --out mut.jsonl
```

**The study.** The 10-bit breast tomosynthesis volume (`dbt10_ea1141`, 24 × 678×1727), the largest frames
the lab has fetched: 13.6 MB as the served HTJ2K, 13.0 MB as the optimized AV1 item (libaom 3.15.1 `good:6`).

**The cell.** Each run starts one server per codec pinned to core 0, and `fill_load` pinned to cores 1–3:
N sessions, each on its own socket, connect, wait at a barrier, then each asks the whole study
(`StreamFrames {}`) at once; a session's fill is its ask to its last frame. Every frame's body is matched
byte for byte with the item ingest wrote, which ingest wrote only after decoding it back to the checksum
taken when the series was fetched. A session reads either as fast as it can (`--read-bps 0`) or at a
phone's rate, 2.5 MB/s (20 Mbit) or 6.25 MB/s (50 Mbit), by pacing its reads, so QUIC's flow control,
not a shaped link, holds the server back: no loss, no queue, loopback round trip. Server CPU is the
server's threads' `schedstat` over the fills, memory its resident set sampled every 20 ms, and host
busy the share of all four cores `/proc/stat` saw busy. Cells (codec × rate × N) run in a Williams
order per round (`lab/scripts/order.py`).

**Why not `server_ab`.** `lab/disk-access-bench`'s `server_ab` fills too, but reports asks per second
over the run, with no per-session fill time, no pacing and no byte check.
