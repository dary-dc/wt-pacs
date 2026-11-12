# Glossary

One concept, one name, defined here once; the rule is in [`CLAUDE.md`](../CLAUDE.md) §Names. A term a standard
already defines (DICOM, AV1, JPEG 2000, QUIC, WebTransport) keeps the standard's meaning and is not repeated here.

## The product

| name | is |
| --- | --- |
| series | one series' frames in display order, from one series bundle: what a session reads, and what one server process serves under `--series` |
| coded UID | a DICOM UID in the PCS's coding, two characters of `0-9 A-Z _ a-z ~` per three of the UID ([`ingest/contract.md`](ingest/contract.md) §The layout); under `--root` a session names its series by two, the study's and the series' ([`WIRE.md`](WIRE.md) §Naming the series) |
| series refusal | a session accepted and closed before its first frame, with a code and a reason: 1 bad name, 2 not found, 3 changed, 4 unreadable, 5 busy ([`WIRE.md`](WIRE.md) §Refusing a series); not a frame's refusal, which is a FoD message |
| series bundle | the store's file (`.sbnd`, magic `SBND`): header, frame table, metadata JSON, the coded frames ([`FIXTURES.md`](FIXTURES.md) §SBND series bundle) |
| frame | one image of a series, addressed by its display index |
| study DB | one SQLite file per study at the PACS, `study.db` beside the study's `.sbnd` files, never served (`common/study-db`) |
| metadata group | one level's attributes for one UID — exam, series, instance or private — a row of the study DB, its bytes and their XXH3-64; not a frame **group**, nor a DICOM tag group |
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
| revision | one published state of a study's store, numbered from 1 and named by its `CURRENT` file ([`ingest/design.md`](ingest/design.md) §12) |
| resume, recycle | a dead session replaced, owing what the records owe; a live one replaced before a byte budget |
| transport file | `dev-transport.json`, served at `/wt/`: the server's `wt_url` and the `cert_sha256` it pins, rewritten at each start; the consumer's `transportFile` ([`ARCHITECTURE.md`](ARCHITECTURE.md) §An open page follows a server restart) |
| decoder | a worker that decodes; **codec module**, the code it loads per codec (`htj2k.js`, `av1.js`) |
| group | G frames from a keyframe, decoded in order on one decoder; **unit**, one AV1 temporal unit |
| split | a sample as a top stream (v ≫ k) and a low one (v & (2^k − 1)), each coded losslessly |
| RCT | JPEG 2000's reversible colour transform, applied to RGB before AV1 codes it |
| PCS | the hospital-side component, another team's: receives DICOM, parses it, encodes it and sends submission packages; this repository's scope starts at the PACS ([`ingest/pacs-receive-design.md`](ingest/pacs-receive-design.md) §1) |
| submission package | the one file the PCS sends the PACS: a series (its `.sbnd` and metadata groups) or an update (metadata only); its XXH3 in its name; OAIS's SIP (ISO 14721); **package** for short, never "archive" ([`adr/pcs-transfer.md`](adr/pcs-transfer.md) §4) |
| carrier | how a submission package travels from the PCS to the PACS and how the PACS's reply comes back: an HTTPS upload, rsync, an object store ([`ingest/link.md`](ingest/link.md) §11) |
| sender | our program at the PCS that builds a series' submission package from its exam tree, keeps it in its **outbox** until the verdict accepts it (`committed` as the carrier is built; D3), and uploads it through the carrier ([`adr/pcs-transfer.md`](adr/pcs-transfer.md) §15) |
| study DB | one SQLite-format file per study at the PACS, one row per metadata group; the one source of a study's metadata, never served to a client ([`ingest/pacs-receive-design.md`](ingest/pacs-receive-design.md) §4); never "study database" or "truth" |
| study index | the database listing studies and series for list, browse and search screens, derived from the study DBs ([`adr/study-index.md`](adr/study-index.md)); never "catalog"; not `FIXTURES.md`'s study manifest |
| revision | a study's or a series' version number, raised by each change the PACS applies; never "generation", which is a request's |
| viewer metadata | everything a viewer reads about a study or series besides frames; its paint part is **display metadata**: codec, frame count, rows and columns, photometric, bits, rescale, window, order, cine rate ([`adr/viewer-metadata.md`](adr/viewer-metadata.md)); never "page document" |
| verdict | the receiver's word on a submission package, written to `status/<package>`: as the carrier is built, `committed`, or `refused` with its class, **retry** (the PCS sends it once more) or **final** (an operator's); the receiver writes `stored`/`refused`/`quarantined`; which words and where is open ([`ingest/pacs-receive-design.md`](ingest/pacs-receive-design.md) §14, D3); the carrier's own reply before it is *received* ([`ingest/link.md`](ingest/link.md) §12.2) |
| site | a hospital, as the carrier's allow list names it: the PCS certificates enrolled for it and the units it first sent ([`ingest/link.md`](ingest/link.md) §12.3) |
| frame digest | a frame's XXH3-64 in the series' metadata, which the decoder worker checks the frame against; the frame says `exact` ([`FIXTURES.md`](FIXTURES.md) §Frame digests) |
| viewer metadata | everything a viewer reads about a series; **display metadata**, its paint part: codec, frame count, rows and columns, photometric, bits, rescale, window, order, cine rate ([`ingest/metadata-draft.md`](ingest/metadata-draft.md) §2) |
| representation | how an AV1 payload holds its samples: **plain**, as an encoder codes them out of the box (the control), or **optimized**, split by depth and RGB through the RCT ([`av1/payload-format.md`](av1/payload-format.md)) |
| preview | a lossy picture shown before its frame's exact one, and replaced by it |
| client | an implementation of the transport (`transport-ts`, `transport-wasm`, the WebSocket one) |
| Tap | the client's telemetry recorder, outside the product build ([`adr/telemetry-instrument-clients-from-outside.md`](adr/telemetry-instrument-clients-from-outside.md)) |

