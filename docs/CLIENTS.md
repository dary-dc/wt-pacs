# Clients

The client contract: one transport surface, the implementations behind it, the suite that holds
them to it, and what every implementation does at the edges. The bytes they speak are
[`WIRE.md`](WIRE.md); what sits above the surface — the downloader, its decoders, the consumer —
is [`ARCHITECTURE.md`](ARCHITECTURE.md).

| Path | What |
| --- | --- |
| `client/transport-ts/` | TypeScript, browser ESM (`build.sh` → gitignored `dist/`). `frame-session.ts` is everything a session does whatever carries its bytes; `session.ts` carries it over WebTransport, `ws-session.ts` over a WebSocket, `race-session.ts` dials both |
| `client/transport-wasm/` | Rust → WASM over `web_sys::WebTransport` (`build.sh` → gitignored `pkg/`; needs `wasm-pack`, `README.md` §Prerequisites) |
| `client/conformance/` | the suite, §The conformance suite |

## The seam

`TransportSession` is one surface with independent implementations behind it. That is what makes
it a seam rather than a coincidence: another transport plugs in without anything above it knowing,
and the downloader takes any module exporting `TransportSession` as `config.transport`
(`client/downloader/README.md`).

| | |
| --- | --- |
| `connect(url, certHash, options?)` | open a session |
| `requestExactFrame(i)` | one frame, the interactive path; a promise per ask |
| `startExactFrames(indices)` / `waitExactFrame(i, askMs)` | ask for a set in one `request_frames`, take them as they land |
| `requestExactFrames(indices)` | the two above, awaited in order |
| `startStreamFrames(waitLast, range?)` | a fill as `stream_frames`, a waiter armed per frame |
| `fillFrames(from, to, onFrame, onError?)` | a fill **pushed** as it lands, no waiter per frame — §Fills are pushed |
| `endStream()` | **stop a running fill without ending the session** |
| `releaseWireBuffer(buffer)` | hand a delivered frame's buffer back to the session's ring ([`decode/README.md`](decode/README.md) §The wire buffer ring) |
| `stats()` / `close()` | `closed`, `inFlight`, `droppedEarlyMedia`, `frameErrors`, `lastByteAt`, … / end the session now |

A `FrameResult` is `{ frameIndex, tier: "exact", codec: "htj2k", bytes, timing: { askMs,
firstChunkMs, lastChunkMs, chunks, serveUs } }`, times in `performance.now()` milliseconds.

**Where the implementations differ**, and the conformance adapters are the only code that knows:
`endStream` is a promise in TypeScript and synchronous in WASM; `startStreamFrames` takes a range
object in TypeScript and two optional arguments in WASM; the WASM handle is exported as
`TransportSessionHandle`. `connect`'s options are TypeScript's alone except `wireBuffers`, which
the WASM `connect` takes as its third argument:

| option | what it does |
| --- | --- |
| `wireBuffers` | the size of the wire buffer ring; unset or 0 keeps none |
| `window` | hold on-demand asks to a depth, fixed or `"auto"` from the link (`ask-window.ts`, [`adr-client-window-depth.md`](adr-client-window-depth.md)) |
| `dialMs` | a dial whose `ready` has not settled by then is closed and rejected with a `DialTimeoutError`. The WASM client has no deadline and waits for ever |
| `fill` | an opening fill carried in the session URL (WIRE.md §The opening ask); armed at once, never sent as `stream_frames` |

**Three clauses the surface requires.** Each cost real time before it was written down.

1. **Worker-safe.** No implementation may reach for `window`. The WASM client read its clock from
   `window.performance`, and every timestamp it produced inside a worker was `0` — zeros, not an
   error.
2. **Cancellable.** `endStream()` stops a fill and the session goes on serving. An implementation
   that can only cancel by closing the session is not conformant.
3. **Transferable results.** A `FrameResult`'s buffer must be transferable, so crossing a worker
   boundary is a move, and no two delivered frames share a backing buffer. Priced 2026-09-16: at
   8 MB a copied frame costs the page's main thread 1.34 s per 237-frame burst, against 17 ms
   transferred.

## The implementations

**Over WebTransport, TypeScript and WASM.** One bidirectional control stream, which the client
opens; media on every unidirectional stream the server opens, each read as a sequence of envelopes,
so every server stream mode is read by the same code. The certificate is pinned by
`serverCertificateHashes`; `congestionControl: "low-latency"` is requested.

