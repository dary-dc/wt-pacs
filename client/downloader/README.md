# downloader

One worker owns the session, every frame's record and the queue; decoders hand pixels straight to
the consumer over a port the downloader hands out. Beside today's path, not instead of it.
Design and what it is for: [`docs/proposal-downloader.md`](../../docs/proposal-downloader.md).

| file | |
| - | - |
| `downloader.js` | the worker: dial, per-frame records, the fill pushed one run at a time and re-issued after an ask, two-priority queue, dispatch, cancel |
| `decoder.js` | one decoder instance, reused; pixels into a `SharedArrayBuffer`, sign extension and range in one pass |
| `consumer.js` | the page side: one waiter per asked frame, so `stats` needs no round trip |

`DownloaderClient.connect(url, certHash, opts)` takes `opts.fill` — the first fill's indices, sent
in `start` so it does not wait for a round trip through the page. `lab/fill-at-start/` prices it.

**Only the dial needs the URL.** `url` and `certHash` may each be a promise: the worker, the
decoders and the transport import start at once and the dial waits alone. With `opts.openAsk` the
opening fill rides the session URL as `?ask=fill:A-B` and is never asked for on the control stream —
off by default, as the server's `--open-ask` is. `lab/page-open/README.md` §The first byte on a
fill prices both: the opening ask is **−1.13 round trips** to the first frame of a fill, 41 ms at a
40 ms link and 178 ms at 160; the promise is worth nothing measurable on that box.

**A warm-up frame.** `opts.warmup` is a URL to a codestream **of the series' shape**. Each decoder
fetches it beside its own WASM compile and decodes it — through the same path a real frame takes —
before it answers `ready`, so the tiering the first frames of a fill pay is spent in the idle
window before the first bytes instead of on the frames a user is waiting for.
`warmup/` ships one per shape the product serves, 160x160, made by
`lab/scripts/gen_htj2k_fixtures.sh warmup_c warmup_g`. The **caller** picks the file, because the
caller is what holds the series metadata; a file of the wrong shape warms the wrong code
([`docs/decode/README.md`](../../docs/decode/README.md) §Warming the decoders). It is one
same-origin GET, nothing on the session, and a warm-up that cannot be fetched leaves a working
decoder — `client/conformance/dispatch-rig.ts` holds all three to account. One that is *not a
codestream* also leaves one, now because `decodeFrame` refuses it rather than because the wrapper
is silent (`docs/decode/README.md` §A frame that did not decode).
**Off by default, and the shape is not a detail**: a warm-up takes 30–45 % off frames 0–2 of a
fill, but a warm-up of the *wrong* shape leaves the frames after them slower than no warm-up at
all, and on the box that measured it the decoders answer `ready` later by about what the frames
save, so the page's clock does not move. `docs/decode/README.md` §Warming the decoders has the
table and the conditions it would pay under.

**What a decoder worker costs.** 5.9 MB resident each, 5.7 MB of it the worker's own JS+WASM heap,
measured as the slope in the decoder count with the instrument calibrated against 32 MB of ballast
per worker — and 6.1 MB through this whole path, session included, with the page keeping every
frame ([`docs/decode/README.md`](../../docs/decode/README.md) §What a decoder worker costs,
resident). The one decoder object `decoder.js` reuses accounts for 0.81 MB of that and does not
grow with the series; each worker compiling its own module accounts for 0.3 MB. So neither is a
lever worth pulling, and a page where three of these cost tens of MB each is not paying for them.

**The wire buffer is a ring, not a frame's own.** `connect` sizes it —
`opts.wireBuffers`, defaulting to `decoders × perDecoder + 2`, the frames that can be between the
wire and a decoder, a default 2, 8 and 16 were measured against and nothing beat — and the session
hands frames out of it. `decoder.js` transfers `bytes.buffer`
back in its `done` or `failed` reply and this worker returns it with `session.releaseWireBuffer`,
so a fill's peak is the pool rather than the series: **−19.2 MB [−20.9…−16.0] of renderer peak on
an 87-frame 16-bit fill, 8 of 8 rounds**, −10.8 on the colour set, against a constant 3.1 MB the
pool retains and no movement in the fill's clock
([`docs/decode/README.md`](../../docs/decode/README.md) §The wire buffer ring). `wireBuffers: 0`
never retains, which is one buffer per frame — the behaviour before it, and what a consumer that
hands nothing back gets anyway. An undecoded frame (`decode: false`) is transferred to the page and
never comes back, as before.

**A request is a generation.** `cancel()` bumps it and returns a promise that resolves once the
downloader has ended the stream and dropped that request's work; every frame and failure carries the
generation it was made under, and anything older is dropped on the page rather than handed over
under an index the new request is using. A refused *fill* frame has no waiter, so it reaches the
consumer through `opts.onError({ frameIndex, reason, generation })` — a refused *asked* frame still
rejects its own promise. [`proposal-downloader.md`](../../docs/proposal-downloader.md) §The consumer.

