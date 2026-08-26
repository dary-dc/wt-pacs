#!/usr/bin/env bash
# Cloud campaign: E4 gate first; continue only if gate passes.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="$ROOT/.local/measurements/cloud/RUN.log"
export SKIP_BUILD=1 CLOUD_URL="${CLOUD_URL:-https://168.138.130.163:4435/}"
exec >> "$LOG" 2>&1
echo "=== E4 gate (8 runs @ RTT 90 ms) $(date -Iseconds) ==="
"$ROOT/lab/scripts/e4_premise_cloud.sh" CELL=mild RTTS_MS=90
if grep -q 'Gate FAIL' "$ROOT/.local/measurements/cloud/E4_CLOUD_MILD_SUMMARY.md" 2>/dev/null; then
  echo "Gate failed — stopping (no E1/E2/severe)."
  exit 0
fi
echo "=== gate passed — context + E1 + E2 ==="
"$ROOT/lab/scripts/e4_premise_cloud.sh" CELL=severe RTTS_MS=90
"$ROOT/lab/scripts/e1_saturation_cloud.sh" RTTS_MS=90
"$ROOT/lab/scripts/e2_miss_cost_cloud.sh" RTTS_MS=90
python3 - <<PY
from pathlib import Path
root = Path("$ROOT/.local/measurements/cloud")
parts = [f"## {p.name}\n\n{p.read_text()}\n" for p in sorted(root.glob("*_SUMMARY.md")) if p.name != "CAMPAIGN_SUMMARY.md"]
(root / "CAMPAIGN_SUMMARY.md").write_text("# Cloud campaign\n\n" + "\n".join(parts))
PY
echo "=== complete $(date -Iseconds) ==="
