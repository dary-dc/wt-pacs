# lab/study-index — the study index, prototyped and timed

The study index of [`docs/adr/study-index.md`](../../docs/adr/study-index.md) (#146), built on MySQL 8.4 and run
through its §11 protocol as amended below. It is a prototype for measurement and touches no product code. The crate
has its own `[workspace]` and stays outside `scripts/gate.sh`.

## What is built

| file | what |
| --- | --- |
| `schema.sql` | §4's study and series tables, list-time fields only. Text columns use the server default `utf8mb4_0900_ai_ci`; UIDs, keys and codes are `ascii_bin` |
| `src/index.rs` | the upsert: one transaction per study, `SELECT … FOR UPDATE` on its revision, applied only when the incoming revision is **higher**, the series replaced whole; READ COMMITTED |
| `src/receiver.rs` | a stand-in study DB per study (SQLite, WAL, `synchronous=FULL`) whose commit inserts its **outbox row in the same transaction**; the publisher (in order, retries with backoff 10 ms → 1 s); the reconcile job; deletion as a tombstone |
| `src/api.rs`, `src/query.rs` | `GET /studies` and `GET /studies/{uid}/series`, shaped like QIDO-RS Search, PS3.18 JSON, `limit`/`offset`, `Cache-Control: no-store`. Access keys come from the bearer token, never from the query. `Server-Timing` carries `db` and `app` |
| `src/gen.rs` | the seeded generator (§Data) |
| `src/bench.rs`, `src/main.rs`, `src/sync.rs` | the load, the brute-force check, the sync scenarios |
| `src/forward.rs` | the emulated hop: two TUN devices and a fixed one-way delay. The kernel has no netem, as in #156 |
| `run.py` | the rig: MySQL in network namespace `idx`, one API process per (size, arm), restarts, the campaign |
| `tuned.sql` | the tuned shape (§Arms) |
| `src/engine.rs`, `src/pg.rs`, `src/lite.rs` | §Engines: the index behind one interface on MySQL, PostgreSQL 18 or SQLite; the same upsert on each |
| `pg.sql`, `pg_indexes.sql`, `lite.sql`, `lite_indexes.sql` | §Engines: the schema and the tuned indexes on PostgreSQL and on SQLite |
| `mutate.sh` | nine deliberate breakages; the tests must catch each |

**Revision, not generation.** #146 calls the study's version a *generation*. [`docs/glossary.md`](../../docs/glossary.md)
already gives *generation* to a request's identity, so this prototype says **revision**, which is also the owner's
word in `docs/ingest/pacs-receive-design.md` §7 on `claude/pacs-design-state` (`e699ed3d`).

**The outbox lives in the study DB.** #146 §7 puts it in one intent file per host and writes the intent before the
study DB commit. Here the outbox is a table inside each study DB, written in the receiver's own transaction, so
intent and truth commit together. A tombstone keeps a deletion's intent until it is published.
§Results says what this costs.

## Pre-registration (amends §11; committed before any recorded run)

Smoke runs of one round were made while the rig was built and then discarded. They found two rig faults: the
driver's default connection reset re-prepared every statement, and an unloaded buffer pool passed for "warm". They
also suggested the tuned shape below. The tuned shape was therefore chosen on this same data, and its result does
not test it independently.

**Engine.** MySQL 8.4.6 Community, the generic Linux "minimal" tarball (sha256 `f284b17b…c42e`), with `libaio`
from Ubuntu. MariaDB was not needed. Settings are printed to `results/settings.txt`. The buffer pool is 8 GiB; its
dump at shutdown and load at start are **off**, and `O_DIRECT` is the default, so a restart is cold from disk. The
binary log is on, with `sync_binlog=1` and `innodb_flush_log_at_trx_commit=1`. The amendments to §11:

* **Arms dropped:** PostgreSQL 18 and SQLite. ~~The owner chose MySQL on 10-25.~~ **Corrected 2026-10-26:** that
  sentence attributed to the owner a choice the owner had not made. The owner, 2026-10-26: "I suggested in biased you
  that it was going to be MySQL for that study index database, but I'm not really sure. Perhaps an agent can do some
  investigation to be sure that it's what better fits our use case." The two arms are run in §Engines below.
  **Size dropped:** 10⁴, kept only for the collation mutation.
* **Frame-read interference not run**: the PACS server is not part of this rig. It stays open for the co-located case.
* **Added:** the network hop, a tuned shape, an extra low-selectivity name cell, and §Sync.

**Data.** `gen.rs` with seed 105 (10⁵) and seed 106 (10⁶):

* 20 sites (access keys) sized by Zipf s = 1, so the largest holds about 28 %; three hosts at 50/30/20 %.
* Patients with a geometric number of studies (mean ≈ 2.5). Names are `Family1 Family2^Given [Given2]`, drawn by
  Zipf from 150 Spanish surnames (4 % foreign) and 60 given names. 60 % of sites write ASCII capitals without
  accents (`PEREZ GARCIA^JUAN`), the rest mixed case with accents.
* Study dates over 12 years, each year 0.82 of the next's volume, weekends at 0.35. Times mostly 07–19 h.
* Modalities by a fixed mix (CR 22, CT 20, US 15, DX 12, MR 12, MG 8, …), with per-modality series counts: CT 3–12
  plus a dose SR, MR 5–15, CR 1–3, and so on. This gives **4.85 series a study, not §11's ~8**.
* Enhanced multiframe counts. Codec `AV01` for 40 % of US/XA/RF series (cine), `HTJ2` otherwise. 3 % of
  accessions empty.

**Access.** Every request is authorized for one key, `site-01`, the largest site (278 k of 10⁶). It is the
worst case for the filters that lead with the key.

**Cells.** `limit=50` at `offset=0` and `offset=1000`. The series cell runs at offset 0 only.

* §11's cells: `newest`; `name_accented` and `name_plain`, both family names plus the given initial
  (`Pérez García^J*` / `perez garcia^j*`); `patient_id`; `accession`; `date7_modality`, a 7-day range from a
  random study's date with that study's first modality; `series`.
* Added: `name_family`, the first family name alone (`García*` matches 13.6 % of the site).

Each request draws its parameters from a random study of the site.

**Arms**, per size, as one API binary per arm:

* `local` and `local_aa`: a Unix socket, so the API sits beside the index (§6), and the A/A pair.
* `hop_floor`: the TUN forwarder with no added delay, which measures the forwarder's own cost.
* `hop_0.5ms` and `hop_2ms`: round trips of 0.5 and 2 ms between the API and the index. Orthanc asks for 1–4 ms.
* `tuned_local` and `tuned_hop_2ms`: the tuned shape. `newest` also covers the name and the modalities, and
  `by_name` the date (`tuned.sql`). A page's UIDs are found first and only their rows are then read (a deferred
  join). The modality is matched in the study row (`FIND_IN_SET`) instead of a series probe.

