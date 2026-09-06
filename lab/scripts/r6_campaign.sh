#!/usr/bin/env bash
# R6 — stream shape, measured on a rig that can actually produce head-of-line blocking.
#
# Pre-registration: docs/lanes/R6-preregistration.md. Everything here that looks like a
# judgement call was fixed in writing there before this ran.
#
# Differences from l4_campaign.sh, each one a scar from a previous review:
#   - the reader is OPEN-loop, so the transport can fall behind it (review 4)
#   - --step-scale is calibrated per cell on the incumbent arm and frozen across arms,
#     so the operating point cannot be tuned to fit an arm
#   - rows carry stranded / censored / center-dropped counters, and a row that failed to
#     produce the condition under test is VOID rather than quietly averaged in (review 3)
#   - failed runs are written as VOID rows, never dropped: failures are systematically the
#     slowest runs, so deleting them flatters whichever arm fails (review 3)
#   - arms are interleaved within each repeat, because host drift is not common-mode
#     and has already produced one wrong answer in this work (review 1)
#
# Usage: EXP=x1 CELLS="X1" r6_campaign.sh <repeats>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REPEATS="${1:-3}"
EXP="${EXP:?set EXP}"
CELLS="${CELLS:-X1 X2 X3 N0}"
DEPTH="${DEPTH:-8}"
CACHE_FRAMES="${CACHE_FRAMES:-64}"
FIXTURE="${FIXTURE:-frames_500x64k}"
TRACE="${TRACE:-$ROOT/lab/traces/radiologist_review_500.json}"
OUT="${OUT:-$ROOT/.local/measurements/r6/$EXP.tsv}"
SRV_BIN="${SRV_BIN:-$ROOT/target/lab-arms/exact-server-seg10}"
HARNESS="$ROOT/target/release/window-harness"
NETSIM="$ROOT/target/release/netsim"
SPORT="${SPORT:-14481}"; NPORT="${NPORT:-15081}"
STUDY="$ROOT/lab/fixtures/$FIXTURE/$FIXTURE.sbnd"
FRAME_COUNT=$(python3 -c "import json;print(json.load(open('$ROOT/lab/fixtures/$FIXTURE/metadata.json'))['frameCount'])")
TICK=$(getconf CLK_TCK)

# The three shapes this lane may test. A fixed-N pool would need a server change and this
# lane is constrained not to modify server/ — it stays untested, and is recorded as
# untested rather than inferred about.
ARMS="${ARMS:-shared|--stream-mode shared;perframe_fair|--stream-mode per-frame;perframe_fifo|--stream-mode per-frame --send-fairness false}"

# cell -> one-way delay ms, rate Mbps, per-direction loss %, step-scale
#
# The step-scale column is the calibrated operating point from E0-R6b, frozen. It is what
# makes each cell sit where it claims to: the reader's offered load has to be set against
# the rate the link can ACHIEVE, not the rate it is labelled with. At 1 % loss and 600 ms
# RTT Cubic's Mathis ceiling is 0.24 Mbps against a 30 fps reader's ~15 Mbps demand, and
# every arm collapses identically at 93 % censoring.
cell_params() {
  case "$1" in
    # loss AND stranding — the deployment case, and the only cell where both mechanisms
    # under test are live at once.
    X1) echo "25 20 0.1 2" ;;
    # stranding, no loss: nothing to retransmit, so any arm difference here is SENDER-side
    # scheduling (H5) and cannot be receiver-side head-of-line blocking (H4).
    X2) echo "25 20 0.0 1" ;;
    # loss-DOMINANT, weak stranding. Not "loss without stranding": no such point exists on
    # this trace, because loss lowers achievable throughput and that itself causes
    # stranding. Measured at scale 8: 1 % loss strands 35 frames where 0 % strands 0.
    # 1 % rather than 0.1 % because at 0.1 % and this reader speed the cell is degenerate —
    # p95 79.6 ms with loss against 79.5 ms without, i.e. no effect to attribute.
    X3) echo "25 20 1.0 8" ;;
    # NEGATIVE CONTROL: no loss, reader cannot outrun the link. All arms must tie.
    # If any arm separates here the rig is measuring something other than what it claims
    # and the campaign is void — not adjusted, void.
    N0) echo "25 20 0.0 8" ;;
    *) echo "unknown cell $1" >&2; exit 1 ;;
  esac
}

