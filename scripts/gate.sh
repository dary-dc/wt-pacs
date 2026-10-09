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
wasm=client/transport/wasm/pkg/transport_wasm_bg.wasm
[[ -f "$wasm" ]] || { echo "missing $wasm: client/transport/wasm/build.sh (README.md §Prerequisites)" >&2; exit 2; }
stale="$(find client/transport/wasm/src client/transport/wasm/Cargo.toml common -newer "$wasm" -print -quit)"
[[ -z "$stale" ]] || { echo "stale pkg/: $stale is newer than $wasm; client/transport/wasm/build.sh" >&2; exit 2; }
dav1d=lab/.av1-build/out/simd.wasm
if [[ -f "$dav1d" ]]; then
  stale="$(find client/decode/wasm/dav1d/build.sh client/decode/wasm/dav1d/dav1d_wrap.c -newer "$dav1d" -print -quit)"
  [[ -z "$stale" ]] || { echo "stale $dav1d: $stale is newer; VARIANTS=simd client/decode/wasm/dav1d/build.sh" >&2; exit 2; }
fi
if [[ $quick -eq 0 ]]; then
  for tool in nm strings; do
    command -v "$tool" >/dev/null || { echo "missing $tool (binutils): the absence checks read the built artifacts" >&2; exit 2; }
  done
fi
if [[ $browser -eq 1 ]]; then
  source client/contract/browser_env.sh
  require_browser
  require_vendor
fi

step "repo: comment budget"
run 1 scripts/comment_budget.sh

step "repo: every doc link, anchor and backticked path resolves"
run 1 python3 scripts/check_links.py

step "repo: no personal path in a tracked file"
run 1 scripts/check_personal_paths.sh

step "quinn: the opt-in GSO patch still applies to crates.io quinn"
run 1 scripts/patch_crate.sh quinn --check

step "client: build bundles + unit tests"
run 1 bash client/transport/ts/build.sh
run 1 node client/record/test/run.mjs
run 1 node client/transport/ts/test/run.mjs
run 1 node client/decode/htj2k.test.mjs
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

step "lab: the variant order and its predecessor split"
run 1 node lab/order.test.mjs

step "lab: the AV1 fetch refuses a lossy source its set does not mark"
run 1 python3 lab/av1/provenance_test.py

step "server: tests, default features"
run 1 cargo test -p series-server --quiet -- --nocapture
step "server: tests, telemetry feature"
run 1 cargo test -p series-server --features telemetry --quiet -- --nocapture
step "server: compiles without io_uring (the pool path alone)"
run 1 cargo check -p series-server --no-default-features --features crypto-ring --all-targets --quiet
step "common, ingest and tools: wire, envelope, series bundle, pack-series and check-fastpath"
run 1 cargo test -p fod -p frame-envelope -p series-bundle -p pack-series -p check-fastpath --quiet
step "lab: window-harness tests"
run 1 cargo test -p window-harness --quiet
step "lab: disk-access-bench and telemetry-bench compile (the variants are part of the API)"
run 1 cargo check -p disk-access-bench -p telemetry-bench --all-targets --quiet

if [[ $browser -eq 1 ]]; then
  step "client: against the real server, over QUIC and the WebSocket — refusals, an ask during a fill (headless Chromium)"
  run 8 bash client/contract/run_wire.sh
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
