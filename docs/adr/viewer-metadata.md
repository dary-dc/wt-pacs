# ADR: how a viewer gets all the metadata it reads, and where each part lives

**Status:** proposed 2026-10-25, **theory only: nothing built, nothing timed.** Every choice is the owner's (§10).
Labels: *(M)* measured in this repository, with where; *(E)* an estimate, with its arithmetic; *(S)* a primary source
in §12; *(I)* this record's own inference. A number without a label is one of these by its sentence.

**Builds on, read-only and unmerged:** #142
([`serving-by-uid.md`](https://github.com/dary-dc/wt-pacs/blob/claude/serve-by-uid-design/docs/adr/serving-by-uid.md):
one frame server for many series by UID, `?digest=`, the refusal codes), #146
([`study-index.md`](https://github.com/dary-dc/wt-pacs/blob/claude/study-index-design/docs/adr/study-index.md): the list
fields, MySQL, the outbox, "viewing by direct link does not need the index"), #147 (`lab/sqlite-engine`: Turso cannot
share a file across processes), #150 (`lab/metadata-store` §Repetition: metadata sizes on five real series), #148
(`metadata-updates.md`: one writer, update packages). **Written independently of #145**: every section but §11 was committed
before #145's branch was opened; §11 compares the two.

## 1 · On one screen

| question | recommendation | what would change it |
| --- | --- | --- |
| **What a viewer reads** | four kinds, each needed at a different moment and corrected at a different rate (§2): **list fields**, **paint metadata**, **study fields**, **full metadata** | — |
| **List fields** | the study index (#146), as proposed there, with each series' **codec** and **frame count** | — |
| **Paint metadata** (decode, order, paint; no identifiers) | **exported per series by the receiver beside the `.sbnd`, and sent by the frame server as the session's first message**, after it checks the export names the bundle it has open | the owner refusing a wire change (→ the same file over HTTPS from the host, runner-up, §8); a requirement that a third-party viewer read it (→ a DICOMweb endpoint) |
| **Study fields** (the overlay's patient and study text) | exported per study by the receiver; sent in the same opening message | — |
| **Full metadata** (the attribute panel) | exported per series by the receiver, compressed; **sent in the session when the user opens the panel** | a third-party viewer or a DICOMweb integration (→ WADO-RS Series Metadata on the host, same file) |
| **Codec** | **also in the index and in a direct link** (`?codec=`), only to start loading the decoder module before the session exists (§3) | a page that always preloads both decoders (then the index's copy is only for marking a series the device cannot decode) |
| **Who opens a study DB at serve time** | **nobody**: only the receiver ever opens it, so the engine stays the owner's free choice (Turso or rusqlite) | the owner choosing rusqlite anyway (#147); then reading the study DB live in the frame server (option C) becomes the runner-up for tags |
| **Deciding reason** | the process that serves the frames is the one that describes them, from a file it checks against the bundle it has open: **stale metadata is never paired with frames, by construction**, with no extra request, no extra connection, no dependence on the index, and no second database reader | — |

**The owner's preference — the paint metadata as a column in the study index — ranks fifth of six (§8).** It is the
fastest path when the list was shown first and the index is near and up; it makes the index necessary for viewing,
which #146 §6 rules out for a direct link; it puts per-frame data (tens of KB a series) into a database sized for list
rows (§5); and the outbox's lag leaves an image-level correction unseen for as long as the publisher is behind (§6).

## 2 · What a viewer reads, when it needs it, and how often it changes

| kind | fields | needed | changes when | size a series | identifiers |
| --- | --- | --- | --- | --- | --- |
| **list fields** | patient name, ID, birth date, sex, study date, description, accession, modalities; per series number, modality, description, frame count, codec (#146 §4) | before any series is chosen | patient/study corrections: **the common update** | 0.1–0.2 KB (*(E)*, #146 §4) | yes |
| **paint metadata** | codec, frame count, rows, columns, channels, bits allocated/stored, high bit, signed, photometric, rescale, window (every value, function), min/max, frame time or cine rate, frame order; per frame what varies (position, window in MR, decay factor in PET); pixel spacing and orientation for measurement and markers (`FIXTURES.md` §The metadata, plus the last two) | before the first paint; the codec **before the first decode** | image-level corrections: **very rare** (owner); a new bundle | shared ≈ 0.5 KB; per frame ≈ 40–60 B as JSON, so ≈ 13 KB raw at 262 frames, ≈ 100 KB at 2 000, ≈ 3–5× smaller compressed (*(E)*: ~15 numbers a frame) | **none** (`FIXTURES.md`: "No patient or study identifier is copied") |
| **study fields** | the exam group: the overlay's name, ID, birth date, sex, study date and description, institution | with the first paint, for the overlay | patient/study corrections: common | 1.2–1.8 KB a study (*(M)*, #150, exam group) | yes |
| **full metadata** | every group of every instance: exam, series, instance, private | when the user opens the attribute panel; rarely | any update | 6.7–763 KB raw; **0.8–12.6 KB as one zstd stream** (*(M)*, #150, five de-identified series; a hospital's headers may weigh more) | yes |

Two facts decide most of what follows (*(I)*):

1. **The paint metadata carries no identifier, so the common update never touches it.** A patient or study correction
   rewrites the list fields, the study fields and the full metadata; the paint metadata changes only with an
   image-level correction or a new bundle.
2. **The frame digests are no longer metadata.** The target layout moves each frame's samples hash into the `.sbnd`
   entry ([`../disk-layout/target.md`](../disk-layout/target.md) §The two hashes), so the frame server already holds
   them with the frames they check.

## 3 · Why the codec lives apart from the rest

The codec is the one field needed **before the session exists**. Loading an AV1 decoder module after the first payload
cost **2.0 serial round trips through WebCodecs and 3.9 through dav1d-WASM**; fetched at the decoder's start it was 1.0
and 3.0 fewer, and with the page's preloads AV1 reached HTJ2K's 8.0 round trips to the first exact frame (*(M)*,
[`../../lab/page-open/README.md`](../../lab/page-open/README.md) §Cold round trips by codec, COLDRTT). Everything else in
the paint metadata is needed only at paint time, at least one round trip after the session is up, and so can arrive
with the frames.

The codec is also the one field that is safe to copy (*(I)*):

* it is a property of the coded bytes, written in the `.sbnd` header, so it changes only with a new bundle, never with
  a metadata update;
* a stale copy costs a wrong module prefetched, never a wrong picture: the decoder is chosen by the session's own
  paint metadata, the authority;
* it is 4 bytes, carries no identifier, and the list needs it anyway to mark a series this device cannot decode.

None of these holds for the rest of the paint metadata: rescale and window are clinical values a correction can
change, and the per-frame part grows with the series.

**Prefetch without the codec.** With two codecs, a page can preload both decoders while the user browses; that reached
8.0 round trips for AV1 and cost the session +27 to +41 ms, a constant, and dav1d's 238 KB of gzipped WASM (*(M)*,
COLDRTT). On a metered phone the codec in the list saves those bytes for an HTJ2K-only study. For a **direct link**, the
link's producer (the list, a report, a worklist) carries `?codec=` ([#118's hint](https://github.com/dary-dc/wt-pacs/pull/118)),
or the page falls back to preloading both.

## 4 · The options

| | where the paint metadata lives, and who serves it | full metadata |
| --- | --- | --- |
| **A** | a column (binary or JSON) per series in the study index, served by its API, in the study's series list | the index, or the host |
| **B** | a file per series, exported by the receiver beside the `.sbnd`, served over HTTPS by nginx on the host | a second file, the same way |
| **C** | the study DB, read by the frame server at session open (`spawn_blocking`), sent in the session | the study DB, read on request in the session |
| **D** | the study DB, read by a metadata API process on the host at request time | the same API (DICOMweb Retrieve Metadata) |
| **E** | A or D with a cache (Redis) beside the index | the same |
| **F** *(recommended)* | split by kind: list fields and codec in the index; paint and study fields exported per series by the receiver and **sent by the frame server as the session's first message**; full metadata exported and sent on request | an export, sent in the session |
| **G** | as F, but the exports fetched over HTTPS from the host (B's delivery with F's split) | an export over HTTPS |
| — | rejected: the paint metadata in the `.sbnd` header — a correction to window or rescale would rewrite a bundle of hundreds of MB, and the target keeps the file free of metadata ([`../disk-layout/target.md`](../disk-layout/target.md)) | — |

**Judged** (*(E)* and *(I)* throughout; the round trips are §5's model):

| | A index column | B static file, nginx | C study DB, frame server | D study DB, metadata API | E cache | **F split, in session** | G split, HTTPS |
| --- | --- | --- | --- | --- | --- | --- | --- |
| extra requests to paint, from the list with prefetch | 0 | 0 | 0 | 0 | 0 | **0** | 0 |
| extra requests to paint, direct link | 1, on a connection to the index's server | 1, on a connection to the host | 0 | 1, on a connection to the host | 1 | **0** | 1 |
| connections, direct link (page origin aside) | host + index server | host (QUIC) + host (TCP/TLS) unless HTTP/3 shares | **one** | two to the host | as A | **one** | as B |
| under loss | a second, often distant, connection's handshake and RTO | a second connection to the host | one connection | as B | as A | **one connection; the metadata on its own stream** | as B |
| viewing needs the index | **yes** | no | no | no | **yes** | no | no |
| processes opening a study DB at serve time | none (publisher only) | none | **receiver + frame server → rusqlite, not Turso** (#147) | **receiver + API → rusqlite** | as A | **none** | none |
| stale metadata paired with frames | possible while the outbox lags; `?digest=` catches a new bundle, **not** a metadata-only correction | the client pairs by `?digest=`; an HTTP cache must be revalidated or keyed | never: read at open | never, if read with the bundle's digest | as A, plus the cache's own staleness | **never: the server checks the export's digest against its open bundle** | as B |
| scaling | every series open on the central index; tens of GB of per-frame data in it (§5) | per host, from the page cache | per host; a parse per open, cacheable | per host | adds capacity to A, and a service | **per host; a file read per open** | per host |
| new code and operations | a column, the publisher's derive, an API route, migrations of every row when the format changes | the receiver's export, nginx and its authorization on every host, cache headers, the client's pairing | the frame server learns the study DB's schema and the derive | a new service per host | Redis, its invalidation | **the receiver's export; one wire message each way; the server's digest check** | as B |
| attribute panel | needs the host anyway (MB raw in a list database) | a file, with PHI behind nginx's authorization | live from the truth | live from the truth | — | **an export, behind the session's authorization** | a file, as B |
| a third-party viewer | no | partly (static DICOMweb's shape) | no | **yes** (WADO-RS) | — | no | partly |

## 5 · The user's path, in round trips

**Baseline, measured.** A cold page to its first exact frame is 8.0 round trips with the decoders preloaded, 5.9–6.0
warm; the dial is 2.1–2.5 round trips with early SETTINGS (*(M)*, COLDRTT and
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The session open). A metadata file fetched on the page's open HTTP/3
connection alongside the dial landed in no extra round trip and cost the dial +7 / +29 ms at 80 / 160 ms (*(M)*,
page-open §The order the page's files leave in, PORD, ~120 KB).

**Opened from the list, prefetch on.** Every option is off the critical path (*(E)*): the paint metadata is needed only
at paint, and the session's dial plus the first frame is ≥ 3 round trips, against 1 for a fetch on a warm connection.
A's real advantage — the metadata already in hand from the series list — buys nothing the frames do not already wait
for. F's opening message rides behind the accept, so it lands before frame 0 by construction.

**Direct link, cold.** The page has the host and the UIDs from the link (#146 §6). F needs nothing more: one connection,
the dial, the message, the frames. B, D and G add a connection to the host in parallel with the dial; A and E add one
to the index's server, possibly in another network, and fail when it is down.

**Under loss.** Residual loss on real links is mostly ≤ 0.1 %, with tails near 1 % and handover bursts of 24–50 ms
([`../transport/link-conditions.md`](../transport/link-conditions.md)). What a loss costs here is a handshake's: a lost
SYN waits the initial RTO of 1 s (RFC 6298 §2), a lost QUIC Initial a PTO from a 333 ms initial RTT (RFC 9002 §6.2.2),
about 1 s. Each added connection is another independent chance of that second (*(E)*: at 1 % loss and ~4 handshake
packets, ~4 % of opens per connection). F adds none; the paint metadata travels on the session already paying for the
frames.

**Bytes.** The same in every option for the paint metadata (≈ 3–25 KB compressed, §2); A sends it for **every series
of the study** in the series list, whether or not it is opened (*(E)*: 8 series ≈ 30–200 KB), unless the list fetches
it per series, which is then B's request to a central server.

**What A costs the index.** At ≈ 5 KB compressed per series (*(E)*, §2) and #146's ~8 series a study, 10⁶ studies are
≈ 40 GB of paint metadata, against the 2–4 GB #146 §4 sizes for the list fields, "which a small server holds in
memory". The index would no longer fit its own premise.

## 6 · Consistency after an update

**The receiver's order** (#119 §12.5, #148): the bundle renamed in, then the study DB committed, then the derived
copies, then "stored". In F the derived copies are the exports, each written `.partial` → `fsync` → `rename`, and each
**names the bundle digest and the study DB's generation it was derived from** (*(I)*: the generation is #146 §7's).

**At session open, F's frame server** opens the bundle as #142 §3–§4 does, then the series' export; if the export's
digest is not the bundle's, it reopens both once (the receiver is between its rename and its export, milliseconds);
still unequal, it refuses with #142's code 3, `series changed`. **It never sends paint metadata for frames it is not
serving.** The client needs no pairing logic and no cache-busting.

**A metadata-only image-level correction** (window, rescale) leaves the bundle and its digest unchanged, so `?digest=`
cannot catch it in any option. In F, every session opened after the receiver's rename gets the new values. A session
already open keeps the values it was sent, as it keeps its bundle (#142 §4); telling it is #148 §7's question (a
re-sent message, or revalidation), and in F it is one more server message on a session that already exists. In A the
correction reaches a viewer only once the outbox has published it: seconds normally, unbounded while the index or the
publisher is down. In B and G an HTTP cache holds the old file until revalidated.

**A crash between commit and export** leaves an export behind the study DB. The receiver re-derives at start where an
export's generation is lower than its study DB's (*(I)*: the same check as #146 §7's reconcile, on the host).

## 7 · What established systems do

| system | list-level | per-series metadata | full metadata, bulk data | consequence here *(I)* |
| --- | --- | --- | --- | --- |
| **DICOMweb**, PS3.18 | Search (QIDO-RS) | Retrieve Metadata: `/studies/{study}/series/{series}/metadata`, "all the Metadata for all individual Instances … in the Series" (§10.4.1.1.2, Table 10.4.1-2) | metadata "without Bulk Data"; bulk data by **BulkDataURI** (§10.4.1.1.5) | the standard itself splits by kind: its Note says a client wanting only study- or series-level fields "would be better served by using the Search Transaction" (§10.4.1.1.2) |
| **OHIF** | QIDO series search, sorted | one WADO-RS series metadata request **per series, deferred until consumed** (`retrieveMetadataLoaderAsync.js`); `enableStudyLazyLoad` | `bulkDataURI` resolution per series (data-source docs) | a request per opened series, after the list: the shape B, D and G have |
| **Orthanc**, DICOMweb plugin | its Index (SQL) | `SeriesMetadata`: `Full` reads "all the DICOM instances … from the storage area"; `MainDicomTags`, `Extrapolate` | since 1.15, **"caches metadata as a gzipped attachment"** (`EnableMetadataCache`) | a derived, compressed file per series, made because reading the truth per request was slow |
| **dcm4chee-arc-light** | the database's query attributes | **Series Metadata Storage**: series metadata aggregated into a zip per series after `dcmSeriesMetadataDelay` | full attributes per level also kept in the database | a derived file per series beside the database; whether WADO-RS reads it is *unconfirmed* |
| **AWS HealthImaging** | search API | `GetImageSetMetadata`: one JSON document per image set, **gzip**, **versioned** (`versionId`), a 409 while processing | frames by `GetImageFrame`, HTJ2K | one compressed document, versioned apart from the frames: F's export plus its generation |
| **Static DICOMweb** | `studies/index.json.gz`, `series/index.json.gz` | `metadata.gz` per series, served from disk or object storage | `bulkdata/`; a `deduplicated/` root for eventual consistency | precomputed per-series files: B |

**What none of them does:** deliver the paint metadata on the frames' own channel. They are HTTP request-response
systems, and AWS HealthImaging addresses frames by IDs found in the metadata, so the metadata must come first. Here
frames are addressed by index on a session the server already holds, so the server can describe what it serves
without a request (*(I)*). **What all of them do:** keep list-level fields in a query index, and serve per-series
metadata as a document derived from the truth, cached as a compressed file. None puts the per-series metadata in its
query index; dcm4chee keeps full attributes in its database, and added a per-series file beside it.

## 8 · Ranking (independent, committed before reading #145)

1. **F — split by kind; paint and study fields in the session, from the receiver's exports.** Zero requests and one
   connection on every path; consistency by the server's own check; only the receiver opens a study DB; the attribute
   panel behind the session's authorization. Costs: a wire change (one server message at open, one ask and one answer
   for the full metadata), and no HTTP cache for the paint metadata (re-sent each open, a few KB).
2. **G — the same split, the exports over HTTPS from the host.** Everything F decides except the channel. Better if the
   wire must not change, or if an HTTP cache on the phone is wanted; costs a second connection on a direct link, nginx
   and its authorization on every host, and the client's pairing by `?digest=`.
3. **C — the frame server reads the study DB at open.** No derived copy at all, always current. Costs: two processes on
   every study DB, so rusqlite (#147), and the frame server coupled to the study DB's schema and the derive.
4. **D — a metadata API on the host.** The DICOMweb-conformant shape; a new service and connection, two processes on a
   study DB. The choice when a third-party viewer must read this PACS.
5. **A — the owner's preference, a column in the index.** Fastest only where every option is already off the critical
   path; makes viewing depend on the index; ≈ 10× the index's size; the outbox's lag on corrections.
6. **E — a cache beside the index.** Fixes none of A's problems but load, which nothing yet shows.

## 9 · What this does not decide

* **The wire shape of the opening message.** The control stream is opened by the client and the opening ask's frames go
  out "behind the accept" ([`../WIRE.md`](../WIRE.md) §The opening ask), so the server's message needs a server-opened
  stream or a reserved first item on the media stream; and it may exceed `MAX_FOD_LEN`'s 64 KiB at thousands of
  frames. A WIRE design, reviewed before built.
* **The export's format** (JSON or binary, which compressor) and the derive's rules (functional groups over shared,
  `FIXTURES.md` §The metadata): one library, run by the receiver.
* **Presentation states, key images, structured reports**: separate instances with their own pixels or none; not
  designed here.
* **Overlays, ICC profiles, LUT data**: bulk data in DICOMweb's sense, inside the full metadata or beside it; not
  designed here.
* **Who may open a series** (#142 §9 item 6): F inherits whatever the session decides.

## 10 · Questions only the owner can answer

Each with the default this record assumes.

1. **May the session carry metadata** (a wire change)? Default: yes, F. If no: G.
2. **Must a third-party viewer read this PACS** (DICOMweb)? Default: not now (#146 §9); D's endpoint added on the host
   when one must.
3. **Do viewers always start from the list?** Default: no; direct links from reports and worklists are a first-class
   path, so viewing must not depend on the index.
4. **May paint metadata be kept on the phone** between visits? Default: yes, it holds no identifier; the study fields
   and full metadata no (`no-store`, as #146 §8).
5. **Preload both decoders on every page, or only the listed codec?** Default: the listed codec from the list; both on a
   direct link without `?codec=`.
6. **Is an open session told of an image-level correction?** Default: yes, by a re-sent opening message (#148 §7's
   question).

## 11 · Comparison with #145

*Added after every other section was committed.*

## 12 · Measurement protocol (pre-registered, not run)

**Claim under test:** F's opening message costs the first exact frame nothing measurable against B's parallel HTTPS
fetch, at every delay and loss cell, and saves a connection's loss exposure on a direct link.

* **Arms, interleaved in every round, order rotated** ([`../../CLAUDE.md`](../../CLAUDE.md) §Measurement):
  (i) F: paint metadata as the session's first message; (i′) F again, the A/A arm; (ii) B on the page's own origin and
  connection; (iii) B from a second origin (the host), a new connection; (iv) A from a third origin (the index),
  already connected (the list path) and cold (the direct link).
* **Cells.** `lab/page-open`'s harness through `lab/scripts/link_impair.py`; round trips 40, 100, 200 ms; loss 0, 1 and
  3 %; paint metadata of 1, 10 and 50 KB compressed; a first frame of one flight (64 × 48) and CT-sized (~150 KB
  HTJ2K); cold and warm profile; ≥ 12 rounds a cell.
* **Metric: latency only** — navigation to the first painted exact frame, p50 and p95, and the slope against the round
  trip. The host's saturation point (a core, the relay's rate) stated; nothing claimed past it.
* **Server side.** `--root` session open with and without the export read, CONNECT to the opening message's last byte,
  A/A spread as noise (#142 §8's protocol, one arm more).
* **Correctness, mutated.** An export whose digest is not the open bundle's is never sent (break: skip the check → the
  test fails); a rename race between bundle and export ends in the new pair or code 3, never a mixed pair; a crash
  between commit and export is re-derived at start.
* **Decision rule, fixed now.** F stands if its p95 is within the A/A spread of the best other arm in every lossless cell
  and no worse than (iii) in every lossy cell. If (ii) beats F beyond the A/A spread in any cell, the opening message
  is moved off the frames' stream before G is reconsidered.

## 13 · Sources

| claim | source |
| --- | --- |
| Metadata resources, "all the Metadata for all individual Instances", the Note on Search for study/series level, "without Bulk Data" | DICOM PS3.18 (current, fetched 2026-10-25) §10.4.1.1.2, Table 10.4.1-2 |
| Bulk Data resources and the Bulk Data URI | PS3.18 §10.4.1.1.5, §10.4.1.1.5.1, Table 10.4.1.5-1 |
| OHIF's per-series deferred metadata requests | OHIF Viewers, `extensions/default/src/DicomWebDataSource/wado/retrieveMetadataLoaderAsync.js` (master, 2026-10-25); docs.ohif.org, Configuration › Data sources › DICOMweb (`enableStudyLazyLoad`, `bulkDataURI`) |
| `StudiesMetadata`/`SeriesMetadata` modes; `Full` reads the storage area; `EnableMetadataCache` since 1.15 | Orthanc Book, "DICOMweb plugin", §Options and §Fine-tuning server for WADO-RS Retrieve Metadata |
| Series Metadata Storage, `dcmSeriesMetadataDelay` | dcm4chee-arc-light wiki, "Query Retrieve with Series Metadata"; dcm4chee-arc-cs, Archive Device configuration |
| `GetImageSetMetadata`: gzip JSON, `versionId`, 409 while processing | AWS HealthImaging Developer Guide, "Getting image set metadata" |
| Static DICOMweb's file layout | RadicalImaging Static-DICOMWeb, `file-structure.md` |
| initial RTO 1 s | RFC 6298 §2 |
| initial RTT 333 ms, PTO | RFC 9002 §6.2.2 |
| decoder load in round trips; the preloads' cost | [`../../lab/page-open/README.md`](../../lab/page-open/README.md) §Cold round trips by codec (COLDRTT, *(M)*) |
| a metadata file beside the config costs no round trip | the same, §The order the page's files leave in (PORD, *(M)*) |
| metadata sizes, zstd, exam group | #150, `lab/metadata-store/README.md` §Repetition (*(M)*) |
| Turso cannot share a file across processes | #147, `lab/sqlite-engine/README.md` §3 |
