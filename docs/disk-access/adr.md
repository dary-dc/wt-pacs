# ADR: how the server reads SBND frame bytes

**Status:** Accepted · current as of **2026-09-10** · supersedes the 2026-08-31 always-touch
decision (provenance at the end)
**Evidence:** [`EVIDENCE.md`](EVIDENCE.md) — every number · [`IMPLEMENTATION.md`](IMPLEMENTATION.md) — how it works
**What is still open:** [`NEXT.md`](NEXT.md)

§1 is the decision. §2 is what shaped it, including the numbers that are safe to quote and
the claims that were retracted. §3 is how it got here. §4 is consequences and §5 every
candidate in one table. §6 is where it does not apply, and what to set. §7–9: invariants, the levers
outside it, what is next.

## 1 · The decision, as it ships

**Two readers, chosen by what the session is doing.** A fill knows the next frame; a tile
ask does not. That difference picks the escalation.

1. **A page-cache hit is served inline.** The whole frame is probed with
   `preadv2(RWF_NOWAIT)` on the executor thread. It returns short instead of waiting on the
   disk, so a cold frame can never park a worker, and a warm ask takes no thread hop at all.
2. **A fill (`SeqReader`) stays on the pool.** Two buffers, the next frame named
   (`FILL_AHEAD = 1`), one `spawn_blocking` + `pread` for a miss. No ring, no extra fd.
   `peak_in_flight` is 1. A sequential walk is read-ahead's best case (~one miss in sixty).
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
`Ask::Frame` per index, fed by an ask-reader task into a planner. `READ_WINDOW` (64 KiB)
chunks the **write**, not the read — the reader returns a whole frame.

What is *not* done: no memory mapping anywhere in `server/`; no whole-frame envelope; no
`mincore` gate; no `SQPOLL`, no registered buffers, no cursor reads.

| | |
| --- | --- |
| Where | `server/src/media/read_path.rs` (`SeqReader`, `TileReader`), `uring_reader.rs` (thin ring), `transport/planner.rs` (the loop), `transport/frame_out.rs` (the write) |
| Flag | `WTPACS_READ_PATH` = `auto` (default) · `pool` (kill switch, tiles) · `uring` (lab lever, every tile through the ring) |
| Feature | `uring`, on by default; the pool path is `--no-default-features --features crypto-ring` |
| Reports | `read_fast_path=` in the startup banner, WARN when it is the pool; `session reads hits=… misses=… miss_rate=… named=… in_flight=… ring=…` per session, default build, with fill/tile hits split |
| Validated | as the **product**: `read_campaign --arms product_fill,product_tile` drives the real readers |

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
| Every-read-through-the-ring vs ring-on-the-miss | misses tie; hits **+164.8 % CPU per ask at depth 1, RESOLVED** (`--monitors 0`) — why a hit must never touch a ring. The depth-scaled latency figures this row used to carry are retracted: [EVIDENCE](EVIDENCE.md) §Correction |
| Warm, vs the 2026-08-31 always-touch path | **60.9 µs vs 152.3 µs per frame (2.5×)**; neighbours' p99 166 vs 702 µs |
| A miss reading the rest of the frame vs the rest of the window, 100 % misses | **2.1× at one reader, 3.0–3.2× at 8–32** |
| OS threads | ring readers **5** (sandbox) / 9 (workstation), flat to 256 in flight; pool 125–135 at 64 readers, capped at 512 by tokio |
| Per session that misses | 2 fds, 8.7 KiB, 15.6 µs to build the ring; the second slot did not change the cost |
| Read ahead by one, cold 16 KiB at 99.6 % misses, one session (`v36`) | **+73.8 % asks/s, 12/12, RESOLVED**, p50 −53.4 %; **warm a tie** — the load-bearing row; 16 missing tiles 1.14 → 0.62 ms |
| The depth ladder on the shipped path (`v35`) | 1 → 2 is **+67.4 %** and collects 62 % of what depth 16 offers; from the medians 2 → 4 adds +37 %, 4 → 16 +28 % |
| Where the hosts stop separating the arms | ~64 reads in flight: the sandbox on CPU, the workstation on the device (~840 MB/s at 0.42 of 8 cores). **Past it every arm ties by construction** |
| Sequential streaming, 16 KiB, 8–64 sessions (`x15`) | shipped reader, pool and ring-on-miss **tie at ~3 µs per read**; `tokio::fs::File` 48–223 µs; the same on tokio's io_uring driver 141 µs–2.1 ms |

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
| "WILLNEED 4 MiB on a fill is free once the miss rate drops" | a cached study still pays the syscall: PR #27 browser fill **+7.5 %** `serve_us` (does not clear this file's 28.5 % bar; the sign is the reason). PR #28's combo cut 250 kB cold misses and p50, then lost on wall, p99, and 16 KiB cold wall. **Not landed.** [`EVIDENCE.md`](EVIDENCE.md) §Store / single-request hunt |

