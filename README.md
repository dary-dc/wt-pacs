# wt-pacs

WebTransport PACS — web-native medical imaging transport (MIT).

## Prerequisites

A Rust toolchain, Python 3 and Node. `scripts/gate.sh` requires everything below and exits 2,
with the install command, when any is missing: the WASM client is part of the product, not an
optional arm (the conformance and worker-safe steps cover both clients or neither), and the
browser steps need playwright, Chromium and the decoder vendor. `scripts/gate.sh --no-browser`
skips the browser steps and says so in its last line.

```bash
rustup target add wasm32-unknown-unknown
npm i -g wasm-pack                    # or: cargo install wasm-pack
npm i -g playwright && npx playwright install chromium
bash lab/decode-bench/fetch_decoder.sh   # the decoder vendor
```

## Quick start (harness)

```bash
# 1. Build the clients (once, and after changes; dist/ and pkg/ are not tracked)
bash client/transport-wasm/build.sh   # web_sys WASM client; fetches wasm-opt on first run
bash client/transport-ts/build.sh     # TypeScript client → dist/

# 2. Dev TLS + dev-transport.json
./server/scripts/gen_dev_cert.sh

# 3. Pack the smoke bundle, or use the tracked one
cargo run -p pack-study -- \
  --metadata fixtures/us_cine_smoke/metadata.json \
  --frames fixtures/us_cine_smoke/frames \
  --output fixtures/us_cine_smoke/us_cine_smoke.sbnd

# Terminal 1 — WebTransport server
cargo run --release -p exact-server -- \
  --port 4433 \
  --study fixtures/us_cine_smoke/us_cine_smoke.sbnd

# Terminal 2 — static host
python3 server/dev-server.py --port 8765 --study us_cine_smoke
```

Open in Chrome:

- A cell over the downloader: `http://127.0.0.1:8765/harness/cell.html?autorun=1` — `&transport=wasm` or
  `&transport=ws` for the other transports behind it; the query parameters are listed in `client/harness/shell.js`.
- The downloader's self-check (decoded frames against `.sha256`): `http://127.0.0.1:8765/harness/` against
  the `decode_c512` study, with the decoder vendor built (`client/downloader/README.md`).

The TypeScript and WASM transports speak the same wire (FoD on bidi control + envelope on server uni
streams); the WASM client uses `web_sys::WebTransport` (no hand-rolled JS glue module).

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
| [`lab/README.md`](lab/README.md) | which lab directory reproduces which claim; each lab README runs its cells — [`lab/page-open/README.md`](lab/page-open/README.md) the page open |
| `docs/adr-*.md`, `docs/transport/adr-*.md`, `docs/telemetry/adr-*.md` | the decisions: stream shape, ask window, framing, stride, resolution fitting, what the server refuses to do, idle sessions, receive windows, telemetry |
| [`docs/transport/upstream-*.md`](docs/transport/) | upstream drafts, not filed |
| [`docs/cloud-queue.md`](docs/cloud-queue.md) | the work queue, closed: its protocol, where each row's verdict lives, and the open owner decisions |

Older campaign evidence and `lab/transport/` are on tag `archive/transport-lab-2026-09`; every
retired doc is in the history before the commit that folded it.


## Provenance

Public MIT extract of work that began in a private codebase. Names, license,
and git history were cleaned for publication; treat the log as an engineering
timeline of this tree, not a byte-for-byte mirror of the private repo.
