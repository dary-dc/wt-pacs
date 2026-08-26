#!/usr/bin/env bash
# E4 premise gate — random D vs oracle D on fly_and_settle, under netem RTT.
#
# Decision metric (fixed in advance): oracle must beat random by ≥ 100 ms at p95.
# Report mean_wait_ms too; do not decide on mean (cache hits dilute stalls).
#
# RTT=0 is a floor control only (pipelining cannot help; oracle→D=1 is expected).
# The gate is answered only at RTT ∈ {20,60,150} ms.
#
# Requires CAP_NET_ADMIN (tc netem on lo). On lo, each direction hits the qdisc once,
# so netem delay = RTT/2.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT_DIR="${OUT_DIR:-$ROOT/.local/measurements}"
TRACE="${TRACE:-$ROOT/lab/traces/fly_and_settle.json}"
STUDY="${STUDY:-$ROOT/lab/fixtures/queue_large/queue_large.sbnd}"
CERT="${CERT:-$ROOT/server/dev-cert/cert.pem}"
KEY="${KEY:-$ROOT/server/dev-cert/key.pem}"
READ_BPS="${READ_BPS:-5000000}"
FRAME_BYTES="${FRAME_BYTES:-51000}"
PORT="${PORT:-4433}"
URL="${URL:-https://127.0.0.1:${PORT}/}"
RANDOM_N="${RANDOM_N:-24}"
FRAME_COUNT="${FRAME_COUNT:-20}"
RTTS_MS="${RTTS_MS:-0,20,60,150}"
IFACE="${IFACE:-lo}"
P95_GAP_MS="${P95_GAP_MS:-100}"
U="${U:-0.95}"
SUMMARY="${SUMMARY:-$OUT_DIR/E4_PREMISE_SUMMARY.md}"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/target}"

mkdir -p "$OUT_DIR"
[[ -f "$CERT" ]] || "$ROOT/server/scripts/gen_dev_cert.sh"
[[ -f "$STUDY" ]] || { echo "missing study $STUDY" >&2; exit 1; }
[[ -f "$TRACE" ]] || { echo "missing trace $TRACE" >&2; exit 1; }

need_netem=0
IFS=',' read -ra RTT_ARR <<< "$RTTS_MS"
for r in "${RTT_ARR[@]}"; do
  [[ "$r" != "0" ]] && need_netem=1
done
if [[ "$need_netem" -eq 1 ]]; then
  if ! tc qdisc replace dev "$IFACE" root netem delay 1ms 2>/dev/null; then
    echo "FATAL: tc netem on $IFACE failed — need CAP_NET_ADMIN." >&2
    echo "This Cursor agent sandbox has CapEff=0 / NoNewPrivs=1 and cannot run netem." >&2
    echo "Run in a normal host terminal:" >&2
    echo "  sudo -E $ROOT/lab/scripts/e4_premise_check.sh" >&2
    tc qdisc del dev "$IFACE" root 2>/dev/null || true
    exit 2
  fi
  tc qdisc del dev "$IFACE" root 2>/dev/null || true
fi

cargo build -p exact-server -p window-harness --release >/dev/null
SERVER="$CARGO_TARGET_DIR/release/exact-server"
HARNESS="$CARGO_TARGET_DIR/release/window-harness"

ORACLE_TSV="$OUT_DIR/E4_PREMISE_ORACLE.tsv"
RANDOM_TSV="$OUT_DIR/E4_PREMISE_RANDOM.tsv"

echo -e "rtt_ms\tdepth\tmean_wait_ms\tp95_wait_ms\trecovered_ms\twait_samples\twasted_bytes" > "$ORACLE_TSV"
echo -e "rtt_ms\ttrial\tdepth\tmean_wait_ms\tp95_wait_ms\trecovered_ms\twait_samples\twasted_bytes" > "$RANDOM_TSV"

spid=""
cleanup() {
  kill "$spid" 2>/dev/null || true
  tc qdisc del dev "$IFACE" root 2>/dev/null || true
}
trap cleanup EXIT

set_rtt() {
  local rtt_ms=$1
  tc qdisc del dev "$IFACE" root 2>/dev/null || true
  if [[ "$rtt_ms" -gt 0 ]]; then
    local one_way
    one_way=$(python3 -c "print(max(0.001, float($rtt_ms) / 2.0))")
    tc qdisc replace dev "$IFACE" root netem delay "${one_way}ms"
    echo "netem $IFACE delay ${one_way}ms (target RTT≈${rtt_ms}ms)" >&2
  else
    echo "netem off (RTT≈0 floor control)" >&2
  fi
}

