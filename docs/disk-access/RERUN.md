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

- **Cold means guest-cold, not device-cold.** Residency is asserted `< 0.1%` in the guest,
  but the hypervisor caches the backing file: the same cold pass takes 25 ms on one repeat
  and 200 ms on another. Arm *rankings* held in every cell; absolute cold latency is not
  this host's to give.
- **The gap monitor is one task.** On four workers it can be stolen off a stalled worker, so
  `gap_max` under `--runtime multi` understates a stall. Cells 3 and 4 — real sessions on
  every worker — are the sensitive neighbour instrument; `--monitors N` raises monitor count
  at the cost of pinning every core to a spin loop.
- **No live end-to-end run.** `with_bind_default` binds IPv6 and this container has no IPv6,
  so the server could not be driven over the wire here. Wire compatibility is covered by
  unit tests asserting the streamed bytes equal the `wrap()` envelope they replaced.
- Prior campaigns (`git show be78860:docs/disk-access/`) are superseded by this one — the
  instrument differences above are not reconcilable cell by cell. Do not cite them.
