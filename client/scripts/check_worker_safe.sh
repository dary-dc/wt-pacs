#!/usr/bin/env bash
# No built client artifact may reach for `window`. The WASM client did, through its clock, and
# every timestamp it produced inside a worker read 0 rather than raising.
# docs/proposal-conformance-suite.md; client/conformance/ asserts the runtime half.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

artifacts=(client/transport-ts/dist/session.js)
[[ -f client/transport-wasm/pkg/transport_wasm.js ]] &&
  artifacts+=(client/transport-wasm/pkg/transport_wasm.js)

bad=0
for f in "${artifacts[@]}"; do
  [[ -f "$f" ]] || { echo "missing $f — run the build first" >&2; exit 2; }
  if hits=$(grep -nE '(^|[^.[:alnum:]_])window[.[]' "$f"); then
    echo "$f reaches for window:" >&2
    echo "$hits" | head -5 >&2
    bad=1
  fi
done

if [[ -f client/transport-wasm/pkg/transport_wasm_bg.wasm ]] &&
  strings client/transport-wasm/pkg/transport_wasm_bg.wasm | grep -qx window; then
  echo "client/transport-wasm/pkg/transport_wasm_bg.wasm carries the string 'window'" >&2
  bad=1
fi

[[ $bad -eq 0 ]] || exit 1
echo "OK: no client artifact reaches for window (${#artifacts[@]} checked)"
