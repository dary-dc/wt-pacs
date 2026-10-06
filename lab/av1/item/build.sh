#!/usr/bin/env bash
# The ingest check's in-process decoders (decode.cpp) against the pinned dav1d of lab/av1/tools.sh and
# the OpenJPH of lab/scripts/gen_htj2k_fixtures.sh, into BUILD/item/libdecode.so.
#
#   BUILD=... lab/av1/item/build.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BUILD="${BUILD:-$ROOT/lab/.av1-build}"
OJPH="$ROOT/lab/.openjph-build/install"
mkdir -p "$BUILD/item"
c++ -std=c++17 -O2 -shared -fPIC -o "$BUILD/item/libdecode.so" "$ROOT/lab/av1/item/decode.cpp" \
  -I"$BUILD/dav1d/include" -I"$OJPH/include" -L"$BUILD/dav1d/lib" -L"$OJPH/lib" -ldav1d -lopenjph \
  -Wl,-rpath,"$BUILD/dav1d/lib" -Wl,-rpath,"$OJPH/lib"
