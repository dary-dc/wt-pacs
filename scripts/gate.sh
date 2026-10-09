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

step() { printf '\n== %s\n' "$*"; }

step "prerequisites: a WASM pkg/ built from this tree; playwright, Chromium and the decoder vendor"
wasm=client/transport/wasm/pkg/transport_wasm_bg.wasm
[[ -f "$wasm" ]] || { echo "missing $wasm: client/transport/wasm/build.sh (README.md §Prerequisites)" >&2; exit 2; }
stale="$(find client/transport/wasm/src client/transport/wasm/Cargo.toml common -newer "$wasm" -print -quit)"
[[ -z "$stale" ]] || { echo "stale pkg/: $stale is newer than $wasm; client/transport/wasm/build.sh" >&2; exit 2; }
if [[ $browser -eq 1 ]]; then
  source client/contract/browser_env.sh
  require_browser
  require_vendor
fi

step "repo: comment budget"
scripts/comment_budget.sh

step "repo: every doc link, anchor and backticked path resolves"
python3 scripts/check_links.py

step "quinn: the opt-in GSO patch still applies to crates.io quinn"
scripts/patch_crate.sh quinn --check

step "client: build bundles + unit tests"
bash client/transport/ts/build.sh >/dev/null
node client/record/test/run.mjs | tail -1
node client/transport/ts/test/run.mjs | tail -1
node client/decode/htj2k.test.mjs
node client/transport/downloader.test.mjs
node client/transport/consumer.test.mjs
node client/decode/av1.test.mjs
python3 server/dev-server.test.py 2>&1 | tail -1
node client/paint/voi.test.mjs

step "client: worker-safe (no artifact reaches for window)"
bash client/scripts/check_worker_safe.sh

step "client: transport contract (every implementation, and the race)"
node client/contract/run.mjs | tail -2

if [[ $browser -eq 1 ]]; then
  step "client: the downloader in headless Chromium — the clauses through it, and its dispatch order and per-decoder bound"
  bash client/contract/run_browser.sh
  step "client: the painter at 1:1 against its CPU reference (SwiftShader, ~3 s)"
  if PYTHON="${PYTHON:-python3}" && "$PYTHON" -c "import numpy" 2>/dev/null; then
    PYTHON="$PYTHON" node client/paint/check.mjs --zoom1 | tail -1
  else
    echo "SKIPPED: the painter check makes its frames with numpy (PYTHON=... with numpy, or pip install numpy)"
  fi
fi

step "client: type-check (product, shared record, contract and transport-ts tests)"
(cd client/transport/ts && npx tsc -p tsconfig.check.json)
(cd client/transport/ts && npx tsc -p ../../record/tsconfig.json)
(cd client/transport/ts && npx tsc -p ../../contract/tsconfig.json)

step "lab: the arm order and its predecessor split"
node lab/order.test.mjs

step "lab: the AV1 fetch refuses a lossy source its set does not mark"
python3 lab/av1/provenance_test.py

step "server: tests, default features"
cargo test -p series-server --quiet
step "server: tests, telemetry feature"
cargo test -p series-server --features telemetry --quiet
step "server: compiles without io_uring (the pool path alone)"
cargo check -p series-server --no-default-features --features crypto-ring --all-targets --quiet
step "common + ingest: wire, envelope and series-bundle tests"
cargo test -p fod -p frame-envelope -p series-bundle --quiet
step "lab: window-harness tests"
cargo test -p window-harness --quiet
step "lab: disk-access-bench and telemetry-bench compile (the arms are part of the API)"
cargo check -p disk-access-bench -p telemetry-bench --all-targets --quiet

if [[ $browser -eq 1 ]]; then
  step "client: against the real server, over QUIC and the WebSocket — refusals, an ask during a fill (headless Chromium)"
  bash client/contract/run_wire.sh | tail -8
fi

if [[ $quick -eq 0 ]]; then
  step "client: absence check (default bundle carries no telemetry)"
  bash client/scripts/check_telemetry_absent.sh | tail -1
  step "server: absence check (default release binary carries no Tap)"
  bash server/scripts/check_telemetry_absent.sh | tail -1
else
  step "absence checks skipped (--quick)"
fi

if [[ $browser -eq 1 ]]; then
  printf '\nGATE OK\n'
else
  printf '\nGATE OK (browser steps skipped)\n'
fi
