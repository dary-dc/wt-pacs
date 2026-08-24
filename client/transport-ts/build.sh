#!/usr/bin/env bash
# Optional: rebuild dist/ from TypeScript when npm is available.
# Harness ships a checked-in dist/session.js so no Node is required.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found — using checked-in dist/session.js (source of truth: session.ts + wire.ts)"
  exit 0
fi
if [[ ! -d node_modules ]]; then
  npm install
fi
npx esbuild session.ts --bundle --format=esm --outfile=dist/session.js --platform=browser --target=es2022
echo "wrote dist/session.js"
