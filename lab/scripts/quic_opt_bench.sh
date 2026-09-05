#!/usr/bin/env bash
# Loopback throughput rig for the QUIC send-path / crypto / transport-config arms.
#
# One server process per (arm, fixture, depth) cell; harness in --mode saturate with
# --read-bps 0 so no userspace pacer competes with the measurement. Reports Mbps
# (harness fill_rate) and server CPU seconds over the dwell.
#
# Usage: quic_opt_bench.sh <arm-label> <server-bin> [fixture] [depths] [repeats]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ARM="${1:?arm label}"
SERVER_BIN="${2:?server binary path}"
FIXTURE="${3:-frames_250k}"
DEPTHS="${4:-1,4,8,16}"
REPEATS="${5:-3}"
DWELL_MS="${DWELL_MS:-3000}"
PORT="${PORT:-14433}"
STREAM_MODE="${STREAM_MODE:-shared}"
OUT="${OUT:-$ROOT/.local/measurements/quic-opt/results.tsv}"
HARNESS="${HARNESS:-$ROOT/target/release/window-harness}"
# Extra server flags for this arm, e.g. SRV_FLAGS="--send-path copy".
read -r -a SRV_FLAGS <<< "${SRV_FLAGS:-}"

STUDY="$ROOT/lab/fixtures/$FIXTURE/$FIXTURE.sbnd"
FRAME_COUNT=$(python3 -c "import json;print(json.load(open('$ROOT/lab/fixtures/$FIXTURE/metadata.json'))['frameCount'])")

mkdir -p "$(dirname "$OUT")"
[ -s "$OUT" ] || printf 'arm\tfixture\tstream_mode\tdepth\trun\tmbps\tframes\tbytes\tsrv_cpu_s\tsrv_rss_kb\tcpu_s_per_gb\n' > "$OUT"

cpu_of() { awk '{print ($14+$15)/'"$(getconf CLK_TCK)"'}' /proc/"$1"/stat 2>/dev/null || echo 0; }
rss_of() { awk '/VmRSS/{print $2}' /proc/"$1"/status 2>/dev/null || echo 0; }

for D in ${DEPTHS//,/ }; do
  for RUN in $(seq 1 "$REPEATS"); do
    "$SERVER_BIN" --port "$PORT" --study "$STUDY" --stream-mode "$STREAM_MODE" --bind 127.0.0.1 \
      "${SRV_FLAGS[@]}" \
      --cert-pem "$ROOT/server/dev-cert/cert.pem" --key-pem "$ROOT/server/dev-cert/key.pem" \
      > /tmp/quic_opt_server.log 2>&1 &
    SRV=$!
    for _ in $(seq 1 50); do grep -q '^wt_url=' /tmp/quic_opt_server.log && break; sleep 0.1; done
    if ! kill -0 "$SRV" 2>/dev/null; then echo "server died: $(tail -3 /tmp/quic_opt_server.log)" >&2; exit 1; fi

    C0=$(cpu_of "$SRV")
    JSON=$("$HARNESS" --url "https://127.0.0.1:$PORT/" --mode saturate --read-bps 0 \
      --depth "$D" --frame-count "$FRAME_COUNT" --fill-dwell-ms "$DWELL_MS" \
      --stream-mode "$STREAM_MODE" --bind 127.0.0.1 --arm "$ARM" --json 2>/dev/null)
    C1=$(cpu_of "$SRV"); RSS=$(rss_of "$SRV")

    kill "$SRV" 2>/dev/null || true; wait "$SRV" 2>/dev/null || true

    printf '%s' "$JSON" > /tmp/quic_opt_run.json
    python3 - "$ARM" "$FIXTURE" "$STREAM_MODE" "$D" "$RUN" "$C0" "$C1" "$RSS" "$OUT" /tmp/quic_opt_run.json <<'PY'
import json, sys
arm, fx, sm, d, run, c0, c1, rss, out, jf = sys.argv[1:11]
m = json.load(open(jf))
mbps = m["fill_rate"]; frames = m["fill_frames"]; nbytes = m["fill_bytes"]
cpu = float(c1) - float(c0)
# Normalise CPU by every byte the server actually sent in this session, not just the
# dwell slice, so handshake + prefill are inside the denominator too.
gb = m["bytes_on_wire"] / 1e9
per_gb = (cpu / gb) if gb > 0 else 0.0
row = f"{arm}\t{fx}\t{sm}\t{d}\t{run}\t{mbps:.2f}\t{frames}\t{nbytes}\t{cpu:.3f}\t{rss}\t{per_gb:.3f}"
print(row)
open(out, "a").write(row + "\n")
PY
  done
done
