# Where a frame's microseconds go — 2026-09-05

The ADR's headline is **60 894 ns per frame** for the accepted path. Read next to a
published io_uring figure of "~3 000–6 000 ns", that looks like a factor of ten left on the
table. This decomposes the number and answers the comparison, then measures what is
actually worth removing.

**Decision:** [`adr.md`](adr.md) · **Campaign:** [`RERUN.md`](RERUN.md) · **Raw:**
[`v6_frame_budget.txt`](v6_frame_budget.txt) · [`v6_ladder_runs.txt`](v6_ladder_runs.txt) ·
[`v6_uring_ops_runs.txt`](v6_uring_ops_runs.txt) ·
[`v6_wire_send_modes.tsv`](v6_wire_send_modes.tsv) · [`v6_wire_cache.tsv`](v6_wire_cache.tsv)

**Host:** KVM guest · 4 vCPU Xeon @2.1 GHz · 16 GB RAM · ext4 on `/dev/vda` · Linux 6.18 ·
same shape as the campaign host, and quieter: it reproduces every arm at ~0.53× the
campaign's wall time (`pread_nowait_chunked` **32 274 ns** here vs 60 894 ns there;
`mmap_blocking_touch` 82 170 vs 152 295 — the 2.5× ratio the ADR turns on is unchanged).
Percentages below are what transfers between hosts; absolute nanoseconds are this host's.

```bash
cargo build -p disk-access-bench --release
./target/release/frame_budget lab/fixtures/frames_250k_live/frames_250k_live.sbnd all 1
./target/release/wire_send_bench <study> <write_all|write_chunk|cache:MB|preloaded> <frames> <repeats>
```

---

## 1. The two numbers measure different things

| | Accepted path | The quoted io_uring figure |
| --- | --- | --- |
| Unit | **one 250 000 B frame**, prep **and** the copy to the connection | **one 4 KiB I/O**, submit → complete |
| Storage | page cache — a hit, no device | NVMe with `O_DIRECT`, a device round trip |
| Bytes | 61× more | — |

Priced in the same unit as the citation, on this host, warm — p50 of 400 samples, median of
5 runs ([`v6_uring_ops_runs.txt`](v6_uring_ops_runs.txt)):

| Operation | p50 |
| --- | ---: |
| `preadv2(RWF_NOWAIT)` 4 KiB, page-cache hit | **561 ns** |
| `preadv2(RWF_NOWAIT)` 64 KiB, page-cache hit | 3 608 ns |
| io_uring `ReadFixed` 4 KiB, registered file + fixed buffer, QD1 | 852 ns |
| io_uring `ReadFixed` 64 KiB, same | 3 523 ns |
| **`O_DIRECT` 4 KiB — the device path this host actually has** | **27 543 ns** |
| `O_DIRECT` 64 KiB | 47 783 ns |

So the accepted path already reads a 4 KiB block in **561 ns — five to ten times faster
than the 3–6 µs it was being measured against** — because it does not go to a device at
all. And the device figure is not reachable here in any case: a real round trip on this
KVM/virtio-blk guest costs ~28 µs, not 3–6 µs. That number describes bare-metal NVMe with
polled `O_DIRECT`; it is a floor for a *miss*, and the warm path never takes one.

Nothing in the 60 894 ns is I/O wait. There is no device round trip in it to remove.

## 2. What the 60 894 ns is made of

Same ingredients, added one at a time, inside the product's runtime shape (tokio
multi-thread, 4 workers, one co-tenant spin monitor), 320-frame forward pass × 9, median of
5 runs ([`v6_ladder_runs.txt`](v6_ladder_runs.txt)):

| Ladder | p50 | Δ | Share |
| --- | ---: | ---: | ---: |
| A loop only — index lookup, no read, no copy | 2 121 ns | | 8% |
| B + 4 × 64 KiB `RWF_NOWAIT` reads | 14 877 ns | **+12 756** | **49%** |
| C + copy into the send buffer, 16 KiB at a time | 18 844 ns | +3 967 | 15% |
| D + a yield per 16 KiB chunk — **the accepted arm** | 25 872 ns | +7 028 | 27% |

Two thirds of the frame is memory movement — the kernel's copy out of the page cache (49%)
and the copy into the connection (15%). The rest is the scheduler: with a co-tenant
runnable, each `yield_now` hands over the core and costs ~440 ns, and the harness models
quinn as sixteen of them per frame. Row B is the steadiest of the four (14.1–15.3 µs across
runs) and row D the loosest (22.6–28.0 µs), which is the scheduler term moving, not the
reads.

