#!/usr/bin/env bash
# The frame check's XXH3-64 (hash-wasm's single-algorithm build) from npm, pinned by its tarball's checksum.
# Nothing is committed: vendor/ is ignored. docs/av1/licensing.md
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"

VER=4.12.0
SHA=1db32a125fb46177932ec8ac438d3cd8214ebdfaccb5d6611b657d88eb586f92
OUT=vendor/hash-wasm

rm -rf vendor/.pack-xxh3 "$OUT"
mkdir -p vendor/.pack-xxh3 "$OUT"
( cd vendor/.pack-xxh3 && npm pack "hash-wasm@$VER" --silent >/dev/null )
echo "$SHA  vendor/.pack-xxh3/hash-wasm-$VER.tgz" | sha256sum -c --quiet
tar -xzf "vendor/.pack-xxh3/hash-wasm-$VER.tgz" -C vendor/.pack-xxh3
cp vendor/.pack-xxh3/package/dist/xxhash3.umd.min.js vendor/.pack-xxh3/package/LICENSE "$OUT/"
rm -rf vendor/.pack-xxh3
echo "hash-wasm $VER's XXH3 in $OUT"
