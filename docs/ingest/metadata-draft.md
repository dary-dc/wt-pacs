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
* [`design.md`](design.md) §5 (d): one SQLite database per study, built at the PACS from the parser's groups, so bad
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

## The open points

Each with its options, what decides between them, what each costs now, and what switching later costs.

### 1. Who serves the metadata

| | A. The web host reads the database | B. The server, over HTTP behind the web host | C. The server, inside the WebTransport session |
| --- | --- | --- | --- |
| how | a small reader beside nginx (nginx cannot read SQLite); dev-server.py with Python's `sqlite3` | a read endpoint in the Rust process; nginx proxies `/study/…/metadata` to it | a new message on the wire after the dial |
| who opens the databases | a second process | the process that already opens the `.sbnd` | the same |
| page-open path | unchanged: a fetch before the dial | unchanged | the codec is known only after the dial, so the decoder's preload waits a round trip or more |
| cost now | a second program to deploy and secure | an HTTP listener in the server (whether wtransport can answer a plain HTTP/3 GET is not checked) | [`../WIRE.md`](../WIRE.md), both clients, the contract suite |

* **What decides it:** whether one process should own every read of the study's files (B, C), and whether the decoder
  must be chosen before the dial (A, B). Across the band of sessions per host it does not change: the read is one
  small query per page open, against a fill of megabytes.
* **Switching later:** A ↔ B is a proxy line, because the page's URL and the JSON stay the same. Either → C rewrites
  the wire and both clients, and back again the same.
* **Leaning:** B, for one owner of the study's files and no wire change. Unmeasured.

### 2. Which engine reads the databases

*Filled from primary sources below (§Sources); the file format is the same for all four, so a database built by one
is read by the others.*

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

* **What decides it:** whether the study databases are on the disk of the host that reads them (embedded is enough)
  or must be reached by several hosts over the network (a server, or a hosted service); and how much a pre-1.0 engine
  may cost us in a medical archive.
* **Switching later:** cheap while two rules hold — the file stays plain SQLite format, and the SQL stays in the
  dialect all four share. Each engine's Rust API differs, so the reads sit behind one function that takes UIDs and
  returns the viewer's document; switching is that function and the dependency.

### 3. The schema for what the viewer needs

| | A. Columns for what the viewer reads | B. The parser's groups as stored, and a view that builds the viewer's document | C. One JSON column per series, the document as today |
| --- | --- | --- | --- |
| tables | `series` (codec, frame count, photometric, cine timing, default rescale and window), `frame` (rescale, window where they vary) | the groups, one row per instance and group, plus a view | `series(uid, document)` |
| a new viewer key | a migration of every study database | a change to the view, no rebuild | a rebuild from the groups |
| queryable | yes | yes, through SQLite's JSON functions | weakly |

* **What decides it:** how often the viewer's needs change, and what must be queried in SQL rather than handed to the
  page whole. A changes the stored shape each time; B keeps the stored shape the parser's and moves the change into
  a view; C is today's file inside a database, and does not use the database.
* **What is settled either way:** `digests` leave the metadata for the `.sbnd` entry (target.md §The two hashes).
  Patient and study identifiers are not sent to the viewer today; sending them is a separate decision, not part of
  this schema.
* **Switching later:** A → B or B → A is a rebuild of every study database from its groups, which the design already
  allows (§5: a rebuilt database re-registers by the same upsert). The page's document does not change.
* **Leaning:** B. The cost of building the document at each read is unmeasured; it is one small query.

### 4. How a study database is built, published and replaced

| | A. Rebuild whole, publish by rename | B. Update in place |
| --- | --- | --- |
| how | build `study.db.partial` with the journal off WAL, `fsync`, `rename`, `fsync` the directory — as the `.sbnd` | transactions on the published file, WAL mode |
| readers during a replace | a reader that has the old file open keeps reading it whole; the next open sees the new one | snapshot reads; one writer at a time |
| what readers must do | open read-only with `immutable=1`, which is true because a published file never changes | open normally, with the `-wal` and `-shm` files beside it |
| copy to another host | copy one file | needs replication (the libSQL server's or Turso's) |
| risk | none from SQLite's list if a published file is never written | renaming or deleting a database or its WAL while a writer holds it is on SQLite's list of ways to corrupt one (§2.5, §1.3) |

* **What decides it:** how often a study changes after it is first published — late instances, corrections (design.md
  §10, decisions 1 and 6, still open) — and whether the database is read on another host.
* **Switching later:** A → B is a change in the writer and the readers' open flags; no stored data changes.
* **Leaning:** A: one publishing rule for both the `.sbnd` and the database, and a reader never coordinates with a
  writer. A server that keeps a database open notices a replace by the generation (point 5) or the file's inode.

