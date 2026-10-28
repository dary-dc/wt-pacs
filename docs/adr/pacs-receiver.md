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
