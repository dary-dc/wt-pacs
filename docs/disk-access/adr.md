# ADR: how the server reads SBND frame bytes

**Status:** Accepted · **2026-09-04** · Evidence: [`RERUN.md`](RERUN.md)
**Amended 2026-09-05** with a bounded frame cache and a per-frame cost budget:
[`SEND-BUDGET.md`](SEND-BUDGET.md)
**Supersedes:** the 2026-08-31 always-touch decision (`git show be78860:docs/disk-access/adr.md`)

## Context

`FrameStore` serves immutable HTJ2K frames from an SBND file. Studies can exceed RAM (DBT).
The server runs on `#[tokio::main]` — a **multi-thread** runtime. A major page fault on an
mmap'd slice is not an `.await`, so it freezes every task on that OS thread.

Question: how should the server bring frame bytes into a state safe for `write_all`?

## Decision

**Stream each frame to the wire in `READ_WINDOW` (64 KiB) pieces, taking each piece with
`preadv2(RWF_NOWAIT)` on the executor and sending only the shortfall to
`spawn_blocking`.**

1. `frame_range(i)` — index lookup, no I/O. A refusal costs nothing.
2. Write `[4B BE payload len][4B BE index]`; both are known before any byte is read.
3. Per window: `read_at_nowait`. It returns short rather than waiting on disk, so a cold
   frame cannot park the executor thread. Only the missing tail goes to
   `spawn_blocking(read_at_blocking)`.
4. `write_all` the window. Repeat into the same buffer.

Do **not** pre-touch mmap pages on every ask. Do **not** build a whole-frame envelope. Do
**not** use `mincore` as a gate. Do **not** serve frame bytes from the mapping at all — the
mapping stays for the header, index and metadata.

**And where a frame is asked more than once, do not read it again.** `--frame-cache-mb`
(default `0`, off) holds frames the session asked twice as process-private `Bytes`; a hit is
handed to quinn with `write_chunk` — no syscall, no copy into the connection, no pool hop.
The ask that earns a slot assembles the frame from the windows it is already streaming, so
the fill costs one copy and no extra read, and the executor's uninterrupted copy stays
bounded by `READ_WINDOW`. Measured **−20% server CPU and +15% throughput** on a cine loop
whose working set fits the budget, **+4%** on a linear sweep that never re-asks a cached
frame ([`SEND-BUDGET.md`](SEND-BUDGET.md) §5). Size it to the working set being scrubbed,
not to the study; leave it at `0` when there is no reuse.

### Guarantee

The bytes quinn puts on the wire are process-private, so reclaim cannot take them back
mid-write. This is the hard guarantee the previous ADR kept as an escape hatch; here it is
the default, and it costs no extra hop.

### Where the fast path does not exist

