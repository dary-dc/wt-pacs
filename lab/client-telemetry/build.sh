#!/usr/bin/env bash
# Build the recorder's bundle and its tests (gitignored — do not commit), with the TS client's esbuild.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TS="$HERE/../../client/transport/ts"
[[ -x "$TS/node_modules/.bin/esbuild" ]] || bash "$TS/build.sh" --product
cd "$HERE"
bundle() {
  local target=es2022; [[ $3 == node ]] && target=node20
  "$TS/node_modules/.bin/esbuild" "$1" --bundle --format=esm --outfile="$2" --platform="$3" --target="$target"
}
bundle session-telemetry.ts dist/session-telemetry.js browser
bundle test/run.ts test/run.mjs node
bundle test/session.ts test/session.mjs node
echo "wrote dist/session-telemetry.js test/run.mjs test/session.mjs"
