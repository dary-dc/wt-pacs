# ADR: how the server reads SBND frame bytes

**Status:** Accepted · **2026-09-04** · Evidence: [`RERUN.md`](RERUN.md)
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
| **Good** | Warm asks take **no pool hop at all** (0 misses in every warm cell). ~2.1× lower per-frame latency than always-touch on the product runtime (48.4 µs vs 103.4 µs). Neighbours under pressure see p99 **166 µs vs 702 µs**. Hard reclaim guarantee. 64 KiB per session instead of a 250 KB envelope allocated per frame. |
| **Cost** | Two copies (kernel→window, window→quinn) where mmap would need one. Measured: the copy is cheaper than the hop it replaces, on every cell. |
| **Cost** | Four `write_all` calls per 250 KB frame instead of one. Same bytes, same total copy. |
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
| `io_uring` | **Deferred** | Would replace the fallback, not the fast path — which takes no hop |
| `sendfile`/splice | **Rejected for this stack** | Userspace QUIC still copies |
| `O_DIRECT` + app cache / SPDK / whole-study preload | **Rejected** | Wrong scale or scope |

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
