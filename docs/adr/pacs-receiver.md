# ADR: the PACS receiver — one package in, stored or refused

**Status:** proposed 2026-10-26. Steps 1–8, 11 (as a status file), 12, R and crash recovery are **built** in
[`ingest/receiver/`](../../ingest/receiver/), behind no deployment; steps 9 and 10 are interfaces with nothing behind
them (§6). Nothing here is measured: the receiver's cost is §8's to measure.

**What it supersedes.** #119's §12 of `docs/ingest/design.md` ("The PACS receiver and builder", commit `a9c8e3a` on
`claude/pacs-receiver-design`, not on this branch) is replaced whole by this record. What changes is listed in §9.

**Where its decisions come from.** The owner's design sessions of 2026-10-24/25/26, gathered in the design-state record
`docs/ingest/pacs-receive-design.md` (commit `e699ed3` on `claude/pacs-design-state`): its §3 (the receiver), §4 (the
study DB) and §5 (updates). *Decided* below is the owner's, dated; *Proposed* is that record's or #149's best so far,
built here as such; *Open* is not built, or is built behind a field that can change, and says which. The package
format is #149's (`docs/adr/pcs-transfer.md`, commit `a197b23` on `claude/pcs-transfer-design`), narrowed in §2.

## 0 · On one screen

