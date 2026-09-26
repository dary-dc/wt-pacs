# ADR: size the client ask window from the link, at the minimum depth that saturates

**Status:** accepted · **Date:** 2026-08-26 · **Tags:** delivery, client, transport

## Context and Problem Statement

The client asks the server for frames. If it asks for one, waits, then asks for the next, the link
idles for a full round trip between every frame. So it keeps several asks outstanding — a *window*.

How deep should that window be? The intuitive answer is "as deep as possible": more outstanding asks
means more speculative fill, a warmer cache, and the link never starves. That answer is wrong, and the
reason is not obvious.

## Decision Drivers

- Minimise time from *reader wants a frame* to *first byte of that frame*
- Keep the link at 100% — unused bandwidth cannot be banked, except in the cache
- The client cannot un-ask. Cancel was measured and rejected (see [`adr-reject-server-cancel.md`](adr-reject-server-cancel.md))

## Considered Options

- **A** — Fixed shallow depth (1). Maximum responsiveness
- **B** — Fixed deep window. Maximum fill
- **C** — Minimum depth that saturates the link, derived continuously
- **D** — Deep window plus server-side reordering to undo staleness

## Decision Outcome

**Chosen option: C** — *any depth past saturation buys no throughput and costs latency on every miss.*

Two quantities were being conflated and are in fact independent:

| | |
| - | - |
| **`W`** — cache window | how many frames are held locally. Grows over **time** at the link's fill rate |
| **`D`** — ask depth | how many asks are outstanding. Sets **pipelining only** |

Cache coverage is a function of time and link rate, not of `D`. Once `D` is deep enough to keep the
link busy, more depth fills the cache no faster — it only lengthens the queue a reader must wait
behind when they ask for something uncached.

```
D = ceil( U × (1 + RTT / Tf) )        Tf = time to send one frame,  U ≈ 0.95
```

| term | what it is |
| ---- | ---------- |
| `RTT / Tf` | how many frame-times fit inside one round trip — the gap pipelining must cover |
| `1 +` | the frame currently arriving |
| `U` | how much link we are willing to leave unused in exchange for responsiveness |

Below `D_min` utilisation is `min(1, D·Tf / (RTT + Tf))`; at depth 1 it is `Tf / (Tf + RTT)`.

`U` is **the knob for the trade this ADR is about**, not a constant of nature. It earns its place at the
extremes: a 2.85 MB frame on a 10 Mbps link has `Tf ≈ 2 s`, so `D = 1` already reaches 97% utilisation.
Without `U` the formula would return 2 — doubling the miss cost from 0 to 2000 ms to buy 3% throughput.
`U = 0.95` correctly declines.

> **Corrected 2026-08-26.** An earlier draft replaced `U` with `demand = reader speed × Tf`, on the
> reasoning that a slow reader does not need a full link. That is **incompatible with running the link
> at 100%**: if background fill takes the slack, the link is always fully demanded and the reader's own
> speed never reduces the depth required. Reader speed drives **stride** and the **ask-order split**,
> not depth.

Background fill occupies whatever depth the foreground is not using. It never gets its own budget, so
the link is always full and cursor-driven asks always go first.

**Where the window applies (2026-09-14).** A fill stays one `StreamFrames` ask, for throughput.
On-demand network depth is this client window, not a server queue; disk depth is the server's
`TILE_SLOTS` and `FILL_AHEAD`. Depth 1 is the right answer where `Tf ≫ RTT` — large frames — not
the tile default.

### Positive consequences

- Requires **no server change**. Asks pipeline in the QUIC receive buffer on the existing serial loop
- Link runs at 100% while the miss penalty stays at its theoretical minimum
- Ask order carries priority; a FIFO server preserves it exactly (see [`adr-reject-server-ordering.md`](adr-reject-server-ordering.md))

### Negative consequences

- On a cache miss the reader waits behind `D − 1` outstanding asks. Unavoidable without cancel, which
  does not work. Scroll-only movement (`max_step = 1`) makes this rare — outstanding asks are almost
  always adjacent frames in the direction of travel, so they get used
- `D` depends on measured RTT and on `Tf`, which is itself an estimate — HTJ2K compression varies per
  slice, so frame size is not constant within a series. Both need estimators and both can be wrong
