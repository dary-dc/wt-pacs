#!/bin/bash
# Per conflicted file of each merge: added lines of either side (vs the merge base) that the result does not contain.
base=$1; tip=$2
git log --first-parent --reverse --format='%H %P' $base..$tip | while read c p1 p2; do
  [ -z "$p2" ] && continue
  git log -1 --format=%s $c | grep -q -- '-s ours' && continue
  mb=$(git merge-base $p1 $p2)
  for f in $(git merge-tree --write-tree --name-only $p1 $p2 | sed -n '2,/^$/p' | grep -v '^$' | sort -u); do
    res=$(git show $c:$f 2>/dev/null)
    for side in p1 p2; do s=${!side}
      lost=$(git diff -U0 $mb $s -- $f | grep '^+' | grep -v '^+++' | sed 's/^+//' | grep -v '^\s*$' | while IFS= read -r l; do grep -qxF -- "$l" <<<"$res" || echo "$l"; done | wc -l)
      added=$(git diff -U0 $mb $s -- $f | grep '^+' | grep -v '^+++' | grep -vc '^+\s*$')
      echo "${c:0:8} $f $side lost=$lost/$added"
    done
  done
done
