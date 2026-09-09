# Implementing the read path

**Decision:** [`adr.md`](adr.md) · **Numbers:** [`EVIDENCE.md`](EVIDENCE.md) ·
**Deploy:** [`DEPLOYMENT.md`](DEPLOYMENT.md)

What ships is `hybrid_lazyring`: `preadv2(RWF_NOWAIT)` on a hit, a per-session io_uring on
the first miss, the blocking pool where either is refused.

## Why no performance toggle

The lazy ring already chooses per session, at runtime. No arm is established better than it
in any regime under the 28.5 % / 0.8n rule. The arm a “miss-optimised” flag would pick
(`uring` — every read through the ring) is **+131 to +142 % on hits, RESOLVED**.

What is worth a flag is a **kill switch**. `WTPACS_READ_PATH=pool` forces the pre-ring path.
`uring` is a lab lever, not a production mode. An unrecognised value warns and uses `auto`.

## The trap: never route a hit through the ring

On overlayfs or tmpfs, `RWF_NOWAIT` returns 0 for every read, hit or miss. A ring keyed only
on “the inline read came up short” would then serve every warm ask through the ring — the
`uring` arm, measured worse than the pool on hits. The ring is gated on
`FrameStore::nowait_supported()`, not on the shortfall alone.

| `RWF_NOWAIT` | io_uring | Path |
| --- | --- | --- |
| honoured | available | inline hit, ring on the miss |
| honoured | unavailable | inline hit, `spawn_blocking` on the miss |
| refused | either | one pooled `pread` per frame. **Never the ring** |

The third row is ~2.5× worse per frame. [`DEPLOYMENT.md`](DEPLOYMENT.md) and `check-fastpath`
exist so a deployment finds out before it ships.

## What the server reports

Default build, not behind `telemetry`.

**Startup:** `read_fast_path=preadv2` or `pooled_pread` (plus WARN).

**End of session** (`Drop`, because a session ends several ways):

```
INFO session reads hits=… misses=… miss_rate=… named=… in_flight=… ring=… fills=…
```

* A **read** is a window, not a frame. At 16 KiB they coincide; at 250 kB they do not.
* `named` is the most frames one `read` was told about (planner reach). `in_flight` is the
  most windows with a read outstanding. At client depth 1 / 2 / 4 this is 1 / 2 / 4; a fill
  reports `named=2`.
* `ring=false` on a session with misses means the ring was refused or the build has no
  `uring` feature.

## How a read works

Per-session state is `ReadCtx`: W = 4 windows and a ring built on the first miss. The window
index is the ring slot. There is no slot table.

```
read(span, pos, upcoming):
  start current if not held
  start upcoming that fit (at most W − 1)
  wait current
```

The mode is resolved once in `ReadCtx::new`. The loop does not branch on
`WTPACS_READ_PATH`. `probe: false` skips the page-cache read, so every frame goes through
the ring — that *is* the `uring` lever.

`Ring` is not an `Option`. A kernel that refuses io_uring must not be retried on every miss
and must not fail the ask. `Off` is both “never wanted” and “refused.”

On-demand names up to three upcoming frames. A fill names one (`FILL_AHEAD = 1`), so fill
uses two of the four windows. The planner and the read path share that split; the session
line reports it.

Four properties a simpler version loses:

* **A hit never touches the ring.** Read-ahead probes `RWF_NOWAIT` first and submits only
  the shortfall.
* **The pool path reads ahead too.** No ring means the window goes to `spawn_blocking` and
  the `JoinHandle` is held, not awaited.
* **A window is never grown or reused while the kernel owns it.** Reuse waits.
  `UringReader::drop` drains in-flight reads so the kernel does not write into freed memory.
* **Delivery stays in ask order.** Reading *n+1* early is pipelining, not reordering.

A miss escalates **the rest of the frame**, not the rest of the 64 KiB window. Windowing the
pool read cost 2–3 device round trips per 250 kB frame.

The planner bounds `in_hand` at `ASKS_AHEAD`. The ask reader streams `RequestFrames` instead
of collecting the batch. `upcoming` stops at the first `Fill` or `EndSession`.

## What does not change

* The wire bytes. The envelope test still guards them.
* `READ_WINDOW` = 64 KiB, and one `write_all` per window. Handing quinn owned buffers was
  worse at 16 and 32 sessions, RESOLVED.
* Bytes reaching quinn are process-private. `server/` has no mapping.
* `--no-default-features` compiles to the pool path.

Buffers are **not** registered. Registering them pins pages against `RLIMIT_MEMLOCK` at
thousands of sessions. `product` against the lab arm that registered them is a tie on
misses.

## Tests that pin the decision

| Claim | Test |
| --- | --- |
| A hit never builds a ring | `a_hit_never_touches_the_ring`, `lazy_ring_is_not_built_when_every_read_hits` |
| No ring where `RWF_NOWAIT` is refused | `lazy_ring_is_never_built_without_nowait` |
| W named frames start before the current wait | `w_named_frames_start_before_the_current_read_finishes` — also `named` / `in_flight` |
| One store per study | `sessions_share_one_store_rather_than_opening_their_own` |
| `in_hand` cannot grow with ask rate | `the_loop_holds_no_more_than_asks_ahead` |
| Upcoming stops at Fill | `upcoming_stops_at_the_first_ask_that_is_not_a_frame` |
| Pooled write stays windowed | `a_pooled_frame_is_written_in_read_windows_not_in_one_copy` |
| Fill and EndStream on the wire | `empty_stream_frames_is_the_whole_study`, `end_stream_stops_a_fill_on_the_wire` |

Mutate every new test (`CLAUDE.md`).

## Re-running the gates

```bash
lab/scripts/read_path_ab.sh <base-commit>   # every capability cell must tie
lab/scripts/server_ab.sh <base-commit>      # cold depth 4 is the claim; fill and depth 2 tie
```

A sandbox number is a direction, not a magnitude. [`NEXT.md`](NEXT.md).
