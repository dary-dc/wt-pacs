# Wire

What a session carries, byte for byte. Over WebTransport: one bidirectional **control** stream,
which the client opens, carrying FoD messages; and the server's unidirectional **media** streams,
carrying one envelope per frame. Over a WebSocket, the same bytes (§The WebSocket mapping).

**Media-complete:** a frame is complete when its envelope's last byte arrives; there is no
acknowledgement message. The server's banner prints what a client dials: `wt_url=`,
`cert_sha256=` (the hash a browser pins through `serverCertificateHashes`), `stream_mode=`, and
`ws_url=` with `--websocket`.

The study on disk is SBND, [`FIXTURES.md`](FIXTURES.md). What each client does with these bytes is
[`CLIENTS.md`](CLIENTS.md).

## FoD messages

FoD names the control messages: the client's asks and the server's refusals. On the control stream
each message is `[4B LE len][JSON]` — little-endian, unlike the envelope — tagged by `op`
(`common/fod`, `client/transport-ts/wire.ts`). The server refuses a length of 0 or over 4 MiB
(`MAX_FOD_LEN`) before allocating it; a message it cannot read ends the session.

**A goodbye is not an error.** No client sends `end_session`: a session ends with the client closing
it, stopping a stream the server is writing (`STOP_SENDING`, as dropping its receive half does), a FIN
on the control stream between messages, or a WebSocket Close. Each is a normal end, logged
`session closed by peer` at INFO, and a send it interrupts is part of it; a malformed message, a
timeout or a protocol abort is a WARN. On QUIC the peer's close is read from quinn's close reason, the
peer's application close or wtransport's local close answering its `CLOSE_WEBTRANSPORT_SESSION`, so
an HTTP/3 violation by the peer, which wtransport also answers with a local close, reads as one too.
*Corrected 2026-10-03:* every ordinary session used to end as a WARN, and skipped the per-frame
grace below. *Corrected 2026-10-04:* a client walking away mid-fill still did, in 8 of 30 sessions —
those where its stream's stop reached the server before its close, so the write failed as stopped.

| Message | Direction | What the server does |
| --- | --- | --- |
| `{"op":"request_frame","frame":N}` | client → server | one `Ask::Frame`; served with any asks already in hand named as upcoming |
| `{"op":"stream_frames","from":A,"to":B}` | client → server | a fill of `A..=B`; either end may be omitted (`from` → 0, `to` → the last frame), `{}` is the whole study. Recited until done, until `end_stream`, or until any other message arrives (§An ask during a fill) |
| `{"op":"end_stream"}` | client → server | ends a running fill at the next frame boundary; the session goes on. Without a fill, nothing |
| `{"op":"end_session"}` | client → server | ends the session |
| `{"op":"frame_error","frame_index":N,"reason":"…"}` | server → client | a refusal. Ignored if a client sends one |

**Refusals.** A frame out of range is refused with `frame index N out of range (count)`; a fill
range outside the study with one `frame_error` at `from` (0 when omitted), reason `StreamFrames
A..=B outside 0..=last`; an empty study with `study is empty`. A refusal takes no media stream.

**Depth is the client's.** The real-time path is one `request_frame` per message, and the client's
window ([`adr/client-window-depth.md`](adr/client-window-depth.md)) is how many it keeps
outstanding. An ask-reader task owns the control stream and feeds a planner, which keeps up to
`ASKS_AHEAD` (8) asks in hand and names what follows the current frame, so the tile reader can
start up to `TILE_SLOTS` (4) reads at once
([`adr/frame-framing-and-loop-shape.md`](adr/frame-framing-and-loop-shape.md) §6d). A run from
start to end without naming every index is `stream_frames`, not a large batch (§6c there).

**A group ask is G pipelined `request_frame`s.** `request_frames` left the wire on 2026-10-03
(`202644d`); the server had already turned it into one `Ask::Frame` per index, so G
`request_frame`s in a row give the planner the same input, order and per-index refusals. A fill of
whole groups is `stream_frames {from: k, …}`. Not measured: with pipelined asks the first frame may
be planned before the rest are parsed, so its read-ahead can name fewer upcoming frames; the bytes
are identical.

