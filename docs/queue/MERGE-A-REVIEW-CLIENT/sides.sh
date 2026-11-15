#!/usr/bin/env bash
# sides.sh: for each path a merge changed beyond its conflicts, whether its tree holds the staging (TIP) side, the branch's, or an edit
cd /home/user/mac
while read -r c r p; do
  a=$(git rev-parse -q --verify "$c:$p" 2>/dev/null || echo ABSENT)
  b=$(git rev-parse -q --verify "$c^1:$p" 2>/dev/null || echo ABSENT)
  m=$(git rev-parse -q --verify "$c^2:$p" 2>/dev/null || echo ABSENT)
  if [ "$a" = "$b" ]; then s=TIP; elif [ "$a" = "$m" ]; then s=BRANCH; else s=EDITED; fi
  echo "$c $s $p"
done < /home/user/rev/out/beyond-named.txt
