# ADR: the study index — the database the list, browse and search screens read

**Status:** proposed 2026-10-25, **theory only: nothing built, nothing timed; not accepted.** Every choice is the
owner's (§10); the owner said on 2026-10-25 that MySQL fits and that it may live on its own server over the network, to
evaluate ([`../ingest/pacs-receive-design.md`](../ingest/pacs-receive-design.md) §7). *Corrected 2026-10-26:* a study's
**revision** replaces this record's "generation", which the glossary keeps for a request's identity; the study DB is
the one **source**, not a "truth"; the "mysql master index" quotation is in pcs.pdf as updated 2026-10-23 (§2). It
names and specifies the component [`../ingest/design.md`](../ingest/design.md) §5 calls "the catalog"; where the two
differ (the engine, §5 here), this record is the newer reading. Sources are pinned in §12 and
[`study-index-sources.txt`](study-index-sources.txt). *Inferred* marks a conclusion of this record, not a source's
statement.

## 1 · On one screen

| question | recommendation | what would change it | cost of switching later |
| --- | --- | --- | --- |
| **1 Name** | **study index**; the glossary entry, and "catalog" renamed in `docs/ingest/`, on acceptance | the list screen becoming a reading *worklist* (status, assignee): that is a second thing, named separately | a rename in docs and identifiers: hours |
| **2 Content** | list-time fields only: QIDO-RS's required study and series return attributes, plus study description, Issuer of Patient ID, the study's **host**, its **revision**, an **access key**; per series the **codec**. No display metadata, no instance rows, no blobs | a screen that filters on a field not listed (add a column, backfill by reconcile) | a column: one migration + one reconcile pass, because the index is derived |
| **3 Engine** | **MySQL 8.4 LTS** (or MariaDB, whichever the operators already run) | the owner answering "one host for the foreseeable future" → an SQLite file on that host; a need for database-enforced row security → PostgreSQL | low: plain SQL, and every row is rebuilt from the study DBs by the reconcile job (§7) |
| **4 Placement** | **one index for all PACS hosts**; its server process starts on the first host and moves to its own server when a second host arrives. Viewing by direct link **does not need the index** | a second host, or the index's load measurably slowing the host's frame reads (§11) | a move: restore or rebuild elsewhere, re-point one connection string |
| **5 Sync** | the study DB is the one source. **Intent row first, study DB commit, then publish**: a per-host outbox, an upsert that replaces a study's rows whole when its **revision** is higher, retries, and a reconcile job at start and daily | many writers per study (today one receiver per host) | the outbox is one table on each host: small either way |
| **6 Access** | the browser reaches only an **HTTPS API** shaped like QIDO-RS's Search (`/studies`, `/studies/{uid}/series`) with PS3.18 JSON; authorization in the API by the study's access key; the database never reachable from outside. Budget: **≤ 50 ms p95 server time a list page** (§11); no cache tier | a measured miss of the budget (§11) | an added cache or replica: additive |
| **7 Not now** | instance rows, display metadata, thumbnails, fuzzy name matching, full-text search, replicas, a cache tier, a change feed, a patient table, QIDO-RS conformance claimed, distributed transactions (§9) | each one's trigger in §9 | each is additive |

## 2 · What is fixed, and what was read

