#!/usr/bin/env bash
# Multi-client rig: N concurrent harness sessions against one server.
#
# Why it exists: one harness saturates ~0.93 of a core and caps a single session at
# ~1.4 Gbps on this box, while the server is still at 1.3 of 4 cores. Every
# single-client throughput number is therefore a *client* ceiling. Aggregate over two
# clients is 1.92x one, so the server is not the limit until at least there.
#
# Three clients + one server exceeds 4 cores on this host, so N=2 is the default:
# enough to move the bottleneck to the server, not so much that the clients starve it.
#
# Usage: [N=2] [FIXTURE=frames_250k] [DEPTH=16] quic_opt_multiclient.sh <arm> <server-bin> <repeats>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ARM="${1:?arm label}"; SERVER_BIN="${2:?server binary}"; REPEATS="${3:-3}"
N="${N:-2}"; FIXTURE="${FIXTURE:-frames_250k}"; DEPTH="${DEPTH:-16}"
DWELL_MS="${DWELL_MS:-3000}"; PORT="${PORT:-14477}"; STREAM_MODE="${STREAM_MODE:-shared}"
OUT="${OUT:-$ROOT/.local/measurements/quic-opt/multiclient.tsv}"
HARNESS="${HARNESS:-$ROOT/target/release/window-harness}"
read -r -a SRV_FLAGS <<< "${SRV_FLAGS:-}"

STUDY="$ROOT/lab/fixtures/$FIXTURE/$FIXTURE.sbnd"
FRAME_COUNT=$(python3 -c "import json;print(json.load(open('$ROOT/lab/fixtures/$FIXTURE/metadata.json'))['frameCount'])")
TICK=$(getconf CLK_TCK)
mkdir -p "$(dirname "$OUT")"
[ -s "$OUT" ] || printf 'arm\tfixture\tclients\tdepth\trun\tagg_mbps\tsrv_cpu_s\tsrv_cores\tbytes\tcpu_s_per_gb\n' > "$OUT"

cpu_of() { awk -v t="$TICK" '{print ($14+$15)/t}' /proc/"$1"/stat 2>/dev/null || echo 0; }

for RUN in $(seq 1 "$REPEATS"); do
  "$SERVER_BIN" --port "$PORT" --study "$STUDY" --stream-mode "$STREAM_MODE" --bind 127.0.0.1 \
    "${SRV_FLAGS[@]}" --cert-pem "$ROOT/server/dev-cert/cert.pem" --key-pem "$ROOT/server/dev-cert/key.pem" \
    > /tmp/quic_opt_mc_server.log 2>&1 &
  SRV=$!
  for _ in $(seq 1 50); do grep -q '^wt_url=' /tmp/quic_opt_mc_server.log && break; sleep 0.1; done
  kill -0 "$SRV" 2>/dev/null || { tail -3 /tmp/quic_opt_mc_server.log >&2; exit 1; }

  C0=$(cpu_of "$SRV"); W0=$(date +%s.%N)
  PIDS=()
  for i in $(seq 1 "$N"); do
    "$HARNESS" --url "https://127.0.0.1:$PORT/" --mode saturate --read-bps 0 --depth "$DEPTH" \
      --frame-count "$FRAME_COUNT" --fill-dwell-ms "$DWELL_MS" --stream-mode "$STREAM_MODE" \
      --bind 127.0.0.1 --arm "$ARM" --json > "/tmp/quic_opt_mc_$i.json" 2>/dev/null &
    PIDS+=($!)
  done
  for p in "${PIDS[@]}"; do wait "$p" || true; done
  W1=$(date +%s.%N); C1=$(cpu_of "$SRV")
  kill "$SRV" 2>/dev/null || true; wait "$SRV" 2>/dev/null || true

  python3 - "$ARM" "$FIXTURE" "$N" "$DEPTH" "$RUN" "$C0" "$C1" "$W0" "$W1" "$OUT" <<'PYEOF'
import json, sys
arm, fx, n, depth, run, c0, c1, w0, w1, out = sys.argv[1:11]
runs = [json.load(open(f"/tmp/quic_opt_mc_{i}.json")) for i in range(1, int(n) + 1)]
agg = sum(r["fill_rate"] for r in runs)
nbytes = sum(r["bytes_on_wire"] for r in runs)
cpu = float(c1) - float(c0)
wall = float(w1) - float(w0)
gb = nbytes / 1e9
row = "\t".join([arm, fx, n, depth, run, "%.2f" % agg, "%.3f" % cpu,
                 "%.2f" % (cpu / wall if wall else 0), str(nbytes),
                 "%.3f" % (cpu / gb if gb else 0)])
print(row)
open(out, "a").write(row + "\n")
PYEOF
done