**Rounds.** 12 rounds. Each round:

1. Restart mysqld and every API process; one connection-only `/health` per arm.
2. **Cold pass:** each cell once per size, on one arm rotated by round.
3. Load every index (a `COUNT(*)` forced through each).
4. Three warm-up passes, not recorded.
5. 20 recorded passes, cells rotated, arms rotated, at concurrency 1.

**Metrics.** These are latencies; no throughput is quoted beside them.

* `app`: from handler entry to the serialized body. It excludes hyper's write and the loopback.
* `db`: from taking a pooled connection to the last row read. This is §8's "query".
* `client`: the bench's own time over loopback HTTP/1.1, without TLS.

**Sweep.** At 10⁶ on `local`, `hop_2ms` and `tuned_local`: closed-loop clients at concurrency 1, 2, 4, 8, 16, 32
and 64, 5 s per step, 2 repetitions, arms alternating. The mix is uniform over the cells. The host's CPU busy
fraction comes from `/proc/stat`. The host has 4 vCPUs, shared by mysqld, the API, the bench and the forwarder. The
report gives the concurrency where p95 doubles against concurrency 1 and where the CPU saturates, and claims
nothing past that point.

**Correctness.**

* `check` compares every cell to a brute-force filter over the generator, 20 queries per cell, at both sizes, on
  `local`, `hop_2ms` and `tuned_local`.
* A 10⁴ copy whose name column is `utf8mb4_bin` must fail the name cells.
* `mutate.sh`'s nine mutations must each fail `cargo test`, whose publisher tests cover a kill after the receiver's
  commit, a kill after the index commit, an out-of-order revision, a correction and a deletion, and orphans.

