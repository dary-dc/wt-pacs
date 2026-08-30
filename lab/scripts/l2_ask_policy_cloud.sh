#!/usr/bin/env bash
# Lane L2 — ask policy campaign (docs/lanes/L2-ask-policy.md)
# Harness local → exact-server on Oracle São Paulo with server-side netem.
# Round-robin the netem with L1: refuse to shape if /tmp/wt-pacs-rig.lock is held by another lane.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# Prefer the agent key; fall back only if SSH_KEY already set.
export SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_rig_agent}"
source "$ROOT/lab/scripts/cloud_common.sh"

OUT_TSV="${OUT_TSV:-$ROOT/docs/measurements/r2/l2_ask_policy.tsv}"
D_TRACE_DIR="${D_TRACE_DIR:-$ROOT/docs/measurements/r2/l2_ask_policy_d_current}"
RAW_DIR="${RAW_DIR:-$ROOT/.local/r2/l2_ask_policy/raw}"
LOG="${LOG:-$ROOT/.local/r2/l2_ask_policy/RUN.log}"
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
export RIG_LOCK_HOLDER=L2
source "$ROOT/lab/scripts/rig_lock.sh"

RTTS=(20 60 150)
LOSSES=(0 0.5)
REPEATS=3
ARMS=(control fixed dynamic)

ONLY_RTT="${ONLY_RTT:-}"
ONLY_LOSS="${ONLY_LOSS:-}"
ONLY_ARM="${ONLY_ARM:-}"

mkdir -p "$(dirname "$OUT_TSV")" "$D_TRACE_DIR" "$RAW_DIR" "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1

echo "=== L2 ask-policy $(date -Iseconds) ==="
echo "CLOUD_URL=$CLOUD_URL SSH_KEY=$SSH_KEY"

[[ -f "$SSH_KEY" ]] || { echo "missing SSH_KEY=$SSH_KEY" >&2; exit 1; }
[[ -f "$STUDY" ]] || bash "$ROOT/lab/scripts/gen_tf_fixtures.sh"
[[ -f "$CERT" ]] || bash "$ROOT/server/scripts/gen_dev_cert.sh"
[[ -f "$TRACE" ]] || { echo "missing $TRACE" >&2; exit 1; }

if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  cargo build -p window-harness -p exact-server --release
fi
[[ -x "$HARNESS" ]] || { echo "missing $HARNESS" >&2; exit 1; }
[[ -x "$BIN_SERVER" ]] || { echo "missing $BIN_SERVER" >&2; exit 1; }

if [[ ! -f "$OUT_TSV" ]]; then
  echo -e "arm\trtt_ms\tloss_pct\trun\tp95_wait_ms\tmean_wait_ms\tbytes_on_wire\tasks_sent\td_min_observed\td_max_observed" > "$OUT_TSV"
fi

formula_depth() {
  local rtt=$1
  python3 -c "
import math
rtt_ms=$rtt; fb=$FRAME_BYTES; mbps=$LINK_MBPS; U=0.95
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
  "${SSH[@]}" "mkdir -p /home/ubuntu/wt-pacs/bin /home/ubuntu/wt-pacs/cert /home/ubuntu/wt-pacs/fixtures /home/ubuntu/wt-pacs/scripts"
  "${SCP[@]}" "$BIN_SERVER" "$REMOTE:/home/ubuntu/wt-pacs/bin/exact-server.new"
  "${SCP[@]}" "$CERT" "$KEY_PEM" "$REMOTE:/home/ubuntu/wt-pacs/cert/"
  "${SCP[@]}" "$STUDY" "$REMOTE:$remote_study"
  "${SSH[@]}" "mv -f /home/ubuntu/wt-pacs/bin/exact-server.new /home/ubuntu/wt-pacs/bin/exact-server && chmod +x /home/ubuntu/wt-pacs/bin/exact-server"
  "${SSH[@]}" "bash -s" "$PORT" "$remote_study" <<'REMOTE'
set -euo pipefail
PORT=$1
STUDY=$2
pkill -x exact-server 2>/dev/null || true
sleep 1
> /tmp/wt-pacs-exact.log
setsid env RUST_LOG=info nohup /home/ubuntu/wt-pacs/bin/exact-server \
  --port "$PORT" \
  --study "$STUDY" \
  --cert-pem /home/ubuntu/wt-pacs/cert/cert.pem \
  --key-pem /home/ubuntu/wt-pacs/cert/key.pem \
  --stream-mode shared \
  > /tmp/wt-pacs-exact.log 2>&1 < /dev/null &
disown
sleep 2
pgrep -x exact-server || { echo "exact-server failed:"; cat /tmp/wt-pacs-exact.log; exit 1; }
REMOTE
}

