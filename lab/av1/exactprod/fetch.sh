#!/usr/bin/env bash
# hash-wasm from npm and the truth's two hashers from PyPI, pinned and checked; nothing is committed.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HERE/../../.av1-build/hash-wasm"
VER=4.12.0
SHA=1db32a125fb46177932ec8ac438d3cd8214ebdfaccb5d6611b657d88eb586f92

rm -rf "$OUT" && mkdir -p "$OUT/.pack"
( cd "$OUT/.pack" && npm pack "hash-wasm@$VER" --silent >/dev/null )
echo "$SHA  $OUT/.pack/hash-wasm-$VER.tgz" | sha256sum -c --quiet
tar -xzf "$OUT/.pack/hash-wasm-$VER.tgz" -C "$OUT/.pack"
cp "$OUT/.pack/package/dist/index.umd.min.js" "$OUT/.pack/package/LICENSE" "$OUT/"
rm -rf "$OUT/.pack"

VENV="$HERE/.venv"
[[ -x "$VENV/bin/python" ]] || python3 -m venv "$VENV"
"$VENV/bin/pip" install -q --require-hashes -r "$HERE/requirements.txt"
