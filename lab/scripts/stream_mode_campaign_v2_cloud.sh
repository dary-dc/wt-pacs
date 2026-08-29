#!/usr/bin/env bash
# Stream-mode campaign v2 — docs/stream-mode-campaign-v2.md
# Harness local → exact-server on São Paulo rig with server-side netem.
# --rtt-ms is always 0. --read-bps 0. --mode saturate.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/lab/scripts/cloud_common.sh"

OUT_TSV="${OUT_TSV:-$ROOT/docs/measurements/r2/stream_mode_campaign_v2.tsv}"
RAW_DIR="${RAW_DIR:-$ROOT/.local/r2/campaign_v2/raw}"
LOG="${LOG:-$ROOT/.local/r2/campaign_v2/RUN.log}"
FILL_DWELL_MS="${FILL_DWELL_MS:-5000}"
LINK_MBPS=10
PORT="${CLOUD_PORT:-4435}"
CLOUD_URL="${CLOUD_URL:-https://${CLOUD_HOST}:${PORT}/}"
export CLOUD_URL

BIN_MAIN="${BIN_MAIN:-$ROOT/.local/r2/bin-main-exact-server}"
BIN_Q="${BIN_Q:-$ROOT/.local/r2/bin-q-exact-server}"
HARNESS="${HARNESS:-$ROOT/.local/r2/window-harness}"
CERT="${CERT:-$ROOT/server/dev-cert/cert.pem}"
KEY_PEM="${KEY_PEM:-$ROOT/server/dev-cert/key.pem}"

STUDY_250="$ROOT/lab/fixtures/frames_250k/frames_250k.sbnd"
STUDY_32="$ROOT/lab/fixtures/frames_32k/frames_32k.sbnd"

DEPTHS=(1 2 3 4 6 8 12 16)
RTTS=(20 60 150)
REPEATS=3

# Optional: restrict for resume / control-first runs.
ONLY_RTT="${ONLY_RTT:-}"
ONLY_ARM="${ONLY_ARM:-}"
ONLY_FIXTURE="${ONLY_FIXTURE:-}"

mkdir -p "$(dirname "$OUT_TSV")" "$RAW_DIR" "$(dirname "$LOG")"
exec > >(tee -a "$LOG") 2>&1

echo "=== stream-mode campaign v2 $(date -Iseconds) ==="
echo "CLOUD_URL=$CLOUD_URL HARNESS=$HARNESS"

[[ -x "$BIN_MAIN" ]] || { echo "missing $BIN_MAIN" >&2; exit 1; }
[[ -x "$BIN_Q" ]] || { echo "missing $BIN_Q" >&2; exit 1; }
[[ -x "$HARNESS" ]] || { echo "missing $HARNESS" >&2; exit 1; }
[[ -f "$STUDY_250" ]] || bash "$ROOT/lab/scripts/gen_tf_fixtures.sh"
[[ -f "$CERT" ]] || bash "$ROOT/server/scripts/gen_dev_cert.sh"

if [[ ! -f "$OUT_TSV" ]]; then
  echo -e "arm\tfixture\trtt_ms\tdepth\trun\tmbps\tp95_wait_ms\tpeak_outstanding\tasks_sent" > "$OUT_TSV"
fi

cleanup() { cloud_set_netem off 2>/dev/null || true; }
trap cleanup EXIT

cloud_sync_netem_script

deploy_arm() {
  local arm=$1 study=$2 stream_mode=$3
  local bin remote_study
  case "$arm" in
    S|P) bin="$BIN_MAIN" ;;
    Q) bin="$BIN_Q" ;;
    *) echo "bad arm $arm" >&2; exit 1 ;;
  esac
  remote_study="/home/ubuntu/wt-pacs/fixtures/$(basename "$study")"

  echo "==> deploy arm=$arm mode=$stream_mode study=$(basename "$study")" >&2
  "${SSH[@]}" 'pkill -x exact-server 2>/dev/null || true; sleep 1'
  "${SSH[@]}" "mkdir -p /home/ubuntu/wt-pacs/bin /home/ubuntu/wt-pacs/cert /home/ubuntu/wt-pacs/fixtures /home/ubuntu/wt-pacs/scripts"
  "${SCP[@]}" "$bin" "$REMOTE:/home/ubuntu/wt-pacs/bin/exact-server.new"
  "${SCP[@]}" "$CERT" "$KEY_PEM" "$REMOTE:/home/ubuntu/wt-pacs/cert/"
  "${SCP[@]}" "$study" "$REMOTE:$remote_study"
  "${SSH[@]}" "mv -f /home/ubuntu/wt-pacs/bin/exact-server.new /home/ubuntu/wt-pacs/bin/exact-server && chmod +x /home/ubuntu/wt-pacs/bin/exact-server"

  "${SSH[@]}" "bash -s" "$PORT" "$remote_study" "$stream_mode" <<'REMOTE'
