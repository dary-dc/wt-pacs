# sqlite-engine

Which embedded engine holds the per-study metadata database ([`docs/ingest/metadata-draft.md`](../../docs/ingest/metadata-draft.md)
§3): **rusqlite** 0.41.0 (bundles SQLite 3.54.0) against **Turso** 0.8.3, the Rust rewrite of SQLite (crate `turso`, its
latest stable tag, `v0.8.3` = `607bff9`; not libSQL, not Turso Cloud). The bottom line and the summary table are in
the draft's §3; this file holds the evidence.

**Outside the workspace** (like `lab/recv-cost`): Turso's default build installs mimalloc as the process's allocator
and pulls in tantivy; as a member it would enter the workspace's `Cargo.lock` and the gate's `cargo test -p
metadata-store`. Here it enters no product crate and no gate build.

```bash
(cd lab/sqlite-engine && cargo build --release)
B=lab/sqlite-engine/target/release/sqlite-engine
$B blocking --workers 1 --rounds 12 > blocking-w1.jsonl ; $B blocking --workers 2 --rounds 12 > blocking-w2.jsonl
$B files --files 1000 --rounds 5 > files.jsonl
$B two > two.jsonl
```

**The study file**, the same for both engines (built by rusqlite, so the format is SQLite's): one table
`groups(uid TEXT PRIMARY KEY, kind INTEGER, series TEXT, body BLOB, xxh3 INTEGER)` and an index on `series`; one exam
row, one series row per series, one instance row per instance, a private row per 10 instances; each body 1 024
pseudo-random bytes, its `xxh3` a 64-bit integer stored beside it (not computed: what is timed is the read). WAL,
`synchronous=FULL` on the writer. A rowid table: Turso's WITHOUT ROWID tables cannot be updated (below).

## Pre-registered, 2026-10-25, before any run

### 1. Blocking a tokio worker (`blocking`)

A tokio runtime with 1 worker, then 2. A **heartbeat** task sleeps until its next 1 ms deadline and records how late
it woke; four **reader** tasks, each with its own held connection to its own study file of 2 000 instances, read the
page's series (`SELECT uid, body, xxh3 FROM groups WHERE series = ?`, 2 001 rows, about 2 MB) again and again for
2 s. Arms, interleaved round by round with the order rotated, 12 rounds:

* **idle**: the heartbeat alone (the timer's own lateness);
* **turso**: Turso's async API with its default I/O backend, awaited in the task;
* **turso-uring**: the same with `Builder::with_io("io_uring")`, if the container allows io_uring;
* **rusqlite**: rusqlite called directly in the task;
* **rusqlite-blocking**: rusqlite inside `tokio::task::spawn_blocking`.

Per arm: heartbeat lateness p50 / p99 / max over every tick of every round, reads per second, the median scan time,
and, for the Turso arms, how often a `Rows::next` future returned `Pending` (a wrapper counts its polls). Then
`strace -f -e trace=pread64,io_uring_enter` over one round of each arm names the thread that issues each read
(`/proc/self/task/*/comm` maps thread IDs to `tokio-runtime-w` workers and the blocking pool).

**Warm cache only.** Every file is in the page cache (written just before, never evicted); page-cache eviction is not
a lever here. A pread from the page cache is a few µs, so what a direct arm blocks the worker for is its CPU time per
read, not a disk's latency. A cold disk would add the device's latency to the same blocking, by the source (§Source);
**not measured**.

| Prediction | Contradicted if |
| --- | --- |
| P1. 1 worker: **turso**, **turso-uring** and **rusqlite** each push heartbeat p99 above 50 % of their own median scan time, and above 5× idle's p99 | any of the three stays under either bound |
| P2. 1 worker: **rusqlite-blocking**'s heartbeat p99 within 2× idle's p99 | above 2× |
| P3. 2 workers: the three direct arms still above 3× idle's p99; rusqlite-blocking within 2× | otherwise |
| P4. **turso**: no `Rows::next` future ever returns `Pending` on a warm read | one does |
| P5. strace: **turso**, **rusqlite** issue `pread64` from `tokio-runtime-w` threads; **turso-uring** `io_uring_enter` from them; **rusqlite-blocking** `pread64` from blocking-pool threads only | any read from another thread |

### 2. Many open files (`files`)

1 000 study files of 2 000 instances (about 2 MB each), and 10 more of 10 000; each arm a fresh child process, which
opens every file (one connection each, WAL) and reads one instance row from each, then reads one random row from every
held connection for 3 passes. Arms **rusqlite** and **turso**, 5 rounds, the order alternated. Per arm: open latency
(to the first row read) p50 / p99, file descriptors per open file (`/proc/self/fd`), RSS per open file
(`/proc/self/statm`, after the opens against before), held read latency p50 / p99, and the side files beside one
study file after its open and read, and after one insert.

| Prediction | Contradicted if |
| --- | --- |
| P6. rusqlite holds 3 descriptors per open file after a read (db, `-wal`, `-shm`); Turso 2 (db, `-wal`), no `-shm` | otherwise |
| P7. Turso's RSS per open file is larger than rusqlite's | not larger |
| P8. held read latency within 2× of each other at the median | further apart |

### 3. Two connections, two processes (`two`)

For each engine, a writer inserting a series of 200 instance rows per commit, 20 commits, beside a reader, recording
whether the reader sees every commit (its count of rows rises to the end), and every error:

* one process, two connections from the same database handle (Turso: one `Database`, two `connect()`);
* one process, two handles opened separately on the same file;
* two processes, the reader read-write; the reader read-only (`mode=ro` / `Builder::read_only`);
* Turso: two processes with `experimental_multiprocess_wal` on both;
* mixed: a rusqlite writer with a Turso reader, and a Turso writer with a rusqlite reader.

| Prediction | Contradicted if |
| --- | --- |
| P9. rusqlite: every case sees every commit, no error | an error or a missed commit |
| P10. Turso, one process, one `Database`: sees every commit | otherwise |
| P11. Turso, two processes, default: the second read-write open fails on the lock; a read-only reader opens but does not see commits made after it opened | otherwise |
| P12. Turso with `experimental_multiprocess_wal` on both: the reader sees every commit | otherwise |
| P13. mixed: a rusqlite process cannot open while a Turso writer holds the file, and the reverse | otherwise |
