#!/usr/bin/env bash
# conflict-sides.sh: for each merge, each conflicted path's resolution: TIP (staging side), BRANCH, or EDITED
cd /home/user/mac
git log --first-parent --reverse --format='%H %P' e5b20cba8d..HEAD | while read -r c p1 p2; do
  [ -z "$p2" ] && continue
  out=$(git merge-tree --write-tree --name-only "$p1" "$p2"); conf=$(echo "$out" | sed -n '2,/^$/p' | grep -v '^$' | sort -u)
  for p in $conf; do
    a=$(git rev-parse -q --verify "$c:$p" 2>/dev/null || echo ABSENT)
    b=$(git rev-parse -q --verify "$p1:$p" 2>/dev/null || echo ABSENT)
    m=$(git rev-parse -q --verify "$p2:$p" 2>/dev/null || echo ABSENT)
    if [ "$a" = "$b" ]; then s=TIP; elif [ "$a" = "$m" ]; then s=BRANCH; else s=EDITED; fi
    echo "${c:0:8} $s $p"
  done
done
