#!/usr/bin/env bash
# libaom 3.15.1's svc_encoder_rtc, stock and with svc_encoder_rtc.patch (12-bit, --profile,
# --monochrome; the example's CLI only, the library untouched), from tools.sh's checksummed tarball.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BUILD="${BUILD:-$ROOT/lab/.av1-build}"
BUILD="$BUILD" "$ROOT/lab/av1/tools.sh" >/dev/null
cmake --build "$BUILD/aom-3.15.1-b" --target svc_encoder_rtc >/dev/null

SRC="$BUILD/aom-3.15.1-svc-src"
if [[ ! -x "$BUILD/aom-3.15.1-svc-b/svc_encoder_rtc" ]]; then
  rm -rf "$SRC" && mkdir -p "$SRC"
  tar -xzf "$BUILD/libaom-3.15.1.tar.gz" -C "$SRC" --strip-components=1
  patch -s -d "$SRC" -p1 < "$ROOT/lab/av1/svc/svc_encoder_rtc.patch"
  cmake -S "$SRC" -B "$BUILD/aom-3.15.1-svc-b" -G Ninja -DCMAKE_BUILD_TYPE=Release \
    -DENABLE_TESTS=0 -DENABLE_DOCS=0 -DENABLE_TOOLS=0 >/dev/null
  cmake --build "$BUILD/aom-3.15.1-svc-b" --target svc_encoder_rtc >/dev/null
fi
ls "$BUILD/aom-3.15.1-b/svc_encoder_rtc" "$BUILD/aom-3.15.1-svc-b/svc_encoder_rtc"
