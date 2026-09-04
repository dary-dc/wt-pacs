#!/usr/bin/env bash
# Build product + telemetry bundles into dist/ (gitignored — do not commit).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
if [[ ! -d node_modules ]]; then
  npm install
fi
npx esbuild session.ts --bundle --format=esm --outfile=dist/session.js --platform=browser --target=es2022
npx esbuild record/session-telemetry.ts --bundle --format=esm --outfile=dist/session.telemetry.js --platform=browser --target=es2022
npx esbuild record/install.ts --bundle --format=esm --outfile=record/dist/install.js --platform=browser --target=es2022
npx esbuild record/test/run.ts --bundle --format=esm --outfile=record/test/run.mjs --platform=node --target=node20
echo "wrote dist/session.js dist/session.telemetry.js record/dist/install.js record/test/run.mjs"
