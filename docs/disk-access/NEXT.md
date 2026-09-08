# Read path — what is parked, and in what order

> Context for a cold start — what ships, what was decided, what was retracted, and the
> measurement traps: [`HANDOFF.md`](HANDOFF.md).

Written 2026-09-08. The read path is implemented, validated against the lab arms and
merged-ready; nothing here blocks the branch. The order below was set with the owners on
2026-09-08 under their weights: **latency first; simplicity and clean code valued; thousands
of sessions at depth 4 or more; studies far larger than RAM; cloud, possibly Docker, not yet
decided.** Two use cases: tiles (random positional reads) and sequential serving.

## The order, and why

| # | Item | Measured worth | What kind of change | Detail |
| --- | --- | --- | --- | --- |
| 1 | **Serving depth ≥ 4** — read ahead by one first | 1.2 ms → 0.4 ms on 16 missing tiles | session loop, not read path | §1 |
| 2 | **Miss rate observable in production** | prerequisite for checking every threshold below | telemetry | §2 |
| 3 | **`max_udp_payload_size` 1472 → 4000 B** | −35 % CPU, +55 % throughput — the largest effect measured anywhere | transport; blocked on what browsers advertise | [`adr.md`](adr.md) §Levers |
| 4 | **P0 — validate ring vs pool on the production target**, both read modes | decides whether ~800 lines stay | one campaign run | §3 |
| 5 | **Deploy manifest** — `LimitMEMLOCK`/`LimitNOFILE` or `CAP_IPC_LOCK`, `check-fastpath` on the study volume | without it the ring is silently off in a container | ops | §4 |
| 6 | **`read_ahead_kb` and layout on the target** | miss rate moved 2–15× by that one knob | tuning | [`../disk-layout/`](../disk-layout/README.md) |
| 7 | **Sequential reader for streaming mode** | evaluated: [`SEQUENTIAL-READER.md`](SEQUENTIAL-READER.md) | design input for §6c | §5 |
| 8 | **`io-uring` 0.7.14 → 0.7.15** | drop-in | dependency bump | [`RESEARCH-io-backends-RESULT.md`](RESEARCH-io-backends-RESULT.md) P2 |
| 9 | **Bounded frame cache** | −20.2 % CPU at a 0.92 hit rate, lab only | needs a real ask trace to size | [`adr.md`](adr.md) §Levers |
| 10 | **P1 — park on the ring fd, drop the eventfd** | 1 fd per session instead of 2, ~30 lines fewer, no latency change | after P0 keeps the ring | [`RESEARCH-io-backends-RESULT.md`](RESEARCH-io-backends-RESULT.md) P1 |

Items 1 and 3 move more than everything else combined, and neither is a read-path change.
With studies far larger than RAM, latency is miss count × miss cost: 6 sets the count, the
volume class sets the cost, 1 hides one miss behind the previous send. The backend (4, 8, 10)
trims tens of microseconds off each miss.

## 1 · Serving depth is 1 — the biggest available win, and the depth-4 requirement

The session loop serves one frame at a time, for `RequestFrame` and `RequestFrames` alike.
The read path can hold several reads in flight; the loop never asks for them, so the owners'
depth-4 requirement is not met by any backend choice. Overlapping the read of frame *n+1*
with the send of frame *n* is worth **1.2 ms → 0.4 ms** on 16 missing tiles, and more on
slower storage. Shape to build first: **read ahead by one**, two windows and two ring
slots — not a general *N*-deep design; measure, then widen.
[`../adr-frame-framing-and-loop-shape.md`](../adr-frame-framing-and-loop-shape.md) §6b.

## 2 · The server cannot report its own miss rate

Every threshold in this investigation is a miss rate, and it is invisible in production.
Until a session can say how often it escalated, no arm choice, layout change or read-ahead
setting can be checked against a real workload. Blocks §3's interpretation.

## 3 · P0 — decide the backend on the target, and the arm question at depth > 1

One campaign run on the production instance type, volume class and container image:
`product` against `pool`, cold, readers 64–256, depth 4, with `check-fastpath` on the study
**volume** and `ulimit -l` inside the container recorded beside the TSV. Decision rule fixed
in advance: a tie on the resolution rule deletes the ring and ships the pool; a resolved
margin keeps it and folds in P1. Why it can go either way there, and not on a workstation:
[`RESEARCH-io-backends-RESULT.md`](RESEARCH-io-backends-RESULT.md) §Decision.

