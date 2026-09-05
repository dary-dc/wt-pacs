#!/usr/bin/env bash
# Shared L1 v3 defaults + gates (complete-plan Phases A–C).
# shellcheck shell=bash
set -euo pipefail

: "${ROOT:=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

# --- A1: fixture / trace parameterization (collect defaults to 160) ---
L1_FIX_FC="${L1_FIX_FC:-160}"
L1_LINK_MBPS="${L1_LINK_MBPS:-10}"
L1_MEAN_FRAME_BYTES="${L1_MEAN_FRAME_BYTES:-32000}"
L1_FRAME_BYTES_TOL="${L1_FRAME_BYTES_TOL:-64}"
L1_TAIL_MIN="${L1_TAIL_MIN:-5}"

if [[ "$L1_FIX_FC" == "160" ]]; then
  L1_STUDY="${L1_STUDY:-$ROOT/lab/fixtures/frames_32k_160/frames_32k_160.sbnd}"
  L1_TRACE="${L1_TRACE:-$ROOT/lab/traces/l1_one_way_160.json}"
  L1_META="${L1_META:-$ROOT/lab/fixtures/frames_32k_160/metadata.json}"
elif [[ "$L1_FIX_FC" == "80" ]]; then
  L1_STUDY="${L1_STUDY:-$ROOT/lab/fixtures/frames_32k/frames_32k.sbnd}"
  L1_TRACE="${L1_TRACE:-$ROOT/lab/traces/l1_one_way_80.json}"
  L1_META="${L1_META:-$ROOT/lab/fixtures/frames_32k/metadata.json}"
else
  echo "STOP: unsupported L1_FIX_FC=$L1_FIX_FC (want 80|160)" >&2
  exit 2
fi

L1_DIRECTIONAL_BANNER="# DIRECTIONAL — NOT A DECISION"
L1_SMALL_TSV_COLS="order_index	ts_iso	arm	rtt_label_ms	loss_pct	depth	run	regime	step_interval_ms	miss_p95_wait_ms	miss_mean_wait_ms	cache_misses	tail_at_p95	asks_sent	peak_outstanding	step_loop_ms	bytes_on_wire	frames_on_wire	wait_h1_median_ms	wait_h2_median_ms	cell_label	protocol_sha	cadence_sha	server_sha"

l1_require_study_trace() {
  [[ -f "$L1_STUDY" ]] || { echo "STOP: missing study $L1_STUDY" >&2; exit 1; }
  [[ -f "$L1_TRACE" ]] || { echo "STOP: missing trace $L1_TRACE" >&2; exit 1; }
}

# A4 — demand/supply diagnostic.
# clinical_under_delivery (default): expect demand/supply in [0.55, 0.95]
# stress_over_delivery: expect demand/supply >= 1.0
l1_precheck_ratio() {
  local step_ms=$1 label=${2:-cell}
  local mode="${L1_READER_MODE:-clinical_under_delivery}"
  python3 - "$L1_MEAN_FRAME_BYTES" "$L1_LINK_MBPS" "$step_ms" "$label" "$mode" <<'PY'
import sys
fb, mbps, step, label, mode = int(sys.argv[1]), float(sys.argv[2]), int(sys.argv[3]), sys.argv[4], sys.argv[5]
bps = mbps * 1_000_000
supply = bps / (fb * 8)
demand = 1000.0 / step
ratio = demand / supply
print(f"{label}: demand/supply={ratio:.2f} (reader {demand:.1f} f/s, link {supply:.1f} f/s @ {mbps:.0f} Mbps, {fb} B, {step} ms) mode={mode}")
if mode == "stress_over_delivery":
    if ratio < 1.0:
        raise SystemExit(f"STOP: stress reader must outrun link (ratio={ratio:.2f} < 1)")
elif mode == "clinical_under_delivery":
    if ratio < 0.55 or ratio > 0.98:
        raise SystemExit(f"STOP: clinical reader ratio {ratio:.2f} outside [0.55, 0.98]")
else:
    raise SystemExit(f"STOP: unknown L1_READER_MODE={mode}")
PY
}

# A4 — observed mean frame bytes ≈ fixture mean.
l1_assert_frame_bytes() {
  local json=$1
  python3 - "$json" "$L1_MEAN_FRAME_BYTES" "$L1_FRAME_BYTES_TOL" <<'PY'
import json, sys
path, mean, tol = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
m = json.load(open(path))
fw = float(m["frames_on_wire"])
bw = float(m["bytes_on_wire"])
assert fw > 0, "frames_on_wire=0"
obs = bw / fw
if abs(obs - mean) > tol:
    raise SystemExit(f"STOP: mean frame bytes {obs:.1f} vs fixture {mean:.1f} (tol {tol})")
print(f"frame_bytes_ok obs={obs:.1f} mean={mean:.1f}")
PY
}

# A2 — ≥ L1_TAIL_MIN positive waits at/above miss_p95.
# Prints: miss_p95\ttail_n\tmiss_n\tok|FAIL ; exit 2 on FAIL.
l1_tail_gate() {
  local json=$1
  python3 - "$json" "$L1_TAIL_MIN" <<'PY'
import json, sys
path, need = sys.argv[1], int(sys.argv[2])
m = json.load(open(path))
waits = [float(w) for w in m.get("wait_ms") or [] if float(w) > 0]
p95 = float(m.get("miss_p95_wait_ms") or 0)
tail = sum(1 for w in waits if w + 1e-12 >= p95) if waits and p95 > 0 else 0
ok = "ok" if tail >= need else "FAIL"
print(f"{p95:.6f}\t{tail}\t{len(waits)}\t{ok}")
if ok != "ok":
    raise SystemExit(2)
PY
}

# Phase B regime stamp.
l1_stamp_regime() {
  local json=$1 loss=$2
  python3 - "$json" "$loss" <<'PY'
import json, sys
m = json.load(open(sys.argv[1]))
loss = float(sys.argv[2])
h1 = float(m.get("wait_h1_median_ms") or 0)
loop = float(m.get("step_loop_ms") or 0)
n = float(m.get("frames_on_wire") or 1)
if loss <= 0:
    print("clean")
elif h1 >= 55.0 or (loop / n) >= 45.0:
    print("loss_slow")
else:
    print("loss_stable")
PY
}

l1_protocol_sha() {
  git -C "$ROOT" rev-parse HEAD
}

l1_require_clean_protocol_tree() {
  local dirty
  dirty="$(git -C "$ROOT" status --porcelain -- lab/ docs/lanes/ || true)"
  if [[ -n "$dirty" ]]; then
    echo "STOP: protocol tree dirty under lab/ or docs/lanes/:" >&2
    echo "$dirty" >&2
    exit 1
  fi
}

l1_cadence_sha() {
  local path=$1
  sha256sum "$path" | awk '{print $1}'
}

# A3 — interleaved arm schedule (one arm per line).
l1_interleave_arms() {
  local repeats=$1
  shift
  local seed="${L1_INTERLEAVE_SEED:-}"
  python3 - "$repeats" "$seed" "$@" <<'PY'
import random, sys
repeats = int(sys.argv[1])
seed = sys.argv[2]
arms = sys.argv[3:]
rng = random.Random(seed if seed else None)
order = []
for _ in range(repeats):
    block = list(arms)
    rng.shuffle(block)
    order.extend(block)
print("\n".join(order))
PY
}

l1_write_directional_header() {
  local tsv=$1
  {
    echo "$L1_DIRECTIONAL_BANNER"
    echo "$L1_SMALL_TSV_COLS"
  } >"$tsv"
}