The scheduler term is a harness assumption, not a product measurement. The product calls
`write_all` once per 64 KiB window — four per frame, not sixteen — and row E is that shape:
**20 403 ns, 21% under D**. Chunking to quinn's flow-control granularity is a pessimistic
model of the wire, so treat the ~27% scheduler share as an upper bound.

The read half is already at the machine's limit. Warm `preadv2` moves 250 KB at **22.4
GB/s** on this vCPU, and the window size barely matters above 64 KiB (4 × 64 KiB = 11 186
ns; 1 × 250 KB = 10 880 ns, −2.7% for four times the uninterrupted executor copy — the trade
the ADR already rejected on `gap_max`). A 16 KiB window is 13 663 ns: smaller windows cost
syscalls without buying anything. **64 KiB is the right window, and it is not close.**

**`RWF_NOWAIT` is free.** Measure each flag both first and second in its pass and they land
together: at 64 KiB, `nowait` reads 3 333 ns first / 3 490 ns second, plain `pread` 6 543 ns
first / 3 496 ns second. The 2× gap belongs to the *position*, not the flag — the first loop
over a set of offsets is colder than the second. An uncontrolled run makes whichever flag is
measured second look twice as fast, which is exactly the artifact [`RERUN.md`](RERUN.md)
§Precision warns about.

## 3. io_uring, priced per operation

On the same warm bytes, with the ring given every advantage — registered file, registered
buffer, `submit_and_wait(1)`, no eventfd, no runtime (a shape the server could not use,
because blocking in `io_uring_enter` is the executor stall this ADR exists to prevent):

| Size | io_uring ReadFixed | `preadv2(RWF_NOWAIT)` | Verdict over 5 runs |
| ---: | ---: | ---: | --- |
| 4 KiB | 852 ns | **561 ns** | preadv2 faster in **5 of 5** |
| 64 KiB | 3 523 ns | 3 608 ns | tie, signs split |
| 250 KB | 11 038 ns | 12 080 ns | tie, signs split |

The ring is measurably *slower* where per-operation overhead is visible, and a tie once the
copy dominates. Submission and completion bookkeeping is pure cost when the read completes
inline from the page cache, and a warm read always does. The campaign's verdict stands, now
with a per-op mechanism behind it rather than only an arm comparison — and note which way
the one resolvable difference points.

## 4. On the wire, the disk path is a fifth of the frame

`wire_send_bench` runs the send path over real quinn (the stack wtransport is built on) on
IPv4 loopback, with the client in a separate process so `CLOCK_PROCESS_CPUTIME_ID` is the
server's CPU alone. This is the "no live end-to-end run" limitation of
[`RERUN.md`](RERUN.md) closed for the send path.

Per 250 KB frame, product path, 5 rounds interleaved:

| | |
| --- | ---: |
| Server CPU per frame | **~675 µs** |
| Datagrams per frame | 179 |
| `sendmsg` per frame (GSO batches ~10 datagrams) | 18 |
| `preadv2` per frame | 4 |
| Path MTU | 1452 B |

Serving the same frames from memory instead — no read, no copy into the connection, which
is the most any disk-access change could ever be worth — costs **19–23% less CPU per frame**
(−18.9% and −25.5% on the sweep cell in two campaigns, −23.4% on the cine cell; same sign in
every round). So the whole disk-access decision — every arm in [`RERUN.md`](RERUN.md), the
60 µs and the 152 µs alike — moves about a fifth of what a frame costs this server. The rest
is per-datagram QUIC work: header, seal, ACK bookkeeping, 18 syscalls.

Two consequences worth stating plainly:

* **The ADR's 2.5× is still worth having.** A fifth of the frame is real CPU, and the
  neighbour and `gap_max` properties the path was chosen for do not show up in a CPU total
  at all.
* **No disk-access change can be worth more than ~20%**, and only by removing the read
  entirely. That bound is what the rest of this document is measured against.

### The per-datagram term, for the record

Raising the endpoint's `max_udp_payload_size` from the default 1472 B to 4000 B cuts
datagrams per frame from 179 to 64 and server CPU from 642 to 420 µs — **−35% CPU, +55%
throughput**, far more than anything in this campaign. It is recorded here as where the
cost actually is, **not** as a recommendation: it requires the *peer* to advertise the same
ceiling, and the peer is a browser. Above 4000 B on this host, discovery fails and the
connection falls back to a 1200 B floor, which is worse than the default.

## 5. What was tried, and what survived

### Rejected — handing quinn owned buffers instead of copying into it (−3%, not established)

`write_all(&[u8])` reaches `ByteSlice::pop_chunk` in quinn-proto, which is
`Bytes::from(data[..limit].to_owned())` — an allocation and a copy of every byte.
`write_chunk(Bytes)` reaches `BytesArray::pop_chunk`, which is `split_to`: a refcount bump.
The copy is provably removed by reading quinn's source; the question is only what it is
worth.

