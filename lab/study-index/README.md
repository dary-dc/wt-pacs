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

Not yet run.
