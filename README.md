# wt-pacs

WebTransport PACS — web-native medical imaging transport (MIT).

## Prerequisites

A Rust toolchain, Python 3 and Node. `scripts/gate.sh` requires everything below and exits 2,
with the install command, when any is missing: the WASM client is part of the product, not an
optional variant (the contract and worker-safe steps cover both clients or neither), and the
browser steps need playwright, Chromium and the decoder vendor. `scripts/gate.sh --no-browser`
skips the browser steps and says so in its last line.

```bash
rustup target add wasm32-unknown-unknown
npm i -g wasm-pack                    # or: cargo install wasm-pack
npm i -g playwright && npx playwright install chromium
bash client/decode/wasm/fetch_openjph.sh   # the decoder vendor
```

### What the gate costs and what it catches

Without `lab/.av1-build/out` (`VARIANTS=simd client/decode/wasm/dav1d/build.sh`) the dispatch rig skips every
AV1 clause, saying `SKIPPED` — 128 checks run instead of 719 — so build it once where AV1 matters.

**Time** (row GATE, 2026-10-07; 4 cores, warm builds, n = 3 a cell, the two trees' runs interleaved):
**161.4 [159.8–161.7] → 105.9 [104.9–106.1] s** `--quick`, **160.7 [160.5–161.1] → 107.0
[106.0–107.0] s** full. The two steps that waited on timers now wait side by side: transport
contract runs each implementation in its own process (54.4 → 18.2 s; one clause trickles a frame
for 16 s on each), and the two browser rigs run in parallel pages (57.0 → 38.3 s). Next largest:
the real-server wire step 13 s, the two server test runs 11 s each, nothing else over 6 s.

**What it catches** — mutants made by hand at each decision, the step that owns the code run on
each (the node tests and both rigs for the client, `cargo test` for the rest):

| code | mutants | killed before | after | left alive, and why |
| --- | --- | --- | --- | --- |
| `downloader.js`, `consumer.js` | 76 | 44 | 65 of 72 | 4 were dead code, removed; 7: two only matter when a frozen page's timers fire late, a listener removal and two `??=` change nothing observable, the wire buffer's release only moves memory, a recycle racing a resumption the fake cannot order (`client/README.md` §Every decision is held by a test) |
| the decoder modules (`decoder.js`, `htj2k.js`, `av1*.js`, `decode-av1*.js`) | 45 | 45 | 45 | — |
| the send path (`planner.rs`, `frame_out.rs`, `pipeline.rs`) | 25 | 16 | 20 of 24 | 1 was dead code, removed; 4: `fills` and the end-of-session read report are log lines, and the lab-only byte-budget stall's FIN and its `>`/`>=` send the same bytes |
| the series bundle's reader and writer | 10 | 3 | 10 | — |

No test was cut: the pairs whose mutants another test also kills are checks inside one clause, which
cost no time of their own, or rest on too few mutants to show one covers the other.

## Quick start (harness)

```bash
# 1. Build the clients (once, and after changes; dist/ and pkg/ are not tracked)
bash client/transport/wasm/build.sh   # web_sys WASM client; fetches wasm-opt on first run
bash client/transport/ts/build.sh     # TypeScript client → dist/

# 2. Dev TLS + dev-transport.json
./server/scripts/gen_dev_cert.sh

# 3. Pack the smoke bundle, or use the tracked one
cargo run -p pack-series -- \
  --metadata fixtures/us_cine_smoke/metadata.json \
  --frames fixtures/us_cine_smoke/frames \
  --output fixtures/us_cine_smoke/us_cine_smoke.sbnd

# Terminal 1 — WebTransport server
cargo run --release -p series-server -- \
  --port 4433 \
  --series fixtures/us_cine_smoke/us_cine_smoke.sbnd

# Terminal 2 — static host
python3 server/dev-server.py --port 8765 --series us_cine_smoke
```

Open in Chrome:

- A cell over the downloader, on any series: `http://127.0.0.1:8765/harness/cell.html?autorun=1`, the
  URL the static host prints. `&transport=wasm` runs the WASM client. `&transport=ws` runs the
  WebSocket fallback, which needs the server started with `--websocket` (add it to Terminal 1's
  command) and a Chrome that trusts the dev certificate, since a WebSocket cannot pin it by hash
  ([`docs/WIRE.md`](docs/WIRE.md) §The WebSocket mapping):

  ```bash
  SPKI=$(openssl x509 -in server/dev-cert/cert.pem -pubkey -noout | openssl pkey -pubin -outform DER \
    | openssl dgst -sha256 -binary | base64)
  google-chrome --user-data-dir="$(mktemp -d)" --ignore-certificate-errors-spki-list="$SPKI" \
    'http://127.0.0.1:8765/harness/cell.html?autorun=1&transport=ws'
  ```

  The query parameters are listed in `client/harness/shell.js`.
- The downloader's self-check (decoded frames against `.sha256`): `http://127.0.0.1:8765/harness/`.
  It needs the decoder vendor (§Prerequisites) and the server running the `decode_c512` series in
  place of the smoke one ([`docs/FIXTURES.md`](docs/FIXTURES.md), `client/README.md`):

```bash
lab/scripts/gen_htj2k_fixtures.sh c512   # 87 frames and their .sha256; builds OpenJPH's encoder once (cmake, a C++ compiler)
mkdir -p target/c512
for f in lab/fixtures/decode_c512/*.j2c; do cp "$f" "target/c512/$(basename "$f" .j2c).htj2k"; done
cargo run -p pack-series -- \
  --metadata lab/fixtures/decode_c512/metadata.json \
  --frames target/c512 \
  --output target/c512.sbnd

# Terminal 1, in place of the smoke series
cargo run --release -p series-server -- --port 4433 --series target/c512.sbnd
```

`scripts/cellcheck.sh` runs both pages headless in one go: the cells over both clients (on-demand at
depth 1 and 4, fill, refuse, a fill on a busy main thread, telemetry) must each deliver what they asked,
the refuse cell none of it, and the self-check must pass. It builds a release server, packs the c512
series and makes its own cert under a temp dir, so it needs the c512 frames above, the WASM `pkg/` and
the browser prerequisites, but not the two terminals or `gen_dev_cert.sh`. `scripts/gate.sh` does not run
it, since the gate does not require the c512 frames.

The TypeScript and WASM transports speak the same wire (FoD on bidi control + envelope on server uni
streams); the WASM client uses `web_sys::WebTransport` (no hand-rolled JS glue module).

A TCP fallback serves the same envelopes over a WebSocket: `--websocket` on the server, and
`client/transport/ts/dist/ws-session.js` or `race-session.js` on the page
([`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §Race it).

## Docs

Each subject has one owner; a claim lives there, corrected in place when it is wrong (`CLAUDE.md` §Docs).

| doc | owns |
| --- | --- |
| [`docs/WIRE.md`](docs/WIRE.md) | the wire: FoD messages, the envelope, stream modes, an ask during a fill, the WebSocket mapping |
| [`docs/CLIENTS.md`](docs/CLIENTS.md) | the client contract: the transport seam, its implementations, the contract suite |
| [`docs/FIXTURES.md`](docs/FIXTURES.md) | the fixtures and how each is made |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | the client above the transport: downloader, decoders, consumer; the session's open, survival and fallback |
| [`docs/transport/transport-conclusions.md`](docs/transport/transport-conclusions.md) | what the transport measured and chose, why, and what is open |
| [`docs/decode/README.md`](docs/decode/README.md) | the decoder: builds, dispatch, warm-up, the range, the decode tail |
| [`docs/adr/disk-access.md`](docs/adr/disk-access.md) | how the server reads frame bytes, and its deployment |
| [`docs/rig-limits.md`](docs/rig-limits.md) | what the measurement hosts can and cannot claim |
| [`lab/README.md`](lab/README.md) | which lab directory reproduces which claim; each lab README runs its cells — [`lab/page-open/README.md`](lab/page-open/README.md) the page open |
| [`docs/adr/`](docs/adr/README.md) | the decisions, one per record, indexed with their status: stream shape, the session loop, ask window, stride, resolution fitting, what the server refuses to do, the read path, idle sessions, receive windows, telemetry |
| [`docs/transport/upstream-*.md`](docs/transport/) | upstream drafts, not filed |
| [`docs/cloud-queue.md`](docs/cloud-queue.md) | the work queue, closed: its protocol, where each row's verdict lives, and the open owner decisions |
| [`docs/av1/`](docs/av1/README.md) | the AV1 phase: a second lossless codec, what is open and what decides it; its own queue |

Older campaign evidence and `lab/transport/` are on tag `archive/transport-lab-2026-09`; every
retired doc is in the history before the commit that folded it.


## Names

A name states its role in the domain's words: no word from the project's history (a queue row, a
campaign label, *lever 2*), none a standard the code touches uses for something else (DICOM's
*Item*, (FFFE,E000); ARM the CPU), and one concept, one name, defined here once (row NAMING,
2026-10-07).

| name | is |
| --- | --- |
| frame | one image of a series, addressed by its display index |
| ask | a request for one frame, `request_frame`, served next |
| fill | frames the server pushes in index order, `stream_frames`; on the wire one contiguous **run** at a time |
| the opening ask | an ask or a fill carried in the session URL, served behind the accept |
| early SETTINGS | the server's SETTINGS in its handshake flight, at 0.5 RTT (a crate patch) |
| envelope | `[4B display_index][codestream]`, one frame, sent behind its 4-byte length on a media stream |
| bundle | the store's file (`.sbnd`): header, index, metadata, frames |
| record | the downloader's state of one frame: `wire`, `queued`, `decoding` |
| generation | a request's identity, moved by `cancel`; **epoch**, a session's, moved by a resume |
| resume, recycle | a dead session replaced, owing what the records owe; a live one replaced before a byte budget |
| decoder | a worker that decodes; **codec module**, the code it loads per codec (`htj2k.js`, `av1.js`) |
| AV1 payload | one DICOM frame's AV1 data as stored and sent: a 16-byte header and its temporal units, the top and the low stream's when split ([`docs/av1/payload-format.md`](docs/av1/payload-format.md)); never an "AV1 frame", which is the AV1 specification's own term |
| group | G frames from a keyframe, decoded in order on one decoder; **unit**, one AV1 temporal unit |
| split | a sample as a top stream (v ≫ k) and a low one (v & (2^k − 1)) |
| client | an implementation of the transport (`transport-ts`, `transport-wasm`, the WebSocket one); **rig**, the harness that drives one through the contract clauses |
| variant | in the lab only: one condition of a timed comparison |

**Renamed:** ARCHITECTURE's *Lever 1, 2, 3* and transport-conclusions' *Lever 1, 2* — five things
under three numbers — are the opening ask, early SETTINGS, hints in the session URL, the bytes
pushed at session open and a 32-packet initial window; *S4* is the container campaign; the
contract suite's *variants* are clients and rigs; `consumer.js`'s `#variant` is `#waitFor`. The `lab/av1/` folders named for
queue rows are named by subject in five groups (`lab/av1/README.md` §The folders, by what they measure). The AV1
*item* is the AV1 payload (row AV1DOCS): `payload-format.md`, `av1-payload.js`, `parsePayload`.

**Proposed, not applied:**

| name | where | breaks | proposed | why not now |
| --- | --- | --- | --- | --- |
| `variant` in telemetry rows | `client/record`, `client/harness/shell.js` | names a client, and ARM the CPU | `client` | a row schema the lab's analyses read |
| *variant* in the lab (≈1 900 lines) | `lab/`, `CLAUDE.md` §Measurement | ARM the CPU | **variant** | the owner's word in `CLAUDE.md` |
| campaign labels (*S1–S4*, *R1*, *PO1*, *WP1*) | `docs/`, `lab/` | history | what each measured | doc by doc, with the docs that own them |

**For `CLAUDE.md`, proposed:** *"**Names.** A name states its role in the domain's words. No word from
the project's history — a queue row, a campaign label, a numbered lever — and none that a standard
the code touches uses for something else (DICOM's Item; ARM). One concept, one name, defined once in
`README.md` §Names."*

## Provenance

Public MIT extract of work that began in a private codebase. Names and license
were cleaned for publication; treat the log as an engineering timeline of this
tree, not a byte-for-byte mirror of the private repo.

*Corrected 2026-10-03:* this said the git history was cleaned too. Its commit
metadata was not rewritten: some commits carry attribution trailers.
