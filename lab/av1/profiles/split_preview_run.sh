#!/usr/bin/env bash
# Row SPLITPREVIEWB's bytes stage as split-preview-b.md §Stage 2 orders it: items 1 → 4, each pushed when done.
#
#   lab/av1/profiles/split_preview_run.sh [ITEM ...]     default: 1 2 3 4
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
W=lab/.av1-work/split
R=lab/av1/profiles/results/split-preview-b
push() {
  git add "$R"
  git commit -qm "$1" -- "$R" || return 0
  git pull -q --rebase --autostash origin claude/av1-split-preview-b
  git push -q origin claude/av1-split-preview-b
}
items=("$@")
[[ ${#items[@]} -gt 0 ]] || items=(1 2 3 4)
for item in "${items[@]}"; do
  echo "item $item from $(date -u +%T)" >> "$R/timeline.txt"
  lab/av1/.venv/bin/python lab/av1/profiles/split_preview_bytes.py lab/.av1-build "$W/work" "$R" --item "$item" --keep "$W/streams"
  echo "item $item done $(date -u +%T)" >> "$R/timeline.txt"
  push "lab/av1/profiles: split-preview-b stage 2 item $item rows"
done