set -euo pipefail
PORT=$1
STUDY=$2
MODE=$3
pkill -x exact-server 2>/dev/null || true
sleep 1
> /tmp/wt-pacs-exact.log
setsid env RUST_LOG=info nohup /home/ubuntu/wt-pacs/bin/exact-server \
  --port "$PORT" \
  --study "$STUDY" \
  --cert-pem /home/ubuntu/wt-pacs/cert/cert.pem \
  --key-pem /home/ubuntu/wt-pacs/cert/key.pem \
  --stream-mode "$MODE" \
  > /tmp/wt-pacs-exact.log 2>&1 < /dev/null &
disown
sleep 2
pgrep -x exact-server || { echo "exact-server failed:"; cat /tmp/wt-pacs-exact.log; exit 1; }
grep -E '^wt_url=|^frames=|^cert_sha256=' /tmp/wt-pacs-exact.log || cat /tmp/wt-pacs-exact.log
REMOTE
}

restart_server() {
  local study=$1 stream_mode=$2
  local remote_study="/home/ubuntu/wt-pacs/fixtures/$(basename "$study")"
  "${SSH[@]}" "bash -s" "$PORT" "$remote_study" "$stream_mode" <<'REMOTE'
set -euo pipefail
PORT=$1
STUDY=$2
MODE=$3
pkill -x exact-server 2>/dev/null || true
sleep 1
> /tmp/wt-pacs-exact.log
setsid env RUST_LOG=info nohup /home/ubuntu/wt-pacs/bin/exact-server \
  --port "$PORT" \
  --study "$STUDY" \
  --cert-pem /home/ubuntu/wt-pacs/cert/cert.pem \
  --key-pem /home/ubuntu/wt-pacs/cert/key.pem \
  --stream-mode "$MODE" \
  > /tmp/wt-pacs-exact.log 2>&1 < /dev/null &
disown
sleep 1.5
pgrep -x exact-server || { echo "exact-server failed:"; cat /tmp/wt-pacs-exact.log; exit 1; }
REMOTE
}

row_exists() {
  local arm=$1 fixture=$2 rtt=$3 depth=$4 run=$5
  awk -F'\t' -v a="$arm" -v f="$fixture" -v r="$rtt" -v d="$depth" -v n="$run" \
    'NR>1 && $1==a && $2==f && $3==r && $4==d && $5==n {found=1} END{exit !found}' "$OUT_TSV"
}

run_cell() {
  local arm=$1 fixture=$2 frame_count=$3 stream_mode=$4 rtt=$5 depth=$6 run=$7
  local tag raw json_file
  tag="${arm}_${fixture}_rtt${rtt}_d${depth}_r${run}"
  raw="$RAW_DIR/${tag}.json"

  if row_exists "$arm" "$fixture" "$rtt" "$depth" "$run"; then
    echo "skip existing $tag" >&2
    return 0
  fi

  echo "==> $tag" >&2

  set +e
  timeout 120 "$HARNESS" --url "$CLOUD_URL" --mode saturate \
    --read-bps 0 --depth "$depth" --frame-count "$frame_count" \
    --fill-dwell-ms "$FILL_DWELL_MS" --stream-mode "$stream_mode" \
    --rtt-ms 0 --arm "$tag" --json >"$raw" 2>"$raw.err"
  local rc=$?
  set -e

  if [[ $rc -ne 0 ]]; then
    echo "FAIL $tag harness_rc=$rc" >&2
    cat "$raw.err" >&2 || true
    # One retry after server restart (transient)
    restart_server "$ROOT/lab/fixtures/${fixture}/${fixture}.sbnd" "$stream_mode"
    set +e
    timeout 120 "$HARNESS" --url "$CLOUD_URL" --mode saturate \
      --read-bps 0 --depth "$depth" --frame-count "$frame_count" \
      --fill-dwell-ms "$FILL_DWELL_MS" --stream-mode "$stream_mode" \
      --rtt-ms 0 --arm "$tag" --json >"$raw" 2>"$raw.err"
    rc=$?
    set -e
    if [[ $rc -ne 0 ]]; then
      echo "FAIL $tag harness_rc=$rc after restart" >&2
      cat "$raw.err" >&2 || true
      echo -e "${arm}\t${fixture}\t${rtt}\t${depth}\t${run}\tFAIL\tFAIL\t-\t-" >> "$OUT_TSV"
      echo "STOP: run will not complete ($tag). Campaign void from here." >&2
      return 2
    fi
  fi

  python3 - "$LINK_MBPS" "$raw" "$arm" "$fixture" "$rtt" "$depth" "$run" "$OUT_TSV" <<'PY'
import json, sys
link_mbps = float(sys.argv[1])
path, arm, fixture, rtt, depth, run, out = sys.argv[2:9]
m = json.load(open(path))
dwell_ms = max(1, int(m.get("fill_dwell_ms") or 1))
fill_bytes = int(m.get("fill_bytes") or 0)
mbps = (fill_bytes * 8.0 / (dwell_ms / 1000.0)) / 1_000_000.0
p95 = float(m.get("p95_wait_ms") or 0)
peak = int(m.get("peak_outstanding") or 0)
asks = int(m.get("asks_sent") or 0)
line = f"{arm}\t{fixture}\t{rtt}\t{depth}\t{run}\t{mbps:.3f}\t{p95:.2f}\t{peak}\t{asks}\n"
open(out, "a").write(line)
print(f"OK {arm} {fixture} {rtt}ms D={depth} run {run}: {mbps:.3f} Mbps", flush=True)
PY
}

