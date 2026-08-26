#!/usr/bin/env bash
# E4 premise gate on cloud — 8 runs (one RTT, depths 1–8). Random arm derived from oracle waits.
#
# Gate cell: mild (185 ms/step, ratio ~1.1). Default RTT=90 ms only — formula predicts D=2
# for the entire 30–180 ms range at 250 KB / 10 Mbps (Tf≈205 ms); sweeping 4 RTTs repeats
# the same prediction.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
source "$ROOT/lab/scripts/cloud_common.sh"

CELL="${CELL:-mild}"
OUT_DIR="${OUT_DIR:-$ROOT/.local/measurements/cloud}"
# Gate: single RTT. Override RTTS_MS for context sweeps only.
RTTS_MS="${RTTS_MS:-90}"
DEPTHS="${DEPTHS:-1,2,3,4,5,6,7,8}"
FRAME_BYTES="${FRAME_BYTES:-250000}"
LINK_MBPS="${LINK_MBPS:-10}"
FRAME_COUNT="${FRAME_COUNT:-320}"
U="${U:-0.95}"
P95_GAP_MS="${P95_GAP_MS:-100}"
SKIP_BUILD="${SKIP_BUILD:-1}"

case "$CELL" in
  mild)
    TRACE="${TRACE:-$ROOT/lab/traces/mild_cell_scroll.json}"
    STEP_MS=185
    SUMMARY="${SUMMARY:-$OUT_DIR/E4_CLOUD_MILD_SUMMARY.md}"
    ROLE="gate"
    ;;
  severe)
    TRACE="${TRACE:-$ROOT/lab/traces/severe_cell_scroll.json}"
    STEP_MS=111
    SUMMARY="${SUMMARY:-$OUT_DIR/E4_CLOUD_SEVERE_SUMMARY.md}"
    ROLE="context"
    ;;
  *) echo "CELL must be mild or severe" >&2; exit 1 ;;
esac

mkdir -p "$OUT_DIR"
cloud_precheck_ratio "$FRAME_BYTES" "$LINK_MBPS" "$STEP_MS" "$CELL cell"
ensure_harness_binary
cloud_sync_netem_script
cloud_ensure_server

TAG="$(echo "$CELL" | tr '[:lower:]' '[:upper:]')"
SWEEP_JSON="$OUT_DIR/E4_CLOUD_${TAG}_SWEEPS.json"
ORACLE_TSV="$OUT_DIR/E4_CLOUD_${TAG}_ORACLE.tsv"
DERIVED_TSV="$OUT_DIR/E4_CLOUD_${TAG}_DERIVED.tsv"

echo -e "rtt_ms\tdepth\tmean_wait_ms\tp95_wait_ms\twait_n" > "$ORACLE_TSV"
echo -e "rtt_ms\toracle_d\tpred_d\toracle_p95\tderived_random_p95\tp95_gap\tformula_match\tgate" > "$DERIVED_TSV"

IFS=',' read -ra RTT_ARR <<< "$RTTS_MS"
SWEEP_PARTS=()

cleanup() { cloud_set_netem off 2>/dev/null || true; }
trap cleanup EXIT

pred_d() {
  python3 -c "
import math
rtt,U,fb,mbps=$1,$U,$FRAME_BYTES,$LINK_MBPS
tf=fb*8/(mbps*1_000_000)*1000
print(max(1, math.ceil(U*(1+rtt/tf))))
"
}

for rtt in "${RTT_ARR[@]}"; do
  n_depths=$(echo "$DEPTHS" | tr ',' '\n' | wc -l)
  echo "=== cloud RTT~${rtt}ms — depth sweep ${DEPTHS} (${n_depths} runs, one process) ===" >&2
  cloud_set_netem "$rtt"
  json=$("$HARNESS" --url "$CLOUD_URL" --trace "$TRACE" \
    --read-bps "$HARNESS_READ_BPS" --frame-count "$FRAME_COUNT" \
    --fill-dwell-ms 0 --mode trace --arm "${CELL}_rtt${rtt}" \
    --depth-sweep "$DEPTHS" --rtt-ms 0 --json)
  pred=$(pred_d "$rtt")
  SWEEP_PARTS+=("$(printf '%s' "$json" | python3 -c "
import json,sys
runs=json.load(sys.stdin)
rtt,pred,gap=int(sys.argv[1]),int(sys.argv[2]),float(sys.argv[3])
print(json.dumps({'rtt_ms':rtt,'pred_d':pred,'p95_gap_ms':gap,'runs':runs}))
" "$rtt" "$pred" "$P95_GAP_MS")")
  printf '%s' "$json" | python3 -c "
