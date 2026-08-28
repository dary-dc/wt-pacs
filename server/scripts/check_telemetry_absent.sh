#!/usr/bin/env bash
# Verify the default (non-telemetry) server binary contains no Tap symbols.
#
# What this checks (B1 isolation harness for CI):
#   1. Builds exact-server with default features (no `telemetry`).
#   2. Locates the release binary via `cargo metadata` (respects CARGO_TARGET_DIR).
#   3. Fails if `nm` finds Tap / server timing symbols in that binary.
#   4. Fails if `cargo tree` shows a telemetry feature on the default dependency graph.
#
# Usage (from anywhere):
#   server/scripts/check_telemetry_absent.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE="$(cd "$SERVER_DIR/.." && pwd)"

cd "$WORKSPACE"

echo "Building default exact-server (no telemetry feature)…"
cargo build --release -p exact-server 2>&1

target_dir="${CARGO_TARGET_DIR:-}"
if [[ -z "$target_dir" ]]; then
  target_dir="$(cargo metadata --format-version 1 --no-deps \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])')"
fi

BIN="$target_dir/release/exact-server"
if [[ ! -f "$BIN" ]]; then
  echo "error: expected binary at $BIN (set CARGO_TARGET_DIR if using a custom target dir)" >&2
  exit 1
fi

echo "Checking $BIN …"
if nm -C "$BIN" 2>/dev/null | grep -qE 'exact_server::record::tap|Tap::for_session|server_work_us'; then
  echo "FAIL: telemetry symbols found in default build" >&2
  nm -C "$BIN" | grep -E 'record::tap|Tap::' || true
  exit 1
fi

if cargo tree -p exact-server -e normal 2>/dev/null | grep -qiE 'telemetry'; then
  echo "FAIL: telemetry crate/name in default dependency tree" >&2
  exit 1
fi

echo "OK: no telemetry symbols in default build"
