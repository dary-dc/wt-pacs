# ADR: how a viewer gets all the metadata it reads, and where each part lives

**Status:** proposed 2026-10-25, **theory only: nothing built, nothing timed; not accepted.** Every choice is the
owner's (§10); where viewer metadata lives is **open**, to discuss next ([`../ingest/pacs-receive-design.md`](../ingest/pacs-receive-design.md) §6).
Labels: *(M)* measured in this repository, with where; *(E)* an estimate, with its arithmetic; *(S)* a primary source
in §13; *(I)* this record's own inference. A number without a label is one of these by its sentence.

**Builds on, read-only and unmerged:** #142
([`serving-by-uid.md`](serving-by-uid.md):
one frame server for many series by UID, `?digest=`, the refusal codes), #146
([`study-index.md`](study-index.md): the list
fields, MySQL, the outbox, "viewing by direct link does not need the index"), #147 ([lab/sqlite-engine](https://github.com/dary-dc/wt-pacs/blob/claude/sqlite-engine-eval/lab/sqlite-engine/README.md): Turso cannot
share a file across processes), #150 (`lab/metadata-store` §Repetition: metadata sizes on five real series), #148
(`metadata-updates.md`: one writer, update packages). **Written independently of #145**: every section but §11 was committed
before #145's branch was opened (`043c82e`); §11 compares the two. *Corrected 2026-10-25, after reading #145:* that
commit recommended F (the exports sent in the session); three facts #145 brings, each checked here, put G (the same
exports over HTTPS on the page's origin) first and F second (§11). §1, §3, §5, §10 and §12 now say so; §8 is the
ranking as committed.

