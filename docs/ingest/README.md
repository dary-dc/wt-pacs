# Ingest — from the hospital to the PACS

The target shape of everything between a hospital's image sources and the PACS, and the one place every decision about
it is listed. The reasoning lives in the files linked from §5; this file says what the system does and where each
choice stands.

![The hospital ↔ PACS pipeline: decided, recommended, open and deferred parts](pipeline.svg)

## 1. The flow

**At the hospital.**

1. **Receive.** Image sources (modalities, other archives) send DICOM to a receiver: dcmtk's `storescp`, modified to
   run the parser once per received instance.
2. **Parse.** The owner's C parser writes one directory per instance: the exam, series, instance and private
   attributes as key-value group files, each named by its BLAKE3-256, and one raw file per frame. That directory is
   the hand-over: a crash checkpoint, inspectable, and a process boundary between C reading untrusted files and the
   ingest.
3. **Wait for the series.** DICOM marks no last instance, so the ingest needs a rule for when a series is complete
   (open, §4).
4. **Ingest (Rust).** Per frame: hash the raw samples, encode them exactly (HTJ2K or AV1), decode the result back and
   compare, and hash the coded bytes. Nothing is written unless every frame is equal. The metadata groups are kept as
   the parser wrote them and compressed together, one zstd stream per series.
5. **Outbox.** One archive per series (the `.sbnd` plus its metadata groups) waits in an outbox until it is complete
   and checked, and leaves it when the PACS acknowledges its digest.

**On the link.** TCP: a resumable HTTPS upload, idempotent by series UID and archive digest, resumable by offset.

**At the PACS.**

6. **Receive and verify.** The receiver checks the archive's and the frames' digests, writes into a temporary
   directory, `fsync`s, and publishes by rename.
7. **Store.** The `.sbnd` joins the image store the server already reads.
8. **Index.** The PACS builds one SQLite database per study from the metadata groups, so bad data in one study never
   forces rebuilding another. A catalog server, derived from the study databases, lets the server find studies.
9. **Serve.** The wt-pacs server streams frames to web and native clients, which check each frame's digest before
   painting it.

## 2. The integrity chain

| hash | over | written by | checked by | proves |
| --- | --- | --- | --- | --- |
| XXH3-64 | the raw samples, as read | the ingest | the ingest after decode-back; the client after its decode | the coded frame, and the shown one, is the encoder's input |
| coded-frame digest (open) | the coded bytes | the ingest | the PACS on receipt, the server on read | transit and storage, without decoding |
| BLAKE3-256 | a metadata group | the parser | the PACS, after decompressing | parser → PACS for metadata, once the parser hashes the bytes it writes (§3) |
| TLS | the bytes on the wire | — | — | the link alone |

The client's checks stay on by default.

## 3. Failure and recovery

* **A bad frame** fails the series at the site: nothing is sent. Storing the good instances and marking the series
  incomplete is the alternative (open).
* **A cut upload** resumes from its offset; a repeated one changes nothing. A known series UID with a new digest is a
  new generation; what happens to the old one is open.
* **A publish** is a rename after `fsync`: readers see the whole series or none of it.
* **A bad study database** is rebuilt from its groups without touching any other study; the catalog is rebuilt by
  scanning the study databases.

## 4. Decisions

| decision | status | where it is argued |
| --- | --- | --- |
| The ingest is written in Rust | **decided** 2026-10-11 | [`../FIXTURES.md`](../FIXTURES.md) §A compiled ingest at the site |
| The parser's directory output is the hand-over, to start | **decided** 2026-10-11 | [`design.md`](design.md) §3 |
| The link is TCP; a QUIC shipper is dropped until research shows a gain | **decided** 2026-10-11 | [`link.md`](link.md) |
| One SQLite database per study, built in the PACS | **decided** 2026-10-11 | [`design.md`](design.md) §5 |
| A catalog server indexes the study databases | **decided** 2026-10-11 | [`design.md`](design.md) §5 |
| The client's exactness checks stay on by default | **decided** 2026-10-11 | [`../adr/exactness-in-production.md`](../adr/exactness-in-production.md) |
| Frames are coded at the site | recommended | [`design.md`](design.md) §2 |
| One archive per series on the link | recommended | [`design.md`](design.md) §4 |
| Metadata compressed one stream per series | recommended | [`design.md`](design.md) §7 |
| Publish by rename after `fsync`; idempotent by UID + digest | recommended | [`design.md`](design.md) §8 |
| When a series is complete; what a late instance does | open | [`design.md`](design.md) §4 |
| The raw-frame check is the XXH3-64 already written for the client | **decided** 2026-10-12 | [`design.md`](design.md) §6 |
| A digest of the coded bytes | open | [`../adr/exactness-in-production.md`](../adr/exactness-in-production.md) §8 |
| A changed duplicate: replace, keep both, or hold | open | [`design.md`](design.md) §8 |
| A bad instance: refuse the series, or store the rest marked incomplete | open | [`design.md`](design.md) §8 |
| The upload's shape (S3-style multipart, tus, per-file PUT, rsync) | open | [`link.md`](link.md) §7, §9 |
| Site host tuning, the server's kernel, the site's congestion controller | open | [`link.md`](link.md) §4, §9 |
| How the parser ships with the ingest | open | [`../FIXTURES.md`](../FIXTURES.md) §A compiled ingest at the site |
| The parser hashes the bytes it writes | open | §5 below |
| The catalog's engine | deferred | — |

## 5. Parser findings

Read from the parser's public source for the ingest's input contract. Phase 1 does not act on them; they are for the
parser's author.

* **Planar configuration (0028,0006) is never read**, so a colour frame stored plane by plane is written plane by plane
  with nothing saying so.
* **Three of the four group hashes cover a length taken before the UTF-8 conversion** (series, instance, private; the
  exam group's is right). A group whose text changed length in the conversion fails a recompute while intact.
* **Frame files are named with five digits**, so a series over 99 999 frames cannot be written.
* **The variable `comp` holds samples per pixel (0028,0002)**, though its comment says planar configuration.

## 6. Where the details live

* [`design.md`](design.md) — each part of this pipeline against its alternatives, with the prior art.
* [`link.md`](link.md) — why the link is TCP, and what QUIC would have to show.
* [`contract.md`](contract.md) — the parser's directory output as the ingest reads it, and what phase 1 reads of it.
* [`../FIXTURES.md`](../FIXTURES.md) §A compiled ingest at the site — today's Python ingest and the plan for the
  compiled one.
