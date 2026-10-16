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
(`common/fod`, `client/transport/ts/wire.ts`). The server refuses a length of 0 or over 4 MiB
(`MAX_FOD_LEN`) before allocating it; a message it cannot read ends the session.

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

A binary message from the client, or any message over 4 MiB, ends the session. The library
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
once (`a_failing_websocket_accept_is_retried_at_a_pace`).

One ordered byte stream gives up what QUIC's streams give: a slow or lost frame holds every frame
behind it, and a retransmit stalls everything. The contract suite reports the independent-
delivery clauses as not applicable rather than passing
([`CLIENTS.md`](CLIENTS.md#the-contract-suite)).
