# ADR: how the server reads SBND frame bytes

**Status:** Accepted · current as of **2026-09-08** · supersedes the 2026-08-31 always-touch
decision (provenance at the end)
**Evidence:** [`EVIDENCE.md`](EVIDENCE.md) — every number · [`RERUN.md`](RERUN.md) — the
instrument and its precision rules · [`IMPLEMENTATION.md`](IMPLEMENTATION.md) — how it works
and what is validated
**What is parked, in order:** [`NEXT.md`](NEXT.md)

§1 is the decision. §2 is what shaped it, including the numbers that are safe to quote and
the claims that were retracted. §3 is how it got here. §4–5 are consequences and every
alternative measured. §6 is where it silently does not apply. §7–9: invariants, the levers
outside it, what is next.

## 1 · The decision, as it ships

**Bytes come in three ways, chosen per session at runtime by what the session does.**

1. **A page-cache hit is served inline.** Each 64 KiB window of a frame is read with
   `preadv2(RWF_NOWAIT)` on the executor thread. It returns short instead of waiting on the
   disk, so a cold frame can never park a worker, and a warm ask takes no thread hop at all.
2. **A miss goes to a ring built for that session on its first miss.** io_uring, driven
   through the `io-uring` crate directly: registered file, unregistered buffers, two slots —
   one per window — and completions awaited through tokio's `AsyncFd`, never waited on. The ring
   reads **the rest of the frame** in one round trip, never the rest of the window. A session
   whose reads all hit never builds a ring, so on a warm workload the mechanism is inert.
3. **The fallback is `spawn_blocking` + `pread`.** Where the filesystem refuses
   `RWF_NOWAIT` (overlayfs, tmpfs) or the kernel refuses a ring (limits), the session takes
   one pooled read per frame. Same guarantee, one hop per ask.

**And a batch reads one frame ahead.** A session keeps two windows, each with its own ring
slot; a frame served in a `RequestFrames` batch starts the read of the frame after it before
the frame in hand is waited on, so the device carries two reads. The read-ahead probes
`RWF_NOWAIT` first exactly as an on-demand read does and submits only the shortfall, which is
why a warm session pays nothing for a depth it never uses. Where there is no ring the pool
path reads ahead too. `RequestFrame` is still served at depth 1 — that is the session loop,
not the read path (§4, Scale).

The same reader serves both use cases: **tiles** (positional reads, out of order) and
**sequential streaming** (the same reader going forward, one frame ahead — §5, group E).

What is *not* done: no memory mapping anywhere in `server/`; no whole-frame envelope; no
`mincore` gate; no `SQPOLL`, no registered buffers, no cursor reads.

| | |
| --- | --- |
| Where | `server/src/media/read_path.rs` (the choice and the read-ahead), `uring_reader.rs` (the ring, two slots), `transport/frame_out.rs` (the wire loop) |
| Flag | `WTPACS_READ_PATH` = `auto` (default) · `pool` (kill switch) · `uring` (lab lever, every read through the ring) |
| Feature | `uring`, on by default; `--no-default-features` compiles to the pool path |
| Reports | `read_fast_path=` in the startup banner, WARN when it is the pool; `session reads hits=… misses=… miss_rate=… ring=…` per session, default build |
| Validated | as the **product**: `read_campaign --arms product,product_ahead` drives the real `ReadCtx` and ties the lab arm that won |

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
| Every-read-through-the-ring vs ring-on-the-miss | misses tie; **hits +106 % at depth 2, +298 % at depth 4** — why a hit must never touch a ring |
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
| **Scale** | This decision moves about a fifth of a frame's server CPU; per-datagram QUIC work is the rest (§8). A `RequestFrames` batch serves at **depth 2**; `RequestFrame` is still depth 1 because `run_session` does not read the next ask until the frame is on the wire — the loop, not the read path, and its design is written ([`../adr-frame-framing-and-loop-shape.md`](../adr-frame-framing-and-loop-shape.md) §6d). The owners asked for 4; `v35` prices 2 → 4 at a further +37 % |
| **Risk** | The hit rate is access-shape-conditional. Whole frames in order let read-ahead run ahead of the loop; serving a codestream *prefix* per frame strides the file and misses 319 of 320 cold. The fix is the packer, not the reader ([`../disk-layout/PREFIX-READS.md`](../disk-layout/PREFIX-READS.md)) |

## 5 · Alternatives considered

Every row below was measured unless marked otherwise. Numbers: warm p50 / neighbour p99
under pressure, product runtime; "(miss)" rows are frames/s at 100 % misses, 8 sessions.

**A — how a hit is served**

