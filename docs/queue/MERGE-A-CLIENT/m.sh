#!/usr/bin/env bash
# usage: m.sh <index>  — start the merge of row <index>, show conflicts and the staged change
[ -f .git ] && git rev-parse -q --verify MERGE_HEAD >/dev/null 2>&1 && { cd /home/user/mac; }; cd /home/user/mac; git rev-parse -q --verify MERGE_HEAD >/dev/null && { echo "A MERGE IS IN PROGRESS"; exit 1; }
cd /home/user/mac
export GIT_AUTHOR_NAME=dary-dc GIT_AUTHOR_EMAIL=crespoydelgado@gmail.com GIT_COMMITTER_NAME=dary-dc GIT_COMMITTER_EMAIL=crespoydelgado@gmail.com
read i n t m < <(awk -v k=$1 '$1==k' /home/user/mac-work/list)
echo "== $i $n $t"
git merge --no-ff --no-commit $t >/dev/null 2>&1
echo "-- conflicts:"; git status --porcelain | grep -E '^(UU|AA|DU|UD|AU|UA|DD) '
echo "-- staged (vs HEAD):"; git diff --cached --stat HEAD | tail -40
