#!/usr/bin/env bash
# Build client/transport-wasm under several release-profile variants (all through wasm-opt, as
# wasm-pack does by default) into .local/wasm-variants/<name>/ and print the sizes.
# Needs wasm-pack and wasm-opt on PATH (npm i -g wasm-pack binaryen) and the wasm32 target.
# usage: lab/bench/wasm_variants.sh            (env: OUT=.local/wasm-variants)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-$ROOT/.local/wasm-variants}"; mkdir -p "$OUT"
cd "$ROOT/client/transport-wasm"
export RUSTFLAGS="--cfg=web_sys_unstable_apis"
build() { # name [ENV=VALUE …] -- [wasm-pack args]
  local name=$1; shift
  local envs=(); while [[ $# -gt 0 && "$1" != "--" ]]; do envs+=("$1"); shift; done; shift || true
  rm -rf "$OUT/$name"
  env "${envs[@]}" wasm-pack build --target web --release --out-dir "$OUT/$name" "$@" >/dev/null 2>"$OUT/$name.build.log" \
    || { echo "BUILD FAILED $name"; tail -5 "$OUT/$name.build.log"; return; }
  local w="$OUT/$name/transport_wasm_bg.wasm"
  printf "%-28s wasm=%8d B  gzip=%7d B  js=%6d B\n" "$name" "$(stat -c %s "$w")" "$(gzip -9 -c "$w" | wc -c)" "$(stat -c %s "$OUT/$name/transport_wasm.js")"
}
build default-opt3 --
build opt3-lto CARGO_PROFILE_RELEASE_LTO=fat CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1 --
build opt-s CARGO_PROFILE_RELEASE_OPT_LEVEL=s --
build opt-s-lto CARGO_PROFILE_RELEASE_OPT_LEVEL=s CARGO_PROFILE_RELEASE_LTO=fat CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1 --
build opt-z-lto CARGO_PROFILE_RELEASE_OPT_LEVEL=z CARGO_PROFILE_RELEASE_LTO=fat CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1 --
build opt3-lto-nopanic CARGO_PROFILE_RELEASE_LTO=fat CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1 CARGO_PROFILE_RELEASE_PANIC=abort --
build opt3-no-console-hook -- --no-default-features
build opt3-lto-no-console-hook CARGO_PROFILE_RELEASE_LTO=fat CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1 -- --no-default-features
