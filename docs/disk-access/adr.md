# ADR: how the server reads SBND frame bytes

**Status:** Accepted · current as of **2026-09-23** · supersedes the 2026-08-31 always-touch
decision (provenance at the end)

The one document for the read path. §1 the decision; §2 what shaped it, with the numbers safe
to quote and the claims retracted; §3 its history; §4 consequences; §5 every candidate; §6
deployment; §7–9 invariants, levers outside it, what is open; §10 the code as built; §11 the
evidence; §12 how to re-run it.

## 1 · The decision, as it ships

**Two readers, chosen by what the session is doing.** A fill knows the next frame; a tile
ask does not. That difference picks the escalation.

1. **A page-cache hit is served inline.** The whole frame is probed with
   `preadv2(RWF_NOWAIT)` on the executor thread. It returns short instead of waiting on the
   disk, so a cold frame can never park a worker, and a warm ask takes no thread hop at all.
2. **A fill (`SeqReader`) stays on the pool, and tells the kernel what comes next.** Two
   buffers, the next frame named (`FILL_AHEAD = 1`), one `spawn_blocking` + `pread` for a
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
shortfall. `RequestFrame` and `RequestFrames` are the same thing to the loop: one
`Ask::Frame` per index, fed by an ask-reader task into a planner. The reader returns a whole
frame, and **the frame goes to quinn whole**: its buffer comes from `media/frame_pool.rs`, is
handed off as `Bytes`, and returns to the pool when quinn drops it after acknowledgement
(since 2026-09-23; before, `READ_WINDOW` = 64 KiB chunked the write and a second copy fed quinn).

What is *not* done: no memory mapping anywhere in `server/`; no `mincore` gate; no `SQPOLL`,
no registered buffers, no cursor reads.

| | |
| --- | --- |
| Where | `server/src/media/read_path.rs` (`SeqReader`, `TileReader`), `uring_reader.rs` (thin ring), `frame_pool.rs` (the hand-off), `transport/planner.rs` (the loop), `transport/frame_out.rs` (the write) |
| Flag | `WTPACS_READ_PATH` = `auto` (default) · `pool` (kill switch, tiles) · `uring` (lab lever, every tile through the ring) |
| Feature | `uring`, on by default; the pool path is `--no-default-features --features crypto-ring` |
| Reports | `read_fast_path=` in the startup banner, WARN when it is the pool; `session reads hits=… misses=… miss_rate=… named=… in_flight=… ring=…` per session, default build, with fill/tile hits split (§10) |

**Guarantee.** The bytes quinn puts on the wire are process-private — copied once into a
session-owned buffer — so reclaim cannot take them back mid-write. This was the previous
ADR's escape hatch; here it is the default and costs no extra hop.

## 2 · What shaped it

### The workload and the weights

Set with the owners on 2026-09-08. **Latency first; simplicity and clean code valued;
thousands of sessions at depth 4 or more; studies far larger than RAM**, so misses are the
common case, not the exception; **cloud for sure, Docker possibly, not decided**. Two use
cases with opposite access shapes: a tile viewport asks for scattered frames out of order;
streaming pushes a study start to end.

### The constraints that ruled options out before any measurement

* **Tokio's multi-thread runtime.** `wtransport` runs on `quinn::TokioRuntime`. Anything that
  brings its own runtime is a transport rewrite, not a read-path change.
* **Never block a worker.** A major page fault is not an `.await`; it freezes every task on
  that OS thread. Measured on mmap: `gap_max` 1.5–4.2 ms cold, 7.7 ms under pressure.
* **Positional reads, one fd per study.** Tiles read `(offset, len)` out of order. A cursor
  API needs one open file per session and cannot express reads in flight.
* **The page cache is shared** across every session on one study. `O_DIRECT` would throw
  that away.
* **`RWF_NOWAIT` is filesystem-conditional.** Honoured on ext4, xfs, btrfs; refused on
  overlayfs and tmpfs. Measured, not assumed — §6.

### Numbers that are safe to quote

Paired inside each cell under the campaign's rule: a difference counts only if the median
beats the resolution threshold **and** the signs agree on ≥ 80 % of cells. Everything else is
a **tie**, which is a real answer.

| Comparison | Result |
| --- | --- |
| Shipped reader vs the lab arm it implements (`product` vs `hybrid_lazyring`) | **tie** on p50, p99 and CPU at every depth and reader count, two hosts |
| Shipped reader vs the pool it replaced, 16 KiB misses | **−45.4 % CPU per ask, RESOLVED** |
| Ring-on-the-miss vs pool, misses, depth 1 / 4 / 16 | **−56 / −70 / −75 %**, RESOLVED |
| Every-read-through-the-ring vs ring-on-the-miss | misses tie; hits **+164.8 % CPU per ask at depth 1, RESOLVED** (`--monitors 0`) — why a hit must never touch a ring. The depth-scaled latency figures this row used to carry are retracted: §11, *Correction* |
| Warm, vs the 2026-08-31 always-touch path | **60.9 µs vs 152.3 µs per frame (2.5×)**; neighbours' p99 166 vs 702 µs |
| A miss reading the rest of the frame vs the rest of the window, 100 % misses | **2.1× at one reader, 3.0–3.2× at 8–32** |
| OS threads | ring readers **5** (sandbox) / 9 (workstation), flat to 256 in flight; pool 125–135 at 64 readers, capped at 512 by tokio |
| Per session that misses | 2 fds, 8.7 KiB, 15.6 µs to build the ring; the second slot did not change the cost |
| Read ahead by one, cold 16 KiB at 99.6 % misses, one session (`v36`) | **+73.8 % asks/s, 12/12, RESOLVED**, p50 −53.4 %; **warm a tie** — the load-bearing row; 16 missing tiles 1.14 → 0.62 ms |
| The depth ladder on the shipped path (`v35`) | 1 → 2 is **+67.4 %** and collects 62 % of what depth 16 offers; from the medians 2 → 4 adds +37 %, 4 → 16 +28 % |
| Where the hosts stop separating the arms | ~64 reads in flight: the sandbox on CPU, the workstation on the device (~840 MB/s at 0.42 of 8 cores). **Past it every arm ties by construction** |
| Sequential streaming, 16 KiB, 8–64 sessions (`x15`) | shipped reader, pool and ring-on-miss **tie at ~3 µs per read**; `tokio::fs::File` 48–223 µs; the same on tokio's io_uring driver 141 µs–2.1 ms |
| A cold 250 kB fill at the stock 128 KiB `read_ahead_kb` (2026-09-10) | **59–66 % misses at one read in flight** before `FILL_WINDOW`; **0.7–1.1 %** after, 3/3; where read-ahead is 8 MB the 3.8 ms p99 bursts go (−62 %, +5.6 % 3/3); warm a tie at both frame sizes. §11, *Fill against on-demand* |