**Sync** (new). The index is `si_1e6`, under its own host and key.

* **Seed:** 10⁴ study DBs, not timed. **Rebuild** = reconcile into an index without that host's rows, per arm;
  **rescan** = reconcile with nothing owed.
* **12 rounds** over the arms `local`, `hop_0.5ms` and `hop_2ms` (publisher → index), rotated.
  * *idle:* 50 new studies one at a time, 20 ms apart. Each gives its lag from the receiver's commit to the index
    commit, and to being visible through that arm's API, polled every 1 ms.
  * *burst:* 200 studies committed back to back: per-study lag p50 and max, and the drain time.
  * *correction:* one patient with ≥ 3 studies, found through the API, the name corrected in each study DB, timed
    until the API returns all of them under the new name.
* **Recovery:** 6 rounds on `local` and `hop_2ms`. The index is shut down cleanly, the receiver commits 1 000
  studies, and the index is started again. The publisher is either *kept* (it retries with backoff) or *restarted*
  (its reconcile scan at start finds the owed rows). Drain runs from the index answering to the last owed study
  published.

**Decision rule.** These are §11's thresholds, restated per arm.

* At 10⁶, warm, **every cell's p95 `db` ≤ 10 ms and `app` ≤ 50 ms**:
  * on `local`: the engine stands;
  * on `hop_2ms`: the index may live on its own server at that distance.
* If the as-designed shape misses and `tuned_*` meets, §4's schema takes the tuned indexes and query shape.
* Sync, a threshold set here, since §7 says only "tolerant of seconds": idle lag p95 ≤ 1 s on every arm.
  Burst, recovery and correction are reported, without a threshold.

## Run

```bash
cargo build --release                       # in this directory
# run.py as of 16fec79 drove this campaign; it now drives §Engines, whose Run block is below
python3 run.py setup                        # as root: namespace, TUN hops, mysqld, the API arms
# load: study-index gen --n N --seed S --out /opt/si/load/si_1eK; mysql < schema.sql; LOAD DATA (§Results notes the times)
python3 run.py settings && python3 run.py latency && python3 run.py sweep && python3 run.py check && python3 run.py sync
SI_TEST_MYSQL="mysql://root@localhost/?socket=/opt/si/run/mysql.sock" cargo test --release -- --test-threads 1
SI_TEST_MYSQL=… ./mutate.sh
python3 summary.py results/                  # the tables below
```

## Results

Run 2026-10-26 on one 4-vCPU container (kernel 6.18, 15 GiB). The raw rows are in `results/`
(`latency.jsonl.gz`, `sweep.jsonl`, `sync.jsonl`). [`results/summary.md`](results/summary.md) holds every table:
both sizes, p50s, cold. 50 760 list requests, all `200`.

**Correctness.** `check` found 0 mismatches over 90 (arm, size, cell) combinations × 20 queries
([`results/check.txt`](results/check.txt)). The `utf8mb4_bin` copy failed every name cell: 60 mismatches, against
0 for `utf8mb4_0900_ai_ci` ([`results/collation.txt`](results/collation.txt)). 11 tests pass, and all 9 mutations
were caught ([`results/tests.txt`](results/tests.txt)). `EXPLAIN` shows the prefix `LIKE` under
`utf8mb4_0900_ai_ci` as a range on `by_name`, which answers §12's open question.

**List latency, 10⁶ studies, warm, concurrency 1:** p95 `db` / `app`, ms. 240 requests a cell. Bold misses §11
(`db` > 10 or `app` > 50).