### 5. The catalog, and its consistency with the study databases

**Already decided, not reopened:** the catalog's engine is deferred (the owner, 2026-10-11: a far-away decision); it
is a separate server (MySQL or PostgreSQL, not embedded); the study database is the truth and the catalog is derived
from it by a generation upsert (design.md §5).

**What this work needs from it: nothing on the page-open path.** With files at `<StudyUID>/`, the server finds a
study's database by its UID, with no catalog lookup. The one thing to build now so the catalog can come later
unchanged: each study database carries its generation, which the upsert reads.

* **Switching later:** none to pay; the catalog is added beside, not under, this path.

### 6. What the client fetches, and when

| | A. One series' document, at page open, as today | B. The whole study's document | C. Two steps: what to paint first, then the rest |
| --- | --- | --- | --- |
| when | before the dial, beside the transport file | the same | the first before the dial, the rest after |
| size | grows with frames only where rescale or window vary per frame | every series of the study | the first is constant |

* **What decides it:** whether the viewer opens a series or a study (it opens one series today), and how large a
  per-frame document grows across the band — mammography's 4 frames to CT's 2 000. With `digests` gone, a series
  whose display does not vary per frame is a few hundred bytes at any frame count.
* **Caching:** today `/series/metadata` is `no-cache`; with a generation, an `ETag` of it lets a reopened page
  revalidate in one round trip instead of fetching the document again.
* **Switching later:** A → B or C is a change to head.js and the endpoint, not the database. Measure first: PORD's
  +7 / +29 ms is for ~120 KB; a smaller document is expected to cost less, unmeasured.
* **Leaning:** A, with the URL naming the study and the series.

### 7. Moving fixtures, the dev host and the gate off the JSON file

* **Fixtures.** Keep the committed JSON (text, reviewable in a diff) as the *input* the study database is built from,
  and build the database in the gate and at the dev host's start; or commit the built `.db` (binary, no build step).
  What decides it: whether a reviewer must read a fixture's metadata in a diff.
* **The dev host.** Under 1A it reads the database with Python's `sqlite3`; under 1B it proxies to the server as nginx
  does. `--metadata` goes either way.
* **The gate.** The `pack-series` same-bytes check (`scripts/gate.sh:180`) packs `metadata.json` into the `.sbnd`;
  under the target it packs none, so that check changes with the target's format, not with this work.
  `deploy/check_equivalence.sh` lists `/series/metadata` among what the image answers; the new URL replaces it.
* **The lab.** `lab/container-bench` and `lab/viewer-ceiling` read the ingest's `metadata.json` as their input. It
  stays the ingest's output, so the lab keeps it.

## What the owner decides, in order

1. Who serves the metadata (§1).
2. The engine (§2), within the rule that the file stays SQLite format.
3. The schema's shape (§3).
4. Rebuild-and-rename or update in place (§4).
5. What the page fetches (§6).
6. Fixtures as JSON input or a committed `.db` (§7).

## Sources

Fetched 2026-10-19, first 12 hex of the fetched file's sha256.

* **SQLite**: "How To Corrupt An SQLite Database File" (`e00709e3f37e`), §1.3 and §2.5; URI filenames, `immutable`
  and `mode=ro` (`9fba2ee18bc6`); WAL (`f3467b530b88`, the same as design.md §12).
* **rusqlite** 0.40.2 on crates.io (`43b0cec6bd46`), its bundled `sqlite3.h` (`9e69a1353a42`), LICENSE
  (`c10c1f273375`).
* **libSQL** at `d8bc862d20be` (2026-10-13): README (`5a7d05bd5b34`, the same as design.md §12), `libsql/Cargo.toml`
  (`c9393a164fca`), `docs/ADMIN_API.md` (`a45a5003fa4a`); `libsql` on crates.io (`2c4b345f6b82`); Turso's docs,
  `libsql.md` (`ea0bd1401325`). sqld's last tag and commit from the repository's git history.
* **Turso** at `f9c3d9045c71` (2026-10-19): README (`fe932831cf8d`, the same as design.md §12), COMPAT.md
  (`28a771b01162`), `docs/manual.md`, `bindings/rust/src/lib.rs` lines 284–342; `turso` (`99f8bf2b2551`),
  `turso_core` (`cc08a07a0f95`) and `limbo` (`b365420bb9c7`) on crates.io. Turso Cloud: `turso-cloud.md`
  (`6f75c718aecf`), usage and billing (`b975c2fcfd32`); the pricing page could not be fetched.
