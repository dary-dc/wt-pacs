#!/usr/bin/env bash
# Rate-shaped variant of quic_opt_bench.sh.
#
# The unshaped loopback rig answers CPU questions (copies, crypto, GSO). It cannot
# answer bandwidth-sharing questions, because fair queuing across streams costs
# nothing when there is no scarcity. This one puts a TBF token bucket on `lo` inside
# a private netns so the arms compete for a fixed rate.
#
# No netem on this kernel, so there is no RTT or loss axis here: rate only.
#
# Usage: RATE=200mbit quic_opt_shaped.sh <arm> <server-bin> <fixture> <depths> <repeats>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="$PATH:/usr/sbin"
RATE="${RATE:-200mbit}"
export ARM="${1:?arm label}" SERVER_BIN="${2:?server binary}" FIXTURE="${3:-frames_250k}"
export DEPTHS="${4:-4,8,16}" REPEATS="${5:-3}"
export RATE ROOT
export OUT="${OUT:-$ROOT/.local/measurements/quic-opt/shaped.tsv}"
export STREAM_MODE="${STREAM_MODE:-shared}" SRV_FLAGS="${SRV_FLAGS:-}"
export DWELL_MS="${DWELL_MS:-3000}" PORT="${PORT:-14455}"
export HARNESS="${HARNESS:-$ROOT/target/release/window-harness}"

mkdir -p "$(dirname "$OUT")"
[ -s "$OUT" ] || printf 'arm\tfixture\tstream_mode\trate\tdepth\trun\tmbps\tframes\tbytes\tsrv_cpu_s\tsrv_rss_kb\tcpu_s_per_gb\n' > "$OUT"

exec unshare --user --map-root-user --net -- bash "$ROOT/lab/scripts/quic_opt_shaped_inner.sh"