| cell | offset | local | hop_2ms | tuned_local | tuned_hop_2ms |
| --- | --- | --- | --- | --- | --- |
| newest | 0 | 1.8 / 2.6 | 4.1 / 5.0 | 2.1 / 2.9 | 4.4 / 5.2 |
| newest | 1000 | 9.5 / 10.4 | **11.6** / 12.3 | 2.7 / 3.6 | 4.9 / 5.8 |
| name_accented | 0 / 1000 | 2.8 / 3.7 · 2.4 / 2.4 | 5.1 / 5.8 · 4.5 / 4.5 | 2.0 / 2.8 · 1.2 / 1.2 | 4.3 / 5.0 · 3.4 / 3.4 |
| name_plain | 0 / 1000 | 2.2 / 2.9 · 2.5 / 2.5 | 4.8 / 5.4 · 4.9 / 4.9 | 1.9 / 2.5 · 1.1 / 1.3 | 4.2 / 4.9 · 3.5 / 3.5 |
| patient_id, accession | 0 / 1000 | ≤ 0.9 / 1.0 | ≤ 3.3 / 3.3 | ≤ 1.2 / 1.3 | ≤ 3.5 / 3.6 |
| date7_modality | 0 | **14.1** / 14.6 | **15.3** / 16.0 | 2.8 / 3.6 | 5.0 / 5.8 |
| date7_modality | 1000 | **18.7** / 18.7 | **19.8** / 19.8 | 2.2 / 2.2 | 4.5 / 4.5 |
| series | 0 | 1.2 / 1.2 | 3.5 / 3.6 | 1.2 / 1.3 | 3.4 / 3.5 |
| *name_family (added)* | 0 | **22.6** / 23.1 | **24.7** / 25.6 | 5.6 / 6.3 | 7.0 / 8.1 |
| *name_family (added)* | 1000 | **113.0 / 113.7** | **106.0 / 106.5** | **17.2** / 17.8 | **19.5** / 20.2 |

* **The hop.** `hop_floor` adds 0.1–0.5 ms over `local`, the forwarder's cost. `hop_0.5ms` adds 0.4–0.9 ms and
  `hop_2ms` 2.1–2.6 ms. That is one round trip a query, once the driver stopped resetting its connections (§Rig
  notes).
* **A/A.** `local_aa` sits within 0.9 ms of `local` on the point and name cells and within 1.7 ms on `date7_modality`. Its
  `name_family` @ 1000 p50 is 31.7 ms against 23.2 ms, the noisiest cell.
* **10⁵.** As designed, only `name_family` @ 1000 misses (23.8 ms `db`), plus `newest` @ 1000 at 2 ms (10.4 ms).
  The tuned shape meets every cell, at ≤ 9.1 ms `db` and ≤ 9.6 ms `app`.
* **Cold** (the first request of each cell after a restart, on the arm of the round, both shapes). Point lookups are
  ≤ 26 ms. The scans pay for their pages: `date7_modality` p50 61 ms, max 461 ms; `name_family` @ 1000 p50 411 ms,
  max 919 ms; `newest` @ 1000 p50 68 ms at 10⁶.
* **The client's view.** `client` − `app` is ≤ 0.9 ms at p95 on loopback, hyper's write included.

**Where the host saturates** (sweep, 10⁶, the uniform mix, `name_family` included; ms):

| arm | p95 `app` at c = 1 · 2 · 4 · 8 · 16 | CPU busy at c = 8 · 16 |
| --- | --- | --- |
| local | 19.0 · 22.4 · 27.0 · 44.1 · 84.1 | 97 % · 99 % |
| hop_2ms | 21.9 · 25.7 · 30.9 · 46.3 · 90.3 | 84 % · 98 % |
| tuned_local | 4.0 · 4.9 · 6.7 · 11.9 · 22.0 | 84 % · 95 % |

p95 doubles between c = 4 and c = 8 in the tuned shape, and by c = 8 as designed. The 4 vCPUs are saturated from
c = 8–16. mysqld, the API, the closed-loop clients and the forwarder share them, so nothing is claimed past c = 16
or for a host with the API alone.

**Size.** At 10⁶, `information_schema` reports 0.9 GB for the study table (rows and indexes) and 3.0 GB for the
series table: 3.9 GB at 4.85 series a study. That is the top of §4's 2–4 GB estimate. The series rows are three
quarters of it, so at §11's ~8 series a study it would be about 5.5 GB (arithmetic). The tuned study table is
0.8 GB. `LOAD DATA` took 201 s at 10⁶, with the binary log off for the load.

**Sync** (`si_1e6`, a 10⁴-study host; ms):

| arm | commit → index p50 / p95 | commit → visible in the API p50 / p95 | burst of 200: lag max · drained | correction of one patient (3–26 studies) p50 / max |
| --- | --- | --- | --- | --- |
| local | 7.2 / 10.2 | 8.5 / 11.8 | 360 · 1 414 | 57 / 175 |
| hop_0.5ms | 11.2 / 15.8 | 13.2 / 18.0 | 1 300 · 2 277 | 117 / 241 |
| hop_2ms | 21.2 / 25.6 | 24.8 / 29.4 | 3 396 · 4 306 | 208 / 500 |