## 3 · How the decision evolved

| Date | Decision | What changed it |
| --- | --- | --- |
| 2026-08-31 | mmap, pages pre-touched on the blocking pool every ask | overturned: its harness ran a current-thread runtime while the product is multi-thread (a hop costs 40 µs there, 103 µs here); its neighbour cell never let neighbours pay the hop; `RWF_NOWAIT` was never in its table |
| 2026-09-04 | `RWF_NOWAIT` inline, `spawn_blocking` for the shortfall | 2.5× warm against always-touch; io_uring a tie — at the ~0 % miss rate those cells fixed |
| 2026-09-06 | the ring on the miss, built on the first miss | the read-path campaign, four hosts, six runs: **−42 to −73 % CPU per miss, RESOLVED everywhere**. Inert on warm workloads by construction, so it did not wait on the layout that decides the miss rate |
| 2026-09-07 | a miss reads the rest of the frame | on a fixture where a miss is a real device read, windowing the escalation cost 2–3 round trips per 250 KB frame and stopped scaling at ~1 600 f/s where whole-frame arms reach ~5 000 |
| 2026-09-08 | keep driving `io-uring` directly; **validate on the production target before any further backend change**; the sequential reader is the same reader forward; **read ahead by one built** for batches; **the server reports its own miss rate** | backend research with web access found no standard alternative (§5 C); the owners' weights and the container traps (§6) mean the ring's margin has to be shown on the target, not a laptop (`x14`, `x15`); read-ahead measured +73.8 % on missing tiles and a tie warm (`v36`); every threshold in this file is a miss rate, and the server could not report one |

## 4 · Consequences

| | |
| --- | --- |
| **Good** | Warm asks take no pool hop; a miss costs one round trip; OS threads stay flat at any session count; the reclaim guarantee holds; 64 KiB per session buffer instead of a 250 KB envelope per frame |
| **Good** | The decision is per session and automatic: a session that never misses never pays for the ring, and the kill switch is a flag, not a rebuild |
| **Cost** | ~800 lines of custom code with tests and 8 `unsafe` sites, on top of the `io-uring` crate — maintained, and tokio's own dependency. The glue is ours; the ring is not |
| **Cost** | 2 fds and 8.7 KiB per session that misses, the latter charged against `RLIMIT_MEMLOCK` (§6) |
| **Cost** | Two copies (kernel → window, window → quinn) where mmap needs one; measured cheaper than the hop it replaces on every cell. Four `write_all` calls per 250 KB frame. A reader that misses grows its buffer to frame size and keeps it |
| **Conditional** | The win is on misses. On local NVMe the ring is 56–75 % of a miss; on cloud block storage a miss is device-bound and the ring's margin is threads and CPU per miss, not latency. That is the one thing P0 exists to measure |
| **Conditional** | Where `RWF_NOWAIT` is refused or a ring is refused, the session runs the pool. The server now says which path it took, in the startup banner and per session; deployment (§6) is still part of the decision |
| **Scale** | This decision moves about a fifth of a frame's server CPU; per-datagram QUIC work is the rest (§8). Tiles serve at **`TILE_SLOTS` = 4**; fill names one frame ahead and never builds a ring. The loop is a planner over a channel of `Ask`. Depth 2 → 4 was +37 % on the sandbox host |
| **Risk** | The hit rate is access-shape-conditional. Whole frames in order let read-ahead run ahead of the loop; serving a codestream *prefix* per frame strides the file and misses 319 of 320 cold. The fix is the packer, not the reader |

