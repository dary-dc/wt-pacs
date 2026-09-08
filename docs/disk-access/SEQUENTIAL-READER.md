# The sequential reader — evaluation

**2026-09-08.** Which reader server-driven streaming
([`../adr-frame-framing-and-loop-shape.md`](../adr-frame-framing-and-loop-shape.md) §6c,
unbuilt) should use. Tiles are positional reads out of order; streaming is one cursor per
session, start to end. The tile answer is in
[`RESEARCH-io-backends-RESULT.md`](RESEARCH-io-backends-RESULT.md); this is the other use
case, under the same weights: latency first, simplicity valued, thousands of sessions,
studies far larger than RAM, cloud and possibly Docker.

## 1 · What a sequential stream actually needs

* **The wire is the bottleneck for one session, not the disk.** A 16 KiB frame costs ~675 µs
  of QUIC work; a warm read of it costs ~3 µs and a device read ~100 µs to a few ms. One
  session streams at ~24 MB/s at most, so a reader that keeps one frame ahead of the sender
  never stalls the stream on a healthy device. The reader is not where a session's latency
  comes from.
* **Thousands of sessions are device-bound before they are reader-bound.** A thousand
  sessions at 24 MB/s want 24 GB/s; no volume class delivers that, so the aggregate rate is
  set by the device and shared by every session on it. What the reader decides at that scale
  is **CPU per byte** (the QUIC budget is the scarce resource), **threads and memory per
  session**, and **whether a miss ever stalls a worker thread**.
* **The kernel already reads ahead.** Consecutive reads trigger read-ahead
  (`read_ahead_kb`, 128 KiB by default, 8 MiB on the hosts here), so after the first miss the
  next windows are page-cache hits until the reader outruns the window. On the sweep shape
  the campaign measured **1.2–1.4 % misses at depth 1** without any hint — the hit path
  decides, and a mechanism that helps misses helps 1 ask in 70.
* **Positional is not required — but a cursor costs one fd per session.** A `File` cursor
  cannot be shared, so a cursor API means one open file per streaming session (fine against
  `RLIMIT_NOFILE`, but it is per session), and it cannot express depth: one cursor has one
  position, so "N reads in flight" needs N cursors.
* **The hard constraints do not change.** Tokio's multi-thread runtime (`wtransport`), never
  block a worker on a fault or a read, production-grade.

## 2 · Candidates

| # | Candidate | What it is | Constraint check | Arm |
| --- | --- | --- | --- | --- |
| A | **`ReadCtx` reading forward** | the shipped tile reader used sequentially: `RWF_NOWAIT` inline, the lazily built ring on a miss, one shared fd per study | ✓ | `product` |
| B | **`spawn_blocking` + `pread`** | `RWF_NOWAIT` inline, a thread hop for the shortfall; no ring, no unsafe beyond `preadv2` | ✓ | `pool` |
| C | **Ring for every read** | no inline attempt; every read is a ring submission | ✓, but +70–294 % CPU on hits (tiles evidence) | `uring` |
| D | **`tokio::fs::File` cursor** | the standard library answer: `read_exact` per frame; internally `spawn_blocking` per read plus a copy through tokio's own buffer | ✓; one fd per session; no depth | `tokio_fs` |
| E | **`tokio::fs::File` on tokio's io_uring driver** | the same code under `--cfg tokio_unstable` + feature `io-uring` (tokio 1.52+): cursor reads submitted to one ring per runtime | ✓ mechanically; `tokio_unstable` in a production build; one fd per session; no depth | `tokio_fs_uring` |
| F | **Read-ahead hints** | `posix_fadvise(WILLNEED)` one round ahead; `POSIX_FADV_SEQUENTIAL`; `read_ahead_kb` | ✓; not a reader, a knob on any of A–E | `--prefetch on` |
| G | **Larger windows** | 64 KiB–256 KiB asks: fewer syscalls per byte | ✓; a parameter of A–E | `--size` |
| H | **Read-ahead by N frames** | N reads in flight per stream: the ring's slots or N pool tasks | ✓; the overlap lever ([`NEXT.md`](NEXT.md) §1) | `--depth` |
| I | mmap + `MADV_SEQUENTIAL` | map the study, let faults stream | ✗ a fault is not an `.await`; sequential does not remove it | rejected earlier |
| J | `sendfile` / `splice` | kernel-to-socket | ✗ userspace QUIC copies anyway | rejected earlier |
| K | `O_DIRECT` + own cache | bypass the page cache | ✗ loses the page cache shared across sessions of one study; wrong scale | rejected earlier |