- **`U` is a policy choice with no measured basis yet.** 0.95 is a starting value, not a result

### Validated 2026-08-26 under real netem, on the shared stream

Real `tc netem` (delay + rate) inside an unprivileged network namespace —
`unshare --user --map-root-user --net`, **no root required**; loopback is crossed once per
direction, so `delay 30ms` is an RTT of 60 (`ping` read 60.3 ms). In-process pacer disabled
(`--read-bps 0`); netem shapes the wire. 10 Mbit cap. `D_min` = smallest depth reaching 95% of the
measured ceiling:

| frames | `Tf` | RTT | predicted | measured | |
| ------ | ---- | --- | --------- | -------- | - |
| 250 KB | 200 ms | 20 ms | 2 | 2 | pass |
| 250 KB | 200 ms | 60 ms | 2 | 3 | pass (±1) |
| 250 KB | 200 ms | 150 ms | 2 | 3 | pass (±1) |
| 51 KB | 40.8 ms | 20 ms | 2 | 3 | pass (±1) |
| 51 KB | 40.8 ms | 60 ms | 3 | 3 | pass |
| 51 KB | 40.8 ms | 150 ms | 5 | **5** | pass |

**Six of six.** The last row also first read as a fail, until the sweep was extended past `D`=8: the
curve was still climbing at 8, and the ceiling is 7.84 Mbps at `D`=12. **A plateau is not a ceiling,
and the grid must be extended until the curve turns over.**

On the shared stream **depth past the optimum costs no throughput**: at RTT 60 / 250 KB it delivers
7.00, **8.00**, **8.50** and 8.50 Mbps at `D` = 1, 2, 4, 8. The case against over-asking is miss
latency alone.

### Per-frame streams: a server defect, since fixed

Under the same netem, the per-frame-stream server delivered 7.00 Mbps at every depth, with
`peak_outstanding` correctly reaching 8. Its send phases, median of 14 frames (250 KB, 10 Mbit,
60 ms): `open_uni` **0.0 ms**, `write_all` **0.1 ms**, **`finish` 271.8 ms** — `Tf + RTT`, because
`finish().await` waits for the frame to be acknowledged and the serial loop could not read the next
ask until it returned. Throughput capped at `Tf / (Tf + RTT)`. Opening a stream is local and free;
the cost was waiting for the acknowledgement, and nothing the client did could fix it.

> **Corrected — this section used to call it a live defect of the product default.** It is neither
> now. `finish()` is awaited off the session loop (`server/src/transport/frame_out.rs`): the per-frame
> arm then reached 8.0 Mbps against the old ~7.0 ceiling (250 KB, `D`=4, 10 Mbit, 60 ms). And the
> binary's default has been `--stream-mode shared` since 2026-09-11
> ([`adr-stream-shape.md`](adr-stream-shape.md)). With the fix in, per-frame still needed more
> depth than `shared` to saturate — `D_min` 3–8 against 2–5 on the same grid, the gap widest at
> 150 ms — which is a stream-shape finding, not a window one.

### Corrected: the first validation measured the harness

The first run (simulated RTT, one uni stream per frame) read **five of six**, failing 51 KB / 150 ms
(predicted 5, measured 8), and found depth past the optimum *losing* throughput — 0.933 at `D`=2
against 0.600 at `D`=8 (250 KB, RTT 60), and `D`=64 with 250 KB frames delivering nothing (~16 MB in
flight against connection flow control). **None of it describes the formula or a single-stream
server.** Three harness defects had each produced a convincing null, and a fourth made simulated
RTT inert on the shared stream:

| # | Defect | Effect |
| - | ------ | ------ |
| 1 | `ask_frame` slept `RTT/2` inline, and every caller awaited it in a loop | asks were never simultaneously in flight; `D` was a counter with no wire meaning |
| 2 | `LinkPacer::consume_bytes` held its mutex across the sleep | one uni stream read at a time; concurrent delivery impossible by construction |
| 3 | `e1_saturation_sweep.sh` discarded the server's output | a failed bind was silent, and the 250 KB cells were served by another fixture's server (51 004 bytes per frame) |
| 4 | `--rtt-ms` has no effect on the shared stream until RTT exceeds `Tf` (`D`=1, 250 KB, 10 Mbit: util 1.000 at RTT 60 and 150, where 0.77 and 0.57 are correct; exact at 400) | depth cannot be measured there with it; mechanism **not established** |

