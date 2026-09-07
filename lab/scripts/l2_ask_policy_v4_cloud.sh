#!/usr/bin/env bash
# L2 ask-policy v4 — shaped-path campaign. Lab only.
#
# Pre-registered (docs/lanes/L2-ask-policy-v4-methodology-fix.md), do not switch:
#   primary reader  = lateness_median_ms
#   primary abandon = stranded_bytes
#   p95_lateness_ms is diagnostic (warm-up on short traces)
#
# Packet e0 must pass first (shaper on path, stats read-only, drops increment):
#   HARNESS_IPV4=--ipv4 lab/scripts/l2_e0_v4_profile.sh
# Then:
#   SKIP_SMOKE=1 HARNESS_IPV4=--ipv4 RTTS=60 lab/scripts/l2_ask_policy_v4_cloud.sh
#
# Void: empty waits; bulk achieved_mbps > 12; a loss>0 run with netem_drops=0.
#
# What changed from v2:
#   * two traces (scroll, jump) at a cadence the link can keep up with (40 ms), because the
#     saturated 16 ms cell cannot separate policies (v2 rows + model); the 16 ms scroll is one
#     optional control cell (STEPS="40 16")
#   * depth and prefetch varied independently: control / window / adr / bulk / bounded, plus the
#     dynamic arm with its two honest RTT inputs (path probe, clean samples)
#   * arm order shuffled per (cell, run); n = 3 at loss 0, n = 10 at loss > 0
#   * netem queue limit set explicitly; netem drop counters recorded per run
#   * TSV carries depth_oscillating, run_rc, achieved_rtt_ms, achieved_mbps, netem_drops, netem_limit
#   * everything is written under .local/ — a summary goes to docs/ only once someone has read it
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_rig_agent}"
source "$ROOT/lab/scripts/cloud_common.sh"

OUT="${OUT:-$ROOT/.local/l2/v4}"
OUT_TSV="$OUT/l2_ask_policy_v4.tsv"
RAW_DIR="$OUT/raw"
LOG="$OUT/RUN.log"
PORT="${CLOUD_PORT:-4435}"
CLOUD_URL="${CLOUD_URL:-https://${CLOUD_HOST}:${PORT}/}"
export CLOUD_URL
LINK_MBPS=10
FRAME_BYTES=32000
FRAME_COUNT=80
NETEM_LIMIT="${NETEM_LIMIT:-1000}"
STUDY="$ROOT/lab/fixtures/frames_32k/frames_32k.sbnd"
CERT="${CERT:-$ROOT/server/dev-cert/cert.pem}"
KEY_PEM="${KEY_PEM:-$ROOT/server/dev-cert/key.pem}"
BIN_SERVER="${BIN_SERVER:-$ROOT/target/release/exact-server}"
HARNESS_IPV4="${HARNESS_IPV4:-}"   # set to --ipv4 on a client host without IPv6
export RIG_LOCK_HOLDER=L2-v4
source "$ROOT/lab/scripts/rig_lock.sh"

STEPS=(${STEPS:-40})
TRACES=(scroll jump)
RTTS=(${RTTS:-20 60 150})
LOSSES=(${LOSSES:-0 0.5})
REPEATS="${REPEATS:-3}"
REPEATS_LOSS="${REPEATS_LOSS:-10}"
# window = same K as adr, no cap. dynfb = lane estimator (must be allowed to move D).
# dynclean = hold-D control. dynpath omitted: it is adr plus noisy Tf.
ARMS=(control window adr bulk dynfb dynclean)

mkdir -p "$OUT/traces" "$RAW_DIR"
PROBE_TRACE="$OUT/traces/one_frame.json"
[[ -f "$PROBE_TRACE" ]] || echo '{"name":"probe","max_step":1,"step_interval_ms":16,"settle_on":"last_asked","steps":[{"frame":0}]}' > "$PROBE_TRACE"
exec > >(tee -a "$LOG") 2>&1

echo "=== L2 ask-policy v4 $(date -Iseconds) ==="
[[ -f "$SSH_KEY" ]] || { echo "missing SSH_KEY=$SSH_KEY" >&2; exit 1; }
[[ -f "$STUDY" ]] || bash "$ROOT/lab/scripts/gen_tf_fixtures.sh"
[[ -f "$CERT" ]] || bash "$ROOT/server/scripts/gen_dev_cert.sh"
[[ "${SKIP_BUILD:-0}" == "1" ]] || cargo build -p window-harness -p exact-server --release
[[ -x "$HARNESS" ]] || { echo "missing $HARNESS" >&2; exit 1; }
# the loopback gates first: a harness that fails them has nothing to say on the rig
[[ "${SKIP_SMOKE:-0}" == "1" ]] || { echo "run lab/scripts/l2_harness_smoke.sh against a local server first, then SKIP_SMOKE=1" >&2; exit 1; }

