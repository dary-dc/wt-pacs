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
L1_SMALL_TSV_COLS="order_index	ts_iso	arm	rtt_label_ms	loss_pct	depth	run	regime	step_interval_ms	miss_p95_wait_ms	miss_mean_wait_ms	cache_misses	tail_at_p95	asks_sent	peak_outstanding	step_loop_ms	bytes_on_wire	frames_on_wire	wait_h1_median_ms	wait_h2_median_ms	late_p95_ms	late_mean_ms	late_max_ms	on_time_rate	cell_label	protocol_sha	cadence_sha	server_sha"

l1_require_study_trace() {
  [[ -f "$L1_STUDY" ]] || { echo "STOP: missing study $L1_STUDY" >&2; exit 1; }
  [[ -f "$L1_TRACE" ]] || { echo "STOP: missing trace $L1_TRACE" >&2; exit 1; }
}

# A4 — demand/supply diagnostic.
# clinical_under_delivery (default): expect demand/supply in [0.55, 0.98]
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

# A2 — honest miss-p95 tail mass (second review N2; stream-mode-remediation §R4).
#
# Nearest-rank p95 places ~5% of a run's positive waits at or above it, so a
# L1_TAIL_MIN-sample tail needs ~20x L1_TAIL_MIN misses. Below that the "p95" is a
# max estimator with a max's variance — the defect that voided v2 at 4-5 samples.
#
# This gate does NOT soften the requirement to fit the cell. A cell that cannot reach
# the tail count has no usable p95, and says so: the row is still collected (the
# lateness readout does not need a miss tail) but is stamped P95_UNSUPPORTED so that
# no decision can quote its p95.
#
# Prints: miss_p95\ttail_n\tmiss_n\tneed\tok|p95_unsupported|FAIL
# Exit 0 = ok · 3 = p95 unsupported (collect the row, do not decide on it) · 2 = FAIL.
l1_tail_gate() {
  local json=$1
  python3 - "$json" "$L1_TAIL_MIN" <<'TAILPY'
import json, sys
path, need = sys.argv[1], int(sys.argv[2])
m = json.load(open(path))
waits = [float(w) for w in m.get("wait_ms") or [] if float(w) > 0]
p95 = float(m.get("miss_p95_wait_ms") or 0)
n = len(waits)
if n == 0 or p95 <= 0:
    print(f"{p95:.6f}\t0\t{n}\t{need}\tFAIL")
    raise SystemExit(2)
tail = sum(1 for w in waits if w + 1e-12 >= p95)
if tail < need:
    print(f"{p95:.6f}\t{tail}\t{n}\t{need}\tp95_unsupported")
    raise SystemExit(3)
print(f"{p95:.6f}\t{tail}\t{n}\t{need}\tok")
TAILPY
}

# N1 — the null gate must be at least as sharp as the claim it protects.
#
# A null cell that tolerates an arm gap of X% cannot certify an effect smaller than X%,
# so the rule is an interval, not a point: the 95% CI on the null relative gap must
# exclude the effect bar. A gate stated as "within 25%" (v2's D=1 control) or "within
# 40%" (the first Phase C runner) permits a zero-effect discrepancy larger than the
# effect the campaign exists to detect.
#
# Usage: l1_null_gate <tsv> [effect_bar_pct]  ·  exit 0 = pass, 3 = fail.
l1_null_gate() {
  local tsv=$1 bar=${2:-${L1_EFFECT_BAR:-15}}
  python3 - "$tsv" "$bar" <<'NULLPY'
import csv, random, statistics as st, sys
from collections import defaultdict
path, bar = sys.argv[1], float(sys.argv[2])
by = defaultdict(list)
with open(path) as f:
    first = f.readline()
    if not first.startswith("#"):
        f.seek(0)
    for r in csv.DictReader(f, delimiter="\t"):
        if r.get("cell_label", "").split("+")[0] == "null" and float(r["loss_pct"]) == 0.0:
            by[r["arm"]].append(float(r["miss_p95_wait_ms"]))
if len(by) < 2:
    print("null_gate: fewer than two arms — skip")
    raise SystemExit(0)
rng = random.Random(20260906)
arms = sorted(by)
fail = False
for i, a in enumerate(arms):
    for b in arms[i + 1:]:
        A, B = by[a], by[b]
        gaps = []
        for _ in range(20000):
            ma = st.median([rng.choice(A) for _ in A])
            mb = st.median([rng.choice(B) for _ in B])
            lo = min(ma, mb)
            gaps.append(abs(ma - mb) / lo * 100 if lo > 0 else float("inf"))
        gaps.sort()
        hi = gaps[int(0.975 * len(gaps))]
        obs_lo = min(st.median(A), st.median(B))
        obs = abs(st.median(A) - st.median(B)) / obs_lo * 100 if obs_lo > 0 else float("inf")
        ok = hi < bar
        print(f"  {a} vs {b}: gap={obs:.1f}% CI_upper={hi:.1f}% bar={bar:.0f}% -> {'ok' if ok else 'FAIL'}")
        fail |= not ok
if fail:
    print(f"STOP: the null cell cannot exclude a {bar:.0f}% arm gap, so it cannot certify a {bar:.0f}% effect.")
    raise SystemExit(3)
print("null_gate ok")
NULLPY
}

# Phase B regime stamp (harness keys: wait_h1_median_ms, step_loop_ms).
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

# Starts a fresh directional TSV. Refuses to truncate one that already holds rows:
# these files are tracked results, and a re-run (or a DRY_RUN) that silently empties a
# published campaign destroys the only copy of data the rig cannot cheaply reproduce.
# Set L1_OVERWRITE_TSV=1 to start a genuinely new campaign over an existing path.
l1_write_directional_header() {
  local tsv=$1
  if [[ -s "$tsv" && "${L1_OVERWRITE_TSV:-0}" != "1" ]]; then
    local rows
    rows=$(grep -vc '^#' "$tsv" || true)
    if [[ "${rows:-0}" -gt 1 ]]; then
      echo "STOP: $tsv already holds $((rows - 1)) data rows." >&2
      echo "  Re-run with L1_OVERWRITE_TSV=1, or point OUT_TSV somewhere new." >&2
      # `return`, not `exit`: callers run under `set -e` so a collect still aborts,
      # while a checker can assert the refusal without killing its own process.
      return 1
    fi
  fi
  {
    echo "$L1_DIRECTIONAL_BANNER"
    echo "$L1_SMALL_TSV_COLS"
  } >"$tsv"
}
