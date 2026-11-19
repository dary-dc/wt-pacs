#!/usr/bin/env bash
# The fetch carrier's bundle, beside the TS client's (client/transport/ts/build.sh); never committed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TS="$HERE/../../client/transport/ts"
bash "$TS/build.sh" >/dev/null
"$TS/node_modules/.bin/esbuild" "$HERE/fetch-session.ts" --bundle --format=esm --platform=browser --target=es2022 \
  --outfile="$HERE/dist/fetch-session.js" --log-level=warning
"$TS/node_modules/.bin/esbuild" "$HERE/fetch-session.test.ts" --bundle --format=esm --platform=node --target=es2022 \
  --outfile="$HERE/dist/fetch-session.test.mjs" --log-level=warning
echo "wrote lab/transport-arms/dist/fetch-session.js dist/fetch-session.test.mjs"
