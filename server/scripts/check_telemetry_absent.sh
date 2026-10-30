#!/usr/bin/env bash
# The default (non-telemetry) release binary carries no Tap, path sampler or controller trace, by symbol or literal,
# no lab feature's controller (`lab-classify`) and none of `lab-levers`' flags.
set -euo pipefail

cd "$(dirname "$0")/../.."
command -v nm >/dev/null || { echo "nm is missing (binutils)" >&2; exit 2; }

cargo build --release -p series-server

target_dir="${CARGO_TARGET_DIR:-}"
if [[ -z "$target_dir" ]]; then
  target_dir="$(cargo metadata --format-version 1 --no-deps \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["target_directory"])')"
fi

BIN="$target_dir/release/series-server"
if [[ ! -f "$BIN" ]]; then
  echo "error: expected binary at $BIN (set CARGO_TARGET_DIR if using a custom target dir)" >&2
  exit 1
fi

if grep -qE 'server_telemetry::|Tap::for_session|LiveSummary|flush_on_exit' <(nm -C "$BIN"); then
  echo "FAIL: telemetry symbols found in default build" >&2
  nm -C "$BIN" | grep -E 'server_telemetry::|Tap::|LiveSummary|flush_on_exit' || true
  exit 1
fi

# Report field names live in the data section as serializer literals and survive stripping.
if grep -a -qE 'percentile_method|server_session|histogram-loglinear|rows_in_file|server-pipeline-v|WTPACS_(TELEMETRY|PATH_TELEMETRY|CC_TRACE|LOSS_TRACE)' "$BIN"; then
  echo "FAIL: telemetry report literals found in default build" >&2
  grep -a -oE 'percentile_method|server_session|histogram-loglinear|rows_in_file|server-pipeline-v[0-9]|WTPACS_(TELEMETRY|PATH_TELEMETRY|CC_TRACE|LOSS_TRACE)[A-Z_]*' "$BIN" | sort -u || true
  exit 1
fi

if grep -q 'cc_classify' <(nm -C "$BIN") || grep -a -q 'cubic-classify' "$BIN"; then
  echo "FAIL: lab-classify's controller or flag found in default build" >&2
  exit 1
fi

if grep -q 'transport::lab_levers' <(nm -C "$BIN") \
  || grep -a -qE 'force-pool-reads|hold-sessions|stall-after-bytes|segmentation-offload|send-window-follows-cwnd|per-frame-asks-first|reply-repeated-initial' "$BIN"; then
  echo "FAIL: a lab-levers flag found in default build" >&2
  grep -a -oE 'force-pool-reads|hold-sessions|stall-after-bytes|segmentation-offload|send-window-follows-cwnd|per-frame-asks-first|reply-repeated-initial' "$BIN" | sort -u >&2 || true
  exit 1
fi

echo "OK: no telemetry symbols, no lab controller and no lab lever in default build"
