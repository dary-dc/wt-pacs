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
