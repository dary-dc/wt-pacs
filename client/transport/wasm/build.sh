#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
export RUSTFLAGS="${RUSTFLAGS:---cfg=web_sys_unstable_apis}"
# wasm-pack runs the wasm-opt it finds on PATH; this pins the one it would fetch.
BINARYEN=version_117
BINARYEN_SHA256=3dc677006555b355ea2da5e82602065a161d5e83eaefd3f759afa00b96e83212
TOOLS="$ROOT/../../../target/tools"
if [[ ! -x "$TOOLS/binaryen-$BINARYEN/bin/wasm-opt" ]]; then
  mkdir -p "$TOOLS"
  tarball="$TOOLS/binaryen-$BINARYEN.tar.gz"
  curl -sSfL -o "$tarball" \
    "https://github.com/WebAssembly/binaryen/releases/download/$BINARYEN/binaryen-$BINARYEN-x86_64-linux.tar.gz"
  echo "$BINARYEN_SHA256  $tarball" | sha256sum -c --quiet || { echo "binaryen $BINARYEN: checksum mismatch" >&2; exit 2; }
  tar -xzf "$tarball" -C "$TOOLS"
fi
PATH="$TOOLS/binaryen-$BINARYEN/bin:$PATH" wasm-pack build --target web --release
