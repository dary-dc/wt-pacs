# ADR: the PACS receiver — one package in, stored or refused

**Status:** proposed 2026-10-26. Steps 1–8, 11 (as a status file), 12, R and crash recovery are **built** in
[`ingest/receiver/`](../../ingest/receiver/), behind no deployment, for layout 2 and its three kinds (*corrected
2026-10-26:* this record first described layout 1, which no sender wrote and which is removed, §2); steps 9 and 10 are interfaces with nothing behind
them (§6). Nothing here is measured: the receiver's cost is §8's to measure.

**What it supersedes.** #119's §12 of `docs/ingest/design.md` ("The PACS receiver and builder", commit `a9c8e3a` on
`claude/pacs-receiver-design`, not on this branch) is replaced whole by this record. What changes is listed in §9.

**Where its decisions come from.** The owner's design sessions of 2026-10-24/25/26, gathered in the design-state record
`docs/ingest/pacs-receive-design.md` (commit `e699ed3` on `claude/pacs-design-state`): its §3 (the receiver), §4 (the
study DB) and §5 (updates). *Decided* below is the owner's, dated; *Proposed* is that record's or #149's best so far,
built here as such; *Open* is not built, or is built behind a field that can change, and says which. The package
format is #149's (`docs/adr/pcs-transfer.md`, commit `a197b23` on `claude/pcs-transfer-design`), narrowed in §2, as its
§15 (#177, commit `a2f8fc1` on `claude/sender-package-build`) changes it to layout 2 for the sender's build.

## 0 · On one screen

| | what | standing |
| --- | --- | --- |
| unit | one package per series, and small packages for updates; its XXH3-64 in its name | Decided 10-25; reopened 10-28 (§1) |
| format | a pax tar of three members: a five-line header, `metadata` (an inner tar of the group files), the bundle; layout 2 (§2) | Proposed (#149 §15), narrowed here |
| compression | the `metadata` member may be one zstd frame, told by its magic number; frames never; the switch is the sender's | Decided 10-26; default on or off Open |
| late instance | an `addition` package, merged into the series' one bundle by a rewrite in staging, read back from disk, renamed over (§5) | Decided 10-26 |
| staging | `incoming/<f>.work/`, on the root's filesystem (checked at start: `EXDEV`) | Decided 10-25 |
| checks | two: the package against its name (3), and every staged file read back **from disk** (6b, 8), by the one helper the verify tool uses too, [`common/from-disk`](../../common/from-disk/) | Decided 10-25; one helper Decided 10-26 |
| durability | `fsync` of every staged file and of each directory a rename changes; "stored" only after | Decided 10-25 |
| placing | one rename per change of the serving tree; a new study is one rename of its whole directory | Proposed |
| metadata | one transaction into the study DB: a table per level, a group's bytes and XXH3 by its coded UID; an audit row per package | Proposed (T1); audit Decided 10-24/25 |
| reply | `incoming/status/<f>`: `stored`, `refused <why>` or `quarantined <why>`; the carrier relays it | Decided 10-24; the carrier is another row |
| refusal | undo what the package wrote, keep it in `refused/`; the same content failing again goes to `quarantine/` | Decided 10-24/25 |
| crash | at start, every `incoming/*.work/` is deleted and every package left is taken again from step 3 | Proposed |
| deletion | the package goes once its status says "stored" | Decided 10-24/25 |
| process map | two programs joined by files, a scan as trigger, the sender read from the carrier's upload line (§10) | Proposed 10-26, not decided |

## 1 · Where the receiver sits

The PCS (the hospital-side component, another team's) packs a complete series into one file and sends it; a carrier
(an HTTPS resumable upload, #155, not built) writes it into `incoming/`; the receiver takes it from there to the serving
tree the server reads, and leaves one line in `incoming/status/` for the carrier to answer with. The PCS keeps its copy
until that line says `stored` (Storage Commitment's model, PS3.4 Annex J), and resends on `refused`.
*Corrected 2026-10-28:* the team meeting of 2026-10-28 reopened rsync of the PCS's tree, a trigger after it marking the unit
complete; one package per transfer is open with the team (the design state, `pacs-receive-design.md`, #168).

```text
 carrier ──▶ incoming/<f>.partial ─rename─▶ incoming/<f> ──▶ receiver ──▶ <root>/<Study>/<Series>.sbnd
                                                                │      └─▶ <root>/<Study>/study.db
 carrier ◀── incoming/status/<f> ◀──────────────────────────────┘
```

`incoming/` and the root are two directories given at start; they must be one filesystem, or the start fails. The
serving tree's shape (`<root>/<Study>/`) is a placeholder for #152's layout, which is Open (§7, question 8).

## 2 · The package, layout 2

*Corrected 2026-10-26:* this section described layout 1 (groups as members of the package, each its own zstd frame or
not, paths under the study's directory). No sender ever wrote it, and pcs-transfer §15.11 (#177) removes it when layout 2
is built; the receiver now reads layout 2 only, and a `layout 1` header is refused.

**Name:** `<unit>.<revision>.<xxh3-64 of the file, 16 lowercase hex>.tar`; the unit is a coded UID (the PCS's coding,
[`../ingest/contract.md`](../ingest/contract.md#the-layout)), so it holds no `.`; the revision is a decimal from 1 with no
leading zero. Identity is (unit, revision); the hash is a check, never a key.

**Three members, in this order, and nothing else** (no links, no `..`, no absolute path, no file twice — refused before
anything is placed):

| member | is |
| --- | --- |
| `package` | the header, at most 4 KiB, exactly five lines (below) |
| `metadata` | a pax tar of the group files, as it is or as one zstd frame (magic `28 B5 2F FD`) |
| `<S>/series.sbnd` | the series' bundle; a series package and an addition only, never an update |

```text
layout 2
kind series            (or: addition, update)
study <coded study UID>
unit <coded series UID, or the study's for a study-level update>
revision <n>
```

**The groups**, inside `metadata`, at paths relative to the exam directory (the study is the header's):

| path | is |
| --- | --- |
| `--.<h>` | the exam group |
| `<S>/---.<h>` | a series group |
| `<S>/<I>/----.<h>` | an instance group |
| `<S>/<I>/priv.<h>` | a private group |

`<h>` is the XXH3-64 of the group as the parser wrote it ([`../ingest/contract.md`](../ingest/contract.md#group-files)),
16 hex. A group is never compressed on its own: one that begins with the zstd magic is refused (a group begins with its
first key's length, 8). The inner tar is bounded at 1 GiB after decompression, a placeholder until the largest series is
measured (pcs-transfer §15.11), which bounds a zstd bomb; a group past 64 MiB is refused before it is read. The names are
the parser's of 2026-10-11 with XXH3 in place of BLAKE3; whether they stay or the PDF's `d/<n>` and `p/` replace them is
#149's question 3 (§7, 2).

**A series package** holds one exam group, one series group of its unit, at least one instance group, private groups
only beside their instance group, and one bundle of its unit. **An addition** holds the same set, its instance groups
those of the late instances only and its bundle their frames only (§5). **An update** holds groups and no bundle: a
study-level update any group of the study, a series-level update only groups of its series and no exam group.

## 3 · The steps, and why each exists

One worker; the same code would run one worker per study. The tests that hold each step are listed with their
mutations in the crate's README (§8).

| step | what the receiver does | why it exists |
| --- | --- | --- |
| 1 arrive | nothing: the carrier writes `<f>.partial` and renames it to `<f>`; a `.partial` is never taken | the package's existence declares it complete (#149); a reader never sees half a file |
| 2 pick up | every complete file in `incoming/`, updates first, then by name | an update is kilobytes and a viewer may be waiting on it; a series is minutes of link |
| 3 check | the file's XXH3-64 against its name | the one check over the bytes as sent: a bad resume splice, a disk fault on either side |
| 4 open | the header, first; its unit and revision against the name; the revision against the study DB; an addition only to a stored study and a stored unit | identity before work: a conflict (another package for a stored revision) or a gap is answered without staging |
| 5 check | the three members in order; every group's path in the layout, its XXH3 against its name and its UID against its path; the set the kind needs | the groups name the objects the pixels belong to; a member outside the layout is untrusted input |
| 6 stage | every group and the bundle written under `incoming/<f>.work/`, each file `fsync`ed | never the serving tree; `fsync` because the read-back that follows must find the bytes on the device, not dirty pages (`DONTNEED` keeps those) |
| 6b verify | each staged file read back from the device ([`common/from-disk`](../../common/from-disk/): `fdatasync`, `posix_fadvise(DONTNEED)`, then the read): the groups re-hashed, the bundle re-hashed against its hash as extracted, opened as v1, its `frameCount` against its index and against the instance groups' Number of Frames, its codec known. An addition then: its exam and series groups against the stored ones, its instances new to the study, and the merge (§5): a new bundle written in the work directory, read back from disk whole and checked as above against every instance of the series | proves what will be served, not what the page cache holds: our write bugs and media errors at write time; a merged bundle is read back whole because every old frame was copied. v1 carries no coded-frame hash, so the per-frame check is the version's to add; a v2 bundle is refused by the reader until it is |
| 6c place | a new study: its staged directory (bundle + a study DB with its schema) renamed into the root, the root `fsync`ed; a stored study: the bundle (an addition's: the merged one) renamed over its place, the replaced one kept as a hard link in the work directory, the study directory `fsync`ed | a rename is atomic for every reader at once; it survives a power cut only once the directory is flushed |
| 7 record | one transaction into the study DB (WAL, `synchronous=FULL`): a series package replaces its series' rows whole and upserts the exam group; an addition inserts its instance and private groups; an update replaces rows that exist; one audit row | the rows change together or not at all; pixels are placed before the rows that describe them, so no row describes a bundle that is not there |
| 8 verify | the study DB's pages dropped (the file and its WAL, by `common/from-disk`), a new connection, `PRAGMA integrity_check`, every written row re-read and re-hashed, every removed row absent | as 6b, for the metadata |
| 9 derive | `Downstream::derive`, nothing behind it | Open (§6) |
| 10 index | `Downstream::index`, nothing behind it; its failure never undoes 6–9 | Open (§6) |
| 11 confirm | `incoming/status/<f>` written by `.partial`, `fsync`, rename, directory `fsync` | "stored" is a promise the PCS acts on by deleting its copy; it is made only after 8 |
| 12 clean | the package deleted, any refused copy of it deleted, `incoming/` `fsync`ed | the hospital keeps the originals; the PACS keeps what it serves |

**R, a refusal,** at any step from 3 to 8: rows rolled back (before the commit) or restored to their prior values and
the audit row removed (after it, a failed step 8); the placed bundle put back from its hard link, or removed, or a
new study's directory removed; the work directory deleted. The status says `refused <why>`, and the package moves to
`incoming/refused/`. A resend has the same name, so the same content: if a package fails while `refused/` holds its
name, it goes to `incoming/quarantine/` and the status says `quarantined <why>` — a bug or a fault, not the network,
for an operator. A conflict (another package for a stored (unit, revision)) goes straight to quarantine (#149 §4).

**Idempotent.** The latest stored revision sent again is run again whole, its transaction a no-op, and answered
`stored`: a crash after step 7 but before 8 is then verified on the restart. An older stored revision is answered
`stored` without being staged, so it never puts old pixels over newer ones. A revision is accepted only as the next
of its unit (1 for a unit not seen); a later one is refused until its predecessor is stored.

**Crash.** At start the receiver takes `incoming/` alone (an exclusive lock), deletes every `*.work/` and every partial
status, and `run` takes every package left from step 3. Partial state only ever sits in `incoming/`. The crash test
kills the process after each of the eight points between steps, in four cases (a new study, a series' next revision,
an update, an addition in the middle of its series), and checks at the kill that the bundle served is the old or the new one, the rows all old or all new, and
new rows never beside the old bundle; then that a restart ends where an uninterrupted run ends.

**What a crash can still leave.** Between 6c and 7 of a series' next revision the new bundle is served with the old
rows (pixels before metadata, by design); #142's `?digest=` pairing is what keeps a viewer from mixing them. A crash
inside that window followed, on the restart, by a failure at 7 or 8 puts back the bundle the restart found, which is
the new one; the rows stay old. Neither is tested beyond the kill points.

## 4 · The study DB

One SQLite file per study, `study.db` beside the study's bundles, never served to a client. Four tables of the same
shape, `exam`, `series`, `instance`, `private`: `uid` (the coded UID, primary key), `series` (the group's series; NULL
for the exam group), `xxh3` (16 hex), `bytes` (the group as the parser wrote it); the level is the table, since the
coded UID does not carry it. `audit`: when, the package's name, kind, unit, revision and hash, and one line per row
changed (`<level> <uid> <old hash or -> <new hash or ->`); (unit, revision) is unique, which is what step 4 reads.
Engine: rusqlite 0.41 with SQLite bundled, as the design state's §4 chose (#147, #151); WAL so a reader never waits on
the writer, until #157 reports how two processes collide (Open).

**Prior values are not kept** (Decided 10-24/25: an update replaces the row, no history); the audit names the hashes,
not the bytes. A refused package leaves no audit row: a new study's refusal has no study DB to hold one, so refusals are
the status files' and the operator's.

## 5 · Updates and additions

### Updates

Built: **whole group replacement at the level that changed** (#149 §8) — an update package carries the new group files,
each replacing a row that exists, in one transaction with its audit row; a row that does not exist, or that belongs to
another series than the path says, refuses the package. Revision order per unit catches a lost or reordered update.
**Not built:** #148's attribute-level differences (`set`/`remove` by DECK key) and per-group base hashes (`If-Match`):
the design state calls the update "likely as differences" and #148 proposes them; that would be a third kind, after
the owner's answer (§7, 4). The update API in front of client applications (#148, Open for the team) is not this
crate's: it would submit packages like any sender.

### Additions (Decided 10-26, built)

A late instance, one arriving after its series was stored, comes as an `addition` package (pcs-transfer §15.2) and is
merged into the series' one `.sbnd`; the format is unchanged (`docs/disk-layout/target.md` §A late instance, commit
`bc2a610` on `claude/sbnd-late-frames`, #175: keep the rewrite and rename). This supersedes, for additions, the 10-24/25 rule that the PACS does no repacking.

* **What it must be.** The next revision of a stored unit; its exam and series groups the stored ones, byte for byte
  (a change to either is an update's); every instance new to the study; its bundle the added instances' frames, in
  their display order, with the series' frame attributes (every key of the bundle's metadata but `frameCount`, `min`,
  `max` and `digests` equal to the served bundle's).
* **The merge**, inside step 6b: every instance of the series, stored and added, in **display order: Instance Number
  (0020,0013), then the coded UID**, an instance without a number after every numbered one; each instance's frames
  taken as a run from the bundle that holds them, the served bundle's runs in the same order. A new `.sbnd` is written in
  the work directory with the metadata's count, range (`min`, `max`) and per-frame digests merged in the same order,
  `fsync`ed, read back from disk whole, then placed by 6c's rename. An open session keeps the old file (its inode); a
  new one gets the merged file.
* **The cost**, accepted by the owner: the series read once and written once, and read back from disk once, per merge;
  a second copy of it on disk until the old one's last reader closes. Not measured (target.md §A late instance lists how).
* **A restart after 6c and before 7** finds the merged bundle served and the rows without the addition. The served
  bundle then holds the stored instances' frames plus the addition's, which the merge recognises by the count and
  rewrites to the same file; a resend of the stored addition does the same. The crash test holds both.

What it assumes and does not check: that a series package's bundle is in that display order already. The receiver has
no per-frame instance in v1 to check it by (§7, 11).

### Item by item (Proposed, not built)

**Proposed, awaiting the owner's confirmation; not decided.** The model is metadata-updates §14 (#176, on
`claude/update-flow`); the sender's manifest is pcs-transfer §15.13 (#177, on `claude/sender-package-build`). The
receiver would apply each item of a package (the exam group, the series group, an instance's groups) in the one
transaction of step 7:

| the manifest says | current row | the receiver |
| --- | --- | --- |
| nothing (a new item) | none | creates it (a new study or series, as now) |
| | equal to the package's | a duplicate: nothing |
| `replaces <path> <previous>` | equal to `<previous>` | replaces it, with an audit line |
| | equal to the package's | a duplicate: nothing |
| `removes <path>` | equal to the path's hash | removes it, with an audit line |
| | none | a duplicate: nothing |
| any of the above | anything else | stale: the whole package refused `final` |

New instances' frames are merged into the `.sbnd` as an addition's are (above). A package that changes nothing is
answered `stored` with no audit row, so a resend needs no counter: the revision order of §7, 5 would go, the revision
left a label in the name. *Would change:* §5's update refusing a row that does not exist, the addition's rule that
the exam and series groups match byte for byte, step 4's (unit, revision) check and step 5's three members. Whether
a removed instance's frames are rewritten out of the `.sbnd` or only hidden is not settled here.

## 6 · What is stubbed, and why

| step | interface | why not built |
| --- | --- | --- |
| 9 derive | `Downstream::derive(&Stored)` | what is derived and where (display metadata, a file per series or a query) is Open, design state §6 |
| 10 index | `Downstream::index(&Stored)` | the study index (#146) is Open: its engine, on which host, its outbox (*corrected 2026-10-28:* this said MySQL, which was never chosen) |
| 11 relay | the status file | the carrier (#155) is another row: it maps `stored` / `refused` / `quarantined` to its replies and deletes the status file once relayed |

`Stored` names the study, the unit, the revision, the kind, the groups written and the bundle placed. `Downstream`
returns nothing: each implementation retries and reports its own failures (an outbox, design state §7), because a
failure there must never undo what is stored.

## 7 · Questions only the owner can answer, each with the default built

1. **Group names' hash:** XXH3-64, 16 hex, like the package's — or XXH3-128? *Default: 64.*
2. **Layout 1's names:** the parser's `--`, `---`, `----`, `priv`, plus `series.sbnd` and the five-line header — or the
   PDF's `d/<n>` and `p/`? *Default: the parser's; `layout` in the header switches.*
3. **One zstd stream** for a series' metadata (#156's 3–31×) as a layout-2 member, or per member only? **Decided
   10-26:** one stream, the `metadata` member (§2); layout 1 is removed.
4. **Differences** (#148) as a third kind, or whole groups only? *Default: whole groups.*
5. **Revisions:** one counter per unit, the series' shared by its full resends and its metadata updates, strictly n+1?
   *Default: yes.*
6. **A series package whose exam group differs** from the stored one replaces it, audited (#149's rule) — or is refused?
   *Default: replaces.*
7. **Who, in the audit:** the package names no sender; the carrier knows the client certificate. *Default: the
   carrier passes it to the receiver when it is built; the audit row gets a `sender` column then.*
8. **The serving tree:** `<root>/<Study>/<Series>.sbnd` and `<root>/<Study>/study.db` until #152 is decided at the
   team meeting? *Default: yes; one function builds the path.*
9. **A refusal caused by the receiver's own fault** (a full disk) counts toward quarantine like any other. *Default:
   yes; the operator sees it.*
10. **Status files** are the carrier's to delete after relaying. *Default: yes.*
11. **Display order** within a series: Instance Number, then the UID, and the PCS's bundle written in it? The merge of an
    addition depends on it (§5). *Default: yes; the PCS team to confirm.*

## 8 · Tests, and the mutations that hold them

`cargo test -p pacs-receiver` runs 48 tests (`scripts/gate.sh` runs them; *corrected 2026-10-26:* this said 40 where
the suite ran 42); the crash test alone kills a child process at 32 points. "From disk" is observed, not assumed: a test reads `read_bytes` of `/proc/thread-self/io` (bytes this
thread had read from the device) across the read-back and the study DB's verification, after the write that cached
them.

**Mutation-checked:** each check and step of §3 was broken on purpose, one at a time, and the suite run: 99
mutations (77 for layout 1, 10 of them retired with it, then 32 for layout 2, the addition and the shared read-back),
every one failed a test. The list, each with the test that failed it, is in [`../../ingest/receiver/README.md`](../../ingest/receiver/README.md#mutations).

**Not testable here, and so not claimed:** that the `fsync`s make a placement survive a power cut (a kill does not lose
the page cache; only a power cut does); and anything about cost — the receiver's time per package, which §3's "≈ 1 s
for 500 MB on an SSD" estimates, is not measured.

## 9 · What this changes in #119's §12

| §12 said | now |
| --- | --- |
| two files and a commit per series (§12.2), or one tar | one package, one file, its hash in its name |
| BLAKE3 group hashes; an archive identity over them | XXH3-64 in the names; identity (unit, revision), the hash a check |
| checks on arrival, no read-back (§12.3) | two checks, the second from disk after `fsync` and `DONTNEED` |
| received groups kept as an append-only `inputs/` list (§12.4) | not kept: the rows are the groups; the PCS keeps the originals |
| a builder writing revision directories and `CURRENT` (§12.5) | one transaction in place; no revision directories, no `CURRENT` |
| a `pending/` list between receiver and builder (§12.6) | one receiver; `incoming/` is the only queue, and the only place partial state lives |
| "accepted" / "refused" answered by the receiver | a status file the carrier relays; `quarantined` added |
| the package kept | deleted once its status says "stored" |

## 10 · One program or two: the process map

**Status: Proposed 2026-10-26, not decided.** The owner asked on 2026-10-26 that the reply file's location "be
analyzed"; this section compares the process maps that decide it. Nothing in it is measured; each *inference* is
marked. It changes no code.

### 10.1 What was built, and what does not fit

The carrier (#164, `docs/ingest/link.md` §12 and `carrier/src/handoff.rs`, commit `9bb1c53` on `claude/pcs-carrier-impl`) and
this receiver (#163) were built in parallel as two programs joined by files: the carrier writes `incoming/<name>.partial`
and renames it to `incoming/<name>`; the receiver answers with a one-line file. No record compared alternatives.
What shows:

| | carrier (#164) | receiver (#163) |
| --- | --- | --- |
| reply file | `<root>/status/<name>` (`Root::status`) | `incoming/status/<f>` (§3 step 11) |
| words | `committed`, `refused retry <why>`, `refused final <why>` | `stored`, `refused <why>`, `quarantined <why>` |
| reply's lifetime | kept for good: "it is what answers a late duplicate" (link.md §12.8 q5) | the carrier's to delete once relayed (§6, §7 q10) |
| who | knows the site, from the pinned client certificate (link.md §12.3), and writes it to `uploads/<unit>/<revision>` | the audit row has no sender (§7 q7; design state §3 "Owed") |
| start | a long-running listener | `main.rs` recovers, takes `incoming/` once, and exits: nothing starts it again |

The owner decided (2026-10-24/25, design state §3) that the PCS keeps each package until `stored` and resends on
`refused`, and the word `stored`. The design state's D3 (§14) defaults to the receiver's file and words.

### 10.2 Theory first: what the process map can and cannot change

**What every option keeps.** `stored` is a promise the PCS acts on by deleting its copy, so it is said only once it is
on disk (§3 step 11). A crash is recovered by taking every package left in `incoming/` again from step 3 (§3 Crash).
*Inference:* so whatever the receiver needs to know about a package — its bytes, and its sender if the audit is to name
one — must be on disk beside it before the package is complete, **whatever the process map**; anything handed over only
in memory is lost by the crash the recovery exists for. Files stay the record in all three options. What the map
decides is the rest:

1. **the trigger:** how the receiver learns a package is complete;
2. **who may write what:** which code holds write access to the serving tree;
3. **what restarts together**, and how each part is tested.

**Two kinds of untrusted input, in two places.** The carrier parses the network: TLS, HTTP, the upload's framing; it
"never opens a package" (link.md §12.6). The receiver parses the package: a tar, zstd frames, groups that become
SQLite rows, a bundle's header. Both reach C code (rustls's `ring`; the `zstd` crate binds libzstd, rusqlite bundles
SQLite). Their write needs differ: the carrier needs `incoming/` and `uploads/`, and reads the reply; the receiver
needs the serving tree, the study DBs and the reply, and no network. That difference is what privilege separation is
for: "a generic approach that lets parts of an application run with different levels of privilege … Programming
errors occurring in the unprivileged parts can no longer be abused to gain unauthorized privileges" (Provos, Friedl,
Honeyman 2003).

### 10.3 Prior art

| system | what it does | what it says here |
| --- | --- | --- |
| **Postfix** | separate daemons, files as the queue: postdrop puts local mail in the maildrop queue; "the pickup(8) daemon waits for hints that new mail has been dropped into the maildrop directory"; cleanup(8) "places the result as a single file into the incoming queue, and notifies the queue manager" (OVERVIEW); pickup "runs with fixed low privilege and can run in a chrooted environment … reads files from potentially hostile users … opens no files for writing" (pickup(8)) | a file as the record, a wake-up as a **hint**, a reader of hostile files kept at low privilege: (a) with a trigger |
| **OpenSSH** | a privileged monitor and unprivileged children: "An unprivileged slave processes all network communication" (Provos et al., fig. 4); since 7.5 the option is gone, "thereby making privilege separation mandatory" (release notes 7.5) | the network-facing part should not hold the privileges the rest needs |
| **Maildir** | write to `tmp/`, rename into `new/`; readers ignore `tmp/`; designed for "eliminating the need for program code to handle file locking" (Bernstein's maildir(5), as quoted by its Wikipedia article) | exactly our `.partial` → rename; the hand-off by files is the well-trodden part |
| **Orthanc** | one server; the DICOM files in a storage area, an SQLite index "accessed either through the REST API of Orthanc or through the DICOM protocol"; "one SQLite database should be accessed by at most one process at any time" (Orthanc Book, storage FAQ) | one program receiving and serving is the common PACS shape; *inference:* it buys simplicity with one trust domain for the network and the store |
| **dcm4chee-arc** | "a Java EE application for DICOM medical archive, running in WildFly" (its wiki) | the other common shape: one application server for every service |
| **systemd.path(5)** | starts a unit when a path condition holds (`DirectoryNotEmpty=`, `PathChanged=`, …); "monitored paths are checked immediately again" when the service ends, and the service "restarted instantly"; trigger limit 200 per 2 s by default; it has inotify's limits | a trigger for a run-once receiver, where systemd runs it |
| **inotify(7)** | `IN_MOVED_TO` for a rename into a watched directory; "the event queue can overflow. In this case, events are lost … Robust applications should handle the possibility of lost events" | a hint, never the record: a scan stays the truth |

### 10.4 The options

#### (a) Two programs joined by files, as built, plus a trigger

**Reply:** the status file, one vocabulary defined once in a module both link (today only the carrier has it).
**Who:** already on disk. The carrier writes `uploads/<unit>/<revision>` = `<hash> <site> <token> <length>` durably
(`write_durably`) when the upload is created, before completion renames the package into `incoming/` (`upload.rs`).
The receiver reads it, checks its hash against the package's name, and writes the site into the audit row; a package
with no such line (one an operator placed) records `-`. No new file, no new write: the line moves from "the carrier's
own" into the hand-off contract, read-only for the receiver. A sidecar `incoming/<name>.site` or a directory per site
would carry the same fact with a write more.
**Trigger,** five ways:

| trigger | how | against it |
| --- | --- | --- |
| a scan every few seconds | `main.rs` becomes a loop: recover once, then `run`, sleep, `run` | latency up to the interval. *Inference:* the PCS polls every `POLL_SECS` (10 s, link.md §12.5) and a series is minutes of link, so a 2 s scan is not what the PCS waits on; a `readdir` of a small directory each 2 s is negligible (not measured) |
| inotify(7) in the receiver | `IN_MOVED_TO` on `incoming/` wakes the loop | events can be lost, so the scan stays as backstop: two mechanisms where one suffices unless latency matters |
| systemd.path(5) | a path unit starts the run-once receiver; re-checked when it exits | `DirectoryNotEmpty=` never clears: `incoming/` always holds `status/`, `refused/`, `quarantine/`, `.lock` and `.partial` files; `PathChanged=` fires on the receiver's own moves too and on every partial. *Inference:* it works only with a directory that holds complete packages alone, and only where systemd runs the receiver — `deploy/` runs containers under compose, where it does not |
| a signal | the carrier sends `SIGUSR1` after a completion | kill(2) needs the same user ID or `CAP_KILL`, which undoes the separate users this option is for; the carrier must also find the PID |
| a local socket or FIFO | the carrier writes a byte (Postfix's hint) | a second interface and its permissions, for the latency the scan already gives |

**Crash and recovery:** each program recovers alone from the files, as built and tested (§3 Crash; link.md §12.1:
the offset is the partial file's length, so a restarted carrier keeps every upload). **Isolation:** two users; the
carrier with no write access to the serving tree, the receiver with no network (its own seccomp profile, as the viewer
server already has one in `deploy/`). *Inference:* a TLS or HTTP bug then reaches `incoming/`, not the store; a tar or
zstd bug reaches the store but no socket. **Testability:** each is tested alone against the files — the carrier's
`tests/pcs.rs` already drives a stand-in receiver that follows §12.2. **Operations:** two units; the receiver is
restarted or upgraded without dropping an upload. **Cost:** one process more; not measured, *inference:* megabytes.

#### (b) One program, carrier and receiver as tasks in one process, files kept as the record

**Reply:** the status file still — the PCS polls by `GET` every 10 s, so an in-memory answer saves no round trip, and
a restart or a refused new study (no study DB, so no audit row, §4) needs it on disk. **Who:** could be passed in
memory, but recovery must read it from disk (§10.2), so the disk path exists anyway and the memory path is a second
one. **Trigger:** a channel from the upload's completion to the receiver's thread, plus the scan at start: the one
real simplification. The receiver's work is blocking and `fsync`-bound, so it runs on its own thread beside the async
listeners. **Isolation:** lost. One address space holds the TLS private key, parses the network and the packages, and
has write access to every bundle and study DB; seccomp filters attach per thread but the memory is shared, so
*inference:* no filter separates them. **Crash:** the same files, the same recovery; a panic in either part restarts
both. **Operations:** one unit; upgrading the receiver drops the uploads in flight, which resume from their offset (a
reconnect each). **Testability:** both in one test, but the files remain the interface the tests must check. **Cost:**
one process fewer. Note: the owner's 2026-10-25/26 preference for "one application handler … preferred over two
separate programs" (design state §2) was about the carrier's TCP and QUIC listeners, not about the receiver.

#### (c) Two programs joined by a local socket or a queue

**Reply and who** over the socket, synchronously. *Inference:* the crash argument (§10.2) still puts both on disk, so
the socket carries a copy of what the files hold, with a reconnect protocol and a reply lost if the receiver restarts
mid-answer; the files and the socket must then agree. A queue (a broker, or a table) is a dependency to run for what a
directory already is. Postfix's sockets carry requests between daemons that each own their files; they do not replace
the queue files. **Isolation, crash, operations:** as (a). **Simplicity:** below (a): a protocol more. Kept only as a
trigger, it is (a).

#### Where the viewer server sits

It already is its own process: its own container, user 10001, the studies mounted read-only (`deploy/compose.yml`,
`deploy/README.md`). It faces browsers, so it stays apart from both under every option. Under the owner's option for
viewer metadata (design state §6, D6) it opens study DBs, open-read-close, while the receiver writes them. SQLite reads
a WAL database without write permission only if "the -shm and -wal files already exist and are readable", the
directory lets them be created, or the connection is `immutable` (SQLite, *Write-Ahead Logging*, since 3.22.0).
*Inference, to test under #157:* the receiver closes its connection after each package, and SQLite then normally
removes the `-wal` and `-shm` files, so a viewer on a read-only mount could fail to open a study DB at rest; `immutable`
is wrong for a file that changes. Either the receiver keeps those files (a persistent WAL) or the viewer's mount gives
it write access to the study directories. The process map does not change this; the mount does.

```text
 PCS ─mTLS─▶ carrier   (user A, network; writes incoming/, uploads/; reads status/)
               │ files: incoming/<name>, uploads/<unit>/<revision>
               ▼
             receiver  (user B, no network; writes the root, status/; moves packages out of incoming/)
               │ files: <root>/<Study>/
               ▼
 browser ─WT─▶ viewer server (user 10001, root read-only) · nginx (root read-only)
```

*Inference:* the receiver deletes and moves packages, so it needs write access to `incoming/` as the carrier does — a
shared group on that directory, without the sticky bit (which would stop B removing A's files).

### 10.5 The reply: where it lives, and how long

**Where.** One directory, written by the receiver alone, read by the carrier. Under (a) and (c) the directory's mode is
the permission boundary, so it belongs outside `incoming/`, which both users write: `<root>/status/<name>`, the
carrier's path, owned by the receiver's user and readable by the carrier's. Under (b) the place is free; the same one
serves. *This differs from D3's default (the receiver's `incoming/status/`) in the place only, not the words.*

**How long**, three choices, the same under every option:

| lifetime | for | against |
| --- | --- | --- |
| deleted once relayed (§7 q10) | nothing accumulates | "relayed" cannot be observed: the carrier knows it wrote a response, not that the PCS read it. A response lost on a dropped link leaves the PCS polling a package the carrier holds as received in `uploads/` with no verdict and nothing in `incoming/`: by §12.2's table it answers `received` until the script gives up (`WAIT_SECS`, 86 400 s, exit 4). And the carrier deleting the receiver's file breaks one writer per file |
| for good (link.md §12.8 q5) | always answers a late duplicate at once | one file per package for ever, the stored ones repeating the audit row; growth not measured |
| a fixed time, then removed by its writer | bounded; one writer | after it, a late duplicate is uploaded again |

**A late duplicate is answered from the audit row.** The receiver is idempotent (§3): the latest stored revision is run
again with a no-op transaction and answered `stored`; an older one is answered `stored` without staging; a different
hash is a conflict. So once the status is gone, the right answer still comes — from the study DB's audit row, by the
receiver, at the cost of the package's upload. *Inference:* that needs one rule in the carrier: a revision whose
package is neither partial, nor in `incoming/`, nor judged is unknown, so its own `uploads/<unit>/<revision>` line is
cleared and the upload starts. Under (b) the carrier could ask the audit row directly, but a package's name has no
study and the audit row is per study, so it would need a unit-to-study index that does not exist.

*Recommended:* a fixed time at least the PCS's longest wait for a verdict (`WAIT_SECS`), removed by the receiver at its
scan; the number is the owner's.

### 10.6 On one screen

| criterion | (a) two programs, files, a scan | (b) one process | (c) two programs, a socket |
| --- | --- | --- | --- |
| crash safety and recovery | built and tested, each alone | the same files; a crash of either stops both | the files plus a socket to reconcile |
| isolation | two users, the network away from the store | none: one address space | as (a) |
| simplicity | built; a loop and a read of one existing line more | a channel less, a thread and a shared runtime more | a protocol more |
| testability | each against the files; the carrier's stand-in exists | one test for both; the files still checked | each, plus the protocol |
| operations | two units; restarting one drops nothing | one unit; an upgrade drops uploads (they resume) | two units, and the socket's lifetime |
| resource cost | one process more (not measured) | least | as (a) |

**Verdicts.** (a) fits: the files were going to stay the record anyway, and it keeps the network away from the store
for a loop and one line of reading. (b) saves the trigger and loses the isolation the record cannot buy back. (c)
duplicates the files.

### 10.7 What D3 becomes under (a)

1. **One hand-off contract, linked by both:** names, paths and words in one small module neither program owns (today
   `carrier/src/handoff.rs`, which the receiver does not link).
2. **The words are the receiver's:** `stored`, `refused <why>`, `quarantined <why>` (D3's default; the carrier maps
   `refused` to its resend and `quarantined` to an operator's, as `refused retry` and `refused final` today).
3. **The place is the carrier's:** `<root>/status/<name>`, written only by the receiver.
4. **The lifetime is a fixed time,** removed by the receiver; §7 q10's "the carrier deletes" and link.md §12.8 q5's
   "for good" both change; a late duplicate is answered from the audit row (§10.5).
5. **Who:** `uploads/<unit>/<revision>` joins the contract; the receiver reads its site into an audit `sender` column
   (§7 q7's default, made concrete).
6. **The trigger:** the receiver becomes a loop with a scan every few seconds, its own user, no network.

### 10.8 Questions only the owner can answer, each with a default

1. **Two programs or one?** *Default: two (a).*
2. **The trigger:** a scan every few seconds, or inotify for less latency? *Default: a scan; inotify only if a
   measurement shows the interval matters.*
3. **The reply's place:** `<root>/status/` (outside `incoming/`) — or `incoming/status/` as D3 defaults? *Default:
   `<root>/status/`.*
4. **The reply's lifetime:** how long? *Default: a fixed time at least `WAIT_SECS`; the number is yours.*
5. **The viewer server's mount** of study DBs: read-only with a persistent WAL, or write access to the study
   directories? *Default: decided with #157's answer.*

### 10.9 Sources

* Provos, Friedl, Honeyman, "Preventing Privilege Escalation", USENIX Security 2003 (abstract, §3, figure 4).
* OpenSSH 7.5 release notes, 2017: `UsePrivilegeSeparation` deprecated.
* Postfix, *Postfix architecture overview* (`OVERVIEW.html`) and pickup(8).
* D. J. Bernstein, maildir(5), via Wikipedia's *Maildir*.
* Orthanc Book, *How does Orthanc store its database?* (storage FAQ).
* dcm4chee-arc-light wiki, front page.
* systemd.path(5); inotify(7); kill(2); seccomp(2).
* SQLite, *Write-Ahead Logging*, §"Read-Only Databases".
