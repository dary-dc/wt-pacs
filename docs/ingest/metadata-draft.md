# Metadata from the study database: the purpose and the open points (draft)

*A draft for the owner's review, 2026-10-19. Nothing here is built and nothing is timed unless it says
**measured**. Once a design is agreed, its text moves into the file that owns it — [`design.md`](design.md) §5 for
the study database and the catalog, [`../disk-layout/target.md`](../disk-layout/target.md) for what sits on disk,
[`../CLIENTS.md`](../CLIENTS.md) for what the page fetches — and this file is removed.*

## Why

**The need.** A viewer has to know, before it paints a frame, how many frames there are, which codec they are in,
how to turn samples into grey levels (photometric, rescale, window), and how fast a cine plays. Today that arrives
as one JSON file. Two decisions already taken make that file go away:

* [`../disk-layout/target.md`](../disk-layout/target.md): no metadata in or beside the `.sbnd`; it lives only in the
  per-study database, one copy, where it is queried.
* [`design.md`](design.md) §5 (d): one database per study, built from the parser's groups (at the PCS since 2026-10-19), so bad
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
* **The study database is built at the PCS**, the machine that parses and packs; the PACS checks everything that
  arrives and serves it. When a series or a study is complete is the PCS's question ([`design.md`](design.md) §5).
* **The client loads only what it needs**: the metadata the page uses now, and only the decoder of the series' codec.
  More is sent as more client features need it.
* **The parser's contract of 2026-10-11 stays** until a stable version is published
  ([`contract.md`](contract.md) §The parser at `f36230b`).
* **Whether SQLite is the store at all is open.** The parser's output comes first: [`contract.md`](contract.md)
  §The parser at `f36230b` records it.
* **Parked:** how a study database is replaced while it is read (it matters once studies change after they are first
  published), and the catalog (deferred on 2026-10-11).

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
| d. load every decoder | — | refused: the client loads only what it needs |
| e. from the series file's header | the `.sbnd` header names the codec ([`../disk-layout/target.md`](../disk-layout/target.md) §The header); the server sends it first in the session | after the connection, as c, but the codec is written once |

**Open, the owner (2026-10-19):** whether a worklist should know the codec at all, and whether the codec should be
written in two places (the `.sbnd` header and the metadata) or read only from the file (e). Not decided.

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

**B. Groups whole in SQLite, plus columns copied out of them.** The parser's `deck.db` shape, trimmed:

```sql
CREATE TABLE instance (iuid TEXT PRIMARY KEY, suid TEXT, number INTEGER, photometric TEXT,
                       slope REAL, intercept REAL, grp BLOB, blake3 BLOB);
-- one row:  'HB494Az5…', 'HB494Az5H3…', 1, 'MONOCHROME2', 1.0, -1024.0, <the 1 427 B group>, 0f2469da…
SELECT number, photometric, slope, intercept FROM instance WHERE suid = ? ORDER BY number;
```

The columns hold values that are also inside `grp`, copied out at build time so the read needs no parsing. They are
derived, like a book's index: the blob stays the truth, and the columns can be thrown away and rebuilt from it. A new
client need is a new column, filled again from the blobs of every study.

**C. One row per attribute.** DECK's key-value table (`doc/DECK/databases/README.md`):

```sql
CREATE TABLE kv (key BLOB PRIMARY KEY, value BLOB) WITHOUT ROWID;
-- one row per record:  x'2080010080010000 0028105244530000', '-1024 '
SELECT key, value FROM kv WHERE key >= :instance || x'00280000' AND key < :instance || x'00290000';
```

Keys sort by series, instance, then tag, so the page's tags of one instance (all in group 0028) are one contiguous
range, read in one step through the table's B-tree; a series is one such range per instance. Every attribute is
addressable, so a new client need is a new key list, with nothing rebuilt.

**D. A key file searched directly, with the values apart.** No database engine: the PCS writes two files per study,
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
  build at the PCS; a cold disk; CPU at many sessions.

* **Switching later:** every shape is rebuilt from the groups, so a switch is a rebuild at the PCS, not lost data.

