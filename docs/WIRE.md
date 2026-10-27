# Wire

What a session carries, byte for byte. Over WebTransport: one bidirectional **control** stream,
which the client opens, carrying FoD messages; and the server's unidirectional **media** streams,
carrying one envelope per frame. Over a WebSocket, the same bytes (§The WebSocket mapping).

**Media-complete:** a frame is complete when its envelope's last byte arrives; there is no
acknowledgement message. The server's banner prints what a client dials: `wt_url=`,
`cert_sha256=` (the hash a browser pins through `serverCertificateHashes`), `stream_mode=`, and
`ws_url=` with `--websocket`.

The series on disk is SBND, [`FIXTURES.md`](FIXTURES.md). What each client does with these bytes is
[`CLIENTS.md`](CLIENTS.md).

## FoD messages

FoD names the control messages: the client's asks and the server's refusals. On the control stream
each message is `[4B LE len][JSON]` — little-endian, unlike the envelope — tagged by `op`
(`common/fod`, `client/transport/ts/wire.ts`). The server refuses a length of 0 or over 64 KiB
(`MAX_FOD_LEN`) before allocating it; a message it cannot read ends the session. A client's longest message
is 56 B, `stream_frames` with both ends at `u32::MAX`. *Corrected 2026-10-16:* the cap was 4 MiB.

**A goodbye is not an error.** No client sends `end_session`: a session ends with the client closing
it, stopping a stream the server is writing (`STOP_SENDING`, as dropping its receive half does), a FIN
on the control stream between messages, or a WebSocket Close. Each is a normal end, logged
`session closed by peer` at INFO, and a send it interrupts is part of it; a malformed message, a
timeout or a protocol abort is a WARN. On QUIC the peer's close is read from quinn's close reason, the
peer's application close or wtransport's local close answering its `CLOSE_WEBTRANSPORT_SESSION`, so
an HTTP/3 violation by the peer, which wtransport also answers with a local close, reads as one too.
A stream stop is a goodbye whatever its code: the WASM client also stops the stream when it cannot
decode an envelope, so a server framing bug shows on the client, as frames failed with "the media
stream ended", and not in the server's log; the client drops the decode error's own text. Over a
WebSocket the Close excuses only a failure on the socket: a read from disk that fails is a WARN even
when the client's Close, or its echo of the server's, arrives first. *Corrected 2026-10-03:* every
ordinary session used to end as a WARN, and skipped the per-frame grace below. *Corrected
2026-10-04:* a client walking away mid-fill still did, in 8 of 30 sessions — those where its
stream's stop reached the server before its close, so the write failed as stopped.

| Message | Direction | What the server does |
| --- | --- | --- |
| `{"op":"request_frame","frame":N}` | client → server | one `Command::Frame`; served with any asks already in hand named as upcoming |
| `{"op":"stream_frames","from":A,"to":B}` | client → server | a fill of `A..=B`; either end may be omitted (`from` → 0, `to` → the last frame), `{}` is the whole series. Recited until done, until `end_stream`, or until any other message arrives (§An ask during a fill) |
| `{"op":"end_stream"}` | client → server | ends a running fill at the next frame boundary; the session goes on. Without a fill, nothing |
| `{"op":"end_session"}` | client → server | ends the session |
| `{"op":"frame_error","frame_index":N,"reason":"…"}` | server → client | a refusal. Ignored if a client sends one |

**Refusals.** A frame out of range is refused with `frame index N out of range (count)`; a fill
range outside the series with one `frame_error` at `from` (0 when omitted), reason `StreamFrames
A..=B outside 0..=last`; an empty series with `series is empty`. A refusal takes no media stream.

**Depth is the client's.** The real-time path is one `request_frame` per message, and the client's
window ([`adr/client-window-depth.md`](adr/client-window-depth.md)) is how many it keeps
outstanding. An ask-reader task owns the control stream and feeds a planner, which keeps up to
`ASKS_AHEAD` (8) asks in hand and names what follows the current frame, so the tile reader can
start up to `TILE_SLOTS` (4) reads at once
([`adr/frame-framing-and-loop-shape.md`](adr/frame-framing-and-loop-shape.md) §6d). A run from
start to end without naming every index is `stream_frames`, not a large batch (§6c there).

**A group ask is G pipelined `request_frame`s.** `request_frames` left the wire on 2026-10-03
(`202644d`); the server had already turned it into one `Command::Frame` per index, so G
`request_frame`s in a row give the planner the same input, order and per-index refusals. A fill of
whole groups is `stream_frames {from: k, …}`. Not measured: with pipelined asks the first frame may
be planned before the rest are parsed, so its read-ahead can name fewer upcoming frames; the bytes
are identical.

`CancelFrames`, `generation` and `RequestPath` were removed:
[`adr/reject-server-cancel.md`](adr/reject-server-cancel.md),
[`adr/reject-server-ordering.md`](adr/reject-server-ordering.md).

## The envelope

```text
[4B BE envelope_len][4B BE display_index][coded frame …]
envelope_len = 4 + coded frame bytes
```