**What a frame reports.** Beside the decoded `byteCount`, every frame message the decoder and the
downloader post carries `wireBytes` — the codestream length the frame's envelope declared, which is
what actually crossed the link. A consumer reporting traffic quotes that one: on a compressed frame
the decoded plane is several times larger, so `byteCount` would overstate the link by that factor.
It reaches the page as `frame.info.wireBytes`, the way `byteCount` does, on the decoded path and on
the undecoded one alike; nothing was renamed to make room for it.

**A frame that did not arrive whole is a failure, not a frame.** Two checks, both inside the worker
graph, so the page never sees a bad frame. On the wire, a uni stream that ends before the length its
own envelope declares names the frame it lost and refuses it
([`docs/CLIENTS.md`](../../docs/CLIENTS.md) §A truncated frame is a failure). In the decoder, a
decoded buffer that is empty or shorter than the codestream's header declares is thrown, because one
decoder object is reused and an undecodable frame otherwise comes back carrying the **previous**
frame's pixels under the new index ([`docs/decode/README.md`](../../docs/decode/README.md) §A frame
that did not decode). Either way the consumer gets `onError({ frameIndex, reason, generation })` for
a fill frame or a rejected promise for an asked one, so a fill that lost a frame cannot report
itself complete. A session that **dies** mid-fill is the third way to lose a frame: the transport
names every index the fill still owed, and — corrected 2026-09-22 — this worker resumes on that
list rather than failing the run, and fails it only once the re-dials have run out (§A session that
dies is resumed). Neither check sees a codestream the server truncated *before* framing it; the
harness's per-frame `.sha256` is what sees that.

**A session that dies is resumed.** A path that goes away takes no byte with it that the records do
not already hold, so the worker treats a death as a resumption rather than a failure. Every
platform trigger — `online`/`offline` and `navigator.connection` `change` in the worker,
`visibilitychange`, `pageshow`, `freeze` and `resume` forwarded by `consumer.js` — re-reads one
clock: the last byte the transport delivered. **No byte for `stallMs` while frames are owed** and the
session is re-dialled, the wait doubling after each re-dial it caused, and exactly what the records
still owe is issued on the new one — the fill's remainder as a run and any outstanding ask again, with
nothing that arrived re-fetched and nothing re-decoded. The request's **generation does not move**:
a resume is the same request, so the page's waiters and records stay valid and the only thing it is
told is when each resume happened, as `stats().resumedAt`. `survival: false` turns it off; an object overrides
`{ stallMs: 3000, redialMs: 1000, tries: 5, dialMs: 5000 }`. A dial whose `ready` has not settled by
`dialMs` is closed and counts as a failed try, the first dial included. Until 2026-09-24 a quiet fill started a probe ask
instead, which livelocked on a slow link. An ask keeps no timer in the consumer: the downloader
settles it, and the transports time a frame from the last byte, not from the ask.
[`docs/proposal-session-survival.md`](../../docs/proposal-session-survival.md) has the states, the
reasons and what a cut costs today against built.

Run the arm (`client/harness/downloader.html`) the way the README's quick start runs the others,
against any study — it checks each decoded frame against the fixture's `.sha256`:

```bash
./server/scripts/gen_dev_cert.sh
cargo run --release -p exact-server -- --port 4433 --study <study>.sbnd
python3 server/dev-server.py --port 8765
# then open http://127.0.0.1:8765/harness/downloader.html in a cross-origin-isolated context
```

**The page must be cross-origin isolated.** Pixels are written once into a `SharedArrayBuffer`;
`DownloaderClient.connect` refuses rather than falling back to a copy, because a silent fallback
would measure the wrong thing. `dev-server.py` and `deploy/nginx` both send the headers.

**The transport is a seam.** `config.transport` is a module URL exporting `TransportSession`,
defaulting to `client/transport-ts/dist/session.js`. A third implementation plugs in there without
the downloader knowing ([`client-shape-plan.md`](../../docs/client-shape-plan.md) §0) — and it is
how the conformance suite drives this arm: `client/conformance/run_downloader.sh`, run by the gate.
`config.decoderWorker` is the same seam for the decoder: `client/conformance/run_dispatch.sh` (D2c)
points it at a stalling stand-in to force the contention its ordering and dispatch-bound tests need.

**Mutate it after any change to `decoder.js`.** Perturb one decoded sample and every `sha` line must
read `MISMATCH`; drop every fifth frame and the fill must report fewer than it asked for. Both were
run; a decode path whose ground-truth check does not fire is worth nothing.
