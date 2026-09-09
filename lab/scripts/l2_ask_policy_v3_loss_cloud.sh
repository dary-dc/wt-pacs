#!/usr/bin/env bash
# L2 ask-policy v3 — loss-axis expansion (see l2_ask_policy_EVIDENCE.md).
# Requires ask→first-byte path RTT probe (not displayable wait).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_rig_agent}"
source "$ROOT/lab/scripts/cloud_common.sh"

OUT_TSV="${OUT_TSV:-$ROOT/docs/measurements/r2/l2_ask_policy_v3_loss.tsv}"
D_TRACE_DIR="${D_TRACE_DIR:-$ROOT/docs/measurements/r2/l2_ask_policy_v3_loss_d_current}"
RAW_DIR="${RAW_DIR:-$ROOT/docs/measurements/r2/l2_ask_policy_v3_loss/raw}"
LOG="${LOG:-$ROOT/.local/r2/l2_ask_policy_v3_loss/RUN.log}"
PORT="${CLOUD_PORT:-4435}"
CLOUD_URL="${CLOUD_URL:-https://${CLOUD_HOST}:${PORT}/}"
export CLOUD_URL
LINK_MBPS=10
FRAME_BYTES=32000
FRAME_COUNT=80
STUDY="$ROOT/lab/fixtures/frames_32k/frames_32k.sbnd"
TRACE="$ROOT/lab/traces/l2_ask_policy_scroll.json"
CERT="${CERT:-$ROOT/server/dev-cert/cert.pem}"
KEY_PEM="${KEY_PEM:-$ROOT/server/dev-cert/key.pem}"
BIN_SERVER="${BIN_SERVER:-$ROOT/target/release/exact-server}"
export RIG_LOCK_HOLDER=L2-v3
source "$ROOT/lab/scripts/rig_lock.sh"

# First-pass loss map: mid/high delay profiles × expanded loss.
RTTS=(60 150)
LOSSES=(0 0.1 0.5 1.0 2.0)
REPEATS_LOSS0="${REPEATS_LOSS0:-3}"
REPEATS_LOSS="${REPEATS_LOSS:-5}"
ARMS=(control fixed dynamic)

ONLY_RTT="${ONLY_RTT:-}"
ONLY_LOSS="${ONLY_LOSS:-}"
ONLY_ARM="${ONLY_ARM:-}"

mkdir -p "$(dirname "$OUT_TSV")" "$D_TRACE_DIR" "$RAW_DIR" "$(dirname "$LOG")" "$(dirname "$LOG")/../probe"
PROBE_TRACE="${PROBE_TRACE:-$(dirname "$LOG")/../probe/one_frame.json}"
if [[ ! -f "$PROBE_TRACE" ]]; then
  echo '{"name":"probe","max_step":1,"step_interval_ms":16,"settle_on":"last_asked","steps":[{"frame":0}]}' > "$PROBE_TRACE"
fi
exec > >(tee -a "$LOG") 2>&1

echo "=== L2 ask-policy v3 loss $(date -Iseconds) ==="
echo "CLOUD_URL=$CLOUD_URL harness=L2-v3 (ask→first-byte path RTT, expanded loss)"

[[ -f "$SSH_KEY" ]] || { echo "missing SSH_KEY=$SSH_KEY" >&2; exit 1; }
[[ -f "$STUDY" ]] || bash "$ROOT/lab/scripts/gen_tf_fixtures.sh"
[[ -f "$CERT" ]] || bash "$ROOT/server/scripts/gen_dev_cert.sh"
[[ -f "$TRACE" ]] || { echo "missing $TRACE" >&2; exit 1; }

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  cargo build -p window-harness -p exact-server --release
fi
[[ -x "$HARNESS" ]] || { echo "missing $HARNESS" >&2; exit 1; }

if [[ ! -f "$OUT_TSV" ]]; then
  echo -e "arm\trtt_nom_ms\tloss_pct\trun\tpath_rtt_ms\tformula_depth\tp95_lateness_ms\tmean_lateness_ms\tfrac_steps_late\tp95_wait_ms\tmean_wait_ms\tbytes_on_wire\tasks_sent\tunique_frames_asked\tduplicate_asks\td_min_observed\td_max_observed\tpeak_outstanding\twait_samples\tstream_mode\tdrain_incomplete\tdepth_saturated\tmedian_ask_first_byte_ms" > "$OUT_TSV"
