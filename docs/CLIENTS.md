# Clients

The client contract: one transport surface, the implementations behind it, the suite that holds
them to it, and what every implementation does at the edges. The bytes they speak are
[`WIRE.md`](WIRE.md); what sits above the surface — the downloader, its decoders, the consumer —
is [`ARCHITECTURE.md`](ARCHITECTURE.md).

| Path | What |
| --- | --- |
| `client/transport/ts/` | TypeScript, browser ESM (`build.sh` → gitignored `dist/`). `frame-session.ts` is everything a session does whatever carries its bytes; `session.ts` carries it over WebTransport, `ws-session.ts` over a WebSocket, `race-session.ts` dials both |
| `client/transport/wasm/` | Rust → WASM over `web_sys::WebTransport` (`build.sh` → gitignored `pkg/`; needs `wasm-pack`, `README.md` §Prerequisites) |
| `client/contract/` | the suite, §The contract suite |
| `client/transport/` | beside the transports, the page side (`consumer.js`) and the download worker (`downloader.js`): [`ARCHITECTURE.md`](ARCHITECTURE.md) |
| `client/decode/` | the decode worker, its codec modules and the decoders' WASM builds: [`decode/README.md`](decode/README.md) |
| `client/paint/`, `client/record/`, `client/harness/`, `client/scripts/` | the painter, the telemetry recorder (Tap), the lab's pages, the worker-safe and absence checks: [`../client/README.md`](../client/README.md) |

## The seam

`TransportSession` is one surface with independent implementations behind it. That is what makes
it a seam rather than a coincidence: another transport plugs in without anything above it knowing,
and the downloader takes any module exporting `TransportSession` as `config.transport`
(`client/README.md`).

| | |
| --- | --- |
| `connect(url, certHash, options?)` | open a session |
| `requestExactFrame(i)` | one frame, the interactive path; a promise per ask |
| `fillFrames(from, to, onFrame, onError?)` | a fill **pushed** as it lands, no waiter per frame — §Fills are pushed |
| `endStream()` | **stop a running fill without ending the session** |
| `releaseWireBuffer(buffer)` | hand a delivered frame's buffer back to the session's ring ([`decode/README.md`](decode/README.md) §The wire buffer ring) |
| `stats()` / `close()` | `closed`, `inFlight`, `lastByteAt`, … / end the session now |

A `FrameResult` is `{ frameIndex, bytes, timing: { askMs, lastChunkMs } }`, times in
`performance.now()` milliseconds. *Corrected 2026-10-03:* it also carried `tier`, `codec`,
`firstChunkMs`, `chunks` and `serveUs`, constants nobody read; both clients dropped them, and
`stats()` its `droppedEarlyMedia` and `frameErrors` counters, which nothing read (code:
`git show archive/arms-2026-10-03:client/transport-ts/frame-session.ts`).

**Where the implementations differ:** the WASM handle is exported as `TransportSessionHandle`, and
`session-adapter.js` re-exports it as `TransportSession` once wasm-bindgen's init has run; `readMin` is
TypeScript's alone. Every other option, `onHead` and `stats().mediaReads` are both clients' (since row 265,
2026-10-16; until then `endStream` was synchronous on WASM and its `connect` took `wireBuffers` alone):

| option | what it does |
| --- | --- |
| `wireBuffers` | the size of the wire buffer ring; unset or 0 keeps none |
| `dialMs` | a dial whose `ready` has not settled by then is closed and rejected with a `DialTimeoutError` |
| `fill` | an opening fill carried in the session URL (WIRE.md §The opening ask); armed at once, never sent as `stream_frames` |
| `readMin` | read the media stream through a BYOB reader, opt-in — §Reading a frame whole |

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
`serverCertificateHashes`. No `congestionControl` hint is requested: it shapes only the browser's
send side, which carries only asks, Chrome does not expose it, and it is not measured elsewhere
(the `"low-latency"` request was removed 2026-10-03; code:
`git show archive/arms-2026-10-03:client/transport-ts/session.ts`).

**Over a WebSocket, TypeScript** (`ws-session.ts`). The same `FrameSession` over one socket to
`wss://` on the same host and port number; the certificate hash is ignored, since a WebSocket
cannot pin one and the browser's trust store decides. Binary messages are joined into one media
byte stream and read exactly as a shared uni stream is; a text message is a FoD message. An
opening `fill` rides the upgrade's URL as over WebTransport, armed and never sent. When the socket
closes, the bytes already received are read first, so a frame the close cut short is named
as truncated rather than merely owed.

### The race

`race-session.ts`, opt-in. Dials both at once and keeps whichever session is ready
first; the other is closed when its own dial settles. An opening fill rides the WebSocket's URL
alone, since in both URLs both servers would push it: if QUIC wins it is asked there as
`stream_frames`, and the losing socket's close fails none of its frames. If both dials fail, one
error names both, a `DialTimeoutError` if either timed out. Why race rather than detect, and which
wins on loopback and on a link: [`ARCHITECTURE.md`](ARCHITECTURE.md) §The TCP fallback.

### Choosing the client

The product's page loads one client, the one the transport file's `client` names: `"ts"`, which absent means, or
`"wasm"` (row 277). A deployment sets it with `CLIENT` ([`../deploy/README.md`](../deploy/README.md)), the dev host
in `client/dev-transport.json`, whose `client` `gen_dev_cert.sh` keeps when it renews the file. `viewer/head.js` maps
the name to files on the page's own origin, so a link picks no code, and preloads them once the file arrives: TS's
`dist/session.js`; WASM's adapter, glue and `.wasm`. A name it does not know stops the page, by name on the status
line, before any client's code is fetched or anything dialled; a client that fails to load fails the start, with no
fallback to the other. The status line names the client, and the page check runs on each (`--client`).

