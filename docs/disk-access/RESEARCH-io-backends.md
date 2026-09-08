# Research brief: is there a better I/O backend for this read path?

**For an agent with web access** (Cursor, or a local session that can reach crates.io and
docs.rs). Everything below marked *unverified* was written in a sandbox with no network. The
job is to verify it, extend it, and come back with a recommendation that is either "keep what
we have" or a specific named change.

Write the answer into `docs/disk-access/RESEARCH-io-backends-RESULT.md` and link it from
[`NEXT.md`](NEXT.md).

---

## 1 · What this server is, in the terms that constrain the answer

A WebTransport server that streams HTJ2K medical image frames out of a single packed file
(`.sbnd`) to browser clients. Read path, as shipped:

| | |
| --- | --- |
| Runtime | **tokio multi-thread**, work-stealing (`tokio = "1.53"`, features `full`) |
| Transport | `wtransport 0.7` → `quinn 0.11` → **`quinn::TokioRuntime`** |
| Toolchain | rustc 1.94.1, edition 2021, Linux 6.18 |
| Read shape | **positional** — a frame is a byte range `(offset, len)` read out of order |
| Descriptors | **one `File` per study**, shared by `Arc` across every session |
| Hit path | `preadv2(RWF_NOWAIT)` inline on the executor — returns short rather than blocking |
| Miss path | `io-uring 0.7` crate, driven directly: registered file, unregistered buffers, eventfd + `AsyncFd` for completions |
| Per session | one ring + one eventfd (**2 fds**, 8.7 KiB) built on that session's *first* miss |

Two workloads, and they want different things:

* **Random / tile** (the built path): a viewport asks for scattered frames. Positional reads,
  out of order, most missing the page cache.
* **Sequential streaming** (`../adr-frame-framing-and-loop-shape.md` §6c, **not built**): the
  client says "study open", the server streams frames start to end. This *is* a cursor read,
  and the positional constraint below does not apply to it.

## 2 · Constraints that disqualify an option outright

Check these before spending time on a candidate.

1. **It must run on tokio's multi-thread runtime.** `wtransport`/`quinn` require
   `quinn::TokioRuntime`. Anything that brings its own runtime (thread-per-core,
   current-thread-only, completion-first) is a **transport rewrite**, not a read-path change.
   Say so explicitly rather than recommending it as a drop-in.
2. **It must support positional reads** for the random/tile path — `pread`-style, an offset
   per call. A cursor-only API forces one file handle per concurrent session, where we
   currently share one fd for the whole study however many thousands of sessions read it.
3. **It must not block a worker thread on a page fault or on I/O.** That is the entire reason
   mmap was rejected: a major fault is not an `.await`, so it freezes every task on that OS
   thread. Measured `gap_max` 1.5–4.2 ms cold, 7.7 ms under pressure.
4. **Production-grade for a medical imaging server.** `--cfg tokio_unstable`, `unsafe` without
   a clear contract, or an unmaintained crate are costs to name, not footnotes.

## 3 · What is already settled — do not re-open without new evidence

These were measured on this branch. Numbers and raw TSVs are in
[`EVIDENCE.md`](EVIDENCE.md), [`IMPLEMENTATION.md`](IMPLEMENTATION.md) and the `v3*.tsv` files.

* **mmap is rejected** — executor stalls, and `mincore` gating was unsafe on 5/5 runs.
* **`spawn_blocking` + `pread` is the fallback, not the default** — −56 to −75% slower on
  misses, and it grows OS threads (98 at 256 reads in flight, where ring arms hold 5).
* **`O_DIRECT`/SPDK, `sendfile`/`splice`** — wrong scale; userspace QUIC copies anyway.
* **`RWF_NOWAIT` inline is the hit path and stays.** A page-cache hit must not touch a ring:
  plain io_uring costs **+69.8% to +293.9% CPU on hits**.

## 4 · The candidates, and exactly what to find out

