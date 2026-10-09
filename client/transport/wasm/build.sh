#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
export RUSTFLAGS="${RUSTFLAGS:---cfg=web_sys_unstable_apis}"
wasm-pack build --target web --release