*Not measured:* the TypeScript preload now starts once the transport file has arrived, not as the page is parsed
(on page-open's page, the first frame came 1.16 round trips later without it), and the viewer reads the file before it starts the
downloader (the head start that saves measured −0.06 round trips, inside the noise:
[`../lab/page-open/README.md`](../lab/page-open/README.md) §The first byte on a fill). Row 5 below measures the page
on each client.

## The contract suite

The surface's clauses as tests, run against every implementation. It proves the client half
against a fake: a contract test, not an integration test, and an implementation passing it is
conformant, not proven correct.

**How it runs without a browser.** Every implementation constructs `new WebTransport(...)` or
`new WebSocket(...)` from the **global scope** — TypeScript directly, WASM through `web_sys`, which
emits the same global lookup. A fake installed on `globalThis` therefore drives any of them in
plain Node, with no browser and no server. The fake speaks the wire of `WIRE.md` and belongs to the
suite, not to an implementation. Its media streams are byte streams, as a WebTransport receive
stream is, so a TypeScript BYOB reader (`readMin`) runs on it too. `WTPACS_WASM_PKG=<pkg> node
client/contract/run.mjs` runs the suite on another build of the WASM client.

| File | What |
| --- | --- |
| `fake-transport.ts`, `fake-websocket.ts` | the global stand-ins, and the frame pushers |
| `clauses.ts` | the clauses, written against a rig any client can supply |
| `adapters.ts` | one surface; the only place that knows how the implementations differ |
| `ring.ts`, `race.ts` | the wire buffer ring against every session; the race's outcomes |
| `run.ts` → `run.mjs` | Node entry: every implementation, then the race |
| `fake-session.ts`, `worker-fake.ts`, `downloader-rig.ts` | the downloader rig: the fake installed inside the downloader's worker, under either client |
| `dispatch-rig.ts` | the downloader's own behaviours against a stalling decoder ([`ARCHITECTURE.md`](ARCHITECTURE.md)); its transport clauses under either client |
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
| `endStreamIsAPromise` | `endStream()` returns a promise, so the downloader's `.catch` on it cannot throw |
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

**Five more are a session's own** (`runSessionClauses`), the surface its `connect` and reader offer, which the
downloader's rig cannot reach: `onHeadRunsBeforeTheBody` (an asked frame's `onHead` runs once, ahead of its body),
`aDialThatNeverSettlesIsClosedAtItsDeadline` (rejected at `dialMs` as a `DialTimeoutError`, the dial closed),
`anOpeningFillRidesTheUrl` (`?ask=fill:a-b`, armed, every frame to `onFrame`, nothing asked on control),
`anEmptyHashDialsUnpinned` (no `serverCertificateHashes` without a hash, one with) and
`mediaReadsCountsTheMediaReads` (a read per media chunk). They were the TypeScript unit tests' until row 265;
`onHead` under `readMin` stays there.

`ring.ts` adds, per session implementation: a buffer handed back is read into again, one still
held is not, the free list never exceeds its size, a frame in a larger buffer is a view of its own
length, and a buffer smaller than the frame is dropped rather than grown. `race.ts` has one clause
per outcome — QUIC first, TCP first, QUIC refused (and both refused) — and the opening fill.

**Over a WebSocket, independent delivery is not applicable**, and is reported by name rather than
counted: the per-frame halves of `bothStreamModes` and `pushedFill`, and `aSlowFrameHoldsNoOther`; and
`anEmptyHashDialsUnpinned`, since a WebSocket cannot pin.
A truncated frame does apply — on TCP it is the connection ending inside one.

**The downloader rig.** The downloader dials inside its own worker, out of the test's reach, so
`fake-session.ts` is the module `config.transport` names during a run: it installs the fake inside
that worker and answers the page over a `BroadcastChannel` named in its URL, which also names the
client it exports, TypeScript or, with `client=wasm`, WASM. `run_browser.sh` drives the same clauses in
headless Chromium, through the downloader over each client (`downloader`, `downloader-wasm`). The dispatch
rig runs whole on TypeScript and its 35 transport clauses — the wire, the dials, survival, cancel — on
WASM too (`dispatch-wasm`); the other 45 are the decoders' and the downloader's own, whichever client
carried the bytes. Two read what the client does from the rig: an ask after
a closure **re-dials and is served** rather than failing, and the dead-session clause runs with
resumption off, since its claim is the transport's. One thing the page cannot see is whether the
worker moved or copied a buffer — a frame posted without a transfer list arrives as a clone that
still detaches — so the clause holds delivered-buffer semantics only.

`run_browser.sh` drives two pages at a time, the longest first, so the dispatch rig shares the host with one other
page as it did before the WASM rigs. With all four at once on one core (2026-10-16), `aFrameLostTwiceFailsByName`
failed in both runs: frame 2 reached the page and then failed with the decoder that crashed on frame 1, its ack not
yet back, and frame 3 was neither within the clause's 4 s. Two at a time it passed in both runs. *Corrected
2026-10-16 (row 275):* "not fixed here" — the page now drops a failure of a frame it has
([`ARCHITECTURE.md`](ARCHITECTURE.md) §The downloader). Frame 3 was not lost: the clause waits for four answers, and
frame 2's two met the count before frame 3's came.

The fake says `listening` on its channel once it is up, and the page posts nothing before it hears
that. Chromium can drop a message posted to a channel a worker has already constructed: on Chrome
148, 10 of 5 000 pings posted at once were lost without the wait and 0 with it (five rounds each,
interleaved); on Chromium 141 in this container 103 of 5 000 (`lab/early-messages/run.mjs`). No
product code uses a `BroadcastChannel`.

**Against the real server** (`run_wire.sh`). It builds a debug `series-server` and `pack-series`,
packs 200 random 256 KB frames, makes its own certificate under a temp dir, and serves with a 2 MB
send window and `--websocket`, so a fill is still running when an ask lands and few enough frames
are in flight that its end is observable. Nothing in the tree is touched.

* `client/contract/refusals.html`: 64 out-of-range asks in flight at once, every waiter
  rejected promptly with **the server's own reason** — TS and WASM over WebTransport, TS over the
  WebSocket. Mutant: the TS control pump dropping one `frame_error` reports 63 of 64, 1 timed out.
  *Corrected 2026-09-25:* the page counted any `unavailable` rejection, and a session that died
  makes every waiter `unavailable`, so the WebSocket client passed 64 of 64 with its refusals sent as
  the wrong message type. It now requires the reason's words; every client still passes 64 of 64.
