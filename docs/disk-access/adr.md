# ADR: how the server reads SBND frame bytes

**Status:** Accepted · **2026-09-04** · Evidence: [`RERUN.md`](RERUN.md)
**Amended 2026-09-05** with a bounded frame cache and a per-frame cost budget:
`SEND-BUDGET.md` (archived: `git show a330783:docs/disk-access/SEND-BUDGET.md`)
**Amended 2026-09-07**: a window that misses reads the rest of the frame —
[`RERUN-miss.md`](RERUN-miss.md)
**Supersedes:** the 2026-08-31 always-touch decision (`git show be78860:docs/disk-access/adr.md`)

> ### Standing as of 2026-09-06 — read this before acting on the decision below
>
> **What ships is still right, and it is what this ADR says.** The decision below —
> `RWF_NOWAIT` inline, `spawn_blocking` for the shortfall — is implemented in `server/` and is
> the correct choice for the workload this ADR measured, which fixed the miss rate at **~0**.
> Nothing here is withdrawn.
>
> **A better shape has since been measured, and it is conditional on one number.** The
> read-path campaign (`READ-PATH-DECISION.md` (archived: `git show a330783:docs/disk-access/READ-PATH-DECISION.md`), four hosts, six runs)
> finds io_uring on the *miss* path worth **−42% to −73% CPU per read, RESOLVED on every host
> and every run**. The best shape is **`hybrid_lazyring`**: this ADR's path exactly, plus a
> ring built on the *first miss* rather than at session start
> (`S5-CONTROL-ARM.md` (archived: `git show a330783:docs/disk-access/S5-CONTROL-ARM.md`)). A session that never misses never builds one, so
> it costs nothing on the warm workload this ADR is about.
>
> **The gate is the miss rate, and that is a layout decision nobody has taken yet.** The win
> exists only where reads miss, and whether reads miss is set by how frames are laid out on
> disk, not by study size ([`ACCESS-PATTERNS.md`](../disk-layout/ACCESS-PATTERNS.md)): a strided layout steps
> to 99% miss under pressure, a grouped one holds at 0.5%. Past that cliff the layout is worth
> 17.6× and the read path 2–4×; before it the layout is worth 1.50×, and the read path is the
> only lever left.
>
> **So:** keep this decision while the workload is warm-dominated. Adopt `hybrid_lazyring`
> when the layout design lands and leaves reads missing — the arm is in
> `lab/disk-access-bench`, and the split justifying it reruns with `lab/scripts/s5_split.py`.
> The one thing not to do is read the two documents as disagreeing: they measured different
> miss rates, and each is right at the one it measured.

> ### Amendment, 2026-09-07 — how much a miss reads, which is a separate question
>
> **Landed, and it is not about io_uring.** Step 4 below used to send only *the rest of the
> window* to the pool. On a fixture large enough that a miss is a real device read, that
> costs **2–3 pool round trips per 250 KB frame instead of one**, and the shipped shape then
> stops scaling — flat at ~1 600 f/s from 8 concurrent readers to 32, where every arm that
> reads a whole frame per round trip reaches the device's ~5 000. Sending the rest of the
> *frame* is **2.1× at one reader and 3.0–3.2× at 8/16/32**, identical warm, and has the
> lowest worst co-tenant gap of any arm measured. [`RERUN-miss.md`](RERUN-miss.md).
>
> **It composes with the standing note above rather than competing with it.** The ring makes
> a round trip cheaper; this makes there be one round trip instead of three. The two campaigns
> agree once the units are lined up: the ring's saving is a roughly fixed ~25 µs of CPU per
> round trip (the hop tax, 24–34 µs on four hosts), so it is most of a **16 KB** read and
> under 8% of a **250 KB** one — which is why the read-path campaign resolves it at 16 KB
> frames and the miss campaign cannot at 250 KB. Neither result overturns the other; frame
> size is the variable that was different.
>
> **Do the escalation first regardless.** It has no dependency, no ring, and it is the
> prerequisite for a lazy ring to be worth what it measures — on 250 KB frames the ring would
> otherwise be making two *unnecessary* round trips cheaper.

## Context

`FrameStore` serves immutable HTJ2K frames from an SBND file. Studies can exceed RAM (DBT).
The server runs on `#[tokio::main]` — a **multi-thread** runtime. A major page fault on an
mmap'd slice is not an `.await`, so it freezes every task on that OS thread.

Question: how should the server bring frame bytes into a state safe for `write_all`?

