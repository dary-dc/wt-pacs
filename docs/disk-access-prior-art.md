# Disk access — abstract problem + prior art (investigation)

**2026-08-30** · after local Wave A/B. Goal: stop reinventing settled OS/runtime facts; keep local work for *our* constraints only.

---

## 1 · Abstract problem (iteration 1 → 2)

### Iteration 1 (too vague)

> “Is mmap better than reading from disk?”

Unanswerable. Better at what, when pages are hot or cold, on which scheduler?

### Iteration 2 (what we actually have)

**Setting:** A cooperative async runtime (Tokio) serves immutable frame blobs from a large file. Working set can exceed RAM (DBT-scale). One cold I/O must not freeze unrelated sessions on the same OS thread.

**Decide:**

1. **Scheduler safety** — major page faults / blocking reads must not run on the executor thread without an `await` boundary the runtime understands.  
2. **Hot path cost** — when bytes are already in page cache, prefer the cheapest way to hand them to `write_all` (copy vs no-copy, hop vs no hop).  
3. **Cold path cost** — time and CPU to bring bytes in; optional prefetch if we know the next ask.  
4. **Complexity** — Linux-only APIs, `unsafe`, new deps, failure modes.

**Non-goals for v1:** beating NVMe with `O_DIRECT` queue depth; reinventing a buffer pool; whole-study preload.

---

## 2 · What prior art already settled

| Claim | Who / where | Implication for us |
| --- | --- | --- |
| **mmap indexing has no `await`; a major fault blocks the whole async thread** | Huon Wilson, *Async hazard: mmap is secretly blocking IO* (2024) | Our L3 finding is the same hazard, not new science |
| **Warm mmap can be extremely fast; cold mmap destroys cooperative concurrency** | Same | Measure cold *and* warm; never judge mmap on warm alone |
| **Go: cold mmap can pin OS threads; runtime doesn’t treat faults like syscalls** | Valialkin / VictoriaMetrics; Grafana Mimir thread-pool for index mmap | Same shape as Tokio `current_thread` / shared worker stall |
| **Useful question is “is the page resident?”, not “mmap vs pread forever”** | Internals for Interns — mmap vs pread in a Go storage engine | Hybrid: mmap if hot, explicit I/O if cold (`mincore` / touch-off-thread / pread) |
| **`madvise(WILLNEED)` often still blocks the caller until pages are in** | StackOverflow / kernel behaviour notes | Matches our Wave B: willneed alone didn’t remove executor freeze |
| **Moving mmap faults onto a dedicated OS thread pool is a known mitigation** | Grafana Mimir PR (indexheader thread pool) | Same idea as our `spawn_blocking` pre-touch |
| **io_uring wins when you need deep async queues to disk (`O_DIRECT`); on warm page cache it can lose to plain reads/mmap** | io-uring benches / HN / DBMS papers | Wave C only if we leave the page-cache model |

Primary references:

- https://huonw.github.io/blog/2024/08/async-hazard-mmap/  
- https://internals-for-interns.com/posts/mmap-vs-pread-go-storage-engine/  
- https://gist.github.com/valyala/43d50cb058411e54a9d08111e2fde2ad  
- https://github.com/grafana/mimir/pull/1660  
- https://wanglong.cv/articles/mmap-vs-read-performance/

---

## 3 · Options others use (menu, not homework)

| Option | Idea | Cost |
| --- | --- | --- |
| **A. mmap + blocking prefault** | Touch/copy on a blocking pool; executor only sees hot bytes | Small hop always |
| **B. pread on blocking pool** | Explicit read; runtime knows it’s blocking work | Full-frame copy |
| **C. Hybrid: `mincore` then mmap or pread** | mmap only when resident | Extra syscall; platform quirks (ZFS stories) |
| **D. Dedicated fault thread pool** | Cap how many threads may block on mmap | Mimir-style; more moving parts |
| **E. io_uring** | True async disk queue | Complexity; biggest win off page-cache / deep QD |
| **F. madvise / fadvise only** | Hint without off-thread work | **Insufficient alone** for async safety |

Our local campaign already compared A, B, and F-like arms. We did **not** need to invent A vs B; we needed to confirm which fits *this* server loop.

---

## 4 · What is left that is *ours* (not rediscovery)

Stop exploring “is mmap secretly blocking?” — answered.

Still product-local:

1. Keep **A (mmap + `spawn_blocking` touch)** as default — matches prior art + our numbers.  
2. Optional later: **C (`mincore`)** to skip the hop when pages are already hot (warm path tax).  
3. Re-check A vs B once on a **real study disk** if hop or copy shows up in end-to-end serve p95.  
4. **E (io_uring)** only if we deliberately leave page-cache buffering or need deep parallel disk QD — not the next step.  
5. Prefetch of *next ask* only if the control path gains a real queue (serial FoD loop today has almost no lookahead).

---

## 5 · Verdict

Agree with the meta-point: **more arms without prior art would have been wasteful.**  
The investigation says the industry already named the hazard and the main mitigations; our benches **calibrated** which mitigation to ship, they did not discover a new class of solution.
