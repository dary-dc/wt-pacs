#!/usr/bin/env bash
# Lane A — S vs Q under loss (docs/parallel-work-plan-2026-08-29.md).
# Exclusive holder of the São Paulo netem rig for this run.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_rig_agent}"
source "$ROOT/lab/scripts/cloud_common.sh"

OUT_TSV="${OUT_TSV:-$ROOT/docs/measurements/r2/lane_a_s_vs_q_loss.tsv}"
RAW_DIR="${RAW_DIR:-$ROOT/.local/r2/lane_a/raw}"
LOG="${LOG:-$ROOT/.local/r2/lane_a/RUN.log}"
PORT="${CLOUD_PORT:-4435}"
CLOUD_URL="${CLOUD_URL:-https://${CLOUD_HOST}:${PORT}/}"
export CLOUD_URL

BIN_MAIN="${BIN_MAIN:-$ROOT/.local/r2/bin-main-exact-server}"
BIN_Q="${BIN_Q:-$ROOT/.local/r2/bin-q-exact-server}"
HARNESS="${HARNESS:-$ROOT/.local/r2/window-harness}"
CERT="${CERT:-$ROOT/server/dev-cert/cert.pem}"
KEY_PEM="${KEY_PEM:-$ROOT/server/dev-cert/key.pem}"

# D_min from stream_mode_campaign_v2.tsv (95% of arm max mbps), S and Q only.
# frames_250k_live uses frames_250k D_min (same Tf).
declare -A DMIN=(
  [frames_32k|60|S]=8
  [frames_32k|60|Q]=8
  [frames_32k|150|S]=12
  [frames_32k|150|Q]=12
  [frames_250k_live|60|S]=2
  [frames_250k_live|60|Q]=2
  [frames_250k_live|150|S]=2
  [frames_250k_live|150|Q]=2
)

declare -A FIX_FC=(
  [frames_32k]=80
  [frames_250k_live]=320
)
declare -A FIX_TRACE=(
  [frames_32k]=$ROOT/lab/traces/x3_short_scroll.json
  [frames_250k_live]=$ROOT/lab/traces/mild_cell_scroll.json
)
declare -A ARM_MODE=([S]=shared [Q]=per-frame)
declare -A ARM_BIN=([S]=$BIN_MAIN [Q]=$BIN_Q)

LOSSES=(0 0.5 2)
RTTS=(60 150)
REPEATS=3
# Harness per-frame wait timeout; schedule alone is long under loss.
HARNESS_TIMEOUT_MS="${HARNESS_TIMEOUT_MS:-600000}"
CELL_TIMEOUT_S="${CELL_TIMEOUT_S:-900}"

mkdir -p "$(dirname "$OUT_TSV")" "$RAW_DIR" "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1

echo "=== lane A S vs Q loss $(date -Iseconds) ==="
echo "SSH_KEY=$SSH_KEY CLOUD_URL=$CLOUD_URL"
echo "RIG HOLD: lane A exclusive until this script exits"

[[ -x "$BIN_MAIN" && -x "$BIN_Q" && -x "$HARNESS" ]] || {
  echo "missing binaries" >&2
  exit 1
}
[[ -f "$CERT" ]] || bash "$ROOT/server/scripts/gen_dev_cert.sh"

if [[ ! -f "$OUT_TSV" ]]; then
  printf 'arm\tfixture\trtt_ms\tloss_pct\tdepth\trun\tp95_wait_ms\tmean_wait_ms\tmbps\tpeak_outstanding\t%s\n' 'asks_sent' > "$OUT_TSV"
fi

cleanup() {
  echo "RIG RELEASE: clearing netem" >&2
  cloud_set_netem off 2>/dev/null || true
}
trap cleanup EXIT

cloud_sync_netem_script

