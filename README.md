# wt-pacs

WebTransport PACS — web-native medical imaging transport (MIT).

## Prerequisites

Linux on x86-64 (the server's read path uses io_uring; the pinned `wasm-opt` is x86-64), Rust 1.88 or newer
with `rustup`, Node 22 (`.nvmrc`), Python 3.11 to 3.13, and on PATH: git, curl, tar, patch, sha256sum,
openssl, jq, and binutils' `nm` and `strings`. The first builds fetch from crates.io, npm and GitHub.

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.15.0 --locked
npm i -g playwright@1.56.1 && npx playwright install chromium
bash client/decode/wasm/fetch_openjph.sh            # the HTJ2K decoder the page runs
bash client/decode/wasm/fetch_xxh3.sh               # the reference the frame check's hash is tested against
```

Two more open what the gate otherwise skips, by name, in its log:

```bash
client/decode/wasm/build/build.sh                  # the decoder builds the page loads: docker; fetches emscripten (~5 min)
python3 -m venv .venv && .venv/bin/pip install --require-hashes -r ingest/requirements.txt
                                                    # numpy, pydicom, xxhash, blake3 (CPython 3.11–3.13): PYTHON=.venv/bin/python
```

With the first, the dispatch rig runs all 782 of its checks, the real-decode ones on npm's OpenJPH and on the
product's build alike; without it, those that need the build are skipped by name. Without the second, the painter
checks, the split's merge and the DICOM reader do not run; the native painter's also needs Mesa's lavapipe
(`mesa-vulkan-drivers` on Debian and Ubuntu), and the native window's also `xvfb`, `xdotool` and `libxkbcommon-x11-0`. The ingest's coders — libaom 3.15.1, dav1d 1.5.4 and
OpenJPH 0.31.0, built from source at their pins into `ingest/.build` — need cmake, ninja, meson (1.9.1 here), nasm and
a C++ compiler: `ingest/tools.sh`. The DICOM ingest needs them, and the gate's comparison of the two ingests and its
synthetic DICOM series to `.sbnd` end to end run on them
([`ingest/from-parser/README.md`](ingest/from-parser/README.md)).
Without nginx on PATH, the web host's check (`deploy/check_equivalence.sh --local`) does not run.
Without Go 1.24 or newer on PATH, the lab's two Go clients are not compiled (Go fetches the toolchain each `go.mod` names and checks it against its checksum database).

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

The same gate runs in CI, `.github/workflows/gate.yml`, on every pull request into `claude/av1-unified-mainbase` and
`main` and every push to them: every prerequisite above present, so a skip not on the workflow's list fails it, and
the deploy image built with `deploy/check_equivalence.sh` and the viewer's page check run through it. No timing runs
there: a shared runner is not a measurement host. Performance is guarded by counts instead, which no runner moves:
`scripts/perf_counts.mjs` drives the product's downloader against the release server, over its WebSocket (the same asks
and envelopes as QUIC's shared stream), on a 24-frame synthetic series filled, stepped through as a cine and asked on
demand, and fails on any change from `scripts/perf_counts.baseline` in the client's asks, the server's reads of the
bundle (through strace, every read forced to a miss) or the envelope bytes; a changed count is a reviewed line there.
A doubled read on either reader, a fill asked twice and a padded frame each turn it red. Not counted: the io_uring
path a forced miss bypasses, QUIC's own framing, and the viewer's choice of what to ask, since the downloader is
driven directly.

Then open in Chrome:

- The viewer, the product's page: `http://127.0.0.1:8765/`. The smoke series' frames are placeholders and do not
  decode, so give it a series of your own (§The viewer on a DICOM series). `"client": "wasm"` in
  `client/dev-transport.json` loads it over the WASM client.
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

  The query parameters are listed in `lab/harness/shell.js`.
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

`lab/harness/cellcheck.sh` runs both pages headless in one go, after the c512 frames above: the cells over both
clients must each deliver what they asked, the refuse cell none of it, and the self-check must pass. It makes its
own server, bundle and certificate, so it needs neither terminal nor step 2; the gate does not run it.
`scripts/wtcompat.py --fetch DIR` fetches the newest Chrome and Firefox builds and fails if any no longer dials the
server, gets frame 0 exact, or offers a different WebTransport draft or `reset_stream_at` than `scripts/wtcompat.json`
expects ([`docs/transport/transport-conclusions.md`](docs/transport/transport-conclusions.md) §3); the gate does not run it.
`deploy/check_equivalence.sh` checks that the web image answers every path the viewer loads exactly as
`server/dev-server.py` does, and nothing else; it needs podman or docker, or nginx with `--local`, which the gate runs
([`deploy/README.md`](deploy/README.md)). `--local` wants nginx on PATH (`/usr/sbin` on Debian),
`server/scripts/gen_dev_cert.sh` run first, and a checkout nginx's worker can read (not under a `0700` directory).
`lab/scripts/server_ab.sh` runs the binaries under `target/release`, so it wants `CARGO_TARGET_DIR` unset, and a
`LOGDIR` given to it must exist.

## The read path on your machine

`lab/scripts/workstation_run.sh` measures the server's read path on the machine it runs on and packs one report to
send back: the host, whether io_uring works natively and in the deploy's container, the two readers against every
variant, and the server with the ring against the pool, each with an A/A arm. `--plan` prints the time and disk it
needs and exits; `--quick` runs one round as a first try. What each part answers, and how cold is made without
eviction: [`docs/adr/disk-access.md`](docs/adr/disk-access.md) §12, *On the workstation, in one command*.

## The viewer on a DICOM series

One series, ingested once, then one terminal per server:

```bash
cargo build --release -p series-server -p pack-series && ingest/tools.sh   # once, with the venv of §Prerequisites
.venv/bin/python ingest/from-dicom/from_dicom.py ingest/.build path/to/series target/my.sbnd
#   (a folder of one series' single-frame objects, or one multi-frame object; docs/FIXTURES.md §From DICOM)

# Terminal 1 — the WebTransport server, on the dev certificate
target/release/series-server --port 4433 --series target/my.sbnd \
  --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem

# Terminal 2 — the static host: the viewer at /, the series' metadata at /series/metadata;
#   it makes the dev certificate when it is missing or ends within a day
python3 server/dev-server.py --port 8765 --metadata target/my.metadata.json
```

A lossy series and its exact series (client/README.md §A lossy series, exact on request) run as two servers, the
static host naming the second by the id the lossy metadata gives:

```bash
target/release/series-server --port 4434 --series target/my-exact.sbnd \
  --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem   # beside the lossy series' on 4433
sed 's/:4433/:4434/' client/dev-transport.json > target/exact-transport.json
python3 server/dev-server.py --port 8765 --metadata target/my-lossy.metadata.json \
  --exact-metadata target/my-exact.metadata.json --exact-transport target/exact-transport.json
```

Open `http://127.0.0.1:8765/`. The wheel and the arrow keys step; space or the button runs the cine; a drag moves
window and level, a shift or right drag pans, ctrl-wheel and `+`/`-` zoom; `r` turns, `h` and `v` flip, `i`
inverts, `0` resets, `l` on a lossy series shows the frame lossless and back; `?fill=0` asks each frame as it is stepped to instead of filling the series. Its check is
`client/viewer/check.mjs` ([`client/README.md`](client/README.md) §The viewer).

Both clients and the TCP fallback are [`docs/CLIENTS.md`](docs/CLIENTS.md); the bytes they speak, [`docs/WIRE.md`](docs/WIRE.md).

**What the gate costs and what it catches** — mutants made by hand at each decision, run by the step that owns the code: the
downloader's in [`client/README.md`](client/README.md) §Every decision is held by a test; the decoder modules
45 of 45; the send path (`planner.rs`, `pipeline.rs`, and `frame_out.rs`, now `link.rs`) 20 of 24, the four alive being log lines
and a lab-only stall's equivalent sends; the series bundle's reader and writer 10 of 10. Its time, the gate-time measurement
(queue row GATE, 2026-10-07, 4 cores, warm builds): `--quick` 161 → 106 s once the two timer-bound steps ran side by side; the
before-and-after table is at `git show 0d293c89^:README.md`, and each step's time is in the gate's own log.

**What the nightly times and what it claims** — `.github/workflows/perf-nightly.yml` runs `scripts/perf_nightly.mjs`
nightly on `claude/av1-unified-mainbase` against itself 24 hours earlier, and on a pull request labelled `perf` against
its base: both trees built, the gate's grey codestream 48 times filled through the downloader on the total-time
harness (`r50000`, 1×, Chromium; [`lab/av1/delivery/total-time/README.md`](lab/av1/delivery/total-time/README.md)),
the base, the head and the base again in `lab/order.mjs`'s order, 12 rounds and 12 confirming, the fill and the first
frame judged by row NETRULES' A/A rule ([`lab/scripts/aa_rule.py`](lab/scripts/aa_rule.py)). A cell is flagged only
when both campaigns flag it; *worse* turns the nightly red, never a pull request. On this repository's 4-core
container (row PERFNIGHTLY, 2026-10-15): the base against itself a tie (fill A/A sd 0.3 %, a loss of 0.6 % caught);
a 10 ms sleep a frame in the server's send path worse on both cells (fill ×1.155); a 2 ms one flagged too (first
frame ×1.015 worse, fill ×0.988 better). The fill there follows the link to 200 Mbit/s (0.51, 0.45, 0.38 s at 50,
100, 200) and no further (0.37 at 400 and 800), so the host is not what bounds `r50000`. It claims a difference
between two trees that repeats on that runner, that series and that link: no number for another host, a series that
decodes longer, a slower CPU or another engine; a schedule fires from the default branch's copy of the workflow only.

