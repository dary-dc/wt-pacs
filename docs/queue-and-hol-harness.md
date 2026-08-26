# Queue and head-of-line — what to build, and what has to justify it

> **§1 obsolete 2026-08-26.** The queue shape it specifies is rejected and being removed
> ([`adr-reject-server-ordering.md`](adr-reject-server-ordering.md),
> [`cleanup-plan-2026-08.md`](cleanup-plan-2026-08.md)).
> **§2 (head-of-line) is still open and still the plan.** §5 (quotability) still governs every
> measurement in this repo.

**Written:** 2026-08-24 · **Status:** queue design settled, HoL deliberately open ·
**Audience:** the agent implementing this, with no access to the design session.

This document is the buildable half, scoped to wt-pacs.

wt-pacs is a **product**, not a lab. Everything here that is scaffolding is marked as such and comes out
in one commit when it has answered its question.

---

## 0. Two questions, one rig

| | Question | Status |
| - | -------- | ------ |
| **Q1 · Queue** | Does holding asks and cancelling stale ones recover enough time to justify keeping it? | **Cancel rejected** — see [`adr-reject-server-cancel.md`](adr-reject-server-cancel.md). Two-task shape kept |
| **Q2 · Head-of-line** | Does spreading frames across several streams recover enough under loss to justify it? | **Open — do not pre-commit to an answer** |

They share a harness because they are the same measurement with different independent variables.

---

## 1. Q1 — the queue

### The shape to build

```
reader task                      sender task
recv().await → mpsc send         owns a PRIVATE VecDeque
(never cancelled)                between frames: drain channel with try_recv,
                                   applying asks and cancels to its own deque
                                 then write ONE frame to completion
```

**Do not use `tokio::select!` for this.** An earlier design did, and it is wrong: `select!` cancels the
losing branch by dropping its future.

- If the receive branch wins, the in-flight `send_htj2k_frame` future is dropped **mid-write** →
  truncated frame on the stream
- If the send branch wins, the receive future is dropped possibly having consumed the 4-byte length
  prefix but not the body → the FoD stream is desynchronised from then on

Both are silent corruption, not panics. A pinned-future variant is possible but replaces mechanical
complexity with cancel-safety auditing, which is the worse kind. The two-task split above has **no
cancellation anywhere** — both tasks loop over awaits that always run to completion.

Because the deque is **private to the sender**, cancel does not need shared mutable state: cancels
arrive as ordinary messages and are applied at the drain step. A bounded channel supplies the volume
cap for free. Cancels never queue behind asks, because the sender drains *everything* pending before
choosing its next frame.

### Policy

| | Decision | Reason |
| - | -------- | ------ |
| Contents | Asks, not data | Locating a frame is a memory-map slice |
| Priority | **None in phase 1** | With client-side stride and no speculative fill, everything queued is wanted. Priority arrives with the orientation-fill layer |
| Stale asks | **`CancelFrames` ignored server-side** | Measured; cancel did not pay — [`adr-reject-server-cancel.md`](adr-reject-server-cancel.md). Client stride limits outstanding asks instead |
| Cap | Bounded channel | A **robustness** bound against any client asking for 2000 frames — not a performance knob, and unrelated to stride |
| Mid-frame stop | No | A frame is one write. Commitment depth is one frame |

**Priority is about order and is deferred. The cap is about volume and is permanent.** These were
conflated in earlier discussion.

### Unconditional vs on probation

- **Unconditional:** the two-task shape. It is the prerequisite for `queue_us` in the telemetry spec
  and it handles `EndSession` promptly. Same bytes, same order
- **Rejected (2026-08-24):** server-side cancel — see ADR. Priority remains deferred

---

## 2. Q2 — head-of-line, open

QUIC already gives independent ordering per stream. Head-of-line blocking appears when **many frames
share one server uni stream**: a lost packet in frame 5 holds up frame 6 even though frame 6's bytes
arrived.

wt-pacs today opens **one server uni stream per frame response** (see `docs/WIRE.md`). That already
avoids the classic single-pipe HoL case. Q2 is about whether further tuning — more streams, FEC,
unreliable delivery — pays under loss, not about rediscovering "one stream vs many."

Candidate answers, none chosen:

| Candidate | Trades | Note |
| --------- | ------ | ---- |
| Fixed stream pool at connect | setup RTT × N, one-time | Pre-created uni streams; frames assigned round-robin or by hash |
| **Current shape — stream per frame** | one stream open per response | Already shipped. HoL is per-frame, not cross-frame |
| `unreliable_fec` | bandwidth for latency | Competes with multi-stream for the *same* problem. Belongs in the same comparison |
| One stream per frame with cold open each time | 1–2 RTT per frame | **Dead.** Stream creation cost measured |
| `gop_stream` | — | Ranked low: assumes inter-frame coding; our frames are independent |

**The question worth answering is not "how many endpoints" but "under induced loss, does our current
one-stream-per-frame model still leave recoverable HoL, and does any alternative beat it?"** wt-pacs
links `wtransport` directly, so stream policy is a server knob, not a separate wire stack.

**Value is loss-dependent and is exactly zero on a clean link.** Any run without induced loss will
report this whole family as worthless. That is a property of the run, not of the design.

---

## 3. The harness

### Predict first, then try to falsify

The queue's win is `bytes committed ahead ÷ link rate` — arithmetic, not discovery. Write the predicted
curve (recovered time vs link rate vs burst depth) **before** measuring, so a null result means
something. A harness built without a prediction can only confirm whatever scenario it happened to
construct.

### Layers, cheapest first

