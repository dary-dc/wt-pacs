#!/usr/bin/env bash
# Build the TS client's bundles and its tests; of them only dist/session.js is committed (manifest.sha256). The recorder's: lab/client-telemetry/build.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
# npm writes node_modules/.package-lock.json on install: older than the lockfile means a dependency changed since.
if [[ ! -f node_modules/.package-lock.json || package-lock.json -nt node_modules/.package-lock.json ]]; then
  npm install
fi
bundle() {
  local target=es2022; [[ $3 == node ]] && target=node20
  npx esbuild "$1" --bundle --format=esm --outfile="$2" --platform="$3" --target="$target"
}
bundle session.ts dist/session.js browser
bundle ws-session.ts dist/ws-session.js browser
bundle race-session.ts dist/race-session.js browser
# --product: the transports a page loads, and nothing for the lab or the tests (deploy/Containerfile).
[[ "${1:-}" == "--product" ]] && { echo "wrote dist/session.js dist/ws-session.js dist/race-session.js"; exit 0; }
bundle ../../contract/run.ts ../../contract/run.mjs node
bundle ../../contract/fake-session.ts ../../contract/dist/fake-session.js browser
bundle ../../contract/downloader-rig.ts ../../contract/dist/downloader-rig.js browser
bundle ../../contract/dispatch-rig.ts ../../contract/dist/dispatch-rig.js browser
bundle test/run.ts test/run.mjs node
echo "wrote dist/session.js dist/ws-session.js dist/race-session.js ../../contract/run.mjs ../../contract/dist/{fake-session,downloader-rig,dispatch-rig}.js test/run.mjs"