The burst figures are the median round's.

* A publish costs about seven statements and one durable commit (binary log and redo flushed). Locally the 7 ms is
  mostly that commit. Each 1 ms of round trip adds about 7 ms.
* The publisher works in order, one study at a time: about 140 studies/s locally and 47/s at 2 ms. That throughput
  bounds the burst and the drain, not the idle lag.

**Recovery** (6 rounds; the index down about 5.3 s while the receiver committed 1 000 studies; drain counted from the
index answering):

| arm | publisher kept: first publish · drained, p50 | publisher restarted: drained p50 / max (study DBs scanned) |
| --- | --- | --- |
| local | 0.68 s · 7.6 s | 19.4 s / 24.6 s (21 000–42 000) |
| hop_2ms | 0.82 s · 22.6 s | 34.2 s / 37.5 s (23 000–40 000) |

* A kept publisher resumes within its 1 s backoff cap.
* A restarted one has no memory of what is owed. With the outbox inside each study DB it must open every study DB
  to find out. **Rescan** shows the cost: 2.9 s for 10⁴ study DBs (0.29 ms each), whatever the arm.
* **Rebuild** by reconcile: 10⁴ studies took 71 s locally, 87 s at 0.5 ms and 186 s at 2 ms. At 10⁶ that is about
  2 h locally and 5 h at 2 ms, and a scan of about 5 min (arithmetic, not measured).

**By the decision rule:**

