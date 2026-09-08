# I/O backends — research result

**Checked 2026-09-08.** Answers [`RESEARCH-io-backends.md`](RESEARCH-io-backends.md). Every
crate claim below is read from the crate's own source at the version named, every kernel claim
from the Linux tree at tag `v6.18` (this host runs 6.18.44), and every activity date from the
repository's commit feed. The sandbox could reach the crates.io index and API, crate sources on
static.crates.io, GitHub pages and raw files; it could not reach docs.rs, lib.rs, man7.org,
lwn.net or kernel.org, so nothing below cites those.

## Decision, aligned with the owners — 2026-09-08

Four answers set the weights: production is **cloud for sure, Docker possibly, not decided**;
**studies are far larger than RAM**, so misses are the common case; the code budget is **a
small measured binding now**, "whatever is fastest" once it is shown to pay; and the design
must hold at **thousands of sessions with depth 4 or more**. Latency is the main metric,
simplicity and clean code are valued. Under those weights the answer below stands, with one
change of timing and one reframing.

**Do not change the read path now, in either direction.** What ships is measured, tested, and
degrades to `spawn_blocking` on its own when a ring is refused. P1 is a reduction, not an
addition — but it is still a change with no measured gain, and it has not run in production.
It waits behind P0.

**P0 — decide on the target, not on a laptop.** One campaign run on the actual cloud
instance, volume class and container image: `product` against `pool`, cold, readers 64–256 at
depth 4, with `check-fastpath` on the study **volume** and `ulimit -l` inside the container
recorded beside the TSV. Decision rule, fixed now: if the ring's margin over `pool` on misses
does not beat the resolution rule on that host, **delete the ring** (~800 lines with its
tests) and ship the pool — the simplest option wins on a tie. If it holds, keep the ring, fold
P1 into the same change as the deploy limits, and re-run the `product` arm.

Why the answer might go either way there, which it would not on a workstation:

* **A miss on cloud block storage is device-bound.** The ring removes a thread hop of tens of
  microseconds from each miss. On local NVMe that was −56 to −75 % of a miss; on a network
  volume whose read costs hundreds of microseconds to milliseconds it is a few percent, and
  [`SCALE-RUN.md`](SCALE-RUN.md) already showed every arm tying once the device saturates
  (~64 reads in flight on that host). The x14 grid says the same: CPU per miss differs by
  0–30 µs between arms, against ~675 µs of QUIC work per frame. **The backend decides ≤ 5 % of
  a frame's CPU and a few percent of a miss's latency.**
* **Two container traps, both silent.** (1) `RWF_NOWAIT` is refused on overlayfs, so a study on
  the image layer never builds a ring and runs the pool anyway — a bind-mounted or block
  volume is the host filesystem and is fine; `check-fastpath` on the study path answers it.
  (2) Every ring's memory is charged against `RLIMIT_MEMLOCK` unless the process holds
  `CAP_IPC_LOCK` (`io_uring/memmap.c` `io_create_region` → `__io_account_mem`, which checks
  `rlimit(RLIMIT_MEMLOCK)` — `v6.18`). At 8.7 KiB a ring, the 8 MB default is ~940 missing
  sessions; container runtimes often set far less. A refused ring falls back to the pool, per
  session, without a log line. Thousands of sessions therefore need either the limit raised
  or the capability, and that has to be in the deploy manifest, not discovered.
* **What "thousands at depth 4" costs each option.** The pool holds one blocking thread per
  miss in flight, capped at 512 by tokio: 128 missing sessions at depth 4 fill it, and further
  misses queue behind it (a queue, not a failure — and the device is usually the narrower
  funnel). The ring holds no thread per miss: 5 OS threads flat at 256 in flight where the
  pool reached 110. That is the ring's real claim at scale — thread count and CPU per miss,
  not per-miss latency — and it is the claim P0 must test on the target.

**Where latency is actually won when studies exceed RAM:** fewer misses, then a faster
device, then overlap — the backend last. Layout and read-ahead
([`../disk-layout/`](../disk-layout/README.md)) set the miss rate; the volume class sets what a
miss costs; read-ahead by one ([`NEXT.md`](NEXT.md) §1) hides one miss behind the previous
send. None of these is a backend change, and each moves more than any option in this file.