**Integrity under C and D.** The parser's BLAKE3 covers a whole group. C and D keep it checkable: the group's bytes are
its records in key order, so the PACS writes them back to back and hashes them on arrival — the same bytes, the same
BLAKE3 — then stores the rows. That proves the content equals what the parser wrote. A hash of the whole database
file is cheap (BLAKE3 runs at gigabytes a second; design.md §6 puts a 10 KB group at ≈ 1.5 µs) but proves only that the
file arrived as it left the PCS: the same rows can be stored as different file bytes (page layout, free pages, the
SQLite version), so it cannot be compared with anything the parser computed. Both have a use: the file's hash for the
transfer, the groups' for the content, and SQLite's `PRAGMA integrity_check` for the file's structure.

### 3. Which embedded engine

*Primary sources below (§Sources). All read the same file format, so a database built by one is read by the
others. Only the embedded columns apply now (Decided, above).*

| | rusqlite (plain SQLite) | libSQL embedded (`libsql`) | libSQL server (sqld) | Turso, the Rust rewrite (`turso`) |
| --- | --- | --- | --- | --- |
| what it is | the C library, bundled | a fork of SQLite's C library, in process | a server holding many databases (namespaces) behind an HTTP API | SQLite rewritten in Rust, in process |
| latest | 0.40.2, 2026-08-08; bundles SQLite 3.53.2 | 0.10.0, 2026-10-13; bundles SQLite 3.47.0 | `libsql-server-v0.24.33`, 2025-12-19; since then one doc fix (2026-05-14) | 0.8.3 stable 2026-10-12, 0.9.0-pre.1 2026-10-15; tracks SQLite 3.50.4 |
| licence | MIT | MIT | MIT | MIT |
| state | SQLite's own | "actively maintained, but new features are being developed in Turso" (its README) | no release in 10 months: maintenance **not confirmed** | pre-1.0, "currently in beta"; "keep independent backups" (its README) |
| open read-only | `mode=ro`, `immutable=1` (SQLite's URI flags) | the same C library | — | `Builder::read_only`, from the source only, not tried |
| JSON functions | SQLite's, JSONB since 3.45 | SQLite 3.47's | the same | all but `json_tree` (partial) |
| concurrent writers | one | one | one per database | `BEGIN CONCURRENT` on MVCC; its two documents disagree on whether it is experimental |
| reach over the network | no | remote mode and embedded replicas (features `remote`, `replication`) | yes | no SQLite-protocol server; an experimental PostgreSQL-wire one |

The owner's word in target.md is "Turso". Turso also names a hosted service, Turso Cloud, which hosts both libSQL and
Turso databases (Turso's there in "early preview"); whether it can be self-hosted is **not confirmed**. A PACS's own
disk holds the study databases under the target, so the hosted service is not on this path.

* **What decides it:** how much a pre-1.0 engine may cost in a medical archive (Turso), against one that is SQLite's
  own C (rusqlite) or a fork of it (libSQL).
* **Switching later:** cheap while two rules hold — the file stays plain SQLite format, and the SQL stays in the
  dialect all of them share. The reads sit behind one function that takes UIDs and returns the viewer's document;
  switching is that function and the dependency.

### 4. What the client fetches

The principle is decided: only what the page needs now. What remains open:

* **The unit:** one series (today) or the whole study. It follows what the viewer opens; it opens one series today.
* **Its size across the band:** with `digests` moved into the `.sbnd` entry ([`../disk-layout/target.md`](../disk-layout/target.md)
  §The two hashes), a series whose display does not vary per frame is a few hundred bytes at any frame count; per-frame
  rescale or window grows with frames. **Measured:** PORD's ~120 KB cost the connection +7 / +29 ms at 80 / 160 ms.
* **Caching:** today it is `no-cache`; a generation number in the study database lets a reopened page check its copy
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

1. How the page gets the metadata and the codec (§1).
2. The groups' storage shape (§2), after its measurement if wanted; the codec's place (§1) is open with it.
3. The engine (§3).
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
