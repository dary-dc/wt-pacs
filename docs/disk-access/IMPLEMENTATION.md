# Implementing the read path

**Decision:** [`adr.md`](adr.md) · **Numbers:** [`EVIDENCE.md`](EVIDENCE.md) ·
**Deploy:** [`DEPLOYMENT.md`](DEPLOYMENT.md)

What ships is two readers, chosen by what the session is doing. A fill (`SeqReader`)
knows the next frame and reads it through the blocking pool. A tile ask (`TileReader`)
does not, and escalates a miss to a per-session io_uring built on the first miss. A
tile session that never misses never builds a ring. A fill session never builds one
at all.

## Why no performance toggle

`TileReader` already chooses per session, at runtime. No arm is established better than
the lazy ring in any regime under the 28.5 % / 0.8n rule. The arm a “miss-optimised”
flag would pick (`uring` — every read through the ring) is **+131 to +142 % on hits,
RESOLVED**.

What is worth a flag is a **kill switch**. `WTPACS_READ_PATH=pool` forces the pre-ring
path on tiles. `uring` is a lab lever, not a production mode. An unrecognised value
warns and uses `auto`. A fill ignores the flag: it has no ring to take.

## The trap: never route a hit through the ring

On overlayfs or tmpfs, `RWF_NOWAIT` returns 0 for every read, hit or miss. A ring keyed
only on “the inline read came up short” would then serve every warm ask through the
ring — the `uring` arm, measured worse than the pool on hits. The ring is gated on
`FrameStore::nowait_supported()`, not on the shortfall alone.

| `RWF_NOWAIT` | io_uring | Path |
| --- | --- | --- |
| honoured | available | inline hit; tiles take the ring on a miss; a fill stays on the pool |
| honoured | unavailable | inline hit, `spawn_blocking` on the miss |
| refused | either | one pooled `pread` per frame. **Never the ring** |

The third row is ~2.5× worse per frame. [`DEPLOYMENT.md`](DEPLOYMENT.md) and
`check-fastpath` exist so a deployment finds out before it ships.

## What the server reports

Default build, not behind `telemetry`.

**Startup:** `read_fast_path=preadv2` or `pooled_pread` (plus WARN).

**End of session** (`Drop`, because a session ends several ways):

```
INFO session reads hits=… misses=… miss_rate=… fill_hits=… fill_misses=… tile_hits=… tile_misses=… named=… in_flight=… ring=… fills=…
```

* A **read** is a frame. The reader returns the whole codestream; `READ_WINDOW` chunks
  the write and the hit probe (yield between windows). A miss still reads the rest of
  the frame in one hop.
* `named` / `in_flight` are the peaks across both readers. A fill reports `named=2` and
  `in_flight=1`. A tile miss at client depth 1 / 2 / 4 reports `named` 1 / 2 / 4; a hit
  reports `named=1` (upcoming stay unprobed so the send is not behind those copies).
  `in_flight` is how many of the started frames actually missed.
* `ring=false` on a tile session with misses means the ring was refused or the build
  has no `uring` feature. A fill-only session is `ring=false` because `SeqReader` has
  no ring to build.

## How a read works

The planner’s `Mode` picks the reader. Each is built on the first frame of its kind, so
a session pays for neither reader it does not use.

**Fill — `SeqReader`.** Two buffers. `next` is the frame the planner will ask for
after this one (`FILL_AHEAD = 1`). Its read is *started* by the time `read` returns,
on another task — the next frame's `RWF_NOWAIT` must not sit in front of this send.
`peak_in_flight` is 1 on a miss (the named frame with the pool). A hit ahead is not
a device read. No ring, no extra fd.

```
read(span, next):
  settle whatever the last call started
  serve span from that, or start it now
  start next on another task (spare buffer)
```

**Tiles — `TileReader`.** `slots` frames (default `TILE_SLOTS = 4`); `slots` is a
constructor argument so a campaign can sweep depth. Current first. Upcoming that fit
start only when current missed, then wait. A hit send is not queued behind `slots − 1`
whole-frame `RWF_NOWAIT` copies — those copies are the 4 ms `gap_max` the ADR rejected
as a serve path, and at depth 4 they sat in front of the first write. Unmeasured on a
shaped link; the pin is `a_hit_does_not_probe_upcoming_tiles_before_the_current_send`.
A shortfall goes to the ring on the first miss, or to the pool where the ring is refused.

