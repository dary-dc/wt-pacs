# Sourced by the headless runners, from the repo root.
NO_BROWSER_HINT="or skip every browser step: scripts/gate.sh --no-browser"

# Exports CHROME_PATH (and NODE_PATH for a global playwright), or exits 2 with the install command.
require_browser() {
  if ! node -e 'require("playwright")' 2>/dev/null; then
    export NODE_PATH="${NODE_PATH:-$(npm root -g 2>/dev/null || true)}"
    node -e 'require("playwright")' 2>/dev/null || {
      echo "playwright is missing: npm i -g playwright && npx playwright install chromium ($NO_BROWSER_HINT)" >&2
      exit 2
    }
  fi
  CHROME_PATH="$(node -e 'console.log(process.env.CHROME_PATH || require("playwright").chromium.executablePath())' 2>/dev/null || true)"
  [[ -x "$CHROME_PATH" ]] || {
    echo "no headless Chromium: npx playwright install chromium, or set CHROME_PATH ($NO_BROWSER_HINT)" >&2
    exit 2
  }
  export CHROME_PATH
}

# A two-day cert in $1 (cert.pem, key.pem), within Chrome's hash-pinning limit: sets CERT_HASH.
make_test_cert() {
  openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout "$1/key.pem" -out "$1/cert.pem" \
    -days 2 -nodes -subj '/CN=localhost' -addext 'basicConstraints=critical,CA:FALSE' \
    -addext 'keyUsage=critical,digitalSignature' -addext 'extendedKeyUsage=serverAuth' \
    -addext 'subjectAltName=DNS:localhost,IP:127.0.0.1' 2>/dev/null
  CERT_HASH="$(openssl x509 -in "$1/cert.pem" -outform DER | openssl dgst -sha256 | awk '{print $2}')"
}

# The static host on a free port: sets STATIC (its pid) and PORT, or exits 1 with its log.
start_static() {
  local log=$1
  python3 server/dev-server.py --port 0 >"$log" 2>&1 &
  STATIC=$!
  for _ in $(seq 50); do
    PORT="$(sed -n 's/^port=\([0-9]*\).*/\1/p' "$log")"
    [[ -n "$PORT" ]] && return 0
    kill -0 "$STATIC" 2>/dev/null || break
    sleep 0.1
  done
  echo "the static host did not start:" >&2
  cat "$log" >&2
  exit 1
}

# The transport's WASM build, refused when missing or older than its sources.
require_transport_wasm() {
  local wasm=client/transport/wasm/pkg/transport_wasm_bg.wasm stale
  [[ -f "$wasm" ]] || { echo "missing $wasm: client/transport/wasm/build.sh (README.md §Prerequisites)" >&2; exit 2; }
  stale="$(find client/transport/wasm/src client/transport/wasm/Cargo.toml common -newer "$wasm" -print -quit)"
  [[ -z "$stale" ]] || { echo "stale pkg/: $stale is newer than $wasm; client/transport/wasm/build.sh" >&2; exit 2; }
}

require_vendor() {
  [[ -f client/decode/wasm/vendor/openjph/openjphjs.js ]] || {
    echo "the decoder vendor is missing: bash client/decode/wasm/fetch_openjph.sh ($NO_BROWSER_HINT)" >&2
    exit 2
  }
  [[ -f client/decode/wasm/vendor/hash-wasm/xxhash3.umd.min.js ]] || {
    echo "the frame check's hasher is missing: bash client/decode/wasm/fetch_xxh3.sh ($NO_BROWSER_HINT)" >&2
    exit 2
  }
}
