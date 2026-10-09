#!/usr/bin/env bash
# Build product + telemetry bundles (gitignored — do not commit).
# Shared recorder lives in client/record/; this script builds the TS client's entries
# and the shared install/test artifacts.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
# npm writes node_modules/.package-lock.json on install: older than the lockfile means a dependency changed since.
if [[ ! -f node_modules/.package-lock.json || package-lock.json -nt node_modules/.package-lock.json ]]; then
  npm install
fi
npx esbuild session.ts --bundle --format=esm --outfile=dist/session.js --platform=browser --target=es2022
npx esbuild ws-session.ts --bundle --format=esm --outfile=dist/ws-session.js --platform=browser --target=es2022
npx esbuild race-session.ts --bundle --format=esm --outfile=dist/race-session.js --platform=browser --target=es2022
# --product: the transports a page loads, and nothing for the lab or the tests (deploy/Containerfile).
[[ "${1:-}" == "--product" ]] && { echo "wrote dist/session.js dist/ws-session.js dist/race-session.js"; exit 0; }
npx esbuild session-telemetry.ts --bundle --format=esm --outfile=dist/session-telemetry.js --platform=browser --target=es2022
npx esbuild ../../record/test/run.ts --bundle --format=esm --outfile=../../record/test/run.mjs --platform=node --target=node20
npx esbuild ../../contract/run.ts --bundle --format=esm --outfile=../../contract/run.mjs --platform=node --target=node20
npx esbuild ../../contract/fake-session.ts --bundle --format=esm --outfile=../../contract/dist/fake-session.js --platform=browser --target=es2022
npx esbuild ../../contract/downloader-rig.ts --bundle --format=esm --outfile=../../contract/dist/downloader-rig.js --platform=browser --target=es2022
npx esbuild ../../contract/dispatch-rig.ts --bundle --format=esm --outfile=../../contract/dist/dispatch-rig.js --platform=browser --target=es2022
npx esbuild ../../../lab/telemetry-cost/cost.ts --bundle --format=esm --outfile=../../../lab/telemetry-cost/cost.mjs --platform=node --target=node20
npx esbuild test/run.ts --bundle --format=esm --outfile=test/run.mjs --platform=node --target=node20
echo "wrote dist/session.js dist/ws-session.js dist/race-session.js dist/session-telemetry.js ../../record/test/run.mjs ../../contract/run.mjs ../../contract/dist/{fake-session,downloader-rig,dispatch-rig}.js ../../../lab/telemetry-cost/cost.mjs test/run.mjs"