The coded frame is the bundle's entry as stored, whatever its codec: an HTJ2K codestream or an AV1 payload
([`av1/payload-format.md`](av1/payload-format.md)); the series' metadata names the codec, not the envelope.
Every frame is length-prefixed in every stream mode. `common/frame-envelope` is the one definition:
the server streams its `frame_head` before the codestream, clients `unwrap`, and
`the_head_is_the_envelope_length_then_the_index_big_endian` pins the bytes. A frame is
identified by its index, never by the stream it came on. Clients stop reading a stream whose
`envelope_len` is under 4 or over 64 MiB (`MAX_FRAME_LEN`, checked by the crate's `envelope_len` in the
Rust clients and the harness; `wire.ts` holds the TypeScript copy), and a series holding a larger frame
fails to open ([`FIXTURES.md`](FIXTURES.md#sbnd-series-bundle)). Clients name a frame whose stream ends
before `envelope_len` bytes ([`CLIENTS.md`](CLIENTS.md#a-truncated-frame-is-a-failure)).

## Stream modes

`series-server --stream-mode`, process-wide, never told to the client — nothing in the handshake or
the envelope says which is in force. Clients read every uni stream the server opens as a sequence
of envelopes, so both are read by the same code.

| Mode | Media streams | Priority |
| --- | --- | --- |
| `shared` (default) | one uni, opened at session start, for the whole session; frames arrive strictly in ask order | none set |
| `per-frame` | one uni per frame, finished after it; the session waits up to 2 s for outstanding finishes when it ends, however it ends | each stream ranks by ask order: an earlier ask outranks a later one, so a lost frame's retransmit goes before newer frames' data |
| `per-frame-asks-first` (lab only) | as `per-frame` | every frame asked by name ranks above every frame a fill recites, each kind in ask order: [`native/quic-compared.md`](native/quic-compared.md) §9.5 |

Why `shared` is the default, and what `per-frame` (and the retired `pool:k`, in history at `6e9c126`)
cost under loss: [`adr/stream-shape.md`](adr/stream-shape.md).

## The send path

Each frame is written as two chunks: the 8-byte head, then the whole codestream as `Bytes` over a
buffer from the server's frame pool (`server/src/media/frame_pool.rs`). quinn holds that buffer
until the peer acknowledges it and the pool gets it back, so a frame is copied once — page cache
into the buffer — and never into quinn's send buffer. The bytes are process-private; `server/`
has no memory mapping ([`adr/disk-access.md`](adr/disk-access.md)).

*Corrected 2026-09-26, in place:* this section said the codestream was written in 64 KiB
`READ_WINDOW` pieces through `write_all(&[u8])`, leaving one full-frame copy into quinn's send
buffer. That was the send path before whole frames were handed to quinn over pooled buffers; the
code today is `link.rs` `write_frame`. The copy-cost knee sweep once listed as open against
that copy (link rate against memcpy time) was never run and now has no copy to price. Over the
WebSocket the codestream is still split, every 64 KiB (§The WebSocket mapping).

## An ask during a fill

**An ask does not wait for the fill, because the fill stops.** It does not overtake a running
fill; it replaces it. While a fill runs, the planner checks for new messages between frames, and
any message in hand ends the fill — a `request_frame`, a batch, a new `stream_frames`, an
`end_stream` (which is then consumed), an `end_session`. There is no saved position: the fill does
not resume. The asked frame is served next, and a client that still wants the rest of the run asks
for it again; the downloader does so by itself. That re-ask is this shape's cost, which row 229 only
shortens; queue row 249 proposes a server that keeps the fill and moves the asked frame to its front.
Tests: `a_data_request_during_a_fill_ends_it_and_is_served_next` (`planner.rs`) and `request_frame_during_fill_switches_to_on_demand` (`server.rs`, "fill kept
reciting after the mode switch").

```
client                                   server: planner                   media stream
  │ stream_frames 0..199  ───────────────►  fill 0, 1, 2, …   ───────────►  0 1 2 … 40 41 42 43 44
  │ request_frame 120     ───────────────►  between two frames: a message
  │                                          in hand ends the fill
  │                                          serve 120 next    ───────────►  … 45 (in flight) 120
  │ stream_frames 46..199 ───────────────►  a new fill, if the client still wants the rest
```

So a fill and an ask never share the connection, and there is nothing for a stream priority to
order: the fill's stream has stopped being fed. What the ask waits behind is **what of the fill is
already in flight** — written into the send window and not yet delivered. Ask-order priority
(`per-frame`) does not shorten that: the fill frames already written were asked first,
so they outrank the ask's frame.

**What it costs.** `lab/window-harness/src/bin/ask_during_fill.rs`, browser-free, against
`series-server` in `shared` mode over a synthetic 200-frame series of 250 KB frames, measured in
the container, one client, no shaping. Each round a fresh session: start the fill, send
`request_frame` for a frame the fill has not reached, stop the clock on that frame's last byte.
Nine rounds per position, positions interleaved and their order rotated:

| ask arrives at | n | ask → last byte (ms) | frames in flight | fill frames delivered after |
| --- | ---: | ---: | ---: | ---: |
| 10 % of the fill | 9 | **2.79** [1.69 … 5.33] | 5 | 6 |
| 50 % of the fill | 9 | **3.40** [3.09 … 4.93] | 5 | 6 |
| 90 % of the fill | 9 | **2.82** [1.65 … 4.66] | 4 | 5 |

Where in the fill the ask lands makes no difference: the ask waits behind the four or five frames
in flight, about 1.1 MB, and not behind any of the fill still to come. **What the fill pays is the
rest of itself**: across all 27 rounds 3 to 8 more frames arrived after the ask, then nothing — at
10 %, 180 frames of stated intent discarded. That is a protocol cost, not a delay.

The number to carry is **"the ask waits for the send window to drain"**, not "3 ms". Loopback is
CPU-bound where a link is congestion-bound: on a link with a large bandwidth-delay product the
window holds more, and the ask waits behind more of it. Over the WebSocket the same holds with the
TCP socket buffer in place of the send window; the two are not the same size, and neither link
case is measured. Seen from the client, against the real server with a 2 MB send window:
[`CLIENTS.md`](CLIENTS.md) §The contract suite. A client's `endStream()` is a different thing
and is not measured here.

### Proposed: one queue, an ask moves its frame to the front (row 249)

*Proposed 2026-10-15 (queue row 249, the owner's idea). Nothing changes before the owner's yes.*

**The problem.** An ask and a fill compete: the ask ends the fill (above) and the client rebuilds it. Two costs
follow, each measured on its own:

* **The fill pays for the re-ask.** The wire idles from the ask until the client's new `stream_frames` arrives. Row
  229 moved the re-ask to the asked frame's envelope head, and the 10 % fill gained up to 256 ms
  ([`transport/link-conditions.md`](transport/link-conditions.md) §Re-measured, *ASKTHENFILL*). That is a measure of
  the gap, which stays.
* **The ask waits behind the fill already written to quinn**, up to the receiver's 6 MiB of credit in Chromium
  (link-conditions.md item 9): 3.1 s at 18 Mbit/s in row 211's `shared` arm
  ([`native/quic-compared.md`](native/quic-compared.md) §9.7).

The client carries the rebuild: with row 229 in, `asksInFlight` and its gate on the fill, the hold-and-release in
`ask()`, three `refill` modes, and a head callback through `requestExactFrame`.

**Candidate 1, one queue (the owner's).** The server holds what the client wants as one ordered queue. A fill
appends its run, and an ask moves its frame to the front, or puts it there if the fill did not hold it. An ask never
ends the fill, so nothing is asked again. The order stays the client's: asks before fill frames, the rule the
downloader already uses for its decoders ([`ARCHITECTURE.md`](ARCHITECTURE.md) §The downloader). So
[`adr/reject-server-ordering.md`](adr/reject-server-ordering.md), which rejected a server ordering asks by a rule of
its own, does not apply.

* **On the wire:** a `request_frame` during a fill is served next and the fill resumes behind it, skipping a frame
  already sent. `stream_frames` still replaces a fill and `end_stream` still ends one. A client that re-asks the
  remainder still works: its `stream_frames` replaces the fill with the same frames.
* **What it removes** (read from the code, not built): the client code listed above, and in the planner the end of
  the fill on a data request.
* **What it adds:** the planner keeps the fill's position across the asks it serves, and the frames served ahead of
  it. After each ask the fill's reader starts its read-ahead again; that cost is not measured.
* **Its limit:** the queue reorders only what the server still holds. Fill already written to quinn goes first, so
  on its own the ask still waits as above. Paired with `--send-window-follows-cwnd` (cwnd + M written ahead,
  link-conditions.md item 9), most of the fill stays in the queue. That lever alone, in row 211: the ask ×0.25–0.83
  of `shared` in all nine cells, the fill within `shared`'s spread in each (§9.7). In row 180 its fill was +5.0 % at
  103 Mbit/s behind 20 ms (§9.5).

**Candidate 2, asks ranked above fill at the transport** (`--stream-mode per-frame-asks-first`, lab only). Row 211:
the ask ×0.10–0.92 of `shared` (row 180: ×1.05 at 103 Mbit/s behind 360 ms), but the fill above `shared`'s spread at
103/360 (+11 %) and 18/800, and +2–44 % under a 6 MiB send window (§9.5, §9.7). It keeps the end of the fill on an ask, so the re-ask and its client
code stay.

**Candidate 3, today with row 229's head re-issue.** The baseline.

**What decides** (a protocol for a separate session; the rule is fixed before the data):

* **Arms:** 3; 3 again (the A/A arm); 1; 1 with `--send-window-follows-cwnd`; 3 with `--send-window-follows-cwnd`,
  which separates the window's share from the queue's.
* **Cells:** row 229's (18 and 103 Mbit/s, 46 and 92 ms, FIFO 20 and CoDel, 18 Mbit/s at 300 ms), and row 211's
  deep FIFOs; the ask at 10 % and at 50 % of the fill.
* **Measured:** ask → last byte and the fill's issue → last frame, every frame exact by SHA-256; rounds
  Williams-ordered.
* **Rule:** the better of the two arms of candidate 1 becomes the default if neither its asks nor its fills are worse
  than 3's beyond the A/A spread in any cell. A tie adopts it, because it removes code. Worse in any cell makes it a
  trade-off for the owner, with those cells as its cost.

*Measured 2026-10-16 (row 253): a trade-off for the owner*, its numbers and the designs after it in §Proposed: an ask
during a fill, from its use cases.

## Proposed: an ask during a fill, from its use cases

*Proposed 2026-10-20, a design review. Nothing changes before the owner's choices. Corrected 2026-10-22: its
measurement has run (ASKSTREAM, §The measurement below); QW and QS exist as lab levers only.
It builds on §Proposed: one queue above, its measurement (row 253) and the two candidates still open, #96 and #39
([`handoff/review-2026-10-16.md`](https://github.com/dary-dc/wt-pacs/blob/claude/project-thread-9uugfm/handoff/review-2026-10-16.md)
rows C1, C2: "no winner yet; design first"). (D) marks a number derived here, not measured.*

### Why it was parked, and what decides it

The fill and the ask were each tuned alone: the fill for its time to all frames, the ask for one frame on an idle
session. An ask *during* a fill was left at "the ask ends the fill and the client re-asks the rest" (§An ask during a
fill). Two things set its wait, and only one of them is the planner's:

```
ask → last byte  ≈  RTT  +  (B + F) ÷ R          F the asked frame, R the link's rate,
                                                 B the fill's bytes already handed to quinn
 server                                quinn (send buffer)                       link
 planner ── fill 41 42 43 44 45 ──►  [ 41 42 43 44 45 … up to 6 MiB ]  ──►  in flight: one cwnd
         └─ ask 120 ─────────────►   written behind all of it, on the same stream
```

* **The planner** decides what happens to the fill: ended today, kept by the one queue.
* **The transport** decides B. On the shared stream B is Chromium's 6 MiB stream credit once the fill has run a
  little ([`transport/link-conditions.md`](transport/link-conditions.md) §Verdicts, item 9): **6 MiB ÷ R is 2.8 s at
  18 Mbit/s, 0.49 s at 103** (item 9, D), and 16.8 s at the ~3 Mbit/s a 1 % loss leaves Cubic (D, the rate from
  [`native/quic-compared.md`](native/quic-compared.md) §9.5).

**Measured, the fact that decides most of this:** B is the whole story. Row 253 (below) put today's ask at
2 569–3 655 ms at 18 Mbit/s and 437–539 ms at 103 — item 9's arithmetic — and the one queue alone (Q) moved it
×0.988–1.267: nothing, or worse. Every gain came from shrinking B.

### The use cases

A reader asks for a frame the fill has not delivered. Frequencies are **not measured**: the repo has no usage data,
so each row names what would set it. The latency the reader tolerates is **not measured** either; the common
interaction rule of thumb (0.1 s feels immediate, 1 s keeps the flow) is outside knowledge, not the repo's. Below
the design's reach is the floor RTT + F ÷ R: a 0.57 MB DBT slice is ~0.3 s at 18 Mbit/s and 46 ms, ~0.09 s at 103,
~1.5 s under 1 % loss (D).

| use case | who asks, and why | asks | what it needs | today |
| --- | --- | --- | --- | --- |
| **U1 scroll ahead of the fill** | DBT slices are "scrolled like cine" ([`av1/series.md`](av1/series.md) §1d); the viewer asks every step whose frame is missing (`client/viewer/viewer.js` `show`) | one per step. The fill delivers R ÷ S slices a second: 3.9 at 18 Mbit/s, 22 at 103 for `dbt10_ea1141`'s 0.57 MB (D), so a wheel outruns it on a slow link: **the common case there, not the rare one** (D) | the cursor's frame within the budget; the fill not slowed | every ask ends the fill and re-asks it; N steps, N restarts (**not measured** past one ask) |
| **U2 jump to a slice** | a click on the scroll bar, Home/End, a finding's slice | one, a few per series | that frame | row 253's shape: 2.6–3.7 s at 18 Mbit/s |
| **U3 a zoom into a tiled frame** | series over 12 bits get the fit plus tiles (decided); a zoom is a `request_frame` per tile in view during the fitted fill ([`adr/resolution-fitting-for-large-frames.md`](adr/resolution-fitting-for-large-frames.md) §8.4) | k at once | all k soon | the first ends the fill, the rest queue, then the re-ask |
| **U4 a frame lost with its decoder** | the downloader re-asks it (ARCHITECTURE.md §The downloader) | one, rare | correctness, no deadline | ends the fill like any ask |
| **U5 a second series, a comparison** | a prior, the other view | another series | its first frame soon | **not an ask during a fill**: one process serves one series ([`glossary.md`](glossary.md)), so it is a second session competing at the bottleneck (§9.4, *several connections*). Out of this design until a session carries several series |

U1 and U2 drive the choice; U3 adds bursts; U4 only needs the fill not to be lost; U5 is named, not designed.

### The levers

| lever | values | what decides it |
| --- | --- | --- |
| **L1 the fill on an ask** (planner) | ended, the client re-asks (today) · kept, the ask goes first (one queue) | code (the re-ask is the client's: `refill`, `asksInFlight`, `onHead`) and U1's N restarts; row 253: ask a tie |
| **L2 the bytes ahead of an ask** (transport) | the stream credit, 6 MiB (today) · send window = cwnd + M, M two of the largest frames (`--send-window-follows-cwnd`) · only what is in flight: the ask on a stream ranked above the fill | R, loss and frame size S: B ÷ R is the ask's wait |
| **L3 the client's re-ask** | `head` (default, row 229) · `ask` · `landed` | exists only while L1 ends the fill |
| **L4 what a scroll ahead asks** (client) | every step (today) · the cursor's frame only · the fill re-aimed at the cursor (`stream_frames` from it) | scroll rate against R ÷ S. Server-side ordering stays rejected ([`adr/reject-server-ordering.md`](adr/reject-server-ordering.md)) |

**Frame size changes L2's middle value.** M is two of the series' largest frames, so for a mammogram, ~4.8 MB a frame
(#96's open question 2, not measured), the window is ~9.6 MB, above the 6 MiB credit: it never binds and gives
nothing (D). Whole uncropped DBT slices (`dbts_b1`, 50 × 2560×3328) sit between; their coded size is not quoted here.

### The numbers the repo has

| row | arms | the ask | the fill | source |
| --- | --- | --- | --- | --- |
| 229 | head re-ask (B) vs today | a tie everywhere | at 10 %: −28 to −256 ms; idle wire after the ask 53–141 ms → 4–79 ms | link-conditions.md §Re-measured, row 229 |
| 253 | Q one queue; QW one queue + window; TW today + window; vs today T | Q ×0.988–1.267, worse in four 10 % cells (+24 to +684 ms, unexplained); **QW ×0.320–0.900, better in 25 of 28 cells**; TW within ±0.04 of QW | Q better in four 103 cells; **QW +45 ms (strict +54) at 103/92 FIFO 20 at 50 %, +14 ms at 103/46 CoDel at 50 % round-paired only**; TW +13 to +108 ms in six 103 cells | branch `claude/wip-253-ONEQUEUEMEASURE` at `144a2f29`, link-conditions.md §Re-measured, row 253 (#92, closed into #96) |
| 180 | shared, window, per-frame, asks first (uncapped) | 18/46 FIFO 20: 3 118 · 1 025 · 3 115 · **314** ms; 1 % loss at 18: 20 954 · 5 315 · 21 353 · **1 792** ms | asks first within shared's spread in every 20 ms and loss cell; +0.1 to +2.5 % behind deep FIFOs | quic-compared.md §9.5 |
| 211 | asks first + 6 MiB (#39) | ×0.18–0.31 of shared behind 20 ms and under loss | **+2 to +44 % in all nine cells**, +40–44 % under 1 % loss; 13 724 packets against 9 713–9 840; the 6 MiB window costs shared nothing | quic-compared.md §9.7 |

All four: one container, server, relay and Chromium 141 on one host, which **saturates between 103 and 200 Mbit/s**;
nothing past 103 is claimed. None ran on a phone. Row 253 ran no loss cell and no large frame.

### The designs

**A. Today plus the window** (row 253's TW). The fill still ends, the client still re-asks; the send window follows
cwnd. Server: a flag made default. Client: unchanged, the re-ask stays. Measured: QW's ask, a fill cost in six cells.
Large frames: the window does not bind (above). It keeps the code row 249 set out to remove.

**B. One queue plus the window** (#96, QW). The ask goes first, the fill resumes behind it skipping what an ask
served; the window follows cwnd.

```
 planner ── 41 42 [ask 120] 43 44 … ──►  quinn [ 41 42 120 … ≤ cwnd + M ]  ──►  link
```

Server +58 −37, client +37 −84, wire: a `request_frame` no longer ends a fill (#96's body). U1 and U3 cost no
restarts. Measured: the table's QW row. Costs: the one fill cell, nothing under loss or with large frames measured,
and `--send-window-bytes` no longer bounding memory (#96's question 1). Switching back: the planner's old branch.

**C. Asks first on per-frame streams under 6 MiB** (#39). Measured to cost the fill +2 to +44 %, most under loss, the
regime the product lives in; the direction counts the fill. **Not to pursue** unless row 211's extra packets are
explained (§9.7, *Further rows*). Its result is what D builds on: the ask gain is the priority's, the fill cost is
in per-frame streams.

**D. One queue plus an ask stream** (new; measured as QS, ASKSTREAM below). The fill keeps the shared stream; the session opens a second
uni stream that carries only asks, ranked above it (`set_priority`, as `per-frame-asks-first` does). quinn builds
packets from the higher-ranked stream first, so an ask jumps every fill byte not yet sent:

```
 planner ── fill 41 42 43 … ──►  fill stream  [ 41 42 43 … ≤ 6 MiB credit ] ─┐
         └─ ask 120 ─────────►  ask stream   [ 120 ]  ranked above ──────────┴─►  link: in flight ≤ one cwnd
```

* **Bytes ahead:** what is in flight, about a cwnd: ~0.15 MB, 66 ms, at 18 Mbit/s behind 46 + 20 ms (D), plus, with
  today's one writer, the rest of the fill frame being written when the ask arrives, up to S ÷ R (0.25 s for a DBT
  slice at 18, 2.1 s for a 4.8 MB mammogram; D). A second writer task removes that term, at more code.
* **The fill:** it keeps the stream credit as its cap, so the controller sees what it sees today, and two streams
  are not the many that row 211 found sending more, smaller packets. Both predicted, not measured.
* **Under loss:** a lost fill packet no longer holds the ask, which is on another stream.
* **Costs:** server, B's planner plus a second `open_uni` and a priority in `link.rs`, which already receives `ask`
  per frame. Client: B's, and no new read (clients read every uni stream as envelopes, §Stream modes). Wire: B's. A
  `--stream-mode` value, so switchable by configuration. The WebSocket keeps one ordered stream: there D is B
  without the window, and the TCP buffer stays ahead of every ask in every design.

**What decides across the band** (D, from the table and the formula):

* **Fast link, short queue, small frames** (103 Mbit/s, 0.57 MB): B ÷ R is under 0.5 s in every design; B is measured
  and ready, D adds a stream for little.
* **Slow or lossy link** (18 Mbit/s, 1 % loss): B ÷ R dominates. The window leaves M ÷ R, 0.5 s at 18 and ~3 s at
  3 Mbit/s for DBT (D); only an ask stream leaves just the flight. D's case.
* **Large frames:** the window does not bind, so B ≈ A ≈ today; D keeps its gain, less the S ÷ R term.
* **Deep FIFOs:** cwnd fills the queue; all designs tie on the ask (rows 180, 253); C loses the fill, D predicted not.

### The measurement that would settle it (pre-registered 2026-10-20 at `68232c9`, run 2026-10-22)

* **Arms:** T (today, `refill: head`); T′ (T again, the A/A arm); QW (#96's build); QS (D on B's planner, one writer).
* **Cells:** row 253's (18 and 103 Mbit/s × 46 and 92 ms × FIFO 20 and CoDel, the ask at 10 % and 50 %; FIFO 360 and
  800 at 103/46, 50 %); 1 % loss at 18 and 103 (row 180's); `dbts_b1` at 18 and 103 behind FIFO 20.
* **Shapes:** U2, one ask for the largest unreached frame, in every cell; U1, eight asks for consecutive unreached
  frames 100 ms apart, and U3, four asks at once, at 18/46 FIFO 20, 103/46 FIFO 20 and 18 with 1 % loss.
* **Measured:** each ask → its last byte; the fill's issue → its last frame; packets sent; server RSS; every frame
  SHA-256-exact. ≥ 10 Williams-ordered rounds, read strict and round-paired by `lab/scripts/aa_rule.py`.
* **Rule, fixed before the data:** QS is the candidate over QW if its asks are better than QW's beyond the A/A spread
  in the loss or `dbts_b1` cells and no cell's ask or fill is worse than QW's; a tie keeps QW, which is built. The
  candidate becomes the default if neither its asks nor its fills are worse than T's beyond the A/A spread in any
  cell; a worse fill in any cell makes it a trade-off for the owner, those cells its cost (row 249's rule).
* **Predictions:** (1) QS's U2 ask at 18/46 FIFO 20 within ±30 % of row 180's asks first (314 ms), and ≤ ×0.35 of T
  under 1 % loss; (2) QS's fill within T's spread in every cell, deep FIFOs included; (3) QS's packets within 2 % of
  T's; (4) QW's ask within T's spread in the `dbts_b1` cells, QS's ≤ ×0.5 of T's there; (5) under U1, T's fill longer
  than QW's and QS's by at least one RTT per ask. A failed (4) by about S ÷ R names the one writer as the cause.
* **Its check:** QS with the ask stream at the fill's rank brings its ask back within T's spread.
* **Its limits:** the container rig, Chromium only, one session; nothing past 103 Mbit/s; a phone is not covered.

**Measured (ASKSTREAM, 2026-10-22): the readings disagree, so by the rule nothing is decided; round-paired, QW stays
the candidate, a trade-off; D (QS) loses to QW on the ask everywhere but `dbts_b1`.** The arms, cells, shapes and rule
above, unchanged since `68232c9`; run by [`lab/ask-ahead/askstream.sh`](../lab/ask-ahead/askstream.sh) (committed
before any timing, `4087e2d`), read by `askstream.py`. QW is `--fill-resumes-after-asks --send-window-follows-cwnd`,
QS `--fill-resumes-after-asks --ask-stream-priority 1`, both with the client's `?refill=none`, T and T′
`?refill=head`; the two server flags exist only under `lab-levers` (server/README.md §Lab only). Readings fixed with
the run, before the data: U2 asks for the last frame (every frame is within 6 % of the largest; the last is the one no
arm has written at the ask), every shape asks at 50 %, U1's ask is the median of its asks and a step whose frame has
landed is not asked (the viewer's rule), U3's the last of its four to land; QS ÷ QW is read against T′/T; the check
arm QS0 (`--ask-stream-priority 0`) ran at 18/46 FIFO 20, its loss cell and `dbts_b1` at 18. One frozen release build;
Chromium 141.0.7390.37; relay under `chrt -f 50`; **10 Williams rounds, 1 150 runs, every frame SHA-256-exact, none
failed**. The host restarted in round 1: its 11 runs before the restart set aside, round 1 rerun from its start on the
same binary. **375 runs `VOID`** (7 in round 0, rising to 62 in round 9): the strict reading kept 1–7 rounds a cell and
is *undecided* in every cell but `dbts_b1` at 103, so **the two readings disagree and the rule decides nothing**.
**The relay's ceiling**, fills with no ask at 2 ms: 17.7 Mbit/s at 18, 100.0–101.0 at 103, 170–196 at 200 with 5 of
6 visits `VOID`: **the host saturates between 103 and 200 Mbit/s**; nothing is claimed past 103. Rows
`rows-askstream.jsonl`, `rows-askstream-ceiling.jsonl`.

  | round-paired, × T | ask: T ms | QW | QS | QS ÷ QW | fill: T ms | QW | QS |
  |---|---|---|---|---|---|---|---|
  | 18/46 FIFO 20 @10 % | 2 637 | ×0.405 ↓ | ×0.387 ↓ | ×0.938 ↓ | 6 494 | ×0.997 | ×1.001 |
  | 18/46 FIFO 20 @50 % | 3 118 | ×0.328 ↓ | ×0.481 ↓ | ×1.464 **↑** | 6 485 | ×0.997 | ×0.996 |
  | 18/46 CoDel @10 % | 2 658 | ×0.395 ↓ | ×0.375 ↓ | ×0.957 | 6 810 | ×0.999 | ×1.006 |
  | 18/46 CoDel @50 % | 3 480 | ×0.361 ↓ | ×0.521 ↓ | ×1.421 **↑** | 6 824 | ×1.002 | ×1.001 |
  | 18/92 FIFO 20 @10 % | 2 804 | ×0.426 ↓ | ×0.408 ↓ | ×0.972 | 6 877 | ×1.003 | ×0.996 |
  | 18/92 FIFO 20 @50 % | 3 097 | ×0.332 ↓ | ×0.496 ↓ | ×1.500 **↑** | 6 852 | ×0.995 | ×0.998 |
  | 18/92 CoDel @10 % | 2 876 | ×0.319 ↓ | ×0.323 ↓ | ×1.005 ? | 7 344 | ×0.996 | ×0.999 |
  | 18/92 CoDel @50 % | 3 461 | ×0.348 ↓ | ×0.508 ↓ | ×1.443 **↑** | 7 322 | ×0.997 | ×1.003 |
  | 103/46 FIFO 20 @10 % | 448 | ×0.739 ↓ | ×0.662 ↓ | ×0.947 | 1 399 | ×0.993 | ×0.999 |
  | 103/46 FIFO 20 @50 % | 537 | ×0.415 ↓ | ×0.557 ↓ | ×1.341 **↑** | 1 387 | ×1.004 | ×1.004 |
  | 103/46 CoDel @10 % | 482 | ×0.733 ↓ | ×0.977 | ×1.338 **↑** | 1 452 | ×0.963 ↓ | ×0.958 ↓ |
  | 103/46 CoDel @50 % | 468 | ×0.608 ↓ | ×0.519 ↓ | ×0.852 | 1 390 | ×1.010 | ×1.003 |
  | 103/92 FIFO 20 @10 % | 489 | ×0.881 | ×1.215 | ×1.383 **↑** | 1 949 | ×0.987 | ×0.961 ↓ |
  | 103/92 FIFO 20 @50 % | 451 | ×0.578 ↓ | ×0.486 ↓ | ×0.849 ? | 1 883 | ×1.018 | ×0.993 |
  | 103/92 CoDel @10 % | 538 | ×0.909 ? | ×1.132 ? | ×1.237 ? | 2 028 | ×0.957 ↓ | ×0.922 ↓ |
  | 103/92 CoDel @50 % | 463 | ×0.856 ↓ | ×0.512 ↓ | ×0.595 ↓ | 1 912 | ×1.016 **↑** | ×1.000 |
  | 103/46 FIFO 360 @50 % | 536 | ×1.000 | ×0.924 ↓ | ×0.923 ↓ | 1 385 | ×1.000 | ×1.001 |
  | 103/46 FIFO 800 @50 % | 534 | ×1.000 | ×0.931 ↓ | ×0.931 ↓ | 1 386 | ×1.000 | ×0.997 |
  | 18/46 FIFO 20 1 % loss @50 % | 20 692 | ×0.311 ↓ | ×0.448 ↓ | ×1.478 **↑** | 40 096 | ×1.027 | ×1.004 |
  | 103/46 FIFO 20 1 % loss @50 % | 20 486 | ×0.238 ↓ | ×0.451 ↓ | ×1.939 **↑** | 38 816 | ×0.998 | ×0.978 |
  | 18/46 FIFO 20 `dbts_b1` @50 % | 4 006 | ×0.990 | ×0.562 ↓ | ×0.566 ↓ | 49 980 | ×1.002 | ×1.002 |
  | 103/46 FIFO 20 `dbts_b1` @50 % | 669 | ×0.999 | ×0.633 ↓ | ×0.635 ↓ | 8 821 | ×1.001 | ×1.001 |
  | 18/46 FIFO 20 @50 % U1 | 1 868 | ×0.850 ↓ | ×1.121 **↑** | ×1.312 **↑** | 8 330 | ×0.781 ↓ | ×0.805 ↓ |
  | 18/46 FIFO 20 @50 % U3 | 3 881 | ×0.462 ↓ | ×0.592 ↓ | ×1.278 **↑** | 7 263 | ×0.894 ↓ | ×0.895 ↓ |
  | 103/46 FIFO 20 @50 % U1 | 142 | ×1.012 | ×0.850 ↓ | ×0.847 | 1 801 | ×0.897 ↓ | ×0.920 ↓ |
  | 103/46 FIFO 20 @50 % U3 | 680 | ×0.524 ↓ | ×0.635 ↓ | ×1.209 **↑** | 1 542 | ×0.910 ↓ | ×0.903 ↓ |
  | 18/46 FIFO 20 1 % loss @50 % U1 | 14 360 | ×0.871 ↓ | ×1.072 ? | ×1.235 **↑** | 52 504 | ×0.773 ↓ | ×0.788 ↓ |
  | 18/46 FIFO 20 1 % loss @50 % U3 | 25 923 | ×0.452 ↓ | ×0.570 ↓ | ×1.262 **↑** | 45 945 | ×0.902 ↓ | ×0.873 ↓ |

  ↓ better, **↑** worse, ? not conclusive, unmarked a tie: the round-paired reading, rounds 0–4 flagged and 5–9 the
  confirmation. The A/A spread: T′/T ×0.939–1.020, the loss the rule would catch 0.3–19.4 % (103/92 FIFO 20 at 50 %,
  where T′/T is ×0.939).

* **The rule, round-paired:** QS's asks are better than QW's in both `dbts_b1` cells (×0.57, ×0.64) but worse in 14
  others, both loss cells among them (×1.48, ×1.94), and its U1 fill at 18 (×1.04): **QW stays the candidate. QW is a
  trade-off for the owner**: every ask a tie or better than T's (×0.24–1.01), its one cost **a fill +31 ms (×1.016) at
  103/92 CoDel at 50 %**, and its ask not conclusive at 103/92 CoDel at 10 %. Row 253's two worse QW fills (103/92
  FIFO 20 and 103/46 CoDel at 50 %) are ties here (×1.018, ×1.010). Strict: undecided (above).
* **The fill's cost per arm:** QW worse in one cell (above), better in all six U1/U3 cells (×0.77–0.91, no re-ask) and
  in two 103 cells at 10 %; QS worse in none, better in the same six and three 103 cells at 10 %. Under 1 % loss both
  ties (QW ×1.027 and ×0.998, QS ×1.004 and ×0.978). Session RSS, median: T 7.9 MB, QW 4.8, QS 8.1 (`dbts_b1`: T 12.0,
  QW 12.0, QS 13.6).
* **(1) contradicted:** QS's ask at 18/46 FIFO 20 at 50 % is 1 499 ms (T 3 118, QW 1 024), not 314 ± 30 %; under 1 %
  loss ×0.448 and ×0.451 of T (9.7 and 9.5 s), not ≤ ×0.35. QW's is ×0.311 and ×0.238.
* **(2) held** round-paired (no QS fill worse than T's; deep FIFOs ties); strict undecided.
* **(3) contradicted** as written: U2 cells ×0.993–1.001 of T's packets, but U1 and U3 ×0.80–0.94, fewer: T's re-asks
  resend frames. QW ×0.989–1.001 in U2 cells.
* **(4) contradicted:** QW's ask a tie with T's in both `dbts_b1` cells (held), QS's ×0.562 and ×0.633, not ≤ ×0.5. The
  misses, 248 ms at 18 and 89 at 103, are below S ÷ R (0.92 s and 0.16 s for its 2.1 MB frames, D), so the rule's
  pointer at the one writer does not apply as stated.
* **(5) contradicted** at 103 only: T's U1 fill exceeds QW's and QS's by 1 826 and 1 625 ms at 18 (8 asks × 46 ms =
  368) and 11.8 and 11.6 s under loss, but by 186 and 143 ms at 103 against 6 asks × 46 = 276.
* **Check contradicted:** QS0, the ask stream at the fill's rank, did not bring the ask back to T's: ×0.563, ×0.556
  and ×0.805 of T. A stream of its own gains whatever its rank; the rank adds 0.08 of T's ask at 18/46 FIFO 20.
* **Not explained here:** why QS's ask at 50 % waits ~1.2 s more than the flight it was predicted to wait behind, at 10 %
  matching QW. A guess, not measured: the one writer blocks in the fill's write until the client's stream credit
  reopens, and Chromium reopens it in large steps, so the ask waits for more than the frame being written.

### What a scroll ahead asks (L4, pre-registered 2026-10-27 at `a3dc100`, run the same day)

U1's question: which of L4's three policies gives the reader the frame under the cursor soonest while the fill still
completes? Each policy is the downloader's lab flag `scroll` (`client/transport/downloader.js`); the viewer is unchanged
and asks every step whose frame is missing, as today.

* **Every step** (today, no flag): each step's ask goes to the wire.
* **The cursor's frame only** (`scroll: "cursor"`): while an ask is on the wire, a step's ask is held, a newer one
  replacing it; when the ask on the wire lands, the held one goes out if the fill has not delivered it. A step it
  replaced is left to the fill.
* **The fill re-aimed at the cursor** (`scroll: "aim"`): an ask for a frame the fill still owes sends no ask; the fill is
  re-issued from that frame (`stream_frames` from it), the earlier frames after it, unless the run on the wire was
  already aimed at or before it and reaches it. The step's waiter settles when the fill delivers the frame.

**The shape.** `dbt10_ea1141` (24 frames, 0.57 MB), once 10 % has landed: the cursor jumps to frame 14 and steps one
frame every 500, 100 or 20 ms to the last, 23; ten steps. Its readings: **stale**, the time the cursor showed another
frame than its own (each step's wait for its frame, cut at the next step; the last step's whole), the latency the rule
judges; **rest**, the last step to its frame, reported; **the fill**, its issue to its last frame on the page.

**The cells.** 18 and 103 Mbit/s at 46 ms behind FIFO 20; the step every 500 and 100 ms at 18, 100 and 20 ms at 103,
below and above the fill's R ÷ S (3.9 and 22 frames a second, above). Each on two servers: today's (`?refill=head`)
and QW's (`--fill-resumes-after-asks --send-window-follows-cwnd ?refill=none`), the candidate.

**The arms.** Per server: every step (E), the same again (Ep, the A/A arm), the cursor's frame only (C), the fill
re-aimed (F); QW's are QE, QEp, QC, QF. Williams-ordered within each cell, **10 rounds**; before them **an A/A
campaign**, E and Ep alone in the same eight cells, 7 rounds; and the relay's ceiling, fills with no ask at 2 ms, at
18, 103 and 200 Mbit/s. One frozen release build with `lab-levers`; relay under `chrt -f 50`. Run by
[`lab/ask-ahead/scrollpolicy.sh`](../lab/ask-ahead/scrollpolicy.sh), read by `scrollpolicy.py`. One smoke round (12
runs, one per arm at 18/500 and 103/20) ran before this was written, to check the rig: set aside, not read.

**Predictions** (D, from the mechanism: B, the bytes ahead of an ask, is today's 6 MiB credit, ≈ 2.8 s at 18 and
0.49 s at 103; under QW about cwnd + two frames, ≈ 0.6 s at 18 and 0.14 s at 103):

| server | policy | stale against E | the fill against E | why |
| --- | --- | --- | --- | --- |
| today's | C | a tie in every cell | a tie or better | every ask waits behind B however many are sent; fewer asks end fewer fills |
| today's | F | a tie in every cell | **worse by ≈ B ÷ R**: +2.8 s at 18, +0.49 s at 103 | the re-aimed run waits behind B too, and the client drops the old run's frames the server had written ahead (a frame no fill owes, `frame-session.ts` `deliver`), so they are sent again |
| QW's | C | a tie below R ÷ S; **better above** (≈ ×0.6 at 18/100, ≈ ×0.75 at 103/20) | a tie | the newest step's ask overtakes the rest; below R ÷ S each ask still waits ≈ B ÷ R, as E's do |
| QW's | F | **better below R ÷ S** (≈ ×0.3 at 18/500, ≈ ×0.4 at 103/100); a tie above | worse by ≈ B ÷ R: +0.6 s at 18, +0.14 s at 103 (≈ ×1.1) | once re-aimed, the fill outruns a slower cursor and no step waits; a faster one it never catches |

**The rule, fixed before the data.**

* **A cell is `VOID`** when more than 20 % of its visits are `VOID` (the relay's p99 over 1 ms, #138's rule), or when
  its A/A, the median of Ep ÷ E round-paired on stale or on the fill, falls outside ×0.90–1.10. A `VOID` cell is not
  read.
* **A policy wins a cell** when `lab/scripts/aa_rule.py` (bar 5 %) reads its stale `better` than E's and its fill not
  `worse`, every frame SHA-256-exact. Stale better with the fill worse is a trade-off for the owner, those cells its
  cost.
* **Per server and regime** (below R ÷ S: 18/500 and 103/100; above: 18/100 and 103/20) the answer is the policy that
  wins both cells, the lower stale ratio if both do, every step if neither. It is decided only where the strict reading
  (rounds a `VOID` visit touched dropped) and the round-paired one agree; a regime with a `VOID` cell, or whose readings
  disagree, is **not resolved on this host**, its round-paired reading reported as a leaning.
* **Its limits:** one 0.57 MB series, one RTT, no loss, the container rig, Chromium only, one session; nothing past
  the relay's ceiling.

**Measured (SCROLLPOLICY, 2026-10-27): on today's server, every step stays below R ÷ S and the cursor's frame only is
better above it; on QW's server not resolved on this host**, each regime having an 18 Mbit/s cell `VOID`. The arms,
cells, shape and rule above, unchanged since `a3dc100`; one frozen release build (`--features lab-levers`, built at
`627a6ca`, the server unchanged since); Chromium 153.0.8010.12, not ASKSTREAM's 141; relay under `chrt -f 50`.
Every arm's settings, as each row records them: E and Ep `transport=congestion=cubic-restart ?refill=head`, C and F
the same with `?scroll=cursor` and `?scroll=aim`; QE and QEp `transport=congestion=cubic-restart
--fill-resumes-after-asks --send-window-follows-cwnd ?refill=none`, QC and QF the same with the two `scroll` values; the
page `ASK_AT=0.1&asks=10&every=MS`, frames 14–23. Rows `rows-scrollpolicy.jsonl` (10 rounds, 320 runs),
`rows-scrollpolicy-aa.jsonl`, `rows-scrollpolicy-ceiling.jsonl`; **every frame SHA-256-exact, none failed**.

* **The A/A campaign first** (7 rounds, 112 runs): Ep ÷ E ×0.987–1.005 on stale and the fill in all eight cells, but
  27 visits `VOID`, 36–43 % in five cells. **The main campaign's** A/A ×0.996–1.006 everywhere, and 44 of 320 visits
  `VOID`: 5–15 % in six cells, **28 % (QW 18/500) and 25 % (QW 18/100)**, so those two cells are `VOID` by the rule.
* **The relay's ceiling**, fills with no ask at 2 ms: 17.7 Mbit/s at 18, 100.1–100.4 at 103, 166–193 at 200 with one
  of three visits `VOID`: **the host saturates between 103 and 200 Mbit/s**; nothing is claimed past 103.

  | round-paired, × E | stale: E ms | C | F | fill: E ms | C | F | rest: E → C · F ms |
  |---|---|---|---|---|---|---|---|
  | today's, 18, step 500 ms | 5 495 | ×0.999 ↓ (strict tie) | ×0.907 ↓ | 6 478 | ×0.998 | ×1.379 **↑** | 995 → 988 · 483 |
  | today's, 103, step 100 ms | 951 | ×1.005 | ×0.815 ↓ | 1 392 | ×1.005 | ×1.337 **↑** | 51 → 54 · 0 |
  | today's, 18, step 100 ms | 4 986 | ×0.686 ↓ | ×1.002 | 6 477 | ×1.002 | ×1.386 **↑** | 4 086 → 2 512 · 4 082 |
  | today's, 103, step 20 ms | 853 | ×0.688 ↓ | ×1.001 | 1 389 | ×1.002 | ×1.339 **↑** | 673 → 408 · 673 |
  | QW's, 18, step 500 ms `VOID` | 5 512 | ×0.996 | ×0.312 ↓ | 6 487 | ×0.995 | ×1.108 **↑** | 1 012 → 1 003 · 0 |
  | QW's, 103, step 100 ms | 1 034 | ×0.913 ↓ | ×0.515 ↓ | 1 473 | ×0.941 ↓ | ×1.170 **↑** | 134 → 46 · 0 |
  | QW's, 18, step 100 ms `VOID` | 3 356 | ×0.610 ↓ | ×1.002 | 6 457 | ×1.005 | ×1.110 **↑** | 2 456 → 1 040 · 2 380 |
  | QW's, 103, step 20 ms | 720 | ×0.748 ↓ | ×1.000 | 1 386 | ×0.998 | ×1.247 **↑** | 540 → 359 · 539 |

  ↓ better, **↑** worse, unmarked a tie, by `aa_rule.py` at bar 5 % (MDL 0.4–2.0 % round-paired). The strict reading
  kept 6–8 rounds in the clean cells and agrees with this one in each of them except C at today's 18/500 (a tie);
  in the two `VOID` cells it kept 4 and 2.
* **The rule. Today's server, below R ÷ S: every step stays**; F is a trade-off, its stale ×0.91 and ×0.82 at a fill
  +2.47 s (×1.38) and +0.47 s (×1.34); C does not win both cells. **Above R ÷ S: the cursor's frame only**, stale
  ×0.686 and ×0.688, rest 4.1 → 2.5 s and 0.67 → 0.41 s, the fill a tie; both readings agree. **QW's server: not
  resolved on this host** in either regime. Leaning, round-paired, from the cells as read: below, F (×0.31, ×0.52) at a
  fill +0.69 s and +0.25 s (×1.11, ×1.17), C a tie at 18 and better at 103; above, C (×0.61, ×0.75), the fill a tie.
* **Predictions.** Today's C, a tie: held below, **contradicted above** (×0.69 both rates). Today's F: stale a tie
  **contradicted below** (×0.91, ×0.82; the rest falls to 0.48 s and 0) and held above; its fill cost held, +2.47 s
  and +0.47 s against B ÷ R's 2.8 and 0.49. QW's C: held, ×0.61 and ×0.75 above against ≈ ×0.6 and ×0.75; below a tie
  at 18 as predicted, ×0.91 at 103 not. QW's F: held below, ×0.31 and ×0.52 against ≈ ×0.3 and ×0.4, a tie above; its
  fill cost larger than predicted, ×1.11–1.25 against ≈ ×1.1.
* **Not explained here:** why one ask for the newest step beats ten in order on today's server, where every ask was
  predicted to wait behind the 6 MiB credit alike. A guess, not measured: the head re-issue of the fill goes out on the
  first ask's head, and the second ask, sent when that frame lands, ends that refill before most of it is written.
* **What it means for the viewer** (D): the policies split by regime and no one wins both. F's gain below R ÷ S is paid
  in the fill on both servers, mostly because the client drops the frames an earlier run had written ahead; keeping
  them is the change F would need before it could win. C costs nothing measured and helps above R ÷ S on both servers.

### Questions for the owner

1. **The use cases' order:** scroll ahead (U1) first, then the jump (U2), then tiles (U3), with the comparison (U5)
   left until a session carries several series. Is that the product's order?
2. **The scroll's behaviour (L4):** while the reader scrolls past the fill, should the viewer ask every step, only the
   cursor's frame, or re-aim the fill at the cursor? Measured (SCROLLPOLICY): on today's server every step below
   R ÷ S and the cursor's frame only above it; on QW's not resolved on this host. Take the cursor's frame only (it lost
   no cell), keep F's re-aim for a client that keeps an earlier run's frames, or rerun QW's 18 Mbit/s cells on a quieter host?
3. ~~Run the measurement above~~ Run 2026-10-22 (ASKSTREAM): round-paired, B (#96, QW) beats D (QS) on the ask in
   every cell but `dbts_b1`, at one fill cost (+31 ms, 103/92 CoDel at 50 %); strict undecided. Take B at that price,
   rerun the strict reading on a quieter host, or pursue D with a second writer first?
4. **#39:** close it with its results recorded here, or keep it until row 211's extra packets are explained?
5. **The WebSocket** keeps its TCP buffer ahead of an ask in every design: accept that for the fallback?

## The opening ask

On by default; `series-server --opening-ask false` turns it off. The session URL may carry
`?ask=frame:N` or `?ask=fill:A-B`, which the server reads before accepting the session and serves
at once, behind the accept rather than behind the control stream. A malformed or out-of-range
value is ignored and the session proceeds as without it, so an opening ask is never refused (this
said until 2026-10-04 that a refusal of one waits for the control stream: that case cannot occur).
The TypeScript client sends it for
`connect(url, hash, { fill })` and arms the fill without sending `stream_frames`. Why:
[`ARCHITECTURE.md`](ARCHITECTURE.md), session open.

## The WebSocket mapping

Off by default; `series-server --websocket` also serves one WebSocket per session beside QUIC. The
frame path, the store and the planner are the QUIC path's; one process serves both.

| | QUIC | WebSocket |
| --- | --- | --- |
| port | UDP `--port` | TCP, the same number, so `https://h:p/` dials `wss://h:p/` |
| TLS | QUIC's | rustls, the same certificate, ALPN `http/1.1`, `TCP_NODELAY` |
| certificate | pinned by hash | the browser's trust store: a real certificate in deployment; a test certificate through Chromium's `--ignore-certificate-errors-spki-list` |
| FoD, both ways | the control stream, `[4B LE len][JSON]` | one text message per FoD message, the JSON alone |
| media | uni streams, one envelope per frame | binary messages whose bytes, joined, are the `shared` uni stream's: the 8-byte head, then the codestream split every 64 KiB — the grain at which a browser, which hands a message over only whole, sees a frame's bytes move |
| refusals | the control stream | a text message, through the same writer as the frames |
| stream mode | `--stream-mode` | always one ordered stream |
| opening ask | `?ask=` with `--opening-ask` | the same `?ask=` on the upgrade's URL, with the same flag: served right behind the 101 |

A binary message from the client, or any message or frame over 64 KiB (`MAX_FOD_LEN`), ends the
session; an over-long frame ends it at its header, before its payload is buffered. *Corrected 2026-10-16:* this
said 4 MiB a message, but the frame cap was tungstenite's 16 MiB default, so one unfragmented message could hold
16 MiB before it was refused. The library
answers pings. Not on this path: the QUIC knobs (`--congestion`, the windows — TCP's are the
kernel's), the per-session `session path` line, and telemetry rows. The idle-session behaviour of
[`adr/transport-idle-sessions.md`](adr/transport-idle-sessions.md) is QUIC's and does not
transfer; nothing here measures TCP's.

**A peer that vanishes ends its session.** Every accepted socket has TCP keep-alive: after 20 s
with nothing received, four probes 5 s apart. A peer that answers none, a laptop asleep or a NAT
that forgot it, fails the session's read at about 40 s, and the session ends as any failed read
does, a WARN; a live tab's kernel answers the probes, so an idle page keeps its session, as on
QUIC. A test reads the options back (`an_accepted_socket_probes_a_silent_peer`); the kernel's
expiry is not observed. A peer that vanishes while the server is writing to it is not probed: the
kernel's retransmissions end it, after `tcp_retries2` (about 15 minutes by default), not measured.
An accept that fails, as when the process is out of descriptors, is retried after 100 ms, not at
once (`a_failing_websocket_accept_is_retried_at_a_pace`). *Shown 2026-10-16, row 272:*
`prlimit --nofile=64 series-server --websocket …`, 80 TCP connections held open, then the
`WebSocket accept failed` WARNs (`Too many open files`) timestamped in one second: 10 with the
pause, 462 816–475 514 without it (before this change), 457 474–533 246 with the pause removed;
three interleaved rounds each, release builds, 4-core host.

One ordered byte stream gives up what QUIC's streams give: a slow or lost frame holds every frame
behind it, and a retransmit stalls everything. The contract suite reports the independent-
delivery clauses as not applicable rather than passing
([`CLIENTS.md`](CLIENTS.md#the-contract-suite)).
