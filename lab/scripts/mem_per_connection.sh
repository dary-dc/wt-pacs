#!/usr/bin/env bash
# Server memory per concurrent viewer, and whether bounding the windows buys anything.
# Why RssAnon and not RSS, and why the slope and not the ratio: measurements/mem/README.md.
# Usage: [REPEATS=3] [NS="1 5 10 25 50"] mem_per_connection.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRV_BIN="${SRV_BIN:-$ROOT/target/lab-arms/exact-server-seg10}"
HARNESS="$ROOT/target/release/window-harness"
FIXTURE="${FIXTURE:-frames_500x64k}"
STUDY="$ROOT/lab/fixtures/$FIXTURE/$FIXTURE.sbnd"
FRAME_COUNT=$(python3 -c "import json;print(json.load(open('$ROOT/lab/fixtures/$FIXTURE/metadata.json'))['frameCount'])")
TRACE="${TRACE:-$ROOT/lab/traces/radiologist_review_500.json}"
PORT="${PORT:-14495}"
NS="${NS:-1 5 10 25 50}"
REPEATS="${REPEATS:-3}"
DEPTH="${DEPTH:-8}"
# Slow enough that 50 clients do not saturate this 4-core box — beyond that the row
# measures the load generator, not the server.
STEP_SCALE="${STEP_SCALE:-12}"
# LOW is the stress case: at 0 the client keeps up and nothing accumulates to bound.
READ_BPS="${READ_BPS:-0}"
OUT="${OUT:-$ROOT/.local/measurements/mem/mem_per_connection.tsv}"

# Bounded arm from the spec's own rule, 10 Mbps x 150 ms. stream_receive_window stays at
# quinn's default so this isolates the two knobs the spec says are unbounded.
BOUNDED_FLAGS="--receive-window 2000000 --send-window 200000"

ARMS="${ARMS:-default|;bounded|$BOUNDED_FLAGS}"

mkdir -p "$(dirname "$OUT")"
[ -s "$OUT" ] || printf 'arm\tclients\trun\trss_anon_kb\trss_total_kb\tvm_size_kb\tsrv_cpu_s\twall_s\tconnected\tread_bps\tdepth\n' > "$OUT"

anon_of() { awk '/^RssAnon:/{print $2}' /proc/"$1"/status 2>/dev/null || echo 0; }
rss_of()  { awk '/^VmRSS:/{print $2}'   /proc/"$1"/status 2>/dev/null || echo 0; }
vm_of()   { awk '/^VmSize:/{print $2}'  /proc/"$1"/status 2>/dev/null || echo 0; }
tick=$(getconf CLK_TCK)
cpu_of()  { awk -v t="$tick" '{print ($14+$15)/t}' /proc/"$1"/stat 2>/dev/null || echo 0; }

for RUN in $(seq 1 "$REPEATS"); do
  IFS=';' read -r -a ARM_LIST <<< "$ARMS"
  for SPEC in "${ARM_LIST[@]}"; do
    LABEL="${SPEC%%|*}"; FLAGS="${SPEC#*|}"
    read -r -a SRV_FLAGS <<< "$FLAGS"
    for N in $NS; do
      "$SRV_BIN" --port "$PORT" --study "$STUDY" --bind 127.0.0.1 --stream-mode shared \
        --cert-pem "$ROOT/server/dev-cert/cert.pem" --key-pem "$ROOT/server/dev-cert/key.pem" \
        "${SRV_FLAGS[@]}" > /tmp/mem_srv.log 2>&1 &
      SRV=$!
      for _ in $(seq 1 60); do grep -q '^wt_url=' /tmp/mem_srv.log && break; sleep 0.1; done
      kill -0 "$SRV" 2>/dev/null || { echo "server died: $(tail -3 /tmp/mem_srv.log)" >&2; exit 1; }

      C0=$(cpu_of "$SRV"); W0=$(date +%s.%N)
      PIDS=()
      for _ in $(seq 1 "$N"); do
        timeout 200 "$HARNESS" --url "https://127.0.0.1:$PORT/" --mode trace --trace "$TRACE" \
          --read-bps "$READ_BPS" --depth "$DEPTH" --frame-count "$FRAME_COUNT" --stream-mode shared \
          --bind 127.0.0.1 --cache-frames 64 --reader-mode open --step-scale "$STEP_SCALE" \
          --arm mem --json > /dev/null 2>&1 &
        PIDS+=($!)
      done

      # Sample at the peak of the run rather than at its start: connection state is
      # allocated lazily and an early sample reports the handshake, not a session.
      sleep 25
      PEAK_ANON=0; PEAK_RSS=0; PEAK_VM=0
      for _ in $(seq 1 20); do
        a=$(anon_of "$SRV"); r=$(rss_of "$SRV"); v=$(vm_of "$SRV")
        [ "${a:-0}" -gt "$PEAK_ANON" ] && PEAK_ANON=$a
        [ "${r:-0}" -gt "$PEAK_RSS" ] && PEAK_RSS=$r
        [ "${v:-0}" -gt "$PEAK_VM" ] && PEAK_VM=$v
        sleep 0.5
      done
      # How many clients were actually still up when memory was sampled. A row where this
      # is below N measured fewer connections than it claims.
      CONNECTED=0
      for p in "${PIDS[@]}"; do kill -0 "$p" 2>/dev/null && CONNECTED=$((CONNECTED+1)); done

      C1=$(cpu_of "$SRV"); W1=$(date +%s.%N)
      for p in "${PIDS[@]}"; do kill "$p" 2>/dev/null || true; done
      wait "${PIDS[@]}" 2>/dev/null || true
      kill "$SRV" 2>/dev/null || true; wait "$SRV" 2>/dev/null || true

      printf '%s\t%d\t%d\t%d\t%d\t%d\t%.3f\t%.2f\t%d\t%d\t%d\n' \
        "$LABEL" "$N" "$RUN" "$PEAK_ANON" "$PEAK_RSS" "$PEAK_VM" \
        "$(echo "$C1 - $C0" | bc)" "$(echo "$W1 - $W0" | bc)" "$CONNECTED" \
        "$READ_BPS" "$DEPTH" | tee -a "$OUT"
    done
  done
done

echo
echo "--- $OUT"
python3 "$ROOT/lab/scripts/mem_analyse.py" "$OUT"
