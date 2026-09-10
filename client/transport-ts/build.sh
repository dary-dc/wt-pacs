#!/usr/bin/env bash
# Build product + telemetry bundles (gitignored — do not commit).
# Shared recorder lives in client/record/; this script builds the TS arm entries
# and the shared install/test artifacts.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
if [[ ! -d node_modules ]]; then
  npm install
fi
npx esbuild session.ts --bundle --format=esm --outfile=dist/session.js --platform=browser --target=es2022
npx esbuild session-telemetry.ts --bundle --format=esm --outfile=dist/session.telemetry.js --platform=browser --target=es2022
npx esbuild ../record/install.ts --bundle --format=esm --outfile=../record/dist/install.js --platform=browser --target=es2022
npx esbuild ../record/test/run.ts --bundle --format=esm --outfile=../record/test/run.mjs --platform=node --target=node20
npx esbuild test/session.test.ts --bundle --format=esm --outfile=test/session.mjs --platform=node --target=node20
echo "wrote dist/session.js dist/session.telemetry.js ../record/dist/install.js ../record/test/run.mjs test/session.mjs"
