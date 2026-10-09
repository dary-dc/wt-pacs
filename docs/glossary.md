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
| decoder | a worker that decodes; **codec module**, the code it loads per codec (`htj2k.js`, `av1.js`) |
| group | G frames from a keyframe, decoded in order on one decoder; **unit**, one AV1 temporal unit |
| split | a sample as a top stream (v ≫ k) and a low one (v & (2^k − 1)), each coded losslessly |
| RCT | JPEG 2000's reversible colour transform, applied to RGB before AV1 codes it |
| preview | a lossy picture shown before its frame's exact one, and replaced by it |
| client | an implementation of the transport (`transport-ts`, `transport-wasm`, the WebSocket one) |
| Tap | the client's telemetry recorder, outside the product build ([`adr/telemetry-instrument-clients-from-outside.md`](adr/telemetry-instrument-clients-from-outside.md)) |

## Testing and measuring

| name | is |
| --- | --- |
| contract suite | the clauses every client of the transport is held to (`client/contract/`, [`CLIENTS.md`](CLIENTS.md) §The contract suite) |
| rig | the harness that drives one client, or the downloader, through the contract suite's clauses |
| golden payload | an AV1 payload the writer made from a synthetic source with a known checksum, kept in `client/contract/av1/payloads/` |
| cell | one configuration a lab run measures: a link, a CPU throttle, a series, a schedule |
| variant | one condition of a timed comparison, interleaved with the others in every round (`CLAUDE.md` §Measurement) |