Defects 1 and 2 pinned utilisation at the `D`=1 value for every depth — the flat 0.408 of the old
tables (`Tf/(Tf+RTT)` = 40.8/100.8). The netem grid above replaces that run.

## How it is built

`client/transport-ts` carries the window as an opt-in, `connect(url, hash, { window })`: fixed
`{ depth: N }`, or `{ depth: "auto", initial }` (`initial` 2 by default). Only the TypeScript client has it, and
nothing sets it by default.

### The estimator, as built

`client/transport-ts/ask-window.ts`:

- **`Tf`** — the median time between the last 8 arrivals: the link's per-frame time once the depth
  saturates it, the delivered pace below that
- **RTT** — `getStats().smoothedRtt` where the browser has it; otherwise the smallest trip of at
  least two of the last 4 asks sent into an idle window, minus `Tf`. An ask queued behind others
  reads `RTT + D·Tf`, and noise only inflates a trip, so the smallest idle one wins; a session's
  first ask alone carries its warm-up
- **`D = ceil(0.95 × (1 + RTT / Tf))`**, re-evaluated every 8 completed frames, clamped to [1, 16]
- **Damping** — a new `D` is adopted only when two consecutive evaluations agree on it

Chromium has no `getStats` on WebTransport (headless 141 and Chrome alike), so there the idle-ask
path is the only RTT source.

> **Corrected — L2's first estimator did not measure RTT.** The spec that preceded this took RTT as
> the median of first-byte minus ask time over the last 8 frames. On a shared ordered stream that
> includes the ask's own queue, so the estimate ratcheted `D` to the clamp — as did a later min-RTT
> probe. The first shaped ask-policy campaign (control fire-all, fixed, dynamic; 32 KB; RTT
> 20/60/150; 0 and 0.5 % loss) was withdrawn on four blockers and **its rankings are not quoted**:
> a primary metric (p95 ask → displayable after depth-gated asks) that rewarded late asks; arms
> whose byte and ask counts differed by an order of magnitude; that queue-contaminated RTT; and an
> RTT axis mislabelled (netem on egress only, delay N/2, the WAN base unrecorded). The review and
> its rows: `git show aabc46a:docs/measurements/r2/l2_ask_policy_METHODOLOGY_REVIEW.md`.

## Which depth ships — open

Whether `auto` earns its estimator over a fixed constant was never measured. The rule, fixed
before any run (T1):

- On every cell `auto` must reach a depth within ±1 of the formula's, and its p95 wait must be
  within 10 % of the fixed arm run at the formula's depth. Then `auto` is the harness default and
  the recommended viewer setting.
- If `auto` fails any cell, the product setting is a fixed `D` per link class from the formula,
  and `auto` stays an opt-in.
- Void: `auto` oscillating between two depths on consecutive evaluations despite the damping; a
  cell whose fixed arm at the formula's depth does not beat `d=1` (the formula is wrong there, and
  the grid is extended until the curve turns over); a dead cell (§Live cells).

The campaign: a browser on the workstation against `exact-server` on the rig
([`rig-limits.md`](rig-limits.md) §9), `lab/scripts/cloud_netem.sh` at 20, 60 and 150 ms (and
0.5 % loss) on the server's egress, 10 Mbit; `frames_32k` and `frames_250k`; arms interleaved, six
repeats: `d=1` (control), `w:<formula D>` (fixed), `w:auto:2` and `w:auto:16` (which must descend).
`lab/scripts/browser_getstats.py` first says whether the browser build exposes `smoothedRtt`;
`lab/scripts/browser_cell.py` needs a `SERVER_URL` and `CERT_SHA256` to drive a remote server. The
telemetry build harvests per-frame `askMs → receivedMs`; report p95 over positive waits, the mean,
and the final `window_depth`.

## The experiments that test it

The formula is a model: if the transport needs depth 4 where it predicts 2, every number downstream
changes. E1 has data (above), E2 is inconclusive, E4 is void and E5 was never started. The designs
stand; `lab/window-harness` and the `e*_*.sh` scripts in `lab/scripts/` implement them.

