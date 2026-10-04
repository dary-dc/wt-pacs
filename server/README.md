# server

The WebTransport server: it reads a study bundle (`.sbnd`) once, and serves each session the frames
it asks for, as envelopes, over QUIC or over a WebSocket. This file is the map — how data moves and
which object does what. The bytes on the wire are [`docs/WIRE.md`](../docs/WIRE.md); every number
and every reason is in [`docs/adr/`](../docs/adr/README.md). Where this map and the code disagree,
the code is right and this file is corrected.

## Start-up

```
main.rs            flags → ServeConfig                         (TransportTuning is flattened in)
   │
run_server         load the TLS identity, print its SHA-256 for the client to pin
   │               FrameStore::open — once per process: the bundle's index, the RWF_NOWAIT probe
   │               bind QUIC (dual-stack, IPv4 fallback); with --websocket, TCP on the same port
   │               print the banner (wt_url=, cert_sha256=, frames=, read_fast_path=, transport=, …)
   │               Sessions { Arc<FrameStore>, read mode, stream mode, open_ask, stall }
   ├─▶ WebSocket accept loop (its own task)   one task per TCP connection
   └─▶ QUIC accept loop                       one task per session
```

## One session

Both transports end in the same place, `Sessions::serve`; they differ only in how a session opens
and in what `Link` writes to.

```
QUIC: handle_incoming                            WebSocket: websocket::session
   session request ── ?ask= read before accept      TLS + upgrade (10 s deadline) ── ?ask= read in the upgrade
   accept                                           split the socket: sink → WsWriter, stream → asks
   Link::quic: open the shared uni now,             Link::WebSocket(WsWriter)
     or one uni per frame later (--stream-mode)
   control stream: accepted now, or — when an
     opening ask is being served first — later,
     handed to the Link through a oneshot
          │                                                │
          └──────────────────────┬─────────────────────────┘
                                 ▼
Sessions::serve(pipeline, opening ask, reader)
   ask reader task:  control stream ─ read_fod_msg ─ forward ─▶ Ask ─▶ mpsc channel (ASKS_AHEAD)
                     RequestFrame → Frame · StreamFrames → Fill · EndStream · EndSession
                     a clean end of the stream stops the reader; a bad message becomes Ask::Failed
   session task:     drive → steps, the loop below; then finish; then the reader is stopped
```

## The loop: one step at a time

```
steps:  Planner::next(poll the channel) ─▶ Step
          Serve { frame, next } ─▶ pipeline.serve(frame, next) = read, then write
          Refuse { frame, reason } ─▶ pipeline.refuse ─▶ Link::refuse (FrameError to the client)
          Wait ─▶ await the next ask (none left: the session ends)
          End  ─▶ the session ends
```

The `Planner` does no I/O, so its tests are plain `Vec`s. It holds up to `ASKS_AHEAD` asks beyond the
frame being served, refuses anything out of range (the only source of refusal text), and decides what
follows the served frame: `Next::Fill { after }` while a fill runs, `Next::Tiles(names)` otherwise. An
ask that arrives during a fill ends it and is served next ([`docs/WIRE.md`](../docs/WIRE.md) §An ask
during a fill).

## One frame: read, then write

```
read   Next::Fill  ─▶ SeqReader   (built on the session's first fill frame)
                        the frame read earlier is already in hand, or read now;
                        the next frame's read is started; the kernel is asked to prefetch ahead
       Next::Tiles ─▶ TileReader  (built on the session's first tile frame)
                        the frame and the names behind it that fit get a slot each;
                        each slot: probe the page cache without waiting (RWF_NOWAIT)
                          whole frame cached ─▶ done, on this thread
                          short ─▶ the rest from the io_uring ring (built on the first miss)
                                   or, where there is no ring, from tokio's blocking pool
       both ─▶ the frame's buffer leaves as Bytes; frame_pool takes it back once it is sent
                                 │
write  Link::send_frame(frame, body) ─▶ 8-byte head + the codestream, uncopied
         Quic + shared      the session's one uni stream, frames in ask order
         Quic + per-frame   a new uni per frame, earlier asks at higher priority
         WebSocket          the head, then the body in 64 KiB binary messages
```

