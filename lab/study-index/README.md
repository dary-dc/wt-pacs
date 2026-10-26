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
| `mutate.sh` | nine deliberate breakages; the tests must catch each |

**Revision, not generation.** #146 calls the study's version a *generation*. [`docs/glossary.md`](../../docs/glossary.md)
already gives *generation* to a request's identity, so this prototype says **revision**, which is also the owner's
word in `docs/ingest/pacs-receive-design.md` §7 on `claude/pacs-design-state`.

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

* **Arms dropped:** PostgreSQL 18 and SQLite. The owner chose MySQL on 10-25. **Size dropped:** 10⁴, kept only for
  the collation mutation.
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
