# Read path — what is parked, and in what order

> Context for a cold start — what ships, what was decided, what was retracted, and the
> measurement traps: [`HANDOFF.md`](HANDOFF.md).

Written 2026-09-08, updated the same day after a second session landed read-ahead-by-one and
the miss-rate reporting. The read path is implemented, validated against the lab arms and
merged-ready; nothing here blocks the branch. The order below was set with the owners under
their weights: **latency first; simplicity and clean code valued; thousands of sessions at
depth 4 or more; studies far larger than RAM; cloud, possibly Docker, not yet decided.** Two
use cases: tiles (random positional reads) and sequential serving.

**That ordering came from the owners and stands.** Items closed since it was written are
struck through in place rather than removed, so the order is still readable as they set it.

## The order, and why

| # | Item | Measured worth | What kind of change | Detail |
| --- | --- | --- | --- | --- |
| 1 | **Serving depth ≥ 4** — read ahead by one **is built for `RequestFrames`**; `RequestFrame` is still depth 1 | +73.8 % asks/s on missing tiles, measured on the shipped path; 1.14 ms → 0.62 ms on 16 | **loop landed 2026-09-09, unmeasured**; W above 2 waits on step 3 — tiles go to 4, fill stays 2 ([`READ-PATH-DESIGN.md`](READ-PATH-DESIGN.md) §9.3) | §1 |
| 2 | ~~**Miss rate observable in production**~~ **Done** | every threshold below can now be checked against a real workload | `session reads …` per session, default build | [`IMPLEMENTATION.md`](IMPLEMENTATION.md) §Reporting |
| 3 | **`max_udp_payload_size` 1472 → 4000 B** | −35 % CPU, +55 % throughput — the largest effect measured anywhere | transport; blocked on what browsers advertise | [`adr.md`](adr.md) §Levers |
| 4 | **P0 — validate ring vs pool on the production target**, both read modes | decides whether ~800 lines stay | one campaign run | §3 |
| 5 | **Deploy manifest** — `LimitMEMLOCK`/`LimitNOFILE` or `CAP_IPC_LOCK`, `check-fastpath` on the study volume | without it the ring is silently off in a container | ops; **the numbers and the manifest snippets are now in [`DEPLOYMENT.md`](DEPLOYMENT.md)** | §4 |
| 6 | **`read_ahead_kb` and layout on the target** | miss rate moved 2–15× by that one knob | tuning | [`../disk-layout/`](../disk-layout/README.md) |
| 7 | **Sequential reader for streaming mode** | **settled:** the shipped reader forward, one frame ahead; `tokio::fs` rejected on measurement — [`SEQUENTIAL-READER.md`](SEQUENTIAL-READER.md) | design input for §6c, no reader change | §5 |
| 8 | **`io-uring` 0.7.14 → 0.7.15** | drop-in | dependency bump | [`RESEARCH-io-backends-RESULT.md`](RESEARCH-io-backends-RESULT.md) P2 |
| 9 | **Bounded frame cache** | −20.2 % CPU at a 0.92 hit rate, lab only | needs a real ask trace to size | [`adr.md`](adr.md) §Levers |
| 10 | **P1 — park on the ring fd, drop the eventfd** | 1 fd per session instead of 2, ~30 lines fewer, no latency change | after P0 keeps the ring. `uring_reader.rs` now carries two slots and a per-slot `Pending`, so re-read it before costing the change | [`RESEARCH-io-backends-RESULT.md`](RESEARCH-io-backends-RESULT.md) P1 |

Everything below the table was found or written after that ordering was set, so nothing there
reorders it.

Items 1 and 3 move more than everything else combined, and neither is a read-path change.
With studies far larger than RAM, latency is miss count × miss cost: 6 sets the count, the
volume class sets the cost, 1 hides one miss behind the previous send. The backend (4, 8, 10)
trims tens of microseconds off each miss.

## 1 · Serving depth — half built, and the depth-4 requirement is not met

> The design that takes this past two, with `RequestFrame` kept and the loop, seam and
> numbers sequenced: [`READ-PATH-DESIGN.md`](READ-PATH-DESIGN.md).

**Built:** read ahead by one. Two windows, each with its own ring slot, and a frame served in
a `RequestFrames` batch names the one after it, so its read starts before this one is waited
on. Measured on the shipped `ReadCtx`: **+73.8 % asks/s, 12/12, RESOLVED** on cold 16 KiB,
p50 −53.4 %, **warm a tie** ([`v36_readahead.tsv`](v36_readahead.tsv),
[`IMPLEMENTATION.md`](IMPLEMENTATION.md) §Read ahead by one). 16 missing tiles: 1.14 →
0.62 ms.

**2026-09-09 — the loop landed** (ask-reader task, `StreamFrames` + `EndStream`, the peek that
gives a pipelined `RequestFrame` its next; [`HANDOFF.md`](HANDOFF.md) §1), unmeasured. Why the
loop and W are not where latency is lost on the owners' default link, the call to widen tiles to
W = 4 anyway and keep fill at 2, and the one cell to run: [`READ-PATH-DESIGN.md`](READ-PATH-DESIGN.md)
§9. The simplification cuts to choose from before step 3: §10 there. The paragraph below is
kept as the state that ordering was set against.

