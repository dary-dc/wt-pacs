#!/usr/bin/env bash
# R6 stream shape on the Oracle rig. Usage: EXP=r6cloud CELLS="X1 X2 X3 N0" ... 3
# How the rig differs from netsim: docs/measurements/r6/step-scale-calibration.md.

REPEATS="${1:-3}"
EXP="${EXP:?set EXP}"
CELLS="${CELLS:-X1 X2 X3 N0}"
DEPTH="${DEPTH:-8}"
CACHE_FRAMES="${CACHE_FRAMES:-64}"
FIXTURE="${FIXTURE:-frames_500x64k}"
TRACE="${TRACE:-$ROOT/lab/traces/radiologist_review_500.json}"
OUT="${OUT:-$ROOT/.local/measurements/r6/$EXP.tsv}"
RAW="${RAW:-$ROOT/.local/measurements/r6/${EXP}_raw}"
FRAME_COUNT=$(python3 -c "import json;print(json.load(open('$ROOT/lab/fixtures/$FIXTURE/metadata.json'))['frameCount'])")
TICK=$(getconf CLK_TCK)

ARMS="${ARMS:-shared|--stream-mode shared;perframe_fair|--stream-mode per-frame;perframe_fifo|--stream-mode per-frame --send-fairness false}"

# cell -> one-way egress delay ms, rate Mbps, loss %, step-scale.
# RIG-calibrated and frozen; NOT the netsim column. step-scale-calibration.md.
cell_params() {
  case "$1" in
    X1) echo "25 20 0.1 ${SCALE_X1:-1}" ;;   # loss AND stranding — the deployment case
    X2) echo "25 20 0.0 ${SCALE_X2:-1}" ;;   # stranding, no loss — H5 alone
    X3) echo "25 20 1.0 ${SCALE_X3:-4}" ;;   # loss-dominant, weak stranding
    # NEGATIVE CONTROL, at X3's reader speed so the two differ ONLY in loss.
    N0) echo "25 20 0.0 ${SCALE_N0:-4}" ;;
    X3S) echo "25 20 1.0 ${SCALE_X3S:-4}" ;; # X3's cell under the scroll trace
    # X3L — NO DEFAULT SCALE ON PURPOSE: the one-step-easier rule was measured at 64 KB.
    # Calibrate on the rig: docs/measurements/r6/x3l-run-card.md.
    X3L) echo "25 20 1.0 ${SCALE_X3L:?set SCALE_X3L from a rig calibration - see docs/measurements/r6/x3l-run-card.md - do not reuse the netsim scale or the old 16 default}" ;;
    *) echo "unknown cell $1" >&2; exit 1 ;;
  esac
}

mkdir -p "$(dirname "$OUT")" "$RAW"
[ -s "$OUT" ] || printf 'exp\tarm\tcell\trtt_ms\trate_mbps\tloss_pct\tstep_scale\tdepth\tcache\trun\tp95_wait_ms\tmean_wait_ms\tpeak_outstanding\twait_samples\tnz_n\tnz_p50\tnz_p95\tnz_p99\tnz_max\treader_lag_ms\tstranded_frames\tstranded_bytes\tcensored\tcensored_frac\tcenter_dropped\tframes_on_wire\tbytes_on_wire\tsrv_cpu_s\tcli_cpu_s\tns_cpu_s\twall_s\tns_qdrop\tverdict\n' > "$OUT"

cpu_of() { awk -v t="$TICK" '{print ($14+$15)/t}' /proc/"$1"/stat 2>/dev/null || echo 0; }

r6_require_cell_inputs

r6_sync_scripts
r6_upload_server
STUDY=$(r6_upload_fixture "$ROOT/lab/fixtures/$FIXTURE/$FIXTURE.sbnd")

# rtt_ms is base + delay, MEASURED, never the flag: the flag alone omits the real path.
# Port 22 sits outside the shaper, so a connect there measures the base with netem installed.
BASE_RTT=$(python3 -c "
import socket,statistics,time
xs=[]
for _ in range(9):
    t=time.time()
    s=socket.create_connection(('$CLOUD_HOST',22),5); s.close()
    xs.append((time.time()-t)*1000)
print(round(statistics.median(xs)))
")
echo "base path RTT (unshaped, ssh bypass): ${BASE_RTT} ms"

CUR_CELL_SHAPE=""
for RUN in $(seq 1 "$REPEATS"); do
  for CELL in $CELLS; do
    read -r DELAY RATE LOSS SCALE <<< "$(cell_params "$CELL")"
    SHAPE="$DELAY/$RATE/$LOSS"
    if [[ "$SHAPE" != "$CUR_CELL_SHAPE" ]]; then
      r6_netem "$DELAY" "$RATE" "$LOSS" >/dev/null
      CUR_CELL_SHAPE="$SHAPE"
    fi
    IFS=';' read -r -a ARM_LIST <<< "$ARMS"
    for SPEC in "${ARM_LIST[@]}"; do
      LABEL="${SPEC%%|*}"; FLAGS="${SPEC#*|}"
      read -r -a SRV_FLAGS <<< "$FLAGS"
      SM=shared; case " ${SRV_FLAGS[*]} " in *" per-frame "*) SM=per-frame ;; esac

      SRVPID=$(r6_start_server "$STUDY" "${SRV_FLAGS[@]}")
      [[ -n "$SRVPID" ]] || { echo "server failed to start for $LABEL/$CELL" >&2; exit 1; }

      S0=$(r6_srv_cpu "$SRVPID"); Q0=$(r6_netem_drops); W0=$(date +%s.%N)
      timeout "${RUN_TIMEOUT:-900}" "$HARNESS" --url "$CLOUD_URL" --mode trace \
        --trace "$TRACE" --read-bps 0 --depth "$DEPTH" --frame-count "$FRAME_COUNT" \
        --stream-mode "$SM" --cache-frames "$CACHE_FRAMES" \
        --reader-mode open --step-scale "$SCALE" --arm "$LABEL" --json \
        > /tmp/r6c_run.json 2>/dev/null &
      CLI=$!; CLI_CPU=0; HPID=""
      # `timeout` is the direct child; the harness is its child. Measuring $CLI measures
      # `timeout` and always reports ~0, silently disabling the client-bound stop condition.
      while kill -0 "$CLI" 2>/dev/null; do
        [ -n "$HPID" ] || HPID=$(pgrep -P "$CLI" 2>/dev/null | head -1)
        [ -n "$HPID" ] && CLI_CPU=$(cpu_of "$HPID")
        sleep 0.15
      done
      wait "$CLI" || true
      W1=$(date +%s.%N); S1=$(r6_srv_cpu "$SRVPID"); Q1=$(r6_netem_drops)

      cp -f /tmp/r6c_run.json "$RAW/${EXP}_${CELL}_${LABEL}_r${RUN}.json" 2>/dev/null || true
      QDROP=$(( ${Q1:-0} - ${Q0:-0} ))
      # ns_cpu is 0 by construction: the shaper is the kernel, not a userspace process.
      python3 "$ROOT/lab/scripts/r6_row.py" "$EXP" "$LABEL" "$CELL" "$((BASE_RTT+DELAY))" "$RATE" \
        "$LOSS" "$SCALE" "$DEPTH" "$CACHE_FRAMES" "$RUN" "$S0" "$S1" "$CLI_CPU" "0" "0" \
        "$W0" "$W1" "$OUT" /tmp/r6c_run.json "$QDROP"
    done
  done
done
r6_stop_server || true
echo "--- $OUT"
python3 "$ROOT/lab/scripts/r6_show.py" "$OUT"
