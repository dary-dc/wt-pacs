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

* **What decides it:** one program reading the study's files (B) against the metadata before the connection (A); with
  b, B no longer costs the decoder's round trips.
* **Leaning:** B with b, unmeasured: one owner of the files, and only the needed decoder loads before the connection.
  What it would cost is the time to the metadata after the connection, which is not measured.

### 2. How the parser's groups are stored

The parser writes each group (exam, series, instance, private) as one run of records
([`contract.md`](contract.md) §Group files), named by its BLAKE3. A study's groups are kilobytes
(§Sizes there). The question is the shape the PACS serves them from.

| | A. The group files as written | B. Groups as blobs in SQLite, with columns taken out | C. One row per attribute (DECK's key-value) | D. A pattern search over the blobs |
| --- | --- | --- | --- | --- |
| what is stored | the parser's directory, untouched | each group whole, plus a column for each attribute that is queried or served | `(key BLOB PRIMARY KEY, value) WITHOUT ROWID`, DECK's ordered keys (`doc/DECK/databases`) | B's blobs, nothing taken out |
| the viewer's read | open and parse every instance's group | read the columns | a key-range read per instance, picking the tags | scan the series' blobs for the tags |
| a new client need | parse more | a new column, so a rebuild from the blobs | nothing: every attribute is already a row | a new pattern |
| the BLAKE3 check | per file, as written | per blob, as written | lost unless the group is put back together | per blob |
| the parser's own shape | its directory output | `doc/PACS/db/deck.db` | `memorysqlite` and its databases README | none |

* **What decides it:** what is read most. The page reads a dozen attributes for every instance of one series; a CT is
  2 000 instances. A shape that reads those directly (B's columns) does the least work per page open. A shape that
  stores every attribute addressably (C) makes the next client need free. SQLite has no regular expressions built in
  (D would need a function from the server); a scan of a study's kilobytes is cheap, of 2 000 groups unknown.
* **Leaning:** B, unmeasured. The blobs keep the parser's bytes and their BLAKE3 checkable, and the columns are an index
  derived from them, rebuilt when a need is added. It is also the parser's own `deck.db` shape.
* **What would decide it with numbers:** a 2 000-instance CT series from the parser's groups, stored as A, B and C:
  the time to build the viewer's document and the database's size. SQLite's "35 % Faster Than The Filesystem" page measured
  100 000 blobs of ~10 KB read 35 % faster from one database than from files (about 5× on Windows 10); its numbers,
  not ours.
* **Switching later:** every shape is rebuilt from the groups, so a switch is a rebuild at the PCS, not lost data.

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
2. The groups' storage shape (§2), after its measurement if wanted.
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