## Decision

**Stream each frame to the wire in `READ_WINDOW` (64 KiB) pieces, taking each piece with
`preadv2(RWF_NOWAIT)` on the executor — and when a piece misses, fetch the whole rest of
the frame on `spawn_blocking` in one round trip.**

1. `frame_range(i)` — index lookup, no I/O. A refusal costs nothing.
2. Write `[4B BE payload len][4B BE index]`; both are known before any byte is read.
3. Per window: `read_at_nowait`. It returns short rather than waiting on disk, so a cold
   frame cannot park the executor thread.
4. On a short read, `spawn_blocking(read_at_blocking)` for **everything still outstanding in
   the frame**, not just the rest of that window. The window exists to bound the executor's
   uninterrupted copy, and that argument applies only to the inline read — which happens on
   a hit. On the pool a large read costs no more than a small one, and a small one costs a
   whole extra round trip.
5. `write_all` in `READ_WINDOW` pieces either way, so a bigger read never means a bigger
   uninterrupted copy. Repeat into the same buffer.

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
frame (`SEND-BUDGET.md` (archived: `git show a330783:docs/disk-access/SEND-BUDGET.md`) §5). Size it to the working set being scrubbed,
not to the study; leave it at `0` when there is no reuse.

### Guarantee

The bytes quinn puts on the wire are process-private, so reclaim cannot take them back
mid-write. This is the hard guarantee the previous ADR kept as an escape hatch; here it is
the default, and it costs no extra hop.

### Where the fast path does not exist

