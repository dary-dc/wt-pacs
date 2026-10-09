#!/usr/bin/env bash
# The client against the real server, headless, over QUIC and over its WebSocket: refusals back to
# back with none lost, and an ask during a fill seen with the server's own semantics. Builds a debug server, packs a synthetic
# series and makes its own cert under a temp dir — nothing in the tree is touched. Needs playwright
# and Chromium.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
source client/contract/browser_env.sh
require_browser

cargo build -q -p series-server -p pack-series
BIN="${CARGO_TARGET_DIR:-target}/debug"
T="$(mktemp -d)"
SERVER=""
STATIC=""
trap 'kill "$SERVER" "$STATIC" 2>/dev/null || true; rm -rf "$T"' EXIT

make_test_cert "$T"
export WTPACS_TRUST_SPKI="$(openssl x509 -in "$T/cert.pem" -pubkey -noout | openssl pkey -pubin -outform DER |
  openssl dgst -sha256 -binary | base64)"

# 200 frames of 256 KB: enough that a fill is still running when an ask lands, and with the
# 2 MB send window below, few enough in flight that the fill's end is observable.
mkdir -p "$T/frames"
for i in $(seq 0 199); do head -c 262144 /dev/urandom > "$T/frames/$(printf '%03d' "$i").htj2k"; done
echo '{"frameCount": 200}' > "$T/metadata.json"
"$BIN/pack-series" --metadata "$T/metadata.json" --frames "$T/frames" --output "$T/series.sbnd" >/dev/null

serving() { grep -q "wt_url=" "$T/server.log"; }
for _ in 1 2 3; do
  WT_PORT=$((30000 + RANDOM % 20000))
  "$BIN/series-server" --port "$WT_PORT" --series "$T/series.sbnd" --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" \
    --send-window-bytes 2000000 --websocket > "$T/server.log" 2>&1 &
  SERVER=$!
  for _ in $(seq 50); do serving || ! kill -0 "$SERVER" 2>/dev/null && break; sleep 0.1; done
  serving && break
done
serving || { echo "the server did not start:" >&2; cat "$T/server.log" >&2; exit 1; }
start_static "$T/static.log"

WT="wt=https://127.0.0.1:$WT_PORT/&hash=$CERT_HASH"
drive() { node client/contract/drive_page.cjs "http://127.0.0.1:$PORT/$1" | grep . | tail -1; }
failed=0
drive "client/contract/refusals.html?client=ts&n=64&$WT" || failed=1
drive "client/contract/refusals.html?client=wasm&n=64&$WT" || failed=1
drive "client/contract/refusals.html?client=ws&n=64&$WT" || failed=1
drive "client/contract/ask-during-fill.html?client=ts&$WT" || failed=1
drive "client/contract/ask-during-fill.html?client=downloader&$WT" || failed=1
drive "client/contract/ask-during-fill.html?client=ws&$WT" || failed=1
drive "client/contract/ask-during-fill.html?client=downloader-ws&$WT" || failed=1
exit $failed
