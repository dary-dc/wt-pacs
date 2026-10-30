# Ingest design — from the parser to the PACS

*Queue row 153 INGESTDESIGN, 2026-10-11. Theory only: read from sources (§13), nothing built, nothing timed. It
compares options and recommends; every choice is the owner's (§10).*

**Corrected 2026-10-26**, against [`pacs-receive-design.md`](pacs-receive-design.md), which holds the decisions since:

* **Scope starts at the PACS** (decided 2026-10-24). Coding the frames, packing the `.sbnd`, the outbox and the upload
  are the **PCS's side** (the hospital-side component, another team's); this file's "site" is relabelled the PCS. What
  the two sides share is the **submission package**: one file per series (or a small update package), its XXH3 in its
  name (decided 2026-10-25); this file's "archive" is that package.
* **Hashes the PACS checks are XXH3, not BLAKE3** (decided 2026-10-24/25). The group files are named by XXH3; §6's
  identity argument for BLAKE3-256 no longer holds (corrected there).
* **"Catalog" is the study index** ([`../adr/study-index.md`](../adr/study-index.md), proposed: MySQL, list fields
  only); "study database" is the **study DB**; a study's **revision**, not "generation" (the glossary's generation is a
  request's identity); the study DB is the one source, not a "truth".
* **Superseded, not rewritten here:** §5's rebuild-and-rename of a study DB (an update replaces the row in place, with an
  audit record, decided 2026-10-24/25) and §8's key and publish sequence (the receiver's steps, design state §3).

**The question.** Today's proposal — the owner's C parser writes a directory per instance; a Rust ingest at the PCS
hashes, codes exactly, checks and compresses; an outbox; TCP to the PACS; the PACS checks, writes the image layout and
builds one SQLite database per study; a study-index server indexes the studies — grew out of what exists. This file weighs
each of its parts against the alternatives. The plan it extends is [`../FIXTURES.md`](../FIXTURES.md) §A compiled
ingest at the site; the link itself is row 154's (LINKTCP); the parser's output contract is
row 155's (INGESTRS1: the row's brief in [`../av1/queue.md`](../av1/queue.md)).

**The parser was read only through row 155's brief**, which reads its public source: one run per SOP instance, a
directory per instance, group files named by their BLAKE3-256 (XXH3 since 2026-10-24/25), one raw file per frame. That it has a key-value stream
output and an HTJ2K output on the grok encoder is from this row's brief, not read.

## Contents

