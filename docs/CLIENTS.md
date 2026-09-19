# Client transports

| Path | Role |
|------|------|
| `client/transport-wasm/` | Rust WASM via `web_sys::WebTransport` |
| `client/transport-ts/` | TypeScript / browser ESM (`session.ts` + `wire.ts`; `build.sh` → gitignored `dist/`) |

Same Media-complete wire as the server: FoD on one bidi control stream, envelope payloads on server uni streams.

The TypeScript client keeps an optional ask window (2026-09-14): `connect(url, hash,
{ window: { depth: 4 } })` holds `requestExactFrame` to a fixed depth in ask order, and
`{ depth: "auto", initial: 2 }` re-derives the depth from the link every eight frames —
`D = ceil(0.95 × (1 + RTT / Tf))`, RTT from the browser's `getStats().smoothedRtt`, `Tf` the median
time between arrivals, or from asks sent into an idle window where the browser has no `getStats`
(Chromium 141 has none; two are needed, so a reader that never pauses holds `initial`). Without a window,
`requestExactFrame` is one ask and depth is whatever the caller leaves outstanding, which is
still the WASM client's only shape. Fill is `startStreamFrames` (one `StreamFrames`). The window
ADR is [`adr-client-window-depth.md`](adr-client-window-depth.md); which depth ships is L2's
question ([`lanes/L2-ask-policy.md`](lanes/L2-ask-policy.md)); the rest of the open work is
[`transport/NEXT.md`](transport/NEXT.md).

## What a browser can receive

Measured 2026-09-19 in headless Chromium 141 on loopback, the regime where the browser and not
the wire binds ([`lanes/T12-browser-receive.md`](lanes/T12-browser-receive.md)). Chromium's
network-service IO thread costs 6.6 ms of CPU per MB received at either frame size and runs a
full core through a fill, so ~150 MB/s on that host is the browser's ceiling, and no code in
this repository raises it beyond the 1.4 % a 1 472-byte packet would. The TypeScript client on the main thread costs the
renderer 2.5 ms per MB at 250 KB and 3.9 at 32 KB (~50 µs per frame plus 2.3 ms per MB); that,
not throughput, is all a session off the main thread could move, and on its own it does not
pay (below). A stream per frame costs a
browser a quarter of its throughput at 250 KB and three fifths at 32 KB, and a third more latency
at depth 1; `shared` stays the default. The default reader hands a 250 KB frame over in ~5 reads
and a 32 KB frame in less than one — it coalesces up to 256 KB — so a BYOB read per frame is
fewer reads only for large frames. On the target link none of this binds.

## A fill longer than 15 s fails from the client's side

Arithmetic, not a measurement, recorded 2026-09-19: `startStreamFrames` arms every frame's 15 s
deadline at the ask, so on the 20 Mbps target a fill past ~37 MB (15 s × 2.5 MB/s) times out
frame by frame while the bytes are still arriving, and the late frames count as dropped media
(N6 saw the TS client lose 29/80 in a slowed cell; the WASM client arms its deadline at the
wait). The client branch's pushed fills carry no timer per frame and are the fix; this branch's
`session.ts` is merged there by hand, so the change is not made here twice.

## ACK frequency, by browser

The server can ask its peer for a smaller `max_ack_delay`
(`--ack-frequency-max-delay-ms`), which is the 25 ms half of the depth-1 tail
([`lanes/T7-tail-and-ack-frequency.md`](lanes/T7-tail-and-ack-frequency.md)). quinn only uses
the extension where the peer advertises `min_ack_delay`, and the frames it sends are counted in
`frame_tx.ack_frequency`, logged as `session transport ack_frequency=` when a session ends.

Measured 2026-09-14 on this VM, 32 KB fixture, `ondemand`, three cells:

| peer | `--ack-frequency-max-delay-ms 5` | `ack_frequency` |
| --- | --- | --- |
| quinn (`window-harness`) | yes | **1** |
| quinn (`window-harness`) | no | 0 |
| **headless Chromium 141** | yes | **0** |

The two quinn cells are the controls: the count follows the flag, so the zero against Chromium
is Chromium's and not the wiring. **Headless Chromium 141 does not advertise `min_ack_delay`**,
so nothing this server sets shortens its ACK delay. The rule closes the item on that evidence
unless Chromium 148 differs — it is one run of the same cell on the browser rig, and it is the
only thing T7 still waits on.

## The session in a Worker, on its own, does not pay (2026-09-15)

The survey ranks main-thread contention at 10–50 ms of tail and calls a Worker the highest-
leverage single latency change for a web app ([`lanes/T5-client-worker.md`](lanes/T5-client-worker.md)).
Measured here — headless Chromium 141, loopback, 32 KB frames, `ondemand` depth 4, five repeats
per arm with the arms interleaved and the order reversed every repeat, the session behind
`client/harness/session-worker.js` and frames crossing as transferable buffers:

| main-thread load | arm | median µs/frame | the five runs |
| --- | --- | ---: | --- |
| idle | main thread | 400 | 400 · 400 · 400 · 425 · 525 |
| idle | Worker | 375 | 325 · 325 · 375 · 450 · 650 |
| 50 ms per 100 ms | main thread | **400** | 350 · 375 · 400 · 400 · 450 |
| 50 ms per 100 ms | Worker | **475** | 400 · 400 · 475 · 475 · 500 |

Idle, the arms are inside each other's spread. **Under contention the Worker is 19 % worse**,
which is the opposite of the expected direction and the more interesting half.

The mechanism is that a Worker moves the session's work off the main thread but not the
frames: every one still crosses back by `postMessage` to a page that consumes it, and that
crossing queues behind whatever is making the main thread busy. Removing the reader from the
main thread while leaving the consumer on it moves the queue rather than draining it.

So **"session in a Worker" is not the change worth making on its own.** What could pay is the
shape `docs/client-shape-plan.md` describes on the client branch, where the decode pool sits
beside the session and the page only paints — there the frames never cross to the main thread
at all. This measurement is evidence for that milestone ordering, not against the architecture.

Limits: five repeats, one browser, loopback, a synthetic busy loop, and a page that touches
every frame. The 28.9 ms per frame the browser rig measured for a page accepting a decoded
result is a different regime from this one.