## Demo

Optimal quality: every reader sees a series' visually lossless AV1 view, and a frame comes whole from its exact HTJ2K
series only when **Lossless** is pressed ([`client/README.md`](client/README.md) §A lossy series, exact on request).
The demo set is three breast tomosynthesis volumes, `dbts_a1` (56 frames, 12-bit), `dbts_b1` (50, 10-bit) and `dbts_c1`
(69, 12-bit), each as its exact series and its optimal-quality series at Q 8 and Q 24, G 1, 8 and 16; the 12-bit two
as depth cuts (`…-cut`, 10-bit codes WebCodecs decodes) plus one 12-bit stored form each (`…-q8-g16-stored`).

**Once, from a fresh checkout on a laptop** — §Prerequisites (Linux x86-64; docker for the decoders; cmake, ninja,
meson, nasm and a C++ compiler for the coders; `python3.11`, or `PYTHON=` another 3.11–3.13, for the data's venv):

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.15.0 --locked
npm i -g playwright@1.56.1 && npx playwright install chromium   # demo-check.mjs only
client/decode/wasm/build/build.sh                # the page's decoders, dav1d and OpenJPH as WASM (~5 min)
bash client/transport/wasm/build.sh && bash client/transport/ts/build.sh
./server/scripts/gen_dev_cert.sh                 # valid 10 days: make it again before the demo day
cargo build --release -p series-server
scripts/demo-series.sh                           # ingest/tools.sh, the three volumes fetched, 23 series coded:
                                                 #   ~20 min on 4 cores; demo-series/ID.sbnd and ID.metadata.json
```

**One series**, three terminals — the optimal-quality series, its exact series, the static host:

```bash
ID=dbts_a1-q8-g8-cut; EXACT=${ID%%-*}            # any demo-series/ID; its exact series is the part before the first -
target/release/series-server --port 4433 --series demo-series/$ID.sbnd \
  --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem
target/release/series-server --port 4434 --series demo-series/$EXACT.sbnd \
  --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem
sed 's/:4433/:4434/' client/dev-transport.json > target/exact-transport.json
python3 server/dev-server.py --port 8765 --metadata demo-series/$ID.metadata.json \
  --exact-metadata demo-series/$EXACT.metadata.json --exact-transport target/exact-transport.json
```

Open `http://127.0.0.1:8765/?overlay=1` in Chrome; without `?overlay=1` the page is the reader's, label and status
line only. To change series, stop the three and start them again with another `ID`. **A rehearsal**, with the three
stopped: `NODE_PATH=$(npm root -g) node client/viewer/demo-check.mjs demo-series $ID` runs the commands above, opens the page in headless
Chromium as below, and fails by name a frame not painted, a decode route other than WebCodecs (`--route av1-dav1d` for
a stored form), a console error, a label out of order, an on-demand jump that asked other than whole groups, or
*Lossless* shown for an exact frame whose digest was made wrong.

**On a phone**: the laptop serves as above, the phone opens the page over USB; follow §The viewer on an Android phone
(on `claude/phone-setup` until merged). The pair needs two changes to it: open `4434/udp` as well as `4433/udp` in
step 2, and in step 3 write the exact series' transport file with the laptop's address too,
`sed 's/:4433/:4434/' target/phone-transport.json > target/exact-transport.json`, then start the static host with
`--transport target/phone-transport.json` and the three `--metadata`/`--exact-*` options above.

**What to show, in order:**

1. `dbts_a1-q8-g8-cut`. The picture arrives, the label top right says *Optimal quality*. Scroll with the wheel or the
   arrows: every slice is already here. `End` jumps. Press `l`: *Optimal quality · fetching lossless…*, then
   *Lossless* in green once the exact frame's digest matched and it was painted; `l` again goes back. Step off the frame
   and it is optimal quality again.
2. A narrow window (drag left on the image) on the same frame, `l` and back: where the coding error would show, if
   anywhere.
3. `dbts_b1-q8-g8`: a 10-bit volume coded at its own depth, 2560 × 3328, the largest frame.
4. `dbts_a1-q24-g8-cut` for contrast: a twentieth of Q 8's bytes; the same narrow window and `l` against it.
5. `dbts_a1-q8-g16-stored`: the same view coded at 12 bits; the overlay shows `av1-dav1d after WebCodecs refused: …`,
   the fallback.
6. With `?fill=0` added to the URL, nothing is asked ahead: a jump decodes its group from the keyframe and lands it whole,
   and stepping through that group asks nothing more.
7. The bytes: `scripts/demo-series.sh`'s last table, each series as a fraction of its exact series' bundle.

**What is on screen:**

* **The label**, top right: what is painted. *Optimal quality*, the AV1 view; *fetching lossless…* while the exact frame
  is asked; *Lossless* only after that frame's XXH3-64 digest matched its exact series' metadata and it was painted;
  *Lossless check failed* in red otherwise, the optimal-quality frame kept and the reason on the status line.
* **The mark**, top left: *unchecked* on every optimal-quality frame, since a lossy frame has no digest to check; gone
  under *Lossless*.
* **The overlay** (`?overlay=1`): the painted frame's decode route (`av1-webcodecs`, Chrome's `VideoDecoder`; `av1-dav1d`,
  the page's WASM, with WebCodecs' refusal), its bytes on the wire in KB, its decode time in ms, and the series' Q
  (the encoder's quantizer: higher, more error), G (frames per keyframe) and depth (*depth cut of 12*: 10-bit codes of a
  12-bit series).