trace_at() {  # scroll|jump step_ms -> path
  local src out
  case "$1" in scroll) src="$ROOT/lab/traces/l2_ask_policy_scroll.json" ;; jump) src="$ROOT/lab/traces/l2_jump.json" ;; esac
  out="$OUT/traces/$1_step$2.json"
  python3 -c "import json,sys; t=json.load(open(sys.argv[1])); t['step_interval_ms']=int(sys.argv[3]); json.dump(t, open(sys.argv[2],'w'))" "$src" "$out" "$2"
  echo "$out"
}

if [[ ! -f "$OUT_TSV" ]]; then
  printf '%s\n' "arm	trace	step_ms	rtt_nom_ms	loss_pct	run	path_rtt_ms	depth	prefetch	p95_lateness_ms	lateness_median_ms	lateness_max_ms	mean_lateness_ms	frac_steps_late	bytes_on_wire	asks_sent	unique_frames_asked	duplicate_asks	stranded_bytes	d_min_observed	d_max_observed	peak_outstanding	wait_samples	stream_mode	drain_incomplete	depth_saturated	depth_oscillating	run_rc	achieved_rtt_ms	achieved_mbps	netem_drops	netem_limit" > "$OUT_TSV"
fi

measure_path_rtt() {
  # Ask→first-byte on a one-frame trace: the pipe is empty, so the sample is the path.
  local samples=() json
  for _ in 1 2 3; do
    if json=$("$HARNESS" --url "$CLOUD_URL" $HARNESS_IPV4 --trace "$PROBE_TRACE" --read-bps 0 --depth 0 \
        --frame-count "$FRAME_COUNT" --fill-dwell-ms 0 --mode trace --arm _probe --stream-mode shared \
        --timeout-ms 90000 --json 2>/dev/null); then
      samples+=("$(python3 -c "import json,sys; m=json.loads(sys.argv[1]); print(int(round(m['median_ask_first_byte_ms'])))" "$json")")
    fi
  done
  [[ ${#samples[@]} -gt 0 ]] || { echo "path RTT probe failed" >&2; return 1; }
  python3 -c "import statistics,sys; print(int(statistics.median([int(x) for x in sys.argv[1:]])))" "${samples[@]}"
}

formula_depth() {
  python3 -c "import math; tf=($FRAME_BYTES*8)/($LINK_MBPS*1e6); print(max(1, min(16, math.ceil(0.95*(1+$1/1000/tf)))))"
}

netem_drops() { cloud_netem_stats | sed -n 's/.*dropped \([0-9]*\).*/\1/p'; }

cleanup() { cloud_set_netem off 0 2>/dev/null || true; rig_lock_release || true; }
trap cleanup EXIT

deploy_server() {
  local remote_study="/home/ubuntu/wt-pacs/fixtures/$(basename "$STUDY")"
  echo "==> deploy exact-server shared mode on port $PORT" >&2
  "${SSH[@]}" "bash -s" "$PORT" <<'REMOTE'
set -euo pipefail
PORT=$1
pid=$(ss -ltnp 2>/dev/null | sed -n "s/.*:${PORT} .*pid=\\([0-9]*\\).*/\\1/p" | head -1)
[[ -n "${pid:-}" ]] && kill "$pid" 2>/dev/null || true
sleep 1
mkdir -p /home/ubuntu/wt-pacs/{bin,cert,fixtures}
REMOTE
  "${SCP[@]}" "$BIN_SERVER" "$REMOTE:/home/ubuntu/wt-pacs/bin/exact-server.new"
  "${SCP[@]}" "$CERT" "$KEY_PEM" "$REMOTE:/home/ubuntu/wt-pacs/cert/"
  "${SCP[@]}" "$STUDY" "$REMOTE:$remote_study"
  "${SSH[@]}" "bash -s" "$PORT" "$remote_study" <<'REMOTE'
set -euo pipefail
PORT=$1; STUDY=$2
mv -f /home/ubuntu/wt-pacs/bin/exact-server.new /home/ubuntu/wt-pacs/bin/exact-server && chmod +x /home/ubuntu/wt-pacs/bin/exact-server
setsid env RUST_LOG=info nohup /home/ubuntu/wt-pacs/bin/exact-server --port "$PORT" --study "$STUDY" \
  --cert-pem /home/ubuntu/wt-pacs/cert/cert.pem --key-pem /home/ubuntu/wt-pacs/cert/key.pem \
  --stream-mode shared > /tmp/wt-pacs-exact.log 2>&1 < /dev/null &
disown; sleep 2; pgrep -x exact-server || { cat /tmp/wt-pacs-exact.log; exit 1; }
REMOTE
}

run_one() {  # arm trace step rtt loss run path_rtt
  local arm=$1 trace=$2 step=$3 rtt_nom=$4 loss=$5 run=$6 path_rtt=$7
  local d; d=$(formula_depth "$path_rtt")
  local depth=0 prefetch=0 extra=()
  case "$arm" in
    control)  depth=0;  prefetch=0 ;;
    window)   depth=0;  prefetch=$((d - 1)) ;;
    adr)      depth=$d; prefetch=$((d - 1)) ;;
    bulk)     depth=0;  prefetch=$((FRAME_COUNT - 1)) ;;
    bounded)  depth=$d; prefetch=$((FRAME_COUNT - 1)) ;;
    dynpath)  depth=$d; prefetch=$((d - 1)); extra=(--dynamic-depth --rtt-source path --path-rtt-ms "$path_rtt") ;;
    dynfb)    depth=$d; prefetch=$((d - 1)); extra=(--dynamic-depth --rtt-source first-byte) ;;
    dynclean) depth=$d; prefetch=$((d - 1)); extra=(--dynamic-depth --rtt-source clean) ;;
  esac
  local label="v4_${arm}_${trace}_s${step}_rtt${rtt_nom}_loss${loss}_r${run}"
  local json="$RAW_DIR/$label.json"
  local drops0 drops1; drops0=$(netem_drops); drops0=${drops0:-0}
  echo "==> $label depth=$depth prefetch=$prefetch path_rtt=${path_rtt}ms" >&2
  set +e
  "$HARNESS" --url "$CLOUD_URL" $HARNESS_IPV4 --trace "$(trace_at "$trace" "$step")" --read-bps 0 \
    --depth "$depth" --prefetch "$prefetch" "${extra[@]}" --frame-count "$FRAME_COUNT" --fill-dwell-ms 0 \
    --mode trace --arm "$label" --stream-mode shared --timeout-ms "${TIMEOUT_MS:-180000}" --json > "$json" 2> "$json.err"
  local rc=$?
  set -e
  drops1=$(netem_drops); drops1=${drops1:-0}
  python3 - "$json" "$OUT_TSV" "$arm" "$trace" "$step" "$rtt_nom" "$loss" "$run" "$path_rtt" "$depth" "$prefetch" "$rc" "$((drops1 - drops0))" "$NETEM_LIMIT" <<'PY'
