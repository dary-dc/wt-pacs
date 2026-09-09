# Read path — what is still open

Order set with the owners: **latency first; simplicity; thousands of sessions at depth 4 or
more; studies far larger than RAM; cloud, possibly Docker.**

Nothing here blocks the code that ships. Items already built (W = 4, miss reporting, fill,
named/in_flight on the session line) are not listed.

| # | Item | Why it is still open |
| --- | --- | --- |
| 1 | **P0 — ring vs pool on the production target** | Sandbox and workstation miss costs differ. A tie on the 28.5 % / 0.8n rule deletes the ring and ships the pool; a resolved margin keeps it. Run `product` against `pool`, cold, both frame sizes, depths 2 / 4 / 8 / 16, `check-fastpath` on the study volume, `ulimit -l` recorded. [`adr.md`](adr.md) §6 |
| 2 | **`server_ab.sh` on the workstation** | Sandbox cold depth 4 won on direction (−19 % p50, −28 % CPU/ask) but missed the 28.5 % wait bar. Magnitudes are not evidence until this host. Named is now on the session line (`named=4` at depth 4). |
| 3 | **Throttled link** (20 Mbps, 50 ms, 1 % loss, cold tiles, client depth 4) | Predicted tie: the wire hides the 0.2 ms W = 2 → 4 saving. Unmeasured. |
| 4 | **`max_udp_payload_size` 1472 → 4000 B** | −35 % CPU, +55 % throughput — the largest lever measured anywhere. Blocked on what browsers advertise. [`adr.md`](adr.md) §8 |
| 5 | **Deploy limits in the manifest** | `LimitMEMLOCK` / `LimitNOFILE` or `CAP_IPC_LOCK`, and `check-fastpath` on the study volume. Snippets are in [`DEPLOYMENT.md`](DEPLOYMENT.md); they are not in a unit file yet. |
| 6 | **`read_ahead_kb` and study layout on the target** | Miss rate moved 2–15× by that knob. Tuning, not a code change. |
| 7 | **Park on the ring fd, drop the eventfd** | 1 fd per session instead of 2, ~30 lines fewer, measured tie. Now also the *only* way to cut the eventfd's per-hit cost: `REGISTER_EVENTFD_ASYNC` never signals on a `COOP_TASKRUN` ring, so the parked reader hangs. [`EVIDENCE.md`](EVIDENCE.md) §Short io_uring completions. Only after P0 keeps the ring. |
| 8 | **`io-uring` 0.7.14 → 0.7.15** | Drop-in. After P0. |
| 9 | **Bounded frame cache** | −20.2 % CPU at a 0.92 hit rate, lab only. Needs a real ask trace to size. |
| 10 | **A frame wider than `READ_WINDOW` with an empty `upcoming`** | 250 kB is four serial `ctx.read()` calls where `pool` issues one; +32 to +88 % RESOLVED, and naming one frame ahead turns it into −33 % over `pool`. The *rest of the current frame* is known with certainty — no speculation is needed to overlap it. The unpipelined `RequestFrame` is the case that pays. [`EVIDENCE.md`](EVIDENCE.md) §Where the 250 kB penalty lives |
| 11 | **`WINDOWS > 4`** | `read()` takes `upcoming.take(WINDOWS - 1)`, so one session tops out at **4 reads in flight** — `peak_in_flight` reads 4 at `--depths 16`. The owners' weighting is "thousands of sessions at depth 4 or more"; depth above 4 on one session is currently unreachable and untested. |
| 12 | **A ring per session that misses once** | `rings_built` is **1.00 per session** at 1, 16 and 64 readers, including a 16 KiB fill that misses 1.6 % of its reads — 2 fds and ~8.7 KiB held for the session's life to serve about one read in sixty, a ~941-session ceiling on an 8 MiB `memlock`. Whether a fill should build one at all is open. |
| 13 | **Short io_uring completions on a regular file** | The lab's `drain` used to credit them whole; it now resubmits the tail and `short_reads()` counts them. Incidence in the published cells is unmeasured, and it is size-dependent by construction. |

`tokio::fs` as a sequential reader is **rejected** (15× slower; tokio’s io_uring driver
serialises). Fill uses the shipped reader, one frame ahead. Not reopened.

Frames past 250 kB (native DBT is ~3 MB) and storage faster than ~1.25 GB/s are **not
established**. Named so they are not quoted as measured.
