# ADR: reject server-side `CancelFrames`

**Status:** accepted · **Date:** 2026-08-24 · **Supersedes:** Q1 cancel policy in
[`queue-and-hol-harness.md`](queue-and-hol-harness.md)

> **§4 and §5 superseded 2026-08-26** by [`adr-reject-server-ordering.md`](adr-reject-server-ordering.md).
> Three of §4's four flip conditions are wrong — only RTT changes the answer. §5's retained two-task
> queue shape is being removed; see [`cleanup-plan-2026-08.md`](cleanup-plan-2026-08.md).
> **§1–§3 stand: the measurement is still the evidence.**

---

## 1 · What was proposed

The server holds client asks in a private deque (two-task queue: reader → channel → sender). When the
reader settles on a frame, the client sends `CancelFrames` for indexes it no longer wants. The server
would drop matching entries from the deque before sending the next frame — undoing stale commitment
instead of draining it FIFO.

Arm A (cancel off) vs arm B (cancel on) was measured with the layer-2 harness at paced read rates.

---

## 2 · The numbers

Fixture: `lab/fixtures/queue_large` (~51 KB mean frame). Trace: `fly_and_settle` (`max_step = 1`,
16 ms/step). Metric: **`recovered_ms`** — settle → first byte of wanted frame (user-visible wait).

### Layer 2 — real harness (`lab/scripts/harness_sweep_mbps.sh`, 1–300 Mbps)

| Read pace | Arm A | Arm B | Cancel saves |
| --------- | ----- | ----- | ------------ |
| 1 Mbps | 110 ms | 112 ms | −2 ms (noise) |
| 2 Mbps | 0 ms | 0 ms | **0 ms** |
| 10 Mbps | 0 ms | 0 ms | **0 ms** |
| 18 Mbps | 0 ms | 0 ms | 0 ms |
| 50+ Mbps | 0 ms | 0 ms | 0 ms |

Cancel beat FIFO on `recovered_ms` at **0 of 100** sweep points. Wire counts differed sporadically by
~one frame (~48 KB) with no UX impact.

Full table: `.local/measurements/HARNESS_SWEEP.tsv` (gitignored; regenerate with the script above).

### Layer 1 — simulation (same fixture size, **different trace shape**)

Sim models 20 **unique** frame indexes (0→19, wanted = 19). Harness trace uses `frame_modulo: 3`
(cycles 0,1,2; wanted = 1). Sim therefore **overstates** cancel benefit vs the harness trace.

| Read pace | Sim cancel off | Sim cancel on | Sim predicted save |
| --------- | -------------- | ------------- | ------------------ |
| 2 Mbps | 3572 ms | 104 ms | 3468 ms |
| 10 Mbps | 471 ms | 22 ms | 449 ms |
| 18 Mbps | 127 ms | 13 ms | 113 ms |
| 25+ Mbps | ≤6 ms | ≤6 ms | 0 ms |

**Finding separate from cancel:** sim overpredicted harness `recovered_ms` by roughly an order of
magnitude at low rates. The transport commits bytes earlier than a deque-only model assumes. Record this
for any future queue or HoL model — not only for this rejected feature.

---

## 3 · Why it lost

Not “cancel never helps in theory.” **In this stack, cancel arrived too late to matter.**

The sender opens one uni stream per frame and writes the full envelope before dequeuing the next ask.
By settle time, frames were already handed to QUIC — not sitting in the server deque. `CancelFrames`
could only drop **not-yet-started** sends. At paced read rates where sim predicted large wins, the
real server had already committed the bytes; the client still had to drain in-flight streams before
the wanted frame.

That is the mechanism that stops someone retrying the same idea with a “faster cancel path” on this
architecture: the bottleneck is **transport commit**, not deque depth.

---

## 4 · What would flip the answer

Re-run the harness (same rig under `lab/`) if any of these change:

| Condition | Why it matters |
| --------- | -------------- |
| **Much smaller frames** (e.g. tile-sized codestreams) | More frames in flight at once → more deque entries cancel could still reach |
| **Higher RTT / further readers** | Pipelining depth grows; stride may choose larger D (see below) |
| **Jump affordance in the UI** | Thumbnail click, scrollbar drag, page-down — traces with `max_step = 1` cannot show that workload |
| **Trace with linear 0→N asks** | Matches sim’s burst model; still failed to move `recovered_ms` in early runs, but worth re-checking if frame size or RTT change |

Falsifier threshold (unchanged): if cancel does not beat FIFO by **~100 ms** `recovered_ms` on
`fly_and_settle` at cared-about link rates, do not ship server-side cancel.

---

## 5 · What we kept instead

**Two-task queue shape** — reader never cancelled; sender owns private deque; one frame per write to
completion. No `tokio::select!` on the hot path.

**Stride depth (client policy, not server cancel)** — limit how many asks the client has outstanding
(`D`). That **prevents** waste rather than undoing it after commit. See
[`stride-and-queue-experiment.md`](stride-and-queue-experiment.md): at `D = D_min`, the queue’s
cancel benefit collapses toward ~one RTT; on large frames over slow links, `D = 1` already saturates
the link and cancel is worth nothing.

**Wire:** clients may still send `CancelFrames` (best-effort, no ack). The server **ignores** them.

---

## References

- Design + harness spec: [`queue-and-hol-harness.md`](queue-and-hol-harness.md)
- Stride / queue interaction: [`stride-and-queue-experiment.md`](stride-and-queue-experiment.md)
- Rerun: `lab/queue-harness`, `lab/queue-sim`, `lab/scripts/harness_sweep_mbps.sh`
