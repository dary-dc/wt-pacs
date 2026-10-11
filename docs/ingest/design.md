# Ingest design — from the parser to the PACS

*Queue row 153 INGESTDESIGN, 2026-10-11. Theory only: read from sources (§10), nothing built, nothing timed. It
compares options and recommends; every choice is the owner's (§10).*

**The question.** Today's proposal — the owner's C parser writes a directory per instance; a Rust ingest at the site
hashes, codes exactly, checks and compresses; an outbox; TCP to the PACS; the PACS checks, writes the image layout and
builds one SQLite database per study; a catalog server indexes the studies — grew out of what exists. This file weighs
each of its parts against the alternatives. The plan it extends is [`../FIXTURES.md`](../FIXTURES.md) §A compiled
ingest at the site; the link itself is row 154's (LINKTCP); the parser's output contract is
row 155's (INGESTRS1: the row's brief in [`../av1/queue.md`](../av1/queue.md)).

**The parser was read only through row 155's brief**, which reads its public source: one run per SOP instance, a
directory per instance, group files named by their BLAKE3-256, one raw file per frame. That it has a key-value stream
output and an HTJ2K output on the grok encoder is from this row's brief, not read.

## Contents

1. [The answer in plain words](#1-the-answer-in-plain-words)
2. [(a) Where frames are coded](#2-a-where-frames-are-coded)
3. [(b) How the parser hands over](#3-b-how-the-parser-hands-over)
4. [(c) What travels](#4-c-what-travels)
5. [(d) Where the layout, the study databases and the catalog are built](#5-d-where-the-layout-the-study-databases-and-the-catalog-are-built)
6. [(e) The integrity chain and what each hash costs](#6-e-the-integrity-chain-and-what-each-hash-costs)
7. [(f) Metadata compression](#7-f-metadata-compression)
8. [(g) Recovery](#8-g-recovery)
9. [(h) Prior art](#9-h-prior-art)
10. [The owner's decisions](#10-the-owners-decisions)
11. [Sources](#11-sources)

## 1. The answer in plain words

* **Today's proposal holds on most axes, and the one it leaves open matters most: when a series is complete.** DICOM
  has no "series ended" marker. A bundle per series can be built only once its instances stop arriving; the AWS edge
  gateway closes a batch when the modality's association ends (§9). Until that rule is chosen, (c) cannot pick its
  unit.
* **(a) Code frames at the site.** Raw frames with zstd cost 1.0–1.8× HTJ2K's bytes on the link (median ≈ 1.4× over
  seven images, one source; JPEG 2000 1.2–1.7× gzip in Clunie's 3 679 images). They also move the encoder's CPU to the
  cloud, where it is paid. Coding inside the parser in C ties the product's bytes to grok, AGPL v3, and to a second
  HTJ2K encoder whose output is not OpenJPH's.
* **(b) Keep the directory.** It is a crash checkpoint, inspectable, and a process boundary between a C parser reading
  untrusted files and the ingest. Its cost is one write and one read a frame; P-STAGE predicts under 5 % for HTJ2K.
  A pipe or a library call buys at most that 5 %, and the library call loses the boundary.
* **(c) Send per series: the `.sbnd` plus the series' metadata groups, as one archive.** The bundle is already the
  server's unit, and its coded frames are already checked. The groups are what the PACS needs to build the study's
  database. One archive per series gives one upload to resume and one unit to refuse.
* **(d) The PACS builds the layout and the study database; the catalog is derived from them.** The study database is
  the truth. The catalog holds one row per study, written after that study's database is published, and keyed by
  Study Instance UID with a generation number. A rebuilt database re-registers by the same upsert, so the whole catalog
  can be rebuilt by scanning. SQLite cannot query across thousands of files (ATTACH: 10 by default, at most 125), so
  the catalog is needed. **PostgreSQL** is recommended: PostgreSQL licence, `jsonb` with GIN indexes, partial indexes,
  both reference archives support it. libSQL's server holds many SQLite databases in one process and keeps one
  dialect, but its maintainer has moved its effort to a pre-1.0 rewrite.
* **(e) The owner's point holds, and cost does not decide it.** A metadata group is kilobytes, so any hash of it costs
  microseconds against a frame's milliseconds. What decides is what each hash proves. The PACS decompresses the
  metadata to build the database, so a hash of the original, checked after decompression, proves parser → PACS end to
  end. A hash of the compressed bytes proves only the link. Reuse the parser's BLAKE3 group hashes for that, once row
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

| | at the site, by the Rust ingest (proposed) | inside the parser, in C | in the cloud |
| --- | --- | --- | --- |
| encoder | OpenJPH, pinned, the bytes today's ingest writes (row 155's parity) | grok, AGPL v3 (§11); a second HTJ2K encoder | any, paid per CPU-second |
| bytes on the link | HTJ2K's | HTJ2K's | raw + zstd: 1.0–1.8× HTJ2K's (below) |
| CPU | the site's (the owner: free) | the site's | the PACS operator's |
| exactness check | decode-back at the site, before anything leaves | needs a decoder in the parser, or the ingest re-decodes | decode-back in the cloud; end to end only if the site hashed the raw samples first |
| what the check proves | the coded frame equals the encoder's input, at the source | the same, if a check is added | the coded frame equals what arrived; the site's raw hash then proves what arrived equals what was read |

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
the cloud moves that time onto the operator's bill and saves none of the site's hashing. AWS HealthImaging does exactly
this: it transcodes to HTJ2K on import and checks a CRC32 of each frame taken before the encode against the decoded
result (§9). The check is 32 bits, which [`../adr/exactness-in-production.md`](../adr/exactness-in-production.md) §7
rejects at this scale.

**In the parser.** grok is AGPL v3. Shipping it inside the site's binary puts the binary under its terms, which is a
licence question for the owner (§10, 3). It also adds a second encoder whose bytes differ from OpenJPH's served profile
(RPCL, five decompositions, 64² blocks, [`../codecs/htj2k.md`](../codecs/htj2k.md)). Row 155's byte-identity parity
then fails by construction and a profile check takes its place. And the decode-back check would have to be written in C.

**Recommended: at the site, by the Rust ingest.** It is the only option where the link carries the fewest bytes, the
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

| | the parser's files, as written | the series' `.sbnd` + its groups (recommended) | one archive per study |
| --- | --- | --- | --- |
| frames | raw (if coded at the PACS) or coded files, one a frame | coded, in the server's own format | coded |
| unit to resume and refuse | a file | a series | a study |
| requests on the link | one a file, or a stream of them | one a series | one a study |
| the PACS's work | build bundles and the database | build the database; place the bundle | build the database; place the bundles |
| ready when | each file lands | the series is complete | the study is complete |

**Recommended: one archive a series** — its `.sbnd`, its series group and its instances' groups, as a tar or one
zstd stream (§7). The series is what the server serves ([`../FIXTURES.md`](../FIXTURES.md) §SBND series bundle) and
what the ingest checks. A study can take hours to finish arriving, and its series are independent, so a study unit
holds back finished series for no gain. Single files multiply requests and leave the PACS to build what the ingest
already built and checked.

**What none of the three settles: when a series is complete.** DICOM sends instances, and nothing marks the last one.
The choices are the end of the modality's association (the AWS Greengrass edge in §9), a quiet period with no new
instance, or a count from the modality (Number of Series Related Instances is a query attribute, not sent with the
images). An instance that arrives after its series was sent makes a new generation of that series' bundle (§8). This
is the owner's (§10, 1).

## 5. (d) Where the layout, the study databases and the catalog are built

**The image layout and the study database: at the PACS, from the groups** (the owner's decision of 2026-10-11, one
SQLite file per study so that bad data in one study never forces a shared database to be rebuilt). Building at the
site and shipping the database is the alternative. It moves CPU to the site, but the PACS would trust a database it
did not build, and the site would need the whole study before the database is final.

SQLite fits this use. One writer at a time per file, which a study has. A single file, copied or moved whole. Atomic
commit across crashes, given `fsync`. `VACUUM INTO` and `sqlite3_rsync` for copies, the session extension for
changesets, JSONB since 3.45. WAL does not work over a network filesystem, so a study database is written on the
PACS's local disk before it is published. SQLite's own guidance sends many networked clients to a client/server
engine. That is the catalog's job, not the study database's.

**The catalog.**

| | PostgreSQL (recommended) | MySQL | libSQL server (sqld) |
| --- | --- | --- | --- |
| licence | PostgreSQL licence (BSD-like) | GPLv2 with the Universal FOSS Exception, or commercial | MIT |
| JSON | `jsonb`, GIN-indexed containment | binary JSON, indexed only through generated columns or multi-valued indexes | SQLite's JSON and JSONB |
| partial indexes | yes | not stated (absence not confirmed) | SQLite's |
| replication | logical, publish/subscribe | (not read) | primary + replicas polling the WAL; no global ordering |
| dialect | a second one | a second one | the study databases' own; one server holds many databases (namespaces) |
| state | 18.6 current, supported to 2030-11 | — | its maintainer now focuses on a pre-1.0 Rust rewrite; libSQL "run in production today" |
| reference archives | dcm4chee, Orthanc | dcm4chee, Orthanc | none |

**Schema scope.** One row per study: Study Instance UID (key), patient ID and name, birth date, sex, study date and
time, accession number, description, referring physician, the modalities in the study, its series and instance
counts. A worklist adds what DICOM does not carry: status, priority and assignee. Then the location of the study
database, its generation and its digest. Per series, only what a search filters on: modality, body part, series
description. Everything else stays in the study database. A cross-study search finds studies in the catalog and opens
their databases.

**Consistency: the study database first, then the catalog.**

1. The PACS builds the study's new database beside the old one, then publishes it by rename (§8).
2. It upserts the catalog row, keyed by Study Instance UID, with a generation one higher and the new database's digest.
3. A crash between 1 and 2 leaves the catalog one generation behind. A start-up scan compares each database's
   generation with its row and re-registers the ones behind.

A study database rebuilt from its groups re-registers by the same upsert. The catalog is derived throughout, so
losing it means a rescan, not lost data. An ordered change log beside it (Azure's change feed, §9) is optional; the
generation number is enough for one PACS.

## 6. (e) The integrity chain and what each hash costs

**What each hash proves.**

| hash | over | written | checked | proves |
| --- | --- | --- | --- | --- |
| SHA-256 today, any 128-bit+ hash in Rust | the raw frame, as read | the ingest, before coding | the ingest, after decode-back | the coded frame is the encoder's input |
| XXH3-64 (served today) | the raw frame | the ingest | the client, after its decode | the shown frame is the encoder's input ([`../FIXTURES.md`](../FIXTURES.md) §Frame digests) |
| a coded-frame digest | the coded bytes | the ingest | the PACS on receipt, the server on read | transit and storage, without decoding; row 123's decision (2) |
| BLAKE3-256, the parser's | a metadata group | the parser | the PACS, after decompression | parser → PACS for metadata, end to end, *if* the hash covers the bytes written |
| an archive digest | the series archive | the ingest | the PACS on receipt | the link only |

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
as a key; BLAKE3-256 has no such limit. The PACS can skip a series or exam group it already holds (§8). A zstd frame's
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

**Recommended: one stream per series**, matching §4's archive. No published ratio on DICOM headers was found. A
gzip-style compressor halves "a typical instance" in Orthanc's words, pixels included. DICOM's own deflated syntax is
"particularly useful" for objects without pixels. Against frames of hundreds of kilobytes to tens of megabytes, metadata
compression moves the link's bytes little. Its value is storage at the PACS, if the groups are kept.

## 8. (g) Recovery

* **Resumable by offset.** A series archive is uploaded so that a cut resumes where it stopped. tus 1.0 (`Upload-Offset`,
  409 on a mismatch, `sha1` checksums at least) and its IETF successor draft-ietf-httpbis-resumable-upload-13 (a draft,
  not an RFC) do this over HTTPS. So do S3 multipart (≤ 10 000 parts of 5 MiB–5 GiB, per-part CRC64NVME, CRC32C,
  SHA-256 or XXH3) and GCS resumable sessions (a week, 256 KiB chunks). Row 154 picks among them.
* **Idempotent.** Receiving the same series archive twice changes nothing: the PACS keys a series by its UID and the
  archive's digest, and a known digest is acknowledged without work. A known UID with a new digest is a new
  generation. Whether it replaces the old one or is held for review is the owner's (§10, 6). The archives in §9 differ
  exactly here: Orthanc `Never`/`Always`/`IfChanged`, dcm4chee four overwrite policies, AWS overwrite with a version,
  Azure and Google refuse.
* **Dedupe.** The parser does not rewrite an exam or series group it already wrote. The PACS can likewise skip a group
  whose BLAKE3 it holds. That saves only metadata bytes, which are few (§7). The frames carry no such key and need
  none: an instance is sent once.
* **Isolation.** A bad instance is refused by name at the site and its series is not sent. That is today's rule:
  nothing is written unless every frame passes. The alternative, STOW-RS's model, stores the good instances and lists
  the failed ones, so a partial series is served. That is the owner's (§10, 7). A bad study database is rebuilt from
  its groups without touching another study (§5).
* **Published by rename.** The PACS writes a series or a study database into a temporary directory and `fsync`s each
  file and the directory. Then it renames into place and `fsync`s the parent. POSIX makes rename atomic in normal
  operation, not across a crash; Linux's `fsync` does not cover the directory entry. A failed `fsync` is fatal, not
  retried (PostgreSQL's lesson). The sequence is drawn from the sources; none states it whole.
* **At the site,** the outbox is the same directory discipline. An archive leaves when it is complete and checked, and
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

Listed, not taken; under the queue's §Blocked.

1. **When a series is complete** (§4): the association's end, a quiet period, or another signal. Also whether a late
   instance makes a new generation.
2. **The unit on the link** (§4): one archive per series (recommended), the parser's files, or one per study.
3. **Where frames are coded** (§2): at the site (recommended), in the parser on grok (AGPL v3, a licence decision), or
   in the cloud.
4. **The catalog** (§5): PostgreSQL (recommended), MySQL, or libSQL's server; the schema scope above.
5. **The raw-frame check's hash** (§6): SHA-256 as today, BLAKE3, or the XXH3-64 already written.
6. **A changed duplicate** (§8): replace, keep both generations, or hold for review.
7. **A bad instance** (§8): refuse its series (today), or store the rest and mark the series incomplete.
8. **The parser's group hashes** (§6): whether the parser hashes the bytes it writes, so the PACS can check every group
   (row 155's open point 2).
9. **Metadata compression** (§7): per series (recommended), or per group with a shipped dictionary.

Gaps theory cannot close, one line each: HTJ2K against zstd on the lab's own sets (no published side-by-side beyond
seven images); DICOM header sizes per modality (no source); P-STAGE's share (proposed in
[`../FIXTURES.md`](../FIXTURES.md)).

## 11. Sources

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