### Claims that were made along the way and then measured to be wrong

| Retracted | What is true |
| --- | --- |
| "`uring` has the better p99 at depth 4" | a 4-vCPU sandbox artefact; on the workstation misses tie at every depth |
| "`uring` is 47–61 % worse on latency" | a one-reader p50; does not survive crossing depth with readers |
| "throughput confirms the latency result" | throughput is depth ÷ latency; quoting both counts one measurement twice |
| "`adr-reject-server-ordering.md` fixes the loop at depth 1" | it rejects *reordering*, not concurrency; pipelining reads keeps FIFO delivery |
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
| 2026-09-07 | a miss reads the rest of the frame | on a fixture where a miss is a real device read, windowing the escalation cost 2–3 round trips per 250 KB frame and stopped scaling at ~1 600 f/s where whole-frame arms reach ~5 000 |
| 2026-09-08 | keep driving `io-uring` directly; **validate on the production target before any further backend change**; **read ahead by one built** for batches; **the server reports its own miss rate** | backend research found no standard alternative (§5); the owners' weights and the container traps (§6) mean the ring's margin has to be shown on the target, not a laptop (`x14`, `x15`); read-ahead measured +73.8 % on missing tiles and a tie warm (`v36`); every threshold in this file is a miss rate, and the server could not report one |
| 2026-09-10 | **two readers**: a fill on the pool, tiles on the ring; the probe is the whole frame; look-ahead is depth | the capped 64 KiB probe was the whole of a +37–97 % penalty at frames past 64 KiB (§11, *Line 221*); a fill built a ring to serve one miss in sixty (§11, *Fill at scale*) |
| 2026-09-10 | **the fill advises the kernel `FILL_WINDOW` past the named frame**, a quarter window at a time | a fill reported slower than on-demand; measured cold at the stock read-ahead: 60 % misses at one read in flight, against depth 4 on demand. `WILLNEED` takes it to ~1 % with no thread and no ring and removes the 8 MB read-ahead's burst tail; per frame the syscall cost −8.7 % at 16 KiB, per quarter window nothing |
| 2026-09-23 | **the frame is handed to quinn whole** over pooled buffers; a tile jump takes a slot with no read in flight | the 2026-09 owned-buffer rejection was the fresh 64 KiB allocation, not the hand-off (§5); a jump's wanted read queued behind an abandoned one |

## 4 · Consequences