**Over a WebSocket, TypeScript** (`ws-session.ts`). The same `FrameSession` over one socket to
`wss://` on the same host and port number; the certificate hash is ignored, since a WebSocket
cannot pin one and the browser's trust store decides. Binary messages are joined into one media
byte stream and read exactly as a shared uni stream is; a text message is a FoD message. There is
no opening ask in the URL: an opening `fill` is sent as the socket's first message. When the
socket closes, the bytes already received are read first, so a frame the close cut short is named
as truncated rather than merely owed.

### The race

`race-session.ts`, opt-in. Dials both at once and keeps whichever session is ready
first; the other is closed when its own dial settles. An opening fill rides neither URL — both
servers would push it — and is sent to the winner alone. If both dials fail, one error names both,
a `DialTimeoutError` if either timed out. Why race rather than detect: ARCHITECTURE.md, TCP
fallback. On loopback the WebSocket wins 57–58 of 60 dials (headless Chromium, debug and release
server, 200 ms apart), where the handshakes' CPU decides; on a link TCP + TLS + upgrade is three
round trips against the QUIC dial's 2.1. **Not measured on a link.**

## The conformance suite

The surface's clauses as tests, run against every implementation. It proves the client half
against a fake: a contract test, not an integration test, and an implementation passing it is
conformant, not proven correct.

**How it runs without a browser.** Every implementation constructs `new WebTransport(...)` or
`new WebSocket(...)` from the **global scope** — TypeScript directly, WASM through `web_sys`, which
emits the same global lookup. A fake installed on `globalThis` therefore drives any of them in
plain Node, with no browser and no server. The fake speaks the wire of `WIRE.md` and belongs to the
suite, not to an implementation. Its media streams are byte streams, as a WebTransport receive
stream is, so a BYOB build runs too: `WTPACS_WASM_PKG=<a --features byob pkg> node
client/conformance/run.mjs`.

| File | What |
| --- | --- |
| `fake-transport.ts`, `fake-websocket.ts` | the global stand-ins, and the frame pushers |
| `clauses.ts` | the clauses, written against a rig any arm can supply |
| `adapters.ts` | one surface; the only place that knows how the implementations differ |
| `ring.ts`, `race.ts` | the wire buffer ring against every session; the race's outcomes |
| `run.ts` → `run.mjs` | Node entry: every implementation, then the race |
| `fake-session.ts`, `worker-fake.ts`, `downloader-rig.ts` | the downloader arm: the fake installed inside the downloader's worker |
| `dispatch-rig.ts` | the downloader's own behaviours against a stalling decoder ([`ARCHITECTURE.md`](ARCHITECTURE.md)) |
| `ask-during-fill.html`, `run_wire.sh` | against the real server |

TypeScript bundled by esbuild, run by `node`, asserting with a counter and a non-zero exit — no
test framework, no dependency. Every clause bounds its waits, so a regression fails its own check
by name rather than taking the process down at `FRAME_TIMEOUT_MS`, and a clause that throws fails
by name while the rest still run.

**The clauses** (`clauses.ts`), each a claim:

| Clause | What it requires |
| --- | --- |
| `workerSafe` | every timestamp is a real reading, `lastChunkMs ≥ askMs` — asserted on the value, so silent zeros fail |
| `cancellable` | `end_stream` goes out, the session is not closed, and a frame asked afterwards is served |
| `transferable` | transferring a frame's buffer detaches it, and does not detach a frame delivered beside it on the same stream |
| `noticesClose` | §A closed session is noticed at once, driven by the stream ending and by `closed` alone |
| `bothStreamModes` | every frame of a run arrives in the order asked, on one stream and on a stream per frame |
| `reportsStats` | `inFlight` counts outstanding asks and returns to zero |
| `oneDialServesLaterAsks` | an ask long after the dial is served without a second dial |
| `redialsAfterClosure` | a session opened after a closure serves again |
| `pushedFill` | §Fills are pushed |
| `aTruncatedFrameIsAFailure` | §A truncated frame is a failure |
| `aDeadSessionNamesWhatItOwed` | a session that dies mid-fill names every frame it still owed, each once |
| `aFrameIsLateOnlyWhenTheSessionGoesQuiet` | a frame whose bytes keep coming for 16 s lands |
| `aSlowFrameHoldsNoOther` | a frame slow on its own stream holds back no frame on another |

