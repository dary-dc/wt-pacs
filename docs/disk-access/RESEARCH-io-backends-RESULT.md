# Is there a better I/O backend for this read path? — the answer

**Verdict: keep what we have.** Nothing found beats a directly driven `io-uring` for the
random/tile path, and the one thing that changed materially since the brief was written —
tokio's own io_uring work — still cannot do a positional read through its public API.

Answers [`RESEARCH-io-backends.md`](RESEARCH-io-backends.md). Checked **2026-09-08** against
crates.io, the tokio changelog, and the vendored sources this repo actually builds against
(`~/.cargo/registry`, which is authoritative for the pinned versions, unlike any doc page).

This branch builds: `tokio 1.53.1`, `wtransport 0.7.2` → `quinn 0.11.11`, `io-uring 0.7.14`
(0.7.15 released 2026-09-07), Linux 6.18, rustc 1.94.1.

## 1 · The candidates

| Candidate | Latest | Released | Verdict |
| --- | --- | --- | --- |
| [`io-uring` (direct, current)](https://crates.io/crates/io-uring) | 0.7.15 | 2026-09-07 | **Keep.** Maintained by the tokio org, 55 M downloads, and now a dependency of tokio itself |
| [`tokio-uring`](https://crates.io/crates/tokio-uring) | 0.5.0 | **2024-05-27** | **Rejected** — fails constraint 1 (own current-thread runtime, `!Sync` resources) and has had no release in over two years |
| [`glommio`](https://crates.io/crates/glommio) | 0.9.0 | 2024-03-25 | **Rejected** — thread-per-core runtime; fails constraint 1 |
| [`monoio`](https://crates.io/crates/monoio) | 0.2.4 | 2024-08-20 | **Rejected** — thread-per-core runtime; fails constraint 1 |
| [`compio`](https://crates.io/crates/compio) | 0.19.2 | 2026-08-18 | **Rejected** — own completion-based runtime; fails constraint 1. The liveliest of the four, so it is the one to re-check if the transport is ever rewritten |
| [`nuclei`](https://crates.io/crates/nuclei) | 0.4.4 | 2024-01-26 | **Rejected** — proactor with its own runtime, quiet for two years |
| [`rio`](https://crates.io/crates/rio) | 0.9.4 | **2020-08-21** | **Rejected** — abandoned, and GPL-3.0 |
| [`uring-fs`](https://crates.io/crates/uring-fs) | 1.4.0 | 2024-01-15 | **Rejected** — see §2, it is the closest thing to what the brief hoped existed |
| `tokio` + `io-uring` feature | 1.53.1 | 2026-07-20 | **Rejected for tiles, viable later for streaming** — §3 |

The four "own runtime" rows are rejected on architecture, not on version, so their release
dates change nothing. They are listed with dates anyway because two of them are visibly
stalled and that is worth knowing.

## 2 · What the brief did not know

**The runtime constraint is `wtransport`'s, not `quinn`'s.** quinn 0.11.11 has a public
`Runtime` trait with three implementations shipped (`TokioRuntime`, `SmolRuntime`,
`AsyncStdRuntime` — `quinn-0.11.11/src/runtime/`). `wtransport 0.7.2` then hardcodes
`Arc::new(TokioRuntime)` in `endpoint.rs:132` and `:186` with no way to pass another. So
constraint 1 is real but it is *one crate's constructor*, not a property of QUIC in Rust. A
thread-per-core runtime would still need its own `quinn::Runtime` implementation over its own
UDP and timers, so this is a lead, not an opening.

**Someone did build the wrapper — and it is not one to adopt.**
[`uring-fs` 1.4.0](https://github.com/Foxcirc/uring-fs) is "truly asynchronous file operations
using io-uring… usable with any async runtime". It fails on three counts: it **spawns a reaper
thread** to wait on completions (where the eventfd + `AsyncFd` binding here adds no thread at
all), its documented read API takes a size rather than an offset, and the author states it
"might contain some subtle undefined behaviour" and has not been tested much. For a medical
imaging server that is constraint 4, decided.

**No other reverse dependency of `io-uring` is a general-purpose async file reader.** The list
is runtimes (`monoio`, `slings`, `orengine`, `stuck`, `commonware-runtime`) and storage
engines (`turso_core`, `limbo_core`, `foyer-storage`). The closest prior art is
[foyer](https://github.com/foyer-rs/foyer), a hybrid cache on tokio that ships *both* a
`PsyncIoEngine` (thread pool + `pread`) and a uring engine — the same fork in the road this
project took, reached independently. How its uring engine is driven was not verified here;
it is the one thing worth reading if this question is ever reopened.

**Kernel features: nothing to collect.**

* **Multishot reads do not apply.** `IORING_OP_READ_MULTISHOT` is for *pollable* files —
  pipes, tun devices — and returns `-EBADFD` on a regular file
  ([man 3](https://man7.org/linux/man-pages/man3/io_uring_prep_read_multishot.3.html)).
  Closed permanently, not "not yet".
* **`IORING_SETUP_ATTACH_WQ`** shares one kernel worker pool across many rings, which is the
  right tool for per-session rings at scale — but it only pays where io-wq workers are
  actually spawned, and **R5 measured zero** at 128 concurrent rings under 53–79% miss
  ([`EVIDENCE.md`](EVIDENCE.md)). Nothing to fix. Worth remembering if a future workload ever
  does spawn them.
* Per-session cost stays **2 fds and 8.7 KiB** (ring + eventfd); read-ahead-by-one added a
  second slot to the same ring, not a second ring.

## 3 · tokio's own io_uring — real progress, still the wrong shape

Verified from the [tokio changelog](https://github.com/tokio-rs/tokio/blob/master/tokio/CHANGELOG.md)
and the vendored 1.53.1 source:

| version | date | what landed |
| --- | --- | --- |
| 1.48.0 | 2025-10-14 | `fs::write`, `File::open`, `OpenOptions` |
| 1.49.0 | 2026-01-03 | `tokio::fs::read`, `EINTR` handling, disable on `EPERM` |
| 1.50.0 | 2026-03-03 | opcode probing |
| **1.52.0** | **2026-04-14** | **`io_uring` in `AsyncRead` for `File`** |
| 1.53.0 | 2026-07-17 | `try_exists`, `rename`, CQE-overflow fix |

The gate is `cfg(all(tokio_unstable, feature = "io-uring", feature = "rt", feature = "fs",
target_os = "linux"))` (`tokio-1.53.1/src/macros/cfg.rs:738`).

**The positional gap is now an API boundary, not missing machinery.**
`tokio-1.53.1/src/io/uring/read.rs:102` defines `read_at(fd, buf, max_len, offset)` — and it
is `pub(crate)`. The public `tokio::fs::File` has no `read_at`/`read_exact_at`; its uring path
goes through `AsyncRead`, which is a cursor. So constraint 2 still fails for tiles: adopting
it would mean one file handle per concurrent session where we share one fd for the whole
study. **Re-check when a public positional read appears** — that is the single event that
would reopen Q1.

## 4 · The two questions

**Q1 — anything better than driving `io-uring` directly, for tiles? No.** Every alternative
either brings its own runtime (constraint 1), reads through a cursor (constraint 2), or is
unmaintained or self-declared possibly-unsound (constraint 4). The binding here is ~200 lines,
adds no threads, holds 2 fds per session that misses, and is measured. Keep it.

**Q2 — what should the unbuilt sequential streaming path use? The `ReadCtx` that already
exists, reading forward.** tokio's `AsyncRead for File` over io_uring is now genuinely real
for that shape (1.52+), and it still costs `--cfg tokio_unstable` in a production build plus
one fd per streaming session — against a warm sequential read of ~10 µs set beside ~675 µs of
QUIC work per frame. Optimising 1.5% of a frame is not worth an unstable-cfg build. Revisit
if and only if the flag stabilises.

## 5 · What would change this answer

1. A **public positional read** on `tokio::fs::File` (reopens Q1).
2. `tokio_unstable`'s io_uring **stabilising** (reopens Q2 immediately).
3. `wtransport` taking a `quinn::Runtime` instead of hardcoding `TokioRuntime` (reopens the
   whole runtime question — and would still be a transport rewrite).
4. io-wq workers ever appearing in a scale run (makes `IORING_SETUP_ATTACH_WQ` worth having).

No code changes were made for this pass, as the brief asked.