mkdir -p "$(dirname "$OUT")"
[ -s "$OUT" ] || printf 'exp\tarm\tcell\trtt_ms\trate_mbps\tloss_pct\tstep_scale\tdepth\tcache\trun\tp95_wait_ms\tmean_wait_ms\tpeak_outstanding\twait_samples\tnz_n\tnz_p50\tnz_p95\tnz_p99\tnz_max\treader_lag_ms\tstranded_frames\tstranded_bytes\tcensored\tcensored_frac\tcenter_dropped\tframes_on_wire\tbytes_on_wire\tsrv_cpu_s\tcli_cpu_s\tns_cpu_s\twall_s\tns_qdrop\tverdict\n' > "$OUT"

cpu_of() { awk -v t="$TICK" '{print ($14+$15)/t}' /proc/"$1"/stat 2>/dev/null || echo 0; }

for RUN in $(seq 1 "$REPEATS"); do
  for CELL in $CELLS; do
    read -r DELAY RATE LOSS SCALE <<< "$(cell_params "$CELL")"
    IFS=';' read -r -a ARM_LIST <<< "$ARMS"
    for SPEC in "${ARM_LIST[@]}"; do
      LABEL="${SPEC%%|*}"; FLAGS="${SPEC#*|}"
      read -r -a SRV_FLAGS <<< "$FLAGS"

      "$SRV_BIN" --port "$SPORT" --study "$STUDY" --bind 127.0.0.1 \
        --cert-pem "$ROOT/server/dev-cert/cert.pem" --key-pem "$ROOT/server/dev-cert/key.pem" \
        "${SRV_FLAGS[@]}" > /tmp/r6_server.log 2>&1 &
      SRV=$!
      for _ in $(seq 1 60); do grep -q '^wt_url=' /tmp/r6_server.log && break; sleep 0.1; done
      kill -0 "$SRV" 2>/dev/null || { echo "server died: $(tail -3 /tmp/r6_server.log)" >&2; exit 1; }

      # Seed varies per repeat so repeats resample loss instead of replaying an identical
      # sequence — with a constant seed the reported ranges measure host jitter only, and
      # the non-overlap rule fires on noise (review 2).
      "$NETSIM" --listen 127.0.0.1:"$NPORT" --upstream 127.0.0.1:"$SPORT" \
        --delay-ms "$DELAY" --rate-mbps "$RATE" --loss-pct "$LOSS" --queue-pkts 500 \
        --seed "$((RUN * 7919 + 13))" --stats true > /tmp/r6_netsim.log 2>&1 &
      NS=$!; sleep 0.4

      SM=shared; case " ${SRV_FLAGS[*]} " in *" per-frame "*) SM=per-frame ;; esac

      S0=$(cpu_of "$SRV"); N0C=$(cpu_of "$NS"); W0=$(date +%s.%N)
      timeout "${RUN_TIMEOUT:-420}" "$HARNESS" --url "https://127.0.0.1:$NPORT/" --mode trace \
        --trace "$TRACE" --read-bps 0 --depth "$DEPTH" --frame-count "$FRAME_COUNT" \
        --stream-mode "$SM" --bind 127.0.0.1 --cache-frames "$CACHE_FRAMES" \
        --reader-mode open --step-scale "$SCALE" --arm "$LABEL" --json > /tmp/r6_run.json 2>/dev/null &
      CLI=$!; CLI_CPU=0
      # `timeout` is the direct child; the harness is its child. Measuring $CLI measures
      # `timeout` and always reports ~0, silently disabling the client-bound stop condition.
      HPID=""
      while kill -0 "$CLI" 2>/dev/null; do
        [ -n "$HPID" ] || HPID=$(pgrep -P "$CLI" 2>/dev/null | head -1)
        [ -n "$HPID" ] && CLI_CPU=$(cpu_of "$HPID")
        sleep 0.15
      done
      wait "$CLI" || true
      W1=$(date +%s.%N); S1=$(cpu_of "$SRV"); N1C=$(cpu_of "$NS")
      kill "$NS" "$SRV" 2>/dev/null || true; wait "$NS" "$SRV" 2>/dev/null || true

      QDROP=$(grep -o 'down_queue=[0-9]*' /tmp/r6_netsim.log 2>/dev/null | tail -1 | cut -d= -f2)
      python3 "$ROOT/lab/scripts/r6_row.py" "$EXP" "$LABEL" "$CELL" "$((DELAY*2))" "$RATE" \
        "$LOSS" "$SCALE" "$DEPTH" "$CACHE_FRAMES" "$RUN" "$S0" "$S1" "$CLI_CPU" "$N0C" "$N1C" \
        "$W0" "$W1" "$OUT" /tmp/r6_run.json "${QDROP:-0}"
    done
  done
done
echo "--- $OUT"
python3 "$ROOT/lab/scripts/r6_show.py" "$OUT"
