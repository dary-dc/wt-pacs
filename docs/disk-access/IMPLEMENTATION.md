# Implementing the read path — design

**Decision:** [`adr.md`](adr.md) · **Evidence:** `READ-PATH-DECISION.md` (archived: `git show a330783:docs/disk-access/READ-PATH-DECISION.md`) ·
`S5-CONTROL-ARM.md` (archived: `git show a330783:docs/disk-access/S5-CONTROL-ARM.md`)

What ships today is `pool`: `preadv2(RWF_NOWAIT)` inline, `spawn_blocking` for the shortfall.
This is the change to **`hybrid_lazyring`** — the same path, plus an io_uring built on the
session's *first miss* and used for the shortfall from then on.

## Why no performance toggle

The obvious shape is a config flag choosing "optimised for hits" against "optimised
generally". **The measurement says not to build one.** `hybrid_lazyring` already makes that
choice per session, at runtime, from what the session actually does — and no arm is
*established* better than it in any regime (`v27_lazyring.tsv` (archived: `git show a330783:docs/disk-access/v27_lazyring.tsv`), two runs,
rule as always: |median| ≥ 28.5% **and** sign ≥ 0.8n **and** same sign in both runs):

| Regime | Cheapest arm | `hybrid_lazyring` against it |
| --- | --- | --- |
| hit | `pool_ringloop` 2 069 ns | 2 144 ns — **tie** |
| mix | `hybrid` 5 068 ns | 5 298 ns — **tie** |
| miss | `uring` 14 051 ns | 24 188 ns — **tie** (−26.9 / −20.1%, does not clear 28.5%) |

And the arm a "miss-optimised" setting would select is *established worse* where it is wrong:
`uring` costs **+141.7 / +131.0% on hits, RESOLVED**. A static flag cannot know a session's
miss rate in advance; the lazy ring does not have to guess, because it only builds one once a
read has actually missed.

**What is worth a flag is a kill switch, not a tuning knob.** `WTPACS_READ_PATH=pool` forces
the pre-change path. It is an operational escape from a ring misbehaving in production, and it
costs nothing to keep because `pool` is the code that ships today.

`WTPACS_READ_PATH=uring` is a third value and is **not a production mode**: it skips the
inline probe entirely and reads every frame through the ring, which is the `uring` arm at
+131 to +142% CPU on hits. It exists so a tile-based layout can be experimented with against
a genuinely miss-optimised path. An unrecognised value warns and falls back to `auto` —
a kill switch that silently does nothing because of a typo is worse than no kill switch.

## The trap: never route a hit through the ring

On a filesystem without `RWF_NOWAIT` — overlayfs, tmpfs, i.e. **any container that serves
studies from its own layer** ([`DEPLOYMENT.md`](DEPLOYMENT.md)) — `read_at_nowait` returns `0`
for *every* read, hit or miss, because the flag is refused rather than because the bytes are
cold. A lazy ring keyed naively on "the inline read came up short" would therefore build a
ring on the first ask and then serve **every warm read through it**. That is the `uring` arm,
measured at **+131 to +142% on hits**: the change would make the container case
*significantly worse* than what ships today.

So the ring is gated on `FrameStore::nowait_supported()`, not on the shortfall alone:

