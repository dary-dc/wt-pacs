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
| downloader | the worker that owns a series' session, every frame's record and the queue (`client/transport/downloader.js`, [`ARCHITECTURE.md`](ARCHITECTURE.md)); one per series, so a pair runs two |
| consumer | what a downloader hands its frames to, the page or the view worker; on the page side, `DownloaderClient` (`client/transport/consumer.js`, [`ARCHITECTURE.md`](ARCHITECTURE.md) §The consumer) |
| refusal | said of three things, each named in full: the server's, a FoD message ([`WIRE.md`](WIRE.md) §FoD messages); a decoder's, WebCodecs refusing a frame, which then goes to dav1d (`info.refusal`, `client/decode/av1.js`); the page's, an input it will not run on, an error that begins `refused:` |
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
| client cache | the page's frames in OPFS, decoded and checked, one file per series kept by a **store worker**; the **memory window** is the frames held in memory around the current index, within a byte budget (built, [`docs/client/evidence/cache-in-opfs.md`](client/evidence/cache-in-opfs.md) §Proposed: the client cache in OPFS). Proposed 2026-10-28: the **view worker** holds the store, the controller and the paint; a **slot** is a frame-sized span of one shared buffer the store lends a decoder for one frame (§Proposed, *Who owns a frame's memory*) (§Proposed, *M5 amended*, for its **credits**) |
| preview | a lossy picture shown before its frame's exact one, and replaced by it |
| lossy stream | the earlier name of an *optimal-quality series*' frames (below), which older docs still use; the studies use it for any lossy AV1 stream ([`../lab/av1/profiles`](../lab/av1/profiles/README.md)) |
| noise ratio | a frame's coding error over its own noise, e_N ÷ σ, both in the noise band of the 3 × 3 Laplacian ÷ 6 ([`av1/noise-ratio.md`](av1/noise-ratio.md)) |
| residual | source − the decoded lossy frame, per sample, one offset per series, coded losslessly; the lossy frame plus it is the exact frame |
| quantizer | libaom's 0–63 scale (`--cq-level`, `--min-q`, `--max-q`), mapped by the encoder to AV1's `base_q_idx`; a rung of the owner's "qualities" |
| quality profile | what a role receives by default: **exact** (every frame exact), **standard** (the optimal-quality series alone), **exact on request** (the optimal-quality series, and the asked frame exact); role-based profiles are still open ([`av1/README.md`](av1/README.md) §Open questions), and today every viewer sees optimal quality, exact on request |
| optimal quality | a series' picture meant to be visually lossless (not confirmed by readers,
[`client/evidence/which-quality-is-visually-lossless.md`](client/evidence/which-quality-is-visually-lossless.md)), the one every viewer sees, and the series that holds it (an **optimal-quality series**): lossy AV1 at a fixed quantizer Q, G frames a group, at its stored depth D when D ≤ 10, else as its depth cut; its metadata carries `lossy` and names its exact series ([`av1/payload-format.md`](av1/payload-format.md) §Optimal quality; [`client/README.md`](../client/README.md) §Optimal quality, exact on request) |
| exact series | the HTJ2K series of the same source as an optimal-quality series, served beside it; its frame *i*, checked against its frame digest, is the **exact frame** the client fetches whole and paints when a reader asks for lossless |
| depth cut | an optimal-quality form of a D > 10 series coded from 10-bit codes `min((v + 2^(D−11)) >> (D−10), 1023)`, so WebCodecs decodes it, adding a **rounding error** of at most 2^(D−11), up to 2^(D−10) − 1 at the clamp; metadata `lossy.bitsStored` ([`av1/payload-format.md`](av1/payload-format.md) §Depth cut); an **8-bit depth cut**, the same rule to 8 bits, is a candidate only ([`av1/depth-cut-8.md`](av1/depth-cut-8.md)) |
| source sample | a pixel's value as stored in the series' DICOM pixel data; the exact frame carries it unchanged |
| D | a series' stored bit depth, DICOM *Bits Stored* (0028,0101) |
| Q, G | an optimal-quality series' quantizer, libaom's (higher Q, more error), and its frames per keyframe |
| coding error | an optimal-quality value minus its source sample |
| stored form | an optimal-quality form of a D > 10 series coded at D itself, not cut: a comparison, decoded by dav1d-WASM only after WebCodecs refused it |
| pairing | an optimal-quality series naming its exact series in `exactSeries`, by the name the exact series' bundle is known by; nothing else links the two |
| demo pair | an optimal-quality series and its exact series served together, two `series-server`s (4433, 4434) and the static host (8765), as `scripts/demo-pair.sh` starts them (README §Demo) |
| source fingerprint | `sourceFingerprint`, the XXH3-64 of a source's frame digests that every series of it carries; the pairing refuses two series whose fingerprints differ ([`av1/payload-format.md`](av1/payload-format.md) §Source fingerprint) |
| route | where a frame's pixels came from: the decoder, `av1-webcodecs`, `av1-dav1d` or `htj2k` (the lab's `av1-mixed`), or the client cache, `cache` or `store`; a frame's `info.route`, the overlay's first word, the status line's `routes:` |
| quality label | top right on an optimal-quality series, what is painted, its colour beside its words (`client/viewer/screen.js` `labelOf`): `optimal` *Optimal quality*, `asking` *Optimal quality · fetching lossless…*, `lossless` *✓ Lossless*, `failed` *Lossless check failed · optimal quality shown* |
| mark | top left, a frame's check on a series without a quality label: none when exact, *NOT EXACT* and the reason, or *unchecked* (`markOf`) |
| overlay | `?overlay=1`: the painted frame's route, wire KB and decode ms, and on an optimal-quality frame its Q, G and depth |
| status line | the bar's line: the frame, the client, the view, frames received and their checks, the routes, the codec, the renderer, the fill's time (or *on demand*, `?fill=0`: no fill, every frame asked) and the last error |
| view | where the viewer holds and paints its frames: `page` (the default) or `worker`, the page's `?view=` ([`docs/client/evidence/frame-store-owner.md`](client/evidence/frame-store-owner.md) §3, *Built*) |
| view worker | under `?view=worker`, the worker that holds the controller, the frame store and the paint module; the page sends it intents and hears events, never a frame |
| cursor | the frame the viewer shows, moved by each step ([`client/evidence/what-a-scroll-ahead-asks.md`](client/evidence/what-a-scroll-ahead-asks.md)) |
| controller | the view's current frame, what it wants and in what order, and its paint (`client/view/controller.js`) |
| frame store | the frames held, by index: has, get, put, a memory window; under `worker`, where a frame comes from: it sends the downloader the misses of each want (`client/view/store.js`) |
| cache | under `worker`, a series' decoded frames in OPFS behind the frame store, each checked against its frame digest when read back; its **cache writer** (`?writer=`, a lab lever; none by default, so no cache) is the **store worker** (`client/viewer/store.js`, one packed file a series), the `decoders` or the `view` worker, those two a file per frame ([`docs/client/evidence/frame-store-owner.md`](client/evidence/frame-store-owner.md) §3, *Built*) |
| want | the frames a view wants, in its order; the misses reach the downloader as one `want` message that replaces the last, and change its order alone; natively it rides a `watch` channel ([`native/README.md`](native/README.md) §Built; [`docs/client/evidence/frame-store-owner.md`](client/evidence/frame-store-owner.md) §3, *Built*) |
| client | an implementation of the transport (`transport-ts`, `transport-wasm`, the WebSocket one, the native one in `client/native`) |
| native cache | the native core's frames whose check was `true`, their coded bytes, a file per frame under the series and its metadata's version, re-checked on read ([`native/README.md`](native/README.md) §8.4) |
| paint thread | the thread that holds the native window's frames and paints them: `ui`, the UI thread (today's); `view`, a view thread with the store beside a downloader thread; `core`, the view's loop and the downloader's on one thread ([`native/README.md`](native/README.md) §The view-worker design, native) |
| credit | room for one decoded frame the view has not yet taken: a decoder takes one before a job, `K` in all, so a full store reaches the wire as a pause; in the browser's M5 arms, a frame dispatched and not yet acknowledged ([`docs/client/evidence/frame-memory-ownership.md`](client/evidence/frame-memory-ownership.md), *M5 amended*; [`native/README.md`](native/README.md) §Built) |
| `wt-pacs/1` | the native client's ALPN: the session's streams on raw QUIC, without HTTP/3 or WebTransport ([`WIRE.md`](WIRE.md) §The raw QUIC mapping) |
| span | the frames a consumer holds that one run may cross so the misses around them stay one run; a lab setting, default 0 ([`docs/client/evidence/spanning-small-gaps-in-the-misses.md`](client/evidence/spanning-small-gaps-in-the-misses.md) §Experiment 1) |
| asking policy | what a view wants of a series: its memory window, W frames from the device's budget, ascending from the current frame; the whole series when it fits (proposed, [`adr/asking-policy.md`](adr/asking-policy.md)) |
| paint worker | under `?view=page`, the worker the page posts each frame's handle to, which paints it with WebGL2 on the transferred canvas (`client/paint/paint-worker.js`); in the view worker, the same module is its paint |
| settle | what a paint waits for before it reports, so its `drawn` stamp is when the draw executed: `fence`, a sync object polled on a 1 ms timer, or `read`, a one-pixel `readPixels`, which in Firefox ≥ 145 waits for the page's thread. A lab's setting only; the product paints unsettled, its `drawn` the draw's issue ([`../client/paint/README.md`](../client/paint/README.md) §When a paint has executed) |
| cine | the frames shown one after another at a rate; the product's is ticked by a page `setInterval` (`client/view/view.js`) |
| cine clock | what ticks cine, on the page or in the view worker; each of the lab's clocks shows the frame due at its tick (`client/view/clock.js`, [`docs/client/evidence/frame-clock-in-a-worker.md`](client/evidence/frame-clock-in-a-worker.md) §A frame clock in the view worker); natively, a timer on the paint thread (`client/native/src/clock.rs`), a frame **late** when its paint has not ended by the time the next is due |
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
| busy-UI loop | the lab's block of the UI thread: it spins for a set time on a fixed schedule, so what waits on that thread slips (`client/native/src/clock.rs`; [`native/README.md`](native/README.md) §The comparison, pre-registered, metric 4) |
| hop | one message between two threads; its **hop stamp** is its send → receive time (`client/native/src/count.rs`) |
| page hooks | what the viewer check and a lab harness do with the product's page (`lab/viewer/hooks.js`): reached only through `head.js`'s lab gate, so absent wherever `lab/` is not served |
| display level | the 8-bit code a sample gets through a window as the product paints it; a source error e shows as e · 255 ÷ (W − 1) levels in a LINEAR window of width W ([`av1/window-q.md`](av1/window-q.md)) |