run_one() {
  local arm=$1 rtt=$2 loss=$3 run=$4
  local depth=0
  local dyn_flag=()
  case "$arm" in
    control) depth=0 ;;
    fixed)
      depth=$(formula_depth "$rtt")
      ;;
    dynamic)
      depth=$(formula_depth "$rtt")
      dyn_flag=(--dynamic-depth)
      ;;
    *) echo "bad arm $arm" >&2; exit 1 ;;
  esac

  local json="$RAW_DIR/${arm}_rtt${rtt}_loss${loss}_run${run}.json"
  local label="L2_${arm}_rtt${rtt}_loss${loss}_r${run}"
  echo "==> $label depth=$depth" >&2

  set +e
  "$HARNESS" \
    --url "$CLOUD_URL" \
    --trace "$TRACE" \
    --read-bps 0 \
    --depth "$depth" \
    "${dyn_flag[@]}" \
    --frame-count "$FRAME_COUNT" \
    --fill-dwell-ms 0 \
    --mode trace \
    --arm "$label" \
    --rtt-ms 0 \
    --stream-mode shared \
    --json >"$json" 2>"$json.err"
  local rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then
    echo "FAIL $label rc=$rc" >&2
    cat "$json.err" >&2 || true
    if grep -q oscillating "$json.err" 2>/dev/null; then
      echo "STOP: depth oscillating — see $json.err" >&2
      exit 2
    fi
    echo -e "${arm}\t${rtt}\t${loss}\t${run}\tFAIL\tFAIL\tFAIL\tFAIL\tFAIL\tFAIL" >> "$OUT_TSV"
    return 0
  fi

  python3 - "$json" "$OUT_TSV" "$arm" "$rtt" "$loss" "$run" "$D_TRACE_DIR" <<'PY'
import json, sys, pathlib
path, tsv, arm, rtt, loss, run, ddir = sys.argv[1:8]
m = json.load(open(path))
p95 = m.get("p95_wait_ms", 0)
mean = m.get("mean_wait_ms", 0)
bytes_w = m.get("bytes_on_wire", 0)
asks = m.get("asks_sent", 0)
dmin = m.get("d_min_observed", 0)
dmax = m.get("d_max_observed", 0)
if p95 == 0:
    print(f"VOID {arm} rtt={rtt} loss={loss} run={run}: p95_wait_ms=0", file=sys.stderr)
with open(tsv, "a") as f:
    f.write(f"{arm}\t{rtt}\t{loss}\t{run}\t{p95}\t{mean}\t{bytes_w}\t{asks}\t{dmin}\t{dmax}\n")
traj = m.get("d_current") or []
if traj:
    out = pathlib.Path(ddir) / f"{arm}_rtt{rtt}_loss{loss}_run{run}.tsv"
    out.write_text("step\td_current\n" + "\n".join(f"{i}\t{d}" for i, d in enumerate(traj)) + "\n")
print(f"OK {arm} rtt={rtt} loss={loss} run={run} p95={p95} mean={mean} bytes={bytes_w} d=[{dmin},{dmax}]")
PY
}

# Wait for the rig (round-robin with L1).
for attempt in $(seq 1 120); do
  if rig_lock_acquire; then
    break
  fi
  echo "waiting for rig (attempt $attempt/120)..." >&2
  sleep 30
  if [[ $attempt -eq 120 ]]; then
    echo "timed out waiting for rig lock" >&2
    exit 1
  fi
done

deploy_server

for rtt in "${RTTS[@]}"; do
  [[ -n "$ONLY_RTT" && "$ONLY_RTT" != "$rtt" ]] && continue
  for loss in "${LOSSES[@]}"; do
    [[ -n "$ONLY_LOSS" && "$ONLY_LOSS" != "$loss" ]] && continue
    cloud_set_netem "$rtt" "$loss"
    for arm in "${ARMS[@]}"; do
      [[ -n "$ONLY_ARM" && "$ONLY_ARM" != "$arm" ]] && continue
      for run in $(seq 1 "$REPEATS"); do
        run_one "$arm" "$rtt" "$loss" "$run"
      done
    done
  done
done

cloud_set_netem off 0
release_rig
trap - EXIT
echo "=== L2 ask-policy done $(date -Iseconds) ==="
echo "TSV: $OUT_TSV"
echo "d_current: $D_TRACE_DIR"