`ring.ts` adds, per session implementation: a buffer handed back is read into again, one still
held is not, the free list never exceeds its size, a frame in a larger buffer is a view of its own
length, and a buffer smaller than the frame is dropped rather than grown. `race.ts` has one clause
per outcome — QUIC first, TCP first, QUIC refused (and both refused) — and the opening fill.

**Over a WebSocket, independent delivery is not applicable**, and is reported by name rather than
counted: the per-frame halves of `bothStreamModes` and `pushedFill`, and `aSlowFrameHoldsNoOther`.
A truncated frame does apply — on TCP it is the connection ending inside one.

**The downloader arm.** The downloader dials inside its own worker, out of the test's reach, so
`fake-session.ts` is the module `config.transport` names during a run: it installs the fake inside
that worker and answers the page over a `BroadcastChannel` named in its URL. `run_downloader.sh`
drives the same clauses in headless Chromium. Two read what the arm does from the rig: an ask after
a closure **re-dials and is served** rather than failing, and the dead-session clause runs with
resumption off, since its claim is the transport's. One thing the page cannot see is whether the
worker moved or copied a buffer — a frame posted without a transfer list arrives as a clone that
still detaches — so the clause holds delivered-buffer semantics only.

The fake says `listening` on its channel once it is up, and the page posts nothing before it hears
that. Chromium can drop a message posted to a channel a worker has already constructed: on Chrome
148, 10 of 5 000 pings posted at once were lost without the wait and 0 with it (five rounds each,
interleaved); on Chromium 141 in this container 103 of 5 000 (`lab/early-messages/run.mjs`). No
product code uses a `BroadcastChannel`.

**Against the real server** (`run_wire.sh`). It builds a debug `exact-server` and `pack-study`,
packs 200 random 256 KB frames, makes its own certificate under a temp dir, and serves with a 2 MB
send window and `--websocket`, so a fill is still running when an ask lands and few enough frames
are in flight that its end is observable. Nothing in the tree is touched.

* `client/harness/refusals.html`: 64 out-of-range asks in one `request_frames`, every waiter
  rejected promptly with **the server's own reason** — TS and WASM over WebTransport, TS over the
  WebSocket. Mutant: the TS control pump dropping one `frame_error` reports 63 of 64, 1 timed out.
  *Corrected 2026-09-25:* the page counted any `unavailable` rejection, and a session that died
  makes every waiter `unavailable`, so the WebSocket arm passed 64 of 64 with its refusals sent as
  the wrong message type. It now requires the reason's words; every arm still passes 64 of 64.
* `client/conformance/ask-during-fill.html`: WIRE.md §An ask during a fill, seen from the client,
  raw and through the downloader, over both transports. Raw: the ask is served mid-fill, the fill
  ends — 28 of 120 arrive, then nothing — and the rest arrive only once asked again. Downloader: the
  fill completes without being asked again, no frame twice. Mutants: a planner that keeps the fill
  past an ask (the raw client reports 120 of 120; the downloader survives it) and a downloader that
  never re-issues (28 of 120).