| | |
| --- | --- |
| **Good** | Warm asks take no pool hop; a miss costs one round trip; OS threads stay flat at any session count; the reclaim guarantee holds; one copy per frame (page cache → buffer), the buffer handed to quinn and reused |
| **Good** | The decision is per session and automatic: a session that never misses never pays for the ring, and the kill switch is a flag, not a rebuild |
| **Cost** | ~800 lines of custom code with tests and 8 `unsafe` sites, on top of the `io-uring` crate — maintained, and tokio's own dependency. The glue is ours; the ring is not |
| **Cost** | 2 fds and 8.7 KiB per session that misses, the latter charged against `RLIMIT_MEMLOCK` (§6) |
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
| **Ring per session, built on the first miss, whole rest of the frame** | T | **host-dependent, and P0's question.** Sandbox: misses −56 / −70 / −75 % CPU vs pool at depth 1 / 4 / 16. Workstation: a **tie at depth 1**, where the pool was the cheaper of the two (311 vs 326 µs CPU/ask). Agent container: the pool is **+106 to +138 % CPU, 6/6 RESOLVED**. Three hosts, three answers | **5 threads flat** to 256 in flight; 2 fds + 8.7 KiB per missing session; 15.6 µs to build | ~800 lines with tests, 8 `unsafe`, on a maintained crate; container traps (§6) | **Accepted for tiles** — conditional on P0 |
| **`TileReader` — probe, ring on the first miss, `slots` frames named** | T | beats every pool arm **RESOLVED on wall *and* CPU** at 16 KiB cold, ties every ring arm, and is 1st of eleven at 250 kB; **+73.8 % asks/s** on missing tiles at depth 2, warm a tie; 16 tiles 1.14 → 0.62 ms | 5 threads; 2 fds + 8.7 KiB per session that misses; `slots` defaults to 4 | one slot table, no mode machine | **Accepted** |
| **`SeqReader` — probe, pool on the miss, one frame named** | S | ties every serious arm on a cold sweep at both frame sizes; `peak_in_flight` is **1 by construction**, which is what bounds its threads | 6 threads; **0 rings, 0 fds, 0 memlock** — no ~941-session ceiling | two buffers, no slot table, no `unsafe` | **Accepted** |
| **Read ahead (`TILE_SLOTS` / `FILL_AHEAD`)** | B | tiles name up to `slots − 1`, a fill names one; look-ahead **is** depth 2, not a separate effect (§11) | four tile slots / two fill buffers | `slots` is a constructor argument, so a campaign sweeps depth | **Accepted** |
| **`WILLNEED` window ahead of a fill (`FILL_WINDOW`)** | S | misses **60 % → ~1 %** at the stock read-ahead, 3/3; p99 −62 % where read-ahead is 8 MB; warm a tie once per quarter window (per frame it cost −8.7 % at 16 KiB) | one syscall per MiB walked; no thread, no fd, no buffer | ~15 lines, one test | **Accepted** 2026-09-10 |
| **Whole frame handed to quinn over pooled buffers** (`media/frame_pool.rs`) | B | **−3 to −8 % CPU per ask in every cell, 5–6/6** | no allocation per frame once the pool is warm | one module, no `unsafe` | **Accepted** 2026-09-23 — [`transport-conclusions.md`](../transport/transport-conclusions.md) |
| `write_chunk` owned windows to quinn | B | −3.2 % at one session; **+14.6 / +19.1 % at 16 / 32**, RESOLVED | a fresh 64 KiB allocation per window | — | Rejected as built. **Corrected 2026-09-23:** the allocation was the cost, not the hand-off — the row above |
| `spawn_blocking` + `pread` for the miss | B | identical on hits; on 16 KiB misses the shipped reader is −45.4 % CPU against it, and its tail widens with depth | **125–135 threads at 64 readers, 512 cap** (517 seen at 64 × 16); 0 fds | the simplest correct reader; zero `unsafe` beyond `preadv2` | **Kept as fallback**; ships if P0 ties |
| Probe capped at 64 KiB, then escalate | B | **+37 to +97 % wall at 128 KiB and 250 kB, RESOLVED**; a tie where the probe covers the frame | — | — | **Removed 2026-09-10** — §11, *Line 221* |
| Escalate only the rest of the window | B | 2–3 device round trips per 250 KB frame: 1 404–1 573 f/s vs 4 539–4 777 | flat at ~1 600 f/s from 8 to 32 readers | — | Superseded 2026-09-07 |
| Every read through the ring (`uring`) | B | hits **+165 % CPU at depth 1, RESOLVED** (§11, *Correction*); above depth 1 a 16 KiB tie on throughput, ~+30 % at 250 kB; streams +143–190 % at 8–64 sessions; misses tie | 5 threads; lowest CPU per miss | one path, but a hit must never touch a ring | Rejected as default; kept as a lab flag |
| Ring pipelining (read *n+1* during write *n*) | T | ~6 % on a 100 %-miss trace, −25 % warm | 2× session memory | — | Rejected |
| Fill: start the named read inside the current miss's wait, sliding `WILLNEED` | S | 250 kB cold p50 −68.9 % (12/12) but **wall a tie and p99 worse**; 16 KiB cold wall a resolved loss. A 2026-09-10 branch, never merged, not re-measured | — | — | Not taken: `FILL_WINDOW` had landed |
| `SQPOLL` | B | worse warm on every column; cold tail unresolved | **2.8× CPU** | a kernel thread **per session**, and `COOP_TASKRUN` is refused alongside it | **Rejected, closed** — structural |
| Registered buffers | B | no change | memlock per buffer | more `unsafe` | Rejected — measured unnecessary |
| Ahead-N `POSIX_FADV_WILLNEED` for tiles | T | **4.6–4.9×** on a cold strided read; a loss on a sweep | one syscall | a routed choice waiting on a layout design | Measured, not landed |
| Park on the ring fd instead of an eventfd (`x14`) | B | tie on CPU and latency everywhere | **1 fd per session instead of 2**; one syscall fewer per park | ~30 lines fewer, 2 `unsafe` fewer; same mechanism tokio uses | Proposed, after P0 (§9) |
| One shared ring per runtime (tokio's shape) | B | **1.36–1.45× slower** than a ring per thread on concurrent positional reads (tokio #8367); reproduced on streams | 0 per-session fds; one lock across every session | a dispatcher and a waker slab | Not now |
| Whole-frame `RWF_NOWAIT`, one read (2026-09-06) | B | best miss throughput of any arm | — | 250 KB uninterrupted executor copy: **4.0 ms** warm `gap_max` | Rejected then. **Corrected 2026-09-10:** the shipped readers probe the whole frame (§3); its co-tenant gap has **not been re-measured** since |
| Larger window (128 / 256 KiB) | B | −12–25 % warm throughput | — | wider executor copy | Rejected; moot since the whole-frame probe |
| mmap, any variant | B | naive: faults freeze co-tenants, `gap_max` 1.5–4.2 ms, 7.7 ms under pressure. `mincore` gate: unsafe under pressure 5/5 — residency is not a lease. Always-touch on the pool (2026-08-31): 103 µs/frame, 702 µs neighbour p99. Touch via `block_in_place`: 38 µs, worst neighbour p99 (2.1 ms). `madvise(POPULATE_READ)`: within noise of the touch loop | a thread per ask where the fault is made safe | no copy, no safety — or safe and slow | Rejected (§11) |
| `tokio-uring` 0.5.0 · `glommio` · `monoio` · `compio` | T | — | — | own current-thread or thread-per-core runtime | Rejected — transport rewrite |
| tokio's own io_uring driver | S (no positional read) | one session 6 µs; **2.1 ms per 16 KiB at 64 sessions**, ⅓ of the device; executor gaps 10× any other arm | one locked ring per runtime; one fd per session | `--cfg tokio_unstable` in a medical build | Rejected — measured |
| `tokio::fs::File`, plain | S | **48–223 µs per 16 KiB** vs 3 (a thread hop and a copy per read); +514 % wall, +1872 % CPU against `SeqReader` | threads grow like the pool's, 517 at 64 × 16 | the standard answer, and 15× slower | Rejected — measured, not reopened |
| `rio` · `ringbahn` · `nuclei` · `uring-fs` · `luring` and 90 other dependents | T | — | — | soundness hole, dead, own runtime, cursor + thread, `LocalSet`-only | Rejected — none drives a ring on multi-thread tokio with positional reads |
| `sendfile` / `splice` | B | — | — | userspace QUIC copies anyway | Rejected |
| `O_DIRECT` + SPDK, whole-study preload | B | — | loses the page cache shared across sessions | wrong scale | Rejected |
| Bounded process-private frame cache | T | **−20.2 % CPU** at a 0.92 hit rate; +4.2 % where nothing repeats | duplicates RAM the page cache holds | needs a real ask trace to size | Lab only, not ported |
| Sequential: wider windows | S | 20–30 % less CPU per byte | escalations climb 1 % → 13.5 % | — | Rejected |
| Sequential: depth above 2 per stream | S | at 64 sessions × 16 every arm queues on the device, p99 100–190 ms | — | the wire is 200× slower than a warm read | Rejected as a rule |

## 6 · Deployment

Both fallbacks degrade to the pool **per session**, and the server says so (`read_fast_path=`,
`ring=`, §10) — but only once deployed. The checks below belong in the manifest.

### `RWF_NOWAIT` is a property of the mount

`FrameStore::open` probes once; where the flag is refused, one pooled `pread` per frame —
correct, safe, and **132.5 µs per frame against 48.4 µs** on the validation host.

| Filesystem | `RWF_NOWAIT` | Note |
| --- | --- | --- |
| ext4, btrfs | **honoured** | measured (ext4 on Linux 6.18; btrfs on the workstation) |
| overlayfs | **refused** (`EOPNOTSUPP`) | measured — **a container's own filesystem** |
| tmpfs | **refused** (`EOPNOTSUPP`) | measured — RAM disks, `emptyDir: {medium: Memory}` |
| XFS | *expected to work* | **not measured** |
| NFS / EFS / Filestore | *unknown* | **not measured** — run the tool; do not assume |

**Check before shipping, from where the server reads.** `cargo build -p check-fastpath
--release`, then `check-fastpath /srv/studies` — the directory, not a file; it creates and
removes a probe file, so it works before any study is in place, and prints the filesystem,
`read_ahead_kb` and the verdict. Exit **0** fast path, **1** fallback, **2** could not
determine, so it can gate a rollout. Ship it in the image and run it inside the container
(`docker exec` / `kubectl exec`): the host's answer is not the container's.

**Serve studies from a mounted volume, never from the container's own layer.** A bind mount
carries the underlying filesystem through — verified: the same directory reports `overlayfs /
REFUSED` inside an overlayfs tree and `ext2/ext3/ext4 / honoured` with an ext4 bind mount over
it. A study `COPY`'d into the image works, passes tests, and has silently lost the fast path —
as the 2026-08-31 campaign's overlayfs host had, which is part of why it concluded wrongly.

```bash
docker run -v /srv/studies:/srv/studies:ro \
  --ulimit nofile=65535:65535 --ulimit memlock=-1 myserver
```

In Kubernetes, a read-only PVC on a block device (EBS, PD, Azure Disk, Ceph RBD: ext4 or XFS).
Not `emptyDir: {medium: Memory}` (tmpfs); plain `emptyDir` is node disk that does not survive
rescheduling. A PVC on a network filesystem (EFS, Filestore, NFS) must be checked.

### Limits: `ulimit -n` and `ulimit -l`

A tile session that misses keeps one io_uring and one eventfd for its life: **2 fds, 8.7 KiB
of locked memory, 15.6 µs to build** (`lab/disk-access-bench/src/bin/ring_scale.rs`); more
slots are more entries in the same ring.
Ring memory is charged against **`RLIMIT_MEMLOCK`** unless the process holds `CAP_IPC_LOCK`
(kernel 6.18, `io_uring/memmap.c`, verified). The 8 MB default is **~940 rings**, and it bit
first on a real host: two cells of a scale run were refused by it. The failure is silent — the
ring is refused, the session falls back to the pool and gets slower. The descriptor budget is `2
× sessions that miss + sockets + 1 per study`.

In a unit file, `LimitNOFILE=65535` and `LimitMEMLOCK=infinity` (or at least 16 KiB × the
sessions expected to miss at once). Kubernetes has no per-pod ulimit — the node runtime's apply;
`cat /proc/<pid>/limits` inside the running container is the honest check anywhere.

### Read-ahead

`check-fastpath` prints `read_ahead_kb` because it moves every measured miss rate by **2–15×**.
Linux's default is 128 KiB; the validation host shipped 8 192, the workstation 4 096 on its
btrfs bdi (not the 128 its block device reports), the cloud rig 2 048. The fill no longer
depends on it (`FILL_WINDOW`); tiles still do. Record it with any published number
(`/sys/block/<dev>/queue/read_ahead_kb`; `blockdev --setra 16384` sets 8 MiB, not persistently).

### P0 — validate on the production target before touching anything

One campaign run on the cloud instance, volume class and container image: `product_tile`
against `pool`, cold, both frame sizes, 64–256 sessions at depth 4, `check-fastpath` on the
study volume and `ulimit -l` recorded. The rule is fixed in advance: a tie deletes the ring and
ships the pool; a resolved margin keeps it and folds in the ring-fd change. It can go either
way, because a cloud miss is device-bound and the ring's remaining claim is threads and CPU per
miss. Status in §9.

## 7 · Invariants

What the code depends on and the types do not enforce, each pinned by a named test.

* **One index per study, never per session.** `FrameStore` is opened once and shared by
  `Arc`; 12 B per frame, immutable after open. A per-session store would cost 384 MB instead
  of 384 KB at a thousand readers. `sessions_share_one_store_rather_than_opening_their_own`.
* **The bytes quinn sends are process-private.** The read path copies into a buffer from
  `media/frame_pool.rs`, hands that buffer to quinn and gets it back on acknowledgement; it
  never hands quinn a mapping — which is why `server/` has no mapping at all; the mmap arms
  live in `lab/`. `a_handed_off_frame_is_the_buffer_itself_and_comes_back_when_dropped`.
* **A ring is never built where `RWF_NOWAIT` is refused.** Otherwise every warm tile would
  go through it, the `uring` arm's +131–142 % CPU on hits. `lazy_ring_is_never_built_without_nowait`.
* **A buffer is never grown or reused while the kernel owns it.** Dropping a ring drains its
  reads first; an abandoned fill read is settled before its buffer is reused.
  `dropping_a_reader_mid_read_waits_for_the_kernel`, `an_abandoned_read_ahead_is_awaited_before_its_buffer_is_reused`.
* **A fill never builds a ring.** `SeqReader` has two buffers and the pool. `a_fill_never_holds_more_than_one_read_at_once`.
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
| `read_ahead_kb` and layout | miss rates moved **2–15×** by that one knob; the layout study measured **17.6×** on the same reads, against 2–4× for the read path (`git show read-path-evidence-2026-09-09:docs/disk-layout/`) | Not tuned; layout undecided |
| Bounded frame cache | −20.2 % CPU at a 0.92 hit rate | Lab only — needs a real ask trace |
| AEAD provider (`aws-lc-rs` for `ring`) | +3–5 % CPU at 32 KB, tie at 250 KB, +10–18 % RSS | **Measured 2026-09-10, not taken** |
| Release profile: `lto = "fat"`, `codegen-units = 1` | −4 to −8 % CPU per frame, every cell | **Landed 2026-09-10**; 4× longer release rebuild |

**Where scale actually binds.** A 250 kB copy is ~11 µs of a ~675 µs frame, and L2-resident
(measured on the copy into quinn, which the pooled hand-off has since removed); per-datagram
QUIC work runs out of CPU long before the copy runs out of memory bandwidth. The levers that
reach the bound are sending fewer datagrams and not doing the read at all.

## 9 · What is next

Nothing here blocks the code that ships. Order set with the owners (§2).

| # | Item | Why it is still open |
| --- | --- | --- |
| 1 | **P0 — ring vs pool on the production target** | §6. Sandbox, workstation and agent container gave three answers. **The cloud rig cannot answer it** (L7, 2026-09-18): burstable, stolen CPU, every p99 60–100 ms (§11, *A study past RAM*). A non-burstable host is needed |
| 2 | **`server_ab.sh` on the workstation** | **Done 2026-09-09**: cold depth 4 −42.1 %, 16/16, RESOLVED, where the sandbox missed the bar (§11, *Serving depth*). Still one bare-metal host and untested on the production instance type — that is P0's run |
| 3 | **Throttled link** (20 Mbps, 50 ms, 1 % loss, cold tiles, client depth 4) | Predicted tie: the wire hides the 0.2 ms depth 2 → 4 saving. Unmeasured |
| 5 | **Deploy limits in the manifest** | `LimitMEMLOCK` / `LimitNOFILE` or `CAP_IPC_LOCK`, and `check-fastpath` on the study volume (§6). Not in a unit file yet |
| 6 | **`read_ahead_kb` and study layout for tiles, per target** | on-demand missed 14–69 % at the stock value in the fill cells; on the cloud rig 128 against 2 048 was no clean result in any cell. A large value hurts only the fill's tail, which `FILL_WINDOW` fixed |
| 7 | **Park on the ring fd, drop the eventfd** | 1 fd per session instead of 2, ~30 lines fewer, measured tie. The *only* way to cut the eventfd's per-hit cost (§11, *Short io_uring completions*). Only after P0 keeps the ring |
| 8 | **`io-uring` 0.7.14 → 0.7.15** | Drop-in. After P0 |
| 9 | **Bounded frame cache** | §8. Needs a real ask trace to size |
| 10 | **The two readers on the workstation** | the only full-arm measurement of `SeqReader` and `TileReader` ran in the agent container (noise floor up to 24 %): direction and shape, not magnitude. Re-run there and replace those cells (§12) |
| 13 | **Short io_uring completions on a regular file** | the lab now resubmits the tail and counts them; 0 in 1 032 workstation rows. Incidence on other hosts and sizes past 250 kB is unmeasured |

Numbers are kept because older records cite them; 4 is closed (§8), the missing ones closed or
built. **Not established anywhere**, named so they are not quoted as measured:
frames past 250 kB (native DBT is ~3 MB); storage faster than ~1.25 GB/s, where io_uring's 5
threads against the pool's hundreds might start converting (the workstation's 1.5–1.6 GB/s
semi-sequential ceiling was device-bound and may be the NVMe's own cache); `hybrid_lazyring`
on the 4 vCPU sandbox or the GitHub runner; a second bare-metal host.

## 10 · How it is built

### How a read works

The planner's `Mode` picks the reader; each is built on the first frame of its kind.

**Fill — `SeqReader`.** Two buffers. `next` is the frame the planner will ask for after this
one, and its pooled read is running by the time `read` returns; only it may still be with the
pool. Then the reader advises `FILL_WINDOW` past `next`, extended a quarter window at a time (one
syscall per megabyte walked) and restarted on a seek. Frames sit in index order in the bundle,
so the bytes after `next` are the frames after it.

**Tiles — `TileReader`.** `slots` frames: current first, then upcoming that fit, then wait — the
measured order. The probe is the whole frame; a shortfall goes to the ring, or to the pool where
the ring is refused. A new read takes a slot with no read in flight when there is one.
`WTPACS_READ_PATH` is resolved once in `TileReader::new`; `probe: false` *is* the `uring` lever.
`Ring` is not an `Option`: a refused ring must be neither retried on every miss nor fail the
ask, so `Off` means both "never wanted" and "refused".

**The ring** is set up with `COOP_TASKRUN`: `SINGLE_ISSUER` and `DEFER_TASKRUN` are unusable
because tokio migrates a task between workers, and blocking in `io_uring_enter` would be the
stall this exists to prevent, so the reader parks on an eventfd (plain `register_eventfd`). A
short completion is resubmitted for its tail. Buffers are **not** registered: that pins pages
against `RLIMIT_MEMLOCK`, and the lab arm that registered them tied on misses.

Also: the pool path reads ahead too (the `JoinHandle` is held, not awaited); delivery stays in
ask order — reading *n+1* early is pipelining, not reordering; the planner bounds `in_hand` at
`ASKS_AHEAD`, streams `RequestFrames` rather than collecting the batch, and stops upcoming at
the first `Fill` or `EndSession`. `READ_WINDOW` (64 KiB) is off the product path; it survives in
tests and in the lab arms that reproduce the capped probe. `--no-default-features` alone has no
rustls provider and does not link; add `--features crypto-ring`.

### The trap

On overlayfs or tmpfs, `RWF_NOWAIT` returns 0 for every read, hit or miss. A ring keyed only on
"the inline read came up short" would then serve every warm ask through the ring — the `uring`
arm, **+131 to +142 % on hits, RESOLVED**. The ring is gated on
`FrameStore::nowait_supported()`, not on the shortfall alone.

| `RWF_NOWAIT` | io_uring | Path |
| --- | --- | --- |
| honoured | available | inline hit; tiles take the ring on a miss; a fill stays on the pool |
| honoured | unavailable | inline hit, `spawn_blocking` on the miss |
| refused | either | one pooled `pread` per frame, ~2.5× worse per frame. **Never the ring** |

### Flags

No performance toggle: `TileReader` already chooses per session, and the arm a "miss-optimised"
flag would pick is the trap above. `WTPACS_READ_PATH=pool` is the **kill switch** (the pre-ring
path on tiles); `uring` is a lab lever; an unrecognised value warns and uses `auto`; a fill
ignores it. `--force-pool-reads` (lab) clears the store's `nowait` at open, so every frame
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
  `uring` feature. A fill-only session is always `ring=false`.
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
| Slot count is a constructor argument | `a_tile_reader_holds_as_many_frames_as_it_was_given_slots` |
| A hit never builds a ring | `lazy_ring_is_not_built_when_every_read_hits` |
| No ring where `RWF_NOWAIT` is refused | `lazy_ring_is_never_built_without_nowait` |
| The `uring` lever serves whole frames through the ring | `the_uring_lever_serves_whole_frames_through_the_ring` |
| Dropping a ring mid-read waits for the kernel | `dropping_a_reader_mid_read_waits_for_the_kernel` |
| A parked reader is woken (the `_async` eventfd hangs it) | `a_read_that_cannot_complete_inline_wakes_the_parked_reader` |
| The session line reports the miss rate | `read_stats_report_the_session_miss_rate` |
| The frame quinn sends is the pooled buffer, and it comes back | `a_handed_off_frame_is_the_buffer_itself_and_comes_back_when_dropped` |
| One store per study | `sessions_share_one_store_rather_than_opening_their_own` |
| `in_hand` cannot grow with ask rate | `the_loop_holds_no_more_than_asks_ahead` |
| Upcoming stops at Fill | `upcoming_stops_at_the_first_ask_that_is_not_a_frame` |
| Fill and EndStream on the wire | `empty_stream_frames_is_the_whole_study`, `end_stream_stops_a_fill_on_the_wire` |

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

Everything else is a **tie** — not a small effect. `lab/scripts/s5_split.py` applies it. The
rule is defined on **paired** per-cell deltas, not pooled medians per arm, and the two disagree
by about 2× on the comparison most wanted: `uring` against `hybrid_lazyring` on misses is
−41.9 % as a ratio of medians and −24.0 % (a tie) as the median of per-cell ratios, on the same
84 cells. It has been misread as a 42 % win twice; run `lab/scripts/pair_arms.py` first. Never
compare p50 across arms whose `peak_in_flight` differs.

### The ring on the miss, and where its margin comes from (2026-09-06)

Four hosts, six runs, 4 KiB–250 KB. `hybrid_lazyring` (inline probe, ring built on the first
miss — what ships for tiles) is **tied for cheapest CPU per read at every miss rate** and
**−61.8 / −64.4 % RESOLVED** against `pool` on misses. `pool_ringloop` holds the loop fixed to
split the two: the **ring** is **−42 to −73 % RESOLVED on misses on every host and run**; the
**loop** is a smaller, core-dependent term (nothing on 4 vCPU, −48 to −53 % on mixed cells at
8 CPU). Ring arms stay at **5 OS threads** to 128 readers where `pool` reaches 381. Re-measured
2026-09-08, `uring` against `hybrid_lazyring` on 16 KiB misses ties at depth 1 / 4 / 16, and its
hit penalty exceeds its miss saving everywhere: breakeven at 53 % misses at depth 4, 64 % at 16.

**The margin decays with frame size**: a round trip costs what it costs, and the rest of a read
scales with its bytes. `hybrid` against `pool` on misses is −62 / −58 / −46 % at 4 / 16 / 64 KiB
and **−24.8 %, a tie, at 250 KB** (`v22`; `v10` agrees). A 250 KB run on an 8 GB fixture agreed:
whole-frame io_uring against whole-frame `spawn_blocking` ties at 1–32 readers, while escalating
the pool read to the rest of the frame was **2.1× at one reader, 3.0–3.2× at 8–32**, identical
warm. On that ~1.25 GB/s device a blocking pool capped at four threads lost nothing at 32 readers.

### Re-measured on the code that ships (2026-09-09)

`read_campaign`'s `product` arm drives the shipped reader; 4 vCPU sandbox, depth 4, cold misses
98.8–100 %. At 16 KiB it ties `hybrid_lazyring` warm and cold; at 250 kB cold **`pool` was ahead**
(514 against 623 µs p50) — the size-dependence above. That arm modelled depth as session count,
a defect corrected under *Line 221*; the corrected arm trailed `pool` by more.

**mmap: cheaper, and not safe.** In the harness that also times a quinn-shaped copy, `mmap_naive`
spends a third to a half less CPU than a windowed `pread` — exactly the bytes it never copies.
But at 250 kB cold every mmap arm has a **p99 of 3 276–3 914 µs** against 1 036, and
`mmap_naive` holds a worker for **3 991 µs**; the variants that make the fault safe are 2–3×
slower at 1.5–2× the CPU. Its cold median flatters it (cold ÷ warm 1.1× against 5.3× for
`pread`): fault-around pulls in neighbours, so **it is not doing the same I/O faster, it is doing
less of it.** The workstation reproduced the freeze: 2 187–3 699 µs against 233–1 001.

**On the workstation** (8-thread i5-8250U, btrfs-on-LUKS over NVMe, a miss is a real device
read; 12 interleaved repeats; desktop up, governor unpinned, so absolute µs carry drift),
250 kB cold `product` against `pool` is **+38.5 % p50, +36.5 % CPU, RESOLVED at depth 1**,
while `hybrid_lazyring` **ties** `pool` at every depth. **That retracted "the shipped path *is*
the arm" at 250 kB**: the penalty was the old `ReadCtx`'s, not the ring's; *Line 221* found it.
At 16 KiB they tie. 250 kB at depth 16 is past saturation there (×1.09 for 4× depth, every arm
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
between two modes); at `--monitors 0` the three arms read 34.4 / 34.6 / 34.8 µs. Every warm CPU
figure in the `w1_*_arms.tsv` dumps carries it; the cold cells do not.

### Short io_uring completions

The lab's ring arms were credited for bytes the kernel did not deliver: `drain` freed a slot on
any non-negative result, while the product and `pool` always completed the tail. `drain` now
resubmits the tail, `UringReader::short_reads()` counts it, and
`a_short_completion_is_resubmitted_for_its_tail` pins it on a pipe delivering 64 bytes in two
halves. On the workstation: 0 short reads on every ring arm at 250 kB cold, and **0 in all
1 032 rows** of the five w3 campaigns, so no published ring number needs re-running.

**`IORING_REGISTER_EVENTFD_ASYNC` is unavailable to this design.** It signals only for
completions posted from an io-wq worker, which on a `COOP_TASKRUN` ring is none of them, so a
parked reader is never woken. Applied to the product it hung every escalated read while the
server's suite passed. `a_read_that_cannot_complete_inline_wakes_the_parked_reader` closes that
gap (10 s timeout against `_async`, 0.05 s against `register_eventfd`). The eventfd's per-hit
cost is therefore not tunable; parking on the ring fd (§9 item 7) is the only way to remove it.

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
it: the old `product` arm modelled depth as *session count* (a `ReadCtx` per task); it survives
as `product_sessions`, and its depth-4 and 16 rows were withdrawn.

### Fill at scale

Contiguous walk, warm, 1 / 16 / 64 readers, 12 repeats, both sizes, CPU per ask: `product`,
`hybrid_lazyring` and `pool` **tie everywhere** (worst |median| 10.9 %) and hold **9 OS
threads** from 1 to 64 readers; `pooled_pread` loses (+69 to +501 % RESOLVED) and grows to
151–206 threads. **What separates them is the ring, paid by sessions that barely miss**: the old
reader built **1.00 ring per session** at every reader count, including a 16 KiB fill missing
1.6 % — two fds and ~8.7 KiB for the session's life to serve one read in sixty, against an 8 192
KiB memlock ceiling of **~941 sessions**. That is why a fill has its own reader. (A lab ring arm
that registers buffers fails outright at 64 readers × 250 kB; the shipped reader registers none
and falls back to the pool on refusal.)

### The two readers, every arm (2026-09-10, agent container)

Twelve arms, cold, depth 1, one reader, `--monitors 0`, six repeats; `product_tile` and
`product_fill` are the shipped readers. **Direction and shape only**: `pool` and
`pool_capped_probe` are the same code at 16 KiB and read 6.0–23.5 % apart here. Wall · CPU per
ask against the shape's own reader:

| arm | tile 16 KiB (~99 % miss) | tile 250 kB | fill 16 KiB (0.4 % miss) | rings |
| --- | --- | --- | --- | ---: |
| `product_tile` | — | — (1st) | −2.8 · −4.3 % tie | 1 |
| `product_fill` | **+62.0 · +133.0 % RES** | **+45.3 · +110.2 % RES** | — | **0** |
| `hybrid_lazyring` | +2.9 · +4.4 % tie | +14.8 · +15.6 % tie | −0.2 · −6.3 % tie | 1 |
| `uring` | −10.1 · −0.7 % tie | +5.2 · +16.3 % tie | +0.6 · +12.2 % tie | 1 |
| `pool` | **+66.7 · +134.4 % RES** | +17.5 % tie · **+51.7 % RES** | +0.1 · +1.0 % tie | 0 |
| `pooled_pread` | **+73.0 · +106.3 % RES** | **+31.9 · +54.6 % RES** | **+483.7 · +1734.4 % RES** | 0 |
| `tokio_fs` | — | — | **+513.9 · +1871.7 % RES** | 0 |

**Each reader is first-or-tied on its own shape and RESOLVED worse on the other** — the case for
the split — and `product_fill` builds no ring. Ring arms held 5 OS threads, pool arms 6. The
250 kB fill cell resolves nothing (every p99 3.3–4.3 ms). Not covered: depth above 1, more than
one reader, RSS, warm cells, the co-tenant gap.

### Fill against on-demand, cold, at stock read-ahead (2026-09-10)

4 vCPU sandbox, `frames_250k_deep` (8 GB) evicted before every cell, one session, 256 asks via
`server_ab`, before/after interleaved and reversed, three rounds, misses from `session reads`.
**A miss here is served from the hypervisor (~12 µs)**: rate, tail and direction, not magnitude.

| `read_ahead_kb` | arm | asks/s | p50 | p99 | fill miss rate |
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

### A study nobody has read (2026-09-18)

L20, headless Chromium through the shipped client (`lab/scripts/cold_study.sh`, 8 rounds,
120 × 256 KB), cold forced by `--force-pool-reads`, the server's `misses` read back per run.
One ask on an idle session: 6.5 ms warm, 7.0 cold (1 miss). A whole fill: 318.5 ms warm, 320.5
cold (120 misses). **A tie in both** (3/8 and 5/8 slower). The forced miss still reads from the
container's page cache, so this prices the executor-to-pool hop alone — ~0.5 ms on one ask,
nothing measurable across a fill. What a cold study costs is the device's. A coarse-to-fine fill
order, measured the same way, cost the read path 0.3 % (`lab/scripts/fill_order_cells.sh`).

### A study past RAM (2026-09-18, cloud rig)

L7. A 4 GB study on a 954 MB host, so reads reach the block volume with no eviction; native
driver on loopback; every run starts at a frame no earlier run read; asks 997 frames apart; six
interleaved rounds (`lab/scripts/l7_read_path.sh`). The device (`O_DIRECT`) is a throttled network
volume: random 256 KiB at depth 1 p50 1.3 ms in burst, 4.9 ms after; 51–53 MB/s sequential.

* **A spread ask misses (76–92 %), and a miss costs ~1 ms at p50**: 2.5–2.7 ms cold against
  1.5 ms warm, 6/6 on both read-ahead arms, disjoint ranges — L20's hop, and as much again.
* **The fill does not miss past RAM**: 1 %, as warm. `FILL_WINDOW` holds on a real device.
* **`read_ahead_kb` 128 against 2 048: no clean result in any cell.**
* **The host saturates on CPU; claim nothing past a median.** A burstable 2-vCPU instance losing
  ~2.6 s to steal over a 2.1 s fill; every p99, warm included, is 60–100 ms. P0 cannot be asked
  here.

### Hosts and closed risks

The `spawn_blocking` round trip is **24–34 µs** on a lab KVM Xeon, a GitHub runner EPYC, the
workstation (the only bare-metal host) and the agent sandbox — ext4, btrfs, read-ahead 128 KiB to
8 MiB — and no miss-regime row flipped on any host. Closed: single host (R1); synthetic fixture
(R3); force- rather than pressure-evicted (R4, cgroup cap verified by `failcnt`); ring count at
scale (R5, 128 rings at 53–79 % miss spawn no io-wq workers; `pool` reaches 265 threads);
filesystem support (R6, `check-fastpath`); loop against ring (R8). Open, not worth closing:
guest-cold understates the ring (R2); one read per ask affects every arm alike (R7).

## 12 · Re-running the evidence

`lab/disk-access-bench` stays a workspace member on the tip (the 2026-08-31 decision went wrong
partly because its harness had to be restored from a commit), mmap arms included.

```bash
NAME=frames_16k_big  BYTES=16384  FRAMES=5120  ./lab/scripts/gen_live_cell_fixture.sh
NAME=frames_250k_big BYTES=250000 FRAMES=2048  ./lab/scripts/gen_live_cell_fixture.sh
NAME=frames_250k_deep BYTES=250000 FRAMES=32000 ./lab/scripts/gen_live_cell_fixture.sh   # 8 GB, the miss fixture
cargo build -p disk-access-bench -p check-fastpath --release
lab/scripts/read_path_ab.sh <base-commit>   # SeqReader / TileReader: every cell must tie
lab/scripts/server_ab.sh <base-commit>      # product server: cold depth 4 is the claim; fill and depth 2 tie
```

`read_campaign --arms product_fill,product_tile` drives the shipped readers themselves; the base
of `read_path_ab.sh` must know both arms. A sandbox number is a direction, not a magnitude.
**Make the miss real.** Use a fixture larger than the host cache: an 80 MB study fits in the
hypervisor, where a "miss" is ~12 µs and hides every miss-path effect. Consecutive asks must
stride past `read_ahead_kb` — of the filesystem's bdi, not the block device — or a cold cell is
a hit cell wearing a cold label, and **a stride calibrated on one host is not portable**: 16 KiB
asks miss 1.6 % at a 16 kB stride and 100 % at 262 kB on the sandbox (8 192 KiB), 93 % from 32
kB on the workstation (4 096); 250 kB asks miss 97.7–99.2 % from a 500 kB stride on both. Where
every read must miss, use `--force-pool-reads`, not eviction ([`CLAUDE.md`](../../CLAUDE.md)
§Measurement).

**The two readers on the workstation** (§9 item 10): the tile shape per `--size` in 16384, 65536,
131072, 250000, stride re-derived on the day —
`read_campaign --arms pool,uring,hybrid,pooled_pread,pool_capped_probe,pool_ringloop,hybrid_lazyring,uring_ringfd,hybrid_lazyring_ringfd,product_fill,product_tile --temps cold --depths 1,2,4,8,16 --readers 1,16,64 --monitors 0 --repeats 12`;
then the fill shape, `--stride` = `--size`, adding `tokio_fs`. Verdicts on wall and CPU per ask.
Three columns carry the claims: `rings` stays 0 for `product_fill`, `peak_named` follows
`--depths` past 4, and the 128 KiB / 250 kB penalty stays gone.

## Provenance

The full tables this ADR condenses: `git show 3143820:docs/disk-access/` (`EVIDENCE.md`,
`IMPLEMENTATION.md`, `DEPLOYMENT.md`, `NEXT.md`), the last tree before they were folded here.
TSVs and the design diary: tags `read-path-evidence-2026-09-09` (do not move it),
`read-path-workstation-2026-09-09`, `read-path-evidence-2026-09-10`, `read-path-w2-2026-09-10`,
`read-path-w3-2026-09-10`. Earlier campaigns: `git show a330783:docs/disk-access/`. The
2026-08-31 decision: `git show be78860:docs/disk-access/adr.md`.
