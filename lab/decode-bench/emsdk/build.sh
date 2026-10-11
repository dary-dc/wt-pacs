#!/usr/bin/env bash
# P-EMSDK's second arm: the delivered decoders' recipe (client/decode/wasm/build) under emscripten 6.0.11 and its
# Node, every other pin unchanged, into lab/.openjph-build/wasm/em6.{js,wasm}. The delivered build is not touched.
#
#   lab/decode-bench/emsdk/build.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PRODUCT="$ROOT/client/decode/wasm/build"
# Four levels under the root, as inside.sh finds the root from where it runs.
COPY="$ROOT/lab/.emsdk-arm/wasm/build"
rm -rf "$COPY"
mkdir -p "$COPY"
cp "$PRODUCT"/{build.sh,inside.sh,Containerfile,requirements.txt,pins.sh} "$COPY/"
# emsdk dd8e2563 (tag 6.0.11): emscripten-releases-tags.json and emsdk_manifest.json's node.
sed -i -e 's/^EMSCRIPTEN_VERSION=.*/EMSCRIPTEN_VERSION=6.0.11/' \
  -e 's/^EMSCRIPTEN_RELEASE=.*/EMSCRIPTEN_RELEASE=f6264d4a4dd9ba24a9f0a5702835a44d1463de13/' \
  -e 's/^EMSCRIPTEN_SHA256=.*/EMSCRIPTEN_SHA256=EM6_SHA256/' \
  -e 's/^NODE_VERSION=.*/NODE_VERSION=24.19.0/' \
  -e 's/^NODE_SHA256=.*/NODE_SHA256=14b342e71204f811bde6153be8e04b62aef63c236fef92b55f9c83154b409647/' "$COPY/pins.sh"
# 6.0.2 dropped wasmBinary and mainScriptUrlOrBlob from the default INCOMING_MODULE_JS_API; client/decode/wasm-glue.js
# passes both, so without them the glue fetches its own unpinned .wasm. 6.0.11's defaults (src/settings.js), plus the two.
API="ENVIRONMENT,arguments,canvas,dynamicLibraries,elementPointerLock,instantiateWasm,locateFile,monitorRunDependencies"
API+=",noExitRuntime,noInitialRun,onAbort,onExit,onRuntimeInitialized,postRun,preInit,preRun,print,printErr,setStatus"
API+=",statusMessage,stderr,stdin,stdout,thisProgram,wasm,websocket,wasmBinary,mainScriptUrlOrBlob"
sed -i "s/-sMODULARIZE=1 -sEXPORT_NAME=OpenJPHModule/-sINCOMING_MODULE_JS_API=$API &/" "$COPY/inside.sh"
grep -q "INCOMING_MODULE_JS_API=$API" "$COPY/inside.sh" || { echo "the OpenJPH link line moved" >&2; exit 2; }
sed -i "s/EM6_SHA256/$(cat "$(dirname "$0")/emscripten-6.0.11.sha256")/" "$COPY/pins.sh"
OUT="$ROOT/lab/.openjph-build/em6"
CACHE="$PRODUCT/.cache" OUT="$OUT" UPDATE=1 bash "$COPY/build.sh"
mkdir -p "$ROOT/lab/.openjph-build/wasm"
cp "$OUT/openjph/openjph.js" "$ROOT/lab/.openjph-build/wasm/em6.js"
cp "$OUT/openjph/openjph.wasm" "$ROOT/lab/.openjph-build/wasm/em6.wasm"
sha256sum "$ROOT/lab/.openjph-build/wasm/em6".{js,wasm} "$ROOT/client/decode/wasm/built/openjph/openjph".{js,wasm}
