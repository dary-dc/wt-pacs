#!/usr/bin/env bash
# The ingest check's in-process decoders (decode.cpp) against the pinned dav1d of lab/av1/tools/tools.sh and
# the OpenJPH of lab/scripts/gen_htj2k_fixtures.sh, into BUILD/payload/libdecode.so.
#
#   BUILD=... ingest/coded-frames/build.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BUILD="${BUILD:-$ROOT/lab/.av1-build}"
OJPH="$ROOT/lab/.openjph-build/install"
mkdir -p "$BUILD/payload"
c++ -std=c++17 -O2 -shared -fPIC -o "$BUILD/payload/libdecode.so" "$ROOT/ingest/coded-frames/decode.cpp" \
  -I"$BUILD/dav1d/include" -I"$OJPH/include" -L"$BUILD/dav1d/lib" -L"$OJPH/lib" -ldav1d -lopenjph \
  -Wl,-rpath,"$BUILD/dav1d/lib" -Wl,-rpath,"$OJPH/lib"