D and E are the ones the tile research could not use (no positional read) and the owners'
question is really about them: is there a *standard* reader for the sequential case that
beats the custom one? E is the only path on which tokio's own ring reaches a file.

## 3 · What was already measured — the sweep cells of the v10 campaign

Consecutive 16 KiB reads on the 84 MB fixture, sessions overlapping, 4 vCPU
([`v10_campaign.tsv`](v10_campaign.tsv), `shape = sweep`, pooled medians of 18 cells):

| depth | temp | arm | p50 µs | p99 µs | CPU µs/ask | miss % | threads |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | cold | `pool` | 4.6 | 513 | 7.8 | 1.4 | 6 |
| 1 | cold | `hybrid` | 4.5 | 434 | 6.7 | 1.4 | 5 |
| 1 | cold | `uring` | 5.7 | 146 | 11.9 | 100 | 5 |
| 1 | cold | `pooled_pread` | 54.3 | 132 | 63.2 | 100 | 7 |
| 16 | cold | `pool` | 5.7 | 2 407 | 21.3 | 18.4 | 26 |
| 16 | cold | `hybrid` | 4.6 | 922 | 7.7 | 6.5 | 5 |
| 16 | cold | `uring` | 80.8 | 1 388 | 7.6 | 100 | 5 |
| 1 | warm | `pool` | 3.2 | 5.4 | 4.0 | 0 | 5 |
| 1 | warm | `hybrid` | 2.6 | 4.2 | 3.4 | 0 | 5 |
| 1 | warm | `uring` | 16.2 | 36.1 | 15.4 | 100 | 5 |

Three things it settles for the sequential shape. **The hit path decides**: at depth 1 the
kernel's read-ahead turns 98.6 % of cold consecutive reads into hits, and `pool` and `hybrid`
tie on p50 and CPU because both serve a hit inline. **Every-read-through-the-ring loses**:
`uring` pays 3–4× the CPU warm and falls apart at depth 16 (p50 81 µs). **Depth is where the
ring earns something**: at 16 in flight `pool` misses 18 % (the pool's own reads outrun
read-ahead) and holds 26 threads, `hybrid` misses 6.5 % and holds 5. The `WILLNEED` hint one
round ahead changed nothing (`B_prefetch_sweep`): the kernel was already doing it. At 250 KB
asks `pool` and `hybrid` tie at depth 1 (34 vs 36 µs) and `hybrid` wins the tail at depth 16
(p99 5.9 vs 9.6 ms).

What v10 could not say: how the *standard* readers D and E compare, what a larger window
buys, and what happens when sessions do **not** share a study — which is the production case
when studies exceed RAM.

## 4 · x15 — every candidate on consecutive reads, sessions not sharing a study