1. **Simulation** — no transport. Both loops as arithmetic with a reversal injected partway. Sweeps
   thousands of points in seconds. Produces the predicted curve. **Scaffolding — delete when done**
2. **Real stack, headless** — wt-pacs server, Rust client, real `wtransport`. Check a handful of points
   against layer 1. Disagreement is the finding
3. **Browser** — only if 1–2 land near the decision boundary. Only layer that yields `gesture → painted`

Expect to stop after layer 2.

### Constraining the link

**Throughput axis — pace the harness client's reads.** It reads at rate R; flow control does the rest,
the server's write blocks as on a slow link. Zero product code, deterministic, no privileges.

**RTT axis — `netem` delay. Not optional.**

> **Correction.** An earlier draft of this section said read pacing was "exact, not an approximation"
> for Q1, and that `netem` was needed only for Q2. **That was wrong.** Working the model analytically
> (see [`stride-and-queue-experiment.md`](stride-and-queue-experiment.md)) shows the queue recovers
> approximately `U·RTT` at the depth stride would actually choose — so **RTT is the dominant variable
> for Q1 too**, and read pacing cannot vary it. A pacing-only rig would sweep the axis that barely
> matters while holding fixed the one that decides the answer.

**Loss axis — `netem` loss.** Q2 only. Needs the container and `NET_ADMIN`.

> Record in the harness README which axis each mechanism can and cannot move. Otherwise someone reuses
> this rig for a question it cannot answer and gets a confident wrong number.

### Traces — use the right one

The harness crate should ship committed reader traces (e.g. under `lab/traces/`), emitted by a small
timing tool. **`max_step` must be 1 in the primary workloads — a reader scrolls, it never jumps.**

That kills the obvious motivating scenario: "client asks 10–30, reader jumps to 200, all wasted"
**cannot occur** in those traces. Deep commitment comes from the client *outrunning the link*, not from
jumping.

| Trace | Role |
| ----- | ---- |
| `fly_and_settle` | **The one that matters.** 16 ms/step ≈ 62 asks/sec; on any link where a frame takes longer than 16 ms, asks outrun delivery and commitment builds with `max_step` still 1. The 3 s dwell then wastes everything queued but the last frame |
| `reversal_storm` | Secondary. Adjacency means committed frames are often still wanted — expect a **small** win, and that is a result, not a failed run |
| `dense_scrub` | Control arm |

Evaluate the falsifier **per trace**. A queue that pays on `fly_and_settle` and not on `reversal_storm`
is a queue that pays — the burst case is what a faster transport produces more of.

Caveat: these traces are synthetic. `max_step = 1` is documented and defensible, but if the product
exposes any jump affordance — thumbnail click, scroll-bar drag, page-down — the queue is worth more
than any of them can show.

### What it measures

Mechanism metrics. They explain; they are never targets.

- **wasted bytes** — written for frames the reader had already left
- **recovered time** — reversal → first byte of the wanted frame, arm A minus arm B
- **commitment depth** — frames sent after the reversal that were already unwanted

First two are headless.

### Falsifier, stated in advance

> **Q1:** falsifier met — recovered time under ~100 ms on `fly_and_settle` at paced read rates 2–300
> Mbps; cancel saved 0 ms vs FIFO. **Decision:** [`adr-reject-server-cancel.md`](adr-reject-server-cancel.md).
>
> **Q2:** state a threshold before the first `netem` run, not after.

---

## 4. Where things live

| | |
| - | - |
| Design docs | `wt-pacs/docs/` — **committed**. Not `.local/`, which is gitignored, and history is the point |
| Harness + simulation | `lab/` — committed for reruns. **No product crate may depend on it.** |
| The product change | Two-task queue shape only |

---

## 5. When a harness number is quotable in wt-pacs

Before treating any measurement as a product decision, confirm the model matches the server you are
running:

| Must match | Why |
| ---------- | --- |
| **One uni stream per frame response** | Shared-stream servers measure a different HoL problem |
| **`wtransport` write path** | Internal buffering before bytes hit QUIC changes "committed" timing |
| **SBND mmap slice send** | Copy vs mmap affects server CPU but not queue drain math — still document which |
| **Cancel policy flag** | Historical A/B used `WTPACS_QUEUE_CANCEL` (removed). Harness `--server-cancel` is label-only |
| **Trace `max_step`** | Jump traces vs scroll-only traces answer different queue questions |

Maintain in the harness README a named checklist of these invariants. Without it, a number from one
server configuration quietly stops applying after the next refactor.

The simulation layer (§3) is transport-agnostic and transfers unchanged. **Layer 2+ numbers are valid
only for the wt-pacs exact-server configuration under test.**

---

## 6. Related, not in scope here

**Cold-page stalls.** `frame_slice()` is a memory-map read; if the page is not resident the OS thread
stalls, and that stall is *not* an `await`, so tokio cannot schedule around it — other sessions sharing
that thread stall too. Invisible in the lab because fixtures are warm.

Three real options (`tokio::fs` is *not* a fourth — it is `spawn_blocking` internally, and there is no
true async file I/O on Linux outside io_uring):

- **mmap + `MADV_WILLNEED`** — no copy; the readahead target is *the next entries in the ask queue*, so
  it needs no scroll prediction and works through reversals. Populates reclaimable page cache rather
  than reserving RAM. Advisory, Linux-only
- **`pread` on a blocking pool** — never stalls the runtime; costs a copy and a thread hop
- **io_uring** — genuinely async, no copy, real complexity

Preload-the-study is dead: it does not survive the scaling target.

**Decide by measurement** — serve-time tail on a cold file versus a warm one. The right fix differs by
which it is, and we currently have no number at all.
