#!/bin/bash
# For each first-parent merge on the staging branch: conflicted files from merge-tree, and every path where the
# actual tree differs from the mechanical merge (conflicted paths reported separately).
base=$1; tip=$2
git log --first-parent --reverse --format='%H %P' $base..$tip | while read c p1 p2; do
  subj=$(git log -1 --format=%s $c | cut -c1-70)
  if [ -z "$p2" ]; then echo "== $c (non-merge) $subj"; git diff --stat $p1 $c | tail -1; continue; fi
  if echo "$subj" | grep -q -- '-s ours'; then
     d=$(git diff --name-only $p1 $c | wc -l); echo "== ${c:0:8} OURS tree-diff-vs-p1=$d"; continue; fi
  out=$(git merge-tree --write-tree --name-only $p1 $p2); mt=$(echo "$out" | head -1)
  conf=$(echo "$out" | sed -n '2,/^$/p' | grep -v '^$' | sort -u)
  diffs=$(git diff --name-only $mt $c | sort -u)
  extra=$(comm -13 <(echo "$conf") <(echo "$diffs") | grep -v '^$')
  echo "== ${c:0:8} $subj"
  echo "   conflicted: $(echo $conf)"
  [ -n "$extra" ] && echo "   CHANGED-BEYOND-CONFLICTS: $(echo $extra)"
done
