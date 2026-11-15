#!/usr/bin/env bash
# sides.sh BASE TIP: per stage-B merge, each conflicted file's result as p1 (the tip), p2 (the branch) or edited;
# for p1, whether p2's blob is in p1's history ("old": an older version of the tip's own file).
base=$1; tip=$2
git log --first-parent --merges --reverse --format='%H %P' $base..$tip | while read c p1 p2; do
  echo "== ${c:0:8} $(git log -1 --format=%s $c | cut -c1-60)"
  git merge-tree --write-tree --name-only $p1 $p2 | sed -n '2,/^$/p' | grep -v '^$' | sort -u | while read f; do
    r=$(git rev-parse -q --verify $c:$f 2>/dev/null); a=$(git rev-parse -q --verify $p1:$f 2>/dev/null); b=$(git rev-parse -q --verify $p2:$f 2>/dev/null)
    if [ "$r" = "$a" ]; then
      old=new; [ -n "$b" ] && git log --format=%H $p1 -- "$f" | while read h; do [ "$(git rev-parse -q --verify $h:$f 2>/dev/null)" = "$b" ] && { echo old; break; }; done | grep -q old && old=old
      echo "p1 $old $f"
    elif [ "$r" = "$b" ]; then echo "p2 - $f"; else echo "edited - $f"; fi
  done
done
