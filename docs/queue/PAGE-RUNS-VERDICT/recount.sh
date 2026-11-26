#!/usr/bin/env bash
# PAGE-RUNS-VERDICT's recount: each run's raw rows read from origin, apart from the run rows' own summaries.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
w=$(mktemp -d)
mkdir -p "$w"/t "$w"/r "$w"/e "$w"/a "$w"/c
show() { git show "origin/$1:$2" > "$3"; }
for f in flags-AD flags-CR; do show claude/page-runs "docs/reviews/page-runs-rows/$f.jsonl" "$w/t/$f.jsonl"; done
for f in chromium-D5a-busy chromium-Lbusy chromium-C; do show claude/report-arms "lab/report-arms/rows/r3-$f.jsonl" "$w/r/r3-$f.jsonl"; done
show claude/engines docs/decode/engine-cells/3b/m5-firefox.jsonl "$w/e/m5-firefox.jsonl"
for f in main p1b p1c80; do show claude/ask-cells "lab/viewer/rows/ask/$f.jsonl" "$w/a/$f.jsonl"; done
for f in L-512-1x L-2560-1x O-512-1x O-3328-1x T-2560-1x; do show claude/cache-arms "lab/cache-arms/rows/chromium-1125/$f.jsonl" "$w/c/$f.jsonl"; done
echo "## transport"; python3 "$here/transport.py" "$w/t"
echo "## reports"; python3 "$here/reports.py" "$w/r"
echo "## asking"; python3 "$here/ask.py" "$w"/a/main.jsonl "$w"/a/p1b.jsonl "$w"/a/p1c80.jsonl
echo "## engines 3b and cache"; python3 "$here/engines_cache.py" "$w/e" "$w/c"
