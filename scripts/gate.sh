#!/usr/bin/env bash
# Before pushing, fail-fast. What it needs: README.md §Prerequisites.
#   scripts/gate.sh [--quick] [--no-browser]   --quick skips the two absence checks
# CARGO_TARGET_DIR is respected; the server absence check builds a default-feature release.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
quick=0
browser=1
for arg in "$@"; do
  case "$arg" in
    --quick) quick=1 ;;
    --no-browser) browser=0 ;;
    *) echo "usage: scripts/gate.sh [--quick] [--no-browser]" >&2; exit 2 ;;
  esac
done

LOG="$(mktemp -d)"
trap 'rm -rf "$LOG"' EXIT
t0=$SECONDS
step() { printf '\n== %s\n' "$*"; }
# run N CMD...: the last N lines on success, every line on failure; SKIPPED lines kept for the recap.
run() {
  local n=$1; shift
  local t=$SECONDS out="$LOG/step"
  if "$@" >"$out" 2>&1; then
    tail -n "$n" "$out"
    grep -h 'SKIPPED' "$out" >>"$LOG/skipped" || true
    printf '   (%d s)\n' $((SECONDS - t))
  else
    cat "$out"
    printf '\nGATE FAILED: %s\n' "$*" >&2
    exit 1
  fi
}
skip() { echo "SKIPPED: $*" | tee -a "$LOG/skipped"; }
PYTHON="${PYTHON:-python3}"
numpy=0
"$PYTHON" -c "import numpy" 2>/dev/null && numpy=1

step "prerequisites: built clients newer than their sources; playwright, Chromium and the decoder vendor"
source client/contract/browser_env.sh
require_transport_wasm
built=client/decode/wasm/built
if [[ -f "$built/THIRD_PARTY_NOTICES" ]]; then
  stale="$(find client/decode/wasm/build client/decode/wasm/openjph client/decode/wasm/dav1d/dav1d_wrap.c client/decode/wasm/xxh3 -newer "$built/THIRD_PARTY_NOTICES" \
    -type f ! -path '*/.cache/*' ! -name manifest.sha256 ! -name README.md -print -quit)"
  [[ -z "$stale" ]] || { echo "stale $built: $stale is newer; client/decode/wasm/build/build.sh" >&2; exit 2; }
  (cd "$built" && sha256sum -c --quiet ../build/manifest.sha256) \
    || { echo "$built is not the build client/decode/wasm/build/manifest.sha256 pins; client/decode/wasm/build/build.sh" >&2; exit 2; }
else
  skip "the decoder builds and their manifest check — no $built (client/decode/wasm/build/build.sh, docker)"
fi
if [[ $quick -eq 0 ]]; then
  for tool in nm strings; do
    command -v "$tool" >/dev/null || { echo "missing $tool (binutils): the absence checks read the built artifacts" >&2; exit 2; }
  done
fi
if [[ $browser -eq 1 ]]; then
  require_browser
  require_vendor
fi

step "repo: comment budget"
run 1 scripts/comment_budget.sh

step "repo: every doc link, anchor, backticked path and cited archive tag resolves"
run 1 python3 scripts/check_links.py

step "repo: no personal path in a tracked file"
run 1 scripts/check_personal_paths.sh

step "quinn: the GSO patch of the default build still applies to crates.io quinn"
run 1 scripts/patch_crate.sh quinn --check

step "deploy: the server's seccomp profile is Docker's pinned default plus io_uring, nothing else"
run 1 bash deploy/seccomp-uring.sh --check

step "client: build bundles + unit tests"
run 1 bash client/transport/ts/build.sh
run 1 node client/record/test/run.mjs
run 1 node client/transport/ts/test/run.mjs
run 1 node client/decode/htj2k.test.mjs
run 1 node client/decode/wasm-glue.test.mjs
run 1 node client/decode/xxh3.test.mjs
run 1 node client/transport/downloader.test.mjs
run 1 node client/transport/consumer.test.mjs
run 2 node client/decode/av1.test.mjs
run 1 python3 server/dev-server.test.py
run 1 node client/paint/voi.test.mjs

step "client: worker-safe (no artifact reaches for window)"
run 1 bash client/scripts/check_worker_safe.sh

step "client: transport contract (every implementation, and the race)"
run 2 node client/contract/run.mjs

if [[ $browser -eq 1 ]]; then
  step "client: the downloader in headless Chromium — the clauses through it, and its dispatch order and per-decoder bound"
  run 4 bash client/contract/run_browser.sh
  step "client: the viewer's page check — a complete, exact, drawn page (headless Chromium)"
  run 3 bash client/viewer/run_check.sh
  step "client: the painter at 1:1 against its CPU reference (SwiftShader, ~3 s)"
  if [[ $numpy -eq 1 ]]; then
    run 1 env PYTHON="$PYTHON" node client/paint/check.mjs --zoom1
  else
    skip "the painter check makes its frames with numpy (PYTHON=... with numpy, README.md §Prerequisites)"
  fi
fi

step "client: type-check (product, shared record and its tests, contract and transport-ts tests)"
run 1 bash -c "cd client/transport/ts && npx tsc -p tsconfig.check.json && npx tsc -p ../../record/tsconfig.json && npx tsc -p ../../record/test/tsconfig.json && npx tsc -p ../../contract/tsconfig.json && echo typed"

step "ingest: the split and its merge, every depth, sign and k"
if [[ $numpy -eq 1 ]]; then
  run 1 "$PYTHON" lab/av1/exact/split/merge_test.py
else
  skip "the split's merge test needs numpy (PYTHON=... with numpy, README.md §Prerequisites)"
fi