**Method.** [`lab/scripts/run_sequential_campaign.sh`](../../lab/scripts/run_sequential_campaign.sh):
a 1 GiB fixture, every session on its own slice (`--partition`), 8 MB streamed per session
per cell whatever the ask size — 512 × 16 KiB, 128 × 64 KiB, 32 × 256 KiB — at depth 1, 4, 16
and 1, 8, 64 sessions, cold and (16 KiB) warm, six rounds with the arm order rotated, two
binaries per round. `tokio_fs_uring` is the same arm built with `--cfg tokio_unstable` and
tokio's `io-uring` feature; the process was seen holding one io_uring fd while it ran and
none in the normal build. 1 297 cells, none skipped
([`x15_sequential.tsv`](x15_sequential.tsv)); safety cell with the monitor on
([`x15_sequential_safety.tsv`](x15_sequential_safety.tsv)); host in
[`x15_sequential_host.txt`](x15_sequential_host.txt); pooled medians and every paired verdict in
[`x15_sequential_pairs.txt`](x15_sequential_pairs.txt).

**One caveat before the numbers.** This host's "cold" is bimodal: in some rounds a
one-session stream ran at ~3 µs per 16 KiB (guest-cold, hypervisor-warm), in others at
~70–90 µs (a real device read, ~230 MB/s) — for *every* arm in that round. The one-session
cells are therefore mixtures and their pooled medians wobble; the 8- and 64-session cells
hide it behind parallelism, and the paired verdicts compare arms inside the same round, so
they are unaffected. A cloud volume is the second mode all the time.

### 16 KiB frames, depth 1 — cold, pooled medians (p50 µs / p99 µs / CPU µs per ask / threads)

| arm | 1 session | 8 sessions | 64 sessions | MB/s at 64 |
| --- | --- | --- | --- | --- |
| `pool` | 3.5 / 182 / 22.9 / 6 | 3.0 / 788 / 20.6 / 13 | 3.2 / 3 177 / 48.5 / 73 | 971 |
| `hybrid_lazyring` | 37.4 / 244 / 48.2 / 5 | 3.1 / 1 039 / 16.0 / 5 | 3.2 / 3 314 / 48.5 / 5 | 990 |
| **`product`** | 3.8 / 305 / 47.6 / 5 | 3.1 / 704 / 18.3 / 5 | 3.3 / 2 836 / 35.7 / 5 | 1 193 |
| `uring` | 3.7 / 38 / 10.1 / 5 | 4.5 / 496 / 22.7 / 5 | 4.3 / 7 246 / 44.2 / 5 | 1 031 |
| `tokio_fs` | 55.7 / 177 / 68.3 / 7 | 48.1 / 786 / 39.5 / 40 | 223 / 4 893 / 55.2 / 172 | 923 |
| `tokio_fs_uring` | 6.1 / 61 / 11.0 / 6 | 141 / 1 474 / 48.5 / 10 | 2 121 / 19 180 / 76.0 / 16 | 295 |

Warm, 8 sessions: `pool` 3.5 / 10.3 / 4.1, `product` 3.4 / 10.2 / 4.1, `uring` 4.6 / 33 / 7.7,
`tokio_fs` 40.7 / 456 / 29.1 (49 threads), `tokio_fs_uring` 153 / 392 / 42.5.

### Depth at 64 sessions, 16 KiB cold (p50 µs / p99 ms / threads)

| arm | depth 1 | depth 4 | depth 16 |
| --- | --- | --- | --- |
| `pool` | 3.2 / 3.2 / 73 | 3.4 / 85.9 / 256 | 3.8 / 191.8 / **517** |
| **`product`** | 3.3 / 2.8 / 5 | 3.3 / 94.6 / 5 | 3.6 / 141.0 / 5 |
| `hybrid_lazyring` | 3.2 / 3.3 / 5 | 3.3 / 54.6 / 5 | 3.4 / 129.0 / 5 |
| `tokio_fs` | 223 / 4.9 / 172 | 81 / 62.5 / 318 | 5 758 / 147.3 / **517** |
| `tokio_fs_uring` | 2 121 / 19.2 / 16 | 5 578 / 30.9 / 14 | 24 438 / 114.1 / 18 |

### Window size, 8 sessions, depth 1, cold