**In the gate** (`scripts/gate.sh`): `run.mjs`, the worker-safe static check
(`client/scripts/check_worker_safe.sh`: no built artifact may contain a `window.` reference), the
downloader and dispatch arms, and `run_wire.sh`. **The WASM arm is required**: `run.mjs` exits 2
without `client/transport-wasm/pkg/` (decided 2026-09-18, over the proposal's "skip the arm
loudly"). The headless steps skip loudly when playwright or Chromium is missing. The suite itself
is not type-checked — it needs `@types/node`, which `client/transport-ts` does not carry; esbuild
still fails on anything malformed.

Every clause was mutated — the implementation broken on purpose, the check watched failing.

## A closed session is noticed at once

A request against a session the server had already closed used to wait the full
`FRAME_TIMEOUT_MS` (15 s), in both implementations. In the product that is the normal path, not a
corner case: the session opens when the user picks a series and is used when the viewer mounts,
perhaps minutes later.

**The shape.** A session holds one piece of state — the reason it is gone, unset while it is alive
— set by whichever arrives first of the session's own `closed` and the media stream ending; they
are the same event seen twice, so the second is a no-op. Setting it fails every armed waiter with
that reason, and a request arriving afterwards fails without arming one.

`FRAME_TIMEOUT_MS` keeps its own job: a frame that never arrives on a session still alive. It is
counted **from the last byte the session delivered, not from the ask** (since 2026-09-24), so the
tail of a burst longer than 15 s is not failed while its bytes still arrive.

Measured on the conformance fake — wall-clock gaps of milliseconds against seconds, not a timing
claim; both implementations, same numbers:

| | before | after |
| --- | --- | --- |
| request against an already-closed session | 15.01 s | **0.8 ms** |
| request in flight when the close lands | 15.01 s | woken within the test's 30 ms settle |
| frame never arrives, session alive | 15.01 s | 15.01 s, unchanged |

`close()` on the WASM handle takes `&self`: taking `self` made wasm-bindgen claim a handle an
in-flight request still borrowed, and closing mid-fill is ordinary.

**Still open:** a cancelled waiter-per-frame fill (`startStreamFrames`) leaves its waiters armed
until `FRAME_TIMEOUT_MS`, because `endStream()` settles nothing on the client; it wants a decision
about what a cancelled waiter rejects with. A pushed fill does not have this problem.

## Fills are pushed

```
fillFrames(from, to, onFrame, onError?)   → askMs
```

On the wire it is `stream_frames {from, to}`, a fill the server recites and **drops the moment an
ask arrives** (WIRE.md §An ask during a fill). A `request_frames` batch is not that: the server
serves it index by index, in order, so an ask behind a 200-frame batch waits for all 200. A pushed
fill is how an ask gets the wire.

**The shape.** The session keeps one fill: the set still owed, the ask time and the callbacks. A
frame that lands and is owed goes straight to `onFrame`; one outside the fill is dropped and
counted in `droppedEarlyMedia`. No waiter and no timer per frame. A frame *asked* during the fill
keeps its own waiter and wins — it settles the ask's promise and is not pushed as well.
`endStream()` or a later `fillFrames` drops what is still owed, leaving nothing armed. A refused
range is one `frame_error` at `from`, delivered to `onError`.

**A dead session names what it owed.** `failAll` (Rust: `fail_all`) reports each index the fill
still owed once, through `onError`, with the closure's reason, after the waiters are rejected.

**What the consumer owns.** A pushed fill cannot time out a frame that never comes; the consumer
keeps its own record of what it wants. The downloader does, and re-issues the undelivered remainder
as a new fill once an ask has settled, and resumes on a dead session's report rather than failing
(`client/downloader/README.md`).

## A truncated frame is a failure

A frame arrives as `[4B BE len][4B BE index][codestream]`, so the stream says how long the frame
is. A stream that ends before that length has lost the frame, and it must be neither delivered nor
silently dropped — a fill would otherwise wait on it for ever while the consumer counted the rest as
complete.

Both clients read the **index ahead of the codestream**, so a loss can be named. A stream that
ends short reports `truncated: G of D bytes` for that index through the refusal path a server
`frame_error` takes: an asked frame rejects its promise, a fill frame reaches `onError`. The reader
then stops on that stream. Under the default `shared` mode that stream carries the whole run, so
whatever was behind the lost frame is gone too and a run-wide response is right; under `pool:k` it
is that stream's share of the run, and under `per-frame` it is one frame. The report is **not
narrowed** by mode: nothing on the wire says which mode is in force, and a stream that ends
mid-frame looks the same under all of them, so narrowing would need a wire field and a server
change.

Both read paths of the WASM client have it — the default and the BYOB prototype
(`--features byob`, off by default) — with the TypeScript reason string byte for byte;
[`decode/README.md`](decode/README.md) §The BYOB read path records the BYOB run.

**What it does not catch.** A codestream the *server* truncated before framing declares its own
short length and passes; only its pixels would say, and the per-frame hash is what says that. A
stream cut inside the 4 bytes of the index cannot name a frame and is not reported.

Conformance: `aTruncatedFrameIsAFailure` — every implementation and the downloader arm — and
`aTruncatedFrameIsAFailureNotAFrame` in `dispatch-rig.ts`, which adds the generation the consumer
sees.

## What a browser can receive

Measured 2026-09-19 in headless Chromium 141 on loopback, the regime where the browser and not the
wire binds (`lab/scripts/browser_receive.py`, `browser_reads.py`). The ceiling is the browser's
network-service thread ([`rig-limits.md`](rig-limits.md) §1): 6.6 ms of CPU per MB at either frame
size, a full core through a fill, ~150 MB/s on that host, and no code here raises it beyond the
1.4 % a 1 472-byte packet would. The TypeScript client on the main thread costs the renderer
2.5 ms per MB at 250 KB and 3.9 at 32 KB (~50 µs per frame plus 2.3 ms per MB) — that, not
throughput, is all a session off the main thread could move. A stream per frame costs the browser
a quarter of its throughput at 250 KB and three fifths at 32 KB, and a third more latency at depth
1; `shared` stays the default. The default reader coalesces up to 256 KB, handing a 250 KB frame
over in ~5 reads and a 32 KB frame in less than one, so a BYOB read per frame is fewer reads only
for large frames. On the target link none of this binds.

## ACK frequency, by browser

The server can ask its peer for a smaller `max_ack_delay` (`--ack-frequency-max-delay-ms`), the
25 ms half of the depth-1 tail. quinn uses the extension only where the peer advertises
`min_ack_delay`; frames sent are logged as `ack_frequency=` on the `session path` line.

Measured 2026-09-14, 32 KB fixture, on-demand, three cells:

| peer | `--ack-frequency-max-delay-ms 5` | `ack_frequency` |
| --- | --- | --- |
| quinn (`window-harness`) | yes | **1** |
| quinn (`window-harness`) | no | 0 |
| **headless Chromium 141** | yes | **0** |

The quinn cells are the controls: the count follows the flag, so the zero is Chromium's. **Headless
Chromium 141 does not advertise `min_ack_delay`**, so nothing this server sets shortens its ACK
delay. Not checked on Chromium 148.

## On WebKit: what the clients rely on, and what happens without it

No WebKit browser runs here. The WebKit column is WebKit's published status as read on 2026-09-19,
**not a measurement**; where nothing was read the cell says *not checked*. The last column is what
the code does, read from the code.

| API | relied on by | WebKit | without it |
| --- | --- | --- | --- |
| `WebTransport` | both WebTransport clients | shipped in Safari 26; a dial can hang with `ready` never settling (bug 319879) | the downloader's `dialMs` ends a hung dial and retries; the TS client does so when given `dialMs`; the WASM client waits for ever |
| `serverCertificateHashes` | both WebTransport clients, the dev setup | not checked | the dial fails; a deployment uses a CA-signed certificate, which the clients do not care about |
| `SharedArrayBuffer`, `crossOriginIsolated` | the downloader's pixel path | not checked | `DownloaderClient.connect` throws *serve the page cross-origin isolated* unless `decode: false` |
| module workers, a worker started from a worker | the downloader and its decoders | not checked | the downloader does not start, and `connect` rejects |
| WebAssembly SIMD128 | the shipped HTJ2K decoder | not checked | the decoder's init fails, and the page is told why (`failed`, index −1) |
| `navigator.connection` `change` | a survival trigger | declined | `navigator.connection?.` makes it a no-op; a network change is noticed only when the bytes stop, after `stallMs` |
| `navigator.deviceMemory` | nothing today | declined | — |
| `freeze` / `resume` (Page Lifecycle) | survival triggers the consumer forwards | not checked; a Chromium API | they never fire; `visibilitychange` and `pageshow` still do |
| Speculation Rules (prerender) | nothing built ([`rig-limits.md`](rig-limits.md) §8) | absent | prerender's saving is Chromium-only |
| OPFS | a planned cache, not built | present; script-written storage deleted after 7 days without interaction, `persist()` no exemption | when built, an OPFS cache must be evictable on WebKit, not a store |
| 2D canvas `alpha: false` | `lab/paint-floor/` only | no effect | the lab's 2D route measures something different on WebKit |
| WebAssembly under Lockdown Mode | the decoder, the WASM client | disabled when introduced; not verified for current iOS | a blank viewer, not a slow one. Needs a device |

The two that bite without a device are the hung dial, which now has its deadline, and
`navigator.connection`, whose absence moves a network change from the radio's event to the byte
silence: `stallMs`, 3 s.
