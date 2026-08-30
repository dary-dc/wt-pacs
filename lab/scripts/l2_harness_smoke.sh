#!/usr/bin/env bash
# L2 harness smoke gates — run BEFORE the shaped 54-cell grid.
# See docs/lanes/L2-ask-policy-harness-fix.md
#
# Loopback: harness LinkPacer @ 10 Mbps (--read-bps), no tc netem.
# Needs exact-server on 4433 shared mode (same as l2_review_replicate.sh).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${OUT:-$ROOT/.local/r2/l2_harness_smoke}"
HARNESS="${HARNESS:-$ROOT/target/release/window-harness}"
TRACE="${TRACE:-$ROOT/lab/traces/l2_ask_policy_scroll.json}"
URL="${URL:-https://127.0.0.1:4433/}"
BPS="${BPS:-10000000}"
DEPTH="${DEPTH:-2}"
FRAME_BYTES=32004
STEP_MS=16
TRACE_STEPS=119
TRACE_WALL_S=$(python3 -c "print($TRACE_STEPS * $STEP_MS / 1000.0)")

mkdir -p "$OUT"
[[ -x "$HARNESS" ]] || { echo "build: cargo build -p window-harness -p exact-server --release" >&2; exit 1; }

pass=0
fail=0
note() { echo "== $*"; }
gate() {
  local name=$1 ok=$2
  if [[ "$ok" == 1 ]]; then echo "PASS $name"; pass=$((pass+1)); else echo "FAIL $name"; fail=$((fail+1)); fi
}

run_h() {
  local label=$1; shift
  local t0 t1
  t0=$(date +%s.%N)
  "$HARNESS" --url "$URL" --trace "$TRACE" --read-bps "$BPS" --frame-count 80 \
    --fill-dwell-ms 0 --mode trace --arm "$label" --rtt-ms 0 --stream-mode shared \
    "$@" --json >"$OUT/$label.json" 2>"$OUT/$label.err" || echo "rc=$? for $label" >&2
  t1=$(date +%s.%N)
  python3 - "$OUT/$label.json" "$t0" "$t1" <<'PY'
import json, sys, collections
m = json.load(open(sys.argv[1]))
wall = float(sys.argv[3]) - float(sys.argv[2])
asks = m.get("ask_join", [])
per = collections.Counter(r["frame_index"] for r in asks)
unique = len(per)
dups = sum(v - 1 for v in per.values())
short = m["asks_sent"] * int(sys.argv[0]) - m["bytes_on_wire"] if False else m["asks_sent"] * 32004 - m["bytes_on_wire"]
print(
    f"wall={wall:.2f}s asks={m['asks_sent']} unique_frames={unique} dup_asks={dups} "
    f"bytes={m['bytes_on_wire']} p95_wait={m.get('p95_wait_ms',0):.1f} "
    f"p95_lateness={m.get('p95_lateness_ms', 'MISSING')} "
    f"d_max={m.get('d_max_observed',0)} peak={m.get('peak_outstanding',0)} "
    f"shortfall_frames={short / 32004:.1f}"
)
PY
}

slow_trace() {
  local ms=$1 out="$OUT/trace_step${ms}.json"
  python3 - "$TRACE" "$out" "$ms" <<'PY'
import json, sys
t = json.load(open(sys.argv[1]))
t["step_interval_ms"] = int(sys.argv[3])
t["name"] = f"l2_step{sys.argv[3]}"
json.dump(t, open(sys.argv[2], "w"))
PY
  echo "$out"
}

note "running three arms (depth=$DEPTH)"
run_h control --depth 0
run_h fixed   --depth "$DEPTH"
run_h dynamic --depth "$DEPTH" --dynamic-depth

note "control slower steps (cadence demo)"
run_h control_step26 "$(slow_trace 26)" --depth 0

# Parse JSON for gates
python3 - "$OUT" "$TRACE_WALL_S" "$DEPTH" <<'PY'
import json, os, sys
out, trace_wall, depth = sys.argv[1], float(sys.argv[2]), int(sys.argv[3])

def load(name):
    p = os.path.join(out, name + ".json")
    if not os.path.isfile(p):
        return None
    return json.load(open(p))

def unique_frames(m):
    asks = m.get("ask_join", [])
  from collections import Counter
  return len(Counter(r["frame_index"] for r in asks))

c, f, d, c26 = load("control"), load("fixed"), load("dynamic"), load("control_step26")
gates = []

if c and f and d:
    uc, uf, ud = unique_frames(c), unique_frames(f), unique_frames(d)
    gates.append(("G1 same unique_frames_asked", uc == uf == ud, f"control={uc} fixed={uf} dynamic={ud}"))

    def wall(name):
        import subprocess
        # wall printed by harness run — re-read from file metadata not stored; use bytes/link
        m = load(name)
        return m["bytes_on_wire"] * 8 / 10e6

    wc, wf, wd = wall("control"), wall("fixed"), wall("dynamic")
    # G2: wall should be near trace reader time, not link-limited stretch
    gates.append(("G2 control wall near trace time", wc < trace_wall * 2.5, f"control_link_s={wc:.2f} trace_s={trace_wall:.2f}"))
    gates.append(("G2 fixed not link-stretched", wf < trace_wall * 4, f"fixed_link_s={wf:.2f}"))

    gates.append(("G3 dynamic d_max <= 2 on loopback", d.get("d_max_observed", 99) <= 2, f"d_max={d.get('d_max_observed')}"))

    short_f = f["asks_sent"] * 32004 - f["bytes_on_wire"]
    gates.append(("G5 no D-frame shortfall (fixed)", abs(short_f / 32004 - f.get("d_max_observed",0)) < 0.5 or short_f == 0, f"short={short_f/32004:.1f}"))

    gates.append(("G1 fixed asks not ~119*D", f["asks_sent"] < 119 * depth * 0.8, f"asks={f['asks_sent']}"))

    if "p95_lateness_ms" in c:
        gates.append(("G4 lateness metric present", True, ""))
        if c26:
            gates.append(("G4 slower steps lower p95 lateness", c26["p95_lateness_ms"] < c["p95_lateness_ms"], f"16ms={c['p95_lateness_ms']:.1f} 26ms={c26['p95_lateness_ms']:.1f}"))
    else:
        gates.append(("G4 lateness metric present", False, "add p95_lateness_ms to harness (Phase 1)"))

for name, ok, detail in gates:
    print(f"{'PASS' if ok else 'FAIL'} {name} — {detail}")
    if not ok:
        sys.exit(1)
print("ALL GATES PASSED")
PY
rc=$?
if [[ $rc -eq 0 ]]; then
  note "smoke OK — shaped one-cell + full grid may proceed (after E0)"
else
  note "smoke FAILED — implement docs/lanes/L2-ask-policy-harness-fix.md"
fi
echo "pass=$pass fail=$fail"
exit $rc