| | what | standing |
| --- | --- | --- |
| unit | one package per series, and small packages for updates; its XXH3-64 in its name | Decided 10-25 |
| format | a pax tar: a five-line header member first, then the group files and the bundle, layout 1 (§2) | Proposed (#149), narrowed here |
| compression | any group member may be one zstd frame, told by its magic number; the switch is the sender's | Decided 10-26; default on or off Open |
| staging | `incoming/<f>.work/`, on the root's filesystem (checked at start: `EXDEV`) | Decided 10-25 |
| checks | two: the package against its name (3), and every staged file read back **from disk** (6b, 8) | Decided 10-25 |
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

```text
 carrier ──▶ incoming/<f>.partial ─rename─▶ incoming/<f> ──▶ receiver ──▶ <root>/<Study>/<Series>.sbnd
                                                                │      └─▶ <root>/<Study>/study.db
 carrier ◀── incoming/status/<f> ◀──────────────────────────────┘
```

`incoming/` and the root are two directories given at start; they must be one filesystem, or the start fails. The
serving tree's shape (`<root>/<Study>/`) is a placeholder for #152's layout, which is Open (§7, question 8).

## 2 · The package, layout 1

**Name:** `<unit>.<revision>.<xxh3-64 of the file, 16 lowercase hex>.tar`; the unit is a coded UID (the PCS's coding,
[`../ingest/contract.md`](../ingest/contract.md#the-layout)), so it holds no `.`; the revision is a decimal from 1 with no
leading zero. Identity is (unit, revision); the hash is a check, never a key.

**Header member**, first, named `package`, at most 4 KiB, exactly five lines:

```text
layout 1
kind series            (or: update)
study <coded study UID>
unit <coded series UID, or the study's for a study-level update>
revision <n>
```

**Members**, every other one a regular file at a path the layout names, and nothing else (no links, no `..`, no
absolute path, no file twice — refused before anything is placed):

| member | is |
| --- | --- |
| `<E>/--.<h>` | the exam group |
| `<E>/<S>/---.<h>` | a series group |
| `<E>/<S>/<I>/----.<h>` | an instance group |
| `<E>/<S>/<I>/priv.<h>` | a private group |
| `<E>/<S>/series.sbnd` | the series' bundle, series packages only |

`<h>` is the XXH3-64 of the group as the parser wrote it ([`../ingest/contract.md`](../ingest/contract.md#group-files)),
16 hex, after decompression when the member is a zstd frame (magic `28 B5 2F FD`). A decompressed group past 64 MiB is
refused, which bounds a zstd bomb, not real data (groups are kilobytes). The names are the parser's of 2026-10-11 with
XXH3 in place of BLAKE3; whether layout 1 keeps them or the PDF's `d/<n>` and `p/` is #149's question 3 (§7, 2).

**A series package** holds one exam group, one series group of its unit, at least one instance group, private groups
only beside their instance group, and one bundle of its unit. **An update** holds groups and no bundle: a study-level
update any group of the study, a series-level update only groups of its series and no exam group.

**Compression per member, not one stream.** #156 measured one zstd stream over a series' metadata at 3–31× and a file
alone at 1.6–3.2×; the receiver reads members one at a time, so one stream would be one member holding an inner tar.
It is not built: layout 1 is per member, and a stream member is a layout-2 change on both ends (§7, 3).

## 3 · The steps, and why each exists

One worker; the same code would run one worker per study. The tests that hold each step are listed with their
mutations in the crate's README (§8).

| step | what the receiver does | why it exists |
| --- | --- | --- |
| 1 arrive | nothing: the carrier writes `<f>.partial` and renames it to `<f>`; a `.partial` is never taken | the package's existence declares it complete (#149); a reader never sees half a file |
| 2 pick up | every complete file in `incoming/`, updates first, then by name | an update is kilobytes and a viewer may be waiting on it; a series is minutes of link |
| 3 check | the file's XXH3-64 against its name | the one check over the bytes as sent: a bad resume splice, a disk fault on either side |
| 4 open | the header, first; its unit and revision against the name; the revision against the study DB | identity before work: a conflict (another package for a stored revision) or a gap is answered without staging |
| 5 check | every member's path in the layout; every group's XXH3 against its name and its UID against its path; the set the kind needs | the groups name the objects the pixels belong to; a member outside the layout is untrusted input |
| 6 stage | every member written under `incoming/<f>.work/`, each file `fsync`ed | never the serving tree; `fsync` because the read-back that follows must find the bytes on the device, not dirty pages (`DONTNEED` keeps those) |
| 6b verify | each staged file's pages dropped (`posix_fadvise(DONTNEED)`), then read back: the groups re-hashed, the bundle re-hashed against its hash as extracted, opened as v1, its `frameCount` against its index and against the instance groups' Number of Frames, its codec known | proves what will be served, not what the page cache holds: our write bugs and media errors at write time. v1 carries no coded-frame hash, so the per-frame check is the version's to add; a v2 bundle is refused by the reader until it is |
| 6c place | a new study: its staged directory (bundle + a study DB with its schema) renamed into the root, the root `fsync`ed; a stored study: the bundle renamed over its place, the replaced one kept as a hard link in the work directory, the study directory `fsync`ed | a rename is atomic for every reader at once; it survives a power cut only once the directory is flushed |
| 7 record | one transaction into the study DB (WAL, `synchronous=FULL`): a series package replaces its series' rows whole and upserts the exam group; an update replaces rows that exist; one audit row | the rows change together or not at all; pixels are placed before the rows that describe them, so no row describes a bundle that is not there |
| 8 verify | the study DB's pages dropped (the file and its WAL), a new connection, `PRAGMA integrity_check`, every written row re-read and re-hashed, every removed row absent | as 6b, for the metadata |
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
kills the process after each of the eight points between steps, in three cases (a new study, a series' next revision,
an update), and checks at the kill that the bundle served is the old or the new one, the rows all old or all new, and
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

## 5 · Updates

Built: **whole group replacement at the level that changed** (#149 §8) — an update package carries the new group files,
each replacing a row that exists, in one transaction with its audit row; a row that does not exist, or that belongs to
another series than the path says, refuses the package. Revision order per unit catches a lost or reordered update.
**Not built:** #148's attribute-level differences (`set`/`remove` by DECK key) and per-group base hashes (`If-Match`):
the design state calls the update "likely as differences" and #148 proposes them; that would be a third kind, after
the owner's answer (§7, 4). The update API in front of client applications (#148, Open for the team) is not this
crate's: it would submit packages like any sender.

## 6 · What is stubbed, and why

| step | interface | why not built |
| --- | --- | --- |
| 9 derive | `Downstream::derive(&Stored)` | what is derived and where (display metadata, a file per series or a query) is Open, design state §6 |
| 10 index | `Downstream::index(&Stored)` | the study index (#146) is Open: MySQL, on which host, its outbox |
| 11 relay | the status file | the carrier (#155) is another row: it maps `stored` / `refused` / `quarantined` to its replies and deletes the status file once relayed |

`Stored` names the study, the unit, the revision, the kind, the groups written and the bundle placed. `Downstream`
returns nothing: each implementation retries and reports its own failures (an outbox, design state §7), because a
failure there must never undo what is stored.

## 7 · Questions only the owner can answer, each with the default built

1. **Group names' hash:** XXH3-64, 16 hex, like the package's — or XXH3-128? *Default: 64.*
2. **Layout 1's names:** the parser's `--`, `---`, `----`, `priv`, plus `series.sbnd` and the five-line header — or the
   PDF's `d/<n>` and `p/`? *Default: the parser's; `layout` in the header switches.*
3. **One zstd stream** for a series' metadata (#156's 3–31×) as a layout-2 member, or per member only? *Default: per
   member now; one stream when the PCS's sender is built.*
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

## 8 · Tests, and the mutations that hold them

`cargo test -p pacs-receiver` runs 40 tests (`scripts/gate.sh` runs them); the crash test alone kills a child process
at 24 points. "From disk" is observed, not assumed: a test reads `read_bytes` of `/proc/thread-self/io` (bytes this
thread had read from the device) across the read-back and the study DB's verification, after the write that cached
them.

**Mutation-checked:** each check and step of §3 was broken on purpose, one at a time, and the suite run: 77
mutations, every one failed a test. The list, each with the test that failed it, is in [`../../ingest/receiver/README.md`](../../ingest/receiver/README.md#mutations).

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