1. [The answer in plain words](#1-the-answer-in-plain-words)
2. [(a) Where frames are coded](#2-a-where-frames-are-coded)
3. [(b) How the parser hands over](#3-b-how-the-parser-hands-over)
4. [(c) What travels](#4-c-what-travels)
5. [(d) Where the layout, the study DBs and the study index are built](#5-d-where-the-layout-the-study-dbs-and-the-study-index-are-built)
6. [(e) The integrity chain and what each hash costs](#6-e-the-integrity-chain-and-what-each-hash-costs)
7. [(f) Metadata compression](#7-f-metadata-compression)
8. [(g) Recovery](#8-g-recovery)
9. [(h) Prior art](#9-h-prior-art)
10. [The owner's decisions](#10-the-owners-decisions)
11. [Streaming the pack](#11-streaming-the-pack)
12. [The PACS receiver and builder](#12-the-pacs-receiver-and-builder)
13. [Sources](#13-sources)

## 1. The answer in plain words

* **Today's proposal holds on most axes, and the one it leaves open matters most: when a series is complete.** DICOM
  has no "series ended" marker. A bundle per series can be built only once its instances stop arriving; the AWS edge
  gateway closes a batch when the modality's association ends (§9). Until that rule is chosen, (c) cannot pick its
  unit.
* **(a) Code frames at the PCS.** Raw frames with zstd cost 1.0–1.8× HTJ2K's bytes on the link (median ≈ 1.4× over
  seven images, one source; JPEG 2000 1.2–1.7× gzip in Clunie's 3 679 images). They also move the encoder's CPU to the
  cloud, where it is paid. Coding inside the parser in C ties the product's bytes to grok, AGPL v3, and to a second
  HTJ2K encoder whose output is not OpenJPH's.
* **(b) Keep the directory.** It is a crash checkpoint, inspectable, and a process boundary between a C parser reading
  untrusted files and the ingest. Its cost is one write and one read a frame; P-STAGE predicts under 5 % for HTJ2K.
  A pipe or a library call buys at most that 5 %, and the library call loses the boundary.
* **(c) Send per series: the `.sbnd` plus the series' metadata groups, as one package.** The bundle is already the
  server's unit, and its coded frames are already checked. The groups are what the PACS needs to build the study's
  DB. One package per series gives one upload to resume and one unit to refuse.
* **(d) The PACS builds the layout and the study DB; the study index is derived from them.** The study DB is
  the one source. The study index holds one row per study, written after that study's DB is published, and keyed by
  Study Instance UID with a revision number. A rebuilt database re-registers by the same upsert, so the whole study index
  can be rebuilt by scanning. SQLite cannot query across thousands of files (ATTACH: 10 by default, at most 125), so
  the study index is needed. **PostgreSQL** is recommended: PostgreSQL licence, `jsonb` with GIN indexes, partial indexes,
  both reference archives support it. libSQL's server holds many SQLite databases in one process and keeps one
  dialect, but its maintainer has moved its effort to a pre-1.0 rewrite.
* **(e) The owner's point holds, and cost does not decide it.** A metadata group is kilobytes, so any hash of it costs
  microseconds against a frame's milliseconds. What decides is what each hash proves. The PACS decompresses the
  metadata to build the database, so a hash of the original, checked after decompression, proves parser → PACS end to
  end. A hash of the compressed bytes proves only the link. Reuse the parser's group hashes (XXH3 since 2026-10-24/25) for that, once row
  155's open point (2) is settled: three of its four groups hash a length that differs from the bytes written when
  text is converted. The frame's XXH3-64 already proves encoder input → screen. A hash of the coded bytes would let
  the PACS check transit and storage without decoding; that is row 123's open decision (2), not this row's.
* **(f) Compress a series' groups together; a dictionary only if each group must stand alone.** zstd with a trained
  dictionary gains ×1.5 to ×4.7 on small records (300 B to 6 KB). It needs ≥ 100 samples and a dictionary both ends
  hold. Compressing the series' groups as one stream catches the repetition across instances without one. The metadata
  is small against the pixels either way.
* **(g) Recovery: idempotent by SOP Instance UID and content hash, resumable by offset, published by rename.** Every
  archive in §9 keys duplicates by the instance UID and differs only in what a changed duplicate does. That is the
  owner's call (§10).

## 2. (a) Where frames are coded

| | at the PCS, by the Rust ingest (proposed) | inside the parser, in C | in the cloud |
| --- | --- | --- | --- |
| encoder | OpenJPH, pinned, the bytes today's ingest writes (row 155's parity) | grok, AGPL v3 (§13); a second HTJ2K encoder | any, paid per CPU-second |
| bytes on the link | HTJ2K's | HTJ2K's | raw + zstd: 1.0–1.8× HTJ2K's (below) |
| CPU | the PCS's (the owner: free) | the PCS's | the PACS operator's |
| exactness check | decode-back at the PCS, before anything leaves | needs a decoder in the parser, or the ingest re-decodes | decode-back in the cloud; end to end only if the PCS hashed the raw samples first |
| what the check proves | the coded frame equals the encoder's input, at the source | the same, if a check is added | the coded frame equals what arrived; the PCS's raw hash then proves what arrived equals what was read |

**Bytes.** No paper puts HTJ2K and zstd on the same medical images. Two sources bound the ratio:

* **Clunie, SPIE MI 2000:** 3 679 images, raw over compressed. JPEG 2000 5/3 compresses 3.81× overall and gzip 2.39×,
  so JPEG 2000 is 1.59× smaller (CT 1.72×, MR 1.58×, CR 1.67×, DX 1.37×, MG 1.44×, US 1.17×; this file's
  arithmetic). HTJ2K is 6.6–8.2 % larger than JPEG 2000 Part 1 lossless in its authors' white paper. That makes HTJ2K
  about 1.08–1.61× smaller than gzip (inference). zstd beats gzip by an amount not measured on these images.
* **pappuks/medical-image-codec**, one author, not peer-reviewed: OpenJPH against raw zstd at level 3 on the same
  seven 16-bit images. HTJ2K is 0.99× (CT 512²) to 1.84× (CR) smaller, 1.27–1.48× on the rest. Its two columns come
  from different runs.

**So raw + zstd costs about 1.0–1.8× HTJ2K's bytes on the link, ≈ 1.4× typically.** At the 13.6 MB one HTJ2K
mammogram takes at an assumed 2:1 (3328×4096, 16-bit), that is ≈ 5.4 MB more per frame; on a 100 Mbit/s uplink, 0.4 s more per
frame (arithmetic). zstd's own speed is not the issue: 510 MB/s at level 1 on Silesia.

**CPU.** INGESTPROFILE measured today's Python HTJ2K ingest at 33–906 ms of CPU a frame, 15–43 % of it the encoder.
Intel's AVX-512 OpenJPH encodes a 512² CT in 1.3 ms and a 2394×3062 mammogram in 29.3 ms on one Xeon core. Coding in
the cloud moves that time onto the operator's bill and saves none of the PCS's hashing. AWS HealthImaging does exactly
this: it transcodes to HTJ2K on import and checks a CRC32 of each frame taken before the encode against the decoded
result (§9). The check is 32 bits, which [`../adr/exactness-in-production.md`](../adr/exactness-in-production.md) §7
rejects at this scale.

**In the parser.** grok is AGPL v3. Shipping it inside the PCS's binary puts the binary under its terms, which is a
licence question for the owner (§10, 3). It also adds a second encoder whose bytes differ from OpenJPH's served profile
(RPCL, five decompositions, 64² blocks, [`../codecs/htj2k.md`](../codecs/htj2k.md)). Row 155's byte-identity parity
then fails by construction and a profile check takes its place. And the decode-back check would have to be written in C.

**Recommended: at the PCS, by the Rust ingest.** It is the only option where the link carries the fewest bytes, the
CPU is free, and the check runs before anything leaves.

## 3. (b) How the parser hands over

| | a directory (the start, decided) | a stream (the key-value output) | a library call |
| --- | --- | --- | --- |
| cost a frame | one write and one read; P-STAGE predicts < 5 % of HTJ2K's, < 0.1 % of AV1's | one copy through a pipe | none |
| after a crash | the directory is a checkpoint: restart at the first instance without a finished marker | the instance is re-parsed | the instance is re-parsed |
| a parser fault on a bad file | its process dies; the ingest refuses that instance by name | the same | the ingest dies with it: C on untrusted input in the same address space |
| inspectable | yes, by hand | no | no |
| needs from the parser | nothing new | a framing the ingest parses | a C API (open, next frame, attributes, close) and a licence that allows linking |

**Recommended: the directory.** Keep it unless P-STAGE measures its share over 5 %. If it does, the pipe keeps the
process boundary and costs one copy; the library call loses the boundary. One thing the directory needs that row 155
does not name: a marker that an instance is complete, written by the parser last (an empty file, or the instance
group itself if the parser writes it last). Without it, an ingest that starts reading too early sees a half-written
instance.

## 4. (c) What travels

| | the parser's files, as written | the series' `.sbnd` + its groups (recommended) | one package per study |
| --- | --- | --- | --- |
| frames | raw (if coded at the PACS) or coded files, one a frame | coded, in the server's own format | coded |
| unit to resume and refuse | a file | a series | a study |
| requests on the link | one a file, or a stream of them | one a series | one a study |
| the PACS's work | build bundles and the database | build the database; place the bundle | build the database; place the bundles |
| ready when | each file lands | the series is complete | the study is complete |

**Recommended: one package a series** — its `.sbnd`, its series group and its instances' groups, as a tar or one
zstd stream (§7). The series is what the server serves ([`../FIXTURES.md`](../FIXTURES.md) §SBND series bundle) and
what the ingest checks. A study can take hours to finish arriving, and its series are independent, so a study unit
holds back finished series for no gain. Single files multiply requests and leave the PACS to build what the ingest
already built and checked.

**What none of the three settles: when a series is complete.** DICOM sends instances, and nothing marks the last one.
The choices are the end of the modality's association (the AWS Greengrass edge in §9), a quiet period with no new
instance, or a count from the modality (Number of Series Related Instances is a query attribute, not sent with the
images). An instance that arrives after its series was sent makes a new bundle for that series and a new revision
of its study DB (§8, §12). This is the owner's (§10, 1).

## 5. (d) Where the layout, the study DBs and the study index are built

*Corrected 2026-10-20 (the owner): the study DB is built at the PACS, as below. On 2026-10-19 it had moved to
the PCS, the machine that parses and packs; it moved back because the metadata will inevitably be updated after the
PACS has received it. So the PACS owns the study DB's creation and its updates, its table design, and whatever it
keeps on its filesystem. The PCS sends the parser's groups; the PACS checks everything that arrives. When a series or
a study is complete stays the PCS's question (2026-10-19). Whether SQLite is the store at all is open:
[`metadata-draft.md`](metadata-draft.md).*

**The image layout and the study DB: at the PACS, from the groups** (the owner's decision of 2026-10-11, one
SQLite file per study so that bad data in one study never forces a shared database to be rebuilt). Building at the
PCS and shipping the database is the alternative. It moves CPU to the PCS, but the PACS would trust a database it
did not build, and the PCS would need the whole study before the database is final.

SQLite fits this use. One writer at a time per file, which a study has. A single file, copied or moved whole. Atomic
commit across crashes, given `fsync`. `VACUUM INTO` and `sqlite3_rsync` for copies, the session extension for
changesets, JSONB since 3.45. WAL does not work over a network filesystem, so a study DB is written on the
PACS's local disk before it is published. SQLite's own guidance sends many networked clients to a client/server
engine. That is the study index's job, not the study DB's.

**The study index.** *Named, bounded and re-weighed in [`../adr/study-index.md`](../adr/study-index.md) (proposed 2026-10-25), which recommends MySQL once the study index holds list-time fields only.*

| | PostgreSQL (recommended) | MySQL | libSQL server (sqld) |
| --- | --- | --- | --- |
| licence | PostgreSQL licence (BSD-like) | GPLv2 with the Universal FOSS Exception, or commercial | MIT |
| JSON | `jsonb`, GIN-indexed containment | binary JSON, indexed only through generated columns or multi-valued indexes | SQLite's JSON and JSONB |
| partial indexes | yes | not stated (absence not confirmed) | SQLite's |
| replication | logical, publish/subscribe | (not read) | primary + replicas polling the WAL; no global ordering |
| dialect | a second one | a second one | the study DBs' own; one server holds many databases (namespaces) |
| state | 18.6 current, supported to 2030-11 | — | its maintainer now focuses on a pre-1.0 Rust rewrite; libSQL "run in production today" |
| reference archives | dcm4chee, Orthanc | dcm4chee, Orthanc | none |

**Schema scope.** One row per study: Study Instance UID (key), patient ID and name, birth date, sex, study date and
time, accession number, description, referring physician, the modalities in the study, its series and instance
counts. A worklist adds what DICOM does not carry: status, priority and assignee. Then the location of the study
database, its revision and its digest. Per series, only what a search filters on: modality, body part, series
description. Everything else stays in the study DB. A cross-study search finds studies in the study index and opens
their databases.

**Consistency: the study DB first, then the study index.**

1. The PACS builds the study's new database beside the old one, then publishes it by rename (§8).
2. It upserts the study index row, keyed by Study Instance UID, with a revision one higher and the new database's digest.
3. A crash between 1 and 2 leaves the study index one revision behind. A start-up scan compares each database's
   revision with its row and re-registers the ones behind.

A study DB rebuilt from its groups re-registers by the same upsert. The study index is derived throughout, so
losing it means a rescan, not lost data. An ordered change log beside it (Azure's change feed, §9) is optional; the
revision number is enough for one PACS.

## 6. (e) The integrity chain and what each hash costs

*Decided 2026-10-12 (the owner): the raw-frame check is the XXH3-64 written for the client, one hash family per frame;
both ingests check by it since row INGESTRS1 ([`README.md`](README.md) §2). The table below is the comparison as written.*

**What each hash proves.**

| hash | over | written | checked | proves |
| --- | --- | --- | --- | --- |
| SHA-256 today, any 128-bit+ hash in Rust | the raw frame, as read | the ingest, before coding | the ingest, after decode-back | the coded frame is the encoder's input |
| XXH3-64 (served today) | the raw frame | the ingest | the client, after its decode | the shown frame is the encoder's input ([`../FIXTURES.md`](../FIXTURES.md) §Frame digests) |
| a coded-frame digest | the coded bytes | the ingest | the PACS on receipt, the server on read | transit and storage, without decoding; row 123's decision (2) |
| the parser's group hash (BLAKE3-256 here; XXH3, decided 2026-10-24/25) | a metadata group | the parser | the PACS, after decompression | parser → PACS for metadata, end to end, *if* the hash covers the bytes written |
| a package digest | the series package | the ingest | the PACS on receipt | the link only |

**What each costs, against a 27 MB mammogram frame (3328×4096, 16-bit).** Published single-core speeds:

| hash | speed | source | one frame |
| --- | --- | --- | --- |
| XXH3-64 | 31.5 GB/s (SSE2), 59.4 GB/s (AVX2), i7-9700K | xxHash | 0.5–0.9 ms |
| CRC32C, hardware | 13.0 GB/s, same CPU | xxHash wiki | 2.1 ms |
| BLAKE3 | 6 866 MiB/s (AVX-512, Cascade Lake); 4.4 GB/s (AVX2) | BLAKE3, xxHash wiki | 3.8–6.2 ms |
| SHA-256, SHA-NI | 1 979 MB/s, Ryzen 7 2700X | sha256-simd | 14 ms |
| SHA-256, no SHA-NI | 484 MiB/s (Cascade Lake), 0.3 GB/s (i7-9700K) | BLAKE3, xxHash wiki | 53–91 ms |

Against OpenJPH's 29.3 ms for a 2394×3062 mammogram (Intel, AVX-512), **SHA-256 without SHA-NI costs more than the
encode**. INGESTPROFILE found hashing 41 % of today's Python ingest on the mammogram. **BLAKE3 or SHA-256 with SHA-NI
keeps the raw-frame check under a fifth of the encode; XXH3-64 is nearly free.** The raw-frame check needs no
cryptographic strength: it compares against its own frame, with no birthday bound
([`../adr/exactness-in-production.md`](../adr/exactness-in-production.md) §7). So a Rust ingest could check with the
XXH3-64 it writes anyway, and drop the second hash. The owner decides (§10, 5).

**The owner's point, in numbers.** A metadata group is kilobytes (no source gives DICOM header sizes; "a few KB" is
unsourced). At BLAKE3's ≈ 7 GB/s a 10 KB group hashes in ≈ 1.5 µs, and decompressing it with zstd (≈ 1.6 GB/s at
level 1) takes ≈ 6 µs. So **hashing the compressed bytes instead saves about a microsecond a group**, and the PACS
decompresses every group anyway to build the database. Compressed-byte hashes save nothing worth having. The original's
hash, checked after decompression, covers the link *and* the decompressor, and it already exists: the parser's. One
thing is needed first: three of the parser's four group hashes cover a length summed before the UTF-8 conversion (row
155's open point 2). A group whose text changed length then fails the PACS's recompute while intact. Until the parser
hashes the bytes it writes, the PACS can check only the exam group's hash.

**Reusing the parser's hashes as identities is safe at 256 bits.** The exactness ADR's birthday bound forbids XXH3-64
as a key; BLAKE3-256 has no such limit. The PACS can skip a series or exam group it already holds (§8). *Corrected
2026-10-26:* the group hashes are XXH3 (decided 2026-10-24/25), so they are checks, not identities: a group is keyed
by its UID (the study DB, design state §4), a package by (unit UID, revision) with its hash a check
([`../adr/pcs-transfer.md`](../adr/pcs-transfer.md) §4, proposed). Skipping an exam group whose hash matches stays
sound as a check against the row the UID names. A zstd frame's
own content checksum is the low 32 bits of XXH64 (RFC 8878 §3.1.1). It catches a broken stream on the link, nothing
more.

## 7. (f) Metadata compression

**Per group with a dictionary, or per series without one.**

* **A trained dictionary** pays on small inputs alone. zstd's README: about 1 KB records, 2.86× → 9.92× with a
  dictionary (setup not stated). Its 0.5.0 table: 300 B JSON ×1.33 → ×5.9–6.8, 1.5 KB events ×2.3 → ×3.4–4.5, 6 KB
  JSON ×3.8 → ×8.9–13.4. Training wants ≥ 100 samples and ≈ 100× the dictionary's size in samples; ~100 KB is the
  default and the stated limit of usefulness. Both ends must hold the same dictionary. That means one shipped and
  versioned per modality, or one per series sent with it. A per-series one is useless below ~100 instances.
* **One stream per series**, the groups concatenated (or tarred) and compressed together. The window catches
  repetition across instances without a dictionary. Each group is no longer readable alone, which the PACS does not
  need: it reads the whole series to build the database.

**Recommended: one stream per series**, matching §4's package. No published ratio on DICOM headers was found. A
gzip-style compressor halves "a typical instance" in Orthanc's words, pixels included. DICOM's own deflated syntax is
"particularly useful" for objects without pixels. Against frames of hundreds of kilobytes to tens of megabytes, metadata
compression moves the link's bytes little. Its value is storage at the PACS, if the groups are kept.

## 8. (g) Recovery

* **Resumable by offset.** A series package is uploaded so that a cut resumes where it stopped. tus 1.0 (`Upload-Offset`,
  409 on a mismatch, `sha1` checksums at least) and its IETF successor draft-ietf-httpbis-resumable-upload-13 (a draft,
  not an RFC) do this over HTTPS. So do S3 multipart (≤ 10 000 parts of 5 MiB–5 GiB, per-part CRC64NVME, CRC32C,
  SHA-256 or XXH3) and GCS resumable sessions (a week, 256 KiB chunks). Row 154 picks among them.
* **Idempotent.** Receiving the same series package twice changes nothing: the PACS keys a series by its UID and the
  package's digest, and a known digest is acknowledged without work. A known UID with a new digest is a new
  revision. Whether it replaces the old one or is held for review is the owner's (§10, 6). The archives in §9 differ
  exactly here: Orthanc `Never`/`Always`/`IfChanged`, dcm4chee four overwrite policies, AWS overwrite with a version,
  Azure and Google refuse.
* **Dedupe.** The parser does not rewrite an exam or series group it already wrote. The PACS can likewise skip a group
  whose hash matches the row its UID names (XXH3, not BLAKE3, since 2026-10-24/25). That saves only metadata bytes, which are few (§7). The frames carry no such key and need
  none: an instance is sent once.
* **Isolation.** A bad instance is refused by name at the PCS and its series is not sent. That is today's rule:
  nothing is written unless every frame passes. The alternative, STOW-RS's model, stores the good instances and lists
  the failed ones, so a partial series is served. That is the owner's (§10, 7). A bad study DB is rebuilt from
  its groups without touching another study (§5).
* **Published by rename.** The PACS writes a series or a study DB into a temporary directory and `fsync`s each
  file and the directory. Then it renames into place and `fsync`s the parent. POSIX makes rename atomic in normal
  operation, not across a crash; Linux's `fsync` does not cover the directory entry. A failed `fsync` is fatal, not
  retried (PostgreSQL's lesson). The sequence is drawn from the sources; none states it whole.
* **At the PCS,** the outbox is the same directory discipline. A package leaves when it is complete and checked, and
  is deleted when the PACS acknowledges its digest.

## 9. (h) Prior art

| | (a) coded where | (b) handed in | (c) unit | (d) index | (e) integrity | (g) duplicates |
| --- | --- | --- | --- | --- | --- | --- |
| **STOW-RS** (PS3.18 2026d §10.5) | server may encapsulate; lossy not recompressed | HTTP POST, multipart | instances, many per request | — | — | not stated; per-instance success and failure lists, 200/202/409 |
| **AWS HealthImaging** | in the cloud, to HTJ2K lossless (or JPEG 2000) on import | S3 import jobs (≤ 5 000 files, 10 GB) or STOW-RS (≤ 1 GB) | P10 files → image sets per series | not stated; metadata JSON, served gzip | CRC32 per frame, before and after the encode | overwrite, version incremented; conflicting metadata to a non-primary set |
| **Google Cloud Healthcare** | stored as sent, transcoded on read | STOW-RS, import from Cloud Storage | instances | not stated; BigQuery export | not stated | "already exists" failure; its 409 means at least one failed |
| **Azure DICOM service** | stored as sent, transcoded on read | STOW-RS POST, upsert by PUT (≤ 4 GB) | instances | not stated; extended query tags; a change feed | not stated | 45070 refused; delete first |
| **Orthanc** | optional transcoding on ingest | DIMSE, DICOMweb, REST | instances, files by UUID | SQLite by default, PostgreSQL or MySQL plugins | MD5 per attachment, before and after compression | `Never` (default), `Always`, `IfChanged` |
| **Orthanc transfers accelerator** | — | HTTP(S) pull or push | buckets of a few MB, gzip | — | MD5 per instance, storage commitment | atomic, resubmittable |
| **dcm4chee-arc** | compression rules on receive | DIMSE, DICOMweb | instances; a series as TAR optional | PostgreSQL, MySQL/MariaDB, Oracle and others | MD5, SHA-1 or SHA-256 per object | four overwrite policies |
| **AWS Greengrass edge** (2023 blog) | not compressed at the edge | DIMSE to an edge SCP | an association's instances, then a manifest | MySQL, headers by Lambda | not stated | SQS retry |

**What none of them does:** compress at the edge and check exactness before the upload. AWS HealthImaging checks in
the cloud, with 32 bits. The closest to today's proposal is an edge Orthanc with ingest transcoding plus its
accelerator. No published import throughput was found for any cloud service.

## 10. The owner's decisions

Listed, not taken; under the queue's §Blocked. *Updated 2026-10-26* (design state): 2 is decided (one package per
series, 10-25); 3 is the PCS's side (scope, 10-24); 4 is re-weighed by the study index's record (MySQL, proposed); 5
is decided (XXH3-64, 10-12); 1 and 6 have proposals in [`../adr/pcs-transfer.md`](../adr/pcs-transfer.md) §2, §4.

1. **When a series is complete** (§4): the association's end, a quiet period, or another signal. Also whether a late
   instance makes a new revision.
2. **The unit on the link** (§4): one package per series (recommended), the parser's files, or one per study.
3. **Where frames are coded** (§2): at the PCS (recommended), in the parser on grok (AGPL v3, a licence decision), or
   in the cloud.
4. **The study index** (§5): PostgreSQL (recommended), MySQL, or libSQL's server; the schema scope above.
5. **The raw-frame check's hash** (§6): SHA-256 as today, BLAKE3, or the XXH3-64 already written.
6. **A changed duplicate** (§8): replace, keep both revisions, or hold for review.
7. **A bad instance** (§8): refuse its series (today), or store the rest and mark the series incomplete.
8. **The parser's group hashes** (§6): whether the parser hashes the bytes it writes, so the PACS can check every group
   (row 155's open point 2).
9. **Metadata compression** (§7): per series (recommended), or per group with a shipped dictionary.
10. **Streaming the pack** (§11): code on arrival first; stream frames as records only under a quiet-period rule for
    completeness; no index at the end (recommended).
11. **The PACS receiver and builder** (§12): its own decisions are listed in §12.10.

Gaps theory cannot close, one line each: HTJ2K against zstd on the lab's own sets (no published side-by-side beyond
seven images); DICOM header sizes per modality (no source); P-STAGE's share (proposed in
[`../FIXTURES.md`](../FIXTURES.md)).

## 11. Streaming the pack

*Queue row 163 STREAMPACK, 2026-10-13. Theory only: nothing built, nothing timed. (S) a source in §13, (D) derived
here, (M) measured in this repository, with its row. The uplink rates are the assumed 10 Mbit/s–1 Gbit/s of
[`link.md`](link.md) until row 162 (LINKREAL) replaces them.*

**The question.** The PCS packs a series into one `.sbnd` and publishes it once complete. Could frames cross the link
while the series is still being parsed and coded, and what would that take and save?

**The answer in plain words.**

* **Overlap saves at most the smaller of coding and sending, so never more than half of code-then-send** (D, §11.3).
  The PCS codes HTJ2K faster than any assumed uplink, so streaming saves the coding: under a second for 300 frames on
  4 cores. AV1 coding is the clock, so streaming hides the link: up to 26 s on the same series.
* **The larger gain is against the wait for completeness.** If a series is called complete after a quiet period, the
  streamed frames cross the link during it, and what is left after it is one round trip and the PACS's publish. A long,
  safe quiet period then costs little. If the association's end is the signal, streaming HTJ2K buys almost nothing.
* **Coding on arrival takes the coding part without streaming**: the ingest codes frames as instances arrive and writes
  the bundle, index first, at completion. No format, wire or store change.
* **If streaming is wanted, frames as records with a final "series complete" message** keep the `.sbnd` unchanged,
  check each frame on arrival and resume frame by frame. An index at the end changes the format and still leaves the
  frames in arrival order. A chunked resumable upload is the transport under either, not a third design.
* **Per frame, no safety is lost**: a frame leaves only after its own decode-back check. What changes: the earlier frames
  of a series that fails late have already crossed and are discarded, the PACS holds partial series until they expire,
  and resuming after a PCS crash relies on the ingest coding the same bytes again (shown for HTJ2K, row INGESTRS1; not
  measured for AV1).

### 11.1 Why it does not stream today

* **The format is front-loaded.** The 16 B header holds the frame count and the metadata's length; the index, 12 B a
  frame (offset, length), follows; then the metadata; then the frames
  (`common/series-bundle/src/format.rs:8–12`). `BundleWriter::create` takes every frame's length and writes the header,
  index and metadata before the first frame's byte (`common/series-bundle/src/writer.rs:20–60`). The metadata needs
  the whole series too: its minimum, maximum and every frame's digest (`ingest/from-parser/src/main.rs:98–112`).
* **The ingest runs on a complete series.** It starts after the wait for the series ([`README.md`](README.md) §1, step
  3), codes every frame into memory, then writes the bundle (`ingest/from-parser/src/main.rs:81–114`; *corrected
  2026-10-16:* both line ranges were one to three lines off).
* **The parser hands over whole instances**, one directory each ([`README.md`](README.md) §1, step 2). A multi-frame
  instance (a cine, a tomosynthesis volume) gives no frame until all of it is received and parsed. Streaming inside one
  instance needs the parser's stream output (§3).
* **The draft target is front-loaded as well.** [`../disk-layout/target.md`](../disk-layout/target.md)'s header carries the entry count, and its index (offset,
  length, a coded and a samples XXH3-64, 28 B a frame) precedes the frames. It drops only the metadata, which moves to
  the study DB.
* **Display order.** Frames lie back to back in display order, and a fill asks the kernel for
  `FILL_WINDOW` = 4 MiB past the frame it reads (`server/src/media/read_path.rs:28`, `196–210`). A file written in
  arrival order serves fills in display order only if the instances arrived in it.
* **AV1's offset.** The bit split codes samples offset by the series' minimum, which takes one pass over every frame
  before the first is coded ([`../FIXTURES.md`](../FIXTURES.md) §A compiled ingest at the site, *Streaming memory*).
  A streamed AV1 series needs an offset fixed before the series is read: per frame, or from the bits stored, as HTJ2K's
  is (2^(bits − 1), `ingest/from-parser/src/htj2k.rs:47`). That changes the stored coding, so it is row DEPTH's
  decision, not this row's.

### 11.2 The options

| | (A) an index at the end | (B) frames as records, then "series complete" | (C) chunked resumable upload |
| --- | --- | --- | --- |
| what it is | frames written as coded, then the index and a fixed footer pointing at it: ZIP's layout, file data first and its central directory last (APPNOTE 6.3.10 §4.3.6; its data descriptor exists "to facilitate ZIP file streaming", §4.3.5) (S) | each frame a record (series UID, revision, instance UID, frame in the instance, length, coded and samples XXH3-64, bytes); a last record gives the count and a hash over the ordered coded hashes | the transport for (A) or (B), not a layout |
| the `.sbnd` | a new version: the reader reads the footer, then the index (one more read at open); structural, so proposed only | unchanged: the PACS writes today's or the target's bundle from the records | unchanged |
| a frame's coded hash checked | when the index arrives, last; earlier only if each frame carries its own header, which is (B) | as its record lands; a bad frame is asked again alone | per chunk, if the protocol has it (below) |
| a cut link resumes | from the byte offset the PACS confirms (C) | the PACS lists the frames it holds; the PCS sends the rest; a record is idempotent by its key and coded hash | tus: HEAD returns the offset; draft-13: the offset "MUST NOT decrease"; S3: ListParts (§8) (S) |
| a PCS crash resumes | from the PCS's growing file, `fsync`ed a chunk at a time | the ingest re-codes from the parser's directory; held frames stay valid if the new bytes hash the same: HTJ2K writes identical bytes at 1, 2 and 4 jobs (M, row INGESTRS1); AV1 not measured, so its series is sent again | — |
| publish only complete | when the upload ends and the index checks | on the last record only; a partial is dropped on an abort record or when it expires | completion is explicit: draft-13 `Upload-Complete: ?1`, S3 CompleteMultipartUpload, tus the final length reached (S) |
| display order | arrival order, unless the PACS rewrites the file | any arrival order; the PACS orders by instance and frame at completion | — |
| the PACS's extra work | none if served as written | one sequential copy of the series: 0.3 s for a 152 MB series at an assumed 500 MB/s (D) | — |
| precedent | ZIP | tus concatenation: partial uploads, then a final upload naming them in order (tus 1.0 §Concatenation) (S); S3 multipart: parts in any order, assembled in ascending part number at completion (S); DICOM storage commitment: instances sent, then one request listing them, answered by a notification (PS3.4 2026d J.1.2) (S) | — |

**The uploads, for a series of unknown length.**

* **tus 1.0** creates an upload with `Upload-Defer-Length: 1` and sets `Upload-Length` in a later PATCH once known
  (its Creation extension). Its Checksum extension checks each PATCH ([`link.md`](link.md) §7) (S).
* **draft-ietf-httpbis-resumable-upload-13** names this case: "the client does not know the final size … originates
  from a streaming source" (§3.2). Parts go with `Upload-Complete: ?0`, the last with `?1` (§4.1.2–4.1.3). It has no
  integrity of its own since draft -12 removed its section on digests (Appendix A) (S).
* **S3-style multipart** needs no length up front, holds at most 10 000 parts, and each part but the last is
  5 MiB–5 GiB; parts can be uploaded over time (S). Frames under 5 MiB are batched: 33 CT frames of 164 kB a part, coded in 0.06 s on 4 cores; 10 AV1
  fluoroscopy frames of 529 kB, coded in 0.9 s (D, inputs in §11.3). So a part leaves at most that late.
* **HTTP/1.1 chunked transfer** sends an unknown length in one request (RFC 9112 §7.1) (S). A cut loses the request
  unless the server keeps what arrived, which is what the draft adds.

### 11.3 What overlap saves

**The formula** (D). For one series: *a* = its coding time at the PCS (frames × time a frame ÷ cores), *b* = its
sending time (coded bytes × 8 ÷ link rate), *Q* = the wait from the last instance to "complete" (≈ 0 if the
association's end is the signal, a quiet period otherwise). With the series arriving at once (one multi-frame
instance), and round trips and the publish left out, the time from its last instance to its publication at the PACS:

| design | time | saves |
| --- | --- | --- |
| today: wait, code, then send | *Q* + *a* + *b* | — |
| code on arrival, today's format | max(*Q*, *a*) + *b* | min(*Q*, *a*) |
| streamed | max(*Q*, *a*, *b*) | min(*b*, max(*Q*, *a*)) more |

At *Q* = 0 streaming saves min(*a*, *b*), at most half of *a* + *b*. As rates, with *K* the PCS's coded bytes a
second and *L* the link's, the share saved is min(*K*, *L*) ÷ (*K* + *L*). A series that arrives over a span *W*
lets both overlapping designs start earlier, by up to *W*.

**The inputs.** Coded bytes and coding time a frame, one core (M, row ENC, [`../../lab/av1/bytes`](../../lab/av1/bytes/README.md)
§ENC and §AV2):

* HTJ2K, `ojph_compress`, process start included, encode only: 7.4–17.2 ms a frame on 164–571 kB frames of the six sound sets, so
  174–335 Mbit/s of coded output a core (D). The whole Python ingest on the fluoroscopy, hash and check included:
  32.6 ms a frame, 124 Mbit/s a core (M, row INGESTPROFILE, [`../FIXTURES.md`](../FIXTURES.md)). The Rust ingest's
  rate is not measured.
* AV1 at the fastest preset within 2 % of the slowest's bytes: fluoroscopy `--allintra` 7, 345 ms a frame, 12.3 Mbit/s
  a core; 10-bit tomosynthesis `--good` 6, 936 ms, 4.9 Mbit/s (D). INGESTPROFILE measured the ingest's own AV1 path at
  8.6 s a frame on that tomosynthesis at `good:6`, about 9× the encode alone; the gap is not explained here, and it
  would only make coding more the clock.
* 4 cores at the PCS, as INGESTPROFILE's container had (assumed).

**The result** (D, printed by [`overlap.py`](overlap.py)): seconds from the last instance to publication, today ·
code on arrival · streamed.

*Q* = 0 (the association's end):

| set | frames | MB | coding s | 10 Mbit/s | 50 Mbit/s | 100 Mbit/s | 1 Gbit/s |
| --- | ---: | ---: | ---: | --- | --- | --- | --- |
| CT 512², HTJ2K, ojph | 300 | 49 | 0.6 | 39.8 · 39.8 · 39.3 | 8.4 · 8.4 · 7.9 | 4.5 · 4.5 · 3.9 | 0.9 · 0.9 · 0.6 |
| fluoroscopy 768², HTJ2K, ojph | 300 | 152 | 0.9 | 122.5 · 122.5 · 121.6 | 25.2 · 25.2 · 24.3 | 13.1 · 13.1 · 12.2 | 2.1 · 2.1 · 1.2 |
| fluoroscopy 768², HTJ2K, Python ingest | 300 | 152 | 2.4 | 124.1 · 124.1 · 121.6 | 26.8 · 26.8 · 24.3 | 14.6 · 14.6 · 12.2 | 3.7 · 3.7 · 2.4 |
| fluoroscopy 768², AV1 allintra 7 | 300 | 159 | 25.9 | 152.9 · 152.9 · 127.0 | 51.3 · 51.3 · 25.9 | 38.6 · 38.6 · 25.9 | 27.1 · 27.1 · 25.9 |
| tomosynthesis 678×1727, HTJ2K, ojph | 60 | 34 | 0.3 | 27.7 · 27.7 · 27.4 | 5.7 · 5.7 · 5.5 | 3.0 · 3.0 · 2.7 | 0.5 · 0.5 · 0.3 |
| tomosynthesis 678×1727, AV1 good 6 | 60 | 34 | 14.0 | 41.3 · 41.3 · 27.3 | 19.5 · 19.5 · 14.0 | 16.8 · 16.8 · 14.0 | 14.3 · 14.3 · 14.0 |

*Q* = 30 s (a quiet period, an example value):

| set | frames | MB | coding s | 10 Mbit/s | 50 Mbit/s | 100 Mbit/s | 1 Gbit/s |
| --- | ---: | ---: | ---: | --- | --- | --- | --- |
| CT 512², HTJ2K, ojph | 300 | 49 | 0.6 | 69.8 · 69.3 · 39.3 | 38.4 · 37.9 · 30.0 | 34.5 · 33.9 · 30.0 | 30.9 · 30.4 · 30.0 |
| fluoroscopy 768², HTJ2K, ojph | 300 | 152 | 0.9 | 152.5 · 151.6 · 121.6 | 55.2 · 54.3 · 30.0 | 43.1 · 42.2 · 30.0 | 32.1 · 31.2 · 30.0 |
| fluoroscopy 768², HTJ2K, Python ingest | 300 | 152 | 2.4 | 154.1 · 151.6 · 121.6 | 56.8 · 54.3 · 30.0 | 44.6 · 42.2 · 30.0 | 33.7 · 31.2 · 30.0 |
| fluoroscopy 768², AV1 allintra 7 | 300 | 159 | 25.9 | 182.9 · 157.0 · 127.0 | 81.3 · 55.4 · 30.0 | 68.6 · 42.7 · 30.0 | 57.1 · 31.3 · 30.0 |
| tomosynthesis 678×1727, HTJ2K, ojph | 60 | 34 | 0.3 | 57.7 · 57.4 · 30.0 | 35.7 · 35.5 · 30.0 | 33.0 · 32.7 · 30.0 | 30.5 · 30.3 · 30.0 |
| tomosynthesis 678×1727, AV1 good 6 | 60 | 34 | 14.0 | 71.3 · 57.3 · 30.0 | 49.5 · 35.5 · 30.0 | 46.8 · 32.7 · 30.0 | 44.3 · 30.3 · 30.0 |

**What it says.**

* **HTJ2K, association's end:** streaming saves 0.3–0.9 s, the coding (2.4 s on the Python path). The link is the
  clock at every assumed rate.
* **AV1, association's end:** streaming saves the smaller of coding and sending: 25.9 s on the fluoroscopy up to
  100 Mbit/s, 1.2 s at 1 Gbit/s; on the tomosynthesis 14.0 s at 10 Mbit/s, 0.3 s at 1 Gbit/s.
* **A quiet period:** coding on arrival saves the coding, up to *Q* of it (0.3–26 s here). Streaming then hides the send
  under the wait as well, all of it while *b* ≤ *Q*: 3.9–30 s on the HTJ2K CT and the fluoroscopy at 10–100 Mbit/s.
  Publication follows the wait by one round trip, so a longer, safer quiet period costs little.

### 11.4 Its interplay with completeness

The open decision of when a series is complete (§4, §10, 1) decides whether streaming pays.

* **The association's end:** *Q* ≈ 0, and for HTJ2K streaming saves under a second here. Code on arrival is enough.
* **A quiet period:** streaming makes *Q* nearly free. That favours a long *Q*, which calls fewer series complete too
  early, so fewer late instances make a new revision.
* **A late instance** is the same in every design: one arriving after "complete" makes a new revision (§8). Before
  "complete", (B)'s records only accumulate.
* **The frame's key.** In a series of several instances, a frame's position is known only once every instance's number
  is, so a record is keyed by its instance UID and its frame within the instance, and the PACS orders at completion.
  The Rust ingest does not yet take a series of several instances ([`../FIXTURES.md`](../FIXTURES.md) §A compiled ingest
  at the site, phase 1).

### 11.5 What it costs in safety and checks

* **Exactness, unchanged per frame.** The PCS's decode-back check runs before a frame's record leaves.
* **"Nothing is written unless every frame is equal" becomes "nothing is published unless".** A frame that fails late
  leaves its earlier frames at the PACS, dropped by an abort record or on expiry. That wastes uplink bytes only, and
  rarely: no bundle was refused in 528 (M, row INGESTRS1).
* **The package's digest (§8) becomes a hash over the ordered coded hashes**, checked with the count at completion; it
  is the series' idempotency key in the same way. It rests on the frames' 64-bit hashes: enough against accidental
  damage, with TLS covering the wire, and not an identity ([`../adr/exactness-in-production.md`](../adr/exactness-in-production.md)
  §7).
* **Partial series at the PACS** take storage until they complete or expire: tus `Upload-Expires`, the draft's
  `max-age`, an S3 lifecycle rule (S, [`link.md`](link.md) §7). The operator pays for abandoned ones.
* **Publication is unchanged:** the PACS writes the bundle as `.partial`, `fsync`s it, renames it and `fsync`s the
  directory (§8).

### 11.6 Recommended

Proposed; the owner decides (§10, 10).

1. **Code on arrival.** No format, wire or store change. It saves min(*Q*, *a*): the whole coding under a quiet period.
2. **Stream only under a quiet-period rule, and only where *b* is large** (AV1, or a slow uplink). Then use (B), carried
   by whichever upload [`link.md`](link.md) §9 picks; the `.sbnd` stays as it is.
3. **No index at the end.** It changes the format for what (B) gives without, and does not restore display order.

Gaps theory cannot close: the Rust ingest's coding rate; real site uplinks (row 162); how long real series take to
arrive (*W*); whether libaom codes the same bytes on a re-run.

## 12. The PACS receiver and builder

*2026-10-20. Theory only: nothing built, nothing timed. (S) a source in §13, (D) derived here, (M) measured in this
repository, with where. It builds on what the owner has decided: the PACS builds and updates each study's store
(§5); the PCS sends the parser's groups and the packed series, and decides when a series or a study is complete; the
PACS checks everything that arrives; the link is TCP; metadata and pixels live on the host of the server that serves
them; bad data in one study never forces a shared rebuild. The store's format is open
([`metadata-draft.md`](metadata-draft.md) §2) and is left open here (§12.9).*

**Named here.** A study's store changes by **revisions**: revision 1 is its first publish, and each later one replaces
it whole. §5, §8, §10 and §11 called this a generation until today; the glossary gives that word to a request's
identity, so it is renamed there in place.

**The question.** What does the program at the PACS that receives a series from the PCS, checks it, places it and
builds its study's store look like, as a process of its own beside the WebTransport server, able to run on another
machine when scaling needs it?

**The answer in plain words.**

* **One program, two jobs, and only files between it and the server.** The *receiver* takes uploads, checks them and
  places them; the *builder* turns a study's accepted inputs into a new revision of its store. The server never
  talks to either: it reads the files they publish. The same binary can run the two jobs on two machines later.
* **What arrives, per series:** the `.sbnd`, the series group, every instance's groups and a copy of the exam group.
  Also, rarely, a "study complete" notice and corrections. A series is accepted or refused whole.
* **Every check is cheap except decoding.** The coded-frame hashes prove that the bytes on the PACS's disk are the
  bytes the site checked, at ≈ 5 ms for a 152 MB series (D). The parser's BLAKE3 proves each group's content. The UIDs
  and the frame count, compared across the bundle and the groups, prove that the pixels and the metadata belong
  together. Decoding every frame again would prove more, and the client already does it for every frame it shows.
* **Everything that arrived is kept, and the store is derived from it.** A study's accepted inputs are an
  append-only list. Every revision is built whole from that list, so a builder bug, a new page view or a new format
  is a rebuild of one study at a time, never lost data.
* **A revision is a directory that never changes, and one small file, `CURRENT`, names the live one.** The builder
  writes the new directory, makes it durable, then replaces `CURRENT` by rename. A reader sees the old revision whole
  or the new one whole. This works for any format, on local disk and on network storage, without locks.
* **One new invariant: a page's metadata and the frames it asks must describe the same bundle.** A late instance can
  sort into the middle of a series, so the page sends its series' digest when it opens a session, and the server
  refuses a mismatch. Then the server needs no message when a study changes.
* **Crash recovery is a list of studies with work.** Each step leaves a state on disk that a restart finishes or
  undoes, and receiving the same series again changes nothing.
* **On another machine:** the bundles have to land on the PACS host, so the receiver stays there. The builder can move
  and send each revision back. At the band's volumes neither job saturates a host on its own (D); what would justify
  moving them is not measured.

### 12.1 The shape

```text
 PCS (the site)                    PACS host
 ──────────────                    ──────────────────────────────────────────────────────────────────────
                                   ┌─ receiver ──────────┐
 outbox ── HTTPS over TCP ───────▶ │ resume, check,      │──▶ <StudyUID>/<SeriesUID>.sbnd ◀── server reads frames
           (link.md)        ◀───── │ place, answer       │──▶ <StudyUID>/inputs/…  (what was accepted)
           accepted / refused      └─────────────────────┘──▶ pending/<StudyUID>   (this study has work)
                                                                      │
                                   ┌─ builder ───────────┐            │
                                   │ build a revision,   │◀───────────┘
                                   │ publish it          │──▶ <StudyUID>/store/<N>/ and CURRENT ◀── the store's reader
                                   └─────────────────────┘
```

| | inside `server/` | one process, two jobs (recommended) | two processes |
| --- | --- | --- | --- |
| a builder fault or CPU burst | reaches the sessions | stays out of the server | the same |
| moving the builder to another machine | a rewrite | the same binary, the builder job only | as built |
| cost now | — | the `pending/` list between the jobs | a second service to deploy |
| switching later | — | to two processes: configuration | — |

What the server and the program share is code, not a process: the `.sbnd` reader (`common/series-bundle`) and the
store format's reader (§12.9).

### 12.2 What arrives

| input | carries | sent by | when |
| --- | --- | --- | --- |
| **series archive** | the `.sbnd`; the series group; each instance's instance group and private group; a copy of the study's exam group | the PCS | the PCS calls the series complete |
| **study-complete notice** | the study UID; each series UID with its archive's identity | the PCS | the PCS calls the study complete |
| **correction** | replacement groups, each naming what it replaces (the exam, a series, an instance), a reason and an author | the PCS, or an edit made at the PACS | any time |

**Two identities, both computed by the PACS from what arrived.**

* **The series digest:** BLAKE3-256 over the bundle's coded-frame hashes in entry order (§11.5's hash, its algorithm
  fixed here). It changes when any frame changes or moves. It is compared only with digests of the same series UID,
  never used as a key across series.
* **The archive's identity:** BLAKE3-256 over the series digest and then each group's BLAKE3, in name order. It does
  not change if the PCS packs the same content again, which a hash of the archive's bytes would.

**On the wire.** §4 sends a series as one archive. Two ways to carry it:

| | one tar, the bundle inside (§4) | two files and a commit (recommended) |
| --- | --- | --- |
| what is sent | `series.tar` | the bundle; the metadata (the groups in one zstd stream, §7); then a short commit naming the study, the series and both identities |
| resume after a cut | by the tar's offset; the receiver must rebuild where it was inside which member | each file by its own offset (link.md §7) |
| the bundle's bytes at the PACS | written once in `incoming/`, then once more when unpacked | written once, as the final file's `.partial` beside where it will live |
| precedent | — | tus concatenation and S3 multipart: parts, then one request that completes them (§11.2) (S) |
| cost now | one request a series | three; nothing against megabytes |

The unit of acceptance is the series in both: nothing is placed until the commit is checked. Switching is the PCS's
sender and the receiver's front, not the rest.

**Not carried yet:** the encapsulated documents (PDF, CDA, STL) the parser writes since `f36230b`; the contract of
2026-10-11 stays ([`contract.md`](contract.md)), so they wait for it. A withdrawal (deleting a series or a study sent
to the wrong patient) is not designed: §12.10, 11.

### 12.3 The checks on arrival

In order; a later check runs only if every earlier one passed.

| # | check | proves | cost | on failure |
| --- | --- | --- | --- | --- |
| 1 | the upload's own checksum, per chunk, if the shape has one ([`link.md`](link.md) §7) | the link | per chunk | that chunk is asked again |
| 2 | the bundle's structure: magic, version 2, a known codec and layout, the entry count, entries back to back, the last one ending at the file's end ([`../disk-layout/target.md`](../disk-layout/target.md)) | it is a whole `.sbnd` the server can read | microseconds | refuse the series |
| 3 | every entry's coded bytes against its XXH3-64 | the bytes on the PACS's disk are the ones the site wrote after its decode-back check: the link, the receiver's write and the disk | 152 MB at 31.5 GB/s ≈ 5 ms (D, §6's speed) | refuse |
| 4 | every group: its records well formed (key lengths a multiple of 8, every length inside the file) and its BLAKE3-256 recomputed against its name | its content is what the parser wrote, across compression, the link and the PCS's disk | kilobytes at GB/s: microseconds (§6) | refuse, but see the parser's fault below |
| 5 | the UIDs agree: the commit's study and series UIDs, the exam group's (0020,000D), the series group's (0020,000E), the bundle header's two UIDs; each instance's SOP Instance UID once | the pixels and the metadata are of the same series, in the study they claim | microseconds | refuse |
| 6 | the frame count: the bundle's N against the sum over instances of Number of Frames (0028,0008), 1 when absent | no instance is missing on either side | microseconds | refuse |
| 7 | optional: each coded frame's own header (HTJ2K's SIZ, AV1's sequence header) against the instance's rows, columns, bits and samples | the frames have the size the metadata says | tens of bytes read a frame | refuse |
| 8 | optional: decode every frame and compare its samples with the entry's samples XXH3-64 | the coded frame decodes to the site's input, here | a decode of every frame, the site's decode-back again; not measured at the PACS | refuse, or run later as a scrub |

**What the frames' samples hash proves at the PACS: nothing, without check 8.** It travels with its frame, and the
client checks it on every frame it shows
([`../adr/exactness-in-production.md`](../adr/exactness-in-production.md)). The PACS's cheap proof is the coded hash.

**The parser's known fault.** Three of its four group hashes cover a length taken before the UTF-8 conversion (§6).
A group with no converted record (every charset index 0) has no conversion, so its hash must match, and a mismatch
refuses. A group with a converted record that mismatches cannot be told apart from damage. Until the parser hashes
the bytes it writes (§10, 8), such a group is accepted and marked *unverified* in the store, or refused, which would
refuse many studies with non-ASCII names. The owner's (§12.10, 3).

**What a refusal does.** The whole series archive is refused. Nothing is placed, the study's store is not touched,
and no other series or study is. The files move to `refused/<identity>/` with a line saying which check failed, kept
for diagnosis. The PCS's commit is answered `refused: <check>`. A content failure (checks 2 to 8) means the PCS's own
copy is bad, so sending the same bytes again is refused again without work; the PCS packs the series again from the
parser's directory.

**An exam group that differs** from the one the study already holds is not damage: the patient's or the study's
attributes changed at the modality or the site. It is a correction in disguise, and patient identity is in it. The
owner's (§12.10, 10).

### 12.4 The disk

```text
<root>/
  incoming/<upload>.partial              metadata uploads in progress; gone once accepted, refused or expired
  refused/<identity>/                    a refused archive and the check it failed
  pending/<StudyUID>                     an empty file: this study has inputs its store does not hold yet
  <StudyUID>/
    <SeriesUID>.sbnd                     the published bundle (target.md)
    <SeriesUID>.<upload>.sbnd.partial    a bundle still arriving or being checked; never opened by a reader
    inputs/
      000001.<identity>.series           an accepted series archive's metadata, as it arrived
      000002.<identity>.correction
      000003.<identity>.complete
    store/
      CURRENT                            the one name that changes: the live revision, its format, its last input
      7/                                 revision 7, never changed after it is published
      8/
```

A UID is digits and dots (PS3.5 §9.1, as the target cites it), so no study can be named `incoming`, `refused` or
`pending`. A study is one directory holding everything of it: moving a study to another host is copying that
directory.

**The received groups: keep them (recommended), or keep only the store.**

| | keep the inputs | keep only the store |
| --- | --- | --- |
| a builder bug found later | rebuild the studies it touched | the bad revisions are all there is |
| a new format or page view | built from what arrived | converted from the old store |
| what it costs | the groups again: 2.15 MB for 2 000 instances of the parser's CT group uncompressed (M, [`metadata-draft.md`](metadata-draft.md) §2), against ≈ 330 MB of coded CT frames at 164 kB a frame (§11.2): under 1 % (D) | nothing |
| switching later | to "store only": delete the inputs | to "keep": impossible for what already arrived |

The bundles are not in `inputs/`: the pixels are kept once. A series sent again replaces its bundle, so the inputs
can rebuild every revision's metadata but only the live bundles; keeping old bundles is §10, 6.

### 12.5 Building a study's store, and updating it while it is read

**Three ways to update.**

| | (a) a new revision directory, named by `CURRENT` (recommended) | (b) SQLite changed in place under WAL | (c) one new file renamed over the old |
| --- | --- | --- | --- |
| what a reader sees | the old revision whole, or the new one | a consistent snapshot | the old file, or the new |
| formats | any, with any number of files | SQLite only | formats of one file; not SQLite, where renaming over an open database is "undefined" (S, SQLite's corruption page §2.5) |
| network storage | yes: no locks, no shared memory | no: "WAL does not work over a network filesystem" (S) | yes |
| a builder on another machine | yes | no: "all processes using a database must be on the same host computer" (S) | yes |
| code | one path: build | two: build and update | one |
| an update writes | the whole study: 7 KB at 4 instances, 2.9–3.4 MB at 2 000 (M, on-disk sizes, [`metadata-draft.md`](metadata-draft.md) §2); ≈ 3 ms at an assumed 1 GB/s, ≈ 30 ms at 100 MB/s (D) | the changed rows | as (a) |

Updates are infrequent (the owner, 2026-10-20), so rewriting a study costs little against the code it saves. A study
of many large series rewrites more: twenty series of 2 000 is ≈ 60 MB, under a second at either rate (D). If that is
ever too slow, a format with one file per series lets the next revision hard-link the files of every series that did
not change, so (a) stays and only changed series are written (§12.9).

**Building revision N**, one study at a time:

1. **Resolve** the study's inputs in order: for each series its latest accepted archive (or §10, 6's policy), the
   corrections applied in order, the study-complete notice if any.
2. **Read each live bundle's header and index:** the codec, N, and the series digest (N × 8 B: microseconds).
3. **Build** into the empty directory `store/N.partial/`: the truth and the page view, both from the same resolved
   inputs, so they never disagree. The format does this step alone (§12.9).
4. **Make it durable:** `fsync` each file and the directory, rename `N.partial` to `N`, `fsync` `store/`.
5. **Publish:** create `CURRENT.lock` with `O_CREAT|O_EXCL` (it fails if another writer holds the study), write
   `N`, the format and the last input's number, `fsync` it, rename it to `CURRENT`, `fsync` `store/`. This is git's
   lockfile: "readers do not block, but they are guaranteed to see either the old contents of the file or the new
   contents" (S).
6. **Close the work:** remove `pending/<StudyUID>`, unless an input arrived during the build, in which case go to 1.
7. **Tidy:** remove revisions older than N − 1 that are older than a grace period.

A failed `fsync` stops the program, as §8 says. A new bundle is renamed into place when its series is accepted
(§12.6), before the revision that describes it is built, so a revision never names a bundle that is not there.

```text
 time ────────────────────────────────────────────────────────────────────────────────────▶
 builder   writes store/8.partial/ ── fsync ── rename to 8 ── CURRENT.lock ── rename to CURRENT
 CURRENT   "7" ─────────────────────────────────────────────────────────────┤ "8" ──────────
 reader A  reads CURRENT: 7 → opens store/7/ → reads ……… closes         sees 7 whole
 reader B                                                                    reads CURRENT: 8 → opens store/8/ …
```

**Readers during an update.**

* **The store's reader** (the server, or a reader beside the web host: [`metadata-draft.md`](metadata-draft.md) §1,
  open) reads `CURRENT`, opens revision N's files, reads, and closes. A reader still in N when N is removed keeps
  reading it: an unlinked file "will remain in existence until the last file descriptor referring to it is closed"
  (S, unlink(2)). One that read `CURRENT` but finds N already gone, two publishes inside its microseconds, reads
  `CURRENT` again. The grace period in step 7 is for that race, and for SQLite, whose corruption page calls unlinking
  an open database undefined as well (S, §2.5): a revision is removed only after its readers have closed it.
* **The bundle.** The server opens a series' file once (`FrameStore`, `server/src/media/frame_store.rs:26`). A rename
  over `<SeriesUID>.sbnd` leaves that descriptor on the old file, still whole: rename(2) replaces the name "so that
  there is no point at which another process attempting to access newpath will find it missing" (S), and the old
  file lives until it is closed. Sessions already open keep being served the bundle they started with.

**The pairing, the one new invariant.** A late instance can sort into the middle of a series, so frame *i* of the new
bundle need not be frame *i* of the old. Each frame still passes its own samples check, since that hash travels with
it, so a page holding the old metadata would paint a frame with another frame's rescale and window, and nothing would
fail. So:

* the page view carries each series' digest (§12.2), and the page puts it in the session URL beside the opening ask
  ([`../WIRE.md`](../WIRE.md) §The opening ask);
* the server compares it with the digest of the bundle it holds open. Equal: serve. Different: open the path again,
  once. Still different: refuse the session with "series changed", and the page fetches its metadata again.

| | the digest in the session URL (recommended) | bundles named by content, `<SeriesUID>.<digest>.sbnd`, the store naming the file |
| --- | --- | --- |
| a mismatch | detected, refused, fetched again | cannot happen |
| what changes | a field in the session URL, both clients and a contract-suite clause | the target's file name; the server finds a bundle through the store |
| the old bundle | freed when its last session closes | removed after a grace period, when no revision names it |
| cost now | the field | the target's change |

**When the page view's shape changes** (the owner: it will), the new shape is a new format version. `CURRENT` names
the version, so a rebuild goes study by study, resumable, and the reader reads both versions until it ends. No
rebuild is shared: each study is its own.

### 12.6 Idempotence, resume and crash recovery

**Accepting a series archive, step by step.**

1. The two files arrive: `incoming/<upload>.partial` and `<StudyUID>/<SeriesUID>.<upload>.sbnd.partial`, each
   `fsync`ed when complete.
2. The checks of §12.3 run.
3. **The commit point.** The metadata file is renamed to `inputs/<number>.<identity>.series`, `inputs/` is
   `fsync`ed, then `pending/<StudyUID>` is created and `pending/` `fsync`ed.
4. The bundle is renamed to `<SeriesUID>.sbnd`; the study's directory is `fsync`ed.
5. The PCS is answered `accepted <identity>` and deletes its outbox copy (§8).
6. The builder publishes a revision (§12.5).

**After a crash, the disk says where it stopped.**

| it stopped after | on disk | at restart |
| --- | --- | --- |
| part of 1 | partial files | the PCS asks the offset and resumes; partials past their expiry are deleted |
| 2 | complete partials, no input | the checks run again: they change nothing |
| 3 | the input, the bundle still `.partial` | the input names its upload: finish step 4 |
| 4 | the bundle in place, the PCS not answered | the PCS sends again; its identity is in `inputs/`: answered `accepted`, no work |
| part of 6 | `store/N.partial/` or `CURRENT.lock` | remove them; build again |
| 6's rename, before `CURRENT` | `store/N/` newer than `CURRENT` | remove it; build again |

**A restart reads `pending/`, not every study:** its work is the studies with work, whatever the archive's size.
`pending/` is Maildir's discipline: one name per item, made by rename, read and removed with "no locks", "reliable
even over NFS" (S).

**Idempotent.** The same identity again is answered `accepted` with no work. The same series UID with a new identity
is a new input, and what the build does with the old one is §10, 6. A study's revision built twice from the same
inputs has the same content (a test to write when it is built: build twice, compare). The bytes need not be equal:
SQLite's file bytes vary with its version ([`metadata-draft.md`](metadata-draft.md) §2).

**One writer per study, by construction.** One builder per host; if there are several, a study goes to the one its
UID's hash names. `CURRENT.lock` catches a breach: the second writer fails and says so, and never removes a lock it
did not make. On network storage `O_EXCL` holds only "when using NFSv3 or later" (S, open(2)).

### 12.7 Telling the server

**The server does not need to be told for correctness.** It reads `CURRENT` at each page open (one small file:
microseconds on local disk, one round trip on network storage) and compares the series digest at each session open
(memory only, §12.5).

| | (a) nothing; the server checks on use (recommended) | (b) a datagram on a local socket | (c) inotify | (d) the catalog's row (§5) |
| --- | --- | --- | --- | --- |
| how | §12.5's reads | the builder sends "study, revision" after step 5 | the server watches every study's `store/` | the builder upserts the study's row with its revision |
| a builder on another machine | yes; on a network filesystem another client's rename may show only after the directory attribute cache, 30–60 s by default (S, nfs(5)) | a TCP message instead | no: inotify "does not catch remote events that occur on network filesystems" (S) | yes |
| a lost message | nothing to lose | harmless with (a) beneath it | — | the start-up scan of §5 |
| cost now | the pairing field | a socket and its protocol | one watch per study, thousands of them | the catalog, deferred |

A push is worth adding when a feature needs one: a worklist that shows new studies (d), or an open page told that its
series changed (b). What an open page does then is the owner's (§12.10, 8).

### 12.8 Running it on another machine

**What has to stay on the PACS host.** The bundles: pixels live on the host of the server that serves them (decided).
So the receiver, which writes them, stays where they live; sending them to another machine and back would cross a
network twice for nothing. What can move is the builder, and check 8, the only heavy CPU here.

**What the jobs cost, across the band** (D, nothing measured): receiving over TLS ≈ 1.3 ms of a core per MB
([`link.md`](link.md) §2), so 100 GB a day is ≈ 130 core-seconds; check 3 adds ≈ 0.03 ms per MB; a build is
milliseconds per study (§12.5). At these volumes the program does not saturate a host on its own. What could justify
moving it is its effect on the server's latency at thousands of sessions, which is not measured; nothing here claims
past that.

| | (a) on the PACS host | (b) the builder elsewhere, writing over a network filesystem | (c) the builder elsewhere, sending each revision back | (d) more PACS hosts, each with its own program |
| --- | --- | --- | --- | --- |
| shared | nothing | the PACS host's study tree, exported, and `pending/` | the inputs reach the builder (kilobytes per instance); each revision comes back (megabytes) | where each study lives: StudyUID → host, the catalog's job (§5) |
| costs | the host's CPU | each `fsync` a round trip; `O_EXCL` only on NFSv3+; `flock` emulated as whole-file `fcntl` locks (S, flock(2)); a second machine that can write every study | a small publisher on the PACS host, which is §12.5's steps 4–5, the same code | moving a study is copying its directory, then changing the map |
| switching from (a) | the root's path | the publish step behind one function | a router in front of the receivers |

**The queue.** On one host it is `pending/`. Under (c) the remote builder asks the PACS host's publisher for its
`pending/` list over the same kind of link, and sends each revision back to it; no queue service is needed until a
measurement asks for one.

### 12.9 Where the store's format plugs in

**Two functions and one field.**

* **build** takes a study's resolved inputs (§12.5, step 1) and an empty directory, and writes one revision's files:
  the truth and the page view.
* **open** takes a revision's directory and returns the reader that answers the page view.
* `CURRENT`'s **format** field says which open reads a revision, so two formats live side by side while studies are
  rebuilt from one to the other.

Nothing else in the program reads a store file: receiving, checking, the inputs, revisions, `CURRENT`, recovery and
telling the server are the same for every format. What a format must do to fit:

* write only into the directory it is given, and never change a file after it is published. SQLite fits when its
  readers open with `immutable=1`, which "skips all file locking and change detection" (S), and its files are never
  renamed over while open;
* give the same content from the same inputs;
* if it can, keep one file per series, so that an update hard-links what did not change (§12.5).

**Switching format** is a rebuild of every study from its inputs, one study at a time, resumable through `CURRENT`.

### 12.10 The owner's decisions

Listed, not taken.

1. **The shape** (§12.1): one program with two jobs (recommended), or two processes.
2. **A series on the wire** (§12.2): the bundle and the metadata as two files and a commit (recommended), or one tar
   (§4). The unit of acceptance stays the series either way.
3. **Groups the parser's fault leaves uncheckable** (§12.3): accepted and marked unverified (recommended), or refused.
4. **The optional checks** (§12.3): the frames' own headers, check 7 (recommended on); decoding every frame, check 8
   (recommended off on arrival, since the client checks every frame it shows; perhaps a scrub later).
5. **The received groups** (§12.4): kept (recommended), or the store only.
6. **The update** (§12.5): a revision directory named by `CURRENT` (recommended), SQLite in place, or one file
   renamed over.
7. **The pairing** (§12.5): the series digest in the session URL (recommended; a wire change), or bundles named by
   content (a change to the target's file name).
8. **An open page whose series changed:** refused and refetched without a word, or the user told. A clinical
   question as much as a technical one.
9. **When a study's store is first published:** at each accepted series (recommended, as §4 argues for the link), or
   only at the study-complete notice.
10. **An exam group that differs** between series of one study (§12.3): keep the held one and flag the study for
    review (recommended), or apply it as a correction.
11. **Corrections and withdrawals:** who may author a correction at the PACS; whether and how a series or a study is
    withdrawn. Neither is designed.
12. **Telling the server** (§12.7): nothing (recommended), a local socket, or the catalog.
13. **Another machine** (§12.8): on the PACS host now (recommended), with (c) and (d) kept as configuration; (b) not
    recommended.

### 12.11 Recommended

**One program beside the server, receiving and building, whose only interface to the server is the files it
publishes.** Per series it receives two files and a commit, checks the structure, the coded-frame hashes, the group
hashes, the UIDs and the frame count, and refuses the series whole on any failure. It logs what it accepted in the
study's `inputs/`, places the bundle by rename, and answers the PCS. The builder then builds the study's store whole
into a new revision directory and publishes it by replacing `CURRENT`. Pages name their series' digest when they open
a session, so the server serves only the bundle their metadata describes.

**Why.** Every choice in it is the switchable one. Kept inputs make every store, format and page view rebuildable.
An immutable revision with one pointer works for any format, on local disk and network storage, with a builder on
this host or another, and with one code path. The digest check makes the server correct without being told, so a
notification can be added when a feature needs it rather than now. What it costs now: the whole study rewritten at
each update (megabytes, infrequent), the groups stored twice (under 1 % of the pixels), and one field on the wire.

**Gaps theory cannot close:** the build's and an update's time at 4, 200 and 2 000 images on local and network
storage (the handoff's benchmark, read and update); the restart's time with many pending studies; the program's
effect on the server's latency at thousands of sessions; how late another NFS client sees a rename of `CURRENT` under
the mount options a PACS uses.

## 13. Sources

Fetched 2026-10-11, pinned by tag or commit and the first 12 hex of the fetched file's sha256. Raw copies are not
committed.

* **DICOM PS3.18 2026d** (`2a7e405198f8`); PS3.5 2024c §A.5 (`a0a9c447434c`).
* **AWS HealthImaging** developer guide: import jobs (`f07cd25cda39`), pixel data verification (`e3185e5a8a28`),
  transfer syntaxes (`4d326c181d77`), quotas (`ec3239e5262e`), STOW-RS (`f1fc1b63febc`), image set metadata
  (`b14720a1699e`), concepts (`8de44e720a0f`). AWS for Industries, on-premises integration with Greengrass, 2023-07-26
  (`23729ab84946`); CitiusTech pipeline (`2043659b48d6`).
* **Google Cloud Healthcare API**: DICOM conformance (`2cc082440318`), import and export (`20e67f18173d`), BigQuery
  streaming (`404657a33b1b`).
* **Azure DICOM service**: conformance statement v2, dated 2026-08-11 (`a7abac5ac3df`), extended query tags
  (`235bd92e351a`), change feed (`6f08df8798d8`), Data Lake storage (`7c7eb55c202b`).
* **Orthanc** book: storage FAQ (`daccaab883ba`), features (`828938cdf7f0`), transfers plugin (`9f0fa7ccdbc6`),
  PostgreSQL plugin (`76f0aa1f0c0a`), MySQL plugin (`506b1e9857cf`), SQLite note (`f321db6bfb25`);
  `Configuration.json` at tip (`f342eab685e6`). Orthanc S3 ingestion (`728461648ed2`).
* **dcm4chee-arc-light** conformance 5.35: storage (`f73a73c03dec`), archive device (`7b0fd42fede9`), compression rule
  (`234241af044d`); wiki `442dc7ac7bca` Installation (`772e6694df2d`).
* **Clunie**, "Lossless Compression of Grayscale Medical Images", SPIE MI 2000 (`a2539feca600`).
* **pappuks/medical-image-codec** `b85d6f48ddea`: README (`07575da036bd`), compression results (`a652f8203740`).
* **Intel**, "Low-Latency Lossless Compression of Monochrome Medical Images", 2022 (`71cc8bf35339`).
* **Taubman, Naman, Mathew et al.**, HTJ2K white paper, 2020-05-29 (`ef3837d22efd`).
* **grok** `cb6f402a1faa`: LICENSE, AGPL v3 (`533acb8581ee`), README (`66cb29913769`).
* **zstd** v1.5.7 `f8745da6ff1a`: README (`c97c5752f0cf`), dictionary charts (`d81e32e43cd8`, `91460b20e981`,
  `28b60851ed26`), `zstd.1.md` (`c661300a953f`), `zdict.h` (`abacadb94e3f`); v0.5.0 README (`b5d246f8db92`).
  RFC 8878 (`8ee6be035341`).
* **Hashes**: BLAKE3 1.8.7 `f3149ec5bb54` speed chart (`bfcc3fc3df66`) and paper `ac784c9f22a4` (`ce179e62f29a`);
  xxHash v0.8.3 `e626a72bc232` README (`750a69246094`), wiki `1e88b88712bf` (`f30033d73fa7`); minio/sha256-simd
  `6096f891a77b` (`3ceed2e58827`).
* **SQLite** 3.54.0: application file format (`2822f91d4efb`), faster than the filesystem (`2cba6be472d2`), when to use
  (`d0850096c26e`), limits (`0cdbd54a8916`), WAL (`f3467b530b88`), atomic commit (`5a5be7b66021`), VACUUM
  (`740f02ade006`), `sqlite3_rsync` (`30b70362b95d`), sessions (`5410c53bab44`), JSON (`bca8f665a03a`).
* **libSQL** `d6c75af6353b`: README (`5a7d05bd5b34`), licence (`cecf589818a5`), user guide (`663a54f941ce`),
  consistency (`07426f42bff5`); Turso README `c5dc0e59c431` (`fe932831cf8d`), blog 2025-01-21 (`58fe5e8d9b88`).
* **PostgreSQL**: licence (`ecc2a8f75f01`), versioning (`3bd34fc19d0f`), JSON types (`04813ed35af6`), partial indexes
  (`81eead708c01`), logical replication (`966b03b2aff8`). **MySQL**: server LICENSE at `3b99be40f8a3`
  (`9ec6888641d8`); reference manual 8.4 on JSON read through a fetch summary, not pinned.
* **Uploads**: tus 1.0 `c6a11fa3d7b6` (`dfc82027d295`); draft-ietf-httpbis-resumable-upload-13 (`3053c6e3fbdc`); S3
  multipart limits (`387c24248a3e`), checksums (`6dc12f843221`); GCS resumable (`6e9d45cf7278`).
* **Publication**: POSIX 2024 `rename` (`06671610134b`), `fsync` (`5c2975abbb2d`); Linux `fsync(2)` man-pages
  `ae6b221882ce` (`01522de115da`); Dan Luu, "Files are hard" (`3fdda83b367e`); PostgreSQL wiki, Fsync Errors
  (`22b894afe50d`).
* **Streaming the pack** (§11), fetched 2026-10-13: PKWARE APPNOTE.TXT 6.3.10 (`0b993022a7d3`); RFC 9112
  (`e4f426bac620`); DICOM PS3.4 2026d Annex J (`41c056d20052`); S3 multipart overview (`69c3cbba7a97`); tus 1.0,
  draft-13 and S3 limits as above, re-fetched to the same hashes.
* **The PACS receiver and builder** (§12), fetched 2026-10-20: Linux man-pages 6.19 (2026-02-08) rename(2)
  (`8772946a809a`), unlink(2) (`54342d11f277`), open(2) (`d665489cadb8`), flock(2) (`f46b6eb4cb7c`), inotify(7)
  (`79f5ab18e2fc`), nfs(5) (`2b9d9223f2fa`), from man7.org; the version control system git at tag v2.51.0,
  `lockfile.h` (`11169c5369e7`); D. J. Bernstein, "Using maildir format", cr.yp.to/proto/maildir.html, undated
  (`8cc7fa200494`); SQLite's corruption page (`e00709e3f37e`), URI filenames (`9fba2ee18bc6`) and WAL
  (`f3467b530b88`), re-fetched to the hashes [`metadata-draft.md`](metadata-draft.md) and the SQLite line above pin.
