#!/usr/bin/env bash
# Comment budget — no source file spends more than RATIO comment lines per code line.
#
#   scripts/comment_budget.sh          check; non-zero exit names the files over budget
#   scripts/comment_budget.sh --list   every file, worst first, always exit 0
#
# A file that needs more than this is either doing too much or is being explained in the
# wrong place. CLAUDE.md#comments says where the explanation goes instead.
#
# `SAFETY:` / `# Safety` blocks do not count: they are contracts the compiler cannot express,
# and no budget should argue for dropping one.
set -euo pipefail
cd "$(cd "$(dirname "$0")/.." && pwd)"

RATIO=${RATIO:-0.25}
FLOOR=${FLOOR:-12}   # what any file may spend regardless of size: header and pointers
list=0
[[ "${1:-}" == "--list" ]] && list=1

files=$(git ls-files '*.rs' '*.ts' '*.js' '*.mjs' | grep -v -e '/node_modules/' -e '^target/')

# shellcheck disable=SC2086
awk -v ratio="$RATIO" -v floor="$FLOOR" -v list="$list" '
  FNR == 1                                 { order[++n] = FILENAME; safety = 0 }
  /^[[:space:]]*$/                         { next }
  /^[[:space:]]*(\/\/|\/\*|\*[ \t\/]|\*$)/ {
    if (/SAFETY|# Safety/) safety = 1
    if (!safety) comment[FILENAME]++
    next
  }
                                           { safety = 0; code[FILENAME]++ }
  END {
    for (i = 1; i <= n; i++) {
      f = order[i]
      budget = code[f] * ratio
      if (budget < floor) budget = floor
      if (list || comment[f] > budget) {
        printf "%7.2f %6d %6d  %s\n",
          (code[f] ? comment[f] / code[f] : 0), comment[f] + 0, code[f] + 0, f | "sort -rn"
      }
      if (comment[f] > budget) over++
    }
    close("sort -rn")
    if (list) exit 0
    if (over) {
      printf "\n%d file(s) over budget: %.2f comment lines per code line, floor %d.\n", over, ratio, floor
      printf "Move the narrative to docs/ and leave a one-line pointer. CLAUDE.md#comments\n"
      exit 1
    }
    print "comment budget ok"
  }' $files