| ask | `pool` p50 | `product` p50 | CPU µs per KiB (NOWAIT arms) | escalations (`pool` miss %) |
| --- | --- | --- | --- | --- |
| 16 KiB | 3.0 µs | 3.1 µs | 1.8–2.2 | 1.1 % |
| 64 KiB | 11.2 µs | 11.5 µs | 1.5–1.8 | 4.0 % |
| 256 KiB | 55.4 µs | 47.6 µs | 1.4–1.6 | 13.5 % |

### The paired verdicts (`pair_arms.py`; CPU on the 28.5 % rule, latency on 7 %)

| Pair | Verdict |
| --- | --- |
| `product` vs `pool` | **tie everywhere**: CPU −4.9 … +19 % with signs near chance in every regime and session count; p50 −7.5 … +9.3 %, all ties; p99 by depth, all ties |
| `product` vs `hybrid_lazyring` | ties on CPU and p50; `product`'s p99 is +33 % at depth 4 on hits (32/40) — the shipped reader carries a slightly longer tail than the lab arm at depth |
| `uring` vs `product` | p50 **+190 % at 8 sessions (36/36) and +143 % at 64 (35/36)**, +1 564 % p99 at depth 16 — every read through the ring queues behind the session's own ring; CPU −86 % in the one-session cold cells (20/23), the only column it wins |
| `tokio_fs` vs `pool` | p50 **+1 562 % at 8 sessions (36/36), +12 072 % at 64 (36/36)**; CPU +316–410 % on hits; threads track the pool's and reach the 512 cap first |
| `tokio_fs_uring` vs `tokio_fs` | −31 % p50 at one session (tie); **+239 % at 8, +252 % at 64 (36/36 each)**; CPU +34–45 % at 8–64 sessions |
| `tokio_fs_uring` vs `product` | p50 +9 068 % at 8 sessions, +139 539 % at 64 (36/36) |

**Safety** (cold, 16 KiB, depth 1, 8 sessions, monitor on): `gap_p99` 18–19 µs for `pool`,
`hybrid_lazyring`, `uring` and `product`; **48 µs for `tokio_fs`; 223 µs for `tokio_fs_uring`**.
Tokio's ring driver runs completions on the worker that holds its lock, and the co-tenant
sees it. `gap_max` is in the millisecond range for every arm on this host.

### What it says

1. **The three `RWF_NOWAIT` readers are the same reader on a sequential stream.** `product`,
   `pool` and `hybrid_lazyring` tie on p50, p99 and CPU in every cell that can resolve, at
   ~3 µs per 16 KiB and ~1 GB/s at 8 sessions and above — the device on this host. The
   read-ahead makes 96–99 % of consecutive asks hits at depth 1, and a hit is served the same
   way by all three. Where they differ is **threads**: the pool holds 73 at 64 sessions and hits
   tokio's 512 cap at 64 × 16 in flight; the ring readers hold 5 whatever the load.
2. **`tokio::fs::File` is not a candidate, in either form.** The plain cursor costs a thread
   hop and a copy per read — ~50 µs against 3 — and grows blocking threads exactly like the
   pool. On tokio's io_uring driver it is fast for one session (6 µs) and then collapses:
   one ring per runtime behind one lock, so 64 sessions serialise on it at 2 ms per 16 KiB read
   and 300 MB/s, a third of the device, while stalling the executor 10× longer than any other
   arm. That is tokio issue #8367 reproduced on this host, and it is before the
   `tokio_unstable` and one-fd-per-session costs are counted.
3. **Every read through a ring loses on a stream.** `uring` queues each session's reads
   behind its own ring and pays +143–190 % p50 at 8–64 sessions; the 96 % of asks that hit
   should never touch a ring. Its lowest-CPU column in the one-session cold cells is real but
   is not a reason: a stream is not one session.
