#!/usr/bin/env bash
# Cornerstone3D bundled once, at the lockfile's pins, into dist/cs.js.
set -euo pipefail
cd "$(dirname "$0")"
npm ci --no-audit --no-fund
npx esbuild cs.js --bundle --format=esm --minify --outfile=dist/cs.js