* **As designed** (§4's indexes, one statement a page, the modality by a series probe), MySQL **misses** at 10⁶.
  `date7_modality`'s query is 14–19 ms, over 10 ms, locally and across the hop. The added `name_family` cell misses
  too.
* **The tuned shape meets** every one of §11's cells: ≤ 2.8 ms `db` locally and ≤ 5.0 ms at 2 ms, with `app`
  ≤ 5.8 ms. **§4 therefore takes the tuned indexes and query shape**, within the caveat of §Pre-registration that
  the shape was chosen on this data.
* The added `name_family` @ 1000 still takes 17–20 ms of query: inside the API's 50 ms, outside the query's 10 ms.
* **On its own server at a 2 ms round trip** the index meets the same budget, at about +2.3 ms a query and +14 ms of
  sync lag.
* **Sync** meets its 1 s rule on every arm, with idle p95 ≤ 26 ms.

**Rig notes.**

* With mysql_async's default `reset_connection`, every request reset its pooled connection, which drops the
  server-side prepared statements. Every query then cost two round trips. `reset_connection=false` is in every URL
  here, and a product client needs the same.
* The frame-read interference, TLS (to the API and to MySQL; the lab's MySQL traffic is unencrypted), PostgreSQL,
  SQLite, more than one publisher, and the PCS's real study DB schema were **not measured**.
* The 10⁶ figures for rebuild and scan are arithmetic.

## Engines: PostgreSQL 18 and SQLite beside MySQL 8.4

§Pre-registration dropped two of #146 §11's arms on a misattributed choice (corrected there). This section runs them on
the same harness, data and query set, and **reports; it does not decide**. The question: at 10⁶ studies, how do
PostgreSQL 18 and SQLite (one file on the host) compare with MySQL 8.4 as the study index?

### What each engine runs

All three hold §4's columns and the tuned shape of §Arms, which is the best shape found for MySQL: `newest` covers
the name and the modalities, `by_name` the date, a page's UIDs come from the covering index and only their rows are
then read, the modality is matched in the study row. Every engine is reached through the same API binary, which
converts every row to text before serializing it (a change from §Results' MySQL path, applied to all three).

| | MySQL 8.4.6 | PostgreSQL 18.6 (PGDG build) | SQLite 3.54.1 (rusqlite, bundled) |
| --- | --- | --- | --- |
| reached | Unix socket, or TCP across the hop; `mysql_async`, server-side prepared statements kept | Unix socket, or TCP across the hop; `tokio-postgres` with `deadpool-postgres`, statements prepared once per connection | in the API process: one writer connection, a pool of reader connections, each call on tokio's blocking pool |
| durable commit | redo log and binary log flushed (`innodb_flush_log_at_trx_commit=1`, `sync_binlog=1`) | WAL flushed (`synchronous_commit=on`, the default) | WAL file fsynced (`journal_mode=WAL`, `synchronous=FULL`) |
| name matching (PS3.4 PN: case- and accent-insensitive) | the column's collation `utf8mb4_0900_ai_ci`, `LIKE` on it | `name_key`, a **stored generated column** `lower(unaccent(name))` through `pn_fold`, declared `IMMUTABLE`; a pattern becomes a range on its literal prefix plus `LIKE` | `name_key`, written by the publisher: Unicode NFD, combining marks dropped, lower case (`lite::pn_key`); a range on the literal prefix plus `GLOB` |
| cache | buffer pool 4.5 GiB (§Arms had 8 GiB; cut so that three engines fit in 15 GiB), `O_DIRECT` | `shared_buffers` 3 GB, over the page cache | the page cache through `mmap` (16 GiB window; the bundled 2 GiB cap raised at build, `.cargo/config.toml`), 64 MiB private cache per connection |

**Settings changed from each engine's defaults** (printed to `results/engines/settings.txt`):

* **MySQL:** §Pre-registration's (`O_DIRECT`, binary log on, `sync_binlog=1`, buffer-pool dump and load off) with
  the pool at 4.5 GiB and `max_connections=600` for four pools of 80.
* **PostgreSQL:** the database's collation is the builtin `C.UTF-8` (code-point order, as `ascii_bin`, and Unicode
  case mapping); `shared_buffers` 3 GB (128 MB), `effective_cache_size` 8 GB (4 GB), `random_page_cost` 1.1 (4),
  `work_mem` 16 MB (4 MB), `jit` off (on), `max_connections` 400 (100); for the load, `maintenance_work_mem` 1 GB,
  `max_wal_size` 8 GB, `checkpoint_timeout` 15 min. After the load, `VACUUM (ANALYZE, FREEZE)`, so the visibility map
  allows index-only scans. `plan_cache_mode` is left at `auto`: a prepared statement goes generic after five runs.
* **SQLite:** WAL, `synchronous=FULL` on the writer, `mmap_size` 16 GiB, `cache_size` −65 536, `temp_store=MEMORY`,
  readers `query_only`; `WITHOUT ROWID` for the study table; `ANALYZE` after the load (SQLite's defaults: rollback
  journal, `synchronous=FULL`, no mmap, a 2 MiB cache).

**Not chosen, and why.** PostgreSQL's nondeterministic ICU collation (`und-u-ks-level1`): `LIKE` accepts it since 18,
but a B-tree cannot serve a prefix `LIKE` under it, so a name search reads every row of the access key. It is timed
once, outside the campaign (§Engines results). `citext` folds case, not accents. A normalised column on MySQL is not
needed: its collation does both.

### Pre-registration (committed before any recorded run)

**What was seen first.** Smoke runs of one round, at 10⁶, on every arm, then discarded. They found four rig faults,
fixed before this commit: `pg_prewarm` not installed, `VACUUM` inside a transaction, PostgreSQL's generic plan folding
the name pattern once per row (38 k `unaccent` calls, about 100 ms; now folded once in a sub-select), and `newest`
lacking the name on PostgreSQL and SQLite, which MySQL's tuned `newest` has (aligned). The predictions below were
written **after** those smoke runs and lean on them.

**Size.** 10⁶ only, seed 106, `site-01` (278 k studies), as §Data. 10⁵ is dropped: three engines warm at once need
the host's memory, and §Results holds MySQL's 10⁵. The 10⁴ copies serve the name-matching controls.

**Arms**, one API process each, all on the tuned shape, interleaved within every pass:

* `my_local`, `my_local_aa` (the A/A pair), `my_hop_0.5ms`, `my_hop_2ms`;
* `pg_local`, `pg_hop_0.5ms`, `pg_hop_2ms`;
* `lite_local`. SQLite has no network protocol: a second host reaches this index only through its host's API (one
  HTTP round trip a request, not a query) or holds its own file, and then lists are a fan-out across hosts (§6's
  rejected shape). There is no `lite_hop`.

**Rounds, cells, metrics, sweep** as §Pre-registration: 12 rounds, each a restart of both servers and every API, a
cold pass, every index and table read once (`run.py warm-load`: InnoDB by `COUNT(*)` per index, PostgreSQL by
`pg_prewarm`, the SQLite file read through), three unrecorded passes and 20 recorded at concurrency 1. **Cold is
not comparable across engines**: InnoDB reads through `O_DIRECT`, so a restart empties its cache; PostgreSQL and
SQLite keep the page cache across a restart, and page-cache eviction is not a lever here (CLAUDE.md). Cold is
reported for MySQL only. Sweep: `my_local`, `pg_local`, `lite_local`, `my_hop_2ms`, `pg_hop_2ms`, concurrency 1 to
64, 5 s a step, 2 repetitions.

**Sync**, as §Sync, on every arm above but `my_local_aa`, writing into the same 10⁶ index. Recovery on `my_local`,
`my_hop_2ms`, `pg_local`, `pg_hop_2ms`; an SQLite index cannot be down while its host's receiver runs, since they
are one process's file. Publisher throughput is the burst's 200 studies over its drain time.

**Correctness.** `check` on `my_local`, `my_hop_2ms`, `pg_local`, `pg_hop_2ms`, `lite_local`: 20 queries a cell.
Name matching, per engine, on a 10⁴ copy (seed 104) as built and with its folding broken (MySQL: the name column
`utf8mb4_bin`; PostgreSQL: `pn_fold` replaced by the identity; SQLite: `name_key` the raw name): the first must give
0 mismatches on the three name cells, the second must fail them. `cargo test` runs the publisher tests and a new
name-prefix test on all three engines; `mutate.sh` adds mutations of the new code, each must fail them.

**Predictions** (from the smoke runs and the engines' designs):

1. All three meet §11 at 10⁶ on `local`; MySQL and PostgreSQL also on `hop_2ms`.
2. SQLite has the lowest `db` p95 on most §11 cells; it pays no socket and no protocol.
3. PostgreSQL ties MySQL (within the A/A spread or 1 ms) on most §11 cells locally, and is slower on `name_family`.
4. Each networked query pays about one round trip, on both servers.
5. Sync idle lag p95 locally: SQLite < PostgreSQL < MySQL, all ≤ 30 ms; at 2 ms PostgreSQL and MySQL within 5 ms.
6. The host saturates at c = 8–16 on every arm; SQLite and PostgreSQL serve more requests a second at saturation
   than MySQL. (Throughput, here only: the sweep's latencies are reported, its rates are not compared to them.)
7. Rebuild of 10⁴ studies is fastest on SQLite; across 2 ms the two servers are within 20 % of each other.
8. Size at 10⁶ (measured at load, not predicted): MySQL 4.0 GB, PostgreSQL 2.3 GB, SQLite 2.1 GB.
9. The ICU collation's name search misses 10 ms at 10⁶.

**Reporting rule** (not a decision rule: the owner decides).

* An engine **meets §11** if every one of §11's cells (all but `name_family`) has p95 `db` ≤ 10 ms and `app`
  ≤ 50 ms at 10⁶, warm, on `local`; for MySQL and PostgreSQL also on `hop_2ms`.
* Two engines **differ** in a cell only if their p95 `db` differ by more than both 1 ms and that cell's A/A spread
  (|`my_local` − `my_local_aa`|); otherwise the cell is a **tie**.
* Sync meets §Pre-registration's rule if idle lag p95 ≤ 1 s.
* MySQL here **reproduces** §Results if `my_local` and `my_hop_2ms` are within the same tolerance of §Results'
  `tuned_local` and `tuned_hop_2ms`; if not, both are reported and the difference is not explained away.
* Each result is put against #146 §5's "what would change it": (a) one host, (b) row security, (c) a measured miss.

### Run (§Engines)

```bash
cargo build --release
python3 run.py init && python3 run.py load   # as root: data dirs, my.cnf, initdb, namespace, TUN hops; 10⁶ into each
python3 run.py setup && python3 run.py settings && python3 run.py sizes
python3 run.py check && python3 run.py controls && python3 run.py latency && python3 run.py sweep && python3 run.py sync
export SI_TEST_MYSQL="mysql://root@localhost/?socket=/opt/si/run/mysql.sock" \
  SI_TEST_PG="postgresql://postgres@%2Fopt%2Fsi%2Fpgrun" SI_TEST_SQLITE=/opt/si/test
cargo test --release -- --test-threads 1 && ./mutate.sh
python3 summary.py results/engines/
```