start_server() {
  kill "$spid" 2>/dev/null || true
  wait "$spid" 2>/dev/null || true
  "$SERVER" --port "$PORT" --study "$STUDY" --cert-pem "$CERT" --key-pem "$KEY" >/dev/null 2>&1 &
  spid=$!
  sleep 1.0
}

run_one() {
  local depth=$1 arm=$2
  "$HARNESS" --url "$URL" --trace "$TRACE" --read-bps "$READ_BPS" \
    --depth "$depth" --frame-count "$FRAME_COUNT" --fill-dwell-ms 0 \
    --mode trace --arm "$arm" --json
}

SUMMARY_ROWS=()

for rtt in "${RTT_ARR[@]}"; do
  set_rtt "$rtt"
  start_server
  echo "=== RTT=${rtt}ms — oracle D=1..8 (rank by p95) ===" >&2
  best_p95=""
  best_mean=""
  best_d=""
  for d in 1 2 3 4 5 6 7 8; do
    json=$(run_one "$d" "oracle_rtt${rtt}_d${d}")
    mean=$(printf '%s' "$json" | python3 -c "import json,sys; print(json.load(sys.stdin)['mean_wait_ms'])")
    p95=$(printf '%s' "$json" | python3 -c "import json,sys; print(json.load(sys.stdin)['p95_wait_ms'])")
    rec=$(printf '%s' "$json" | python3 -c "import json,sys; print(json.load(sys.stdin)['recovered_ms'])")
    ws=$(printf '%s' "$json" | python3 -c "import json,sys; print(json.load(sys.stdin)['wait_samples'])")
    waste=$(printf '%s' "$json" | python3 -c "import json,sys; print(json.load(sys.stdin)['wasted_bytes'])")
    echo -e "${rtt}\t${d}\t${mean}\t${p95}\t${rec}\t${ws}\t${waste}" >> "$ORACLE_TSV"
    echo "  D=$d mean=$mean p95=$p95" >&2
    if [[ -z "$best_p95" ]] || python3 -c "
import sys
p95, best_p95, mean, best_mean = map(float, sys.argv[1:])
sys.exit(0 if (p95 < best_p95 - 1e-9) or (abs(p95 - best_p95) <= 1e-9 and mean < best_mean) else 1)
" "$p95" "$best_p95" "$mean" "${best_mean:-0}"; then
      best_p95=$p95
      best_mean=$mean
      best_d=$d
    fi
  done

  echo "=== RTT=${rtt}ms — random N=$RANDOM_N ===" >&2
  rand_means=()
  rand_p95s=()
  for i in $(seq 1 "$RANDOM_N"); do
    d=$((1 + RANDOM % 8))
    json=$(run_one "$d" "random_rtt${rtt}_t${i}")
    mean=$(printf '%s' "$json" | python3 -c "import json,sys; print(json.load(sys.stdin)['mean_wait_ms'])")
    p95=$(printf '%s' "$json" | python3 -c "import json,sys; print(json.load(sys.stdin)['p95_wait_ms'])")
    rec=$(printf '%s' "$json" | python3 -c "import json,sys; print(json.load(sys.stdin)['recovered_ms'])")
    ws=$(printf '%s' "$json" | python3 -c "import json,sys; print(json.load(sys.stdin)['wait_samples'])")
    waste=$(printf '%s' "$json" | python3 -c "import json,sys; print(json.load(sys.stdin)['wasted_bytes'])")
    echo -e "${rtt}\t${i}\t${d}\t${mean}\t${p95}\t${rec}\t${ws}\t${waste}" >> "$RANDOM_TSV"
    echo "  trial $i D=$d mean=$mean p95=$p95" >&2
    rand_means+=("$mean")
    rand_p95s+=("$p95")
  done

  SUMMARY_ROWS+=("${rtt}|${best_d}|${best_mean}|${best_p95}|$(IFS=,; echo "${rand_means[*]}")|$(IFS=,; echo "${rand_p95s[*]}")")
done

tc qdisc del dev "$IFACE" root 2>/dev/null || true

python3 - "$SUMMARY" "$ORACLE_TSV" "$RANDOM_TSV" "$READ_BPS" "$FRAME_BYTES" "$U" "$P95_GAP_MS" "$TRACE" "$STUDY" "${SUMMARY_ROWS[@]}" <<'PY'
import math, statistics, sys
from pathlib import Path

summary, oracle_tsv, random_tsv, read_bps, frame_bytes, U, gap_need, trace, study, *rows = sys.argv[1:]
read_bps = float(read_bps)
frame_bytes = float(frame_bytes)
U = float(U)
gap_need = float(gap_need)
tf_ms = frame_bytes * 8.0 / read_bps * 1000.0

