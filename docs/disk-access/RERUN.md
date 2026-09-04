# Disk-access validation campaign — 2026-09-04

Re-run of the 2026-08-31 decision with a corrected instrument and three arms it never had.
**Decision:** [`adr.md`](adr.md) · **How to run:** [`README.md`](README.md)

**Host:** KVM guest · 4 vCPU Xeon @2.1 GHz · 16 GB RAM · **ext4 on `/dev/vda`** (not
overlayfs — this closes the archive's C3 follow-up) · Linux 6.18 · cgroup v1.
Cold sequential read from the guest's own cache-miss path: ~400 MB/s.
Fixture: `frames_250k_live` — 320 × 250 000 B ≈ 80 MB.

---

## Instrument

Everything the archived harness had — co-tenant `yield_now` gap monitor, per-frame await,
quinn-shaped chunked `write_sim`, equal byte consume by every arm, one-pass cold — plus
four fixes. The first three are why the archived numbers pointed the wrong way.

| Fix | What was wrong |
| --- | --- |
| **`--runtime multi`** | The harness ran `Builder::new_current_thread()`. The product is `#[tokio::main]` — multi-thread. Every hop cost, and therefore the whole decision, differs. Both shapes are reported. |
| **Interleaved repeats** | All repeats of one arm ran back to back, so slow host drift landed on whichever arm held that block. The archived warm table has `mmap_hybrid_mincore` (naive **plus** a `mincore` syscall) beating `mmap_naive` — impossible by construction, and a ~10 µs drift artifact at the scale of the ~8 µs effect being decided. Repeat is now the outer loop. |
| **Cold cells are verified cold** | `fadvise(DONTNEED)` cannot evict page-cache pages that are still mapped, and `FrameStore::open` parses the header — dragging read-ahead into the first frames. Measured 1.4–2.1% of frame data resident at the start of a "cold" cell. Now: `madvise(DONTNEED)` the data region, `fadvise(DONTNEED)` the file, then assert `< 0.1%` resident or abort the cell. |
| **`--bg-arm same`** | The C2 neighbours always ran always-touch, so the hop tax could never show up as a neighbour cost. This is the all-sessions cell the archive listed as a follow-up. |

Two bugs also had to be fixed before the pressure cell could run here at all: the wrapper
rejected cgroup v1's `stat -f` name (`cgroupfs`) and refused the v1 path when already root,
and the in-process assert took a hybrid host's empty `0::/` v2 line as authoritative and
never looked at the v1 memory controller.

Arms read through the product `FrameStore`, so `pread_nowait*` time
`read_at_nowait`/`read_at_blocking` as shipped.

### Metric glossary

| Column | Meaning |
| --- | --- |
| `later_p50/p99_ns` | Per-frame prep+write cost after the first ask |
| `hop_count` | Asks (of 320) that paid a `spawn_blocking` round trip |
| `gap_max_ns` | Worst co-tenant `yield_now` gap — how long the executor was unavailable |
| `other_later_p99_ns` | Multi-session: background sessions' ask latency during the primary. **Lead with this for neighbour safety** |
| `runtime` | `current` (archived shape) or `multi` (product shape) |

---

## Cell 1 — Arm comparison · [`v2_arms_multi.tsv`](v2_arms_multi.tsv) · [`v2_arms_current.tsv`](v2_arms_current.tsv)

```bash
./target/release/disk-access-bench --study lab/fixtures/frames_250k_live/frames_250k_live.sbnd \
  --arm mmap-naive --arm mmap-hybrid-mincore --arm mmap-blocking-touch --arm mmap-touch-in-place \
  --arm mmap-populate-read --arm pread-blocking --arm pread-blocking-pooled \
  --arm pread-nowait --arm pread-nowait-chunked \
  --temp warm --temp cold --trace forward --chunk 16384 --repeats 9 \
  --runtime multi --read-chunk 65536 --out docs/disk-access/v2_arms_multi.tsv
```

Median of 9 interleaved repeats, **product runtime**:

| Arm | Warm p50 | Warm hops | Cold p50 | Cold hops | Cold gap_max (med / worst) |
| --- | ---: | ---: | ---: | ---: | ---: |
| mmap_naive | 29.5 µs | 0 | 39.2 µs | 0 | 1578 / **2078 µs** |
| mmap_hybrid_mincore | 25.6 µs | 0 | 39.8 µs | 10 | 213 / 742 µs |
| mmap_blocking_touch *(prior ADR)* | 103.4 µs | 320 | 118.7 µs | 320 | 79 / 127 µs |
| mmap_populate_read | 97.6 µs | 320 | 127.6 µs | 320 | 189 / 1282 µs |
| mmap_touch_in_place | 38.2 µs | 320 | 54.4 µs | 320 | 127 / 2168 µs |
| pread_blocking (fresh `Vec`) | 149.2 µs | 320 | 153.7 µs | 320 | 117 / 1053 µs |
| pread_blocking_pooled | 132.5 µs | 320 | 139.7 µs | 320 | 118 / 2674 µs |
| pread_nowait (whole frame) | 43.9 µs | **0** | 44.0 µs | 6 | 302 / 428 µs |
| **pread_nowait_chunked (accepted)** | **48.4 µs** | **0** | **48.1 µs** | **6** | 186 / 420 µs |

Three readings:

* **The hop is the whole cost.** `mmap_populate_read` replaces the byte-per-page touch loop
  with one `madvise` syscall and lands within noise of it (97.6 vs 103.4 µs). What
  always-touch pays for is the `spawn_blocking` round trip, not the touching.
* **Pooling a `pread` buffer saves ~17 µs** (149.2 → 132.5 µs) and nothing else — the
  archive's D3 conclusion, reproduced.
* **The nowait arms take no hop at all when warm**, and 6 of 320 when cold and sequential.
  That is the difference the decision turns on.

Same arms on the **archived** current-thread shape: always-touch 40.0 µs warm (not 103.4),
naive 20.8, chunked nowait 36.6. The arm order is unchanged; the *size* of the hop tax is
what the runtime decides — and the product's runtime is the expensive one.

---

## Cell 2 — Memory pressure · [`c1_mempressure_multi.tsv`](c1_mempressure_multi.tsv) · [`c1_mempressure_current.tsv`](c1_mempressure_current.tsv)

```bash
lab/scripts/run_disk_access_mempressure.sh 48M -- \
  --study lab/fixtures/frames_250k_live/frames_250k_live.sbnd \
  --arm ... --temp cold --trace forward --chunk 16384 --repeats 5 --read-chunk 65536 \
  --runtime multi --out docs/disk-access/c1_mempressure_multi.tsv
```

48 MiB cgroup, 80 MB study. The wrapper prints `fstype=cgroupfs (v1)` and the bench prints
`cgroup mem assert ok` — abort if either is missing. Per-run `gap_max` (µs):

| Arm | current-thread | multi-thread |
| --- | --- | --- |
| mmap_naive | 3585 · 4003 · 3958 · **7698** · 3928 | 57 · 241 · 270 · 1763 · 1997 |
| mmap_hybrid_mincore | 2850 · 515 · 2663 · 1784 · 2984 | 2123 · 210 · 131 · 1341 · 750 |
| mmap_blocking_touch | 92 · 74 · 152 · **4008** · 133 | 137 · 1076 · 527 · 326 · 100 |
| pread_blocking_pooled | 197 · 206 · 200 · 133 · 130 | 103 · 841 · 91 · 305 · 449 |
| pread_nowait | 1772 · 344 · 355 · 2424 · 251 | 324 · 140 · 217 · 280 · 172 |
| **pread_nowait_chunked** | 658 · 517 · 409 · 186 · 411 | **292 · 177 · 161 · 135 · 124** |

**Confirms the archive:** the `mincore` gate is unsafe under pressure — here on **5/5** runs
in both shapes, worse than the 2/5 the archive reported. Do not read it as a rare outlier.

**Corrects the archive:** always-touch is not immune either (one 4.0 ms current-thread run,
one 1.1 ms multi run). On the product runtime the chunked nowait arm has the tightest
worst case of any arm measured.

---

## Cell 3 — Neighbour safety · [`c2_multisession_bg-same.tsv`](c2_multisession_bg-same.tsv) · [`c2_multisession_bg-always-touch.tsv`](c2_multisession_bg-always-touch.tsv)

4 background sessions + 1 primary on 4 workers, 400 asks each. Median of 5, cold primary,
**lead with other p99**:

| Arm | Archived shape (neighbours on always-touch) | **All sessions on the arm** |
| --- | ---: | ---: |
| mmap_naive | 327 µs | 160 µs |
| mmap_hybrid_mincore | 400 µs | 145 µs |
| mmap_blocking_touch | 449 µs | 392 µs |
| mmap_touch_in_place | 698 µs | 1156 µs |
| pread_blocking_pooled | 468 µs | 587 µs |
| **pread_nowait_chunked** | **284 µs** | **151 µs** |

The archive's headline — cold naive inflating neighbour p99 ~3× versus always-touch — does
**not** reproduce: naive is better on this axis in both shapes. On four workers, naive's
pathology lands in `gap_max` (Cell 1), not in a neighbour's p99, because work stealing
rescues tasks off the faulting worker. Naive is still rejected; the reason is `gap_max`.

The all-sessions column is the one the previous ADR never ran. When neighbours pay the hop
too, always-touch goes from "keeps neighbours near baseline" to the worst safe arm.

## Cell 4 — Pressure *and* all sessions · [`c4_pressure_allsessions.tsv`](c4_pressure_allsessions.tsv)

128 MiB cgroup, 4 background sessions on the arm under test + cold primary — the closest
cell to production. Median of 5:

| Arm | Warm other p99 | Cold other p99 | Cold gap_max |
| --- | ---: | ---: | ---: |
| mmap_naive | 108 µs | 225 µs | **4528 µs** |
| mmap_blocking_touch | 337 µs | 702 µs | 943 µs |
| mmap_touch_in_place | 881 µs | 2150 µs | 1351 µs |
| pread_blocking_pooled | 467 µs | 953 µs | 1252 µs |
| **pread_nowait_chunked** | **152 µs** | **166 µs** | **613 µs** |

## Cell 5 — Non-sequential traces · [`v3_traces_multi.tsv`](v3_traces_multi.tsv)

The nowait arm's low cold hop count comes from read-ahead, so it has to be shown on traces
that defeat read-ahead. Cold, median of 5:

| Arm | random p50 / hops | reverse p50 / hops |
| --- | ---: | ---: |
| mmap_blocking_touch | 141 µs / 320 | 153 µs / 320 |
| pread_blocking_pooled | 347 µs / 320 | 379 µs / 320 |
| pread_nowait (whole frame) | 344 µs / 191 | 387 µs / 320 |
| **pread_nowait_chunked** | 75 µs / 58 | 421 µs / **320** |

A cold reverse pass is the honest worst case: every window misses, the arm becomes pooled
`pread` exactly, and it lands within noise of it (421 vs 379 µs) with a *better* `gap_max`
(176 vs 205 µs). **It degrades to the escape hatch; it never degrades below it.** Warm —
which is the common case, and where the sequential result was never in doubt — it takes
zero hops on random and reverse alike (42.5 µs, 42.5 µs).

---

## Cell 6 — io_uring

The first pass of this ADR deferred io_uring with an argument rather than a measurement
("would replace the fallback, not the fast path"). It is measured here, tuned rather than
naive, because a strawman io_uring arm would prove nothing.

### What the workload lets io_uring do

| io_uring strength | Available here? |
| --- | --- |
| Deep queues, batched submission | **Barely.** The session loop sends one frame to completion before reading the next ask (`docs/adr-reject-server-ordering.md`), so queue depth is 1. The only batch inside an ask is the frame's own four windows — which `uring_tuned` submits together |
| No thread pool for blocking I/O | **Yes** — this is the real opportunity, on the miss |
| Registered files / fixed buffers | **Yes** — used by every tuned arm |
| `SINGLE_ISSUER`, `DEFER_TASKRUN` | **No.** Tokio's multi-thread runtime resumes a task on whichever worker steals it, so a per-session ring is submitted from different threads. The kernel answers `EEXIST`; `uring_access.rs` has a test that pins this down rather than citing documentation. These are io_uring's two biggest knobs and a work-stealing runtime cannot have them |
| `SQPOLL` | Yes, and it tolerates migration — measured below |
| Provided buffers, linked ops, multishot, zero-copy | Not applicable: read sizes are known, reads do not chain, and userspace QUIC copies regardless |

Completions are awaited through a registered eventfd wrapped in Tokio's `AsyncFd` —
blocking in `io_uring_enter` would reintroduce the exact executor stall this ADR is about.
That eventfd costs one extra `read` per *parked* completion, and parks are rare (0 warm,
4 of 1280 window reads on a cold sequential pass), so it is not what limits these arms.

### Arms · [`v4_uring_arms.tsv`](v4_uring_arms.tsv) · [`v4_uring_hybrid.tsv`](v4_uring_hybrid.tsv)

Warm, 9 interleaved repeats, `--monitors 0`. `pread_nowait_chunked` appears in both cells at
84.9 and 84.7 µs, which is what makes them comparable:

| Arm | Warm p50 | CPU/ask | Threads | Session memory |
| --- | ---: | ---: | ---: | ---: |
| **pread_nowait_chunked** *(accepted)* | 84.7 µs | 106 µs | 5 | 64 KiB |
| uring_nowait_hybrid | **80.9 µs** | **104 µs** | 5 | 64 KiB + ring |
| uring_tuned (batched, registered) | 82.1–88.1 µs | 104–111 µs | 5 | 256 KiB + ring |
| uring_pipelined | 103.0–108.6 µs | 136–141 µs | 5 | 128 KiB + ring |
| uring_naive | 108.6 µs | 142 µs | 5 | 64 KiB + ring |
| mmap_blocking_touch | 132.0 µs | 161 µs | 6 | none |
| pread_blocking_pooled | 162.7 µs | 188 µs | 6 | 250 KB |
| pread_pipelined_pool | 177.4 µs | 251 µs | 6 | 128 KiB |

The hybrid — `RWF_NOWAIT` inline, io_uring only for the shortfall — is the best io_uring
arm, and it ties the accepted path within noise. That is the expected result once stated
plainly: **on a page-cache hit the hybrid *is* the accepted path**, and a hit is what the
warm path always gets. io_uring can only differ where the read misses.

`pread_pipelined_pool` is the control that separates "pipelining" from "io_uring": the same
overlap built on `spawn_blocking` is the worst arm in the campaign, and in the multi-session
cell it reached **28–30 OS threads** and a 1.35 ms neighbour p99 by paying four pool hops
per frame instead of one. Pipelining is only viable through a ring.

### SQPOLL · [`v4_uring_sqpoll.tsv`](v4_uring_sqpoll.tsv)

| Arm | Warm p50 | CPU/ask | Parked completions |
| --- | ---: | ---: | ---: |
| pread_nowait_chunked | 83.9 µs | 126 µs | 0 |
| uring_tuned + SQPOLL | 153.0 µs | **287 µs** | 320 |
| uring_pipelined + SQPOLL | 134.2 µs | **297 µs** | 320 |

A kernel submitter removes the submit syscall and takes far more than it gives: nothing
completes inline any more, so every read parks on the eventfd, and the `iou-sqp` thread's
spin is charged to the process. (`COOP_TASKRUN` is rejected alongside `SQPOLL` with
`EINVAL` — with a kernel submitter there is no task work to defer.)

### Neighbours · [`v4_uring_multisession.tsv`](v4_uring_multisession.tsv)

Five sessions, all on the arm under test, cold primary. Median of 5:

| Arm | Other p99 | gap_max | Threads |
| --- | ---: | ---: | ---: |
| **pread_nowait_chunked** | **143.7 µs** | **241 µs** | 6 |
| uring_naive | 160.5 µs | 278 µs | 5 |
| uring_tuned | 182.4 µs | 373 µs | 5 |
| uring_pipelined | 183.7 µs | 274 µs | 5 |
| mmap_blocking_touch | 726.6 µs | 776 µs | 16 |
| pread_pipelined_pool | 1451 µs | 937 µs | 30 |

Five per-session rings did not multiply io-wq workers — the io_uring arms hold thread count
at 5. But so does the accepted path, for a simpler reason: it almost never hops.

### The cold path cannot be resolved on this host · order-controlled

Cold cells first appeared to favour io_uring — 34% lower CPU and a 6.5× better p99. Both
evaporated under an order control. Arms run round-robin, so each takes a turn creating its
own 80 MB cold copy; re-running with the arm order reversed moved the penalty rather than
keeping it with the arm ([`v4_order_control_forward_nowait_first.tsv`](v4_order_control_forward_nowait_first.tsv) ·
[`v4_order_control_forward_uring_first.tsv`](v4_order_control_forward_uring_first.tsv), 25 repeats each):

| Arm | CPU/ask, listed first | CPU/ask, listed last |
| --- | ---: | ---: |
| pread_nowait_chunked | 154 µs | **111 µs** |
| uring_tuned | 116 µs | 117 µs |

**No cold difference between these arms is resolvable on this host**, even at 25 repeats —
the hypervisor's own cache decides how much real I/O a cold pass does, and that swamps
everything. Any cold ranking here, in either direction, is noise.

The one cold claim that did survive the control is the 100%-miss trace, where every arm does
the same disk work and the mechanism is all that is left
([`v4_order_control_reverse_nowait_first.tsv`](v4_order_control_reverse_nowait_first.tsv) ·
[`v4_order_control_reverse_uring_first.tsv`](v4_order_control_reverse_uring_first.tsv), 9 repeats each,
cold reverse):

| Arm | p50, order A | p50, order B |
| --- | ---: | ---: |
| **uring_pipelined** | **349 µs** | **340 µs** |
| pread_nowait_chunked | 358 µs | 372 µs |
| uring_tuned | 437 µs | 408 µs |

Pipelining is worth ~6% when every read misses, consistently in both orders. It costs ~25%
on the warm path, which is the path a server spends its life on.

### Verdict

io_uring is not dismissed here; it is tied. Its fast path cannot beat `RWF_NOWAIT` because
both resolve to the same kernel work on a cache hit, and the miss path — where it could
win — is either unresolvable on this host or worth single-digit percent. Against that: a
ring, an eventfd and registered buffers per session, a dependency, and the loss of
`SINGLE_ISSUER`/`DEFER_TASKRUN`.

Two conditions would make it worth revisiting, and both are in [`later.md`](later.md):

1. **A thread-per-core runtime.** Pinning sessions to cores unlocks `SINGLE_ISSUER` +
   `DEFER_TASKRUN` and removes the eventfd. That is a server-wide architecture change, not
   a disk-access decision, and this campaign cannot justify it on its own.
2. **A genuinely miss-dominated deployment.** Everything above says the same thing: io_uring
   only matters where reads miss. A study whose working set really does exceed RAM, with a
   real ask window to prefetch against, is where pipelining and ahead-N would pay — and
   where this host's variance stopped being able to see.

---

## Filesystem support

`preadv2(RWF_NOWAIT)` probed directly on this host:

| Filesystem | Warm read | Cold read | Verdict |
| --- | --- | --- | --- |
| ext4 | 65536 B | `EAGAIN` | honours the flag |
| overlayfs | `EOPNOTSUPP` | `EOPNOTSUPP` | **no fast path** |
| tmpfs | `EOPNOTSUPP` | `EOPNOTSUPP` | **no fast path** |

The archived campaign ran on overlayfs, where this decision's fast path would not have
existed. `FrameStore::open` probes once and `read_window` collapses to the whole frame when
the answer is no, so such a host pays one pooled `pread` per frame rather than one per
window. Checking the deployment filesystem is the first item in [`later.md`](later.md).

## Limitations

- **Cold means guest-cold, not device-cold, and cold cells do not resolve small
  differences.** Residency is asserted `< 0.1%` in the guest, but the hypervisor caches the
  backing file: the same cold pass takes 25 ms on one repeat and 200 ms on another. At 25
  interleaved repeats an apparent 34% CPU difference between two arms reversed when the arm
  order was reversed (Cell 6). Large, mechanism-explained cold effects survive — naive
  mmap's millisecond stalls, the `mincore` gate under pressure, an arm that parks on 100% of
  reads instead of 2%. Differences of tens of percent do not. **Order-control any new cold
  claim before believing it.**
- **The gap monitor changes the numbers it is not measuring.** It is a spin loop, so it
  keeps a core busy and its absence lets the host drop frequency: the same warm arm reads
  46.9 µs with one monitor and 84.7 µs with none. Both are internally consistent — compare
  arms *within* a cell, never across cells with different `--monitors`.
- **The gap monitor is one task.** On four workers it can be stolen off a stalled worker, so
  `gap_max` under `--runtime multi` understates a stall. Cells 3 and 4 — real sessions on
  every worker — are the sensitive neighbour instrument; `--monitors N` raises monitor count
  at the cost of pinning every core to a spin loop.
- **No live end-to-end run.** `with_bind_default` binds IPv6 and this container has no IPv6,
  so the server could not be driven over the wire here. Wire compatibility is covered by
  unit tests asserting the streamed bytes equal the `wrap()` envelope they replaced.
- Prior campaigns (`git show be78860:docs/disk-access/`) are superseded by this one — the
  instrument differences above are not reconcilable cell by cell. Do not cite them.