`RWF_NOWAIT` is honoured on ext4 and refused (`EOPNOTSUPP`) on **overlayfs and tmpfs** —
measured, not assumed, and the previous campaign's host was overlayfs. `FrameStore::open`
probes once; when the answer is no, `read_window` returns the whole frame length so the
loop degrades to exactly one pooled `pread` per frame (the previous ADR's escape hatch),
never one pool round trip per window.

## Consequences

| | |
| --- | --- |
| **Good** | Warm asks take **no pool hop at all** (0 misses in every warm cell). **60 894 ns vs 152 295 ns** per frame against always-touch on the product runtime — 2.5×, from 2 871 pooled samples per arm with non-overlapping 95% CIs, reproduced across two independent runs. Neighbours under pressure see p99 **166 µs vs 702 µs**. Hard reclaim guarantee. 64 KiB per session instead of a 250 KB envelope allocated per frame. |
| **Cost** | Two copies (kernel→window, window→quinn) where mmap would need one. Measured: the copy is cheaper than the hop it replaces, on every cell. |
| **Cost** | Four `write_all` calls per 250 KB frame instead of one. Same bytes, same total copy. |
| **Considered** | io_uring, in four tuned variants, is a measured tie at best — see [`RERUN.md`](RERUN.md) §io_uring, including the two conditions that would make it worth revisiting. Priced per operation it is *slower*: 852 ns vs 561 ns on a warm 4 KiB read, 5 of 5 runs ([`SEND-BUDGET.md`](SEND-BUDGET.md) §3). |
| **Scale** | On the wire this whole decision is ~a fifth of a frame's server CPU; the rest is per-datagram QUIC work. The 2.5× is real and worth having, and it is not where a server's cycles mostly go ([`SEND-BUDGET.md`](SEND-BUDGET.md) §4). |
| **Risk** | The win is filesystem-conditional. On overlayfs/tmpfs the path is pooled `pread` — safe, and ~30 µs/frame worse than always-touch would have been. Confirm the deployment filesystem ([`later.md`](later.md)). |

## Why the previous decision was overturned

Not because always-touch was mis-measured on its own terms, but because:

1. **The archived harness ran on `Builder::new_current_thread()`; the product runs
   multi-thread.** A `spawn_blocking` round trip costs ~16 µs on one thread and ~21 µs plus
   a cross-worker migration on four — always-touch measures 40.0 µs warm on the archived
   shape and 103.4 µs on the product's.
2. **The C2 cell never let neighbours pay the hop.** Background sessions always ran
   always-touch, so the hop tax could not appear in a neighbour number. With every session
   on the arm under test (the cell [`later.md`](later.md) listed as a follow-up),
   always-touch is the *worst* safe arm for neighbours, not the best.
3. **`RWF_NOWAIT` was never in the alternatives table.** The ADR framed the choice as
   "fault safely off-thread (mmap) vs copy safely (pread)" and did not consider reading
   only what is already cached, which needs neither.

The archive's own C2 headline — cold naive inflating neighbour p99 ~3× — does not reproduce
here: on four workers, naive's stall shows in `gap_max`, not in neighbour p99. Naive is
still rejected, on `gap_max` (1.5–4.2 ms median depending on cell, 7.7 ms worst
under pressure).

## Alternatives considered

Numbers are the product runtime, warm `later_p50` / worst-cell neighbour p99 — see
[`RERUN.md`](RERUN.md).

| Option | Verdict | Why |
| --- | --- | --- |
| **`RWF_NOWAIT` streaming (accepted)** | **Accepted** | 48.4 µs · 166 µs. Zero hops warm; degrades to pooled `pread`, never worse |
| Whole-frame `RWF_NOWAIT` (one read, one buffer) | **Rejected** | 43.9 µs but 4× the uninterrupted executor copy and 250 KB/session; cold gap_max 302 vs 186 µs |
| mmap naive | **Rejected** | Faults freeze co-tenants: gap_max 1.5–4.2 ms cold (median by cell), 7.7 ms worst under pressure |
| mmap + `mincore` gate | **Rejected** | Unsafe under pressure on **5/5** runs here (0.5–3.0 ms); residency ≠ lease |
| mmap always-touch (prior ADR) | **Rejected as default** | 103.4 µs · 702 µs. Safe, but pays a pool hop on every ask including the ~100% warm case |
| mmap touch via `block_in_place` | **Rejected** | 38.2 µs but the worst neighbour arm measured (p99 2.1 ms under pressure, worst cold gap 2.2 ms) — evacuating a worker under load is not free |
| `madvise(POPULATE_READ)` on the pool | **Rejected** | Within noise of the touch loop (97.6 vs 103.4 µs) — the hop is the cost, not the touching |
| Pooled `pread` (prior escape hatch) | **Kept, as the no-`RWF_NOWAIT` path** | 132.5 µs · 953 µs. Same guarantee, one hop per ask |
| `pread` into a fresh `Vec` | **Rejected** | 149.2 µs — ~17 µs of allocation tax over pooled, no other difference |
| WILLNEED on executor | **Rejected** | Fault still on the executor |
| Ahead-N prefetch | **Deferred** | Needs a real ask window ([`later.md`](later.md)) |
| `io_uring` + `RWF_NOWAIT` hybrid *(best io_uring arm)* | **Rejected** | A tie bounded at ±5%: +2.5% and +2.4% against the accepted path in two pooled-sample runs, −4.5% in a `--monitors 0` cell. It **is** the accepted path on a page-cache hit — the ring only serves the miss — so it buys a ring, an eventfd and registered buffers per session for nothing that reproduces |
| `io_uring` alone (registered file + fixed buffers, whole frame in one submit) | **Rejected** | Ties warm (82–88 µs), worst io_uring arm when reads miss: 224 parked completions on a cold random trace vs 59, and 408–437 µs on a cold reverse pass vs ~345. Batching a frame's windows means every window of a miss waits together |
| `io_uring` pipelined (read n+1 during write n) | **Rejected** | The one thing only io_uring can do here, order-controlled at ~6% on a 100%-miss trace — while costing ~25% warm (108.6 vs 84.7 µs) and 2× session memory |
| `io_uring` + `SQPOLL` | **Rejected** | 2.8× the CPU (287 vs 104 µs/ask) for worse latency: with a kernel submitter nothing completes inline, so every read parks |
| `sendfile`/splice | **Rejected for this stack** | Userspace QUIC still copies |
| **Bounded process-private frame cache** | **Accepted, opt-in** | −20% server CPU / +15% throughput at a 0.92 hit rate; +4% where nothing is re-asked. `--frame-cache-mb`, default off ([`SEND-BUDGET.md`](SEND-BUDGET.md) §5) |
| Handing quinn owned windows (`write_chunk`) instead of copying into it | **Rejected** | The copy is provably removed, and worth −3.2% (9 of 12 paired rounds) — under the drift threshold. Costs `unsafe { set_len }` and the fixed 64 KiB/session bound |
| `O_DIRECT` + SPDK / whole-study preload | **Rejected** | Wrong scale or scope. The *bounded* app cache above was in this row until it was measured; it is not any more |

## Product path

`send_one_frame` → `write_frame` → `stream_codestream` in `server/src/transport/server.rs`.
`FrameStore` exposes `read_at_nowait`, `read_at_blocking`, `read_window` and
`nowait_supported`; the mmap pre-touch, `mincore` and WILLNEED arms live in
`lab/disk-access-bench` because they are the comparison, not the product.

The `wrap()` envelope allocation is gone with it: the header is 8 bytes on the stack and the
codestream streams behind it. That is the copy reduction the previous ADR deferred to a
"next version", delivered here.

## Follow-ups

[`later.md`](later.md) — the deployment-filesystem check is the one that matters.
