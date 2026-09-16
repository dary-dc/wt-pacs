# Plan: the production client shape

**For:** wt-pacs implementer · 2026-09-14 · **Status:** proposed, nothing built.

The client in this repository is the shape the product takes. The transport behind it is
swappable and may not be this one. Everything above the transport — where the session lives, how
frames are decoded, how a fill is bounded and cancelled, how the session survives an idle user —
is decided here and consumed elsewhere.

The deliverable is a **running demo at every milestone**, not a document that proposes one.

## 0 · The seam already exists, and is already proved

`client/transport-ts/session.ts` and `client/transport-wasm/src/session.rs` are two independent
implementations of one surface:

| | |
| --- | --- |
| `connect(url, certHash)` | open a session |
| `requestExactFrame(i)` | one frame, interactive path |
| `startExactFrames(indices)` / `waitExactFrame(i)` | ask for a set, take them as they land |
| `startStreamFrames(last, range?)` | the bulk path |
| `endStream()` | **stop a running fill without ending the session** |
| `stats()` / `close()` | |

Two implementations behind one surface is what makes it a seam rather than a coincidence. A third
implementation — a different transport entirely — plugs in without anything above it knowing. That
is the whole reason this plan lives in this repository and says nothing about what else might
implement it.

**Three clauses the surface does not yet state, and must.** Each has already cost real time:

1. **Worker-safe.** No implementation may reach for `window`. The WASM client did, through
   `perf_now_ms`, and every timestamp it produced inside a worker read `0` — not an error, zeros.
   Fixed on this branch; it belongs in the contract so the next implementation cannot repeat it.
2. **Cancellable.** `endStream()` is part of the surface and the server honours it mid-fill under
   test. An implementation that cannot cancel is not conformant.
3. **Transferable results.** A `FrameResult`'s buffer must be transferable, so crossing the worker
   boundary is a move and not a copy. Priced: at 8 MB a copied frame costs the page's main thread
   1.34 s per 237-frame burst against 17 ms transferred. [`thread-hops.md`](thread-hops.md).

A conformance suite over those three, run against both implementations, is milestone 1's real
output.

## 1 · What the shape adds above the seam

| | why, and the evidence |
| --- | --- |
| **the session lives in a worker** | a receive loop on the main thread cannot read while the main thread is busy, and it is busy constantly; a fill measured behind one blocking task loses more than any transport lever recovers |
| **one decode pool, sized from the device** | `navigator.hardwareConcurrency`, not a constant. Thread count is a whole-application budget — transport worker plus decoders plus the renderer — and pricing any one of them alone is how you end up oversubscribed on a phone |
| **first-free dispatch** | a free decoder takes the next frame; round-robin idles a decoder behind a slow neighbour. Matters when decode times are uneven, which is the device case |
| **a bounded fill window** | asking for every frame of a study up front allocates one waiter per frame before a byte arrives. Fine at 87, not at 2 000 |
| **cancellation wired end to end** | a jump to another series must abandon what is in flight, or the new frames queue behind the old ones |
| **lifecycle: dial early, stay alive, notice death** | the session opens when the user picks a series and is used when the viewer mounts, minutes later |
| **a cache seam** | the viewer paints from cache; the cache is filled ahead of it |
| **a paint sink** | the client hands decoded frames to a renderer it does not know |
| **async `stats()`** | it cannot be synchronous across a worker; pretending otherwise returns stale data under a truthful-looking signature |

**No proxy layer.** The shape is `App → ViewerClient → [worker: transport + decode pool]`. The
worker boundary *is* the API. A shim that makes a worker-backed client look like an in-page one
exists to let a benchmark swap implementations at run time; a product ships one.

## 2 · Milestones

Each is a demo that runs and a claim that is measured. None is a refactor without an observable.

**M1 — the seam, in a worker.** Move the session into a module worker behind the existing surface.
Add the conformance suite (§0) and run it against both implementations. *Proves:* the surface
survives the boundary, and both implementations satisfy the three clauses.
*Measured:* the harness's existing figures are unchanged; worker stamps are non-zero.

