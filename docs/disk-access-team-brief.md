# Disk access for frame serve — team brief

> ⚠️ **Evidence under review — see [`docs/l3-disk-access-evidence-review.md`](l3-disk-access-evidence-review.md). In particular the `stall n = 1` reading in §2 is not valid: that value is produced by any arm without an await, warm cells included.**

**2026-08-30** · wt-pacs · working notes on branch `cursor/l3-executor-stall-bc88`  
**Audience:** anyone deciding how the server should read SBND frame bytes  
**Status:** L3 mitigation implemented and measured; **broader options still open** — evaluate the interesting follow-ups, then write an ADR.

---

## 1 · The problem in one paragraph

The server maps the study file with **mmap** and treats frames like byte slices. If a page is not already in RAM, the first access causes a **page fault**: the kernel loads that page from disk and the **OS thread waits**. In Tokio that wait is **not** an `.await`, so the whole async executor thread freezes — other sessions/frames on that thread stall too. That is unsafe for a multi-session server when studies are larger than RAM (e.g. DBT).

---

## 2 · What the metric names mean

From `docs/measurements/r2/DISK_ACCESS_CAMPAIGN.md` (lab harness, not end-to-end WebTransport):

| Name in the tables | Plain meaning |
| --- | --- |
| **later p50** | Median time to prepare **one frame after the first** in the same run. “Typical” per-frame cost once the series has started. Lower is better. |
| **series wall** | Clock time to finish **all frames** in the ask order (e.g. 80 frames). End-to-end for that lab trace. Lower is better. |
| **bytes copied** | How many frame payload bytes we **explicitly copied into a userspace buffer** for that series. `0` = we only touched mmap pages (no `pread`-style copy). `pread` copies every frame (e.g. 80 × 250 KB = **20 MB**). |

Related (same docs):

| Name | Plain meaning |
| --- | --- |
| **first** | Time for the **first** frame (often colder / includes startup). |
| **gap p50 / p99 / max** (new instrument) | How long a co-tenant `yield_now` task waited between polls — executor unavailable to another session. |
| **hop p50** | Median cost of the **thread-pool round trip** (`spawn_blocking`) when the arm uses one. |

**Deprecated (do not use for safety conclusions):** old **stall max / stall n** from the sleep-heartbeat
instrument. `stall n = 1` is produced by *any* arm that never awaits — including warm cells — and is
**not** “executor froze” (evidence review F1–F2).

**Caveat:** numbers are from a cloud container (overlayfs). Use them to **rank** approaches, not as Oracle-rig absolute µs.

---

## 3 · Approaches we already compared (simple)

| Approach | What it does | Executor safe when cold? |
| --- | --- | --- |
| **mmap naive** (old habit) | Touch/read mapped pages on the async thread | **No** — page fault freezes the runtime |
| **mmap + blocking touch (L3)** | Prefault pages on a **background pool thread**, then use mmap on the executor | **Yes** |
| **pread + blocking** | Background thread **reads into a buffer** (`pread`) | **Yes** |
| **mmap + WILLNEED** | Ask kernel to prefetch, still touch on executor | **No** (in our cells) — advice ≠ off-thread fault |
| **mmap + WILLNEED next / ahead-2** | Prefetch or prefault an extra frame | Ahead-2 is safe; willneed* alone was not |

**“Blocking” in “blocking touch”** means “may block a *pool* OS thread on disk,” **not** “blocks the async event loop.” The whole point is to keep the event loop free.

---

## 4 · Snapshot of results worth sharing

**Warm path · `frames_250k` forward** (follow-up campaign):

| Approach | later p50 | hop p50 | bytes copied |
| --- | ---: | ---: | ---: |
| **mmap hybrid (`mincore`)** | **~0.40 µs** | **0** | 0 |
| mmap always blocking touch | ~10.6 µs | ~10 µs | 0 |
| pread + blocking | ~35 µs | ~35 µs | **20 MB** |

**Cold path:** hybrid and always-hop keep the runtime alive (`stall n` ≈ 15); naive mmap does **not**. Hybrid’s warm path matches “almost naive speed” without that freeze.

**Realistic final wave** (320-frame study · `live_cell_scroll` · full + prefix_4k/64k): same ranking — warm hybrid hop 0 / sub‑µs; cold naive freezes (~55 ms stall max); partial access does not make `pread` the winner. Tables: `DISK_ACCESS_REALISTIC.md`.

Tables: `DISK_ACCESS_CAMPAIGN.md`, `DISK_ACCESS_FOLLOWUP.md` · Prior art: `disk-access-prior-art.md`

---

## 5 · What “hybrid” means

| Sense | Meaning |
| --- | --- |
| **A.** mmap vs `pread` | Choose API — we evaluated; **mmap wins as default** |
| **B. (shipped)** | Always mmap; **`mincore` → skip pool hop when already in RAM**; cold → pool prefault |

**In cache = in RAM** (page cache).

---

## 6 · Plan / decision

**ADR:** [`docs/adr-frame-disk-access.md`](adr-frame-disk-access.md)

**Accepted:** mmap + `mincore` + blocking pre-touch **only when cold** (hybrid).  
Follow-ups that remain optional: `docs/disk-access-later.md`.

---

## 7 · One-line takeaway for the team

> Cold mmap on the async thread is unsafe; **prefault on a pool thread when cold, skip the hop when pages are already in RAM**. Prefer that over `pread` as the default. Details and rejected options are in the ADR.
