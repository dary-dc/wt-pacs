# Disk access — later

ADR: [`adr.md`](adr.md) · Evidence: [`RERUN.md`](RERUN.md) · [`SEND-BUDGET.md`](SEND-BUDGET.md) ·
[`PREFIX-READS.md`](PREFIX-READS.md).

| Idea | Note |
| --- | --- |
| `RWF_NOWAIT` on the real deployment filesystem | `read_at_nowait` reports an unsupporting filesystem as a miss, so an overlayfs/NFS host silently degrades to pooled `pread`. Confirm support where the product actually runs — the arm is only a win where the kernel honours the flag |
| Ask-queue ahead-N prefetch | When a real client window exists. A pool read for frame *n+1* while *n* is on the wire would cut the cold miss further; needs the ask window first |
| `io_uring` under a thread-per-core runtime | Measured and tied as things stand (RERUN §Cell 6). Pinning sessions to cores would unlock `SINGLE_ISSUER` + `DEFER_TASKRUN` and drop the eventfd — but that is a server-wide architecture decision, not a disk-access one |
| `io_uring` pipelining for a miss-dominated deployment | Reading window n+1 during window n's write is worth ~6% when every read misses and ~-25% when they hit. Worth revisiting only where the working set genuinely exceeds RAM |
| Larger-than-RAM study on a real study volume | This host's cold cells are guest-cold but hypervisor-warm (see RERUN §Limitations). Ranking held across every cell, but absolute cold latency is not this host's to give |
| **Rung-major SBND layout** | The one measured lever for prefix delivery: same bytes, 319 → 3 misses per 320 asks, 27× lower cold per-ask latency ([`PREFIX-READS.md`](PREFIX-READS.md)). Needs HTJ2K rung-boundary parsing in `pack-study` and a per-rung SBND index; trades "one contiguous read per frame" for "one contiguous read per rung across the stack" |
| Frame cache against a real ask trace | `--frame-cache-mb` is measured on two synthetic shapes: a cine loop (−20% CPU) and a linear sweep (+4%). Driving `lab/traces/*.json` through `wire_send_bench` would turn "size it to the working set" into a number, and would say whether admission on the *second* ask is the right threshold |
| ~~Per-datagram cost~~ | **Closed: not available.** 4 KB datagrams cut server CPU 35%, but the ceiling is what the *peer* advertises and the peer is a browser. Revisit only if a native client appears |
| Frame cache under single-send clients | The client caches every increment it receives (OPFS/IndexedDB), so a frame is sent once *per user*. `--frame-cache-mb` then pays only where several users read the same study at once, not within a session. Its measured cine-loop win does not transfer; re-measure against concurrent sessions on one hot study before enabling it |
| Dedicated fault thread | Only relevant to the rejected pre-touch arms; the accepted path hops on ~2% of cold asks |

Closed by the 2026-09-04 campaign: real-disk (ext4, not overlayfs) confirmation; the
all-sessions hop-cost cell; and gate-plus-verification (D2), which the accepted path makes
moot — it reads bytes rather than asking whether bytes are resident.

Closed by the 2026-09-05 budget ([`SEND-BUDGET.md`](SEND-BUDGET.md)): what the per-frame
number is made of; io_uring priced per operation rather than per arm; the send path measured
over real quinn; and "app cache" moved out of *wrong scale or scope* into a measured,
opt-in feature.