* **The study DB is the one source.** Per study the PACS keeps one SQLite-format study DB (one row per group: study,
  series, instance, private) and one `.sbnd` per series, on a PACS host's local disk; one receiver process per host
  writes both from submission packages (one per series, or an update) and applies rare updates, each with an audit
  record ([`../ingest/design.md`](../ingest/design.md) §5; the owner's brief).
* **The PCS team's sample schema** (`doc/PACS/db/deck.db` at DECK_WebTransport `a65abe2`, read with Python's
  `sqlite3`, read-only) has tables `E` (exam/study), `S` (series), `I` (instance), `F` (frame), `G`/`M` (subsets of a
  series' frames, *inferred* from their foreign keys). Each level holds its group's key-value blob (`edckv`, `sdckv`, `idckv`, `pdckv` for private), its BLAKE3
  (`eblake3` …), and copied-out columns: patient name, IDs (`pide`, `pidr`), birth date, sex, study date, description,
  modalities; series number, class, modality, description, icon, frames; instance pixel attributes (rows, columns,
  bits, photometric code). The path in the brief, `doc/subprojects/PACS/db/`, is not where it is at `a65abe2`.
* **The PCS's own words, as read.** `DICMele2deck/pcs.pdf` at `a65abe2` says the PACS "receives key-value metadata
  already formated for inclusion into a sqlite database". The brief's quotation of pcs.pdf — server-side processing
  "updates the study sqlite database and the mysql master index" — is **not in the copy read** at `a65abe2`.
  *Corrected 2026-10-26:* it is in pcs.pdf as updated 2026-10-23, quoted verbatim in
  [`../ingest/pacs-receive-design.md`](../ingest/pacs-receive-design.md) §1. The brief's README `dicm2deck/dicm/capi/dicm2decksqlite3/README.md` **does not exist at
  `a65abe2`**, so the "consolidated into another database, multi-core, distributed, optimised for concurrency"
  statement is *unconfirmed*; the nearest read is `doc/dcmtk-storescp/README.md`: the parser "consolidates the sop
  sqlite into a study sqlite". Neither file at `a65abe2` mentions MySQL.

## 3 · The name

**What the standards and the reference archives call it.**

| source | its word | what it denotes |
| --- | --- | --- |
| DICOM PS3.4 §C.1.3 | **Query/Retrieve Information Model** | the abstract model "about the Attributes of a number of stored Composite Object Instances" an SCP answers C-FIND against; levels Patient, Study, Series, Instance (§C.3: Patient Root, Study Root) |
| DICOM PS3.18 §10.6 | **Search Transaction** (QIDO-RS), on an **origin server** | the resources All Studies, Study's Series, All Series … (Table 10.6.1-4) |
| IHE RAD TF-1 Rev 23.0 §2.4 | the **Image Manager/Image Archive** actor | grouped by rule ("the Image Archive … shall be grouped with the Image Manager"); "the Image Manager provides necessary information updates to the Image Archive to support its Query/Retrieve functionality … outside the scope of the IHE Technical Framework". RAD TF-2 §4.14: Query Images [RAD-14] is answered by the Image Archive. No IHE actor is the index alone |
| Orthanc book, "Orthanc storage" | **the Index** (beside the **Storage Area**) | "a summary of all the DICOM resources in a SQL database … mandatory to rapidly provide information when browsing"; SQLite by default, PostgreSQL, MySQL or ODBC by plugin |
| dcm4chee-arc-light 5.35.2 | the archive's database; tables `patient`, `study`, `series`, `instance`, and **`study_query_attrs`**, **`series_query_attrs`** | no single product word was found in the source read (*unconfirmed* in its documentation) |

**Recommendation: "study index".** It is Orthanc's word for the same split (an index beside a storage area), it says
its level, and it collides with no DICOM or IHE term read. *Inferred.*

**Confusable terms, to keep free:**

* **Modality Worklist** (PS3.4 Annex K, §K.6.1.2): scheduled procedure steps queried *by the modality*. PS3.4 §K.1.1
  also calls a reporting station's list of studies "waiting to be reported" a **worklist**. The list screen may grow
  into that (status, priority, assignee); it would then be a worklist built on the study index, named separately.
* **"Master index"** (the PCS team's phrase, as quoted): in IHE, a master patient index is a patient-identity
  service (the ITI domain's, not read here). The study index holds patient identifiers but reconciles none.
* **"Catalog"**: this repository's own earlier word ([`../ingest/design.md`](../ingest/design.md) §5), for the same
  component. One concept, one name ([`../../CLAUDE.md`](../../CLAUDE.md) §Names): renamed on acceptance.
* **"Study index" already names something here**: [`../FIXTURES.md`](../FIXTURES.md) §From DICOM uses it for a proposed
  `study.json` listing one study's series. That file is unbuilt; on acceptance it needs another name (a *study
  manifest*, say), or this component does.
* **"Index"** alone: the `.sbnd`'s frame index ([`../disk-layout/target.md`](../disk-layout/target.md)) and a
  frame's display index. Always "study index" in full.
* **Registry**, **directory**: IHE's XDS-I uses a document registry; DICOM's DICOMDIR is a media directory. Neither
  is this.

## 4 · Content: what the list screens and common searches need

**Grounding.** PS3.18 Table 10.6.1-5 lists the attributes an origin server *shall* match on; Tables 10.6.3-3 and
10.6.3-4 those it *shall* return for each matching study and series (the Note: "consistent with those required in
[IHE RAD TF-2] Table 4.14-1"). Orthanc stores a fixed list of "main DICOM tags" per level "to avoid accessing the
storage". dcm4chee keeps every level's full attributes in a blob (`dicomattrs_fk`) plus copied-out columns.

**Per study** (one row, key Study Instance UID):

| field | QIDO-RS match / return | Orthanc main tag | dcm4chee column | `deck.db` `E` | why here |
| --- | --- | --- | --- | --- | --- |
| Study Instance UID (0020,000D) | match · U | yes | `study_iuid` | `euid` | key |
| Patient's Name (0010,0010) | match · R | yes | `person_name` + `soundex_code` | `pname` | the main search |
| Patient ID (0010,0020) | match · R | yes | `patient_id.pat_id` | `pide`, `pidr` | exact search |
| Issuer of Patient ID (0010,0021) | — (RAD-14 Enterprise Identity option) | via OtherPatientIDs | `patient_id.entity_id` | — | *inferred*: many hospitals' IDs collide without it |
| Patient's Birth Date, Sex (0010,0030/0040) | return · R | yes | `pat_birthdate`, `pat_sex` | `pbirth`, `psex` | the list row |
| Study Date, Time (0008,0020/0030) | match · R | yes | `study_date`, `study_time` | `edate` | sort, range search |
| Accession Number (0008,0050) | match · R | yes | `accession_no` | `ean` (*inferred* from the name) | exact search |
| Study ID (0020,0010) | match · R | yes | `study_id` | `eid` (*inferred*) | returned |
| Referring Physician's Name (0008,0090) | match · R | yes | `ref_phys_name_fk` | — | search |
| Modalities in Study (0008,0061) | match · R | — (computed) | `study_query_attrs.mods_in_study` | `emods` | filter, the list row |
| Study Description (0008,1030) | — | yes | `study_desc` | `edesc` | every list shows it |
| Number of Study Related Series, Instances (0020,1206/1208) | return · R | computed | `study_query_attrs.num_series`, `num_instances` | — | returned |
| **host** | (Retrieve URL is derived from it) | — | `storage_ids`, `ext_retrieve_aet` | — | where the study DB and its `.sbnd`s live |
| **revision** | — | — | `version` | — | the sync's ordering (§7) |
| **access key** | — | — | `access_control_id` | — | authorization (§8) |
| updated at | — | — | `updated_time` | — | reconcile, support |

**Per series** (one row, key Series Instance UID, with its study's UID):

| field | QIDO-RS | Orthanc | dcm4chee | `deck.db` `S` | why here |
| --- | --- | --- | --- | --- | --- |
| Series Instance UID (0020,000E) | match · U | yes | `series_iuid` | `suid` | key |
| Modality (0008,0060) | match · R | yes | `modality` | `smod` | filter, the row |
| Series Number (0020,0011) | match · R | yes | `series_no` | `snumber` | order |
| Series Description (0008,103E) | return · C, if known | yes | `series_desc` | `sdesc` | the row |
| Number of Series Related Instances (0020,1209) | return · R | computed | `num_instances` | — | returned |
| number of frames | — | NumberOfFrames (instance) | — | `sframes` | *inferred*: after the PCS's conversion to enhanced multiframe a series is few instances of many frames; the viewer's unit is the frame |
| **codec** (`HTJ2`, `AV01`) | — | — | `tsuid` (the transfer syntax) | — | which decoder module the client loads; it is the `.sbnd` header's field ([`../disk-layout/target.md`](../disk-layout/target.md)) |

**Not listed, on purpose:** Retrieve URL and Instance Availability are derived from the host at response time;
Timezone Offset, Performed Procedure Step Start Date/Time and the Request Attributes Sequence are QIDO-RS "C, if
known", and no list screen here shows them (add when one does); Body Part Examined is an Orthanc main tag and a
dcm4chee column, and the first candidate to add.

**Where each series lives.** At the study level: a study DB is one file on one host, and its `.sbnd`s beside it, so a
series' host is its study's (*inferred* from §2). A per-series host would be one column more, and is needed only if a
study's series are ever split across hosts (§10, Q4).

**The boundary with display metadata.** The study index holds **list-time fields only**, plus the per-series codec,
because the client can pick its decoder module before it opens the series and a list may mark a series it cannot
decode. Display metadata (window, pixel attributes, per-frame values) stays with the series on its host. Three
reasons: it is needed only once the series is opened, from the host that serves its frames; a second copy has to be
kept true against the pixels it describes; and putting it in the index would make the index necessary for viewing,
which §6 avoids. *Inferred.* Where display metadata lives on the host is the parallel row's question.

**Name matching.** PS3.4 §C.2.2.2.1: matching is case-sensitive except for PN, where "an application may perform
literal matching that is either case-sensitive, or that is insensitive to some or all aspects of case, position,
accent"; §C.2.2.2.4: PN wild-card matching "is implementation dependent and shall be specified in the Conformance
Statement". The proposal: case- and accent-insensitive prefix matching on the whole name (`PÉREZ^J*` finds
`Perez^Juan`), through the column's collation (§5). Spanish names make the accent rule matter. *Inferred.*

**Size, arithmetic (not measured).** About 0.3–0.5 KB of fields a study and 0.1–0.2 KB a series, ~8 series a study,
with five or six secondary indexes: roughly 2–4 KB a study, so 10⁶ studies in 2–4 GB, which a small server holds in
memory.

## 5 · Engine

The workload: simple filtered, sorted, paged queries; reads far more frequent than writes; writes rare, small,
idempotent, and tolerant of seconds of delay. Every engine below does this. What separates them is below.

| | MySQL 8.4 LTS / MariaDB | PostgreSQL 18 | SQLite, one file per host |
| --- | --- | --- | --- |
| licence | MySQL: GPLv2 with the Universal FOSS Exception, or commercial ([`../ingest/design.md`](../ingest/design.md) §12); MariaDB: GPLv2 server, LGPL C/Java/ODBC connectors; "connecting to a remote service that runs MariaDB … is also free" (MariaDB licensing FAQ) | PostgreSQL licence, BSD-like | public domain |
| accent- and case-insensitive name match | **the default collation**, `utf8mb4_0900_ai_ci` ("accent-insensitive and case-insensitive"), usable by an index for a prefix `LIKE` (*inferred* from MySQL's usual index use; not read) | a nondeterministic ICU collation; `LIKE` supports them **since 18** (17's page: "do not support nondeterministic collations"); "a performance penalty"; or a normalised extra column | `NOCASE` folds ASCII only (*unconfirmed*: not read); a normalised extra column |
| read replicas | asynchronous by default; semi-synchronous, group replication | hot standby: read-only queries on a standby | none; copies by `sqlite3_rsync` |
| row security in the database | none found (*absence not confirmed*) | row security policies | none |
| networked clients | yes | yes | "SQLite will work over a network filesystem" but sends many networked clients to a client/server engine; WAL "does not work over a network filesystem" |
| who runs it already | the owner's and the PCS team's choice, as briefed | — | the study DBs |
| reference archives | dcm4chee (a `mysql` and a `mariadb` script), Orthanc plugin | dcm4chee, Orthanc plugin; Orthanc's "recommended setup for best performance" names PostgreSQL | Orthanc's default index |

**Recommendation: MySQL 8.4 LTS, or MariaDB if that is what the operators run.** For this workload the deciders are
who operates it and how names match. The owner and the PCS team already name MySQL; its default collation gives the
matching PS3.4 allows for PN without extra work. Two of the reasons [`../ingest/design.md`](../ingest/design.md) §5
gave for PostgreSQL were `jsonb` with GIN indexes and partial indexes. They mattered for a catalog that held more
than list fields. The boundary in §4 removes that need. Licence does not decide: the product reaches the server over
the network, and the Rust client crate's licence is still to check (*not read*). *Inferred.*

**What would change it.** (a) One host for the foreseeable future: an SQLite study index on that host is less to run
(no server, no credentials, no network). The same schema, accent folding then done in a normalised column. (b) A
requirement that the database itself enforce per-row access: PostgreSQL's row security. (c) A measured miss of §11's
budget that a replica would fix: both engines have one.

**Switching cost is low by construction.** The index is derived. A new engine is filled by the reconcile job (§7)
from the study DBs, and the code touches it through a handful of plain-SQL statements: one upsert per study, about
four queries.

**Others weighed, and not worth it now.** A search engine (inverted index, fuzzy matching): no list screen asks for
relevance ranking. A document store: the rows are flat. libSQL's server: weighed in
[`../ingest/design.md`](../ingest/design.md) §5; its maintainer's effort has moved elsewhere.

## 6 · Placement and scale

**One study index for many PACS hosts.** Each list or search is one query on one server. The alternative is a
per-host index and a fan-out API, which merges, sorts and pages across hosts: a page then waits on the slowest host
and fails with any one of them. With one host the two are the same thing. *Inferred.*

**Where it runs.** The engine's process starts on the first PACS host, on a local socket. It moves to its own server
when a second host arrives, or when §11 shows its load slows that host's frame reads. Orthanc's scalability page
asks for 1–4 ms between the application and its database server, "in the same datacenter". For the API, that means
running beside the index, not beside the browser. Co-location adds no new class of exposure: the host already holds
every study DB, with all of their identifiers. *Inferred.*

**When the index is unreachable.** Lists and searches fail with a clear error; nothing else stops. A study can still
be viewed by direct link if two things hold, both proposed here:

1. **The link names the host** (`https://<host>/…/<Study>`), not only the study, so nothing has to look it up.
2. **The host authorizes the view without the index:** a short-lived token, signed by the API and checked by the host
   with a key it holds.

The host reads its own study DB for display metadata (§4). Serving a study by its UIDs on a host is itself unbuilt:
today a server process serves one series (`--series`; [`../FIXTURES.md`](../FIXTURES.md) §From DICOM, "Several series of
one study — proposed").

**The receivers keep writing when the index is down.** The study DB commits are independent of it. The outbox (§7)
holds what is owed, and the index catches up when it returns.

## 7 · Sync with the study DBs, without a distributed transaction

There is no transaction across a study DB and the study index; none is needed, because the index is derived. Even
within one host SQLite gives none for this pair in WAL mode: "if the journal_mode is WAL, then transactions continue
to be atomic within each individual database file" only (SQLite, ATTACH).

**The order the receiver keeps** (per study update; one receiver per host, so one writer per study):

1. **Intent.** Upsert `(study_uid, revision = g + 1)` into the host's **outbox** (one small SQLite file per host)
   and commit.
2. **Commit.** Commit the study DB with revision `g + 1` and the update's **audit record**, in one SQLite
   transaction. The audit record lives with the source, not in the index.
3. **Publish**, by a publisher task on the host, for each outbox row: open that study DB, read its revision and
   list-time fields, and in one index transaction **replace the study's row and all its series rows if the stored
   revision is lower**. Then delete the outbox row.

A crash after 1 leaves an intent: publish reads the study DB, whose revision is either `g + 1` (published) or `g`
(already published, a no-op), and the intent goes. A crash after 2 is the same case. A failed publish keeps its row
and retries with backoff. Duplicates and reordering are harmless, because the upsert compares revisions, so each
step is **idempotent, keyed by the Study Instance UID**. Replacing a study's series rows whole avoids a per-series
merge. *Inferred.*

**Reconcile**, at publisher start and daily: for its host, compare each study DB's `(study_uid, revision)` with the
index's rows for that host, publish what is behind, and delete index rows whose study DB is gone. It opens every
study DB, which is right for a background job and wrong for a list request. It also rebuilds a lost or restored
index: a rescan, not lost data ([`../ingest/design.md`](../ingest/design.md) §5).

**Corrections propagate through the same path.** A patient-name correction for one study is an update to that study
DB (audited, revision + 1), then published. A correction for one patient across studies uses the index only to
find them (`patient_id`, issuer). It then applies the update to each study DB through its host's receiver, and each
republishes. The index is never edited directly, or it would disagree with its source. IHE's Patient Information
Reconciliation profile gives this responsibility to the Image Manager ("to ensure that the patient information is
updated … when they are retrieved", RAD TF-1 §4). Updates from client applications later go through the receiver as
well, so they need no second path.

**Deleted studies:** the receiver writes an intent; publish finds no study DB and deletes the index rows.

## 8 · Access

* **Never the database from the browser.** The browser calls an HTTPS API; only the API holds database credentials,
  on a network the internet cannot reach.
* **The API's shape: QIDO-RS's Search resources and PS3.18 JSON**, a subset: `GET /studies?…&limit=&offset=`,
  `GET /studies/{StudyInstanceUID}/series`, the keys of §4, and the codec and host as extra fields. It costs nothing
  over a bespoke shape and leaves conformance a later choice. No conformance is claimed (§9). PS3.18 §8.3.4.4 warns
  that offset paging "may be inconsistent" if results change between pages; that is acceptable for a list.
* **Authorization in the API, per study,** by the access key in the row: who may see which key is the owner's
  (§10, Q5). The API adds the key filter to every query; it never comes from the client. Database row security
  (PostgreSQL) would be a second wall, not the first.
* **Identifiers in transit and at rest:** TLS to the API; `Cache-Control: no-store` on every response that carries
  identifiers, so a phone's disk keeps none (§10, Q7). Identifiers never go into URLs beyond the search keys the user
  typed, and those stay out of access logs (*inferred*: a log is a copy).
* **Audit of reads:** an update is audited (§7). Whether every list and search is also recorded is the owner's
  (§10, Q6). IHE's audit trail profile (ITI domain) defines such records; it was not read for this record.
* **Latency budget, a list page** (*inferred*; checked by §11). On a phone the round trip dominates: one HTTPS request
  on an open connection: idle 17–52 ms plus 0–100 ms to the region, 0.1–0.5 s loaded on Wi-Fi and 0.4–1.9 s on
  cellular ([`../transport/link-conditions.md`](../transport/link-conditions.md)). A page of 25–50 studies is ~10–20 KB of JSON
  before compression. The server's share should stay small against that: **≤ 50 ms p95 from request to last byte at
  the API, ≤ 10 ms p95 for the query**. One request a page, never one per row; the series of a study fetched when it
  is opened.
* **Caching:** none added. The engine's buffer pool holds the whole index (§4's size). A series list can carry an
  `ETag` of the study's revision for a cheap `304` revalidation, if Q7 allows the response to be kept.

## 9 · What is not needed now

| not now | why | what would bring it |
| --- | --- | --- |
| instance-level rows | no list screen shows instances; the study DB has them | an instance-level search (QIDO-RS's All Instances) |
| display metadata, thumbnails, icons in the index | §4's boundary; `deck.db` keeps icons per series (`sicon`) in the study DB, where they can stay | a list screen with thumbnails: served by the host, keyed by revision |
| fuzzy or phonetic name matching | dcm4chee keeps soundex codes; PS3.18's `fuzzymatching` is optional | users missing studies by spelling |
| full-text search | no screen asks for relevance | a free-text search box |
| read replicas, a cache tier | one server holds the index in memory | §11's budget missed under load |
| a change feed | the revision and the outbox suffice for one index | a second consumer of changes |
| a patient table, merges | QIDO-RS's top level is the study; a correction finds studies by patient ID | patient-level screens, or IHE PIR merges at scale |
| reading-worklist fields (status, priority, assignee) | a different concept (§3) | the worklist itself |
| QIDO-RS conformance | no third-party viewer queries it | an external viewer or a DICOMweb integration |
| distributed transactions | §7 makes them unnecessary | — |
| per-series host | a study is on one host (§4) | splitting a study across hosts (Q4) |

## 10 · Questions only the owner can answer

Each with the default this record assumes.

1. **How many PACS hosts within a year?** Default: more than one, so MySQL; if one, SQLite on it (§5 (a)).
2. **MySQL or MariaDB?** Default: whichever the operators run; MySQL 8.4 LTS otherwise.
3. **The name.** Default: *study index*; `FIXTURES.md`'s `study.json` renamed *study manifest*, "catalog" renamed.
4. **Is a study always on one host?** Default: yes, so the host is a study-level field.
5. **What decides who sees a study** (the access key): the sending site, the institution, a group? Default: the site
   the PCS sent it from.
6. **Are list and search reads audited?** Default: yes, at the API, one record per request with the user and the
   query, without the results.
7. **May list responses be cached on the device?** Default: no (`no-store`).
8. **The latency target for a list page on a phone.** Default: §8's server budget; the network's share is not ours.
9. **The PCS team's "master index" and "consolidated database":** is either a second index the PACS must feed, or
   this one? Default: this one; nothing else is fed.

## 11 · Measurement protocol (pre-registered, not run)

**Claim under test:** a list page meets §8's budget on the recommended engine, on the host that serves frames,
without slowing the frame reads.

* **Data.** A synthetic index of 10⁴, 10⁵ and 10⁶ studies with ~8 series each, from a seeded generator. It mixes
  accented and unaccented names, and the study dates follow a skewed distribution, recent dates more frequent. No
  real identifiers.
* **Queries, a fixed mix.** The newest 50 studies; a patient-name prefix, accented and not; a patient ID exactly; an
  accession number exactly; a date range of 7 days with a modality; one study's series. Each is run with
  `limit=50`, and at `offset=0` and `offset=1000`.
* **Arms, interleaved in every round** ([`../../CLAUDE.md`](../../CLAUDE.md) §Measurement): MySQL 8.4, PostgreSQL 18,
  SQLite with a normalised name column, all behind the same API binary; each arm's settings printed. A/A: MySQL
  twice. ≥ 12 rounds per size, with the cold buffer forced by restarting the engine, never by page-cache eviction.
* **Metrics.** Query time and API request-to-last-byte time, as latency at a concurrency of 1, then the concurrency
  where p95 doubles; the host's saturation point stated, nothing claimed past it. With the API on the PACS host,
  the frame-read p95 of a concurrent fill (`lab/server-load/`), with and without list load.
* **Correctness, mutated.** Every query's result set checked against a brute-force filter in the generator; a
  deliberately broken collation (`utf8mb4_bin`) must fail the accented-name check. A publisher test kills the
  receiver between steps 1–2 and 2–3 of §7 and must find the index at the study DB's revision after restart; an
  update forced out of order must leave the higher revision.
* **Decision rule, before any data.** The recommended engine stands if, at 10⁶ studies, every query's p95 is
  ≤ 10 ms warm and the API's ≤ 50 ms, and the frame-read p95 under list load is within the A/A spread. If MySQL misses
  and another arm meets it, that arm is recommended instead. If the frame reads slow beyond the A/A spread, the index
  moves to its own server.

## 12 · Sources

Fetched 2026-10-25; URLs and full sha256 in [`study-index-sources.txt`](study-index-sources.txt). Nothing fetched is
committed.

| claim | source |
| --- | --- |
| Q/R information model, levels, roots | DICOM PS3.4 2026d §C.1.3, §C.3.1–C.3.2 |
| PN matching case/accent rules; wild-card PN implementation-dependent | PS3.4 2026d §C.2.2.2.1, §C.2.2.2.4 |
| Modality Worklist; "worklist" for a reporting station | PS3.4 2026d Annex K: §K.1.1 and its Note, §K.6.1.2 |
| QIDO-RS resources, required levels and matching attributes | DICOM PS3.18 2026d §10.6, Tables 10.6.1-4, 10.6.1-5 |
| study and series return attributes | PS3.18 2026d §10.6.3.3.1–2, Tables 10.6.3-3, 10.6.3-4 |
| `limit`/`offset` and their inconsistency under change | PS3.18 2026d §8.3.4.4 |
| Image Manager/Image Archive grouping; internal updates out of scope | IHE RAD TF-1 Rev 23.0 (2025-08-08) §2.4 (Product Implementations) |
| patient updates the Image Manager's responsibility | RAD TF-1 Rev 23.0 §4 (Patient Information Reconciliation) |
| RAD-14 answered by the Image Archive; Enterprise Identity option | RAD TF-2 Rev 23.0 §4.14.2, §4.14.4.1.2.1 |
| Orthanc's Index and Storage Area; engines | Orthanc book, "Orthanc storage" (§Orthanc Index) |
| Orthanc's main DICOM tags per level | Orthanc book, "Main DICOM Tags in DB" (Orthanc 1.12.5+) |
| PostgreSQL recommended for large databases; 1–4 ms to the database | Orthanc book, "Scalability" (§Recommended setup, §Latency) |
| dcm4chee's tables, `access_control_id`, `version`, `tsuid`, query-attribute tables, engines | dcm4chee-arc-light 5.35.2 `dcm4chee-arc-entity/src/main/resources/sql/psql/create-psql.sql`; the `sql/` directory's eight engine folders |
| `utf8mb4_0900_ai_ci` accent- and case-insensitive, the default | MySQL 8.4 manual §12.10.1 (Unicode character sets), §12.3.2 (server character set) |
| asynchronous replication by default | MySQL 8.4 manual, Chapter 19 (Replication) |
| 8.4 is an LTS release | MySQL 8.4 manual §1.3 |
| MariaDB server GPLv2, LGPL connectors, remote use free | MariaDB licensing page |
| `LIKE` with nondeterministic collations since 18, their penalty | PostgreSQL 18 manual §9.7, §23.2.2.4; PostgreSQL 17 §9.7 |
| hot standby; row security policies; licence; 18.6 current | PostgreSQL 18 manual §26.4, §5.9; licence page; versioning page |
| WAL not over a network filesystem; client/server for many clients | SQLite `wal.html`, `whentouse.html` |
| ATTACH: atomic across files only outside WAL | SQLite `lang_attach.html` |
| the PCS's schema and statements | opendicom/DECK_WebTransport `a65abe2`: `doc/PACS/db/deck.db`, `DICMele2deck/pcs.pdf`, `doc/dcmtk-storescp/README.md` |

**Not verified:** the brief's pcs.pdf and `dicm2decksqlite3` quotations (§2); a product word for dcm4chee's database
in its documentation; whether MySQL uses an index for a prefix `LIKE` under `utf8mb4_0900_ai_ci` (§11 checks it);
SQLite `NOCASE`'s folding; IHE ITI's master patient index and audit trail; the Rust MySQL client crate's licence.
