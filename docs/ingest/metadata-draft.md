# Metadata from the study database: the purpose and the open points (draft)

*A draft for the owner's review, 2026-10-19. Nothing here is built and nothing is timed unless it says
**measured**. Once a design is agreed, its text moves into the file that owns it — [`design.md`](design.md) §5 for
the study database and the catalog, [`../disk-layout/target.md`](../disk-layout/target.md) for what sits on disk,
[`../CLIENTS.md`](../CLIENTS.md) for what the page fetches — and this file is removed.*

*Corrected in place, 2026-10-26, to the owner's decisions of 2026-10-24/25, gathered in the design state
(`docs/ingest/pacs-receive-design.md` at `e699ed3`, branch `claude/pacs-design-state`): an update replaces the stored
row and an audit record is kept, so §2's "truth" with generations and history is retracted; its "page view" is
**display metadata**, the paint part of what a viewer reads; §3 holds the engines' versions and tests. Each correction
is marked where it is made; every number keeps its source.*

| Measurement | Here | Evidence | PR |
| --- | --- | --- | --- |
| the page's read from four stores, A–D | §2 | [`lab/metadata-store`](../../lab/metadata-store/README.md), top | #113 |
| a survey of formats, T1–T5 and V1–V6 (read, not timed) | §2 | §Sources | #120 |
| the pair, T1 or T2 with V1: page open, update, integrity, a reader; patch against rebuild; the reader's tail | §2 | the same README, `--mode pair`, `--mode pair-followup` | #126 |
| one update in place against a new revision directory | §2 | the same README, `--mode update-cost` | #144 |
| metadata size and repetition on five TCIA series | §2 | the same README, §Repetition | #150 |
| the parser's own output on the same series | §2 | the same README, §The parser's own output | #154 |
| compressing metadata-only update packages on emulated links | §2 | the same README, §Updates on the link | #156 |
| rusqlite against Turso; each at its best; a read beside an update in two processes | §3 | [`lab/sqlite-engine`](../../lab/sqlite-engine/README.md) §1–§5 | #147, #151, `claude/sqlite-lock-behaviour` |

## Why

**The need.** A viewer has to know, before it paints a frame, how many frames there are, which codec they are in,
how to turn samples into grey levels (photometric, rescale, window), and how fast a cine plays. Today that arrives
as one JSON file. Two decisions already taken make that file go away:

* [`../disk-layout/target.md`](../disk-layout/target.md): no metadata in or beside the `.sbnd`; it lives only in the
  per-study database, one copy, where it is queried.
* [`design.md`](design.md) §5 (d): one database per study, built from the parser's groups at the PACS (confirmed 2026-10-20), so bad
  data in one study never forces a shared rebuild.

**The purpose of this work** is the path between those two: the page gets what it needs to paint from the study's
database, no slower than today, and the dev host, the fixtures and the gate stop depending on a JSON file.

## Today

```text
 build time                                     page open
 ──────────                                     ─────────
 ingest.py ──▶ metadata.json ──┬─▶ pack-series ──▶ x.sbnd  (JSON copied into the file; the server never reads it)
                               │
                               └─▶ <series>.metadata.json            browser
                                    │                                   │
                                    ▼                                   │ GET /series/metadata   (head.js:9)
              web host: nginx  /series/metadata ──alias──▶ that file ◀──┤ GET /wt/dev-transport.json
                        or dev-server.py --metadata                     │      (both in parallel, before the dial)
                                                                        │
                                                                        │ codec → preload that decoder only
              series-server --series x.sbnd   ◀──── WebTransport ───────┘ frames
              (one series per process)
```

**What the viewer reads out of the JSON** (`client/viewer/viewer.js`, `client/viewer/head.js`, every use):

| Key | Used for |
| --- | --- |
| `frameCount` | the frame range, the fill's end |
| `codec` | which decoder to preload and run (`htj2k` when absent) |
| `photometric` | MONOCHROME1/2 or RGB; guessed from components when absent |
| `rescale` {slope, intercept} | samples → values; per frame under `perFrame.rescale[i]` when it varies |
| `window` {center[], width[], function} | the default window; per frame under `perFrame.window[i]` |
| `frameTimeMs`, `cineRate` | cine speed; 100 ms a frame when both absent |
| `digests` {algorithm, frames[]} | the exactness check; **moves into the `.sbnd` entry** under the target |

The ingest also writes `width`, `height`, `channels`, `bitsAllocated`, `bitsStored`, `highBit`, `signed`,
`modality`, `min`, `max` and, for AV1, `representation` and `preset`; the viewer reads none of them. It writes no
patient or study identifier, on purpose (`ingest/from-dicom/dicom_series.py`, `display`).

**Measured** (`lab/page-open/README.md` §The order the page's files leave in, PORD `37d2af7`, synthetic 300-frame
metadata of ~120 KB gzipped): the transport file lands first in 112 of 112 visits whichever is asked first; the
metadata costs the dial +7 ms at 80 ms RTT and +29 ms at 160 ms. That is the bar a new path is held to.

**A prerequisite outside metadata:** today one server process serves one series named by path. The target's
`<StudyUID>/<SeriesUID>.sbnd` means a page names its study and series, and whatever serves frames or metadata
looks them up by those UIDs. Every option below assumes that step; it is shared, not a cost of one option.

## Decided, 2026-10-19 (the owner)

* **The metadata and the pixels live on the same host**, so no read of either crosses a network. That leaves the
  embedded engines (§3) and drops the libSQL server, Turso Cloud and libSQL's remote and replica modes.
