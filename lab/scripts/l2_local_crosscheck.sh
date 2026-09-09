#!/usr/bin/env bash
# L2 ask policy — loopback cross-check of the harness against the FIFO simulator.
#
# Same cells in both: the harness on a loopback server with its own LinkPacer at 10 Mbps and an
# emulated RTT, the simulator at the link rate the pacer actually delivers (measured once, on the
# first cell, where the link never idles). The point is not the absolute numbers (T2-local, no
# netem) but that the two agree on the ORDER and the SIZE of the effects, so the simulator's grid
# can be read as a prediction of what the rig would show.
#
# Needs exact-server on 4433 in shared mode with lab/fixtures/frames_32k:
#   target/release/exact-server --port 4433 --study lab/fixtures/frames_32k/frames_32k.sbnd \
#     --stream-mode shared --bind 127.0.0.1 &
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${OUT:-$ROOT/.local/l2/crosscheck}"
HARNESS="${HARNESS:-$ROOT/target/release/window-harness}"
SIM="$ROOT/lab/scripts/l2_policy_sim.py"
URL="${URL:-https://127.0.0.1:4433/}"
BPS="${BPS:-10000000}"
mkdir -p "$OUT/traces"
[[ -x "$HARNESS" ]] || { echo "missing $HARNESS — cargo build -p window-harness --release" >&2; exit 1; }

trace_at() {  # name step_ms -> path of a copy of the trace with that step
  local name=$1 step=$2 src out
  case "$name" in
    v2) src="$ROOT/lab/traces/l2_ask_policy_scroll.json" ;;
    reversal) src="$ROOT/lab/traces/l2_reversal.json" ;;
    jump) src="$ROOT/lab/traces/l2_jump.json" ;;
  esac
  out="$OUT/traces/${name}_step${step}.json"
  python3 - "$src" "$out" "$step" <<'PY'
import json, sys
t = json.load(open(sys.argv[1])); t["step_interval_ms"] = int(sys.argv[3]); json.dump(t, open(sys.argv[2], "w"))
PY
  echo "$out"
}

RATE=""  # Mbps the pacer delivers, taken from the first (saturated) cell
printf "%-34s | %-58s | %s\n" "cell" "harness (loopback, pacer 10 Mbps)" "simulator at the pacer's measured rate"
run_cell() {  # trace step rtt depth prefetch shape [extra harness args]
  local trace=$1 step=$2 rtt=$3 depth=$4 prefetch=$5 shape=$6; shift 6
  local label="${trace}_s${step}_r${rtt}_D${depth}_P${prefetch}_${shape}"
  local pf=$prefetch; [[ $prefetch == all ]] && pf=79
  "$HARNESS" --url "$URL" --ipv4 --stream-mode shared --frame-count 80 --read-bps "$BPS" \
    --fill-dwell-ms 0 --mode trace --trace "$(trace_at "$trace" "$step")" --rtt-ms "$rtt" \
    --depth "$depth" --prefetch "$pf" --window-shape "$shape" --arm "$label" "$@" --json \
    > "$OUT/$label.json" 2> "$OUT/$label.err" || { echo "rc=$? $label: $(tail -1 "$OUT/$label.err")"; return 0; }
  if [[ -z "$RATE" ]]; then
    RATE=$(python3 -c "import json; print(round(json.load(open('$OUT/$label.json'))['achieved_mbps'], 2))")
  fi
  local h s
  h=$(python3 - "$OUT/$label.json" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
print(f"p95={m['p95_lateness_ms']:6.1f} med={m['lateness_median_ms']:6.1f} max={m['lateness_max_ms']:6.1f} late={m['frac_steps_late']:.2f} stranded_KB={m['stranded_bytes']/1000:4.0f} peak={m['peak_outstanding']:2d} D=[{m['d_min_observed']},{m['d_max_observed']}]")
PY
)
  local spf=$prefetch; [[ $prefetch == all ]] && spf=-1
  s=$(python3 "$SIM" --cell --trace "$trace" --step-ms "$step" --rtt "$rtt" --depth "$depth" --prefetch "$spf" --shape "$shape" --rate-mbps "$RATE" | sed 's/^.*forward //; s/^.*ring    //')
  printf "%-34s | %s | %s\n" "$label" "$h" "$s"
}

echo "== reader faster than the link (16 ms steps, Tf 25.6 ms): policy cannot matter, the window shape does"
run_cell v2 16 0 0 0 forward
run_cell v2 16 0 16 15 ring
run_cell v2 16 0 16 15 forward
run_cell v2 16 60 0 0 forward
run_cell v2 16 60 4 3 forward
echo "== link faster than the reader (40 ms steps): prefetch removes lateness, depth bounds what a jump strands"
for tr in reversal jump; do
  run_cell $tr 40 60 0 0 forward
  run_cell $tr 40 60 4 3 forward
  run_cell $tr 40 60 16 15 forward
  run_cell $tr 40 60 0 all forward
  run_cell $tr 40 60 4 all forward
done
echo "== dynamic arm, jump trace at 40 ms / rtt 60 (formula D = 4): what the estimator does with each RTT input"
for src in first-byte clean path; do
  extra=(--dynamic-depth --rtt-source $src); [[ $src == path ]] && extra+=(--path-rtt-ms 60)
  run_cell jump 40 60 4 3 forward "${extra[@]}"
done
echo "== dynamic arm on the saturated scroll (16 ms): the ratchet"
for src in first-byte clean; do
  run_cell v2 16 60 4 3 forward --dynamic-depth --rtt-source $src
done
echo "outputs: $OUT"
