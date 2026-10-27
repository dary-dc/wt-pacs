# PACS receive and metadata: the design state

Status: **working record, 2026-10-27.** The one current state of the PACS receive and metadata design: every
decision, proposal, open question and result from the owner's sessions of 2026-10-24/25/26/27 and the runs of
2026-10-26 (#142–#185), each folded into its section. It decides nothing by itself: each item says whose it is.
**Decided** = the owner's, dated. **Proposed** = recommended by a record or run, not accepted; a result can strengthen
or weaken it, never make it Decided. **Open** = to discuss (with the owner, the team, the product owner or the PCS
team), with its default. Each item names the PR that holds its evidence; every design PR is a draft, none merged (only
the advisories' lock fix, #183 and #184, is, §19). How the PRs merge is §13; what waits for whom is §14–§16; where the
records disagree is §17; the afternoon's rows §18, the night's §19.

Terms. *PCS*: the hospital-side component (another team's; github.com/opendicom/DECK_WebTransport), which receives,
parses, encodes and forwards. *Submission package* (OAIS's SIP, ISO 14721), *package* for short: one file the PCS sends.
*Study DB*: one SQLite-format file per study at the PACS. *Study index*: the database listing studies and series (its
engine open, §7). *Viewer metadata*: everything a viewer reads; *display metadata* is its paint part (codec, frame count,
rows/cols, photometric, bits, rescale, window, order, cine rate). *Revision*, never *generation* (the glossary's
generation is a request's identity).

## 1 · Scope and what the PCS document says

* **Decided 10-24:** our scope starts at the PACS. The PCS's output layout is our input contract; say "PCS".
* **Decided 10-26 evening:** the PCS decides when a series is complete, as pcs.pdf proposes ("separation of
  responsibilities"); our sender at the PCS then builds and sends its package (§2).
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
  PDF); no MXF/MP4 reading in the server, the PACS does no repacking (*corrected 2026-10-26 evening:* the 10-24 "no
  repacking" did not consider late instances; an addition is merged at the PACS, §3); hashes are **XXH3** (no
  cryptographic need, faster), so the PCS must name files with XXH3; **one file per transfer**, as agreed in a meeting
  (the PDF does not say so yet). These go to the PCS team (§15).

## 2 · The package and the carrier

* **Decided 10-25:** one package per series (and small packages for updates); its XXH3 in its **name**, no manifest
  until something needs one; the contents say series or update. Pixels are sent once.
* **Decided 10-24/25:** an update carries **metadata only, down to the level that changed, no deeper** (a patient-name
  fix is the exam group alone); likely as **differences** (§5).
* **Decided 10-26 evening, the sender:** our sender at the PCS builds the package from the study's exam directory (plus
  which series) and sends it: the equivalent of pcs.pdf's process (3) "forwarding to cloud". Its deployment profile
  picks the transport (TCP, or QUIC at build) and the compression; the zstd version is pinned. It keeps the built
  package until "stored" and resends those bytes.
* **Decided 10-26 evening, the container:** pax tar, "for its simplicity" (overhead about 0.4 % of a CT package,
  estimated).
* **Decided 10-26 evening, late instances:** an **addition** package from the start, merged at the PACS into the
  series' single `.sbnd` (§3). **Decided 10-26/27 night:** several bundle files per series are rejected (they complicate
  serving and archiving).
* **Open with the owner, package identity:** how a resend is recognised — by name/hash, by content, or another way;
  the hash should be only an integrity check (§14, D12; §17, A9). *Proposed 2026-10-27:* the update model of §5, whose
  item-by-item apply makes a resend change nothing, so no identity is needed for correctness; it needs a small manifest
  for updates (removals and previous hashes), the "something" the 10-25 decision above waits for.
* **Proposed (#177), the sender's build** (pcs-transfer §15, theory): layout 2 — a 5-line header `package` (`layout 2`,
  `kind series|addition`, `study`, `unit`, `revision`; `update` reserved), one inner pax tar `metadata` holding every
  group (one zstd frame on the limited-link profile, plain otherwise, told by the magic), `<S>/series.sbnd` as it is;
  an allow list, exit 5 on a tree it cannot pack; deterministic bytes (sorted, mode 0644, uid/gid 0, mtime 0, crates
  locked), so a rebuild keeps its name; `sender EXAM_DIR SERIES...` idempotent, kept revisions sent oldest first; a
  refusal resends the kept bytes, a rebuild only when they fail their name. The receiver's changes are its §15.11
  (row NIGHT2-4).
* **Built (#177, proposed):** the sender (`carrier/sender` at `ab34536`, §15 corrected as built at `ecbea88`) — layout
  2 by an allow list, the inner tar in byte order of its paths, one zstd frame (level 3) on the zstd profile; ustar
  only (a member of 8 GiB or more refused); `--profile`, exit 2 for a profile error and 4 for other I/O; the package
  kept in the outbox with what each revision carried until `committed`, checked against its name before each call of
  `send-package.sh` (embedded, unchanged), rebuilt only when it fails or is gone; a late instance makes an addition of
  the instances no earlier revision carried. `transport quic` is refused (the upload is curl's). tar 0.4.46, zstd
  0.13.3 (libzstd 1.5.7 bundled), xxhash-rust 0.8.19, locked; 11 tests, 18 mutations, all caught. Found: a lost kept
  file rebuilt after a late instance's bundle conflicts. Its reply word is still #164's `committed` (D3). Built
  **without resend-identity logic, on purpose**, until the update model (§5) is confirmed.
* **Proposed (#149):** a deterministic pax tar named `<unit>.<revision>.<xxh3-64>.tar`; identity is (unit UID,
  revision), the hash a check; the PCS decides completeness and the package's existence declares it. Each series
  package may carry the exam group: stored if new, nothing if its hash matches, a study-level update if it differs.
  *Corrected 2026-10-26:* #149's reason for tar over zip (tar cannot compress per member, so the group files go as one
  zstd member, compressed across files) no longer holds: #163 compresses per member (a file alone 1.6–3.2×, one stream
  16–31×), which zip does too. *Corrected 2026-10-26 evening:* the container is pax tar, the owner's (above), and the
  metadata goes as one stream; #163's per-member compression is a flaw.
* **Why one file (corrected 10-25):** not the wire — rsync pipelines files ("pipelining of file transfers to minimize
  latency costs", rsync(1)) and QUIC streams do not block each other — but the two ends: the completeness signal, one
  hash, one atomic placement, one thing to process and confirm.
* **Rsync is not enough (owner 10-25):** the PACS must reply (§3), and rsync has no reply channel (a reply over ssh is
  possible, but reachability and no QUIC path rule it out, #155). **Decided 10-26 evening:** replies and retries are
  required; rsync alone is not enough.
* **Second opinion (#180, link.md §11.10, theory): a reply is needed** — the end-to-end argument (Saltzer, Reed and
  Clark 1984); one durable verdict per package after step 8, read as state on connections the PCS opens, at-least-once
  sending against an idempotent receiver; `rsync --remove-source-files` deletes too early on corruption at rest, a full
  disk at staging and a receiver bug. Agrees with the decision.
* **How the PCS learns the verdict (#170, link.md §11.9, theory, proposed):** keep polling as the contract (every push
  option still needs the status resource after a drop); if anything is built, `Prefer: wait=20` (RFC 7240) on the
  completing request; a long-poll only if slow verdicts must be seen at once; SSE adds nothing; WebSocket rejected (curl
  8.5.0 has no `ws`). Open with the owner (§14, D13).
* **Proposed carrier (#155, stacks on #149):** the IETF resumable upload (httpbis draft-14) on HTTP/1.1, 443/TCP;
  careful creation only; interop version 10 pinned (we write both ends); the same endpoint takes a one-shot upload so
  fiber sites skip resume; the PCS needs stock curl plus a script with a stall timeout. The reply and the resume live
  in HTTP's application layer, so they are written once for every transport. **QUIC:** wtransport 0.7.2 rejects
  non-CONNECT requests, so HTTP/3 needs a second listener on h3/h3-quinn 0.0.x ("very experimental", no release since
  2025-05-06). Satellite TCP-splitting proxies cannot act on QUIC (RFC 3135, RFC 9065). Whole-package retry is enough
  when send time ≤ a tenth of the mean time between drops.
* **Owner 10-25/26:** different protocol implementations per link are acceptable — one application handler with a TCP
  and a QUIC listener (or sender) chosen by config at start; preferred over two separate programs. **Owner 10-26:**
  QUIC chosen at build time is accepted, "it is something that will be decided at the deployment" (§14, D4).
* **Which QUIC (#171, link.md §13, theory, proposed):** the sender picks the congestion controller, and stock curl's
  ngtcp2 never sets it (always CUBIC); quinn's default 1.25 MB stream window caps an upload near 100 Mbit/s at 100 ms.
  TCP with stock curl stays; h3 not the default; if QUIC is built for its controller, raw QUIC on quinn with our own
  framing (b1), our client at that site only; if stock curl must carry QUIC, nghttpx in front of the TCP carrier (d2);
  either way the receive windows set to the site's bandwidth-delay product. Pre-registered, not run.
* **The transport seam (#182, link.md §14, theory, proposed):** a seam is needed only if QUIC is built at all, and its
  smallest form (S1) is no interface of ours: hyper's connection type parameter, filled at build by a TLS-over-TCP
  stream or one bidirectional quinn stream carrying the same draft-14 over HTTP/1.1 under an ALPN of ours (~40 lines
  at the carrier, ~20–30 a `connect()` in the sender, *estimated*; h3 and h3-quinn dropped). Pairing is then by
  transport only. Best per side: kernel TCP; quinn at both ends. Recommended: the default profile TCP with CUBIC; the
  limited-link profile **TCP with BBR per socket** until a pre-registered run (T, T-bbr, Q, Q-bbr, Q-ack on emulated
  limited links, its §14.5) shows quinn > 20 % ahead on a real site's class; otherwise S0, the `quic` feature deleted.
  It narrows #171: b1's framing is HTTP/1.1 itself, and d2 (stock curl over HTTP/3) falls away since the sender is
  ours. Four questions with defaults (S1 yes once QUIC is kept; no ALPN registration; BBR enabled by the installer; no
  MPTCP). Nothing built or timed (§14, D4).
* **The TCP carriers explained (#181, `carriers-explained.md`, theory, sourced):** rsync, SFTP/SCP, a plain PUT retried
  whole, partial PUT, draft-14, tus 1.0, S3-style multipart, C-STORE with Storage Commitment, STOW-RS with PS3.18 §13,
  each scored against resumable, fast, simple, with a reply; no recommendation beyond its table. The carrier choice
  after it is open with the owner (§14, D4).
* **Built (#164, proposed):** the carrier crate at `9bb1c53` — draft-14, interop version 10, careful creation, one-shot
  on the same endpoint, mutual TLS pinned per site, replies `received` then `committed`/`refused`, polled; TCP always,
  HTTP/3 experimental; the PCS's script with a stall timeout. 17 tests (18 with `quic`); offset and script-timeout
  mutations caught. QUIC is a cargo feature, so the default binary cannot choose it by config at start, which
  the owner accepted 10-26 (§14, D4). **Does not match §3:** its reply is "committed" where §3 decided "stored", and it reads
  `status/<name>` at the root while #163 writes `incoming/status/<f>` (§14, D3). Owed: the carrier's own stall timeout
  has no test (its mutation survives); the script resends without limit while the poll answers 404.
* **Compression.** Measured (#150, #154, #156): metadata is 0.005–1.0 % of stored pixels and 0.02–4.1 % of HTJ2K pixels
  as #150 split it; as the parser writes it (#154, 1.15–1.95× larger) 0.01–1.8 % and 0.04–8 %, PET the largest. One
  zstd stream 3–27× (#150), 16–31× on the parser's output (#154); a file alone 1.6–3.2×; level 1 as good as any,
  < 1.1 ms per series. A single correction (3–6 KB) fits one flight compressed or not: no gain. A fan-out (one change
  to 262 instances, 29 → 9.7 KB) or a series resend (1.35 MB → 45 KB) saves 1–5 round trips: 0.12 s on fiber to 10.8 s
  on rural ADSL; never slower in 56 pairs; ≤ 0.8 ms CPU. **Decided 10-25:** frames are never compressed again (already
  HTJ2K/AV1), and compressing a series package's metadata gains at most ~2.75 %. *Corrected 2026-10-26:* 2.75 % is mr's;
  the largest measured is pt's **3.45 %** with HTJ2K pixels (#150's table), not re-measured on the parser's larger
  output; the decision stands either way. **Owner 10-26:** make metadata compression **configurable per site** (or
  dynamic), on only where the link gains; the receiver detects a zstd frame by its magic number and accepts both, so
  the switch lives only in the sender. **Decided 10-26 evening:** only metadata is compressed, as one stream, on the
  limited-link profile; frames never; per-file compression (#163) is a flaw (§14, D8). On the converted-enhanced layout
  see §4 (#178).
* **Owner 10-26: the path's implicit choices** (the HTTPS upload, polling for the reply, tar, ...) are presented with
  their options before anything is decided; nothing on the path is Decided beyond what §1–§3 list (the evening's
  decisions included).

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

* **Decided 10-26 evening, the addition merge:** a late instance's addition package is merged into the series' single
  `.sbnd` by rewriting it (staged, renamed as in 6–6c). **The owner prefers** frames kept contiguous in display order
  over any layout that stores them in arrival order (sequential reads are common, updates rare).
* **Decided 10-26/27 night: late frames stay with the current `.sbnd` format and the full rewrite.** The owner's
  reason: publishing by rename is needed for crash safety and for readers that already have the file open, in MXF and
  MP4 too; modifications are uncommon, so the full copy is acceptable. *Correction recorded beside it:* with reflinks
  (XFS, btrfs) a tail-only rewrite keeps rename's guarantees (#185: 342 kB and 3–7 ms for a frame at the end at
  N = 2 000; 264 MB for the middle; worse than the full rewrite at the start), but it needs a format change (the index
  at the end, or reserved slack), gains nothing on ext4 and little on the v2 tiled layout (≥ 93 % of S rewritten).
  Reopen only if late merges prove frequent.
* **Proposed (#175, `target.md` §A late instance, theory):** keep the rewrite and rename (about 3·S of I/O with the
  read-back), the format unchanged: the only option that keeps staging, publish-by-rename, serving-by-uid §4's inode
  check and the read-ahead. A trailer written in place is not crash-safe; append-only and a segment per merge store
  frames in arrival order. The deciding unknown is late-merge frequency × series size.
* **Measured (#179, `containers.md` §Measured: what a late frame costs; interleaved, warm, host page-cache bound):** at
  2 000 frames the `.sbnd` rewrite writes 527.5 MB (1 frame) to 529.8 MB (10), end = middle, 0.57–1.02 s on this host
  (only its bytes are claimed exactly); MXF and MP4 with the moov at the end append in place in 2–10 ms (kB written);
  every middle insertion in MXF or a front-moov MP4 rewrites the series too; AV1 GOP 30 in the middle adds ~9–11.5 s
  of re-encode.
* **Measured (#185, `containers.md` §Measured: rewriting only the tail; XFS with reflinks and ext4 on loop devices,
  interleaved, five rounds, medians):** the merge clones the published file (`FICLONE`), rewrites the clone from the
  insertion point on, reads it back and renames it over: the publish-by-rename guarantees hold, and a reader holding the
  old file read it unchanged. At N = 2 000, XFS: 342 kB and 3.0 / 6.7 ms (warm / `fsync`'d) for a frame at the end,
  264.4 MB and 1.16 / 1.39 s in the middle, 529.4 MB and 1.6× the full rewrite `fsync`'d at the start (copy-on-write
  over shared extents); the full rewrite 529.4 MB, 1.75–4.08 / 2.24–2.32 s. ext4 has no reflink: the fallback copies,
  the same bytes and time as the full rewrite. Needs the index at the end or reserved slack (the two tied); on layout 1
  (v2 tiled) the tail is ≥ 93 % of S (arithmetic). The times are the merge's one core, the bytes exact; btrfs, a cold
  cache and repeated merges not measured. It corrects #175's "extent sharing does not help". The owner kept the full
  rewrite (Decided 10-26/27 night, above).
* **Proposed (#169, receiver ADR §10, theory): the process map.** Crash recovery takes every package in `incoming/`
  again, so the files are the record in every option. Recommended: **two programs joined by files**, the receiver a
  loop with a scan every few seconds, its own user, no network; one process loses the isolation (one address space
  holds the TLS key and writes every study DB); a socket copies what the files hold. The reply at `<root>/status/<name>`,
  written by the receiver only, kept a fixed time; a late duplicate answered from the audit row; the sender's identity
  from the carrier's `uploads/<unit>/<revision>`. Open with the owner (§14, D3).
* **Decided 10-24:** the refusal/confirmation protocol is part of the design even if first versions do not build it;
  the PCS keeps each package until "stored" and resends on "refused" (#149 proposes two replies, "received" then
  "committed", polled).
* **Decided 10-26 (owner): staging** (step 6): extract into `incoming/<f>.work/` on the root's filesystem, never the
  serving tree. *Corrected 2026-10-26:* this file listed it as a proposed step.
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
* **Built (#163, proposed):** the receiver crate (ingest/receiver at `d06f17a`) and its ADR — steps 1–8, 11, 12, R,
  quarantine and crash recovery; 9 and 10 a trait with nothing behind it. Verified against the steps above one by one:
  staging on the root's filesystem, fsync of files and directories, 6b from disk, never decodes, one rename, one
  transaction with an audit row, 8 from disk, refusal keeps the package, recovery from 3. Package-hash and 6b-hash
  mutations caught. Owed: **the audit row has no "who"** (Decided 10-24/25: who, when, what; its ADR §7 question 7);
  its ADR §0 calls quarantine and durability "Decided", where they are proposed steps here (staging is the owner's,
  10-26). *Corrected 2026-10-27, from the branch's commits of the night:* the flaky suite is fixed (`791e015`: the crash
  test forks only while no test holds a lock; 20 full runs and 40 parallel runs, 0 failures); steps 6b and 8 are
  tested at their call sites (`33ffdaf`, three mutations caught); 6b and 8 read through `common/from-disk`, the one
  helper D2 chose (`3471fb9`); **layout 2 and the addition merge are built** (`5d0ae2c`: one `metadata` member, zstd
  or plain; kinds `series`, `addition`, `update`; a `layout 1` header refused; the merge in display order by Instance
  Number then coded UID, written in the work directory, read back whole from disk and renamed; the crash test adds an
  addition in the middle of its series), so the per-member compression flaw is gone. Built **without resend-identity
  logic, on purpose**, until the update model (§5) is confirmed: what it has is #149's (unit, revision) order per unit,
  which §5's point 5 would take out of the correctness logic.
* **Built (#160, proposed):** the verify tool (tools/pacs-verify and common/study-db at `5c9356c`) for a file, a study
  or a root; reads from disk (`fdatasync` + `posix_fadvise(DONTNEED)`), report, exit 0/1/2; 20 tests; integrity,
  group-hash and fadvise mutations caught. Frames are read back, not hashed: v1 `.sbnd` has no per-frame coded XXH3
  (documented). *Corrected 2026-10-27:* the uncached-open call sites are tested (`62c8ce5`, two mutations caught), and
  the helper is the crate `common/from-disk` (`4d9e4a7`), the same files as #163's (they merge clean).
* **#160, #163 and #164 do not fit together yet** (built in parallel): two study-DB schemas (`xxh3 INTEGER` in #160,
  `xxh3 TEXT` in #163: the verify tool fails on a study DB the receiver writes); two disk-read helpers where "same code"
  is Decided (**Decided 10-26:** #160's, §14 D2; *now one crate in both, 2026-10-27*); two reply files and vocabularies (#163 `stored`/`refused`/`quarantined` in `incoming/status/<f>`; #164
  `committed`/`refused retry`/`refused final` in `status/<name>`). Each is structural: §14, D1–D3. *Corrected
  2026-10-26:* #160's schema also lacks #163's `series` column and audit table; the one real D1 choice is the hash's
  type.

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
* **Layout measured (#161):** on the parser's five packages, shared + per-frame (the series as a simulated
  converted-enhanced instance) weighs 0.18–0.19× a row per group and reads a series' display values in 0.29–0.41× its
  time **once the parser's nested keys are masked**; as written only 0.52× (and 0.78–0.84× for mr, whose private keys
  differ per instance). A correction of a shared attribute in one instance splits it into every frame (263 rows,
  ≤ 4.8 ms); in every instance it stays one shared row (≤ 0.9 ms against 262 rows, ≤ 9.5 ms). The pre-registered
  rule recommends **row per group while the parser's keys hold address bytes, shared + per-frame once they are
  deterministic**. It strengthens T1 for now and makes shared + per-frame conditional on the PCS fixing its keys (§15).
  Measured on rusqlite 0.40.2; the 1.4–1.6× slower exam correction in shared + per-frame is unexplained. **Open:**
  adopt it (§14, D5).
* **Compression of that layout (#178, measured, one stream, interleaved):** the converted-enhanced instance with masked
  keys is 4.9–7.6× smaller raw but compresses only 6.5–9.5×, so compressed it is 1.17–1.32× **larger** than the
  per-instance groups (1.17–2.0× as written); two pre-registered predictions contradicted. Level 1 is right (19 saves
  6–19 % for 36–380× the CPU); compressed, metadata is ≤ 0.36 % of the package in every layout; the layouts differ by
  ≤ 23 ms per series on rural ADSL. The layout choice (D5) does not hinge on compression.
* **Engine (#147, #151, #157): rusqlite, proposed and strengthened**, through `spawn_blocking`. Turso awaited directly
  blocks the tokio worker (heartbeat p99 285 ms vs 2.4–3.5 ms); in `spawn_blocking` it no longer blocks but costs ~2×
  the CPU per scan; 2 MiB per open file (transparent huge pages; 130 KiB with THP off); its multi-process mode is "not
  production ready". rusqlite: 185 KiB per open file, open 0.9–1.4 ms, read 18–23 µs. **The two-process question is
  answered (#157):** Turso's lock goes with the handle, not the transaction, and fails at once (`LockingError`, no busy
  wait), and a held read-only Turso handle is stale; rusqlite only ever waits (≤ 4.8 ms), no errors, nothing stale —
  the owner's reasoning (reads never meet creation, both are short) holds for rusqlite. #157 committed no raw results.
  *Corrected 2026-10-26:* two processes on a study DB were never the owner's criterion for discarding Turso ("won't be
  common" was an agent's reply on 10-24); if the viewer server reads the study DB at open (§6), the receiver and the
  server share every study DB, so it is a design constraint on either engine (one owning process, or open per
  operation with retries), not a veto. The engine stays Proposed (§14, D7).
* **Versions:** rusqlite 0.41.0, SQLite 3.54.1 (#159). lab/metadata-store still pins rusqlite 0.40, which cannot share
  a workspace with 0.41 (`libsqlite3-sys` links `sqlite3` once): a one-line bump, checked, is in §13.

## 5 · Updates (#148)

* **Proposed:** one path — client applications go through an update API that authenticates, stamps the author and
  submits an update package like any sender; per-study arrival order; a worker for metadata-only packages; a caller
  may wait for "stored" (`200`, `412`, `422`, or `202` after a timeout); priority by what a package is, never by who
  sent it. Differences (`set`/`remove` by DECK key; a sequence replaced whole, as PS3.4 §CC.2.6.2 does for N-SET);
  UIDs and the frame description not updatable; base hash per touched group (`If-Match`, `412` stale, `428` missing);
  audit row per package (refused ones too) with prior values in the study DB, DICOM Original Attributes vocabulary;
  withdrawal per IHE IOCM (CID 7010 reasons; hidden, purged after a grace period); `sender` and `on_behalf_of` now,
  roles later.
* **Proposed 2026-10-27, the update model — awaiting the owner's confirmation of five points.** The owner's own rule:
  the receiver applies a package **item by item**. The exam: no study → create it; else its hash differs → replace it
  and write an audit record; else nothing. The same for each series and each instance; new frames are merged into the
  `.sbnd` (§3); items not in the package are left untouched. The completion proposed:
  1. absence means unchanged; deletions are listed explicitly;
  2. item-by-item apply is idempotent, so a resend changes nothing and is answered `stored`;
  3. each changed item carries the hash it replaces, taken from the sender's sent list: applied if the current hash is
     that previous one; current = new is a duplicate (`stored`); anything else is stale and refused;
  4. the sender sends one package per series at a time, in order, waiting for `stored`;
  5. the revision counter leaves the correctness logic (a label at most).

  Consequence: updates need a small manifest (the removals and the previous hashes), which meets the 10-25 "no
  manifest until something needs one" (§2). Points 2–3 are #176's and #148's base hash on the PCS's wire. If
  confirmed, it answers D12 and A9 (§14, §17): no package identity is needed for correctness. The sender (#177) and
  the receiver (#163) were implemented without any resend-identity logic, on purpose, waiting for this. **For the PCS
  team** (§15): the parser writes a corrected group beside the old file and never deletes the old one (#176), so the
  sender cannot tell which is current; the parser should replace the file or mark the current one.
* **Decided 10-26 evening, first version:** the sender compares the hash-named files with what it last sent (#176's
  option c), "good enough"; to the team meeting (§16).
* **Proposed (#176, metadata-updates §13, theory, for the team meeting):** every correction that reaches the PCS comes
  back as a whole object (a re-sent instance, an IOCM KOS); HL7 ADT, MPPS and QC at the PACS do not reach it. So whole
  changed groups on the PCS's wire, differences after intake (update API, audit); the base hash from the sent list; an
  update whose new hash equals the current row is answered `stored`; a withdrawal's KOS travels as a document series.
  Read at `a65abe2`: the parser never deletes an old group file, so a correction adds a name and A → B → A leaves no
  trace (its Q-U1–Q-U7, §15).
* **Open (owner 10-25), for the team and the product owner:** whether client-application updates go through the
  receiver's queue or a standard update endpoint coordinated with it. The single path is the best so far for
  consistency, simplicity and integrity; what is avoided is a second process writing study DBs directly. The honest
  guarantee is order and a bounded delay, not "instant". Default: the single path (§16).
* Measured since (#165): a correction of one patient's 3–26 studies reaches the study index in p50 57 ms locally,
  208 ms across a 2 ms round trip; nothing measured contradicts the bounded delay.

## 6 · Viewer metadata (OPEN)

* **Decided 10-24:** the codec can come from the study index; without it the page loads every decoder. **To
  evaluate:** prefetch every decoder while the user browses the list (fetch, never instantiate; same site for the HTTP
  cache); a direct open by link is the case left. This replaced the 10-19 "only its codec's decoder" decision.
* **#145** (first evaluation): a derived file per series served by nginx (`no-cache`, ETag) plus the codec as a
  study-index column; deciding reason: no serving process opens a study DB.
* **#153** (independent second evaluation): split by kind — list fields and codec in the index; display metadata (no
  identifiers) as a derived file per series; study fields with identifiers in a per-study file (`no-store`,
  authorized); full metadata (tag panel, 0.8–12.6 KB per series compressed) in a file fetched when the panel opens.
  Ranking: F (same split, in the session), G (over HTTPS), C (the frame server reads the study DB at open), D (a
  metadata API), A (a column in the index: the owner's earlier idea, ranked 5th), E (a cache). Its decoder rule is
  corrected in #158.
* **The owner's view (10-25/26):** read the series' metadata from the study DB when it is opened; derived files or index
  columns duplicate data. Its costs: a serving process opens study DBs (fine with rusqlite, measured), coupled to the
  schema. The privacy split (#153's strongest point) argues for splitting by kind, which a query can do too, not for
  files. The index-down case does not apply (the study DB is on the PACS host).
* **Measured (#166), four emulated links, 1 344 browser visits, 0 errors:** the study DB read at the request (A1) ties
  or beats the derived file (B) to the first painted frame on every link (cold metadata, 262 instances: fiber
  101 / 110 ms, 4G/5G 297 / 298 ms, GEO 2.47 s both); #153's split (C) ties too. In the session ahead of frame 0 (A2):
  +2 to +6.4 round trips later. **Host:** per open at 2 000 instances A1 costs 4.0 ms with a ready per-series row (3.3
  ms of it gzip) and 9.0 ms per-instance, against 0.04 ms for B; holding one connection per viewer at 1 000 viewers
  costs 155 MiB (ready row) or 2.1 GiB (per instance), open-read-close holds none. **Consistency:** no torn read in
  144 860; A never stale; B and C stale up to p99 4–8 ms. Against its own rule the owner's option is **not
  contradicted on the user's path or consistency, contradicted on host CPU at 2 000 instances** (4.0 ms vs the 2 ms
  threshold). This strengthens the owner's view on the path and weakens it on CPU, where the cost is gzip, which a
  ready row could store compressed (*not measured*). Deviations not recorded as such: h2load's gzip request and opens
  counted once (e30f966, after pre-registration); H2 at 1/100 studies, not 1/10/100; saturation inferred. **Open**
  (§14, D6); row DAY-4 measures the ready row stored compressed (§18).
* **Measured (#173), the ready row stored gzipped at write, the revision as ETag** (warm; user's path and consistency not
  run): CPU in process per open 0.25 ms at 262 instances and 0.38 ms at 2 000 (ready row 0.92 / 4.22 ms; B 0.02–0.04);
  a 304 0.20 / 0.21 ms. Served at 1 viewer 0.9–1.0 ms either size; at 100 viewers, where the host saturates, 2.2–2.4 ms
  (contention, not the read), peak 1 250–1 600 opens/s against B's 9 400–16 800. The receiver pays 0.17 / 3.1 ms per
  series write; the row is B's file byte for byte. Against the 2 ms rule: under it in process and at 1 viewer, over it
  at 100 (the rule names no concurrency). Proposed: D6 with a compressed ready row; open with the owner.

## 7 · The study index (#146)

Proposed: the name *study index* (Orthanc's word; not Modality Worklist, not a master patient index, not FIXTURES.md's
`study.json`); list fields only (QIDO-RS's required study and series attributes, description, issuer, host, revision,
access key; per series the codec); MySQL 8.4 LTS or MariaDB (`utf8mb4_0900_ai_ci` matches PN's accent/case-insensitive
matching); one index for all hosts, starting on the first; a direct link never needs it; a per-host outbox, idempotent
upserts keyed by UID accepting only a higher revision, a reconcile job; an HTTPS API shaped like QIDO-RS Search,
authorized by access key, ≤ 50 ms p95 server time; not now: instance rows, thumbnails, fuzzy matching, replicas.
**Owner 10-25:** MySQL fits; it may live on its own server over the network; to evaluate. *Corrected 2026-10-26:* not a
choice of MySQL; the owner: "I suggested in biased you that it was going to be MySQL ... but I'm not really sure". The
engine and the separate server are open (§14, D9).

**Prototyped and timed (#165, MySQL 8.4.6, 10⁶ studies, warm, p95).** Strengthens: MySQL 8.4 and its default
collation (accent- and case-insensitive prefix matching on the index; `utf8mb4_bin` fails), the revision-ordered
upsert, the reconcile, the 50 ms API budget, and the index on its own server at ≤ 2 ms round trip (+2.1–2.6 ms a
query). As designed, `date7_modality` misses its 10 ms budget (14–19 ms); a tuned shape (covering indexes, a deferred
join, modality on the study row) meets every cell (query ≤ 2.8 ms locally, ≤ 5.0 ms at 2 ms; API ≤ 5.8 ms), except an
added low-selectivity name prefix at offset 1000 (17–20 ms); the shape was chosen on the same data. Sync lag commit →
index p50/p95 7/10 ms locally, 21/26 ms at 2 ms. Size 3.9 GB at 10⁶, the top of the estimate. Rebuild 140 studies/s
locally (about 2 h at 10⁶, arithmetic). The outbox inside the study DB is atomic but costs a full scan when the
publisher restarts; #146 §7's per-host file avoids it (§14, D9). A product client must set mysql_async's
`reset_connection=false`. Saturation at concurrency 8–16 on 4 vCPUs. Tests: 11, 9/9 mutations caught (on MySQL 8.0.46
for the re-run); without `SI_TEST_MYSQL` five tests skip silently. **To evaluate stays the owner's.** *Corrected
2026-10-26:* #165's `lab/study-index/README.md` (`16fec79`) says "The owner chose MySQL on 10-25"; the owner did not (above; §14, D9).

**Engines (#174, on #165's harness, 10⁶, p95 warm, c = 1, local / 2 ms).** Worst §11 cell: MySQL 3.4 / 5.7 ms,
PostgreSQL 18 2.9 / 5.9, SQLite 1.9 (local only); sync idle p95 12.1 / 9.7 / 8.4 ms; size 3.98 / 2.35 / 2.11 GB. All
three meet §11, most cells tie within 1 ms; saturation at c = 8–16. An ICU nondeterministic collation costs 128 ms a name
search (no B-tree prefix). 0 mismatches, 12 tests on each engine, 18/18 mutations caught. #165's attribution corrected in
place in its README. Reported, not decided (§14, D9).

**Placement (#172, study-index ADR §6, theory, proposed).** Not on day one: the index on the first PACS host behind a
local socket, the list API beside it; both move together at the first trigger — a second PACS host (decisive), list
load slowing frame reads, or the index's memory raising frame-read misses. With the API beside it no query crosses the
network; only publishers do (+14 ms sync lag at 2 ms, #165). SQLite cannot move to another server. Pre-registered, not
run: frame-read interference, TLS to a remote index, several publishers (§14, D9).

## 8 · The disk layout (#152, #167) — for the team meeting

Options: flat; the PCS's coded `<D>/`; `yyyy/mm/dd`; one or two hashed levels; volume prefixes; hashed + a derived date
view. Recommended by #152: **256 folders from a hash of the study UID, no date in the path or the URL** — the server
builds the path from the link alone; a date in the path breaks issued links when a date is corrected, or needs a
lookup per session. **Owner 10-25:** not decided; partly ours; present the trade-offs at the next meeting with the team,
the product owner and the DICOM-experienced members, and decide together.

**Measured (#167, ext4 and XFS, 10⁴–10⁶ studies, warm only — no eviction lever here):** lookup within a few µs across
options, flat no slower than hashed at 10⁶; scan and deletion by age about equal per study; publication flush-bound
(~2 ms at 1 writer, 5–8 ms at 8) everywhere, and the date trees' next-day folder is one hot directory as flat's root
is; **a corrected date moves the study under B and C (~1 ms) and all 500 old paths stop resolving; flat and hashed move
nothing.** ext4 without `large_dir` stops at **7 667 255** entries (44-character names) and 9 950 066 (30), below the
10–26 M inference (corrected in place in the ADR); `large_dir` passes 8.5 M; without `dir_nlink` subdirectories stop at
64 998. XFS was not run to a ceiling. Host: 4 vCPUs, 15 GiB, nothing claimed past 10⁶; ext4 and XFS ran sequentially, not
compared. The recommendation is unchanged, and the measurement strengthens its one hard argument (link stability).
Deviation not stated in the ADR: amendment 2 (5aa5e72) came four minutes after the first rows (f92b0d9); the changed
cells were re-run, and the re-run's ext4 10⁵ publish p50 is ~1.7× the first run's (arms still tie).

## 9 · Serving by UID (#142, #162)

Proposed (#142): one process, many series; URL `/<Study>/<Series>` validated by grammar before any file is touched; a
map of `Weak` stores (one open file per series in use); a `stat` at lookup to see a renamed-in replacement; an optional
`?digest=` pairing metadata with frames; accept-then-close with codes (1 bad name, 2 not found, 3 changed, 4
unreadable, 5 busy). The grammar is corrected to PCS-coded UIDs (alphabet `0-9 A-Z _ a-z ~`, even length ≤ 44, no
`.`, `/` or `%`) in both #158 and #162.

**Built (#162, on v1):** many series under `--root`, each named by its coded UIDs, codes 1–5, both clients surface
them; 151 tests; accept-`.` and drop-the-`stat` mutations caught. #142 §9's seven choices are built as its defaults,
each still the owner's (§14, D10). `<Study>/<Series>.sbnd` is marked provisional, §8 being open. Measured: over
WebTransport the close code does not reach a browser (wtransport 0.7 closes the connection); a capsule patch is
proposed, not built. Owed: a panic in the blocking open maps to code 5 "busy"; the downloader still redials on
refusals.

## 10 · Findings for the PCS team (#154, #159, parser `a65abe2`)

Read in its source or seen in its bytes; the questions are §15.

* converted-enhanced is planned, not implemented;
* nested keys contain bytes from memory addresses, so parsing the same files twice gives different groups (PT got five
  series groups, US two exam groups) and different group names; with address randomisation off three parses agreed;
* group 0002 lands in the instance group;
* an exam-level sequence keeps only its first attribute in the exam group; the rest repeats in every instance group;
* the date directory is made from an unterminated name (`capi.c` 148–160): a stray directory, or exit 12, depending on
  the heap (runs used `MALLOC_PERTURB_=255`);
* exit codes: after `exitNoArg1FilePath = -6` the enum counts on from −5, so `exitMkdirFailure` is 12 and
  `exitNotDICM` is 0, the success code (`datatypes.h` 62–87);
* series, instance and private groups are hashed over the length summed before UTF-8 conversion (exam over the bytes
  written): a non-ASCII value would leave a name that is not its hash (read, not exercised);
* fixed-size attribute tables (`capi.c` 67–70) are filled with no bound check (read, not exercised);
* group files are named by BLAKE3; the build of `ESIPbasetags` and `dicm2decksqlite` fails;
* the output is 1.15–1.95× the size the level table predicts; differences from `contract.md` are listed in #154.

## 11 · Corrections owed (before implementation is merged)

| where | change | state |
| --- | --- | --- |
| #142 `docs/adr/serving-by-uid.md` | grammar for PCS-coded UIDs | done in #158 and #162 (merge both, §13) |
| #119 `docs/ingest/design.md` §12 | one package; staging in `incoming/`; two checks from disk; no `inputs/` log, revisions dirs or `CURRENT`; in-place updates; refusal/confirmation | owed; #163's ADR covers it, so #119 can close (§13) |
| #120 `docs/ingest/metadata-draft.md` §2 | no truth/generation/history; T2 as the team's first design | done in #159 |
| #120 §3 | versions (rusqlite 0.41.0, SQLite 3.54.x); the engine results of #147/#151 | done in #159 (#157's in §4 here) |
| #126/#144 READMEs | "page document/page view" → display metadata | done in #159 |
| #153 | the decoder rule (10-24 replaced 10-19) | done in #158 |
| `docs/disk-layout/target.md` | "no metadata beside the `.sbnd`" restated; XXH3 group names | done in #158 |
| `docs/ingest/contract.md`, `design.md`, `README.md` | BLAKE3 → XXH3; the site's encoding/outbox/upload relabelled as the PCS's side; the package as the interface | done in #158 |
| all docs | the terms above | done in #158; owed in #143 ("catalog"), #164's glossary ("site", "verdict"), #166 ("paint metadata") |
| #158 display-metadata and metadata-updates ADRs | Proposed items (one study DB per study, one row per group, one writer, the receiver's steps) listed under "Decided by the owner" | owed |
| #158 glossary | study DB defined as "one row per group" (T1, Proposed) | owed |
| #158 `docs/ingest/link.md`; `target.md` | "the site" relabelled only by a note; the layout meeting "with the PCS team" (§8 says who) | owed |
| #159 handoff/metadata-2026-10.md | the 10-19 decoder rule and the truth/page-view model as "Decided": needs a superseded note; names the owner by first name | owed |
| #163 ADR §0 | quarantine and durability called "Decided" (staging is, 10-26) | owed |
| #167 ADR §5 | amendment 2 came after the first 10⁴/10⁵ rows; the re-run's 1.7× publish p50 | owed |
| #165 `lab/study-index/README.md` (`16fec79`) | "The owner chose MySQL on 10-25": the owner did not (§14, D9) | owed |
| #149 (in #158) `docs/adr/pcs-transfer.md` (`b47b918`) container table | tar over zip for cross-file zstd: #163 compresses per member (§2) | owed |
| #160 common/study-db | #163's `series` column and audit table (§14, D1) | owed |
| #163 receiver | per-member compression → one stream; layout 2 and the addition merge (#177 §15.11) | done in #163 (`5d0ae2c`) |
| #175 `docs/disk-layout/target.md` §A late instance | "extent sharing does not help": true of the index at the front with no slack only (#185) | owed; #185 corrects it in `containers.md` |
| #149 (in #158) `docs/adr/pcs-transfer.md` (`b47b918`) §2, §4, §7 | the late instance as an addition, byte order of paths, no compression flag, resend the kept bytes (#177 §15.12) | owed, once the owner accepts #177 |

## 12 · PR index

One line per PR: what it delivers · state · supersedes / superseded by. "Theory" = no code or timing.

| PR | delivers | state | relation |
| --- | --- | --- | --- |
| #142 | ADR serving by UID (theory) | draft | carried by #158 and #162: close after both |
| #143 | ADR client telemetry in production, sampled (theory; outside PACS) | draft, CI green on `deb236a` | independent; its body still has a session link, and it says "catalog" |
| #144 | update cost: in place 6–17× cheaper than revision directories | draft | carried by #159: close |
| #145 | ADR display metadata, first evaluation (theory) | draft | carried by #158: close |
| #146 | ADR study index (theory) | draft | carried by #158 (and #165): close after #165 is retargeted |
| #147 | lab/sqlite-engine: rusqlite vs Turso | draft | carried by #159: close |
| #148 | ADR metadata updates (theory) | draft | carried by #158: close |
| #149 | ADR pcs-transfer (theory) | draft | carried by #158 (and #164): close |
| #150 | metadata size, zstd, repetition on five series | draft | carried by #159: close |
| #151 | sqlite-engine §4, each at its best | draft | carried by #159 (and #157): close after #157 is retargeted |
| #152 | ADR disk layout (theory) | draft | carried by #158 (and #167): close after #167 is retargeted |
| #153 | ADR viewer metadata, second evaluation (theory) | draft | carried by #158 (and #166): close after #166 is retargeted |
| #154 | the parser's own output, measured | draft | carried by #159 (and #161): close after #161 is retargeted |
| #155 | link.md §11: the carrier (theory) | draft | carried by #158 (and #164): close after #164 is retargeted |
| #156 | update compression, measured | draft | carried by #159: close |
| #157 | sqlite-engine §5: two processes, rusqlite waits, Turso fails or is stale | draft, verified | merge; not in #159 |
| #158 | the design records combined, §11's corrections | draft, verified | supersedes #142 #145 #146 #148 #149 #152 #153 #155 as the way they merge |
| #159 | the metadata lab branches consolidated, draft corrected | draft, verified | supersedes #113 #120 #126 #144 #147 #150 #151 #154 #156 |
| #160 | tools/pacs-verify + common/study-db + common/from-disk (§3's verify tool) | draft, verified; call-site tests `62c8ce5` | waits for D1 and D11 |
| #161 | study DB layout: row per group vs shared + per-frame vs blob | draft, verified | merge after #159 |
| #162 | server `--root`: many series by coded UIDs | draft, verified | built from #142; waits for D10 only to make defaults final |
| #163 | ingest/receiver + ADR: steps 1–8, 11, 12, R, recovery; layout 2 and the addition merge (`5d0ae2c`) | draft; flaky tests fixed (`791e015`) | waits for D1, D3, D11, the update model (§5); supersedes #119 |
| #164 | carrier crate + the PCS's script (draft-14, mTLS) | draft, verified | built from #149/#155; waits for D3, D4, D11 |
| #165 | lab/study-index: MySQL 8.4 prototype, timed | draft, verified | built from #146 |
| #166 | lab/metadata-delivery: viewer metadata ways, timed | draft, verified | built from #153 |
| #167 | lab/disk-tree: #152's protocols, ext4 and XFS | draft, verified | built from #152 |
| #168 | this design state | draft | carries §13 |
| #169 | receiver ADR §10: the process map (theory) | draft, Proposed | two programs + files, the receiver a loop; reply at `<root>/status/` (D3) |
| #170 | link.md §11.9: how the PCS learns the verdict (theory) | draft, Proposed | keep polling, optionally `Prefer: wait=20` (D13) |
| #171 | link.md §13: which QUIC implementation (theory) | draft, Proposed | TCP stays; b1 or d2 if QUIC; not h3 by default (D4) |
| #172 | study-index ADR §6: a server of its own (theory) | draft, Proposed | not on day one; index and API move together at the first trigger (D9) |
| #173 | lab/metadata-delivery: ready row gzipped at write, timed | draft, Proposed | 0.25–0.38 ms per open in process; over 2 ms at 100 viewers (D6) |
| #174 | lab/study-index: PostgreSQL 18 and SQLite beside MySQL, timed | draft, Proposed | all three meet §11, most cells tie (D9); stacks on #165 |
| #175 | `target.md`: a late instance without the rewrite (theory) | draft, Proposed | keep rewrite and rename, format unchanged (§3) |
| #176 | metadata-updates §13: how a change travels (theory) | draft, Proposed | option (c), whole groups on the wire (§5, A8); for the team meeting |
| #177 | pcs-transfer §15 and `carrier/sender`: the sender's package build, built (`ecbea88`) | draft, Proposed | layout 2; reconciles A4–A6; waits for D3, D4, D11, the update model (§5); stacks on #164 |
| #178 | lab/metadata-store: zstd on converted-enhanced, timed | draft, Proposed | compressed, CE is 1.17–1.32× larger than per-instance; level 1 (§4) |
| #179 | lab/late-frame: a late frame in `.sbnd`, MXF, MP4, timed | draft, Proposed | `.sbnd` rewrites the series; moov-at-end and MXF append in ms (§3) |
| #180 | link.md §11.10: is a reply needed? (theory) | draft, Proposed | yes, the end-to-end argument; agrees with the decision (§2) |
| #181 | `carriers-explained.md`: the TCP carriers (theory) | draft, Proposed | a scored table, no recommendation (D4) |
| #182 | link.md §14: the transport seam now that the sender is ours (theory) | draft, Proposed | S1 if QUIC is kept; TCP with BBR first; pre-registered T-bbr vs quinn (D4); stacks on #171 |
| #183 | `Cargo.lock`: rustls 0.23.46, rustls-webpki 0.103.16, tokio 1.53.3, into `claude/av1-unified-mainbase` | **merged** 10-26/27 night, the owner's request, CI green | the base of §13 |
| #184 | the same into `main` | **merged** 10-26/27 night, the owner's request, CI green | — |
| #185 | `containers.md`: a late frame by rewriting only the tail of a reflinked clone, timed | draft, Proposed | yes with reflinks, needs a format change; the owner kept the full rewrite (§3); stacks on #179 |

Older stack (before #142): #113 ← #120 ← #126 (stores, format survey, pair bench), carried by #159: close; #118
page-open carriers (`metadata-turso` base), not carried, evidence only; #119 receiver design, superseded by #163's ADR
and §3. #141, #140, #139–#130 and earlier are not PACS work and not in this plan.

Verification of the night (2026-10-26, one branch at a time): every PR above from #157 is verified as its line says;
"gate" is `scripts/gate.sh --quick --no-browser`, which passes on each (the browser steps need decoders this container
lacks and fail the same 7 checks on the untouched base). Comment budget, link check and personal-path check pass on
every branch. The "Generated by" line was removed from the bodies of #157, #158, #161, #162, #164, #165 and #167.

## 13 · Assembly plan

Into `claude/av1-unified-mainbase` (`feeb1626`). Checked with `git merge-tree --write-tree`, pairwise and in this
order, and by a scratch merge of the whole sequence (nothing pushed). Every PR from #142 has `feeb1626` or `5625dcf4`
(an ancestor of it) as its base, so none needs a rebase: where a conflict is listed, resolve it in the merge, as
written, or merge the base into the PR's branch first (the repository merges, it does not rebase). Merge with
`--no-ff`; GitHub then marks each PR merged when the push lands.

| step | PR | conflict in this order | resolution |
| --- | --- | --- | --- |
| 1 | #168 (this) | none | — |
| 2 | #158 | none: it adds one paragraph to §11 ("Applied 2026-10-26", true of #158) and nothing else to this file | — |
| 3 | #143 | none | — |
| 4 | #165 | none | — |
| 5 | #166 | none | — |
| 6 | #159 | `docs/ingest/design.md` §5 and the compression paragraph; `.gitignore` | `.gitignore`: keep both; design.md: keep the base's terms (study DB, package, PCS) and add #159's "Corrected 2026-10-20" note and its measured sentence, in those terms; then the rusqlite bump below |
| 7 | #157 | none | — |
| 8 | #161 | metadata-draft.md, lab/metadata-store/README.md | both sides added text: keep both (#159's paragraph first, then #161's study-DB sentences; both README sections) |
| 9 | #162 | the serving-by-uid ADR (3 hunks) | #162's status and its built wording, with #158's correction note and its fuller grammar paragraph |
| 10 | #167 | the disk-layout ADR status; `.gitignore` | status: #158's corrected terms + #167's "protocols were run" sentence, "the team, the product owner and the DICOM-experienced members"; `.gitignore`: keep both |
| — | stop | | steps 11–13 wait until everything is clean (§14, D11, Decided 10-26) |
| 11 | #163 | `Cargo.lock` | keep the base's, then let cargo re-resolve |
| 12 | #160 | `Cargo.lock`, `Cargo.toml`, `scripts/gate.sh`, `docs/ingest/README.md` | members and gate lists: keep both; README: the base's wording ("the PCS's side", "study DBs", "study index") plus #160's item 7 |
| 13 | #164 | `Cargo.lock`, `scripts/gate.sh`, `docs/glossary.md` | lists: keep both; glossary: the base's PCS, submission package and carrier rows; #164's verdict and site rows once D3 fixes the vocabulary |

**#169–#181 are not yet in this plan:** each is a draft on another PR's branch (#163, #164, #165, #166, #158, #161) or on
the base; their order waits on the owner's acceptance (§14).

**A text-clean merge that does not build.** After #159, lab/metadata-store (rusqlite 0.40) and #160/#163 (0.41) cannot
resolve in one workspace. Bump it at step 6 — checked: `cargo check` of metadata-store, the receiver, the verify tool
and the carrier, and metadata-store's 9 tests pass on 0.41.

```bash
git fetch origin
git switch -C assembly origin/claude/av1-unified-mainbase
m() { git merge --no-ff -m "Merge pull request #$1: $2" "origin/claude/$3"; }

m 168 "the PACS design state"            pacs-design-state
m 158 "the PACS design records combined" design-records-combined
m 143 "client telemetry in production"   telemetry-production-design
m 165 "the study index prototyped"       study-index-proto
m 166 "viewer metadata delivery, timed"  viewer-metadata-measure
m 159 "the metadata analysis consolidated" metadata-consolidated   # resolve docs/ingest/design.md by hand, then:
sed -i 's/^rusqlite = { version = "0.40"/rusqlite = { version = "0.41"/' lab/metadata-store/Cargo.toml
cargo check -p metadata-store && git commit -am "lab/metadata-store: rusqlite 0.41, the workspace's"
m 157 "two processes on one study DB"    sqlite-lock-behaviour
m 161 "the study DB layout, timed"       study-db-layout          # keep both sides
m 162 "serve many series by coded UIDs"  serve-by-uid-impl        # resolve the ADR
m 167 "the disk tree, timed"             pacs-disk-layout-measure # resolve status and .gitignore
scripts/gate.sh --quick --no-browser
git push origin assembly:claude/av1-unified-mainbase              # fast-forward only; the owner's push

# only once everything is clean (D11), each fix pushed to its branch:
m 163 "the PACS receiver" pacs-receiver-impl  # Cargo.lock: git checkout --ours Cargo.lock && cargo metadata -q >/dev/null
m 160 "the verify tool"   verify-tool
m 164 "the carrier"       pcs-carrier-impl
```

The conflicting steps stop with the conflict in place: resolve, `git add`, `git commit --no-edit`.

**Retarget before closing.** Several open PRs have another PR's branch as their base; closing that PR is fine, but
deleting its branch closes the PR stacked on it. Retarget them before the push, too, or
GitHub will not mark them merged (`gh pr edit N --base claude/av1-unified-mainbase`, or Edit beside the title): #157
(on #151), #161 (on #154), #164 (on #155), #165 (on #146), #166 (on #153), #167 (on #152). Then close as superseded: #142, #144–#156 (carried by #158 or #159),
#113, #120, #126 (carried by #159), #119 (by #163). Keep #118 as evidence or close: the owner's.

## 14 · Decisions waiting for the owner

Each: the evidence in one line · the default if nothing else is said.

* **D1 · one study-DB schema.** #160 stores `xxh3 INTEGER`, #163 `xxh3 TEXT`; the verify tool fails on the receiver's DB.
  *Corrected 2026-10-26:* #160's schema lacks #163's `series` column and audit table, so the only real choice is the
  hash as hex `TEXT` or `INTEGER` · #160's common/study-db is the one schema, carrying #163's `series` column and audit
  table, `xxh3 INTEGER`; #163 uses the crate.
* **D2 · one disk-read helper. Decided 2026-10-26:** #160's (flush, then drop the cache), "yes, rec seems safer"; used by
  steps 6b and 8, with a test at a call site. *Done 2026-10-27:* `common/from-disk` in #160 and #163, call sites tested
  in both (`33ffdaf`, `62c8ce5`).
* **D3 · the reply file and its words.** #163 writes `incoming/status/<f>` `stored`/`refused`/`quarantined`; #164 reads
  `status/<name>` `committed`/`refused retry`/`refused final`; §3 decided "stored". **Owner 10-26:** "need to be
  analyzed" (where the reply file lives and how long); row DAY-5 first compares one program against two. #169
  (proposed): two programs joined by files, the receiver a loop; one hand-off module both link; the receiver's words at
  the carrier's place `<root>/status/<name>`, kept a fixed time; open with the owner · #169's (a): #163's words at
  `<root>/status/<name>`; #164 adapts (retry → refused, final → quarantined).
* **D4 · QUIC in the carrier.** **Owner 10-26:** chosen at build time is accepted, "it is something that will be
  decided at the deployment". WebTransport has no place in the carrier (no browser on either end); it came up only
  because wtransport 0.7.2 rejects non-CONNECT requests, so HTTP/3 needs its own listener. Open: the h3 0.0.x
  dependency, "we might need to use directly some quic implementation ... Not necessarily in rust"; row DAY-1, answered
  by #171 (TCP with stock curl; b1 or d2 if QUIC, not h3). #182 (proposed): the sender is ours, so d2 falls away; if
  QUIC is kept, S1 (the same HTTP/1.1 on one quinn stream, chosen at build); TCP with BBR per socket first, quinn only
  if its pre-registered run puts it > 20 % ahead. The carrier choice after #181's table is open with the owner · TCP in
  the default build, the `quic` feature off.
* **D5 · study DB layout** (§4). #161: row per group wins while the parser's keys hold addresses · T1 now; revisit
  shared + per-frame when the PCS's keys are deterministic.
* **D6 · viewer metadata** (§6). #166: reading the study DB at open ties derived files on every link, loses on host CPU
  at 2 000 instances (4.0 ms per open, of which 3.3 ms is gzip repeated per request); row DAY-4 measures the ready row
  stored compressed with the revision as ETag. #173: stored gzipped, 0.25–0.38 ms per open in process, 0.9–1.0 ms at
  1 viewer, 2.2–2.4 ms at 100 (saturated); open with the owner · your option, a ready per-series row stored compressed,
  open-read-close.
* **D7 · the study-DB engine and its version** (§4). **Owner 10-26:** "The latest version should be encouraged." On two
  processes as a reason to discard Turso: "we were discussing in prev session that several process won't be common and
  thus we don't know if that would be a valid discarding criteria." The owner never made it one; "won't be common" was
  an agent's reply on 10-24; with §6's read at open the receiver and the server share every study DB, so it is a design
  constraint (one owning process, or open per operation with retries), not a veto. Engine Proposed · rusqlite 0.41,
  bumped at assembly step 6.
* **D8 · metadata compression per site** (§2). #156: never slower in 56 pairs, saves 1–5 round trips on fan-outs and
  resends. **Owner 10-26:** "two profiles and at compile time we decide which profile it is compiled for". **Decided
  2026-10-26 evening:** only metadata, as one stream, on the limited-link profile; frames never; the sender is ours and
  its deployment profile picks it (§2). *Corrected:* this item said the sender is the PCS's packer.
* **D9 · the study index: engine, placement, outbox** (§7). **Owner 10-26:** "I suggested in biased you that it was
  going to be MySQL ... but I'm not really sure"; rows DAY-2 (the engine) and DAY-3 (a separate server). #165: an
  outbox in the study DB is atomic but a restarted publisher scans every study DB (0.29 ms each). The owner's idea:
  "Why not simply having a outgoing or outbox dir and a file(s) inside it?" · that, proposed: one file per owed study
  in an outbox directory (name the study UID, content the revision), the same crash behaviour as #146 §7's per-host
  file; #146 §4 takes #165's tuned indexes. DAY-2 answered by #174 (all three engines meet §11, most cells tie), DAY-3
  by #172 (not on day one; index and API move together at the first trigger); open with the owner.
* **D10 · #142 §9's seven choices.** Built as defaults in #162; the close code does not reach a browser · the defaults
  as built; the capsule patch later.
* **D11 · implementation PRs before the fit. Decided 2026-10-26:** "we hold until everything is clean. We don't merged
  unfinished work." #160, #163, #164 and #177 wait until everything is clean (the fit, #163's missing audit "who",
  each PR's owed tests; #163's flaky test and the call-site tests are done, 2026-10-27).
* **D12 · package identity and the update model** (§2, §5, A9). Open with the owner: how a resend is recognised — by
  name/hash, by content, or another way; the hash should be only an integrity check. **Proposed 2026-10-27 (§5):** the
  owner's item-by-item apply completed by five points (absence = unchanged, deletions listed; idempotent apply, a
  resend answered `stored`; the previous hash per changed item, stale refused; one package per series in flight; the
  revision a label at most), which needs a small manifest for updates; the five points await the owner's confirmation
  · the §5 model as proposed; until confirmed, #163 and #177 keep #149's (unit, revision) and nothing else.
* **D13 · how the PCS learns the verdict** (§2). #170: keep polling, optionally `Prefer: wait=20`; open with the owner
  · polling, as built in #164.

## 15 · Questions for the PCS team

* We differ from pcs.pdf (§1): the PACS receives `.sbnd`, not MXF/MP4/JXL; hashes and names are XXH3, not BLAKE3; one
  file per transfer and one package per series instead of per-file rsync. Agreed?
* Completeness: the PCS decides it per series (Decided 10-26 evening, as pcs.pdf proposes) and calls our sender. Which
  heuristic? A late instance goes as an addition package (Decided 10-26 evening): can the PCS call the sender again for
  that series?
* The reply: keep each package until "stored"; resend on "refused"; stop on "quarantined" and tell an operator. Can the
  PCS run curl and a small script (resumable upload, mutual TLS, a certificate per site)?
* Updates: does a correction delete the old group file on your side? How is a withdrawal sent? #176 §13.6 Q-U1–Q-U7
  (one group file per marker per directory; deterministic keys; ...). **The ask (§5, 2026-10-27):** the parser writes a
  corrected group beside the old file and never deletes the old one, so our sender cannot tell which is current;
  please replace the file, or mark the current one.
* Your parser (§10): when will nested keys be deterministic (the study DB layout waits on it, §4)? Group 0002 in the
  instance group, the exam sequence split, the unterminated date-directory name, exit codes 12 and 0, unbounded
  attribute tables, the failing builds.
* **The key overwrite in `capi.c`** (read at `a65abe2`): in struct KV the key is `memcpy`'d from the pointer field K,
  which has 9 bytes of room; a nested key's bytes 11–14 become the value length and the rest the value's address; at
  depth 2 it carries the whole address, so with address randomisation PT's bytes change on every parse. Consequence,
  read, not run: nested values never take the UTF-8 path.
* **A blocker:** series, instance and private groups are hashed over the length before UTF-8 conversion, so our group
  checks (§3, step 5) fail on intact data whenever a value is non-ASCII. When is it fixed?
* **Converted enhanced:** in pcs.pdf (10-23) and `codec.md`, not implemented at `a65abe2`: when?
* The date folder `<D>/` (eDA): does the PCS need it in the PACS path? The disk layout is open (§16).
* Not needed from you: a decoded-samples hash per frame (the PACS checks coded hashes; the client checks samples).

## 16 · For the team meeting

**Disk layout** (with the team, the product owner and the DICOM-experienced members; §8). Options A flat, B the PCS's
coded `<D>/`, C `yyyy/mm/dd`, D/D2 one or two hashed levels. Evidence (#167, warm): all options tie on lookup, scan,
deletion and publication; a corrected date moves the study under B and C and breaks every issued link; ext4 without
`large_dir` stops at 7.7 M entries in one directory, so flat needs XFS or `large_dir`. Recommended (#152): D, 256
folders from a hash of the study UID, no date in the path or the URL. Default if no decision: D, provisional
(`<Study>/<Series>.sbnd` under it, #162).

**Client-app update path** (with the team and the product owner; §5). Options: through the receiver's queue (one path,
one writer per study DB) or a standard update endpoint coordinated with it. Evidence: one path gives order and a bounded
delay (#165: a correction reaches the index in 57–208 ms), no second writer; the cost is no "instant". Default: one path,
the update API submitting update packages.

**Updates from the PCS** (§5). The owner's first version (10-26 evening, "good enough"): the sender compares hash-named
files with what it last sent (#176's option c), whole changed groups on the wire; (d), a manifest, is the fallback if the
sender must hold no state. The update model proposed 2026-10-27 (§5) adds a small manifest to updates anyway (removals
and previous hashes) and needs the parser to replace or mark a corrected group (§15).

## 17 · Where the records disagree

One line each; none is settled here (a reconciliation by a Proposed PR is a proposal too).

* **A1 · the reply file and its words:** #163 `incoming/status/<f>` `stored`/`refused`/`quarantined`; #164
  `status/<name>` `committed`/`refused retry`/`refused final` (§14, D3).
* **A2 · how long a status lives:** link.md §12.8 q5 against the receiver ADR §6.
* **A3 · "received":** the receiver ADR means the package hash matched; the built carrier means fsynced and renamed
  only.
* **A4 · the header member:** the transfer ADR's ~100 B with kinds `series`/`study`/`delete`/`addition`, against the
  receiver's 5 lines with `series`/`update`. *Reconciled by #177 (as proposed):* #163's 5 lines, `layout 2`, kinds
  `series`/`addition`, `update` reserved, the compression flag dropped.
* **A5 · compression:** per member (#163) against one zstd stream (#149, #156) (§2). *Reconciled by #177 (as
  proposed):* one inner-tar member, one zstd frame; per member is a flaw (Decided 10-26 evening).
* **A6 · after a refusal:** the PCS rebuilds the package (#149), or resends the same bytes. *Reconciled by #177 (as
  proposed):* resend the kept bytes (Decided 10-26 evening), rebuild only when they fail their name.
* **A7 · a differing exam group:** flagged for review (#119), or replaced with an audit record (#163).
* **A8 · updates:** as differences (§5, #148), or as whole-group replacement (#163). *Addressed by #176:* whole groups
  on the PCS's wire, differences after intake (§5).
* **A9 · a package's identity:** (unit, revision) (#149), a sender UUID, or a content digest; open with the owner
  (§14, D12). *Addressed by the §5 proposal (2026-10-27):* none is needed for correctness if apply is item by item.
* **A10 · the audit row's "who":** decided (§4), but nothing carries a "who" to the audit row.
* **A11 · starting the receiver:** nothing starts it.
* **A12 · staging:** the owner's decision 10-26 against "proposed" in this file. *Fixed* in §3.

## 18 · Rows of 2026-10-26 afternoon

* **DAY-1** (`claude/carrier-quic-choice`): the carrier's QUIC dependency, h3 0.0.x or a QUIC implementation used
  directly, not necessarily in Rust (§14, D4). Delivered: #171.
* **DAY-2** (`claude/study-index-engines`): the study index's engine (§14, D9). Delivered: #174.
* **DAY-3** (`claude/study-index-placement`): the study index on a separate server (§14, D9). Delivered: #172.
* **DAY-4** (`claude/viewer-metadata-gz-row`): the ready row stored compressed, the revision as ETag (§14, D6).
  Delivered: #173.
* **DAY-5** (`claude/receiver-process-map`): one program against two, then the reply file's place and lifetime
  (§14, D3). Delivered: #169.
* **DAY-6**: not recorded in this file.
* **DAY-7** (`claude/pacs-receiver-impl`, `claude/verify-tool`): the owed fixes pushed to #163 and #160 (§3, §14 D2
  and D11).
* **DAY-8**: not recorded in this file.

## 19 · Rows of 2026-10-26 night

* **NIGHT2-1** (`claude/rustls-advisories-mainbase`, `claude/rustls-advisories-main`): the rustls advisories seen in
  #171 (0.23.44 pinned; RUSTSEC-2026-0285, -0346 to -0349). Delivered: #183 into `claude/av1-unified-mainbase` and
  #184 into `main`, **merged 2026-10-26/27 night at the owner's request**, CI green: rustls 0.23.46, rustls-webpki
  0.103.16, tokio 1.53.3 (`Cargo.lock` only).
* **NIGHT2-2** (`claude/transport-seam`): the transport seam (TCP, or QUIC at build, §2). Delivered: #182.
* **NIGHT2-3** (pushes to #177): the sender's implementation. Delivered: `ab34536`, `ecbea88` (§2).
* **NIGHT2-4** (pushes to #163 and #160): the receiver's layout 2 and addition merge, and D2's disk-read helper as one
  crate. Delivered: `3471fb9`, `5d0ae2c` on #163, `4d9e4a7` on #160 (§3).
* **NIGHT2-5** (`claude/sbnd-tail-rewrite`): whether only the `.sbnd`'s tail can be rewritten on an addition (§3).
  Delivered: #185. Decided 10-26/27 night: the full rewrite stays, with #185's correction beside it (§3).