**Not built, and it is the loop, not the read path:** `run_session` still does not read the
next ask until the current frame is on the wire, so a client that pipelines `RequestFrame`
gets depth 1, and a fill has no message that can stop it mid-study. The design is
[`READ-PATH-DESIGN.md`](READ-PATH-DESIGN.md) and
[`../adr-frame-framing-and-loop-shape.md`](../adr-frame-framing-and-loop-shape.md) **§6d**.
Fill (`StreamFrames` + `EndStream`) is why the reader task is required; pipelined
`RequestFrame` is the other half of the same split.

**And depth 2 is a first step, not the requirement.** The owners asked for depth 4 or more.
[`v35_depth2.tsv`](v35_depth2.tsv) prices the ladder on this host: depth 2 is +67.4 % over
depth 1 and collects 62 % of what depth 16 offers; from the medians, 2 → 4 adds a further
+37 % and 4 → 16 +28 %. Widening past two costs a slot table and a completion demultiplexer,
so it is worth doing only once the loop can actually keep four asks in flight.

## 2 · The server reports its own miss rate — done

`read_fast_path=preadv2|pooled_pread` in the startup banner (with a warning on the bad one),
and `session reads hits=… misses=… miss_rate=… ring=…` when a session ends. Both in the
**default** build, not behind the telemetry feature.
[`IMPLEMENTATION.md`](IMPLEMENTATION.md) §Reporting says what a "read" is there — a window,
not a frame, and at 16 KiB they coincide.

This is what P0 (§3) needs to be interpretable on the target, and what makes any later arm or
layout claim checkable against a real workload rather than against the campaign's `--mix`.

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
unbuilt. Which reader it should use is settled — [`SEQUENTIAL-READER.md`](SEQUENTIAL-READER.md):
the shipped `ReadCtx` reading forward, one frame ahead, frame-sized asks. On consecutive reads
it ties the simplest reader on every column at 5 threads; tokio's `fs::File` is 15× slower per
read, and on tokio's io_uring driver it serialises on one locked ring and collapses past a
handful of sessions (`x15`). What §6c still has to design is flow control, not the reader.

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

* ~~**Live defect: the write chunk collapses to the whole frame where `RWF_NOWAIT` is
  refused.**~~ **Fixed 2026-09-08** (`259e25f`). `stream_codestream` took its *write* chunk from
  `store.read_window(span.len)`, which answers a *read* question and deliberately returns the
  whole frame when the probe is refused — so on overlayfs, the deployment
  [`DEPLOYMENT.md`](DEPLOYMENT.md) already calls the slow one, every 250 KB frame was one
  uninterrupted executor copy, the shape [`adr.md`](adr.md) rejected an arm for at 4.0 ms warm
  `gap_max`. The write chunk is now `READ_WINDOW` outright (`write_chunks` in `frame_out.rs`),
  pinned by `a_pooled_frame_is_written_in_read_windows_not_in_one_copy`. Kept here because it
  was live for the length of this branch and is [`READ-PATH-REVIEW.md`](READ-PATH-REVIEW.md)
  fault 1: change A must not reintroduce it by collapsing the two sizes back into one.
* **Two proposal documents cover the same ~120 lines.**
  [`READ-PATH-REVIEW.md`](READ-PATH-REVIEW.md) — the seam, changes A and B — and
  [`READ-PATH-DESIGN.md`](READ-PATH-DESIGN.md) — depth, messages and the loop around it — were
  written in two sessions and cross-reference each other, but an implementer who reads one alone
  gets half the design. Fold them into one, per [`../../CLAUDE.md`](../../CLAUDE.md) §Docs.
* **The 250 KB miss cell cannot resolve differences under ~2×** — the same arm varies 12.5×
  between repeats. Any 250 KB conclusion needs many more asks per cell, or a quieter device.
  **And check that the cell misses at all**: at `--size 250000 --stride 250000` against 8 MiB
  of read-ahead, `v36`'s cold cell reached **4.7 %** misses — a hit cell wearing a cold label.
  Isolating 250 KB misses needs ≥ 8 MiB between asks, so a fixture of ~2 GB for 256 distinct
  positions. Every fixture is gitignored and regenerates with `lab/scripts/gen_live_cell_fixture.sh`
  ([`README.md`](README.md)) — a fresh checkout has none of them.
* **The bench copies `stream_codestream`'s loop** rather than calling it, because the real one
  needs a live QUIC stream. Four lines now, and the real loop gained an end-to-end test
  (`a_batch_arrives_whole_and_in_ask_order`, the first here to drive the server over a real
  WebTransport connection), so a break in the product would be caught — but only the copy is
  measured, and the two can still drift.
* **`serve_batch`'s look-ahead has no test of its own.** `frames.get(position + 1)` is one
  line; the read path's use of it is covered from both ends, the wiring is not. The fill loop's
  equivalent now is — `a_fill_recites_from_to_inclusive_in_order` asserts the `(frame, next)`
  pairs against a `RecordingPipeline` — so closing this is one test of that shape driving
  `RequestFrames`.
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
