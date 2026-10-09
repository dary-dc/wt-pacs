#!/usr/bin/env bash
# The harness pages headless against a release server on the c512 series: every cell delivers what it
# asked (the refuse cell fails all of it) and the self-check decodes every frame byte-identical.
# Cert, series and logs go under a temp dir, kept only on failure; nothing in the tree is touched.
#   scripts/cellcheck.sh [c512.sbnd]   what it needs: README.md §Quick start
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
source client/conformance/browser_env.sh
NO_BROWSER_HINT="README.md §Prerequisites"
require_browser
require_vendor
[[ -f client/transport/wasm/pkg/transport_wasm_bg.wasm ]] || { echo "no WASM pkg/: client/transport/wasm/build.sh" >&2; exit 2; }
[[ -f lab/fixtures/decode_c512/086.sha256 ]] || { echo "no c512 frames: lab/scripts/gen_htj2k_fixtures.sh c512" >&2; exit 2; }

bash client/transport/ts/build.sh >/dev/null
cargo build --release -q -p series-server -p pack-series
BIN="${CARGO_TARGET_DIR:-target}/release"
T="$(mktemp -d -t cellcheck.XXXXXX)"
SERVER=""
STATIC=""
trap 'kill "$SERVER" "$STATIC" 2>/dev/null || true; [[ -f "$T/ok" ]] && rm -rf "$T" || echo "logs kept in $T" >&2' EXIT

SERIES="${1:-$T/c512.sbnd}"
if [[ -z "${1:-}" ]]; then
  mkdir "$T/frames"
  for f in "$ROOT"/lab/fixtures/decode_c512/*.j2c; do ln -s "$f" "$T/frames/$(basename "$f" .j2c).htj2k"; done
  "$BIN/pack-series" --metadata lab/fixtures/decode_c512/metadata.json --frames "$T/frames" --output "$SERIES" >/dev/null
fi
make_test_cert "$T"

serving() { grep -q "wt_url=" "$T/server.log"; }
for _ in 1 2 3; do
  WT_PORT=$((30000 + RANDOM % 20000))
  RUST_LOG=series_server=warn "$BIN/series-server" --port "$WT_PORT" --series "$SERIES" \
    --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" > "$T/server.log" 2>&1 &
  SERVER=$!
  for _ in $(seq 50); do serving || ! kill -0 "$SERVER" 2>/dev/null && break; sleep 0.1; done
  serving && break
done
serving || { echo "the server did not start:" >&2; cat "$T/server.log" >&2; exit 1; }
start_static "$T/static.log"

BASE="http://127.0.0.1:$PORT" WT_URL="https://127.0.0.1:$WT_PORT/" CERT_SHA256="$CERT_HASH" node scripts/cellcheck.mjs
touch "$T/ok"