The four rows below were written from prior knowledge and are **unverified**. Treat every
claim as a hypothesis to check against current releases.

| Candidate | Hypothesis to verify | Verdict if true |
| --- | --- | --- |
| **`tokio-uring`** | Current-thread runtime with its own driver; owned-buffer API; low maintenance activity | Fails constraint 1 |
| **`glommio`** | Thread-per-core, io_uring-native, own runtime | Fails constraint 1 |
| **`monoio`** | Thread-per-core, io_uring/IOCP, own runtime | Fails constraint 1 |
| **`compio`** | Completion-based, io_uring + IOCP, own runtime | Fails constraint 1 |
| **`tokio` `io-uring` feature** | **Verified already**: gated behind `--cfg tokio_unstable`; routes *sequential* `File::read`; `tokio::fs` has no `read_at`/`read_exact_at` | Fails constraint 2 for tiles; **viable for streaming** |
| **`io-uring` crate direct** (current) | 0.7.x, actively maintained, raw but complete | — |

For each, report: **latest version, last release date, maintenance status, whether it works on
a multi-thread tokio runtime, and whether it offers a positional read.** A one-line answer per
crate with a link is enough; do not write an essay.

### Also look for things not on this list

The list above is what one engineer could remember. Go find what is missing. Places worth
looking:

* Crates depending on `io-uring` 0.7 (reverse dependencies on crates.io) — someone may have
  already built the "ring on a multi-thread tokio runtime" wrapper we hand-rolled.
* `rio`, `uring-fs`, `ringbahn`, `nuclei`, or successors — check whether any is alive.
* Kernel-side features we are not using: **registered buffers** (measured as unnecessary, see
  IMPLEMENTATION.md), `IORING_SETUP_SQPOLL` (measured: 2.8× the CPU), multishot reads,
  `IORING_REGISTER_RING_FDS`, or anything newer than the 6.x baseline that reduces
  per-session cost. Our per-session cost is 2 fds — if a kernel feature shares a ring across
  sessions safely, that is worth more than a different crate.
* Whether `quinn`/`wtransport` have gained a runtime abstraction that would loosen
  constraint 1.

## 5 · The two questions that actually decide something

**Q1 — For the random/tile path, is there anything better than driving `io-uring` directly?**
"Better" means: fewer fds per session, less `unsafe`, simpler code, or measurably faster —
without failing §2. The bar is high; the current implementation is ~130 lines and measured.

**Q2 — For the unbuilt sequential streaming path, what should it use?**
The positional constraint does not apply. Candidates: the existing `ReadCtx` reading forward
(costs nothing new), `tokio::fs` + `io-uring` feature (costs `tokio_unstable` and one fd per
session), or something else. Weigh it against the fact that a sequential read is the page
cache's best case: **~10 µs warm read against ~675 µs of QUIC work per frame**, so this is
optimising ~1.5% of a frame.

## 6 · What a good answer looks like

* A verdict per candidate: **keep / adopt / adopt-for-streaming-only / rejected**, each with a
  reason tied to §2 and a link to the evidence.
* Versions and dates, so the next reader knows when it was checked.
* Anything found that is **not** in §4 — that is the highest-value part of this brief.
* If the answer is "keep what we have", say so plainly. That is a real result and it closes an
  open item in [`NEXT.md`](NEXT.md).
* **No code changes.** This is a research pass; a recommendation to change comes back here
  first.

## 7 · How to check a claim against this repo

```bash
git checkout claude/disk-access-adr-validation-saz6m8
cargo tree -p exact-server | grep -E "tokio|quinn|io-uring|wtransport"
sed -n '1,60p' server/src/media/uring_reader.rs      # the current binding, in full
sed -n '1,80p' server/src/media/read_path.rs         # how it is used
./target/release/check-fastpath .                    # does RWF_NOWAIT work here at all
```

The measured baselines any alternative has to beat are in
[`IMPLEMENTATION.md`](IMPLEMENTATION.md) §Validated and `v30`–`v33` TSVs in this directory.
