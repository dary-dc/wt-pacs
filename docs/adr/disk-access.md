# ADR: how the server reads SBND frame bytes

**Status:** Accepted · current as of **2026-09-23** · supersedes the 2026-08-31 always-touch
decision (provenance at the end)

The one document for the read path. §1 the decision; §2 what shaped it, with the numbers safe
to quote and the claims retracted; §3 its history; §4 consequences; §5 every candidate; §6
deployment; §7–9 invariants, levers outside it, what is open; §10 the code as built; §11 the
evidence; §12 how to re-run it; §13 what could be faster, in theory (row 198). The file it reads is laid out in [`../disk-layout/README.md`](../disk-layout/README.md),
and its draft successor in [`../disk-layout/target.md`](../disk-layout/target.md).

## 1 · The decision, as it ships

**Two readers, chosen by what the session is doing.** A fill knows the next frame; a tile
ask does not. That difference picks the escalation.

1. **A page-cache hit is served inline.** The whole frame is probed with
   `preadv2(RWF_NOWAIT)` on the executor thread. It returns short instead of waiting on the
   disk, so a cold frame can never park a worker, and a warm ask takes no thread hop at all.
2. **A fill (`FillReader`) stays on the pool, and tells the kernel what comes next.** Two
   buffers, the next frame named (`Next::Fill`'s `after`), one `spawn_blocking` + `pread` for a
   miss. No ring, no extra fd. `peak_in_flight` is 1. The device's queue depth comes from
   `posix_fadvise(WILLNEED)` over `FILL_WINDOW` (4 MiB) past the named frame, issued a
   quarter window at a time — since 2026-09-10, because the kernel's own read-ahead only
   makes a sequential walk a hit walk when its window exceeds the frame (§2, retracted).
3. **A tile miss goes to a ring built on that session's first miss.** `TileReader` holds
   `slots` frames (default `TILE_SLOTS = 4`; a constructor argument, so a campaign can sweep
   depth). io_uring through the `io-uring` crate: registered file, unregistered buffers, one
   slot per named frame, completions awaited through tokio's `AsyncFd`. The ring reads **the
   rest of the frame** in one round trip. A tile session whose reads all hit never builds a
   ring. A fill session never builds one at all.
4. **The fallback is `spawn_blocking` + `pread`.** Where the filesystem refuses
   `RWF_NOWAIT` (overlayfs, tmpfs) or the kernel refuses a ring (limits), tiles take one
   pooled read per frame. Same guarantee, one hop per ask. A fill is already on this path.

**And the read path is told what is coming.** On-demand names up to `slots − 1` upcoming
frames; a fill names one. The tile read-ahead probes `RWF_NOWAIT` first and submits only the
shortfall. Each `RequestFrame` is one `Command::Frame`, fed by an ask-reader task into a planner
(`RequestFrames`, which the server split into one per index, left the wire on 2026-10-03). The reader returns a whole
frame, and **the frame goes to quinn whole**: its buffer comes from `media/frame_pool.rs`, is
handed off as `Bytes`, and returns to the pool when quinn drops it after acknowledgement
(since 2026-09-23; before, `READ_WINDOW` = 64 KiB chunked the write and a second copy fed quinn).

What is *not* done: no memory mapping anywhere in `server/`; no `mincore` gate; no `SQPOLL`,
no registered buffers, no cursor reads.

| | |
| --- | --- |
| Where | `server/src/media/read_path.rs` (`FillReader`, `TileReader`), `uring_reader.rs` (thin ring), `frame_pool.rs` (the hand-off), `transport/planner.rs` (the loop), `transport/link.rs` (the write) |
| Flag | `WTPACS_READ_PATH` = `auto` (default) · `pool` (kill switch, tiles). The `uring` lab lever (every tile through the ring) was removed 2026-10-03; code: `git show archive/arms-2026-10-03:server/src/media/read_path.rs` |
| Feature | `uring`, on by default; the pool path is `--no-default-features` |
| Reports | `read_fast_path=` in the startup banner, WARN when it is the pool; `session reads hits=… misses=… miss_rate=… named=… in_flight=… ring=…` per session, default build, with fill/tile hits split (§10) |

**Guarantee.** The bytes quinn puts on the wire are process-private — copied once into a
session-owned buffer — so reclaim cannot take them back mid-write. This was the previous
ADR's escape hatch; here it is the default and costs no extra hop.

## 2 · What shaped it

### The workload and the weights

Set with the owners on 2026-09-08. **Latency first; simplicity and clean code valued;
thousands of sessions at depth 4 or more; series far larger than RAM**, so misses are the
common case, not the exception; **cloud for sure, Docker possibly, not decided**. Two use
cases with opposite access shapes: a tile viewport asks for scattered frames out of order;
streaming pushes a series start to end.

### The constraints that ruled options out before any measurement

* **Tokio's multi-thread runtime.** `wtransport` runs on `quinn::TokioRuntime`. Anything that
  brings its own runtime is a transport rewrite, not a read-path change.
* **Never block a worker.** A major page fault is not an `.await`; it freezes every task on
  that OS thread. Measured on mmap: `gap_max` 1.5–4.2 ms cold, 7.7 ms under pressure.
* **Positional reads, one fd per series.** Tiles read `(offset, len)` out of order. A cursor
  API needs one open file per session and cannot express reads in flight.
* **The page cache is shared** across every session on one series. `O_DIRECT` would throw
  that away.
* **`RWF_NOWAIT` is filesystem-conditional.** Honoured on ext4, xfs, btrfs; refused on
  overlayfs and tmpfs. Measured, not assumed — §6.

### Numbers that are safe to quote

Paired inside each cell under the campaign's rule: a difference counts only if the median
beats the resolution threshold **and** the signs agree on ≥ 80 % of cells. Everything else is
a **tie**, which is a real answer.

| Comparison | Result |
| --- | --- |
| Shipped reader vs the lab variant it implements (`product` vs `hybrid_lazyring`) | **tie** on p50, p99 and CPU at every depth and reader count, two hosts |
| Shipped reader vs the pool it replaced, 16 KiB misses | **−45.4 % CPU per ask, RESOLVED** |
| Ring-on-the-miss vs pool, misses, depth 1 / 4 / 16 | **−56 / −70 / −75 %**, RESOLVED |
| Every-read-through-the-ring vs ring-on-the-miss | misses tie; hits **+164.8 % CPU per ask at depth 1, RESOLVED** (`--monitors 0`) — why a hit must never touch a ring. The depth-scaled latency figures this row used to carry are retracted: §11, *Correction* |
| Warm, vs the 2026-08-31 always-touch path | **60.9 µs vs 152.3 µs per frame (2.5×)**; neighbours' p99 166 vs 702 µs |
| A miss reading the rest of the frame vs the rest of the window, 100 % misses | **2.1× at one reader, 3.0–3.2× at 8–32** |
| OS threads | ring readers **5** (sandbox) / 9 (workstation), flat to 256 in flight; pool 125–135 at 64 readers, capped at 512 by tokio |
| Per session that misses | **1 fd** (2 until row 250 dropped the eventfd, 2026-10-16: §9 #7), 8.7 KiB, 15.6 µs to build the ring (timed with the eventfd); the second slot did not change the cost |
| Read ahead by one, cold 16 KiB at 99.6 % misses, one session (`v36`) | **+73.8 % asks/s, 12/12, RESOLVED**, p50 −53.4 %; **warm a tie** — the load-bearing row; 16 missing tiles 1.14 → 0.62 ms |
| The depth ladder on the shipped path (`v35`) | 1 → 2 is **+67.4 %** and collects 62 % of what depth 16 offers; from the medians 2 → 4 adds +37 %, 4 → 16 +28 % |
| Where the hosts stop separating the variants | ~64 reads in flight: the sandbox on CPU, the workstation on the device (~840 MB/s at 0.42 of 8 cores). **Past it every variant ties by construction** |
| Sequential streaming, 16 KiB, 8–64 sessions (`x15`) | shipped reader, pool and ring-on-miss **tie at ~3 µs per read**; `tokio::fs::File` 48–223 µs; the same on tokio's io_uring driver 141 µs–2.1 ms |
| A cold 250 kB fill at the stock 128 KiB `read_ahead_kb` (2026-09-10) | **59–66 % misses at one read in flight** before `FILL_WINDOW`; **0.7–1.1 %** after, 3/3; where read-ahead is 8 MB the 3.8 ms p99 bursts go (−62 %, +5.6 % 3/3); warm a tie at both frame sizes. §11, *Fill against on-demand* |

### Claims that were made along the way and then measured to be wrong

| Retracted | What is true |
| --- | --- |
| "`uring` has the better p99 at depth 4" | a 4-vCPU sandbox artefact; on the workstation misses tie at every depth |
| "`uring` is 47–61 % worse on latency" | a one-reader p50; does not survive crossing depth with readers |
| "throughput confirms the latency result" | throughput is depth ÷ latency; quoting both counts one measurement twice |
| "`reject-server-ordering.md` fixes the loop at depth 1" | it rejects *reordering*, not concurrency; pipelining reads keeps FIFO delivery |
| "ring construction costs 82 µs" | that is 1 000 rings at once; one ring is 15.6 µs |
| "the ring's per-miss latency win carries to production" | on cloud block storage a miss is device-bound; the ring's claim there is threads and CPU per miss, and P0 (§6) tests it |
| "depth 4 and 16 differ by far less than 1 and 4" | not in throughput: in `v32` 1 → 4 is ×1.90 and 4 → 16 ×1.52. The case for building depth 2 first is `v35`, where 2 alone collects 62 % |
| "`v36`'s 250 KB cold cell shows no win for read-ahead" | it reached only 4.7 % misses, so it shows no regression, not no win |
| "a sequential walk is read-ahead's best case (~one miss in sixty)" | only while the kernel's window exceeds the frame. At 250 kB frames and the stock 128 KiB `read_ahead_kb` a cold fill missed six frames in ten with one read in flight — slower than on-demand at depth 4 on any device with real latency. The fill now advises its own window (§1.2) |

## 3 · How the decision evolved

| Date | Decision | What changed it |
| --- | --- | --- |
| 2026-08-31 | mmap, pages pre-touched on the blocking pool every ask | overturned: its harness ran a current-thread runtime while the product is multi-thread (a hop costs 40 µs there, 103 µs here); its neighbour cell never let neighbours pay the hop; `RWF_NOWAIT` was never in its table |
| 2026-09-04 | `RWF_NOWAIT` inline, `spawn_blocking` for the shortfall | 2.5× warm against always-touch; io_uring a tie — at the ~0 % miss rate those cells fixed |
| 2026-09-06 | the ring on the miss, built on the first miss | the read-path campaign, four hosts, six runs: **−42 to −73 % CPU per miss, RESOLVED everywhere**. Inert on warm workloads by construction, so it did not wait on the layout that decides the miss rate |
| 2026-09-07 | a miss reads the rest of the frame | on a fixture where a miss is a real device read, windowing the escalation cost 2–3 round trips per 250 KB frame and stopped scaling at ~1 600 f/s where whole-frame variants reach ~5 000 |
| 2026-09-08 | keep driving `io-uring` directly; **validate on the production target before any further backend change**; **read ahead by one built** for batches; **the server reports its own miss rate** | backend research found no standard alternative (§5); the owners' weights and the container traps (§6) mean the ring's margin has to be shown on the target, not a laptop (`x14`, `x15`); read-ahead measured +73.8 % on missing tiles and a tie warm (`v36`); every threshold in this file is a miss rate, and the server could not report one |
| 2026-09-10 | **two readers**: a fill on the pool, tiles on the ring; the probe is the whole frame; look-ahead is depth | the capped 64 KiB probe was the whole of a +37–97 % penalty at frames past 64 KiB (§11, *Line 221*); a fill built a ring to serve one miss in sixty (§11, *Fill at scale*) |
| 2026-09-10 | **the fill advises the kernel `FILL_WINDOW` past the named frame**, a quarter window at a time | a fill reported slower than on-demand; measured cold at the stock read-ahead: 60 % misses at one read in flight, against depth 4 on demand. `WILLNEED` takes it to ~1 % with no thread and no ring and removes the 8 MB read-ahead's burst tail; per frame the syscall cost −8.7 % at 16 KiB, per quarter window nothing |
| 2026-09-23 | **the frame is handed to quinn whole** over pooled buffers; a tile jump takes a slot with no read in flight | the 2026-09 owned-buffer rejection was the fresh 64 KiB allocation, not the hand-off (§5); a jump's wanted read queued behind an abandoned one |

## 4 · Consequences

| | |
| --- | --- |
| **Good** | Warm asks take no pool hop; a miss costs one round trip; OS threads stay flat at any session count; the reclaim guarantee holds; one copy per frame (page cache → buffer), the buffer handed to quinn and reused |
| **Good** | The decision is per session and automatic: a session that never misses never pays for the ring, and the kill switch is a flag, not a rebuild |
| **Cost** | ~800 lines of custom code with tests and 8 `unsafe` sites (*corrected 2026-10-16, row 250*: counted then, 6 `unsafe` blocks and one `unsafe fn` in `media/`, after the eventfd's three went), on top of the `io-uring` crate — maintained, and tokio's own dependency. The glue is ours; the ring is not |
| **Cost** | 1 fd (2 until row 250, §9 #7) and 8.7 KiB per session that misses, the latter charged against `RLIMIT_MEMLOCK` (§6) |
| **Cost** | Buffers are frame-sized and live until quinn acknowledges the frame; the pool keeps at most 64 spare. Per-session RSS was +39 to +49 KiB against the double-buffer server (§11), measured before the pooled hand-off and not since |
| **Conditional** | The win is on misses. On local NVMe the ring is 56–75 % of a miss; on cloud block storage a miss is device-bound and the ring's margin is threads and CPU per miss, not latency. That is the one thing P0 exists to measure |
| **Conditional** | Where `RWF_NOWAIT` is refused or a ring is refused, the session runs the pool. The server says which path it took, in the startup banner and per session; deployment (§6) is still part of the decision |
| **Scale** | This decision moves about a fifth of a frame's server CPU; per-datagram QUIC work is the rest (§8). Tiles serve at **`TILE_SLOTS` = 4**; fill names one frame ahead and never builds a ring. The loop is a planner over a channel of `Ask`. Depth 2 → 4 was +37 % on the sandbox host |
| **Risk** | The hit rate is access-shape-conditional. Whole frames in order let read-ahead run ahead of the loop; serving a codestream *prefix* per frame strides the file and misses 319 of 320 cold. The fix is the packer, not the reader |

## 5 · Every candidate, one table

Scored on the owners' three criteria. **Latency** is p50 on the regime named; **scale** is what
the option costs at thousands of sessions with several reads in flight — OS threads, fds,
CPU per miss; **simplicity** is code owned and risk carried. Numbers are measured unless a row
says otherwise; "tie" is the rule of §11. Serves: **T** tiles (positional, out of order),
**S** sequential streaming, **B** both.

**Re-measured 2026-09-09 on the code that ships**: the fast path, "a hit must never touch a
ring" and mmap's co-tenant freeze all reproduce; the ring against the pool on misses is
depth- *and* size-dependent, which is why that row says *conditional* and P0 runs both sizes.

| Candidate | Serves | Latency | Scale: threads · fds · CPU per miss | Simplicity · risk | Verdict |
| --- | --- | --- | --- | --- | --- |
| **`RWF_NOWAIT` inline for hits** | B | warm 48 µs/frame, 2.5× vs always-touch; no hop on a hit (measured with 64 KiB windows; the whole frame since 2026-09-10) | no thread per hit; 0 fds | one `preadv2` call; filesystem-conditional (§6) | **Accepted** |
| **Ring per session, built on the first miss, whole rest of the frame** | T | **host-dependent, and P0's question.** Sandbox: misses −56 / −70 / −75 % CPU vs pool at depth 1 / 4 / 16. Workstation: a **tie at depth 1**, where the pool was the cheaper of the two (311 vs 326 µs CPU/ask). Agent container: the pool is **+106 to +138 % CPU, 6/6 RESOLVED**. Three hosts, three answers | **5 threads flat** to 256 in flight; 1 fd + 8.7 KiB per missing session (2 fds until row 250, §9 #7); 15.6 µs to build | ~800 lines with tests, 8 `unsafe` (6 and an `unsafe fn` since row 250, §4), on a maintained crate; container traps (§6) | **Accepted for tiles** — conditional on P0 |
| **`TileReader` — probe, ring on the first miss, `slots` frames named** | T | beats every pool variant **RESOLVED on wall *and* CPU** at 16 KiB cold, ties every ring variant, and is 1st of eleven at 250 kB; **+73.8 % asks/s** on missing tiles at depth 2, warm a tie; 16 tiles 1.14 → 0.62 ms | 5 threads; 1 fd + 8.7 KiB per session that misses (2 fds until row 250, §9 #7); `slots` defaults to 4 | one slot table, no mode machine | **Accepted** |
| **`FillReader` — probe, pool on the miss, one frame named** | S | ties every serious variant on a cold sweep at both frame sizes; `peak_in_flight` is **1 by construction**, which is what bounds its threads | 6 threads; **0 rings, 0 fds, 0 memlock** — no ~941-session ceiling | two buffers, no slot table, no `unsafe` | **Accepted** |
| **Read ahead (`TILE_SLOTS` / a fill's one ahead)** | B | tiles name up to `slots − 1`, a fill names one; look-ahead **is** depth 2, not a separate effect (§11) | four tile slots / two fill buffers | `slots` is a constructor argument, so a campaign sweeps depth | **Accepted** |
| **`WILLNEED` window ahead of a fill (`FILL_WINDOW`)** | S | misses **60 % → ~1 %** at the stock read-ahead, 3/3; p99 −62 % where read-ahead is 8 MB; warm a tie once per quarter window (per frame it cost −8.7 % at 16 KiB) | one syscall per MiB walked; no thread, no fd, no buffer | ~15 lines, one test | **Accepted** 2026-09-10 |
| **Whole frame handed to quinn over pooled buffers** (`media/frame_pool.rs`) | B | **−3 to −8 % CPU per ask in every cell, 5–6/6** | no allocation per frame once the pool is warm | one module, no `unsafe` | **Accepted** 2026-09-23 — [`transport-conclusions.md`](../transport/transport-conclusions.md) |
| `write_chunk` owned windows to quinn | B | −3.2 % at one session; **+14.6 / +19.1 % at 16 / 32**, RESOLVED | a fresh 64 KiB allocation per window | — | Rejected as built. **Corrected 2026-09-23:** the allocation was the cost, not the hand-off — the row above |
| `spawn_blocking` + `pread` for the miss | B | identical on hits; on 16 KiB misses the shipped reader is −45.4 % CPU against it, and its tail widens with depth | **125–135 threads at 64 readers, 512 cap** (517 seen at 64 × 16); 0 fds | the simplest correct reader; zero `unsafe` beyond `preadv2` | **Kept as fallback**; ships if P0 ties |
| Probe capped at 64 KiB, then escalate | B | **+37 to +97 % wall at 128 KiB and 250 kB, RESOLVED**; a tie where the probe covers the frame | — | — | **Removed 2026-09-10** — §11, *Line 221* |
| Escalate only the rest of the window | B | 2–3 device round trips per 250 KB frame: 1 404–1 573 f/s vs 4 539–4 777 | flat at ~1 600 f/s from 8 to 32 readers | — | Superseded 2026-09-07 |
| Every read through the ring (`uring`) | B | hits **+165 % CPU at depth 1, RESOLVED** (§11, *Correction*); above depth 1 a 16 KiB tie on throughput, ~+30 % at 250 kB; streams +143–190 % at 8–64 sessions; misses tie | 5 threads; lowest CPU per miss | one path, but a hit must never touch a ring | Rejected as default; kept as a lab flag, then removed 2026-10-03 (§1, *Flag*) (*corrected in place, row DOCSTRUE, 2026-10-14*: this cell still said "kept") |
| Ring pipelining (read *n+1* during write *n*) | T | ~6 % on a 100 %-miss trace, −25 % warm | 2× session memory | — | Rejected |
| Fill: start the named read inside the current miss's wait, sliding `WILLNEED` | S | 250 kB cold p50 −68.9 % (12/12) but **wall a tie and p99 worse**; 16 KiB cold wall a resolved loss. A 2026-09-10 branch, never merged, not re-measured | — | — | Not taken: `FILL_WINDOW` had landed |
| `SQPOLL` | B | worse warm on every column; cold tail unresolved | **2.8× CPU** | a kernel thread **per session**, and `COOP_TASKRUN` is refused alongside it | **Rejected, closed** — structural |
| Registered buffers | B | no change | memlock per buffer | more `unsafe` | Rejected — measured unnecessary |
| Ahead-N `POSIX_FADV_WILLNEED` for tiles | T | **4.6–4.9×** on a cold strided read; a loss on a sweep | one syscall | a routed choice waiting on a layout design | Measured, not landed |
| Park on the ring fd instead of an eventfd (`x14`) | B | tie on CPU and latency everywhere | **1 fd per session instead of 2**; one syscall fewer per park | ~26 lines fewer, 3 `unsafe` blocks fewer; same mechanism tokio uses (*corrected 2026-10-15, row 244*: this said ~30 and 2; a sketch of the product file counts 26 and 3; built, 27 and 3) | **Built 2026-10-16** (row 250): a tie on p50 and CPU in both cold cells, re-measured interleaved; 1 fd per missing session, counted (§9 #7). *Was:* proposed, after P0 |
| One shared ring per runtime (tokio's shape) | B | **1.36–1.45× slower** than a ring per thread on concurrent positional reads (tokio #8367); reproduced on streams | 0 per-session fds; one lock across every session | a dispatcher and a waker slab | Not now |
| Whole-frame `RWF_NOWAIT`, one read (2026-09-06) | B | best miss throughput of any variant | — | 250 KB uninterrupted executor copy: **4.0 ms** warm `gap_max` | Rejected then. **Corrected 2026-09-10:** the shipped readers probe the whole frame (§3); its co-tenant gap has **not been re-measured** since |
| Larger window (128 / 256 KiB) | B | −12–25 % warm throughput | — | wider executor copy | Rejected; moot since the whole-frame probe |
| mmap, any variant | B | naive: faults freeze co-tenants, `gap_max` 1.5–4.2 ms, 7.7 ms under pressure. `mincore` gate: unsafe under pressure 5/5 — residency is not a lease. Always-touch on the pool (2026-08-31): 103 µs/frame, 702 µs neighbour p99. Touch via `block_in_place`: 38 µs, worst neighbour p99 (2.1 ms). `madvise(POPULATE_READ)`: within noise of the touch loop | a thread per ask where the fault is made safe | no copy, no safety — or safe and slow | Rejected (§11) |
| `tokio-uring` 0.5.0 · `glommio` · `monoio` · `compio` | T | — | — | own current-thread or thread-per-core runtime | Rejected — transport rewrite |
| tokio's own io_uring driver | S (no positional read) | one session 6 µs; **2.1 ms per 16 KiB at 64 sessions**, ⅓ of the device; executor gaps 10× any other variant | one locked ring per runtime; one fd per session | `--cfg tokio_unstable` in a medical build | Rejected — measured |
| `tokio::fs::File`, plain | S | **48–223 µs per 16 KiB** vs 3 (a thread hop and a copy per read); +514 % wall, +1872 % CPU against `FillReader` | threads grow like the pool's, 517 at 64 × 16 | the standard answer, and 15× slower | Rejected — measured, not reopened |
| `rio` · `ringbahn` · `nuclei` · `uring-fs` · `luring` and 90 other dependents | T | — | — | soundness hole, dead, own runtime, cursor + thread, `LocalSet`-only | Rejected — none drives a ring on multi-thread tokio with positional reads |
| `sendfile` / `splice` | B | — | — | userspace QUIC copies anyway | Rejected |
| `O_DIRECT` + SPDK, whole-series preload | B | — | loses the page cache shared across sessions | wrong scale | Rejected |
| Bounded process-private frame cache | T | **−20.2 % CPU** at a 0.92 hit rate; +4.2 % where nothing repeats | duplicates RAM the page cache holds | needs a real ask trace to size | Lab only, not ported |
| Sequential: wider windows | S | 20–30 % less CPU per byte | escalations climb 1 % → 13.5 % | — | Rejected |
| Sequential: depth above 2 per stream | S | at 64 sessions × 16 every variant queues on the device, p99 100–190 ms | — | the wire is 200× slower than a warm read | Rejected as a rule |

## 6 · Deployment

Both fallbacks degrade to the pool **per session**, and the server says so (`read_fast_path=`,
`ring=`, §10) — but only once deployed. The checks below belong in the manifest.

### `RWF_NOWAIT` is a property of the mount

`FrameStore::open` probes once; where the flag is refused, one pooled `pread` per frame —
correct, safe, and **132.5 µs per frame against 48.4 µs** on the validation host.

| Filesystem | `RWF_NOWAIT` | Note |
| --- | --- | --- |
| ext4, btrfs | **honoured** | measured (ext4 on Linux 6.18; btrfs on the workstation) |
| overlayfs | **refused** (`EOPNOTSUPP`) | measured — **a container's own filesystem**; Linux 7.2.8 by source and probe (*In a container*) |
| tmpfs | **refused** (`EOPNOTSUPP`) | measured — RAM disks, `emptyDir: {medium: Memory}`; Linux 7.2.8 too |
| XFS | *expected to work* | **not measured** |
| NFS / EFS / Filestore | *unknown* | **not measured** — run the tool; do not assume |

**Check before shipping, from where the server reads.** `cargo build -p check-fastpath
--release`, then `check-fastpath /srv/series` — the directory, not a file; it creates and
removes a probe file, so it works before any series is in place, and prints the filesystem,
`read_ahead_kb` and the verdict. Exit **0** fast path, **1** fallback, **2** could not
determine, so it can gate a rollout. Ship it in the image and run it inside the container
(`docker exec` / `kubectl exec`): the host's answer is not the container's.

**Serve series from a mounted volume, never from the container's own layer.** A bind mount
carries the underlying filesystem through — verified: the same directory reports `overlayfs /
REFUSED` inside an overlayfs tree and `ext2/ext3/ext4 / honoured` with an ext4 bind mount over
it. A series `COPY`'d into the image works, passes tests, and has silently lost the fast path —
as the 2026-08-31 campaign's overlayfs host had, which is part of why it concluded wrongly.

```bash
docker run -v /srv/series:/srv/series:ro --security-opt seccomp=deploy/seccomp-uring.json \
  --ulimit nofile=65535:65535 --ulimit memlock=-1 myserver
```

Docker ≥ 25, Podman and containerd ≥ 2.0 refuse io_uring under their default seccomp profiles, so without the
profile every tile miss takes the pool. What the profile reopens, and the runtimes' defaults:
[`../../deploy/README.md`](../../deploy/README.md) §Container settings (row 199).

In Kubernetes, a read-only PVC on a block device (EBS, PD, Azure Disk, Ceph RBD: ext4 or XFS).
Not `emptyDir: {medium: Memory}` (tmpfs); plain `emptyDir` is node disk that does not survive
rescheduling. A PVC on a network filesystem (EFS, Filestore, NFS) must be checked.

### Limits: `ulimit -n` and `ulimit -l`

A tile session that misses keeps one io_uring for its life: **1 fd, 8.7 KiB of locked memory,
15.6 µs to build** (*corrected 2026-10-16, row 250*: 2 fds with the eventfd it parked on until then, §9 #7; the
15.6 µs was timed with it) (`lab/disk-access-bench/src/bin/ring_scale.rs`); more
slots are more entries in the same ring.
Ring memory is charged against **`RLIMIT_MEMLOCK`** unless the process holds `CAP_IPC_LOCK`
(kernel 6.18, `io_uring/memmap.c`, verified). The counter is the uid's, host-wide, and the exemption counts only in the initial user namespace: `--cap-add IPC_LOCK` does nothing for a non-root `USER` (row 199, measured in Docker) or a rootless runtime (read from the source). The 8 MB default is **~940 rings**, and it bit
first on a real host: two cells of a scale run were refused by it. The failure is silent — the
ring is refused, the session falls back to the pool and gets slower. The descriptor budget is
`sessions that miss + sockets + 1 per series` (2 × sessions until row 250).

In a unit file, `LimitNOFILE=65535` and `LimitMEMLOCK=infinity` (or at least 16 KiB × the
sessions expected to miss at once). Kubernetes has no per-pod ulimit — the node runtime's apply;
`cat /proc/<pid>/limits` inside the running container is the honest check anywhere.

### Read-ahead

`check-fastpath` prints `read_ahead_kb` because it moves every measured miss rate by **2–15×**.
Linux's default is 128 KiB; the validation host shipped 8 192, the workstation 4 096 on its
btrfs bdi (not the 128 its block device reports), the cloud rig 2 048. The fill no longer
depends on it (`FILL_WINDOW`); tiles still do. Record it with any published number
(`/sys/block/<dev>/queue/read_ahead_kb`; `blockdev --setra 16384` sets 8 MiB, not persistently).

### Read-ahead and folios (row 196: theory; measured by row 197, §Measured below)

Row 172 ([`../disk-layout/README.md`](../disk-layout/README.md) §Measured, rule (d)): after reclaim, a cache warmed
by the fill's `POSIX_FADV_WILLNEED` holds 4 KiB folios only, 41 and 123 a 160 and 500 kB frame against
`pack-series`' 7 and 9, and on the host's ext4 a hit costs ×2.02 and ×1.99, the fill's hit rate ×0.68 and ×0.64, its
CPU per GB ×1.49 and ×1.56. On XFS the same counts separated nothing. The question: can the fill's read-ahead build
large folios with its wait unchanged?

Sources: Linux **v6.18.44** from `gregkh/linux`, SHA-256 first 16 hex `mm/readahead.c` 25f3c0da49787109,
`mm/fadvise.c` f05ef1386bb5d24b, `mm/filemap.c` 2bd1223972411197 (the files row 168 read), `mm/madvise.c`
f56dddf47e81ceb6, `mm/khugepaged.c` 0334087a87a281c3, `mm/huge_memory.c` 26ab392300cbaa97,
`fs/xfs/libxfs/xfs_ialloc.c` 70dd9daed7294dd5; mainline at **v7.3-rc7** from `torvalds/linux` for what has
changed since: `mm/readahead.c` 6ee106a2f671e354, `mm/filemap.c` 98c5d6444d210a8c. Fetched 2026-10-14.

**The mechanism.** The kernel sizes a folio where it allocates it, and its paths differ:

* *Forced read-ahead* — `POSIX_FADV_WILLNEED` (`mm/fadvise.c:106`) → `force_page_cache_ra` → `page_cache_ra_unbounded`,
  which allocates every folio at the mapping's **minimum** order (`mm/readahead.c:275–276`): 4 KiB on ext4 and on
  XFS with 4 KiB blocks. Unchanged at v7.3-rc7. One call reads at most `max(io_pages, ra_pages)` (`:354`).
* *The read path's own read-ahead* — a `pread` that misses, `RWF_NOWAIT` included (`mm/filemap.c:2644`), goes
  through `page_cache_sync_ra`, which **resets the order to 0** (`mm/readahead.c:624`); each asynchronous window
  that a sequential reader then triggers adds 2 (`:689`), up to `ilog2` of the window (`:487`): 128 KiB folios at
  the stock `read_ahead_kb`. That state lives in the `struct file` (`f_ra`), which all of a series' sessions share
  (`FrameStore` opens it once, §7), so concurrent fills reset each other's order.
* *A fault on a mapping marked `MADV_HUGEPAGE`* — `do_sync_mmap_readahead` sets the order to PMD's, 2 MiB, aligns the
  start down to 2 MiB of file offset and calls `page_cache_ra_order` (`mm/filemap.c:3266–3279`), whatever
  `read_ahead_kb` says; 2 × 2 MiB unless the mapping is also `MADV_RANDOM` (`:3274`). Kept at v7.3-rc7, now for
  any mapping with large folios and capped at 2 MiB (`mm/filemap.c:3350`). `MADV_HUGEPAGE` sets the VMA flag and
  nothing else (`mm/khugepaged.c:340–362`); it is refused only without `CONFIG_TRANSPARENT_HUGEPAGE` (`mm/madvise.c:1539–1542`). The sysfs
  `enabled` setting is not read on this path at v6.18.44 (read, not run).

`page_cache_ra_order` stops at the first index already cached and **finishes the rest at the minimum order**
(`mm/readahead.c:512–534`), and an order the allocator cannot meet is the same `-ENOMEM` stop: large folios degrade
to today's, never to a failed read. A mapping without large folios (ext4 `data=journal`, ext4 before v6.16) goes
straight to that fallback (`:479`).

**The candidates.**

| candidate | folios it builds after reclaim (source) | the fill's wait | verdict |
| --- | --- | --- | --- |
| `readahead(2)` | 4 KiB: it **is** `vfs_fadvise(…, WILLNEED)` (`mm/readahead.c:730`), and does not block | as today | no lever |
| larger `WILLNEED` ranges | 4 KiB; the per-call cap and nothing else move | as today | no lever |
| `madvise(MADV_WILLNEED)` on a mapping | 4 KiB: `vfs_fadvise` again (`mm/madvise.c:325`) | as today | no lever |
| `read_ahead_kb` | none for `WILLNEED`; raises the sync path's ceiling | as today | no lever here (tiles: §Read-ahead) |
| `MADV_POPULATE_READ` on a plain mapping | read-around at order 0 (`mm/filemap.c:3335–3341`), then +2 a window to 128 KiB | blocks a pool thread per call | weaker than **P** |
| **P**: `MADV_HUGEPAGE` + `MADV_RANDOM` + `MADV_POPULATE_READ`, one aligned 2 MiB block a call | **2 MiB**, one folio a block; the block's tail at the file's end in smaller aligned orders | the same bytes in flight; a block is readable when all of it lands | **the candidate** |
| **B**: sequential `pread` of the window into a scratch buffer (pool, or the ring) | order 0, then +2 a window up to `ilog2(window)`; row 172's A5 is this at 128 KiB: 1.35–6.24 a frame | one more copy a byte, a buffer, the shared `f_ra` | second candidate |
| `MADV_COLLAPSE` after `WILLNEED` | 2 MiB, by copying every byte into a new folio; needs `CONFIG_READ_ONLY_THP_FOR_FS` (`mm/huge_memory.c:89`), off on this host's kernel | a second pass | rejected |
| no advice (the kernel's read-ahead alone) | as **B** | the 2026-09-10 "before": 59–66 % misses at 128 KiB (§11) | rejected by the brief |
| XFS with blocks above the page (`mkfs.xfs -b size=64k`) | the block size as the minimum order (`xfs_ialloc.c:3081–3084`), so `WILLNEED` builds 64 KiB folios | as today | a deployment option, no code; ext4 has it in mainline (`s_min_folio_order`), not at v6.18 |

**P, as it would be built** (nothing is built here; the lab builds it for row 197). At open, the store opens the
series a second time, so P's faults write a read-ahead state no `pread` shares, and maps it read-only once with
`MADV_HUGEPAGE` and `MADV_RANDOM`. `FillReader::advise` keeps its window, but extends it in whole 2 MiB blocks that
start at or past the named frame's end, each one `MADV_POPULATE_READ` call in its own `spawn_blocking`, so two
blocks are on the device at once as `WILLNEED`'s 4 MiB is today. The block holding the named frame is left to the
fill's own reads, which have touched it already; populating it would stop at their folios. P never reads through the
mapping, so §7's reason for having none (bytes handed to quinn must be process-private) holds, but the invariant's
wording would change. `MADV_HUGEPAGE` refused (`EINVAL`) or the mapping failing falls back to `WILLNEED`.

**Predictions** (P against today's `WILLNEED`, both after reclaim, the fill alone on the file):

* **Folios a frame:** 160 kB 1.1–1.6, 500 kB 1.2–2.2, MB-scale `ffdm_d` 1.5–3.5, 32 kB 1.0–1.4 (the walk's first
  2 MiB, read by the fill itself, holds A5-like folios; the rest one folio a block); `WILLNEED` as row 172's A6.
  ext4 `data=journal`: P = `WILLNEED` = 4 KiB. With four fills on one file at staggered starts: between the two.
* **Hits on ext4:** at 160–500 kB P at 0.40–0.55 of `WILLNEED`'s hit p50 (row 172's A2 against A6: 0.41 and 0.45);
  fill hit frames/s ×1.4–1.6, fill-hit CPU per GB ×0.6–0.75; at 32 kB within row 172's resolution. **On XFS a tie**
  on every metric (row 172), so P helps ext4 only, on this evidence.
* **The cold fill (the wait):** frames/s and misses a tie (P keeps the same bytes in flight), fill CPU per GB a tie
  or lower (one folio a block to allocate instead of 512); the first frame after a walk starts unchanged.
* **Costs:** a `spawn_blocking` (24–34 µs, §11 *Hosts*), four syscalls and one fault a 2 MiB block — ~30 ms per GB
  filled at most; an order-9 allocation that fails under fragmentation falls back (`compact_stall` would show it).

**What would make P wrong:** the hit cost being something other than the folio count after reclaim (row 172 counted
folios and timed hits on the same files, so it is the folios or something they carry); `MADV_HUGEPAGE` refused in a
container (`madvise` is in Docker's default seccomp allow-list; row 199 owns the container); 2 MiB reads landing
later than `WILLNEED`'s at the walk's start, which the cold fill would show.

### Protocol for row 197

Given to a separate session with nothing above this heading.

* **Arms, differing in the fill's read-ahead alone**, all through the shipped `FillReader` and `TileReader` but for
  its `advise`, built in the lab: **W0** today's `WILLNEED`, quarter-window; **W0′** W0 on another copy of the file
  (A/A); **W1 (P)** a second descriptor mapped read-only with `MADV_HUGEPAGE` and `MADV_RANDOM`, the window
  extended in whole 2 MiB file-aligned blocks starting at or past the named frame's end, each block one
  `MADV_POPULATE_READ` in its own `spawn_blocking`, a refused `madvise` falling back to W0 and counted; **W2 (B)**
  a second descriptor with `POSIX_FADV_SEQUENTIAL`, the window `pread` into a scratch buffer in 1 MiB reads on the
  pool; **W3** no advice. Every arm's settings printed.
* **Cold without eviction:** each round, each arm's file is a fresh copy written with `O_DIRECT` (row 172's `direct`),
  so nothing of it is cached; one fill walks it from frame 0 (the **cold fill**). Then, on the cache that fill left:
  folios a frame (row 172's `/proc/kpageflags` counter), the **hit** p50 and p99 through `TileReader` with
  `RWF_NOWAIT`, a second fill (**fill hit**), and the forced miss through `force_pool_reads`. A cell where four fills
  walk one cold copy, starting a quarter of the file apart, is timed the same way.
* **Cells:** `ct_lidc` (163 kB), `dbt12_ea1141` (503 kB), `ffdm_d` (record its frame sizes), and `pt15_cptac` (32 kB)
  as the check that small frames lose nothing; HTJ2K, ingest's coded frames. **16 rounds**, arms in
  `lab/scripts/order.py`'s order inside each cell.
* **Filesystems:** the host's (kernel, filesystem, mount options, `read_ahead_kb`, `max_sectors_kb`, THP `enabled`),
  a loop ext4, the same image `-o data=journal`, a loop XFS; a loop XFS made with `-b size=65536`, W0 and W0′ only, if
  the pinned `mkfs.xfs` makes one and the kernel mounts it.
* **Metrics:** cold fill frames/s, its misses (`ReadStats`), its CPU per GB, and the time to its first frame; hit p50
  and p99; fill-hit frames/s and CPU per GB; forced-miss p50; folios a frame, with the share of W1's blocks that are
  one 2 MiB folio; `/proc/vmstat` `compact_stall` and `pgmajfault` deltas a round.
* **Exactness:** every frame read checked against its coded bytes' XXH3-64 and every arm's frames decoded once
  against ingest's sample digests; `--mutate shift|short` must fail it. W1's block arithmetic gets a unit test that
  fails when a block straddles the named frame's end or leaves a gap (mutate it).
* **Predictions:** folios a frame W1 160 kB 1.1–1.6, 500 kB 1.2–2.2, `ffdm_d` 1.5–3.5, 32 kB 1.0–1.4, W0 as row
  172's A6, W2 between; on `data=journal` every arm at 4 KiB folios. On ext4 at 160–500 kB, W1's hit p50 0.40–0.55
  of W0's, fill hit ×1.4–1.6, fill-hit CPU per GB ×0.6–0.75; cold fill frames/s and misses a tie, CPU a tie or
  lower; at 32 kB, on XFS and on `data=journal`, a tie on every metric. Four fills: W1's folios between its alone and
  W0's, its hits still better. W3's cold fill misses most.
* **Decision rule.** The resolution is row 172's: the p90 over rounds of \|W0′/W0 − 1\|, per cell and metric; a
  difference counts beyond it with ≥ 80 % of rounds agreeing in sign. *(a) Mechanism:* confirmed if W1's folio
  counts fall in the predicted ranges (within 20 % of their bounds) and the hit ranking follows the counts on ext4;
  rejected if W1 builds 2 MiB folios and its hits do not part from W0's on ext4 at 160–500 kB. *(b) P adopted*
  as the fill's read-ahead if, on host and loop ext4, W1 beats W0 beyond the resolution on hit p50 or fill-hit CPU
  per GB at 160–500 kB **and** is worse beyond it on no metric in any cell or filesystem, the cold fill's frames/s,
  misses and first frame included. *(c) B instead* only if P fails (b) and W2 passes it. *(d)* Better hits with a
  slower cold fill beyond the resolution is a trade-off for the owner, not adopted. *(e)* Neither better beyond the
  resolution closes the fill's read-ahead as it is; the XFS 64 KiB reading, if made, is recorded for the deployment
  either way.

### Measured (row 197, 2026-10-14): neither read-ahead is adopted; W0 stays

Run by a session given only the protocol above. Rig, commands and rows: [`../../lab/container-bench/`](../../lab/container-bench/README.md)
§The fill's read-ahead (`readahead.py`, `readahead_bench`, `rows-readahead.jsonl`, `readahead_summary.py`). The arms are
the shipped `FillReader` with its advice replaced through `FillReader::with_read_ahead` (a test pins that the hook is
handed exactly the ranges `WILLNEED` would be, and fails when it is not), every other line of both readers shipped.
*Since removed (row 224, REJECTEDPATHS): the hook, its test and the arms W1–W3, none adopted; they are at `ba408823`,
and the rig runs W0 and W0aa.*
Kernel 6.18.44, 4 cores, 15 GB, THP `madvise`. The host's filesystem is ext4 on `/dev/vda` (`read_ahead_kb` 128,
`relatime,discard`); the loop images (2 GiB, ext4, ext4 `data=journal`, XFS and XFS `-b size=65536` from xfsprogs
6.6.0-1ubuntu2.1) sit on it with `read_ahead_kb` 2560 and `max_sectors_kb` 1280, so **the host's and the loops'
ext4 differ in their read-ahead window by 20×**. Sets as ingest coded them: `ct_lidc` 164 kB a frame (100),
`dbt12_ea1141` 499 kB (29), `ffdm_d` 4 808 kB (4), `pt15_cptac` 31 kB (335). 16 rounds, the arms in `order.py`'s order
in each cell; one fill on every filesystem, four fills on the host and loop ext4; 2 048 rows, **5 238 656 frames
checked by XXH3-64, none inexact**; every arm's frames decoded once against ingest's digests, 0 inexact; `--mutate
shift` and `short` failed every arm (870 of 870 frames). W1's block test failed under each of four mutations of its
arithmetic. No `madvise` was refused; `compact_stall` 0 and `pgmajfault` 0 in every cell's median.

**Not cold on `data=journal`.** ext4 with `data=journal` serves `O_DIRECT` through the page cache: every copy there was
wholly cached after it (the XFS copies kept one page, the truncated last one). Its cold fill is a fill on the cache, its
folios the copy's; nothing below claims a cold fill there.

Folios a frame (W0, then each arm ×W0), and the hit p50 ×W0 (**bold**: beyond the resolution, ≥ 80 % of rounds
agreeing; resolution = p90 of |W0aa/W0 − 1| per cell and metric):

| filesystem, set | W0 folios | W1 folios · hit | W2 folios · hit | W3 folios · hit | W1 2 MiB blocks whole |
| --- | --: | --- | --- | --- | --: |
| host ext4, 164 kB | 41 | ×0.057 · **×0.72** | ×0.58 · **×0.68** | ×0.11 · **×0.62** | 86 % |
| host ext4, 499 kB | 113 | ×0.024 · **×0.62** | ×0.42 · **×0.79** | ×0.058 · **×0.65** | 82 % |
| host ext4, 4.8 MB | 204 | ×0.91 · ×0.90 | ×1.37 · ×0.97 | ×0.11 · ×0.87 | 50 % |
| host ext4, 31 kB | 8.58 | ×0.14 · **×0.76** | ×0.86 · **×0.65** | ×0.16 · **×0.63** | 75 % |
| loop ext4, 164 kB | 41 | ×0.31 · ×0.77 | ×0.13 · **×0.64** | ×0.095 · ×0.75 | 43 % |
| loop ext4, 499 kB | 97 | ×0.11 · ×0.67 | ×0.14 · ×0.72 | ×0.023 · ×0.66 | 60 % |
| loop ext4, 4.8 MB | 191 | ×1.90 · ×0.97 | ×0.65 · ×0.97 | ×0.063 · ×0.89 | 61 % |
| loop ext4, 31 kB | 8.58 | ×0.28 · **×0.77** | ×0.75 · **×0.69** | ×0.15 · **×0.72** | 75 % |
| loop XFS, 499 kB | 97 | ×0.11 · **×0.61** | ×0.14 · **×0.63** | ×0.023 · **×0.60** | 65 % |
| `data=journal`, every set | 8.6–1 170 | ×1.000 · ×0.94–1.02 | ×1.000 · ×0.68–1.11 | ×1.000 · ×0.94–1.06 | 0 % |

What each arm costs where it is worse beyond the resolution: **W1** a cold fill's CPU per GB ×1.146 on XFS at 4.8 MB,
and its first frame ×2.13 on `data=journal` at 31 kB; its cold fill's frames/s is ×0.74–1.02 at 164–499 kB on the host
and loop ext4 but within the A/A spread. **W2** a cold fill's CPU per GB ×1.11–1.92 in every cell but two, a fill's on
the cache ×1.72–2.03 at 499 kB, and +4 to +8 cold misses with four fills on the host. **W3** +7 to +71 cold misses in
five of the host's eight cells, each beyond the resolution; on the loops, whose window is 2.5 MiB, +0 to +6.

* *Folios a frame W1 160 kB 1.1–1.6, 500 kB 1.2–2.2, `ffdm_d` 1.5–3.5, 32 kB 1.0–1.4:* **failed** outside the host's
  32 kB (1.17): 2.34 and 2.7 on the host, 12.5 and 10.9 on loop ext4, and at 4.8 MB 186 and 363 — as many as W0's or
  more. 43–86 % of W1's blocks became one 2 MiB folio alone, 0–19 % with four fills.
* *W0 as row 172's A6 (41, 123):* **held** at 164 kB (41); 97–113 at 499 kB.
* *W2 between:* **held on the host** at 164–499 kB (24 and 47, between W1's 2.3–2.7 and W0's 41–113); **failed** on loop
  ext4 (5.5 and 13.5 against W1's 12.5 and 10.9) and at 4.8 MB.
* *Every arm 4 KiB on `data=journal`:* **held** (×1.000 in every cell).
* *W1's hit p50 0.40–0.55 of W0's on ext4 at 160–500 kB:* **failed**, 0.62–0.77. *Fill hit ×1.4–1.6:* **failed**,
  ×1.00–1.22. *Fill-hit CPU per GB ×0.6–0.75:* **failed**, ×0.77–1.02 (host 164 kB to loop 499 kB).
* *Cold fill frames/s and misses a tie, CPU a tie or lower:* **held** within the resolution, frames/s ×0.74–1.02.
* *At 32 kB, on XFS and on `data=journal`, a tie on every metric:* **held on `data=journal` only**; at 32 kB and on XFS
  W1's hits are ×0.61–0.77, beyond the resolution.
* *Four fills: W1's folios between its alone and W0's, its hits still better:* **held** for the folios (164 kB: 12.5 →
  26.4 → 36.5 on loop ext4, 2.3 → 28 → 41 on the host; 499 kB 10.9 → 82 → 96, 2.7 → 73 → 113), hits ×0.84–0.95, none
  beyond the resolution.
* *W3's cold fill misses most:* **held** on the host (+7 to +71 against W0's 3–17), barely on the loops.
* *Unpredicted:* **no advice at all (W3) builds the fewest folios** (×0.02–0.16 of W0's) and hits as fast as W1 or W2
  (×0.60–0.75), at the price of the misses above where the device's own read-ahead window is small. What `WILLNEED`
  costs is its folios, not its reads.
* **Rule.** *(a) Mechanism:* **not confirmed**: W1's counts miss their ranges, and the hits follow the folio counts only
  roughly (W2's hit beats W1's at 164 kB with twice its folios). Not rejected either: W1's hits part from W0's on ext4
  at 160–500 kB. *(b) P:* **not adopted**: beyond the resolution on hit p50 on the host's ext4 (×0.72, ×0.62) but not on
  loop ext4 (×0.77, ×0.67 inside the spread), and worse beyond it on XFS's cold-fill CPU at 4.8 MB and
  `data=journal`'s first frame at 31 kB. *(c) B:* **not adopted**: its cold fill's CPU is worse beyond the resolution
  almost everywhere. *(d)* does not arise. *(e)* **The fill's read-ahead stays W0.** Recorded for the deployment: XFS
  with 64 KiB blocks builds 3.5, 7.3, 18 and 1.5 folios a frame under W0, and its W0 hits are 13.5 and 25.2 µs at 164 and
  499 kB against the 4 KiB XFS's 19.0 and 40.9 (different images, not paired; a filesystem choice for row 195 to
  measure, not a reader change).

### P0 — validate on the production target before touching anything

One campaign run on the cloud instance, volume class and container image: `product_tile`
against `pool`, cold, both frame sizes, 64–256 sessions at depth 4, `check-fastpath` on the
series volume and `ulimit -l` recorded. The rule is fixed in advance: a tie deletes the ring and
ships the pool; a resolved margin keeps it and folds in the ring-fd change. It can go either
way, because a cloud miss is device-bound and the ring's remaining claim is threads and CPU per
miss. Status in §9.

### In a container (row 195 DOCKERREAD: theory; measured by a separate session)

This section owns two things: what each place a series can live does to the read path, and the measuring protocol.
The settings, the runtimes' defaults and what reopening each one costs in security belong to
[`../../deploy/README.md`](../../deploy/README.md) §Container settings (row 199). The folios belong to §Read-ahead and
folios above (rows 196–197).

**Sources** (fetched 2026-10-13, SHA-256 first 16 hex):

* Linux **v7.2.8**, the host's kernel, from `gregkh/linux`: `fs/overlayfs/file.c` f44fb8dc3f099529, `fs/backing-file.c`
  3814af08154928f9, `include/linux/fs.h` e34b28c8e6d244f2, `io_uring/io_uring.c` 7e4540b9a3d457fa, `kernel/seccomp.c`
  faadf7f5f2b9fe3e, `security/selinux/hooks.c` 738dc14dee815159, `fs/btrfs/fs.h` 455977432542d999 and
  `fs/btrfs/disk-io.c` d757b615b068c266.
* container-selinux **v2.251.0** `container.te` caa9ff6a6f3b29c8, as installed.
* containers-common **0.67.0** `seccomp.json` as installed, byte-equal to `container-libs` tag `common/v0.67.0`
  (2598b3b98e6970f3).

**Probed here** (functional, untimed, 2026-10-13/14):

* The host: Fedora 43 with SELinux enforcing, rootless Podman 5.8.4 with crun 1.28, native overlay on btrfs on LUKS.
  cgroup v2 delegates no `cpuset`.
* `preadv2(RWF_NOWAIT)`, `WILLNEED`, `readahead(2)` and the ring's setup with the server's flags and registrations,
  from `python:3.11-slim` as uid 10001 and through an overlay in a host user namespace; `mincore` for residency.

```text
 series-server, uid 10001
  │ preadv2(RWF_NOWAIT): refused unless the open file has FMODE_NOWAIT (fs.h:3442–3444)
  ├─ O  the container's own layer ─▶ ovl_open sets none (file.c:198–235) ─▶ EOPNOTSUPP ─▶ every frame to the pool
  │       read, mmap, fadvise, write ─▶ the real file in the layer dir (file.c:323–370, 468–476, 509–519)
  ├─ B  bind mount ─────────▶ the host's own file ─▶ honoured
  └─ V  named volume ───────▶ a bind of <storage>/volumes/<name>/_data ─▶ as B
 a tile miss ─▶ io_uring_setup ─▶ seccomp: absent from the default ─▶ ENOSYS (Podman) / EPERM (Docker)
                             └─▶ allowed by seccomp-uring.json ─▶ SELinux io_uring { allowed } (io_uring.c:3142,
                                 hooks.c:7621–7626): container_t has none ─▶ EACCES ─▶ WARN, the session on the pool
 page cache: the real inode's, one shared by the host, B, V, O and every container on that file
```

| | `RWF_NOWAIT` | ring, default profile | ring, `seccomp-uring.json` |
| --- | --- | --- | --- |
| H, the host | honoured on btrfs | — | works |
| B, bind mount; V, named volume | honoured (Docker: row 199) | `ENOSYS` (`seccomp.json:3`); Docker `EPERM` (row 199) | **`EACCES` here**; works with `--security-opt label=disable`, flags and registrations included. Docker: works (row 199) |
| O, own layer; tmpfs | **refused**, on image-layer and upper files alike (Docker: row 199) | never tried: gated on the flag (§10 *The trap*) | never tried |

**The SELinux gate is the host's, not the runtime's.**

* **Why `EACCES`.** `io_uring_allowed` asks the LSM (`io_uring.c:3123–3143`), and SELinux checks
  `io_uring { allowed }` on the caller's own domain (`hooks.c:7621–7626`). container-selinux 2.251.0 grants it
  nowhere: no `io_uring` appears in `container.te`. The host's unconfined domain has it.
* **What follows.** On an SELinux-enforcing host the profile alone does not restore the ring, under either runtime.
* **Podman 5.8.4 accepts the Docker-format profile.** With it the container reports `Seccomp: 2`, and
  `io_uring_setup` gets past the filter, to `EACCES`.

**Limits here** (rootless, probed): `nofile` 524288 : 524288, `memlock` 8 MiB, no `memory.max`.

* The 8 MiB is the host's hard limit too, so rootless cannot raise it. Row 199 measured `memlock` per uid,
  host-wide (1 024 rings at 8 MiB); rootless, uid 10001 is the subuid 665360.
* Nothing binds while the ring is refused. `io_uring_setup` is the first call `UringReader::new` makes (`uring_reader.rs:31–34`; before
  the eventfd, until row 250 removed it), so a refused session holds no ring, fd or locked memory.

**Allowed calls skip the filter.** `preadv2`, `fadvise64`, `readahead` and, under the profile, `io_uring_enter` are
unconditional allows. For those the kernel's per-syscall cache skips the BPF program (`kernel/seccomp.c:416`).

**Folios** are the real file's, so they are set by its writer and its filesystem, as on the host. This btrfs caps a
folio at 256 KiB (`fs/btrfs/fs.h:67–71`, `disk-io.c:3362–3369`), against ext4's 2 MiB. Counts here compare between
arms, not with rows 172 and 197.

**What transfers to rootful Docker Engine.**

* **Transfers:** all of the kernel's part. That covers overlay's refusal and its cost, the shared cache, the folios,
  the filter's cost, and what the ring buys over the pool once it is allowed.
* **Does not transfer:** the SELinux gate, which applies only where SELinux enforces (row 199's host let the ring
  through); absolute µs on a server's ext4 or XFS; a container memory limit; Docker Desktop.

#### Protocol for the measuring row (row 195)

Given to a separate session with nothing above this heading. The rig is `lab/container-bench/dockerread.py`, with the
arms as data in `dockerread-arms.json` ([`../../lab/container-bench/README.md`](../../lab/container-bench/README.md)
§In a container).

* **Image.** The deploy's server image as `deploy/` builds it, and the rig image `Containerfile.dockerread` on the same
  pinned `rust:1.97-bookworm`. Only the entrypoint is overridden; an arm passes its own options and no others (no
  `--ulimit`, `--cap-add` or `--privileged`); the host arm runs the same binaries.
* **Arms.** One series file each, all on the owner's `/home`, which also holds Podman's storage. One long-lived
  container per arm; timed runs are `podman exec`.

  | arm | place and setting | placed by |
  | --- | --- | --- |
  | H, H′ (A/A) | the host, no container | `pack-series` on the host |
  | B | bind mount, `-v DIR:/studies:ro,z` as in compose | `pack-series` on the host |
  | V | named volume, `-v NAME:/studies:ro` | `pack-series` in a uid-10001 container |
  | O | `/srv/series`, the container's upper layer (`measure --pooled-ok`) | `pack-series` inside it |
  | **B+U** | B with `--security-opt seccomp=deploy/seccomp-uring.json` | as B, its own directory |
  | **B+UL** | B+U with `--security-opt label=disable`, which lets the ring through here | as B, its own directory |

* **Left out, and why:**
  * P: row 197 did not adopt it.
  * `no-new-privileges` and `cap_drop: [ALL]`: they touch no call the read path makes. Row 199 found io_uring,
    `RWF_NOWAIT` and 1 024 rings unchanged under them.
  * A raised `memlock` or `nofile`: they change nothing per session and bind only past ~1 000 sessions that miss, at
    P0's scale. Rootless, `memlock` cannot be raised here at all.
  * tmpfs: it refuses as O does.
  * XFS with 64 KiB blocks (row 197): a container does not change a filesystem a bind mount carries.
  * Row 198's frame cache and huge-page buffers: they live in user memory and the host's THP setting, which a
    container does not change. Row 198 rejected or closed the rest.
* **Cells.** Row 172's HTJ2K cells, ingest's coded frames: `pt15_cptac` (32 kB), `ct_lidc` (163 kB) and `dbt12_ea1141`
  (503 kB), each after a pack.
  * `dbt12_ea1141` also runs after `WILLNEED`: `writer_bench direct` into the arm's real directory, then
    `writer_bench warm --how willneed` through the arm's path.
* **Metrics.** Every frame is XXH3-checked. `container_bench measure` (4 000 asks, 256 MiB fill) gives:
  * hit p50 and p99, through `RWF_NOWAIT`;
  * forced-miss p50, through `force_pool_reads`, never eviction;
  * fill hit and fill forced miss in frames/s, with CPU per GB.
* **New: a cold tile pass, for the ring.** The forced miss never builds a ring, so this is the only timing of it.
  1. Write a fresh copy with `writer_bench direct` and check it is not resident: cold, with nothing evicted.
  2. Read it once with `TileReader` at depth 4, in a random order.
  3. Record p50, p99, CPU per frame and `ring=`.
* **Order and n.** Seven units, each round in the order `lab/scripts/order.py row 7 ROUND` gives, for 28 rounds (two
  Williams periods). The resolution is the p90 of |H′/H − 1| per metric and cell. A difference counts beyond it with
  ≥ 80 % sign agreement (§11).
* **Folios.** `writer_bench folios` as root on the host against each arm's real file, after placing and after the last
  round. The two counts must match.
* **Reader check (untimed), per arm.**
  1. Run `check-fastpath`.
  2. Start the image's server on a cold copy and run one depth-4 tile session through `server_ab` in the same
     container.
  3. Record `read_fast_path=`, `ring=`, and the `io_uring unavailable` WARN with its errno.
* **Printed per arm:** `podman inspect`'s User, SecurityOpt, Ulimits, CapAdd and Mounts; in the container
  `/proc/self/limits`, `Seccomp:`, `CapEff:` and `/proc/self/attr/current`; `findmnt -T` and `read_ahead_kb`; the
  kernel, Podman, crun, container-selinux and containers-common versions; each file's SHA-256 (H's, or the arm is void).
* **Throttling.** Everything under `nice -n 19 ionice -c3`; timed visits under `taskset -c 2,3`, inside `podman exec`
  too; builds with `--cpu-period 100000 --cpu-quota 200000`.
* **Time.** 784 visits (7 × 4 cells × 28 rounds) at a measured ~0.5–0.75 s each, plus the cold copies: **about 10–15
  min on a quiet machine.** Preparation runs niced while the owner works. The folio counts take ~5 min as root.
* **VOID.** A visit is `VOID` if any of these holds:
  * its pinned cores were busy outside the bench over 5 % of its wall time;
  * a store with `RWF_NOWAIT` missed in its hit pass;
  * a cold copy was resident.

  The bar is 10 % of visits. Past it, report the strict and the round-paired readings.

**Predictions.** A tie means within the resolution against H in the same round.

| | B, V | O | B+U | B+UL |
| --- | --- | --- | --- | --- |
| hit p50, p99 | tie | ties H's forced miss: 1 + (24–34 µs ÷ H's hit), ~×1.5–2 at 503 kB, more at 32 kB (derived) | tie | tie (the filter's cache) |
| forced miss; fill forced miss and its CPU per GB | tie | tie | tie | tie |
| fill hit and its CPU per GB | tie | ties H's fill forced miss | tie | tie |
| cold tile | the pool: against H, the ring's margin on this host. Wall a tie at 163–503 kB; 32 kB not predicted (§5: three hosts, three answers) | the pool | as B | **ties H** |
| `ring=` on a tile miss | `false`, `ENOSYS` | `false`, none tried | `false`, **`EACCES`** | **`true`** |
| `read_fast_path=` | `preadv2` | `pooled_pread` | `preadv2` | `preadv2` |
| folios, both states | within 20 % of H | the same | the same | the same |

**Decision rule.** The owner ruled on 2026-10-14 that a faster read path and a tuned container are worth it.

* **(a) Placement.** If B and V tie H on every timed metric, `/studies` stays a bind mount, with a named volume as its
  equal. If either is beyond the resolution, §6 advises against it until it is explained.
* **(b) Overlay.** If O sits at H's forced miss and is beyond the resolution against B, *Serve series from a mounted
  volume* stands, with this kernel's number. If O ties B, the 132.5 against 48.4 µs cost is retracted here.
* **(c) io_uring.**
  * **The row recommends the profile** when B+UL restores H's miss path at no measurable cost: `ring=true`, cold
    tiles tie H, and every other metric ties B.
  * **What it states with the recommendation:**
    * the security cost from §Container settings (row 199): io_uring's surface, which seccomp cannot judge;
    * the margin it buys here, B against B+UL on cold tiles, even if that margin is a tie;
    * that on SELinux-enforcing hosts the domain also needs `io_uring { allowed }`. `label=disable`, the arm
      measured, drops the container's whole SELinux confinement. A policy module granting only that permission to
      `container_t` is narrower, but it is untried and reaches every container on the host.
  * The owner adopts these or not; P0 (§9 item 1) still decides whether the ring earns its keep on the target.
  * **If B+UL does not restore H's path,** report where it parts, and recommend nothing.
  * **If the profile is adopted,** compose sizes `memlock` and `nofile` (§Container settings), and the `read_ring=`
    probe proposed there reports it.
* **(d) Limits** (row 166, DEPLOYLIMITS) change only with (c)'s adoption.
* **(e) Folios.** Every arm within 20 % of H in both states means the cache is the real inode's, and row 197's verdict
  (W0 stays) holds in containers. Otherwise the mechanism is wrong; report it.
* **(f) Not conclusive on this host:** a VOID-bar failure whose two readings disagree; absolute µs on a server's ext4
  or XFS (ratios to H transfer); Docker Engine on an SELinux-enforcing host, the one Docker question row 199 left
  open (predicted `EACCES` under the profile; untimed, elsewhere).

#### Measured in a cloud container (row 208, 2026-10-14): placement and folios hold; the profile is recommended

Run by a session given only the protocol above, on rootful Docker in a cloud VM; rig and how-to:
[`../../lab/container-bench/README.md`](../../lab/container-bench/README.md) §In a container, *On rootful Docker*; rows
`rows-dockercloud.jsonl`. **What differs from the rig the protocol was written on:** Docker Engine 29.8.2, containerd
2.3.6 (its overlayfs snapshotter), runc 1.5.1, the builtin seccomp profile, cgroup v1 with cgroupfs, rootful, so
`as_owner` is the identity and V is packed under `/srv/series`; **no SELinux**, so B+U and B+UL are the same arm
twice; ext4 on virtio `/dev/vda` (`read_ahead_kb` 128) under every arm and under Docker's storage; a Firecracker VM,
4 vCPU Xeon at 2.1 GHz, 15 GB, kernel 6.18.44, THP `madvise`, cores 2–3 pinned with nothing else on the machine. The
"host" is itself the VM's Ubuntu 24.04 container, so H runs the rig's binaries on **glibc 2.39**, every container on
the image's Debian **glibc 2.36**. Ratios to H transfer; absolute µs do not.

784 visits, 28 rounds, **2 VOID (0.3 %)**, so the strict reading alone; 0 frames inexact (XXH3) in every visit; every
arm's files equal H's SHA-256. Reader check: H and H′ `preadv2` with `ring=true`; **B and V `preadv2`, `ring=false`,
`io_uring setup: EPERM`** (Docker's default profile returns `EPERM`, not the `ENOSYS` predicted from Podman's); O
`pooled_pread`, no ring tried; BU and BUL `preadv2`, `ring=true`. The cold passes agree: ring on 84 of 84 for H, H′,
BU and BUL, 0 of 84 for B, V and O.

**Two differences are not the container's, and were taken apart before the rule was read.**

* *pt15's fill is the glibc.* B, V, BU and BUL filled pt15 hits ×2.11–2.56 of H at ×0.39–0.47 the CPU a GB (fill
  forced miss ×1.14–1.20). With `dockerread_why.py libc` (12 rounds interleaved), the same binary chrooted into the
  image on the host, Debian's glibc in the host's cgroup and namespaces, matched B: fill hit **×2.10** of H (1.73–2.23,
  12 of 12 rounds), B ×2.10; hit p50, miss p50 and ct_lidc a tie for both. Which glibc routine does it is not measured.
* *The WILLNEED cell is the copy.* Each arm has its own WILLNEED copy, all of order-0 folios, 122.86 a frame. Read
  from the host through `dockerread_why.py copies` (14 rounds), each copy gave its in-container hit p50: H 66.8 µs,
  H′ 63.9, **B 32.7, V 33.8**, BU 48.7, BUL 43.0, O 49.9 (in its container 102.1, through the pool). Two fresh copies,
  one warmed on the host and one in a throwaway container, both read 53–62 µs. So copies with identical folio counts
  serve a hit at 33–67 µs; that spread is a property of a copy's page cache that the folio count does not show, and
  is unexplained. It is not the mount, and it caps what this cell can resolve between arms.

Medians, µs or frames/s (hit through `RWF_NOWAIT`, miss through `force_pool_reads`):

| cell | H hit p50 | B · V · BUL hit p50 | O hit p50 | H miss p50 | H cold p50 | B · BUL cold p50 | O cold p50 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `pt15_cptac` 32 kB | 3.6 | 3.5 · 3.4 · 3.2 | 35.7 | 35.0 | 16.9 | 28.8 · 19.1 | 10.1 |
| `ct_lidc` 163 kB | 11.0 | 11.0 · 11.1 · 10.1 | 50.6 | 50.6 | 50.6 | 53.5 · 54.3 | 12.7 |
| `dbt12_ea1141` 503 kB | 30.4 | 31.4 · 29.7 · 30.7 | 84.1 | 84.3 | 203.0 | 171.2 · 231.6 | 58.1 |

**The predictions** (a tie: within the resolution against H in the same round):

* B, V hit, forced miss, fills: **held** on `ct_lidc` and `dbt12_ea1141` packed, and on pt15's hit and miss; pt15's
  fill and the WILLNEED cell are beyond, both explained above as not the mount.
* O's hit ties H's forced miss: **held** on every packed cell (p50 ×1.005, ×0.992, ×1.011; p99 ×0.99–1.05); fill hit
  ties H's fill forced miss, except its CPU a GB at 503 kB, ×1.21 (beyond; frames/s ×0.83, a tie). On the WILLNEED cell ×0.84, the copy.
* Cold tile, B against H: at 32 kB the pool is ×1.66 the wall and ×1.55 the CPU a frame of the ring; at 163–503 kB a
  tie, **as predicted**. **O's cold pass did not match "the pool":** ×0.56, ×0.28 and ×0.27 of H's wall (beyond at
  32–163 kB), so a cold read through the overlay's own path is faster here than either reader on a bind mount;
  unexplained, and no rule reads it.
* B+UL ties H on cold tiles in every cell (×1.08–1.10): **held**. Against B, ×0.67 the CPU a frame at 32 kB (beyond),
  a tie elsewhere. B+U, the same settings here, ties too, but its pt15 hit p50 is ×0.81 of H (beyond; B+UL's ×0.90).
* `ring=`: B and V `false` with **`EPERM`** (predicted `ENOSYS`); O `false`, none tried; B+U **`true`** where `EACCES`
  was predicted: no SELinux here, so this host cannot test that prediction. B+UL `true`. `read_fast_path=` as
  predicted for every arm.
* Folios: **held**, 28 of 28 files within 20 % of H (all ×1.00), the same after the last round as after placing.

**The rule.**

* **(a) Placement:** by the letter, B and V are beyond H. Both cells that part them part H from *every* container
  through the glibc and the copy, not through the mount, and B and V tie H wherever the reader and the copy are the
  same. Nothing here advises against either: `/studies` stays a bind mount, a named volume its equal.
* **(b) Overlay:** O's hit sits at H's forced miss and is beyond B in every cell, ×10.1 at 32 kB, ×4.6 at 163 kB and
  ×2.7 at 503 kB (35.7, 50.6 and 84.1 µs against 3.5, 11.0 and 31.4). *Serve series from a mounted volume* stands,
  with this kernel's number.
* **(c) io_uring:** B+UL gets `ring=true` on all 84 cold passes and ties H on cold tiles. Against B, its other metrics
  differ only on the WILLNEED cell, ×1.32 hit p50 and ×1.13 miss p50, which is the copy (each copy read from the host:
  B's 32.7 µs, BUL's 43.0). By that explanation **the row recommends the profile**, with:
  * the security cost (§Container settings, row 199): io_uring's surface, which seccomp cannot judge;
  * the margin it buys here, B against B+UL on cold tiles: at 32 kB 28.8 against 19.1 µs p50 and ×0.67 the CPU a
    frame (the wall within the resolution, 96 % of rounds on its side); at 163–503 kB a tie;
  * on SELinux-enforcing hosts the domain also needs `io_uring { allowed }`; `label=disable` drops the container's
    whole confinement, and a module granting only that permission to `container_t` is narrower but untried. This host
    has no SELinux, so it measured neither.
  The owner adopts these or not; P0 still decides whether the ring earns its keep on the target. **Adopted
  2026-10-14** (queue row 231): `deploy/compose.yml` loads the profile; the SELinux half stays the owner's.
* **(d) Limits:** unchanged until (c) is adopted. *Since row 231:* compose sizes `memlock` (64 MiB) and `nofile`
  (65 535), and the banner's `read_ring=` reports the ring ([`../../deploy/README.md`](../../deploy/README.md)
  §Container settings).
* **(e) Folios:** every arm within 20 % of H in both states: the cache is the real inode's, and row 197's verdict
  (W0 stays) holds in containers on this host.
* **(f) Not conclusive here:** Docker under SELinux enforcing (B+U's `EACCES`), and absolute µs.

## 7 · Invariants

What the code depends on and the types do not enforce, each pinned by a named test.

* **One index per series, never per session.** `FrameStore` is opened once and shared by
  `Arc`; 16 B per frame in memory, immutable after open. A per-session store would cost 512 MB instead
  of 512 KB at a thousand readers (32 000 frames). *Corrected 2026-10-16, row 251:* this said 12 B, 384 MB and
  384 KB — the on-disk entry; `Vec<(u64, u32)>` pads to 16. `sessions_share_one_store_rather_than_opening_their_own`.
* **The bytes quinn sends are process-private.** The read path copies into a buffer from
  `media/frame_pool.rs`, hands that buffer to quinn and gets it back on acknowledgement; it
  never hands quinn a mapping — which is why `server/` has no mapping at all; the mmap variants
  live in `lab/`. `a_handed_off_frame_is_the_buffer_itself_and_comes_back_when_dropped`.
* **A ring is never built where `RWF_NOWAIT` is refused.** Otherwise every warm tile would
  go through it, the `uring` variant's +131–142 % CPU on hits. `lazy_ring_is_never_built_without_nowait`.
* **A buffer is never grown or reused while the kernel owns it.** Dropping a ring drains its
  reads first, retrying an interrupted wait; a ring that fails with reads in flight leaks the
  slots' buffers with a WARN rather than free them. An abandoned fill read is settled before its
  buffer is reused. *Corrected 2026-10-03:* the drain gave up on any failed wait and the slots were
  then freed under a live read.
  `dropping_a_reader_mid_read_waits_for_the_kernel`, `an_abandoned_read_ahead_is_awaited_before_its_buffer_is_reused`.
* **A tile read dropped mid-way leaves its frame readable.** A slot's pooled read stays in the slot until it lands, as a
  ring read does; before row 254 `wait` took it out first, and the next read of that frame sliced an empty buffer.
  Latent while the session loop awaits every read. `a_tile_read_dropped_mid_way_leaves_its_frame_readable`.
* **A reader holds a buffer only while it holds a frame.** A hand-off takes the buffer rather than refilling it,
  so a session asking nothing keeps no frame buffer (row 255: 1–29 MB a session before).
  `a_tile_reader_holds_no_buffer_once_its_named_frames_are_served`, `a_fill_that_names_nothing_holds_no_buffer`.
* **A fill never builds a ring.** `FillReader` has two buffers and the pool. `a_fill_never_holds_more_than_one_read_at_once`.
* **A fill keeps `FILL_WINDOW` advised past the named frame.** Otherwise its depth on the device is one blocking read. `a_fill_tells_the_kernel_what_follows_the_named_frame`.
* **Tile depth is `slots`, default `TILE_SLOTS`.** `naming_upcoming_tiles_starts_their_reads_before_the_current_one_finishes`.
* **A jump does not wait on the read-ahead it abandons.** A tile takes a slot with no read in flight first; before 2026-09-23 the wanted frame's read queued behind the dead one. Unpriced on a rig that misses. `an_abandoned_tile_prefetch_does_not_delay_the_frame_that_replaces_it`.

## 8 · Levers outside this decision

This ADR moves about a fifth of a frame's server CPU; the rest is per-datagram QUIC work, owned
by [`transport-conclusions.md`](../transport/transport-conclusions.md). Recorded so the read
path does not become the whole plan.

| Lever | Worth | Status |
| --- | --- | --- |
| **`max_udp_payload_size` 1472 → 4000 B** | **−35 % CPU, +55 % throughput** with a quinn peer — the largest effect measured anywhere in this investigation | **Closed for browser clients**: Chromium 141 advertises 1 472 and quinn takes the smaller bound; no datagram above 1 472 in 85 k with the server's bound at 4 000 and 8 972. Reopen only for a native peer |
| **Serving depth ≥ 4** — `TILE_SLOTS` = 4, fill names one ahead | **+73.8 % asks/s** on missing tiles at depth 2; 2 → 4 a further +37 % on the sandbox | **Built**; unmeasured on a throttled link (§9) |
| `read_ahead_kb` and layout | miss rates moved by that one knob (§6 *Read-ahead*); the layout study measured **17.6×** on the same reads, against 2–4× for the read path (`git show read-path-evidence-2026-09-09:docs/disk-layout/`) | Not tuned; layout undecided |
| Bounded frame cache | −20.2 % CPU at a 0.92 hit rate | Lab only — needs a real ask trace |
| `MALLOC_MMAP_THRESHOLD_=1048576` in the unit | memory at rest after large-frame fills **−46 to −57 %**, CPU a tie to +5 % (§11, *Frames past 250 kB*) | Measured 2026-10-06, not taken: the owner's, if large frames ship. Idle sessions: no saving once readers give their buffers back (row 255, §9) |
| AEAD provider (`aws-lc-rs` for `ring`) | +3–5 % CPU at 32 KB, tie at 250 KB, +10–18 % RSS | **Measured 2026-09-10, not taken**; the feature was removed 2026-10-03 (`c9fce63`) |
| Release profile: `lto = "fat"`, `codegen-units = 1` | −4 to −8 % CPU per frame, every cell | **Landed 2026-09-10**; 4× longer release rebuild |

**Where scale actually binds.** A 250 kB copy is ~11 µs of a ~675 µs frame, and L2-resident
(measured on the copy into quinn, which the pooled hand-off has since removed); per-datagram
QUIC work runs out of CPU long before the copy runs out of memory bandwidth. The levers that
reach the bound are sending fewer datagrams and not doing the read at all.

## 9 · What is next

Nothing here blocks the code that ships. Order set with the owners (§2).

| # | Item | Why it is still open |
| --- | --- | --- |
| 1 | **P0 — ring vs pool on the production target** | §6. Sandbox, workstation and agent container gave three answers. **The cloud rig cannot answer it** (L7, 2026-09-18): burstable, stolen CPU, every p99 60–100 ms (§11, *A series past RAM*). A non-burstable host is needed. **Owner, 2026-10-16:** the production target will not be tested soon, so the items ordered after P0 go ahead, built for the best case the project can reach |
| 2 | **`server_ab.sh` on the workstation** | **Done 2026-09-09**: cold depth 4 −42.1 %, 16/16, RESOLVED, where the sandbox missed the bar (§11, *Serving depth*). Still one bare-metal host and untested on the production instance type — that is P0's run |
| 3 | **Throttled link** (20 Mbps, 50 ms, 1 % loss, cold tiles, client depth 4) | Predicted tie: the wire hides the 0.2 ms depth 2 → 4 saving. Unmeasured |
| 5 | **Deploy limits in the manifest** | `LimitMEMLOCK` / `LimitNOFILE` or `CAP_IPC_LOCK`, and `check-fastpath` on the series volume (§6). Not in a unit file yet; `deploy/compose.yml` sets `memlock` and `nofile` since row 231 |
| 6 | **`read_ahead_kb` and series layout for tiles, per target** | on-demand missed 14–69 % at the stock value in the fill cells; on the cloud rig 128 against 2 048 was no clean result in any cell. A large value hurts only the fill's tail, which `FILL_WINDOW` fixed |
| 7 | **Park on the ring fd, drop the eventfd** | **Built 2026-10-16** (row 250), on the owner's decision in #1: a tie re-measured, 1 fd per missing session counted, [below](#7-built-park-on-the-rings-own-fd-rows-244-250). Was: ordered after P0; proposed as row 244 |
| 8 | **`io-uring` 0.7.14 → 0.7.15** | Drop-in. After P0. *Corrected 2026-10-16, row 251:* already in. `Cargo.lock` pins 0.7.15 since its first commit on this line (`427d3ce0`, 2026-10-03); the 2026-09 campaigns ran 0.7.14 (`b55b68db`'s lock), every row since on 0.7.15. Closed, never timed against 0.7.14 |
| 9 | **Bounded frame cache** | §8. Needs a real ask trace to size |
| 10 | **The two readers on the workstation** | the only full-variant measurement of `FillReader` and `TileReader` ran in the agent container (noise floor up to 24 %): direction and shape, not magnitude. Re-run there and replace those cells: `lab/scripts/workstation_run.sh`, built 2026-10-16 (row 262), not yet run (§12, *On the workstation, in one command*) |
| 13 | **Short io_uring completions on a regular file** | the lab now resubmits the tail and counts them; 0 in 1 032 workstation rows. Incidence on other hosts and sizes past 250 kB is unmeasured |

Numbers are kept because older records cite them; 4 is closed (§8), the missing ones closed or
built. **Not established anywhere**, named so they are not quoted as measured:
frames past 250 kB on a device or a real link (corrected 2026-10-06: CPU per byte and memory at
rest measured on loopback up to 16 MB, §11, *Frames past 250 kB*); storage faster than ~1.25 GB/s, where io_uring's 5
threads against the pool's hundreds might start converting (the workstation's 1.5–1.6 GB/s
semi-sequential ceiling was device-bound and may be the NVMe's own cache); `hybrid_lazyring`
on the 4 vCPU sandbox or the GitHub runner; a second bare-metal host.

### #7, built: park on the ring's own fd (rows 244, 250)

*Proposed 2026-10-15 by row 244 (RINGPARK; [`merge-readiness.md`](../merge-readiness.md) §Second round, S19 and
S20), taken on the owner's decision of 2026-10-16 (#1 above), built and measured by row 250.*

**Verdict: a tie on latency and CPU, and one fd per session that misses instead of two.** `UringReader` parks on
`AsyncFd::with_interest(ring.as_raw_fd(), Interest::READABLE)` and clears readiness on each wake; the eventfd, its
registration and its read went, with 27 of the file's 149 product lines (the sketch said 26) and three `unsafe`
blocks with their `SAFETY` lines. `submit_and_wait` joined the first `impl` block. The reads, the wake and the
drain are unchanged: `COOP_TASKRUN` stays, and `drain_in_flight` waits in `submit_and_wait`, never on the parked
fd. What it costs is one invariant the types do not enforce, carried in one comment line: the `AsyncFd` is
declared before the ring, so it leaves the reactor before the ring's fd closes. No test can force that race.

| check | result |
| --- | --- |
| [`read_path_ab.sh`](../../lab/scripts/read_path_ab.sh) against `1d6cb6dc`, 12 rounds, arms interleaved by round, 256 asks, `product_tile` | `cold16_d1` p50 88.1 → 81.0 µs, −5.7 % (7/12), CPU per ask −8.8 % (8/12); `cold16_dW` p50 39.2 → 32.0 µs, −5.7 % (9/12), CPU −2.4 % (7/12): **a tie** on both under the 28.5 % rule. `miss_pct` 97.3–99.6 and a ring built in every cold row of both arms |
| the controls | `warm16`: no ring, a tie. `product_fill` builds no ring in any cell, and ties in each |
| `/proc/<pid>/fd` of the server, 16 and 64 tile sessions cold at depth 4 (`server_ab`), each arm twice | peak less idle is **2 × the sessions that built a ring** before (28 for 14, 24/12, 50/25, 48/24) and **1 ×** after (15/15, 16/16, 29/29, 25/25) |
| the park test, two reads | 2 wakes in 30 of 30 runs. Parking on an fd nothing signals fails it on the 10 s timeout; dropping `clear_ready` fails it at 79 829 wakes |

The host: 4 vCPU, ext4 on a virtio disk, `read_ahead_kb` 128, so the 250 kB stride misses. The cells are one
session at depth ≤ 4, far below where the host saturates, which was not measured; nothing is claimed at scale
but the fd. The run used the script's own loop and verdict with both binaries built first, since its worktree
build cannot run under a shared `CARGO_TARGET_DIR`. Its verdict keys on the label and the arm, so of the two
variants each run prints it keeps the last, `product_tile`; `product_fill` was read apart, by `pos`. *Fixed
2026-10-16, row 257:* the script copies each binary out, rebuilds HEAD after the base under a shared target, refuses
two identical arms, and gives each reader its own verdict.

**Corrected 2026-10-16 (row 250), two claims of the proposal.** It said `seq1g` builds no ring: `product_tile`
built one in every `seq1g` row of both arms, on 1.6–2 % misses. It ties (p50 −1.7 %, CPU −5.3 %) and stays a
control. It said the park test's wake count would catch a dropped `clear_ready`: with one read it does not, since
the first wake is the one that carries the completion and readiness left set costs nothing until the next park.
The test now makes two reads.

### Next round for the readers (row 251)

*2026-10-16. Theory and audit at `1d6cb6dc`: nothing built or timed; an effect marked (D) is derived. The owner ruled
on 2026-10-16 that P0 will not run soon, so the project builds for the best case it can reach and "after P0" gates
nothing below. #7 is row 250's and is taken as landed (one fd per tile session that misses); nothing here re-proposes
it.* Read: `server/src/media/` whole, `transport/pipeline.rs`, `planner.rs`, `banner.rs` and the session loop in
`server.rs`. Corrected in place by this row: #8 above (0.7.15 has shipped since 2026-10-03) and §7's index size.

**Findings, ranked by gain per risk.** *Kind*: **R** small enough for a review row; **S** structural, a proposal
first (CLAUDE.md); **M** needs a measurement first. Lines are product lines by a sketch, not built.

| # | Finding (where) | Verdict · cost · lines | Kind · row |
| --- | --- | --- | --- |
| 1 | **A tile read cancelled on the pool path panics the next read of that frame.** `wait` takes the `JoinHandle` out of the slot before awaiting it (`read_path.rs:412–417`), and `escalate` has already moved the buffer into the blocking task (`:404`). Dropped there, the slot stays keyed to its frame with no read and an empty buffer; the next `read` finds it held (`:320`), waits on nothing and slices `..len` of an empty buffer (`:339`): a panic. The ring path puts its read back before awaiting (`:421`), so it is safe. Latent: `steps` awaits every `serve` to its end (`server.rs:370`); it goes live the day a `select!` races a read (row 249's one queue is a candidate) | **do** · await the handle in place, clear `read` once landed · ±1 | R · 254 |
| 2 | **The ring's refusal WARNs once per session** (`read_path.rs:243`). Past the memlock ceiling (§6: ~940 rings at 8 MiB, ~7 500 at compose's 64 MiB) every new tile session that misses logs it, a flood at exactly the scale where it fires; the session line's `ring=false` already counts each one | **do** · once per process · +2 | R · 254 |
| 3 | **An idle session keeps up to six frame buffers.** A tile hand-off refills its slot from the pool at once (`read_path.rs:338`), a fill hand-off likewise (`:163`), and a finished fill keeps its spare (`:156`): `slots` + 2 frame-sized buffers per session that has read, held while it asks nothing — ~1 / 3 / 29 MB a session at 164 kB / 499 kB / 4.8 MB (D), against the ~75 KB an idle session otherwise costs ([`transport-idle-sessions.md`](transport-idle-sessions.md)). `POOL_CAP` (`frame_pool.rs:356`) bounds the spares, not what readers hold. Fix: a reader holds a buffer only while it holds a frame — hand off with `mem::take`, take from the pool where a read begins, give an idle fill's spare back. The allocator may keep what is freed (§11, *Frames past 250 kB*), hence the measurement | **landed** (row 255): idle RSS ×0.02–0.21, CPU a tie or lower · +3 | M → R · 255, *Idle sessions' buffers* below |
| 4 | **Row 209's frame cache pays where it gives nothing back.** Its cost (+25–36 % CPU a frame) is a lone session re-asking its own frames, which its client can hold; its gain (−17–22 %, half the peak RSS) is a second session asking. Admitting on a second *session's* ask instead of a second ask (`claim_fill` is keyed by frame alone, `lab/disk-access-bench/src/frame_cache.rs:65`) should keep the gain and drop the cost (D). Row 209's suspected mechanism is checkable alongside: a buffer grown by `fit` is zero-filled by `resize` (`read_path.rs:65–69`). *Measured 2026-10-16 (§13, row 256): B1s matches B0's RSS on a lone session and B1's when shared, its CPU gain is inside the resolution, so row 209's trade-off stands; B1z keeps B1's lone cost, so the zero-fill is not it* | **measure** on row 209's rig · lab +10; the port is a proposal | M → S · 256 |
| 5 | **The tile reader repeats itself.** `Slot.at` and `.len` copy its `key` (`read_path.rs:255–264`, set at `:366–368`); a `#[derive(Default)]` slot replaces the 9-line literal (`:297–306`). The unread tail is submitted at two `unsafe` sites (`:387–395`, `:437–444`): one `Slot` method that submits it *and* sets `read` establishes the invariant in one place, one `unsafe` block fewer. Two `spawn_blocking` tails (`:79–86`, `:399–408`) are one helper; hits and misses are counted twice (`:195–201`, `:332–336`). `ReadStats::miss_rate` is `#[cfg(test)]` (`:57–63`) while the session line computes its own (`pipeline.rs:144–151`), so `read_stats_report_the_session_miss_rate` pins arithmetic the product never runs: the line should call it. Names: the fill reader is `seq` (`pipeline.rs:45`, `:115`, `:121`, `:138`); `escalate` has `slots` the count beside `slots: s` the vector (`:383–384`); `if i == 0 { span } else { upcoming[i - 1] }` (`:319`) is `once(span).chain(upcoming)`. `:111–112` gives as the fill's reason for no ring "a sequential walk is read-ahead's best case", the claim §2 retracts; the reason is one read in flight under `FILL_WINDOW`. `READ_WINDOW` (`frame_store.rs:15–17`) is a test constant named for a product concept gone since 2026-09-23 | **do**, after row 250 · −30, one `unsafe` block fewer | R · 257 |
| 6 | **Two waits on the executor, never timed where they bite.** The fill's `WILLNEED` runs inline (`read_path.rs:153` → `:181–193` → `frame_store.rs:135–147`); it copies nothing but allocates the folios and submits their reads in the caller (`force_page_cache_ra`, §*Read-ahead and folios*), so it can wait on reclaim and on the block layer's request tags (not traced at a pinned kernel) — the owners' regime of series past RAM and thousands of sessions. Its one timing is a 64 KiB hint on a guest-cold cache (224 against 178 µs co-tenant gap, 2026-09-05). `TileReader::drop` (`:487–500`) drains in `io_uring_enter` on the executor (`uring_reader.rs:114–131`): one device read, ~1–5 ms on cloud block storage (§11, L7), for each session that ends mid-batch (a closed tab). Candidates: the advice detached on the pool (+3; a 24–34 µs hop per MiB walked, awaited by no one); the drain moved to `spawn_blocking` inside a guard whose own `Drop` drains, so a pool that drops the task still never frees a live buffer (+15, one `SAFETY`). The third executor stall, the whole-frame inline copy at 2.8–16 MB, is levers.md's INLINECAP (#10): same rig | **measure** | M · 258 |
| 7 | **Tile names past the slots wait for a slot.** The planner holds `ASKS_AHEAD` = 8 (`planner.rs:7`) and names every frame ask behind the served one (`:96–103`); `TileReader` starts `slots − 1` = 3 (`read_path.rs:316`). One `WILLNEED` per further name puts it on the device with no buffer, ring entry or thread. **Reopens §5's ahead-N row with new evidence:** its 4.6–4.9× (2026-09-05) was one read in flight against no look-ahead, which `TILE_SLOTS` has since delivered (look-ahead *is* depth, §11, *Line 221*), so within the slots it stays closed; past them it is untried. It bites only when a client keeps more than four asks out; its sweep loss (misses 7 → 56) and finding 6's executor cost carry over | **measure** · +6 | M · 259 |
| 8 | **`FILL_WINDOW` is 4 MiB at every frame size** (`read_path.rs:26`). At `ffdm_d`'s 4.8 MB it covers less than the frame after the named one, at 16 MB a quarter of it, and the extension rule (`:184–190`) re-advises every frame. A window of `max(4 MiB, 2 × the named frame)` (D). Row 197 ran `ffdm_d` cold under W0 but varied the advice, not its size | **measured 2026-10-16: not adopted** — a tie on the cold fill ([below](#measured-row-260-the-fill-window-stays-4-mib)) · +1 | M · 260 |
| 9 | **A ring completion waits for its submitter's thread.** `COOP_TASKRUN` (`uring_reader.rs:32`) posts a completion as task work on the submitting thread without an IPI: a sleeping thread is woken, a running one runs it at its next syscall or tick. A reader parked on another worker waits that long while the submitter seals a large frame in user space. From the kernel's task-work notification (`TWA_SIGNAL_NO_IPI`), not traced at a pinned kernel and not timed; without the flag, an IPI a completion | **measure**, after row 250 · ±1 | M · 261 |

**Kept**, with the reason:

* Releasing an idle session's ring (8.7 KiB of memlock, one fd after row 250): the next miss rebuilds it for 15.6 µs,
  and the ceiling has been a deploy setting since row 231. A ring per runtime stays rejected (1.36–1.45× slower, §5).
* A failed `io_uring_enter` on submit (`uring_reader.rs:71`, e.g. `EAGAIN` under memory pressure) ends the session
  instead of sending that frame to the pool; the entry stays queued and the drain waits for it, so it is safe.
  Incidence unmeasured; the session's `WARN` would show it.
* A read error (EIO, a truncated file: `read_path.rs:84`, `uring_reader.rs:83–84`) ends the session rather than
  refusing the frame: a protocol choice, not the reader's.
* `EINTR`: `read_exact_at` retries it, `RWF_NOWAIT` does not sleep, and the drain retries it with `EBUSY`. SQ full and
  CQ overflow cannot happen: a session never holds more reads than `slots`, the ring's SQ size.
* `reap`'s `Vec` (`uring_reader.rs:78`) and the pipeline's span list per frame: below any noise floor (§11).
* SQPOLL, registered buffers, mmap, `O_DIRECT`, `IOPOLL`, tokio's driver: closed (§5, §13), no new evidence.
* The comment budget: every reader file is inside it (`read_path.rs` 0.09, `uring_reader.rs` 0.14, `frame_store.rs`
  0.12, `pipeline.rs` 0.07, `planner.rs` 0.09; `frame_pool.rs` 0.20 under its floor of 10). The one stale comment is
  finding 5's.

**The protocols.** Common to each: an A/A arm (a second process of the base) sets the resolution, the p90 over rounds
of |A′/A − 1| per cell and metric; a difference counts beyond it with ≥ 80 % of rounds agreeing in sign; arms run in
`lab/scripts/order.py`'s order inside each round; every frame is checked by XXH3-64 (`server_ab --coded`); the host's
kernel, filesystem, `read_ahead_kb`, THP mode and glibc are printed; nothing is claimed past where the host saturates,
which each row reports.

* **255 IDLEBUFFERS.** *Arms:* R0 today, R0′, R1 (buffers only while a frame is held); R0m and R1m the same under
  `MALLOC_MMAP_THRESHOLD_=1048576` (§8). *Cells:* `ct_lidc` 164 kB, `dbt12_ea1141` 499 kB, `ffdm_d` 4.8 MB, warm; 64
  sessions in turn, each a depth-4 batch of 16 tiles and a 32-frame fill, then held open asking nothing
  (`idle_session_cost.sh`'s hold, or a `server_ab` option added in the lab); 16 rounds. *Metrics:* server RSS with all
  64 idle (the claim), peak RSS, CPU per frame over the active phase. *Predictions (D):* R0 idle ≈ 64 × (1 / 3 / 29)
  MB over the 75 KB baseline; R1 near the pool's cap of 64 frames plus what glibc keeps, R1m lower still at 499 kB and
  4.8 MB; CPU a tie. *Rule:* R1 lands if its idle RSS is below R0's beyond the resolution in ≥ 2 of 3 cells and its
  CPU is worse beyond it in none; if only R1m separates, R1 lands and the setting goes to the owner beside §8's row;
  otherwise closed here.
* **256 CACHESHARED.** *Rig:* row 209's (`frame_cache_ab.py`, `--features lab-frame-cache`), its cells and 16
  rounds. *Arms:* B0, B0′, B1 (admit on a second ask), **B1s** (admit on a second session's ask; a session's own repeat
  admits nothing), B1z (B1 with `fit` replacing a short buffer by `vec![0; n]`: the mechanism check, not a candidate).
  *Cells:* four sizes × 1 and 16 sessions × passes 1, 2 and **3** (a lone session's all-hit pass, which row 209 did not
  run). *Metrics:* CPU per frame per pass, peak and rest RSS. *Predictions (D):* B1s at one session ties B0 on every
  pass; at 16 sessions pass 2 within row 209's ×0.78–0.83; B1z narrows B1's lone pass 2 if a fresh buffer is the cost.
  *Rule:* B1s goes to the owner as a structural proposal, a net rather than a trade-off, if at 16 sessions its pass 2
  beats B0 beyond the resolution in ≥ 2 of 4 cells and at one session no pass is worse beyond it; otherwise row 209's
  trade-off stands. B1z decides nothing; it confirms or retracts row 209's "likely mechanism".
* **258 EXECGAP.** *Host:* a device-bound volume, a series larger than the host's cache (§12, *Make the miss real*):
  the workstation or a non-burstable VM, never L7's rig; `nr_requests` recorded. *Arms:* G0, G0′, G1 (the fill's advice
  on `spawn_blocking`, not awaited), G2 (the drain on the pool under its guard); each a build of the base with that one
  change, interleaved as `runtime_ab.sh` runs builds. *Cells:* (a) 16 and 64 cold fills of 499 kB frames on disjoint
  ranges beside one warm co-tenant asking one tile at a time; (b) 16 tile sessions at depth 4 whose client closes each
  connection mid-batch, beside the same co-tenant; (c) INLINECAP's 2.8–16 MB warm hits, if queued with it. 12 rounds.
  *Metrics:* the co-tenant's ask p50, p99 and max (the gap a stalled worker leaves); the fills' wall, misses and CPU
  per frame. *Rule:* G1 (G2) lands if the co-tenant's p99 beats G0's beyond the resolution in a cell below
  saturation and the fills' wall, misses and CPU are worse beyond it nowhere; otherwise closed as "costs the executor
  nothing measurable on this device".
* **259 TILEWILLNEED.** *Arms:* T0, T0′, T1 (one `WILLNEED` per name past the slots, each frame once per batch).
  *Cells:* cold strided tiles at 16 KiB and 250 kB, the stride re-derived past `read_ahead_kb` on the day (§12), on a
  fixture larger than the cache; client depth 8 (names past the slots exist) and 4 (the control, T1 ≡ T0 by
  construction); a sweep cell, tiles in file order at 250 kB and depth 8, where 2026-09-05 lost; 1 and 16 sessions;
  12 rounds. *Metrics:* wall per 16-tile burst, CPU per ask, misses and `in_flight` from the session line.
  *Predictions (D):* depth 8 strided ×0.75–0.9 of T0's wall (v35's 4 → 16 was +28 %); depth 4 a tie; the sweep a tie or
  a loss. *Rule:* adopted if strided depth 8 beats T0 beyond the resolution at both sizes and no cell, the sweep
  included, is worse beyond it; a sweep loss alone sends it back as a routed choice (advise only names not contiguous
  with the one before), not adopted here. The control not tying voids the run.
* **260 FILLWINDOW.** *Arms:* W0, W0′, Wf (`max(4 MiB, 2 × the named frame)`). *Cells:* `ffdm_d` 4.8 MB, a synthetic
  16 MB series (`runtime_ab.sh`'s generator), `ct_lidc` 164 kB as the control (Wf ≡ W0); cold through fresh
  `writer_bench direct` copies (row 197), never eviction; one fill and four; the host's ext4 and a loop XFS; 16 rounds.
  *Metrics:* cold fill wall per frame, misses, CPU per GB, time to the first frame. *Rule:* adopted if Wf beats W0
  beyond the resolution on wall in both large cells on at least one filesystem and is worse beyond it on nothing; the
  control not tying voids the run.
* **261 RINGCOOP.** After row 250. *Arms:* C0 (`COOP_TASKRUN`), C0′, C1 (no setup flag). *Cells:* cold tiles at depth
  4, 16 KiB and 250 kB, one session, alone and beside eight warm fills of 4.8 MB frames on the same workers, server
  cores under 80 % busy; 12 rounds. *Metrics:* cold tile p50 and p99, CPU per ask. *Predictions (D):* alone a tie;
  beside the fills C1's p99 lower, its CPU a tie or higher. *Rule:* C1 adopted if its p99 beats C0's beyond the
  resolution beside the fills with p50 and CPU worse beyond it nowhere, and the park test passes on it; otherwise
  closed, and §10's reason for the flag cites this row.

**Rows drafted**, in rank order, numbered from 254 as assigned:

| row | name — question | kind | needs |
| --- | --- | --- | --- |
| 254 | **TILECANCEL** — a cancelled pool read leaves its slot servable (finding 1), and the ring's refusal warns once per process (finding 2). Test: a runtime with one blocking thread held busy, so the pool read cannot land; poll `read` once, drop it, read the frame again, bytes exact; mutated by restoring the `take`, it must fail | review row | — |
| 255 | **IDLEBUFFERS** — does holding a buffer only while a frame is held cut an idle session's RSS at no CPU cost? (finding 3, protocol above) | measure, then review row | — |
| 256 | **CACHESHARED** — does admitting on a second session's ask turn row 209's trade-off into a net? (finding 4) | measure, then proposal | row 209's rig |
| 257 | **READERTIDY** — finding 5's cuts, no behaviour change: the server's suite green, `read_path_ab.sh` ties every cell (§12), and the merged `Slot` submit mutated (drop the `read = Some`) fails a test | review row | rows 250, 254 |
| 258 | **EXECGAP** — do the fill's inline `WILLNEED` and the tile drain stall co-tenants on a device-bound volume? (finding 6; INLINECAP joins it) | measure | a device-bound host |
| 259 | **TILEWILLNEED** — does advising tile names past the slots buy depth without memory? (finding 7) | measure | — |
| 260 | **FILLWINDOW** — does a window of two frames beat 4 MiB on frames past 1 MiB? (finding 8) | measured: not adopted | — |
| 261 | **RINGCOOP** — does `COOP_TASKRUN` delay ring completions beside busy workers? (finding 9) | measure | row 250 |

**Row 257, built (2026-10-16): finding 5's cuts, no behaviour change.** `Slot` lost `at` and `len`, both read from its
`key` now, and derives `Default`. `Slot::submit_tail` submits the unread tail *and* sets `read`, so the invariant the
`SAFETY` line rests on is established at one site instead of two; the two `spawn_blocking` tails are
`read_rest_on_pool`. Hits and misses were already counted once (row 227's D3). The session line calls
`ReadStats::miss_rate`, no longer test-only; the fill reader is `fill` in `pipeline.rs`; the upcoming loop is
`once(span).chain(upcoming)`; the fill's reason for no ring points to §11, *Fill at scale*, which now states it;
`READ_WINDOW` is `TEST_CHUNK`. `read_path.rs` went from 506 to 484 product lines (the sketch said −30) and from 2
`unsafe` blocks to 1. One field changes meaning without changing behaviour: `filled` no longer rises to the frame's
length when a pool read lands, since nothing reads it there, and the field says so. No test had a pool read finish a
partial probe (every pooled test probed nothing), so `the_pool_finishes_a_partial_hit_from_where_the_probe_stopped`
now covers both readers.

| check | result |
| --- | --- |
| the server's suite | 128 pass with default features, 118 without `uring`; `scripts/gate.sh` green except `check_equivalence.sh --local` (nginx 403 under a 0700 scratch directory, the known environment caveat) |
| `submit_tail` without `read = Some` | `a_frame_cut_from_the_file_fails_the_ring_read_instead_of_hanging` fails. It is the only one: on a cached file the ring lands inside `submit`, so the byte tests cannot see a read nobody waits for |
| the pool tail read from the frame's start, or landed at the buffer's front | the new test fails, and no other |
| `miss_rate` over hits; `count` swapped; one name instead of `named`; the tile hand-off a byte short | `read_stats_report_the_session_miss_rate`; it and `a_fill_never_holds_more_than_one_read_at_once`; three look-ahead tests; eight byte tests |
| a short ring completion that forgets what landed before | the short-read test hangs: it times out instead of passing |
| [`read_path_ab.sh`](../../lab/scripts/read_path_ab.sh) | against unified's `d2535bd6`, 12 rounds, arms interleaved by round, 256 asks, each reader its own verdict | **a tie in all 8 cells**, p50 and CPU per ask. p50: fill `warm16` −4.6 % (7/12), `cold16_d1` +10.9 % (9/12), `cold16_dW` −4.4 % (8/12), `seq1g` −1.0 % (7/12); tile `warm16` −9.2 % (8/12), `cold16_d1` −6.9 % (7/12), `cold16_dW` +5.0 % (7/12), `seq1g` −1.3 % (6/12). CPU per ask within −10.5 to +8.3 %, no sign in more than 9/12. Tile cold `miss_pct` 98.4–99.6 with a ring built in every row of both arms. The host: 4 vCPU, ext4 on a virtio disk, `read_ahead_kb` 128, two other rows' builds at nice 19 on CPU 3; one session at depth ≤ 4, far below where it saturates (not measured). A first run is void: under the shared target HEAD's build counted as fresh and both arms ran the base, which the script now refuses |

### Idle sessions' buffers (row 255)

*2026-10-16, row 255: finding 3, built and measured by the 255 protocol above.*

**Verdict: R1 lands.** A reader holds a buffer only while it holds a frame: a hand-off takes the buffer with
`mem::take` instead of refilling it from the pool, `fit` takes one from the pool where a read begins, and
`Ahead::Idle` carries no buffer, so a fill that names nothing drops its spare. +3 product lines in `read_path.rs`.
Idle RSS with 64 sessions held is **×0.21 / ×0.086 / ×0.021** of R0's at 164 kB / 499 kB / 4.8 MB, 16/16 rounds
each, every cell beyond the resolution; CPU per frame is worse beyond it in no cell. The rule's first clause holds,
so R1m decides nothing: `MALLOC_MMAP_THRESHOLD_` adds no idle saving once readers give their buffers back (§8).

| cell | R0 idle RSS | R1 | R1m | R0 − R1, a session | CPU per frame R1/R0 |
| --- | --- | --- | --- | --- | --- |
| `ct_lidc` 164 kB | 80.7 MB | 16.9 MB (×0.209, 16/16) | 17.1 MB | 1.0 MB | ×0.934 (11/16), tie |
| `dbt12_ea1141` 499 kB | 205.7 MB | 17.7 MB (×0.086, 16/16) | 18.2 MB | 2.9 MB | ×0.967 (13/16), tie |
| `ffdm_d` 4.8 MB | 1 868 MB | 39.9 MB (×0.021, 16/16) | 38.2 MB | 28.6 MB | **×0.926 (16/16)**, beyond |

Resolution (p90 of |R0′/R0 − 1|): idle RSS 0.7–1.0 %, CPU 6.8–9.9 %. Peak RSS equals the idle reading in every run:
memory freed by a session stays with the pool or the allocator, so RSS never falls. Finding 3's prediction, `slots`
+ 2 buffers a session (~1 / 3 / 29 MB), is what R0 − R1 measured. What R1 keeps idle, 160–520 KB a session over
the server at start, is the pool's few buffers (sessions read one at a time, so a handful circulate) and the
allocator's, divided by 64; that it stays flat at other session counts is derived, not measured. The ×0.93 CPU at
4.8 MB is unexplained (D: R0 faults in up to six fresh 4.8 MB buffers per session while every earlier session holds
its own, R1 reuses the pool's); it is not a claim.

| check | result |
| --- | --- |
| `a_tile_reader_holds_no_buffer_once_its_named_frames_are_served` (hit, pool, ring) | mutated by refilling the slot on hand-off: fails |
| `a_fill_that_names_nothing_holds_no_buffer` (hit, pool, an abandoned read-ahead) | mutated by refilling `cur` on hand-off: fails. A finished fill keeping its spare cannot be written: `Ahead::Idle` has no field |
| exactness | every frame of 240 runs checked by XXH3-64 against ingest's coded files (`server_ab --coded`); 0 errors, all 64 sessions open at each RSS reading |

The rig: two release builds of `series-server` from one tree, R0 with the base's `read_path.rs`
(`d2535bd6`), R1 with this row's; `server_ab --mode idle` (64 sessions in turn, each 16 tiles at depth 4 then a fill
of up to 32 frames from frame 0, 3 s keep-alives, RSS read after a 1 s hold), driven by
[`idle_buffers_ab.py`](../../lab/disk-access-bench/idle_buffers_ab.py); 16 rounds plus a pilot round
(`rows-idlebuffers.jsonl`, `rows-idlebuffers-pilot.jsonl`), arms in `order.py`'s order, 42 min. CPU is the server's
over the active phase, handshakes included. Host: 4 vCPU agent container, kernel 6.18.44, ext4, `read_ahead_kb` 128,
THP `madvise`, glibc 2.39, warm; server on cores 0–1, client on 2–3, where other rows' builds ran at nice 19 on
core 3. One session reads at a time, far below where the server saturates, which was not measured; nothing is
claimed for concurrent sessions.

### Measured (row 260): the fill window stays 4 MiB

*2026-10-16, on the protocol above, built and run by row 260.* **Verdict: not adopted.** Wf's cold fill ties W0's in
both large cells on both filesystems, alone and four at once, on every metric the rule names; nothing is worse beyond
the resolution, and the 164 kB control ties on all of them, so the run stands. What Wf changes is the cache it
leaves: ×0.74–0.94 the folios a frame at 16 MB, beyond the resolution in three of four cells — not a rule metric.

| filesystem, set, fills | W0 cold fill | Wf ×W0 frames/s · resolution | misses W0 → Wf | first frame ×W0 | CPU a GB ×W0 |
| --- | --: | --- | --- | --- | --- |
| host ext4, 4.8 MB, 1 | 120 frames/s | ×1.049 · 68 % | 3 → 3 of 4 | ×0.931 | ×0.949 |
| host ext4, 4.8 MB, 4 | 383 | ×1.113 · 41 % (81 %) | 4.5 → 4 of 16 | ×0.801 | ×1.020 |
| host ext4, 16 MB, 1 | 41.9 | ×1.036 · 60 % | 20 → 20 of 20 | ×0.800 | ×0.992 |
| host ext4, 16 MB, 4 | 144 | ×0.987 · 70 % | 20 → 20 of 80 | ×1.119 | ×0.996 |
| loop ext4, 4.8 MB, 1 | 153 | ×0.973 · 52 % | 3 → 4 | ×0.941 | ×0.968 |
| loop ext4, 4.8 MB, 4 | 455 | ×1.070 · 26 % | 4 → 4 | ×0.846 (81 %) | ×0.937 |
| loop ext4, 16 MB, 1 | 59.3 | ×0.954 · 15 % | 20 → 20 | ×0.952 | ×1.022 |
| loop ext4, 16 MB, 4 | 118 | ×0.892 · 149 % | 20 → 20 | ×0.856 | ×1.002 |
| control, 164 kB, both, 1 and 4 | 5 070–14 500 | ×0.922–1.042 | 4–14, ±1 | ×0.929–1.085 | ×0.960–1.033 |

Medians over 16 rounds, Wf's paired by round against W0; the resolution is the p90 of \|W0aa/W0 − 1\| per cell and
metric, and no Wf cell is beyond it with ≥ 80 % of rounds agreeing on any cold-fill metric. The hits, the fill on the
cache and the forced miss the rig also times tie too. The 16 MB fill misses every frame under both windows: its
named frame's read starts with the advice, so a wider window lands only frames the walk has not reached.

* *A window of two frames beats 4 MiB past 1 MiB (D):* **not borne out**. At 4.8 MB, W0 restarts a 4 MiB window at
  every frame (a test pins it) and still misses no more than Wf; at 16 MB both miss every frame.
* *The control Wf ≡ W0 at 164 kB:* **held**, by construction (a test pins the advice equal) and on every metric.

The rig: row 197's, [`lab/container-bench/readahead.py`](../../lab/container-bench/README.md) with `ROW=260`, rows in
`rows-window.jsonl`. `ffdm_d` (4 × 4 808 kB) and `ct_lidc` (100 × 164 kB) as ingest coded them, and 20 random 16 MB
frames; every measure on its own fresh `writer_bench direct` copy (0 pages cached after any), so cold without
eviction; W0, W0aa and Wf in `order.py`'s order in each cell; 702 336 frames checked by XXH3-64, none inexact;
`--mutate shift|short` failed every arm. The host: kernel 6.18.44, ext4 on `/dev/vda` (`read_ahead_kb` 128), 4 vCPU,
16 GB, THP `madvise`, glibc 2.39, other rows' builds at nice 19 on CPU 3. **Deviation:** the protocol's loop XFS was
not run — `mkfs.xfs` is not installed and the rules forbid installing it — and a loop ext4 (2 GiB image on the host
disk, `read_ahead_kb` 2 560) stands in, a second read-ahead regime rather than a second filesystem; XFS stays
unmeasured. A first run on the code before rows 256–257 merged was cut at round 13 by a container restart; its 13
rounds showed the same ties and are not used. **Saturation**, not swept: four 16 MB fills on the host deliver ~2.3 GB/s, three
quarters of it frames another fill had already read; nothing is claimed past these cells.

The arm, `FillReader::windowing_two_frames` (lab), and its tests stay on `claude/wip-260-FILLWINDOW`, for the owner to
drop.

## 10 · How it is built

### How a read works

The planner's `Next` picks the reader; each is built on the first frame of its kind, and keeps
the series' `FrameStore` it was built with: the ring registers that store's file and the slots key
on its offsets, so a reader can serve no other store.

**Fill — `FillReader`.** Two buffers. `next` is the frame the planner will ask for after this
one, and its pooled read is running by the time `read` returns; only it may still be with the
pool. Then the reader advises `FILL_WINDOW` past `next`, extended a quarter window at a time (one
syscall per megabyte walked) and restarted on a seek. Frames sit in index order in the bundle,
so the bytes after `next` are the frames after it.

**Tiles — `TileReader`.** `slots` frames: current first, then upcoming that fit, then wait — the
measured order. The probe is the whole frame; a shortfall goes to the ring, or to the pool where
the ring is refused. A new read takes a slot with no read in flight when there is one.
`WTPACS_READ_PATH` is resolved once at server start, and an unknown value is warned about and read as
`auto`. The `uring` lever, `probe: false`, was removed 2026-10-03 (§Flags). **Corrected 2026-10-03:**
this said "once in `TileReader::new`"; it was read, and warned about, in every session's pipeline.
`Ring` is not an `Option`: a refused ring must be neither retried on every miss nor fail the
ask, so `Off` means both "never wanted" and "refused".

**The ring** is set up with `COOP_TASKRUN`: `SINGLE_ISSUER` and `DEFER_TASKRUN` are unusable
because tokio migrates a task between workers, and blocking in `io_uring_enter` would be the
stall this exists to prevent, so the reader parks on the ring's own fd, readable interest only, and
clears readiness on each wake (*since row 250, 2026-10-16*: it parked on a registered eventfd, plain
`register_eventfd`, never `_async`, §11). The `AsyncFd` is declared before the ring, so it leaves the reactor
before the ring's fd closes; the other order deregisters a number the process may have given another session. A
short completion is resubmitted for its tail. Buffers are **not** registered: that pins pages
against `RLIMIT_MEMLOCK`, and the lab variant that registered them tied on misses.

Also: the pool path reads ahead too (the `JoinHandle` is held, not awaited); delivery stays in
ask order — reading *n+1* early is pipelining, not reordering; the planner bounds `in_hand` at
`ASKS_AHEAD` and stops upcoming at the first `Fill` or `EndSession` (it also streamed a
`RequestFrames` batch rather than collecting it, until that message left the wire on 2026-10-03). The retired 64 KiB `READ_WINDOW` lives on only
as `read_campaign.rs`'s own, for the variant that reproduces the capped probe; the tests' 64 KiB is `frame_store.rs`'s
`TEST_CHUNK` (renamed from it 2026-10-16, row 257). `--no-default-features` alone builds
it: ring is a plain dependency feature (*corrected 2026-10-14:* this said to add `--features crypto-ring`, a feature
that could not be turned off and is gone).

### The trap

On overlayfs or tmpfs, `RWF_NOWAIT` returns 0 for every read, hit or miss. A ring keyed only on
"the inline read came up short" would then serve every warm ask through the ring — the `uring`
variant, **+131 to +142 % on hits, RESOLVED**. The ring is gated on
`FrameStore::nowait_supported()`, not on the shortfall alone.

| `RWF_NOWAIT` | io_uring | Path |
| --- | --- | --- |
| honoured | available | inline hit; tiles take the ring on a miss; a fill stays on the pool |
| honoured | unavailable | inline hit, `spawn_blocking` on the miss |
| refused | either | one pooled `pread` per frame, ~2.5× worse per frame. **Never the ring** |

### Flags

No performance toggle: `TileReader` already chooses per session, and the variant a "miss-optimised"
flag would pick is the trap above. `WTPACS_READ_PATH=pool` is the **kill switch** (the pre-ring
path on tiles); an unrecognised value, `uring` included since its lever was removed, warns and
uses `auto`; a fill ignores it. `--force-pool-reads` (lab) clears the store's `nowait` at open, so every frame
misses and takes the pool — the state a refusing filesystem produces, so it trips the same
warning. It exists because eviction is not a lever ([`CLAUDE.md`](../../CLAUDE.md)
§Measurement). One saturate run over `queue_large`: 3 648 hits, 0 misses by default; 0 hits,
3 627 misses, `read_fast_path=pooled_pread` forced.

### Reporting

Default build, not behind `telemetry`. **Startup:** `read_fast_path=preadv2` or `pooled_pread`
(plus WARN). **End of session**, in `Drop` because a session ends several ways:

```
INFO session reads hits=… misses=… miss_rate=… fill_hits=… fill_misses=… tile_hits=… tile_misses=… named=… in_flight=… ring=… fills=…
INFO session path mtu=… rtt_us=… cwnd=… sent=… lost=… congestion_events=… datagrams_tx=…
```

* A **read** is a frame.
* `named` / `in_flight` are the peaks across both readers. A fill reports `named=2`,
  `in_flight=1`. A tile session at client depth 1 / 2 / 4 reports `named` 1 / 2 / 4;
  `in_flight` is how many of those actually missed (a hit is served inline).
* `ring=false` on a tile session with misses means the ring was refused or the build has no
  `uring` feature. A fill-only session is always `ring=false`. The refusal's errno is WARNed once per
  process, not per session: past the `memlock` ceiling every new session is refused.
* `session path` is quinn's counters, the server's half of the loss-regime question in
  [`transport-conclusions.md`](../transport/transport-conclusions.md) §1. `mtu` tops out at 1 472
  against Chromium; `mtu=1200` after a long session was quinn's black-hole detection pinning the
  MTU on ordinary loss, fixed in `quinn-proto` 0.11.18 (taken 2026-09-18). Seen twice, both under
  induced relay loss; the line postdates every archive, so older runs cannot be swept for it.

### Test plan

| Claim | Test |
| --- | --- |
| A miss is one pooled read however wide the frame | `a_missing_frame_costs_one_round_trip_however_wide_it_is` |
| Both readers reassemble every frame | `both_readers_reassemble_every_frame` |
| A named fill frame is not read twice | `a_named_fill_frame_is_read_before_it_is_asked_for` |
| A fill holds one read at a time | `a_fill_never_holds_more_than_one_read_at_once` |
| A fill advises a window past the named frame, per quarter window, restarted on a seek | `a_fill_tells_the_kernel_what_follows_the_named_frame` |
| An abandoned read-ahead is settled before reuse | `an_abandoned_read_ahead_is_awaited_before_its_buffer_is_reused` |
| Named tiles start before the current wait | `naming_upcoming_tiles_starts_their_reads_before_the_current_one_finishes` |
| A jump does not wait on the prefetch it abandons | `an_abandoned_tile_prefetch_does_not_delay_the_frame_that_replaces_it` |
| A tile read dropped mid-way leaves its frame readable | `a_tile_read_dropped_mid_way_leaves_its_frame_readable` |
| Slot count is a constructor argument | `a_tile_reader_holds_as_many_frames_as_it_was_given_slots` |
| A hit never builds a ring | `lazy_ring_is_not_built_when_every_read_hits` |
| No ring where `RWF_NOWAIT` is refused | `lazy_ring_is_never_built_without_nowait` |
| Dropping a ring mid-read waits for the kernel | `dropping_a_reader_mid_read_waits_for_the_kernel` |
| An interrupted wait does not end the drain | `an_interrupted_drain_still_waits_for_the_kernel` |
| A failed drain reports the read still in flight | `a_failed_drain_reports_the_read_still_in_flight` |
| A tile reader whose ring fails mid-read leaks its slots | `a_tile_reader_whose_ring_fails_mid_read_leaks_its_slots` |
| A parked reader is woken, a handful of times and not in a spin (an fd nothing signals hangs it; a park that never clears readiness spins; until row 250, the `_async` eventfd hung it) | `a_read_that_cannot_complete_inline_wakes_the_parked_reader` |
| The session line reports the miss rate | `read_stats_report_the_session_miss_rate` |
| The frame quinn sends is the pooled buffer, and it comes back | `a_handed_off_frame_is_the_buffer_itself_and_comes_back_when_dropped` |
| One store per series | `sessions_share_one_store_rather_than_opening_their_own` |
| `in_hand` cannot grow with ask rate | `the_loop_holds_no_more_than_asks_ahead` |
| Upcoming stops at Fill | `upcoming_stops_at_the_first_ask_that_is_not_a_frame` |
| Fill and EndStream on the wire | `empty_stream_frames_is_the_whole_series`, `end_stream_stops_a_fill_on_the_wire` |

Mutate every new test ([`CLAUDE.md`](../../CLAUDE.md)). The suite reads page-cached files, where
a completion lands before anything awaits it; only the park test covers the parked path.

## 11 · Evidence

The decisive numbers and their conditions; the full tables are at Provenance. Cells before
2026-09-10 drove the single `ReadCtx` (`product`, `product_ahead`) the two readers replaced.

### The rule every number below obeys

Re-running an identical configuration moves a median by up to 7 % within a run and ~11 % (p50)
across campaigns on these hosts. So:

> A difference counts only if **|median| ≥ 28.5 %** (the measured p90 drift) **and** sign
> agreement **≥ 0.8n**, **and** it keeps its sign across independent runs.

Everything else is a **tie** — not a small effect. `lab/scripts/read_path_split.py` applies it. The
rule is defined on **paired** per-cell deltas, not pooled medians per variant, and the two disagree
by about 2× on the comparison most wanted: `uring` against `hybrid_lazyring` on misses is
−41.9 % as a ratio of medians and −24.0 % (a tie) as the median of per-cell ratios, on the same
84 cells. It has been misread as a 42 % win twice; run `lab/scripts/pair_variants.py` first. Never
compare p50 across variants whose `peak_in_flight` differs.

### The ring on the miss, and where its margin comes from (2026-09-06)

Four hosts, six runs, 4 KiB–250 KB. `hybrid_lazyring` (inline probe, ring built on the first
miss — what ships for tiles) is **tied for cheapest CPU per read at every miss rate** and
**−61.8 / −64.4 % RESOLVED** against `pool` on misses. `pool_ringloop` holds the loop fixed to
split the two: the **ring** is **−42 to −73 % RESOLVED on misses on every host and run**; the
**loop** is a smaller, core-dependent term (nothing on 4 vCPU, −48 to −53 % on mixed cells at
8 CPU). Ring variants stay at **5 OS threads** to 128 readers where `pool` reaches 381. Re-measured
2026-09-08, `uring` against `hybrid_lazyring` on 16 KiB misses ties at depth 1 / 4 / 16, and its
hit penalty exceeds its miss saving everywhere: breakeven at 53 % misses at depth 4, 64 % at 16.

**The margin decays with frame size**: a round trip costs what it costs, and the rest of a read
scales with its bytes. `hybrid` against `pool` on misses is −62 / −58 / −46 % at 4 / 16 / 64 KiB
and **−24.8 %, a tie, at 250 KB** (`v22`; `v10` agrees). A 250 KB run on an 8 GB fixture agreed:
whole-frame io_uring against whole-frame `spawn_blocking` ties at 1–32 readers, while escalating
the pool read to the rest of the frame was **2.1× at one reader, 3.0–3.2× at 8–32**, identical
warm. On that ~1.25 GB/s device a blocking pool capped at four threads lost nothing at 32 readers.

### Re-measured on the code that ships (2026-09-09)

`read_campaign`'s `product` variant drives the shipped reader; 4 vCPU sandbox, depth 4, cold misses
98.8–100 %. At 16 KiB it ties `hybrid_lazyring` warm and cold; at 250 kB cold **`pool` was ahead**
(514 against 623 µs p50) — the size-dependence above. That variant modelled depth as session count,
a defect corrected under *Line 221*; the corrected variant trailed `pool` by more.

**mmap: cheaper, and not safe.** In the harness that also times a quinn-shaped copy, `mmap_naive`
spends a third to a half less CPU than a windowed `pread` — exactly the bytes it never copies.
But at 250 kB cold every mmap variant has a **p99 of 3 276–3 914 µs** against 1 036, and
`mmap_naive` holds a worker for **3 991 µs**; the variants that make the fault safe are 2–3×
slower at 1.5–2× the CPU. Its cold median flatters it (cold ÷ warm 1.1× against 5.3× for
`pread`): fault-around pulls in neighbours, so **it is not doing the same I/O faster, it is doing
less of it.** The workstation reproduced the freeze: 2 187–3 699 µs against 233–1 001.

**On the workstation** (8-thread i5-8250U, btrfs-on-LUKS over NVMe, a miss is a real device
read; 12 interleaved repeats; desktop up, governor unpinned, so absolute µs carry drift),
250 kB cold `product` against `pool` is **+38.5 % p50, +36.5 % CPU, RESOLVED at depth 1**,
while `hybrid_lazyring` **ties** `pool` at every depth. **That retracted "the shipped path *is*
the variant" at 250 kB**: the penalty was the old `ReadCtx`'s, not the ring's; *Line 221* found it.
At 16 KiB they tie. 250 kB at depth 16 is past saturation there (×1.09 for 4× depth, every variant
within 5.3 %), so no claim is made in it.

### Correction — `uring`'s depth-scaled hit penalty was queue depth

This section once published `uring`'s hit penalty as **+59.9 / +345.6 / +1571.5 %** at 16 KiB
and **+29.8 / +430.0 / +1985.0 %** at 250 kB, depths 1 / 4 / 16, "scaling with depth". The
scaling is the artefact: these are `p50_ns`, and `hybrid_lazyring` serves a hit inline at depth 1
whatever `--depth` says while `uring` holds `depth` reads in flight — the ratio restated `depth`.

| hits, `uring` vs `hybrid_lazyring`, 16 KiB | depth 1 | depth 4 | depth 16 |
| --- | ---: | ---: | ---: |
| `p50_ns` (the artefact) | +59.9 % | +345.6 % | +1571.5 % |
| `wall_ns` | **+71.3 % RESOLVED** | +23.1 % tie | +12.2 % tie |
| `cpu_ns_per_ask`, `--monitors 0` | **+164.8 % RESOLVED** | +38.5 % RESOLVED | +31.5 % RESOLVED |

At 250 kB the wall cost is +29.6 to +35.2 % RESOLVED at every depth, and `uring`'s p50 divided
by its depth leaves a residual flat at +31–34 % — a real per-hit penalty; at 16 KiB it collapses
(+71 / +16 / +2 %) because one `io_uring_enter` amortises over the batch. **"A hit must never
touch a ring" stands, and so does the reason there is no toggle; the magnitude is retracted.**
Against `pool` it is +154.1 % at depth 1 and a tie above.

The depth-1 CPU figure first published as +224.3 % came from an **instrument defect**:
`--monitors 1` counts the co-tenant monitor's own CPU, a large intermittent addend on warm cells.
It also faked a 1.9× gap in the 2026-09-09 warm 250 kB column (`product` 54.4 µs, a median
between two modes); at `--monitors 0` the three variants read 34.4 / 34.6 / 34.8 µs. Every warm CPU
figure in the `w1_*_variants.tsv` dumps carries it; the cold cells do not.

### Short io_uring completions

The lab's ring variants were credited for bytes the kernel did not deliver: `drain` freed a slot on
any non-negative result, while the product and `pool` always completed the tail. `drain` now
resubmits the tail, `UringReader::short_reads()` counts it, and
`a_short_completion_is_resubmitted_for_its_tail` pins it on a pipe delivering 64 bytes in two
halves. On the workstation: 0 short reads on every ring variant at 250 kB cold, and **0 in all
1 032 rows** of the five w3 campaigns, so no published ring number needs re-running.

**`IORING_REGISTER_EVENTFD_ASYNC` is unavailable to this design.** It signals only for
completions posted from an io-wq worker, which on a `COOP_TASKRUN` ring is none of them, so a
parked reader is never woken. Applied to the product it hung every escalated read while the
server's suite passed. `a_read_that_cannot_complete_inline_wakes_the_parked_reader` closes that
gap (10 s timeout against `_async`, 0.05 s against `register_eventfd`). The eventfd's per-hit
cost is therefore not tunable; parking on the ring fd (§9 item 7) is the only way to remove it. *History since
row 250 (2026-10-16):* the product parks on the ring fd and has no eventfd; the test still guards the wake.

### Line 221: the capped probe was the 250 kB penalty (2026-09-10)

Workstation, `--monitors 0`, 12 repeats, cold, depth 1, wall. The old `ReadCtx` probed
`READ_WINDOW.min(remaining)` (`read_path.rs:221` then) and escalated the rest of the frame on
the same descriptor. `reads_per_ask` was 1.00–1.01 at every size, so window count was never the
variable (a first reading that blamed it is retracted). Bracketed from both sides:

| 250 kB | vs `pool` | vs `hybrid_lazyring` |
| --- | --- | --- |
| `product`, probe on, ring on the miss | **+53.1 %**, 12/12 RESOLVED | **+39.0 %**, 12/12 RESOLVED |
| `product`, probe on, pool on the miss | **+38.0 %**, 11/12 RESOLVED | +28.3 %, tie |
| `product`, probe **off** (`uring`) | +2.1 %, 6/12 tie | +1.8 %, 7/12 tie |

The probe-off row ran the product's `uring` lever, removed 2026-10-03; code:
`git show archive/arms-2026-10-03:server/src/media/read_path.rs`.

| size | probe covers | `pool_capped_probe` vs `pool` | `product` vs `pool_capped_probe` |
| ---: | --- | --- | --- |
| 16 KiB / 64 KiB | the whole frame | +2.6 / +16.5 %, tie | +2.3 / +4.5 %, tie |
| 128 KiB | half | **+83.4 %, 12/12 RESOLVED** | −5.7 %, tie |
| 250 kB | a quarter | **+53.5 %, 12/12 RESOLVED** | −2.6 %, tie |

Removing the probe loses the penalty, adding it to `pool` gains it, and with it `pool` *is*
`product`. **The location is measured; the mechanism is inferred** — not the syscall, since a
refused `RWF_NOWAIT` is cheap at any length, but what a short probe leaves on a descriptor the
whole-frame read then reuses. The fix shipped: the probe is the whole frame.

**Look-ahead was never a separate thing.** `product_ahead` at depth 1 against `product` at
depth 2 ties at every size (+2.6 to +7.6 %, 7–9/12); depth 2 is worth −48 to −58 % wall,
RESOLVED, to `product`, `pool` and `hybrid_lazyring` alike. A published "−33.3 % win over `pool`
at 250 kB" compared depth 2 against depth 1 and is retracted; at equal depth the probe penalty
was still there (+106.1 % at 128 KiB, +63.2 % at 250 kB). A harness defect is corrected with
it: the old `product` variant modelled depth as *session count* (a `ReadCtx` per task); it survives
as `product_sessions`, and its depth-4 and 16 rows were withdrawn.

### Fill at scale

Contiguous walk, warm, 1 / 16 / 64 readers, 12 repeats, both sizes, CPU per ask: `product`,
`hybrid_lazyring` and `pool` **tie everywhere** (worst |median| 10.9 %) and hold **9 OS
threads** from 1 to 64 readers; `pooled_pread` loses (+69 to +501 % RESOLVED) and grows to
151–206 threads. **What separates them is the ring, paid by sessions that barely miss**: the old
reader built **1.00 ring per session** at every reader count, including a 16 KiB fill missing
1.6 % — two fds and ~8.7 KiB for the session's life to serve one read in sixty, against an 8 192
KiB memlock ceiling of **~941 sessions**. That is why a fill has its own reader. (A lab ring variant
that registers buffers fails outright at 64 readers × 250 kB; the shipped reader registers none
and falls back to the pool on refusal.)

**Corrected 2026-10-16 (row 257): why the fill has no ring.** One miss in sixty was a 16 KiB frame inside the
kernel's read-ahead window, the regime §2 retracts; at 250 kB and the stock window a fill missed six frames in ten.
What keeps the fill off a ring is its own advice: one read in flight under `FILL_WINDOW` misses ~1 % (§3,
2026-09-10), which a ring would serve for ≤ 0.3 µs a frame on average (§13, *Each candidate at its best*).

### The two readers, every variant (2026-09-10, agent container)

Twelve variants, cold, depth 1, one reader, `--monitors 0`, six repeats; `product_tile` and
`product_fill` are the shipped readers. **Direction and shape only**: `pool` and
`pool_capped_probe` are the same code at 16 KiB and read 6.0–23.5 % apart here. Wall · CPU per
ask against the shape's own reader:

| variant | tile 16 KiB (~99 % miss) | tile 250 kB | fill 16 KiB (0.4 % miss) | rings |
| --- | --- | --- | --- | ---: |
| `product_tile` | — | — (1st) | −2.8 · −4.3 % tie | 1 |
| `product_fill` | **+62.0 · +133.0 % RES** | **+45.3 · +110.2 % RES** | — | **0** |
| `hybrid_lazyring` | +2.9 · +4.4 % tie | +14.8 · +15.6 % tie | −0.2 · −6.3 % tie | 1 |
| `uring` | −10.1 · −0.7 % tie | +5.2 · +16.3 % tie | +0.6 · +12.2 % tie | 1 |
| `pool` | **+66.7 · +134.4 % RES** | +17.5 % tie · **+51.7 % RES** | +0.1 · +1.0 % tie | 0 |
| `pooled_pread` | **+73.0 · +106.3 % RES** | **+31.9 · +54.6 % RES** | **+483.7 · +1734.4 % RES** | 0 |
| `tokio_fs` | — | — | **+513.9 · +1871.7 % RES** | 0 |

**Each reader is first-or-tied on its own shape and RESOLVED worse on the other** — the case for
the split — and `product_fill` builds no ring. Ring variants held 5 OS threads, pool variants 6. The
250 kB fill cell resolves nothing (every p99 3.3–4.3 ms). Not covered: depth above 1, more than
one reader, RSS, warm cells, the co-tenant gap.

### Fill against on-demand, cold, at stock read-ahead (2026-09-10)

4 vCPU sandbox, `frames_250k_deep` (8 GB) evicted before every cell, one session, 256 asks via
`server_ab`, before/after interleaved and reversed, three rounds, misses from `session reads`.
**A miss here is served from the hypervisor (~12 µs)**: rate, tail and direction, not magnitude.

| `read_ahead_kb` | variant | asks/s | p50 | p99 | fill miss rate |
| --- | --- | ---: | ---: | ---: | ---: |
| 128 (stock) | fill, before | 1 617 | 583 µs | 1 613 µs | **59–66 %** at `in_flight=1` |
| 128 | **fill, after** | 1 582 (tie) | 585 | 1 599 | **0.7–1.1 %** |
| 128 | on-demand depth 4 | 1 618 | 2 379 | 4 291 | 14–69 % at `in_flight=4` |
| 8 192 | fill, before | 1 496 | 577 | **3 798** | 0.7–1.1 % |
| 8 192 | **fill, after** | 1 687 (+5.6 %, 3/3) | 562 | **1 429** | 0.3–1.1 % |

At the stock read-ahead the fill missed six frames in ten with one read in flight, where
on-demand had four on the device — on storage with real latency, a round trip each. After, ~1 %
at either setting, and the 8 MB read-ahead's bursts inside the blocking read are gone. Warm stays
a tie (16 KiB +5.2 %, 250 kB +3.7 %). **The advice must not be per frame**: the first cut cost
the 16 KiB warm fill −8.7 % (4/4); per quarter window it is +5.2 %. Not measured: cloud block
storage, or a device slower than this one.

### Serving depth

`hybrid_lazyring`, cold 16 KiB, 12 repeats paired against depth 1 (`v35`, 2026-09-08): depth 2
is **+67.4 % asks/s, 12/12 RESOLVED**, 4 is +125.8 %, 16 is +184.4 %; 16 missing tiles take
1.33 / 0.78 / 0.57 / 0.45 ms; CPU per ask falls with depth; warm ties at every depth. Depth 2
collects 62 % of what depth 16 offers. Built as look-ahead on the shipped reader (`v36`):
**+73.8 % asks/s, 12/12**, warm −3.8 %, a tie.

**The server against the double-buffer server (`580e312`)**, `server_ab.sh`, 16 interleaved
rounds, 256 asks, cold miss 0.984–1.000, bytes checked by digest over `(index, length, body)`
on both binaries: **cold depth 4 is −42.1 % p50, 16/16, RESOLVED on the workstation** (816.6 →
470.6 µs), where the sandbox reached −19.1 % (15/16) and missed the bar; cold depth 1 and 2,
warm and fill tie on both hosts. `read_path_ab.sh` ties every cell, so the win belongs to the
serving shape. The workstation's ladder on HEAD: 2 831 → 4 813 → 7 710 asks/s. Per-session RSS
**+39 to +49 KiB**.

### A series nobody has read (2026-09-18)

*Queue row L20.* Headless Chromium through the harness's page path, before 2026-10-03 (`lab/scripts/cold_series.sh`, 8 rounds,
120 × 256 KB), cold forced by `--force-pool-reads`, the server's `misses` read back per run.
One ask on an idle session: 6.5 ms warm, 7.0 cold (1 miss). A whole fill: 318.5 ms warm, 320.5
cold (120 misses). **A tie in both** (3/8 and 5/8 slower). The forced miss still reads from the
container's page cache, so this prices the executor-to-pool hop alone — ~0.5 ms on one ask,
nothing measurable across a fill. What a cold series costs is the device's. A coarse-to-fine fill
order, measured the same way, cost the read path 0.3 % (`lab/scripts/fill_order_cells.sh`).

### A series past RAM (2026-09-18, cloud rig)

*Queue row L7.* A 4 GB series on a 954 MB host, so reads reach the block volume with no eviction; native
driver on loopback; every run starts at a frame no earlier run read; asks 997 frames apart; six
interleaved rounds (`lab/scripts/read_path_cloud.sh`). The device (`O_DIRECT`) is a throttled network
volume: random 256 KiB at depth 1 p50 1.3 ms in burst, 4.9 ms after; 51–53 MB/s sequential.

* **A spread ask misses (76–92 %), and a miss costs ~1 ms at p50**: 2.5–2.7 ms cold against
  1.5 ms warm, 6/6 on both read-ahead variants, disjoint ranges — L20's hop, and as much again.
* **The fill does not miss past RAM**: 1 %, as warm. `FILL_WINDOW` holds on a real device.
* **`read_ahead_kb` 128 against 2 048: no clean result in any cell.**
* **The host saturates on CPU; claim nothing past a median.** A burstable 2-vCPU instance losing
  ~2.6 s to steal over a 2.1 s fill; every p99, warm included, is 60–100 ms. P0 cannot be asked
  here.

### Frames past 250 kB, and memory at rest

*2026-10-06, AV1 queue row 51.*

Synthetic SBND of 80 × 250 kB, 40 × 4 MB and 20 × 16 MB (a mammogram's order); `lab/scripts/runtime_ab.sh`,
server on cores 0–1 and `server_ab` on 2–3 of the agent container, loopback, warm, a whole fill per session, six
repeats reversed every repeat, `rss_after_kib` read once a run's sessions have all ended. Release build of
`9b0ccb7`. No hardware counters in this VM (`perf_event_open` refuses cycles and
instructions), so CPU is rusage. The 16-session cells saturate the two server cores; nothing is claimed past them.

* **CPU per byte does not grow with the frame.** One session: 2.3 µs/kB at 250 kB, 2.6 at 4 MB and 16 MB; sixteen:
  1.5–1.7 µs/kB at all three. The send path has no per-frame cost a large frame exposes.
* **What a peak leaves resident does.** After a fill by sixteen sessions the server holds **~800 MB at 16 MB, ~230 MB
  at 4 MB, ~40 MB at 250 kB** with no session open. The pool's count cap (64) allows 1 GB of 16 MB buffers, but
  capping it by bytes is not the fix: a 16 MiB cap cut rest RSS 797 → 523 MB (−32 %, 6/6) and cost **+8.4 % CPU per
  frame (0/6 lower)**, −7.1 % asks/s (6/6) — every large frame then faults in a fresh buffer; at 64 MiB rest RSS was
  a tie (+1.8 %) and CPU +3.5 % (3/6). Neither is adopted.
* **Most of it is the allocator's.** With the pool holding at most one buffer, 523 MB stayed: glibc's dynamic mmap
  threshold rises to the frame's size, so freed frames return to an arena rather than to the kernel.
  `MALLOC_MMAP_THRESHOLD_=1048576` (no code change) cut rest RSS **−57 % at 16 MB × 16 (812 → 347 MB), −46 % at
  4 MB × 16, −49 % at 16 MB × 1, 6/6 each**, at a CPU tie (+0.0 to +2.4 %, 2–3/6) except +5.0 % (2/6) and −5.2 %
  asks/s (4/6) at 16 MB × 16; at 250 kB it is +2.8 MB (0/6 lower). A deployment setting, not taken: whether large
  frames ship, and whether memory at rest or CPU at peak binds the target host, are the owner's.

What the brief's other levers would buy was already measured and is not repeated: the per-send copy is gone since
2026-09-23 (§5, the pooled hand-off; the one copy left, page cache → buffer, is what makes the bytes
process-private, §1 *Guarantee*); mmap and `sendfile` stay rejected (§5). The per-frame allocations left — the
envelope's 8-byte head, the planner's and the pipeline's upcoming lists — are three small allocations against
0.4–43 ms of CPU a frame, below any noise floor here. Fill time on the five-link total-time measurement's 50 Mbit link (AV1 queue row TOTAL) was not run, since nothing
changed the send path (`RELAY=` in `runtime_ab.sh` runs it).

### Hosts and closed risks

The `spawn_blocking` round trip is **24–34 µs** on a lab KVM Xeon, a GitHub runner EPYC, the
workstation (the only bare-metal host) and the agent sandbox — ext4, btrfs, read-ahead 128 KiB to
8 MiB — and no miss-regime row flipped on any host. Closed: single host (R1); synthetic fixture
(R3); force- rather than pressure-evicted (R4, cgroup cap verified by `failcnt`); ring count at
scale (R5, 128 rings at 53–79 % miss spawn no io-wq workers; `pool` reaches 265 threads);
filesystem support (R6, `check-fastpath`); loop against ring (R8). Open, not worth closing:
guest-cold understates the ring (R2); one read per ask affects every variant alike (R7).

## 12 · Re-running the evidence

`lab/disk-access-bench` stays a workspace member on the tip (the 2026-08-31 decision went wrong
partly because its harness had to be restored from a commit), mmap variants included.

```bash
NAME=frames_16k_big  BYTES=16384  FRAMES=5120  ./lab/scripts/gen_live_cell_fixture.sh
NAME=frames_250k_big BYTES=250000 FRAMES=2048  ./lab/scripts/gen_live_cell_fixture.sh
NAME=frames_250k_deep BYTES=250000 FRAMES=32000 ./lab/scripts/gen_live_cell_fixture.sh   # 8 GB, the miss fixture
cargo build -p disk-access-bench -p check-fastpath --release
lab/scripts/read_path_ab.sh <base-commit>   # FillReader / TileReader: every cell must tie
lab/scripts/server_ab.sh <base-commit>      # product server: cold depth 4 is the claim; fill and depth 2 tie
```

`read_campaign --variants product_fill,product_tile` drives the shipped readers themselves; the base
of `read_path_ab.sh` must know both variants. A sandbox number is a direction, not a magnitude.
**Make the miss real.** Use a fixture larger than the host cache: an 80 MB series fits in the
hypervisor, where a "miss" is ~12 µs and hides every miss-path effect. Consecutive asks must
stride past `read_ahead_kb` — of the filesystem's bdi, not the block device — or a cold cell is
a hit cell wearing a cold label, and **a stride calibrated on one host is not portable**: 16 KiB
asks miss 1.6 % at a 16 kB stride and 100 % at 262 kB on the sandbox (8 192 KiB), 93 % from 32
kB on the workstation (4 096); 250 kB asks miss 97.7–99.2 % from a 500 kB stride on both. Where
every read must miss, use `--force-pool-reads`, not eviction ([`CLAUDE.md`](../../CLAUDE.md)
§Measurement).

**The two readers on the workstation** (§9 item 10): the tile shape per `--size` in 16384, 65536,
131072, 250000, stride re-derived on the day —
`read_campaign --variants pool,uring,hybrid,pooled_pread,pool_capped_probe,pool_ringloop,hybrid_lazyring,uring_ringfd,hybrid_lazyring_ringfd,product_fill,product_tile --temps cold --depths 1,2,4,8,16 --readers 1,16,64 --monitors 0 --repeats 12`;
then the fill shape, `--stride` = `--size`, adding `tokio_fs`. Verdicts on wall and CPU per ask.
Three columns carry the claims: `rings` stays 0 for `product_fill`, `peak_named` follows
`--depths` past 4, and the 128 KiB / 250 kB penalty stays gone.

### On the workstation, in one command (row 262: built, not yet run)

*2026-10-16.* Item 10 of §9, and the ring against the pool on the server, on the owner's machine. The script was
run here once with `--quick` on a cut matrix, untimed: it proves it runs, and no number in this section comes from it.

```bash
lab/scripts/workstation_run.sh --plan    # the estimate and the disk it needs, then exit
lab/scripts/workstation_run.sh --quick   # one round of everything: a first try, nothing to conclude from
lab/scripts/workstation_run.sh           # 12 rounds; prints the estimate and starts 10 s later
```

It refuses when a prerequisite of README §Prerequisites it uses is missing, or when the disk is short. It builds
what it runs, works under `.local/workstation` (`--work DIR` elsewhere: the series volume is the one it records),
and packs `report-<UTC>/` as `workstation-<UTC>.tar.gz`, the one file to send back. Nothing runs as root.

| part | in the report | what it answers |
| --- | --- | --- |
| host | `host.txt` | kernel, distro, CPU and threads, governor, AC, RAM; the series volume's filesystem, mount options and device stack, `read_ahead_kb` of its bdi and of each device; THP, glibc, `ulimit -l` and `-n`, SELinux, `io_uring_disabled`; `check-fastpath` on the volume |
| ring | `ring.txt` | does a tile miss build a ring: natively (the session line's `ring=true`); in the deploy image under the runtime's default profile (the control: refused) and under `seccomp-uring.json`. Where SELinux enforces and the profile alone is refused, `label=disable` is tried, and the policy module [`deploy/wtpacs_io_uring.te`](../../deploy/wtpacs_io_uring.te) (only `io_uring { allowed }`, for `container_t`) is left to the owner: `ROOT-STEPS.txt` says how to load it, then `--only ring` tests it |
| readers | `readers.tsv`, `readers_summary.txt` | item 10: the cells of *The two readers, every variant* (§11) on this host. Cold tile 16 KiB (stride 250 000) and 250 kB (stride 500 000), cold fill 16 KiB; depths 1, 4, 16; 1 and 16 readers; 256 asks; `product_tile`, `product_fill`, `hybrid_lazyring`, `uring`, `pool`, `pool_capped_probe`, `pooled_pread`, and a second copy of each product reader as the A/A; 12 repeats in `read_campaign`'s rotation. Each variant against the shape's own reader, paired per repeat, on p50 and CPU per ask under §11's rule; the A/A's p90 \|Δ\| is this host's resolution; and the three claim columns above |
| server | `server.tsv`, `server_summary.txt` | the product server, ring against pool (`WTPACS_READ_PATH=pool`) with a second ring arm as the A/A, on `server_ab.sh`'s cells (cold depth 1, 2, 4; warm depth 1, 4; a cold fill), 256 asks, 12 rounds, the three arms in `lab/scripts/order.py`'s order inside each cell. Checked: cold misses ≥ 0.95, `ring=true` in every cold ring row and `false` in every pool row |
| execgap | `execgap/` | row 258's script (exec_gap.sh in `lab/scripts/` on its branch, or `EXEC_GAP_SCRIPT`), given its binaries with `--exec-gap BIN_DIR`, on a series of 499 kB frames past RAM and at least the unread frames its rounds need (1.25 × RAM, and ≥ 67 GB at 12 rounds); skipped when either is missing |

**Cold is a copy, never an eviction.** Every cold cell reads a copy written past the page cache with `O_DIRECT`
(`writer_bench direct`, and `read_campaign --fresh DIR` per cell) and counted non-resident by `mincore`: the server
part reports a resident copy, `read_campaign` skips the cell and the summary counts the skips. `read_path_ab.sh` and
`server_ab.sh` stay what they are, a commit against a commit with eviction; this asks one commit, ring against pool,
so it drives their binaries on their cells, asks, strides and rule instead. Every server cell is a fresh process; a
warm one follows a discarded pass by another.

**Time and disk.** The estimate, a model whose rates are guesses for a laptop NVMe (`timing.txt` has the real ones):
~5 min for the first build, ~17 min for the image build and the container checks where podman or docker is present,
~26 min for the readers and ~5 min for the server at 12 rounds: **~53 min**. `--quick` takes ~25 min the first time,
nearly all of it the two builds. It needs 1.1 GB under the work directory and ~4 GB of image and cache in the
runtime's storage; the copies write ~450 GB to the series volume over a full run (~38 GB with `--quick`: the 250 kB
series is 512 MB, rewritten per cell). `--exec-gap` adds a series of max(1.25 × RAM, 67 GB) unless `EXEC_GAP_SERIES` names one.

**Left out, by choice:** the rest of §12's sweep above (64 and 128 KiB, depths 2 and 8, 64 readers, the `ringfd`
and loop variants, and `tokio_fs`, which needs its own build). `R_VARIANTS`, `R_DEPTHS` and `R_READERS` take them,
at the cost `--plan` prints. At 16 readers the readers share one series and wrap it, so those cells are mix, not
miss: `pair_variants.py` buckets by regime for that reason. P0 is not this: one bare-metal host is not the target.

## 13 · Faster than today (theory, AV1 queue row 198)

*2026-10-14. Reasoned, not measured: every µs below not cited to a measurement is derived (D). The protocol for the row
that measures it is at the end.* Sources: Linux **v6.18.44** from `gregkh/linux` (SHA-256, first 16 hex:
`io_uring/rw.c` bf8afad1c04c59a9, `io_uring/rsrc.c` 0ec50bf732c7c720, `io_uring/io_uring.c` 75d549fe1bc34442,
`mm/filemap.c` 2bd1223972411197, `include/uapi/linux/fs.h` bf3363a0a2afe616, `include/linux/fs.h` afa1e1e76569a2e9,
`fs/ext4/file.c` 5ab2ac4b304b0db2, `drivers/nvme/host/pci.c` 2c5d6ecdfb6a6f21, `drivers/nvme/host/ioctl.c`
2394894321f58f76); quinn-proto **0.11.18**, the crate `scripts/patch_crate.sh` pins (a9746dbde176634f).

### Where today's µs go

**A hit** is one `preadv2(RWF_NOWAIT)`: a syscall, a walk of the cached folios, one copy into a pooled buffer.
Row 172 measured it on the host's ext4 (`../disk-layout/README.md` §Measured): **4.1 µs at 32 kB, 16 µs at 163 kB,
52 µs at 503 kB**, a file from `pack-series`. Its arms split it: the copy is ~0.095 µs a kB (the ~1-folio arm, 2.4 →
47 µs from 32 to 503 kB) and each extra 4 KiB folio ~0.46 µs (the 4 KiB-folio arm, ×1.41–2.02 of today). At 3 MB that
is ~290 µs with large folios and ~640 µs with 4 KiB ones (D). The send path costs **1.5–2.6 µs a kB of server CPU**
(§11, *Frames past 250 kB*), so **a hit is 4–9 % of a frame's CPU at 32–500 kB, and 4–7 % at 3 MB, 8–14 % on 4 KiB
folios** (D). That is the most any hit lever can remove.

**A miss** is the device's: latency plus bytes over bandwidth — ~1 ms at p50 on the cloud rig (§11, *A series past
RAM*), 27.5 µs for 4 KiB `O_DIRECT` on a lab host's virtio-blk (§Provenance), 0.84–1.6 GB/s on the workstation's NVMe (§2,
§9). On that NVMe a miss is ~0.1 ms at 32 kB, ~0.3 ms at 250 kB, 2–4 ms at 3 MB (D). Around it the server spends the hop (24–34 µs,
pool) or a ring round trip, a page-cache insert per folio and the same copy. The fill rarely pays any of it:
`FILL_WINDOW` holds its misses at ~1 % (§2). **What a read-path change can take from a miss is CPU, not wait**,
except where the device's own latency is a few µs.

**The copy QUIC forces.** quinn copies a stream's bytes into the datagram (`connection/streams/state.rs:667`) and
seals the datagram in place (`crypto/rustls.rs:616–620`, called at `packet.rs:492`); v6.18.44 has no in-kernel QUIC
(no `net/quic`). So the plaintext must be in user memory, and `sendfile`, `splice` and any zero-copy read-to-socket
path cannot reach the wire. The read's copy is the one that buys the process-private guarantee (§1); only a cache
that keeps the bytes in user memory between asks removes it.

### Each candidate at its best

Predicted change against today, per frame, 32 kB–3 MB. *Needs* is what the kernel and a container must allow (row 199
owns the container side).

| Candidate | Mechanism, and what it removes | Hit | Miss | Needs | Verdict (D) |
| --- | --- | --- | --- | --- | --- |
| **Large folios after reclaim** | the fill's `WILLNEED` builds 4 KiB folios; keeping them large removes ~0.46 µs a folio | ×0.5 at 160 kB–3 MB on a cache the fill warmed (row 172's ×2.0, inverted) | fill CPU per GB ×0.65 | ext4 ≥ v6.16 or XFS | **Row 196's** — the largest hit lever here, and no structural change |
| **User-space frame cache** (`lab/disk-access-bench/src/frame_cache.rs`) | a repeated frame is a refcount handed to quinn: no syscall, no folio walk, no copy (~0.6 µs measured, 2026-09-05) | **4–640 µs → ~0.6 µs**: frame CPU ×0.91–0.96 at 32–500 kB, ×0.86–0.96 at 3 MB | first ask unchanged; a no-repeat sweep +4 % (2026-09-05) | RAM: duplicates the page cache unless filled past it; a lock across sessions | **Net only where frames repeat in one process** (cine loops, viewers of one series); a trade in RAM. Its −20.2 % (§5) predates the pooled hand-off and the whole-frame probe, which took the second copy and three of four syscalls: re-predicted −4 to −14 %. Structural: a proposal, measured first |
| `O_DIRECT` for misses | DMA into the buffer: no page-cache insert, no copy; frames are unaligned, so a 4 KiB-aligned superset (≤ 8 KiB more) sliced as `Bytes` | **every repeat is a device read**: 4–640 µs → 0.1–2.5 ms local, ~1 ms+ cloud | CPU per miss ×0.25–0.5 at ≥ 250 kB; wait a tie (the device); the fill loses `WILLNEED` and needs its own depth | filesystem support (ext4, XFS) | **Rejected alone** — gives up the shared page cache (§2). Only as the fill side of a frame cache |
| `IOPOLL` (`HYBRID_IOPOLL`) | the ring polls the device instead of an interrupt and a wake-up | — (`O_DIRECT` only, `rw.c:891–893`) | −2 to −10 µs a miss on local NVMe (≤ 10 % at 32 kB, ≤ 1 % at 3 MB); a core spins the device's latency, ~80 µs local and ~1 ms cloud, per miss in flight | `O_DIRECT`, plus poll queues: `nvme.poll_queues` at module load, 0 by default (`pci.c:127–129`), not settable in a container; this container's virtio-blk reports `io_poll` 0 | **Rejected** — `O_DIRECT`'s trade, CPU worse, nothing on cloud block storage |
| NVMe passthrough (`uring_cmd` on `/dev/ngXnY`) | NVMe read commands from user space: no filesystem, no block-layer per-I/O work | as `O_DIRECT` | a few µs of block-layer CPU per I/O; wait the device's | the char device in the container, and `CAP_SYS_ADMIN` unless the controller's effects log marks the read supported (`ioctl.c:17–86`); the file's block map; NVMe only | **Rejected** — `O_DIRECT`'s trade with the filesystem gone too; the per-I/O saving is µs against a 32 kB–3 MB transfer |
| Registered buffers | a buffered read copies with `copy_to_user` either way; fixed buffers skip only the iovec import | not on the ring (§7) | tie — measured "no change" (§5); a 4 KiB `ReadFixed` 852 against 561 ns (§Provenance) | every pinned page charged to `RLIMIT_MEMLOCK` (`rsrc.c:661–687`, `:47`): 4 slots × 3 MB is 12 MB a session against the 8 MB default | **Closed** — measured |
| Registered files | — | — | — | — | **Already shipped** (§1.3) |
| `SQPOLL` | a kernel thread polls the submission queue: no `io_uring_enter` | worse | tie | a kernel thread per ring, so per session | **Closed** — measured 2.8× CPU (§5) |
| Multishot reads | one submission, repeated completions | — | — | a pollable file: `io_read_mshot` refuses a regular file with `-EBADFD` (`rw.c:1063–1067`) | **Not applicable** |
| Linked reads (`IOSQE_IO_LINK`) | orders one read after another | — | tie at best: frames are independent, and the link worth having (read → send) cannot exist with QUIC in user space | — | **Rejected** |
| A ring for the fill | the hop (24–34 µs) on a fill miss | — | ≤ 0.3 µs a frame on average, at ~1 % misses | the ring's memlock and fds | **Rejected** — a tie by arithmetic; §1 keeps the fill off the ring |
| Transparent huge pages for frame buffers | fewer dTLB misses on the copy's destination | ≤ 3 % of the copy at frames ≥ 2 MiB, ≤ 0.5 % of frame CPU; nothing below 2 MiB | the same | `GLIBC_TUNABLES=glibc.malloc.hugetlb=1` (glibc ≥ 2.35; this container's 2.39 lists it) where THP is `madvise` or `always` (this container: `madvise`); no code | **Predicted tie**; one cheap arm below because it costs no code |
| `mmap` + `MAP_POPULATE` / `MADV_POPULATE_READ` | the bytes handed to quinn straight from the page cache: removes the read's copy | measured within noise of the touch loop, always-touch 103 against 48 µs (§5) | a refault on the executor after reclaim, 1.5–7.7 ms measured; `mlock` would hold every unacknowledged frame against `RLIMIT_MEMLOCK` | — | **Closed** — not safe (§5); reopens only if a frame cache is rejected *and* the hit's copy binds |
| `RWF_DONTCACHE` | the read's folios are dropped once copied (`include/uapi/linux/fs.h:431`; `mm/filemap.c:2563`, `:2610`, `:2642`; ext4 opts in, `fs/ext4/file.c:980–982`) | no faster: the same copy, then the drop | the same | v6.18.44 has it | **Not a speed lever** — a cache policy for one fill sweeping a series past RAM, and it discards the sharing §2 relies on |
| `sendfile` / `splice` / zero-copy send | — | — | — | — | **Closed** — QUIC copies and seals in user space (above) |

**The verdict, predicted.** On a miss nothing here shortens the wait on any device the target can have; the levers
move CPU per miss and each one gives up the shared page cache. On a hit the ceiling is the 4–14 % of a frame's CPU the
read costs, and two levers reach into it: **large folios after reclaim** (row 196, no structural change, ×0.5 on the
hit at 160 kB–3 MB) and **a user-space frame cache** (structural, −4 to −14 % of frame CPU where frames repeat, a cost
in RAM). Today's path is otherwise at its floor: one syscall and the one copy the guarantee needs.
*Corrected by row 209 (§Measured, below): where sixteen sessions share a series the cache saved 17–22 % of a frame's
CPU and halved peak RSS, beyond the 4–14 % this section allowed a hit — the read is not a hit's whole cost; on a lone
session's repeat the admitting pass cost +25–36 %.*

### Protocol for the measuring row

Given to a separate session with nothing above this heading.

* **Arms, differing in the lever alone**, every arm's settings printed: **B0** the server as it ships; **B0′** the same
  build, a second process (A/A: the p90 of \|B0′/B0 − 1\| over the rounds is the resolution); **B1** a lab build with
  `lab/disk-access-bench`'s `FrameCache` in front of the reader, budget larger than the series (code beside today's
  path; the server's default build unchanged); **B2** B0 under `GLIBC_TUNABLES=glibc.malloc.hugetlb=1`, the 3 MB cell
  only, with THP `enabled` recorded.
* **Cells:** `pt15_cptac` (32 kB), `ct_lidc` (163 kB), `dbt12_ea1141` (503 kB), HTJ2K, and a synthetic 3 MB series
  (`lab/scripts/runtime_ab.sh`'s generator). Each cell a whole fill by 1 and by 16 sessions on loopback,
  **twice in a session** (the second pass is the repeated case), as §11 *Frames past 250 kB* ran it: server and client
  on separate cores; `rss_after_kib` after each run.
* **Metrics:** server CPU per frame (rusage), split by pass; asks/s; RSS at peak and at rest. **16 rounds**, the arms'
  order by `lab/scripts/order.py`. Host: kernel, filesystem, `read_ahead_kb`, THP mode, glibc. Where the 16-session
  cells saturate the server's cores, nothing is claimed past them.
* **Exactness:** every frame received checked against its coded bytes' XXH3-64; one fill per arm decoded against
  ingest's sample digests; a mutation that hands back a stale cache entry must fail it.
* **Predictions:** B1 against B0, second pass: CPU per frame ×0.91–0.96 at 32–503 kB, ×0.86–0.96 at 3 MB; first pass
  ×1.00–1.04; RSS at peak higher by the series' size. B2 at 3 MB: a tie (within ±3 %).
* **Decision rule.** *(a)* B1 goes to the owner as a proposal (this section) if its second-pass CPU per frame beats
  B0 beyond the resolution with ≥ 80 % sign agreement in at least two of the four cells, and its first pass is worse
  by no more than 5 % in any; otherwise the frame cache is closed for this workload. *(b)* B2 becomes a deployment
  note in §6 only if it beats B0 beyond the resolution at 3 MB and is worse on no metric; otherwise closed. *(c)* Every
  other row of the table stays as its verdict says unless the measurement contradicts a premise it rests on (the hit's
  share of a frame's CPU above all: if B1's second pass gains more than the read's 4–14 %, this section's model is
  wrong and is corrected in place).

### Measured (row 209, 2026-10-14): B1 goes to the owner as a trade-off; B2 is closed; the hit model is corrected

*Run from the protocol alone.* `lab/disk-access-bench/frame_cache_ab.py` (README there); 16 rounds, arms in
`lab/scripts/order.py`'s order, each arm a fresh server process per cell and round, two whole fills in it; 832 runs, none
failed. Host: this cloud container, kernel 6.18.44, ext4, `read_ahead_kb` 128, THP `madvise`, glibc 2.39, 4 vCPUs,
server on cores 0–1 and `server_ab` on 2–3, loopback, page cache warm. Arms as the protocol, settings in the rows'
first line: B1 is B0's source built with `--features lab-frame-cache`, a 4 GiB budget, the cache's own admission on a
frame's second ask; nothing else differs. The 3 MB cell is 32 frames of seeded random bytes (`make`), so its exactness
is XXH3-64 only. Rows: `lab/disk-access-bench/rows-framecache.jsonl`.

**Exact.** Every frame of every run checked against its coded file's XXH3-64 by `server_ab --coded`. A third fill per
arm, decoded against ingest's digests: 335 + 100 + 29 frames per arm, 0 inexact. `LAB_FRAME_CACHE_MUTATE=stale` (a hit
hands back the previous frame) fails every pass in which the cache holds an entry, 20 of 24 (the four it passes are a
lone session's first fill, where nothing is resident yet).

**CPU per frame, B1 ÷ B0, median of the paired rounds (rounds lower of 16; the A/A resolution):**

| cell | 1 session, pass 1 | 1 session, pass 2 | 16 sessions, pass 1 | 16 sessions, pass 2 |
| --- | --- | --- | --- | --- |
| `pt15_cptac` 31 kB | 1.047 (7; 41 %) | **1.355** (0; 25 %) | 0.794 (15; 19 %) | 0.780 (15; 22.5 %) |
| `ct_lidc` 164 kB | 0.972 (9; 22 %) | **1.328** (0; 29 %) | 0.932 (11; 19.5 %) | 0.826 (16; 24 %) |
| `dbt12_ea1141` 499 kB | 1.011 (8; 25 %) | **1.253** (2; 24 %) | 0.820 (16; 17 %) | **0.812** (16; 18 %) |
| synthetic 3 MB | 0.979 (11; 12 %) | **1.304** (0; 12 %) | 0.870 (16; 9 %) | **0.831** (16; 9 %) |

Bold: beyond the resolution. B0 spends 83 / 283 / 945 / 5 340 µs a frame at one session and 53 / 234 / 797 / 4 246 µs
at sixteen. One session holds one server thread busy (~1.0 core); sixteen hold 1.5–1.8 of the two server cores, every
arm, so no cell saturates them, and asks/s is not claimed (it is the same CPU seen through the core count). Peak RSS,
pass 2: one session +8.6 / +13.5 / +10.0 / +80 MiB over B0 (the series is 9.9 / 15.6 / 13.8 / 91.6 MiB); sixteen
sessions **−26 / −11 / −39 / −84 MiB** (23.8 against 50.3 MiB at 31 kB; 106 against 191 MiB at 3 MB), and at rest
the same.

**Each prediction.** B1's second pass ×0.91–0.96 (×0.86–0.96 at 3 MB): **did not hold either way** — ×0.78–0.83 at
sixteen sessions, ×1.25–1.36 at one. A lone session's second fill is the frame's second ask, so it is the pass that
admits, not the one that hits; it costs more than either pass of B0 (the admitted frame keeps its pooled buffer, so
each read takes a fresh one: §11's byte-capped pool cost the same way — a likely mechanism, not measured here;
*corrected by row 256:* not the zero-fill — with `vec![0; n]` in `fit`, B1z keeps the cost, 1.20–1.34 of B0's). First
pass ×1.00–1.04: held at one session (0.97–1.05), not at sixteen (0.79–0.93), where the second session to ask a frame
admits it and the rest hit. RSS higher by the series: held at one session (0.6–0.9 of it), not at sixteen, where one
shared entry replaces sixteen sessions' buffers and peak RSS falls by about half. B2 a tie within ±3 %: 1.013–1.091
(5–7 rounds lower of 16), inside the resolution in every cell, never better.

**The rule.** *(a)* At sixteen sessions B1's second pass beats B0 beyond the resolution in two of the four cells
(499 kB, 3 MB; 16 of 16 rounds each; 31 kB is −22.0 % against 22.5 %) and its first pass is better, not worse, so
**B1 goes to the owner as a proposal** — and it is a trade-off, not a net: −17 to −22 % CPU a frame and half the
peak RSS where sessions share a series, **+25 to +36 % CPU a frame and the series' size in RAM on a lone session's
repeat**. What a third pass of one session costs (all hits) was not run (*row 256 ran it, below: inside the
resolution*). *(b)* B2 does not beat B0 anywhere: closed,
no deployment note. *(c)* The premise is contradicted: a hit saves 17–22 % of a frame's CPU at sixteen sessions, above
the 4–14 % the read was modelled to cost. The model priced the read alone; a shared entry also removes each session's
buffer, its fill and the RSS it holds — corrected in place above, after *The verdict, predicted*.

### Measured (row 256, 2026-10-16): B1s does not clear the rule; row 209's trade-off stands

*The protocol is §9's 256 CACHESHARED, on row 209's rig.* Arms B0, B0′, B1, **B1s** (B1's binary,
`LAB_FRAME_CACHE_ADMIT=session`: a frame is admitted on an ask from a session other than its first asker, so a
session's own repeat admits nothing) and **B1z** (B1 built with `lab-fit-zeroed`: `fit` replaces a short buffer by
`vec![0; n]` instead of `resize`); 16 rounds in `lab/scripts/order.py`'s order, a fresh server per arm, cell and
round. Each session now fills the series **three times over its one connection** (`server_ab --passes 3`): a pass
per connection, as row 209 ran it, would make every repeat another session's. 1 920 rows, none failed:
`lab/disk-access-bench/rows-cacheshared.jsonl`. Host as row 209's (kernel 6.18.44, ext4, `read_ahead_kb` 128, THP
`madvise`, glibc 2.39, server on cores 0–1, client on 2–3), but **not quiet**: other rows' builds ran on core 3 at
nice 19, one of the client's cores, and compilers or Python were running in 30 of the run's 38 minute samples. B0
spent 1.4–1.8× row 209's CPU a frame (one session 119 / 425 / 1 612 / 9 106 µs, sixteen 86 / 421 / 1 419 / 7 443),
and the A/A resolution was coarser: 17–42 % against row 209's 9–41 %. No cell saturates the two server cores
(0.9–1.5 busy).

**Exact.** Every frame of every timed pass XXH3-64 checked (`server_ab --coded`); per arm, a lone session's three
passes checked the same way and its last decoded against ingest's digests: 335 + 100 + 29 frames, 0 inexact.
`LAB_FRAME_CACHE_MUTATE=stale` fails B1 on a lone session's passes 2–3 and every pass at sixteen; it fails B1s at sixteen on every pass and **passes B1s on all three of a lone session's**, where it holds
nothing. That is the admission rule end to end. In the cache, three mutations of its guard each fail the cache's
tests: B1s admitting a session's own repeat, B1s admitting no other session, and B1 refusing one session's repeat.

**CPU per frame, ÷ B0, median of the paired rounds (rounds lower of 16; the A/A resolution):**

| cell | 1 session, pass 2: B1 · **B1s** | 1 session, pass 3: B1 · **B1s** | 16 sessions, pass 2: B1 · **B1s** |
| --- | --- | --- | --- |
| `pt15_cptac` 31 kB | 1.323 (2) · **1.005** (8); 36 % | 0.710 (15) · **0.957** (10); 38.5 % | 0.938 (12) · **0.840** (15); 24 % |
| `ct_lidc` 164 kB | 1.142 (3) · **0.984** (8); 32 % | 0.880 (10) · **1.000** (8); 29 % | 0.904 (11) · **0.915** (10); 31.5 % |
| `dbt12_ea1141` 499 kB | 1.296 (0) · **1.105** (6); 35 % | 0.996 (9) · **0.986** (9); 39 % | 0.860 (12) · **0.907** (13); 18 % |
| synthetic 3 MB | 1.194 (0) · **1.088** (7); 21.5 % | 0.922 (12) · **0.976** (10); 24 % | 0.936 (14) · **0.918** (11); 23 % |

Nothing in the table is beyond its resolution. B1s's pass 1 at one session is 0.90–1.05, its passes 1 and 3 at sixteen
0.78–0.94 (`pt15_cptac` pass 3, 0.777 in 15 of 16 against 19.8 %, the one B1s cell beyond). B1z's lone pass 2 is
1.20–1.34, beyond only at 3 MB.

**Peak RSS** (resolution 0.7–18 %; each difference named here in 16 of 16 rounds). One session, passes 2 and 3: B1
holds the series, ×1.8 / 2.5 / 2.1 / 5.2 of B0 (17.6 against 9.6 MiB at 31 kB, 99 against 19 MiB at 3 MB); **B1s is B0's**,
0.95–1.01, and 0.19–0.53 of B1's. Sixteen sessions: B1s ×0.43–0.75 of B0, as B1 (B1s ÷ B1 0.96–1.01): 22.7 against
49.2 MiB at 31 kB, 132 against 185 MiB at 3 MB, pass 2. At rest likewise, but for `ct_lidc` at sixteen: B0 gives
12 MiB back after its first pass, so there every cache arm rests at ×1.11–1.13 of it after pass 1 and ×0.75–0.78
after pass 3.

**Each prediction.** B1s at one session ties B0 on every pass: **held** on CPU (0.90–1.11, none beyond) and on RSS.
At sixteen, pass 2 within ×0.78–0.83: **did not hold** — 0.84–0.92, and not beyond the resolution. B1z narrows B1's
lone pass 2: **did not hold** — 1.20–1.34 of B0's against B1's 1.14–1.32, B1z ÷ B1 0.94–1.04 with no sign
agreement, so row 209's zero-fill reading is retracted above; whether a fresh
buffer (allocation and first-touch faults) is the cost, B1z cannot say, since it still takes one.

**The rule.** B1s's pass 2 at sixteen sessions beats B0 beyond the resolution in **none** of the four cells, so it does
not go to the owner as a net, and **row 209's trade-off stands**. One session, no pass worse beyond it: held. The
run resolves no CPU difference of B1 either — not even the lone session's pass 2, +14–32 % here and +25–36 % resolved
by row 209 — so it shows this host lacked the resolution, not that the gain is absent: B1s's RSS is B0's alone and
B1's shared, cleanly; its CPU is unproven. What
would decide it: the same campaign where B0′ resolves B1's sixteen-session pass 2 as row 209's did (9–18 % at 499 kB
and 3 MB).

## Provenance

The full tables this ADR condenses: `git show 3143820:docs/disk-access/` (`EVIDENCE.md`,
`IMPLEMENTATION.md`, `DEPLOYMENT.md`, `NEXT.md`), the last tree before they were folded here.
TSVs and the design diary: tags `read-path-evidence-2026-09-09` (do not move it),
`read-path-workstation-2026-09-09`, `read-path-evidence-2026-09-10`, `read-path-w2-2026-09-10`,
`read-path-w3-2026-09-10`. Earlier campaigns: `git show a330783:docs/disk-access/`. The
2026-08-31 decision: `git show be78860:docs/disk-access/adr.md`.

Retired lab binaries, code at the commit named:

* `crossover_bench` (`265044b`) made the miss rate the knob: below ~5% misses the hybrid ties the pool; above it the hybrid wins, -45 to -77% CPU per ask, more with depth. It disagreed with `read_campaign` at one read in flight (-2.1% vs -53.4% at 100% misses), cause not found.
* `frame_budget` (`b2b6554`) split a warm 250 KB frame: 49% kernel copy, 15% copy into the connection, 27% scheduler, 8% loop; a warm 4 KiB read is 561 ns, `ReadFixed` 852 ns, an `O_DIRECT` round trip 27 543 ns on virtio-blk.
* `wire_send_bench` (`b2b6554`) drove the send path over quinn on loopback: the disk-access decision is about a fifth of a frame's server CPU; `write_chunk` is the rejected row in section 5.
