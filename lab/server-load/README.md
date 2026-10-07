# server-load

How many concurrent fills one server core carries before it, not the links, is the clock. Queue row 81
(SERVERLOAD) of [`docs/av1/queue.md`](../../docs/av1/queue.md); the reading is in
[`docs/transport/transport-conclusions.md`](../../docs/transport/transport-conclusions.md) §4, *Many fills at once*.

```bash
lab/av1/tools.sh && lab/av1/item/build.sh                       # aomenc 3.15.1, dav1d 1.5.4, the check's decoders
PATH=$PWD/lab/av1/.venv/bin:$PATH FRAMES=1 OUT_ROOT=/tmp/x lab/scripts/gen_htj2k_fixtures.sh g160   # OpenJPH
lab/av1/fetch_data.sh dbt10_ea1141
cargo build --release -p exact-server -p pack-study -p window-harness
W=lab/.av1-work/load P=lab/av1/.venv/bin/python
$P lab/av1/item/ingest.py lab/.av1-build lab/av1/data/dbt10_ea1141 $W/htj2k --codec htj2k
$P lab/av1/item/ingest.py lab/.av1-build lab/av1/data/dbt10_ea1141 $W/av1 --representation optimized --preset good:6
for c in htj2k av1; do target/release/pack-study --metadata $W/$c/metadata.json --frames $W/$c --output $W/$c/$c.sbnd; done
echo 4194304 > /proc/sys/net/core/rmem_default                 # the client's sockets, below
python3 lab/server-load/run.py --study htj2k=$W/htj2k,htj2k --study av1=$W/av1,av1 --rounds 10 --out rows.jsonl
for r in $(seq 0 9); do                                         # the knee, finer
  python3 lab/server-load/run.py --study htj2k=$W/htj2k,htj2k --study av1=$W/av1,av1 --rates 6250000 --sessions 48,80,96 --first-round $r --out knee.jsonl
  python3 lab/server-load/run.py --study htj2k=$W/htj2k,htj2k --study av1=$W/av1,av1 --rates 2500000 --sessions 160,192 --first-round $r --out knee.jsonl
done
python3 lab/server-load/run.py --summary --out rows.jsonl
python3 lab/server-load/run.py --study htj2k=$W/htj2k,htj2k --study av1=$W/av1,av1 --sessions 1,32 --rates 0 --mutate --out mut.jsonl
```

**The study.** The 10-bit breast tomosynthesis volume (`dbt10_ea1141`, 24 × 678×1727), frames of 1.2 M samples:
13.6 MB as the served HTJ2K, 13.0 MB as the optimized AV1 item (libaom 3.15.1 `good:6`).

**The cell.** Each cell starts a fresh server pinned to core 0 and warms it with one unrecorded fill, and `fill_load` pinned to cores 1–3:
N sessions, each on its own socket, connect, wait at a barrier, then each asks the whole study
(`StreamFrames {}`) at once; a session's fill is its ask to its last frame. Every frame's body is matched
byte for byte with the item ingest wrote, which ingest wrote only after decoding it back to the checksum
taken when the series was fetched. A session reads either as fast as it can (`--read-bps 0`) or at a
phone's rate, 2.5 MB/s (20 Mbit) or 6.25 MB/s (50 Mbit), by pacing its reads, so QUIC's flow control,
not a shaped link, holds the server back: no loss, no queue, loopback round trip. Server CPU is the
server's threads' `schedstat` over the fills, memory its resident set sampled every 20 ms, and host
busy the share of all four cores `/proc/stat` saw busy, and drops the datagrams the host's UDP sockets
refused for a full receive buffer (`/proc/net/snmp`). The client's sockets are the rig's, not a phone's:
`net.core.rmem_default` is raised to 4 MB (`echo 4194304 > /proc/sys/net/core/rmem_default`); even so
they drop datagrams from 64 sessions on, and from 192 enough to back the server off. Cells (codec × rate × N) run in a Williams
order per round (`lab/scripts/order.py`).

**Why not `server_ab`.** `lab/disk-access-bench`'s `server_ab` fills too, but reports asks per second
over the run, with no per-session fill time, no pacing and no byte check.

## Checked (2026-10-07)

640 runs, 1 012 320/1 012 320 frames byte-identical; with `--mutate` (one reference byte flipped) every
run of 1 and 32 sessions reported its frame 0 inexact. The table and the knee are in
[`transport-conclusions.md`](../../docs/transport/transport-conclusions.md) §4, *Many fills at once*.
A run with 256 sessions once stalled before its start (a session that never connected held the barrier);
`fill_load` now fails such a run, and the runner records a run with no result in 600 s as an error. None
occurred in the 640.