import json, sys
path, tsv, arm, trace, step, rtt, loss, run, path_rtt, depth, prefetch, rc, drops, limit = sys.argv[1:15]
try:
    m = json.load(open(path))
except Exception:
    m = {}
g = lambda k, d=0: m.get(k, d)
row = [arm, trace, step, rtt, loss, run, path_rtt, depth, prefetch,
       g("p95_lateness_ms"), g("lateness_median_ms"), g("lateness_max_ms"), g("mean_lateness_ms"), g("frac_steps_late"),
       g("bytes_on_wire"), g("asks_sent"), g("unique_frames_asked"), g("duplicate_asks"), g("stranded_bytes"),
       g("d_min_observed"), g("d_max_observed"), g("peak_outstanding"), g("wait_samples"), g("stream_mode", ""),
       int(bool(g("drain_incomplete"))), int(bool(g("depth_saturated"))), int(bool(g("depth_oscillating"))), rc,
       g("median_ask_first_byte_ms"), g("achieved_mbps"), drops, limit]
open(tsv, "a").write("\t".join(str(x) for x in row) + "\n")
print(f"{'OK' if rc == '0' else 'FAIL rc=' + rc} {arm} {trace} rtt={rtt} loss={loss} run={run} p95_lat={g('p95_lateness_ms')} med={g('lateness_median_ms')} stranded={g('stranded_bytes')} D=[{g('d_min_observed')},{g('d_max_observed')}] drops={drops}")
if rc == "0" and int(g("wait_samples") or 0) == 0:
    print("STOP: empty wait samples", file=sys.stderr); sys.exit(3)
if arm == "bulk" and float(g("achieved_mbps") or 0) > 12:
    print("STOP: bulk achieved_mbps > 12 — shaper not on path", file=sys.stderr); sys.exit(4)
if float(loss) > 0 and int(drops) == 0 and int(g("asks_sent") or 0) >= 20:
    print("STOP: loss>0 run with netem_drops=0 — stats still wiping or loss not on path", file=sys.stderr); sys.exit(5)
PY
  local py_rc=$?
  [[ $py_rc -ge 3 ]] && { echo "campaign void rc=$py_rc" >&2; exit 2; }
  return 0
}

for attempt in $(seq 1 120); do
  rig_lock_acquire && break
  echo "waiting for rig $attempt/120..." >&2; sleep 30
  [[ $attempt -eq 120 ]] && { echo "rig lock timeout" >&2; exit 1; }
done
cloud_sync_netem_script
deploy_server

for rtt in "${RTTS[@]}"; do
  for loss in "${LOSSES[@]}"; do
    cloud_set_netem "$rtt" "$loss" "$NETEM_LIMIT"
    path_rtt=$(measure_path_rtt)
    echo "path_rtt_ms=$path_rtt (nominal $rtt, loss $loss)" >&2
    repeats=$REPEATS; [[ "$loss" != "0" ]] && repeats=$REPEATS_LOSS
    for step in "${STEPS[@]}"; do
      for trace in "${TRACES[@]}"; do
        for run in $(seq 1 "$repeats"); do
          for arm in $(printf '%s\n' "${ARMS[@]}" | shuf); do
            run_one "$arm" "$trace" "$step" "$rtt" "$loss" "$run" "$path_rtt"
          done
        done
      done
    done
  done
done

cloud_set_netem off 0
rig_lock_release
trap - EXIT
echo "=== L2 ask-policy v4 done $(date -Iseconds) === TSV: $OUT_TSV"
