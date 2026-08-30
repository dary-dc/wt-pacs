# Disk-access campaign — metrics and arms

**2026-08-30** · lab only · branch work under `lab/disk-access-bench/`  
Companion to L3 (`docs/lanes/L3-executor-stall.md`) and E3 notes in
`docs/window-saturation-experiment.md` §3.

**Status:** harness + Wave A/B runnable. Absolute µs are host-specific (this cloud box is
overlayfs); compare **arms within a run**. Re-check close calls on a real study disk later.

---

## 1 · Question

How should the server get frame bytes off disk so that:

1. cold I/O does not freeze the async executor, and  
2. steady-state cost (time, CPU, RAM, copies) stays acceptable?

mmap vs `pread` is one comparison inside that question — not the only arm.

---

## 2 · Metrics (every arm, every cell)

| Metric | Meaning |
| --- | --- |
| `first_frame_ns` | Latency of frame 0 (or first ask) on a cold mapping/file |
| `later_p50_ns` / `later_p99_ns` | Per-frame latency after the first, same run |
| `series_wall_ns` | Wall time for the whole ask trace |
| `stall_mean_ns` / `stall_max_ns` | Heartbeat late-wake on a `current_thread` tokio runtime while the worker serves the trace |
| `bytes_copied` | Explicit userspace heap copies of frame payload (0 if touch-only mmap) |
| `cpu_user_us` / `cpu_sys_us` | `getrusage` delta for the process over the series |
| `rss_delta_bytes` | RSS after − RSS before the series |
| `hop_p50_ns` | Blocking-pool round trip when the arm uses one (else empty) |

**Traces (ask order):**

| Trace | Pattern |
| --- | --- |
| `forward` | `0 .. n-1` — kernel readahead’s best case |
| `reverse` | `n-1 .. 0` — where sequential readahead / WILLNEED honesty shows |
| `random` | fixed-seed shuffle — no spatial locality |

**Temperature:**

| Temp | How |
| --- | --- |
| `cold` | rewrite study copy + `posix_fadvise(DONTNEED)` before open |
| `warm` | touch/read every frame once before timed series |

---

## 3 · Arms

### Wave A — core (must ship numbers)

| Arm | What it does |
| --- | --- |
| `mmap_naive` | `frame_slice` + page-touch on the executor |
| `mmap_blocking_touch` | `spawn_blocking(touch_frame_pages)` then slice on executor (L3) |
| `pread_blocking` | `spawn_blocking(pread into Vec)` — normal disk read, never faults the executor |

### Wave B — complementary

| Arm | What it does |
| --- | --- |
| `mmap_willneed` | `madvise(WILLNEED)` on the **current** frame range, then touch on executor (honest: no lookahead) |
| `mmap_willneed_next` | WILLNEED on current **and next** index in the trace, then touch current on executor |
| `mmap_blocking_ahead_2` | blocking pre-touch of current + next frame, then slice current |

### Wave C — later / only if A–B leave a gap

| Arm | Note |
| --- | --- |
| `io_uring` | Real complexity; skip until `pread_blocking` looks good but hop/copy still hurts |
| Layout variants | Page-aligned / padded fixtures — separate fixture arms, not product guesses |
| Whole-study preload | Rejected for scaling; do not revive |

---

## 4 · Complexity scorecard (checklist, not µs)

Record per arm in the summary (Y/N / note):

- new crate / unsafe / Linux-only API  
- fails closed if advice is ignored  
- copies full frame to heap  
- needs ask lookahead / queue  

---

## 5 · Fixtures

| Study | Why |
| --- | --- |
| `lab/fixtures/frames_32k/*.sbnd` | smaller Tf, more frames in cache |
| `lab/fixtures/frames_250k/*.sbnd` | E3 / L3 size (~250 KB × 80) |

Generate with `lab/scripts/gen_tf_fixtures.sh` if missing.  
Live-cell large series: `lab/scripts/gen_live_cell_fixture.sh` → `frames_250k_live` (320 × 250 KB).

---

## 5b · Realistic final wave (access patterns)

Before merge reshape: confirm the decision under **large series**, **user-like ask order**, and **partial byte access**.

| Axis | How |
| --- | --- |
| Large series | `frames_250k_live` (320 frames) · synthetic forward / reverse |
| User trace | `--trace-file lab/traces/live_cell_scroll.json` (500 asks, reversal) |
| Access | `--access full` · `prefix_4k` · `prefix_64k` (partial HTJ2K / first-bytes proxy) |
| Arms | `--realistic` → decision subset + those access modes |

```bash
# regenerate fixture if missing
lab/scripts/gen_live_cell_fixture.sh

cargo run -p disk-access-bench --release -- \
  --study lab/fixtures/frames_250k_live/frames_250k_live.sbnd \
  --realistic \
  --trace forward --trace reverse \
  --out docs/measurements/r2/disk_access_realistic.tsv

cargo run -p disk-access-bench --release -- \
  --study lab/fixtures/frames_250k_live/frames_250k_live.sbnd \
  --realistic \
  --trace-file lab/traces/live_cell_scroll.json \
  --out docs/measurements/r2/disk_access_realistic_trace.tsv
```

Results: `docs/measurements/r2/DISK_ACCESS_REALISTIC.md`.

---

## 6 · Output

- TSV: `docs/measurements/r2/disk_access_campaign.tsv`  
- Short raw summary: `docs/measurements/r2/DISK_ACCESS_CAMPAIGN.md`  
- Realistic wave: `docs/measurements/r2/disk_access_realistic.tsv` · `DISK_ACCESS_REALISTIC.md`

No interpretation beyond “what the columns mean” and within-run deltas. Evidence ≤ T2 on this host.