### Live cells — the precondition

A miss can only happen when the reader **outruns the link**: reader demand (frames/s × frame bytes)
must exceed the link rate. Otherwise the cache is always ahead, every wait is 0, and `D` cannot
matter however the grid is swept.

| fixture | link | link delivers | reader wants | verdict |
| ------- | ---- | ------------- | ------------ | ------- |
| 51 KB | 5 Mbps | 12.0 f/s | 9 f/s | **dead** |
| 51 KB | 1 Mbps | 2.4 f/s | 9 f/s | live |
| 250 KB | 10 Mbps | 4.9 f/s | 9 f/s | **live, ratio 1.8** ← primary |
| 250 KB | 25 Mbps | 12.2 f/s | 9 f/s | dead |

**Run every group in a live cell and report the demand/supply ratio beside every result**; a
result from a dead cell is not a null, it is not a measurement. E4 ran in one (ratio ≈ 0.75,
`fly_and_settle`'s `frame_modulo: 3` giving three unique frames, every wait 0) and is void.

A trace that can test depth has **≥ 300 unique frames** (no modulo), **`max_step = 1`** (scroll
only; no jump affordance exists), sustained traversal at ~9 frames/s, a **reversal ~60 % through**,
and enough length to reach steady state. Its fixture must hold every frame it walks:
`mild_cell_scroll` needs 300 (`frames_250k_live` has 320), and against the 80-frame `frames_250k`
the harness once waited for a frame it never asked for and hung — a harness defect since fixed,
not a transport stall. `lab/scripts/gen_live_cell_trace.py` writes such traces.

Guards every run carries:

| | |
| - | - |
| **`peak_outstanding`** | the highest concurrent ask count observed. **Below `D`, the run is void** |
| **Frame size** | observed bytes per frame against the fixture's declared size (a tolerance for variable-size fixtures) |
| **Server output kept** | a silently failing server is indistinguishable from a slow one |
| **A fresh port per cell** | never rebind one across studies |
| **netem, not `--rtt-ms`, on the shared stream** | defect 4 above; `--read-bps 0` whenever `tc` shapes, or the pacer fights netem |

### E1 — does `D_min` saturate the link?

Treatment `D` = 1, 2, 3, 4, 6, 8, 16; frame sizes ~32, ~51 and ~250 KB; RTT via netem 0, 20, 60,
150 ms. Controls: **ceiling** `D` = 64 (without it a plateau cannot be told from the ceiling);
**floor** `D` = 1, which must read `Tf/(Tf+RTT)` or the model is wrong before the sweep starts;
**null**, a link capped far above demand, where throughput must be flat across `D` or something
other than pipelining limits the run. Metric: delivered throughput as a fraction of the link rate.
**Pass, fixed in advance:** measured `D_min`, the smallest depth reaching 95 % of the ceiling
control, within ±1 of predicted at every point. Consistently higher would mean sizing depth from a
measured curve; consistently lower, that the transport buffers more than a frame. Result: six of six
on the shared stream (§Validated). Drivers `lab/scripts/e1_saturation_sweep.sh`,
`e1_saturation_cloud.sh`.

### E2 — what a cache miss costs

The residual this ADR accepts: on a miss the reader waits behind `D − 1` asks, predicted
`(D − 1) · Tf`. Treatment `D` = 1…8 on `lab/traces/reversal_storm.json`; controls: floor `D` = 1
(≈ `Tf/2`, the in-flight frame), no-miss (`fly_and_settle`, which isolates the reversal from base
latency), and **warm cache**, which must read ≈ 0 — a non-zero warm control invalidates the metric,
not the design. Metric: **`recovered_ms`, reversal → the wanted frame displayable**, not first
byte: per-frame streams interleave, so a first byte can arrive while earlier frames still drain,
and a partial frame cannot be shown. **Pass:** treatment within 20 % of `(D − 1) · Tf`. Result:
**inconclusive** — rows outside the 20 % band. Drivers `lab/scripts/e2_miss_cost_sweep.sh`,
`e2_miss_cost_cloud.sh` (the mild cell, reversal at 60 %).

### E4 — does the formula pick the right `D`?

E1 and E2 measure the two halves; the formula is the trade between them, and sweeping `D` to pick
the best is fitting, not testing. Objective: **`mean_wait_ms`**, reader wants frame N → frame N
displayable, hits counting 0, reported with p95 so the choice of objective stays visible. Arms: the
formula, recomputed live; **oracle**, the best `D` in hindsight (the ceiling); `D` = 1; `D` = 8; and
**random** `D` from 1–8 per session, which **tests the premise** — random ≈ formula ≈ oracle means
`D` does not matter and this ADR is over-engineering. Run it first. Gate: the oracle must beat
random by **≥ 100 ms at p95**. Choose any parameter on `fly_and_settle` and report on
`reversal_storm` and `dense_scrub` without re-tuning.

**`U` is measurable once the objective is fixed**, by sweeping 0.80, 0.90, 0.95 and 1.00 on the
formula arm — but `D` is an integer, so `U` moves it only where `x = 1 + RTT/Tf` sits **just above**
an integer. At `x = 1.3` (250 KB, 60 ms, 10 Mbps) every `U` gives `D = 2` and the sweep is a null by
construction — the error that produced the 0-of-100 cancel result. Place `(RTT, Tf)` at
`x ≈ 1.02, 2.05, 3.05`. If `mean_wait_ms` is flat across `U` where `U` changes `D`, remove `U`; if
the optimum moves across traces and links, `U` stands in for something that should react (likely
the hit rate) and the formula needs rethinking.

### E5 — how wrong can the estimators be?

Feed the formula RTT and `Tf` scaled ×0.5, ×0.75, ×1.5, ×2 against the exact values, with a
**blind** control at fixed `D` = 2. Flat under ±50 % error: the estimators can be crude. Blind ≈
truth: stop estimating, ship a constant, delete the machinery. **Not started**; T1 above is the
browser form of the same question.

### E0 — does the emulated link tell the truth?

Every number above comes from an emulated link; if the emulation is wrong they are all wrong
together. Run the harness over the rig's **real path, unshaped**, recording RTT and throughput; run
the same trace locally under netem set to those values; compare `mean_wait_ms`, mean and p95.
Within ~15 %: the emulated grid is trustworthy. Diverges: stop and re-read every emulated result.
`mean_wait_ms` is measured client-side end to end, so no clock is compared across machines.
Driver `lab/scripts/e0_netem_validation.sh`. **Not run.** What was calibrated instead is the
container's userspace relay against netem on the rig, on delay only
([`rig-limits.md`](rig-limits.md) §3).

### What invalidates a run

A null control that is not flat; a warm control that is not ≈ 0; a `D` sweep without the ceiling
control; a dead cell; `peak_outstanding` below `D`.

## Pros and Cons of the Options

### A — fixed depth 1

- ✅ Zero queueing; every ask served next
- ⚠️ Utilisation caps at `Tf / (Tf + RTT)`. At 40 ms frames and 60 ms RTT that is 40% of the link
- ⚠️ Cache fills slower, so misses become *more* frequent — the opposite of the intent

### B — fixed deep window

- ✅ Simple; link always saturated
- ⚠️ Buys no extra fill over C, and every extra slot is latency on a miss
- ⚠️ Depth chosen without reference to the link is wrong on most links

### C — minimum depth that saturates *(chosen)*

- ✅ Optimal on both axes simultaneously: full link, minimum miss penalty
- ✅ No server involvement
- ⚠️ Needs live estimates of RTT and `Tf`

### D — deep window plus server reordering

- ✅ Would recover the miss penalty while keeping deep fill
- ⚠️ The extra fill it protects does not exist: depth past saturation adds no coverage
- ⚠️ Rejected on its own merits — see [`adr-reject-server-ordering.md`](adr-reject-server-ordering.md)

## More Information

- [`adr-reject-server-ordering.md`](adr-reject-server-ordering.md) — why the server stays FIFO
- [`adr-reject-server-cancel.md`](adr-reject-server-cancel.md) — why the client cannot un-ask
- [`adr-stride-is-bandwidth-conservation.md`](adr-stride-is-bandwidth-conservation.md) — stride, which handles the case where demand exceeds 1, and what a queue behind this window could recover
- Reader behaviour: published measurements of radiologist scroll speed, oscillation over adjacent
  slices, and repeated depth passes over ≥80% of a series
