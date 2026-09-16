#!/usr/bin/env bash
# The client against the real server, headless: refusals back to back with none lost, and an ask
# during a fill seen with the server's own semantics. Builds a debug server, packs a synthetic
# study and makes its own cert under a temp dir — nothing in the tree is touched. Skips loudly
# without playwright or Chromium, as the other headless steps do.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

if ! node -e 'require("playwright")' 2>/dev/null; then
  export NODE_PATH="${NODE_PATH:-$(npm root -g 2>/dev/null || true)}"
  if ! node -e 'require("playwright")' 2>/dev/null; then
    echo "SKIPPED: against the real server — playwright is not installed (npm install -g playwright)"
    exit 0
  fi
fi
CHROME="$(node -e 'console.log(process.env.CHROME_PATH || require("playwright").chromium.executablePath())' 2>/dev/null || true)"
if [[ ! -x "$CHROME" ]]; then
  echo "SKIPPED: against the real server — no headless Chromium (set CHROME_PATH or: npx playwright install chromium)"
  exit 0
fi
export CHROME_PATH="$CHROME"

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

# 200 frames of 256 KB: enough that a fill is still running when an ask lands, and with the
# 2 MB send window below, few enough in flight that the fill's end is observable.
mkdir -p "$T/frames"
for i in $(seq 0 199); do head -c 262144 /dev/urandom > "$T/frames/$(printf '%03d' "$i").htj2k"; done
echo '{"frameCount": 200}' > "$T/metadata.json"
"$BIN/pack-study" --metadata "$T/metadata.json" --frames "$T/frames" --output "$T/study.sbnd" >/dev/null

for _ in 1 2 3; do
  WT_PORT=$((30000 + RANDOM % 20000))
  "$BIN/exact-server" --port "$WT_PORT" --study "$T/study.sbnd" --cert-pem "$T/cert.pem" --key-pem "$T/key.pem" \
    --send-window-bytes 2000000 > "$T/server.log" 2>&1 &
  SERVER=$!
  for _ in $(seq 50); do grep -q "wt_url=" "$T/server.log" 2>/dev/null && break; sleep 0.1; done
  kill -0 "$SERVER" 2>/dev/null && grep -q "wt_url=" "$T/server.log" && break
done
for _ in 1 2 3; do
  PORT=$((20000 + RANDOM % 10000))
  python3 server/dev-server.py --port "$PORT" &
  STATIC=$!
  sleep 0.3
  kill -0 "$STATIC" 2>/dev/null && break
done
for _ in $(seq 50); do curl -sf "http://127.0.0.1:$PORT/harness/refusals.html" >/dev/null 2>&1 && break; sleep 0.1; done

WT="wt=https://127.0.0.1:$WT_PORT/&hash=$HASH"
drive() { node client/conformance/drive_downloader.cjs "http://127.0.0.1:$PORT/$1" | grep . | tail -1; }
failed=0
drive "harness/refusals.html?arm=ts&n=64&$WT" || failed=1
if [[ -f client/transport-wasm/pkg/transport_wasm_bg.wasm ]]; then
  drive "harness/refusals.html?arm=wasm&n=64&$WT" || failed=1
else
  echo "SKIPPED arm: transport-wasm refusals — no pkg/"
fi
drive "client/conformance/ask-during-fill.html?arm=ts&$WT" || failed=1
drive "client/conformance/ask-during-fill.html?arm=downloader&$WT" || failed=1
exit $failed