`RWF_NOWAIT` is honoured on ext4 and on **btrfs** (including btrfs-on-LUKS with
`compress=zstd`), and refused (`EOPNOTSUPP`) on **overlayfs and tmpfs** — measured, not
assumed, and the previous campaign's host was overlayfs. Check any new host with
`check-fastpath` ([`DEPLOYMENT.md`](DEPLOYMENT.md)) rather than inferring from this list. `FrameStore::open`
probes once; when the answer is no, `read_window` returns the whole frame length so the
loop degrades to exactly one pooled `pread` per frame (the previous ADR's escape hatch),
never one pool round trip per window.

## Consequences

| | |
| --- | --- |
| **Good** | Warm asks take **no pool hop at all** (0 misses in every warm cell). **60 894 ns vs 152 295 ns** per frame against always-touch on the product runtime — 2.5×, from 2 871 pooled samples per arm with non-overlapping 95% CIs, reproduced across two independent runs. Across every warm cell in this campaign the same margin runs **2.1–2.5×** (Cell 1's nine-arm cell is the low end); the direction never varies. Neighbours under pressure see p99 **166 µs vs 702 µs**. Hard reclaim guarantee. 64 KiB per session instead of a 250 KB envelope allocated per frame. |
| **Good** | Under misses, escalating the pool read is **2.1× the throughput** of the windowed shape at one reader and **3.0–3.2×** at 8/16/32, and has the **lowest worst co-tenant gap of any arm measured** — 148 µs warm, against 326 µs windowed and 4.0 ms for reading a whole frame inline ([`RERUN-miss.md`](RERUN-miss.md) M5/M6). |
| **Cost** | A reader that misses grows its window buffer to frame size and keeps it; one that only ever hits still holds `READ_WINDOW`. Untested past 250 KB frames. |
| **Cost** | Two copies (kernel→window, window→quinn) where mmap would need one. Measured: the copy is cheaper than the hop it replaces, on every cell. |
| **Cost** | Four `write_all` calls per 250 KB frame instead of one. Same bytes, same total copy. |
| **Revisit** | The io_uring rejection below was measured at **one read in flight**, which is what today's serial `run_session` produces. If the server ever serves the client's ask window concurrently, `DEPTH.md` (archived: `git show a330783:docs/disk-access/DEPTH.md`) prices the ring at 1.8–4× less CPU per ask on cold reads with thread count flat at 5 instead of 89. Not a decision this evidence can make — a dependency the decision has. |
| **Considered** | io_uring, in four tuned variants, is a measured tie at best — see [`RERUN.md`](RERUN.md) §io_uring, including the two conditions that would make it worth revisiting. Priced per operation it is *slower*: 852 ns vs 561 ns on a warm 4 KiB read, 5 of 5 runs (`SEND-BUDGET.md` (archived: `git show a330783:docs/disk-access/SEND-BUDGET.md`) §3). |
| **Scale** | On the wire this whole decision is ~a fifth of a frame's server CPU; the rest is per-datagram QUIC work. The 2.5× is real and worth having, and it is not where a server's cycles mostly go (`SEND-BUDGET.md` (archived: `git show a330783:docs/disk-access/SEND-BUDGET.md`) §4). |
| **Risk** | **The hit rate is access-shape-conditional.** "0 hops warm, 6 of 320 cold" assumes whole frames read in order, which is what lets kernel read-ahead run ahead of the loop. Serving rungs — a codestream *prefix* per frame — strides the file instead, and the fast path then misses **319 of 320** cold: the path degrades to its escape hatch on every ask. The read path is still the best arm; the fix is the packer, not the server ([`PREFIX-READS.md`](../disk-layout/PREFIX-READS.md)). |
| **Risk** | The win is filesystem-conditional. On overlayfs/tmpfs the path is pooled `pread` — safe, and ~30 µs/frame worse than always-touch would have been. Confirm the deployment filesystem with `check-fastpath` before shipping — [`DEPLOYMENT.md`](DEPLOYMENT.md), which covers the container case, where the default answer is *no*. |

## Why the previous decision was overturned

Not because always-touch was mis-measured on its own terms, but because:

1. **The archived harness ran on `Builder::new_current_thread()`; the product runs
   multi-thread.** A `spawn_blocking` round trip costs ~16 µs on one thread and ~21 µs plus
   a cross-worker migration on four — always-touch measures 40.0 µs warm on the archived
   shape and 103.4 µs on the product's.
2. **The C2 cell never let neighbours pay the hop.** Background sessions always ran
   always-touch, so the hop tax could not appear in a neighbour number. With every session
   on the arm under test (the cell `later.md` (archived: `git show a330783:docs/disk-access/later.md`) listed as a follow-up),
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
[`RERUN.md`](RERUN.md). Rows marked **(miss)** carry a second figure from
[`RERUN-miss.md`](RERUN-miss.md): frames/s at 100% misses, 8 concurrent sessions.

| Option | Verdict | Why |
| --- | --- | --- |
| **`RWF_NOWAIT` streaming, escalating pool read (accepted)** | **Accepted** | 48.4 µs · 166 µs · **(miss) 4 539–4 777 f/s**. Zero hops warm, one per frame when it misses, and the lowest warm `gap_max` measured (148 µs) |
| Same, but windowing the pool read too *(the 2026-09-04 shape)* | **Superseded** | Identical warm. **(miss) 1 404–1 573 f/s** — 2–3 round trips per frame instead of one, and it does not scale: flat at ~1 600 f/s from 8 sessions to 32 while every whole-frame arm reaches the device's ~5 000 |
| Whole-frame `RWF_NOWAIT` (one read, one buffer) | **Rejected** | 43.9 µs and **(miss) 5 081–5 429 f/s** — the best miss throughput of any arm — but a 250 KB uninterrupted executor copy, and it costs a **4.0 ms** warm `gap_max` against 148 µs. Escalating gets within 6–10% of it without that |
| mmap naive | **Rejected** | Faults freeze co-tenants: gap_max 1.5–4.2 ms cold (median by cell), 7.7 ms worst under pressure |
| mmap + `mincore` gate | **Rejected** | Unsafe under pressure on **5/5** runs here (0.5–3.0 ms); residency ≠ lease |
| mmap always-touch (prior ADR) | **Rejected as default** | 103.4 µs · 702 µs. Safe, but pays a pool hop on every ask including the ~100% warm case |
| mmap touch via `block_in_place` | **Rejected** | 38.2 µs but the worst neighbour arm measured (p99 2.1 ms under pressure, worst cold gap 2.2 ms) — evacuating a worker under load is not free |
| `madvise(POPULATE_READ)` on the pool | **Rejected** | Within noise of the touch loop (97.6 vs 103.4 µs) — the hop is the cost, not the touching |
| Pooled `pread` (prior escape hatch) | **Kept, as the no-`RWF_NOWAIT` path** | 132.5 µs · 953 µs. Same guarantee, one hop per ask |
| `pread` into a fresh `Vec` | **Rejected** | 149.2 µs — ~17 µs of allocation tax over pooled, no other difference |
| WILLNEED on executor | **Rejected** | Fault still on the executor |
| Ahead-N prefetch (`POSIX_FADV_WILLNEED` on the next ask) | **Measured, not landed** | Worth **4.6–4.9×** on a cold *strided* read (rung delivery): misses 319 → 6–56 per 320, ~half the CPU per ask, one syscall, no layout change. A **loss** on a cold sweeping read (108.9 vs 46.8 µs) — so it is a routed choice, and the routing depends on a layout design that does not exist yet ([`PREFIX-READS.md`](../disk-layout/PREFIX-READS.md) Part 2) |
| Windowing the **pool** read too *(the shape shipped until 2026-09-07)* | **Superseded** | Identical warm. 2–3 device round trips per 250 KB frame instead of one: **1 404–1 573 f/s against 4 539–4 777** at 8 readers on 100% misses, and flat at ~1 600 from 8 readers to 32 ([`RERUN-miss.md`](RERUN-miss.md) M2/M5) |
| A larger `READ_WINDOW` (128 / 256 KiB) | **Rejected** | Recovers the same miss-path gap on its own — 3 075 and 5 592 f/s against 1 660 at 64 KiB — but pays 12–25% of the warm throughput and widens the executor's uninterrupted copy. Escalating only the *pool* read gets it for nothing warm |
| `io_uring`, whole frame per read | **Tie on this axis** | The strongest ring form for large frames, added for the miss campaign: 4 732–5 153 f/s against `spawn_blocking` doing the same-sized read, at 1/2/4/8/16/32 readers in both arm orders. Its real advantage is **5 OS threads against 44** — which on this device converts into nothing, because four blocking threads already saturate it. **This does not contradict the −42/−73% CPU above**: that saving is per *round trip*, and a 250 KB read is too big for it to show |
| `io_uring`, windowed (`uring_tuned`, `uring_batched_stream`) | **Rejected** | 3 003–3 402 f/s — beaten by whole-frame io_uring by the same round-trip-count mechanism that beats the windowed `pread` path. The axis is inside io_uring too |
| `io_uring` + `RWF_NOWAIT` hybrid *(best io_uring arm)* | **Rejected here; re-opened by the read-path campaign** | A tie bounded at ±5% *on this cell*: +2.5% and +2.4% against the accepted path in two pooled-sample runs, −4.5% in a `--monitors 0` cell. In the **product design** it is the accepted path on a page-cache hit — the ring only serves the miss — so on a ~100% warm workload it buys a ring, an eventfd and registered buffers per session for nothing. **That rejection is conditional on the miss rate**, which this ADR's cells fixed at ~0: `READ-PATH-DECISION.md` (archived: `git show a330783:docs/disk-access/READ-PATH-DECISION.md`) measures the hybrid **38–79% cheaper once reads miss**, on four hosts. Two caveats before acting on that: how often reads miss is a *layout* decision ([`ACCESS-PATTERNS.md`](../disk-layout/ACCESS-PATTERNS.md)), and part of the margin is reader-loop shape rather than the ring (**R8** in `SCOREBOARD.md` (archived: `git show a330783:docs/disk-access/SCOREBOARD.md`)) |
| `io_uring` alone (registered file + fixed buffers, whole frame in one submit) | **Rejected** | Ties warm (82–88 µs), worst io_uring arm when reads miss: 224 parked completions on a cold random trace vs 59, and 408–437 µs on a cold reverse pass vs ~345. Batching a frame's windows means every window of a miss waits together |
| `io_uring` pipelined (read n+1 during write n) | **Rejected** | The one thing only io_uring can do here, order-controlled at ~6% on a 100%-miss trace — while costing ~25% warm (108.6 vs 84.7 µs) and 2× session memory |
| `io_uring` + `SQPOLL` | **Rejected** | 2.8× the CPU (287 vs 104 µs/ask) for worse latency: with a kernel submitter nothing completes inline, so every read parks |
| `sendfile`/splice | **Rejected for this stack** | Userspace QUIC still copies |
| **Bounded process-private frame cache** | **Accepted, opt-in** | −20% server CPU / +15% throughput at a 0.92 hit rate; +4% where nothing is re-asked. `--frame-cache-mb`, default off (`SEND-BUDGET.md` (archived: `git show a330783:docs/disk-access/SEND-BUDGET.md`) §5) |
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

`stream_codestream` is generic over its sink, so `streaming_reassembles_every_frame_whatever_the_read_path`
drives the real loop against an evicted `FrameStore` — for frame lengths on both sides of the
window boundary — instead of only re-checking the byte layout.

## Follow-ups

`later.md` (archived: `git show a330783:docs/disk-access/later.md`) — the deployment-filesystem check is the one that matters.
