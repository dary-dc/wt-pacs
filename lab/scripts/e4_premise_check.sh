#!/usr/bin/env bash
# E4 premise gate: random D (uniform 1–8) vs oracle D (exhaustive 1–8) on fly_and_settle.
# Objective: mean_wait_ms (and p95). Cache hits score 0.
# If random ≈ oracle, D does not matter — stop the window-depth programme.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT/.local/measurements}"
TRACE="${TRACE:-$ROOT/lab/traces/fly_and_settle.json}"
STUDY="${STUDY:-$ROOT/lab/fixtures/queue_large/queue_large.sbnd}"
CERT="${CERT:-$ROOT/server/dev-cert/cert.pem}"
KEY="${KEY:-$ROOT/server/dev-cert/key.pem}"
READ_BPS="${READ_BPS:-5000000}"
PORT="${PORT:-4433}"
URL="${URL:-https://127.0.0.1:${PORT}/}"
RANDOM_N="${RANDOM_N:-24}"
FRAME_COUNT="${FRAME_COUNT:-20}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"

mkdir -p "$OUT_DIR"
[[ -f "$CERT" ]] || "$ROOT/server/scripts/gen_dev_cert.sh"
[[ -f "$STUDY" ]] || { echo "missing study $STUDY" >&2; exit 1; }
[[ -f "$TRACE" ]] || { echo "missing trace $TRACE" >&2; exit 1; }

cargo build -p exact-server -p window-harness --release >/dev/null
SERVER="$CARGO_TARGET_DIR/release/exact-server"
HARNESS="$CARGO_TARGET_DIR/release/window-harness"

ORACLE_TSV="$OUT_DIR/E4_PREMISE_ORACLE.tsv"
RANDOM_TSV="$OUT_DIR/E4_PREMISE_RANDOM.tsv"
SUMMARY="$OUT_DIR/E4_PREMISE_SUMMARY.md"

start_server() {
  "$SERVER" --port "$PORT" --study "$STUDY" --cert-pem "$CERT" --key-pem "$KEY" >/dev/null 2>&1 &
  echo $!
  sleep 1.0
}

run_one() {
  local depth=$1 arm=$2
  "$HARNESS" --url "$URL" --trace "$TRACE" --read-bps "$READ_BPS" \
    --depth "$depth" --frame-count "$FRAME_COUNT" --fill-dwell-ms 0 \
    --mode trace --arm "$arm" --json
}

echo -e "depth\tmean_wait_ms\tp95_wait_ms\trecovered_ms\twait_samples\twasted_bytes" > "$ORACLE_TSV"
spid=$(start_server)
trap 'kill "$spid" 2>/dev/null || true' EXIT

echo "Oracle sweep D=1..8 ..." >&2
best_mean=""
best_d=""
best_p95=""
for d in 1 2 3 4 5 6 7 8; do
  json=$(run_one "$d" "oracle_d${d}")
  mean=$(printf '%s' "$json" | python3 -c "import json,sys; print(json.load(sys.stdin)['mean_wait_ms'])")
  p95=$(printf '%s' "$json" | python3 -c "import json,sys; print(json.load(sys.stdin)['p95_wait_ms'])")
  rec=$(printf '%s' "$json" | python3 -c "import json,sys; print(json.load(sys.stdin)['recovered_ms'])")
  ws=$(printf '%s' "$json" | python3 -c "import json,sys; print(json.load(sys.stdin)['wait_samples'])")
  waste=$(printf '%s' "$json" | python3 -c "import json,sys; print(json.load(sys.stdin)['wasted_bytes'])")
  echo -e "${d}\t${mean}\t${p95}\t${rec}\t${ws}\t${waste}" >> "$ORACLE_TSV"
  echo "  D=$d mean_wait_ms=$mean p95=$p95" >&2
  if [[ -z "$best_mean" ]] || python3 -c "import sys; sys.exit(0 if float('$mean') < float('$best_mean') else 1)"; then
    best_mean=$mean
    best_d=$d
    best_p95=$p95
  fi
