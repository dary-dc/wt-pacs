#!/usr/bin/env bash
# Fetch the HTJ2K decoder this bench measures, from npm, at a pinned version, and record
# what arrived. Nothing is committed: vendor/ is ignored, so provenance is the tarball's
# own checksum rather than trust in the bytes in this repo.
set -euo pipefail
cd "$(cd "$(dirname "$0")" && pwd)"

PKG=@cornerstonejs/codec-openjph
VER=2.4.11
OUT=vendor/openjph

rm -rf vendor/.pack "$OUT"
mkdir -p vendor/.pack "$OUT"
( cd vendor/.pack && npm pack "$PKG@$VER" --silent >/dev/null )
TARBALL=$(ls vendor/.pack/*.tgz)
SHA=$(sha256sum "$TARBALL" | cut -d' ' -f1)
tar -xzf "$TARBALL" -C vendor/.pack

find vendor/.pack/package -name 'openjphjs.*' -exec cp {} "$OUT/" \;
cp vendor/.pack/package/LICENSE "$OUT/LICENSE" 2>/dev/null || true

cat > "$OUT/SOURCE.txt" <<TXT
$PKG $VER, dist/ as published on npm.
tarball sha256: $SHA
Wrapper MIT (Chris Hafey); OpenJPH itself BSD-2-Clause.
Fetched by fetch_decoder.sh — not committed. Re-run to reproduce.
TXT
rm -rf vendor/.pack

echo "decoder in $OUT"
ls -la "$OUT"