A failed read or write ends the session. A reader keeps the store it was built with: its ring
registered that store's file and its slots key on that store's offsets.

## How a session ends

* The client sends `EndSession`, or closes the control stream: the loop ends when it next waits.
* A write fails because the client went — it closed the session or stopped the stream: logged at
  info, `session closed by peer`. Any other failure: a WARN, `session ended`. Both print the whole
  error chain ([`docs/WIRE.md`](../docs/WIRE.md) §FoD messages).
* However it ended, `finish` runs: per-frame streams get two seconds to be acknowledged, a WebSocket
  gets its close frame. Then two log lines: `session path` (MTU, RTT, loss — QUIC only) and
  `session reads` (hits, misses, which reader, whether the ring was built), the latter when
  `ProductPipeline` is dropped, so every ending reports it.

## What runs where

| | |
| - | - |
| tokio workers | the accept loops, one task per session, one ask-reader task per session; every cached read |
| tokio's blocking pool | a fill's miss; a tile miss where there is no ring |
| the kernel's io_uring | a tile miss; its completion wakes the session task through an eventfd |
| telemetry builds only | a drain thread writing rows; a path sampler task per QUIC session |

No task ever waits on the disk: a read that is not already cached leaves the worker thread.

## The objects

| object | file | owns | what it is for |
| - | - | - | - |
| `ServeConfig` | `server/src/transport/server.rs` | the settings | everything `run_server` needs |
| `Sessions` | `server/src/transport/server.rs` | `Arc<FrameStore>`, modes | what every session is served with; `serve` runs one |
| `Ask`, `Step`, `Next` | `server/src/transport/planner.rs` | — | an ask in, a decision out, the reader it picks |
| `Planner` | `server/src/transport/planner.rs` | asks in hand, the fill | the next step, decided without I/O |
| `FramePipeline` | `server/src/transport/pipeline.rs` | — | the per-frame steps: `read`, `write`, `refuse`, `finish` |
| `ProductPipeline` | `server/src/transport/pipeline.rs` | the store, the `Link`, both readers | the steps as shipped |
| `RecordedPipeline` | `server/src/transport/pipeline.rs` | an inner pipeline, a `Tap` | telemetry builds: stamps each step, then delegates |
| `SeqReader` | `server/src/media/read_path.rs` | the store, two buffers | reads a fill |
| `TileReader` | `server/src/media/read_path.rs` | the store, the ring, the slots | reads tile asks |
| `UringReader` | `server/src/media/uring_reader.rs` | the ring, an eventfd | io_uring for misses only |
| `FrameStore` | `server/src/media/frame_store.rs` | the bundle's file and index | where a frame is; reads that never wait, and reads that may |
| frame pool | `server/src/media/frame_pool.rs` | spare buffers | a frame handed to quinn whole, its buffer reused |
| `Link`, `Media`, `ControlStream` | `server/src/transport/link.rs` | the session's streams | the one writer of frames and refusals |
| `WsWriter` | `server/src/transport/websocket.rs` | the socket's sink | the same, over TCP |
| `SlowStartRestart` | `server/src/transport/restart.rs` | a Cubic controller | after a silence, slow start again instead of halving |
| `TransportTuning` | `server/src/transport/tuning.rs` | QUIC knobs | flags → quinn's transport config |

`server/src/transport/wire.rs` reads and writes the length-prefixed FoD messages on QUIC streams, and
`server/src/transport/stream_mode.rs` is the `shared` / `per-frame` choice.

## Lab only

Off in a deployment, and documented where they are measured: `--force-pool-reads` (every read a miss),
`--hold-sessions` (a dial that never settles), `--stall-after-bytes` (a session that stops sending).
The `telemetry` feature compiles in `server/src/record/` and `RecordedPipeline`; the default build carries
none of it, and `scripts/gate.sh` checks that. One switch is for a deployment, not the lab:
`WTPACS_READ_PATH=pool` takes the tile reader off its ring
([`docs/adr/disk-access.md`](../docs/adr/disk-access.md) §Flags).
