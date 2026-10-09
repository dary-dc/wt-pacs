# wt-pacs

WebTransport PACS — web-native medical imaging transport (MIT).

## Prerequisites

Linux on x86-64 (the server's read path uses io_uring; the pinned `wasm-opt` is x86-64), Rust 1.88 or newer
with `rustup`, Node 22 (`.nvmrc`), Python 3.11 or newer, and on PATH: git, curl, tar, patch, sha256sum,
openssl, and binutils' `nm` and `strings`. The first builds fetch from crates.io, npm and GitHub.

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.15.0 --locked
npm i -g playwright@1.56.1 && npx playwright install chromium
bash client/decode/wasm/fetch_openjph.sh            # the HTJ2K decoder the page runs
bash client/decode/wasm/fetch_xxh3.sh               # the hash that checks each decoded frame
```

Two more open what the gate otherwise skips, by name, in its log:

```bash
VARIANTS=simd client/decode/wasm/dav1d/build.sh     # the AV1 decoder: git, ninja, a C compiler; fetches emscripten (~5 min)
python3 -m venv lab/av1/.venv && lab/av1/.venv/bin/pip install --require-hashes -r lab/av1/requirements.txt
                                                    # numpy for the painter check: PYTHON=lab/av1/.venv/bin/python
```

Without the first, the dispatch rig runs 152 of its 750 checks; without the second, the painter check does not run.

## Quick start

```bash
# 1. Build the clients (once, and after changes; dist/ and pkg/ are not tracked)
bash client/transport/wasm/build.sh   # the WASM client; fetches binaryen's wasm-opt, pinned by checksum, on first run
bash client/transport/ts/build.sh     # the TypeScript client and the test bundles; npm install on first run

# 2. A dev certificate, valid 10 days, and client/dev-transport.json pointing at port 4433
./server/scripts/gen_dev_cert.sh

# 3. The smoke bundle is tracked; packing it again writes the same bytes
cargo run -p pack-series -- \
  --metadata fixtures/us_cine_smoke/metadata.json \
  --frames fixtures/us_cine_smoke/frames \
  --output fixtures/us_cine_smoke/us_cine_smoke.sbnd

# 4. Terminal 1 — the WebTransport server
cargo run --release -p series-server -- \
  --port 4433 \
  --series fixtures/us_cine_smoke/us_cine_smoke.sbnd

#    Terminal 2 — the static host
python3 server/dev-server.py --port 8765 --series us_cine_smoke

# 5. Before pushing: the gate (about 100 s on 4 cores, warm builds); --no-browser skips the browser steps, --quick two absence checks
scripts/gate.sh
```

Then open in Chrome:

- A cell over the downloader: `http://127.0.0.1:8765/harness/cell.html?autorun=1`, the URL the static host
  prints; its last line is `run_end` with `delivered` equal to `asked`. `&transport=wasm` runs the WASM client.
  `&transport=ws` runs the WebSocket fallback, which needs the server started with `--websocket` and a Chrome
  that trusts the dev certificate, since a WebSocket cannot pin it by hash
  ([`docs/WIRE.md`](docs/WIRE.md) §The WebSocket mapping):

  ```bash
  SPKI=$(openssl x509 -in server/dev-cert/cert.pem -pubkey -noout | openssl pkey -pubin -outform DER \
    | openssl dgst -sha256 -binary | base64)
  google-chrome --user-data-dir="$(mktemp -d)" --ignore-certificate-errors-spki-list="$SPKI" \
    'http://127.0.0.1:8765/harness/cell.html?autorun=1&transport=ws'
  ```

  The query parameters are listed in `client/harness/shell.js`.
- The downloader's self-check, every decoded frame against its `.sha256`: `http://127.0.0.1:8765/harness/`.
  It needs the decoder (§Prerequisites) and the server on the `decode_c512` series in place of the smoke one
  ([`docs/FIXTURES.md`](docs/FIXTURES.md)); the frames need cmake and a C++ compiler for OpenJPH's encoder:

  ```bash
  lab/scripts/gen_htj2k_fixtures.sh c512   # 87 frames and their .sha256
  mkdir -p target/c512
  for f in lab/fixtures/decode_c512/*.j2c; do cp "$f" "target/c512/$(basename "$f" .j2c).htj2k"; done
  cargo run -p pack-series -- --metadata lab/fixtures/decode_c512/metadata.json --frames target/c512 \
    --output target/c512.sbnd
  cargo run --release -p series-server -- --port 4433 --series target/c512.sbnd   # Terminal 1, in place of the smoke series
  ```

`scripts/cellcheck.sh` runs both pages headless in one go, after the c512 frames above: the cells over both
clients must each deliver what they asked, the refuse cell none of it, and the self-check must pass. It makes its
own server, bundle and certificate, so it needs neither terminal nor step 2; the gate does not run it.
`deploy/check_equivalence.sh` checks that the web image answers every path the harness uses exactly as
`server/dev-server.py` does; it needs podman or docker, or nginx with `--local` ([`deploy/README.md`](deploy/README.md)).

Both clients and the TCP fallback are [`docs/CLIENTS.md`](docs/CLIENTS.md); the bytes they speak, [`docs/WIRE.md`](docs/WIRE.md).

**What the gate catches** — mutants made by hand at each decision, run by the step that owns the code: the
downloader's in [`client/README.md`](client/README.md) §Every decision is held by a test; the decoder modules
45 of 45; the send path (`planner.rs`, `frame_out.rs`, `pipeline.rs`) 20 of 24, the four alive being log lines
and a lab-only stall's equivalent sends; the series bundle's reader and writer 10 of 10.

## Docs

Each subject has one owner; a claim lives there, corrected in place when it is wrong (`CLAUDE.md` §Docs).

| doc | owns |
| --- | --- |
| [`docs/glossary.md`](docs/glossary.md) | every project term, defined once |
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
| [`docs/av1/`](docs/av1/README.md) | AV1, a second lossless codec: what is open and what decides it; its own queue |

Older campaign evidence and `lab/transport/` are on tag `archive/transport-lab-2026-09`; every
retired doc is in the history before the commit that folded it.


## Names

Every project term is defined once, in [`docs/glossary.md`](docs/glossary.md); the rule names follow is
`CLAUDE.md` §Names.

## Provenance

Public MIT extract of work that began in a private codebase. Names and license
were cleaned for publication; treat the log as an engineering timeline of this
tree, not a byte-for-byte mirror of the private repo.

*Corrected 2026-10-03:* this said the git history was cleaned too. Its commit
metadata was not rewritten: some commits carry attribution trailers.
