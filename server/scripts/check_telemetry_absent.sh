#!/usr/bin/env bash
# The default (non-telemetry) release binary carries no Tap symbol and no report literal.
set -euo pipefail

cd "$(dirname "$0")/../.."
command -v nm >/dev/null || { echo "nm is missing (binutils)" >&2; exit 2; }

cargo build --release -p exact-server

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

if grep -qE 'exact_server::record::(tap|sink|report|rows)|Tap::for_session|LiveSummary|flush_on_exit' <(nm -C "$BIN"); then
  echo "FAIL: telemetry symbols found in default build" >&2
  nm -C "$BIN" | grep -E 'record::(tap|sink|report|rows)|Tap::|LiveSummary|flush_on_exit' || true
  exit 1
fi

# Report field names live in the data section as serializer literals and survive stripping.
if grep -a -qE 'percentile_method|server_session|histogram-loglinear|rows_in_file|server-pipeline-v|WTPACS_TELEMETRY' "$BIN"; then
  echo "FAIL: telemetry report literals found in default build" >&2
  grep -a -oE 'percentile_method|server_session|histogram-loglinear|rows_in_file|server-pipeline-v[0-9]|WTPACS_TELEMETRY[A-Z_]*' "$BIN" | sort -u || true
  exit 1
fi

echo "OK: no telemetry symbols in default build"