deploy_arm() {
  local arm=$1 study=$2 stream_mode=$3
  local bin="${ARM_BIN[$arm]}"
  local remote_study="/home/ubuntu/wt-pacs/fixtures/$(basename "$study")"

  echo "==> deploy arm=$arm mode=$stream_mode study=$(basename "$study")" >&2
  "${SSH[@]}" 'pkill -x exact-server 2>/dev/null || true; sleep 1'
  "${SSH[@]}" "mkdir -p /home/ubuntu/wt-pacs/{bin,cert,fixtures,scripts}"
  "${SCP[@]}" "$bin" "$REMOTE:/home/ubuntu/wt-pacs/bin/exact-server.new"
  "${SCP[@]}" "$CERT" "$KEY_PEM" "$REMOTE:/home/ubuntu/wt-pacs/cert/"
  "${SCP[@]}" "$study" "$REMOTE:$remote_study"
  "${SSH[@]}" "mv -f /home/ubuntu/wt-pacs/bin/exact-server.new /home/ubuntu/wt-pacs/bin/exact-server && chmod +x /home/ubuntu/wt-pacs/bin/exact-server"
  "${SSH[@]}" "bash -s" "$PORT" "$remote_study" "$stream_mode" <<'REMOTE'
set -euo pipefail
PORT=$1; STUDY=$2; MODE=$3
pkill -x exact-server 2>/dev/null || true; sleep 1
> /tmp/wt-pacs-exact.log
setsid env RUST_LOG=info nohup /home/ubuntu/wt-pacs/bin/exact-server \
  --port "$PORT" --study "$STUDY" \
  --cert-pem /home/ubuntu/wt-pacs/cert/cert.pem \
  --key-pem /home/ubuntu/wt-pacs/cert/key.pem \
  --stream-mode "$MODE" \
  > /tmp/wt-pacs-exact.log 2>&1 < /dev/null &
disown
sleep 2
pgrep -x exact-server || { echo "exact-server failed:"; cat /tmp/wt-pacs-exact.log; exit 1; }
grep -E '^wt_url=|^frames=' /tmp/wt-pacs-exact.log || cat /tmp/wt-pacs-exact.log
REMOTE
}

row_exists() {
  awk -F'\t' -v a="$1" -v f="$2" -v r="$3" -v l="$4" -v d="$5" -v n="$6" \
    'NR>1 && $1==a && $2==f && $3==r && $4==l && $5==d && $6==n {found=1} END{exit !found}' "$OUT_TSV"
}

append_row() {
  local arm=$1 fixture=$2 rtt=$3 loss=$4 depth=$5 run=$6 raw=$7
  python3 - "$arm" "$fixture" "$rtt" "$loss" "$depth" "$run" "$raw" "$OUT_TSV" <<'PY'
import json, sys
arm, fixture, rtt, loss, depth, run, path, out = sys.argv[1:9]
m = json.load(open(path))
p95 = float(m.get("p95_wait_ms") or 0)
mean = float(m.get("mean_wait_ms") or 0)
peak = int(m.get("peak_outstanding") or 0)
asks = int(m.get("asks_sent") or 0)
dwell_ms = max(1, int(m.get("fill_dwell_ms") or 1))
fill_bytes = int(m.get("fill_bytes") or 0)
# Trace mode: fill dwell may be 0; mbps from bytes_on_wire / recovered if present, else fill.
bytes_ = int(m.get("bytes_on_wire") or fill_bytes or 0)
# Prefer fill_rate-derived when fill_dwell useful; else leave from fill_bytes/dwell.
mbps = (fill_bytes * 8.0 / (dwell_ms / 1000.0)) / 1_000_000.0 if fill_bytes and dwell_ms > 1 else 0.0
if p95 == 0.0:
    print(f"STOP: p95_wait_ms=0 for {arm} {fixture} rtt={rtt} loss={loss} D={depth} run={run} — mode wrong / void", flush=True)
    raise SystemExit(4)
line = f"{arm}\t{fixture}\t{rtt}\t{loss}\t{depth}\t{run}\t{p95:.2f}\t{mean:.2f}\t{mbps:.3f}\t{peak}\t{asks}\n"
open(out, "a").write(line)
print(f"OK arm {arm}, {fixture}, {rtt} ms, {loss} % loss, D={depth}, run {run}: p95 {p95:.2f} ms", flush=True)
PY
}