**On the asymmetry the owners raised** — rejecting crates for being dormant while keeping a
custom binding: the rejections were on hard constraints, not maintenance. Four candidates
bring their own runtime, which `wtransport` cannot use; two have no positional read; one has a
soundness hole. Maintenance was a secondary note. The single standard alternative, tokio's
own io_uring path, needs `--cfg tokio_unstable` — a flag that may break between minor
releases — and that is a larger maintenance liability for a medical server than ~270 lines of
glue over the `io-uring` crate tokio itself depends on. The custom part is the glue, not an
io_uring implementation. The owners' other point stands unreduced: it has not run in
production at scale, and P0 is how that gets answered before anything else is touched.

## The answer

**Keep driving `io-uring` directly.** Nothing on crates.io drives a ring on tokio's
multi-thread runtime with positional reads and less code than the ~130 lines that ship. Every
wrapper that hides the `unsafe` either brings its own runtime (§2.1 of the brief) or a thread
per ring, which is the hop the ring was adopted to remove. Every prior-knowledge row in
[`IMPLEMENTATION.md`](IMPLEMENTATION.md) §Alternatives holds against the current release.

**One change is worth making, and it is not a crate.** The ring fd is itself pollable, so the
registered eventfd is unnecessary. Parking on the ring fd instead gives **one fd per missing
session instead of two**, removes the eventfd `read` from every park, and removes two of the
binding's `unsafe` sites. Tokio's own io_uring driver parks this way. Measured in the lab as
`x14` (§3): it ties the eventfd on CPU in every regime and costs nothing this host can see; the
gain is by construction. That is proposal **P1** (§5) — timed behind P0, see above.

**Streaming (Q2):** read forward with the existing `ReadCtx`. Do not adopt tokio's io_uring
feature for it (§4).

| Decided | |
| --- | --- |
| Q1 — anything better than `io-uring` direct for tiles? | **No.** P1 improves the binding; no crate replaces it |
| Q2 — what should streaming use? | **`ReadCtx` reading forward.** The ring is already the miss path; tokio's driver is one mutex-locked ring per runtime, behind `tokio_unstable`, one cursor fd per session |
| `io-uring` version | 0.7.14 → **0.7.15** (published 2026-09-07) at the next dependency pass. Drop-in; §2 says why the fix it carries is inert here |

The lab was changed to measure P1; **no product source was touched.**

## 1 · The candidates, verified

| Candidate | Latest · published | Activity | Runtime model | Positional read | Verdict |
| --- | --- | --- | --- | --- | --- |
| **`io-uring`** (current) | 0.7.15 · 2026-09-07 | commit 2026-09-07; no GitHub releases — versions live on crates.io | a binding, no runtime | n/a | **keep** |
| `tokio-uring` | 0.5.0 · 2024-05-27 | last commit 2025-07-07 (a clippy fix); 57 open issues, 41 open PRs; pins `io-uring ^0.6` | own **current-thread** runtime: `tokio_uring::start` builds `new_current_thread()` (`src/runtime/mod.rs:70`) | `File::read_at`, `read_exact_at` — owned buffers | **rejected** — constraint 1, and dormant |
| `glommio` | 0.9.0 · 2024-03-25 | last commit 2025-04-21 | thread-per-core, own executor (README: "Cooperative Thread-per-Core crate") | `BufferedFile::read_at`, `DmaFile::read_at` | **rejected** — constraint 1 |
| `monoio` | 0.2.4 · 2024-08-20 | last commit 2026-05-29 | thread-per-core, own runtime. `monoio-compat` 0.2.2 is an `AsyncRead`/`AsyncWrite` adapter for hyper, not runtime interop | `File::read_at` | **rejected** — constraint 1 |
| `compio` | 0.19.2 · 2026-08-18 | commits 2026-09-07 — very active | thread-per-core: "a thread-local runtime, meaning it cannot be sent to other threads" (`compio-runtime/src/lib.rs:68`) | `AsyncReadAt for File` (`compio-fs` 0.12.1) | **rejected** — constraint 1. Note `compio-quic` 0.8.2: QUIC on `quinn-proto` with an `h3` feature. The transport rewrite has a concrete stack now; it is still a rewrite |
| `tokio` `io-uring` feature | 1.53.1 · 2026-07-20 | 1.52.0 (2026-04-14) routed `File`'s `AsyncRead` through the ring; 1.53.0 added `try_exists`, rename, CQE-overflow flush | multi-thread ✓ — **one ring per runtime** in a `Mutex` on the io driver (`runtime/io/driver.rs:61`), ring fd registered with mio (`driver/uring.rs:177`) | **none public.** `Op::read_at(.., u64::MAX)` in `fs/file.rs` is a cursor read. Issue #1529 (open since 2019-09, "feature-accepted") ↔ PR #8235 (open 2026-06-28, last activity 2026-08-10) adds `File::read_at` via **`spawn_blocking`**, not the ring | **rejected for tiles** (constraint 2); **not adopted for streaming** (§4) |
| `rio` | 0.9.4 · 2020-08-21 | dead | any | — | **rejected** — its README: use-after-free reachable without `unsafe` via `mem::forget` |
| `ringbahn` | 0.0.0-experimental.3 · 2020-06-19 | dead | — | — | **rejected** |
| `nuclei` | 0.4.4 · 2024-01-26 | last commit 2024-02-18 | own proactor runtime on `async-global-executor` | — | **rejected** — constraint 1 |
| `uring-fs` | 1.4.0 · 2024-01-15 | last commit the same day ("important fix for UB during sq submission") | runtime-agnostic through a **reaper thread** per ring (`src/lib.rs:187`); `io-uring 0.6` | **no** — cursor reads at offset −1 only | **rejected** — constraint 2, and the thread hop |

