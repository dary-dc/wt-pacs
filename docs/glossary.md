# Glossary

One concept, one name, defined here once; the rule is in [`CLAUDE.md`](../CLAUDE.md) §Names. A term a standard
already defines (DICOM, AV1, JPEG 2000, QUIC, WebTransport) keeps the standard's meaning and is not repeated here.

## The product

| name | is |
| --- | --- |
| series | what one server process serves: one series' frames in display order, from one series bundle |
| series bundle | the store's file (`.sbnd`, magic `SBND`): header, frame table, metadata JSON, the coded frames ([`FIXTURES.md`](FIXTURES.md) §SBND series bundle) |
| frame | one image of a series, addressed by its display index |
| coded frame | one frame's coded data as stored and sent, whatever the codec; an HTJ2K codestream, or an AV1 payload |
| AV1 payload | one DICOM frame's AV1 data: a 16-byte header and its temporal units, the top and the low stream's when split ([`av1/payload-format.md`](av1/payload-format.md)); never an "AV1 frame", which is the AV1 specification's own term |
| FoD | the control messages on the session's bidirectional stream: the client's asks, the server's refusals ([`WIRE.md`](WIRE.md) §FoD messages) |
| envelope | `[4B display_index][coded frame]`, one frame, sent behind its 4-byte length on a media stream |
| Media-complete | a frame is complete when its envelope's last byte arrives; no acknowledgement message ([`WIRE.md`](WIRE.md)) |
| stream mode | how the server lays frames on its media streams: `shared` or `per-frame`, process-wide ([`WIRE.md`](WIRE.md) §Stream modes) |
| ask | a request for one frame, `request_frame`, served next |
| fill | frames the server pushes in index order, `stream_frames`; on the wire one contiguous **run** at a time |
| the opening ask | an ask or a fill carried in the session URL, served behind the accept |
| early SETTINGS | the server's SETTINGS in its handshake flight, at 0.5 RTT (a crate patch, `settings-in-handshake`) |
| tile | the server's read of one asked frame (`TileReader`); not a codec's tile, which is said in full ("AV1 tile", "HTJ2K tile") |
| ring | the io_uring ring a tile session builds on its first page-cache miss ([`adr/disk-access.md`](adr/disk-access.md) §1) |
| record | the downloader's state of one frame: `wire`, `queued`, `decoding` |
| generation | a request's identity, moved by `cancel`; **epoch**, a session's, moved by a resume |
| resume, recycle | a dead session replaced, owing what the records owe; a live one replaced before a byte budget |
| transport file | `dev-transport.json`, served at `/wt/`: the server's `wt_url` and the `cert_sha256` it pins, rewritten at each start; the consumer's `transportFile` ([`ARCHITECTURE.md`](ARCHITECTURE.md) §An open page follows a server restart) |
| decoder | a worker that decodes; **codec module**, the code it loads per codec (`htj2k.js`, `av1.js`) |
| group | G frames from a keyframe, decoded in order on one decoder; **unit**, one AV1 temporal unit |
| split | a sample as a top stream (v ≫ k) and a low one (v & (2^k − 1)), each coded losslessly |
| RCT | JPEG 2000's reversible colour transform, applied to RGB before AV1 codes it |
| frame digest | a frame's XXH3-64 in the series' metadata, which the decoder worker checks the frame against; the frame says `exact` ([`FIXTURES.md`](FIXTURES.md) §Frame digests) |
| representation | how an AV1 payload holds its samples: **plain**, as an encoder codes them out of the box (the control), or **optimized**, split by depth and RGB through the RCT ([`av1/payload-format.md`](av1/payload-format.md)) |
| client cache | the page's frames in OPFS, decoded and checked, one file per series kept by a **store worker**; the **memory window** is the frames held in memory around the current index, within a byte budget (built, [`adr/frame-path.md`](adr/frame-path.md) §Proposed: the client cache in OPFS). Proposed 2026-10-28: the **view worker** holds the store, the controller and the paint; a **slot** is a frame-sized span of one shared buffer the store lends a decoder for one frame (§Proposed, *Who owns a frame's memory*) (§Proposed, *M5 amended*, for its **credits**) |
| preview | a lossy picture shown before its frame's exact one, and replaced by it |
| view | where the viewer holds and paints its frames: `page` (the default) or `worker`, the page's `?view=` ([`adr/frame-path.md`](adr/frame-path.md) §3, *Built*) |
| view worker | under `?view=worker`, the worker that holds the controller, the frame store and the paint module; the page sends it intents and hears events, never a frame |
| controller | the view's current frame, what it wants and in what order, and its paint (`client/view/controller.js`) |
| frame store | the frames held, by index: has, get, put, a memory window; under `worker`, where a frame comes from: it sends the downloader the misses of each want (`client/view/store.js`) |
| cache | under `worker`, a series' decoded frames in OPFS behind the frame store, each checked against its frame digest when read back; its **cache writer** (`?writer=`, a lab lever; none by default, so no cache) is the **store worker** (`client/viewer/store.js`, one packed file a series), the `decoders` or the `view` worker, those two a file per frame ([`adr/frame-path.md`](adr/frame-path.md) §3, *Built*) |
| want | the frames a view wants, in its order; the misses reach the downloader as one `want` message that replaces the last, and change its order alone; natively it rides a `watch` channel ([`native/README.md`](native/README.md) §Built; [`adr/frame-path.md`](adr/frame-path.md) §3, *Built*) |
| client | an implementation of the transport (`transport-ts`, `transport-wasm`, the WebSocket one, the native one in `client/native`) |
| native cache | the native core's frames whose check was `true`, their coded bytes, a file per frame under the series and its metadata's version, re-checked on read ([`native/README.md`](native/README.md) §8.4) |
| paint thread | the thread that holds the native window's frames and paints them: `ui`, the UI thread (today's); `view`, a view thread with the store beside a downloader thread; `core`, the view's loop and the downloader's on one thread ([`native/README.md`](native/README.md) §The view-worker design, native) |
| credit | room for one decoded frame the view has not yet taken: a decoder takes one before a job, `K` in all, so a full store reaches the wire as a pause; in the browser's M5 arms, a frame dispatched and not yet acknowledged ([`adr/frame-path.md`](adr/frame-path.md) §Proposed, *M5 amended*; [`native/README.md`](native/README.md) §Built) |
| `wt-pacs/1` | the native client's ALPN: the session's streams on raw QUIC, without HTTP/3 or WebTransport ([`WIRE.md`](WIRE.md) §The raw QUIC mapping) |
| span | the frames a consumer holds that one run may cross so the misses around them stay one run; a lab setting, default 0 ([`adr/frame-path.md`](adr/frame-path.md) §Experiment 1) |
| Tap | the client's telemetry recorder, outside the product build ([`adr/telemetry-instrument-clients-from-outside.md`](adr/telemetry-instrument-clients-from-outside.md)) |

## Testing and measuring

| name | is |
| --- | --- |
| contract suite | the clauses every client of the transport is held to (`client/contract/`, [`CLIENTS.md`](CLIENTS.md) §The contract suite) |
| rig | the harness that drives one client, or the downloader, through the contract suite's clauses |
| golden payload | an AV1 payload the writer made from a synthetic source with a known checksum, kept in `client/contract/av1/payloads/` |
| cell | one configuration a lab run measures: a link, a CPU throttle, a series, a schedule |
| variant | one condition of a timed comparison, interleaved with the others in every round (`CLAUDE.md` §Measurement) |