| Option | Verdict | Why |
| --- | --- | --- |
| **`RWF_NOWAIT` inline, 64 KiB windows** | **Accepted** | 48.4 µs · 166 µs; zero hops warm; lowest warm `gap_max` measured (148 µs) |
| Whole-frame `RWF_NOWAIT`, one read | Rejected | best miss throughput of any arm but a 250 KB uninterrupted executor copy: 4.0 ms warm `gap_max` |
| A larger window (128 / 256 KiB) | Rejected | recovers the miss-path gap on its own but costs 12–25 % warm throughput; escalating the pool read gets it for nothing |
| mmap, naive | Rejected | faults freeze co-tenants: `gap_max` 1.5–4.2 ms, 7.7 ms under pressure |
| mmap + `mincore` gate | Rejected | unsafe under pressure 5/5 runs; residency is not a lease |
| mmap + always-touch on the pool (prior ADR) | Rejected as default | 103.4 µs · 702 µs; pays a hop on every ask, including the ~100 % warm case |
| mmap + touch via `block_in_place` | Rejected | 38.2 µs but the worst neighbour arm measured (p99 2.1 ms) |
| `madvise(POPULATE_READ)` on the pool | Rejected | within noise of the touch loop; the hop is the cost |

**B — how a miss is served**

| Option | Verdict | Why |
| --- | --- | --- |
| **A ring per session, built on the first miss, whole rest of the frame** | **Accepted** | −56 to −75 % CPU per miss vs the pool at depth 1–16; 5 threads flat; nothing built on a warm session |
| `spawn_blocking` + `pread` | **Kept as the fallback** | the simplest correct reader; identical on hits; a thread per miss in flight, 512 cap |
| Escalating only the rest of the window | Superseded 2026-09-07 | 2–3 device round trips per 250 KB frame: 1 404–1 573 f/s vs 4 539–4 777 |
| Every read through the ring (`uring`) | Rejected as default, kept as a flag | hits +106 % / +298 % at depth 2 / 4; misses tie |
| Ring pipelining (read *n+1* during write *n*) | Rejected | ~6 % on a 100 %-miss trace, −25 % warm, 2× session memory |
| `SQPOLL` | Rejected | 2.8× the CPU; nothing completes inline, every read parks |
| Registered buffers | Rejected | measured unnecessary; only the file is registered |
| Ahead-N `POSIX_FADV_WILLNEED` | Measured, not landed | 4.6–4.9× on a cold *strided* read, a loss on a sweep; a routed choice waiting on a layout design |
| Park on the ring's own fd instead of an eventfd (`x14`) | **Proposed, after P0** | one fd per session instead of two, two `unsafe` sites fewer; a tie on CPU everywhere — the gain is by construction, so it waits until the ring is validated on the target. `uring_reader.rs` now carries two slots and a per-slot pending state; re-read it before costing the change |
| One shared ring per runtime (tokio's shape) | Not now | zero per-session cost, but one lock across every session's submissions: measured by tokio's own users at 1.36–1.45× slower than a ring per thread, and reproduced here on streams (`x15`) |

**C — standard and third-party readers, verified against current releases 2026-09-08**
([`RESEARCH-io-backends-RESULT.md`](RESEARCH-io-backends-RESULT.md))

| Option | Verdict | Why |
| --- | --- | --- |
| `tokio-uring` 0.5.0 (2024-05) | Rejected | its own current-thread runtime; dormant; pins an older `io-uring` |
| `glommio`, `monoio`, `compio` | Rejected | thread-per-core runtimes: a transport rewrite. `compio-quic` is the shape that rewrite would take |
| tokio's own io_uring driver (`--cfg tokio_unstable`) | Rejected for tiles; **measured and rejected for streams** | no positional read; one ring per runtime behind one lock; unstable cfg in a medical build. On streams (`x15`): fast for one session, **2.1 ms per 16 KiB read at 64 sessions**, a third of the device's throughput, executor gaps 10× any other arm |
| `tokio::fs::File`, plain | **Measured and rejected** | a thread hop and a copy per read: 48–56 µs per 16 KiB against 3; threads grow like the pool's |
| `rio`, `ringbahn`, `nuclei`, `uring-fs`, `luring` and the other 90 dependents of `io-uring` | Rejected | soundness hole, dead, own runtime, cursor-only with a thread, or `LocalSet`-only. **Nothing on crates.io drives a ring on tokio's multi-thread runtime with positional reads** |

**D — other**

| Option | Verdict | Why |
| --- | --- | --- |
| `sendfile` / `splice` | Rejected | userspace QUIC copies anyway |
| `O_DIRECT` + SPDK, whole-study preload | Rejected | loses the page cache shared across sessions; wrong scale |
| Bounded process-private frame cache | **Lab only, not ported** | −20.2 % CPU / +14.7 % throughput at a 0.92 hit rate, +4.2 % where nothing is re-asked; duplicates RAM the page cache holds; needs a real ask trace to size |
| Handing quinn owned windows (`write_chunk`) | Rejected, and more so at scale | −3.2 % at one session, **+14.6 / +19.1 % at 16 / 32 sessions, RESOLVED**: quinn holds each window until acked, so every window becomes a fresh 64 KiB allocation |

**E — the sequential reader** ([`SEQUENTIAL-READER.md`](SEQUENTIAL-READER.md), `x15`)

| Option | Verdict | Why |
| --- | --- | --- |
| **The shipped reader going forward, frame-sized asks, one frame ahead** | **Accepted** | read-ahead makes 96–99 % of consecutive asks hits, so the three `RWF_NOWAIT` readers tie on every column; this one holds 5 threads and one fd per study |
| Wider windows for streams (64 / 256 KiB) | Rejected | 20–30 % less CPU per byte, but escalations climb 1 % → 4 % → 13.5 % |
| Depth above 2 per stream | Rejected | the wire is 200× slower than a warm read; at 64 sessions × depth 16 every arm queues on the device (p99 100–190 ms) |

## 6 · Deployment: where the decision silently does not apply

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
* **A ring is never built where `RWF_NOWAIT` is refused.** Otherwise every warm read would
  go through it, the `uring` arm's +131–142 % CPU on hits. `lazy_ring_is_never_built_without_nowait`.

## 8 · Levers outside this decision

This ADR moves about a fifth of a frame's server CPU. The rest is per-datagram QUIC work,
and the bigger levers live there. Recorded so the read path does not quietly become the
whole plan.

| Lever | Worth | Blocker / cost | Status |
| --- | --- | --- | --- |
| **`max_udp_payload_size` 1472 → 4000 B** | **−35 % CPU, +55 % throughput** — the largest effect measured anywhere in this investigation | the peer must advertise the same ceiling, and the peer is a browser; above 4000 B path discovery failed and fell back to 1200 B | **Measured, not taken.** Price it first |
| **Serving depth ≥ 4** — read ahead by one is built for batches | **+73.8 % asks/s** on missing tiles, 1.14 → 0.62 ms on 16; 2 → 4 a further +37 % | the `RequestFrame` loop is still depth 1: a session-loop change with a written design | **Half built** ([`NEXT.md`](NEXT.md) §1, loop-shape ADR §6d) |
| `read_ahead_kb` and layout | miss rates moved **2–15×** by that one knob | per target | Not tuned ([`../disk-layout/`](../disk-layout/README.md)) |
| Bounded frame cache | −20.2 % CPU at a 0.92 hit rate | needs a real ask trace | Lab only |
| GSO datagram batching | ~10× fewer `sendmsg` | — | Already on in quinn |
| `write_chunk` owned windows | worse at scale (§5 D) | — | Rejected |
| Congestion controller, flow-control windows, AEAD choice | unknown | — | **Not measured** — named so they are not mistaken for rejected |

**Where scale actually binds.** The copy into quinn is ~11 µs of a ~675 µs frame, and
L2-resident; per-datagram QUIC work runs out of CPU long before the copy runs out of memory
bandwidth. The levers that reach the bound are sending fewer datagrams and not doing the
read at all — not doing the read faster.

## 9 · What is next

[`NEXT.md`](NEXT.md), ranked with the owners on 2026-09-08 and kept in that order as items
close. The top of it: finish serving depth (the `RequestFrame` loop, then widening past two
with `v35`'s ladder in hand), the transport lever above, P0 on the target, the deploy
manifest. The miss rate is now observable, which is what lets every other item be checked
against a real workload. The read-path items — the dependency bump, the ring-fd change — come
after.

## Provenance

Documents this ADR absorbed, readable from git: `git show a330783:docs/disk-access/<file>`
for `SEND-BUDGET.md` (the per-frame budget, the frame cache, `write_chunk`),
`READ-PATH-DECISION.md` (the four-host read-path campaign), `S5-CONTROL-ARM.md` (loop shape
vs ring), `DEPTH.md`, `SCOREBOARD.md`, `later.md`; the 2026-08-31 decision at
`git show be78860:docs/disk-access/adr.md`. Raw campaign data: the `v*.tsv` and `x*.tsv`
files in this directory; the harness is `lab/disk-access-bench`, a workspace member so every
number here can be re-run.
