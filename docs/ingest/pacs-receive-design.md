# PACS receive and metadata: the design state

Status: **working record, 2026-10-26.** It gathers every decision, proposal, open question and result from the owner's
design sessions of 2026-10-24/25, so any session or cloud run can continue from it. It decides nothing by itself: each
item says whose it is. **Decided** = the owner's, dated. **Proposed** = recommended by a record or run, not accepted.
**Open** = to discuss (with the owner, the team, the product owner or the PCS team). Each item names the PR that holds
its evidence; all those PRs are drafts, none merged.

Terms. *PCS*: the hospital-side component (another team's; github.com/opendicom/DECK_WebTransport), which receives,
parses, encodes and forwards. *Submission package* (OAIS's SIP, ISO 14721): one file the PCS sends. *Study DB*: one
SQLite-format file per study at the PACS. *Study index*: the database listing studies and series (MySQL fits).
*Viewer metadata*: everything a viewer reads; *display metadata* is its paint part (codec, frame count, rows/cols,
photometric, bits, rescale, window, order, cine rate). *Revision*, never *generation* (the glossary's generation is a
request's identity).

## 1 · Scope and what the PCS document says

* **Decided 10-24:** our scope starts at the PACS. The PCS's output layout is our input contract; say "PCS".
* **Rule 10-25:** every claim about what pcs.pdf (the PCS team's document, updated 2026-10-23, not in this repo) or the
  PCS repo proposes is checked and quoted verbatim. The upstream repo moved (`a65abe2`, 2026-10-22).
* pcs.pdf, verbatim: "(3) forwarding to cloud based on some kind of rsync function"; "The result of our parsing is a
  file system on the PCS side. The system, which grows over time (all the files in their corresponding directory) need
  to be copied to the cloud to be processed. To do so, we are thinking to use some kind of rsync which triggers server
  side a script processing of the data for each file copied which updates the study sqlite database and the mysql
  master index." Process (2)'s prerequisite is per **series**: "all the instances of the series have been successfully
  parsed (process 1)", with heuristics (image numbers 1..n without gaps; another series from the same producer; x
  seconds of silence). It does **not** say the PCS waits for a whole study. The PCS notes say a study database receives
  objects "until the report is authenticated": a study keeps growing.
* pcs.pdf on dates: its tree starts at `[exam]/`; "[date], [exam], [series], and [instance] are placeholder for the
  corresponding UIDs." The PCS repo has one date folder: "eDA and eDAlength (study date aammdd compressed uib64)"
  (`DICMele2deck/README.md`; `contract.md` `<D>/`). A year/month/day tree is in neither; it was a meeting suggestion,
  not agreed.
* pcs.pdf on CT/MR/PT: the metadata "is replaced by a synthesis of the metadata of all the instances, as described in
  the DICOM standard of the 'converted enhanced' classes". **Not implemented** in the parser at `a65abe2` (#154).
* **Decided 10-24/25, where we differ from the PDF:** the PACS receives our `.sbnd` (the role MXF/MP4/JXL play in the
  PDF); no MXF/MP4 reading in the server, the PACS does no repacking; hashes are **XXH3** (no cryptographic need,
  faster), so the PCS must name files with XXH3; **one file per transfer**, as agreed in a meeting (the PDF does not
  say so yet). These go to the PCS team.

## 2 · The package and the carrier

* **Decided 10-25:** one package per series (and small packages for updates); its XXH3 in its **name**, no manifest
  until something needs one; the contents say series or update. Pixels are sent once.
* **Decided 10-24/25:** an update carries **metadata only, down to the level that changed, no deeper** (a patient-name
  fix is the exam group alone); likely as **differences** (§5).
* **Proposed (#149):** a deterministic pax tar named `<unit>.<revision>.<xxh3-64>.tar`; identity is (unit UID,
  revision), the hash a check; the PCS decides completeness and the package's existence declares it. Each series
  package may carry the exam group: stored if new, nothing if its hash matches, a study-level update if it differs.
* **Why one file (corrected 10-25):** not the wire — rsync pipelines files ("pipelining of file transfers to minimize
  latency costs", rsync(1)) and QUIC streams do not block each other — but the two ends: the completeness signal, one
  hash, one atomic placement, one thing to process and confirm.
* **Rsync is not enough (owner 10-25):** the PACS must reply (§3), and rsync has no reply channel (a reply over ssh is
  possible, but reachability and no QUIC path rule it out, #155).
* **Proposed carrier (#155, stacks on #149):** the IETF resumable upload (httpbis draft-14) on HTTP/1.1, 443/TCP;
  careful creation only; interop version 10 pinned (we write both ends); the same endpoint takes a one-shot upload so
  fiber sites skip resume; the PCS needs stock curl plus a script with a stall timeout. The reply and the resume live
  in HTTP's application layer, so they are written once for every transport. **QUIC:** wtransport 0.7.2 rejects
  non-CONNECT requests, so HTTP/3 needs a second listener on h3/h3-quinn 0.0.x ("very experimental", no release since
  2025-05-06). Satellite TCP-splitting proxies cannot act on QUIC (RFC 3135, RFC 9065). Whole-package retry is enough
  when send time ≤ a tenth of the mean time between drops.
* **Owner 10-25/26:** different protocol implementations per link are acceptable — one application handler with a TCP
  and a QUIC listener (or sender) chosen by config at start; preferred over two separate programs.
* **Compression.** Measured (#150, #154, #156): metadata is 0.005–1.0 % of stored pixels (0.02–4.1 % of HTJ2K
  pixels); one zstd stream 3–31×, a file alone 1.6–3.2×; level 1 as good as any, < 1 ms per series. A single
  correction (3–6 KB) fits one flight compressed or not: no gain. A fan-out (one change to 262 instances, 29 → 9.7 KB)
  or a series resend (1.35 MB → 45 KB) saves 1–5 round trips: 0.12 s on fiber to 10.8 s on rural ADSL; never slower in
  56 pairs; ≤ 0.8 ms CPU. **Decided 10-25:** frames are never compressed again (already HTJ2K/AV1), and
  compressing a series package's metadata gains at most ~2.75 %. **Owner 10-26:** make metadata compression **configurable per site** (or dynamic), on only where
  the link gains; the receiver detects a zstd frame by its magic number and accepts both, so the switch lives only in
  the sender. Default: open (#156 measured "never slower", which argues on).

## 3 · The receiver

Proposed steps (async; one worker per study at a time, so one writer per study DB):

```text
 1 arrive    the carrier writes incoming/<f>.partial and renames it to incoming/<f> when complete
 2 pick up   one worker per study at a time; update packages may jump the queue
 3 check     the package's XXH3 against its name                                        fail → R
 4 open      a series (.sbnd + groups) or an update (groups or differences)
 5 check     each group's XXH3 against its name; the .sbnd header (magic, version, codec, UIDs);
             frame count = the instance groups'                                          fail → R
 6 stage     extract into incoming/<f>.work/ on the same filesystem as the root, never the serving
             tree (a new study: its study DB staged there too); fsync each file
 6b verify   drop the staged files' cached pages (posix_fadvise DONTNEED) and read them back FROM
             DISK: every frame's coded XXH3 against the .sbnd index; the PACS never decodes
             (decoded-sample hashes are the client's)                                    fail → R
 6c place    rename into <Study>/ (a new study: rename the whole staged study directory); fsync the
             directory; only now does the serving tree change
 7 metadata  one transaction into the study DB: upsert the exam group, insert series and instance
             groups, or apply the update with its audit record
 8 verify    drop the study DB's cached pages, re-read the rows from disk, re-hash them    fail → R
 9 derive    whatever depends on the changed groups (what and where: OPEN, §6)
10 index     update the study index; retried; a failure never undoes 6–9
11 confirm   "stored" to the PCS (DICOM Storage Commitment's model, PS3.4 Annex J); only now may the
             PCS delete its copy
12 clean     delete incoming/<f>
 R refuse    delete what this package wrote (the work directory, rolled-back rows); keep the package;
             "refused" to the PCS, which resends; the resend starts at 1; the same content failing again
             goes to quarantine and an operator (a bug, not the network)
 crash       on restart, delete incoming/*.work/ and start every package still in incoming/ at 3;
             partial state only ever sits in incoming/
```

* **Decided 10-24:** the refusal/confirmation protocol is part of the design even if first versions do not build it;
  the PCS keeps each package until "stored" and resends on "refused" (#149 proposes two replies, "received" then
  "committed", polled).
* **Decided 10-25: two checks** — the package hash (3) and a read-back **from disk**, not the page cache (6b, 8), so
  they prove what will be served (our write bugs, media errors at write time). Cost ≈ a real disk read (~1 s for 500 MB
  on an SSD, estimated). A check while extracting adds nothing that 3 + 6b do not cover.
* **Why fsync (explained 10-25):** a rename is visible to every process at once because they share the page cache; it
  survives a power cut only once the file's data and the directory are flushed. "Stored" is a promise the PCS acts on
  by deleting its copy. Staging must be on the root's filesystem (`rename` across filesystems fails with `EXDEV`).
* **Decided 10-24/25:** the package is deleted once stored, verified and confirmed; the hospital keeps the originals.
* **Decided 10-25: a verify tool.** Given a path (one file, a study, a host's root) it checks every `.sbnd` (header,
  every frame's coded XXH3) and every study DB (`PRAGMA integrity_check`, every group's XXH3), reads from disk, and
  writes a report; on demand, and a cron entry makes it the periodic scrub. Same code as 6b and 8.
* Display metadata (if derived) is written last, so a viewer never sees metadata for pixels not in place.

## 4 · The study DB

* **Proposed:** one SQLite-format file per study holding all its series, beside one `.sbnd` per series; never served to
  a client. Per study because the exam group is shared (pcs.pdf: "a sqlite database of the study").
* **Proposed (T1):** one row per group, a table per level (exam, series, instance, private): the group's bytes, its
  XXH3, keyed by its UID. The level is the table: the PCS's UID (a reversible coding of the DICOM UID: each character
  to 4 bits, three characters to two of `0-9 A-Z _ a-z ~`; `contract.md` §coding) does not carry it.
* **Why SQLite when rows are blobs (owner agrees 10-24):** the container — one file instead of thousands (files cost
  7.6× their bytes in 4 KB blocks and 30 ms to open 2 001 of them, #113), atomic crash-safe updates across rows, lookup
  by UID, safe reads during a write, standard tools. Not SQL. Measured comparison (#113, #120, #126): row per group
  2.9 MB, integrity 3.2 ms; row per attribute (T2) 3.4–4.0 MB, integrity 29 ms (reassembly); own format (D) fastest
  walk 0.65 ms but we would own it; files (A) 30 ms. T2 was the PCS team's first design (DECK's ordered keys); their
  2026-04-28 sample database (`ba1b31a`) stores whole groups with copied columns — a change of their design. Their
  copied columns: exam/series ones serve lists (study-index material), instance ones are display metadata.
* **Decided 10-24/25:** an update replaces the current row; no kept history ("truth" dropped; the PCS keeps
  originals). An **audit record** of every update (who, when, what changed) is kept.
* **Repetition (#150, #154):** 70–83 % of instance-group bytes are identical across a series (CT, PT, MR, MG); shared
  values once + per-instance values weigh 9–28 % of a row per instance group; image metadata is very rarely updated, so
  a shared + per-instance layout is a natural fit (DICOM's own Shared vs Per-frame Functional Groups, PS3.3 C.7.6.16).
  **Open:** adopt it (from the parser if it implements converted-enhanced, else simulated to the standard).
* **Engine (#147, #151): rusqlite**, through `spawn_blocking`. Turso awaited directly blocks the tokio worker (its
  async does a blocking read on the worker; heartbeat p99 285 ms vs 2.4–3.5 ms); in `spawn_blocking` it no longer
  blocks but costs ~2× the CPU per scan; its 2 MiB per open file is transparent huge pages (130 KiB with THP off); a
  second process's read-write open fails and a read-only open sees no commits; its multi-process mode is "not
  production ready". rusqlite: 185 KiB per open file, open 0.9–1.4 ms, read 18–23 µs. **Open until TURSOLOCK (#157 or
  next) reports** whether a short read and a short update in two processes collide by waiting, by error or by staleness
  (the owner's reasoning: reads never meet creation, and both are short).

## 5 · Updates (#148)

* **Proposed:** one path — client applications go through an update API that authenticates, stamps the author and
  submits an update package like any sender; per-study arrival order; a worker for metadata-only packages; a caller
  may wait for "stored" (`200`, `412`, `422`, or `202` after a timeout); priority by what a package is, never by who
  sent it. Differences (`set`/`remove` by DECK key; a sequence replaced whole, as PS3.4 §CC.2.6.2 does for N-SET);
  UIDs and the frame description not updatable; base hash per touched group (`If-Match`, `412` stale, `428` missing);
  audit row per package (refused ones too) with prior values in the study DB, DICOM Original Attributes vocabulary;
  withdrawal per IHE IOCM (CID 7010 reasons; hidden, purged after a grace period); `sender` and `on_behalf_of` now,
  roles later.
* **Open (owner 10-25), for the team and the product owner:** whether client-application updates go through the
  receiver's queue or a standard update endpoint coordinated with it. The single path is the best so far for
  consistency, simplicity and integrity; what is avoided is a second process writing study DBs directly. The honest
  guarantee is order and a bounded delay, not "instant".

## 6 · Viewer metadata (OPEN — discuss next)

* **Decided 10-24:** the codec can come from the study index; without it the page loads every decoder. **To
  evaluate:** prefetch every decoder while the user browses the list (fetch, never instantiate; same site for the HTTP
  cache); a direct open by link is the case left. This replaced the 10-19 "only its codec's decoder" decision.
* **#145** (first evaluation): a derived file per series served by nginx (`no-cache`, ETag) plus the codec as a
  study-index column; deciding reason: no serving process opens a study DB.
* **#153** (independent second evaluation): split by kind — list fields and codec in the index; paint metadata (no
  identifiers) as a derived file per series; study fields with identifiers in a per-study file (`no-store`,
  authorized); full metadata (tag panel, 0.8–12.6 KB per series compressed) in a file fetched when the panel opens.
  Ranking: F (same split, in the session), G (over HTTPS), C (the frame server reads the study DB at open), D (a
  metadata API), A (a column in the index: the owner's earlier idea, ranked 5th: viewing would depend on the index,
  ~10× its size, outbox lag), E (a cache). It assumes the outdated "only its decoder" rule: to correct.
* **The owner's view (10-25/26):** read the series' metadata from the study DB when it is opened; derived files or index
  columns duplicate data. Its costs: a serving process opens study DBs (fine with rusqlite, measured), coupled to the
  schema; reading paint values per instance ~2.6 ms at 2 000 instances (or ~20 µs with a ready row). The privacy split
  (#153's strongest point) argues for splitting by kind, which a query can do too, not for files. The index-down case
  does not apply (the study DB is on the PACS host).

## 7 · The study index (#146)

Proposed: the name *study index* (Orthanc's word; not Modality Worklist, not a master patient index, not FIXTURES.md's
`study.json`); list fields only (QIDO-RS's required study and series attributes, description, issuer, host, revision,
access key; per series the codec); MySQL 8.4 LTS or MariaDB (`utf8mb4_0900_ai_ci` matches PN's accent/case-insensitive
matching); one index for all hosts, starting on the first; a direct link never needs it; a per-host outbox, idempotent
upserts keyed by UID accepting only a higher revision, a reconcile job; an HTTPS API shaped like QIDO-RS Search,
authorized by access key, ≤ 50 ms p95 server time; not now: instance rows, thumbnails, fuzzy matching, replicas.
**Owner 10-25:** MySQL fits; it may live on its own server over the network; to evaluate.

## 8 · The disk layout (#152) — for the team meeting

Options: flat; the PCS's coded `<D>/`; `yyyy/mm/dd`; one or two hashed levels; volume prefixes; hashed + a derived date
view. Recommended by #152: **256 folders from a hash of the study UID, no date in the path or the URL** — the server
builds the path from the link alone; a date in the path breaks issued links when a date is corrected, or needs a
lookup per session. ext4 without `large_dir`: ~10–26 M entries per directory (inference); XFS ~600–700 M.
**Owner 10-25:** not decided; partly ours; present the trade-offs at the next meeting with the team, the product owner
and the DICOM-experienced members, and decide together.

## 9 · Serving by UID (#142)

Proposed: one process, many series; URL `/<Study>/<Series>` validated by grammar before any file is touched; a map of
`Weak` stores (one open file per series in use); a `stat` at lookup to see a renamed-in replacement; an optional
`?digest=` pairing metadata with frames; accept-then-close with codes (1 bad name, 2 not found, 3 changed, 4
unreadable, 5 busy). **Correction owed:** its grammar is PS3.5 digits and dots; the PACS sees PCS-coded UIDs
(alphabet `0-9 A-Z _ a-z ~`, still no `.`, `/` or `%`). Seven owner choices in its §9 are unanswered.

## 10 · Findings for the PCS team (#154, parser `a65abe2`)

* converted-enhanced is planned, not implemented;
* nested keys contain bytes from memory addresses, so parsing the same files twice gives different groups (PT got five
  series groups, US two exam groups);
* group 0002 lands in the instance group;
* an exam-level sequence keeps only its first attribute in the exam group; the rest repeats in every instance group;
* the output is 1.15–1.95× the size the level table predicts; differences from `contract.md` are listed in #154.
* To ask: one package per series instead of per-file rsync; XXH3 names; keep packages until "stored"; resend on
  "refused"; whether a correction deletes the old group file; how a withdrawal is sent; a decoded-samples hash per
  frame is not needed (the PACS checks coded hashes; the client checks samples).

## 11 · Corrections owed (before implementation is merged)

| where | change |
| --- | --- |
| #142 `docs/adr/serving-by-uid.md` | grammar for PCS-coded UIDs |
| #119 `docs/ingest/design.md` §12 | one package; staging in `incoming/`; two checks from disk; no `inputs/` log, revisions dirs or `CURRENT`; in-place updates; refusal/confirmation |
| #120 `docs/ingest/metadata-draft.md` §2 | no truth/generation/history; T2 as the team's first design |
| #120 §3 | versions (rusqlite 0.41.0, SQLite 3.54.x); the engine results of #147/#151 |
| #126/#144 READMEs | "page document/page view" → display metadata |
| #153 | the decoder rule (10-24 replaced 10-19) |
| `docs/disk-layout/target.md` | "no metadata beside the `.sbnd`" restated; XXH3 group names |
| `docs/ingest/contract.md`, `design.md`, `README.md` | BLAKE3 → XXH3; the site's encoding/outbox/upload relabelled as the PCS's side; the package as the interface |
| all docs | the terms above |

## 12 · PR index

#142 serving by UID · #144 update cost (in place 6–17× cheaper than revision directories) · #145 display metadata ·
#146 study index · #147/#151 engine (+ fair re-run) · #148 updates · #149 transfer · #150 metadata size and repetition ·
#152 disk layout · #153 viewer metadata (independent) · #154 the parser's own output · #155 carrier · #156 update
compression. Older stack: #113 ← #120 ← #126 (format survey, pair bench), #118 page-open carriers, #119 receiver.

## 13 · Night of 2026-10-26: what landed and its state

Verified 2026-10-26 by a review run, one branch at a time. All eleven PRs are drafts; none merged. Every run produced its
PR. "Gate" is `scripts/gate.sh --quick --no-browser`: the browser steps need the docker-built decoders this container
lacks, and they fail the same 7 checks on the untouched base. Comment budget, the link check and the personal-path check
pass on every branch after the fixes below. Every pushed fix is small and in the docs; nothing larger was changed.
The "Generated by" line was removed from the bodies of #157, #158, #161, #162, #164, #165 and #167.

**#157 TURSOLOCK** (lab/sqlite-engine §5). *Delivers:* a read beside an update in two processes, rusqlite against three
Turso modes. **Reports the §4 question:** Turso's lock goes with the handle, not the transaction, and fails at once
(`LockingError`, no busy wait); a held read-only Turso handle is stale; rusqlite only ever waits (≤ 4.8 ms), no errors,
nothing stale. *Verified:* pre-registration precedes results (8312dc7 → 3acfb8f → cde1add → a46fa23); 11 tests pass; 3
mutations re-run, each caught; 4 arms re-run, findings reproduced. *Issues:* no raw results committed (numbers only in
the README); the 12-arm run used code not yet committed (said so). *Fixed:* the draft's §3 verdict named one way Turso
works; it now names both (5ddf0bc).

**#158 design records combined** (docs only). *Delivers:* #142, #145, #146, #148, #149/#155, #152, #153 and this file in
one branch, with §11's corrections. *Verified:* the §11 rows for #142, #153, target.md, contract/design/README/link
(XXH3) and the glossary are applied and correct; #119, #120, #126/#144 honestly listed as owed; §5, §6, §8 stay Open.
*Issues, not fixed:* the display-metadata and metadata-updates ADRs put **Proposed** items (one study DB per study, one
row per group, one writer, the receiver's steps) under "Decided by the owner"; the glossary defines the study DB as "one
row per group" (T1, Proposed); link.md still says "the site", relabelled only by a note; target.md says the layout
meeting is "with the PCS team" (§8: the team, the product owner, the DICOM-experienced members).

**#159 metadata consolidated.** *Delivers:* the metadata lab branches merged without rebase, the draft corrected to the
decisions of 10-24/25. *Verified:* truth/generation/history retracted in place; T2 as the team's first design;
rusqlite 0.41.0, SQLite 3.54.1; #147/#151 folded in, the engine marked proposed; tests pass (sqlite-engine 11,
update-link 2, Python suites); gate OK. *Fixed* (adf9ef5): "the decided one file per study" → proposed; #157 named;
§3's verdict as in #157; the gate's "six lab crates" → seven. *Issues, not fixed:* handoff/metadata-2026-10.md still
lists the 10-19 decoder rule as "Decided (do not reopen)" and the truth/page-view model: it needs a superseded note; it
also names the owner by first name; the PR body says #157's branch has no PR; #161 is not merged in.

**#160 verify tool** (tools/pacs-verify, common/study-db). *Delivers:* §3's verify tool for a file, a study or a root:
`.sbnd` layout and every frame read back, study DB `integrity_check` and every group's XXH3, from disk
(`fdatasync` + `posix_fadvise(DONTNEED)`), a report, exit 0/1/2. *Verified:* 20 tests pass, gate OK; mutations of the
integrity check, the group hash and the helper's fadvise are caught. *Issues:* frames are read back, not hashed — v1 has
no per-frame coded XXH3 (documented); a mutation replacing the uncached open by a plain open at the call sites survives
(only the helper is tested); **not the same code as #163's steps 6b and 8, and the two study-DB schemas conflict**
(`xxh3 INTEGER` here, `xxh3 TEXT` in #163: pacs-verify fails on a study DB #163 writes); "no receiver exists yet" is
now stale.

**#161 study DB layout** (lab/metadata-store --mode study-db). *Delivers:* row per group, shared + per-frame and a blob
per series, timed on the parser's five packages, as written and masked. *Verified:* pre-registration 11c8678 precedes
results 95528f2; 9 + 15 tests pass, 3 mutations caught; gate OK; headline ratios consistent with its tables.
*Fixed* (c1e3e7c): the draft's §2 outcome is labelled a recommendation, its adoption still Open (§4). *Issues:* no raw
results or packages committed (hashes only); the README and the PR body read as an answer; measured on rusqlite 0.40.2
(said so); the 1.4–1.6× slower exam correction in shared + per-frame is unexplained (said so).

**#162 serving by UID** (server --root). *Delivers:* many series under one root, `/<Study>/<Series>` validated as
PCS-coded UIDs before any file is touched (§9's correction owed, done), a map of `Weak` stores, `stat` at lookup,
accept-then-close codes 1–5, both clients surface them. *Verified:* 151 tests pass, gate OK, the arm patch applies;
mutations (accept `.`, drop the `stat` comparison) caught; #142 §9's seven choices kept as defaults for the owner.
Measured: over WebTransport the close code does not reach a browser (wtransport 0.7 closes the connection; a capsule
patch is proposed, not built). *Fixed* (51b4f9f): WIRE.md and the ADR mark `<Study>/<Series>.sbnd` provisional, §8 being
open. *Issues:* a panic in the blocking open maps to code 5 "busy"; the downloader still redials on refusals.

**#163 PACS receiver** (ingest/receiver, ADR proposed). *Delivers:* §3's steps 1–8, 11, 12, R, quarantine and crash
recovery; 9 and 10 a trait with nothing behind it. *Verified* against §3 step by step: staging on the root's
filesystem, fsync of files and directories, 6b read-back from disk, never decodes, one rename, one transaction with an
audit row, 8 re-read from disk, refusal keeps the package, crash recovery from 3; step 9 left open. Gate OK; package
hash and 6b hash mutations caught. *Issues, not fixed:* **the test suite is flaky** (≈ half of full runs fail with
"another receiver holds …/incoming": the crash test forks while other tests hold the lock); a mutation at the 6b call
sites to a cached read survives (only the helper is tested); the audit row has no "who" (Decided: who, when, what);
ADR §0 calls quarantine, staging and durability "Decided" where this file has them as proposed steps; shares no code
with #160 (above); its reply files differ from #164's (below).

**#164 carrier** (carrier/, the PCS's script). *Delivers:* draft-14 resumable upload, interop version 10, careful
creation, one-shot on the same endpoint, mutual TLS pinned per site, `received` then `committed`/`refused`, polled;
TCP always, HTTP/3 experimental. *Verified:* 17 tests (18 with `quic`), gate OK; offset and script stall-timeout
mutations caught; its link-check change widens the check. *Fixed* (9bb1c53): link.md separates the owner's direction
(one handler, listeners chosen at start) from this build's choices. *Issues, not fixed:* QUIC is compiled only with a
cargo feature, so the default binary cannot choose it by config at start (weaker than the owner's 10-25/26 shape); the
reply is "committed" where §3 decided "stored"; **the handoff with #163 does not match** — #164 reads
`status/<name>` at the root with `committed`/`refused retry`/`refused final`, #163 writes `incoming/status/<f>` with
`stored`/`refused`/`quarantined`; the carrier's own stall timeout has no test (its mutation survives); the script
resends without limit if the poll keeps answering 404; the PR body's test count is off by one.

**#165 study index prototype** (lab/study-index, MySQL 8.4.6). *Delivers:* §7's index built and timed per #146 §11 as
amended. *Verified:* amendment ac38bdf precedes results 8d0e173; p95s and sync lags spot-checked against the raw files,
all match; saturation stated (c = 4–16); 11 tests and 9/9 mutations re-run (on MySQL 8.0.46, the container's, not 8.4).
Reports, does not decide (§7: "to evaluate"). *Fixed* (16fec79): the ADR's "the tuned shape meets every cell" now
excepts the added `name_family` @ 1000 (17–20 ms); a link to this file pinned at its commit. *Issues:* without
`SI_TEST_MYSQL` the five publisher tests skip silently and the run still says "11 passed"; the tuned shape was chosen
on the same data (said so).

**#166 viewer metadata measured** (lab/metadata-delivery). *Delivers:* study DB at open (HTTPS or in the session), a
derived file and #153's split, on four emulated links, host cost to 1 000 viewers, consistency under updates.
*Verified:* pre-registration 3e77cce precedes build and results; spot-checks match the ndjson; tests pass, mutations
caught. Reports, does not decide §6 (Open). *Fixed* (e3bfcc1): two paths pinned at their commits so links resolve.
*Issues, not fixed:* e30f966 (h2load asks for gzip; opens counted once) came after pre-registration and is not recorded
as a deviation, nor are H2 at 1/100 studies instead of 1/10/100 and saturation inferred rather than measured; the
floor link's +3/+11 ms set aside as rig noise; "paint metadata" where the glossary says display metadata.

**#167 disk layout measured** (lab/disk-tree). *Delivers:* #152's protocols over five options, ext4 and XFS, 10⁴–10⁶
studies. *Verified:* reports, does not decide §8; warm only, no eviction lever, device reads recorded per cell; ext4
ceiling (7 667 255 at 44-character names; 9 950 066 at 30; 64 998 subdirectories without `dir_nlink`) matches the
rows; 4 tests pass, 3 mutations caught. *Fixed* (3cbd98e): "about 2 billion" labelled arithmetic. *Issues:*
**amendment 2 (5aa5e72) was committed four minutes after the first rows (f92b0d9)**; the changed cells were re-run
rather than reused, but the ADR does not say the 10⁴/10⁵ rows had already run; the re-run's ext4 10⁵ publish p50 is
~1.7× the first run's (arms still tie), not reported; "38 % full" is derived, not measured; the pre-registered P5 text
says "catalog".

**Across PRs, for the owner:** #160, #163 and #164 were built in parallel and do not fit together yet — one study-DB
schema, one disk-read helper shared by the verify tool and steps 6b/8 (Decided), one reply file and vocabulary
("stored") between receiver and carrier. Each is structural, so each waits for the owner. Also owed: the receiver's
flaky test, the read-back call sites untested in #160 and #163, the stale handoff note in #159.