Reading into a pool of reclaimable `BytesMut` windows and handing those to quinn, 12 paired
rounds ([`v6_wire_send_modes.tsv`](v6_wire_send_modes.tsv)):

| | median | same sign |
| --- | ---: | ---: |
| Server CPU per frame | **−3.2%** | 9 of 12 |
| Throughput | +2.5% | 8 of 12 |

Below the ±7% run-to-run drift this campaign requires a difference to beat, and it does not
reproduce cleanly. The mechanism is real but small because the copy is L2-resident: 250 KB
memcpy out of a ~675 µs frame is under 1%. Against that it costs `unsafe { set_len }` on
recycled buffers and replaces the ADR's fixed 64 KiB-per-session bound with "however many
windows are unacked". **Not landed.** A copy you can prove exists is still not worth
removing if you cannot measure it.

### Landed — a bounded process-private frame cache (−20% CPU on a cine loop)

The one thing that reaches that bound is not reading the frame again. `FrameCache`
(`server/src/media/frame_cache.rs`, `--frame-cache-mb`, **default 0 = off**):

* A hit is a refcount bump handed to quinn with `write_chunk` — **no syscall, no copy into
  the connection, no pool hop**, and the bytes are process-private, which is the guarantee
  the ADR streams windows to obtain. It is strictly less work than any arm in the campaign.
* Admission is on the **second** ask, so one linear pass over a study larger than the budget
  never populates it.
* The admitting ask assembles the frame from the windows it is already streaming — one
  extra copy, no extra read, no background task, and the copy stays inside the 64 KiB
  window loop, so the executor's uninterrupted copy is still bounded.
* Eviction is LRU against a byte budget, and evicted allocations are recycled
  (`Bytes::try_into_mut`) so a churning cache does not pay a minor fault per page on every
  admission.

Measured over real quinn, 5 rounds interleaved ([`v6_wire_cache.tsv`](v6_wire_cache.tsv)):

| Cell | Arm | Hit rate | Server CPU/frame | Δ | Throughput | Same sign |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| **Cine loop** — 40 frames (10 MB) × 24 passes | `write_all` (today) | — | 676 µs | | 429 MB/s | |
| | **`--frame-cache-mb 32`** | 0.92 | **539 µs** | **−20.2%** | **492 MB/s (+14.7%)** | **5/5** |
| | preloaded *(ceiling, not shippable)* | 1.00 | 518 µs | −23.4% | 502 MB/s (+17.2%) | 5/5 |
| **Linear sweep** — the whole 80 MB study × 3 | `write_all` (today) | — | 708 µs | | 419 MB/s | |
| | `--frame-cache-mb 20` (working set 4× budget) | 0.00 | 738 µs | +4.2% | 408 MB/s | 1/5 |
| | `--frame-cache-mb 96` (everything fits) | 0.33 | 724 µs | +2.3% | 418 MB/s | 2/5 |

The cine cell is the PACS viewing pattern — the traces in `lab/traces/` are scrubs and
reversals over a few dozen frames — and there the cache is within 3 points of the
theoretical ceiling. The sweep cell is the honest cost: admission is one extra copy of the
frame, so a workload that never re-asks a cached frame pays ~4% and gets nothing.

**The rule this gives an operator:** a cached frame has to be asked at least once more to
break even. Size `--frame-cache-mb` to the *working set* being scrubbed, not to the study.
At zero it is a `HashMap` lookup that always misses, which is why the default is zero.

Server-side per-frame work on a hit is **~570 ns** — below the 3–6 µs the whole question
started from, for an entire 250 KB frame rather than a 4 KiB block. The way under a
microsecond was never a faster I/O engine; it was not doing I/O.

## 6. Limitations

* **Loopback is not a network.** `wire_send_bench` has no propagation delay and no loss, so
  its CPU and throughput numbers are a sender-side cost model, not a delivery model. The
  per-frame p50 it reports is the server's time to hand a frame to the connection; where
  flow control backs up, that lands in p90/p99 instead.
* **Client and server share four cores**, so throughput is a floor, and CPU comparisons
  hold only within a round — which is why every table above is paired and interleaved.
* **CPU per frame is a process total**, including quinn's driver and ACK processing. It
  cannot be split into "our code" and "quinn's" without a profiler this host does not have.
* **The cache's cells are two workloads, not a distribution.** A real ask trace from
  `lab/traces/` driven over the wire would refine the break-even rule; the mechanism (one
  copy in, one read saved per hit) is what generalises, not the 20%.
* The frame-budget ladder attributes cost by subtraction, so anything that changes when two
  ingredients meet — cache pressure, prefetcher behaviour — lands in whichever row is
  added second.
