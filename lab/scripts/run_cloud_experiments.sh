#!/usr/bin/env bash
# Run the full cloud measurement campaign. Local runs are dev-only — never quoted.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOG="${LOG:-$ROOT/.local/measurements/cloud/RUN.log}"
mkdir -p "$(dirname "$LOG")"

exec > >(tee -a "$LOG") 2>&1

echo "=== wt-pacs cloud experiments $(date -Iseconds) ==="

# Archive local sim-rtt floor rig if still running
if pgrep -f 'e4_premise_check.sh' >/dev/null 2>&1; then
  echo "Archiving partial local E4 floor rig (dev only, not quoted)..."
  cp -f "$ROOT/.local/measurements/E4_PREMISE_ORACLE.tsv" \
    "$ROOT/.local/measurements/E4_LOCAL_FLOOR_ORACLE.tsv" 2>/dev/null || true
  pkill -f 'e4_premise_check.sh' 2>/dev/null || true
  pkill -f 'exact-server --port 4434' 2>/dev/null || true
  sleep 1
fi

export SKIP_BUILD=1
export CLOUD_URL="${CLOUD_URL:-https://168.138.130.163:4435/}"

echo "--- deploy / sync ---"
"$ROOT/lab/scripts/deploy_exact_server_cloud.sh"

echo "--- E4 gate: mild cell (ratio ~1.1) ---"
"$ROOT/lab/scripts/e4_premise_cloud.sh" CELL=mild

echo "--- E4 context: severe cell (ratio ~1.8) ---"
"$ROOT/lab/scripts/e4_premise_cloud.sh" CELL=severe

echo "--- E1 saturation ---"
"$ROOT/lab/scripts/e1_saturation_cloud.sh"

echo "--- E2 miss cost ---"
"$ROOT/lab/scripts/e2_miss_cost_cloud.sh"

echo "=== done $(date -Iseconds) ==="
echo "Summaries in $ROOT/.local/measurements/cloud/"

python3 - "$ROOT/.local/measurements/cloud/CAMPAIGN_SUMMARY.md" <<'PY'
import sys
from pathlib import Path
out = Path(sys.argv[1])
root = out.parent
parts = []
for name in sorted(root.glob("*_SUMMARY.md")):
    if name.name == "CAMPAIGN_SUMMARY.md":
        continue
    parts.append(f"## {name.name}\n\n{name.read_text()}\n")
out.write_text("# Cloud measurement campaign\n\n" + "\n".join(parts))
print(f"Wrote {out}")
PY
