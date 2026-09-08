# Read path — what is parked, and in what order

Written 2026-09-08, mid-flight. The read path is implemented, validated against the lab arms
and merged-ready; these are the threads left open when the conversation turned to the serving
loop. Nothing here blocks the branch.

## Parked, in priority order

### 1. Serving depth is 1 — the biggest available win, and it is not a read-path change

The session loop serves one frame at a time, for `RequestFrame` and `RequestFrames` alike.
Overlapping the read of frame *n+1* with the send of frame *n* is worth **1.2 ms → 0.4 ms**
on 16 missing tiles, and more on slower storage. Shape to build: **read ahead by one**, two
windows and two ring slots — not a general *N*-deep design.
[`../adr-frame-framing-and-loop-shape.md`](../adr-frame-framing-and-loop-shape.md) §6b.

### 2. The server cannot report its own miss rate

Every threshold in this investigation is a miss rate, and it is invisible in production.
Until a session can say how often it escalated, the arm choice cannot be checked against a
real workload. Blocks §3.

### 3. The arm question, re-opened only at depth > 1

At depth 1 `hybrid_lazyring` and `uring` tie, so nothing is at stake until §1 lands. Crossed
depth × readers, `hybrid_lazyring` holds the better median in 8 of 9 cells and `uring` the
better tail at depth 4 ([`v33_cross.tsv`](v33_cross.tsv)). Re-measure at whatever depth §1
actually produces, on a host that is not 4 vCPU. `WTPACS_READ_PATH=uring` is already wired,
so this is a restart, not a rebuild.

### 4. Scale evidence tops out at 8 readers on a 4 vCPU host

Per-session *cost* is measured to thousands (2 fds, 8.7 KiB, 15.6 µs setup). Per-session
*speed* is not: past ~64 reads in flight this host is the bottleneck. Needs a bigger machine —
see [`SCALE-RUN.md`](SCALE-RUN.md).

### 5. Smaller, still open

* **`ulimit -n`.** 2 fds per missing session; a default of 1024 caps out near 500 users, and
  fails into the slow path rather than refusing a connection. Belongs in the deploy checklist.
* **The 250 KB miss cell cannot resolve differences under ~2×** — the same arm varies 12.5×
  between repeats. Any 250 KB conclusion needs many more asks per cell, or a quieter device.
* **The bench copies `stream_codestream`'s 5-line loop** rather than calling it, because the
  real one needs a live QUIC stream. Low risk, but the two can drift.
* **Server-driven streaming is unbuilt** —
  [`../adr-frame-framing-and-loop-shape.md`](../adr-frame-framing-and-loop-shape.md) §6c.
  When it is built, re-weigh tokio's io_uring `File::read` for *that* path only: streaming is
  a sequential cursor read, so the "no positional read" objection does not apply. Costs to
  weigh then: `--cfg tokio_unstable` in a production build, and one fd per streaming session
  instead of one shared for the whole study.
* **Recheck the runtime alternatives with network access.** The `tokio-uring`, `glommio`,
  `monoio` and `compio` rows in [`IMPLEMENTATION.md`](IMPLEMENTATION.md) §Alternatives are from
  prior knowledge, not verified — this sandbox has no crates.io. The argument that rules them
  out is architectural (they bring their own runtime; `wtransport`/`quinn` need tokio's
  multi-thread one) and does not depend on their versions, but if one has since gained
  multi-thread tokio compatibility that row should be reopened.

## Not parked — settled on this branch

`hybrid_lazyring` ships and is validated as the *product*, not as a model of it: it ties the
arm that won (+0.7% on misses, sign at chance) and beats the path it replaced by −45.4%
RESOLVED at 16 KiB, −56 to −75% across depths. Both ring arms hold 5 OS threads flat from 1 to
256 reads in flight where `pool` reaches 98. [`IMPLEMENTATION.md`](IMPLEMENTATION.md).