step "ingest: the DICOM reader — order, planes, sign, functional groups, refusals"
if "$PYTHON" -c "import pydicom, numpy" 2>/dev/null; then
  run 1 "$PYTHON" ingest/from-dicom/from_dicom_test.py
else
  skip "the DICOM reader's tests need pydicom and numpy (PYTHON=... with lab/av1/requirements.txt)"
fi

coders=0
[[ -f lab/.av1-build/payload/libdecode.so && -x lab/.av1-build/aom-3.15.1/bin/aomenc && -d lab/.openjph-build/install ]] && coders=1
step "ingest: the Rust ingest against the Python one — every layout byte-identical at --jobs 1, 2 and 4"
if [[ $coders -eq 1 ]] && "$PYTHON" -c "import numpy, xxhash, blake3" 2>/dev/null; then
  run 1 cargo build --release --quiet -p from-parser -p pack-series
  run 2 cargo test -p from-parser --quiet
  run 1 "$PYTHON" ingest/from-parser/same_test.py
else
  skip "the two ingests compared need lab/.av1-build and OpenJPH (ingest/coded-frames/README.md) and PYTHON=... with lab/av1/requirements.txt"
fi

step "ingest: a synthetic DICOM series to .sbnd, every frame out of the bundle as written, HTJ2K and AV1"
if [[ $coders -eq 1 ]] && "$PYTHON" -c "import numpy, pydicom, xxhash" 2>/dev/null; then
  run 1 cargo build --release --quiet -p pack-series
  run 1 "$PYTHON" ingest/from-dicom/end_to_end_test.py lab/.av1-build
else
  skip "DICOM to .sbnd needs lab/.av1-build and OpenJPH (ingest/coded-frames/README.md) and PYTHON=... with lab/av1/requirements.txt"
fi

step "lab: the variant order and its predecessor split"
run 1 node lab/order.test.mjs

step "lab: the device kit's plan, bundle reader, collector and server start"
run 1 node lab/devices/plan.test.mjs
run 1 python3 lab/devices/collector_test.py
run 1 sh lab/devices/server_start_test.sh

step "lab: the AV1 fetch refuses a lossy source its set does not mark"
run 1 python3 lab/av1/provenance_test.py

step "server: tests, default features"
run 1 cargo test -p series-server --quiet -- --nocapture
step "server: tests, telemetry feature"
run 1 cargo test -p series-server --features telemetry --quiet -- --nocapture
step "server: compiles without io_uring (the pool path alone)"
run 1 cargo check -p series-server --no-default-features --all-targets --quiet
step "server: compiles with cert-compression"
run 1 cargo check -p series-server --features cert-compression --all-targets --quiet
step "common, ingest and tools: wire, envelope, series bundle, pack-series and check-fastpath"
run 1 cargo test -p fod -p frame-envelope -p series-bundle -p pack-series -p check-fastpath --quiet
step "tools: pack-series packs the smoke bundle again to the same bytes"
run 1 bash -c 'd="$(mktemp -d)" && trap "rm -rf $d" EXIT && cargo run --quiet -p pack-series -- --metadata fixtures/us_cine_smoke/metadata.json \
  --frames fixtures/us_cine_smoke/frames --output "$d/x.sbnd" >/dev/null && cmp "$d/x.sbnd" fixtures/us_cine_smoke/us_cine_smoke.sbnd && echo "same bytes"'
step "lab: the four lab crates' tests (their variants are part of the API)"
run 1 cargo test -p window-harness -p disk-access-bench -p telemetry-bench -p container-bench --quiet
step "lab: the Go and h3 clients compile"
if command -v go >/dev/null; then
  run 1 bash -c "(cd lab/other-clients/go && go build -o /dev/null .) && (cd lab/page-open/h3-host && go build -o /dev/null .)"
else
  skip "the lab's Go clients (lab/other-clients/go, lab/page-open/h3-host) — no go"
fi
run 1 cargo check --locked --quiet --manifest-path lab/other-clients/h3/Cargo.toml
step "lab: the frame cache compiles"
run 1 cargo check -p series-server --features lab-frame-cache --all-targets --quiet

if [[ $browser -eq 1 ]]; then
  step "client: against the real server, over QUIC and the WebSocket — refusals, an ask during a fill (headless Chromium)"
  run 8 bash client/contract/run_wire.sh
fi

step "deploy: the web host's nginx answers as dev-server.py, and serves the page's files alone"
if ! command -v nginx >/dev/null; then
  skip "the web host's check (deploy/check_equivalence.sh --local) — no nginx"
elif [[ ! -f "$built/THIRD_PARTY_NOTICES" || ! -f client/decode/wasm/vendor/hash-wasm/xxhash3.umd.min.js ]]; then
  skip "the web host's check (deploy/check_equivalence.sh --local) — no decoder builds or hasher (deploy/README.md §Run it)"
else
  run 1 bash deploy/check_equivalence.sh --local
fi

if [[ $quick -eq 0 ]]; then
  step "client: absence check (default bundle carries no telemetry)"
  run 1 bash client/scripts/check_telemetry_absent.sh
  step "server: absence check (default release binary carries no Tap)"
  run 1 bash server/scripts/check_telemetry_absent.sh
else
  skip "the two absence checks (--quick)"
fi
[[ $browser -eq 1 ]] || skip "every browser step (--no-browser)"

printf '\nGATE OK in %d s' $((SECONDS - t0))
if [[ -s "$LOG/skipped" ]]; then
  printf '; skipped:\n'
  sed 's/^.*SKIPPED/SKIPPED/' "$LOG/skipped" | sort -u | sed 's/^/  /'
else
  printf '; nothing skipped\n'
fi