fi

measure_path_rtt() {
  # Ask→first-byte median (NOT ask→displayable). Displayable includes Tf and must not
  # feed the BDP formula.
  local rtt_nom=${1:-20}
  local err json rc samples=()
  err=$(mktemp)
  for _ in 1 2 3; do
    set +e
    json=$("$HARNESS" --url "$CLOUD_URL" --trace "$PROBE_TRACE" --read-bps 0 --depth 0 \
      --frame-count "$FRAME_COUNT" --fill-dwell-ms 0 --mode trace --arm _path_rtt_probe \
      --rtt-ms 0 --stream-mode shared --timeout-ms 90000 --json 2>"$err")
    rc=$?
    set -e
    if [[ $rc -eq 0 && -n "$json" ]]; then
      local s
      s=$(python3 -c "
import json, sys
m = json.loads(sys.argv[1])
fb = [x for x in m.get('ask_first_byte_ms') or [] if x > 0]
if fb:
  print(int(round(sorted(fb)[len(fb)//2])))
elif m.get('median_ask_first_byte_ms'):
  print(int(round(m['median_ask_first_byte_ms'])))
else:
  # Legacy fallback — subtract estimated Tf so we do not feed displayable into BDP.
  wait = m.get('mean_wait_ms') or 0
  tf_ms = ($FRAME_BYTES * 8) / ($LINK_MBPS * 1e6) * 1000
  print(max(1, int(round(wait - tf_ms))))
" "$json")
      samples+=("$s")
    fi
  done
  rm -f "$err"
  if [[ ${#samples[@]} -eq 0 ]]; then
    echo "WARN path RTT probe failed — fallback to nominal ${rtt_nom}ms" >&2
    echo "$rtt_nom"
    return 0
  fi
  python3 -c "import statistics,sys; print(int(statistics.median([int(x) for x in sys.argv[1:]])))" "${samples[@]}"
}

formula_depth() {
  local path_rtt=$1
  python3 -c "
import math
rtt_ms=$path_rtt; fb=$FRAME_BYTES; mbps=$LINK_MBPS; U=0.95
tf=(fb*8)/(mbps*1e6)
d=math.ceil(U*(1+rtt_ms/1000/tf))
print(max(1, min(16, d)))
"
}

release_rig() {
  cloud_set_netem off 0 2>/dev/null || true
  rig_lock_release || true
}

cleanup() { release_rig || true; }
trap cleanup EXIT

cloud_sync_netem_script

deploy_server() {
  local remote_study="/home/ubuntu/wt-pacs/fixtures/$(basename "$STUDY")"
  echo "==> deploy exact-server shared mode" >&2
  "${SSH[@]}" 'pkill -x exact-server 2>/dev/null || true; sleep 1'
  "${SSH[@]}" "mkdir -p /home/ubuntu/wt-pacs/bin /home/ubuntu/wt-pacs/cert /home/ubuntu/wt-pacs/fixtures"
  "${SCP[@]}" "$BIN_SERVER" "$REMOTE:/home/ubuntu/wt-pacs/bin/exact-server.new"
  "${SCP[@]}" "$CERT" "$KEY_PEM" "$REMOTE:/home/ubuntu/wt-pacs/cert/"
  "${SCP[@]}" "$STUDY" "$REMOTE:$remote_study"
  "${SSH[@]}" "mv -f /home/ubuntu/wt-pacs/bin/exact-server.new /home/ubuntu/wt-pacs/bin/exact-server && chmod +x /home/ubuntu/wt-pacs/bin/exact-server"
  "${SSH[@]}" "bash -s" "$PORT" "$remote_study" <<'REMOTE'
set -euo pipefail
PORT=$1; STUDY=$2
pkill -x exact-server 2>/dev/null || true; sleep 1
> /tmp/wt-pacs-exact.log
setsid env RUST_LOG=info nohup /home/ubuntu/wt-pacs/bin/exact-server \
  --port "$PORT" --study "$STUDY" \
  --cert-pem /home/ubuntu/wt-pacs/cert/cert.pem \
  --key-pem /home/ubuntu/wt-pacs/cert/key.pem \
  --stream-mode shared \
  > /tmp/wt-pacs-exact.log 2>&1 < /dev/null &
disown
sleep 2
pgrep -x exact-server || { cat /tmp/wt-pacs-exact.log; exit 1; }
REMOTE
}

run_one() {
  local arm=$1 rtt_nom=$2 loss=$3 run=$4 path_rtt=$5
  local depth=0 dyn_flag=()
  case "$arm" in
    control) depth=0 ;;
    fixed) depth=$(formula_depth "$path_rtt") ;;
    dynamic)
      depth=$(formula_depth "$path_rtt")
      dyn_flag=(--dynamic-depth --path-rtt-ms "$path_rtt")
      ;;
  esac
  local json="$RAW_DIR/${arm}_rtt${rtt_nom}_loss${loss}_run${run}.json"
  local label="L2v3_${arm}_rtt${rtt_nom}_loss${loss}_r${run}"
  local fdepth
  fdepth=$(formula_depth "$path_rtt")
  echo "==> $label depth=$depth formula_depth=$fdepth path_rtt=${path_rtt}ms" >&2

  set +e
  "$HARNESS" --url "$CLOUD_URL" --trace "$TRACE" --read-bps 0 --depth "$depth" \
    "${dyn_flag[@]}" --frame-count "$FRAME_COUNT" --fill-dwell-ms 0 --mode trace \
    --arm "$label" --rtt-ms 0 --stream-mode shared --json >"$json" 2>"$json.err"
  local rc=$?
  set -e

  if [[ $rc -ne 0 ]] && grep -Eqi 'not connected|connection timed out|Connection refused' "$json.err" 2>/dev/null; then
    echo "WARN redeploy + retry $label" >&2
    deploy_server
    cloud_set_netem "$rtt_nom" "$loss"
    set +e
    "$HARNESS" --url "$CLOUD_URL" --trace "$TRACE" --read-bps 0 --depth "$depth" \
      "${dyn_flag[@]}" --frame-count "$FRAME_COUNT" --fill-dwell-ms 0 --mode trace \
      --arm "$label" --rtt-ms 0 --stream-mode shared --json >"$json" 2>"$json.err"
    rc=$?
    set -e
  fi

  if [[ $rc -ne 0 ]]; then
    echo "FAIL $label rc=$rc" >&2
    cat "$json.err" >&2 || true
    if [[ -s "$json" ]]; then
      python3 - "$json" "$OUT_TSV" "$arm" "$rtt_nom" "$loss" "$run" "$path_rtt" "$D_TRACE_DIR" "$fdepth" <<'PY'
import json, sys, pathlib, math
path, tsv, arm, rtt, loss, run, path_rtt, ddir, fdepth = sys.argv[1:10]
m = json.load(open(path))
with open(tsv, "a") as f:
  f.write(f"{arm}\t{rtt}\t{loss}\t{run}\t{path_rtt}\t{fdepth}\t{m.get('p95_lateness_ms',0)}\t{m.get('mean_lateness_ms',0)}\t{m.get('frac_steps_late',0)}\t{m.get('p95_wait_ms',0)}\t{m.get('mean_wait_ms',0)}\t{m.get('bytes_on_wire',0)}\t{m.get('asks_sent',0)}\t{m.get('unique_frames_asked',0)}\t{m.get('duplicate_asks',0)}\t{m.get('d_min_observed',0)}\t{m.get('d_max_observed',0)}\t{m.get('peak_outstanding',0)}\t{m.get('wait_samples',0)}\t{m.get('stream_mode','')}\t{int(m.get('drain_incomplete',0))}\t{int(m.get('depth_saturated',0))}\t{m.get('median_ask_first_byte_ms',0)}\n")
traj = m.get("d_current") or []
if traj:
  pathlib.Path(ddir, f"{arm}_rtt{rtt}_loss{loss}_run{run}.tsv").write_text(
    "step\td_current\n" + "\n".join(f"{i}\t{d}" for i, d in enumerate(traj)) + "\n")
if m.get("depth_oscillating"):
  print("WARN: depth_oscillating", file=sys.stderr)
PY
      return 0
    fi
    echo -e "${arm}\t${rtt_nom}\t${loss}\t${run}\t${path_rtt}\t${fdepth}\tFAIL\tFAIL\tFAIL\tFAIL\tFAIL\tFAIL\tFAIL\tFAIL\tFAIL\tFAIL\tFAIL\tFAIL\tFAIL\tFAIL\tFAIL\tFAIL\tFAIL" >> "$OUT_TSV"
    return 0
  fi

  set +e
  python3 - "$json" "$OUT_TSV" "$arm" "$rtt_nom" "$loss" "$run" "$path_rtt" "$D_TRACE_DIR" "$fdepth" <<'PY'
import json, sys, pathlib
path, tsv, arm, rtt, loss, run, path_rtt, ddir, fdepth = sys.argv[1:10]
m = json.load(open(path))
with open(tsv, "a") as f:
  f.write(f"{arm}\t{rtt}\t{loss}\t{run}\t{path_rtt}\t{fdepth}\t{m.get('p95_lateness_ms',0)}\t{m.get('mean_lateness_ms',0)}\t{m.get('frac_steps_late',0)}\t{m.get('p95_wait_ms',0)}\t{m.get('mean_wait_ms',0)}\t{m.get('bytes_on_wire',0)}\t{m.get('asks_sent',0)}\t{m.get('unique_frames_asked',0)}\t{m.get('duplicate_asks',0)}\t{m.get('d_min_observed',0)}\t{m.get('d_max_observed',0)}\t{m.get('peak_outstanding',0)}\t{m.get('wait_samples',0)}\t{m.get('stream_mode','')}\t{int(m.get('drain_incomplete',0))}\t{int(m.get('depth_saturated',0))}\t{m.get('median_ask_first_byte_ms',0)}\n")
traj = m.get("d_current") or []
if traj:
  pathlib.Path(ddir, f"{arm}_rtt{rtt}_loss{loss}_run{run}.tsv").write_text(
    "step\td_current\n" + "\n".join(f"{i}\t{d}" for i, d in enumerate(traj)) + "\n")
print(f"OK {arm} rtt={rtt} loss={loss} run={run} p95_lat={m.get('p95_lateness_ms')} asks={m.get('asks_sent')} uniq={m.get('unique_frames_asked')} d=[{m.get('d_min_observed')},{m.get('d_max_observed')}] path_rtt={path_rtt} fD={fdepth} med_fb={m.get('median_ask_first_byte_ms')}")
if int(m.get('wait_samples') or 0) == 0:
  print('STOP: empty wait samples', file=sys.stderr); sys.exit(3)
if m.get('drain_incomplete'):
  print('STOP: drain incomplete', file=sys.stderr); sys.exit(4)
PY
  local py_rc=$?
  set -e
  if [[ $py_rc -ge 3 ]]; then
    echo "campaign void rc=$py_rc" >&2
    exit 2
  fi
}

for attempt in $(seq 1 120); do
  rig_lock_acquire && break
  echo "waiting for rig $attempt/120..." >&2
  sleep 30
  [[ $attempt -eq 120 ]] && { echo "rig lock timeout" >&2; exit 1; }
done

deploy_server

for rtt in "${RTTS[@]}"; do
  [[ -n "$ONLY_RTT" && "$ONLY_RTT" != "$rtt" ]] && continue
  for loss in "${LOSSES[@]}"; do
    [[ -n "$ONLY_LOSS" && "$ONLY_LOSS" != "$loss" ]] && continue
    cloud_set_netem "$rtt" "$loss"
    path_rtt=$(measure_path_rtt "$rtt")
    echo "path_rtt_ms=$path_rtt (nominal $rtt) formula_depth=$(formula_depth "$path_rtt")" >&2
    repeats=$REPEATS_LOSS0
    if [[ "$loss" != "0" && "$loss" != "0.0" ]]; then
      repeats=$REPEATS_LOSS
    fi
    for run in $(seq 1 "$repeats"); do
      for arm in dynamic fixed control; do
        [[ -n "$ONLY_ARM" && "$ONLY_ARM" != "$arm" ]] && continue
        run_one "$arm" "$rtt" "$loss" "$run" "$path_rtt"
      done
    done
  done
done

cloud_set_netem off 0
release_rig
trap - EXIT
echo "=== L2 ask-policy v3 loss done $(date -Iseconds) ==="
echo "TSV: $OUT_TSV"