| `RWF_NOWAIT` | io_uring | Path |
| --- | --- | --- |
| honoured | available | **`hybrid_lazyring`** — inline hit, ring on the miss |
| honoured | unavailable | **`pool`** — inline hit, `spawn_blocking` on the miss (today's path) |
| refused | either | **`pooled_pread`** — one pooled read per frame, the ADR's escape hatch. **Never the ring** |

The third row is not a degradation to accept quietly: it is ~2.5× worse per frame, and
`check-fastpath` exists so a deployment finds out before it ships.

## Reporting: what the server says about its own read path

Every threshold in this investigation is a miss rate, and until 2026-09-08 the server could
not report one. Two lines close that, both in the default build — this is not telemetry, and
does not depend on the `telemetry` feature.

**At startup**, one banner line and, where the answer is bad, a warning:

```
read_fast_path=preadv2        # or pooled_pread, plus a WARN naming DEPLOYMENT.md
```

[`DEPLOYMENT.md`](DEPLOYMENT.md) called the fallback "measurably slower with no error in the
logs". It now says so itself; `check-fastpath` remains the pre-deploy gate, and this is the
runtime confirmation that the deployed process got what the gate promised.

**At the end of every session**, what that session's reads did:

```
INFO session reads hits=27 misses=0 miss_rate=0.0 ring=false
```

Three details worth knowing before quoting these numbers:

* **A read, not a frame.** `ReadCtx::read` is called once per window, and a frame longer than
  one window can hit some windows and miss others. At 16 KiB frames — the tile case — window
  and frame coincide and the two readings are the same number; at 250 KB they are not.
* **`ring=false` on a session with misses** means the ring was refused or the build has no
  `uring` feature, and those misses went to the blocking pool.
* **Emitted from `Drop`**, because a session ends in several ways — `EndSession`, a broken
  wire, runtime shutdown — and a miss rate that only some of them report is worse than none.

What this unblocks: the arm choice can be checked against a real workload rather than against
the campaign's `--mix`, which is a number the lab sets rather than one production reports.

## The change

Per-session state today is one `Vec<u8>` window owned by `ProductPipeline` and threaded down
to `stream_codestream`. It becomes a small struct so the ring can live beside it with the same
lifetime:

```rust
pub struct ReadCtx {
    probe: bool,      // false only under the `uring` lever
    ring: Ring,       // Off | Pending | Ready | Refused
    window: Vec<u8>,
}
```

**The mode is resolved once, in `ReadCtx::new`, so the read loop has no mode to branch on.**
The three `WTPACS_READ_PATH` values become two independent facts — whether to try the page
cache first, and whether a miss may use a ring — and every combination then runs the same
code. That is why there is no `uring` special case in the loop: with `probe: false` the
page-cache read is skipped, the read always comes up short, and the escalation reads the
whole frame through the ring, which *is* the `uring` arm.

`Ring` has four states rather than being an `Option`, because a kernel that refuses io_uring
(an old one, a seccomp filter, `kernel.io_uring_disabled`) must not be retried on every
subsequent miss — and must not fail the ask either. It records `Refused` and the pooled path
serves.

`ReadCtx::read` returns the bytes that are ready rather than a count of them. A caller
cannot then advance by the wrong number, which is the bug the escalation invites and which
an earlier version of this code had.

`stream_codestream`'s loop is unchanged except for the shortfall branch:

1. `read_at_nowait` into the window — unchanged, and still the whole path on a hit.
2. On a shortfall, **if `nowait_supported()`**: build the ring if absent, submit the remainder,
   await the completion through the registered eventfd. Otherwise `spawn_blocking`, as today.
3. `write_all` the window — unchanged.

Constructing mid-loop is safe for the same reason it is safe in the lab arm: nothing can be
in flight when the ring does not yet exist, because every earlier ask was a hit.

## Read ahead

**Built 2026-09-08 as two windows; W = 4 as of 2026-09-09** ([`READ-PATH-DESIGN.md`](READ-PATH-DESIGN.md) §9.3, §13). A session keeps **W windows**. On-demand names up to W − 1 upcoming frames; a fill names one (`FILL_AHEAD = 1`), so fill still uses two of the four. The ring is a thin submit/reap/park wrapper; the window index is the slot.

```
read(span, pos, upcoming):
  start current if not held
  start upcoming that fit
  wait current
```

Four properties this keeps, each of which a simpler version loses:

* **A hit never touches the ring.** The read ahead probes `RWF_NOWAIT` first, exactly as an
  on-demand read does, and submits only the shortfall. A read ahead that went straight to the
  ring would rebuild the `uring` arm's +131% on hits (§The trap).
* **The pool path reads ahead too.** Where there is no ring, the window goes to
  `spawn_blocking` and the `JoinHandle` is held instead of awaited. Nothing is ring-specific
  except which mechanism carries the read.
* **A window is never grown or reused while the kernel owns it.** Reuse waits. `UringReader::submit` states the contract; `ReadCtx::drop` is the backstop.
* **Delivery stays in ask order.** Reading frame *n+1* early is pipelining, not reordering —
  `../adr-reject-server-ordering.md` does not speak against it.

### What it is worth

`product` against `product_ahead`, the shipped `ReadCtx` driven both ways by
`read_campaign`, one session, depth 1, 12 interleaved repeats
([`v36_readahead.tsv`](v36_readahead.tsv)):

| cell | asks/s | p50 | p99 | CPU/ask |
| --- | ---: | ---: | ---: | ---: |
| cold 16 KiB, 99.6% miss | **+73.8%, 12/12 RESOLVED** | −53.4% | −16.0% | −18.9% (10/12, tie) |
| warm 16 KiB | −3.8%, 5/12 — **tie** | +5.6% | +8.6% | +1.1%, 6/12 — tie |
| 250 KB | +7.2%, 9/12 — tie | | | |

16 missing tiles go from **1.14 ms to 0.62 ms**. The warm row is the one that had to be a
tie: a session whose reads hit pays nothing for a depth it never uses.

The 250 KB row says less than it looks: at `--stride 250000` on a device that reads ahead
8 MiB the cell only reached 4.7% misses, so it is a hit cell in disguise and shows no
regression rather than no win. Resolving 250 KB misses needs a fixture large enough to stride
past the read-ahead window.

### What it does not do

`RequestFrame` is **still depth 1**. The look-ahead comes from the batch, and a client that
pipelines single asks still has them served one at a time, because `run_session` does not read
the next ask until the current frame is on the wire. That is the remaining half of
[`../adr-frame-framing-and-loop-shape.md`](../adr-frame-framing-and-loop-shape.md) §6b and it
is a loop change, not a read-path one.

Two smaller edges, both by design: the first frame of a batch overlaps nothing, and the last
frame names no successor.

## What does not change

* **The wire.** Byte-for-byte identical; the existing envelope test still guards it.
* **`READ_WINDOW` = 64 KiB**, and the `write_all` per window. Handing quinn owned buffers
  (`write_chunk`) was measured at −3.2% at one session and rejected as under the drift bar
  (`SEND-BUDGET.md` (archived: `git show a330783:docs/disk-access/SEND-BUDGET.md`) §5). It
  has since been measured across session counts and is **+14.6% / +19.1% at 16 / 32
  concurrent sessions, RESOLVED** — quinn holds each window until it is acked, so the buffer
  pool cannot recycle and every window becomes a fresh 64 KiB allocation. The rejection is
  now stronger at scale than at one reader, which is the opposite of what was expected
  ([`adr.md`](adr.md) §Levers).
* **The reclaim guarantee.** Bytes reaching quinn stay process-private — the ring reads into
  the session's own buffer, never a page-cache mapping.
* **`server/` links io-uring for the first time.** Today it is a dependency of the lab crate
  only. Gate it behind a feature so a build without it still compiles to the `pool` path.

## Two things that came out different, and why

**Buffers are not registered.** The measured arm registered both the file and its buffers and
used `ReadFixed`; the product registers the *file* and reads into the session's own window
with `Read`. Registering buffers pins pages, and at thousands of concurrent sessions that is
thousands of unreclaimable frame-sized allocations against `RLIMIT_MEMLOCK`.

**Now measured, and it costs nothing.** `product` against `hybrid_lazyring` on misses at
16 KiB is **+0.7%, 5 of 10 same sign** — a tie with sign agreement at chance
([`v30_product.tsv`](v30_product.tsv)). The reasoning that the difference lives in the
submission path rather than the device path holds.

**Cancellation needed handling the campaign never had to think about.** The kernel writes
into the caller's buffer between submit and completion, so dropping the future in between
hands the kernel freed memory. Session tasks are `tokio::spawn`ed and are dropped at their
await point on runtime shutdown, so this is reachable. `UringReader::drain_in_flight` waits
for the outstanding read, called both from its own `Drop` and from `ReadCtx::drop` — the
latter because a struct's `Drop::drop` runs before any field is dropped, which makes the
guarantee independent of field declaration order instead of one careless reorder away from
memory corruption.

## Test plan

Unit, alongside the existing `frame_store` tests:

| Test | Asserts |
| --- | --- |
| `lazy_ring_is_not_built_when_every_read_hits` | no ring after a warm frame — the arm's whole point |
| `lazy_ring_is_never_built_without_nowait` | with `nowait = false`, no ring is built and the pooled path serves — the container trap |
| `nowait_and_ring_compose_into_the_whole_frame` | prefix from the inline read + remainder from the ring equals the frame, mirroring the existing `spawn_blocking` composition test |
| `a_frame_that_misses_costs_one_round_trip_not_one_per_window` | the escalation reads the rest of the *frame* — the ADR's claim as an assertion rather than a comment |
| `the_uring_lever_serves_whole_frames_through_the_ring` | the lab lever really is the `uring` arm, so a layout experiment measures that and not a broken path |
| `dropping_a_reader_mid_read_waits_for_the_kernel` | `Drop` reaps the outstanding read. The wait is counted, because a read served from the page cache lands before a missing wait could otherwise be observed |
| `streamed_bytes_match_the_envelope_they_replaced` | unchanged, still passes |

**Misses are forced through two test-only `FrameStore` levers** (`force_pool_reads`,
`force_short_reads`) and not by evicting the page cache. Eviction is not a lever a test can
rely on: `fadvise(DONTNEED)` will not evict a mapped page, and on the host these were written
on it does not evict even before the mapping exists — which silently left an earlier version
of the escalation test on the warm path, where it passed against a deliberately broken
implementation.

Then re-run the campaign with the product path as an arm, which is what `read_campaign`
already does through `FrameStore`, and confirm the shipped path lands where
`hybrid_lazyring` did.

## Validated: the shipped path is the arm

`read_campaign --arms product` drives `server`'s own `ReadCtx` the way `stream_codestream`
drives it, so this is the product measured against the candidates rather than against a model
of itself ([`v30_product.tsv`](v30_product.tsv),
`lab/scripts/run_product_validation.sh`). Paired per-cell, the campaign's own rule:

| `product` vs | hit | miss (16 KiB) | miss (250 KB) |
| --- | ---: | ---: | ---: |
| `hybrid_lazyring` — the chosen arm | −0.5%, tie | **+0.7%, tie** | +16.6%, tie |
| `pool` — what shipped before | −0.6%, tie | **−45.4%, RESOLVED** | −6.3%, tie |

The shipped path is indistinguishable from the arm that won, and established cheaper than the
path it replaced where a miss is a whole 16 KiB read. It also reproduces the structural
claim: at 8 readers on misses `pool` peaks at **18** OS threads and every ring arm, the
product included, stays flat at **5**.

The 250 KB miss column is the one to watch. −6.3% against `pool` is what the ADR predicts —
the ring saves a roughly fixed per-round-trip cost, which is most of a 16 KiB read and under
8% of a 250 KB one — so the product's real frame size is where this change is worth least.

**The +16.6% against `hybrid_lazyring` there was rerun at 15 repeats and is not a
difference — the cell cannot measure one** ([`v31_gap250k.tsv`](v31_gap250k.tsv)). It fell to
**+6.7% with 16 of 30 signs**, agreement at chance. The reason is the cell, not the arms: a
250 KB cold read on this device varies **2× to 12.5× between repeats of the same arm**
(CV 0.23–1.16), and the control — `hybrid` against `hybrid_lazyring`, which differ only in
*when* the ring is built — is itself at 12.5× spread. Nothing smaller than about 2× is
resolvable here. Resolving it needs many more asks per cell to average the device tail, or a
quieter device; it is not a question more repeats will answer.

## Measuring the arm at thousands of sessions

The decision so far rests on cells at 1–8 readers and depth 1. The deployment target is
thousands of concurrent sessions, most asks missing. This is what has to be measured, in
order, and what each step would decide.

### The serving loop is serial, and that is a transport bug, not a read-path one

`FramePipeline::serve_batch` is a `for` loop with an `.await`: a batch of *N* frames is *N*
strictly sequential read-then-send cycles. For a tile viewport that is the whole latency
budget spent in series. Measured on 16 tiles of 16 KiB, all missing:

| | serial (today) | pipelined (depth 16) | |
| --- | ---: | ---: | ---: |
| `hybrid_lazyring` | 1.2 ms | 0.4 ms | **2.9×** |
| `pool` | 1.9 ms | 0.5 ms | 3.9× |

**`adr-reject-server-ordering.md` does not forbid this.** It rejects serving the *newest* ask
first, on the grounds that FIFO already carries the client's priority. Reading frame *n+1*
while frame *n* is on the wire preserves FIFO delivery exactly — it is pipelining, not
reordering. The serial loop is an implementation choice, and for a real-time tile viewer on
slower storage than this host it is the dominant cost.

### Crossed depth × readers — where the arm choice actually stands

Earlier cells varied depth at one reader, or readers at depth 1, and **never crossed them**.
Crossed, 100% miss, `uring` minus `hybrid_lazyring` in microseconds — negative means `uring`
is faster ([`v33_cross.tsv`](v33_cross.tsv)):

| depth | readers | in flight | p50 | p99 |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 1 | −13 | −37 |
| 1 | 4 | 4 | +8 | +27 |
| 1 | 16 | 16 | +29 | +166 |
| 4 | 1 | 4 | +28 | **−87** |
| 4 | 4 | 16 | +88 | **−224** |
| 4 | 16 | 64 | +97 | **−1 468** |
| 16 | 1 | 16 | +192 | +111 |
| 16 | 4 | 64 | +128 | **−72** |
| 16 | 16 | 256 | +519 | +7 772 |

On the sandbox this read as "`hybrid_lazyring` has the better median, `uring` the better tail
at depth 4". **That did not reproduce on real hardware and should not be relied on** — see the
next section. The sandbox is 4 vCPU and runs out of CPU at ~64 reads in flight, so its
high-concurrency rows measure the host.

What does hold on both hosts is which arm is structurally safe: `pool` grows OS threads
without bound while every ring arm stays flat. The arm to avoid at scale is the one this
change replaced.

### The scale run: device-bound, and the arms tie on misses

An 8-thread workstation (i5-8250U, btrfs on LUKS/NVMe), 528 cells, arms interleaved, all 264
cold cells verified 0.0000% resident ([`v34_scale.tsv`](v34_scale.tsv),
[`v34_scale_host.txt`](v34_scale_host.txt)).

It does not lift the ceiling it was written to lift — it moves it. The sandbox ran out of
**CPU** at ~64 reads in flight; this host runs out of **disk** at the same place: cold
throughput plateaus at ~51k asks/s (~840 MB/s) with system CPU at 0.42 of 8 cores. Past that
every arm sits in the same full device queue, so every pair ties by construction.
[`EVIDENCE.md`](EVIDENCE.md) already names "storage faster than ~1.25 GB/s" as never
established; this run does not establish it either.

What it does settle:

| | |
| --- | --- |
| **`uring` does not cross `hybrid_lazyring` at depth 2–4** | misses tie at every depth (CPU −3.1 / −3.9 / −1.9%); hits lose harder with depth (p50 +106% at depth 2, +298% at depth 4, RESOLVED) |
| **`product` still tracks `hybrid_lazyring`** | every pair a tie — p50, p99 and CPU — at every depth and reader count |
| **`pool` bends at 64 readers** | 125–135 blocking threads, 25–32k asks/s against ~43k, p99 9.6–13.4 ms against 3.2–7.1 ms, 6 of 6 repeats. Threads cap at 521 (tokio's 512 + runtime) |
| **Ring arms hold 9 threads flat** everywhere, and grow ring fds instead | `hybrid_lazyring` one per session; at 1 024 sessions that is 1 024 rings |

**`RLIMIT_MEMLOCK` refused two cells** on that host — 8 MB hard, no root. At 8.7 KiB per ring
that is roughly 940 rings. So the deployment limit is not only `LimitNOFILE`: **`LimitMEMLOCK`
binds first on a host with the common 8 MB default.**

### Alternatives considered, and why this one

The read path drives the `io-uring` crate directly. What else was on the table:

| Option | Verdict | Why |
| --- | --- | --- |
| **`io-uring` crate, driven directly** | **chosen** | Positional reads at an offset, one shared fd, works on the multi-thread runtime the transport already needs |
| `spawn_blocking` + `pread` | measured, replaced | The `pool` arm. Correct and simple, but −56 to −75% slower on misses and grows OS threads: 98 at 256 reads in flight |
| `preadv2(RWF_NOWAIT)` inline | **kept — it is the hit path** | Not an alternative but the other half: a page-cache hit never reaches the ring |
| mmap | rejected, measured | Faults freeze co-tenants (`gap_max` 1.5–4.2 ms); `mincore` gating unsafe 5/5 runs. See the table above |
| `tokio::fs` + `io-uring` feature | rejected — see below | Sequential only; no positional read exists in `tokio::fs` |
| `tokio-uring` crate | rejected | Current-thread runtime with its own driver. **Verified 2026-09-08**: 0.5.0, no release since 2024-05 |
| `glommio`, `monoio`, `compio` | rejected | Thread-per-core or completion-first runtimes. **Verified 2026-09-08**; `compio` is the live one |
| `uring-fs` — "any async runtime" | rejected | The wrapper this list assumed did not exist. It spawns a reaper thread, has no positional read, and its author flags possible undefined behaviour |
| `O_DIRECT` + SPDK | rejected | Wrong scale for this workload |
| `sendfile` / `splice` | rejected | Userspace QUIC copies anyway |

#### The constraint that rules out four of them at once

Any option that brings its own runtime — `tokio-uring`, `glommio`, `monoio`, `compio` — is not
a read-path change but a **whole-server rewrite** of the transport too.

**And the constraint belongs to `wtransport`, not to QUIC.** Corrected 2026-09-08: quinn
0.11.11 has a public `Runtime` trait with `TokioRuntime`, `SmolRuntime` and `AsyncStdRuntime`
shipped; it is `wtransport 0.7.2` that hardcodes `Arc::new(TokioRuntime)`
(`endpoint.rs:132`, `:186`). Another runtime would still have to implement `quinn::Runtime`
over its own UDP and timers, so this is a lead rather than an opening —
[`RESEARCH-io-backends-RESULT.md`](RESEARCH-io-backends-RESULT.md). That is a real option one day, and [`RERUN.md`](RERUN.md) already names "a thread-per-core
runtime" as one of the two conditions that would reopen io_uring's ceiling. It is not a
choice this ADR can make on its own.

#### Why not tokio's own io_uring support

Verified against the vendored source of tokio 1.53.1 (re-checked 2026-09-08):

* Gated behind `cfg(all(tokio_unstable, feature = "io-uring", "rt", "fs", linux))`.
* It routes **sequential** reads through the ring, and has done since 1.52.0 implemented
  `AsyncRead for File` over io_uring — more than this section originally claimed.
* **The public `tokio::fs::File` still has no positional read** — no `read_at`, no
  `read_exact_at`. Internally `src/io/uring/read.rs:102` has a `pub(crate) read_at`, so the
  gap is an API boundary rather than missing machinery, and a public one appearing is the
  event that reopens this row.

A frame is a byte range at an offset, read out of order across a study, so the operation
tokio accelerates is not the one this path performs.

There is a second, quieter reason, and it is the one that matters at thousands of sessions:
**positional reads share one file descriptor; sequential reads cannot.** A cursor belongs to
a handle, so every concurrently-reading session needs its own `File`. Today `FrameStore` holds
**one** fd for the whole study however many sessions read it. Switching to cursor reads makes
that one fd per session, on top of the 2 the ring already costs.

#### …but for the streaming mode, sequential is the right shape

Server-driven streaming (`../adr-frame-framing-and-loop-shape.md` §6c) reads a study start to
end. That *is* a sequential cursor read, so the objection above does not apply to it, and
tokio's uring path would fit. Two things to weigh when that mode is built rather than now:

* **It is optimising the small half.** A sequential read is the page cache's best case; the
  per-frame budget is ~675 µs of QUIC work against ~10 µs for a warm read. Making the read
  faster moves ~1.5% of the frame.
* **`tokio_unstable` in a production build** is the real cost — an unstable cfg can change
  between minor releases, and this is a medical imaging server.

The honest default for streaming is therefore the path that already exists — read forward
with the same `ReadCtx`, which read-ahead serves well — and to measure before adding an
unstable feature flag for 1.5% of a frame.

#### Caveat on this table

Only the tokio rows are verified: they were read out of the vendored crate source. The
`tokio-uring`, `glommio`, `monoio` and `compio` rows are from prior knowledge and were **not**
checked against current releases — this sandbox has no crates.io access. The runtime argument
above does not depend on their versions, but if one of them has since gained multi-thread
tokio compatibility, that row deserves rechecking before it is treated as closed.

**Checked 2026-09-08** against crate source and the 6.18 kernel:
[`RESEARCH-io-backends-RESULT.md`](RESEARCH-io-backends-RESULT.md). Every row holds — all four
still bring their own runtime — and the search found nothing that replaces this binding. It
did find one thing to change in it: the eventfd is unnecessary, because the ring fd is itself
pollable (proposal P1 there, measured as `x14`).

### One in flight per session, by construction

`UringReader` holds a single `in_flight: bool` and `ReadCtx` a single `window`, so **a session
can have exactly one read outstanding**. That is correct for today's serial `serve_batch`, and
it is the thing that has to change first if frames are ever served concurrently within a
session — pipelining is not a matter of spawning tasks around the existing `ReadCtx`, because
they would contend for one buffer and one ring slot.

### …and the depth argument for `uring` is about the tail, not the median

The published `uring` advantage at depth is a **CPU** advantage, and CPU is not what a
real-time viewer is short of. `uring` is cheaper in CPU and slower in wall-clock at the same
time — not a contradiction, because the ring does less work per read but reaps completions in
batches behind an eventfd wakeup, so each read lands later.

Paired per repeat, **99.2–100% miss in every cell** ([`v32_depth.tsv`](v32_depth.tsv)):

| depth | CPU per ask | p50 latency |
| ---: | ---: | ---: |
| 1 | +0.1% (3/6) | −0.3% (3/6) |
| 4 | **−14.9%** (6/6) | **+47.1%** (6/6) |
| 16 | **−9.7%** (5/6) | **+61.4%** (6/6) |

Throughput is deliberately not a third column: it is `depth / latency` to within 0.66–0.97
here (Little's law), so quoting it beside latency counts one measurement twice.

The tail is what a viewer feels, and it widens the gap rather than narrowing it — cold, 100%
miss:

| arm | depth | p50 | p90 | p99 |
| --- | ---: | ---: | ---: | ---: |
| `hybrid_lazyring` | 16 | 275 µs | 347 µs | **407 µs** |
| `uring` | 16 | 466 µs | 584 µs | **632 µs** |
| `pool` | 16 | 385 µs | 685 µs | **1 205 µs** |
| `hybrid_lazyring` | 4 | 110 µs | 156 µs | **226 µs** |
| `uring` | 4 | 173 µs | 217 µs | **266 µs** |

`hybrid_lazyring` is best at every percentile at depth 4 and 16; at depth 1 the two tie. The
regime is not the explanation — these cells have essentially no hits in them.

### First, the distinction that decides most of it

**Thousands of users is `readers`, not `depth`.** The published `uring` advantage lives at
depth > 1 — several reads in flight *inside one session* — because the inline probes then run
serially on the executor before the ring can batch. A thousand sessions each doing one read
per ask is a thousand instances of depth 1, where there is nothing to serialise: measured at
depth 1 `uring` **ties on misses and is 3× worse on hits**
([`v32_depth.tsv`](v32_depth.tsv)).

The depth axis only opens if the session loop serves several asks from one session
concurrently, which `adr-reject-server-ordering.md` currently forbids. So Phase 3 below is
conditional on that design changing.

### Phase 0 — make the miss rate observable (done)

Every threshold below is a miss rate, and the server could not report its own. It now emits
one per session, plus the read path it actually took at startup — §Reporting above.

### Phase 1 — per-session ring cost (done)

Both ring arms build one io_uring plus one eventfd per session that misses
(`lab/disk-access-bench/src/bin/ring_scale.rs`):

| | measured |
| --- | --- |
| File descriptors | **2 per session** that misses |
| Resident memory | **8.7 KiB per ring** |
| Construction, steady state | **15.6 µs** — pays back on the first miss against a ~29 µs pool hop |
| Construction, mass creation (1 000–4 000 at once) | 82–100 µs, p99 0.5–1.2 ms |
| Ceiling | 4 000 rings created without failure |

**The operational consequence is the descriptors.** At 1 000 missing sessions that is 2 000
fds on top of the sockets; a host left at the common `ulimit -n` of 1024 caps out near 500
sessions, and the failure is a refused ring, not a refused connection. Raise `LimitNOFILE`
before this matters — and note the mass-creation row: a restart with a thundering herd pays
~5× the steady-state construction cost, on the executor.

### Phase 2 — the readers sweep, which decides the arm

`read_campaign --arms pool,hybrid_lazyring,uring --depths 1 --readers 1,8,32,64,128,256`,
cold, stride past the read-ahead window. Six repeats, arms rotated per repeat.

Read three columns, not one: `cpu_ns_per_ask`, `threads`, and `asks_per_s`. The question is
not only which arm is cheapest but **which curve bends first** — `pool` grows threads (18 at
8 readers already), the ring arms grow descriptors.

* **Decides:** whether `hybrid_lazyring` holds its −56 to −75% against `pool` as readers
  climb, and whether `uring` ever crosses it at depth 1.
* **Caveat that must be stated in the result:** on a 4 vCPU host, a few hundred reader tasks
  measure the host, not the arm. Report where the host saturates and stop claiming anything
  past it.

### Phase 3 — depth × readers, only if the session loop changes

If a tile viewport is served with several asks in flight, rerun Phase 2 at depths 1 and 4
crossed with readers 1, 32, 128. Then apply the breakeven from
[`EVIDENCE.md`](EVIDENCE.md): `uring` pays above a **53–64% miss rate** at depth 4–16 and
never at depth 1.

* **Decides:** whether `WTPACS_READ_PATH=uring` should become a supported production mode
  rather than a lab lever.

### Phase 4 — the arithmetic that turns it into a decision

With Phase 0 giving a real miss rate `m` and Phase 2/3 giving hit penalty `P` and miss saving
`S` in ns per ask, `uring` wins when `m·S > (1−m)·P`. Nothing else about the choice needs
arguing once those three numbers exist.

## Before rollout: the one thing still unmeasured

**The chosen arm was never measured above one concurrent session**, and the deployment target
is thousands. `v30_product.tsv` extends it to **8 readers** — where the product still ties
`hybrid_lazyring` and `pool` still grows threads — but 8 is not thousands. The reader-scale
evidence tops out at 128 readers and does not include this arm:

| readers | `pool` threads | `hybrid` | `uring` |
| ---: | ---: | ---: | ---: |
| 1 | 11–12 | 5 | 5 |
| 16 | 77–82 | 5 | 5 |
| 64 | 160–265 | 5 | 5 |
| 128 | 227–381 | 5 | 5 |

Two readings. **Thread growth separates ring-from-`pool`, not the two ring arms** — so scale
is an argument for shipping a ring at all, not for choosing between them. And `pool` at 381
threads for 128 readers is the number that should decide the schedule: at thousands of
concurrent sessions, the arm that shipped before this change is the one that does not hold up.

Closing it is cheap, and it belongs before rollout rather than before implementation:

```bash
./target/release/read_campaign --arms pool,hybrid,hybrid_lazyring,uring \
  --readers 1,16,64,128 --depth 1 --out /tmp/v29_lazyring_readers.tsv
lab/scripts/pair_arms.py --pairs hybrid_lazyring:hybrid,uring:hybrid_lazyring \
  --by readers /tmp/v29_lazyring_readers.tsv
```

Expect ties throughout — `hybrid_lazyring` is `hybrid` with a lazier constructor, and
`hybrid` is already measured to 128. A surprise there is the only thing that would change
the arm.

## Sequencing

1. `ReadCtx` + the gated lazy ring + tests. Behaviour identical on every host where
   `RWF_NOWAIT` is refused, and identical warm everywhere.
2. Run `check-fastpath` on the deployment host — it decides which of the three rows above you
   are on, and therefore whether this change is worth anything at all.
3. **Land it without waiting on the layout decision.**

### The layout changes what this is worth, not which path wins

Worth stating plainly, because the opposite is easy to assume. The disk layout decides
**how often reads miss** ([`../disk-layout/ACCESS-PATTERNS.md`](../disk-layout/ACCESS-PATTERNS.md)):
a strided layout steps to 99% miss under pressure, a grouped one holds at 0.5%. What it does
**not** decide is which read path to build, because `hybrid_lazyring` is tied for cheapest in
*every* regime — there is no layout under which some other arm becomes the right answer:

| If the layout leaves reads… | Cheapest arm | `hybrid_lazyring` | What this change is worth |
| --- | --- | --- | --- |
| **hitting** (grouped, fits cache) | `pool_ringloop` | tie | **~nothing** — no ring is ever built, so it behaves like today's path |
| **mixed** | `hybrid` | tie | ~2.7× against `pool` |
| **missing** (strided, under pressure) | `uring` | tie | **~2.5×** against `pool` |

So the layout decision moves the payoff between "nothing" and "2.5×". It never makes a
different arm correct. That is the argument for landing this **before** the layout is
settled rather than after: on a hit-dominated workload the ring is never constructed and the
change is inert by design, and on a miss-dominated one it is already in place.

Earlier drafts of this section said to "adopt only if the layout leaves reads missing". That
was wrong — it confused *how much the change is worth* with *whether it is the right change*.
