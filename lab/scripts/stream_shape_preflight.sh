#!/usr/bin/env bash
# Does the cell's instrumentation behave, before the rig spends a day finding out it does not?
# Runs the arms on unshaped loopback — which decides nothing about stream shape, and marks
# itself unusable — and checks only that the machinery works: the probe measures, the warm-up
# runs, the flags reach the harness, and each void check fires on data built to trip it and
# clears on data that should not.
#
#   lab/scripts/stream_shape_preflight.sh [server-bin] [harness-bin]
#
# Three of the five faults in the 2026-09-15 campaign would have surfaced here: the client
# pacer left at its default, the missing warm-up, and a check written against a misread field.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
server=${1:-$ROOT/target/release/exact-server}
harness=${2:-$ROOT/target/release/window-harness}
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
fail=0
check() { if [[ "$2" == "$3" ]]; then echo "  ok   $1"; else echo "  FAIL $1: expected $3, got $2"; fail=1; fi; }

# A fixture that passes every check, then one field broken per case. Built from a literal, not
# from the cell's own output: a fixture that silently fails to build is a check that passes
# without testing anything, which this script did on its first run.
fixture() {
  local d="$1"; rm -rf "$d"; mkdir -p "$d"
  python3 - "$d" "$2" <<'PYEOF'
import json, sys
d, mutation = sys.argv[1], sys.argv[2]
for r in (1, 2, 3):
    run = {"stream_mode": "shared", "read_bps": 0, "censored_frac": 0.0, "cache_hit_rate": 0.5,
           "asks_sent": 80, "wait_samples": 81,
           "wait_ms": [float(i % 40 + 1) for i in range(60)]}
    exec(mutation, {"run": run})
    json.dump(run, open(f"{d}/shared.r{r}.json", "w"))
PYEOF
}

trip() {
  local d="$work/trip_$1"
  if ! fixture "$d" "$2"; then echo "  FAIL $1: fixture did not build"; fail=1; return; fi
  python3 "$ROOT/lab/scripts/stream_shape_pool.py" "$d" >/dev/null 2>"$d/err"
  check "$1" "$(grep -c "$3" "$d/err")" "1"
}

echo "== the cell runs, and its knobs reach the harness"
RATE_MBIT=10 RTT_MS=0 REPS=2 DEPTH=2 ARMS="shared pool:2 per-frame" PROBE_MS=1500 PROBE_REPS=2 \
  "$ROOT/lab/scripts/stream_shape_cells.sh" "$work/cell" "$server" "$harness" >/dev/null 2>"$work/cell.err"
check "an unshaped run marks itself unusable" "$(ls "$work"/cell/UNSHAPED 2>/dev/null | wc -l)" "1"
check "probe wrote PROBE_REPS files per arm" "$(ls "$work"/cell/probe.*.json 2>/dev/null | wc -l)" "6"
check "the pooler ignores every probe file" \
  "$(python3 -c "
import sys; sys.path.insert(0, '$ROOT/lab/scripts')
import importlib.util as u
m = u.module_from_spec(u.spec_from_file_location('p', '$ROOT/lab/scripts/stream_shape_pool.py'))
u.spec_from_file_location('p', '$ROOT/lab/scripts/stream_shape_pool.py').loader.exec_module(m)
from pathlib import Path
print(sum(len(v) for v in m.load(Path('$work/cell')).values()))")" "6"
check "six runs landed (3 arms x 2 repeats)" "$(ls "$work"/cell/*.r*.json 2>/dev/null | wc -l)" "6"
check "the probe line is printed per arm" "$(grep -c 'probe .* frames/s' "$work/cell.err")" "3"
check "the reader is unthrottled" \
  "$(python3 -c "import json,glob;print(sum(json.load(open(f))['read_bps'] for f in glob.glob('$work/cell/*.r*.json')))")" "0"
check "one step interval for every arm" \
  "$(grep -o 'step=[0-9]*ms' "$work/cell.err" | sort -u | wc -l)" "1"
python3 "$ROOT/lab/scripts/stream_shape_pool.py" "$work/cell" >/dev/null 2>"$work/pool.err"
check "the pooler refuses an unshaped cell" "$(grep -c 'without a shaped link' "$work/pool.err")" "1"

echo "== every void check fires on data built to trip it"
trip pacer      'run["read_bps"] = 2000000'    "client's pacer"
trip censoring  'run["censored_frac"] = 0.5'   "censored over 10%"
trip suppressed 'run["asks_sent"] = 1'         "under half the trace"
trip cachebound 'run["cache_hit_rate"] = 0.99' "over 90% of steps"
trip fewmisses  'run["wait_ms"] = [1.0, 2.0]'  "under 20"

echo "== and a run with none of those faults is not voided"
ok="$work/clean"
if fixture "$ok" "pass"; then
  python3 "$ROOT/lab/scripts/stream_shape_pool.py" "$ok" >/dev/null 2>"$ok/err"
  check "a clean cell passes (pooler exit 0)" "$?" "0"
  check "and says nothing about VOID" "$(grep -c VOID "$ok/err")" "0"
else
  echo "  FAIL clean fixture did not build"; fail=1
fi

[[ $fail == 0 ]] && echo "PREFLIGHT OK" || { echo "PREFLIGHT FAILED"; exit 1; }
