#!/usr/bin/env bash
# Lane L1 v2 — S vs Q under loss (docs/lanes/L1-loss-run.md).
# Decision metric: miss_p95_wait_ms (positive waits only).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_rig_agent}"
source "$ROOT/lab/scripts/cloud_common.sh"

OUT_TSV="${OUT_TSV:-$ROOT/docs/measurements/r2/l1_s_vs_q_loss_v2.tsv}"
RAW_DIR="${RAW_DIR:-$ROOT/.local/r2/l1v2/raw}"
LOG="${LOG:-$ROOT/.local/r2/l1v2/RUN.log}"
PORT="${CLOUD_PORT:-4435}"
CLOUD_URL="${CLOUD_URL:-https://${CLOUD_HOST}:${PORT}/}"
export CLOUD_URL

BIN_MAIN="${BIN_MAIN:-$ROOT/.local/r2/bin-main-exact-server}"
BIN_Q="${BIN_Q:-$ROOT/.local/r2/bin-q-exact-server}"
HARNESS="${HARNESS:-$ROOT/.local/r2/window-harness}"
CERT="${CERT:-$ROOT/server/dev-cert/cert.pem}"
KEY_PEM="${KEY_PEM:-$ROOT/server/dev-cert/key.pem}"

# Product formula D for 32 KB @ 10 Mbit (not saturate D_min).
declare -A D_FORMULA=( [60]=4 [150]=7 )

FIX_FC=80
TRACE="$ROOT/lab/traces/l1_one_way_80.json"
STUDY="$ROOT/lab/fixtures/frames_32k/frames_32k.sbnd"
FIXTURE=frames_32k

declare -A ARM_MODE=([S]=shared [Q]=per-frame)
declare -A ARM_BIN=([S]=$BIN_MAIN [Q]=$BIN_Q)

LOSSES=(0 0.5 2)
RTTS=(60 150)
REPEATS_LOSSLESS="${REPEATS_LOSSLESS:-5}"
REPEATS_LOSS="${REPEATS_LOSS:-10}"
MIN_MISSES="${MIN_MISSES:-20}"
MAX_HIT_RATE="${MAX_HIT_RATE:-0.90}"

HARNESS_TIMEOUT_MS="${HARNESS_TIMEOUT_MS:-600000}"
CELL_TIMEOUT_S="${CELL_TIMEOUT_S:-900}"

mkdir -p "$(dirname "$OUT_TSV")" "$RAW_DIR" "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1

echo "=== L1 v2 S vs Q loss $(date -Iseconds) ==="
echo "SSH_KEY=$SSH_KEY CLOUD_URL=$CLOUD_URL TRACE=$TRACE"
echo "D_formula: 60→${D_FORMULA[60]} 150→${D_FORMULA[150]}"
echo "repeats lossless=$REPEATS_LOSSLESS loss=$REPEATS_LOSS min_misses=$MIN_MISSES max_hit_rate=$MAX_HIT_RATE"

[[ -f "$SSH_KEY" ]] || { echo "STOP: missing SSH_KEY=$SSH_KEY" >&2; exit 1; }
[[ -x "$BIN_MAIN" && -x "$BIN_Q" && -x "$HARNESS" ]] || {
  echo "missing binaries — bash lab/scripts/l1_build_bins.sh" >&2
  exit 1
}
[[ -f "$CERT" ]] || bash "$ROOT/server/scripts/gen_dev_cert.sh"
[[ -f "$STUDY" ]] || bash "$ROOT/lab/scripts/gen_tf_fixtures.sh"
[[ -f "$TRACE" ]] || { echo "missing $TRACE" >&2; exit 1; }

if [[ ! -f "$OUT_TSV" ]]; then
  cat > "$OUT_TSV" <<'HDR'
arm	fixture	rtt_ms	loss_pct	depth	run	miss_p95_wait_ms	miss_mean_wait_ms	p95_wait_ms	mean_wait_ms	cache_hit_rate	cache_misses	asks_sent	peak_outstanding
HDR
fi
# Normalize header to asks_sent if a broken draft header is present.
if head -1 "$OUT_TSV" | grep -q 'tasks_sent'; then
  sed -i '1s/tasks_sent/asks_sent/' "$OUT_TSV"
fi

python3 - <<'PY'
from pathlib import Path
src = Path("lab/window-harness/src/metrics.rs").read_text()
assert "miss_p95_wait_ms" in src and "cache_misses" in src
print("harness metrics: miss-only fields present in source")
PY

