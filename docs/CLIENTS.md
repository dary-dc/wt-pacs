# Client transports

| Path | Role |
|------|------|
| `client/transport-wasm/` | Rust WASM via `web_sys::WebTransport` |
| `client/transport-ts/` | TypeScript / browser ESM (`session.ts` + `wire.ts`; `build.sh` → gitignored `dist/`) |

Same Media-complete wire as the server: FoD on one bidi control stream, envelope payloads on server uni streams.

`client/conformance/` runs the surface's clauses against both, in Node with no browser;
`docs/proposal-conformance-suite.md` says how.

## A closed session is noticed at once

A request against a session the server had already closed used to wait the full
`FRAME_TIMEOUT_MS` (15 s) before failing. **Both implementations did this**, not only the WASM one
— the brief for this work named one, and the first thing the conformance harness showed was that
the TypeScript client behaved identically.

It stops being a benchmark annoyance in the product: the session is opened when the user picks a
series and used when the viewer mounts, perhaps minutes later, so a session that died in the gap is
the normal path rather than a corner case.

**The shape.** A session has one piece of new state — the reason it is gone, unset while it is
alive — and two things set it:

* the session object's own `closed`, watched from `connect()`; and
* the media stream ending, which the TS client already noticed and used to report on its own.

Whichever arrives first wins and the other is a no-op, because they are the same event seen twice.
Setting it fails every armed waiter with that reason, so a request in flight wakes at once. A
request arriving *after* it is set fails without arming a waiter at all — that is the product case,
and without it the fix only helps sessions that were already waiting.

`FRAME_TIMEOUT_MS` keeps the job it exists for: a frame that never arrives on a session that is
still alive. That path is untouched and still takes the full 15 s.

**Measured**, on the conformance fake (container, but these are wall-clock gaps of milliseconds
against seconds, not a timing claim):

| | before | after |
| --- | --- | --- |
| request against an already-closed session | 15.01 s | **0.8 ms** |
| request in flight when the close lands | 15.01 s | woken within the test's 30 ms settle |
| frame never arrives, session alive | 15.01 s | 15.01 s, unchanged |

Both arms, same numbers. Four clauses now run against both implementations; three mutants were run
against the new one and all three failed as they should — dropping the `closed` watch, dropping the
fast-fail, and dropping the WASM guard and its waiter clearing — with the control clean.

**Two things this turned up.**

`close()` on the WASM handle took `self` by value, so wasm-bindgen tried to take ownership of a
handle that an in-flight `&self` request still borrowed, and threw *"attempted to take ownership of
Rust value while it was borrowed"*. Closing a session mid-fill is ordinary — the user navigates
away — and the TS client's `close()` does not consume. It now takes `&self`, which is what makes
the two implementations agree.

A cancelled fill still leaves its waiters armed until `FRAME_TIMEOUT_MS`; `endStream()` stops the
server sending but settles nothing on the client. Nothing here fixes that — it needs a decision
about what a cancelled waiter should reject with — and the conformance suite tolerates the stray
rejections rather than pretending they are not there.

## Fills are pushed

A fill used to arm a waiter per frame — a promise or a oneshot channel with its own 15 s timer —
and the consumer collected them one `waitExactFrame` at a time, for frames that arrive in order on
one stream anyway. Both implementations now also offer the fill as a **push**:

```
fillFrames(from, to, onFrame, onError?)   → askMs
```

On the wire it is `stream_frames {from, to}`, a fill the server recites and — this is the point —
**drops the moment an ask arrives** (`docs/transport/ask-during-fill.md`). A `request_frames`
batch is not that: the planner turns it into one `Ask::Frame` per index and serves them in order,
so an ask behind a 200-frame batch waits for all 200. A pushed fill is how an ask gets the wire.

**The shape.** The session keeps one `Fill`: the set still owed, the ask time, and the callback.
Each frame that lands and is owed goes straight to `onFrame` as a `FrameResult`; a frame outside
the fill is dropped and counted in `droppedEarlyMedia`. No waiter, no timer per frame. A frame the
consumer *asks* for while the fill is running keeps its own waiter and wins — it settles the ask's
promise and is not pushed as well. `endStream()` or a later `fillFrames` drops what is still owed,
so a cancelled pushed fill leaves nothing armed to time out later — the stray rejections a
cancelled waiter-per-frame fill leaves behind do not arise here. A refused range is one
`frame_error` at `from`, delivered to `onError`.