* **The study database is built and updated at the PACS** (2026-10-20, correcting 2026-10-19's move to the PCS): the
  metadata will be updated after it arrives, so its creation, its updates, its table design and its files are ours.
  The PCS sends the parser's groups and decides when a series or a study is complete; the PACS checks everything
  that arrives ([`design.md`](design.md) §5).
* **The client loads only what it needs**: the metadata the page uses now, and only the decoder of the series' codec.
  More is sent as more client features need it. *Replaced 2026-10-24* for the decoder (below): without the codec the
  page loads every decoder.
* **The parser's contract of 2026-10-11 stays** until a stable version is published
  ([`contract.md`](contract.md) §The parser at `f36230b`).
* **Whether SQLite is the store at all is open.** The parser's output comes first: [`contract.md`](contract.md)
  §The parser at `f36230b` records it. *Answered 2026-10-24* (below): SQLite as the container.
* **Parked:** the catalog (deferred on 2026-10-11). How a study database is changed while it is read is no longer
  parked: updates are certain, so it returns with the storage shape (§2).

## Decided, 2026-10-24/25 (the owner)

* **An update replaces the stored row.** No history is kept (the PCS keeps the originals); an **audit record** of
  every update — who, when, what changed — is kept. §2's generations and kept rows are retracted.
* **SQLite as the container** for the groups' blobs (2026-10-24): one file instead of thousands, atomic updates across
  rows, lookup by UID, safe reads during a write, standard tools; not SQL. One file per study is proposed.
* **Hashes are XXH3**, not BLAKE3: there is no cryptographic need. The measurements below hash with BLAKE3 as the
  parser names its files; the function changes, not the arguments.
* **The codec can come from the study index**; without it the page loads every decoder (2026-10-24, replacing
  2026-10-19's "only the decoder of the series' codec"). Prefetching every decoder while the user browses the list is
  to evaluate.
* **Frames are never compressed again** (2026-10-25). Metadata compression is to be configurable per site, on only
  where the link gains, the receiver accepting both (the owner, 2026-10-26; the default is open).

Open, and not decided here: how a viewer gets its metadata (the design state §6), and whether to store an instance
group as shared plus per-instance values (§2, on real series).

## The open points

### 1. How the page gets the metadata, and the codec before the decoder

**The two paths.** The page talks to two programs today: nginx serves its files over HTTPS (TCP), and the Rust server
takes the WebTransport session directly over UDP. nginx is not in front of the server, so it is not made a proxy for
the metadata.

| | A. The web host answers | B. The server answers, inside the session |
| --- | --- | --- |
| how | the page asks over HTTPS, as today; a small reader beside nginx opens the study's database and answers | the page connects first, then asks; the server opens the database beside the `.sbnd` |
| when the page has it | before the connection is up | after it: the QUIC handshake and the session's `CONNECT` first |
| who reads the study's files | two programs: the reader and the server | one: the server |
| cost now | a reader to write, deploy and secure | a message in [`../WIRE.md`](../WIRE.md), in both clients and the contract suite |
| switching later | A → B: the wire change; B → A: the reader | |

**The codec, so that only its decoder loads.** The decoder must be chosen before the first frame can be shown, and
**measured** (`lab/page-open/README.md` §Cold round trips by codec, COLDRTT `cc47988`, 100–300 ms links): the AV1
decoder loaded after the first frame cost 2.0 serial round trips through WebCodecs and 3.9 through dav1d's WASM; loaded
at the decoder's start, 1.0 and 3.0 of them go.

| | how the page knows the codec | what it costs |
| --- | --- | --- |
| a. from the metadata, before the connection | path A | nothing more |
| b. from the page's address, `?codec=` beside the UIDs | whoever links the page (a worklist) writes it | the linker must know the codec; the metadata can then come by either path |
| c. from the server, after the connection | path B alone | the round trips measured above |
| d. load every decoder | — | refused 2026-10-19; *corrected 2026-10-24:* what the page does when the study index does not give the codec |
| e. from the series file's header | the `.sbnd` header names the codec ([`../disk-layout/target.md`](../disk-layout/target.md) §The header); the server sends it first in the session | after the connection, as c, but the codec is written once |

**Open, the owner (2026-10-19):** whether a worklist should know the codec at all, and whether the codec should be
written in two places (the `.sbnd` header and the metadata) or read only from the file (e). Not decided.
*Since 2026-10-24* the codec can come from the study index (above); the rest stays open with viewer metadata.

* **What decides it:** one program reading the study's files (B) against the metadata before the connection (A); with
  b, B no longer costs the decoder's round trips.
* **Leaning:** B with b, unmeasured: one owner of the files, and only the needed decoder loads before the connection.
  What it would cost is the time to the metadata after the connection, which is not measured.

### 2. How the parser's groups are stored

The parser writes each group (exam, series, instance, private) as one run of records, `[1 B key length][key][4 B
value length][value]` ([`contract.md`](contract.md) §Group files). A study's groups are kilobytes
([`contract.md`](contract.md) §Sizes). The question is the shape the PACS reads them from.

**One example through every option:** the CT instance in the parser's `doc/PACS/db/deck.db`, whose instance group
holds 45 attributes, among them (0020,0013) instance number `1 `, (0028,0004) `MONOCHROME2 ` and (0028,1052) rescale
intercept `-1024 `. In that database the keys carry DECK's 8-byte prefix; here is the intercept's record as stored:

```text
10 | 20 80 01 00 80 01 00 00 | 00 28 10 52 | 44 53 | 00 00 | 06 00 00 00 | 2D 31 30 32 34 20
KL   prefix sSSiIIFF          tag 0028,1052  "DS"    charset  VL = 6        "-1024 "
```

The page needs, per instance of the series: photometric, rescale and window, and the instance number for the order.

**A. The group files as written.** The parser's directory, untouched:

```text
<D>/<E>/--.024fdf3e…                     the exam group, 15 records
<D>/<E>/<S>/---.3b25bd8a…                the series group, 19 records, 599 B
<D>/<E>/<S>/<I1>/----.0f2469da…          instance 1, 45 records
<D>/<E>/<S>/<I2>/----.…                  instance 2, …
```

The read: open the series file and every instance file, walk each one's records, keep the tags the page needs. A
2 000-instance CT is 2 001 files opened per page open.

**B. Groups whole in SQLite, plus columns copied out of them.** The parser's `deck.db` shape, trimmed. It is the
PCS team's own second design: their sample database of 2026-04-28 (`ba1b31a`, `doc/subprojects/PACS/db/deck.db`)
holds each group's blob, its BLAKE3 and copied columns in tables `E`, `S` and `I`; the exam and series columns serve
lists (study-index material), the instance ones are display metadata.

```sql
CREATE TABLE instance (iuid TEXT PRIMARY KEY, suid TEXT, number INTEGER, photometric TEXT,
                       slope REAL, intercept REAL, grp BLOB, blake3 BLOB);
-- one row:  'HB494Az5…', 'HB494Az5H3…', 1, 'MONOCHROME2', 1.0, -1024.0, <the 1 427 B group>, 0f2469da…
SELECT number, photometric, slope, intercept FROM instance WHERE suid = ? ORDER BY number;
```

The columns hold values that are also inside `grp`, copied out at build time so the read needs no parsing. They are
derived, like a book's index: the blob stays the source, and the columns can be thrown away and rebuilt from it. A new
client need is a new column, filled again from the blobs of every study.

**C. One row per attribute.** DECK's key-value table (`doc/DECK/databases/README.md`), the PCS team's first design:

```sql
CREATE TABLE kv (key BLOB PRIMARY KEY, value BLOB) WITHOUT ROWID;
-- one row per record:  x'2080010080010000 0028105244530000', '-1024 '
SELECT key, value FROM kv WHERE key >= :instance || x'00280000' AND key < :instance || x'00290000';
```

Keys sort by series, instance, then tag, so the page's tags of one instance (all in group 0028) are one contiguous
range, read in one step through the table's B-tree; a series is one such range per instance. Every attribute is
addressable, so a new client need is a new key list, with nothing rebuilt.

**D. A key file searched directly, with the values apart.** No database engine: the PACS writes two files per study,
the keys sorted with each value's offset and length, and the values back to back.

```text
keys.bin    [key 16 B][offset u32][length u32] …  sorted, fixed width
values.bin  "1 " "MONOCHROME2 " "-1024 " …
```

The read: a binary search in `keys.bin` (memory-mapped) finds the instance's first key, the following entries are its
attributes in tag order, and only the matching values are read from `values.bin`. The keys never mix with values or
lengths, so a search touches keys alone. Because instance numbers and tags increase, the position of a key can even be
estimated before searching (interpolation search). It is what C does inside SQLite — a sorted structure searched by
key — without SQL, without the B-tree's pages, and without the engine.

| | A | B | C | D |
| --- | --- | --- | --- | --- |
| a page open of a 2 000-instance series | 2 001 file opens and parses | one indexed query | 2 000 key ranges in one B-tree | 2 000 ranges by binary search |
| a new client need | parse more | a new column, rebuilt everywhere | nothing | nothing |
| what the PACS writes and maintains | nothing | SQL schema | SQL schema | the format, its writer, its reader, its checks |
| inspect with standard tools | yes, files | `sqlite3` | `sqlite3` | our own tool |
| the parser's own shape | its directory output | `deck.db` | `memorysqlite`, the databases README | none |

* **What decides it:** whether a custom format's speed is worth owning its writer, reader, checks and tools (D), against
  SQLite doing that (C); and whether every attribute must be addressable (C, D) or only the page's (B).

**Measured, 2026-10-19** ([`../../lab/metadata-store`](../../lab/metadata-store)): the page's read from each store, built
from the same groups, every read checked to hand back the same values first and C checked to give back every group
byte for byte. A series of N instances repeats the parser's CT instance group (45 attributes, 1 067 B) with its own UID,
number and position. Median µs over 300 rounds, the variants interleaved; a second run agreed within 5 %. One thread on
a 4-vCPU Xeon at 2.80 GHz, every file in the page cache: nothing here says what a cold disk or many sessions at once
cost.

| store, read | 4 instances | 200 | 2 000 |
| --- | ---: | ---: | ---: |
| A files (opens every file) | 53 | 2 895 | 29 806 |
| B columns, opened per read | 93 | 513 | 3 113 |
| B columns, held open | 7.4 | 150 | 2 602 |
| C rows, scan of the series, held | 24 | 1 208 | 12 550 |
| C rows, SQLite filtering the tags, held | 36 | 1 650 | 17 005 |
| C rows, seek per instance, held | 54 | 2 783 | 29 668 |
| D keys, scan, opened per read | 25 | 176 | 899 |
| D keys, scan, held | 0.9 | 51 | 646 |
| D keys, seek per instance, held | 3.0 | 184 | 1 949 |

| on disk | 4 instances | 2 000 |
| --- | ---: | ---: |
| A | 4 723 B in 5 files, 36 864 allocated | 2 151 799 B in 2 001 files, 16 388 096 allocated |
| B | 24 576 | 2 912 256 |
| C | 16 384 | 3 395 584 |
| D | 6 912 | 3 142 008 |

* **D's scan is the fastest read at every size:** 0.65 ms for 2 000 instances held, 4.0× B, 19× C, 46× A.
* **Its speed comes from the layout, not from skipping.** Seeking to each instance's page tags lost to scanning in both
  C (2.4×) and D (3.0×): a group is 45 attributes, so walking them costs less than three binary searches (D) or two
  SQLite statements, about 15 µs per instance (C). Keys apart from values, fixed width and no engine is what wins. A
  group much larger than 45 attributes (the 6 799 B private group of the same CT) could move that balance; not measured.
* **Letting SQLite filter the tags was slower than handing every row to the reader** (17.0 against 12.6 ms at 2 000).
* **Against the network:** at 2 000 instances A's 30 ms and C's 12.6 ms are a visible part of a 10–200 ms round trip;
  B's 2.6 ms and D's 0.65 ms are not.
* **Size:** B, C and D are within 17 % of each other. A's 2 001 small files take 7.6× their bytes on disk in 4 KB blocks.
* **Not measured:** any read but the page's (one attribute across a study, the whole study for an AI pipeline); the
  build or an update at the PACS; a cold disk; CPU at many sessions.

* **Switching later:** every shape is rebuilt from the groups, so a switch is a rebuild at the PACS, not lost data.

**On real series (2026-10-25, [`../../lab/metadata-store`](../../lab/metadata-store) §Repetition):** five TCIA series
(CT, PET, MR, mammography, ultrasound) split as the parser splits them. Measured: the metadata is 0.005–1 % of the
pixels as stored, 0.02–4 % in HTJ2K; in CT, PET, MR and MG 70–83 % of the instance groups' bytes are records the same in
every instance, so the shared values once plus each instance's differences weigh 9–28 % of a row per instance group
(CT, PET, MR) and a zstd-3 blob per series 1.5–3.8 %; an ultrasound series of two SOP classes shares a quarter (#150).
A shared plus per-instance layout is DICOM's own (Shared and Per-frame Functional Groups, PS3.3 C.7.6.16); whether to
adopt it is **open**. The parser's own output at `a65abe2` (#154) is 1.15–1.95× these bytes, for reasons read in its
source — an exam-level sequence keeps only its first attribute in the exam group and repeats the rest in every
instance group; group 0002 lands in the instance group — and nested keys carry bytes from memory addresses, so two
parses of the same files give different groups: [`../../lab/metadata-store`](../../lab/metadata-store) §The parser's
own output.

**Metadata-only updates on the link** ([`../../lab/metadata-store`](../../lab/metadata-store) §Updates on the link, 2026-10-25): a
single correction (3–5.6 KB) is one flight raw or compressed, but a resend or a fan-out saves 1–5 round trips and up to
11 s compressed, never slower in 56 pairs (#156). *Corrected 2026-10-26:* this concluded "so compressing every
package's metadata is the simpler rule"; the owner's direction (2026-10-26) is a per-site setting, on only where the
link gains, the receiver telling a zstd frame by its magic number and accepting both; the default is open, and "never
slower" argues for on. For a series package compressing the metadata saves at most 3.45 % with HTJ2K pixels
(§Repetition there), and frames are never compressed again (2026-10-25).

**Integrity under C and D.** The parser's BLAKE3 covers a whole group. C and D keep it checkable: the group's bytes are
its records in key order, so the PACS writes them back to back and hashes them on arrival — the same bytes, the same
BLAKE3 — then stores the rows. That proves the content equals what the parser wrote. A hash of the whole database
file is cheap (BLAKE3 runs at gigabytes a second; design.md §6 puts a 10 KB group at ≈ 1.5 µs) but proves only that the
file arrived as it was sent: the same rows can be stored as different file bytes (page layout, free pages, the
SQLite version), so it cannot be compared with anything the parser computed. Both have a use: the file's hash for the
transfer, the groups' for the content, and SQLite's `PRAGMA integrity_check` for the file's structure. *Since
2026-10-24/25* both hashes are XXH3 (above); the argument is unchanged.

#### The stored groups and display metadata: a survey of formats (2026-10-20)

*Read from primary sources (§Sources, 2026-10-20), nothing built and nothing timed here. A number marked
**measured** is the table above; every other cost is reasoned from the sources and marked unmeasured.*

*Corrected 2026-10-26.* As written, this survey's two jobs were a *truth* — every group as received, each update a new
row with a generation number, so history stays readable — and a *page view* derived from it. The owner decided
(2026-10-24/25) that an update replaces the row, no history is kept and an audit record is; and the page view is
display metadata. Below, the *stored groups* are the current groups, one copy each; every argument that leaned on
kept history is corrected where it stands. The shapes, the engines and the numbers are unchanged.

**The two jobs** (the owner's direction, 2026-10-20). The *stored groups* hold every attribute, once and
addressable. *Display metadata* is small and derived from them: one entry per series with the page's values for every
instance, rebuilt when a group or the client's needs change. Whether it is stored at all, or read from the groups when
a series opens, is open (the design state §6).

```text
 PCS ── the parser's groups ──▶ PACS builder ──▶ the study's store
                                                  ├─ groups    every group, the current one, with its hash
                                                  └─ display   one entry per series: its display metadata
 page open    server ── one lookup by series UID ──▶ display metadata ── its bytes ──▶ client
 an update    builder: replace the changed group, write its audit record, rebuild that series' display metadata, at once
 a new need   builder: rebuild every series' display metadata from the groups
```

**What the split changes.** The measured table is a page open that walks every instance of the series. With display
metadata stored, that walk happens once, when the builder writes it, and a page open reads one entry whatever the
series' size. So the stored groups are no longer judged on the page's read: they are judged on an update, on their
integrity, on addressing any attribute, and on how fast the builder can walk them to rebuild display metadata. Display
metadata is judged on one read and on its size on the wire.

**The stored groups: shapes.** Each can sit in any engine of the next table; SQLite is assumed where it says so.

| | T1. a row per group | T2. a row per attribute | T3. JSONB group, generated columns | T4. sorted key file | T5. the group files |
| --- | --- | --- | --- | --- | --- |
| what it is | B without its copied columns: the parser's bytes as received, its BLAKE3, keyed by series, instance and kind | C: DECK's key, `WITHOUT ROWID`; the PCS team's first design, which their 2026-04-28 sample (`ba1b31a`) changed to group blobs (B) | each group converted to SQLite's JSONB, a page value a `VIRTUAL` column over `json_extract` | D: keys apart from values, rewritten whole | A, untouched |
| walk a series (the rebuild) | open the blobs, walk 45 records each; unmeasured | one key range per instance (**measured** 12.6 ms at 2 000 for the page's tags) | `json_extract` per value, per row; unmeasured | **measured** 0.65 ms at 2 000 | **measured** 30 ms at 2 000, 2 001 files |
| one attribute across a study | parse every group | a key range per instance | one column | a binary search per instance | parse every file |
| one rare update | replace the group's row (*corrected 2026-10-26*; as written, a new row) | rewrite its rows | rewrite one JSONB blob | rewrite the file and rename it | write a new file (its name is its hash) |
| a new client need | nothing (display metadata is rebuilt) | nothing | `ALTER TABLE ADD COLUMN … VIRTUAL`; a `STORED` one cannot be added by `ALTER` | nothing | nothing |
| integrity | BLAKE3 of the stored blob; it *is* the hashed bytes | reassemble the records in key order, then hash (the lab checks it byte for byte) | **lost**: JSONB is not the parser's bytes, so they must be kept beside it | reassemble, as T2 | the file's name is its hash |
| size, 2 000 instances | under B's 2 912 256 B (**measured**, with the columns) | 3 395 584 B (**measured**) | unmeasured; JSONB is 5–10 % under text JSON (SQLite) | 3 142 008 B (**measured**) | 2 151 799 B in 16 388 096 allocated (**measured**) |
| crash, readers during an update | the engine's (next table) | the engine's | the engine's | rename publishes; a reader keeps the old file open | rename publishes; nothing ties the files of one update together |
| what we own | the schema | the schema | the schema, and a conversion | the format, writer, reader, checks and tools | nothing |

* **T2's key order is a lever.** DECK's order (series, instance, tag) keeps a group's records together, which is what
  makes T2's integrity a reassembly. A tag-first order (series, tag, instance) would make the page's six tags six
  ranges of 2 000 rows instead of 2 000 ranges, and scatter every group; unmeasured. Under the split it buys nothing,
  because the page no longer reads the stored groups.
* **T2 fits `WITHOUT ROWID`; T1 does not.** SQLite's rule of thumb is a row under 1/20 of a page (about 200 B at
  4 KiB). A T2 row is a 16-byte key and a short value; a T1 row is the 1 067 B group, so T1 is an ordinary table with
  its key as a unique index.
* **T3's catch is twice over.** SQLite says JSONB is "for internal use by SQLite only", and a generated column may call
  only deterministic functions in the same row: reading DECK's records directly would need our own function,
  registered in every connection, which the `sqlite3` shell does not have. And a `VIRTUAL` column is computed on read,
  so it is B's per-instance read again.
* **An update and the parser's hash.** A corrected group is no longer what the parser wrote. As written, T1 kept the
  received row, wrote the correction as a new row with a generation number and the PACS's own hash, and a read took
  the highest generation, as AWS HealthImaging keeps versions. *Corrected 2026-10-26:* the owner decided no history
  (2026-10-24/25). The parser's hash is checked on the package as it arrives; the replaced row carries the PACS's hash
  over its current bytes; the audit record says who changed what, when.

**Not for the stored groups, and why.** rkyv has no schema evolution (its own feature table); FlatBuffers and Cap'n Proto evolve
only by declared fields added at the end. DICOM's attribute set is open, so none of them can hold it without becoming
a key-value list inside a blob, which T1 already is. Arrow IPC and Parquet files are written once (a footer indexes
the blocks); an update rewrites the file, and Parquet recommends row groups of 512 MB–1 GB, against a study's
kilobytes. Both fit a later, separate export (one attribute across many studies, an AI pipeline), not the stored groups.

**Engines that could hold T1 or T2.** The builder and the server are two processes, so whether a second process may
read while one writes is a column of its own.

| | SQLite (`rusqlite`) | redb | LMDB (`heed`) | fjall | sled |
| --- | --- | --- | --- | --- | --- |
| model | B-tree pages, SQL | copy-on-write B-trees, key-value, pure Rust | copy-on-write B-tree in one memory map, C | LSM tree (memtable, sorted tables, compaction), pure Rust | Bw-tree-like, pure Rust |
| a commit across a crash | atomic, journal or WAL | 1 `fsync` with a checksummed commit (2 under 2PC) | copy-on-write: "no special recovery procedures" | a journal; by default flushed to the OS, not to disk | "sled is beta" |
| a reader during an update | WAL: readers keep their snapshot; other processes on the same host | MVCC in one process; a read-only handle in another process excludes the writer, unless `experimental-multiprocess` (since 4.3.0) | readers lock-free, any process; a lock file to keep healthy | "may not be loaded in parallel from separate processes" | — |
| built-in checks | `PRAGMA integrity_check`; per-page checksums only with `cksumvfs` | XXH3-128 Merkle tree over every page | none in 0.9.36; a checksum callback in the 1.0 branch (`heed3`) | not read | not read |
| inspect with | the `sqlite3` shell, any language | our own tool | `mdb_dump`, `mdb_stat` | our own tool | our own tool |
| latest (crates.io) | 0.41.0, 2026-10-24, bundling SQLite 3.54.1 (*corrected 2026-10-26*; read 2026-10-20 as 0.40.2, 2026-08-08) | 4.4.0, 2026-10-13; also 2.6.4, 2026-10-02 | 0.22.1, 2026-04-07; LMDB 0.9.36 | 3.1.12, 2026-10-03 | 0.34.7, 2021-09-12; 1.0.0-alpha.124, 2024-10-11 |
| licence | MIT | MIT or Apache-2.0 | MIT; the -sys crate Apache-2.0; LMDB OpenLDAP 2.8 | MIT or Apache-2.0 | MIT or Apache-2.0 |
| state | — | "Stable and maintained", file format stable | mature C; the Rust wrapper maintained | stable disk format, major bumps migrate | on-disk format to change before 1.0; a rewrite in progress |

* **Out:** sled (beta, no release in two years) and fjall (one process at a time, and an LSM's compaction is machinery
  for many writes, where ours are rare). `sstable` (0.11.1, 2023-04-22) and `fst` (0.4.7, 2021-06-06) would make T4 a
  library's format instead of ours, but neither has had a release in two years.
* **redb's own benchmark** (its README, Ryzen 9950X3D) puts LMDB first on reads and SQLite last, at 4.3 s for random
  reads where redb takes 1.1 s; that is millions of keys, not a series' one lookup, and says nothing at our sizes.

**Display metadata: formats.**

| | V1. a row per series, its bytes the document | V2. a file per series | V3. copied or generated columns per instance | V4. FlatBuffers or Cap'n Proto | V5. Arrow IPC | V6. rkyv |
| --- | --- | --- | --- | --- | --- | --- |
| a page open | one key lookup, then send the bytes; unmeasured, expected near B's 4-instance read (**measured** 7.4 µs held) at any size | open and read one file | B: **measured** 2.6 ms at 2 000 held, and the document still to build | one lookup; the client reads fields in place | one lookup; columns in place | one lookup; Rust only |
| an update or a new need | rewrite the row(s) in the groups' own commit | rewrite and rename the file; a second step after the groups' commit | B: a new column, every study refilled; generated: `ALTER TABLE` | a field added at the end; old readers ignore it | a new column; the file rewritten | no schema evolution |
| the client | reads it as it does today | as V1 | as V1 | a schema compiler and a library in the page | a library in the page | cannot read it |

* **V1 and V2 are what the archives do** (below): a precomputed document per series, rebuilt from groups kept whole.
  V1 puts it in the same file as the groups, so one commit changes both and a reader sees both before or both after.
  V2 needs a revision number in both places and a check that they agree.
* **The view's encoding is the wire's**, so it is decided with §1 and §4, not here: JSON, as the viewer reads now,
  until a measurement says otherwise. FlatBuffers would suit a growing set of fields (append-only evolution) if the
  size on the wire ever calls for binary.

**What existing archives and viewers do.**

| | the stored metadata | the display-like view | a new need |
| --- | --- | --- | --- |
| **Orthanc** | the DICOM files; a SQLite (default) index with `MainDicomTags`, one row per resource and tag | the DICOMweb plugin's series metadata, cached as a gzipped attachment (since 1.15) | `ExtraMainDicomTags` apply to new data; old data by `/reconstruct` or the Housekeeper plugin |
| **dcm4chee-arc** | the objects on storage; each level's attributes as an encoded blob in table `dicomattrs` | "ZIP archives with aggregated Metadata of all instances of a Series", on storage | an attribute update schedules the series' metadata to be rebuilt (`dcmUpdateSeriesMetadata`, polled) |
| **AWS HealthImaging** | the imported image set | the whole image set's metadata as one gzipped JSON | an update makes a new version, old ones readable; the image set is `LOCKED` while it updates |
| **Google Cloud Healthcare** | not published | DICOMweb Retrieve Metadata | `updateMetadata` (v1beta1) on a study, series or instance: a JSON Patch, a long-running operation |
| **Static DICOMweb** | the files | `series/<uid>/metadata.gz` | not stated; a `deduplicated/` tree "used for concurrent updates" |
| **OHIF** | — (a viewer) | asks DICOMweb's series metadata, every instance's full JSON, into its metadata store; per series with `enableStudyLazyLoad` | — |
| **DECK** (the PCS team's first design; their 2026-04-28 sample, `ba1b31a`, stores whole groups) | one key-value row per attribute, keys ordered by series, instance, group, sequence and item, the same table proposed for SQLite, Turso and IndexedDB | none in `doc/DECK` | none needed: every attribute is addressable |

**What decides across the band.** At 4 instances (mammography) every store read the page's values in under 0.1 ms
(**measured**): nothing decides on speed, so the update, the integrity and the tools do. From 200 to 2 000 (CT)
the per-instance stores grow with the series, 0.05–2.9 ms at 200 and 0.65–30 ms at 2 000 (**measured**), while
stored display metadata stays one lookup. So across the band it is not the groups' format that decides but whether the
per-instance work is done at a page open or at a build. What remains is the view's size on the wire at CT sizes:
**measured** (§Today), ~120 KB gzipped cost the connection +7 ms at 80 ms and +29 ms at 160 ms. Constant values once
and per-instance values only where they vary, as `perFrame` does now, matter more there than any storage format.

**Switching later.** The pair's two edges are the builder (groups in, stored groups and display metadata out) and one
read function (UIDs in, display metadata's bytes out); the client sees only the bytes. A shape of the stored groups
(T1 ↔ T2) changes the builder and a rebuild from the groups, display metadata untouched. An engine (SQLite ↔ redb)
changes the builder and the read function. Display metadata's encoding changes the client and a rebuild of it from the
groups.

**Recommended pair: T1 groups and V1 display metadata, both in the study's one SQLite file** (measured as a pair
below). *Corrected 2026-10-26:* as written, `grp` carried a `generation` in its key and the display row a
`view_version` and a `truth_generation`, for the retracted history. Proposed since (the design state §4): a table per
level (exam, series, instance, private) in place of `kind`, keyed by the group's UID, with the audit record beside it.

```sql
CREATE TABLE grp     (series TEXT, instance TEXT, kind INTEGER, bytes BLOB, xxh3 BLOB,
                      PRIMARY KEY (series, instance, kind));
CREATE TABLE display (series TEXT PRIMARY KEY, revision INTEGER, document BLOB);
```

* **The page open does no per-instance work:** one primary-key lookup, at 4 instances as at 2 000.
* **Integrity is the simplest of all:** the stored bytes are the hashed bytes, so a check is the hash of a blob against
  its column. *Corrected 2026-10-26:* this said the received generation keeps the parser's own hash checkable after
  any update; none is kept, so after an update the row's hash is the PACS's.
* **An update is one transaction:** the replaced group row, its audit record and that series' display metadata row
  commit together; in WAL mode the server's readers, in their own process, see before or after, never between.
* **A new client need** raises display metadata's format version and the builder rebuilds every display metadata row
  from the groups, lazily on first read or in a sweep, as Orthanc's Housekeeper and dcm4chee's scheduled update do.
* **It is what the archives converged on:** the groups kept whole, a per-series document derived from them. It keeps the
  decided one file per study, inspectable with `sqlite3`, and the engine (§3) stays a choice within one file format.
* **What it gives up:** D's 0.65 ms walk is the fastest store of the groups, but the walk is no longer on the page's path, and D
  would make us own a format, its writer, reader, checks and tools.

**Runner-up: T2 groups (DECK's row per attribute) with the same V1 display metadata, in the same file.** Every
attribute is addressable without parsing, which a read across studies (an AI pipeline) would use. It was the PCS
team's first design; their sample database of 2026-04-28 (`ba1b31a`) changed it to group blobs with copied columns,
B's shape. It costs a reassembly for every integrity check, 45 rows per instance (90 000 for a 2 000-instance CT), and
an update that rewrites rows. *Corrected 2026-10-26:* this added "and so needs the old rows kept for the parser's hash
to stay checkable"; no history is kept now. Switching from T1 to
T2 later is a rebuild of one table. Within either, redb is the engine runner-up, held back by multi-process writes
being experimental.

**The benchmark that would confirm the pair** (described only; the owner decides whether it runs). In
[`../../lab/metadata-store`](../../lab/metadata-store), from the same groups, at 4, 200 and 2 000 instances, one
thread, files in the page cache, T1 + V1 and T2 + V1 interleaved round by round with D's held scan as the reference,
300 rounds, medians:

1. **The page open:** read one series' display metadata row, opened per read and held, and check its document equals the one
   built from D's values.
2. **One update:** change one instance's window centre: write its group (T1 a new generation — run as a new revision, below — T2 its rows) and
   rebuild that series' display metadata row, committed with `fsync` in WAL at `synchronous=FULL`; time and bytes written.
3. **A new need:** add one attribute (pixel spacing) to the document and rebuild every display metadata row.
4. **Integrity:** check every group's BLAKE3 (T1 the blob, T2 reassembled); mutate one byte and watch the check fail.
5. **A reader during updates:** a second process reads display metadata rows in a loop while the first commits updates; every
   document read must be the before or the after; count the reads that waited.
6. **Size on disk** of each store.

It reports latency, not throughput, says where the host saturates, and claims nothing about a cold disk or many
sessions at once.

**Pre-registered, 2026-10-21, before it ran** (asked for by the owner through the orchestrator, 2026-10-21; this text
is committed before any number exists, and the result below is held to it). The run is the benchmark above, parts 1,
2, 4, 5 and 6; part 3 (a new need) is the rebuild inside part 2, timed apart. Three departures, each fixed now:

* **The update changes the rescale intercept**, (0028,1052), `-1024 ` ↔ `-1000 `, not the window centre: the fixture's
  CT group has no window. Same length either way, so a store's size does not drift with the rounds.
* **"Revision", not "generation"**, for a store's new version: the glossary already has "generation" for a request
  (PR #119).
* **The host is not the one of the four-store table** (a 4-vCPU Xeon at 2.10 GHz, not 2.80): D's held scan runs again
  in the same rounds as the reference, and only numbers from this run are compared with each other.

What is expected, and what would contradict it:

| Part | Expected | Contradicted if |
| --- | --- | --- |
| 1, page open, 2 000 instances, held | median ≤ 0.3 ms, below D's held scan | above D's scan |
| 1, page open, 4 instances, held | under 20 µs | over 20 µs |
| 1, opened per read | held + 0.05–0.3 ms | the gap over 0.5 ms |
| 2, one update, T1 + V1, 2 000 | 5–30 ms, the commit's `fsync` a large share | over 30 ms |
| 2, one update, T2 + V1, 2 000 | above T1 + V1 by the rebuild's scan of 90 000 rows | below T1 + V1 |
| 4, integrity | every group's BLAKE3 holds in both; one changed byte fails it | any other outcome |
| 5, a reader during updates | every document read is the before or the after; no read waits on a commit | one mixed or failed read |
| 6, size at 2 000 | T1 + V1 within 25 % of B; T2 + V1 within 25 % of C | outside |

Interleaved round by round: the five page-open arms (T1 + V1 and T2 + V1, each held and opened; D's held scan) over
300 rounds, then the two update arms over 60 rounds, at 4, 200 and 2 000 instances. One thread; the files are in the
page cache, never evicted. Medians, with p10 and p90.

**Measured, 2026-10-21** ([`../../lab/metadata-store`](../../lab/metadata-store), `--mode pair`; two runs, and a range is the
two runs' medians). One thread per arm on a 4-vCPU Xeon at 2.10 GHz, the files in the page
cache; part 5 runs a second process beside it. ext4 on the VM's virtual disk: whether its `fsync` reaches durable
storage is the VM's, not measured here. Medians; nothing is claimed for a cold disk or for many sessions at once.

| Part | 4 instances | 200 | 2 000 | Against the pre-registration |
| --- | ---: | ---: | ---: | --- |
| 1, page open, T1 + V1, held | 1.9–2.9 µs | 4.1–5.4 µs | 27–29 µs | holds: ≤ 0.3 ms, below D |
| 1, page open, T2 + V1, held | 1.9–3.0 µs | 3.9–4.0 µs | 18 µs | holds |
| 1, page open, opened per read (T1; T2 within 30 µs) | 54–90 µs | 58–62 µs | 108–117 µs | holds: held + 52–88 µs |
| 1, D's held scan, the reference | 1.2–1.9 µs | 45–46 µs | 440–456 µs | |
| 2, one update, T1 + V1 | 0.52–0.55 ms | 1.45–1.51 ms | 9.4–9.5 ms | in 5–30 ms; **the `fsync` share is contradicted** (below) |
| 2, one update, T2 + V1 | 0.45–0.46 ms | 1.45–1.66 ms | 10.2–10.4 ms | holds: above T1 + V1 at 2 000 |
| 3, the rebuild alone, T1; T2 | 0.04–0.06; 0.03–0.04 ms | 0.85; 0.88 ms | 8.8–8.9; 9.7–9.9 ms | |
| 4, every received group's BLAKE3, T1; T2 | 0.04; 0.18 ms | 0.29; 2.7 ms | 3.2; 29 ms | holds: all pass; one changed byte fails (the tests) |
| 5, documents a second process read during 60 updates that were neither before nor after | 0 of 35 287; 0 of 28 026 | 0 of 41 374; 0 of 42 906 | 0 of 47 304; 0 of 59 052 | holds |
| 5, its slowest read, T1; T2 | 0.14; 0.14 ms | 0.14; 2.9 ms | 1.0; 0.5 ms | **not shown**: see below |
| 6, size as built, T1; T2 | 24 576; 24 576 B | 299 008; 405 504 B | 2 875 392; 3 981 312 B | holds: T1 within 1 % of B, T2 +17 % over C |

* **The page open is one lookup.** Held, it reads a 95 803 B document for 2 000 instances in 18–29 µs, 15–24× below D's
  scan of the same series, and 185 B for 4 instances in 2–3 µs. Opening the file per read adds 52–88 µs, which is the
  larger cost at every size.
* **An update costs its rebuild, not its commit.** At 2 000 instances the rebuild alone is 8.8–9.9 ms of a 9.4–10.4 ms
  update, so the commit and its `fsync` are about 0.6 ms on this disk. The pre-registered "`fsync` a large share" was
  wrong here; on a disk whose `fsync` waits for media it may hold. The rebuild reads every instance's group to write
  one value, so a rebuild that patches only the changed instance's entry would remove almost all of it (not built).
* **T2 costs more where it reassembles.** Its update is 0.8–0.9 ms above T1's at 2 000, and its integrity check 9×
  T1's (29 against 3.2 ms), because each group is put back together from its rows before it is hashed.
* **A reader never saw a mixed document**, in 253 949 reads across the six arms while 60 updates committed beside it.
  Its slowest read was 2.9 ms (T2, 200 instances) where the median is a few µs. Whether that read waited on a commit
  or on the two processes sharing four vCPUs is not told apart by this run, so "no read waits on a commit" is not
  shown.
* **An update writes 12–16 KB**, not the whole 95 KB document: three or four 4 KiB pages, whatever the series size
  (`/proc/self/io` wchar). That fits SQLite rewriting in place only the pages of a same-size blob that changed; the
  mechanism is read from SQLite's behaviour, not checked in its source.
* **Kept revisions are small:** 120 updates grew T1's 2 000-instance file by 163 840 B, about one 1.4 KB group each.
  *Under the retracted model:* every arm of the pair and of its follow-up writes a new revision row per update; a row
  replaced in place, as decided on 2026-10-24/25, is not measured.

**The pair's two open items, pre-registered 2026-10-22, before they ran** (asked by the owner through the
orchestrator, 2026-10-21).

*(a) Patch instead of rebuild.* An update that rewrites only the changed instance's entry in the display metadata row: it reads
that instance's newest group (T1) or rows (T2), takes its page values, and replaces that one entry in the stored
document; the rest of the update (the new revision, one commit) is unchanged. Four arms interleaved round by round —
T1 and T2, each rebuilding and patching — over 60 rounds at 4, 200 and 2 000 instances; after every patched update the
display metadata row must equal, byte for byte, the document a full rebuild gives.

| Expected | Contradicted if |
| --- | --- |
| at 2 000, a patched update is under 2 ms, against 9.4–10.4 ms rebuilt | over 2 ms |
| at 4, patch and rebuild within 0.1 ms of each other | further apart |
| the patched row equals the rebuilt one in every round | one differs |

*(b) Does a reader wait on a commit?* The reader of part 5 again, with each read's start and end on the shared
`CLOCK_MONOTONIC`, and the writer's commit windows on the same clock. Three arms, interleaved by repetition: the
reader alone (no writer), the reader beside the writer on **another** core (pinned with `sched_setaffinity`), and both
on the **same** core. A read is counted as overlapping a commit if its interval meets a commit window. The tail is
reported (p99, p99.9, max), not only the median.

| Expected | Contradicted if |
| --- | --- |
| apart, the read tail beside commits is within 2× the tail of the reader alone | over 2× |
| on one core, the tail grows past the apart arm's: the 2.9 ms read of part 5 was CPU sharing | the same core's tail is no worse than apart |
| no read in any arm sees a document that is neither before nor after | one does |

**Measured, 2026-10-22** (`--mode pair-followup`, two runs, a range is the two runs' medians unless a column says
otherwise; the same 4-vCPU Xeon at 2.10 GHz, files in the page cache; latency only).

*(a) Patch against rebuild*, one update, 60 rounds interleaved:

| Arm | 4 instances | 200 | 2 000 |
| --- | ---: | ---: | ---: |
| T1 + V1, rebuilt | 0.33–0.44 ms | 1.41–1.53 ms | 10.1–10.2 ms |
| T1 + V1, patched | 0.32–0.44 ms | 0.62–0.65 ms | 1.61–1.67 ms |
| T2 + V1, rebuilt | 0.32–0.48 ms | 1.35–1.37 ms | 8.6–8.9 ms |
| T2 + V1, patched | 0.29–0.34 ms | 0.66–0.71 ms | 1.39–1.49 ms |

* **Holds: a patched update at 2 000 is 1.4–1.7 ms**, a sixth of the rebuilt one, and the patched display metadata row equalled a
  full rebuild byte for byte after every one of the 360 patched updates per run (120 at each size).
* **At 4 instances the two are within 0.1 ms in run 1 and not in run 2** for T2 (0.34 against 0.48 ms): contradicted
  once; at this size both are a few hundred µs and their p10–p90 overlap.
* What is left at 2 000 is the patch's parse and rewrite of the 95 803 B document and the commit; a document laid out
  so one entry can be overwritten in place would remove the first (not built).

*(b) The reader's tail*, 6 repetitions of three interleaved arms, 60 updates each (T1 + V1, 2 000 instances, rebuilt
updates as the writer); per read, µs, run 1 | run 2:

| Arm | Reads | p50 | p99 | p99.9 | max |
| --- | ---: | ---: | ---: | ---: | ---: |
| the reader alone, core 2 | 248 990 \| 262 183 | 10.6 \| 9.3 | 46 \| 35 | 119 \| 70 | 2 715 \| 2 521 |
| beside commits, reader core 2, writer core 0 | 223 589 \| 221 440 | 8.6 \| 11.0 | 37 \| 37 | 92 \| 98 | 4 135 \| 22 844 |
| beside commits, both on core 0 | 196 632 \| 188 744 | 10.5 \| 11.0 | 51 \| 54 | 3 709 \| 3 742 | 7 744 \| 8 959 |

* **Holds to p99.9: apart, a read beside commits is no slower than a read alone** (p99 37 against 35–46 µs, p99.9
  92–98 against 70–119 µs).
* **The maximum does not hold:** one read of 22.8 ms in run 2, beside commits on another core, against 2.5–2.7 ms
  alone; it overlapped a commit window. So a rare reader wait during a commit is seen, about once in 220 000 reads.
  SQLite's WAL reader retries with a growing sleep when the WAL is being reset by a checkpoint, which would explain it;
  that mechanism is read from SQLite's design, not checked in this run.
* **Holds: on one core the tail is CPU sharing.** p99.9 grows from about 95 µs to 3.7 ms when reader and writer share a
  core, so part 5's 2.9 ms read is consistent with two processes on four vCPUs, not with a commit.
* **No read in any arm saw a mixed document** (0 in 1 341 578 reads over both runs).
* Reads outside every commit window are few (7 055 and 6 487) because the writer commits back to back; their median
  is higher (31 µs), not explained here.

**One update in place against a new revision directory, measured 2026-10-24**
([`../../lab/metadata-store`](../../lab/metadata-store/README.md), `--mode update-cost`, #144, pre-registered there
first; two runs, a 4-vCPU Xeon at 2.80 GHz, files in the page cache, latency only). The patch arm above, one commit,
against the receiver draft's revision directory (`design.md` §12.5 (a): the study's file rebuilt from every kept
input, renamed in, `CURRENT` switched). Latency to visible, patched against revision: 1.08–1.59 against 7.8–9.3 ms at
200 instances, 2.30–2.86 against 34.6–38.4 ms at 2 000, 7.6–8.2 against 141–143 ms at 10 000 — 5.7–6.5×, 13× and
17× cheaper in place, past the A/A gap in both runs. A patch writes 16 480 B at the median (p90 28 840) with one
`fsync`; a revision its whole file and 7. No read of 2 010 769 was neither before nor after. Both writers are CPU on
their core; the disk is not saturated. The owner's decision of 2026-10-24/25 (updates in place, no revision
directories) agrees with it.

### 3. Which embedded engine

*Primary sources below (§Sources). All read the same file format, so a database built by one is read by the
others. Only the embedded columns apply now (Decided, above).*

| | rusqlite (plain SQLite) | libSQL embedded (`libsql`) | libSQL server (sqld) | Turso, the Rust rewrite (`turso`) |
| --- | --- | --- | --- | --- |
| what it is | the C library, bundled | a fork of SQLite's C library, in process | a server holding many databases (namespaces) behind an HTTP API | SQLite rewritten in Rust, in process |
| latest | 0.41.0, 2026-10-24, bundles SQLite 3.54.1 (*corrected 2026-10-26*; read 2026-10-19 as 0.40.2, bundling 3.53.2) | 0.10.0, 2026-10-13; bundles SQLite 3.47.0 | `libsql-server-v0.24.33`, 2025-12-19; since then one doc fix (2026-05-14) | 0.8.3 stable 2026-10-12, 0.9.0-pre.1 2026-10-15; tracks SQLite 3.50.4 |
| licence | MIT | MIT | MIT | MIT |
| state | SQLite's own | "actively maintained, but new features are being developed in Turso" (its README) | no release in 10 months: maintenance **not confirmed** | pre-1.0: "we have not yet reached 1.0 … keep independent backups" (its README's FAQ). *Corrected 2026-10-25:* this row quoted "currently in beta"; the README it pins (`fe932831cf8d`) does not say so, nor does `v0.8.3`'s |
| open read-only | `mode=ro`, `immutable=1` (SQLite's URI flags) | the same C library | — | `Builder::read_only`, from the source only, not tried |
| JSON functions | SQLite's, JSONB since 3.45 | SQLite 3.47's | the same | all but `json_tree` (partial) |
| concurrent writers | one | one | one per database | `BEGIN CONCURRENT` on MVCC; its two documents disagree on whether it is experimental |
| reach over the network | no | remote mode and embedded replicas (features `remote`, `replication`) | yes | no SQLite-protocol server; an experimental PostgreSQL-wire one |

The owner's word in target.md is "Turso". Turso also names a hosted service, Turso Cloud, which hosts both libSQL and
Turso databases (Turso's there in "early preview"); whether it can be self-hosted is **not confirmed**. A PACS's own
disk holds the study databases under the target, so the hosted service is not on this path.

* **What decides it:** how much a pre-1.0 engine may cost in a medical archive (Turso), against one that is SQLite's
  own C (rusqlite) or a fork of it (libSQL). libSQL embedded is not tested: SQLite 3.47's C with features this use does
  not ask for. The two tested follow.

#### rusqlite against Turso, tested (2026-10-25/26)

rusqlite 0.41.0 (SQLite 3.54.1, the 3.54.x line) against Turso 0.8.3 (`v0.8.3` = `607bff9`), both in process, for one
study database per study, one writer process, readers in that process or another. The evidence, with every source
line and the pre-registrations: [`lab/sqlite-engine/README.md`](../../lab/sqlite-engine/README.md) — §1–§3 the first
comparison (#147), §4 each engine at its best (#151), §5 a read beside an update in two processes (branch
`claude/sqlite-lock-behaviour`). One 4-vCPU VM, files in the page cache. *Re-measured the same day with each engine
at its best* (§4): both in `spawn_blocking`, Turso without its default features, equal engine caches, rusqlite
read-only with mmap; the rows marked *corrected* changed.

| | Mechanism | For this use case | Wins |
| --- | --- | --- | --- |
| **async** | Turso's async API does the read itself on the thread that awaits it: by default a blocking `pread`, with io_uring a blocking `submit_and_wait`; nothing reaches tokio's reactor (source). rusqlite is blocking and says so | *Measured*, 1 worker, 4 readers of a 2 000-instance series: a 1 ms heartbeat's p99 lateness is 1.8 ms idle, 3.0–3.4 ms with rusqlite in `spawn_blocking`, 11–15 ms with rusqlite or Turso called in the task; and **267 ms with Turso's default backend once its reads miss its cache**, because each read wakes its own task and defeats `yield_now` (reproduced with rusqlite by that one wake). io_uring keeps the timer on time (1.9 ms) but scans 5–8× slower, and still blocks the worker for each read. *Corrected:* Turso in `spawn_blocking` keeps the timer as rusqlite there does (p99 4.2–4.7 against 2.7–3.5 ms; the gap is CPU on a saturated host, both at idle's p50); io_uring's slowdown is tokio's page-by-page turn-taking (1.4× in reads/s), the ring itself 1.2×; the self-wake has no setting and is unchanged on Turso's `main` | **rusqlite in `spawn_blocking`**, with mmap (2.4–2.6 ms p99): what tokio prescribes for file I/O. Turso can be rescued the same way, against what its README shows; awaited as documented, its default backend is worse than plain blocking |
| **prepared statements** | both compile once and cache per connection: rusqlite 16 statements, LRU; Turso every distinct SQL text, unbounded | a handful of fixed statements per study | tie |
| **concurrency** | one writer per file in both; WAL readers beside it. Turso's `BEGIN CONCURRENT` needs MVCC, which its own manual calls not production ready | one receiver writes each study | tie; Turso's extra is not usable |
| **multi-process** | SQLite: byte-range locks and `-shm`, any number of processes. Turso: an exclusive whole-file lock per process by default, taken when the file is opened and held until the last handle drops — per handle lifetime, not per transaction | *Tested*: rusqlite, a reader process sees all 20 commits, read-write or read-only. Turso: a second read-write process cannot open; a read-only one opens and **sees none of the commits** (#4627, open); the opt-in `.tshm` mode saw all 20, but is "not production ready", with open lost-commit issues. *Corrected 2026-10-26, timed with a serving process beside a receiving one* (that README's §5): the lock fails at once with an error, which no busy timeout covers; with the receiver holding its handle, **no read is ever served**; with both opening per operation, both sides meet the error and a retry loop waits 29 ms (read) and 44 ms (update) at p99. The stale read is a *held* read-only handle's; one opened per request read fresh data but failed on 0.4 % of reads when a checkpoint truncated the WAL under it. rusqlite: a read waits only when the receiver opens and closes per package — 9 % of reads, inside `busy_timeout`, at most 4.8 ms | **rusqlite**: a serving process apart from the receiver works only with it; with Turso, one process must own each study file |
| **file format, features** | the same file format; Turso reads rusqlite's files (tested) | a SQLite reader and a Turso writer on one file block each other (tested: a Turso open fails; a rusqlite read waits until the Turso process exits); Turso: WITHOUT ROWID insert-only, no backup API, `synchronous` OFF/NORMAL/FULL | **rusqlite** |
| **durability, testing** | SQLite's own test suite; Turso: simulation and Antithesis testing, and a crash before the first checkpoint lost a new database's commits until 2026-08-07 (#8103) | the archive's metadata is the record | **rusqlite** |
| **latency, resources** | *Measured*, 1 010 open files: open and first row p50 0.9–1.7 ms against 0.9–12.9 ms (10 000 instances: 0.9–2.7 against 13–15 ms); **RSS per open file 187 KiB against 2 181 KiB** (two 3 MiB `MADV_HUGEPAGE` arenas per Turso database); descriptors 3 against 2; held read p50 15–21 against 18–20 µs. *Corrected:* the 2 MiB is the host's transparent huge page, not mimalloc or tantivy (the lean build holds 2 174 KiB): with THP off for the process Turso holds **130 KiB** and opens in 1.0–1.2 ms (10 000 instances 1.0–1.9). With the file in both caches, rusqlite scans 2.2× faster; mmap another 1.9× on a forced read | the server may hold many studies open | **rusqlite** on scan CPU and held reads (1.2–1.3×); memory and open *corrected* to a tie or Turso's, but only with the host's huge pages off, which Turso does not document |
| **scaling to many files** | per file: a C connection against a Turso `Database` with its own I/O backend and arenas | 1 000 open studies: about 180 MiB against 2.1 GiB. *Corrected:* against 130 MiB with THP off; io_uring with a ring per file 6.5 GiB, one shared ring as the default backend | **rusqlite** on a THP-`madvise` host; otherwise a tie |
| **maturity** | SQLite 3.54; Turso pre-1.0, "keep independent backups"; its MVCC and multi-process modes not production ready by its own manual | a medical archive | **rusqlite** |
| **extras** | Turso: MVCC, vector and full-text search (tantivy, on by default, with mimalloc as the process's allocator), encryption, an async API | none of them is asked for here | Turso, unused |

**Bottom line, proposed (the owner has not decided): rusqlite, called through `spawn_blocking` (or a small blocking
pool) from the async server.** Turso
wins nothing this use case asks for and loses on the three that decide it: its async API blocks the worker that
awaits it (worse than a blocking call, once its cache misses), a second process cannot read a study a Turso process
writes, and it holds 11.7× the memory per open study. *Corrected 2026-10-25, each engine at its best:* the verdict
stands, on narrower grounds. Turso in `spawn_blocking` no longer blocks the worker, and its memory per open study is
the host's huge-page policy (130 KiB with THP off, below rusqlite's 185); what remains is the multi-process row, which
no setting moves, maturity, and about twice the CPU per scan (rusqlite read-only with mmap: heartbeat p99 2.4 against
4.7 ms, held read p50 21–23 against 24–28 µs). Deploy rusqlite read-only with `mmap_size` above the file size. *Checked 2026-10-26* (a read beside an update in two processes): the multi-process row is not a short wait but a
refusal for as long as the receiver holds its handle; Turso would need one process per study file (or IPC to it),
or an open-per-operation retry loop on both sides; the verdict stands. Not measured: a cold disk (by the source it lengthens the
blocking in every direct arm, and leaves `spawn_blocking`'s worker free), more than 4 readers or 2 workers.

* **Switching later:** cheap while two rules hold — the file stays plain SQLite format, and the SQL stays in the
  dialect all of them share. The reads sit behind one function that takes UIDs and returns the viewer's document;
  switching is that function and the dependency.

### 4. What the client fetches

The principle is decided: only what the page needs now. What remains open:

* **The unit:** one series (today) or the whole study. It follows what the viewer opens; it opens one series today.
* **Its size across the band:** with `digests` moved into the `.sbnd` entry ([`../disk-layout/target.md`](../disk-layout/target.md)
  §The two hashes), a series whose display does not vary per frame is a few hundred bytes at any frame count; per-frame
  rescale or window grows with frames. **Measured:** PORD's ~120 KB cost the connection +7 / +29 ms at 80 / 160 ms.
* **Caching:** today it is `no-cache`; a revision number in the study database lets a reopened page check its copy
  in one round trip.

### 5. Moving fixtures, the dev host and the gate off the JSON file

* **Fixtures.** Keep the committed JSON (text, reviewable in a diff) as the *input* the study database is built from,
  and build the database in the gate and at the dev host's start; or commit the built `.db` (binary, no build step).
  What decides it: whether a reviewer must read a fixture's metadata in a diff.
* **The dev host.** Under 1A it reads the database with Python's `sqlite3`; under 1B it serves no metadata.
  `--metadata` goes either way.
* **The gate.** The `pack-series` same-bytes check (`scripts/gate.sh:180`) packs `metadata.json` into the `.sbnd`;
  under the target it packs none, so that check changes with the target's format, not with this work.
  `deploy/check_equivalence.sh` lists `/series/metadata` among what the image answers; it goes with the JSON.
* **The lab.** `lab/container-bench` and `lab/viewer-ceiling` read the ingest's `metadata.json` as their input. It
  stays the ingest's output, so the lab keeps it.

## What the owner decides, in order

1. How the page gets the metadata and the codec (§1): open with viewer metadata (the design state §6); the codec may
   come from the study index (2026-10-24).
2. The groups' storage shape (§2): T1 proposed, measured; shared plus per-instance values open.
3. The engine (§3): rusqlite proposed, measured.
4. The unit the page fetches (§4).
5. Fixtures as JSON input or a committed `.db` (§5).

## Sources

Fetched 2026-10-19, first 12 hex of the fetched file's sha256.

* **SQLite**: "35% Faster Than The Filesystem" (`2cba6be472d2`, the same as design.md §12); "How To Corrupt An SQLite Database File" (`e00709e3f37e`), §1.3 and §2.5; URI filenames, `immutable`
  and `mode=ro` (`9fba2ee18bc6`); WAL (`f3467b530b88`, the same as design.md §12).
* **The parser**: `github.com/opendicom/DECK_WebTransport` at `f36230b3f46c` (2026-10-16), read and run as
  [`contract.md`](contract.md) §The parser at `f36230b` records.
* **rusqlite** 0.40.2 on crates.io (`43b0cec6bd46`), its bundled `sqlite3.h` (`9e69a1353a42`), LICENSE
  (`c10c1f273375`).
* **libSQL** at `d8bc862d20be` (2026-10-13): README (`5a7d05bd5b34`, the same as design.md §12), `libsql/Cargo.toml`
  (`c9393a164fca`), `docs/ADMIN_API.md` (`a45a5003fa4a`); `libsql` on crates.io (`2c4b345f6b82`); Turso's docs,
  `libsql.md` (`ea0bd1401325`). sqld's last tag and commit from the repository's git history.
* **Turso** at `f9c3d9045c71` (2026-10-19): README (`fe932831cf8d`, the same as design.md §12), COMPAT.md
  (`28a771b01162`), `docs/manual.md`, `bindings/rust/src/lib.rs` lines 284–342; `turso` (`99f8bf2b2551`),
  `turso_core` (`cc08a07a0f95`) and `limbo` (`b365420bb9c7`) on crates.io. Turso Cloud: `turso-cloud.md`
  (`6f75c718aecf`), usage and billing (`b975c2fcfd32`); the pricing page could not be fetched.

Read 2026-10-25 for §3's rusqlite against Turso, each cited by file and line in
[`lab/sqlite-engine/README.md`](../../lab/sqlite-engine/README.md): Turso's source at tag `v0.8.3` (`607bff9fd0e5`), its
issues #4627, #7995, #8536, #9362, #10114, #10314 and PR #8103 on GitHub; `rusqlite` 0.41.0 and `libsqlite3-sys`
0.39.1 as cargo fetched them; tokio 1.54.1's source, docs.rs and the tokio.rs tutorial; ryhl.io, "Async: What is
blocking?".

Fetched 2026-10-20 for §2's survey, first 12 hex of the fetched file's sha256. Raw copies are not committed. A
crates.io entry is its API's JSON (`https://crates.io/api/v1/crates/<name>`), whose download counts change, so its hash
pins the read, not the crate.

* **SQLite** pages: generated columns (`bfeda4cc84fe`), JSON (`bca8f665a03a`, the same as design.md §12), JSONB
  (`7e4563721e62`), `WITHOUT ROWID` (`0e5e50ba91f7`), isolation (`23395653f049`), WAL (`f3467b530b88`, the same as
  above), internal and external blobs (`7977fddc6682`), the checksum VFS (`39559263a54e`), release history
  (`50e63c6da18d`). `rusqlite` on crates.io (`23de2c90d823`).
* **redb** at `6b2d24eb9a02`: README (`23400cd94b12`), `design.md` (`944c21209038`), CHANGELOG (`a463cea1e1a0`);
  crates.io (`15bc9c22e1e6`).
* **LMDB**: `lmdb.h` at tag `LMDB_0.9.36` (`f5282169fed4`) and at the 1.0 branch's `f437e48ccf42` (`90d3c8818169`),
  LICENSE at `LMDB_0.9.36` (`310fe25c858a`). **heed** at `d2252a0eed61`: README (`4e46e42f8c32`), `heed/Cargo.toml`
  (`8fae5d077519`), `lmdb-master-sys/Cargo.toml` (`cee91d7df0e3`); crates.io `heed` (`7f250feb26bf`), `heed3`
  (`9785f2fb1543`), `lmdb-master-sys` (`23ff03c86f4d`).
* **fjall** at `2744f347420b`: README (`1c55025ba595`); `lsm-tree` at `72b344163073`: README (`fd588a4d7533`);
  crates.io `fjall` (`aef07adde97e`), `lsm-tree` (`bf7a7705f290`).
* **sled** at `e449d17111f4`: README (`bdb4a0c55bd3`); crates.io (`7729fe7e4f34`).
* **Sorted tables**: LevelDB at `bb74ef739973`, `doc/table_format.md` (`16f96b651b8e`), `doc/impl.md`
  (`340b4dd78186`), `doc/index.md` (`bd96bc81dacb`); crates.io `sstable` (`87427b816b9b`), `fst` (`24f85f3d6f9b`),
  `memmap2` (`1ebccfe98eb8`).
* **Zero-copy**: rkyv at `d963abc24301`, README (`296e729cb0ac`), `book_src/feature-comparison.md` (`6c9a09549541`),
  `book_src/faq.md` (`f8d00444571b`), `book_src/validation.md` (`51a347be019a`), `book_src/format.md`
  (`c78b649835ff`); FlatBuffers at `b8431fbcd7a5`, the schema evolution page `source/evolution.md` (`8ec4dfa0a1ab`)
  and `source/internals.md` (`82e394484c02`) under its documentation directory; Cap'n Proto at `a7c37e11a6ab`,
  `doc/language.md` (`e7c4b54bb1a5`), `doc/encoding.md` (`2384b3294298`); crates.io `rkyv` (`85623ec495b2`),
  `flatbuffers` (`831aeec9c3a4`), `capnp` (`f2da8af9e1a8`).
* **Columnar**: Arrow at `ee382216db4f`, the columnar format specification `Columnar.rst` (`f7291ce8562f`);
  parquet-format at `53b8bd857682`, README (`692afb37e07e`); crates.io `arrow-ipc` (`4c494efc8386`), `parquet`
  (`a7a501b0217c`).
* **DECK** at `0b1169e98d09` (2026-10-20's `main`, after the `f36230b` read in [`contract.md`](contract.md)):
  `doc/DECK/databases/README.md` (`23f367835d3b`), `doc/DECK/ordered contextual-keys format.md` (`b20e46ac4a7b`), the
  top README (`42b5443f7f1a`). `doc/DECK/README.md` does not exist at that commit.
* **Orthanc** book: main DICOM tags (`7042e11711b9`), the DICOMweb plugin (`6ce73c1ece9a`), storage FAQ
  (`daccaab883ba`, the same as design.md §12); `OrthancServer/Sources/Database/PrepareDatabase.sql` from the
  `default` branch, whose tip was `bb6c9baf347d` (`39ecf6249b6f`; a fetch by that revision was refused, so the pin is
  the branch at the time).
* **dcm4chee-arc-light** at `74e0c73c3312`: `AttributesBlob.java` (`08b01178af21`) and `Series.java`
  (`4891aeacaaa1`) under `dcm4chee-arc-entity`; the archive device configuration (`33ecad8ae7b0`).
* **AWS HealthImaging** developer guide: getting image set metadata (`b14720a1699e`, the same as design.md §12),
  updating it (`52bbde235762`).
* **Google Cloud Healthcare API**: `series.updateMetadata`, v1beta1 (`d4da53bad285`); the DICOM conformance statement
  (`ad1667977db5`).
* **OHIF** at `5a78dac37797`: `DicomWebDataSource/index.ts` (`4e2d993ec276`), `DicomMetadataStore.ts`
  (`1bb16e52313d`). **Static DICOMweb** at `1a38951e2972`: README (`289e453d2106`), `file-structure.md`
  (`a608aedf8d7b`).
