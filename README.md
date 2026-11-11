# wt-pacs

WebTransport PACS — web-native medical imaging transport (MIT).

## Prerequisites

Linux on x86-64 (the server's read path uses io_uring; the pinned `wasm-opt` is x86-64), Rust 1.88 or newer
with `rustup`, Node 22 (`.nvmrc`), Python 3.11 to 3.13, and on PATH: git, curl, tar, sha256sum,
openssl, jq, binutils' `nm` and `strings`, and docker, in which the full gate rebuilds the decoders (`--quick` skips it, and so does its absence, by name).
The first builds fetch from crates.io, npm and GitHub.

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.15.0 --locked
npm i -g playwright@1.56.1 && npx playwright install chromium
bash client/decode/wasm/fetch_openjph.sh            # the HTJ2K decoder the page runs
bash client/decode/wasm/fetch_xxh3.sh               # the reference the frame check's hash is tested against
```

One more opens what the gate otherwise skips, by name, in its log:

```bash
python3 -m venv .venv && .venv/bin/pip install --require-hashes -r ingest/requirements.txt
                                                    # numpy, pydicom, xxhash, blake3 (CPython 3.11–3.13): PYTHON=.venv/bin/python
```

In a cloud container, where nothing starts the Docker daemon and no `meson` is installed, first start the daemon,
`(dockerd >/tmp/dockerd.log 2>&1 &)`, wait until `docker info` answers, and `pip install meson==1.9.1`. After a
branch switch, run `ingest/tools.sh` again: the gate does not check `ingest/.build` for staleness, and a decoder
built from another branch's `ingest/coded-frames/decode.cpp` fails the optimal-quality claims.

With the first, the dispatch rig runs all of its checks, the real-decode ones on npm's OpenJPH and on the
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
# 1. Build the clients (once, and after changes; pkg/ is not tracked, dist/session.js is committed and pinned)
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

# 5. Before pushing: the gate (about 330 s on 4 cores, warm builds, 150 s of it the decoders' rebuild); --no-browser skips the browser steps, --quick the rebuild and two absence checks
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

An optimal-quality series and its exact series (client/README.md §Optimal quality, exact on request) run as two servers, the
static host naming the second by the id the lossy metadata gives:

```bash
target/release/series-server --port 4434 --series target/my-exact.sbnd \
  --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem   # beside the optimal-quality series' on 4433
sed 's/:4433/:4434/' client/dev-transport.json > target/exact-transport.json
python3 server/dev-server.py --port 8765 --metadata target/my-lossy.metadata.json \
  --exact-metadata target/my-exact.metadata.json --exact-transport target/exact-transport.json
```

Open `http://127.0.0.1:8765/`. The wheel and the arrow keys step; space or the button runs the cine; a drag moves
window and level, a shift or right drag pans, ctrl-wheel and `+`/`-` zoom; `r` turns, `h` and `v` flip, `i`
inverts, `0` resets, `l` on an optimal-quality series shows the frame lossless and back; `?fill=0` asks each frame as it is stepped to instead of filling the series. Its check is
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
decodes longer, a slower CPU or another engine; a schedule fires from the default branch's copy of the workflow only. By hand it takes more cells (`--impairs`, `--throttles`), an asked-frame cell (`--asks K`), the product's viewer in every arm with the head's under a view (`--view worker`), and keeps its rows (`--out DIR`), a visit already there not run again ([`scripts/perf_campaign.mjs`](scripts/perf_campaign.mjs)).

## Demo

Optimal quality: every reader sees a series' visually lossless AV1 view, and a frame comes whole from its exact HTJ2K
series only when **Lossless** is pressed ([`client/README.md`](client/README.md) §Optimal quality, exact on request).
The demo set is three breast tomosynthesis volumes, `dbts_a1` (56 frames, 12-bit), `dbts_b1` (50, 10-bit) and `dbts_c1`
(69, 12-bit), each as its exact series and its optimal-quality series at Q 8 and Q 24, G 1, 8 and 16; the 12-bit two
as depth cuts (`…-cut`, 10-bit codes WebCodecs decodes) plus one 12-bit stored form each (`…-q8-g16-stored`).

**Once, from a fresh checkout on a laptop** — §Prerequisites (Linux x86-64; docker for the decoders; cmake, ninja,
meson, nasm and a C++ compiler for the coders; `python3.11`, or `PYTHON=` another 3.11–3.13, for the data's venv):

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --version 0.15.0 --locked
npm i -g playwright@1.56.1 && npx playwright install chromium   # demo-check.mjs only
# client/decode/wasm/build/build.sh              # optional: the page's decoders are committed; this rebuilds them in
                                                 #   docker from Docker Hub's image and checks their hashes (~5 min)
bash client/transport/wasm/build.sh && bash client/transport/ts/build.sh
./server/scripts/gen_dev_cert.sh                 # valid 10 days: make it again before the demo day
cargo build --release -p series-server
scripts/demo-series.sh                           # ingest/tools.sh, the three volumes fetched, 23 series coded:
                                                 #   ~20 min on 4 cores; demo-series/ID.sbnd and ID.metadata.json
```

**One series**, three terminals — the optimal-quality series, its exact series, the static host. Each terminal starts at
the repository's root and sets `ID` first; the certificate is renewed, when it ends within a day, before any server
loads it (the static host would renew it after, and the page would pin a hash the two servers do not have):

```bash
# Every terminal first — any demo-series/ID; its exact series is the part before the first -
ID=dbts_a1-q8-g8-cut; EXACT=${ID%%-*}
# Terminal 1, before the others — the certificate, then the optimal-quality series
./server/scripts/gen_dev_cert.sh --if-needed
target/release/series-server --port 4433 --series demo-series/$ID.sbnd \
  --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem
# Terminal 2 — its exact series
target/release/series-server --port 4434 --series demo-series/$EXACT.sbnd \
  --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem
# Terminal 3 — the static host, which hands the page the exact series' server on 4434
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

**Before the demo, from any state** — another branch checked out, stale builds, servers left running, an old
certificate. On the laptop, at the repository's root, on the demo's branch:

```bash
pkill -f 'release/series-server' ; pkill -f 'server/dev-server.py' ; adb reverse --remove-all 2>/dev/null
git status --short                               # nothing of yours uncommitted, then:
git pull --rebase
bash client/transport/wasm/build.sh && bash client/transport/ts/build.sh
cargo build --release -p series-server
[ -f demo-series/dbts_c1-q8-g16-stored.sbnd ] || scripts/demo-series.sh     # the last series it writes
./server/scripts/gen_dev_cert.sh --if-needed
for ID in $(ls demo-series | sed -n 's/\.metadata\.json$//p' | grep -- -q); do
  R=; [[ $ID == *-stored ]] && R="--route av1-dav1d"
  NODE_PATH=$(npm root -g) node client/viewer/demo-check.mjs demo-series $ID $R | tail -1
done                                             # 20 lines, each "demo check: ID passed"; ~1 min a series
```

Then the one series above, three terminals, in Chrome on the laptop.

**On a phone**: the laptop serves the pair, the phone opens the page over USB. Once per phone and laptop, and per
plug-in, §The viewer on an Android phone, steps "Once", 1 and 2 (they write `target/phone.env`); then, in place of the
three terminals above:

```bash
# Every terminal first
. target/phone.env; ID=dbts_a1-q8-g8-cut; EXACT=${ID%%-*}
# Terminal 1, before the others — the certificate, both transport files naming the laptop's address, the series
./server/scripts/gen_dev_cert.sh --if-needed
HASH=$(openssl x509 -in server/dev-cert/cert.pem -outform DER | openssl dgst -sha256 | awk '{print $2}')
for p in 4433 4434; do
  printf '{"wt_url": "https://%s:%s/", "cert_sha256": "%s"}\n' "$LAPTOP_IP" "$p" "$HASH" > target/phone-transport-$p.json
done
target/release/series-server --port 4433 --series demo-series/$ID.sbnd \
  --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem
# Terminal 2 — its exact series
target/release/series-server --port 4434 --series demo-series/$EXACT.sbnd \
  --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem
# Terminal 3 — the static host, then the page's port on the phone
python3 server/dev-server.py --port 8765 --metadata demo-series/$ID.metadata.json \
  --transport target/phone-transport-4433.json \
  --exact-metadata demo-series/$EXACT.metadata.json --exact-transport target/phone-transport-4434.json
# Terminal 4
adb reverse tcp:8765 tcp:8765
```

On the phone, Chrome, `http://127.0.0.1:8765/?overlay=1`. Nothing arriving: that section's step 4 (`tcpdump`).
Afterwards, `adb reverse --remove-all` and USB tethering off.

**What to show, in order:**

1. `dbts_a1-q8-g8-cut`. The picture arrives, the label top right says *Optimal quality*. Scroll with the wheel or the
   arrows: every slice is already here. `End` jumps to the last slice, mid-group at G 8 and 16. Press `l`: *Optimal quality · fetching lossless…*, then
   *Lossless* in green once the exact frame's digest matched and it was painted; `l` again goes back. Step off the frame
   and it is optimal quality again.
2. A narrow window (drag left on the image) on the same frame, `l` and back: where the coding error would show, if
   anywhere.
3. `dbts_b1-q8-g8`: a 10-bit volume coded at its own depth, 2560 × 3328, the largest frame.
4. `dbts_a1-q24-g8-cut` for contrast: a twentieth of Q 8's bytes; the same narrow window and `l` against it.
5. `dbts_a1-q8-g16-stored`: the same view coded at 12 bits; the overlay shows `av1-dav1d after WebCodecs refused: …`,
   the fallback.
6. At `http://127.0.0.1:8765/?overlay=1&fill=0`, nothing is asked ahead: a jump decodes its group from the keyframe and lands it whole,
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
and its numbers, are in [`client/README.md`](client/README.md) §Optimal quality, exact on request.

## The viewer on an Android phone

Chrome on the phone, the two servers on a Fedora laptop, one USB cable. The page comes over `adb reverse` and the
session over an IP link between the two, because adb carries TCP and nothing else: `adb help` lists, after "reverse
socket connection using:", `tcp:<port>`, `localabstract:`, `localreserved:` and `localfilesystem:`, and no UDP for
`forward` either ([adb's own help](https://android.googlesource.com/platform/packages/modules/adb/+/refs/heads/main/client/commandline.cpp);
its sockets are `SOCK_STREAM`, `socket_spec.cpp` beside it), and WebTransport is QUIC, over UDP. The page at
`http://127.0.0.1:8765` is a secure context — "If origin’s host matches one of the CIDR notations 127.0.0.0/8 or ::1/128
[RFC4632], return "Potentially Trustworthy"" ([Secure Contexts](https://www.w3.org/TR/secure-contexts/)) — which
`WebTransport`, `[Exposed=(Window,Worker), SecureContext]`, needs ([WebTransport](https://www.w3.org/TR/webtransport/)).
The dev certificate is pinned by hash, and pinning asks: "the certificate MUST be an X.509v3 certificate […], the key
used in the Subject Public Key field MUST be one of the allowed public key algorithms, the current time MUST be within
the validity period […] and the total length of the validity period MUST NOT exceed two weeks", the algorithms
including "ECDSA with the secp256r1 (NIST P-256) named group" (*ibid.*, *custom certificate requirements*).
`gen_dev_cert.sh` makes a P-256 certificate for 10 days; no flag is needed. The certificate names `127.0.0.1` only, and
the spec's requirements name no host — *derived*; checked in Chromium 153, which dialed the laptop's other address on
it.

**Once, on the phone:** the **Build number** option (Settings > About phone > Build number on a Pixel; Settings >
About phone > Software information > Build number on a Samsung Galaxy S8 and later; other makers in the source's
table), tapped "seven times until you see the message `You are now a developer!`", then, on Android 9 and higher,
Settings > System > Advanced > Developer Options > USB debugging on
([Android developers](https://developer.android.com/studio/debug/dev-options)). **Once, on the laptop**, with the
decoder builds of §Prerequisites (the page refuses one it does not have, by name) and §The viewer on a DICOM series'
bundle; the package names are Fedora's, *unverified*:

```bash
sudo dnf install -y android-tools iproute-tc tcpdump kernel-modules-extra   # adb; tc; netem lives in -extra
adb devices                                       # the phone asks "Allow USB debugging?": allow; then "device"
```

**1 · The link.** Plug in, then on the phone "swipe down from the top of the screen", "Touch and hold Hotspot", "Turn
on **USB tethering**" ([Android help](https://support.google.com/android/answer/9059108)). NetworkManager brings the
new interface up with an address from the phone (*unverified*); that address faces the phone. The interface is found by its USB network
driver, and Wi-Fi is the fallback when tethering is off or the phone lacks it (both on one network that lets clients
see each other, or the laptop joined to the phone's hotspot); `adb` stays on the cable either way:

```bash
IF=$(for d in /sys/class/net/*; do case $(readlink -f "$d/device/driver") in */rndis_host|*/cdc_ncm|*/cdc_ether) echo "${d##*/}";; esac; done | head -1)
[ -n "$IF" ] || IF=$(nmcli -t -f DEVICE,TYPE,STATE device | awk -F: '$2=="wifi" && $3=="connected" {print $1; exit}')
LAPTOP_IP=$(ip -4 -o addr show dev "$IF" | awk '{print $4}' | cut -d/ -f1 | head -1)
[ -n "$LAPTOP_IP" ] && printf 'IF=%s\nLAPTOP_IP=%s\n' "$IF" "$LAPTOP_IP" | tee target/phone.env ||
  echo "no tether or Wi-Fi interface with an IPv4 address: target/phone.env not written" >&2   # else `. target/phone.env` in each terminal
```

UDP over that link is ordinary IP — *derived*; *unverified* on the device, and the dial in step 4 is the check. Whether
`adb devices` still lists the phone with tethering on is *unverified*: if it does not, use Wi-Fi.

**2 · The firewall.** Fedora's firewalld may drop UDP 4433, and 4434 for a pair's exact series, on the zone that
interface lands in; this opens both for 12 hours:
"the rule will be active for the specified amount of time and will be removed automatically afterwards" (`--add-port`, [firewall-cmd(1)](https://firewalld.org/documentation/man-pages/firewall-cmd.html)):

```bash
. target/phone.env
if sudo firewall-cmd --state >/dev/null 2>&1; then
  ZONE=$(sudo firewall-cmd --get-zone-of-interface="$IF" 2>/dev/null | grep -vx 'no zone') || ZONE=$(sudo firewall-cmd --get-default-zone)
  sudo firewall-cmd --zone="$ZONE" --add-port=4433/udp --add-port=4434/udp --timeout=12h
fi
```

**3 · The servers.** The page dials the transport file's URL and hash, so the phone gets its own file naming the
laptop's address; `--transport` turns off the static host's own renewal, so the certificate is renewed first and the
hash read after:

```bash
. target/phone.env
./server/scripts/gen_dev_cert.sh --if-needed
HASH=$(openssl x509 -in server/dev-cert/cert.pem -outform DER | openssl dgst -sha256 | awk '{print $2}')
printf '{"wt_url": "https://%s:4433/", "cert_sha256": "%s"}\n' "$LAPTOP_IP" "$HASH" > target/phone-transport.json
# Terminal 1 — the server binds every address by default
target/release/series-server --port 4433 --series target/my.sbnd \
  --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem
# Terminal 2 — the static host, on the laptop's loopback alone
python3 server/dev-server.py --port 8765 --metadata target/my.metadata.json --transport target/phone-transport.json
```

A new certificate is a new hash: after any renewal, write the file again and restart Terminal 2.

**3b · A pair.** An optimal-quality series and its exact series (§The viewer on a DICOM series) run as two servers;
the exact series' transport file names the laptop's address too, on 4434. In place of Terminals 1 and 2 above:

```bash
. target/phone.env
./server/scripts/gen_dev_cert.sh --if-needed
HASH=$(openssl x509 -in server/dev-cert/cert.pem -outform DER | openssl dgst -sha256 | awk '{print $2}')
for p in 4433 4434; do
  printf '{"wt_url": "https://%s:%s/", "cert_sha256": "%s"}\n' "$LAPTOP_IP" "$p" "$HASH" > target/phone-transport-$p.json
done
# Terminal 1 — the optimal-quality series
target/release/series-server --port 4433 --series target/my-lossy.sbnd \
  --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem
# Terminal 3 — its exact series
target/release/series-server --port 4434 --series target/my-exact.sbnd \
  --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem
# Terminal 2 — the static host, naming the exact series by the id the lossy metadata gives
python3 server/dev-server.py --port 8765 --metadata target/my-lossy.metadata.json \
  --transport target/phone-transport-4433.json \
  --exact-metadata target/my-exact.metadata.json --exact-transport target/phone-transport-4434.json
```

`l` on the phone then fetches the frame from 4434; the label reads *Lossless* only once its digest matched.

**4 · The page.** `adb reverse tcp:8765 tcp:8765`, then open `http://127.0.0.1:8765/` in Chrome on the phone. Without
`adb reverse`, `chrome://inspect`'s port forwarding does the same: "a listening TCP port on your Android device that
maps to a TCP port on your development machine" — **Port forwarding**, `8765` → `127.0.0.1:8765`, **Enable port
forwarding** ([Chrome DevTools](https://developer.chrome.com/docs/devtools/remote-debugging/local-server)). The status
line reads `received N, exact N` once frames arrive, and Terminal 1 logs `session path … rtt_us=` when the session
closes. When nothing arrives, `sudo tcpdump -ni "$IF" udp port 4433 -c 5` (4434 when `l` stalls on a pair): no packets, the phone is not reaching that
address (Wi-Fi isolation; the other link); packets but no session, the firewall or the server.

**5 · The console.** On the laptop's Chrome, `chrome://inspect#devices`, "Make sure Discover USB devices is enabled",
and **Inspect** beside the page ([Chrome DevTools](https://developer.chrome.com/docs/devtools/remote-debugging));
Chrome also lists the phone through the running adb server (`AdbDeviceProvider`, port 5037, in Chromium's
`devtools_android_bridge.cc`). The frame overlay: "Open the Rendering tab and enable the Frame rendering stats checkbox"
([Chrome DevTools](https://developer.chrome.com/docs/devtools/rendering/performance)). A DevTools session changes what
the browser does: close it before a timed run ([`docs/devices.md`](docs/devices.md) §3).

**6 · Which AV1 decoder.** The status line's `decoders:` counts frames per path: `av1-webcodecs` (Chrome's
`VideoDecoder`), `av1-dav1d` (the page's own WASM), `htj2k`. The product configures WebCodecs with
`hardwareAcceleration: "prefer-software"` (`client/decode/av1-webcodecs.js`), and under it Chrome builds no platform
decoder: `if (hardware_preference_ != HardwarePreference::kPreferSoftware)` guards the `MojoDecoderFactory`
([Chromium, `video_decoder_broker.cc`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/modules/webcodecs/video_decoder_broker.cc))
— so expect software (*derived*). To read Chrome's own record: `chrome://media-internals` gets a decoder's log only
from a window — "For chrome://media-internals. This should only be created in the main Window context, and not from a
worker context" ([Chromium, `renderer_blink_platform_impl.cc`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/content/renderer/renderer_blink_platform_impl.cc))
— and the product decodes in workers, so read DevTools' Media panel instead ("More Options > More tools > Media",
[Chrome DevTools](https://developer.chrome.com/docs/devtools/media-panel)), which a worker logs to as well (the same
function, *derived*): the decoder's
properties `kVideoDecoderName` — `Dav1dVideoDecoder` is software, `MediaCodecVideoDecoder` Android's platform decoder
([Chromium, `media/base/decoder.cc`](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/media/base/decoder.cc))
— and `kIsPlatformVideoDecoder`. Whether the panel lists a worker's decoder on the phone, and under what label, is
*unverified*.

**7 · Shaping the link.** The lab's shaping, on the laptop's egress toward the phone: one `netem` with delay, rate and
loss, the profile naming the round trip and each packet delayed half of it, iid loss or Gilbert–Elliott
(`lab/scripts/cloud_netem.sh`, which takes the interface from `IFACE`; [`docs/rig-limits.md`](docs/rig-limits.md) §3).
netem's own example reads "Delay all outgoing packets on device eth0" ([tc-netem(8)](https://man7.org/linux/man-pages/man8/tc-netem.8.html)),
so the phone's packets to the laptop are not shaped:

```bash
. target/phone.env
sudo modprobe sch_netem                                            # "Specified qdisc kind is unknown" without it
sudo env IFACE="$IF" RATE=20mbit lab/scripts/cloud_netem.sh 60 1           # 30 ms each way, 20 Mbit/s, 1 % iid
sudo env IFACE="$IF" RATE=20mbit lab/scripts/cloud_netem.sh 60 1 gemodel   # loss in bursts, GE_P/GE_R
tc -s qdisc show dev "$IF"                                         # netem 10: with its delay, rate, loss and drops
sudo env IFACE="$IF" lab/scripts/cloud_netem.sh off                # back to the interface's default
```

Under loss, netem on the sending host drops a whole GSO batch as one packet, so the server for a loss cell is the lab
build with each datagram sent alone (§3 again):

```bash
cargo build --release -p series-server --features lab-levers --target-dir target/levers
target/levers/release/series-server --port 4433 --series target/my.sbnd --segmentation-offload false \
  --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem
```

For a pair, both servers are the lab build: `--port 4433` with the optimal-quality series, `--port 4434` with its exact
series, each with `--segmentation-offload false`.

The shaped round trip is Terminal 1's `rtt_us` per session. **Afterwards:** `cloud_netem.sh off` as above,
`adb reverse --remove-all`, USB tethering off; the firewall's port closes itself.

*Checked in a container (2026-11-09):* the page over a TCP tunnel to a network namespace's loopback, standing in for
`adb reverse`, and the session over a veth pair, standing in for the tether: headless Chromium 153 in the namespace
delivered the cell's 3 frames of 3 and the viewer's session reached the server, dialing the veth's address on the dev
certificate's hash. `netem` does not load in that container ("Specified qdisc kind is unknown"); iproute2 6.1 parsed
netem's arguments as the script passes them, iid and `gemodel` (and refused a misspelt one, `What is "lxss"?`). The phone, its Chrome, the tether, firewalld and the Media panel were not checked.

*A pair, checked the same way (2026-11-10):* step 3b's commands on a synthetic 10-bit pair (256×192, 24 frames,
HTJ2K and Q 8 G 8, `lossy_test.py`'s pattern), on this branch merged onto `claude/oq-depth-cut`, which has the exact
flags. Headless Chromium 153 in the namespace filled 24 of 24 frames through `av1-webcodecs` from 4433, *Optimal
quality*; `l` fetched frame 1 from 4434 over the veth, decoded it through `htj2k` and read *Lossless*. One digest
altered in the exact metadata read *Lossless check failed* instead; the exact transport file naming `127.0.0.1` never
reached *Lossless*. Not checked: a real pair from `demo-series.sh`, a depth cut, and everything on the phone above.

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
