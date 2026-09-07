#!/usr/bin/env bash
# L2 ask-policy v4 — local loss=0 grid on the reworked harness.
# Lab only: measures window-harness arms. Does not touch product clients.
#
# Same default arms as the cloud script. RTT is the harness --rtt-ms emulator
# (userspace sleeps + LinkPacer). Mechanism check only — do not lock a cap or
# "no dynamic" from this grid. See docs/lanes/L2-ask-policy-v4-methodology-fix.md.
#
# Needs exact-server on 4433 in shared mode with frames_32k:
#   target/release/exact-server --port 4433 --study lab/fixtures/frames_32k/frames_32k.sbnd \
#     --stream-mode shared --bind 127.0.0.1 --cert-pem server/dev-cert/cert.pem \
#     --key-pem server/dev-cert/key.pem
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${OUT:-$ROOT/.local/l2/v4-local}"
HARNESS="${HARNESS:-$ROOT/target/release/window-harness}"
URL="${URL:-https://127.0.0.1:4433/}"
BPS="${BPS:-10000000}"
FRAME_COUNT=80
FRAME_BYTES=32000
LINK_MBPS=10
STEPS=(${STEPS:-40})
TRACES=(${TRACES:-scroll jump})
RTTS=(${RTTS:-20 60 150})
REPEATS="${REPEATS:-3}"
ARMS=(control window adr bulk dynfb dynclean)

mkdir -p "$OUT/traces" "$OUT/raw"
[[ -x "$HARNESS" ]] || { echo "missing $HARNESS — cargo build -p window-harness --release" >&2; exit 1; }

OUT_TSV="$OUT/l2_ask_policy_v4_local.tsv"
if [[ ! -f "$OUT_TSV" ]]; then
  printf '%s\n' "arm	trace	step_ms	rtt_ms	run	depth	prefetch	p95_lateness_ms	lateness_median_ms	lateness_max_ms	mean_lateness_ms	frac_steps_late	bytes_on_wire	asks_sent	unique_frames_asked	duplicate_asks	stranded_bytes	d_min_observed	d_max_observed	peak_outstanding	wait_samples	drain_incomplete	depth_saturated	depth_oscillating	run_rc	achieved_mbps" > "$OUT_TSV"
fi

formula_depth() {
  python3 -c "import math; tf=($FRAME_BYTES*8)/($LINK_MBPS*1e6); print(max(1, min(16, math.ceil(0.95*(1+$1/1000/tf)))))"
}

trace_at() {
  local src out
  case "$1" in
    scroll) src="$ROOT/lab/traces/l2_ask_policy_scroll.json" ;;
    jump) src="$ROOT/lab/traces/l2_jump.json" ;;
  esac
  out="$OUT/traces/$1_step$2.json"
  python3 -c "import json,sys; t=json.load(open(sys.argv[1])); t['step_interval_ms']=int(sys.argv[3]); json.dump(t, open(sys.argv[2],'w'))" "$src" "$out" "$2"
  echo "$out"
}

run_one() {
  local arm=$1 trace=$2 step=$3 rtt=$4 run=$5
  local d; d=$(formula_depth "$rtt")
  local depth=0 prefetch=0 extra=()
  case "$arm" in
    control)  depth=0;  prefetch=0 ;;
    window)   depth=0;  prefetch=$((d - 1)) ;;
    adr)      depth=$d; prefetch=$((d - 1)) ;;
    bulk)     depth=0;  prefetch=$((FRAME_COUNT - 1)) ;;
    bounded)  depth=$d; prefetch=$((FRAME_COUNT - 1)) ;;
    dynpath)  depth=$d; prefetch=$((d - 1)); extra=(--dynamic-depth --rtt-source path --path-rtt-ms "$rtt") ;;
    dynfb)    depth=$d; prefetch=$((d - 1)); extra=(--dynamic-depth --rtt-source first-byte) ;;
    dynclean) depth=$d; prefetch=$((d - 1)); extra=(--dynamic-depth --rtt-source clean) ;;
  esac
  local label="v4loc_${arm}_${trace}_s${step}_rtt${rtt}_r${run}"
  local json="$OUT/raw/$label.json"
  echo "==> $label depth=$depth prefetch=$prefetch" >&2
  set +e
  "$HARNESS" --url "$URL" --ipv4 --stream-mode shared --frame-count "$FRAME_COUNT" \
    --read-bps "$BPS" --fill-dwell-ms 0 --mode trace --trace "$(trace_at "$trace" "$step")" \
    --rtt-ms "$rtt" --depth "$depth" --prefetch "$prefetch" "${extra[@]}" \
    --arm "$label" --json > "$json" 2> "$json.err"
  local rc=$?
  set -e
  python3 - "$json" "$OUT_TSV" "$arm" "$trace" "$step" "$rtt" "$run" "$depth" "$prefetch" "$rc" <<'PY'
import json, sys
path, tsv, arm, trace, step, rtt, run, depth, prefetch, rc = sys.argv[1:11]
try:
    m = json.load(open(path))
except Exception:
    m = {}
g = lambda k, d=0: m.get(k, d)
row = [arm, trace, step, rtt, run, depth, prefetch,
       g("p95_lateness_ms"), g("lateness_median_ms"), g("lateness_max_ms"), g("mean_lateness_ms"),
       g("frac_steps_late"), g("bytes_on_wire"), g("asks_sent"), g("unique_frames_asked"),
       g("duplicate_asks"), g("stranded_bytes"), g("d_min_observed"), g("d_max_observed"),
       g("peak_outstanding"), g("wait_samples"),
       int(bool(g("drain_incomplete"))), int(bool(g("depth_saturated"))),
       int(bool(g("depth_oscillating"))), rc, g("achieved_mbps")]
open(tsv, "a").write("\t".join(str(x) for x in row) + "\n")
print(f"{'OK' if rc == '0' else 'FAIL rc=' + rc} {arm} {trace} s{step} rtt={rtt} r{run} p95={g('p95_lateness_ms')} med={g('lateness_median_ms')} stranded={g('stranded_bytes')} D=[{g('d_min_observed')},{g('d_max_observed')}]")
if rc == "0" and int(g("wait_samples") or 0) == 0:
    print("STOP: empty wait samples", file=sys.stderr)
    sys.exit(3)
PY
}

echo "=== L2 ask-policy v4 local $(date -Iseconds) ==="
for step in "${STEPS[@]}"; do
  for rtt in "${RTTS[@]}"; do
    for trace in "${TRACES[@]}"; do
      for run in $(seq 1 "$REPEATS"); do
        for arm in $(printf '%s\n' "${ARMS[@]}" | shuf); do
          run_one "$arm" "$trace" "$step" "$rtt" "$run"
        done
      done
    done
  done
done
echo "=== done $(date -Iseconds) === TSV: $OUT_TSV"