run_cell() {
  local arm=$1 fixture=$2 rtt=$3 loss=$4 depth=$5 run=$6
  local mode="${ARM_MODE[$arm]}"
  local fc="${FIX_FC[$fixture]}"
  local trace="${FIX_TRACE[$fixture]}"
  local tag="${arm}_${fixture}_rtt${rtt}_loss${loss}_d${depth}_r${run}"
  local raw="$RAW_DIR/${tag}.json"

  if row_exists "$arm" "$fixture" "$rtt" "$loss" "$depth" "$run"; then
    echo "skip $tag" >&2
    return 0
  fi

  echo "==> $tag" >&2
  set +e
  timeout "$CELL_TIMEOUT_S" "$HARNESS" --url "$CLOUD_URL" --mode trace \
    --trace "$trace" --read-bps 0 --depth "$depth" --frame-count "$fc" \
    --fill-dwell-ms 0 --stream-mode "$mode" --rtt-ms 0 \
    --timeout-ms "$HARNESS_TIMEOUT_MS" --arm "$tag" --json \
    >"$raw" 2>"$raw.err"
  local rc=$?
  set -e
  if [[ $rc -ne 0 ]]; then
    echo "FAIL $tag harness_rc=$rc" >&2
    cat "$raw.err" >&2 || true
    echo -e "${arm}\t${fixture}\t${rtt}\t${loss}\t${depth}\t${run}\tFAIL\tFAIL\tFAIL\t-\t-" >> "$OUT_TSV"
    echo "STOP: run will not complete ($tag). Campaign void from here. RIG still held until exit." >&2
    return 2
  fi
  append_row "$arm" "$fixture" "$rtt" "$loss" "$depth" "$run" "$raw"
}

check_d1_control() {
  local fixture=$1 rtt=$2
  python3 - "$OUT_TSV" "$fixture" "$rtt" <<'PY'
import csv, statistics, sys
path, fixture, rtt = sys.argv[1:4]
by = {"S": [], "Q": []}
with open(path) as f:
    for r in csv.DictReader(f, delimiter="\t"):
        if r["fixture"] != fixture or r["rtt_ms"] != rtt or r["loss_pct"] != "0" or r["depth"] != "1":
            continue
        if r["p95_wait_ms"] in ("FAIL", "-"):
            continue
        by[r["arm"]].append(float(r["p95_wait_ms"]))
if len(by["S"]) < 3 or len(by["Q"]) < 3:
    print(f"STOP: D=1 control incomplete for {fixture} rtt={rtt}: {by}")
    raise SystemExit(3)
s, q = statistics.median(by["S"]), statistics.median(by["Q"])
# Relative spread on p95; also absolute. At D=1 arms should agree.
# Operational gate: >25% relative OR >200 ms absolute median gap.
rel = abs(s - q) / max(s, q, 1e-9)
abs_gap = abs(s - q)
print(f"D=1 control {fixture} rtt={rtt}: S p95={by['S']} med={s:.2f}; Q p95={by['Q']} med={q:.2f}; rel={rel:.3f} abs={abs_gap:.2f}")
if rel > 0.25 or abs_gap > 200:
    print(f"STOP: arms differ at D=1 ({fixture} rtt={rtt})")
    raise SystemExit(3)
print("D=1 control ok; continuing")
PY
}

for fixture in frames_32k frames_250k_live; do
  study="$ROOT/lab/fixtures/${fixture}/${fixture}.sbnd"
  [[ -f "$study" ]] || { echo "missing $study" >&2; exit 1; }

  for rtt in "${RTTS[@]}"; do
    # --- D=1 lossless control first ---
    cloud_set_netem "$rtt" 0
    for arm in S Q; do
      deploy_arm "$arm" "$study" "${ARM_MODE[$arm]}"
      for run in $(seq 1 "$REPEATS"); do
        run_cell "$arm" "$fixture" "$rtt" 0 1 "$run" || exit 2
      done
    done
    check_d1_control "$fixture" "$rtt" || {
      echo "STOP: D=1 control failed. Campaign void. Releasing rig." >&2
      exit 3
    }

    # --- Full loss × D_min grid (D=1 only in lossless control above) ---
    for loss in "${LOSSES[@]}"; do
      cloud_set_netem "$rtt" "$loss"
      for arm in S Q; do
        dmin="${DMIN[${fixture}|${rtt}|${arm}]}"
        deploy_arm "$arm" "$study" "${ARM_MODE[$arm]}"
        for run in $(seq 1 "$REPEATS"); do
          run_cell "$arm" "$fixture" "$rtt" "$loss" "$dmin" "$run" || exit 2
        done
      done
    done
  done
done

echo "=== lane A complete $(date -Iseconds) ==="
echo "TSV=$OUT_TSV"
echo "RIG RELEASE: lane A done"