# Advisory exclusive holder so operators / other lanes see who owns netem.
acquire_rig_lock() {
  echo "==> acquire rig lock" >&2
  "${SSH[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
LOCKDIR=/home/ubuntu/wt-pacs/locks
mkdir -p "$LOCKDIR"
HOLDER=$LOCKDIR/netem.holder
if [[ -f "$HOLDER" ]]; then
  if find "$HOLDER" -mmin +180 | grep -q .; then
    echo "stale lock; taking over: $(cat "$HOLDER")"
    rm -f "$HOLDER"
  else
    cur=$(cat "$HOLDER")
    case "$cur" in
      L1-v2*) echo "renewing our L1-v2 lock" ;;
      *)
        echo "WARN: displacing holder: $cur (L1 v2 taking exclusive netem)"
        rm -f "$HOLDER"
        ;;
    esac
  fi
fi
echo "L1-v2 $(date -Iseconds)" > "$HOLDER"
REMOTE
}

release_rig_lock() {
  "${SSH[@]}" 'rm -f /home/ubuntu/wt-pacs/locks/netem.holder' 2>/dev/null || true
}

cleanup() {
  echo "RIG RELEASE: clearing netem + lock" >&2
  cloud_set_netem off 2>/dev/null || true
  release_rig_lock
}
trap cleanup EXIT

acquire_rig_lock
cloud_sync_netem_script

deploy_arm() {
  local arm=$1 stream_mode=$2
  local bin="${ARM_BIN[$arm]}"
  local remote_study="/home/ubuntu/wt-pacs/fixtures/$(basename "$STUDY")"

  echo "==> deploy arm=$arm mode=$stream_mode" >&2
  "${SSH[@]}" 'pkill -x exact-server 2>/dev/null || true; sleep 1'
  "${SSH[@]}" "mkdir -p /home/ubuntu/wt-pacs/{bin,cert,fixtures,scripts}"
  "${SCP[@]}" "$bin" "$REMOTE:/home/ubuntu/wt-pacs/bin/exact-server.new"
  "${SCP[@]}" "$CERT" "$KEY_PEM" "$REMOTE:/home/ubuntu/wt-pacs/cert/"
  "${SCP[@]}" "$STUDY" "$REMOTE:$remote_study"
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
    'NR>1 && $1==a && $2==f && $3==r && $4==l && $5==d && $6==n && $7!="FAIL" {found=1} END{exit !found}' "$OUT_TSV"
}

append_row() {
  local arm=$1 fixture=$2 rtt=$3 loss=$4 depth=$5 run=$6 raw=$7
  python3 - "$arm" "$fixture" "$rtt" "$loss" "$depth" "$run" "$raw" "$OUT_TSV" \
    "$MIN_MISSES" "$MAX_HIT_RATE" <<'PY'
import json, sys
arm, fixture, rtt, loss, depth, run, path, out = sys.argv[1:9]
min_misses = int(sys.argv[9])
max_hit = float(sys.argv[10])
m = json.load(open(path))
waits = int(m.get("wait_samples") or len(m.get("wait_ms") or []))
misses = int(m.get("cache_misses") or 0)
hit_rate = float(m.get("cache_hit_rate") or 0)
miss_p95 = float(m.get("miss_p95_wait_ms") or 0)
miss_mean = float(m.get("miss_mean_wait_ms") or 0)
p95 = float(m.get("p95_wait_ms") or 0)
mean = float(m.get("mean_wait_ms") or 0)
peak = int(m.get("peak_outstanding") or 0)
asks = int(m.get("asks_sent") or 0)
loss_f = float(loss)

if waits == 0:
    print(f"STOP: wait_samples=0 — void", flush=True)
    raise SystemExit(4)
if loss_f > 0 and misses < min_misses:
    print(
        f"STOP: cache_misses={misses} < {min_misses} at loss={loss} "
        f"(not enough miss samples for miss_p95) — void",
        flush=True,
    )
    raise SystemExit(4)
if loss_f > 0 and hit_rate > max_hit:
    print(
        f"STOP: cache_hit_rate={hit_rate:.3f} > {max_hit} at loss={loss} "
        f"(prefetch still dominates) — void",
        flush=True,
    )
    raise SystemExit(4)

line = (
    f"{arm}\t{fixture}\t{rtt}\t{loss}\t{depth}\t{run}\t"
    f"{miss_p95:.2f}\t{miss_mean:.2f}\t{p95:.2f}\t{mean:.2f}\t"
    f"{hit_rate:.4f}\t{misses}\t{asks}\t{peak}\n"
)
open(out, "a").write(line)
print(
    f"OK {arm} rtt={rtt} loss={loss}% D={depth} run={run}: "
    f"miss_p95={miss_p95:.2f} hits={hit_rate:.2%} misses={misses}",
    flush=True,
)
PY
}