done

echo -e "trial\tdepth\tmean_wait_ms\tp95_wait_ms\trecovered_ms\twait_samples\twasted_bytes" > "$RANDOM_TSV"
echo "Random control N=$RANDOM_N ..." >&2
for i in $(seq 1 "$RANDOM_N"); do
  d=$((1 + RANDOM % 8))
  json=$(run_one "$d" "random_t${i}")
  mean=$(printf '%s' "$json" | python3 -c "import json,sys; print(json.load(sys.stdin)['mean_wait_ms'])")
  p95=$(printf '%s' "$json" | python3 -c "import json,sys; print(json.load(sys.stdin)['p95_wait_ms'])")
  rec=$(printf '%s' "$json" | python3 -c "import json,sys; print(json.load(sys.stdin)['recovered_ms'])")
  ws=$(printf '%s' "$json" | python3 -c "import json,sys; print(json.load(sys.stdin)['wait_samples'])")
  waste=$(printf '%s' "$json" | python3 -c "import json,sys; print(json.load(sys.stdin)['wasted_bytes'])")
  echo -e "${i}\t${d}\t${mean}\t${p95}\t${rec}\t${ws}\t${waste}" >> "$RANDOM_TSV"
  echo "  trial $i D=$d mean_wait_ms=$mean" >&2
done

python3 - "$ORACLE_TSV" "$RANDOM_TSV" "$SUMMARY" "$best_d" "$best_mean" "$best_p95" "$READ_BPS" "$TRACE" "$STUDY" <<'PY'
import sys, statistics
from pathlib import Path
oracle_path, random_path, summary, best_d, best_mean, best_p95, read_bps, trace, study = sys.argv[1:]
rows = []
for line in Path(random_path).read_text().splitlines()[1:]:
    if not line.strip():
        continue
    parts = line.split("\t")
    rows.append(float(parts[2]))
rand_mean = statistics.mean(rows)
rand_stdev = statistics.stdev(rows) if len(rows) > 1 else 0.0
oracle = float(best_mean)
gap = rand_mean - oracle
rel = (gap / oracle) if oracle > 1e-9 else float("inf")
# Pre-declared interpretive band (fixed before the run): |gap|<5 ms OR |rel|≤10%.
approx = (abs(gap) < 5.0) or (oracle > 0 and abs(rel) <= 0.10)
verdict = (
    "RANDOM_APPROX_ORACLE — stop; D does not matter"
    if approx
    else "ORACLE_BEATS_RANDOM — continue E1/E2/E4/E5"
)
Path(summary).write_text(
    f"""# E4 premise check

**Trace:** `{Path(trace).name}` · **Study:** `{Path(study).name}` · **read_bps:** {read_bps}

## Groups

| Group | Setting |
| ----- | ------- |
| Oracle | exhaustive D=1..8; best by mean_wait_ms |
| Random | D ~ Uniform{{1..8}} per session, N={len(rows)} |

## Objective

`mean_wait_ms` (cache hits = 0). Report p95 alongside.

## Results

| Control | mean_wait_ms | p95_wait_ms | notes |
| ------- | ------------ | ----------- | ----- |
| Oracle (D={best_d}) | {oracle:.3f} | {float(best_p95):.3f} | best depth by mean |
| Random | {rand_mean:.3f} (stdev {rand_stdev:.3f}) | — | mean across sessions |

- Absolute gap (random − oracle): **{gap:.3f} ms**
- Relative gap: **{rel:.1%}** (inf if oracle≈0)

## Verdict

**{verdict}**

Approx band used for the stop/go call (fixed before this run): |gap|<5 ms **or** |rel|≤10%.
This band is a go/no-go switch for the programme, not a soft retune of the depth formula.
"""
)
print(verdict)
print(f"oracle_d={best_d} oracle_mean={oracle:.3f} random_mean={rand_mean:.3f} gap={gap:.3f}")
PY

echo "Wrote $SUMMARY" >&2
cat "$SUMMARY"
