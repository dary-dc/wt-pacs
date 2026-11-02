#!/usr/bin/env bash
# The host's CPUs while run.mjs runs, one line a second: epoch s, busy and total jiffies over every CPU (/proc/stat).
#   lab/av1/decode/merge-free/busy.sh > busy.log &   (started after run.mjs; stops with it). passes/busy.mjs reads it.
while pgrep -f "merge-free/run.mjs" >/dev/null; do
  read -r _ u n s i w q sq st _ < /proc/stat
  echo "$(date +%s.%N) $((u+n+s+q+sq+st)) $((u+n+s+i+w+q+sq+st))"
  sleep 1
done