run_cell() {
  local arm=$1 rtt=$2 loss=$3 depth=$4 run=$5
  local mode="${ARM_MODE[$arm]}"
  local tag="${arm}_${FIXTURE}_rtt${rtt}_loss${loss}_d${depth}_r${run}"
  local raw="$RAW_DIR/${tag}.json"
  local attempt rc

  if row_exists "$arm" "$FIXTURE" "$rtt" "$loss" "$depth" "$run"; then
    echo "skip $tag" >&2
    return 0
  fi

  for attempt in 1 2; do
    echo "==> $tag (attempt $attempt)" >&2
    set +e
    timeout "$CELL_TIMEOUT_S" "$HARNESS" --url "$CLOUD_URL" --mode trace \
      --trace "$TRACE" --read-bps 0 --depth "$depth" --frame-count "$FIX_FC" \
      --fill-dwell-ms 0 --stream-mode "$mode" --rtt-ms 0 \
      --timeout-ms "$HARNESS_TIMEOUT_MS" --arm "$tag" --json \
      >"$raw" 2>"$raw.err"
    rc=$?
    set -e
    if [[ $rc -eq 0 ]]; then
      append_row "$arm" "$FIXTURE" "$rtt" "$loss" "$depth" "$run" "$raw"
      return 0
    fi
    echo "FAIL $tag harness_rc=$rc attempt=$attempt" >&2
    cat "$raw.err" >&2 || true
    if [[ $attempt -eq 1 ]]; then
      echo "retry: redeploy arm=$arm and re-run cell" >&2
      deploy_arm "$arm" "$mode"
      cloud_set_netem "$rtt" "$loss"
      continue
    fi
    echo -e "${arm}\t${FIXTURE}\t${rtt}\t${loss}\t${depth}\t${run}\tFAIL\tFAIL\tFAIL\tFAIL\t-\t-\t-\t-" >> "$OUT_TSV"
    echo "STOP: run will not complete ($tag). Campaign void." >&2
    return 2
  done
}

check_d1_control() {
  local rtt=$1
  python3 - "$OUT_TSV" "$rtt" <<'PY'
import csv, statistics, sys
path, rtt = sys.argv[1:3]
by = {"S": [], "Q": []}
with open(path) as f:
    for r in csv.DictReader(f, delimiter="\t"):
        if r["rtt_ms"] != rtt or r["loss_pct"] != "0" or r["depth"] != "1":
            continue
        if r["miss_p95_wait_ms"] in ("FAIL", "-", ""):
            continue
        by[r["arm"]].append(float(r["miss_p95_wait_ms"]))
need = int(__import__('os').environ.get('REPEATS_LOSSLESS', '5'))
if len(by["S"]) < need or len(by["Q"]) < need:
    print(f"STOP: D=1 control incomplete rtt={rtt}: { {k: len(v) for k,v in by.items()} }")
    raise SystemExit(3)
s, q = statistics.median(by["S"]), statistics.median(by["Q"])
rel = abs(s - q) / max(s, q, 1e-9)
abs_gap = abs(s - q)
print(f"D=1 control rtt={rtt}: S med miss_p95={s:.2f} Q={q:.2f} rel={rel:.3f} abs={abs_gap:.2f}")
if rel > 0.25 or abs_gap > 200:
    print(f"STOP: arms differ at D=1 rtt={rtt}")
    raise SystemExit(3)
print("D=1 control ok")
PY
}

# Ensure clean header only when starting a fresh file (do not wipe resume data).
if [[ ! -s "$OUT_TSV" ]] || [[ "$(wc -l < "$OUT_TSV")" -eq 0 ]]; then
  cat > "$OUT_TSV" <<'HDR'
arm	fixture	rtt_ms	loss_pct	depth	run	miss_p95_wait_ms	miss_mean_wait_ms	p95_wait_ms	mean_wait_ms	cache_hit_rate	cache_misses	asks_sent	peak_outstanding
HDR
fi

for rtt in "${RTTS[@]}"; do
  d_op="${D_FORMULA[$rtt]}"

  # --- D=1 lossless control ---
  cloud_set_netem "$rtt" 0
  for arm in S Q; do
    deploy_arm "$arm" "${ARM_MODE[$arm]}"
    for run in $(seq 1 "$REPEATS_LOSSLESS"); do
      run_cell "$arm" "$rtt" 0 1 "$run" || exit 2
    done
  done
  check_d1_control "$rtt" || exit 3

  # --- loss × formula D ---
  for loss in "${LOSSES[@]}"; do
    repeats="$REPEATS_LOSSLESS"
    if [[ "$loss" != "0" ]]; then
      repeats="$REPEATS_LOSS"
    fi
    cloud_set_netem "$rtt" "$loss"
    for arm in S Q; do
      deploy_arm "$arm" "${ARM_MODE[$arm]}"
      for run in $(seq 1 "$repeats"); do
        run_cell "$arm" "$rtt" "$loss" "$d_op" "$run" || exit 2
      done
    done
  done
done

echo "=== L1 v2 complete $(date -Iseconds) ==="
echo "TSV=$OUT_TSV"
echo "RIG RELEASE: L1 v2 done"
