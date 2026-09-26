# wt-pacs

WebTransport PACS — web-native medical imaging transport (MIT).

## Prerequisites

A Rust toolchain, Python 3 and Node. The WASM client is part of the product, not an optional
arm, so `scripts/gate.sh` requires it built and fails when `client/transport-wasm/pkg/` is
absent — the gate's conformance and worker-safe steps cover both clients or neither:

```bash
rustup target add wasm32-unknown-unknown
npm i -g wasm-pack                    # or: cargo install wasm-pack
bash client/transport-wasm/build.sh   # once per clone; fetches wasm-opt on first run
```

## Quick start (harness)

```bash
# Terminal 1 — dev TLS + dev-transport.json
./server/scripts/gen_dev_cert.sh

# Terminal 2 — pack or use smoke bundle
cargo run -p pack-study -- \
  --metadata fixtures/us_cine_smoke/metadata.json \
  --frames fixtures/us_cine_smoke/frames \
  --output fixtures/us_cine_smoke/us_cine_smoke.sbnd

# Terminal 3 — WebTransport server
cargo run --release -p exact-server -- \
  --port 4433 \
  --study fixtures/us_cine_smoke/us_cine_smoke.sbnd

# Terminal 4 — clients (after changes)
client/transport-wasm/build.sh   # web_sys WASM client
client/transport-ts/build.sh     # TypeScript client → dist/

# Terminal 5 — static host
python3 server/dev-server.py --port 8765 --study us_cine_smoke
```

Open in Chrome:

- WASM: `http://127.0.0.1:8765/harness/`
- TypeScript: `http://127.0.0.1:8765/harness/ts.html`

Both speak the same wire (FoD on bidi control + envelope on server uni streams).
The WASM client uses `web_sys::WebTransport` (no hand-rolled JS glue module).

A TCP fallback serves the same envelopes over a WebSocket: `--websocket` on the server, and
`client/transport-ts/dist/ws-session.js` or `race-session.js` on the page
([`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §Race it).

## Docs

Each subject has one owner; a claim lives there, corrected in place when it is wrong (`CLAUDE.md` §Docs).

| doc | owns |
| --- | --- |
| [`docs/WIRE.md`](docs/WIRE.md) | the wire: FoD messages, the envelope, stream modes, an ask during a fill, the WebSocket mapping |
| [`docs/CLIENTS.md`](docs/CLIENTS.md) | the client contract: the transport seam, its implementations, the conformance suite |
| [`docs/FIXTURES.md`](docs/FIXTURES.md) | the fixtures and how each is made |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | the client above the transport: downloader, decoders, consumer; the session's open, survival and fallback |
| [`docs/transport/transport-conclusions.md`](docs/transport/transport-conclusions.md) | what the transport measured and chose, why, and what is open |
| [`docs/decode/README.md`](docs/decode/README.md) | the decoder: builds, dispatch, warm-up, the range, the decode tail |
| [`docs/disk-access/adr.md`](docs/disk-access/adr.md) | how the server reads frame bytes, and its deployment |
| [`docs/rig-limits.md`](docs/rig-limits.md) | what the measurement hosts can and cannot claim |
| `docs/adr-*.md`, `docs/transport/adr-*.md`, `docs/telemetry/adr-*.md` | the decisions: stream shape, ask window, framing, stride, resolution fitting, what the server refuses to do, idle sessions, receive windows, telemetry |
| [`docs/transport/upstream-*.md`](docs/transport/) | upstream drafts, not filed |
| [`docs/cloud-queue.md`](docs/cloud-queue.md) | the live work queue |

Older campaign evidence and `lab/transport/` are on tag `archive/transport-lab-2026-09`; every
retired doc is in the history before the commit that folded it.


## Provenance

Public MIT extract of work that began in a private codebase. Names, license,
and git history were cleaned for publication; treat the log as an engineering
timeline of this tree, not a byte-for-byte mirror of the private repo.