`quinn` 0.11.11 (commits 2026-09-08) has had a `Runtime` trait — `new_timer`, `spawn` of a
`Send` future, `wrap_udp_socket` — with `TokioRuntime`, `SmolRuntime` and `AsyncStdRuntime`
implementations, so the runtime abstraction the brief asks about exists at the quinn layer.
`wtransport` 0.7.2 (commits 2026-08-21) does not use it: its `Cargo.toml` pins
`quinn/runtime-tokio` and 8 of its 14 source files call `tokio::` directly. Constraint 1
stands: any non-tokio runtime is a `wtransport` rewrite, and `compio-quic` is the shape that
rewrite would take.

## 2 · Not on the list

### Reverse dependencies of `io-uring` (crates.io lists 93)

| Crate | Latest · published | What it is | Why not |
| --- | --- | --- | --- |
| `luring` | 0.1.1 · 2024-09-05 (bearcove/loona; last commit 2025-04-08) | "io-uring abstraction using tokio's AsyncFd": 341 lines, two `unsafe` sites, a `thread_local!` `Rc` ring, a slab of ops — and it **parks on the ring's own fd** (`AsyncFd::new(uring)`), no eventfd | `Rc` + thread-local → `!Send` futures → `LocalSet` only, not the work-stealing runtime; pins `io-uring 0.6`. It is, though, independent confirmation of P1's mechanism |
| `uring-file` | 0.9.0 · 2025-12-07 | `ur_read_at` on any `File`, three API levels; 2 333 lines, 17 `unsafe`; `io-uring 0.7.8` | a reaper `thread::spawn` per ring delivers completions (`src/uring.rs:689`) — a thread hop on every miss |
| `fastio` | 0.3.0 · 2026-06-23 | cross-platform file backends | its `uring::File::read_at` is **synchronous** on a thread-local ring; its tokio backend is `spawn_blocking` |
| `io_uring_actor` | 0.2.0 · 2025-01-29 | one shared ring behind a channel to an actor task | the shared-ring shape (P3) plus a channel hop each way |
| `fluke-io-uring-async` | 0.1.0 · 2024-05-28 | `luring`'s predecessor | as `luring` |
| `io_uring_buf_ring` | 0.2.3 · 2025-12-22 | provided-buffer rings | only useful with multishot, which does not apply to regular files (below) |
| `safer-ring` 0.0.1, `ringolo`, `trale`, `orengine`, `hiver-runtime`, `uringy`, `libuio`, `completeio` | 2023–2026 | own runtimes, or 0.0.x | constraint 1 |
| `quilkin` | 0.10.0 · 2026-01-27 | Google's UDP game proxy — tokio plus io-uring | a packet path on dedicated threads, not a file read. A design reference only |