import json,sys
for r in json.load(sys.stdin):
    print(f\"{sys.argv[1]}\t{r['depth']}\t{r['mean_wait_ms']}\t{r['p95_wait_ms']}\t{len(r.get('wait_ms',[]))}\")
" "$rtt" >> "$ORACLE_TSV"
done

cloud_set_netem off

python3 - "$SWEEP_JSON" "${SWEEP_PARTS[@]}" <<'PY'
import json, sys
from pathlib import Path
out = Path(sys.argv[1])
blocks = [json.loads(s) for s in sys.argv[2:]]
out.write_text(json.dumps(blocks, indent=2) + "\n")
n = sum(len(b["runs"]) for b in blocks)
print(f"wrote {out} ({len(blocks)} RTT block(s), {n} oracle runs)")
PY

python3 - "$SUMMARY" "$DERIVED_TSV" "$SWEEP_JSON" "$CELL" "$ROLE" "$P95_GAP_MS" "$TRACE" "$CLOUD_URL" "$LINK_MBPS" "$U" "$FRAME_BYTES" <<'PY'
import json, statistics, sys
from pathlib import Path

(summary, derived_tsv, sweep_path, cell, role, gap_need, trace, cloud_url,
 mbps, U, frame_bytes) = sys.argv[1:12]
gap_need = float(gap_need)
U = float(U)
blocks = json.loads(Path(sweep_path).read_text())
tf_ms = int(frame_bytes) * 8 / (float(mbps) * 1_000_000) * 1000

def pick_oracle(runs):
    best = runs[0]
    for r in runs[1:]:
        if r["p95_wait_ms"] < best["p95_wait_ms"] - 1e-9:
            best = r
        elif abs(r["p95_wait_ms"] - best["p95_wait_ms"]) <= 1e-9 and r["mean_wait_ms"] < best["mean_wait_ms"]:
            best = r
    return best

def derived_random_p95(runs):
    """Uniform D~1..8 session: E[p95_D] = mean of per-depth p95 (paired, same trace)."""
    return statistics.mean(r["p95_wait_ms"] for r in runs)

lines = [
    f"# E4 premise — cloud ({cell}, {role})",
    "",
    f"**Path:** `{cloud_url}` · **Trace:** `{Path(trace).name}` · "
    f"server tc {int(float(mbps))} Mbps · **Tf ≈ {tf_ms:.0f} ms**",
    "",
]
if role == "gate":
    n = sum(len(b["runs"]) for b in blocks)
    lines += [
        f"**Gate:** {n} oracle runs (depths 1–8 at RTT≈{blocks[0]['rtt_ms']} ms). "
        "Random arm derived from the same per-frame waits — no extra runs.",
        "",
        f"Formula at this cell: `D = ceil({U} × (1 + RTT/Tf))` → **pred D = {blocks[0]['pred_d']}** "
        f"for RTT 30–180 ms (does not reach 3 until ~227 ms).",
        "",
    ]
else:
    lines.append("> Context only — gate decided on mild cell.")
    lines.append("")

lines += [
    "## Premise gate (random vs oracle)",
    "",
    "Derived random p95 = mean(p95 at each D) — exact mixture for uniform D per session.",
    "",
    "| RTT ms | oracle D | pred D | formula? | oracle p95 | derived random p95 | gap | gate? |",
    "| ------ | -------- | ------ | -------- | ---------- | ------------------ | --- | ----- |",
]

derived_rows = []
gate_ok = True
formula_ok = True
for block in blocks:
    runs = block["runs"]
    oracle = pick_oracle(runs)
    rand_p95 = derived_random_p95(runs)
    gap = rand_p95 - oracle["p95_wait_ms"]
    pred = block["pred_d"]
    fmatch = oracle["depth"] == pred
    if role == "gate" and not fmatch:
        formula_ok = False
    ok = gap >= gap_need
    if role == "gate" and not ok:
        gate_ok = False
    gate = "PASS" if ok else "FAIL" if role == "gate" else "context"
    fm = "yes" if fmatch else "**no**"
    lines.append(
        f"| {block['rtt_ms']} | {oracle['depth']} | {pred} | {fm} | "
        f"{oracle['p95_wait_ms']:.1f} | {rand_p95:.1f} | {gap:.1f} | {gate} |"
    )
    derived_rows.append((block["rtt_ms"], oracle["depth"], pred,
                         oracle["p95_wait_ms"], rand_p95, gap, fmatch, gate))

with open(derived_tsv, "w") as f:
    f.write("rtt_ms\toracle_d\tpred_d\toracle_p95\tderived_random_p95\tp95_gap\tformula_match\tgate\n")
    for row in derived_rows:
        f.write("\t".join(str(x) for x in row) + "\n")

lines += ["", "## Formula check", ""]
if blocks:
    b = blocks[0]
    oracle = pick_oracle(b["runs"])
    lines.append(
        f"At RTT≈{b['rtt_ms']} ms: oracle chose **D={oracle['depth']}**, formula predicts **D={b['pred_d']}**."
    )
    if oracle["depth"] == b["pred_d"]:
        lines.append(
            "Match — but if the formula is **2 everywhere** in the realistic RTT range, "
            "the next question is whether a **hardcoded D=2** matches oracle as well as the formula "
            "(which would allow deleting the formula and both RTT/Tf estimators)."
        )
    else:
        lines.append(
            "Mismatch — formula does not pick the oracle depth at this RTT; "
            "do not treat `ceil(U×(1+RTT/Tf))` as validated here."
        )

lines += ["", "## Verdict", ""]
if role == "context":
    lines.append("Context run — gate decided on mild cell only.")
elif gate_ok and formula_ok:
    lines.append(
        f"**Gate PASS** — derived random beats oracle by ≥{gap_need:.0f} ms p95, "
        f"and oracle D={oracle['depth']} matches formula pred D={b['pred_d']}."
    )
    lines.append(
        "**Next (if proceeding):** compare hardcoded D=2 vs formula-driven D — "
        "if equivalent across the RTT range, ship constant depth and drop estimators."
    )
elif gate_ok:
    lines.append(
        f"**Premise PASS, formula mismatch** — D matters (gap ≥{gap_need:.0f} ms) "
        "but oracle D ≠ predicted. Formula needs revision, not deletion."
    )
else:
    lines.append(
        f"**Gate FAIL** — p95 gap < {gap_need:.0f} ms. D does not clearly matter in this cell."
    )

Path(summary).write_text("\n".join(lines) + "\n")
print(Path(summary).read_text())
PY

echo "Wrote $SUMMARY" >&2
