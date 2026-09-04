# Disk access — later

ADR: [`adr.md`](adr.md) · Evidence: [`RERUN.md`](RERUN.md).

| Idea | Note |
| --- | --- |
| `RWF_NOWAIT` on the real deployment filesystem | `read_at_nowait` reports an unsupporting filesystem as a miss, so an overlayfs/NFS host silently degrades to pooled `pread`. Confirm support where the product actually runs — the arm is only a win where the kernel honours the flag |
| Ask-queue ahead-N prefetch | When a real client window exists. A pool read for frame *n+1* while *n* is on the wire would cut the cold miss further; needs the ask window first |
| `io_uring` under a thread-per-core runtime | Measured and tied as things stand (RERUN §Cell 6). Pinning sessions to cores would unlock `SINGLE_ISSUER` + `DEFER_TASKRUN` and drop the eventfd — but that is a server-wide architecture decision, not a disk-access one |
| `io_uring` pipelining for a miss-dominated deployment | Reading window n+1 during window n's write is worth ~6% when every read misses and ~-25% when they hit. Worth revisiting only where the working set genuinely exceeds RAM |
| Larger-than-RAM study on a real study volume | This host's cold cells are guest-cold but hypervisor-warm (see RERUN §Limitations). Ranking held across every cell, but absolute cold latency is not this host's to give |
| Dedicated fault thread | Only relevant to the rejected pre-touch arms; the accepted path hops on ~2% of cold asks |

Closed by the 2026-09-04 campaign: real-disk (ext4, not overlayfs) confirmation; the
all-sessions hop-cost cell; and gate-plus-verification (D2), which the accepted path makes
moot — it reads bytes rather than asking whether bytes are resident.
