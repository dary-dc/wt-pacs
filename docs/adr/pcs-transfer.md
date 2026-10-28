# ADR: how what the PCS produces reaches the PACS

**Status:** proposed 2026-10-25, **theory only: nothing built, nothing measured.** Every choice is the owner's, and
those that touch the PCS are the PCS team's too (§12). The record is the basis of the discussion with the PCS team, so
it lists every trade-off found; summaries come later.

**Labels.** *Source*: read in a document pinned in §14, with its section. *Estimated*: arithmetic from assumptions
stated beside it. *Inference*: reasoned from sources, not stated by them. Nothing here is *measured*; §11 says what
would be, and what each result decides.

**Relation to earlier records.** [`../ingest/link.md`](../ingest/link.md) decided the link is TCP and that QUIC returns
only on its §8 conditions; [`../ingest/design.md`](../ingest/design.md) recommended one archive per series (§4),
metadata compressed per series (§7) and publish by rename, idempotent by UID and digest (§8). This record does not
repeat their evidence; it takes the owner's decisions of 2026-10-24/25 (§1) and settles what they leave open. Where it
departs from them it says so (§13).

## Contents

0. [On one screen](#0--on-one-screen)
1. [What is fixed](#1--what-is-fixed)
2. [The unit, and who decides a series is complete](#2--the-unit-and-who-decides-a-series-is-complete)
3. [The tool and the protocol](#3--the-tool-and-the-protocol)
4. [The package format](#4--the-package-format)
5. [Compression](#5--compression)
6. [Integrity end to end](#6--integrity-end-to-end)
7. [Confirmation and refusal](#7--confirmation-and-refusal)
8. [Updates and corrections](#8--updates-and-corrections)
9. [What changes in the PDF's design, and what stays](#9--what-changes-in-the-pdfs-design-and-what-stays)
10. [Security](#10--security)
11. [Pre-registered measurements](#11--pre-registered-measurements)
12. [Questions, each with a default](#12--questions-each-with-a-default)
13. [What acceptance changes in other documents](#13--what-acceptance-changes-in-other-documents)
14. [Sources](#14--sources)
15. [The sender's package build](#15--the-senders-package-build)

## 0 · On one screen

| # | question | recommendation | deciding reason | cost of switching later |
| --- | --- | --- | --- | --- |
| 1 | the unit | **one package per series**; a study-level change is its own small package | the series is what the `.sbnd` holds and what the server serves; a study keeps growing, so a study unit either waits or is re-sent | high: the unit fixes the name, the commitment and the PACS's publish step |
| 1b | completeness | **the PCS decides; a package's existence is the declaration**; a late instance makes the series' next revision | only the PCS sees the image producer (the PDF's three tests are all about it); the PACS sees nothing until a package arrives | low: the rule lives in the PCS alone |
| 2 | tool and protocol | **a resumable HTTPS upload** (the IETF draft's offset model, §3) over TCP, HTTP/3 allowed later on the same endpoint | outbound 443/TCP crosses hospital proxies; the server holds the offset, so a drop on any link resumes at the byte; a reply channel exists for the commitment, which rsync lacks | medium: the PCS's sender and the PACS's endpoint are rewritten; the package does not change |
| 3 | package format | **pax tar**, a fixed member order, deterministic headers; the package hash in its **name**; a ~100-byte header member, no manifest | streamable both ends, read by every platform's tools; determinism makes a rebuilt package byte-equal, which idempotency needs | medium: a format version in the header lets both be read during a switch |
| 4 | compression | **the metadata as one zstd stream** inside the package; **frames never**, unless §11's M2 shows a gain | metadata saves ~1.5 % of a CT's send time and ~9 % of a small-frame MR's (*estimated*, §5), at tens of ms of CPU; coded frames are already entropy-coded | low: a flag in the header; the PACS reads both |
| 5 | integrity | **TLS for the hop, the package's XXH3-64 for the file, the group files' and frames' own digests inside**; none of them authenticates | each covers a different stretch (§6); only the package hash catches a wrong resume splice or a disk fault on either side | low: hashes are additive |
| 6 | confirmation | **two replies: received (the upload's 2xx) and committed (polled by the PCS)**; the PCS deletes only on committed; a refusal makes the PCS rebuild and resend once, then an operator | Storage Commitment's split (PS3.4 J.3.2, J.3.3); polling keeps every connection outbound from the hospital | medium: the PCS's retention logic depends on it |
| 7 | updates | **whole changed group files, at the level that changed, in a numbered revision**; byte diffs only if §11's M4 shows big, frequent changes | group files are kilobytes and named by their hash; a replaced file needs no base bytes, a byte diff does | low: a new package kind |
| 8 | the PDF | **keep the tree, the parsing and the three processes; send the series' subtree as one package instead of copying the tree file by file** | the tree becomes the package's member list, so the PCS's layout survives intact | — |
| 9 | security | **one client certificate per PCS (mutual TLS), authorised per site; one HTTPS endpoint, nothing inbound to the hospital**; the PACS unpacks as untrusted input | a credential per PCS can be revoked alone; an inspecting proxy must be told to pass the endpoint through (§10) | medium: re-enrolling every PCS |

## 1 · What is fixed

**Decided by the owner, 2026-10-24/25.** The PACS receives our series bundle (`.sbnd`: header, frame table, coded
frames; [`../FIXTURES.md`](../FIXTURES.md) §SBND series bundle), not MXF or MP4. Hashes are XXH3, not BLAKE3. **One file
is sent, not a tree** (agreed in a meeting; the PDF does not say so yet). An update carries metadata only, down to the
level that changed, possibly as differences. The PACS confirms storage before the PCS deletes its copy (Storage
Commitment's model, PS3.4 Annex J), refuses a bad package so the PCS resends, and a second failure goes to an operator.
Sites differ: fiber, 5G, satellite, rural clinics without fiber; a QUIC transfer for some sites was discussed, not
decided ([`../ingest/link.md`](../ingest/link.md) stands).
*Corrected 2026-10-28:* "one file, not a tree" is open again: the team meeting of 2026-10-28 reopened rsync of
the PCS's tree, a trigger from the PCS after its rsync marking completeness and a status file pulled back as the
reply. XXH3 is wt-pacs's choice; the PCS keeps BLAKE3 by its team's, a known difference by design (full record:
the design state, `pacs-receive-design.md`, #168).

**The PCS team's document** (`pcs.pdf`, updated 2026-10-23, not in this repository) is quoted verbatim where this record
relies on it:

* P1, the processes: "(1) reception, parsing, formatting of the pixels in tiff, htj2k or jxl. (2) compression of series
  frames (3) forwarding to cloud based on some kind of rsync function".
* P2, process (2): "Prerequisite: all the instances of the series have been successfully parsed (process 1). In the case
  of a series of mono frames, this prerequisite is difficult to validate. A good approximation includes: - existing
  image numbers start at 1 and increase arithmetically, without missing number within the series; - an instance of
  another series of the study, or of another study has been received from the same DICM image producer; - there has been
  no new instance received from the same DICM image producer for x seconds."
* P3, process (3): "The result of our parsing is a file system on the PCS side. The system, which grows over time (all
  the files in their corresponding directory) need to be copied to the cloud to be processed. To do so, we are thinking
  to use some kind of rsync which triggers server side a script processing of the data for each file copied which
  updates the study sqlite database and the mysql master index."
* P4, the tree's names: "[date], [exam], [series], and [instance] are placeholder for the corresponding UIDs."

**The tree, as the owner summarised it** (not a quotation): `[exam]/--.<hash>` (patient and study attributes);
`[series]/---.<hash>` (series attributes) plus at most one of a document (pdf, xml, txt, 3d), `sf.jxl`, `mf.mxf` (HTJ2K
frames) with a construction folder `c/` of per-frame codestreams, or `mf.mp4` (lossless AV1) with a construction folder
`b/` of little-endian TIFFs; `[series]/[instance]/d/<number>.<hash>` instance attributes; `p/` private attributes. Names
carry a 64-hex BLAKE3 of the content.

**Two differences to reconcile, not settled here.** (a) This repository's reading of the parser
([`../ingest/contract.md`](../ingest/contract.md), from its source on 2026-10-11) names the instance group
`<I>/----.<h>` and the private one `<I>/priv.<h>`; the PDF's tree has `[instance]/d/<number>.<hash>` and `p/`. (b) The
contract's first level is the study **date** coded as `YYMMDD`, while P4 calls `[date]` a placeholder for a UID. The
package carries whichever layout the parser writes; the PACS must know which, so the package states a layout version
(§4).

## 2 · The unit, and who decides a series is complete

### The unit

| | the tree, file by file (P3) | **one package per series** | one package per study |
| --- | --- | --- | --- |
| what the PACS sees mid-transfer | a partial study, file by file; it must guess when to process | nothing until a whole series lands | nothing until a whole study lands |
| ready to serve | each file, but a series only when its last file is in, which nothing marks | when the series is complete | when the last series of the study is |
| matches what the server serves | no: the PACS builds or places the `.sbnd` from loose files | **yes: one `.sbnd` per series** | no: the PACS splits it |
| a study that grows (report, late series, correction) | new files appear; natural | a new series package, or a revision (§8) | the whole study re-sent, or an append format |
| commitment granularity | per file: thousands per study | **per series** | per study: one failure holds every series |
| files on the link per CT of 500 instances | ~1 000+ (instance groups, frames or construction files) | 1 | 1 per study |
| per-file cost on a 600 ms link (GEO) | rsync pipelines files (rsync(1) DESCRIPTION: "pipelining of file transfers to minimize latency costs"), so not one RTT a file; the file list and per-file metadata still cost (*not measured*) | one request | one request |
| a dropped link | per-file resume | resume inside the package | resume inside a larger package; more to redo if resume fails |
| the PDF's process (2) | already waits for a whole series (P2) | **same unit** | waits for a study, which P2 does not define |
| switching later | to a package: the PACS stops rebuilding what the PCS already built | to a study unit: a study package could hold series packages (*inference*) | to series: every commitment and name changes |

*Corrected 2026-10-28:* the file-by-file column's "must guess" and "which nothing marks" do not hold when the PCS
sends a trigger after its rsync: the PCS decides completeness and the trigger tells the PACS (the design state, `pacs-receive-design.md`, #168).

**Study-level data** (the exam group: patient and study attributes) travels in **every series package** of the study: it
is a few kilobytes, named by its hash, so the PACS keeps one copy and the duplicates cost bytes only. A change to it
alone is a **study package** (§8). A **document** (report, PDF, SR) is a series in the PDF's tree ("at most one of: a
document …"), so it is a series package without an `.sbnd`.

### Completeness

DICOM marks no last instance ([`../ingest/design.md`](../ingest/design.md) §4). The PDF's three tests (P2) — image
numbers from 1 with no gap, another series or study from the same producer, and a quiet period of x seconds — all read
the image producer's behaviour, which **only the PCS sees**. So:

| who decides | how the PACS learns it | weakness |
| --- | --- | --- |
| **the PCS (recommended)** | the package exists: the PCS builds one only for a series it judges complete | a wrong guess sends a series early; the late instance becomes revision n+1 (§8) |
| the PACS | it would need the PCS's per-file stream and the same three tests, a second time, with less information | duplicates P2, and the PACS cannot see the producer |
| the image producer, via MPPS | the producer's Modality Performed Procedure Step lists the instances it made; PS3.4 J.3.2.1.1.2 notes that Storage Commitment's retired completeness semantics were dropped because "the Modality Performed Procedure Step SOP Classes provide the same facility in a more appropriate service" | only producers that send MPPS, and only to the PCS; a fourth test for P2, not a replacement |

**A late instance** after a series was committed: the PCS sends the series again as **revision n+1** (default), or sends
only the added instances (an *addition* package the PACS merges into a new `.sbnd`). The full resend costs a series'
bytes again: a 105 MB CT at 1 Mbit/s is ~14 minutes (*estimated*, §5's assumptions). The addition package costs a merge
at the PACS and a second package kind. Which wins depends on how often late instances happen and on which links, which
nobody has counted: §11's M4.

## 3 · The tool and the protocol

### The options

| | rsync over ssh | rsync daemon | **resumable HTTPS upload** (IETF draft -14) | tus 1.0 | S3-style multipart | the same HTTP upload over HTTP/3 | a QUIC transfer of our own (WebTransport) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| port, direction | 22/TCP out | 873/TCP out | 443/TCP out | 443/TCP out | 443/TCP out | 443/UDP out, 443/TCP fallback | 443/UDP out, plus a TCP fallback to build |
| through an explicit web proxy | only with a tunnel (CONNECT) set up for ssh (*inference*) | likewise | yes (RFC 9110 §9.3.6 CONNECT) | yes | yes | no: proxies carry TCP (*inference*) | no |
| encryption, authentication | ssh: "authenticates the peer and encrypts the connection" (rsync(1) SECURITY) | "is not encrypted and its authentication is comparatively weak" (rsync(1) SECURITY); `rsync-ssl` wraps it in TLS | TLS; client certificate or token | same | same; signed requests | QUIC's TLS 1.3 | same |
| who holds the resume point | the receiver keeps a partial file (`--partial`, `--partial-dir`); the next run uses it as the basis of a delta transfer | same | **the server holds the offset**; the client asks it with HEAD (-14 §7) and appends with PATCH (-14 §8) | the server holds the offset (core protocol, HEAD/PATCH); a mismatched offset gets 409 | the client keeps the upload id and its parts | as the draft | ours to design |
| resume cost after a drop | reconnect (TCP + ssh handshakes) + block checksums of the partial on both sides (*inference* from rsync(1) `--partial`); a stalled link is noticed only with `--timeout` ("The default is 0, which means no timeout") | reconnect + the same | reconnect + one HEAD; then bytes from the offset | same | re-send the part that was cut (parts ≥ 5 MiB) | one HEAD; QUIC can resume a session in 0-RTT, which must not carry the upload (link.md §5) | ours |
| what the receiver sees mid-transfer | a temporary file in the destination directory, renamed on completion: the default is "creating a new copy of the file and moving it into place when it is complete" (rsync(1) `--inplace`); not synced to disk unless `--fsync` | same | nothing published: the upload resource is not the package until complete | same | nothing until Complete | same | ours |
| integrity in the protocol | a whole-file checksum: "rsync normally verifies that each transferred file was correctly reconstructed on the receiving side … by checking a whole-file checksum" (rsync(1) `--checksum`); xxh128, xxh3, xxh64, md5, md4, sha1 negotiable (`--checksum-choice`) | same | **none**: -14's change log says "Remove section covering integrity digests"; RFC 9530 `Repr-Digest` can be added, but its registry's active algorithms are SHA-256 and SHA-512, not XXH3 (RFC 9530 §7.2, Table 2) | `Upload-Checksum` per PATCH, `sha1` mandatory (Checksum extension) | per part (link.md §7) | as the draft | ours |
| a reply channel for the commitment | **none**: the daemon's `post-xfer exec` runs once per transfer and "The other programs cannot send any text to the user" (rsyncd.conf(5)); a second channel is needed | same | **yes**: responses, and GET on a status resource | yes | yes | yes | yes |
| the PDF's "script … for each file copied" (P3) | no per-file hook; per transfer (`post-xfer exec`), or a watcher on the destination directory | same | the endpoint's own handler, per package | same | an object-store event | same | ours |
| delete at the source | `--remove-source-files` removes files "successfully duplicated on the receiving side": a **transfer**, not a commitment, so it must not be used under §1's decision | same | the PCS deletes on the commitment (§7) | same | same | same | same |
| delta transfer | useless here: a new package has no basis on the receiver, and coded frames do not repeat (*inference*); `--whole-file` disables it | same | n/a | n/a | n/a | n/a | n/a |
| lossy links (5G, LEO, rural radio) | TCP's controller; BBR by sysctl on the PCS (link.md §4) | same | same | same | same | a controller in user space (BBRv3), link.md §8 condition 3 | same |
| high-RTT links (GEO, ~600 ms) | TCP; a satellite operator's TCP-splitting proxy can accelerate it (*inference*: RFC 3135 §2 defines such proxies; TLS over TCP leaves TCP splittable) | same | same | same | same | **a splitting proxy cannot act on QUIC**, whose transport headers are encrypted (*inference*: RFC 3135 §4.1.1 states the same choice for IPsec; RFC 9065 §2.5) | same |
| NAT idle | TCP mappings ≥ 124 min (RFC 9308 §3.2) | same | same | same | same | UDP mappings may expire after 30 s; keep-alives needed (RFC 9308 §3.2) | same |
| build, both ends | the binary on both; ssh accounts or keys on the PACS | the daemon | an HTTP client at the PCS; a handler at the PACS (no Rust crate for -14: link.md §7) | thin Rust clients (link.md §7) | an object store or its API | an HTTP/3 server at the PACS (the server already runs QUIC) | a protocol and a fallback |
| maturity | decades | decades | a working-group draft, not an RFC; it changed in October 2026 | stable 1.0 | stable | as the draft | none |

**What decides.** (1) **Reachability from a hospital:** 443/TCP out is the one port a default-deny perimeter with web
proxies leaves open (link.md §3: HICP's default-deny egress through proxies; a cloud imaging gateway asking for outbound
443/TCP only); 22 and 873 are opened per site by its IT, if at all (*inference*). (2) **A reply channel:** the
commitment (§7) needs one; rsync has none. (3) **Resume on intermittent links:** every option resumes; the HTTP ones
resume at a byte with one round trip, rsync re-handshakes and checksums the partial. (4) **Maturity:** rsync and tus are
stable; the IETF draft is moving.

**Recommendation: the IETF draft's model on HTTPS, built small.** A request carrying `Upload-Complete` creates the
upload (-14 §6: "Any method that allows content can be used, such as POST, PUT, and PATCH"), `HEAD` returns the offset (-14 §7),
`PATCH` appends (-14 §8), the retry rules of -14 §11 apply (409 with the right offset; 5xx retried; "If no final response was
received at all due to connectivity issues, the client MAY automatically attempt upload resumption by retrieving the
current offset"). The package's name carries its hash (§4 here), so the draft's missing integrity costs nothing. Implement
the subset; track the draft; tus is the fallback if the draft stalls (its offset model is the same). **HTTP/3 on the
same endpoint** costs no protocol work and stays off until link.md §8's conditions hold for a site; on GEO links it may
lose to TCP behind a splitting proxy (*inference*, §11 M3).

**rsync stays viable as a carrier for one file**, if the PCS team prefers it: the package is one file, so rsync's
per-file costs vanish, `--partial-dir` resumes, and its temp-file rename publishes atomically. It then needs: ssh, not
the daemon; a watcher on the PACS's landing directory that ignores rsync's temporary names; and **a separate channel for
the commitment** (an HTTPS status endpoint the PCS polls). That is two mechanisms where the HTTP upload is one.

**What switching costs.** The package (§4) does not depend on the carrier, so a later switch rewrites the PCS's sender
and the PACS's receiver, nothing else.

## 4 · The package format

### The container

| | **pax tar** (POSIX `pax` utility, ustar and pax interchange formats) | zip (APPNOTE 6.3.9) | the `.sbnd` extended to hold the group files | our own framing (records, or zstd frames with skippable frames, RFC 8878 §3.1.2) | no container: several files per transfer |
| --- | --- | --- | --- | --- | --- |
| write as a stream | yes | yes, with data descriptors (§4.3.9) | yes | yes | — |
| read as a stream | **yes**, member by member | the central directory is at the end (§4.3.6); streaming readers rely on local headers, which data descriptors leave incomplete | yes | yes | — |
| random access | no index | central directory (§4.3.12) | the frame table | ours | per file |
| per-member overhead | a 512-byte header, data padded to 512; two 512-byte zero records at the end ("At the end of the archive file there shall be two 512-octet logical records filled with binary zeros", `pax` §ustar) | 30 B local header + name, 46 B central header + name, 22 B end record (§4.3.7, §4.3.12, §4.3.16) | a table entry | a few bytes | a request or file-list entry each |
| long paths | ustar: name 100 + prefix 155 bytes; longer through a pax extended header (`pax` §pax Interchange Format) | 64 KiB names | n/a | ours | the filesystem's |
| integrity per member | a header checksum only | CRC-32 per member | the frame digests | ours | the carrier's |
| compression per member | no; the whole archive or nothing | yes; method 93 is Zstandard (§4.4.5), support uneven across tools (*inference*) | no | yes | — |
| > 4 GiB | yes (pax size records) | ZIP64 (§4.3.14) | the `.sbnd`'s u64 offsets | ours | — |
| tools that read it | every platform | every platform | ours only | ours only | — |
| change to our product | none | none | **the `.sbnd` format**: a structural change to the server's file | a new reader | — |
| safe unpacking | path traversal, absolute names, links, device files must be refused (*inference*; rsync(1) SECURITY lists the same class of risk for a malicious sender) | same, plus overlapping entries | none of these | ours | same as tar |

**Recommended: pax tar**, members in a fixed order: a **header member** first, then the exam group, the series group,
the instance groups in instance-number order, the private groups, then the `.sbnd` (or the document) last. Headers
deterministic: mtime, owner and mode fixed, names relative, regular files only. Then the same series always makes the
same bytes, and a rebuilt package keeps its hash (needed by §7's resend and by idempotency). Tar's 512-byte padding
costs ~0.39 MB on a CT of 500 instances (*estimated*: 501 members × ~768 B), a fifth of its metadata; packing the group
files as one compressed member (§5) removes it. §15 specifies the sender's build (proposed 2026-10-26, built as `carrier/sender`).

**The header member**, ~100 bytes of text: the layout version (§1's two differences), the kind (`series`, `study`,
`delete`, later `addition`), the unit's UID, the revision n, and whether the metadata member is compressed. It is the
one place for what the name cannot carry well. No manifest beyond it: the members name themselves by hash, and the
`.sbnd` carries its frame table and frame digests.

### Where the hash lives

| | the package's name (recommended) | a header field in the request | a manifest inside |
| --- | --- | --- | --- |
| checked before unpacking | yes | yes | no: the package must be opened first |
| visible to the operator and in logs | yes | no | no |
| survives a carrier change | yes | no | yes |
| possible at all | yes | yes | not for the package's own hash: it cannot contain itself |

**The name:** `<unit>.<n>.<h>.tar`: the unit's coded UID (contract.md §The coding), the revision, the 16-hex XXH3-64 of
the file as sent. The group files keep their own hash names, XXH3 replacing BLAKE3 (§1; *corrected 2026-10-28:* in wt-pacs's contract; the PCS keeps BLAKE3).

### Idempotency: the same package twice

Queue row 122 (HASHWHY) set the rule that **XXH3 digests are checks, never keys**
([`exactness-in-production.md`](exactness-in-production.md) §7). So the package's identity is **(unit UID, revision)**
and its hash is the check:

| arrives | the PACS holds | answer |
| --- | --- | --- |
| (u, n, h) | nothing for (u, n) | process it |
| (u, n, h) | (u, n, h) committed | the earlier commitment, no work |
| (u, n, h) | (u, n, h) received, not yet committed | "in progress"; the PCS polls (§7) |
| (u, n, h′) | (u, n, h) committed | **refused as a conflict**; operator (two packages claim one revision: two PCSs, or a PCS that lost its state) |
| (u, n, h′) | (u, n, h) refused | process it (the rebuilt package) |
| (u, n+2, ·) | last committed n | refused, "revision n+1 missing"; the PCS still holds it (§7) and sends it first |

Over HTTP the create-only rule is a conditional request: `If-None-Match: *` on the package's resource (RFC 9110 §13.1.2)
fails with 412 when it exists, and a conflict is a 409 (§15.5.10). Design.md §8 keyed a series by "its UID and the
archive's digest"; this table replaces that key (§13).

## 5 · Compression

**The owner's doubt:** metadata is small next to already-compressed pixels, so compressing it may gain little, or cost
more than it saves on some links and CPUs. The arithmetic below answers it under stated assumptions; the parallel row
measuring metadata size and compressibility on real series replaces the assumptions, and is not duplicated here.

**Assumptions (estimated, each to be replaced by a measurement):**

* Series: **CT** 500 instances of 512 × 512 × 16 bits, coded 2.5 : 1 → 104.9 MB of frames, metadata 4 KB an instance →
  2.0 MB; **MR** 200 instances of 256 × 256 × 16 bits, 2.5 : 1 → 10.5 MB, 6 KB an instance → 1.2 MB; **DX** one 3 000 ×
  3 000 × 16-bit image, 2 : 1 → 9.0 MB, 20 KB of metadata; an **update**, one 4 KB group file.
* Metadata compresses 4 : 1 as one stream (range to test: 2–10; design.md §7 found no published ratio for DICOM
  headers).
* The clinic's CPU compresses metadata with zstd at 100 MB/s and frames at 200 MB/s on one core. zstd's README measures
  level 1 at 510 MB/s on Silesia on a 4.9 GHz desktop; a low-power box and level 3 are assumed ~5× slower.
* Uplinks: fiber 100 Mbit/s; 5G 20; LEO satellite 10; GEO satellite 2 (RTT ~600 ms); a rural clinic 1.

**The arithmetic** (*estimated*; saved = metadata × (1 − 1/4) plus 90 % of tar's padding, which compression removes;
script: the formulas in this paragraph, nothing else):

| series | metadata share of the package | CPU to compress the metadata | send time at 100 · 20 · 10 · 2 · 1 Mbit/s | saved by compressing the metadata |
| --- | --- | --- | --- | --- |
| CT 500 | 1.9 % | ~20 ms | 8.6 · 43 · 86 · 429 · 858 s | 0.15 · 0.74 · 1.5 · 7.4 · 15 s (1.7 %) |
| MR 200 | 10.1 % | ~12 ms | 0.9 · 4.7 · 9.5 · 47 · 95 s | 0.08 · 0.42 · 0.83 · 4.2 · 8.3 s (8.8 %) |
| DX 1 | 0.2 % | < 1 ms | 0.7 · 3.6 · 7.2 · 36 · 72 s | ≤ 0.14 s (0.2 %) |
| update | ~70 % (the rest is tar) | < 1 ms | < 0.04 s at any rate | < 0.04 s; RTTs dominate: one GEO round trip is 0.6 s |

**What it shows.** (1) Compressing the metadata **always pays in time on links up to ~600 Mbit/s** under these
assumptions: break-even when the link outruns the compressor, R = 8 × 100 MB/s × (1 − 1/4) = 600 Mbit/s, and only if
compression runs before the send rather than alongside it. The owner's doubt holds only above that, and there the loss
is under 0.1 s a series. (2) The gain matters where links are slow **and** frames are small and many (MR-like, ~9 %); it
is noise for single large images. (3) Updates are latency-bound: compressing them saves nothing visible. (4) **The CPU
cost is tens of ms a series**, against the frame encoding the PCS already does (*not measured*; the encoder's own time
is in [`../FIXTURES.md`](../FIXTURES.md) §A compiled ingest at the site).

**Whole-package compression** adds the frames. Coded HTJ2K and AV1 frames are entropy-coded, so zstd is expected to gain
~0 % on them (*inference*; zstd stores an incompressible block raw, RFC 8878 §3.1.1.2.2, so the loss is a 3-byte block
header per ≤ 128 KiB). Compressing frames pays only if their gain g exceeds R / (8 × s): **6.3 % at 100 Mbit/s, 0.6 % at
10, 0.06 % at 1 Mbit/s** with s = 200 MB/s (*estimated*). On the slowest links any real gain would pay, so this is §11's
M2, not a guess.

**The options:**

| | none | **metadata only** (recommended) | whole package | per group file, with a dictionary | in transit (HTTP `Content-Encoding: zstd`, RFC 8878 §7.2; `rsync -z`) |
| --- | --- | --- | --- | --- | --- |
| bytes saved | 0 | the metadata's (1 − 1/r) and tar's padding | the same plus frames' g (~0) | more on small groups (design.md §7: 300 B JSON ×1.33 → ×5.9–6.8 with a dictionary) | as chosen |
| CPU at the clinic | 0 | tens of ms a series | ~0.5 s a CT at 200 MB/s | low, after training | every send and every resend |
| PACS reads a group without the rest | yes | no; it reads all of them anyway (design.md §7) | no | yes | yes |
| resume | by offset | by offset | by offset | by offset | the draft computes offsets on the coded data (-14 §15), so the coded stream must be stored, not recomputed; `rsync -z` recompresses after a reconnect |
| a dictionary to ship and version | — | — | — | **yes**, both ends | — |
| switching later | — | a header flag | a header flag | a dictionary id | the carrier's option |

**Levels** (zstd(1)): `-#` "selects `#` compression level [1-19] (default: 3)"; "compression speed is expected to be
divided by 2 every 2 levels"; `--ultra` to 22 "using a lot more memory" and needing more to decompress; `--fast=#`
negative levels. For kilobyte-to-megabyte metadata the default 3 is the starting point; §11's M2 sweeps −1 to 19. A
`--long` window adds nothing at these sizes (*inference*). zstd's frame can carry its own checksum (XXH64, low 4 bytes,
RFC 8878 §3.1.1): redundant with the package hash, cheap to enable.

TLS compresses nothing: TLS 1.3 requires `legacy_compression_methods` to be the single null method (RFC 8446 §4.1.2).

## 6 · Integrity end to end

| check | over | computed at | checked at | proves | does not prove |
| --- | --- | --- | --- | --- | --- |
| TLS 1.3 / QUIC AEAD (RFC 8446 §5.2; RFC 9001 §5) | each record or packet on the wire | the sending TLS stack | the receiving TLS stack | nothing changed or was injected on that hop | anything before encryption at the PCS or after decryption at the PACS; a proxy that terminates TLS ends it there |
| the carrier's own (rsync's whole-file checksum; tus `Upload-Checksum`; none in the draft) | one transfer or one chunk | the carrier | the carrier | the transfer | the file on disk before or after |
| **the package's XXH3-64, in its name** | the package as sent | the PCS, once, after writing it | the PACS, before unpacking | the PACS holds the bytes the PCS hashed: across disks, proxies, **resume splices at a wrong offset**, both sides' memory and storage | that the PCS hashed correct content; authenticity (XXH3 is not cryptographic) |
| a group file's XXH3 (its name) | one group file | the parser | the PACS, after unpacking | the group is what the parser wrote — once the parser hashes the bytes it writes ([`../ingest/README.md`](../ingest/README.md) §5: three of four hashes covered a pre-conversion length at `a65abe2`; *corrected 2026-10-28:* fixed upstream at `e105214`, and the parser names groups by BLAKE3, its team's choice) | the parser's reading of DICOM |
| the frame digest, XXH3-64 of the samples | one frame's samples | the ingest at the PCS | the ingest after decode-back; the client before paint | the shown frame is the encoder's input (exactness-in-production.md) | — |
| the coded-frame digest (agreed, not built) | one coded frame | the ingest | the PACS on receipt; the server on read | storage and transit without decoding ([`../disk-layout/target.md`](../disk-layout/target.md) §The two hashes) | — |
| the zstd frame checksum (optional) | the metadata stream decompressed | the PCS | the PACS | the decompression | — |

**What no check here gives: authenticity.** An authenticated PCS that sends wrong content passes every check above; the
channel's client authentication (§10) is what says who sent it. A hostile sender is row 122's sketched case (signed
digests, BLAKE3), not this record's.

**The package hash's width.** XXH3-64, matching the frame digests; at the package counts a PACS sees, an accidental
match on a damaged package is negligible by row 122's arithmetic (2⁻⁶⁴ per check). XXH3-128 costs nothing more to
compute and 16 more characters in the name; it is §12's question only because the PDF's names are 64 hex.

## 7 · Confirmation and refusal

### Storage Commitment's model, as PS3.4 Annex J states it

* The request asks the provider "to commit to the safekeeping of a set of SOP Instances" (J.3.2.1).
* A **Transaction UID** identifies each request and returns in the result, so requests and results "may occur over the
  same or different Associations" (J.3.2.1.2).
* A success response to the request means only this: "A success status conveys that the SCP has successfully received
  the request" (J.3.2.1.3); commitment comes later, in an N-EVENT-REPORT: Event Type 1 when all are committed, 2 when
  "failure exists", with every referenced instance in either the referenced or the failed list (J.3.3.1).
* The provider stores "in accordance with Storage Level 2 (Full) … i.e., shall store all Attributes, including Private
  Attributes" (J.3.3.1).
* What the user does after: "beyond the scope of this Standard"; on failure it "might, for example, re-send the failed
  SOP Instances … However, this behavior is beyond the scope" (J.3.3.1.3). The user documents "if and when local SOP
  Instances copies are deleted" and its recovery (J.3.6.1.2); the provider documents "under what conditions the SCP
  would delete SOP Instances", persistence, capacity (J.3.6.2.1).
* Failure reasons (PS3.3 C.14.1.1): 0110H processing failure, 0112H no such instance, 0213H resource limitation, 0122H
  class not supported, 0119H class/instance conflict, 0131H duplicate Transaction UID.

### Mapped onto a package

| Annex J | here |
| --- | --- |
| Transaction UID | the package name `(unit, n, h)` |
| N-ACTION success: received | the upload's final 2xx: the bytes are in and the hash matched |
| N-EVENT-REPORT type 1: committed | **committed**: unpacked, every check of §6 passed, written with `fsync`, published by rename, indexed (design.md §8's publish) |
| type 2: failure exists | **refused**, with a reason |
| a report on a different association | a status the PCS reads by `GET` on the package's resource, on any later connection |

### How the commitment reaches the PCS

| | in the upload's response | **the PCS polls a status resource** (recommended) | the PACS calls the PCS |
| --- | --- | --- | --- |
| connections | the upload's, held until processing ends | PCS-initiated, short | PACS-initiated **into the hospital** |
| firewall and NAT | fine | fine | needs an inbound path to every site: refused by §3's reachability |
| a long processing step (a large series, a busy PACS) | the response waits; a dropped link loses it | unaffected | unaffected |
| cost | none extra | one small request per pending package per poll interval | an endpoint at every PCS |

The upload's response may carry "committed" when processing is quick; the poll is what the PCS relies on. A `202
Accepted` (RFC 9110 §15.3.3: "the request has been accepted for processing, but the processing has not been completed")
with the status resource's address is the natural shape (*inference*).

### Refusals and the resend loop

| reason (C.14.1.1 analogue) | example | the PCS's action | counts toward the operator |
| --- | --- | --- | --- |
| hash mismatch | a splice or disk fault in transit | resend the same file from offset 0 | yes |
| content invalid (0110H) | a group file not matching its name; a `.sbnd` that fails to open; an unknown layout version | **rebuild the package from its tree**, re-hash, resend | yes |
| conflict (0119H, 0131H) | §4's (u, n, h′) against a committed (u, n, h) | none automatic | **straight to the operator** |
| revision missing | n+2 before n+1 | send n+1 first | no |
| resource limitation (0213H) | the PACS's disk or queue full | retry with backoff | no; alert the PACS's operator |
| not authorised | the PCS's site may not write this unit (§10) | none | straight to the operator |

**Why rebuild, not only resend.** A package is deterministic (§4), so resending the same bytes after a content refusal
can only fail the same way, unless the fault was in transit or in the stored package. Rebuilding re-reads the tree: it
fixes a corrupted package file, not a parser defect. **A second refusal goes to the operator** (§1), with both refusal
reasons.

**Retention at the PCS.** The package (and the tree it came from) stays until **committed**, never until "received". A
refused-twice package stays held. The PCS's disk therefore sizes to the longest outage it must ride out: at 100 GB a day
(link.md's upper volume), a three-day outage holds 300 GB (*estimated*).

**What an operator sees,** on both sides: each package with its state (queued, sending, received, committed, refused
once, held), its age, its reasons; and **the age of the oldest uncommitted package**, the one number that says a site is
stuck. A package received but not committed within a bound is an alert at the PACS.

## 8 · Updates and corrections

| change | level | the package (recommended) | alternatives |
| --- | --- | --- | --- |
| patient or study attributes corrected | study | a **study package**: header + the new exam group file | a byte diff of the group file |
| series attributes corrected | series | header + the new series group file | same |
| instance attributes corrected | instance | header + the new instance group files | same |
| a late instance | series | the series again as revision n+1 (§2) | an *addition* package with the new instances' groups and coded frames |
| a report or a late series | study | a new series package (a document, or an `.sbnd`) | — |
| a study sent to the wrong patient, or withdrawn | study or series | a **delete** package: header only | prior art: IHE's Imaging Object Change Management and DICOM's rejection notes (*not read for this record*) |

**What "possibly as differences" can mean, and the recommendation:**

| | whole changed group files (recommended) | attribute-level differences | byte diff (zstd `--patch-from`, "effectively dictionary compression", zstd(1)) |
| --- | --- | --- | --- |
| bytes | kilobytes per changed group | bytes | bytes |
| needs the base at the PACS | no: the new file stands alone, named by its hash | the base's attributes | **the exact base bytes** |
| applying it | replace one file, rebuild that study's database | a merge in the PACS | a patch, then a hash check |
| a lost or reordered update | the revision order catches it (§4) | same, and a wrong merge is silent until checked | the patch fails |
| what the PCS keeps | nothing extra | the previous state | the previous bytes |

Group files are a few kilobytes and updates are latency-bound (§5), so differences inside a file buy nothing a link can
show. **Whole replacement, at the level that changed, is the difference.**

**Ordering.** Every unit's revisions are numbered by the PCS and applied in order (§4's table). A study package and a
series package of the same study are different units; a study-level change that must reach every series' copy of the
exam group is applied by the PACS to the study, not re-sent per series.

**What the `.sbnd` must not hold.** The bundle carries a metadata JSON (FIXTURES.md §SBND series bundle), and
contract.md §What the ingest reads says modality, rescale, window and frame time are "passed through in phase 2". If
those enter the `.sbnd`, a metadata-only correction to them forces the PACS to rewrite a bundle of up to hundreds of
megabytes; if they stay in the study database, it does not (*inference*). §12 asks which.

## 9 · What changes in the PDF's design, and what stays

| the PDF says | changes | stays |
| --- | --- | --- |
| P1: "(1) reception, parsing, formatting of the pixels in tiff, htj2k or jxl." | the formatted pixels end in an `.sbnd` (§1), not `sf.jxl`, `mf.mxf` or `mf.mp4` | reception and parsing; per-frame TIFF or codestream files as construction material at the PCS |
| P1: "(2) compression of series frames" | its output is the series' `.sbnd` | an asynchronous process, run when a series is complete |
| P1: "(3) forwarding to cloud based on some kind of rsync function" | forwarding sends **one package per series** (§2), over a resumable HTTPS upload (§3) or rsync of that one file | an asynchronous process, after (2) |
| P2: "Prerequisite: all the instances of the series have been successfully parsed (process 1)." and its three tests | nothing; it becomes the rule that releases a package (§2), and an MPPS test may be added | the three tests, the PCS's alone |
| P3: "The result of our parsing is a file system on the PCS side." | — | **the tree stays**, at the PCS, as the source of every package |
| P3: "The system, which grows over time (all the files in their corresponding directory) need to be copied to the cloud to be processed." | not the tree: **each complete series' subtree, packed as one file** (§4); growth travels as new series or revision packages (§8) | the cloud processes what arrives |
| P3: "we are thinking to use some kind of rsync" | rsync can carry the one file (§3), but without a commitment channel; the recommended carrier is HTTPS | — |
| P3: "which triggers server side a script processing of the data for each file copied" | the PACS processes **per package**: verify, unpack, check, publish, index, then commit (§7) | a server-side step triggered by arrival |
| P3: "which updates the study sqlite database and the mysql master index" | — (the PACS's indexing is its own: design.md §5) | a per-study database updated on arrival |
| the tree's construction folders `c/` and `b/` | **not sent**: the `.sbnd` replaces them | kept at the PCS while (2) runs |
| names with a 64-hex BLAKE3 | XXH3 (§1); width §12; *corrected 2026-10-28:* not a change asked of the PCS, which keeps BLAKE3 by its team's choice; XXH3 is wt-pacs's, a known difference by design | **content-hash names** |
| P4: "[date], [exam], [series], and [instance] are placeholder for the corresponding UIDs." | — | the coded-UID folders, which the package keeps as member paths; `[date]`'s meaning to reconcile (§1) |
| (not in the PDF) | **added at the PCS:** keep each package until committed; poll for the commitment; rebuild and resend once on refusal; hand a second refusal to an operator; number revisions per unit | — |

## 10 · Security

| question | options | recommendation | trade-off |
| --- | --- | --- | --- |
| who may send | any authenticated PCS; **each PCS bound to its site and the units it may write** | the latter | the PACS keeps a site per PCS; a PCS cannot overwrite another site's study even with a colliding or forged UID |
| how the PCS proves itself | **mutual TLS, one client certificate per PCS** (RFC 8446 §4.3.2; RFC 8705 §2 for the same in OAuth); a bearer token over TLS; an ssh key (rsync) | mutual TLS | a hospital proxy that inspects TLS terminates it and **cannot present the PCS's certificate**, so mutual TLS needs the endpoint on the proxy's bypass list (*inference* from link.md §3's vendors); a token survives inspection but is then visible to the proxy |
| revocation | per certificate (a short lifetime, or a list the PACS reads); per token; per key | short-lived certificates, re-issued automatically | the issuing service is something to run |
| what the PACS exposes to hospital networks | one HTTPS endpoint on 443 accepting only enrolled clients; ssh (22) or an rsync daemon (873, "not encrypted", rsync(1) SECURITY) | the HTTPS endpoint only | rsync over ssh means shell accounts or forced commands on the PACS |
| what the PACS opens into the hospital | nothing (polling, §7); a callback endpoint | nothing | the PCS polls |
| unpacking untrusted input | refuse: absolute or `..` paths, links, device files, members outside the layout, sizes past a limit, decompression past a ratio; the `.sbnd` already refuses a bad frame table at open (FIXTURES.md) | all of them, before anything is published | — |
| resource exhaustion | per-PCS limits on package size and concurrent uploads; the draft's `Upload-Limit` (-14 §5.1) | both | the limits must exceed the largest real series |
| identifiers in transit | coded UIDs in package names and URLs | accept, with TLS | an inspecting proxy logs URLs; UIDs identify studies, not people directly (*inference*), but a proxy log is a place they land |
| audit | who sent which package, when, from where; every refusal and operator action | logged at the PACS | — |

## 11 · Pre-registered measurements

Registered before any is run, so the result decides and not the reading of it. Each variant is interleaved with the
others in every round (CLAUDE.md §Measurement); each new test is mutated; each report quotes latency per package, not
throughput, and says where the host saturates.

**M1 — metadata size and compressibility.** The parallel row's; this record consumes its numbers (per-instance group
bytes per modality; zstd ratio per series) and re-runs §5's table with them. *Decides:* nothing alone; it feeds M2.

**M2 — compression on the clinic's CPU.** Hardware: the PCS's reference host (the team names it). Inputs: ≥ 20 real
series across CT, MR, DX, US, one of them ≥ 1 GB; the metadata stream and the coded frames (HTJ2K and AV1) separately.
Variants: zstd levels −1, 1, 3, 6, 9, 19, one thread, interleaved, 10 rounds. Metrics: ratio; compression and
decompression ms per series; the clinic's CPU share during the PCS's own encoding. *Decides:* metadata compression is
kept if it saves send time on every deployed link class at the measured speed (§5's formula), else turned off per link
class; frames are compressed only where their measured gain g ≥ R / (8 s) on that site's link. The level is the lowest
within 2 % of level 19's ratio.

**M3 — the carrier on emulated links.** Variants: the HTTPS upload (HTTP/1.1, HTTP/2), rsync over ssh with
`--partial-dir`, and HTTP/3 on the same endpoint. Links by `netem` on a two-host testbed: the five classes of §5 with
RTT 20, 40, 50, 600, 100 ms; loss 0, 0.1, 1 %; a cut every 60 s on the rural and GEO classes. Packages: the CT and MR of
§5. Metric: **seconds from the first byte sent to "committed" seen by the PCS**, median and p95 over 20 packages a
variant, interleaved. Also bytes on the wire per package. *Decides:* the carrier, if any variant beats the HTTPS upload
by > 10 % on a link class a real site has; HTTP/3 is enabled for a site only under link.md §8's conditions.
*Saturation:* report the testbed's own ceiling (CPU and loopback) before any number past it.

**M4 — how often things change after commitment.** From the PCS's logs at ≥ 2 sites over ≥ 4 weeks: late instances per
100 series; metadata corrections per 100 studies, by level; deletions. *Decides:* the addition package (§2) is built if
a late instance's full resend costs a site > 1 % of its monthly upload bytes; byte diffs (§8) are never built unless
corrections exceed 10 % of studies and groups exceed 64 KB.

**M5 — reachability at each pilot site.** From the PCS's host: TCP 443 direct and through the site's proxy, with and
without client certificates; TCP 22; TCP 873; UDP 443. *Decides:* mutual TLS needs a bypass at sites whose proxy
inspects; QUIC is offered only where UDP 443 works.

**M6 — the protocol's failure paths, as tests.** Cut the upload at random offsets and resume (the hash must match); flip
one byte in transit at the PACS's side (refused, rebuilt, resent); send (u, n, h′) against a committed (u, n, h)
(conflict, operator); send n+2 before n+1; fill the PACS's disk (0213H, backoff). Each test is mutated: break the check
it relies on and watch it fail.

## 12 · Questions, each with a default

**For the owner.**

1. The package's hash width: XXH3-64 or XXH3-128? *Default: XXH3-64*, like the frame digests.
2. A late instance: full resend as revision n+1, or an addition package? *Default: full resend*, until M4.
3. Do changeable attributes (window, rescale, modality) enter the `.sbnd`'s metadata, or stay in the study database?
   *Default: the study database*, so corrections never rewrite a bundle.
4. When is a package "committed": published and indexed, or also replicated? *Default: published, fsynced and indexed*;
   replication documented as J.3.6.2.1 asks.
5. HTTP/3 on the upload endpoint now, off by default, or not at all? *Default: not built* until M5 finds UDP open at a
   site with a lossy link.
6. A changed duplicate (design.md §10, 6): *default: refuse as a conflict and hold for the operator* (§4).

**For the PCS team.**

1. One package per series, the tree's subtree packed as tar, with the header member of §4? *Default: yes.*
2. The carrier: the HTTPS upload (§3), or rsync of the one file plus a status poll? *Default: HTTPS.*
3. The layout: the PDF's `d/<number>.<hash>` and `p/`, or the parser's current `----.<h>` and `priv.<h>`; and `[date]`:
   a coded study date or a UID? *Default: the PDF's names, with a layout version in the header.*
4. Completeness: the three tests of P2, plus MPPS where the producer sends it? *Default: the three tests; x = 120 s
   until M4 says otherwise* (a placeholder, not a measured value).
5. Retention: how much disk can a PCS give to uncommitted packages? *Default: three days at the site's peak volume.*
6. Revisions: does the PCS number them per unit and keep its counter across restarts? *Default: yes, stored with the
   tree.*
7. Authentication: can each PCS hold a client certificate, and can its site's proxy pass the endpoint through without
   inspection? *Default: yes; a token fallback for sites that cannot.*
8. The reference host for M2, and logs for M4. *Default: the smallest host the team ships.*

## 13 · What acceptance changes in other documents

Corrected in place when the owner accepts, not before:

* [`../ingest/design.md`](../ingest/design.md) §8: the key becomes (unit UID, revision), the digest a check (§4);
  "archive" becomes "package"; "generation" becomes "revision" (the glossary's generation is a request's).
* [`../ingest/README.md`](../ingest/README.md) §1–2: group hashes XXH3, not BLAKE3; the outbox deletes on "committed";
  the link's line names the upload of §3.
* [`../ingest/link.md`](../ingest/link.md) §1, §7: the bundle's "SHA-256" becomes the package's XXH3-64.

## 14 · Sources

Fetched 2026-10-25 unless stated; the first 12 hex of the fetched file's sha256. Raw copies are not committed.

* **rsync** 3.5.1: rsync(1) (`9160de49f8f5`, the same file link.md read): DESCRIPTION; SECURITY; `--inplace`,
  `--partial`, `--partial-dir`, `--whole-file`, `--checksum`, `--checksum-choice`, `--remove-source-files`, `--fsync`,
  `--timeout`. rsyncd.conf(5) (`52281a0b6b93`): `early exec, pre-xfer exec, post-xfer exec`.
* **IETF:** draft-ietf-httpbis-resumable-upload-14, 2026-10-18 (`6bfbf01573b9`): §4.1, §5.1, §6–§9, §11, §12, §15, and
  the change log; RFC 9530 (`544dbb7d9afc`) §2, §3, §7.2; RFC 9110 (`21c1cdce6ab0`) §9.3.6, §13.1.2, §15.3.3, §15.5.10;
  RFC 8878 (`8ee6be035341`) §3.1.1, §3.1.1.2.2, §3.1.2, §7.2; RFC 8446 (`47871bc8820a`) §4.1.2, §4.3.2, §5.2;  RFC 9001
  §5 (read for link.md); RFC 9308 (`ebe07ab0c29b`) §2, §3.2; RFC 3135 (`ae404ea1b418`) §2, §4.1.1; RFC 9065
  (`42301c88685e`) §2.5; RFC 8705 (`6e45a1ee94c6`) §2.
* **tus** resumable upload protocol 1.0 (`dfc82027d295`, the repository's `main`): Core Protocol, Checksum.
* **zstd:** README at `dev` (`a93d4d36c00b`) §Benchmarks; zstd(1) at `dev` (`94a280b8fc30`): `-#`, `--ultra`, `--fast`,
  `--long`, `--patch-from`.
* **Archives:** POSIX.1-2024 `pax` utility (`398b008eab31`): §pax Interchange Format, §ustar Interchange Format; PKWARE
  APPNOTE.TXT 6.3.9 (`c7cf1fecfbde`): §4.3.1–4.3.16, §4.4.5.
* **DICOM** 2026d: PS3.4 Annex J — J.3 (`6d6a6c5b0bcd`), J.3.2 (`65ef51ed1196`), J.3.3 (`ba77f31b83be`), J.3.6.2
  (`55a818f6607d`), J.2 and J.3.6.1 read on the same pages; PS3.3 C.14.1.1 (`b9f479218bbf`); PS3.18 §10.5 Store
  Transaction (`e2eaa6604e0b`, contents only; design.md §9 read the section).
* **This repository:** [`../ingest/link.md`](../ingest/link.md), [`../ingest/design.md`](../ingest/design.md),
  [`../ingest/contract.md`](../ingest/contract.md), [`../ingest/README.md`](../ingest/README.md),
  [`exactness-in-production.md`](exactness-in-production.md) §7 and queue row 122, [`../FIXTURES.md`](../FIXTURES.md).

**Not read**, so not cited as read: IHE RAD Imaging Object Change Management; DICOM's Key Object Selection rejection
notes; rsync's `rrsync` helper; PS3.15's secure transport profiles; any measurement of zstd on HTJ2K or AV1 codestreams.

## 15 · The sender's package build

**Status: proposed 2026-10-26, not decided; built as `carrier/sender` the same day** (the crate `sender`, beside the
carrier; [`../../carrier/README.md`](../../carrier/README.md) runs it). Where the build forced a change, the text below
is corrected in place and marked *Changed by the build*. Tested on loopback against the carrier and a stand-in
receiver, not against #163's receiver, which reads layout 1 until §15.11 is done; nothing timed. It specifies how our
sender turns the PCS's exam tree into a package. It takes the owner's decisions of 2026-10-26 as fixed and reconciles the design-state record's
A4, A5 and A6 (`docs/ingest/pacs-receive-design.md` §17, commit `40fdbfd` on `claude/pacs-design-state`) with the
receiver as built in #163 (`docs/adr/pacs-receiver.md` §2 and `ingest/receiver/src/package.rs`, commit `33ffdaf` on
`claude/pacs-receiver-impl`).

### 15.1 What is fixed

**Decided by the owner, 2026-10-26.** (1) The PCS decides when a series is complete and calls our sender. (2) The
sender builds the package and sends it: it stands in for the PDF's process (3) (P1). (3) Its input is the study's exam
directory, which is the package root, plus which series; the PCS's tree may have a date folder above it. (4) The
container is pax tar. (5) Late instances come as **addition** packages, merged at the PACS. (6) Frames are never
compressed again; on the limited-link profile the metadata is compressed as **one** stream, not file by file. (7) The
sender is ours, and a deployment profile chooses its transport (TCP, or QUIC in a build that has it) and whether the
metadata is compressed. (8) The PCS keeps each package until it is stored.
*Corrected 2026-10-28:* the team meeting of 2026-10-28 reopened rsync of the PCS's tree for PCS → PACS, so the package is one of the
deliveries open with the team (the design state, `pacs-receive-design.md`, #168).

**Left open on purpose.** Updates (metadata only) are designed in another row for the team meeting. This section
reserves their place (the kind `update`, §15.5; a mode of the call, §15.2) and designs nothing of them.

### 15.2 What the PCS calls, and when

```text
sender --profile FILE EXAM_DIR SERIES...
```

*Changed by the build:* the profile (§15.9) is named on the call, `--profile`, rather than found by convention.

`EXAM_DIR` is `[…/<D>]/<E>`, the directory whose name is the coded study UID; `SERIES` are coded series UIDs, each a
directory under it. The PCS calls it after its process (2) has written a series' bundle, for the series its tests (P2)
judged complete. One package is built per series, one call may name several.

**The call is idempotent, so it is also the recovery.** For each series, in order:

1. Every revision of the unit the sender still keeps (built, not yet stored) is sent, oldest first: the receiver takes
   revision n+1 only after n.
2. The tree is compared with the members every earlier revision carried (recorded at build, §15.7). Nothing new: done.
   No earlier revision: a `series` package. Instance groups no revision carried: an `addition` package (§15.3).
3. The new package is built, kept, recorded, then sent like the others.

Calling again after a crash, a reboot or a gave-up exit resumes where it stopped; calling again after a late instance
makes the addition. The PCS needs no state of its own for the transfer.

**Exit codes**, `carrier/pcs/send-package.sh`'s plus one: 0 every named series stored; 3 refused final (an operator's);
4 gave up for now (call again later); 5 the tree cannot be packed (§15.3's refusals, an operator's or the PCS team's);
2 a usage error. *Changed by the build:* a profile that cannot be read is 2, before anything is built; any other I/O
error (the outbox not writable, a tree file unreadable) is 4. One call naming several series goes through all of them
and exits with the first non-zero code. **An update mode** is a later flag of this same call, reserved and not specified here.

### 15.3 What goes in, and what is left out

The sender reads by an **allow list**: it takes exactly the names layout 2 names (§15.4) and ignores everything else.
Paths are relative to the exam directory; the date folder above it, if any, never appears.

| in the tree | packed | as |
| --- | --- | --- |
| `<E>/--.<h>` | yes, every package | the exam group (patient and study), one level above the series |
| `<E>/<S>/---.<h>` | yes, every package | the series group |
| `<E>/<S>/<I>/----.<h>` | yes; in an addition, only instances no earlier revision carried | an instance group |
| `<E>/<S>/<I>/priv.<h>` | yes, beside its instance group | a private group |
| `<E>/<S>/series.sbnd` | yes, last | the series' coded-frame container (§1); in an addition, a bundle of the added instances' frames only |
| `<E>/<S>/c/`, `<E>/<S>/b/` | **no** | the PDF's construction folders: per-frame codestreams or TIFFs before they are packed into the bundle |
| `<E>/<S>/<I>/00001.OPC` … (`.RGB`, `.PLT`) | **no** | the parser's raw frames (contract.md §Frame files); the bundle holds them coded |
| `sf.jxl`, `mf.mxf`, `mf.mp4` | **no** | the PDF's containers, replaced by the bundle (§1) |
| other series of the exam | **no** | each is its own unit, packed when named |
| anything else: dotfiles, temporary files, unknown names | **no** | |

**Refused at build (exit 5), before anything is kept:** a link or any non-regular file where a member is expected; no
exam group, or more than one (two mean the tree holds a correction, which is the update row's); likewise the series
group; an instance directory without its instance group; a private group without one; no bundle; a group that does
not hash to its name; a member past the receiver's limits. Each is cheaper to catch at the PCS than as a refusal over
the link. *Changed by the build:* "the receiver's limits" are #163's 64 MiB a group (`MAX_GROUP_LEN`) and ustar's
8 GiB − 1 for the bundle (§15.7); two private groups in one instance are refused like two series groups; a link
in the series directory with a coded UID's name is refused, not followed. An instance directory is a directory whose name is a coded
UID (contract.md §The coding: an even length over the coded alphabet), which `c/` and `b/` are not.

**The layout's names are layout 1's:** the parser's `--`, `---`, `----`, `priv`, with XXH3-64 in place of BLAKE3, as
#163 reads them; whether the PDF's `d/<number>.<hash>` and `p/` replace them is still §12's PCS question 3. A change
there changes the allow list and the layout number, nothing else here.
*Corrected 2026-10-28:* the PCS names groups by BLAKE3 by its team's choice, a known difference by design; its parser at `e105214`
writes raw frames at `<I>/G|P|R/%05d`, and which layout wt-pacs follows is open with the owner (the design state, `pacs-receive-design.md`, #168).

**Where the addition's bundle comes from** is the PCS team's: process (2) must write a bundle of the added instances'
frames, or the whole series' again, at `<S>/series.sbnd`. *Default:* the added frames only, so the link carries each
frame once.

### 15.4 The package, layout 2

```text
package                  the header, 5 lines (§15.5)
metadata                 one inner pax tar of the groups, zstd-compressed or not (§15.6)
<S>/series.sbnd          the bundle, stored as it is
```

Three outer members, in that order, always. The inner tar holds `--.<h>`, `<S>/---.<h>`, then every
`<S>/<I>/----.<h>` and `<S>/<I>/priv.<h>`, **sorted by the bytes of their paths** (`LC_ALL=C` order). Byte order
already puts the exam group before the series group and an instance group before its private group (`-` sorts before
the coded alphabet and `p`). It replaces §4's instance-number order, which needs the groups parsed to sort them and
buys the receiver nothing.

**Paths are relative to the exam directory**, as decision (3) makes it the root: `--.<h>`, not `<E>/--.<h>`. The study
UID is in the header once, not repeated in every path.

### 15.5 The header member (A4)

Kept as #163 reads it, five lines, with two changes: the layout number and one more kind.

```text
layout 2
kind series              (or: addition; update is reserved for the other row)
study <E>
unit <S>
revision <n>
```

How the two records meet:

| §4 asked for | here |
| --- | --- |
| the layout version | `layout`, unchanged |
| kinds `series`, `study`, `delete`, `addition` | `series` and `addition` now; `update` reserved, its level told by `unit` (the study's UID for a study-level change, as #163 already reads it), which covers §4's `study`; `delete` is not in the owner's decisions and is not added |
| the unit's UID and the revision | `unit`, `revision`; `study` too, since paths no longer carry it |
| whether the metadata is compressed | **dropped**: the receiver tells by the zstd magic number (link.md §12.6), so the flag would be a second thing to keep true |

An addition's base is revision n − 1 of the same unit: revisions are strictly n+1 (the receiver ADR §7, 5), so the header needs
no base field.

### 15.6 The metadata as one zstd stream (A5)

| | **one member holding an inner tar, one zstd frame** (recommended) | per member (layout 1, as built) | a group stream with our own framing | the whole package as one zstd stream |
| --- | --- | --- | --- | --- |
| matches decision (6) | yes | no: "not per file" | yes | no: the frames would pass through zstd |
| ratio | the stream's: #154 16–31× on the parser's output | a file alone 1.6–3.2× (#156) | as the stream | as the stream, plus ~0 on frames |
| reader at the receiver | the same tar reader, run on the decompressed member | built | a new format to specify and parse | the outer reader behind zstd |
| plain profile | the same inner tar, not compressed: one code path | built | the same framing | an uncompressed tar |
| per-member overhead | the inner tar's 512-byte headers and padding, removed by compression when on | each member's own zstd frame header | a few bytes | — |

**Recommended: the member `metadata` is a pax tar of the groups, written by the same deterministic rules as the outer
one (§15.7), then, on the limited-link profile, compressed as one zstd frame.** On the plain profile it is the same
inner tar, uncompressed; the receiver tells the two by the magic `28 B5 2F FD` (RFC 8878 §3.1.1). A plain inner tar
cannot start with it by accident: its first byte is the first path's, `-`.

**The frame:** one frame, single-threaded, no dictionary, the content size and the frame checksum written, the level
fixed by the sender's build (*default:* 3; level 1 measured as good as any, design-state §2; M2 decides). The frames in the bundle are never
compressed (decision 6).

### 15.7 Determinism, and why it matters

**Why.** The package's hash is in its name, and the carrier and the receiver key on (unit, revision) with the hash as
the check (§4, link.md §12.2). A rebuild of a revision that makes **the same bytes** gets the same name, so the carrier
answers `received` or `committed` and nothing is re-sent; a rebuild that differs by a byte is `(u, n, h′)` against a
received `(u, n, h)`: **a conflict, an operator's**. Rebuilds happen when the kept file is lost or fails its own name
(below), and when the sender dies between building and recording.

**The rules**, for the outer tar and the inner one alike:

| field | value |
| --- | --- |
| member order | §15.4's, from the allow list, never the directory's listing order |
| type | regular file (`0`) only; no directory, link or device entries |
| mode | `0644` |
| uid, gid, uname, gname | 0, 0, empty, empty |
| mtime | 0 |
| format | ustar header; *changed by the build:* **no pax extended header is ever written.** A layout-2 path is at most `<S>/<I>/priv.<h>`, 44 + 1 + 44 + 1 + 21 = 111 bytes for 64-character UIDs, which ustar's prefix and name hold; a member of 8 GiB or more is refused at build (exit 5), since the carrier's `max-size` default refuses such a package anyway (link.md §12.1). The extended header this row first asked for (only `path` or `size`) would be code no package exercises. |
| end | two 512-byte zero records, nothing after: no blocking-factor padding |

**The writer is the sender's own, in Rust**, with the `tar`, `zstd` and `xxhash-rust` crates the receiver already
uses, at versions locked by `Cargo.lock`: **`tar` 0.4.46, `zstd` 0.13.3 over `zstd-safe` 7.3.0 and `zstd-sys`
2.1.2+zstd.1.5.7, so libzstd 1.5.7**, compiled from the crate's bundled source and linked statically (*changed by
the build:* the build must not set `ZSTD_SYS_USE_PKG_CONFIG`, which links the system's libzstd instead, of whatever
version it is), and `xxhash-rust` 0.8.19. A zstd library of another version may compress the same input to other
bytes, so the lock is part of determinism; a rebuild across a sender upgrade is the one case the lock does not cover,
and it arises only when a kept package is lost. **GNU tar** can approximate it for a reader inspecting a package by
hand (`LC_ALL=C tar --format=pax --no-recursion -b 1 --mtime=@0 --owner=0 --group=0 --numeric-owner --mode=0644
--pax-option=exthdr.name=%d/PaxHeaders/%f,delete=atime,delete=ctime -T list`); byte equality with it is **not
claimed**, not having been tested. GNU tar 1.35 lists a built package as `-rw-r--r-- 0/0 … 1970-01-01 00:00` for each
of its three members.

**The hash** is the XXH3-64 of the file, computed while writing it. The package is written as
`<outbox>/<unit>.<n>.partial`, fsynced, renamed to its name, and the directory fsynced; only then is the revision
recorded: `<outbox>/<unit>/<n>` holds the member paths it carried and whether its metadata was compressed. A rebuild
reads that line, so a profile changed since builds the old revision as it was first built. *Changed by the build:*
the file is `metadata zstd` or `metadata plain`, then one group path a line (the bundle, always `<S>/series.sbnd`, is
not listed), written durably as the carrier's `write_durably` writes a verdict. A revision once stored gets an empty
`<outbox>/<unit>/<n>.stored`, written before its package is deleted, so "stored" is told from "lost". A build that died
before its record leaves a package or a `.partial` of an unrecorded revision: the next call removes them (never sent,
since sending follows the record) and builds that revision again.

**What is kept, and A6.** The sender keeps each package until the receiver's verdict says stored (decision 8; the
carrier's word for it is still `committed`, design-state §14 D3). Every send first checks the kept file against the
hash in its name. A refusal of class `retry` is answered by **resending the kept bytes** (A6), as `send-package.sh`
already does: they are what a deterministic rebuild would make. The sender **rebuilds only when the kept file fails its
own name or is gone**, and determinism gives the rebuild the same name. A rebuilt file that still fails, or a second
refusal, is exit 3, an operator's. §7's "rebuild, re-hash, resend" is replaced by this.

*Changed by the build:* **the check runs before each call of `send-package.sh`, not before each send.** The sender
uploads by running the script, embedded in it, once per kept revision; the script's own resend after `refused retry`
happens inside that one call and sends the same file without the sender checking it again. Moving the resend loop into
the sender (§15.11's other option) would close that gap of seconds; it was not needed for anything §15.10 tests.

*Found by the build:* a rebuild of an **earlier** revision reads the tree as it is now, and an addition's process (2)
rewrites `<S>/series.sbnd` with the added frames only (§15.3's default). So a revision whose kept file is lost after
the PCS has written a late instance's bundle, and before that revision is stored, rebuilds to other bytes: the carrier
answers `refused final conflict`, exit 3, an operator's. It takes two faults at once (the lost file, and a late
instance inside that window); it is not handled.

### 15.8 The name

`<unit>.<revision>.<xxh3-64>.tar`, as §4 and `PackageName::parse` have it: the unit the coded series UID, the revision
a decimal from 1 without leading zeros, the hash 16 lowercase hex. The counter is the sender's: the highest `<n>` under
`<outbox>/<unit>/`. It survives the deletion of stored packages because the records stay; they are a few hundred bytes
a revision.

### 15.9 The profile

One file per deployment, read at start:

| setting | values | default |
| --- | --- | --- |
| `transport` | `tcp`; `quic` only in a build with the carrier's `quic` feature (link.md §12.4), else refused at start | `tcp` |
| `metadata` | `zstd` (the limited-link profile) or `plain` | `zstd` until a site's link is shown not to gain (§5, design-state §2) |
| `carrier`, `cert`, `key`, `cacert`, stall, attempts, backoff, poll and wait | as `send-package.sh` reads them (link.md §12.5) | as there |
| `outbox` | where packages and their records are kept | — (required) |

The receiver needs no profile: it reads both forms of the metadata member. The carrier never opens a package.

*Changed by the build:* the file is one `<setting> <value>` a line, `#` to the end of a line a comment, an unknown
setting refused (exit 2). `carrier`, `cert`, `key`, `cacert` and `outbox` are required; `stall`, `attempts`,
`backoff`, `poll` and `wait` become `send-package.sh`'s `STALL_SECS`, `ATTEMPTS`, `BACKOFF_SECS`, `POLL_SECS` and
`WAIT_SECS`. **`transport quic` is refused at start in every build:** the upload is `send-package.sh` over stock curl,
which has no HTTP/3 (link.md §12.4), and no new transport was built. A QUIC sender is a client to write when C1 says
QUIC is worth it.

### 15.10 Test plan

Each test is mutated: the named mutation is made and the test must fail (CLAUDE.md §Measurement).

*Changed by the build:* the table below is the plan as proposed; what was built, in `carrier/sender/tests/`
(`cargo test -p sender`, in `scripts/gate.sh`), is the second table. Every mutation there was made and its test
failed; the code was then restored.

| test | claim | mutation it must catch |
| --- | --- | --- |
| build twice | the same tree, copied with other mtimes, owners, umask and directory creation order, under another locale, builds byte-equal packages, the same name | the directory's listing order; the real mtime or owner |
| one byte changed, refused | a byte flipped in the header, the inner stream or the bundle: the receiver refuses on the name's hash; with a name recomputed to match, a flipped group byte fails its group's name and a flipped bundle byte its frame digest | the name's hash not checked; a group's not checked |
| left out | a tree with `c/`, `b/`, raw frame files, `mf.mxf`, a dotfile and an unnamed series: none is in the package | the allow list replaced by "everything under the series" |
| refused at build | a link in place of a group, two series groups, an instance without its group, a group off its name: exit 5, nothing kept | any of the four checks removed |
| both profiles | the same tree under `zstd` and `plain`: different hashes, the same groups stored | the receiver's magic check |
| an addition | send, add an instance to the tree, call again: revision 2, kind `addition`, only the new instance's groups beside the exam and series groups | the earlier revision's record not read: a full resend |
| a crash, a lost file | killed after the rename and before the record, then called again; the kept file deleted after `received`: both rebuild to the same name and nothing is uploaded twice | the mtime of the build time; a counter advanced before the record |
| a refusal | `refused retry` resends the kept bytes; a kept file that fails its name is rebuilt; a second refusal is exit 3 | the kept file not checked before sending |

**As built:**

| test | claim | mutations it caught |
| --- | --- | --- |
| `build::the_same_tree_builds_the_same_bytes` | a copy of the tree with other mtimes, mode `0600`, another owner (when run as root) and the reverse creation order, on tmpfs where that reverses the listing (asserted), builds a byte-equal package of the same name | the instances in listing order and the paths unsorted; a group's real mtime; its real owner |
| `build::a_changed_byte_fails_the_name_and_is_rebuilt` | a byte flipped in the header, the metadata or the bundle fails the package's name, and the rebuild restores the exact bytes | the name's hash not checked |
| `build::the_allow_list_leaves_the_rest_out` | `c/` and `b/` holding group-named files, a raw frame, a `d/` in an instance, `mf.mxf`, `sf.jxl`, `mf.mp4`, dotfiles, `---.nothex` and another series: the package is `package`, `metadata`, `Se01/series.sbnd`, and the inner tar exactly the six groups in byte order | every directory under the series taken as an instance; any marker taken |
| `build::an_unpackable_tree_is_refused_with_nothing_kept` | a link in place of the series group, two series groups, an instance without its group, a group off its name, no bundle: exit-5 errors, the outbox empty | each of the five checks removed, one at a time |
| `build::the_profile_compresses_the_metadata_or_not` | `zstd`: one frame, its content size and checksum flag set, starting with the magic, of the very inner tar `plain` stores; the bundles equal to the tree's; the two names differ | the profile ignored |
| `build::a_late_instance_makes_an_addition` | nothing new builds nothing; a late instance builds revision 2, `kind addition`, of the exam and series groups and the new instance's two groups | the earlier revision's record not read |
| `build::a_build_killed_before_its_record_is_built_again` | the record removed and a `.partial` left, as a kill between the rename and the record leaves them: the same revision, the same name, one package, no `.partial` | the counter advanced by a kept file without a record |
| `send::a_stored_package_is_dropped_and_not_sent_again` | through the carrier and the script: exit 0, `<n>.stored` written, the package deleted; a second call uploads nothing | the stored mark (and the deletion) removed |
| `send::a_lost_package_is_rebuilt_and_not_sent_twice` | no verdict within `wait 2`: exit 4; the kept file deleted; the next call rebuilds the same name, the carrier holds it, one arrival in all | the build time as mtime (the rebuild then conflicts, exit 3) |
| `send::a_refusal_resends_the_kept_bytes` | a kept file with a flipped byte is rebuilt before it is sent; `refused retry` then `committed`: exit 0, both arrivals the built bytes; then an addition refused twice: exit 3 after exactly one resend, the package still kept | the kept file not checked before sending |
| `send::a_quic_profile_is_refused_at_start` | `transport quic`: exit 2, no outbox made | `quic` accepted |

Not built here, being #163's: the receiver's refusal of a package by its name's hash, a flipped group byte by its
group's name and a flipped bundle byte by its frame digest; and "the same groups stored" under both profiles, which is
asserted at the sender instead (the inner tars are equal). The locale of "build twice" is not exercised: the writer
calls nothing locale-dependent, and sorts by bytes.

### 15.11 What the receiver (#163) must change

1. **Layout 2:** `layout 2` in the header; the kind `addition` beside `series`, `update` unchanged.
2. **Paths relative to the exam directory:** `member()` no longer expects the study UID as the first component; the
   study is the header's.
3. **Three outer members**, in order: `package`, `metadata`, `<S>/series.sbnd`; anything else refused.
4. **The `metadata` member:** a zstd frame (told by its magic) decompressed as a stream, bounded in total (*default:*
   1 GiB, a placeholder until M1's largest series), else read as it is; then read as a pax tar with every check
   `stage()` applies to members now (regular files only, no duplicate, layout names, a group's hash and UID). A group
   inside is never compressed on its own: a group file begins with its key length, 8 (contract.md §Group files), so
   one that begins with the magic is refused.
5. **An addition:** the exam and series groups must match the stored ones, every instance group must be new to the
   unit, the bundle holds the added frames; the PACS merges it into the series' bundle. The merge is new work at the
   PACS, where the 10-24/25 decision had it do no repacking; decision (5) supersedes that for additions.
6. **Layout 1:** no sender ever wrote it, so *default:* removed when layout 2 is built, not kept beside it.

The carrier changes nothing. `send-package.sh` gains the check of the kept file against its name before each send, or
its loop moves into the sender. *Changed by the build:* neither yet; the sender checks before each call of the
unchanged script (§15.7).

### 15.12 Where this departs from §1–§14

Corrected in place when the owner accepts, as §13's are: §2's late instance (a full resend by default) becomes an
addition (decision 5); §4's instance-number order becomes byte order of paths, and its header's compression flag is
dropped; §4's header kinds become `series`, `addition`, `update`; §7's rebuild on a content refusal becomes a resend of
the kept bytes, rebuilt only when they fail their name.

### 15.13 Updates: the manifest and one package at a time (Proposed)

**Proposed, awaiting the owner's confirmation; not decided, not built.** The model is metadata-updates §14 (#176, on
`claude/update-flow`): a package carries only the items that changed, each changed one with the hash it replaces, and
the receiver applies it item by item (`docs/adr/pacs-receiver.md` §5, commit `5d0ae2c` on `claude/pacs-receiver-impl`,
#163). What it asks of the sender:

* **The sent list is the records §15.7 keeps:** the member paths of every stored revision, so the hash each item
  replaces is read from them, never from the tree.
* **A fourth member, `manifest`**, after `package`: one line per replaced or removed item, empty when there is none
  (a first send, a plain addition).

  ```text
  replaces --.<new> <previous hash>
  replaces <S>/---.<new> <previous hash>
  removes <S>/<I>/----.<h>
  ```

  An item in `metadata` without a `replaces` line is new. The bundle member is there only when frames are.
* **One package per series at a time**, in order: the next is built and sent only after the previous one's `stored`,
  so a stale package cannot arrive later. §15.2's step 1 already sends kept revisions oldest first; this makes the
  wait, not the counter, the order.
* **The revision stays in the name as a label** (§15.8); the receiver no longer reads it for correctness, and
  §15.5's "strictly n+1" goes.

**Blocked on the PCS team:** a corrected group is written beside the old file, which is never deleted (§15.3 refuses
two exam groups for that reason), so the sender cannot tell which is current. The parser should replace the file or
mark the current one.
