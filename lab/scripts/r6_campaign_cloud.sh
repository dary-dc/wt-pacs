#!/usr/bin/env bash
# R6 on the REAL PATH — stream shape measured against the Oracle rig behind sch_netem,
# instead of against lab/netsim on localhost.
#
# Rig variant of r6_campaign.sh. Everything about the METHOD is carried over unchanged:
# the same three arms, the same four cells, arms interleaved within each repeat, the same
# open-loop reader, and rows emitted by the same lab/scripts/r6_row.py so the verdicts and
# the TSV schema are identical and the two campaigns are directly comparable.
#
# What necessarily differs, and is recorded rather than hidden:
#
#   1. SHAPING IS EGRESS-ONLY. netem runs on the rig's default route and shapes
#      server->client. netsim shapes both directions independently. The ask path here is
#      unshaped: no added delay, no loss, no rate cap on client->server.
#   2. RTT IS NOT 50 ms. netsim's 25 ms each way makes exactly 50 ms. The rig adds 25 ms
#      of egress delay to a real ~34 ms internet path, so the cell is ~59 ms RTT. The
#      rtt_ms column records base + delay, MEASURED at campaign start, not the flag.
#   3. THERE IS NO SEED. netem draws loss from kernel randomness, so repeats resample loss
#      by construction — which is what r6_campaign.sh's per-repeat seed was for. The
#      `ns_cpu_s` column is 0 throughout because there is no simulator process to charge.
#   4. STEP-SCALES ARE RECALIBRATED. The netsim scales are wrong here; the real path is
#      about one step-scale easier. See e0_r6_calibrate_cloud.sh and E0-validation.md.
#
# Usage: EXP=r6cloud CELLS="X1 X2 X3 N0" lab/scripts/r6_campaign_cloud.sh 3
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/lab/scripts/cloud_r6_common.sh"
source "$ROOT/lab/scripts/r6_cell_inputs.sh"

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

# cell -> one-way egress delay ms, rate Mbps, loss %, step-scale
#
# The step-scale column is the RIG-calibrated operating point from e0_r6_calibrate_cloud.sh,
# frozen before any arm ran, calibrated on the incumbent (shared) arm only. It is NOT the
# netsim column: on this path the reader outruns the transport one step-scale sooner, so
# netsim's X1 scale 2 (152 stranded) corresponds to rig scale 1 (155 stranded).
# Frozen from the rig calibration in .local/measurements/r6/cal_cloud/calibration.tsv,
# swept on the incumbent (shared) arm only and then re-checked at 3 independent loss
# realisations each — the E0-R6c guard. Rig sweep, 0.1 % loss / 0 % loss / 1 % loss:
#
#   loss  sc=1              sc=2            sc=4             sc=8
#   0.1%  155 strand ADM    30 strand       0 strand         0 strand
#   0.0%  153 strand ADM    30 strand       0 strand         0 strand
#   1.0%  VOID cdrop=67    363 strand      75 strand ADM     0 strand
#
# The real path is one step-scale EASIER than netsim: netsim's X1 at scale 2 (152 stranded)
# is this rig's scale 1 (155 stranded), and netsim's X3 at scale 8 (35 stranded, p95 181)
# is this rig's scale 4 (14-46 stranded, p95 85-191). Reusing the netsim column would have
# put X1, X2 and X3 all at zero stranding — i.e. would have run the campaign in cells that
# cannot produce the effect under test.
cell_params() {
  case "$1" in
    X1) echo "25 20 0.1 ${SCALE_X1:-1}" ;;   # loss AND stranding — the deployment case
    X2) echo "25 20 0.0 ${SCALE_X2:-1}" ;;   # stranding, no loss — H5 alone
    X3) echo "25 20 1.0 ${SCALE_X3:-4}" ;;   # loss-dominant, weak stranding
    # NEGATIVE CONTROL — all arms must tie. Held at X3's reader speed, not at its own, so
    # that N0 and X3 differ ONLY in loss and the control is matched to the decisive cell.
    # netsim's campaign had the same property (both at scale 8).
    N0) echo "25 20 0.0 ${SCALE_N0:-4}" ;;
    X3S) echo "25 20 1.0 ${SCALE_X3S:-4}" ;; # X3's cell under the scroll trace
    # X3L — X3 at 250 KB frames. NO DEFAULT STEP-SCALE ON PURPOSE.
    #
    # This used to default to 16, which is netsim's 32 halved by the "the real path
    # is one step-scale easier" rule of thumb. That rule was measured for X1/X2/X3 at
    # 64 KB and never checked at 250 KB, where the reader's demand and the achievable
    # rate both move. Carrying it across was the same "calibrated once, assumed to
    # hold" mistake that voided 4 of 9 rows in X3S (docs/HANDOFF.md §5).
    # Calibrate on the rig first — see docs/measurements/r6/x3l-run-card.md.
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

# The rtt_ms column must not be a restatement of the netem flag. netsim's 25 ms each way
# IS 50 ms RTT; here 25 ms of egress delay sits on top of a real internet path, so the
# cell's RTT is base + 25 and writing 50 would understate it by the whole base path.
# Port 22 is deliberately outside the shaper, so a TCP connect there measures the base
# path with netem still installed.
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
