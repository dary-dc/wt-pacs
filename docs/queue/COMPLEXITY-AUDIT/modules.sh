#!/usr/bin/env bash
# modules.sh: non-blank code lines per product module, claude/unified against the five baseline tips (git only)
set -uo pipefail
cd /home/user/wt-pacs
tips="unified unified-client unified-codecs unified-server unified-pacs line-hygiene"
code='\.(rs|ts|js|mjs|cjs|sh|py|cpp|cc|c|h|hpp|go|wgsl|html|css)$'
excl='(^|/)(dist|built|pkg|node_modules|vendor)/|package-lock\.json'
lines() { git ls-tree -r --name-only "origin/claude/$1" -- "$2" | grep -E "$code" | grep -vE "$excl" | while read -r f; do git show "origin/claude/$1:$f"; done | grep -cv '^[[:space:]]*$'; }
mods=$(for t in $tips; do git ls-tree -r --name-only origin/claude/$t -- server/src client ingest carrier common tools deploy scripts; done \
  | grep -E "$code" | grep -vE "$excl" | awk -F/ '{ if ($1=="server") print $1"/"$2"/"$3; else if (NF>2) print $1"/"$2; else print $1 }' | sed -E 's#^(server/src/[^/]+)\.rs$#\1#' | sort -u)
echo "| module | $(echo $tips | sed 's/ / | /g') |"; echo "| --- $(for t in $tips; do printf '| ---: '; done)|"
for m in $mods; do
  row="| $m"; for t in $tips; do
    p=$m; git cat-file -e "origin/claude/$t:$m.rs" 2>/dev/null && p=$m.rs
    row="$row | $(lines $t $p)"; done; echo "$row |"
done
