#!/usr/bin/env bash
# The XXH3 hasher the decoder worker checks frames with: hash-wasm's, from npm, pinned by checksum.
# Nothing is committed: vendor/ is ignored. docs/adr/exactness-in-production.md
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"

PKG=hash-wasm
VER=4.12.0
SHA256=1db32a125fb46177932ec8ac438d3cd8214ebdfaccb5d6611b657d88eb586f92
OUT=vendor/hash-wasm

rm -rf vendor/.xxh3 "$OUT"
mkdir -p vendor/.xxh3 "$OUT"
( cd vendor/.xxh3 && npm pack "$PKG@$VER" --silent >/dev/null )
echo "$SHA256  vendor/.xxh3/$PKG-$VER.tgz" | sha256sum -c --quiet || { echo "$PKG $VER: checksum mismatch" >&2; exit 2; }
tar -xzf "vendor/.xxh3/$PKG-$VER.tgz" -C vendor/.xxh3
cp vendor/.xxh3/package/dist/xxhash3.umd.min.js vendor/.xxh3/package/LICENSE "$OUT/"
printf '%s %s, dist/xxhash3.umd.min.js as published on npm, MIT.\ntarball sha256: %s\n' "$PKG" "$VER" "$SHA256" > "$OUT/SOURCE.txt"
rm -rf vendor/.xxh3
echo "hasher in $OUT"
