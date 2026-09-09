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
| 7 | **Park on the ring fd, drop the eventfd** | 1 fd per session instead of 2, ~30 lines fewer, measured tie. Only after P0 keeps the ring. |
| 8 | **`io-uring` 0.7.14 → 0.7.15** | Drop-in. After P0. |
| 9 | **Bounded frame cache** | −20.2 % CPU at a 0.92 hit rate, lab only. Needs a real ask trace to size. |

`tokio::fs` as a sequential reader is **rejected** (15× slower; tokio’s io_uring driver
serialises). Fill uses the shipped reader, one frame ahead. Not reopened.

Frames past 250 kB (native DBT is ~3 MB) and storage faster than ~1.25 GB/s are **not
established**. Named so they are not quoted as measured.
