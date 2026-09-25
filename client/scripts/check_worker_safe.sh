#!/usr/bin/env bash
# No built client artifact may reach for `window`. The WASM client did, through its clock, and
# every timestamp it produced inside a worker read 0 rather than raising.
# docs/proposal-conformance-suite.md; client/conformance/ asserts the runtime half.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

wasm=client/transport-wasm/pkg/transport_wasm_bg.wasm
artifacts=(client/transport-ts/dist/session.js client/transport-ts/dist/ws-session.js
  client/transport-ts/dist/race-session.js client/transport-wasm/pkg/transport_wasm.js)

bad=0
for f in "${artifacts[@]}" "$wasm"; do
  [[ -f "$f" ]] || {
    echo "missing $f — build both clients first: client/transport-ts/build.sh and" \
      "client/transport-wasm/build.sh (README.md §Prerequisites)" >&2
    exit 2
  }
done

for f in "${artifacts[@]}"; do
  # A whole-line comment is not a reach; esbuild banners each bundled module with its path.
  if hits=$(grep -nE '(^|[^.[:alnum:]_])window[.[]' "$f" | grep -vE '^[0-9]+:[[:space:]]*//'); then
    echo "$f reaches for window:" >&2
    echo "$hits" | head -5 >&2
    bad=1
  fi
done

if strings "$wasm" | grep -qx window; then
  echo "$wasm carries the string 'window'" >&2
  bad=1
fi

[[ $bad -eq 0 ]] || exit 1
echo "OK: no client artifact reaches for window (${#artifacts[@]} bundles + the wasm)"