4. **Bigger windows buy little.** 64 KiB asks save ~20 % CPU per byte over 16 KiB and 256 KiB
   ~30 %, but the escalation rate climbs 1 % → 4 % → 13.5 %, because a larger `RWF_NOWAIT`
   read is more likely to touch a page the read-ahead has not landed yet and come back short.
   Frame-sized asks with the existing 64 KiB read window are the right shape.
5. **Depth belongs to the stream, not to the device.** For one stream the ring reader keeps
   its tail flat at depth 4–16 (p99 ~290 µs) while the pool's explodes (2–7 ms) as its own
   reads outrun read-ahead. At 64 sessions every arm's p99 is 50–190 ms at depth 4–16: the
   device is queueing, and nothing in the reader changes that. A stream needs one read
   ahead of the sender, not sixteen.

## 5 · Verdict

**Use the shipped reader, reading forward.** `ReadCtx` with frame-sized asks and read-ahead
by one frame is the sequential reader: it ties the simplest possible reader on every latency
and CPU column, holds 5 threads at any session count, shares one fd per study across every
session streaming it, and it already exists — the streaming path is a loop change, not a
read-path change. If P0 ([`NEXT.md`](NEXT.md) §3) deletes the ring, `pool` streams identically
and the only thing lost is the flat thread count under load.

**Rejected on measurement:** `tokio::fs::File` (15× per read, thread growth) and
`tokio::fs::File` on tokio's io_uring driver (collapses past a handful of sessions, stalls the
executor, `tokio_unstable`, one fd per session). **Rejected on design:** every-read-through-
the-ring, mmap, `sendfile`/`splice`, `O_DIRECT`.

The owners' question — is there a *standard* reader that beats the custom one on the
sequential case — has a measured answer: no, and the gap is not close. The custom part of
the shipped reader is the miss path, and on a stream 96–99 % of asks never reach it.

## 6 · Proposals for the streaming path

* **S1 — `ReadCtx` forward, one frame ahead.** *Recommended; the design input for §6c.* The
  session loop reads frame *n+1* while frame *n* is on the wire, using the two-slot shape
  already planned for tiles ([`NEXT.md`](NEXT.md) §1). No new reader code. Validate with the
  `product` arm at depth 2 on the sweep shape, then on the target with P0.
* **S2 — frame-sized asks, 64 KiB read window.** *Recommended; already the default.* Do not
  widen windows for streaming: the CPU saved per byte is smaller than the escalations it
  causes.
* **S3 — `posix_fadvise(POSIX_FADV_SEQUENTIAL)` per streaming session.** *Cheap, unmeasured.*
  Doubles the kernel's read-ahead window for that file description. `WILLNEED` one round
  ahead did nothing in v10 because read-ahead was already doing it; `SEQUENTIAL` changes how
  far ahead it goes. One `--prefetch seq` mode in the campaign measures it; worth it only if
  the escalation rate on the target device is above the ~1 % seen here.
* **S4 — keep stream depth at 2 at thousands of sessions.** *Design rule.* Aggregate reads in
  flight is sessions × depth, and past ~64 the device queues for every arm. The wire is 200×
  slower than a warm read; one frame ahead is all a stream can use.
* **S5 — flow control is the open design question, not the reader.** §6c says it: a fast
  client outruns nothing and a slow one drowns. The reader is settled; the pacing is not.
* **S6 — do not build a second reader for streaming.** Two readers are two miss paths to
  keep correct. `ReadCtx` already handles the miss on a stream the same way it does on a tile.

## 7 · What would reopen this

* Tokio ships a positional or lock-free per-worker ring for `fs::File` on the stable runtime.
  The current driver's serialisation is the measured problem, not the ring.
* A target volume whose escalation rate on streams is far above 1 %, which would make S3 and
  a wider window worth re-measuring there.
* Read-ahead disabled or capped on the target (`read_ahead_kb` at the 128 KiB default moved
  miss rates 2–15× elsewhere): then the sequential case degrades toward the tile case, and the
  ring's miss-path margin returns.