**M2 — decode.** A real decode path in the harness: OpenJPH, one pool, first-free, sized from
`hardwareConcurrency`. *Proves:* codestreams become pixels off the main thread.
*Measured:* per frame — time waiting for a decoder, time decoding, time for the page to take it.
Those three must sum to the total; a split that does not sum is not a split.

**M3 — bounded fill and cancellation.** A window of outstanding frames, refilled as they land, and
`endStream()` reachable from the page. *Proves:* a study far larger than the window fills with
bounded memory, and a jump abandons what is in flight.
*Measured:* peak outstanding waiters against study size; time from a jump to the first frame of the
new target, with and without cancellation.

**M4 — lifecycle.** Dial at selection, closure detected and waiters woken, a re-dial policy.
*Proves:* a session opened minutes before first use still serves the first frame immediately.
*Measured:* first-frame latency after an idle gap, swept over gap length.

**Two thirds of this is already done, and one third moved to the server.** Closure detection landed
in both clients: a session carries the reason it is gone, and setting it fails every armed waiter,
while a frame that never arrives on a *live* session still takes the full timeout. And keep-alive is
**not client work at all** — the WebTransport API exposes no such knob, and only one end needs to
send them, so **only the server can hold a browser's session open**. Measured: a 5 s idle timeout
with none lost 3 of 3 sessions over a 12 s hold; 2 s keep-alive kept 3 of 3 with the client silent.
An idle held session costs ~75 KB and ~0.05 ms of CPU per second, linear to 2 000 with no knee — it
buys packets, not state. **Recommended: 20 s keep-alive, 60 s idle timeout**, since browsers
typically advertise 30 s and the effective timeout is the lower of the two.

So M4's remaining client work is the re-dial policy. Whoever consumes this plan must also configure
its server, or a session opened at selection dies before the viewer mounts.

**M5 — the cache seam.** An interface with an in-memory implementation behind it, and OPFS behind
the same interface. **The format stays undecided** — whether it holds compressed or decoded frames
is to be evaluated, not assumed, and is out of scope here. *Proves:* the shape, not the choice.

**M6 — paint.** A canvas sink, and the hand-off measured. *Proves:* the number that has been the
largest per-frame cost in every measurement so far and has never been decomposed.
*Measured:* per frame, the main-thread work separated from time spent queued behind it. They are
not the same thing and have never been told apart.

## 3 · Sequencing

M1 and M2 are independent of everything and gate the rest. M3 needs M1. M4 needs M1 and a server
keep-alive. M6 needs M2. M5 can slot anywhere after M2.

M2 also unblocks the decode measurements that currently have nowhere to run in this repo, and M6
answers the question that matters most on large frames.

## 4 · Open, and each belongs to someone else

* **Decoder pool shape** — N single-threaded instances or one multithreaded instance. Each instance
  is a separate WASM heap that only grows, so this is a memory decision. `docs/decode/README.md`;
  measured by the decode lane, not here.
* **BYOB reads** — a tie on time, and the first frame of a session costs ~12 ms more on that path,
  reproduced and undiagnosed. Gated on that diagnosis; the feature stays off until then.
* **Cache format** — deferred by decision, not by oversight.
* **Reconnect policy** — eager on visibility change, or lazy on first failed ask. M4 should measure
  both rather than assume.
* **How many hops survive** — the relay through the receive worker costs ~0.1–0.2 ms while that
  worker is quiet, and becomes unbounded (0.28–19.5 ms) when it is not; pull adds a `postMessage`
  per frame to the main thread. Measured, not decided: [`thread-hops.md`](thread-hops.md).

## 5 · Out of scope

Any renderer's specifics: the paint sink is an interface and this repository implements the trivial
one. Server work, except the keep-alive M4 needs. Anything about another implementation of the
transport seam.