## Ingest and the PACS

| name | is |
| --- | --- |
| PCS | the hospital-side component, another team's: it receives DICOM, parses, encodes and sends packages to the PACS |
| package | one file the PCS sends: a series, an addition or an update, as a pax tar named `<unit>.<revision>.<xxh3-64>.tar` ([`adr/pacs-receiver.md`](adr/pacs-receiver.md) §2) |
| addition | a package of a stored series' late instances, merged at the PACS into the series' one bundle ([`adr/pacs-receiver.md`](adr/pacs-receiver.md) §5) |
| group file | the parser's file of one level's attributes: exam, series, instance or private ([`ingest/contract.md`](ingest/contract.md#group-files)); never the decoder's group above |
| revision | the n of a package's (unit, revision): a unit's packages are applied in order, each the next; never *generation*, which is a request's |
| study DB | one SQLite file per study at the PACS, a table per level holding its group files, and an audit table; never served to a client |
| receiver | the PACS's program that takes a package from `incoming/` to the serving tree and writes its status ([`adr/pacs-receiver.md`](adr/pacs-receiver.md) §3) |
| status | the receiver's one-line answer for the carrier: `stored`, `refused <why>` or `quarantined <why>` |
| quarantine | where a package goes that failed twice with the same content, or conflicts with a stored revision: an operator's, never resent |

## Testing and measuring

| name | is |
| --- | --- |
| contract suite | the clauses every client of the transport is held to (`client/contract/`, [`CLIENTS.md`](CLIENTS.md) §The contract suite) |
| rig | the harness that drives one client, or the downloader, through the contract suite's clauses |
| golden payload | an AV1 payload the writer made from a synthetic source with a known checksum, kept in `client/contract/av1/payloads/` |
| cell | one configuration a lab run measures: a link, a CPU throttle, a series, a schedule |
| variant | one condition of a timed comparison, interleaved with the others in every round (`CLAUDE.md` §Measurement) |