## 5 · Every candidate, one table

Scored on the owners' three criteria. **Latency** is p50 on the regime named; **scale** is what
the option costs at thousands of sessions with several reads in flight — OS threads, fds,
CPU per miss; **simplicity** is code owned and risk carried. Numbers are measured unless a row
says otherwise; "tie" is the campaign's rule (median under the resolution threshold, or signs
at chance), and it is a real answer. Serves: **T** tiles (positional, out of order), **S**
sequential streaming, **B** both.

**Re-measured 2026-09-09 against the code that ships**, because the read path was reshaped
after most of these rows were taken: the fast path against the pool fallback, "a hit must
never touch a ring", and mmap's co-tenant freeze all reproduce; the **ring against the pool
on the miss path resolves only at depth 16** on that host, which is P0's question and why
that row says *conditional*. **And it is size-dependent as well as depth-dependent**: at
250 kB cold the pool beats the ring at both depths, so P0 must run both frame sizes.
**The measured tables are [`EVIDENCE.md`](EVIDENCE.md).**

| Candidate | Serves | Latency | Scale: threads · fds · CPU per miss | Simplicity · risk | Verdict |
| --- | --- | --- | --- | --- | --- |
| **`RWF_NOWAIT` inline for hits, 64 KiB windows** | B | warm 48 µs/frame, 2.5× vs always-touch; no hop on a hit | no thread per hit; 0 fds | one `preadv2` call; filesystem-conditional (§6) | **Accepted** |
| **Ring per session, built on the first miss, whole rest of the frame** | T | **host-dependent, and P0's question.** Sandbox: misses −56 / −70 / −75 % CPU vs pool at depth 1 / 4 / 16. Workstation: a **tie at depth 1**, where the pool was the cheaper of the two (311 vs 326 µs CPU/ask). Agent container: the pool is **+106 to +138 % CPU, 6/6 RESOLVED**. Three hosts, three answers | **5 threads flat** to 256 in flight; 2 fds + 8.7 KiB per missing session; 15.6 µs to build | ~800 lines with tests, 8 `unsafe`, on a maintained crate; container traps (§6) | **Accepted for tiles** — conditional on P0 |
| **`TileReader` — probe, ring on the first miss, `slots` frames named** | T | beats every pool arm **RESOLVED on wall *and* CPU** at 16 KiB cold, ties every ring arm, and is 1st of eleven at 250 kB; **+73.8 % asks/s** on missing tiles at depth 2, warm a tie; 16 tiles 1.14 → 0.62 ms | 5 threads; 2 fds + 8.7 KiB per session that misses; `slots` defaults to 4 | the old `ReadCtx` minus the window cap and the mode machine | **Accepted** |
| **`SeqReader` — probe, pool on the miss, one frame named** | S | ties every serious arm on a cold sweep at both frame sizes; `peak_in_flight` is **1 by construction**, which is what bounds its threads | 6 threads; **0 rings, 0 fds, 0 memlock** — no ~941-session ceiling | two buffers, no slot table, no `unsafe` | **Accepted** |
| **Read ahead (`TILE_SLOTS` / `FILL_AHEAD`)** | B | tiles name up to `slots − 1`, a fill names one; look-ahead **is** depth 2, not a separate effect ([EVIDENCE](EVIDENCE.md)) | four tile slots / two fill buffers | `slots` is a constructor argument, so a campaign sweeps depth | **Accepted** |
| `spawn_blocking` + `pread` for the miss | B | identical on hits; on 16 KiB misses the shipped reader is −45.4 % CPU against it, and its tail widens with depth | **125–135 threads at 64 readers, 512 cap** (517 seen at 64 × 16); 0 fds | the simplest correct reader; zero `unsafe` beyond `preadv2` | **Kept as fallback**; ships if P0 ties |
| Escalate only the rest of the window | B | 2–3 device round trips per 250 KB frame: 1 404–1 573 f/s vs 4 539–4 777 | flat at ~1 600 f/s from 8 to 32 readers | — | Superseded 2026-09-07 |
| Every read through the ring (`uring`) | B | hits **+224 % CPU at depth 1, RESOLVED**; above depth 1 a 16 KiB tie on CPU and throughput, ~+30 % throughput at 250 kB; streams +143–190 % at 8–64 sessions; misses tie | 5 threads; lowest CPU per miss | one path, but a hit must never touch a ring | Rejected as default; kept as a lab flag |
| Ring pipelining (read *n+1* during write *n*) | T | ~6 % on a 100 %-miss trace, −25 % warm | 2× session memory | — | Rejected |
| `SQPOLL` | B | worse warm on every column; cold tail unresolved | **2.8× CPU** | a kernel thread **per session**, and `COOP_TASKRUN` is refused alongside it | **Rejected, closed** — structural: `COOP_TASKRUN` is refused alongside it |
| Registered buffers | B | no change | memlock per buffer | more `unsafe` | Rejected — measured unnecessary |
| Ahead-N `POSIX_FADV_WILLNEED` | T | **4.6–4.9×** on a cold strided read; a loss on a sweep | one syscall | a routed choice waiting on a layout design | Measured, not landed |
| Fill `POSIX_FADV_WILLNEED` (`FILL_WINDOW` 4 MiB) and miss-overlap | S | PR #27: 250 kB cold miss 59–66 % → ~1 % (n=3); warm p50 a tie; browser fill on a cached study +7.5 %. PR #28 combo: miss 35 % → 7 % and p50 −68.9 % (12/12); wall a tie; p99 worse; 16 KiB cold wall +76 % RESOLVED. Naive nowait overlap retracted (miss rate doubled) | one syscall per quarter window | the warm/p99 tax is the load-bearing row | **Not landed** — [`EVIDENCE.md`](EVIDENCE.md) §Store / single-request hunt |
| Park on the ring fd instead of an eventfd (`x14`) | B | tie on CPU and latency everywhere | **1 fd per session instead of 2**; one syscall fewer per park | ~30 lines fewer, 2 `unsafe` fewer; same mechanism tokio uses | Proposed, after P0 |
| One shared ring per runtime (tokio's shape) | B | **1.36–1.45× slower** than a ring per thread on concurrent positional reads (tokio #8367); reproduced on streams | 0 per-session fds; one lock across every session | a dispatcher and a waker slab | Not now |
| Whole-frame `RWF_NOWAIT`, one read | B | best miss throughput of any arm | — | 250 KB uninterrupted executor copy: **4.0 ms** warm `gap_max` | Rejected |
| Larger window (128 / 256 KiB) | B | −12–25 % warm throughput | — | wider executor copy | Rejected |
| mmap, naive | B | faults freeze co-tenants: `gap_max` 1.5–4.2 ms, 7.7 ms under pressure | — | no copy, no safety | Rejected |
| mmap + `mincore` gate | B | unsafe under pressure 5/5 runs | — | residency is not a lease | Rejected |
| mmap + always-touch on the pool (2026-08-31) | B | 103 µs/frame, 702 µs neighbour p99: a hop on every ask | a thread per ask | safe, slow | Rejected as default |
| mmap + touch via `block_in_place` | B | 38 µs but worst neighbour p99 (2.1 ms) | evacuates a worker | — | Rejected |
| `madvise(POPULATE_READ)` | B | within noise of the touch loop | — | — | Rejected |
| `tokio-uring` 0.5.0 | T | — | — | own current-thread runtime; last release 2024-05, last commit 2025-07 | Rejected — transport rewrite |
| `glommio` · `monoio` · `compio` | T | — | — | thread-per-core runtimes; `compio-quic` is the rewrite's shape | Rejected — transport rewrite |
| tokio's own io_uring driver | S (no positional read) | one session 6 µs; **2.1 ms per 16 KiB at 64 sessions**, ⅓ of the device; executor gaps 10× any other arm | one locked ring per runtime; one fd per session | `--cfg tokio_unstable` in a medical build | Rejected — measured |
| `tokio::fs::File`, plain | S | **48–223 µs per 16 KiB** vs 3 (a thread hop and a copy per read) | threads grow like the pool's, 517 at 64 × 16 | the standard answer, and 15× slower | Rejected — measured |
| `rio` · `ringbahn` · `nuclei` · `uring-fs` · `luring` and 90 other dependents | T | — | — | soundness hole, dead, own runtime, cursor + thread, `LocalSet`-only | Rejected — none drives a ring on multi-thread tokio with positional reads |
| `sendfile` / `splice` | B | — | — | userspace QUIC copies anyway | Rejected |
| `O_DIRECT` + SPDK, whole-study preload | B | — | loses the page cache shared across sessions | wrong scale | Rejected |
| Bounded process-private frame cache | T | **−20.2 % CPU** at a 0.92 hit rate; +4.2 % where nothing repeats | duplicates RAM the page cache holds | needs a real ask trace to size | Lab only, not ported |
| `write_chunk` owned windows to quinn | B | −3.2 % at one session; **+14.6 / +19.1 % at 16 / 32**, RESOLVED | a fresh 64 KiB allocation per window | — | Rejected, more so at scale |
| Sequential: `SeqReader`, one frame ahead, pool only | S | ties pool and ring-on-miss at ~3 µs per 16 KiB; read-ahead makes 96–99 % of asks hits | 5 threads; one fd per study; no ring | its own reader, because a fill that builds a ring pays 2 fds for one miss in sixty | **Accepted** |
| Sequential: wider windows | S | 20–30 % less CPU per byte | escalations climb 1 % → 13.5 % | — | Rejected |
| Sequential: depth above 2 per stream | S | at 64 sessions × 16 every arm queues on the device, p99 100–190 ms | — | the wire is 200× slower than a warm read | Rejected as a rule |

## 6 · Deployment: where the decision does not apply, and what to set

Both fallbacks degrade to the pool **per session**, and since 2026-09-08 the server says so:
`read_fast_path=` in the startup banner (WARN when it is `pooled_pread`) and `ring=` in every
session's `session reads` line. They still belong in the manifest, not in a post-mortem —
[`DEPLOYMENT.md`](DEPLOYMENT.md) has the Docker, compose and Kubernetes snippets and the unit
file lines (`LimitNOFILE=65535`, `LimitMEMLOCK=infinity` or at least 16 KiB × the sessions
expected to miss at once).

* **overlayfs refuses `RWF_NOWAIT`** — and a container's own filesystem is overlayfs. A
  study baked into the image never gets the fast path; a bind-mounted or block volume is the
  host filesystem and does. `check-fastpath <study dir>` answers it in one command.
* **Ring memory is charged against `RLIMIT_MEMLOCK`** unless the process holds
  `CAP_IPC_LOCK` (kernel 6.18, `io_uring/memmap.c`, verified). 8.7 KiB per session that
  misses: the 8 MB default is ~940 rings; container runtimes often set less. `LimitMEMLOCK`
  and `LimitNOFILE`, or the capability, go in the unit file.
* **P0 — validate on the production target before touching anything.** One campaign run on
  the cloud instance, volume class and container image: `product` against `pool`, cold,
  64–256 sessions at depth 4, `check-fastpath` on the study volume and `ulimit -l` recorded.
  The rule is fixed in advance: a tie deletes the ring and ships the pool; a resolved margin
  keeps it and folds in the ring-fd change. It can go either way there, because a cloud miss
  is device-bound and the ring's remaining claim is threads and CPU per miss.

## 7 · Invariants

Properties the code depends on that the type system does not enforce; each is pinned by a
named test.

* **One index per study, never per session.** `FrameStore` is opened once and shared by
  `Arc`; 12 B per frame, immutable after open. A per-session store would cost 384 MB instead
  of 384 KB at a thousand readers. `sessions_share_one_store_rather_than_opening_their_own`.
* **The bytes quinn sends are process-private.** The read path copies into a session-owned
  buffer and never hands quinn a mapping — which is why `server/` has no mapping at all; the
  mmap arms live in `lab/`. 
* **A ring is never built where `RWF_NOWAIT` is refused.** Otherwise every warm tile would
  go through it, the `uring` arm's +131–142 % CPU on hits. `lazy_ring_is_never_built_without_nowait`.
* **A fill never builds a ring.** `SeqReader` has two buffers and the pool. `a_fill_never_holds_more_than_one_read_at_once`.
* **Tile depth is `slots`, default `TILE_SLOTS`.** `naming_upcoming_tiles_starts_their_reads_before_the_current_one_finishes`.

## 8 · Levers outside this decision

This ADR moves about a fifth of a frame's server CPU. The rest is per-datagram QUIC work,
and the bigger levers live there. Recorded so the read path does not quietly become the
whole plan.

| Lever | Worth | Blocker / cost | Status |
| --- | --- | --- | --- |
| **`max_udp_payload_size` 1472 → 4000 B** | **−35 % CPU, +55 % throughput** — the largest effect measured anywhere in this investigation | the peer must advertise the same ceiling, and the peer is a browser; above 4000 B path discovery failed and fell back to 1200 B | **Measured, not taken.** Price it first |
| **Serving depth ≥ 4** — `TILE_SLOTS` = 4, fill names one ahead | **+73.8 % asks/s** on missing tiles at depth 2; 2 → 4 a further +37 % on this host | the throttled-link cell and P0's depth ladder | **Built**; unmeasured on the default link ([`NEXT.md`](NEXT.md)) |
| `read_ahead_kb` and layout | miss rates moved **2–15×** by that one knob | per target | Not tuned |
| Bounded frame cache | −20.2 % CPU at a 0.92 hit rate | needs a real ask trace | Lab only |
| GSO datagram batching | ~10× fewer `sendmsg` | — | Already on in quinn |
| `write_chunk` owned windows | worse at scale (§5 D) | — | Rejected |
| Congestion controller, flow-control windows, AEAD choice | unknown | — | **Not measured** — named so they are not mistaken for rejected |

**Where scale actually binds.** The copy into quinn is ~11 µs of a ~675 µs frame, and
L2-resident; per-datagram QUIC work runs out of CPU long before the copy runs out of memory
bandwidth. The levers that reach the bound are sending fewer datagrams and not doing the
read at all — not doing the read faster.

## 9 · What is next

[`NEXT.md`](NEXT.md). Serving depth is built. The top of what remains: P0 on the target,
the workstation A/B, the transport lever above, the deploy manifest.

## Provenance

Earlier campaign documents: `git show a330783:docs/disk-access/<file>` for
`SEND-BUDGET.md`, `READ-PATH-DECISION.md`, `S5-CONTROL-ARM.md`, `SCOREBOARD.md`.
The 2026-08-31 decision: `git show be78860:docs/disk-access/adr.md`.
This branch's tables and design diary: `git show read-path-evidence-2026-09-09:docs/disk-access/`.
The w1–w3 dumps: `git show read-path-evidence-2026-09-10:docs/disk-access/`.
The harness is `lab/disk-access-bench`, a workspace member.
