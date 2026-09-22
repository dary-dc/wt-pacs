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
same-origin GET, nothing on the session, and a warm-up that cannot be fetched or decoded leaves a
working decoder — `client/conformance/dispatch-rig.ts` holds all three to account.
**Off by default, and the shape is not a detail**: a warm-up takes 30–45 % off frames 0–2 of a
fill, but a warm-up of the *wrong* shape leaves the frames after them slower than no warm-up at
all, and on the box that measured it the decoders answer `ready` later by about what the frames
save, so the page's clock does not move. `docs/decode/README.md` §Warming the decoders has the
table and the conditions it would pay under.

**A request is a generation.** `cancel()` bumps it and returns a promise that resolves once the
downloader has ended the stream and dropped that request's work; every frame and failure carries the
generation it was made under, and anything older is dropped on the page rather than handed over
under an index the new request is using. A refused *fill* frame has no waiter, so it reaches the
consumer through `opts.onError({ frameIndex, reason, generation })` — a refused *asked* frame still
rejects its own promise. [`proposal-downloader.md`](../../docs/proposal-downloader.md) §The consumer.

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