```
read(span, upcoming):
  start span if not held
  if span missed: start upcoming that fit (at most slots − 1)
  wait span
```

`WTPACS_READ_PATH` is resolved once in `TileReader::new`. The loop does not branch on
it. `probe: false` skips the page-cache read, so every tile goes through the ring —
that *is* the `uring` lever.

`Ring` is not an `Option`. A kernel that refuses io_uring must not be retried on every
miss and must not fail the ask. `Off` is both “never wanted” and “refused.”

Four properties a simpler version loses:

* **A hit never touches the ring.** Tiles probe `RWF_NOWAIT` first and submit only the
  shortfall. A fill has no ring.
* **The pool path reads ahead too.** No ring means the frame goes to `spawn_blocking`
  and the `JoinHandle` is held, not awaited.
* **A buffer is never grown or reused while the kernel owns it.** Reuse waits.
  `UringReader::drop` drains in-flight reads so the kernel does not write into freed
  memory. An abandoned fill read-ahead is settled before its buffer is reused.
* **Delivery stays in ask order.** Reading *n+1* early is pipelining, not reordering.

A miss escalates **the rest of the frame**, not the rest of a 64 KiB window. Windowing
the pool read cost 2–3 device round trips per 250 kB frame.

The planner bounds `in_hand` at `ASKS_AHEAD`. The ask reader streams `RequestFrames`
instead of collecting the batch. Upcoming stops at the first `Fill` or `EndSession`.

## What does not change

* The wire bytes. The envelope test still guards them.
* `READ_WINDOW` = 64 KiB, now the write chunk only. Handing quinn owned buffers was
  worse at 16 and 32 sessions, RESOLVED.
* Bytes reaching quinn are process-private. `server/` has no mapping.
* The pool path compiles with `--no-default-features --features crypto-ring`.
  `--no-default-features` alone has no rustls provider and does not link.

Buffers are **not** registered. Registering them pins pages against `RLIMIT_MEMLOCK` at
thousands of sessions. `product` against the lab arm that registered them is a tie on
misses.

## Tests that pin the decision

| Claim | Test |
| --- | --- |
| A miss is one pooled read however wide the frame | `a_missing_frame_costs_one_round_trip_however_wide_it_is` |
| Both readers reassemble every frame | `both_readers_reassemble_every_frame` |
| A named fill frame is not read twice | `a_named_fill_frame_is_read_before_it_is_asked_for` |
| A fill holds one read at a time | `a_fill_never_holds_more_than_one_read_at_once` |
| An abandoned read-ahead is settled before reuse | `an_abandoned_read_ahead_is_awaited_before_its_buffer_is_reused` |
| Named tiles start before the current wait, on a miss | `naming_upcoming_tiles_starts_their_reads_before_the_current_one_finishes` |
| A hit does not probe upcoming before the send | `a_hit_does_not_probe_upcoming_tiles_before_the_current_send` |
| A fill does not probe the next frame before returning this one | `a_fill_does_not_probe_the_next_frame_before_returning_this_one` |
| A wide hit probe yields between windows | `a_wide_hit_probe_yields_between_windows` |
| Slot count is a constructor argument | `a_tile_reader_holds_as_many_frames_as_it_was_given_slots` |
| A hit never builds a ring | `lazy_ring_is_not_built_when_every_read_hits` |
| No ring where `RWF_NOWAIT` is refused | `lazy_ring_is_never_built_without_nowait` |
| One store per study | `sessions_share_one_store_rather_than_opening_their_own` |
| `in_hand` cannot grow with ask rate | `the_loop_holds_no_more_than_asks_ahead` |
| Upcoming stops at Fill | `upcoming_stops_at_the_first_ask_that_is_not_a_frame` |
| The write stays windowed | `a_pooled_frame_is_written_in_read_windows_not_in_one_copy` |
| Fill and EndStream on the wire | `empty_stream_frames_is_the_whole_study`, `end_stream_stops_a_fill_on_the_wire` |

Mutate every new test (`CLAUDE.md`).

## Re-running the gates

```bash
lab/scripts/read_path_ab.sh <base-commit>   # every product_fill / product_tile cell must tie
lab/scripts/server_ab.sh <base-commit>      # cold depth 4 is the claim; fill and depth 2 tie
```

The base of `read_path_ab.sh` must know `product_fill` and `product_tile`. A sandbox
number is a direction, not a magnitude. [`NEXT.md`](NEXT.md).
