#!/usr/bin/env bash
# L2 methodology review — local replication of the three arms.
# See docs/measurements/r2/l2_ask_policy_METHODOLOGY_REVIEW.md
#
# UNSHAPED LOOPBACK. The 10 Mbps cap comes from the harness's own LinkPacer
# (--read-bps), not from tc; there is no added path RTT. Per the R2 house rules
# that makes every latency number here weaker than a netem result, so this script
# exists for the facts that are not RTT-proportional and that the rig data also
# shows: how many asks each arm sends, how many bytes it pulls, where D goes, and
# how long the run takes against a 1.90 s trace.
#
# Needs an exact-server already listening on 4433 in shared mode:
#   ./target/release/exact-server --port 4433 \
#     --study lab/fixtures/frames_32k/frames_32k.sbnd \
#     --cert-pem server/dev-cert/cert.pem --key-pem server/dev-cert/key.pem \
#     --stream-mode shared &
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${OUT:-$ROOT/.local/r2/l2_review}"
HARNESS="${HARNESS:-$ROOT/target/release/window-harness}"
TRACE="${TRACE:-$ROOT/lab/traces/l2_ask_policy_scroll.json}"
URL="${URL:-https://127.0.0.1:4433/}"
BPS="${BPS:-10000000}"   # 10 Mbps, the campaign's cell
DEPTH="${DEPTH:-2}"      # formula depth for the rtt20 cell
FRAME_BYTES=32004        # 32000 payload + 4 envelope index

mkdir -p "$OUT"
[[ -x "$HARNESS" ]] || { echo "missing $HARNESS — cargo build -p window-harness --release" >&2; exit 1; }

run() {
  local label=$1; shift
  local trace=$1; shift
  local t0 t1
  t0=$(date +%s.%N)
  "$HARNESS" --url "$URL" --trace "$trace" --read-bps "$BPS" --frame-count 80 \
    --fill-dwell-ms 0 --mode trace --arm "$label" --rtt-ms 0 --stream-mode shared \
    "$@" --json >"$OUT/$label.json" 2>"$OUT/$label.err" || echo "rc=$? for $label" >&2
  t1=$(date +%s.%N)
  python3 - "$OUT/$label.json" "$t0" "$t1" "$FRAME_BYTES" <<'PY'
import collections, json, sys
m = json.load(open(sys.argv[1]))
wall = float(sys.argv[3]) - float(sys.argv[2])
frame_bytes = int(sys.argv[4])
waits = m.get("wait_ms", [])
asks = m.get("ask_join", [])
per_frame = collections.Counter(r["frame_index"] for r in asks)
dups = sum(v - 1 for v in per_frame.values())
traj = m.get("d_current") or []
print(
    f"{m['arm_label']:<22} wall={wall:6.2f}s  link_s={m['bytes_on_wire'] * 8 / 10e6:6.2f}"
    f"  asks={m['asks_sent']:>5}  dup_asks={dups:>5}  bytes={m['bytes_on_wire']:>9}"
    f"  p95={m['p95_wait_ms']:9.1f}  mean={m['mean_wait_ms']:8.1f}"
    f"  zero_waits={sum(1 for w in waits if w == 0.0)}/{len(waits)}"
    f"  peak={m['peak_outstanding']}  d=[{m['d_min_observed']},{m['d_max_observed']}]"
    + (f"  frac_at_D_max={sum(1 for d in traj if d == max(traj)) / len(traj):.2f}" if traj else "")
)
short = m["asks_sent"] * frame_bytes - m["bytes_on_wire"]
if short:
    print(f"{'':<22} undrained at close: {short // frame_bytes} frames ({short} bytes)")
PY
}

# Same trace, slower reader: control has no depth bound in any of these.
slow_trace() {
  local ms=$1
  python3 - "$TRACE" "$OUT/trace_step${ms}.json" "$ms" <<'PY'
import json, sys
t = json.load(open(sys.argv[1]))
t["step_interval_ms"] = int(sys.argv[3])
t["name"] = f"l2_step{sys.argv[3]}"
json.dump(t, open(sys.argv[2], "w"))
PY
  echo "$OUT/trace_step${ms}.json"
}

echo "== the three campaign arms (trace = 119 steps x 16 ms = 1.90 s of reader time) =="
run control "$TRACE" --depth 0
run fixed   "$TRACE" --depth "$DEPTH"
run dynamic "$TRACE" --depth "$DEPTH" --dynamic-depth

echo
echo "== same control arm, no depth bound, slower reader: p95 is a function of cadence =="
run control_step26 "$(slow_trace 26)" --depth 0
run control_step53 "$(slow_trace 53)" --depth 0