`CancelFrames`, `generation` and `RequestPath` were removed:
[`adr/reject-server-cancel.md`](adr/reject-server-cancel.md),
[`adr/reject-server-ordering.md`](adr/reject-server-ordering.md).

## The envelope

```text
[4B BE envelope_len][4B BE display_index][HTJ2K codestream …]
envelope_len = 4 + codestream bytes
```

Every frame is length-prefixed in every stream mode. `common/frame-envelope` is the one definition:
the server streams its `frame_head` before the codestream, clients `unwrap`, and
`the_head_is_the_envelope_length_then_the_index_big_endian` pins the bytes. A frame is
identified by its index, never by the stream it came on. Clients stop reading a stream whose
`envelope_len` is under 4 or over 64 MiB (`MAX_FRAME_LEN`, checked by the crate's `envelope_len` in the
Rust clients and the harness; `wire.ts` holds the TypeScript copy), and a study holding a larger frame
fails to open ([`FIXTURES.md`](FIXTURES.md#sbnd-study-bundle)). Clients name a frame whose stream ends
before `envelope_len` bytes ([`CLIENTS.md`](CLIENTS.md#a-truncated-frame-is-a-failure)).

## Stream modes

`exact-server --stream-mode`, process-wide, never told to the client — nothing in the handshake or
the envelope says which is in force. Clients read every uni stream the server opens as a sequence
of envelopes, so both are read by the same code.

| Mode | Media streams | Priority |
| --- | --- | --- |
| `shared` (default) | one uni, opened at session start, for the whole session; frames arrive strictly in ask order | none set |
| `per-frame` | one uni per frame, finished after it; the session waits up to 2 s for outstanding finishes when it ends, however it ends | each stream ranks by ask order: an earlier ask outranks a later one, so a lost frame's retransmit goes before newer frames' data |

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
for it again; the downloader does so by itself. Tests: `a_data_request_during_a_fill_ends_it_and_is_served_next`
(`planner.rs`) and `request_frame_during_fill_switches_to_on_demand` (`server.rs`, "fill kept
reciting after the mode switch").

So a fill and an ask never share the connection, and there is nothing for a stream priority to
order: the fill's stream has stopped being fed. What the ask waits behind is **what of the fill is
already in flight** — written into the send window and not yet delivered. Ask-order priority
(`per-frame`) does not shorten that: the fill frames already written were asked first,
so they outrank the ask's frame.

**What it costs.** `lab/window-harness/src/bin/ask_during_fill.rs`, browser-free, against
`exact-server` in `shared` mode over a synthetic 200-frame series of 250 KB frames, measured in
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
[`CLIENTS.md`](CLIENTS.md) §The conformance suite. A client's `endStream()` is a different thing
and is not measured here.

## The opening ask

On by default; `exact-server --open-ask false` turns it off. The session URL may carry
`?ask=frame:N` or `?ask=fill:A-B`, which the server reads before accepting the session and serves
at once, behind the accept rather than behind the control stream. A malformed or out-of-range
value is ignored and the session proceeds as without it, so an opening ask is never refused (this
said until 2026-10-04 that a refusal of one waits for the control stream: that case cannot occur).
The TypeScript client sends it for
`connect(url, hash, { fill })` and arms the fill without sending `stream_frames`. Why:
[`ARCHITECTURE.md`](ARCHITECTURE.md), session open.

## The WebSocket mapping

Off by default; `exact-server --websocket` also serves one WebSocket per session beside QUIC. The
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
| opening ask | `?ask=` with `--open-ask` | the same `?ask=` on the upgrade's URL, with the same flag: served right behind the 101 |

A binary message from the client, or any message over 4 MiB, ends the session. The library
answers pings. Not on this path: the QUIC knobs (`--congestion`, the windows — TCP's are the
kernel's), the per-session `session path` line, and telemetry rows. The idle-session behaviour of
[`adr/transport-idle-sessions.md`](adr/transport-idle-sessions.md) is QUIC's and does not
transfer; nothing here measures TCP's.

One ordered byte stream gives up what QUIC's streams give: a slow or lost frame holds every frame
behind it, and a retransmit stalls everything. The conformance suite reports the independent-
delivery clauses as not applicable rather than passing
([`CLIENTS.md`](CLIENTS.md#the-conformance-suite)).
