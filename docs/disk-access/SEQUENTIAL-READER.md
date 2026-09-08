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

<!-- x15 -->

> **In progress:** the `x15` campaign (§4) is running as this is committed; results, the
> verdict and the proposals follow in the next commit.
