# ADR: where a study sits under the PACS's root

**Status:** proposed 2026-10-25, **theory only: nothing built or timed; not decided.** The owner (2026-10-25): partly
ours; the trade-offs are presented at the next meeting with the team, the product owner and the DICOM-experienced
members, who decide together (§6); this record recommends
([`../ingest/pacs-receive-design.md`](../ingest/pacs-receive-design.md) §8). *Corrected 2026-10-26:* "catalog" is now
*study index* ([`study-index.md`](study-index.md)), "study database" *study DB*; a year/month/day tree (C) was a meeting
suggestion, in neither pcs.pdf nor the PCS repository (design state §1). Sources are pinned in §8. *(I)* marks
this record's own inference; a figure not marked *measured* is not one, and none here is.

**Why an ADR and not a section of [`../disk-layout/target.md`](../disk-layout/target.md).** The target owns what is
inside a study: `<Study>/<Series>.sbnd`, its bytes, how it is published. This record owns the path above
`<Study>/`, which is a choice among options with a cost to switch, and it bears on how the server turns a session URL
into a path (PR #142, `serving-by-uid.md`, proposed at `a1a80c4c`, not merged). The target's §Open points here.

## 1 · On one screen

The study directory holds the study DB (one SQLite file, and its `-wal` and `-shm` while open) and one `.sbnd`
per series. The question is only what comes before it. Names below are UIDs in the PCS's coded form
([`../ingest/contract.md`](../ingest/contract.md) §The layout): a 64-character UID codes to at most 44 characters, a
`2.25.` UID of 44 characters to 30.

| option | path | server builds the path from the URL alone | a corrected study date | an absent date | entries in the largest directory at 10 M studies *(I)* | retention by age | human browsing |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **A** flat | `<root>/<Study>/` | yes | nothing moves | no case | 10 M: at ext4's ceiling without `large_dir` (§3) | study-index query, then per study | `ls` of millions; find by name |
| **B** one coded date folder (the PCS's `<D>`) | `<root>/<D>/<Study>/` | **no**: the date is in the URL, or a lookup | the study moves, or its folder is wrong | one `PbPb` folder for every undated study | a busy day's studies; `PbPb` unbounded | by folder, if the folder's date is the rule's | sorted by date, read only through the coding |
| **C** `yyyy/mm/dd` | `<root>/2026/10/25/<Study>/` | **no**, as B | as B | a folder named for "no date", as B | a busy day's studies | as B | best: dates as written |
| **D** one hashed level (recommended) | `<root>/<hh>/<Study>/`, `hh` 2 hex characters of a hash of `<Study>` | yes, plus a hash | nothing moves | no case | 39 000 at 256 folders | study-index query, then per study | find by computing `hh`, or `find` |
| **D2** two hashed levels (Orthanc's shape) | `<root>/<hh>/<hh>/<Study>/` | yes, plus a hash | nothing moves | no case | 153 at 65 536 folders | as D | as D, one level deeper |
| **E** a volume or host prefix, over any of the above | `<volume>/…` | only if the volume is known: probe a short list, or a lookup | as the option under it | as under it | as under it | moving old studies to another volume is per study | as under it |
| **F** D plus a derived date view | D, and `by-date/2026/10/25/<Study>` → the D path | yes (the server reads D only) | the view's link moves, the files do not | the view leaves it out | as D | the view lists candidates; deletion as D | C's, for reading |

**Recommended: D, one hashed level of 256 folders, and no date in the path or the URL.** The deciding reason is the
first column. PR #142 serves `/<Study>/<Series>` straight from the disk, with no database in the read path: a
direct link resolves by a string join and one `open`. A date in the path breaks that. Either the date joins the URL, so
a corrected study date breaks every link already given out, or every session first looks up its study's date in the
study index, which [`../ingest/design.md`](../ingest/design.md) §5 makes a derived index that can be lost and rebuilt.
Between A and D, the hash level costs one hash of a short string. It keeps every directory far from the ext4 and XFS
limits of §3 on any filesystem the site deploys. The date organisation the PCS team asked for is a study-index query, or
F's view if people must browse by date (§6, question 5).

## 2 · Finding a study from the URL or a UID

The server is handed `/<Study>/<Series>` and nothing else (PR #142 §2). A path that is a function of the UIDs alone
(A, D, D2) is built with no I/O beyond the `open`. A path that holds a date (B, C) needs the date, and the server has
three ways to get it:

1. **The URL carries it,** `/<D>/<Study>/<Series>`. The date becomes part of the study's address. A study date corrected
   after links were issued (a worklist link, a report, a bookmark) breaks every one of them, unless the old folder
   keeps a forward. Received date avoids that, since it never changes, but then the folder does not organise by study
   date, which is what the PCS team asked for.
2. **A lookup,** UID → date, in the study index or a per-UID index. Every session start then depends on a second store
   being up and current. A study published but not yet in the study index (design.md §5, a crash between steps 1 and 2)
   cannot be served until the start-up rescan. *(I)*
3. **A probe** of every date folder: not an option at thousands of days.

This is the difference from the established archives. Both resolve every read through their database: dcm4chee-arc
stores the path it wrote and reads it back *(I: the location record is not read here)*, and Orthanc maps a UID to an
attachment's random UUID, then builds the path from the UUID (§7). A date or a random name costs them nothing at
read time, because the lookup happens anyway. The server here has no such lookup, by PR #142's design. So it
cannot copy their date folders without adding one.

## 3 · Filesystem behaviour with millions of entries

A study is a directory, so a flat root holds millions of **subdirectories**, not files.

**ext4.** Directories are a hash tree once indexed: "a faster (but peculiar) balanced tree keyed off a hash of the
directory entry name", whose depth "Cannot be larger than 3 if the INCOMPAT_LARGEDIR feature is set; cannot be larger
than 2 otherwise" (ext4 docs §4.3.2). When the tree is full the kernel logs "index full, reach max htree level" and,
without `large_dir`, "Large directory feature is not enabled on this filesystem", and the create fails `-ENOSPC`
(`fs/ext4/namei.c`). At 4 KiB blocks with `metadata_csum`, two levels address 507 × 510 = 258 570 leaf blocks. A leaf
holds 102 entries of a 30-character name or 78 of a 44-character one, and a split leaves it half full. So the ceiling
is **about 10–26 million entries in one directory** *(I: arithmetic on the on-disk format, not measured; §5 P2)*.
Separately, a directory may hold more than `EXT4_LINK_MAX` (65 000) subdirectories only with `dir_nlink` on
(`fs/ext4/ext4.h`, `EXT4_DIR_LINK_MAX`). A flat root passes 65 000 studies in weeks, and each of D's 256 folders
passes it at 16.6 M studies.

**XFS.** Lookups go through hashed leaves, which "are used to optimise lookup operations", and a large directory's
leaves "eventually change into a B+tree" (XFS Algorithms & Data Structures, §Directories). The directory's data
section ends where its leaf section starts, at `XFS_DIR2_LEAF_OFFSET`, "Currently, this is 32GB". An entry of a 30- or
44-character name takes 48 or 56 bytes, so one directory holds about **600–700 million** *(I: arithmetic, not
measured)*.

**What a large directory costs, beyond the ceiling.** A lookup by name stays a hashed walk on both filesystems, so the
server's `open` cares little about the shape *(I; §5 P1 tests it)*. The cost is in what lists a directory: `ls`, a
backup scan, `rm -r`, and creates in one directory, which take that directory's lock in turn *(I; §5 P3)*. ext4's
`max_dir_size_kb` exists because "a very large directory can cause severe performance problems" in memory-constrained
environments (ext4 admin guide, §Options).

**Inside a study** the entries are its series, at most hundreds: no concern under any option.

## 4 · The other criteria

**Which date.** Study Date (0008,0020) is Type 2 in the General Study module, "Date the Study started": it is
required but may be empty (PS3.3 §C.7.2.1). The PCS's `<D>` is that date as `YYMMDD`, `PbPb` when it is not 8
characters (contract.md §The layout), and the DECK README calls it "study date aammdd". Three consequences, each
*(I)* from those sources:

* **Two-digit years:** a 1926 and a 2026 study share a folder. The coded alphabet is in ASCII order, so the folders sort
  by `YYMMDD`, and a 1999 prior sorts after 2026.
* **The undated bucket:** every study without a date goes into one `PbPb` folder, which grows without bound. The
  ingest's stand-in puts every fetched set there today.
* **A corrected date** either moves the study (`rename` of its directory, atomic on one filesystem) or leaves the folder
  stating a date the study no longer has. The received date has none of these problems, but it organises by arrival,
  which is a different filing from the one asked for.

**Retention and deletion by age.** A retention rule is the hospital's: which date it counts from, minors, legal holds
(not read here). Under every option, deletion removes each study's files, so the work per study is the same. A date
folder adds `rm -r` of a whole day, which is right only if the folder's date is the rule's date and no study in it is
held *(I)*. The study index knows all three, so the recommended path is a study-index query that lists the studies, then a
per-study delete.

**Backup.** A snapshot of the volume is indifferent to the tree. A file-level backup scans every entry under every
option. Date folders would let it skip old days, but only if a past day never changes, and it does: a late series, a
corrected study, a deletion *(I)*. No option makes an incremental scan free.

**Tiering and moving studies between volumes or hosts.** A study is a directory, so it moves whole, and nothing in
the path names its volume. Within one filesystem a move is one `rename`. Across mounts `rename` fails with `EXDEV`
(rename(2)), so the study is copied, `fsync`ed, renamed in and the old one removed, as it is published (target
§Packing and publishing). Moving "everything before 2020" in one go needs date folders, or a study-index query and a move per
study. With E the server needs to know the volume: probing a short ordered list of roots is a `stat` per volume on a
miss, and a lookup is the alternative. A second host is the URL's host, not a path prefix: each server serves its own
root *(I)*. The study DB must sit on local disk, since SQLite's WAL does not work over a network filesystem
(design.md §5). So a network volume holds a study only once its database is no longer written.

**URL and filename safety.** Every option is safe in a URL. The coded alphabet is RFC 3986's unreserved set minus `-`
and `.` ("unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~"", §2.3), and `yyyy/mm/dd` is digits. Two points touch
the coded names themselves *(I)*. They mix upper and lower case, so two UIDs can differ only by case, and a copy to a
case-insensitive filesystem (a Windows share, macOS's default) can merge them. Dotted UIDs have no case. A coded UID
starts with an upper-case letter, since a UID starts with `0`, `1` or `2`, so no name starts with `~` or `.`. **Coded or
dotted on disk is open:** PR #142's grammar accepts dotted UIDs, the owner's brief and the PCS's tree use coded ones, and
the `.sbnd` header stores dotted (question 4).

**Human inspection.** C is the easiest to browse. B sorts by date but needs the coding to read. D and D2 need a
`find -name <Study>` or the shard computed by a one-line helper, which is a later tool *(I)*. A study's own
directory reads the same under every option.

**PS3.10 file-sets** do not apply: they are for interchange media, with File ID components of "one to eight
characters" from `A–Z 0–9 _` (PS3.10 §8.2, §8.5), which neither coded nor dotted UIDs fit. Their rule that "no
semantics shall be conveyed by the structure and content of such File IDs" (§8.2) leans against a date in the path,
for interchange only.

## 5 · Performance: pre-registered protocols, no numbers

Each runs on one host, with the variants interleaved, and quotes latency, p50 and p99. Each says where the host
saturates and claims nothing past it. The page cache is not evicted to force a cold case, so every claim is warm-cache
only, and a cold claim waits for a lever that forces one.

* **P1 · lookup.** Trees of 10⁵, 10⁶ and 10⁷ empty study directories as A, C and D, on XFS and on ext4 (with
  `large_dir`, so A fits). Time `open` of `<Study>/x.sbnd` for uniformly random existing studies. Prediction: no
  difference worth a path segment *(I)*.
* **P2 · the ext4 ceiling.** ext4, 4 KiB blocks, `metadata_csum`, without `large_dir`. Create directories with 30- and
  44-character names in one directory until `ENOSPC`. Prediction: between 10 and 26 million (§3). Then the same with
  `dir_nlink` off, to confirm the 65 000-subdirectory stop.
* **P3 · publication.** k = 1, 2, 4, 8 writers, each publishing study directories by create, `fsync`, `rename` and
  `fsync` of the parent, into one directory (A) and into D's 256. Time each publish.
* **P4 · scan.** `readdir` plus `stat` of every entry, as a file-level backup does, over the P1 trees. Time per entry.

## 6 · Questions for the meeting, each with a default

1. **Is the path a function of the UIDs alone, with no database in the read path?** Default: **yes**. That is what the
   URL of PR #142 assumes, and the rest follows from it.
2. **The shard: none, 256, 4 096, or two levels of 256?** Default: **one level of 256** (`<hh>`, 2 lowercase hex
   characters). It holds 10–26 M directories per folder even on ext4 without `large_dir`, so 2.5 billion studies on
   paper *(I)*. Going to 4 096 later is a rename per study (§7).
3. **The shard's hash.** Default: **the low byte of XXH3-64 of the study name as it is on disk**, the hash family the
   ingest already uses. The hash must spread, not just cut the name: UIDs from one organisation share their leading
   characters, so the name's first two characters are no shard *(I)*.
4. **Coded or dotted UIDs on disk and in the URL?** Default: **coded**, as the PCS's tree, the owner's brief and the shorter name
   have it. PR #142's grammar then becomes the coded alphabet, at most 44 characters, and the tree is never copied to
   a case-insensitive filesystem. Dotted is the alternative: it can be read without decoding, has no case, and matches
   the header.
5. **Where the date organisation lives.** Default: **the study index**, by study date and received date, both columns.
   F's derived view of links, rebuilt from the study index, only if people must browse the disk by date.
6. **Retention:** which date, which rule, and holds. Default: **the hospital's rule, applied by a study-index query and a
   per-study delete;** never deletion by folder.
7. **A corrected study date or a late series moves nothing.** Default: **agreed**. Only the study index and the study
   database change.
8. **The filesystem.** Default: **XFS, or ext4 with `dir_nlink` and `large_dir`**, checked at deployment with
   `tune2fs -l` *(whether a given distribution's `mke2fs.conf` turns them on is not read here)*.
9. **More than one volume.** Default: **an ordered list of roots probed on a miss.** A volume column in the study index
   comes only when there are more volumes than a probe should touch.
10. **The PCS's own `<D>/` tree** at the site is the PCS team's and unchanged. The PACS does not mirror it. Default:
    **agreed**.

## 7 · The cost of switching later

Moving a study between any two of these shapes on one filesystem is one `rename` of its directory: atomic, no bytes
copied, and an open session keeps its descriptor (POSIX unlink(), as PR #142 §4 quotes). A migration while serving
walks the study index and renames each study. Meanwhile the server tries the new path, then the old one, which is one
extra `stat` on a miss until the walk ends *(I)*. Moving into B or C needs each study's date (the study index has it), and
then question 1's lookup for good. **The part that cannot be undone is a date in the URL:** links already handed
out keep it. So the URL stays `/<Study>/<Series>` whichever tree is chosen, and the tree stays cheap to change.

## 8 · Sources

Read 2026-10-25 unless stated.

* **pcs.pdf**, not in this repository, as the owner quotes it: "[date], [exam], [series], and [instance] are
  placeholder for the corresponding UIDs."
* **DECK_WebTransport** (github.com/opendicom/DECK_WebTransport, `a65abe28`), `DICMele2deck/README.md`: "eDA and
  eDAlength (study date aammdd compressed uib64)".
* [`../ingest/contract.md`](../ingest/contract.md) §The layout, §The coding; [`../ingest/design.md`](../ingest/design.md)
  §5 (study DB, study index, WAL); [`../disk-layout/target.md`](../disk-layout/target.md) §Packing and publishing.
* PR #142, `docs/adr/serving-by-uid.md` on `claude/serve-by-uid-design` (`a1a80c4c`), §2 (URL, grammar) and §4 (rename).
* **DICOM PS3.3 2026d** §C.7.2.1, General Study module: Study Instance UID (0020,000D) Type 1; Study Date (0008,0020)
  Type 2, "Date the Study started."
* **DICOM PS3.10 2026d** §8.2 File IDs ("one to eight components", "one to eight characters", "no semantics shall be
  conveyed"); §8.5 Character Set (`A–Z`, `0–9`, `_`).
* **RFC 3986** §2.3 Unreserved Characters.
* **ext4:** docs.kernel.org, *ext4 Data Structures and Algorithms* §4.3.2 Hash Tree Directories; *ext4 General
  Information* (admin guide) §Options `max_dir_size_kb`; Linux v6.12 `fs/ext4/namei.c` (`dx_probe`, `ext4_dx_add_entry`:
  the index-full warning and `-ENOSPC`), `fs/ext4/ext4.h` (`EXT4_LINK_MAX 65000`, `EXT4_DIR_LINK_MAX`,
  `EXT4_HTREE_LEVEL_COMPAT 2`, `EXT4_HTREE_LEVEL 3`).
* **XFS:** *XFS Algorithms & Data Structures*, xfs-documentation `7d07fb94`,
  `design/XFS_Filesystem_Structure/directories.asciidoc`, §Directories (introduction), §Leaf Directories
  (`XFS_DIR2_LEAF_OFFSET`, "Currently, this is 32GB"), §Node Directories.
* **dcm4chee-arc:** configuration reference, Storage Descriptor, Storage Path Format (`dcmStoragePathFormat`):
  "‘{now,date,yyyy/MM/dd}/{0020000D,hash}/{0020000E,hash}/{00080018,hash}’, if absent". So the date is the time of
  writing, not the study date. dcm4che `cd8b9ede`, `dcm4che-core/…/util/AttributesFormat.java`: `hash` is
  `TagUtils.toHexString(s.hashCode())`, 8 hex characters of the UID's Java string hash; `md5`, `rnd` and `uuid` are the
  other forms.
* **Orthanc:** OrthancMirror `2482cbec`, `OrthancFramework/Sources/FileStorage/FilesystemStorage.cpp`,
  `FilesystemStorage::GetPath`: `root / uuid[0..2] / uuid[2..4] / uuid`, from an attachment UUID, not a DICOM UID.
* **rename(2)**, Linux man-pages: `EXDEV`, "oldpath and newpath are not on the same mounted filesystem."