* **The status line**: the frame shown of the series; the transport client (`ts`); where frames are held (`page`);
  frames received, of which exact, not exact and unchecked (an optimal-quality frame is unchecked; the exact frame does
  not count here); frames per decode route; the codec; the GPU renderer, *(software)* when it is not a GPU; the fill's
  time from the connect to the last frame received, or *on demand* under `?fill=0`; the last error.

**What a headless container cannot show**, and where the demo's own numbers come from: no GPU (Chromium paints on
SwiftShader, *(software)* on the status line), no hardware decoder (WebCodecs' AV1 is Chrome's software decoder here
and on the laptop: the product asks `prefer-software`), no phone, no real link (loopback), no reader's eye. What it ran,
and its numbers, are in [`client/README.md`](client/README.md) §A lossy series, exact on request.

## Docs

Each subject has one owner; a claim lives there, corrected in place when it is wrong (`CLAUDE.md` §Docs).

| doc | owns |
| --- | --- |
| [`docs/glossary.md`](docs/glossary.md) | every project term, defined once |
| [`docs/WIRE.md`](docs/WIRE.md) | the wire: FoD messages, the envelope, stream modes, an ask during a fill, the WebSocket mapping |
| [`docs/CLIENTS.md`](docs/CLIENTS.md) | the client contract: the transport seam, its implementations, the contract suite |
| [`docs/FIXTURES.md`](docs/FIXTURES.md) | the fixtures and how each is made |
| [`server/README.md`](server/README.md) | the server's map: how a session's data flows, which object does what, what runs where |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | the client above the transport: downloader, decoders, consumer; the session's open, survival and fallback |
| [`docs/transport/transport-conclusions.md`](docs/transport/transport-conclusions.md) | what the transport measured and chose, why, and what is open |
| [`docs/decode/README.md`](docs/decode/README.md) | the decoder: builds, dispatch, warm-up, the range, the decode tail |
| [`docs/adr/disk-access.md`](docs/adr/disk-access.md) | how the server reads frame bytes, and its deployment |
| [`docs/rig-limits.md`](docs/rig-limits.md) | what the measurement hosts can and cannot claim |
| [`docs/levers.md`](docs/levers.md) | every lever outside the codecs: tried, closed or open, and the rows proposed next |
| [`lab/README.md`](lab/README.md) | which lab directory reproduces which claim; each lab README runs its cells — [`lab/page-open/README.md`](lab/page-open/README.md) the page open |
| [`docs/adr/`](docs/adr/README.md) | the decisions, one per record, indexed with their status: stream shape, the session loop, ask window, stride, resolution fitting, what the server refuses to do, the read path, idle sessions, receive windows, telemetry |
| [`docs/transport/upstream-*.md`](docs/transport/) | upstream drafts, not filed |
| [`docs/cloud-queue.md`](docs/cloud-queue.md) | the work queue, closed: its protocol and where each row's verdict lives; an open decision is in its owning doc's §Open |
| [`docs/codecs/`](docs/codecs/README.md) | the codecs side by side — HTJ2K, AV1, JPEG XL, JPEG 2000, AV2 — which carries which series, and why |
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
