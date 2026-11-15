#!/bin/bash
# lostlines.sh MERGE FILE SIDE: the added lines of SIDE (p1|p2) vs the merge base that the merge result lacks
c=$1; f=$2; s=$(git rev-parse $c^${3#p}); mb=$(git merge-base $c^1 $c^2); res=$(git show $c:$f)
git diff -U0 $mb $s -- $f | grep '^+' | grep -v '^+++' | sed 's/^+//' | grep -v '^\s*$' | while IFS= read -r l; do grep -qxF -- "$l" <<<"$res" || echo "$l"; done