**A dead session names what it owed.** `failAll` (Rust: `fail_all`) used to drop the fill on the
floor: every frame still owed went unreported, so a consumer counting frames waited forever on a
session that had already gone. It now reports each still-owed index once through the fill's
`onError`, with the closure's own reason, after the waiters are rejected. First reason wins — the
media stream ending and `closed` settling are the same event twice, and the fill is taken out of
the session before either reports. Conformance: `aDeadSessionNamesWhatItOwed`. What the downloader
does with that report is resume on it, not fail — `client/downloader/README.md` §A session that
dies is resumed; the clause runs against that arm with resumption off, because the claim here is
the transport's.

**What the consumer owns.** A pushed fill cannot time out a frame that never comes; the consumer
that pushed it keeps its own record of what it wants. The downloader does exactly that, and uses
it to re-issue the undelivered remainder as a new fill once an ask has settled
(`docs/proposal-downloader.md` §The downloader).

**Conformance** clause `pushedFill` runs against both implementations and the downloader arm in
both stream modes: every frame lands once, in order, with real timings; nothing is armed; an ask
during the fill is served on its own promise and not pushed; a frame after `endStream()` is dropped.
Mutation-checked on both implementations — §S3 results in `proposal-downloader.md`.

## A truncated frame is a failure

A frame arrives as `[4B BE len][4B BE index][codestream]`, so the stream itself says how long the
frame is. A uni stream that ends before that length has lost the frame, and until 2026-09-22 the
TypeScript reader threw where the pump swallowed it: the frame was neither delivered nor refused,
and a fill simply waited on it forever while the consumer counted the rest as complete.

`readEnvelope` now reads the **index ahead of the codestream**, which is the whole point — a loss
can then be *named*. A stream that ends short reports `truncated: G of D bytes` for that index
through `failWaiter`, the same path a server `frame_error` takes, so an asked frame rejects its
promise and a fill frame reaches `onError`. The reader then stops on that stream: the server's
default `StreamMode::Shared` carries the whole run on one uni, so whatever was behind the lost
frame is gone too, and the downloader's run-wide refusal (`fillHandlers.onError`) is the right
response. In `--stream-mode per-frame` each frame has its own uni and that is one frame too many.
It is **not narrowed**: the mode is a server flag that never reaches the client — nothing in the
handshake or the envelope says which one is in force, and a uni that ends mid-frame looks the same
under both — so the client would have to be told, which is a wire field and a server change for a
mode the measured cells do not use. A reason to prefer the shared mode, not to weaken the report.

**What it does not catch.** A codestream the *server* truncated before framing it declares its own
short length and passes; only its pixels would say, and the per-frame hash oracle is what says
that. A stream cut inside the 4 bytes of the index itself cannot name a frame and is not reported.

**Both clients have it.** The WASM reader used to return `stream ended early` into a loop that
broke, exactly as the TS one did; since 2026-09-22 `read_length_prefixed_frame` returns an
`Envelope` — a frame, a named loss, or a clean end — and `fail_waiter`, the Rust twin of
`failWaiter`, carries the loss to the same two places: the asked frame's promise and the fill's
`onError`. The reason string is the TS one, `truncated: G of D bytes`. Its `pkg/` was rebuilt.
**Both of that client's read paths have it.** The BYOB prototype (`--features byob`, off by
default) reads the head — the length and the index — before the body, returns the same `Envelope`
and carries a named loss through the same `fail_waiter`, so its reason string is the same string.
The clause is answered *by that build*: `WTPACS_WASM_PKG=<a --features byob pkg>
node client/conformance/run.mjs`. `docs/decode/README.md` §The BYOB read path records that run,
and the two ring checks a BYOB read cannot satisfy.

Conformance: `aTruncatedFrameIsAFailure` in `client/conformance/clauses.ts` — both transport
implementations and the downloader arm — and `aTruncatedFrameIsAFailureNotAFrame` in
`dispatch-rig.ts`, which adds the generation the consumer sees. Both drive a fake transport that
ends a stream after a given number of codestream bytes, on a byte stream, as a WebTransport
receive stream is.

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

## ACK frequency, by browser

The server can ask its peer for a smaller `max_ack_delay`
(`--ack-frequency-max-delay-ms`), which is the 25 ms half of the depth-1 tail
([`lanes/T7-tail-and-ack-frequency.md`](lanes/T7-tail-and-ack-frequency.md)). quinn only uses
the extension where the peer advertises `min_ack_delay`, and the frames it sends are counted in
`frame_tx.ack_frequency`, logged as `ack_frequency=` on the `session path` line when a session
ends.

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