# Arms: S shared main, P per-frame main, Q per-frame branch.
declare -A ARM_MODE=( [S]=shared [P]=per-frame [Q]=per-frame )
declare -A FIX_FC=( [frames_250k]=80 [frames_32k]=80 )

# Control-first: RTT 20 across all arms, then 60, then 150.
for rtt in "${RTTS[@]}"; do
  [[ -n "$ONLY_RTT" && "$ONLY_RTT" != "$rtt" ]] && continue
  cloud_set_netem "$rtt"

  for fixture in frames_250k frames_32k; do
    [[ -n "$ONLY_FIXTURE" && "$ONLY_FIXTURE" != "$fixture" ]] && continue
    fc="${FIX_FC[$fixture]}"
    study="$ROOT/lab/fixtures/${fixture}/${fixture}.sbnd"

    for arm in S P Q; do
      [[ -n "$ONLY_ARM" && "$ONLY_ARM" != "$arm" ]] && continue
      mode="${ARM_MODE[$arm]}"
      deploy_arm "$arm" "$study" "$mode"

      for depth in "${DEPTHS[@]}"; do
        for run in $(seq 1 "$REPEATS"); do
          if ! run_cell "$arm" "$fixture" "$fc" "$mode" "$rtt" "$depth" "$run"; then
            cloud_set_netem off
            exit 2
          fi
        done
      done
    done
  done

  # Stop condition after RTT 20 control: report D=16 medians; if not close, void.
  if [[ "$rtt" == "20" ]]; then
    python3 - "$OUT_TSV" <<'PY'
import csv, statistics, sys
from collections import defaultdict
path = sys.argv[1]
by = defaultdict(list)
with open(path) as f:
    for r in csv.DictReader(f, delimiter="\t"):
        if r["rtt_ms"] != "20" or r["depth"] != "16" or r["mbps"] in ("FAIL", "-"):
            continue
        by[(r["fixture"], r["arm"])].append(float(r["mbps"]))
print("RTT20 control D=16 mbps (all runs):")
for key in sorted(by):
    vals = by[key]
    print(f"  {key[0]} arm {key[1]}: {vals} median={statistics.median(vals):.3f}")
# Per fixture, compare arm medians.
void = False
for fixture in sorted({k[0] for k in by}):
    med = {arm: statistics.median(by[(fixture, arm)]) for arm in ("S", "P", "Q") if (fixture, arm) in by}
    if len(med) < 3:
        print(f"STOP: RTT20 incomplete for {fixture}: {med}")
        void = True
        continue
    spread = max(med.values()) - min(med.values())
    print(f"  {fixture} median spread S/P/Q={med} spread_mbps={spread:.3f}")
    # Gate: arms must be close at RTT 20. >2 Mbps spread trips stop (operational threshold).
    if spread > 2.0:
        print(f"STOP: RTT20 arms not close on {fixture} (spread {spread:.3f} Mbps > 2.0)")
        void = True
if void:
    raise SystemExit(3)
print("RTT20 control: arms within 2.0 Mbps at D=16; continuing")
PY
  fi
done

cloud_set_netem off
echo "=== campaign complete $(date -Iseconds) ==="
echo "TSV=$OUT_TSV"
