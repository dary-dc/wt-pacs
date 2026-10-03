#!/usr/bin/env bash
# The client against the real server, headless, over QUIC and over its WebSocket: refusals back to
# back with none lost, and an ask during a fill seen with the server's own semantics. Builds a debug server, packs a synthetic
# study and makes its own cert under a temp dir — nothing in the tree is touched. Needs playwright
# and Chromium.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
source client/conformance/browser_env.sh
require_browser

cargo build -q -p exact-server -p pack-study
BIN="${CARGO_TARGET_DIR:-target}/debug"
T="$(mktemp -d)"
SERVER=""
STATIC=""
trap 'kill "$SERVER" "$STATIC" 2>/dev/null || true; rm -rf "$T"' EXIT

openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$T/key.pem" -out "$T/cert.pem" \
  -days 2 -nodes -subj '/CN=localhost' -addext 'basicConstraints=critical,CA:FALSE' \
  -addext 'keyUsage=critical,digitalSignature' -addext 'extendedKeyUsage=serverAuth' \
  -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null
HASH="$(openssl x509 -in "$T/cert.pem" -outform DER | openssl dgst -sha256 | awk '{print $2}')"
export WTPACS_TRUST_SPKI="$(openssl x509 -in "$T/cert.pem" -pubkey -noout | openssl pkey -pubin -outform DER |
  openssl dgst -sha256 -binary | base64)"

# 200 frames of 256 KB: enough that a fill is still running when an ask lands, and with the
# 2 MB send window below, few enough in flight that the fill's end is observable.
mkdir -p "$T/frames"
for i in $(seq 0 199); do head -c 262144 /dev/urandom > "$T/frames/$(printf '%03d' "$i").htj2k"; done
echo '{"frameCount": 200}' > "$T/metadata.json"
"$BIN/pack-study" --metadata "$T/metadata.json" --frames "$T/frames" --output "$T/study.sbnd" >/dev/null

serving() { grep -q "wt_url=" "$T/server.log"; }
for _ in 1 2 3; do
  WT_PORT=$((30000 + RANDOM % 20000))
  "$BIN/exact-server" --port "$WT_PORT" --study "$T/study.sbnd" --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" \
    --send-window-bytes 2000000 --websocket > "$T/server.log" 2>&1 &
  SERVER=$!
  for _ in $(seq 50); do serving || ! kill -0 "$SERVER" 2>/dev/null && break; sleep 0.1; done
  serving && break
done
serving || { echo "the server did not start:" >&2; cat "$T/server.log" >&2; exit 1; }
start_static "$T/static.log"

WT="wt=https://127.0.0.1:$WT_PORT/&hash=$HASH"
drive() { node client/conformance/drive_page.cjs "http://127.0.0.1:$PORT/$1" | grep . | tail -1; }
failed=0
drive "client/conformance/refusals.html?arm=ts&n=64&$WT" || failed=1
drive "client/conformance/refusals.html?arm=wasm&n=64&$WT" || failed=1
drive "client/conformance/refusals.html?arm=ws&n=64&$WT" || failed=1
drive "client/conformance/ask-during-fill.html?arm=ts&$WT" || failed=1
drive "client/conformance/ask-during-fill.html?arm=downloader&$WT" || failed=1
drive "client/conformance/ask-during-fill.html?arm=ws&$WT" || failed=1
drive "client/conformance/ask-during-fill.html?arm=downloader-ws&$WT" || failed=1
exit $failed
