# What a thread hop costs a decoded frame

Cloud lane L13. The pipeline under redesign moves a decoded frame across more threads than it has
to: the decoder hands pixels to the receive worker, the receive worker hands them to the page, and
the page pulls each frame with a request of its own, so a decoded frame waits in the receive worker
until it is asked for. This prices those hops so the redesign can decide how many survive.

**Measured, not recommended.** The shape is the workstation's call; this is the evidence.
Driver: [`lab/thread-hops/`](../lab/thread-hops/README.md).

## Method

A page under `lab/` with three workers standing in for the pipeline — no transport, no decoder.
The decode worker allocates a buffer of the frame's size, fills it, and posts it. A link worker
posts a steady stream of 4 KB chunks into the receive worker, which copies each into a reassembly
buffer: the read loop's stand-in, and the thing a relayed frame has to queue behind.

Arms, per frame:

| | route | sent |
| - | - | - |
| **relay** | decoder → receive worker → page | transferred at each hop (today's shape) |
| **direct** | decoder → page, over a `MessagePort` the receive worker handed out at setup | transferred |
| **shared** | as direct | `SharedArrayBuffer`, no transfer list |
| **cloned** | as direct | plain `ArrayBuffer`, no transfer list — what a consumer pays posting a frame to its own worker without listing it |

Relay and direct each run **push** (posted as soon as ready) and **pull** (the frame waits in the
holder until the page asks). Sizes 50 KB, 512 KB, 768 KB, 2 MB, 8 MB. Regime 1 is one frame with
every thread idle, 9 rounds; regime 2 is a burst of 237 frames under link load, 5 rounds. Arm order
rotates each round. Sizes do not rotate.

**Clocks.** Each context has its own `performance.timeOrigin` — the page's and a worker's differed
by 48.8 ms here — so `performance.now()` alone is not comparable across threads and
`timeOrigin + now()` is. Checked before anything was measured: 200 worker→page messages, 0 negative
one-way times, median one-way 15 µs against a 40 µs round trip. The page is served cross-origin
isolated, which the page asserts before the shared arm runs, so `performance.now()` resolves to
**5 µs**. Differences of one tick are quantisation, not findings, and are called out below.

**What "head" means.** For push arms it is the decoder's post to the page's receipt — the whole
path. For pull arms it is the page's ask to its receipt, because the decoder posted long before.
Those are different quantities: a pull arm is self-paced, one frame in flight at a time, while a
push arm's producer runs ahead. **Push and pull are not compared on latency here**; relay is
compared against direct within each.

## The relay hop, push (head, ms — median [min..max])

| link load | receive worker busy | 50 K | 512 K | 768 K | 2 M | 8 M |
| - | - | - | - | - | - | - |
| idle, 1 frame | — | 0.285 / **0.120** | 0.245 / **0.080** | 0.165 / **0.110** | 0.295 / **0.135** | 0.380 / **0.170** |
| 24×4 KB/ms | 1.6 % | 0.095 / **0.040** | 0.115 / **0.060** | 0.155 / **0.080** | 0.275 / **0.145** | 0.345 / **0.210** |
| 96×4 KB/ms | 5 % | 0.065 / **0.030** | 0.140 / **0.065** | 0.195 / **0.075** | 0.315 / **0.165** | 0.405 / **0.220** |
| 256×4 KB/ms | 9–12 % | 1.185 / **0.035** | 0.330 / **0.070** | 11.310 / **0.100** | 0.975 / **0.190** | 4.310 / **0.235** |

*relay-push / **direct-push**. Rounds better out of n, direct over relay: 7/9, 7/9, 6/9, 8/9, 7/9
idle; **5/5 at every size ≥ 512 K in all three burst loads**.*

**The hop costs about 0.1–0.2 ms when the receive worker is quiet**, flat in frame size because a
transfer is a pointer move, not a copy. Direct beats relay in almost every round at every size.

**Under a busy receive worker the hop stops being a fixed cost and becomes an unbounded one.** At
256×4 KB/ms the relay arm's range is 0.280–19.500 ms at 768 K and 0.145–36.630 ms at 512 K, while
direct stays inside 0.05–0.27 ms throughout. The receive worker is only 9–12 % busy, and the host
peaked at 70 % of its four cores, so this is **queueing, not saturation**: a frame arriving mid-tick
waits behind up to 256 link messages, and the median is not a stable summary of a distribution that
shaped. Quote the ranges, not the medians, for that row.

That load is well above the product's: a 237-frame fill of 250 KB frames over a few seconds is
tens of MB/s, and 256×4 KB/ms is 266 MB/s. It is included because it is the only setting that shows
the failure mode, not because it is realistic.

## Transfer against copy — the largest number here

`cloned` is the only arm whose cost scales with frame size, because it is the only one that copies.

| | 50 K | 512 K | 768 K | 2 M | 8 M |
| - | - | - | - | - | - |
| direct-push, head ms | 0.040 | 0.060 | 0.080 | 0.145 | **0.210** |
| cloned, head ms | 0.315 | 0.390 | 0.610 | 1.545 | **5.630** |
| **page main-thread ms per 237-frame burst, direct-push** | 0.80 | 2.12 | 2.77 | 4.98 | **17.1** |
| **page main-thread ms per 237-frame burst, cloned** | 15.1 | 95.7 | 121.6 | 341.4 | **1341.8** |

*24×4 KB/ms load. Direct beats cloned 5/5 rounds at every size ≥ 512 K.*

**At 8 MB a cloned frame costs the page's main thread 1.34 s per 237-frame burst against 17 ms
transferred — about 80×, and 5.0 ms of median main-thread time for every single frame.** This is
the number `client-shape-plan.md` §0's transferable-results clause is worth, and it dwarfs every
hop question on this page.

`shared` tracks `direct-push` closely and edges it at the larger sizes (5/5 rounds at 2 M and 8 M
under the two heavier loads, 0.195 against 0.235 ms at 8 M) — a `SharedArrayBuffer` needs no
transfer bookkeeping. At 50 K and 512 K the two are within one or two clock ticks and tie.

## What pull costs, and what it does not

Pull's per-frame latency is low and flat — 0.050–0.065 ms across every size below 8 M, at both
loads — because only one frame is ever in flight. That is not evidence that pull is faster; it is
a different workload. What pull does cost is main-thread work, because the page issues the next ask
from inside its own frame handler:

| page main-thread ms per 237-frame burst, 8 M | relay | direct |
| - | - | - |
| push | 1.8 | 17.1 |
| pull | 20.9 | 45.5 |

**Pull adds a `postMessage` per frame to the thread the redesign is trying to protect.**

**Not a finding: relay-push's 1.8 ms against direct-push's 17.1 ms.** Per-frame medians are 0.0100
and 0.0151 ms — one 5 µs tick apart — and the per-burst totals differ only in the tail (max 0.34
against 1.13 ms). That gap is garbage collection landing in some handlers, not a systematic
per-frame cost, and the two should be read as a tie.

## Mutants

Both of the lane's checks were run, and both fired.

* **`shared` given a transfer list** → `Failed to execute 'postMessage' on 'MessagePort':
  SharedArrayBuffer can not be in transfer list`, and the cell delivers 0/1 frames. The arm really
  is a `SharedArrayBuffer`, and really is sent without a transfer list.
* **`direct` routed through the receive worker** → its numbers move off direct's and onto relay's:
  0.035 → 2.220 ms at 50 K, 0.100 → 2.945 at 768 K, 0.235 → 1.855 at 8 M, with relay's wide ranges
  appearing too. The arms differ because of the route, not because of how they are timed.

## Where this stops

* **Container, 4 vCPU, headless Chromium 141, loopback, no transport and no decoder.** Relative
  only. The host peaked at 70 % of four cores in the heaviest cell; nothing is claimed past that.
* The burst regime's producer runs as fast as it can allocate (≈7.7 ms per 8 MB frame). A real
  decoder is slower, so the relay queue depth here is a ceiling, not a typical case.
* Sizes are not rotated within a round; only arm order is.
* `handlerMs` counts from the message event to the end of the page's frame handling, including the
  page's first touch of the pixels. That is deliberate — a consumer touches them — but it means the
  figure is not message dispatch alone.
* Nothing here says which shape to build. `client-shape-plan.md` §4 is where that is decided.
