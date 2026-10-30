# ADR: where a viewer's display metadata lives, and how it is served

**Status:** proposed 2026-10-25, **theory only: nothing built or timed here; not accepted.** Where viewer metadata
lives is **open**, to discuss next; every choice in §8 is the owner's. Scope starts at the PACS; the PCS (the
hospital-side component) is another team's (the owner, 2026-10-24). *(M)* a number measured in this repository, with
where; *(E)* an estimate, its arithmetic shown; *(I)* this record's own inference; *(S)* a primary source in §9. Every
option was judged on the same rows before one was picked; none was preferred going in.

**Builds on, read-only and unmerged:** #118 (`claude/page-open-metadata` at `6e8eaab`, `docs/ingest/metadata-draft.md` §1: carriers
A1, A2, B and the codec placements), #119 (`claude/pacs-receiver-design`, `docs/ingest/design.md` §12: the series
digest pairing metadata with frames), #120 and #126 (`claude/metadata-pair-bench` at `392c0ce`, `docs/ingest/metadata-draft.md` §2:
the display metadata's read and update, measured), #144 (`claude/metadata-update-cost` at `ebc1207`, `lab/metadata-store` README:
an update patched in place), #142 ([`serving-by-uid.md`](serving-by-uid.md):
one server, many series, `?digest=` and the refusal codes).

**Decided by the owner, taken as given (2026-10-24/25).** Per series the PACS receives one submission package: the
`.sbnd` and its metadata groups. Per study it keeps one SQLite-format **study DB** beside the series files, one row
per group, updated in place by one writer, the receiver. A separate **study index**, likely MySQL and perhaps on
another server, lists studies and series for list, browse and search screens. Pixels go frame by frame over
WebTransport from `series-server`.

