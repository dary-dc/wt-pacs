# L3 / disk-access — evidence review and re-run brief

**Date:** 2026-08-31 · **Branch:** `cursor/l3-executor-stall-bc88` · **Audience:** the implementer picking this up
**Raw probe output:** [`docs/measurements/r2/REVIEW_2026-08-31_RAW.txt`](measurements/r2/REVIEW_2026-08-31_RAW.txt)
**Reviewed:** `docs/adr-frame-disk-access.md`, `docs/disk-access-{campaign,team-brief,prior-art,later}.md`,
`docs/measurements/r2/{DISK_ACCESS_CAMPAIGN,DISK_ACCESS_FOLLOWUP,DISK_ACCESS_REALISTIC,L3_EXECUTOR_STALL}.md`
+ the three TSVs, `lab/disk-access-bench`, `lab/cold-page-bench`, `server/src/media/frame_store.rs`,
`server/src/transport/server.rs`.

> **Premise for this review:** `wrap()` is being removed in the next version. After that the *only* copy
> of frame bytes is the one wtransport/quinn makes inside `write_all`. Everything below is written for
> that target state; where a finding changes because of it, that is called out explicitly.

---

## 0 · TL;DR for the implementer

1. **Do not re-open the invariant.** "A major page fault must not run on the async executor" is correct,
   is confirmed by prior art, and is confirmed again by this review's measurements. Nothing here argues
   for going back to the unguarded path.
2. **The shipped mechanism is the wrong one.** The `mincore` gate (`mmap_hybrid_mincore`) does *not* keep
   faults off the executor once the working set exceeds the page cache — the regime the ADR itself cites as
   motivation. Measured, 6/6 runs: worst-case executor block **1.5–9.5 ms (median 2.4 ms) with the gate** vs
   **0.15–0.70 ms (median 0.18 ms) with the always-blocking touch** it replaced. The gate takes its
   protective hop for only **13–18 of 320 frames** under pressure.
3. **The campaign could not have detected this.** Its stall instrument has a **~0.6–1.8 ms noise floor**, its
   `stall_samples` metric measures *await points, not faults*, its "cold" cells never left the page cache, and
   the arm it recommends never reads the frame bytes it is being timed on.
4. **Four published numbers are artifacts** and must not be carried into the ADR or onto `main`
   (F1–F6 below). Doc↔TSV transcription, by contrast, is clean — the tables faithfully match the raw data.
   The defects are in what the metrics *mean*.
5. **Removing `wrap` strengthens mmap over `pread`** on copy count (1 copy vs 2) and **weakens the `mincore`
   gate** (the check-to-read window widens from microseconds to the whole flow-controlled write).
6. Required actions, in order, are in §6. Nothing should land on `main` from this branch until §6.A–C are done.

---

## 1 · What survives the review (do not re-litigate)

| Claim | Status |
| --- | --- |
| A major fault is not an `.await`; it blocks every task on that OS thread | **Correct.** Re-measured: a product-shaped worker on the unguarded path blocks a co-tenant task for mean ~190 µs, p99 ~2.5 ms, max ~3.8 ms per cold series (§5 of the raw log) |
| `madvise(WILLNEED)` alone does not fix it (the touch still runs on the executor) | **Correct** |
| Whole-study preload rejected (DBT-scale RAM) | **Correct** |
| `O_DIRECT` + app cache rejected | **Correct** |
| `sendfile`/splice rejected — userspace QUIC still copies | **Correct**, and confirmed in the dependency source: `quinn-proto` `ByteSlice::pop_chunk` does `Bytes::from(data[..limit].to_owned())` |
| Prior-art framing (Huon Wilson, Mimir, io_uring wins at deep QD/`O_DIRECT`) | **Accurate and appropriately deflationary** |
| Published tables match the committed TSVs | **Verified**, all three waves, cell counts included (72/60/90) |
| Tier ≤ T2 / overlayfs / "rank within run" caveats | **Honestly stated** |

---

## 2 · What changes now that `wrap()` is going away