* `client/contract/ask-during-fill.html`: WIRE.md §An ask during a fill, seen from the client,
  raw and through the downloader, over both transports and both WebTransport clients. Raw: the ask is served mid-fill, the fill
  ends — 28 of 120 arrive, then nothing — and the rest arrive only once asked again. Downloader: the
  fill completes without being asked again, no frame twice. Mutants: a planner that keeps the fill
  past an ask (the raw client reports 120 of 120; the downloader survives it) and a downloader that
  never re-issues (28 of 120).

**In the gate** (`scripts/gate.sh`): `run.mjs`, the worker-safe static check
(`client/scripts/check_worker_safe.sh`: no built artifact may contain a `window.` reference), the
downloader and dispatch rigs on each client, and `run_wire.sh`. **The WASM client is required**: `run.mjs` exits 2
without `client/transport/wasm/pkg/` (decided 2026-09-18, over the proposal's "skip the variant
loudly"). The headless steps are required too: the gate exits 2 with the install command when
playwright, Chromium or the decoder vendor is missing (decided 2026-10-03; it was "skip loudly"
until then, and a gate without a browser passed none of the browser checks);
`scripts/gate.sh --no-browser` skips them and says so in its last line. The suite and the
transport-ts tests are type-checked (`client/contract/tsconfig.json`).

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

Measured on the contract fake — wall-clock gaps of milliseconds against seconds, not a timing
claim; both implementations, same numbers:

| | before | after |
| --- | --- | --- |
| request against an already-closed session | 15.01 s | **0.8 ms** |
| request in flight when the close lands | 15.01 s | woken within the test's 30 ms settle |
| frame never arrives, session alive | 15.01 s | 15.01 s, unchanged |

`close()` on the WASM handle takes `&self`: taking `self` made wasm-bindgen claim a handle an
in-flight request still borrowed, and closing mid-fill is ordinary.

A cancelled waiter-per-frame fill used to leave its waiters armed until `FRAME_TIMEOUT_MS`; that fill
was removed on 2026-10-03, and a pushed fill has no waiters to leave.

## Fills are pushed

```
fillFrames(from, to, onFrame, onError?)   → askMs
```

On the wire it is `stream_frames {from, to}`, a fill the server recites and **drops the moment an
ask arrives** (WIRE.md §An ask during a fill). A `request_frames` batch, which left the wire on 2026-10-03
(a group is G pipelined `request_frame`s, WIRE.md), was not that: the server served it index by index, in order, so an
ask behind a 200-frame batch waited for all 200. A pushed fill is how an ask gets the wire.

**The shape.** The session keeps one fill: the set still owed, the ask time and the callbacks. A
frame that lands and is owed goes straight to `onFrame`; one outside the fill is dropped. No waiter and no timer per frame. A frame *asked* during the fill
keeps its own waiter and wins — it settles the ask's promise and is not pushed as well.
`endStream()` or a later `fillFrames` drops what is still owed, leaving nothing armed. A refused
range is one `frame_error` at `from`, delivered to `onError`; the downloader fails the whole run on it
except a frame an ask carries, which settles on its own promise.

**A dead session names what it owed.** `failAll` (Rust: `fail_all`) reports each index the fill
still owed once, through `onError`, with the closure's reason, after the waiters are rejected.

**What the consumer owns.** A pushed fill cannot time out a frame that never comes; the consumer
keeps its own record of what it wants. The downloader does, and re-issues the undelivered remainder
as a new fill once an ask has settled, and resumes on a dead session's report rather than failing
(`client/README.md`).

## A truncated frame is a failure

A frame arrives as `[4B BE len][4B BE index][codestream]`, so the stream says how long the frame
is. A stream that ends before that length has lost the frame, and it must be neither delivered nor
silently dropped — a fill would otherwise wait on it for ever while the consumer counted the rest as
complete.

Both clients read the **index ahead of the codestream**, so a loss can be named. A stream that
ends short reports `truncated: G of D bytes` for that index through the refusal path a server
`frame_error` takes: an asked frame rejects its promise, a fill frame reaches `onError`. The reader
then stops on that stream. Under the default `shared` mode that stream carries the whole run, so
whatever was behind the lost frame is gone too and a run-wide response is right; under `per-frame` it is one frame. The report is **not
narrowed** by mode: nothing on the wire says which mode is in force, and a stream that ends
mid-frame looks the same under all of them, so narrowing would need a wire field and a server
change.

The WASM client has it with the TypeScript reason string byte for byte. Its BYOB prototype is
retired (code in history at `6e9c126`); [`decode/README.md`](decode/README.md) §The BYOB read path
records the run.

**What it does not catch.** A codestream the *server* truncated before framing declares its own
short length and passes; only its pixels would say, and the per-frame hash is what says that. A
stream cut inside the 4 bytes of the index cannot name a frame and is not reported.

Contract: `aTruncatedFrameIsAFailure` — every implementation and the downloader rig — and
`aTruncatedFrameIsAFailureNotAFrame` in `dispatch-rig.ts`, which adds the generation the consumer
sees.

## What a browser can receive

Measured 2026-09-19 in headless Chromium 141 on loopback, the regime where the browser and not the
wire binds (`lab/scripts/browser_receive.py`, `browser_reads.py`). The ceiling is the browser's
network-service thread ([`rig-limits.md`](rig-limits.md) §1): 6.6 ms of CPU per MB at either frame
size, a full core through a fill, ~150 MB/s on that host, and no code here raises it beyond the
1.4 % a 1 472-byte packet would. The TypeScript client on the main thread (the harness's page path, removed 2026-10-03) costs the renderer
2.5 ms per MB at 250 KB and 3.9 at 32 KB (~50 µs per frame plus 2.3 ms per MB) — that, not
throughput, is all a session off the main thread could move. A stream per frame costs the browser
a quarter of its throughput at 250 KB and three fifths at 32 KB, and a third more latency at depth
1; `shared` stays the default. The default reader coalesces up to 256 KB, handing a 250 KB frame
over in ~5 reads and a 32 KB frame in less than one, so a BYOB read per frame is fewer reads only
for large frames. On the target link none of this binds.

## Reading a frame whole

`ConnectOptions.readMin` (the downloader's `readMin`) reads the media stream through a BYOB reader,
`read(view, {min})`, each frame straight into its wire buffer, a read resolving at no fewer than
`readMin` bytes or the frame's rest; unset, the default reader and its copy. WebTransport only. A
stream that is not a byte stream is read the default way (`readMinWithoutByobFallsBack`). A cut
stream's last read resolves done with the bytes it holds, so the frame is still named truncated with
its count (`aCutFrameIsNamedWithItsBytes`).

**Bound on K.** Each read moves `lastByteAt`, which the downloader's stall watch reads, so a read
must resolve inside `stallMs` (3 s) at the slowest rate a session should survive, and across an
outage inside what the outage leaves: **K ≤ rate × (`stallMs` − outage − QUIC's recovery after
it).** Measured (RMD, 2026-10-02, `lab/downloader-cost/reads.mjs`, 2 s outages every 8 s, 6
rounds, self-timed): at 0.5 Mbit/s while up, 16 KB kept every session the default reader keeps; 32 KB
(0.52 s a read) was re-dialled in 1 of 6 visits, 64 KB and a whole frame in all of them, each re-dial
costing the fill seconds. **16 KB is the largest K inside the bound.** At 1 Mbit/s only the whole
frame failed. Bit-exact in every visit.

**What it buys.** A whole-frame read on a 40 Mbit trace (BYM, 2026-10-01) took a quarter to a third
off the downloader thread's CPU (~34 µs a read saved) and ~40 MB off the renderer's peak, the clock
not moving because the link binds — but a whole frame is outside the bound. At 16 KB on that link
(RMD, 15 rounds, Williams-ordered, `VOID` visits dropped; paired leads on the default reader): the
downloader's CPU **−105 ms at 1× and −90 at 4×** a fill and the renderer's peak **−37 MB**, every
round; the fill ties (−5 / +3 ms).

**Off by default, and an open owner decision** (§Open). Frame 0 does not lean: on the workstation (RMD4, 2026-10-03; Chrome 148, `KS=0,16384,32768
DECODE=1`, 24 rounds at 4× and 12 at 1×, Williams-ordered, self-timed, 3 of 108 visits `VOID`, every
frame bit-exact), paired leads on the default reader, wins/rounds:

| | 16 KB | 32 KB |
| --- | --: | --: |
| frame 0, 4× | **−4.0 (14/23)**, IQR −12.8…+7.8 | −5.3 (16/22) |
| frame 0, 1× | +2.6 (2/11) | +8.4 (2/12) |
| downloader CPU, 4× / 1× | −97 (23/23) / −104 (10/11) | −114 (22/22) / −43 (9/12) |
| renderer peak | −38 MB (all) | −39 / −38 (all) |

The container's +12 ms (4/11) does not reproduce. **What holds it back is liveness:** as the default,
two dispatch clauses fail. A session whose bytes come slower than 16 KB per `stallMs` (< 44 kbit/s)
is re-dialled, since a read with `min` resolves only at `min` bytes (the bound above, made a default) — the
owner's trade against −97 ms and −38 MB a fill. And a cut whose end is already queued when the read is
made errors the stream (a pull-into it cannot fill), which is taken for a stream end, so the frame is
not named — **a defect of the `readMin` path, to fix before any default**. The BYOB read's ~12 ms frame 0 (cloud
queue row 5) is the WASM client's retired path ([`decode/README.md`](decode/README.md) §The BYOB read path).

## ACK frequency, by browser

The server could ask its peer for a smaller `max_ack_delay` (`--ack-frequency-max-delay-ms`), the
25 ms half of the depth-1 tail. quinn uses the extension only where the peer advertises
`min_ack_delay`; frames sent were logged as `ack_frequency=` on the `session path` line. The flag
and the log field were removed 2026-10-03 as having no browser to act on; code:
`git show archive/arms-2026-10-03:server/src/transport/tuning.rs`.

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
| `WebTransport` | both WebTransport clients | shipped in Safari and iOS 26.4 (MDN browser-compat-data `api.WebTransport`, read 2026-10-02; *corrected from "26"*); a dial can hang with `ready` never settling (bug 319879); flow control never refills, so a session stalls after 16 MB (bug 319818, [`ARCHITECTURE.md`](ARCHITECTURE.md) §Recycling before the stall) | the downloader's `dialMs` ends a hung dial and retries; both clients do so when given `dialMs` (the WASM one since row 265) |
| `serverCertificateHashes` | both WebTransport clients, the dev setup | not checked | the dial fails; a deployment uses a CA-signed certificate, which the clients do not care about |
| `SharedArrayBuffer`, `crossOriginIsolated` | the downloader's pixel path | not checked | `DownloaderClient.connect` throws *serve the page cross-origin isolated* unless `decode: false` |
| module workers, a worker started from a worker | the downloader and its decoders | not checked | the downloader does not start, and `connect` rejects |
| WebAssembly SIMD128 | the shipped HTJ2K decoder | not checked | the decoder's init fails, and the page is told why (`failed`, index −1) |
| `navigator.connection` `change` | a survival trigger | declined | `navigator.connection?.` makes it a no-op; a network change is noticed only when the bytes stop, after `stallMs` |
| `navigator.deviceMemory` | nothing today | declined | — |
| `freeze` / `resume` (Page Lifecycle) | survival triggers the consumer forwards | not checked; a Chromium API | they never fire; `visibilitychange` and `pageshow` still do |
| Speculation Rules (prerender) | nothing built ([`rig-limits.md`](rig-limits.md) §8) | absent | prerender's saving is Chromium-only |
| OPFS | a planned cache, not built | present; script-written storage deleted after 7 days without interaction, `persist()` no exemption (*qualified 2026-10-11:* the source's default window is 30 operating days, 7 for a domain flagged by link decoration; shipping Safari not traced, [`adr/frame-path.md`](adr/frame-path.md) §4) | when built, an OPFS cache must be evictable on WebKit, not a store |
| 2D canvas `alpha: false` | `lab/paint-floor/` only | no effect | the lab's 2D route measures something different on WebKit |
| WebAssembly under Lockdown Mode | the decoder, the WASM client | disabled when introduced; not verified for current iOS | a blank viewer, not a slow one. Needs a device |

The two that bite without a device are the hung dial, which now has its deadline, and
`navigator.connection`, whose absence moves a network change from the radio's event to the byte
silence: `stallMs`, 3 s.

## Proposed: the WASM client and the dav1d tooling to `lab/` (rejected)

*Proposed 2026-10-14 (queue row 228, WASMTOLAB; [`merge-readiness.md`](merge-readiness.md) D9 and P6). Nothing moves
before the owner's yes.*

**Rejected 2026-10-16 for the WASM client, by the owner:** "'the Rust-compiled WASM one is loaded only by the lab
harness.' this is the problem. We want two product clients." The *Why* below is true of the tree and is now a gap to
close, not a reason to move: [§Proposed: the WASM client as a second product client](#proposed-the-wasm-client-as-a-second-product-client).
**The tooling's half rejected the same day:** "the wasm client along with everything it needs, including decoders and
build tools, is considered another product path. We keep them." The rest is kept as written.

**Why.** The product never loads the WASM client: the downloader imports `client/transport/ts/dist/session.js` unless
told otherwise, and the only page that names the WASM one is the lab's harness (`client/harness/shell.js`,
`transport=wasm`). Yet it is a member of the root workspace, the gate refuses to start without its `pkg/`
(`require_transport_wasm`), and README §Prerequisites asks every developer for the `wasm32-unknown-unknown` target,
`wasm-pack` 0.15.0 built by `cargo install`, and the binaryen `wasm-opt` its build fetches. `client/decode/wasm/dav1d/`
is the lab's dav1d build: its `build.sh` writes to `lab/.av1-build`, 45 lab files name it, and the decoder
the page loads is built by `client/decode/wasm/build/` from one file of it, `dav1d_wrap.c`.

**What moves where.**

| today | to | lines |
| --- | --- | --: |
| `client/transport/wasm/`: the crate, `build.sh`, `session-adapter.js` | lab/other-clients/wasm/, outside the root workspace with its own `Cargo.lock`, as `lab/other-clients/h3/` is; its path dependencies on `common/fod` and `common/frame-envelope` kept | 832 |
| `client/decode/wasm/dav1d/` but the wrapper: `build.sh`, `make_streams.sh`, `make_client_frames.sh`, `exact.mjs`, `dav1d.mjs`, the three plane scripts, `README.md` | lab/av1/dav1d-wasm/, still building into `lab/.av1-build` | 556 |
| `client/decode/wasm/dav1d/dav1d_wrap.c` | stays: the page's decoder build compiles it and the gate's staleness check names it | 77 |

`make_client_frames.sh` writes product fixtures (`client/contract/av1/`) from the lab's build and venv, as
`lab/av1/delivery/scalable/client/make_frames.sh` already writes `scalable/`; [`FIXTURES.md`](FIXTURES.md) names its
new place.

**What the product and the gate stop needing.**

* README §Prerequisites: the `wasm32-unknown-unknown` target, `wasm-pack`, and Quick start's
  `client/transport/wasm/build.sh` with its binaryen `version_117` fetch.
* The gate: `require_transport_wasm` (also in `scripts/cellcheck.sh`), `run.mjs`'s exit 2 without `pkg/`, the WASM
  halves of `client/scripts/check_worker_safe.sh` and `client/scripts/check_telemetry_absent.sh`, and
  `run_wire.sh`'s `refusals.html?client=wasm` cell.
* The root workspace: the member and 10 of `Cargo.lock`'s 240 packages (`transport-wasm`, `web-sys`,
  `wasm-bindgen-futures`, `gloo-timers`, `console_error_panic_hook`, `futures` and four of its parts; measured with
  `cargo update -w --offline` at `ba408823`), and the two `COPY` lines that put the crate in `deploy/Containerfile` and
  `lab/container-bench/Containerfile.dockerread` only because a workspace member must be present.
* Row CIGATE's workflow: wasm-pack and its build.

**What stays.**

* The seam: `config.transport` takes any module exporting `TransportSession`, and the harness's `transport=wasm`
  loads the adapter from its new place.
* The contract suite's WASM adapter (`adapters.ts`): `WTPACS_WASM_PKG=<pkg> node client/contract/run.mjs` runs every
  clause on the moved client, as it runs a feature build today. Without the variable, `run.mjs` runs the TypeScript
  sessions and the race and says the WASM client was not run. `refusals.html?client=wasm` stays for a lab wire run.
* Every lab harness that dials it (`lab/page-open`, `lab/dial-deadline`, `lab/scripts/downloader_both_clients.sh`,
  `lab/scripts/verify_e2e.py`, `lab/telemetry-cost`) and every dav1d-WASM run, their paths rewritten; the recorder's
  `transport-wasm` label; `lab/av1/delivery/scalable/two-layer/dav1d_wrap_op.c` including the wrapper where it is.

**What it costs, for the owner to weigh.** It reverses the 2026-09-18 decision in §The contract suite ("The WASM
client is required"). Today the gate holds two independently written WebTransport clients to the clauses. After the
move it holds the TypeScript sessions, and `session.ts` and `ws-session.ts` share `frame-session.ts`, so no clause is
checked against a second reading of the wire. The worker-safe clause came from that second reading (§The seam). A
change to the wire or the suite that breaks the WASM client would be seen only when the lab runs it.

**The move, once agreed:** a review row on its own branch. Both trees `git mv`ed. The files that name either path rewritten (`git grep -l`
at `ba408823`: for the client, 3 at the root, 7 in `client/`, 1 in `deploy/`, 10 in `lab/` and 6 in `docs/`; for the
dav1d tooling, 4 in `client/`, 1 in `ingest/`, 45 in `lab/` and 6 in `docs/`, those naming only the wrapper
unchanged). This document's WASM paragraphs cut to a pointer. Proven by the gate
green with the same skips or fewer, and one suite run through `WTPACS_WASM_PKG` showing every clause still passing on
the moved client. Rows 222 and 223 change the workspace's members and the image's `COPY` lines; the move starts from
whatever of theirs has landed.

## Proposed: the WASM client as a second product client

*Proposed 2026-10-16 (queue row 263, WASMPRODUCT), on the owner's ruling above. Docs only; read from the code at
`a9fd5bd6`. Nothing is built before the owner's yes.*

**What "product client" means here.** Three things, each checkable.

1. **The product selects it, by configuration.** A `client` field, `"ts"` or `"wasm"`, in the transport file the page
   already fetches (`/wt/dev-transport.json`); absent is `"ts"`. The page maps the name to one of two modules on its
   own origin, so a link still picks no code ([`merge-readiness.md`](merge-readiness.md) B1). *Not by capability:* both
   need `WebTransport`, and what only the WASM one needs, WebAssembly, the decoders need too (§On WebKit, Lockdown
   Mode), so no browser the page serves tells them apart. *Not by fallback:* a WASM client that failed to load would
   hide behind the TS one, which is what the checks below exist to see; a failed load fails the start by name (index
   −1), as a decoder's does. The owner may want the fallback anyway: ~5 lines, at that cost.
2. **The image ships it and the page loads it** as it does the TS client: built in the image, preloaded once the
   transport file names it, served under the same headers.
3. **Every product check runs on both, or names why not**, as the WebSocket's inapplicable clauses are: the session
   clauses and refusals (both today), the downloader and dispatch rigs, the ask during a fill and the viewer's page
   check (TS alone today). Exactness is the decoder's per-frame check whichever client carried the bytes; the page
   check on each client proves it end to end.

**What each is for**, from what `docs/` holds.

* **TypeScript, the default:** 4.1 KB gzipped against 110 KB (W10), the whole surface (the WebSocket, the race,
  `readMin`), and a hand reading of `WIRE.md` (`client/transport/ts/wire.ts`).
* **WASM, the server's wire code in the browser:** it parses with the server's own crates, `common/fod` and
  `common/frame-envelope`, so a wire change the server compiles with, it compiles with. In the product it is the second
  client a deployment switches to with one field and a restart, no new image, when a browser release or a regression
  breaks the first.
* **Two, because two readings found what one missed:** the worker-safe clock (§The seam), and N6's batch timeout armed
  at a different point, 29 of 80 frames lost in TS and none in WASM ([`rig-limits.md`](rig-limits.md) §10).
* **No measurement favours the WASM client for a user:** the fill is a tie (120 and 125 ms, [`ARCHITECTURE.md`](ARCHITECTURE.md)
  §Capabilities); its per-frame cost at the boundary is fixed (N6, stale); its telemetry costs about twice TS's a frame
  ([`adr/telemetry-instrument-clients-from-outside.md`](adr/telemetry-instrument-clients-from-outside.md)). TS stays the
  default, and a default that picks WASM on some device or engine waits for a measurement that finds a win there.

**What is missing.** Lines are estimates; *structural* as `CLAUDE.md` means it.

| # | gap | where | lines | structural |
| --- | --- | --- | --: | --- |
| W1 | *Closed by row 277.* **The page cannot select it.** The transport file carries `wt_url` and `cert_sha256` alone; the downloader defaults to the TS module | `deploy/server-start.sh:19`; `server/scripts/gen_dev_cert.sh:35-40`; `client/viewer/viewer.js:21,127`; `client/transport/downloader.js:7,466` | ~+10 | **yes**: a product setting, and a second path the page loads |
| W2 | *Closed by row 277.* **Nothing preloads it.** The page preloads `ts/dist/session.js`; the WASM client is three fetches in series inside the downloader's worker (adapter, glue, `.wasm`), each found only once the one before runs | `client/viewer/index.html:14`; `client/viewer/head.js:15-24`; `client/transport/wasm/session-adapter.js:6` | ~+5 | no |
| W3 | **The image does not carry it.** `web-files.sh` copies no `transport/wasm/`, the bundles stage builds TS alone, and `check_equivalence.sh` asserts neither its files nor `application/wasm` | `deploy/web-files.sh:9-14`; `deploy/Containerfile:50-59,66`; `deploy/check_equivalence.sh:62-68` | ~+20 | **yes**: the image gains a wasm32 stage (the target, `wasm-pack` 0.15.0, binaryen `version_117` by checksum, as `build.sh` and CI fetch them) |
| W4 | *Closed by row 265.* **`refill: "head"`, the default, never fires.** The downloader passes `onHead` as `requestExactFrame`'s second argument; the WASM binding takes one, and its reader reads a frame's head and body in one `read_exact`. The hold is released in `finally`, the trigger row 229 replaced; its 10 % fill gained up to 256 ms on the head ([`transport/link-conditions.md`](transport/link-conditions.md), *ASKTHENFILL*) | `client/transport/downloader.js:233,245,254`; `client/transport/wasm/src/lib.rs:51-52`; `client/transport/wasm/src/session.rs:192-197` | ~+20 | no |
| W5 | *Closed by row 265.* **No dial deadline.** `dialMs` is ignored, so a dial that never settles (WebKit bug 319879, `--hold-sessions`) holds the downloader for ever: `firstDial` retries only a `DialTimeoutError`, `resume` awaits the dial. TS fails at 29.1 s, naming it ([`ARCHITECTURE.md`](ARCHITECTURE.md) §A dial that never settles) | `client/transport/downloader.js:365,469,514`; `client/transport/wasm/src/session.rs:376-395` | ~+15 | no |
| W6 | *Closed by row 265.* **`endStream()` is synchronous**, and the downloader calls `.catch` on it after a cancel lands during a dial that carried an opening fill: on WASM a `TypeError` out of `connect()`, and on the first dial the start fails. Read from the code, not run; *corrected 2026-10-16:* run at the session — `endStreamIsAPromise` on the WASM build of `4406acd2` failed with `Cannot read properties of undefined (reading 'catch')`; through the downloader it is row 2's; `dispatch-rig.ts`'s *cancel during a resume* drives that line | `client/transport/downloader.js:496`; `client/transport/wasm/src/lib.rs:82-85`; `client/contract/dispatch-rig.ts:1866-1885` | ~±2, an `async fn` | no |
| W7 | *Closed by row 265.* **No opening ask.** The adapter asks the opening fill on the control stream once the session is up: the round trip the URL saves TS, −1.06 to −1.52 round trips to a fill's first frame ([`ARCHITECTURE.md`](ARCHITECTURE.md) §The opening ask) | `client/transport/wasm/session-adapter.js:14-17`; `client/transport/wasm/src/session.rs:376-395` | ~+20 | no |
| W8 | *Closed by row 265.* **It always pins.** An empty `cert_sha256` becomes an empty hash, so it cannot dial a deployment with a CA-signed certificate (`server-start.sh`'s `/supplied`; [`devices.md`](devices.md) §4, "the WASM one still pins") | `client/transport/wasm/src/session.rs:381-389`, against `client/transport/ts/session.ts:36` | ~+3 | no |
| W9 | *Closed by row 265.* **No `mediaReads` in `stats()`**: the downloader stamps it on each frame, a stamp, not a decision | `client/transport/downloader.js:202`; `client/transport/wasm/src/session.rs:591-598` | ~+3 | no |
| W10 | **26.5× the transport's bytes:** `transport_wasm_bg.wasm` 240 066 B and `transport_wasm.js` 32 166 B, 103 499 and 6 464 gzipped (`gzip -6`), against `dist/session.js` 13 401 and 4 149. Counted 2026-10-16 on a build of sources unchanged since 2026-10-09; the default `console_error` panic hook is in it, its share not counted | `client/transport/wasm/Cargo.toml:33-37` | 0 | no |
| W11 | **Its load on the product page is not measured.** R2 (2026-09-19) found the cold session a tie once each client was preloaded, 6.72 against 6.64 round trips, on the harness's page path, removed 2026-10-03; the compile of 240 KB and the linear memory's peak (the receive buffer holds a whole frame) are not measured | [`../lab/page-open/README.md`](../lab/page-open/README.md) §The count, before and after | — | no |
| W12 | **Never run outside Chromium.** The Firefox runs (`run_firefox.sh`, the page check's `--engine firefox`) load TS alone; no WebKit runs here. Both dial the same global `WebTransport`, so what differs is the engine's WebAssembly | `client/contract/run_firefox.sh:14`; `client/viewer/check.mjs:5` | ~+2 | no |
| W13 | *Closed by rows 274 and 277.* **The rigs and the page check load TS alone**: `fake-session.ts` re-exports the TS session, `ask-during-fill.html` knows `ts`, `ws` and the downloader over each, the page check serves a transport file without `client` | `client/contract/fake-session.ts:9`; `client/contract/run_browser.sh:11`; `client/contract/ask-during-fill.html:17,57,84`; `client/viewer/check.mjs:59-60` | ~+45 | no |
| W14 | *Closed by row 265.* **The surface's TS-only tests** — `onHead` before the body, the dial deadline, the opening fill in the URL, the unpinned dial — sit in the TS unit tests and the dispatch rig, not in `clauses.ts`, so nothing holds WASM to them | `client/transport/ts/test/run.ts:84-85`; `client/contract/dispatch-rig.ts:1730-1750` | ~+80 test | no |

Out of scope: `readMin`, the WebSocket and the race are TS's alone and off by default, so with `client: "wasm"` the
page is WebTransport only. A race whose QUIC arm is the WASM session is structural, and the fallback itself is open
([`ARCHITECTURE.md`](ARCHITECTURE.md) §Open). CI already builds the WASM client (`.github/workflows/gate.yml:78-126`)
and gains only the steps below.

**The shape.** TS the default; WASM chosen by the transport file's `client`; the same surface, the same checks, built
into the image. No capability test, no fallback, no WASM race.

**The rows, in order.**

1. **WASMSURFACE** — W14's clauses into `clauses.ts` first, failing by name on today's WASM client; then W4–W9 in it:
   the head callback, `dialMs`, the opening fill in the URL and armed (the adapter's control-stream ask removed), the
   unpinned dial, `endStream` async, so §The seam's differences lose a row. `connect` (109 lines) split as it grows.
   *Proves it:* `run.mjs` green on both, each new clause mutated on each client. ~+60 Rust, ~+80 test.
   *Built 2026-10-16, row 265* (`claude/wip-265-WASMSURFACE`): six clauses, five of them `runSessionClauses`; on
   the WASM build before it 8 of their checks failed by name, after it `run.mjs` 227/227 on every session. `connect`
   split into `dial` (the pin and the deadline) and the three readers `session.ts` has, 109 lines to 58. The opening ask's URL is written by hand in
   `session.rs` as in `frame-session.ts`: the server's parser is in `server/`, not a crate the client shares.
2. **WASMRIGS** — W13 but the page check: the downloader and dispatch rigs per client (the dispatch rig's transport
   clauses only on WASM; the rest are the decoders'), `ask-during-fill.html` with `wasm` and `downloader-wasm`.
   *Proves it:* green on both; reverting row 1's `endStream` fails *cancel during a resume* on WASM, reverting the head
   callback fails the refill clause. The gate's added wall time reported. ~+45.
   *Built 2026-10-16, row 274* (`claude/wip-274-WASMRIGS`): `fake-session.ts` exports the WASM client under
   `?client=wasm`; the gate runs `downloader-wasm` (58/58) and `dispatch-wasm` (35 clauses, 95/95) beside the TS
   rigs, and `ask-during-fill.html` with `wasm` and `downloader-wasm` (3/3 each). Two clauses had to be sharpened
   before the proof held. With `endStream` synchronous again, *cancel during a resume* passed all three of its checks:
   the call sends `end_stream` before the `.catch` on its result throws, and the throw only fails a dial the resume
   then abandons with nothing owed. Its new check, that the resumption completes (`resumedAt`), fails. With the head
   callback dropped, `reissuesAfterAsk` passed too: the refill in `finally` went out once the asked frame landed,
   before the page looked. It now trickles that frame's body for 2 s and requires the remainder on the wire first; it
   fails on WASM without the callback and on either client with the downloader's `onHead` removed. The gate's
   added time: +13 s on the rigs (67 s, against 54 s for the TS rigs in row 265's gate) and +6 s on `run_wire.sh`
   (25 s, against 19 s): one run each, on one core pinned at the lowest priority beside row 253's campaign.
3. **WASMSELECT** (*structural*) — W1, W2, the page check's `--client wasm` arm, and the status line naming the client.
   *Proves it:* the page check complete, exact and drawn on both; `crafted.mjs` sees an unknown `client` refused by name
   with nothing loaded; the preloads in the request log. ~+25.
   *Built 2026-10-16, row 277* (`claude/wip-277-WASMSELECT`), as §Choosing the client says: +23 −6 product lines,
   `gen_dev_cert.sh` keeping a hand-set `client` among them. The gate's page check runs four times, filled and on
   demand on each client, 3/3 exact and drawn on both; it fails a status line not naming the client, its files not
   preloaded (the page's resource timing) or not in the request log, or the other client's fetched. `crafted.mjs`
   refuses `"rust"` and `"toString"` by name with no client's code fetched and nothing dialled. Eight mutants each
   failed by name: the status line's client dropped; the preloads dropped; the module not passed, so the downloader
   loaded TS; `session.js` preloaded statically again; `Object.hasOwn` dropped (`"toString"` fails, not by name); an
   unknown name falling back to TS; `CLIENT` defaulting to `wasm`, and the transport file without `client`
   (`server_start_test.sh`).
4. **WASMIMAGE** (*structural*) — W3. *Proves it:* `check_equivalence.sh --local` asserts the adapter, glue and `.wasm`
   served (the `.wasm` as `application/wasm`, with the isolation headers) and the crate's sources still hidden; the
   image built once and `check.mjs --url` run on it with `client: "wasm"` (the gate builds no image). ~+20.
5. **WASMLOAD** — W10, W11 measured: the product page cold and warm, `ts` against `wasm` interleaved, page-open's
   round trips at 1× and 4×, the product build with and without `console_error`. Run when the host is free.
6. **By hand** — W12: the rigs in Firefox with `client=wasm`, and the devices' D0 with `client: "wasm"`.

Rows 1 and 2 add no product path and can land before the owner rules on 3 and 4. Row 249's one queue
([`WIRE.md`](WIRE.md) §Proposed: one queue, an ask moves its frame to the front (row 249)) would take `onHead` out of
both clients; if it is ruled first, W4 is not built.

**Measured, and not.** Measured: the bytes (W10, today); R2's tie (W11); the fill's tie; N6, stale; both clients
pending past 180 s on a held dial ([`../lab/dial-deadline/`](../lab/dial-deadline/README.md)); the telemetry's cost;
W6 through the downloader and the gate's added time (row 274, above). Not measured: anything of the WASM client on the
product page; W4's cost on WASM, inferred from row 229's arms; the WASM client in Firefox or WebKit; the image's
build time with a wasm32 stage.

## Proposed: the harness pages to `lab/`

*Proposed 2026-10-15 (queue row 246, HARNESSTOLAB; [`merge-readiness.md`](merge-readiness.md) §Second round, S21).
Nothing moves before the owner's yes.*

**Why.** `client/harness/` (`index.html`, `cell.html`, `shell.js`; 428 lines) is the lab's. The dev host serves it at
`/harness/`; the image never does — `deploy/web-files.sh` copies the viewer's files alone, and
`deploy/check_equivalence.sh` requires `/harness/` and `/client/harness/cell.html` to be 404. A reader of `client/`
meets it among the product.

**What moves.** `git mv client/harness lab/harness`, and the dev host's `/harness/` route pointed at lab/harness/
(one line of `server/dev-server.py`; `lab/` is already among what it serves). The pages name everything by absolute
URL (`/harness/shell.js`, `/client/transport/consumer.js`, `/lab/fixtures/decode_c512/…`), so no line in them
changes, and every URL that `scripts/cellcheck.mjs` and the lab's drivers open stays as it is. Not taken: serving
the pages at `/lab/harness/` with no route, which rewrites the pages' own links and every driver's URL for nothing.

**What changes with it.** `check_equivalence.sh` drops `/client/harness/cell.html` from its hidden paths (18 → 17;
`/harness/` stays, and `/lab/` is hidden already), and `deploy/README.md` its count and "a harness page". The path is
rewritten in README.md, `client/README.md` (and its list of directories), `lab/page-open/README.md`, ARCHITECTURE (6
lines), this file (2, one in row 228's proposal above) and the two telemetry ADRs; `lab/README.md`'s table gains the
row. Eleven files, about 20 lines. `docs/av1/queue.md` and `merge-readiness.md`'s L4 finding are records and keep
the path they had.

**What it costs.** Nothing is saved: 428 lines move. The self-check `index.html` checks the product, not a
measurement — ARCHITECTURE's table cites it for every decoded frame byte-identical to its `.sha256` — and it would
sit in `lab/`, whose README says "measurement only"; `lab/scripts/downloader_both_clients.sh` already sits there in
that same table, and the README's sentence gains a clause. lab/harness/ sits beside `lab/window-harness/`, the
Rust client: two things with near names. Row 228 edits `shell.js`'s `wasm` entry and this row moves the file;
whichever lands second merges. *Corrected 2026-10-16:* row 228's client half was rejected, so it edits nothing
there.

**How it would be proven.** `git grep client/harness` finds only the two records; `scripts/check_links.py` green;
the gate green with the same skips, its `check_equivalence.sh` on the shorter list; and `scripts/cellcheck.sh` once
before and once after, every cell and the self-check passing — the gate does not run it, and it is the one check
that loads the pages.

**The owner's choice.** Move the three files, as proposed; or move `cell.html` and `shell.js` and keep the
self-check in `client/`, which splits the route across two trees for one page; or leave them, which costs a reader
of `client/` three files and nothing else.

## Open

Each item below is the owner's to decide, and is tracked here.

* **`readMin` at 16 KB by default** — frame 0 ties; the cost is re-dials below 44 kbit/s, and the `readMin` path's
  defect is fixed first (§Reading a frame whole).
* **The WASM client as a product client** — the shape (selected by configuration, no fallback) and rows 3–4 of
  §Proposed: the WASM client as a second product client; and whether row 228's dav1d half moves.