**Against the design state (2026-10-26).** *Corrected in place:* the decoder rule this record assumed (the 10-19 "only
its codec's decoder") was replaced on 2026-10-24: the codec may come from the study index; without it the page loads
every decoder; prefetching every decoder while the user browses is to evaluate (§3); this record's "paint metadata"
is now *display metadata* (glossary), and a study's "generation" its *revision*. **Left open, not resolved here:**
the owner's current view (10-25/26) is to read a series' metadata from the study DB when it is opened, with no derived
file or index column — this record's C — while this record ranks G first and [`display-metadata.md`](display-metadata.md)
ranks its option 1 first; the three are the design state's §6 Open item. The index column ranked fifth (A) is the
owner's earlier idea, not their current view.

## 1 · On one screen

| question | recommendation | what would change it |
| --- | --- | --- |
| **What a viewer reads** | four kinds, each needed at a different moment and corrected at a different rate (§2): **list fields**, **display metadata**, **study fields**, **full metadata** | — |
| **List fields** | the study index (#146), as proposed there, with each series' **codec** and **frame count** | — |
| **Display metadata** (decode, order, paint; no identifiers) | **exported per series by the receiver after its commit, beside the `.sbnd`, served as a static file on the page's origin** (`no-cache`, `ETag`), fetched beside the transport file; the page dials with its `?digest=` | §12 showing the same export sent as the session's first message (F) faster to the first frame under loss: then F, which keeps every other row of this table |
| **Study fields** (the overlay's patient and study text) | exported **per study**, a second file, same origin, `no-store`, behind the same authorization as the frames | — |
| **Full metadata** (the attribute panel) | exported **per series**, every group, one compressed stream; fetched only when the panel opens; `no-store`, authorized | a third-party viewer or queries across attributes (→ D, WADO-RS Series Metadata on the host, from the study DB) |
| **Codec** | **also in the index and in every link** (`?codec=`), so the page starts its decoder from the HTML, before the display metadata lands; without it the page loads every decoder (decided 2026-10-24, §3) | prefetch of every decoder while browsing, once evaluated (§3) |
| **Who opens a study DB at serve time** | **nobody**: only the receiver, so the engine stays the owner's free choice (Turso or rusqlite) | rusqlite chosen anyway (#147): then C or D cost one engine constraint less |
| **Deciding reason** | **split by what changes**: the display metadata holds no identifier, so the common update (patient/study) never touches it, and the device may keep it; what holds identifiers is apart, `no-store`, and rewritten by the common update. Served as files, nothing at serve time opens a study DB, nothing depends on the index, and the measured cost on the user's path is no round trip (PORD) | — |

**The owner's earlier idea — the display metadata as a column in the study index — ranks fifth of six (§8, §11).** It is the
fastest path when the list was shown first and the index is near and up; it makes the index necessary for viewing,
which #146 §6 rules out for a direct link; it puts per-frame data (tens of KB a series) into a database sized for list
rows (§5); and the outbox's lag leaves an image-level correction unseen for as long as the publisher is behind (§6).

## 2 · What a viewer reads, when it needs it, and how often it changes

| kind | fields | needed | changes when | size a series | identifiers |
| --- | --- | --- | --- | --- | --- |
| **list fields** | patient name, ID, birth date, sex, study date, description, accession, modalities; per series number, modality, description, frame count, codec (#146 §4) | before any series is chosen | patient/study corrections: **the common update** | 0.1–0.2 KB (*(E)*, #146 §4) | yes |
| **display metadata** | codec, frame count, rows, columns, channels, bits allocated/stored, high bit, signed, photometric, rescale, window (every value, function), min/max, frame time or cine rate, frame order; per frame what varies (position, window in MR, decay factor in PET); pixel spacing and orientation for measurement and markers (`FIXTURES.md` §The metadata, plus the last two) | before the first paint; the codec **before the first decode** | image-level corrections: **very rare** (owner); a new bundle | shared ≈ 0.5 KB; per frame ≈ 40–60 B as JSON, so ≈ 13 KB raw at 262 frames, ≈ 100 KB at 2 000 (*(E)*: ~15 numbers a frame; #126 measured a 2 000-instance CT document at 95 803 B, *(M)*), ≈ 3–5× smaller compressed (*(E)*) | **none** (`FIXTURES.md`: "No patient or study identifier is copied") |
| **study fields** | the exam group: the overlay's name, ID, birth date, sex, study date and description, institution | with the first paint, for the overlay | patient/study corrections: common | 1.2–1.8 KB a study (*(M)*, #150, exam group) | yes |
| **full metadata** | every group of every instance: exam, series, instance, private | when the user opens the attribute panel; rarely | any update | 6.7–763 KB raw; **0.8–12.6 KB as one zstd stream** (*(M)*, #150, five de-identified series; a hospital's headers may weigh more) | yes |

Two facts decide most of what follows (*(I)*):

1. **The display metadata carries no identifier, so the common update never touches it.** A patient or study correction
   rewrites the list fields, the study fields and the full metadata; the display metadata changes only with an
   image-level correction or a new bundle.
2. **The frame digests are no longer metadata.** The target layout moves each frame's samples hash into the `.sbnd`
   entry ([`../disk-layout/target.md`](../disk-layout/target.md) §The two hashes), so the frame server already holds
   them with the frames they check.

## 3 · Why the codec lives apart from the rest

The codec is the one field needed **before the session exists**. Loading an AV1 decoder module after the first payload
cost **2.0 serial round trips through WebCodecs and 3.9 through dav1d-WASM**; fetched at the decoder's start it was 1.0
and 3.0 fewer, and with the page's preloads AV1 reached HTJ2K's 8.0 round trips to the first exact frame (*(M)*,
[`../../lab/page-open/README.md`](../../lab/page-open/README.md) §Cold round trips by codec, COLDRTT). Everything else in
the display metadata is needed only at paint time, at least one round trip after the session is up, and so can arrive
with the frames.

The codec is also the one field that is safe to copy (*(I)*):

* it is a property of the coded bytes, written in the `.sbnd` header, so it changes only with a new bundle, never with
  a metadata update;
* a stale copy costs a wrong module prefetched, never a wrong picture: the decoder is chosen by the display metadata,
  the authority;
* it is 4 bytes, carries no identifier, and the list needs it anyway to mark a series this device cannot decode.

None of these holds for the rest of the display metadata: rescale and window are clinical values a correction can
change, and the per-frame part grows with the series.

**Prefetch without the codec.** With two codecs, a page can preload both decoders while the user browses; that reached
8.0 round trips for AV1 and cost the session +27 to +41 ms, a constant, and dav1d's 238 KB of gzipped WASM (*(M)*,
COLDRTT). On a metered phone the codec in the list saves those bytes for an HTJ2K-only study. For a **direct link**, the
link's producer (the list, a report, a worklist) carries `?codec=` ([#118's hint](https://github.com/dary-dc/wt-pacs/pull/118)).
*Corrected 2026-10-26:* a correction of 10-25 here applied the owner's 10-19 rule, "the client loads only what it
needs" (as #145 §5 reported it). The owner replaced that rule on 2026-10-24: **the codec may come from the study index;
without it the page loads every decoder**, as this paragraph first said. **To evaluate:** prefetching every decoder
while the user browses the list (fetch, never instantiate; the same site, for the HTTP cache), which leaves a direct
open by link without `?codec=` as the one case where a decoder loads on the first frame's path
([`../ingest/pacs-receive-design.md`](../ingest/pacs-receive-design.md) §6).

## 4 · The options

| | where the display metadata lives, and who serves it | full metadata |
| --- | --- | --- |
| **A** | a column (binary or JSON) per series in the study index, served by its API, in the study's series list | the index, or the host |
| **B** | a file per series, exported by the receiver beside the `.sbnd`, served over HTTPS by nginx (#145's option 1) | a second file, the same way |
| **C** | the study DB, read by the frame server at session open (`spawn_blocking`), sent in the session | the study DB, read on request in the session |
| **D** | the study DB, read by a metadata API process on the host at request time | the same API (DICOMweb Retrieve Metadata) |
| **E** | A or D with a cache (Redis) beside the index | the same |
| **F** | split by kind: list fields and codec in the index; paint and study fields exported per series by the receiver and **sent by the frame server as the session's first message**; full metadata exported and sent on request | an export, sent in the session |
| **G** *(recommended, §11)* | as F, but the exports fetched over HTTPS on the page's origin (B's delivery with F's split) | an export over HTTPS |
| — | rejected: the display metadata in the `.sbnd` header — a correction to window or rescale would rewrite a bundle of hundreds of MB, and the target keeps the file free of metadata ([`../disk-layout/target.md`](../disk-layout/target.md)) | — |

**Judged** (*(E)* and *(I)* throughout; the round trips are §5's model). *Corrected 2026-10-25:* the connection and loss rows
assumed the file on another origin than the page's; on the page's origin, B, D and G add no connection (§5).

| | A index column | B static file, nginx | C study DB, frame server | D study DB, metadata API | E cache | F split, in session | **G split, HTTPS** |
| --- | --- | --- | --- | --- | --- | --- | --- |
| extra requests to paint, from the list with prefetch | 0 | 0 | 0 | 0 | 0 | **0** | 0 |
| extra requests to paint, direct link | 1, on a connection to the index's server | 1, on a connection to the host | 0 | 1, on a connection to the host | 1 | **0** | 1 |
| connections added, direct link, the file on the page's origin | the index's server | none | none | none behind nginx; one on its own origin | as A | none | none |
| under loss | a second, often distant, connection's handshake and RTO | the document's bytes on the transport file's TCP connection | the document ahead of frame 0 on QUIC | as B | as A | as C | as B |
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

**Opened from the list, prefetch on.** Every option is off the critical path (*(E)*): the display metadata is needed only
at paint, and the session's dial plus the first frame is ≥ 3 round trips, against 1 for a fetch on a warm connection.
A's real advantage — the metadata already in hand from the series list — buys nothing the frames do not already wait
for. F's opening message rides behind the accept, so it lands before frame 0 by construction.

**Direct link, cold.** The page has the host and the UIDs from the link (#146 §6). F needs nothing more than the dial.
B, D and G fetch a file; A and E fetch from the index's server, possibly in another network, and fail when it is down.
*Corrected 2026-10-25:* this said B, D and G add a connection. They do not when the file is on the page's origin: the
page already fetches the transport file there over HTTPS before it can dial, in every option
([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The session open; #145 §2), and PORD measured a ~120 KB gzipped document
beside it at no round trip of its own. Only a file on another origin adds one.

**Under loss.** Residual loss on real links is mostly ≤ 0.1 %, with tails near 1 % and handover bursts of 24–50 ms
([`../transport/link-conditions.md`](../transport/link-conditions.md)). What a loss costs here is a handshake's: a lost
SYN waits the initial RTO of 1 s (RFC 6298 §2), a lost QUIC Initial a PTO from a 333 ms initial RTT (RFC 9002 §6.2.2),
about 1 s. Each added connection is another independent chance of that second (*(E)*: at 1 % loss and ~4 handshake
packets, ~4 % of opens per connection). F and G on the page's origin add none; A and E do on a direct link. What G
still puts on TCP is the document's bytes beside the transport file: more bytes, more chance a segment is lost and held
for a retransmit, not a new handshake (*not measured*: §12). What F puts ahead of frame 0 is the same bytes on QUIC:
a 96 KB document is about three slow-start flights from a 12 KB window (#145 §3, *(E)*), unless its per-frame part
goes after frame 0.

**Bytes.** The same in every option for the display metadata (≈ 3–25 KB compressed, §2); A sends it for **every series
of the study** in the series list, whether or not it is opened (*(E)*: 8 series ≈ 30–200 KB), unless the list fetches
it per series, which is then B's request to a central server.

**What A costs the index.** At ≈ 5 KB compressed per series (*(E)*, §2) and #146's ~8 series a study, 10⁶ studies are
≈ 40 GB of display metadata, against the 2–4 GB #146 §4 sizes for the list fields, "which a small server holds in
memory". The index would no longer fit its own premise.

## 6 · Consistency after an update

**The receiver's order** (#119 §12.5, #148): the bundle renamed in, then the study DB committed, then the derived
copies, then "stored". In F the derived copies are the exports, each written `.partial` → `fsync` → `rename`, and each
**names the bundle digest and the study DB's revision it was derived from** (*(I)*: the revision is #146 §7's).

**At session open, F's frame server** opens the bundle as #142 §3–§4 does, then the series' export; if the export's
digest is not the bundle's, it reopens both once (the receiver is between its rename and its export, milliseconds);
still unequal, it refuses with #142's code 3, `series changed`. **It never sends display metadata for frames it is not
serving.** The client needs no pairing logic and no cache-busting.

**In G and B** the client pairs: it dials with the export's `?digest=`, and a new bundle is refused with code 3 and the
file fetched again (#142 §6; #145 §3). A page fetched between the bundle's rename and the export's is refused once more
until the export lands, milliseconds (*not measured*; #145 §7 M4). Frames and display metadata are never paired across
bundles in either.

**A metadata-only image-level correction** (window, rescale) leaves the bundle and its digest unchanged, so `?digest=`
cannot catch it in any option. In F, every session opened after the receiver's rename gets the new values. A session
already open keeps the values it was sent, as it keeps its bundle (#142 §4); telling it is #148 §7's question (a
re-sent message, or revalidation), and in F it is one more server message on a session that already exists. In A the
correction reaches a viewer only once the outbox has published it: seconds normally, unbounded while the index or the
publisher is down. In B and G a new open revalidates (`no-cache`, a 304 when unchanged) and reads the correction once
the export has landed: stale for one export's length, never mispaired.

**A crash between commit and export** leaves an export behind the study DB. The receiver re-derives at start where an
export's revision is lower than its study DB's (*(I)*: the same check as #146 §7's reconcile, on the host).

## 7 · What established systems do

| system | list-level | per-series metadata | full metadata, bulk data | consequence here *(I)* |
| --- | --- | --- | --- | --- |
| **DICOMweb**, PS3.18 | Search (QIDO-RS) | Retrieve Metadata: `/studies/{study}/series/{series}/metadata`, "all the Metadata for all individual Instances … in the Series" (§10.4.1.1.2, Table 10.4.1-2) | metadata "without Bulk Data"; bulk data by **BulkDataURI** (§10.4.1.1.5) | the standard itself splits by kind: its Note says a client wanting only study- or series-level fields "would be better served by using the Search Transaction" (§10.4.1.1.2) |
| **OHIF** | QIDO series search, sorted | one WADO-RS series metadata request **per series, deferred until consumed** (`retrieveMetadataLoaderAsync.js`); `enableStudyLazyLoad` | `bulkDataURI` resolution per series (data-source docs) | a request per opened series, after the list: the shape B, D and G have |
| **Orthanc**, DICOMweb plugin | its Index (SQL) | `SeriesMetadata`: `Full` reads "all the DICOM instances … from the storage area"; `MainDicomTags`, `Extrapolate` | since 1.15, **"caches metadata as a gzipped attachment"** (`EnableMetadataCache`) | a derived, compressed file per series, made because reading the truth per request was slow |
| **dcm4chee-arc-light** | the database's query attributes | **Series Metadata Storage**: series metadata aggregated into a zip per series after `dcmSeriesMetadataDelay` | full attributes per level also kept in the database | a derived file per series beside the database; whether WADO-RS reads it is *unconfirmed* |
| **AWS HealthImaging** | search API | `GetImageSetMetadata`: one JSON document per image set, **gzip**, **versioned** (`versionId`), a 409 while processing | frames by `GetImageFrame`, HTJ2K | one compressed document, versioned apart from the frames: F's export plus its revision |
| **Static DICOMweb** | `studies/index.json.gz`, `series/index.json.gz` | `metadata.gz` per series, served from disk or object storage | `bulkdata/`; a `deduplicated/` root for eventual consistency | precomputed per-series files: B |

**What none of them does:** deliver the display metadata on the frames' own channel. They are HTTP request-response
systems, and AWS HealthImaging addresses frames by IDs found in the metadata, so the metadata must come first. Here
frames are addressed by index on a session the server already holds, so the server can describe what it serves
without a request (*(I)*). **What all of them do:** keep list-level fields in a query index, and serve per-series
metadata as a document derived from the truth, cached as a compressed file. None puts the per-series metadata in its
query index; dcm4chee keeps full attributes in its database, and added a per-series file beside it.

## 8 · Ranking (independent, committed before reading #145)

*As committed at `043c82e`, unchanged. The ranking this record now holds is §11's: G first, F second, the rest as
below.*

1. **F — split by kind; paint and study fields in the session, from the receiver's exports.** Zero requests and one
   connection on every path; consistency by the server's own check; only the receiver opens a study DB; the attribute
   panel behind the session's authorization. Costs: a wire change (one server message at open, one ask and one answer
   for the full metadata), and no HTTP cache for the display metadata (re-sent each open, a few KB).
2. **G — the same split, the exports over HTTPS from the host.** Everything F decides except the channel. Better if the
   wire must not change, or if an HTTP cache on the phone is wanted; costs a second connection on a direct link, nginx
   and its authorization on every host, and the client's pairing by `?digest=`.
3. **C — the frame server reads the study DB at open.** No derived copy at all, always current. Costs: two processes on
   every study DB, so rusqlite (#147), and the frame server coupled to the study DB's schema and the derive.
4. **D — a metadata API on the host.** The DICOMweb-conformant shape; a new service and connection, two processes on a
   study DB. The choice when a third-party viewer must read this PACS.
5. **A — the owner's earlier idea, a column in the index.** Fastest only where every option is already off the critical
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

1. **May the session carry metadata** (a wire change)? Default: not unless §12 shows F faster under loss; G meanwhile.
2. **Must a third-party viewer read this PACS** (DICOMweb)? Default: not now (#146 §9); D's endpoint added on the host
   when one must.
3. **Do viewers always start from the list?** Default: no; direct links from reports and worklists are a first-class
   path, so viewing must not depend on the index.
4. **May display metadata be kept on the phone** between visits? Default: yes, it holds no identifier; the study fields
   and full metadata no (`no-store`, as #146 §8).
5. **Must every link carry `?codec=`?** Default: yes, whoever makes the link (the list, a report, a worklist) reads it
   from the index; a link without it still opens, every decoder loaded (decided 2026-10-24).
6. **Is an open session told of an image-level correction?** Default: yes; under G by the page revalidating its file,
   under F by a re-sent opening message (#148 §7's question).
7. **The study fields and the full metadata as files on the page's origin** carry identifiers: is nginx's authorization
   (a signed, short-lived URL checked on the host, as #146 §6's token) acceptable? Default: yes, the same token the
   session checks.
8. **The transport URL in the page** (an opt-in lever, −1.24 round trips at 1×, [`../ARCHITECTURE.md`](../ARCHITECTURE.md)
   §The session open): taken? Default: not taken; if taken, §12 decides between G and F again (§11, row 7).

## 11 · Comparison with #145

*Added after every other section was committed (`043c82e`); #145 read at its branch's head on 2026-10-25.*

**Where the two agree.** The display metadata (#145's display metadata file) is a per-series document derived by the
receiver and served as a file (#145's option 1 is this record's B); it carries the bundle's digest and the page dials
with `?digest=`; the codec is a study-index column so the list loads only the decoders it uses, and a link may carry
`?codec=`; at serve time no process opens a study DB, so the engine stays free; the index column (A) is rejected
because the index down would stop direct links and a CT series' document is ~96 KB in MySQL; a cache (E) is rejected
without a load it would relieve; the `.sbnd` header is rejected because corrections would rewrite it; and the
established systems converge on a derived per-series document over HTTP, none of them on the pixel channel.

**Where they disagreed, and what this record now holds.** Each disagreement checked against its source.

| # | this record at `043c82e` | #145 | checked | now |
| --- | --- | --- | --- | --- |
| 1 | F first: a file adds a connection and its handshake's loss exposure on a direct link | option 1: no round trip of its own, beside the transport file | the page fetches the transport file over HTTPS before it can dial, in every option ([`../ARCHITECTURE.md`](../ARCHITECTURE.md) §The session open); PORD measured a ~120 KB gzipped document beside it at no round trip, 112/112 | **#145 is right; corrected in §5.** On the page's origin a file adds bytes to a fetch already on the path, not a connection |
| 2 | F's opening message lands before frame 0 at no cost | a 96 KB document ahead of frame 0 is ~3 slow-start flights | arithmetic: 12 + 24 + 48 KB ≥ 96 KB, the 2 000-instance CT document of #126 | **#145 is right**: F must send its per-frame part after frame 0, and is unmeasured either way |
| 3 | the in-session alternative is F: the receiver's export, read as a file by the frame server | the in-session alternative is 2a: the frame server reads the study DB | 2a's costs (rusqlite, two processes on every study DB, ≈ 3 descriptors and ~150 KB a held study, #145 §3) all come from the DB read, none from the channel | **this record holds**: if #145's M1 favours in-session, the answer is F, which keeps option 1's deciding reason (no serving process opens a study DB) and 2a's in-process pairing. #145's "what would change it" should name F |
| 4 | four kinds; identifiers kept out of the display metadata, the overlay's study fields a per-study file | the display metadata only; the overlay text and its identifiers not addressed | a direct link has no list, so the overlay's name and dates need a source on the host | **this record holds**: a per-study export, `no-store`, rewritten by the common update, which then never touches the display metadata |
| 5 | the full metadata decided now: one compressed export per series, on demand | "not now; a second export or 2b; decide with the panel" | #150 measured a series' groups at 0.8–12.6 KB as one zstd stream, 1.6–3.2× file by file | **this record holds** the location and shape (cheap to write, measured), and agrees D replaces it when queries are needed |
| 6 | the files that carry identifiers behind the session's authorization | authorization not designed; default none, as today | a UID is not a secret (#142 §2); a static file of names reachable by UID is a disclosure the session's frames are not | **this record holds**: the same short-lived token (#146 §6) on the study and full files; the paint file may stay open, as the frames are |
| 7 | under F the page dials with nothing but the link; G's wait not weighed | the page waits for the document and the transport file before it dials (today's viewer) | the page needs the document's digest for `?digest=`, and the frame count for its opening ask (`?ask=fill:A-B` out of range is ignored, `WIRE.md` §The opening ask) | **#145 holds** while the transport file is fetched: the wait is beside it, free. With the transport URL in the page (an opt-in lever, −1.24 round trips at 1×), G's wait becomes a serial round trip and F's does not: the one case found where the channel matters on a lossless link (*(I)*; §10, 8) |
| 8 | `?codec=` on every link, default yes | default no until M2 | either way M2 decides; the producer of a link reads the index anyway | a default, the owner's (§10, 5) |
| 9 | preload both decoders on a direct link without a hint | the client loads only what it needs (owner, 2026-10-19) | the owner replaced the 10-19 rule on 2026-10-24: without the codec the page loads every decoder | **this record's first text holds; §3 corrected again on 2026-10-26** |
| 10 | — | 2c, the receiver answers reads | ingest and viewing would share a fate | agreed: rejected |

**The ranking this record now holds:** **G** (B with this record's split: #145's option 1, plus the study fields and
the full metadata as their own files, and identifiers behind the token), then **F** (the same exports in the session,
only if M1 says so), then D, C, A, E. The owner's earlier idea (A) stays fifth; their current view is C (§Status).

**Why a record of its own and not an extension of `display-metadata.md`.** The carrier for the display metadata agrees.
The scope does not: the question here is everything a viewer reads, and rows 3–7 decide what #145 leaves open or
answers otherwise. On acceptance the two records fold into one: #145's §1–§9 as the display metadata's record, this
record's §2–§3, §6 and the table above as its scope, the split and the alternative.

## 12 · Measurement protocol (pre-registered, not run)

*Revised 2026-10-25 after §11, before any run: one run with #145's M1, not a second.* **Claim under test:** G's file on
the page's origin is no slower to the first exact frame than F's opening message, at every delay and loss cell.

* **Arms, interleaved in every round, Williams order** ([`../../CLAUDE.md`](../../CLAUDE.md) §Measurement): G (#145's
  option 1: the file beside the transport file, the page dials with its digest once both land); G′, G again, the A/A
  arm; F (the export as the session's first message, its shared part first and its per-frame part after frame 0);
  F-whole (the whole document ahead of frame 0). `?codec=` in every arm.
* **Cells.** `lab/page-open`'s harness through `lab/scripts/link_impair.py`, both planes (`--tun`, so TCP sees the
  loss); round trips 40, 100, 200 ms; loss 0, 1 and 3 % iid and one Gilbert–Elliott burst profile; display metadata of
  1 KB and #126's 2 000-instance CT document; a one-flight first frame and a CT-sized one (~150 KB HTJ2K); the transport
  file fetched, and the transport URL in the page; cold and warm profile; ≥ 12 paired rounds a cell after `VOID`s.
* **Metric: latency only** — navigation to the first painted exact frame, p50 and p95, and its slope against the round
  trip. The rig's saturation point (a core, the relay's rate) named first; nothing claimed past it
  ([`../rig-limits.md`](../rig-limits.md)); a real phone is outside it.
* **Counts, not timed.** The display metadata, study fields and full metadata of the five #150 series and #126's CT,
  gzipped as nginx serves them.
* **Correctness, each mutated before it counts.** G: a page holding an old document is refused code 3 and paints only the
  new pair (break: skip the server's digest compare → the test fails). F: an export whose digest is not the open
  bundle's is never sent (break: skip the check). Both: a crash between commit and export is re-derived at start; a
  study-field correction leaves the paint file's bytes and `ETag` unchanged.
* **Decision rule, fixed now.** G stands unless F beats it by more than G/G′'s spread at 1 % and 3 % loss at two or more
  delays (#145's M1 rule), in the cells where the transport file is fetched. In the cells with the transport URL in the
  page, the same rule decides §10's question 8: if F wins there, taking that lever means taking F.

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
| metadata sizes, zstd, exam group | #150, [lab/metadata-store README](https://github.com/dary-dc/wt-pacs/blob/claude/metadata-repetition/lab/metadata-store/README.md) §Repetition (*(M)*) |
| Turso cannot share a file across processes | #147, [lab/sqlite-engine README](https://github.com/dary-dc/wt-pacs/blob/claude/sqlite-engine-eval/lab/sqlite-engine/README.md) §3 |
| the transport file on the path in every option; 2a's handle arithmetic; the owner's 2026-10-19 decisions as reported (the decoder rule replaced 2026-10-24) | #145, [`display-metadata.md`](display-metadata.md) §2, §3, §5 |
| a 2 000-instance CT document is 95 803 B | #126, as cited by #145 §3 (*(M)* there) |