def pred_d(rtt_ms: float) -> int:
    return max(1, math.ceil(U * (1.0 + rtt_ms / tf_ms)))

lines = []
lines.append("# E4 premise check")
lines.append("")
lines.append(
    f"**Trace:** `{Path(trace).name}` · **Study:** `{Path(study).name}` · "
    f"**read_bps:** {int(read_bps)} · **Tf:** {tf_ms:.1f} ms (frame≈{int(frame_bytes)} B)"
)
lines.append("")
lines.append("## Decision rule (fixed in advance)")
lines.append("")
lines.append(
    f"- Decide on **p95_wait_ms**. Oracle beats random iff "
    f"`(mean of random session p95 − oracle p95) ≥ {gap_need:.0f} ms`."
)
lines.append("- Report mean too; do **not** decide on mean (cache hits dilute stalls).")
lines.append("- Oracle depth chosen by lowest p95 (mean tie-break).")
lines.append(
    "- **RTT=0 is a floor control only** — pipelining cannot help; oracle→D=1 is expected "
    "and does **not** answer the gate."
)
lines.append(f"- Predicted depth: `ceil({U} × (1 + RTT/Tf))` with Tf={tf_ms:.1f} ms.")
lines.append("")
lines.append("## Results by RTT")
lines.append("")
lines.append(
    "| RTT ms | role | oracle D | pred D | oracle mean | oracle p95 | "
    "random mean | random p95 | p95 gap | gate? |"
)
lines.append(
    "| ------ | ---- | -------- | ------ | ----------- | ---------- | "
    "----------- | ---------- | ------- | ----- |"
)

gate_rtts = []
any_gate_fail = False
for row in rows:
    rtt_s, best_d, best_mean, best_p95, means_csv, p95s_csv = row.split("|", 5)
    rtt = int(rtt_s)
    best_d = int(best_d)
    best_mean = float(best_mean)
    best_p95 = float(best_p95)
    rand_means = [float(x) for x in means_csv.split(",") if x]
    rand_p95s = [float(x) for x in p95s_csv.split(",") if x]
    r_mean = statistics.mean(rand_means)
    r_p95 = statistics.mean(rand_p95s)
    gap = r_p95 - best_p95
    pred = pred_d(rtt)
    role = "floor control" if rtt == 0 else "gate"
    if rtt == 0:
        gate_cell = "n/a (floor)"
    else:
        ok = gap >= gap_need
        gate_cell = "PASS (oracle≫random)" if ok else "FAIL (gap < threshold)"
        gate_rtts.append((rtt, best_d, pred, gap, ok))
        if not ok:
            any_gate_fail = True
    lines.append(
        f"| {rtt} | {role} | {best_d} | {pred} | {best_mean:.1f} | {best_p95:.1f} | "
        f"{r_mean:.1f} | {r_p95:.1f} | {gap:.1f} | {gate_cell} |"
    )

lines.append("")
lines.append("## Formula check (oracle D vs predicted)")
lines.append("")
lines.append("| RTT ms | oracle D | pred D | match? |")
lines.append("| ------ | -------- | ------ | ------ |")
for rtt, best_d, pred, gap, ok in gate_rtts:
    lines.append(f"| {rtt} | {best_d} | {pred} | {'yes' if best_d == pred else 'no'} |")
if not gate_rtts:
    lines.append("| — | — | — | no gate RTTs run |")

lines.append("")
lines.append("## Verdict")
lines.append("")
if not gate_rtts:
    lines.append("**GATE NOT YET ANSWERED** — no netem RTT>0 runs completed.")
elif any_gate_fail:
    fails = [str(r) for r, _, _, g, ok in gate_rtts if not ok]
    lines.append(
        f"**Gate fails at RTT ms ∈ {{{', '.join(fails)}}}** under the ≥{gap_need:.0f} ms p95 rule. "
        "D does not clearly matter at those points — do not treat the window formula as justified."
    )
else:
    matches = all(best_d == pred for _, best_d, pred, _, _ in gate_rtts)
    lines.append(
        f"**Gate answered: oracle beats random by ≥{gap_need:.0f} ms p95 at all tested RTTs.** "
        + (
            "Oracle D tracks `ceil(U×(1+RTT/Tf))` — first real evidence the formula works."
            if matches
            else "Oracle D does **not** match the formula at every RTT — continue, but treat "
            "the formula as unvalidated pending E1/E4."
        )
    )

lines.append("")
lines.append(f"Raw TSVs: `{Path(oracle_tsv).name}`, `{Path(random_tsv).name}`.")
Path(summary).write_text("\n".join(lines) + "\n")
print(Path(summary).read_text())
PY
