# sqlite-engine

Which embedded engine holds the per-study metadata database ([`docs/ingest/metadata-draft.md`](../../docs/ingest/metadata-draft.md)
§3): **rusqlite** 0.41.0 (its `bundled` build compiles SQLite 3.54.1, `libsqlite3-sys` 0.39.1) against **Turso** 0.8.3, the Rust rewrite of SQLite (crate `turso`, its
latest stable tag, `v0.8.3` = `607bff9`; not libSQL, not Turso Cloud). The bottom line and the summary table are in
the draft's §3; this file holds the evidence.

**Outside the workspace** (like `lab/recv-cost`): Turso's default build installs mimalloc as the process's allocator
and pulls in tantivy; as a member it would enter the workspace's `Cargo.lock` and the gate's `cargo test -p
metadata-store`. Here it enters no product crate and no gate build.

```bash
(cd lab/sqlite-engine && cargo build --release)
B=lab/sqlite-engine/target/release/sqlite-engine
for w in 1 2; do for c in 0 64; do $B blocking --workers $w --cache-pages $c --rounds 12 > blocking-w$w-c$c.jsonl; done; done
$B files --files 1000 --rounds 5 > files.jsonl
$B two > two.jsonl
for a in turso turso-uring rusqlite rusqlite-blocking; do      # which thread reads
  strace -f -e trace=pread64,io_uring_enter -o $a.trace $B blocking --arm $a --rounds 1 --secs 1 --cache-pages 64 > $a.jsonl
  python3 lab/sqlite-engine/strace_threads.py $a.trace $a.jsonl
done
$B blocking --arm idle,turso,rusqlite,rusqlite-selfwake --cache-pages 64 --rounds 6   # the self-wake check, below
# §4, each engine at its best: two builds, every arm interleaved, a fresh process per arm and round
(cd lab/sqlite-engine && cargo build --release && cp target/release/sqlite-engine{,-default} \
  && cargo build --release --no-default-features && cp target/release/sqlite-engine{,-lean})
for m in blocking files summary; do python3 lab/sqlite-engine/fair.py $m fair-out; done
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
page's series (`SELECT uid, body, xxh3 FROM groups WHERE series = ?`, 2 202 rows: the exam, the series, 2 000 instances and 200 private rows, about 2.2 MB) again and again for
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

*Amended 2026-10-25, after one 0.5 s smoke round and before the measured runs.* With each engine's default page
cache the 2 MB series stays in the engine's own cache after the first scan, so no arm issues a read and P4–P5 would
test nothing (the smoke round: no `Pending` in either Turso arm). *Corrected 2026-10-25 (§4):* that holds for Turso only. The file is
784 pages of 4 KiB (3.2 MB); SQLite's default `-2000` holds about 500, so rusqlite read about 800 pages per scan in
the "default" condition too (`strace -c`, §4), while Turso's default page cache is 2 000 pages and holds the file. A second condition, **`--cache-pages 64`**, sets
`PRAGMA cache_size = 64` on every reader connection of both engines (the store's own lever), so each scan reads most
of its pages through the OS. *Corrected 2026-10-25 (§4):* Turso raises any value under 200 to 200 pages, its floor,
and reads 200 back; so the condition held 64 pages in rusqlite and 200 in Turso, both under the file's 784. Both conditions run, at 1 and 2 workers; the predictions are unchanged, P4–P5 are judged
in the 64-page condition. The smoke round also showed, uncounted: at 64 pages Turso's default backend let the
heartbeat tick only 4 times in 0.5 s, and the io_uring arm returned `Pending` about once per page.

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

### 4. Each engine at its best (`fair.py`)

*Pre-registered 2026-10-25, before any measured run of this section*, after reading both engines' source and docs
and two characterisation runs (`strace -c` counts and `PRAGMA cache_size` read back, below), whose finding corrects
§1 in place. The question: does the bottom line hold when each engine is deployed as its own documentation
recommends and at its best documented settings for small, read-mostly files? Primary sources only: B as in §Source
(Turso `v0.8.3`), rusqlite 0.41.0 and libsqlite3-sys 0.39.1 from crates.io, sqlite.org, docs.rs/tokio.

**What #147's arms did not equalise.** (1) *The engine cache.* Turso's page cache is 2 000 pages per `Database`
([B/core/storage/page_cache.rs#L14](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/storage/page_cache.rs#L14),
[B/core/database.rs#L740](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/database.rs#L740)),
though `PRAGMA cache_size` reads back `-2000`
([B/core/storage/sqlite3_ondisk.rs#L166](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/storage/sqlite3_ondisk.rs#L166));
SQLite's default `-2000` is "2048000 bytes" ([sqlite.org/pragma.html#pragma_cache_size](https://sqlite.org/pragma.html#pragma_cache_size)),
about 500 pages. The study file is 784 pages, so at "default" rusqlite missed every scan (`strace -c`, 0.5 s:
28 754 `pread64` for 34 scans) and Turso none (3 058 for 512 scans, the opens). (2) *The 64-page condition*: Turso
raises any `cache_size` under 200 to 200 ([B/core/storage/page_cache.rs#L24](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/storage/page_cache.rs#L24),
[B/core/translate/pragma.rs#L1928-L1933](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/translate/pragma.rs#L1928-L1933);
test `the_64_page_cache_is_200_pages_in_turso`). (3) *The call site*: rusqlite was rescued with `spawn_blocking`,
Turso was not. (4) *The build*: one binary, with Turso's default features, so mimalloc was every arm's allocator.

**The settings, each from the engine's own documentation or source.**

| | rusqlite | Turso | why |
| --- | --- | --- | --- |
| call site | `spawn_blocking`, one held connection per study behind a `Mutex` (`Connection` is `Send`, not `Sync`: rusqlite `src/lib.rs:371`) | the same: `spawn_blocking`, the scan's future driven by `Handle::block_on` on that thread; and, as its README recommends, awaited in the task ("Native async operations with tokio support", [B/bindings/rust/README.md#L9](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/bindings/rust/README.md#L9); its own throughput benchmark moved off `spawn_blocking`, commit [`ed8b02d8`](https://github.com/tursodatabase/turso/commit/ed8b02d83e74074f300b1958df942c1bba84008f)) | tokio's rule for blocking code (§Source); Turso's futures need no reactor (§Source), so `block_on` on a blocking thread runs them |
| build | `bundled` | **lean**: `default-features = false`, dropping mimalloc as the global allocator and `fts`/tantivy ([B/bindings/rust/Cargo.toml#L16](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/bindings/rust/Cargo.toml#L16)); this crate's feature `turso-defaults` turns them back on | neither feature is used; a product binary would not let a dependency choose its allocator. Both builds run, interleaved |
| engine cache | three conditions: each default (as §1); **2 000 pages on both** (Turso's default; the file fits); 64 pages (§1's forced read; Turso 200) | the same | neither document names a size for small read-mostly files; the matched condition holds the whole file in both |
| mmap | **tuned arm**: `PRAGMA mmap_size = 256 MiB`, more than any study file, so a miss is a page-cache read without a `pread` copy ([sqlite.org/mmap.html](https://sqlite.org/mmap.html); the bundled build sets no `SQLITE_DEFAULT_MMAP_SIZE`, so it is off by default) | not supported: "PRAGMA mmap_size ❌ No" ([B/COMPAT.md#L259](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/COMPAT.md#L259)) | |
| open | tuned arm: `SQLITE_OPEN_READ_ONLY \| NO_MUTEX \| URI` ([sqlite.org/c3ref/open.html](https://sqlite.org/c3ref/open.html)); rusqlite's default is read-write, create, `NO_MUTEX`, URI (`src/lib.rs:1321`) | read-write: `Builder::read_only` misses other processes' commits (#4627, §3), and the server's readers share the receiver's `Database` | |
| statements | `prepare_cached`, 16 per connection (§Prepared statements) | one prepared `Statement` held per reader and re-queried | both compile once |
| WAL, `synchronous` | WAL, persistent in the file ([sqlite.org/wal.html](https://sqlite.org/wal.html)); `synchronous` governs commits only, and no arm here commits | the same file, WAL | **not measured**: no write is timed |
| page arenas | — | two 3 MiB arenas per `Database`, fixed; only an undocumented `TESTING=true` makes them 1 MiB ([B/core/database.rs#L742-L746](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/database.rs#L742-L746)), not used. The host's huge-page policy is a deployment setting: one exploratory arm turns it off for the process (`PR_SET_THP_DISABLE`) to test §2's huge-page reading | |
| io_uring | — | no knob but the choice: 512 entries, two fixed-buffer slots per ring ([B/core/io/io_uring.rs#L28](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/io/io_uring.rs#L28), [#L43](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/io/io_uring.rs#L43), [#L193-L200](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/io/io_uring.rs#L193-L200)); a ring per `Database` (`with_io("io_uring")`), or one ring for the process passed to every `Database` (`Builder::with_io_impl`, [B/bindings/rust/src/lib.rs#L277-L281](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/bindings/rust/src/lib.rs#L277-L281)) | the ring's own comment designs for "one large arena registered at startup", which one shared ring matches |

**The self-wake (§1) is not a setting.** `Completion::set_waker` wakes the task at once when the read already
finished ([B/core/io/completions.rs#L393-L399](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/io/completions.rs#L393-L399)),
and the default backend always finishes before the VM parks; no `Builder` option or feature changes either. On
`main` at [`aa93d669`](https://github.com/tursodatabase/turso/commit/aa93d669c7940d13e3f124138db0adb77133636e)
(2026-10-25), 1 313 commits after `v0.8.3`, `set_waker` is unchanged and `core/io/unix.rs` untouched; the one change
to `completions.rs` keeps a completion *group* pending ([`81f819b2`](https://github.com/tursodatabase/turso/commit/81f819b2b0ec00e969ab5a49986822bf13698d77), #9550). **Whether it is a known issue upstream is not established**: GitHub's issue search is refused from this host
(HTTP 403), so the tracker could not be searched; the commit history (searched for wake, waker, starve,
`spawn_blocking`, tokio) names no such fix.

**Arms** (`fair.py blocking`, the same 4 study files and series scan as §1): each arm a fresh process for one 2 s
round, all 9 rotated round by round, **6 rounds**, at 1 and 2 workers × the three cache conditions. #147's five
in the default build: **idle**, **turso**, **turso-uring**, **rusqlite**, **rusqlite-blocking**. New, lean build:
**turso-blocking**, **turso-uring-blocking**, **rusqlite-blocking** (the allocator's effect, against the default
build's), **rusqlite-blocking-tuned** (read-only, mmap). The heartbeat's lateness pools every tick of the 6 rounds.

`fair.py files` (§2's 1 010 files, a fresh process per arm, **5 rounds**, 8 arms rotated): default build
**rusqlite**, **turso**; lean **rusqlite**, **rusqlite-tuned**, **turso**, **turso-uring** (a ring per file),
**turso-uring-shared** (one ring), and **turso, THP off** (exploratory). RSS is split into its anonymous and
file-backed parts (`/proc/self/status`); the tuned arm's insert is skipped (read-only).

| Prediction | Contradicted if |
| --- | --- |
| F1. **turso-blocking** keeps the heartbeat's p99 within 2× idle's, at 1 and 2 workers, in every cache condition, as rusqlite-blocking did (P2) | above 2× in any cell |
| F2. 2 000-page condition (both hold the file): turso-blocking's and lean rusqlite-blocking's scan p50 within 1.5× of each other | further apart |
| F3. 64-page condition: rusqlite-blocking-tuned (mmap) scans at least 1.2× faster than lean rusqlite-blocking | not 1.2× faster |
| F4. 64-page condition: turso-uring-blocking's scan p50 at least 2× turso-blocking's — the ring's per-page round trip, not tokio's scheduler, is most of io_uring's slowdown (§1's 13.4 against 2.7 ms) | under 2× |
| F5. The build does not move the read path: lean against default rusqlite-blocking, scan p50 within 1.2× in every cell | further apart |
| F6. #147 reproduces: 1 worker, 64 pages, **turso** heartbeat p99 above 100 ms; **rusqlite-blocking** within 2× idle | otherwise |
| F7. Lean Turso's RSS per open file within 10 % of the default build's: neither mimalloc nor tantivy holds the 2 MiB | lean lower by more than 10 % |
| F8. Lean Turso with THP off: RSS per open file under 500 KiB — the huge page is the 2 MiB | 500 KiB or more |
| F9. turso-uring (a ring per file) holds more RSS per open file than lean turso; turso-uring-shared within 1.2× of lean turso | otherwise |
| F10. rusqlite-tuned: anonymous RSS, open p50 and held read p50 each within 1.2× of lean rusqlite | any further |

**The verdict rule, fixed now.** Tuning can move the async and the latency/resource rows of the draft's §3; it
cannot move the multi-process row (the whole-file lock has no switch but the experimental `.tshm` mode, §3) or
maturity. So #147's bottom line changes only if Turso's best arm ties or beats rusqlite's best (within 1.2×) on
heartbeat p99, RSS per open file, open p50 and held read p50 **and** the owner discounts the multi-process row.
Otherwise it stands, with every row the tuning moved corrected in place.

**Where the host saturates.** 4 readers in the blocking pool and 1–2 workers on 4 vCPUs: every busy arm runs the host
at or near its 4 cores, so reads per second is capacity-bound and is reported, not compared; nothing is claimed
past 4 readers, 2 workers, a warm page cache, or 1 010 open files.

## Source: what a Turso query does on a tokio worker

*Source, Turso `v0.8.3` = `607bff9`* (B = `https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c`).

1. `Rows::next` is a future whose `poll` calls `Statement::step`
   ([B/bindings/rust/src/rows.rs#L47-L77](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/bindings/rust/src/rows.rs#L47-L77)),
   which calls `TursoStatement::step(Some(cx.waker()))`; on `Io` it calls `run_io()` and returns `Poll::Pending`
   ([B/bindings/rust/src/lib.rs#L412-L443](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/bindings/rust/src/lib.rs#L412-L443)).
   `Builder::build` sets `async_io: true` and opens the database through the same loop
   ([#L329-L357](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/bindings/rust/src/lib.rs#L329-L357)).
2. The SDK maps the engine's IO, Yield and Sleep to `Io`
   ([B/sdk-kit/src/rsapi.rs#L1504-L1529](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/sdk-kit/src/rsapi.rs#L1504-L1529));
   `run_io` is one `io.step()`
   ([#L1686-L1693](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/sdk-kit/src/rsapi.rs#L1686-L1693)).
3. A page miss goes `Pager::read_page` → `begin_read_page` → `file.pread`
   ([B/core/storage/pager.rs#L3625](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/storage/pager.rs#L3625),
   [B/core/storage/sqlite3_ondisk.rs#L550-L605](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/storage/sqlite3_ondisk.rs#L550-L605),
   [B/core/storage/database.rs#L275](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/storage/database.rs#L275)).
   The VM then parks: it hands the waker to the completion and returns IO only if the completion is unfinished;
   a finished one is woken at once and the VM runs on
   ([B/core/vdbe/mod.rs#L2619-L2643](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/vdbe/mod.rs#L2619-L2643);
   `set_waker` on a finished completion calls `wake_by_ref`,
   [B/core/io/completions.rs#L393-L398](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/io/completions.rs#L393-L398)).

**Default backend.** `IoBackend::Default` is `PlatformIO`
([B/sdk-kit/src/rsapi.rs#L953-L956](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/sdk-kit/src/rsapi.rs#L953-L956)),
which on Linux is `UnixIO`
([B/core/io/mod.rs#L25-L30](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/io/mod.rs#L25-L30)).
Its `pread` is a blocking `libc::pread` followed by `c.complete()`, "Read succeeded immediately"
([B/core/io/unix.rs#L317-L338](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/io/unix.rs#L317-L338));
its `step` does nothing ([#L81-L83](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/io/unix.rs#L81-L83)).
So the syscall runs **on the thread polling the future**, a tokio worker; the read is finished before the VM parks,
so the future **never returns `Pending` for a read**, and every page miss wakes its own task while it is still
running.

**io_uring backend.** Compiled in by default (the SDK turns on `turso_core/io_uring`,
[B/sdk-kit/Cargo.toml#L22-L26](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/sdk-kit/Cargo.toml#L22-L26)),
chosen with `Builder::with_io("io_uring")`
([B/sdk-kit/src/lib.rs#L60-L67](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/sdk-kit/src/lib.rs#L60-L67)).
`pread` queues an SQE and calls `ring.submit()` without waiting
([B/core/io/io_uring.rs#L119-L136](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/io/io_uring.rs#L119-L136),
[#L738-L773](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/io/io_uring.rs#L738-L773)),
so the VM parks and the binding calls `run_io`. `UringIO::step` takes a `try_lock`; the caller that gets it blocks
in `ring.submit_and_wait(min(pending, 4))` and drains the completions, whose `complete()` wakes each waiting task
([B/core/io/io_uring.rs#L527-L566](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/io/io_uring.rs#L527-L566),
[#L599-L633](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/io/io_uring.rs#L599-L633)).
So the wait also runs **on the polling worker thread**; the leader returns `Pending` only after its read completed and
it has woken itself. A real `Pending` with a read outstanding happens only to a caller that lost the `try_lock`, and
the leader's drain wakes it.

**Not tokio's reactor.** Neither backend registers anything with tokio: tokio is a dependency of `turso` only under
its `sync` feature ([B/bindings/rust/Cargo.toml#L22-L42](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/bindings/rust/Cargo.toml#L22-L42))
and of neither `turso_core` nor the SDK, and no I/O thread is spawned outside tests and `sync`.

**What tokio says about this.** "Code that spends a long time without reaching an `.await` will prevent other tasks
from running" ([docs.rs/tokio §CPU-bound tasks and blocking code](https://docs.rs/tokio/1.54.1/tokio/index.html#cpu-bound-tasks-and-blocking-code));
`spawn_blocking` "runs the provided closure on a thread where blocking is acceptable"
([docs.rs](https://docs.rs/tokio/1.54.1/tokio/task/fn.spawn_blocking.html)); for files, "Tokio provides no advantage
here compared to an ordinary threadpool. This is because operating systems generally do not provide asynchronous file
APIs" ([tokio.rs tutorial](https://tokio.rs/tokio/tutorial)); "no more than 10 to 100 microseconds between each
`.await`" ([ryhl.io, Async: What is blocking?](https://ryhl.io/blog/async-what-is-blocking/)).

## Measured, 2026-10-25

A 4-vCPU Xeon at 2.80 GHz (a VM), ext4 on its virtual disk, Linux 6.18, tokio 1.54.1; every file in the page cache
(warm only, see §1). Both engines run in one binary, whose Rust allocator is the mimalloc Turso's default features
install; SQLite's own allocations go to libc's `malloc`. Each arm's numbers pool every tick or read of its 12 interleaved rounds; the per-round p99s of
every arm stay within the ranges in brackets, so no arm's order or round explains a difference below.

### 1. Blocking a tokio worker

Heartbeat lateness, ms, p50 / p99 / max [per-round p99 range]; the series scan's median; reads per second, all four
readers together.

| 1 worker | default engine cache | | | 64-page engine cache | | |
| --- | --- | ---: | ---: | --- | ---: | ---: |
| arm | lateness | scan | reads/s | lateness | scan | reads/s |
| idle | 0.69 / 1.80 / 21 [1.7–2.2] | — | — | 0.68 / 1.76 / 17 [1.7–1.9] | — | — |
| turso | 7.4 / 13.1 / 23 [10–14] | 1.9 ms | 512 | **167 / 267 / 284** [190–284] | 2.7 ms | 365 |
| turso-uring | 7.5 / 14.5 / 21 [12–19] | 2.0 ms | 491 | 0.47 / 1.93 / 4.4 [1.6–2.3] | **13.4 ms** | 278 |
| rusqlite | 7.2 / 12.1 / 14 [9.6–12.7] | 1.9 ms | 501 | 6.0 / 11.3 / 35 [9.0–11.7] | 1.6 ms | 579 |
| rusqlite-blocking | 1.03 / 3.36 / 27 [2.9–3.7] | 2.5 ms | 1 387 | 0.97 / 3.04 / 8 [2.7–3.6] | 2.2 ms | 1 558 |

| 2 workers | default engine cache | | | 64-page engine cache | | |
| --- | --- | ---: | ---: | --- | ---: | ---: |
| idle | 0.69 / 1.77 / 14 | — | — | 0.70 / 1.75 / 14 | — | — |
| turso | 3.2 / 5.9 / 9 [5.1–6.6] | 1.8 ms | 1 048 | **88 / 182 / 225** [145–224] | 2.8 ms | 707 |
| turso-uring | 3.2 / 5.8 / 11 [5.0–6.7] | 1.9 ms | 1 027 | 0.43 / 1.44 / 3.3 [1.3–1.6] | **7.2 ms** | 501 |
| rusqlite | 3.4 / 5.9 / 10 [4.7–6.8] | 2.0 ms | 986 | 2.7 / 4.9 / 8 [4.4–5.4] | 1.6 ms | 1 195 |
| rusqlite-blocking | 0.93 / 3.37 / 6 [3.1–3.5] | 2.7 ms | 1 310 | 0.95 / 3.04 / 32 [2.7–3.5] | 2.3 ms | 1 524 |

`Rows::next` returned `Pending`: **turso 0 times** in both conditions; turso-uring 0 at the default cache, 3.7 million
times (1 worker) and 6.7 million (2) at 64 pages, about one per page read.

Which thread reads (`strace -f`, one 1 s round per arm at 64 pages; "main" is the thread that opens the files):

| arm | reader's tokio worker | blocking pool | main (opens) |
| --- | ---: | ---: | ---: |
| turso | 33 748 `pread64` | 0 | 6 218 `pread64` |
| turso-uring | 17 160 `io_uring_enter` | 0 | 6 112 `io_uring_enter`, 3 162 `pread64` |
| rusqlite | 13 626 `pread64` | 0 | 6 210 `pread64` |
| rusqlite-blocking | 0 | 31 045 `pread64` | 3 174 `pread64` |

* **P1 holds at the default cache, and for turso and rusqlite at 64 pages; contradicted for turso-uring at 64
  pages**: its heartbeat p99 (1.9 ms) is idle's. Each page read returns `Pending` and the task goes back through the
  scheduler, so the timer gets its turn between pages; the read still runs on the worker (the strace), it is just
  short here because the page cache answers it. A scan takes 5–8× as long (13.4 against 1.6–2.7 ms).
* **P2, P3 hold for rusqlite-blocking**: within 1.7–1.9× idle's p99 in every cell. **P3 for the direct arms holds at
  the default cache, and for turso at 64 pages; contradicted for rusqlite at 64 pages** (4.9 ms, 2.8× idle) **and for
  turso-uring** (as P1).
* **P4, P5 hold.** The default backend never returns `Pending`; every read of the three direct arms is issued by the
  worker the reader task runs on, and spawn_blocking's by the blocking pool only.
* **Turso's default backend at 64 pages is the worst arm by 15–30×**: the heartbeat waited 167 ms at the median.
  *Exploratory, after the fact:* each page read completes before the VM parks and wakes its task while it is still
  running (§Source); the task is then already scheduled, so tokio's `yield_now`, which defers its wake until the
  scheduler has polled the timer driver ([tokio-1.54.1 src/task/yield_now.rs:49-55](https://github.com/tokio-rs/tokio/blob/tokio-1.54.1/tokio/src/task/yield_now.rs#L49-L55)),
  no longer lets the timer in, which then runs only every 61 polls (`EVENT_INTERVAL`). A rusqlite arm that does nothing
  but wake itself once before each `yield_now` (**rusqlite-selfwake**, 6 rounds interleaved with idle, turso and
  rusqlite, 1 worker) reproduces it: heartbeat p50 / p99 110 / 153 ms at the default cache and 75 / 124 ms at 64
  pages, against rusqlite's 6.9 / 11.6 and 4.7 / 9.1 ms in the same rounds. So any task awaiting Turso's default
  backend between other awaits starves the worker's timers and I/O, as long as its reads miss Turso's cache.
* **Where the host saturates**: one worker is one core and every direct arm keeps it busy; nothing is claimed past 4
  readers, 2 workers, or a warm cache. **Cold disk, not measured:** by the source, the default backend and io_uring's
  `submit_and_wait` hold the worker for the device's latency per read; spawn_blocking holds a blocking-pool thread.

### 2. Many open files

1 010 files, 5 rounds alternated, each arm a fresh process: p50 / p99 over every open or read of the round; the range is
the 5 rounds' values.

| | rusqlite | Turso |
| --- | ---: | ---: |
| open and first row, 2 000 instances, p50 | 0.93–1.67 ms | 0.92–12.9 ms |
| the same, p99 | 1.6–3.3 ms | 2.0–26.5 ms |
| open and first row, 10 000 instances, p50 | 0.87–2.7 ms | 13.0–14.8 ms |
| file descriptors per open file | 3.00 | 2.00 |
| RSS per open file | 187 KiB | 2 181 KiB |
| held connection, one random row, p50 / p99 | 15–21 / 54–71 µs | 18–20 / 67–122 µs |
| side files after the open and read, and after one insert | `-wal`, `-shm` | `-wal` |

* **P6 holds** (3 against 2 descriptors; no `-shm` for Turso, which also probes for a `-log` file at every open).
* **P7 holds: Turso holds 11.7× the memory per open file**, 2.1 GiB for 1 000 open studies against about 180 MiB. Each Turso
  `Database` maps two 3 MiB buffer-pool arenas with `MADV_HUGEPAGE`
  ([B/core/storage/buffer_pool.rs#L130](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/storage/buffer_pool.rs#L130),
  [#L448-L463](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/storage/buffer_pool.rs#L448-L463));
  the first read faults in a huge page, about the 2 MiB measured. On this host (`transparent_hugepage` `madvise`,
  `defrag` `madvise`) that first `pread64` into the arena took 12–14 ms in `strace -T` on every 10 000-instance file,
  which is the slow open; that it is the kernel's huge-page allocation is **not confirmed**. It depends on the host's
  memory state, as the rounds show (one round of 2 000-instance files at 12.9 ms, the others near 1 ms).
* **P8 holds**: held reads within 1.3× of each other at the median.

### 3. Two connections, two processes

20 commits of 200 rows; the reader counts after each.

| case | rusqlite | Turso 0.8.3 |
| --- | --- | --- |
| one process, two connections (Turso: one `Database`) | all 20 seen | all 20 seen |
| one process, two handles opened apart | all 20 seen | all 20 seen |
| two processes, reader read-write | all 20 seen | open fails: "Failed locking file … locked by another process" |
| two processes, reader read-only | all 20 seen | opens; **counts 0 rows after every commit** |
| two processes, `experimental_multiprocess_wal` on both | — | all 20 seen |
| rusqlite writer, Turso reader | | Turso's open fails on the lock |
| Turso writer, rusqlite reader | | rusqlite opens; its first read waits out its 5 s busy timeout (5 012 ms) and returns only once the Turso writer has exited |

* **P9–P12 hold.** The read-only reader is issue [#4627](https://github.com/tursodatabase/turso/issues/4627) (open).
* **P13 holds for a Turso reader; for a rusqlite reader in the letter only**: it opens, but cannot read while a Turso
  process holds the file.

## The desk read of 2026-10-24, checked

*Source at `v0.8.3`* (B as above), and GitHub's issue and PR pages, read 2026-10-25.

| | Finding | Verdict |
| --- | --- | --- |
| a | the default backend preads on the awaiting worker; io_uring opt-in and blocking in `submit_and_wait`; not on tokio's reactor | **holds** (§Source, and measured in §1); io_uring is *compiled in* by default, only *chosen* by `with_io("io_uring")` |
| b | a writable open locks the whole file; a read-only open misses new commits (#4627); multi-process mode uses `.tshm`, not production ready, open data-loss issues; mixed SQLite + Turso unsupported | **holds**, measured in §3. The lock is `fcntl(F_SETLK, F_WRLCK, 0, 0)` ([B/core/io/unix.rs#L278-L303](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/io/unix.rs#L278-L303)), skipped by `LIMBO_DISABLE_FILE_LOCK`; the sidecar is `x.db-tshm` ([B/core/storage/wal.rs#L120-L127](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/storage/wal.rs#L120-L127)); "not production ready so do not use it for critical data right now" ([B/docs/manual.md#L156](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/docs/manual.md#L156)), and the manual's limits still say "No multi-process access" ([#L100](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/docs/manual.md#L100)); open: [#9362](https://github.com/tursodatabase/turso/issues/9362) (a process opening without the flag is not refused and its commits are lost), [#8536](https://github.com/tursodatabase/turso/issues/8536), [#10314](https://github.com/tursodatabase/turso/issues/10314), [#10114](https://github.com/tursodatabase/turso/issues/10114); "We don't support mixed SQLite and Turso in multi-process scenarios" ([B/COMPAT.md#L71](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/COMPAT.md#L71)) |
| c | WITHOUT ROWID insert-only; no backup API; `synchronous` OFF/FULL only | **holds for the first two** ([B/COMPAT.md#L155](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/COMPAT.md#L155), [#L756-L764](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/COMPAT.md#L756-L764)); **partly for the third**: COMPAT says OFF and FULL ([#L277](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/COMPAT.md#L277)), the code also takes NORMAL and turns EXTRA into FULL ([B/core/translate/pragma.rs#L656-L678](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/translate/pragma.rs#L656-L678)) |
| d | a crash before the first checkpoint lost a new database's first commits; fixed in PR #8103, 2026-08-07 | **holds**: [#8103](https://github.com/tursodatabase/turso/pull/8103) merged 2026-08-07, fixes [#7995](https://github.com/tursodatabase/turso/issues/7995), in 0.8.0 and so in 0.8.3 ([B/CHANGELOG.md#L564](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/CHANGELOG.md#L564)) |
| e | default features install mimalloc process-wide and pull in tantivy | **holds** ([B/bindings/rust/Cargo.toml#L16](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/bindings/rust/Cargo.toml#L16), [B/bindings/rust/src/lib.rs#L35-L37](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/bindings/rust/src/lib.rs#L35-L37); `fts` → tantivy 0.26.2, [B/core/Cargo.toml#L59](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/core/Cargo.toml#L59)); `default-features = false` drops both |
| f | the README no longer says beta; the FAQ says pre-1.0, keep backups; MVCC docs disagree | **holds**: "It runs in production today at multiple organizations" ([B/README.md#L34](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/README.md#L34)); "we have not yet reached 1.0 … keep independent backups" ([#L436](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/README.md#L436)); MVCC "is a supported journal mode" ([B/docs/manual.md#L112](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/docs/manual.md#L111)) against "not production ready" ([#L590](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/docs/manual.md#L590)). The draft's §3 row "currently in beta" is corrected there |

**Prepared statements.** rusqlite's `prepare_cached` keeps up to 16 statements per connection, least recently used
evicted (rusqlite-0.41.0 `src/lib.rs:171`); Turso's keeps every distinct SQL text for the connection's life, with no
bound or eviction, and re-instantiates a statement from the cached compiled program on each call
([B/sdk-kit/src/rsapi.rs#L1136](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/sdk-kit/src/rsapi.rs#L1136),
[#L1331-L1374](https://github.com/tursodatabase/turso/blob/607bff9fd0e547a25a97b3bf06e83bcc5d99d53c/sdk-kit/src/rsapi.rs#L1331-L1374)).
For a fixed handful of statements per study, both serve.