Run both read modes. At depth 1 `hybrid_lazyring` and `uring` tie; crossed depth × readers,
`hybrid_lazyring` holds the better median in 8 of 9 cells and `uring` the better tail at
depth 4 ([`v33_cross.tsv`](v33_cross.tsv)), at +70–294 % CPU on hits. `WTPACS_READ_PATH=uring`
is already wired, so this is a restart, not a rebuild.

## 4 · Deploy limits — the two silent fallbacks

* **`RLIMIT_MEMLOCK`.** Ring memory is charged against it unless the process holds
  `CAP_IPC_LOCK` (`io_uring/memmap.c` `io_create_region` → `__io_account_mem`, v6.18 —
  verified 2026-09-08), so a container's limit applies. 8.7 KiB per missing session: the 8 MB
  default is ~940 rings, and it bit first on a real host, refusing two cells outright. A
  refused ring falls back to the pool, per session, without a log line.
* **`RLIMIT_NOFILE`.** 2 fds per missing session (1 after P1).
* **`RWF_NOWAIT` on the study path.** Refused on overlayfs, so a study on the image layer never
  builds a ring and runs the pool anyway; a bind-mounted or block volume is the host
  filesystem and is fine. `check-fastpath` answers it per path ([`DEPLOYMENT.md`](DEPLOYMENT.md)).

Both `LimitNOFILE` and `LimitMEMLOCK` (or the capability) belong in the manifest, and the
failure mode of forgetting them is a slower server, not a refused connection.

## 5 · Sequential serving — evaluated, design input for §6c

Server-driven streaming
([`../adr-frame-framing-and-loop-shape.md`](../adr-frame-framing-and-loop-shape.md) §6c) is
unbuilt. Which reader it should use, with every candidate measured on consecutive reads
across sizes, depths and session counts — including tokio's own `fs::File` on its io_uring
driver, the one standard alternative: [`SEQUENTIAL-READER.md`](SEQUENTIAL-READER.md).

## 6 · Scale is device-bound past ~64 reads in flight

[`SCALE-RUN.md`](SCALE-RUN.md) was run on an 8-thread workstation
([`v34_scale.tsv`](v34_scale.tsv)). It settles the arm question — `uring` does not cross
`hybrid_lazyring` at depth 2–4, and `product` tracks it everywhere — but it does not lift the
concurrency ceiling: cold throughput plateaus at ~840 MB/s from ~64 reads in flight with CPU
at 0.42 of 8 cores, so past that every arm queues on the same device and ties by construction.
Closing it needs **faster storage**, not more cores — the "storage faster than ~1.25 GB/s"
row in [`EVIDENCE.md`](EVIDENCE.md). On cloud block storage the plateau arrives earlier, which
is the whole reason P0 runs there.

## 7 · Smaller, still open

* **The 250 KB miss cell cannot resolve differences under ~2×** — the same arm varies 12.5×
  between repeats. Any 250 KB conclusion needs many more asks per cell, or a quieter device.
* **The bench copies `stream_codestream`'s 5-line loop** rather than calling it, because the
  real one needs a live QUIC stream. Low risk, but the two can drift.
* **P1 — park on the ring's own fd.** Measured in the lab as `x14` (the `uring_ringfd` and
  `hybrid_lazyring_ringfd` arms): a tie on CPU everywhere, the gain by construction. ~30 lines
  in `uring_reader.rs`; re-run the `product` arm after it lands. Only after P0 keeps the ring.
* ~~Recheck the I/O backend alternatives with network access.~~ **Closed 2026-09-08** —
  [`RESEARCH-io-backends-RESULT.md`](RESEARCH-io-backends-RESULT.md). Every row in
  [`IMPLEMENTATION.md`](IMPLEMENTATION.md) §Alternatives holds against current releases;
  nothing on crates.io drives a ring on tokio's multi-thread runtime with positional reads
  and less than this binding. Keep driving `io-uring` directly; what would reopen it is
  listed there.

## Not parked — settled on this branch

`hybrid_lazyring` ships and is validated as the *product*, not as a model of it: it ties the
arm that won (+0.7% on misses, sign at chance) and beats the path it replaced by −45.4%
RESOLVED at 16 KiB, −56 to −75% across depths. Both ring arms hold 5 OS threads flat from 1 to
256 reads in flight where `pool` reaches 98. [`IMPLEMENTATION.md`](IMPLEMENTATION.md).
