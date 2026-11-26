#!/usr/bin/env bash
# Claim: the product build (deploy/Containerfile's `build.sh --product`) writes the WebTransport bundle alone, the
# one transport head.js's `ts` client loads; the WebSocket and race sessions stay the contract's and the lab's.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
copy="$(mktemp -d)"
trap 'rm -rf "$copy"' EXIT
cp -p "$ROOT"/*.ts "$ROOT"/package.json "$ROOT"/package-lock.json "$ROOT"/build.sh "$copy"/
[[ -d "$ROOT/node_modules" ]] || (cd "$ROOT" && npm install)
ln -s "$ROOT/node_modules" "$copy/node_modules"
mkdir "$copy/dist"
bash "$copy/build.sh" --product >/dev/null
built=$(cd "$copy/dist" && ls | tr '\n' ' ')
[[ "$built" == "session.js " ]] || { echo "FAIL: build.sh --product wrote: $built"; exit 1; }
echo "ok: build.sh --product writes dist/session.js alone"