### 2.1 Copy accounting (the `bytes_copied` column becomes real)

With `wrap()` present, the server copied every frame into a `Vec` on the executor *anyway*, so the campaign's
"mmap copies 0 bytes, `pread` copies 20 MB" was not a product-level difference. **With `wrap()` removed it is:**

| Path | Copies of the frame | Where |
| --- | --- | --- |
| mmap (naive / gate / always-touch) | **1** | quinn, inside `write_all`, on the executor |
| `pread` | **2** | kernel→heap on the blocking pool, then heap→send buffer on the executor |

So the ADR's preference for mmap over `pread` **gets stronger**, not weaker, in the next version. A criticism
that would have applied to the current tree does not apply to the target state — say so in the ADR rather
than leaving the old justification, which was right for the wrong reason.

### 2.2 Where the faults land, and for how long the guarantee must hold

`wtransport::SendStream::write_all` → `quinn::SendStream::write_all` → loops `write(buf)`, each call copying
up to the current flow-control budget and **awaiting when blocked**. Consequences for this design:

- The read of the mmap slice moves from a single tight `memcpy` in `send_one_frame` into **quinn's chunked copy
  loop**, still on the executor, but now **spread across await points over the whole write**.
- The window between `frame_pages_resident(idx)` and the *last* byte being read is therefore no longer
  microseconds — it is bounded by peer flow control and can be tens of milliseconds under backpressure.
  **Any residency prediction must stay true for that entire window.** It does not have to.
- Pre-touching has the same exposure: pages touched on the pool must remain resident until quinn has drained
  them. Under the memory pressure that motivates the ADR, they may not.
- `pread` is the only arm immune to both: its bytes are in a private heap buffer that cannot be reclaimed.

This is the sharper trade the ADR should state: **`pread` buys a hard guarantee for one extra copy;
mmap + pre-touch buys a soft guarantee for free; mmap + `mincore` gate buys a much softer one.**

### 2.3 What does *not* change

The 250 KB copy still happens on the executor — it just belongs to quinn now. Per-frame executor cost in the
next version is roughly `mincore (~0.3–0.6 µs) + quinn copy (~25–40 µs)`. The gate's entire warm-path
justification is avoiding a ~10 µs pool hop (campaign host) that sits next to a 25–40 µs copy — and the hop is
**latency, not executor CPU**: while one session waits on its hop the executor serves other sessions. In a
single-session lab a hop looks like pure loss; under concurrency most of it overlaps. The experiment that
would settle this — multi-session load — is the one the campaign explicitly deferred.

---

## 3 · Instrument defects (these invalidate the stall column everywhere)

### F1 — The stall metric never rose above its own noise floor

`lab/disk-access-bench/src/main.rs:495` sleeps `heartbeat_us = 500 µs` on a `current_thread` runtime and calls
the lateness a stall. On a **completely idle** runtime with no work at all, measured on this host:

| requested sleep | median lateness | max |
| --- | ---: | ---: |
| 100 µs | 1027 µs | 2395 µs |
| **500 µs** (the campaign's setting) | **687 µs** | **1794 µs** |
| 1000 µs | 1140 µs | 1445 µs |
| 2000 µs | 1148 µs | 1534 µs |

Every "safe arm" stall number in all three waves (0.64–1.55 ms) is at or below that floor. This is not a
host artifact — it is visible in the committed TSVs: **58 of 111 warm cells report a `stall_max` larger than
the entire series wall time** (e.g. `DISK_ACCESS_REALISTIC` warm `live_cell_scroll`: wall 0.513 ms,
"stall max" 1.102 ms). A stall longer than the work cannot be a stall.

**Fix:** the heartbeat cannot resolve what this experiment is about. Replace it with a co-tenant task that
loops `tokio::task::yield_now().await` and records the gap between its own polls — nanosecond resolution, no
timer involved, and it measures exactly the quantity of interest: *how long the executor was unavailable to
another session*. (Working probe pattern is in §7.)

### F2 — `stall_samples` counts await points, not faults

Across all 225 committed cells:

- every arm that hops: `stall_samples ≈ series_wall_ms / 0.9` — one "sample" per ~1 ms of wall clock;
- every arm that does not hop: `stall_samples = 1` — in **all 81 such cells, warm and cold alike**.

Warm `mmap_naive` and warm `mmap_hybrid_mincore` both report `stall_samples = 1`, which
`docs/disk-access-team-brief.md` §2 defines as "executor froze". The metric cannot distinguish the recommended
arm from the rejected one; it is a function of whether the arm awaits, and of wall time. Delete it, or replace
it with the gap distribution from F1.

### F3 — The bench worker never awaits, so "the executor froze for the whole series" is a harness property

`lab/disk-access-bench/src/main.rs:512` runs the whole trace in one loop with no await between frames on the
mmap arms. The real `send_one_frame` awaits `write_payload` per frame — and in the next version awaits several
times *inside* it. Measured on the same cold study with the same code, changing only that:

| worker shape | naive co-tenant gaps |
| --- | --- |
| never awaits (what the bench does) | **one gap of 16.0 ms** — the entire series |
| awaits per frame (what the server does) | 81 gaps · p50 8–10 µs · p90 ~530 µs · p99 ~2.51 ms · **max 3.21 / 3.84 ms** |

The published "executor froze for ~55 ms" is the first row. The product exposure is the second — about
two orders of magnitude smaller, still bad, still worth fixing, but not the number in the docs.

### F4 — `cold-page-bench`'s "cold" latency is 84 % warm re-reads

`lab/cold-page-bench/src/main.rs:72,88,143` iterate `idx = i % n`, so `--iterations 500` over an 80-frame study
walks each frame 6.25 times; only the first pass is cold. Reproduced:

| run | naive `cold_p50` |
| --- | ---: |
| `--iterations 500` (as published) | **600 ns** (the published report says 349 ns) |
| `--iterations 80` (one honest pass) | **16.3 µs** (22.1 µs on a repeat) |
| E3 floor quoted in the lane brief | 28 µs |

`docs/measurements/r2/L3_EXECUTOR_STALL.md` prints a 349 ns "cold p50" directly beneath a floor table saying
28 µs. A sub-microsecond cold read is not physically possible; the table should have been caught here.

---

## 4 · Arm-design defects (these invalidate the warm ranking)

### F5 — The arms do not do the same work

`mmap_naive` touches every page of the frame (`:594`); `mmap_blocking_touch`, `mmap_hybrid_mincore` and
`mmap_dedicated_pool` end with `std::hint::black_box(slice.len())` (`:613`, `:635`, `:652`) — **they never read
the frame bytes at all**. `pread_blocking` reads all of them. So the published warm ranking compares
"syscall only" against "touch every page" against "copy every byte".

That is why the tables show the gate *beating* the unguarded path (0.40 µs vs 0.95 µs). It cannot: the gate is
the unguarded path plus a syscall. With every arm made to consume the bytes the way the product does:

| warm, 320 × 250 KB, next-version model (two runs) | per-frame p50 |
| --- | ---: |
| naive (no gate) | 29.1 / 37.2 µs |
| hybrid `mincore` | 31.1 / 42.6 µs |
| always blocking touch | 58.1 / 68.3 µs |
| `pread` | 105.1 / 114.2 µs |

naive and the gate are a tie, as they must be. The real spread between the gate and the always-touch arm is
~30 µs of *latency* per frame on this host (~10 µs on the campaign host), not the 26× the tables imply.

### F6 — "Ranking is what matters" needs more than one run per cell

Every cell is a single run. The same arm/config moves 0.40 → 0.64 µs between waves while the claimed win over
naive is 0.24–0.55 µs. Re-running the exact follow-up cell on a different container gave `hop_p50` 40–52 µs
where the docs report 10 µs. Any conclusion resting on sub-µs deltas needs ≥5 repeats and a reported spread.

---

## 5 · The decisive finding: the gate fails in the regime it was designed for

### 5.1 `mincore` answers a weaker question than the design assumes

`mincore` reports **page-cache residency** (verified on this kernel both as root and as an unprivileged uid
with no write permission on the file), not "a read of these bytes will not block". A page it calls resident can
still cost a minor fault, and can still be under in-flight readahead.

The practical consequence is that **the gate almost never fires**. On a genuinely cold study
(`posix_fadvise(DONTNEED)`, pre-scan: **4 of 80 frames resident**), during a forward pass **71–72 of 80 frames
are reported resident before they are touched** — readahead fills the cache ahead of the checks. In random ask
order it is 78/80. Under memory pressure (§5.2) it is 302–307 of 320.

Reading a frame the gate passed, on the executor, in the same cold study:

| | p50 | p99 | max |
| --- | ---: | ---: | ---: |
| gate said resident (no hop taken) | 39.7 / 41.2 µs | 82 / 130 µs | 228 / 238 µs |
| gate said cold (hop taken) | 0.81 / 0.84 ms | — | 3.21 / 3.22 ms |
| truly warm control | 35.5 / 35.5 µs | 93 / 109 µs | 238 / 252 µs |

Read this narrowly: with the whole study comfortably inside the page cache, the frames the gate lets through
cost only a few µs more than truly warm ones — which is exactly why the campaign saw nothing wrong. The gate
does catch the expensive frames *in this regime*. What it cannot do is stay right when the cache cannot hold
the study, which is §5.2.

### 5.2 Under the ADR's own premise, the gate is an order of magnitude worse than what it replaced

No campaign cell ever put the working set above the page cache: the fixtures are 20 MB and 80 MB on a 16 GB
host, so "cold" meant one bulk readahead followed by warm re-reads. The ADR's motivation — DBT ~570 MB against
under 1 GB of cache — was never reproduced. Doing so (cgroup `memory.limit_in_bytes = 48M`, 80 MB study, page
cache dropped first, next-version write model), **6 runs**:

| arm | hops taken | worst executor block seen by a co-tenant session, 6 runs | median |
| --- | ---: | ---: | ---: |
| naive (no gate) | 0 / 320 | 7359 · 7126 · 8058 · 5819 · 5580 · 7133 µs | **7.1 ms** |
| **hybrid `mincore` (shipped)** | **13–18 / 320** | 2871 · 1841 · **9523** · 3496 · 1859 · 1546 µs | **2.4 ms** |
| always blocking touch | 320 / 320 | 191 · 176 · 697 · 165 · 232 · 151 µs | **0.18 ms** |
| `pread` on the pool | 320 / 320 | 118 · 140 · 222 · 192 · 102 · 251 µs | **0.17 ms** |

Every one of those 24 cells is in the raw log under §6b.

Without pressure the same cells show the gate and the always-touch arm looking alike (max ~0.15–0.3 ms) — which
is all the campaign ever measured, and exactly why it concluded "same safety class". Under pressure the gate
recovers only about two thirds of the distance from naive to safe, its worst case is millisecond-scale in 6/6
runs, and its median worst block is **13× the always-touch arm's**.
Removing `wrap` makes this worse, not better (§2.2): the prediction now has to hold for the whole flow-controlled
write instead of for one immediate `memcpy`.

Caveat: this uses the *model* of the write path in §7, not the real wtransport/quinn stack. It reproduces the
chunk-copy-and-await shape and nothing else — no crypto, no congestion control, no socket. The ranking should be
confirmed against the real server before the ADR is rewritten; the mechanism (a residency prediction that has to
survive a flow-controlled write while the kernel is reclaiming) does not depend on the model.

**Conclusion:** as measured, `mmap_blocking_touch` (the L3 v1 the ADR calls "superseded") is the safe arm, and
the hybrid trades a real safety property for ~10–30 µs of per-frame latency that mostly overlaps under
concurrency. That trade should be re-made explicitly, on data, not carried over.

---

## 6 · Required actions

### A. Fix the instrument (blocks everything else)

- [x] A1 — Replace the sleep-based heartbeat in `lab/disk-access-bench` with a co-tenant `yield_now()` gap
      monitor (pattern in §7). Report gap p50/p99/max, not "stall mean/max/samples".
- [x] A2 — Delete `stall_samples`, or redefine it as the gap-sample count and stop drawing safety conclusions
      from it. *(Replaced by `gap_*` columns.)*
- [x] A3 — Make the bench worker await once per frame at minimum; better, model the write (A5).
- [x] A4 — Fix `cold-page-bench`: one pass per cold copy, or re-cool between passes. Never report a p50 over a
      trace that revisits frames as "cold".
- [x] A5 — Add the next-version write step to every arm: copy the source into a send buffer in
      flow-control-sized chunks with an await between chunks. Run at least two chunk sizes (e.g. 256 KiB
      = no backpressure, 16 KiB = backpressured). *(Harness: `--chunk`, repeatable.)*

### B. Fix arm parity

- [x] B1 — Every arm must end by consuming the bytes through the same write step (A5). No `black_box(len())`
      arms.
- [x] B2 — `pread` must read into the buffer that is then handed to the write step — one pool copy plus quinn's,
      not an extra one for measurement's sake.
- [x] B3 — ≥5 repeats per cell; report median and spread. Drop any conclusion whose margin is inside the spread.
      *(Harness default `--repeats 5`.)*

### C. Add the regime the decision depends on

- [x] C1 — A memory-limited cell: cgroup helper `lab/scripts/run_disk_access_mempressure.sh` + streamed cold
      copy. **Re-run recorded:** `docs/measurements/r2/disk_access_mempressure.tsv` + `DISK_ACCESS_RERUN.md`.
- [x] C2 — Multi-session cell: `--sessions N` measures other sessions' ask latency during primary work.
      **Re-run recorded:** `docs/measurements/r2/disk_access_multisession.tsv` + `DISK_ACCESS_RERUN.md`.
- [ ] C3 — Optional but cheap: a real-disk (non-overlayfs) confirm, as already planned.

### D. Re-decide the gate on the new numbers

- [x] D1 — Default: **revert `send_one_frame` to unconditional `spawn_blocking` touch** (L3 v1); keep
      `frame_pages_resident` as a lab helper. Gate returns only if C1/C2 clear it.
- [ ] D2 — If the gate is kept, it must be gate **plus** verification, not gate alone — e.g. re-check residency
      after the hop and before handing the slice to `write_all`, and/or hop unconditionally for the first N
      frames of a study. Document the failure mode either way.
- [ ] D3 — Re-evaluate `pread` fairly under the new copy accounting (§2.1): 2 copies vs 1, but immune to
      reclaim and to the widened window. It should be a first-class candidate in the re-run, not an escape
      hatch in a footnote. Its per-frame 250 KB allocation is a real cost but a pooled buffer removes it —
      measure it that way rather than with a fresh `Vec` per ask.

### E. Code fixes worth making regardless

- [x] E1 — `PAGE_SIZE` via `sysconf(_SC_PAGESIZE)` + test.
- [x] E2 — Bad frame index propagates as `Err` from `frame_pages_resident` (via `frame_slice`); `mincore`
      failure alone maps to `Ok(false)`. Strict helper available.
- [x] E3 — Document the reclaim race in the ADR.
- [x] E4 — Cold-copy names use wall time + seq; `ColdCopy` Drop cleans; stream copy (no full-file heap read).
- [ ] E5 — Per the merge plan, drop the `frame_prefix_*` / `pread_frame_prefix` APIs from the product path
      unless progressive serve is actually scheduled; they are lab surface on a product type.

### F. Documentation corrections (do these even if the re-run is deferred)

| File | Change |
| --- | --- |
| `docs/adr-frame-disk-access.md` | **Done** — under review; stall numbers / hybrid-beats-naive removed; always-touch provisional; reclaim race; post-`wrap` copy accounting. |
| `docs/measurements/r2/L3_EXECUTOR_STALL.md` | **Done** — cold p50 retracted (F4); banner. |
| `docs/measurements/r2/DISK_ACCESS_{CAMPAIGN,FOLLOWUP,REALISTIC}.md` | **Done** — banners; TSVs kept. |
| `docs/disk-access-team-brief.md` §2 | **Done** — stall n reading removed. |
| `docs/l3-merge-plan.md` | **Done** — do not prune until re-derived. |
| `docs/lanes/L3-executor-stall.md` | **Done** — always-touch; evidence under review. |

---

## 7 · How to re-run (working patterns)

Fixtures (gitignored, regenerate):

```bash
bash lab/scripts/gen_tf_fixtures.sh          # frames_32k, frames_250k
bash lab/scripts/gen_live_cell_fixture.sh    # frames_250k_live (320 × 250 KB)
```

**Co-tenant gap monitor (replaces the heartbeat).** Nanosecond resolution, no timer:

```rust
let mon = tokio::spawn(async move {
    let mut gaps = Vec::new();
    while !stop.load(Ordering::Relaxed) {
        let t = Instant::now();
        tokio::task::yield_now().await;   // gap = how long the executor was unavailable
        gaps.push(t.elapsed().as_nanos() as u64);
    }
    *out.lock().unwrap() = gaps;
});
```

**Next-version write step (add to every arm).** Models `quinn::SendStream::write_all`, which loops
`write(buf)` copying up to the flow-control budget and awaiting when blocked:

```rust
async fn write_sim(src: &[u8], chunk: usize, sink: &mut Vec<u8>) {
    for c in src.chunks(chunk) {
        sink.clear();
        sink.extend_from_slice(c);        // == Bytes::from(c.to_owned()) in quinn-proto
        std::hint::black_box(sink.len());
        tokio::task::yield_now().await;   // == write_all's poll boundary
    }
}
```

**Memory-pressure cell (cgroup v1 on this host; use `memory.max` on v2):**

```bash
mkdir -p /sys/fs/cgroup/memory/l3
echo 48M > /sys/fs/cgroup/memory/l3/memory.limit_in_bytes
# drop the study's page cache first so its pages are charged to the limited cgroup,
# then run the bench inside it:
bash -c 'echo $$ > /sys/fs/cgroup/memory/l3/cgroup.procs; exec <bench> --study lab/fixtures/frames_250k_live/frames_250k_live.sbnd ...'
```

Without dropping the cache first the pages stay charged to the parent cgroup and the limit does nothing —
the first attempt at this during the review produced a false "no pressure effect" for exactly that reason.

### Acceptance criteria for the re-run

1. Warm cells report a co-tenant gap **max within a small multiple of one chunk copy** (tens of µs, always
   sub-millisecond) for every arm — a millisecond gap in a warm cell means the instrument or the fixture is
   still wrong, not that the arm is unsafe.
2. `naive` and any gate arm agree on warm per-frame cost within noise — if the gate looks *faster*, arm parity
   (B1) is still broken.
3. The cold cell's first pass shows per-frame latency in the tens of µs or more — if it shows sub-µs, the
   cold copy is not cold (F4).
4. The memory-limited cell shows a clear separation between arms; report the worst gap per arm, not a mean.
5. Every reported delta has ≥5 repeats behind it and a stated spread.

---

## 8 · Method and limits of this review

Measurements were taken in a cloud agent container (4 vCPU, 16 GB RAM, kernel 6.18, overlayfs, uid 0) — **not**
the campaign's host. Absolute microseconds are not comparable to the published tables; hop costs here are
4–5× the campaign's. That does not affect the findings, because each is either

- a property of the code (F5 arm asymmetry, F3 missing awaits, F4 `i % n`), or
- re-derived from the campaign's own committed TSVs (F1's floor, F2's counting relationship), or
- a within-run comparison repeated 3–6 times on one host (§5).

The `pread` numbers here are the weakest: on this host `spawn_blocking` costs 80–130 µs where the campaign
measured ~10 µs, which inflates every hop-taking arm. Rank, don't quote.

Raw output: [`docs/measurements/r2/REVIEW_2026-08-31_RAW.txt`](measurements/r2/REVIEW_2026-08-31_RAW.txt).