Nobody has published the thing this server hand-rolled: a ring per session, submitted from
whichever worker resumed the task, awaited through `AsyncFd`. The two crates closest to it
(`luring`, tokio's own driver) both park on the ring fd rather than an eventfd, which is what
P1 adopts.

### Kernel side, `v6.18`

* **The ring fd is pollable — this is P1.** `io_uring_poll` (`io_uring/io_uring.c:2924`,
  installed as `.poll` at `:3585`) reports `EPOLLIN` when the CQ has entries or overflow work
  is pending; every CQ post wakes `ctx->poll_wq` (`io_poll_wq_wake` at `:573`). Activation is
  lazy only for `DEFER_TASKRUN` rings: `if (!ctx->task_complete) ctx->poll_activated = true`
  (`:3825`), and `task_complete` is set only with `DEFER_TASKRUN` (`:3812–3816`). A
  `COOP_TASKRUN` ring, which is what ships, is pollable from setup. The kernel's own comment
  warns that a poller "may get EPOLLIN meanwhile seeing nothing in cqring" — a drain loop that
  tolerates an empty wake, which the binding already has, is the whole requirement.
* **`IORING_REGISTER_RING_FDS` (5.18) and `IORING_SETUP_REGISTERED_FD_ONLY` (6.5, needs
  `NO_MMAP`): not applicable.** The registered-ring table is **per task**, `IO_RINGFD_REG_MAX
  16` (`include/linux/io_uring_types.h:110`), and liburing's `io_uring_register_ring_fd(3)`
  says the optimisation "cannot be used" when a ring is shared between threads because "each
  thread may have a different index". A session's ring is entered from any tokio worker, so
  neither takes a session to zero fds. P1's floor is one.
* **Multishot read (6.7): not applicable.** `io_uring_prep_read_multishot(3)`: "can only be
  used with a file type that is pollable … pipes, tun devices"; `io_read_mshot_prep` returns
  `-EINVAL` otherwise (`io_uring/rw.c:444`). Regular files are excluded, so provided-buffer
  rings are too.
* **`IORING_SETUP_ATTACH_WQ` (5.6): moot, kept as a lever.** It shares one io-wq pool between
  rings. The campaign measured 128 rings under pressure spawning no io-wq threads (buffered
  reads complete through task work), so there is nothing to share yet. If a deployment ever
  shows the `threads` column growing with sessions, this is the knob — P6.
* **Unchanged:** `SQPOLL` costs 2.8× the CPU (measured); `SINGLE_ISSUER` still rejects a second
  submitting thread with `EEXIST` (the lab test `single_issuer_and_a_second_submitting_thread`
  still passes), so `DEFER_TASKRUN` stays out of reach on a work-stealing runtime.
* **Newer than 6.18** (uapi header at master, "7.0"): `IORING_SETUP_SQE_MIXED`,
  `IORING_SETUP_SQ_REWIND` (needs `NO_SQARRAY`, incompatible with `SQPOLL`),
  `IORING_OP_NOP128`/`URING_CMD128`, `IORING_REGISTER_ZCRX_CTRL`, `IORING_REGISTER_BPF_FILTER`.
  None changes per-session cost or the fd count.
* **`io-uring` 0.7.14 → 0.7.15:** 98 changed lines in `cqueue.rs`, `opcode.rs`, `submit.rs` —
  a `write_stream` field on write opcodes (kernel 6.16), `enable_eventfd`/`disable_eventfd`,
  and #408: `submit()` now enters the kernel when `IORING_SQ_TASKRUN` is set ("deferred task
  work is only run by an enter carrying GETEVENTS"). That flag is raised only under
  `IORING_SETUP_TASKRUN_FLAG`, which the binding does not set, so the fix is inert here and
  the bump is a drop-in — P2.

## 3 · Q1 — what "better" would have to mean, and what x14 measured

| "Better" | Any crate? | P1 (ring fd, no eventfd) |
| --- | --- | --- |
| Fewer fds per session | none: every wrapper that hides the ring keeps an eventfd, a thread, or a runtime | **2 → 1** by construction |
| Less `unsafe` | the wrappers with fewer `unsafe` sites (`luring`: 2) are `!Send` | the eventfd's two `unsafe` blocks and the 8-byte `read` go |
| Simpler | 341 lines (`luring`) to 2 333 (`uring-file`) against ~130 here | ~30 lines fewer |
| Faster | tokio's shared ring measured **slower** on concurrent positional reads (§4) | tie — below |

### x14 — the eventfd against the ring fd

Lab only: `Completion::RingFd` in `lab/disk-access-bench/src/uring_access.rs` parks on
`AsyncFd<ring fd>` with readable interest and `clear_ready()`; arms `uring_ringfd` and
`hybrid_lazyring_ringfd` in `read_campaign` are `uring` and `hybrid_lazyring` with only the
wake changed. The unit test `ring_fd_completion_wakes_a_parked_reader` reads from a pipe
nobody has written to, so the read cannot complete inline, and asserts the reader parked and
was woken — the fact P1 rests on, from the kernel rather than from reading it.

Cells: `pool`, `uring`, `uring_ringfd`, `hybrid_lazyring`, `hybrid_lazyring_ringfd` ×
depth 1, 4 × readers 1, 8, 64 × cold, warm × 6 repeats, 512 asks of 16 KiB at stride 250 000
on the 84 MB fixture, arm order rotating per repeat, monitors off
([`x14_ringfd.tsv`](x14_ringfd.tsv), 360 rows, 0 skipped). Safety cell with the monitor on:
cold, depth 1, 8 readers ([`x14_ringfd_safety.tsv`](x14_ringfd_safety.tsv)). Host:
[`x14_ringfd_host.txt`](x14_ringfd_host.txt) — 4 vCPU, ext4, `RWF_NOWAIT` honoured, cold =
`fadvise(DONTNEED)` with the residency check; the whole grid ran in 26 s, so a "cold" 16 KiB
miss costs 70–120 µs here, which is hypervisor-warm, not a device read
([`RERUN.md`](RERUN.md) §Limitations). Pairing:
[`x14_ringfd_pairs.txt`](x14_ringfd_pairs.txt), from `pair_arms.py`, which now takes
`--metric` and `--drift`.

**CPU per ask, the campaign's rule (28.5 %, paired inside each cell, sign agreement ≥ 80 %):**

| Pair | hit | mix | miss |
| --- | --- | --- | --- |
| `uring_ringfd` vs `uring` | −0.3 % (20/40) tie | +1.8 % (12/20) tie | −6.2 % (10/12) tie |
| `hybrid_lazyring_ringfd` vs `hybrid_lazyring` | −0.6 % (21/40) tie | −3.4 % (12/20) tie | −20.1 % (8/12) tie |

Hits tie with signs at chance, as they must: a hit never parks, and under `hybrid_lazyring`
never builds a ring. Misses lean cheaper on the ring fd in both pairs — one syscall fewer per
park — but at n = 12 that is not established.

**Latency (7 % drift):** the cells split both ways. `uring_ringfd` p50 on misses at depth 1
came out −40 % (5/6, resolved *for*); `uring_ringfd` p99 on hits at one reader +13 % (10/12,
resolved *against*); `hybrid_lazyring_ringfd` p50 in the 8-reader mix +10 % (10/12, resolved
*against*); everything else a tie. The calibration is in the same file: `hybrid_lazyring`'s
warm cells run identical code in both arms — no ring is ever built — and still differ by
+19.5 % at p99 (7/12). That is this host's noise at n = 12, and every resolved latency cell sits
inside it. Pooled medians for the product-shaped pair, cold:

| readers × depth | `hybrid_lazyring` p50 / p99 / CPU | `hybrid_lazyring_ringfd` p50 / p99 / CPU |
| --- | --- | --- |
| 1 × 1 | 78.0 / 344.6 µs / 91.0 µs | 75.8 / 147.9 µs / 47.8 µs |
| 1 × 4 | 88.2 / 164.3 / 25.2 | 87.1 / 202.7 / 22.4 |
| 8 × 1 | 9.4 / 1 349 / 29.4 | 15.1 / 1 463 / 28.8 |
| 8 × 4 | 8.2 / 2 519 / 19.9 | 9.1 / 2 640 / 20.2 |
| 64 × 1 | 3.2 / 1 534 / 6.4 | 3.2 / 1 620 / 6.0 |
| 64 × 4 | 3.3 / 6 433 / 6.3 | 3.3 / 6 015 / 6.1 |

**Safety:** `gap_p99` 17–21 µs on every arm; `gap_max` medians `pool` 2.1 ms, `uring` 3.2,
`uring_ringfd` 4.7, `hybrid_lazyring` 4.6, `hybrid_lazyring_ringfd` 2.2 — the ring-fd arms sit
inside the eventfd arms' band, no stall attributable to the wake. Threads: every ring arm holds
5 flat through 64 readers × depth 4; `pool` reaches 110.

**Reading:** the wake mechanism is not where the cost is. P1's case is the fd, the syscall and
the `unsafe` it removes, with no measured price. One thing the grid could not check: 256
reads in flight is the most this host can hold, and a ring-fd wake at thousands of sessions
means thousands of ring fds in one epoll set instead of thousands of eventfds — the same
count, so no new limit, but confirm on the `SCALE-RUN.md` host when P1 lands.

## 4 · Q2 — streaming reads forward with `ReadCtx`

> The full evaluation of the sequential case, with every candidate measured on consecutive
> reads — including tokio's `fs::File` on its io_uring driver — is
> [`SEQUENTIAL-READER.md`](SEQUENTIAL-READER.md). The paragraph below is the short form.

Server-driven streaming ([`../adr-frame-framing-and-loop-shape.md`](../adr-frame-framing-and-loop-shape.md)
§6c) is unbuilt. When it is built:

* **Use the existing `ReadCtx`, reading forward.** Sequential reads are the page cache's best
  case, the miss path is already the ring, and read-ahead does the rest. It costs nothing new
  and keeps one fd per study however many sessions stream it.
* **Do not adopt tokio's io_uring feature for it.** Three reasons, each sufficient: it is
  `--cfg tokio_unstable` in a production build; it is one ring per runtime under a mutex, and
  tokio issue #8367 (2026-08-18, open) measured exactly that shape at **1.36×–1.45× slower**
  than mmap on concurrent positional reads while a ring per thread ran at parity, attributing
  it to "serialization (Mutex'es, one global ring, locks held across `io_uring_enter`)"; and a
  cursor read is one `File` — and one fd — per streaming session.
* **The arithmetic has not moved:** ~10 µs of warm read against ~675 µs of QUIC work per
  frame. The win available in streaming is overlap — read frame *n+1* while *n* is on the wire
  ([`NEXT.md`](NEXT.md) §1) — not a different backend.

## 5 · Implementation proposals, ranked

Nothing here is applied to `server/`. Each proposal names the change, what it buys, what it
risks, and how the lab validates it.

**P0 — Validate on the target before touching anything.** *First.*
The campaign's `product` and `pool` arms on the production instance type, volume class and
container image, cold, readers 64–256, depth 4; `check-fastpath` on the study volume and
`ulimit -l` in the container recorded with the run. The decision rule is written above and
does not move after the numbers arrive. Everything below is conditional on it.

**P1 — Park on the ring fd; drop the eventfd.** *Recommended once P0 keeps the ring; not
before.*
`server/src/media/uring_reader.rs`: replace `eventfd: AsyncFd<OwnedFd>` with an
`AsyncFd` over the ring's own descriptor (`IoUring: AsRawFd`) registered with
`Interest::READABLE` only, delete the `eventfd(2)` call, `register_eventfd` and the 8-byte
`read`, and make `park` = `readable().await` + `clear_ready()` followed by the existing CQ
drain. Field order: the `AsyncFd` before the ring, so it deregisters before the ring closes.
Buys: one fd per missing session instead of two, one syscall fewer per park, two `unsafe`
sites fewer, ~30 lines fewer. Risks: a wake with an empty CQ (allowed by the kernel; the drain
loop already tolerates it); none with `COOP_TASKRUN`, which keeps the poll queue active from
setup. Validate: the lab test and the `x14` arms are the reference implementation; after the
change, re-run the `product` arm against `hybrid_lazyring_ringfd` — that pair is the
"did what shipped land where the arm did" check `IMPLEMENTATION.md` §Validated uses. Deploy:
`ulimit -n` per missing session halves; `RLIMIT_MEMLOCK` is unchanged (the 8.7 KiB is ring
memory). Effort: an hour.

**P2 — `io-uring` 0.7.15.** *Recommended, with the next dependency pass.*
`cargo update -p io-uring`. Drop-in (§2); re-run the `product` arm once.

**P3 — One ring per runtime, tokio's shape.** *Not now.*
A process-wide ring (or one per worker count) behind a mutex, one dispatcher task parked on
its fd, a slab mapping `user_data` to wakers. Buys zero per-session fds and memlock — the
only design that removes the `RLIMIT_MEMLOCK` ceiling (~940 rings per 8 MB). Costs a lock
across every submission from every session, which is what tokio #8367 measured as 1.36×–1.45×
against a ring per thread; and `SINGLE_ISSUER` stays unavailable, so it gains nothing there.
Worth building only if per-session ring cost becomes the binding constraint — thousands of
concurrently *missing* sessions on a host whose memlock limit cannot be raised. Lab plan: an
arm `shared_ring` (`Arc<Mutex<UringReader>>` + waker slab) at readers 64–256, cold, on the
`SCALE-RUN.md` host; the number to beat is `hybrid_lazyring_ringfd`'s CPU per ask in the
miss regime.

**P4 — A ring per worker thread, shared by that worker's sessions.** *Not recommended.*
The `luring`/`fastio` shape, made `Send`: a `thread_local!` ring per tokio worker, submissions
from the local ring, completions delivered through a waker slab because the awaiting task may
have migrated. Zero per-session fds without a global lock — but tokio has no per-worker
driver hook, so each ring needs its own dispatcher task pinned by construction, and
thread-local rings outlive runtime teardown. The complexity is the cost; build it only if P3's
mutex is shown to be the problem.

**P5 — Streaming mode: `ReadCtx` forward, plus one-ahead read.** *Recommended when §6c is
built.* No backend change (§4). The read-ahead-by-one in `NEXT.md` §1 is the whole win, and it
is a loop change, not a read-path one.

**P6 — `IORING_SETUP_ATTACH_WQ` across session rings.** *Keep in the back pocket.*
Attach every session's ring to the first ring's io-wq. One builder call, no API change, no
risk; moot on every host measured because buffered reads spawn no io-wq threads. The trigger
is a `threads` column that grows with sessions in production.

## 6 · What would reopen this

* **tokio ships a ring-backed positional read on the stable runtime.** Watch issue #1529 and
  PR #8235; the current PR is `spawn_blocking` and the driver is one locked ring, so neither
  qualifies yet. Even then, `tokio_unstable` would have to go first.
* **A thread-per-core decision for the transport.** `compio-quic` on `quinn-proto` is a
  concrete stack; WebTransport on it would be new work. That is the server-wide question
  [`RERUN.md`](RERUN.md) names as one of the two that would reopen io_uring's ceiling, and it
  is not a read-path decision.
* **A per-process registered-ring table in the kernel.** Today it is per task and capped at 16;
  if that changes, `REGISTERED_FD_ONLY` would take a session to zero fds.
* **A host that shows io-wq threads.** P6 becomes live.

## 7 · Sources

* crates.io: sparse index (`index.crates.io`, versions, `pubtime`, dependencies) and the API
  (`/api/v1/crates/<name>`, `/reverse_dependencies`); crate sources from `static.crates.io`
  at the versions named above.
* Kernel: `torvalds/linux` at `v6.18` — `include/uapi/linux/io_uring.h`,
  `include/linux/io_uring_types.h`, `io_uring/io_uring.c`, `io_uring/rw.c`; the same header at
  `master` for what is newer. liburing `man/io_uring_setup.2`,
  `io_uring_register_ring_fd.3`, `io_uring_prep_read_multishot.3`.
* tokio: `tokio/CHANGELOG.md`, `tokio/src/fs/file.rs`, `tokio/src/runtime/io/driver.rs`,
  `tokio/src/runtime/io/driver/uring.rs` at `master` (1.53.1); issues
  [#1529](https://github.com/tokio-rs/tokio/issues/1529),
  [#8367](https://github.com/tokio-rs/tokio/issues/8367); PR
  [#8235](https://github.com/tokio-rs/tokio/pull/8235).
* Activity: each repository's `commits/<branch>.atom` feed on GitHub, read 2026-09-08 —
  [tokio-rs/io-uring](https://github.com/tokio-rs/io-uring),
  [tokio-rs/tokio-uring](https://github.com/tokio-rs/tokio-uring),
  [DataDog/glommio](https://github.com/DataDog/glommio),
  [bytedance/monoio](https://github.com/bytedance/monoio),
  [compio-rs/compio](https://github.com/compio-rs/compio),
  [quinn-rs/quinn](https://github.com/quinn-rs/quinn),
  [BiagioFesta/wtransport](https://github.com/BiagioFesta/wtransport),
  [bearcove/loona](https://github.com/bearcove/loona),
  [Foxcirc/uring-fs](https://github.com/Foxcirc/uring-fs),
  [vertexclique/nuclei](https://github.com/vertexclique/nuclei),
  [spacejam/rio](https://github.com/spacejam/rio).
