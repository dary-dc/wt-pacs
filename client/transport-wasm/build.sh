#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
export RUSTFLAGS="${RUSTFLAGS:---cfg=web_sys_unstable_apis}"
if [[ "${WTPACS_TELEMETRY_BUILD:-}" == "1" ]]; then
  # Same product wasm; telemetry is the external JS patch. Separate out-dir only.
  # wasm-pack --out-dir conflicts with cargo 1.98 --artifact-dir; build then rename.
  rm -rf pkg-telemetry
  wasm-pack build --target web --release --features telemetry
  cp -a pkg pkg-telemetry
else
  wasm-pack build --target web --release
fi
