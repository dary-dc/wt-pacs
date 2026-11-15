#!/usr/bin/env bash
cd /home/user/mac
export GIT_AUTHOR_NAME=dary-dc GIT_AUTHOR_EMAIL=crespoydelgado@gmail.com GIT_COMMITTER_NAME=dary-dc GIT_COMMITTER_EMAIL=crespoydelgado@gmail.com
git diff --cached HEAD | grep -qE "^\+(<<<<<<<|>>>>>>>|\|\|\|\|\|\|\|) " && { echo MARKERS; exit 1; }
git status --porcelain | grep -qE '^(UU|AA|DU|UD|AU|UA|DD) ' && { echo UNRESOLVED; exit 1; }
git commit -q -F - && git log -1 --format='%h %s'
