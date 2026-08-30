#!/usr/bin/env bash
# Verify default client artifacts contain no telemetry surface (plan §8).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

TS_DIST="$ROOT/client/transport-ts/dist/session.js"
WASM_JS="$ROOT/client/transport-wasm/pkg/transport_wasm.js"
WASM_BG="$ROOT/client/transport-wasm/pkg/transport_wasm_bg.wasm"

fail() { echo "FAIL: $*" >&2; exit 1; }

if [[ ! -f "$TS_DIST" ]]; then
  fail "missing $TS_DIST — build transport-ts first"
fi

if grep -qE 'record/install|__wtpacsTelemetry|binding_term|serve_plus_path|client_frames|preload_to_decode' "$TS_DIST"; then
  fail "telemetry strings found in default dist/session.js"
fi

if [[ -f "$WASM_JS" ]]; then
  if grep -qiE 'telemetry|Tap|report' "$WASM_JS"; then
    fail "telemetry exports in default pkg/transport_wasm.js"
  fi
fi

if [[ -f "$WASM_BG" ]]; then
  if grep -a -qE 'serve_plus_path|binding_term|client_frames|__wtpacsTelemetry' "$WASM_BG"; then
    fail "telemetry field-name literals in default transport_wasm_bg.wasm"
  fi
fi

# Default bundle must not patch WebTransport when loaded alone.
if command -v node >/dev/null 2>&1; then
  node --input-type=module -e "
    globalThis.WebTransport = function WebTransport() {};
    const before = globalThis.WebTransport;
    await import('file://$TS_DIST');
    if (globalThis.WebTransport !== before) {
      console.error('FAIL: default session.js patched WebTransport');
      process.exit(1);
    }
    console.log('OK: default session.js does not patch WebTransport');
  "
fi

echo "OK: no telemetry surface in default client artifacts"
