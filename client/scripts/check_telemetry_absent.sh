#!/usr/bin/env bash
# Default client artifacts carry no telemetry surface: docs/adr/telemetry-instrument-clients-from-outside.md.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

DIST="$ROOT/client/transport/ts/dist"
BUNDLES=(session.js ws-session.js race-session.js)
WASM_JS="$ROOT/client/transport/wasm/pkg/transport_wasm.js"
WASM_BG="$ROOT/client/transport/wasm/pkg/transport_wasm_bg.wasm"

fail() { echo "FAIL: $*" >&2; exit 1; }

# dist/ is gitignored — build the default product bundles when missing.
for b in "${BUNDLES[@]}"; do
  [[ -f "$DIST/$b" ]] || bash "$ROOT/client/transport/ts/build.sh"
  [[ -f "$DIST/$b" ]] || fail "missing $DIST/$b after build"
  if grep -qE 'client-telemetry/|__wtpacsTelemetry|binding_term|serve_plus_path|client_frames|invalid_reasons|mean_frame_bytes|clock_probe_us|StreamAttributor|first_ask_row|tap_read_cost_us|copies_per_frame_declared|ring_evictions' "$DIST/$b"; then
    fail "telemetry strings found in default dist/$b"
  fi
done

[[ -f "$WASM_JS" && -f "$WASM_BG" ]] || fail "missing the WASM client: client/transport/wasm/build.sh"
if grep -qiE 'telemetry|Tap|report' "$WASM_JS"; then
  fail "telemetry exports in default pkg/transport_wasm.js"
fi
if grep -a -qE 'serve_plus_path|binding_term|client_frames|__wtpacsTelemetry' "$WASM_BG"; then
  fail "telemetry field-name literals in default transport_wasm_bg.wasm"
fi

# Default bundles must not patch WebTransport when loaded alone.
for b in "${BUNDLES[@]}"; do
  node --input-type=module -e "
    globalThis.WebTransport = function WebTransport() {};
    const before = globalThis.WebTransport;
    await import('file://$DIST/$b');
    if (globalThis.WebTransport !== before) {
      console.error('FAIL: default $b patched WebTransport');
      process.exit(1);
    }
    console.log('OK: default $b does not patch WebTransport');
  "
done

echo "OK: no telemetry surface in default client artifacts"