**Against the design state (2026-10-26,** [`../ingest/pacs-receive-design.md`](../ingest/pacs-receive-design.md) **§6).**
*Corrected in place:* the decoder rule of 10-19 that §5 cited was replaced on 2026-10-24 (the codec may come from the
study index; without it the page loads every decoder; prefetch while browsing is to evaluate); "page document" is now
*display metadata*, and the study DB's row is its source, not a "truth". **Left open, not resolved here:** the owner's
current view (10-25/26) is to read a series' metadata from the study DB when it is opened, with no derived file or
index column — closest to 2a below, which this record ranks behind 1 — and
[`viewer-metadata.md`](viewer-metadata.md) (#153) ranks its split G first. The three are the design state's §6 Open item.

## 1 · One screen

**Display metadata** is, per series, what the page needs to decode and paint: codec, frame count, rows and columns,
photometric, bits, rescale, window, instance order, cine rate. Codec, frame count and the digest are already in the
`.sbnd` (header and index, [`../disk-layout/target.md`](../disk-layout/target.md)); the rest is in the groups, so in the
study DB.

| | rt of its own, (i) from the list, decoders prefetched | rt of its own, (ii) a link, nothing prefetched | who opens a study DB while serving | engines it allows | stale never paired with frames | what we add |
| --- | --- | --- | --- | --- | --- | --- |
| **1** a file per series, exported by the receiver, nginx serves it | 0 (M: PORD) | 0 to the doc (M: PORD); the decoder's preload from it, not measured | **no one**; the receiver writes | any, Turso included | `?digest=` in the session URL (#142) | an export after each commit; an nginx location |
| 2a the frame server reads the DB, sends it in the session | 0; the page dials before it knows the count | the decoder after the session: +1.0 to +3.9 rt for AV1 (M: COLDRTT) unless a hint or every decoder | `series-server` + the receiver | multi-process: SQLite WAL (rusqlite); not Turso today | checked in-process at the accept | a wire message, both clients, the contract suite, an open-ended opening ask, the engine in the server |
| 2b a metadata HTTP process reads the DB | 0 behind nginx on the page's origin (I); ≈ 2 rt on its own origin (M: H2) | as 1 | that process + the receiver | as 2a | as 1, the doc always current | a service to deploy, run and secure |
| 2c the receiver answers the reads | as 2b | as 1 | the receiver alone | any | as 1, the doc always current | a read path in the ingest process: an ingest fault stops viewing |
| 3 list fields in the index, display metadata elsewhere | the boundary, not a carrier: it decides what (i) can prefetch | — | — | — | — | the codec as an index column |
| 4 a cache (e.g. Redis) at the index | ≈ 2 rt from the page (another origin) (E) | as (i) | the cache's filler | — | a third copy to invalidate across a network | a server, a protocol, invalidation |
| 5 display metadata in the index | as 4 | as 4; the index down, no study opens | no one; the index holds it | — | a two-host write per update | ≈ 96 KB a CT series in MySQL (M: #126) |

**Recommended: 1 with 3.** The receiver, which already writes the series' display metadata into the study DB in the
update's transaction (#126's V1 row), exports it after the commit as one file per series; nginx serves it on the
page's origin with `no-cache` and its `ETag`, as it serves today's metadata. The study index carries the list fields
and each series' codec, so the list prefetches only the decoders its series use. The page puts the document's digest
in the session URL, and the server refuses a mismatch (#142 §4).

**The deciding reason: under 1, no serving process opens a study DB.** The receiver is the only process that ever
does, so the engine is free (Turso's single-process limit fits), there is no reader to make multi-process safe, no
handle to hold per study at N viewers, and no new process, wire message or client change. Its one measured cost is
PORD's: no round trip of its own, the dial delayed +7 / +29 ms at 80 / 160 ms by ~120 KB gzipped, an upper bound for a
CT document of 95.8 KB before compression (§3). What it pays: a second, derived copy (§4.1), and its fetch rides TCP.

**What would change it:**

* **Loss.** If §7 M1 shows the document's TCP fetch costing the first frame more than 2a's in-session copy at 1–5 %
  loss, 2a wins on the user's path; it then takes rusqlite, a wire change and the multi-process reader with it.
* **Queries, not documents.** A tag panel or search over attributes that a per-series file cannot answer favours 2b
  (or 2c), on the same origin behind nginx.
* **Per-request authorization** that nginx cannot express favours 2b.
* **The owner keeps target.md's "one copy, in the study DB"** literally: then 2c if Turso is wanted, 2b if not.
* **Not** a larger document, until it passes ~120 KB gzipped (the measured bound), nor many viewers: nginx serving a
  file is the one carrier that already does that here.

## 2 · Where the page needs what, today

The viewer fetches its metadata and the transport file side by side on the HTML's connection and **waits for both
before it dials**: the dial needs the decoder and the fill's end (`client/viewer/head.js`, `client/viewer/viewer.js`;
#118 §1). Measured on that path (`lab/page-open/README.md`): the HTML at ≈ 3.0 rt, the transport file at 3.6–4.9
(R2, PORD), the session at ≈ 7.0, the first exact frame at 7.99 for HTJ2K (COLDRTT); AV1 reaches 7.96–7.98 only with
its decoder preloaded from the HTML, and is 2.0 (WebCodecs) or 3.9 (dav1d) rt later when the decoder loads after the
first payload (COLDRTT `-before`).

**The transport file is on the user's path in every option** (I): the page cannot dial before it has `wt_url` and the
certificate hash, and it gets them over HTTPS. So a document fetched beside it adds bytes to a TCP fetch the page
already waits on, not a serial step; under loss, more bytes there is more chance one is lost, not a new round trip.

## 3 · Per option

### 1 · A file per series, exported by the receiver, served by nginx

```text
 receiver   bundle renamed in ─▶ DB commit: groups + page row (doc, digest, revision) ─▶ doc.partial, fsync, rename
 page       GET /studies/<S>/series/<Se>/display  ‖  GET /wt/dev-transport.json  ─▶ preload its codec ─▶ dial ?digest=
 nginx      a file; ETag, no-cache: a reopened page revalidates with a 304 (RFC 9110 §13.1.2, §15.4.5) (S)
```

* **Round trips.** (i) and (ii) alike: none of its own, beside the transport file (M: PORD, 112/112 visits the
  transport file first). A 2 000-instance CT document is 95 803 B uncompressed (M: #126), under PORD's ~120 KB
  *gzipped*, so PORD's +7 / +29 ms at 80 / 160 ms is an upper bound for it (I: gzip only shrinks it).
* **The decoder on a direct link.** Its preload starts when the document lands (≈ 3.6–4.9 rt), not at the HTML
  (≈ 3.0) as COLDRTT's `-pre` did; whether that is still off the first frame's path (the session opens at ≈ 7.0) is
  **not measured** (§7 M2). The link can carry `?codec=` as a hint the page checks (#118's b), at no cost but the link.
* **Bytes.** The document, gzipped by nginx, and a request's headers.
* **Under loss.** TCP: one lost segment of the document holds it, and so the dial, for a retransmit. Not measured;
  `lab/scripts/link_impair.py --loss` reaches TCP only through `--tun` (#118).
* **Processes and DBs at serve time.** nginx opens a file per request; no study DB is opened. At N viewers: zero DB
  handles, zero DB descriptors held.
* **Consistency.** The order above means the file lags the DB by one export (ms, not measured). A page holding the old
  document dials with the old digest; if the bundle changed, the server refuses `series changed` (#142 §6, code 3)
  and the page fetches again. Frames and display values are never paired across bundles. A metadata-only correction
  (a window, same bundle) can be read stale for that export's length: stale, not mispaired.
* **Crash.** Between the commit and the rename the file is behind; at start the receiver re-exports every series of
  its studies with work whose file's revision is not the row's (I).
* **Scaling.** Static files are what nginx does; many PACS hosts are a route by Study UID, the same as for frames.
* **Failure.** The index down: links still open (the document and frames need only the PACS host). nginx down: no
  page either, as today.
* **What we own.** The export (a function: row in, file out) and one location. The document itself is built in every
  option.
* **Full metadata.** A second export, the series' every attribute, fetched only when a panel opens; the DICOM JSON
  model (PS3.18 Annex F) is the standard's shape for it (S). Or 2b, when a panel needs queries.
* **Against target.md** "no metadata in or beside the file; one copy, in the study DB": this is a derived copy, and
  the record names it (§4.1).

### 2a · The frame server reads the DB, sends the document in the session

The server already holds the `.sbnd`'s header, so codec, frame count and digest need no DB; the display values do.

* **Round trips.** (i): the page dials without the document; the document leaves behind the accept with frame 0, so
  the first frame stays ≈ 8.0 rt if the document is small (I, from COLDRTT; not measured). A 96 KB document ahead of
  frame 0 on one stream is about three slow-start flights from a 12 KB window (E: 12 + 24 + 48 KB ≥ 96 KB), unless
  the per-instance part goes after frame 0. (ii): with no hint and no prefetch, the decoder loads after the session:
  +1.0 to +3.9 rt for AV1 (M: COLDRTT `-after` and `-before`).
* **Under loss.** The document rides QUIC with frame 0; but the transport file is still TCP (§2), so TCP is not
  off the path (I).
* **Processes and DBs.** `series-server` reads study DBs while the receiver writes them: two processes on one file.
  SQLite's WAL allows it on one host: "all processes using a database must be on the same host computer" (S: wal
  §1). Turso cannot share a file across processes safely today (the owner's brief); its README lists multi-process WAL
  as experimental (S). So 2a fixes the engine to SQLite through rusqlite until that changes. **At N viewers**, held open: one connection per distinct open
  study, as #142's map of open series; each holds its database, `-wal` and `-shm` files (S: tempfiles §2.2–2.3), three descriptors (I), and the pages it
  read: ≈ 24 pages of 4 KiB for a 96 KB document plus a few B-tree pages, ≈ 110 KB, and the 32 KiB `-shm` map (E).
  A thousand open studies ≈ 3 000 descriptors and ≈ 150 MB (E). Opened per read instead: none held, +52–88 µs a read
  (M: #126).
* **Consistency.** Best of all: the server reads the row and holds the bundle, so it compares the row's digest with
  the bundle's in-process and sends nothing mispaired, with no client round trip.
* **What we add.** A reserved message on the media stream, an open-ended opening ask (`parse_opening_ask` takes a
  closed range), both clients, the contract suite, the DB engine linked into the server (#118 §1 tables).
* **Full metadata.** The wrong carrier: a tag panel's kilobytes are not frames (I).

### 2b · A metadata HTTP process reads the DB

The same document over HTTP, read from the DB at request time (#126: 18–29 µs held, +52–88 µs opened, M).

* **Round trips.** As 1 when nginx forwards to it on the page's origin (I: same connection). On its own origin, a
  second TCP and TLS connection: 163 ms at an 80 ms round trip (M: H2, `lab/page-open/README.md`), ≈ 2 rt, plus CORS.
* **Processes and DBs.** That process and the receiver: as 2a, rusqlite, the same handle arithmetic.
* **Consistency.** Always the committed row; the pairing still needs `?digest=`, as 1.
* **What we add.** A service: its deploy, health, limits, certificate or proxy, and its own failure. What it buys:
  any query (a tag panel, one attribute across a study) on the one copy.

### 2c · The receiver answers the reads (added here)

The single writer already holds each study DB; it answers GETs behind nginx. One process per file, so any engine;
the document always current. Against it: ingest and viewing share a fate (a stuck upload or a crash stops every
page's metadata), which #119 §12.1 split them to avoid; and the receiver's CPU bursts (checks, builds) sit in front
of viewers. It is the option to take if the owner wants one copy *and* Turso.

### 3 · List fields in the index, display metadata elsewhere

Not a carrier, the boundary. **The index holds what a list, browse or search screen shows or filters on, and what
lets a page start before it reaches the PACS host:** the study's rows of #119 §5 (patient, dates, accession,
modalities, counts), per series modality, body part, description, instance and frame counts, **the codec**, and
which PACS host holds the study. **Everything per instance stays in the study DB.** With the codec listed, the list
prefetches only the decoders its rows use; a link built from the list may carry `?codec=`. The digest stays out (I):
it changes with every bundle update, and the document carries it.

**The owner's prefetch-every-decoder idea** is sound for (i): decoders are static, versioned files, so once fetched
they are warm for every later open on that device (M: COLDRTT warm, 5.9–6.0 rt in every codec). Its price on a
mobile link: dav1d's WASM is 238 KB gzipped (M: `docs/decode/README.md`), OpenJPH's 246 209 B before compression
(M: same), and the decoders' modules 15.7 KB gzipped (counted here, `gzip -6` on this tree); ≈ 0.5 MB, ≈ 4 s at
1 Mbit/s, 0.4 s at 10 (E: 500 KB × 8 ÷ rate). Spent while the user reads a list it is free; spent on a direct open it
competes with the first frame (COLDRTT: the AV1 preloads alone cost the session +27 to +41 ms at 100 Mbit). With the
codec in the index, the list fetches the one or two decoders in use instead of all (I). Under 1, a direct open
learns the codec from the document at ≈ 4 rt; under 2a it learns it only at the session.

### 4 · A cache layer in the study-index server

Reads are microseconds at the source (M: #126); a cache saves nothing a user sees. It adds a server, a protocol, a
third copy to invalidate from the receiver across a network, and a partition in which it serves stale display values
with no digest check unless it also caches the digest. On another server it breaks the owner's 2026-10-19 rule,
metadata and pixels on one host (#118). Rejected without a measured load it would relieve.

### 5 · Display metadata in the study index

One query for list and open, but: a CT series' 96 KB per-instance document in MySQL; every update a write on two
hosts with no shared transaction (§5 of #119's design.md sequences the index after the study DB for list fields
only); the index down or partitioned, no study opens, links included; and the same rule broken as 4. It would be the
answer for a PACS whose pixels are not on one host per study; ours are.

### 6 · What established systems do (S, §9; reading them is (I))

| | what it serves | precomputed per series? | served by |
| --- | --- | --- | --- |
| DICOMweb Retrieve Metadata | `/studies/{study}/series/{series}/metadata`: "all the Metadata for all individual Instances contained in the Series" (PS3.18 §10.4.1.1.2), an array of DICOM JSON objects (§8.6, Annex F); bulk values may be replaced by a Bulk Data URI (§10.4.3.3.2) | the standard does not say; it has no caching section (no ETag or Last-Modified in its text) | an HTTP origin, apart from the frames |
| OHIF | asks QIDO for the series, then each series' metadata, the hanging protocol's first, the rest in the background (`retrieveMetadataLoaderAsync.js`, `DicomWebDataSource/index.ts`); `staticWado` reads static responses | — | the archive; opened by link as `/viewer?StudyInstanceUIDs=` |
| Orthanc DICOMweb plugin | `SeriesMetadata`: `Full` (every instance read), `MainDicomTags` (the index's tags) or `Extrapolate` (a few instances); since 1.15 the series' JSON "gzipped and stored in attachment … everytime a series is stable" | yes, cached; the Housekeeper rebuilds after a configuration change | Orthanc's HTTP server |
| dcm4chee-arc-light | "ZIP archives with aggregated Metadata of all instances of a Series" (`dcmSeriesMetadataStorageID`), updated "on attributes update" (`dcmUpdateSeriesMetadata`) after a delay and a poll; WADO-RS metadata read from them (its source, no doc says so) | yes, rebuilt after updates | the archive's HTTP server |
| AWS HealthImaging | `GetImageSetMetadata`: "the aggregated metadata information for the image set", "compressed with gzip"; frames by `GetImageFrame`, HTJ2K, not transcoded; an update makes a new version, a `LOCKED` set takes no writes; DICOMweb `GetDICOMSeriesMetadata` too | yes, versioned with the image set | an API apart from frame retrieval |
| static DICOMweb | `studies/<uid>/series/<uid>/metadata.gz`, served by nginx with `Content-Encoding: gzip`, or S3 behind a CDN; `deduplicated/` "used for concurrent updates" | yes | any static server |
| Google Cloud Healthcare | DICOMweb series metadata; `updateMetadata` (v1beta1) a JSON Patch on a series | not published | its API |

**What they converge on** (I): the per-instance work is done once, at ingest or update, into one document per series;
it is served over plain HTTP apart from the pixels; none puts it inside the pixel channel. That is option 1 (static
DICOMweb is it exactly), or 2b with a cache (Orthanc, dcm4chee). None is a proof here: none has our session, and
none is measured on our path.

## 4 · Consistency, failure and scale, side by side

| | 1 | 2a | 2b | 2c |
| --- | --- | --- | --- | --- |
| frames and display values from different bundles | refused at the accept, refetched (#142 code 3) | cannot leave the server | as 1 | as 1 |
| a correction, same bundle, read stale | for one export's length | never | never | never |
| receiver crash mid-update | the file re-exported at start | — | — | viewing stops until restart |
| index down | links open; the list does not | the same | the same | the same |
| study DBs open at N viewers | 0 | ≤ distinct open studies, or none at +52–88 µs a read | the same | the receiver's own |
| more PACS hosts | route by Study UID, as frames | the same | the same | the same |

### 4.1 · The second copy

Option 1 writes the document twice: the page row in the study DB (its one source, #126's V1) and the file. The file
is derived, rebuilt from the row by one function, carries the row's revision and the bundle's digest, and is never
read back by the PACS. target.md's rule was written for the metadata itself, against a sidecar that could disagree with
the DB (#118); a derived file with its revision is the display metadata's cache, not a second source (I). Whether that
reading is acceptable is the owner's (§8, 2). *Updated 2026-10-26:* target.md now states the rule this way (the study
DB the one source; a derived file only if it can be regenerated from it), so option 1's file is within it.

## 5 · Not chosen, and why, in a line each

* **Display values in the `.sbnd` or in each envelope.** The bundle is immutable and a correction does not change it,
  so the values would go stale; the samples hash travels with its frame because it never changes (I).
* **Columns read at request time** (#126's B, 2.6 ms at 2 000 held, M) instead of a precomputed document: 100× the
  document's read for the same bytes; nothing gained once the document exists.
* **Loading every decoder at the HTML on a direct link** (#118's d): rejected here under the 10-19 rule "the client
  loads only what it needs". *Corrected 2026-10-26:* the owner replaced that rule on 2026-10-24 — without the codec
  (from the study index or `?codec=`) the page loads every decoder — so this is now the fallback, not a rejected option;
  on a slow link it still competes with frame 0 (§3, 3), which M2 (§7) and the prefetch evaluation measure.

## 6 · Switching later

| from → to | what changes | what is lost |
| --- | --- | --- |
| 1 → 2b | nginx's location forwards to a process; the export stops | nothing: the same document |
| 1 → 2a | the wire message, both clients, the suite, rusqlite in the server | nothing |
| 1 → 2c | the location forwards to the receiver | nothing |
| codec in the index ↔ not | an index column and the list's prefetch | (i) prefetches every decoder instead |

The document's format is the same under every carrier, and the page reads it through one function, so a carrier
change stops there (#118).

## 7 · Performance: a protocol, no number

Each pre-registered before it runs, its arms interleaved in Williams order inside every round, an A/A arm whose
spread is the noise, at least 8 paired rounds a cell after the relay's `VOID`s, cold and warm profile, 1× and 4× CPU,
at 10, 40, 100 and 200 ms. Quoted: **latency**, navigation to the first exact frame, in rt. The rig's saturation point
is named first and nothing is claimed past it ([`../rig-limits.md`](../rig-limits.md)); a real phone is outside it.

1. **M1, 1 against 2a, under loss.** `lab/page-open`: the viewer with the document from nginx against a `lab-levers`
   server sending it behind the accept (#118's smallest arm), documents of 0.5 KB and of #126's 2 000-instance CT,
   the codec from `?codec=` in both. Loss 0, 1 and 5 % iid and Gilbert–Elliott, on both planes (`--tun`). Decision,
   fixed now: 2a is preferred only if it beats 1 by more than the A/A spread at 1 % and 5 % at two or more delays.
2. **M2, the decoder on a direct link.** Arms: preload from the document (1), from `?codec=` at the HTML, every
   decoder at the HTML, warm cache; on HTJ2K, WebCodecs and dav1d, with COLDRTT's one-flight frame and a 428 KB one.
   Decision: if the document's preload costs more than the A/A spread against `?codec=`, links carry the hint.
3. **M3, the document's size on the wire** (a count): #126's CT document gzipped at nginx's level 6, whole and with
   constant values once; and the per-instance part's share.
4. **M4, the export's lag** (only under 1): in `lab/metadata-store --mode update-cost` (#144, `ebc1207`), an arm that exports the file
   after each commit; quoted: commit to the file renamed, p50 and p99, and refetches a page made when the bundle was
   replaced.
5. **M5, DB handles at many studies** (only under 2a, 2b): K = 1, 100, 1 000 study DBs, held against opened per
   read, beside the receiver's patched updates; descriptors, RSS, read p50 and p99.9. Page-cache eviction is not a
   lever (`CLAUDE.md`), so a cold read is not claimed.

## 8 · The owner's decisions

1. **The carrier**: 1 (recommended), 2a, 2b or 2c. Default: 1.
2. **The derived file against target.md's one copy** (§4.1). Default: allowed, as a derived file carrying revision
   and digest.
3. **The codec in the study index**, for a prefetch of what the list uses. Default: yes.
4. **Prefetch every decoder from the list, or only the listed codecs.** Default: the listed codecs; prefetch while
   browsing is to evaluate (decided 2026-10-24, design state §6).
5. **A direct link carries `?codec=`?** Default: no, until M2 says the document's preload costs a round trip.
6. **A correction read stale for one export's length** (§4): acceptable? Default: yes; frames are never mispaired.
7. **Full metadata (a tag panel)**: not now; when built, a second export or 2b. Default: decide with the panel.
8. **Authorization of the document and the frames**: not designed here, as #142 §9 item 6. Default: none, as today.

## 9 · Sources

Fetched 2026-10-25; quotes verbatim.

* **DICOM PS3.18**, edition 2026d, dicom.nema.org/medical/dicom/current/output/html/part18.html: §8.6 Payloads;
  §10.4.1.1.2 Metadata Resources (Table 10.4.1-2); §10.4.3.3.2 Metadata Resource Payload; Table 8.7.3-3 and Annex F
  (DICOM JSON, §F.2.6 BulkDataURI); §10.6.3.3.2 and Table 10.6.3-4, the series attributes a search returns.
* **OHIF**: docs.ohif.org/configuration/dataSources/dicom-web and /configuration/url; github.com/OHIF/Viewers
  `extensions/default/src/DicomWebDataSource/index.ts`, `utils/StaticWadoClient.ts`,
  `wado/retrieveMetadataLoaderAsync.js`, `wado/retrieveMetadataLoaderSync.js` (master). That it needs a series'
  metadata before its first image is read from the code, not stated in a doc (I).
* **Orthanc**: orthanc.uclouvain.be/book/plugins/dicomweb.html (`SeriesMetadata`, `EnableMetadataCache`),
  …/plugins/housekeeper.html, …/faq/main-dicom-tags.html, …/plugins/postgresql.html and mysql.html; the plugin's
  NEWS, versions 1.15 (2023-08-24) and 1.23 (2026-04-15): orthanc.uclouvain.be/hg/orthanc-dicomweb/raw-file/tip/NEWS.
* **dcm4chee-arc-light**: `dcm4chee-arc-assembly/src/main/resources/ldap/schema/dcm4chee-archive.schema`
  (`dcmSeriesMetadataStorageID`, `…Delay`, `…PollingInterval`, `dcmUpdateSeriesMetadata`) and
  `dcm4chee-arc-retrieve/…/RetrieveServiceImpl.java`, github.com/dcm4che/dcm4chee-arc-light (master); its
  readthedocs site answered 404.
* **AWS HealthImaging**: docs.aws.amazon.com/healthimaging/latest/APIReference/API_GetImageSetMetadata.html and
  API_GetImageFrame.html; the developer guide's get-image-set-metadata, get-image-frame, update-image-set-metadata
  and dicomweb-retrieve pages.
* **Static DICOMweb**: github.com/RadicalImaging/static-dicomweb, `file-structure.md`, its nginx page (docs/nginx.md),
  `packages/s3-deploy/README.md`.
* **Google Cloud Healthcare**: cloud.google.com/healthcare-api/docs/dicom (Retrieve transaction); REST v1beta1
  `projects.locations.datasets.dicomStores.studies.series/updateMetadata`.
* **HTTP**: RFC 9110 §8.8.3 (ETag), §13.1.2 (If-None-Match), §15.4.5 (304); RFC 9111 §5.2.2.4 (`no-cache`).
* **SQLite**: sqlite.org/wal.html §1; howtocorrupt.html §2.5; pragma.html#pragma_cache_size (default −2000, "limited
  to 2048000 bytes of memory", per open database file); uri.html (`immutable`, `mode`); tempfiles.html §2.2–2.3
  (the `-wal` file, the shared-memory file). No page states a connection's descriptor count.
* **Turso**: github.com/tursodatabase/turso README (multi-process WAL through a `.tshm` sidecar, experimental) and
  COMPAT.md, Guarantees 4. **rusqlite**: github.com/rusqlite/rusqlite README (`bundled`).
* **In this repository**: `lab/page-open/README.md` (R2, H2, PORD, COLDRTT); `docs/decode/README.md` (the WASM
  sizes); `docs/disk-layout/target.md`; #118, #119, #126, #142, #144 on their branches, named above.
